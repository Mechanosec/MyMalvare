import argparse
import sys
from datetime import datetime, timedelta, timezone

from app.discovery.gharchive import fetch_hour_lines
from app.discovery.worker import run_discovery_once
from app.scan.orchestrator import run_scan_loop
from app.state.db import init_db
from app.state.repository import RepoRef


def build_clone_url(repo_ref: RepoRef) -> str:
    return f"https://github.com/{repo_ref.owner}/{repo_ref.name}.git"


def _cmd_discover(args: argparse.Namespace) -> int:
    conn = init_db(args.db)
    hour = datetime.now(timezone.utc) - timedelta(hours=1)
    added = run_discovery_once(conn, fetch_hour_lines(hour))
    print(f"discovered {added} new candidate repos")
    return 0


def _cmd_scan(args: argparse.Namespace) -> int:
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
    )
    print(f"scanned {processed} repos")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="credsscrapper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    discover = subparsers.add_parser("discover")
    discover.add_argument("--db", default="state.db")
    discover.set_defaults(func=_cmd_discover)

    scan = subparsers.add_parser("scan")
    scan.add_argument("--db", default="state.db")
    scan.add_argument("--workdir", default="workdir")
    scan.add_argument("--max-repos", type=int, default=None)
    scan.add_argument("--stale-timeout", type=int, default=3600)
    scan.add_argument(
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
