import csv
import hashlib
import io
import tarfile
import tempfile
import unittest
from pathlib import Path

from scripts.evaluate_local import message_from_bytes
from scripts.large_eval.corpora import iter_phishing_pot, iter_trec_csv_ham, iter_trec_ham


MAIL = b"From: A <a@example.org>\nSubject: Hello\n\nOrdinary message.\n"


def write_trec(path, index, entries):
    with tarfile.open(path, "w:gz") as archive:
        for name, content in {"trec05p-1/full/index": index.encode(), **entries}.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))


class CorpusReadersTest(unittest.TestCase):
    def test_trec_reads_only_indexed_ham_and_never_extracts_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "trec.tgz"
            write_trec(path,
                       "ham ../data/inmail.1\nspam ../data/inmail.2\nham ../../escape\n"
                       "ham ../data/inmail.3\n",
                       {"trec05p-1/data/inmail.1": MAIL,
                        "trec05p-1/data/inmail.2": b"spam body",
                        "trec05p-1/data/inmail.3": b"X" * 256_001})
            rows = list(iter_trec_ham(path, "trec05"))
            self.assertEqual([(r.label, r.source_id) for r in rows], [("ham", "inmail.1")])
            self.assertEqual(rows[0].raw, MAIL)
            self.assertFalse((Path(temporary) / "escape").exists())

    def test_curated_trec_csv_requires_verified_file_and_ham_count(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "TREC_05.csv"
            with path.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(stream, fieldnames=("sender", "subject", "body", "label"))
                writer.writeheader()
                writer.writerow({"sender": "A <a@example.org>", "subject": "Hello",
                                 "body": "Normal letter", "label": "0"})
                writer.writerow({"sender": "B <b@example.org>", "subject": "Free money",
                                 "body": "spam body", "label": "1"})
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            rows = list(iter_trec_csv_ham(path, "trec05", expected_sha256=digest,
                                          expected_ham_count=1))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].label, "ham")
            self.assertEqual(message_from_bytes(rows[0].raw)["text"], "Normal letter")
            with self.assertRaisesRegex(ValueError, "checksum"):
                list(iter_trec_csv_ham(path, "trec05", expected_sha256="0" * 64,
                                       expected_ham_count=1))
            with self.assertRaisesRegex(ValueError, "ham count"):
                list(iter_trec_csv_ham(path, "trec05", expected_sha256=digest,
                                       expected_ham_count=2))

    def test_phishing_pot_rejects_non_eml_and_oversize(self):
        with tempfile.TemporaryDirectory() as temporary:
            email_dir = Path(temporary) / "email" / "batch"
            email_dir.mkdir(parents=True)
            (email_dir / "one.eml").write_bytes(MAIL)
            (email_dir / "note.txt").write_bytes(MAIL)
            (email_dir / "large.eml").write_bytes(b"X" * 256_001)
            rows = list(iter_phishing_pot(Path(temporary)))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].label, "phishing")

    def test_message_conversion_keeps_only_visible_fields(self):
        raw = (b"From: A <a@example.org>\nSubject: Example\n"
               b"MIME-Version: 1.0\nContent-Type: multipart/mixed; boundary=x\n\n"
               b"--x\nContent-Type: text/html\n\n"
               b'<p>Visible <a href="https://example.invalid">link</a></p>'
               b'<script>hidden instructions</script><span hidden>secret</span>\n'
               b"--x\nContent-Type: text/plain\n"
               b"Content-Disposition: attachment; filename=invoice.txt\n\n"
               b"attachment body\n--x--\n")
        message = message_from_bytes(raw)
        self.assertEqual(message["text"], "Visible link")
        self.assertEqual(message["attachments"], ["invoice.txt"])
        self.assertEqual(message["links"][0]["url"], "https://example.invalid")


if __name__ == "__main__":
    unittest.main()
