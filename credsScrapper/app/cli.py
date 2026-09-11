import argparse
import logging
import sys
from datetime import datetime, timedelta, timezone

from app.discovery.gharchive import fetch_hour_lines
from app.discovery.worker import run_discovery_once
from app.scan.orchestrator import run_scan_loop
from app.state.db import init_db
from app.state.repository import RepoRef

logger = logging.getLogger(__name__)


def _configure_logging(log_file: str) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stderr), logging.FileHandler(log_file)],
        force=True,
    )


def build_clone_url(repo_ref: RepoRef) -> str:
    return f"https://github.com/{repo_ref.owner}/{repo_ref.name}.git"


def _cmd_discover(args: argparse.Namespace) -> int:
    _configure_logging(args.log_file)
    logger.info("discover: starting")
    conn = init_db(args.db)
    hour = datetime.now(timezone.utc) - timedelta(hours=1)
    added = run_discovery_once(conn, fetch_hour_lines(hour))
    print(f"discovered {added} new candidate repos")
    return 0


def _cmd_scan(args: argparse.Namespace) -> int:
    _configure_logging(args.log_file)
    logger.info("scan: starting (max_repos=%s, workers=%d)", args.max_repos, args.workers)
    conn = init_db(args.db)
    # source_url_fn is a lambda that looks up build_clone_url dynamically (via the
    # module namespace) rather than binding the function object directly, so tests
    # can monkeypatch app.cli.build_clone_url and have it take effect.
    processed = run_scan_loop(
        conn,
        args.workdir,
        source_url_fn=lambda ref: build_clone_url(ref),
        stale_timeout_seconds=args.stale_timeout,
        max_repos=args.max_repos,
        workers=args.workers,
    )
    print(f"scanned {processed} repos")
    return 0


def build_parser() -> argparse.ArgumentParser:
    log_file_parent = argparse.ArgumentParser(add_help=False)
    log_file_parent.add_argument(
        "-l",
        "--log-file",
        default="credsscrapper.log",
        help="Where to append progress/debug logs (default: credsscrapper.log)",
    )

    parser = argparse.ArgumentParser(prog="credsscrapper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    discover = subparsers.add_parser("discover", parents=[log_file_parent])
    discover.add_argument("-d", "--db", default="state.db")
    discover.set_defaults(func=_cmd_discover)

    scan = subparsers.add_parser("scan", parents=[log_file_parent])
    scan.add_argument("-d", "--db", default="state.db")
    scan.add_argument("-w", "--workdir", default="workdir")
    scan.add_argument("-m", "--max-repos", type=int, default=None)
    scan.add_argument("-s", "--stale-timeout", type=int, default=3600)
    scan.add_argument(
        "-j",
        "--workers",
        type=int,
        default=1,
        help="Number of repos to clone/scan concurrently (default: 1, sequential)",
    )
    scan.add_argument(
        "-r",
        "--resume",
        action="store_true",
        help="No-op: scanning always resumes from persisted state. Kept for CLI clarity.",
    )
    scan.set_defaults(func=_cmd_scan)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
