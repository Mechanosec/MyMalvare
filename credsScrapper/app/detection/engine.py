from dataclasses import dataclass

from app.detection.entropy import find_high_entropy_tokens
from app.detection.patterns import PATTERNS


@dataclass(frozen=True)
class Finding:
    secret_type: str
    secret_value: str
    line_number: int


def _line_number_at(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def scan_text(text: str) -> list[Finding]:
    findings: list[Finding] = []
    matched_spans: list[tuple[int, int]] = []

    for secret_type, pattern in PATTERNS:
        for m in pattern.finditer(text):
            findings.append(Finding(secret_type, m.group(0), _line_number_at(text, m.start())))
            matched_spans.append(m.span())

    for token in find_high_entropy_tokens(text):
        start = text.find(token)
        if start == -1:
            continue
        if any(start >= s and start < e for s, e in matched_spans):
            continue
        findings.append(Finding("generic_high_entropy", token, _line_number_at(text, start)))

    return findings
