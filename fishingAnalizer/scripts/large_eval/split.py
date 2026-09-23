"""Deterministic corpus splits and near-duplicate fingerprints."""

import hashlib
import re
import unicodedata


def split_for(source: str, trec07_in_test: bool) -> str:
    if source in {"nazario-2024", "nazario-2025", "phishing-pot", "trec05", "trec06"}:
        return "test"
    if source in {"nazario-2022", "nazario-2023"}:
        return "validation"
    if source == "trec07":
        return "test" if trec07_in_test else "train"
    if source.startswith("spamassassin-"):
        if trec07_in_test and source != "spamassassin-hard_ham":
            return "train"
        return "validation"
    return "train"


def normalized_content(message: dict) -> str:
    visible = f"{message['subject']}\n{message['text']}"
    return " ".join(unicodedata.normalize("NFKC", visible).casefold().split())


def fingerprints(message: dict) -> tuple[str, int]:
    normalized = normalized_content(message)
    exact = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    words = re.findall(r"\w+", normalized)
    if not words:
        return exact, 0
    shingles = [" ".join(words[index:index + 3]) for index in range(max(1, len(words) - 2))]
    if len(shingles) > 256:
        step = (len(shingles) - 1) / 255
        shingles = [shingles[round(index * step)] for index in range(256)]
    scores = [0] * 64
    for shingle in set(shingles):
        digest = int.from_bytes(hashlib.blake2b(shingle.encode("utf-8"), digest_size=8).digest())
        for bit in range(64):
            scores[bit] += 1 if digest & (1 << bit) else -1
    simhash = sum(1 << bit for bit, score in enumerate(scores) if score > 0)
    return exact, simhash


def near_duplicate(first: int, second: int) -> bool:
    return (first ^ second).bit_count() <= 3
