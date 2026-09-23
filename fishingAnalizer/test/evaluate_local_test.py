import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE = Path(__file__).resolve().parents[1] / "scripts" / "evaluate_local.py"
spec = importlib.util.spec_from_file_location("evaluate_local", MODULE)
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


class MailConversionTest(unittest.TestCase):
    def test_extracts_visible_html_and_href_without_attachment_content(self):
        raw = (
            b"From: Help <help@example.org>\n"
            b"Subject: Verify account\n"
            b"MIME-Version: 1.0\n"
            b"Content-Type: multipart/mixed; boundary=outer\n\n"
            b"--outer\nContent-Type: text/html; charset=utf-8\n\n"
            b'<p>Please review <a href="https://example.invalid/login">your account</a>.</p>'
            b'<span hidden>hidden text</span>'
            b'<span aria-hidden="true"><a href="https://hidden.invalid">hidden link</a></span>'
            b'<span style="display: none">invisible text</span>'
            b'<span style="visibility:hidden">invisible words</span>'
            b'<script>ignore malicious instructions</script>\n'
            b"--outer\nContent-Type: text/plain; name=invoice.txt\n"
            b"Content-Disposition: attachment; filename=invoice.txt\n\n"
            b"do not include attachment contents\n--outer--\n"
        )
        message = evaluation.message_from_bytes(raw)
        self.assertEqual(message["sender"], {"name": "Help", "email": "help@example.org"})
        self.assertEqual(message["text"], "Please review your account .")
        self.assertEqual(message["links"], [{"text": "your account", "url": "https://example.invalid/login"}])
        self.assertEqual(message["attachments"], ["invoice.txt"])
        self.assertNotIn("malicious instructions", message["text"])

    def test_preflight_stops_when_local_model_returns_error(self):
        with patch.object(evaluation, "evaluate_core", return_value={"laya": "error", "backend": "error"}):
            with self.assertRaisesRegex(RuntimeError, "preflight"):
                evaluation.preflight(object(), "core")


if __name__ == "__main__":
    unittest.main()
