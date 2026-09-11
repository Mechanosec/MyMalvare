import os
import shutil
from collections.abc import Callable

from app.detection.engine import scan_text
from app.scan.git_ops import (
    clone_bare,
    get_head_commit,
    iter_commit_diffs,
    list_files_at_head,
    read_file_at_head,
)
from app.state import repository as repo
from app.state.repository import RepoRef


def scan_repository(conn, repo_ref: RepoRef, clone_source: str, workdir: str) -> None:
    if os.path.exists(workdir):
        shutil.rmtree(workdir)

    try:
        clone_bare(clone_source, workdir)
        head_sha = get_head_commit(workdir)

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

        repo.mark_done(conn, repo_ref.repo_id, head_sha)
    except Exception as exc:  # noqa: BLE001 - broad on purpose: any clone/scan failure is recoverable via retry
        repo.mark_failed(conn, repo_ref.repo_id, str(exc))
    finally:
        if os.path.exists(workdir):
            shutil.rmtree(workdir)


def run_scan_loop(
    conn,
    workdir_root: str,
    source_url_fn: Callable[[RepoRef], str],
    stale_timeout_seconds: int = 3600,
    max_repos: int | None = None,
) -> int:
    repo.requeue_stale(conn, stale_timeout_seconds)
    os.makedirs(workdir_root, exist_ok=True)

    processed = 0
    while max_repos is None or processed < max_repos:
        ref = repo.claim_next(conn)
        if ref is None:
            break
        workdir = os.path.join(workdir_root, f"repo-{ref.repo_id}")
        scan_repository(conn, ref, source_url_fn(ref), workdir)
        processed += 1

    return processed
