"""Prepare a reproducible local mail benchmark without writing messages to Git."""

import argparse
import hashlib
import json
import os
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from scripts.evaluate_local import message_from_bytes
from scripts.large_eval.corpora import (SourceMail, iter_nazario, iter_phishing_pot,
                                       iter_spamassassin, iter_trec_csv_ham, iter_trec_ham)
from scripts.large_eval.split import fingerprints, near_duplicate, split_for


TREC_CSV_MD5 = {
    "trec05": "ef4023fa9e64247212487b77a4c7d98e",
    "trec06": "b840dc9477f86c098a71a0dfd25c928e",
    "trec07": "e5a5ae0de1580965191cb32806dc0dae",
}
TREC_ORIGINAL_HAM = {"trec05": 39_399, "trec06": 12_910, "trec07": 25_220}


@dataclass(frozen=True)
class CorpusPaths:
    nazario: dict[str, Path]
    phishing_pot: Path
    trec: dict[str, Path]
    spamassassin: dict[str, Path]

    @classmethod
    def from_dir(cls, directory: Path) -> "CorpusPaths":
        nazario = {f"nazario-{path.name.removeprefix('phishing-')}": path
                   for path in directory.glob("phishing-20??") if path.is_file()}
        for path in directory.glob("phishing[0-9].mbox"):
            nazario[f"nazario-early-{path.stem}"] = path
        early = directory / "20051114.mbox"
        if early.is_file():
            nazario["nazario-early-2005"] = early
        trec = {}
        for year in ("05", "06", "07"):
            for name in (f"trec{year}p-1.tgz", f"trec{year}p.tgz",
                         f"trec{year}p-1.tar.bz2", f"TREC_{year}.csv"):
                path = directory / name
                if path.is_file():
                    trec[f"trec{year}"] = path
                    break
        spamassassin = {}
        for key in ("easy_ham", "easy_ham_2", "hard_ham"):
            for name in (f"20030228_{key}.tar.bz2", key.replace("_", "-")):
                path = directory / name
                if path.is_file():
                    spamassassin[f"spamassassin-{key}"] = path
                    break
        return cls(nazario, directory / "phishing_pot", trec, spamassassin)


def file_hash(path: Path, algorithm: str = "sha256") -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def iter_sources(paths: CorpusPaths) -> Iterator[SourceMail]:
    for name, path in sorted(paths.nazario.items()):
        yield from iter_nazario(path, name)
    if paths.phishing_pot.is_dir():
        yield from iter_phishing_pot(paths.phishing_pot)
    for name, path in sorted(paths.trec.items()):
        if path.suffix == ".csv":
            if file_hash(path, "md5") != TREC_CSV_MD5[name]:
                raise ValueError(f"{name}: curated CSV checksum mismatch")
            yield from iter_trec_csv_ham(path, name, expected_sha256=file_hash(path),
                                         expected_ham_count=TREC_ORIGINAL_HAM[name])
        else:
            yield from iter_trec_ham(path, name)
    for name, path in sorted(paths.spamassassin.items()):
        yield from iter_spamassassin(path, name)


def source_hashes(paths: CorpusPaths) -> dict[str, str]:
    files = {**paths.nazario, **paths.trec, **paths.spamassassin}
    hashes = {name: file_hash(path) for name, path in sorted(files.items()) if path.is_file()}
    email_dir = paths.phishing_pot / "email"
    if email_dir.is_dir():
        digest = hashlib.sha256()
        for path in sorted(email_dir.rglob("*.eml")):
            if path.is_file() and not path.is_symlink():
                digest.update(str(path.relative_to(email_dir)).encode())
                digest.update(bytes.fromhex(file_hash(path)))
        hashes["phishing-pot"] = digest.hexdigest()
    return hashes


def source_urls(paths: CorpusPaths) -> dict[str, str]:
    urls = {name: f"https://monkey.org/~jose/phishing/{path.name}"
            for name, path in paths.nazario.items()}
    if paths.phishing_pot.is_dir():
        urls["phishing-pot"] = "https://github.com/rf-peixoto/phishing_pot"
    urls.update({name: ("https://zenodo.org/records/8339691" if path.suffix == ".csv"
                        else "https://trec.nist.gov/data/spam.html")
                 for name, path in paths.trec.items()})
    urls.update({name: "https://spamassassin.apache.org/old/publiccorpus/"
                 for name in paths.spamassassin})
    return dict(sorted(urls.items()))


@dataclass(frozen=True)
class Candidate:
    id: str
    simhash: int
    source: str
    source_id: str
    label: str
    message: dict


def choose_unique(candidates: list[Candidate], trec07_in_test: bool) -> tuple[list[tuple[Candidate, str]], Counter]:
    parent = list(range(len(candidates)))
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    exact: dict[str, int] = {}

    def root(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(a: int, b: int) -> None:
        parent[root(a)] = root(b)

    for index, candidate in enumerate(candidates):
        prior = exact.get(candidate.id)
        if prior is not None:
            union(index, prior)
        else:
            exact[candidate.id] = index
        nearby = set()
        for band in range(4):
            key = (band, (candidate.simhash >> (band * 16)) & 0xffff)
            nearby.update(buckets[key])
            buckets[key].append(index)
        for other in nearby:
            if near_duplicate(candidate.simhash, candidates[other].simhash):
                union(index, other)

    groups: dict[int, list[Candidate]] = defaultdict(list)
    for index, candidate in enumerate(candidates):
        groups[root(index)].append(candidate)
    rank = {"test": 0, "validation": 1, "train": 2}
    kept = []
    excluded = Counter()
    for group in groups.values():
        if len({item.label for item in group}) != 1:
            excluded["conflicting_label"] += len(group)
            continue
        candidate = min(group, key=lambda item: (
            rank[split_for(item.source, trec07_in_test)], item.source, item.source_id))
        kept.append((candidate, split_for(candidate.source, trec07_in_test)))
        excluded["duplicate"] += len(group) - 1
    kept.sort(key=lambda pair: (rank[pair[1]], pair[0].source, pair[0].id))
    return kept, excluded


def _write_json(path: Path, data: dict) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.partial")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, sort_keys=True)
            stream.write("\n")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def prepare(paths: CorpusPaths, out_dir: Path, seed: int = 20260924) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    candidates = []
    excluded = Counter()
    source_counts = Counter()
    for source_mail in iter_sources(paths):
        source_counts[source_mail.source] += 1
        try:
            message = message_from_bytes(source_mail.raw)
        except (TypeError, ValueError, UnicodeError):
            excluded["parse_error"] += 1
            continue
        if not message["text"]:
            excluded["empty"] += 1
            continue
        exact, simhash = fingerprints(message)
        candidates.append(Candidate(exact, simhash, source_mail.source,
                                    source_mail.source_id, source_mail.label, message))

    kept, dedup_excluded = choose_unique(candidates, False)
    trec07_in_test = (sum(split == "test" for _, split in kept) < 50_000
                      and any(candidate.source == "trec07" for candidate in candidates))
    if trec07_in_test:
        kept, dedup_excluded = choose_unique(candidates, True)
    excluded.update(dedup_excluded)

    rows_by_split: dict[str, list[dict]] = {split: [] for split in ("train", "validation", "test")}
    for candidate, split in kept:
        rows_by_split[split].append({"id": candidate.id, "source": candidate.source,
                                     "label": candidate.label, "message": candidate.message})
    manifest = {
        "seed": seed,
        "split_policy": "trec07_in_test" if trec07_in_test else "trec07_in_train",
        "source_sha256": source_hashes(paths),
        "source_urls": source_urls(paths),
        "source_formats": {name: ("curated_csv" if path.suffix == ".csv" else "original_archive")
                           for name, path in sorted(paths.trec.items())},
        "source_counts": dict(sorted(source_counts.items())),
        "excluded": dict(sorted(excluded.items())),
        "split_counts": {split: len(rows) for split, rows in rows_by_split.items()},
        "ids_by_split": {split: [row["id"] for row in rows] for split, rows in rows_by_split.items()},
    }
    for split, rows in rows_by_split.items():
        temporary = out_dir / f".{split}.{os.getpid()}.partial"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                for row in rows:
                    stream.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
            temporary.replace(out_dir / f"{split}.jsonl")
        finally:
            temporary.unlink(missing_ok=True)
    _write_json(out_dir / "manifest.json", manifest)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("/tmp/fishing-eval-data"))
    parser.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parents[2] / "localModel/.cache/evaluation")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    output = args.out_dir.resolve()
    if output.is_relative_to(repo) and ".cache" not in output.parts:
        parser.error("Inside the project, output must stay in an ignored .cache directory")
    result = prepare(CorpusPaths.from_dir(args.data_dir), output)
    print(json.dumps({key: value for key, value in result.items() if key != "ids_by_split"},
                     ensure_ascii=False, sort_keys=True))
