import logging
import os
import shutil
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from app.detection.engine import scan_text
from app.scan.git_ops import (
    clone_bare,
    get_head_commit,
    iter_commit_diffs,
    list_files_at_head,
    read_file_at_head,
)
from app.state import repository as repo
from app.state.db import db_path, init_db
from app.state.repository import RepoRef

logger = logging.getLogger(__name__)


def scan_repository(conn, repo_ref: RepoRef, clone_source: str, workdir: str) -> None:
    if os.path.exists(workdir):
        shutil.rmtree(workdir)

    logger.info("scan: %s/%s - cloning", repo_ref.owner, repo_ref.name)
    try:
        clone_bare(clone_source, workdir)
        head_sha = get_head_commit(workdir)
        logger.info(
            "scan: %s/%s - cloned, head=%s, scanning working tree",
            repo_ref.owner,
            repo_ref.name,
            head_sha,
        )

        findings_count = 0
        for file_path in list_files_at_head(workdir):
            text = read_file_at_head(workdir, file_path)
            for finding in scan_text(text):
                repo.add_finding(
                    conn,
                    repo_ref.repo_id,
                    repo_ref.owner,
                    repo_ref.name,
                    file_path,
                    head_sha,
                    finding.secret_type,
                    finding.secret_value,
                    finding.line_number,
                )
                findings_count += 1

        logger.info(
            "scan: %s/%s - working tree done (%d findings), scanning commit history",
            repo_ref.owner,
            repo_ref.name,
            findings_count,
        )

        for commit_sha, diff_text in iter_commit_diffs(workdir):
            for finding in scan_text(diff_text):
                repo.add_finding(
                    conn,
                    repo_ref.repo_id,
                    repo_ref.owner,
                    repo_ref.name,
                    "<commit-diff>",
                    commit_sha,
                    finding.secret_type,
                    finding.secret_value,
                    finding.line_number,
                )
                findings_count += 1

        repo.mark_done(conn, repo_ref.repo_id, head_sha)
        logger.info(
            "scan: %s/%s - done, %d findings total",
            repo_ref.owner,
            repo_ref.name,
            findings_count,
        )
    except Exception as exc:  # noqa: BLE001 - broad on purpose: any clone/scan failure is recoverable via retry
        logger.error("scan: %s/%s - failed: %s", repo_ref.owner, repo_ref.name, exc)
        repo.mark_failed(conn, repo_ref.repo_id, str(exc))
    finally:
        if os.path.exists(workdir):
            shutil.rmtree(workdir)


def _worker_loop(
    db_file: str,
    workdir_root: str,
    source_url_fn: Callable[[RepoRef], str],
    max_repos: int | None,
    counter: list[int],
    counter_lock: threading.Lock,
) -> int:
    # Each worker thread gets its own sqlite3 connection - the module is
    # not safe to share one connection across threads, and separate
    # connections is also what lets claim_next's BEGIN IMMEDIATE lock
    # actually serialize claims between threads instead of them all
    # reusing one already-open transaction.
    conn = init_db(db_file)
    processed = 0
    try:
        while True:
            with counter_lock:
                if max_repos is not None and counter[0] >= max_repos:
                    break
                counter[0] += 1
            ref = repo.claim_next(conn)
            if ref is None:
                with counter_lock:
                    counter[0] -= 1
                break
            workdir = os.path.join(workdir_root, f"repo-{ref.repo_id}")
            scan_repository(conn, ref, source_url_fn(ref), workdir)
            processed += 1
    finally:
        conn.close()
    return processed


def run_scan_loop(
    conn,
    workdir_root: str,
    source_url_fn: Callable[[RepoRef], str],
    stale_timeout_seconds: int = 3600,
    max_repos: int | None = None,
    workers: int = 1,
) -> int:
    requeued = repo.requeue_stale(conn, stale_timeout_seconds)
    if requeued:
        logger.info("scan: requeued %d stale in-progress repos", requeued)
    os.makedirs(workdir_root, exist_ok=True)

    if workers <= 1:
        processed = 0
        while max_repos is None or processed < max_repos:
            ref = repo.claim_next(conn)
            if ref is None:
                break
            workdir = os.path.join(workdir_root, f"repo-{ref.repo_id}")
            scan_repository(conn, ref, source_url_fn(ref), workdir)
            processed += 1
    else:
        logger.info("scan: starting %d parallel workers", workers)
        db_file = db_path(conn)
        counter = [0]
        counter_lock = threading.Lock()
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [
                executor.submit(
                    _worker_loop,
                    db_file,
                    workdir_root,
                    source_url_fn,
                    max_repos,
                    counter,
                    counter_lock,
                )
                for _ in range(workers)
            ]
            processed = sum(future.result() for future in futures)

    logger.info("scan: loop finished, %d repos processed this run", processed)
    return processed
