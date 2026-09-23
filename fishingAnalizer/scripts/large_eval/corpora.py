"""Read labelled public mail without executing content or unpacking archives."""

import csv
import hashlib
import mailbox
import re
import tarfile
from dataclasses import dataclass
from email.message import EmailMessage
from pathlib import Path
from typing import Iterator, Literal


MAX_MAIL_BYTES = 256_000


@dataclass(frozen=True)
class SourceMail:
    source: str
    label: Literal["phishing", "ham"]
    source_id: str
    raw: bytes


def iter_nazario(path: Path, source: str) -> Iterator[SourceMail]:
    box = mailbox.mbox(path, create=False)
    try:
        for key in box.iterkeys():
            raw = box.get_bytes(key)
            if len(raw) <= MAX_MAIL_BYTES:
                yield SourceMail(source, "phishing", str(key), raw)
    finally:
        box.close()


def iter_phishing_pot(root: Path) -> Iterator[SourceMail]:
    email_dir = root / "email"
    if not email_dir.is_dir():
        raise ValueError("Phishing Pot email directory is missing")
    for path in sorted(email_dir.rglob("*.eml")):
        if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_MAIL_BYTES:
            continue
        yield SourceMail("phishing-pot", "phishing", str(path.relative_to(email_dir)), path.read_bytes())


def iter_trec_ham(path: Path, source: str) -> Iterator[SourceMail]:
    with tarfile.open(path, "r:*") as archive:
        members = {member.name: member for member in archive.getmembers()}
        index_names = [name for name in members if name.endswith("/full/index")]
        if len(index_names) != 1:
            raise ValueError("TREC full index is missing or ambiguous")
        prefix = index_names[0][:-len("full/index")]
        index_file = archive.extractfile(members[index_names[0]])
        if index_file is None:
            raise ValueError("TREC index is unreadable")
        for line in index_file.read().decode("ascii", errors="replace").splitlines():
            match = re.fullmatch(r"(ham|spam) \.\./data/(inmail\.\d+)", line.strip())
            if match is None or match.group(1) != "ham":
                continue
            member = members.get(prefix + "data/" + match.group(2))
            if member is None or not member.isfile() or member.size > MAX_MAIL_BYTES:
                continue
            stream = archive.extractfile(member)
            if stream is not None:
                yield SourceMail(source, "ham", match.group(2), stream.read())


def iter_trec_csv_ham(path: Path, source: str, *, expected_sha256: str,
                      expected_ham_count: int) -> Iterator[SourceMail]:
    """Use a curated CSV only after its identity and ham mapping were verified."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected_sha256:
        raise ValueError("TREC CSV checksum mismatch")
    csv.field_size_limit(4 * 1024 * 1024)
    count = 0
    with path.open(newline="", encoding="utf-8-sig", errors="replace") as stream:
        reader = csv.DictReader(stream)
        if not {"sender", "subject", "body", "label"}.issubset(reader.fieldnames or []):
            raise ValueError("TREC CSV schema mismatch")
        for index, row in enumerate(reader, start=1):
            if row["label"] != "0":
                continue
            count += 1
            body = row["body"] or ""
            if len(body.encode("utf-8")) > MAX_MAIL_BYTES:
                continue
            mail = EmailMessage()
            try:
                mail["From"] = (row["sender"] or "").replace("\n", " ").replace("\r", " ")[:320]
                mail["Subject"] = (row["subject"] or "").replace("\n", " ").replace("\r", " ")[:500]
                mail.set_content(body)
            except (TypeError, ValueError):
                continue
            yield SourceMail(source, "ham", str(index), mail.as_bytes())
    if count != expected_ham_count:
        raise ValueError("TREC CSV ham count mismatch")


def iter_spamassassin(path: Path, source: str) -> Iterator[SourceMail]:
    with tarfile.open(path, "r:bz2") as archive:
        for member in archive:
            name = Path(member.name).name
            if not member.isfile() or member.size > MAX_MAIL_BYTES or not re.fullmatch(r"\d+\.[0-9a-f]+", name):
                continue
            stream = archive.extractfile(member)
            if stream is not None:
                yield SourceMail(source, "ham", name, stream.read())
