"""Strict three-state phishing metrics; review and errors are abstentions."""

import math


STATUSES = ("suspicious", "review", "no_signals", "error")


def _rate(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def wilson_interval(successes: int, total: int) -> tuple[float, float] | None:
    if not total:
        return None
    z = 1.959963984540054
    p = successes / total
    divisor = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / divisor
    spread = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / divisor
    return max(0.0, centre - spread), min(1.0, centre + spread)


def summarize(matrix: dict[str, dict[str, int]]) -> dict:
    rows = {label: {status: int(matrix.get(label, {}).get(status, 0)) for status in STATUSES}
            for label in ("phishing", "ham")}
    phishing_total = sum(rows["phishing"].values())
    ham_total = sum(rows["ham"].values())
    total = phishing_total + ham_total
    tp = rows["phishing"]["suspicious"]
    fp = rows["ham"]["suspicious"]
    tn = rows["ham"]["no_signals"]
    recall = _rate(tp, phishing_total)
    fpr = _rate(fp, ham_total)
    precision = _rate(tp, tp + fp)
    specificity = _rate(tn, ham_total)
    review = rows["phishing"]["review"] + rows["ham"]["review"]
    errors = rows["phishing"]["error"] + rows["ham"]["error"]
    return {
        "matrix": rows,
        "counts": {"phishing": phishing_total, "ham": ham_total},
        "phishing_recall": recall,
        "ham_fpr": fpr,
        "precision": precision,
        "specificity": specificity,
        "f1": 2 * precision * recall / (precision + recall)
        if precision is not None and recall is not None and precision + recall else None,
        "balanced_accuracy": (recall + specificity) / 2
        if recall is not None and specificity is not None else None,
        "strict_accuracy": _rate(tp + tn, total),
        "review_rate": _rate(review, total),
        "error_rate": _rate(errors, total),
        "intervals_95": {
            "phishing_recall": wilson_interval(tp, phishing_total),
            "ham_fpr": wilson_interval(fp, ham_total),
            "precision": wilson_interval(tp, tp + fp),
            "specificity": wilson_interval(tn, ham_total),
        },
    }
