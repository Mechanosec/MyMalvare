import re
import subprocess
from collections.abc import Iterator


def _run(args: list[str], cwd: str | None = None) -> str:
    result = subprocess.run(
        args, cwd=cwd, check=True, capture_output=True, text=True
    )
    return result.stdout


def clone_bare(source: str, dest_dir: str) -> None:
    _run(["git", "clone", "--bare", source, dest_dir])


def get_head_commit(repo_path: str) -> str:
    return _run(["git", "-C", repo_path, "rev-parse", "HEAD"]).strip()


def list_files_at_head(repo_path: str) -> list[str]:
    output = _run(["git", "-C", repo_path, "ls-tree", "-r", "--name-only", "HEAD"])
    return [line for line in output.splitlines() if line]


def read_file_at_head(repo_path: str, file_path: str) -> str:
    return _run(["git", "-C", repo_path, "show", f"HEAD:{file_path}"])


_COMMIT_HEADER_RE = re.compile(r"(?m)^commit ([0-9a-f]{40})(?: .*)?$")


def iter_commit_diffs(repo_path: str) -> Iterator[tuple[str, str]]:
    output = _run(["git", "-C", repo_path, "log", "-p", "--full-history"])
    matches = list(_COMMIT_HEADER_RE.finditer(output))
    for i, match in enumerate(matches):
        sha = match.group(1)
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(output)
        yield sha, output[start:end]
