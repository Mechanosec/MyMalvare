import json
import math
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.large_eval.metrics import summarize, wilson_interval
from scripts.large_eval.evaluate import _model_identity, aggregate, laya_root


class BenchmarkMetricsTest(unittest.TestCase):
    def test_model_endpoint_stays_on_loopback_and_supports_alternate_port(self):
        with patch.dict("os.environ", {"LAYA_URL": "http://127.0.0.1:8010/v1/systemone"}):
            self.assertEqual(laya_root(), "http://127.0.0.1:8010")
        with patch.dict("os.environ", {"LAYA_URL": "https://example.org/v1/systemone"}):
            with self.assertRaises(ValueError):
                laya_root()

    def test_base_identity_rejects_running_tuned_checkpoint(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = root / "localModel/.cache/huggingface/hub/models--convaiinnovations--laya"
            (cache / "refs").mkdir(parents=True)
            (cache / "refs/main").write_text("revision")
            weights = cache / "snapshots/revision/multilingual/model.safetensors"
            weights.parent.mkdir(parents=True)
            weights.write_bytes(b"synthetic")

            def fake_open(url, timeout):
                if url.endswith("/health"):
                    return io.BytesIO(b'{"status":"ok","loaded":["multilingual"],"device":"cuda"}')
                return io.BytesIO(b'{"kind":"tuned","sha256":"wrong"}')

            with patch("scripts.large_eval.evaluate.urlopen", side_effect=fake_open):
                with self.assertRaises(RuntimeError):
                    _model_identity(root, "base")

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
