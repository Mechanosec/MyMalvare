"""Summarize metadata-only Jev benchmark JSONL; run from fishingAnalizer."""

import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

from scripts.large_eval.metrics import summarize


rows = {}
for line in Path(sys.argv[1]).open():
    row = json.loads(line)
    rows[row["id"]] = row  # A later retry replaces an earlier error.


def percentile(values, fraction):
    ordered = sorted(values)
    return round(ordered[int((len(ordered) - 1) * fraction)], 2) if ordered else None


report = {
    "sample_count": len(rows),
    "api_status": dict(Counter(str(row["httpStatus"]) for row in rows.values())),
    "cost_usd": round(sum(row["cost"] or 0 for row in rows.values()), 6),
    "input_tokens": sum(row["inputTokens"] or 0 for row in rows.values()),
    "by_source": {},
}
for method in ("choice", "status"):
    matrix = defaultdict(Counter)
    for row in rows.values():
        matrix[row["label"]][row[method]] += 1
    report[method] = summarize(matrix)

for source in sorted({row["source"] for row in rows.values()}):
    report["by_source"][source] = {}
    selected = [row for row in rows.values() if row["source"] == source]
    for method in ("choice", "status"):
        matrix = defaultdict(Counter)
        for row in selected:
            matrix[row["label"]][row[method]] += 1
        report["by_source"][source][method] = summarize(matrix)

for key in ("modelMs", "backendMs", "inputTokens"):
    values = [row[key] for row in rows.values() if row[key] is not None and row["status"] != "error"]
    report[key] = {
        "median": round(statistics.median(values), 2) if values else None,
        "p95": percentile(values, 0.95),
        "p99": percentile(values, 0.99),
        "max": max(values) if values else None,
    }

print(json.dumps(report, ensure_ascii=False, indent=2))
