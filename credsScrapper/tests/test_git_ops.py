import subprocess

import pytest

from app.scan.git_ops import (
    clone_bare,
    get_head_commit,
    iter_commit_diffs,
    list_files_at_head,
    read_file_at_head,
)


def _run(cmd, cwd):
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)


@pytest.fixture
def source_repo(tmp_path):
    repo_dir = tmp_path / "source"
    repo_dir.mkdir()
    _run(["git", "init"], repo_dir)
    _run(["git", "config", "user.email", "test@example.com"], repo_dir)
    _run(["git", "config", "user.name", "Test"], repo_dir)

    (repo_dir / "config.py").write_text("SAFE = 'nothing here'\n")
    _run(["git", "add", "config.py"], repo_dir)
    _run(["git", "commit", "-m", "initial commit"], repo_dir)

    (repo_dir / "config.py").write_text("AWS_KEY = 'AKIAABCDEFGH12345678'\n")
    _run(["git", "add", "config.py"], repo_dir)
    _run(["git", "commit", "-m", "oops, added a key"], repo_dir)

    (repo_dir / "config.py").write_text("SAFE = 'nothing here'\n")
    _run(["git", "add", "config.py"], repo_dir)
    _run(["git", "commit", "-m", "remove key"], repo_dir)

    return repo_dir


@pytest.fixture
def bare_clone(source_repo, tmp_path):
    dest = tmp_path / "bare"
    clone_bare(str(source_repo), str(dest))
    return dest


def test_clone_bare_creates_repo(bare_clone):
    assert (bare_clone / "HEAD").exists()


def test_get_head_commit_returns_40_char_sha(bare_clone):
    sha = get_head_commit(str(bare_clone))
    assert len(sha) == 40


def test_list_files_at_head(bare_clone):
    assert list_files_at_head(str(bare_clone)) == ["config.py"]


def test_read_file_at_head_reflects_final_state(bare_clone):
    content = read_file_at_head(str(bare_clone), "config.py")
    assert "AKIA" not in content
    assert "SAFE" in content


@pytest.fixture
def unicode_filename_repo(tmp_path):
    repo_dir = tmp_path / "unicode_source"
    repo_dir.mkdir()
    _run(["git", "init"], repo_dir)
    _run(["git", "config", "user.email", "test@example.com"], repo_dir)
    _run(["git", "config", "user.name", "Test"], repo_dir)

    filename = "公告：头条.md"
    (repo_dir / filename).write_text("AWS_KEY = 'AKIAABCDEFGH12345678'\n", encoding="utf-8")
    _run(["git", "add", filename], repo_dir)
    _run(["git", "commit", "-m", "add unicode filename"], repo_dir)

    return repo_dir, filename


def test_list_files_at_head_returns_unquoted_unicode_filename(unicode_filename_repo, tmp_path):
    repo_dir, filename = unicode_filename_repo
    dest = tmp_path / "unicode_bare"
    clone_bare(str(repo_dir), str(dest))
    assert list_files_at_head(str(dest)) == [filename]


def test_read_file_at_head_works_with_unicode_filename(unicode_filename_repo, tmp_path):
    repo_dir, filename = unicode_filename_repo
    dest = tmp_path / "unicode_bare2"
    clone_bare(str(repo_dir), str(dest))
    content = read_file_at_head(str(dest), filename)
    assert "AKIAABCDEFGH12345678" in content


def test_iter_commit_diffs_includes_removed_secret(bare_clone):
    all_diff_text = "\n".join(diff for _, diff in iter_commit_diffs(str(bare_clone)))
    assert "AKIAABCDEFGH12345678" in all_diff_text


def test_iter_commit_diffs_yields_three_commits(bare_clone):
    shas = [sha for sha, _ in iter_commit_diffs(str(bare_clone))]
    assert len(shas) == 3
    assert len(set(shas)) == 3
