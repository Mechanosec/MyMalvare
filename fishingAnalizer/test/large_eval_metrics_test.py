import json
import math
import unittest

from scripts.large_eval.metrics import summarize, wilson_interval
from scripts.large_eval.evaluate import aggregate


class BenchmarkMetricsTest(unittest.TestCase):
    def test_review_and_error_remain_in_denominators(self):
        matrix = {
            "phishing": {"suspicious": 1, "review": 1, "no_signals": 0, "error": 1},
            "ham": {"suspicious": 1, "review": 0, "no_signals": 1, "error": 0},
        }
        report = summarize(matrix)
        self.assertAlmostEqual(report["phishing_recall"], 1 / 3)
        self.assertEqual(report["ham_fpr"], 0.5)
        self.assertEqual(report["precision"], 0.5)
        self.assertEqual(report["specificity"], 0.5)
        self.assertEqual(report["review_rate"], 0.2)
        self.assertEqual(report["error_rate"], 0.2)
        self.assertEqual(report["counts"], {"phishing": 3, "ham": 2})

    def test_empty_rates_are_json_null_and_intervals_are_bounded(self):
        report = summarize({"phishing": {}, "ham": {}})
        self.assertIsNone(report["phishing_recall"])
        self.assertIsNone(report["ham_fpr"])
        self.assertNotIn("NaN", json.dumps(report))
        self.assertEqual(wilson_interval(0, 0), None)
        lower, upper = wilson_interval(1, 2)
        self.assertTrue(0 <= lower < 0.5 < upper <= 1)
        self.assertTrue(math.isfinite(lower) and math.isfinite(upper))

    def test_aggregate_output_never_contains_mail_fields(self):
        rows = [{"source": "nazario-2024", "label": "phishing",
                 "message": {"text": "SECRET_SYNTHETIC_MAIL", "links": ["https://example.invalid"]},
                 "laya": "suspicious", "backend": "review", "layaMs": 12.0,
                 "backendMs": 15.0}]
        result = aggregate(rows)
        output = json.dumps(result)
        self.assertNotIn("SECRET_SYNTHETIC_MAIL", output)
        self.assertNotIn("example.invalid", output)
        self.assertEqual(result["laya"]["phishing_recall"], 1)
        self.assertEqual(result["backend"]["review_rate"], 1)


if __name__ == "__main__":
    unittest.main()
