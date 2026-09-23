import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    import laya
except ImportError:
    laya = None

if laya is not None:
    from fastapi.testclient import TestClient
    from localModel import serve_checkpoint


@unittest.skipIf(laya is None, "Laya serving tests use localModel/.venv/bin/python")
class CheckpointServerTest(unittest.TestCase):
    def test_invalid_checkpoint_fails_before_agent_load(self):
        with patch.object(serve_checkpoint, "Agent") as agent:
            with self.assertRaises(FileNotFoundError):
                serve_checkpoint.build_app(Path("/no/such/checkpoint"), "cpu")
            agent.assert_not_called()

    def test_wrong_weight_hash_fails_before_agent_load(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkpoint = Path(temporary)
            (checkpoint / "model.safetensors").write_bytes(b"synthetic")
            (checkpoint / "rl_agent_config.json").write_text("{}")
            (checkpoint / "tokenizer").mkdir()
            (checkpoint / "tokenizer/tokenizer.json").write_text("{}")
            (checkpoint / "encoder").mkdir()
            (checkpoint / "encoder/config.json").write_text("{}")
            (checkpoint / "training.json").write_text('{"weights_sha256": "wrong"}')
            with patch.object(serve_checkpoint, "Agent") as agent:
                with self.assertRaises(ValueError):
                    serve_checkpoint.build_app(checkpoint, "cpu")
                agent.assert_not_called()

    def test_serves_existing_checkpoint_and_reports_only_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkpoint = Path(temporary)
            payload = b"synthetic weights"
            (checkpoint / "model.safetensors").write_bytes(payload)
            (checkpoint / "rl_agent_config.json").write_text("{}")
            (checkpoint / "tokenizer").mkdir()
            (checkpoint / "encoder").mkdir()
            (checkpoint / "tokenizer/tokenizer.json").write_text("{}")
            (checkpoint / "encoder/config.json").write_text("{}")
            expected = hashlib.sha256(payload).hexdigest()
            (checkpoint / "training.json").write_text(
                "{\"epoch\": 1, \"weights_sha256\": \"" + expected + "\"}")

            class FakeRouter:
                loaded = ["multilingual"]

                def attach(self, name, agent):
                    self.agent = agent

                def predict(self, state, questions, model):
                    return {"answers": {"phishing_risk": {"choice": "review"}}}

            with patch.object(serve_checkpoint, "Agent") as agent, \
                 patch.object(serve_checkpoint, "Router", return_value=FakeRouter()):
                app = serve_checkpoint.build_app(checkpoint, "cpu")
                agent.assert_called_once_with(str(checkpoint), device="cpu")
            client = TestClient(app)
            identity = client.get("/checkpoint")
            self.assertEqual(identity.status_code, 200)
            self.assertEqual(identity.json()["sha256"], expected)
            self.assertNotIn("message", identity.text)
            reply = client.post("/v1/systemone", json={
                "state": {"message": {"text": "Synthetic test"}},
                "questions": {"phishing_risk": {"type": "choice", "instructions": "Risk?",
                                                 "criteria": {"review": "review"}}},
            })
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.json()["answers"]["phishing_risk"]["choice"], "review")


if __name__ == "__main__":
    unittest.main()
