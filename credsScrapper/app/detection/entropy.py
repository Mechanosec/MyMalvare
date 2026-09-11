import math
import re
from collections import Counter

ENTROPY_THRESHOLD = 4.0
GENERIC_TOKEN_RE = re.compile(r"[A-Za-z0-9+/=]{32,}")


def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    counts = Counter(s)
    length = len(s)
    return -sum((c / length) * math.log2(c / length) for c in counts.values())


def find_high_entropy_tokens(text: str) -> list[str]:
    return [
        token
        for token in GENERIC_TOKEN_RE.findall(text)
        if shannon_entropy(token) > ENTROPY_THRESHOLD
    ]
