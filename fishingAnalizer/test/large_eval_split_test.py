import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.large_eval.corpora import SourceMail
from scripts.large_eval.prepare import CorpusPaths, prepare
from scripts.large_eval.split import split_for


def mail(subject, body):
    return f"From: Test <test@example.org>\nSubject: {subject}\n\n{body}\n".encode()


class LargeSplitTest(unittest.TestCase):
    def test_split_policy_moves_trec07_only_when_needed(self):
        self.assertEqual(split_for("trec07", False), "train")
        self.assertEqual(split_for("trec07", True), "test")
        self.assertEqual(split_for("spamassassin-hard_ham", True), "validation")
        self.assertEqual(split_for("spamassassin-easy_ham", True), "train")
        self.assertEqual(split_for("nazario-2024", False), "test")

    def test_when_trec_is_unavailable_ham_stays_in_each_split(self):
        records = [
            SourceMail("nazario-2015", "phishing", "train", mail("A", "Invoice account update")),
            SourceMail("nazario-2022", "phishing", "valid", mail("B", "Password reset alert")),
            SourceMail("nazario-2024", "phishing", "test", mail("C", "Delivery notice action")),
            SourceMail("spamassassin-easy_ham", "ham", "train", mail("D", "Team agenda next week")),
            SourceMail("spamassassin-easy_ham_2", "ham", "valid", mail("E", "Holiday office closure")),
            SourceMail("spamassassin-hard_ham", "ham", "test", mail("F", "Conference paper attached")),
        ]
        paths = CorpusPaths({}, Path("/unused"), {}, {})
        with tempfile.TemporaryDirectory() as temporary:
            with patch("scripts.large_eval.prepare.iter_sources", return_value=iter(records)):
                result = prepare(paths, Path(temporary))
            self.assertEqual(result["split_policy"], "spamassassin_only")
            for split in ("train", "validation", "test"):
                labels = {json.loads(line)["label"] for line in
                          (Path(temporary) / f"{split}.jsonl").read_text().splitlines()}
                self.assertEqual(labels, {"phishing", "ham"})

    def test_prepare_is_stable_and_prevents_cross_split_leakage(self):
        records = [
            SourceMail("nazario-2015", "phishing", "train-copy", mail("Urgent", "Verify your account today")),
            SourceMail("nazario-2024", "phishing", "test-copy", mail("Urgent", "Verify your account today")),
            SourceMail("nazario-2022", "phishing", "near-copy", mail("Urgent", "Verify your account today!")),
            SourceMail("nazario-2016", "phishing", "train-unique", mail("Alert", "Please confirm your payment")),
            SourceMail("nazario-2023", "phishing", "valid-unique", mail("Notice", "Reset your account password")),
            SourceMail("phishing-pot", "phishing", "conflict", mail("Same", "A shared template message")),
            SourceMail("trec05", "ham", "conflict", mail("Same", "A shared template message")),
            SourceMail("trec06", "ham", "test-ham", mail("Meeting", "Project meeting tomorrow")),
            SourceMail("trec06", "ham", "empty", b"From: A <a@example.org>\nSubject: Blank\n\n"),
        ]
        paths = CorpusPaths({}, Path("/unused"), {}, {})
        with tempfile.TemporaryDirectory() as temporary:
            with patch("scripts.large_eval.prepare.iter_sources", return_value=iter(records)):
                first = prepare(paths, Path(temporary) / "one")
            with patch("scripts.large_eval.prepare.iter_sources", return_value=iter(records)):
                second = prepare(paths, Path(temporary) / "two")
            self.assertEqual(first, second)
            self.assertEqual(first["split_counts"], {"train": 1, "validation": 1, "test": 2})
            self.assertEqual(first["excluded"]["conflicting_label"], 2)
            self.assertGreaterEqual(first["excluded"]["duplicate"], 2)
            all_ids = [entry for ids in first["ids_by_split"].values() for entry in ids]
            self.assertEqual(len(all_ids), len(set(all_ids)))
            manifest_text = (Path(temporary) / "one" / "manifest.json").read_text()
            for secret_field in ('"sender"', '"subject"', '"text"', '"links"',
                                 '"message"', "Verify your account"):
                self.assertNotIn(secret_field, manifest_text)
            test_rows = [json.loads(line) for line in (Path(temporary) / "one" / "test.jsonl").read_text().splitlines()]
            self.assertEqual(len(test_rows), 2)
            self.assertEqual({row["source"] for row in test_rows}, {"nazario-2024", "trec06"})


if __name__ == "__main__":
    unittest.main()
