import tempfile
import unittest
from pathlib import Path

from scripts.evaluate_local import QUESTION

try:
    import torch
    from laya.common import DecisionModel
except ImportError:
    torch = None

if torch is not None:
    from localModel.train_head import freeze_encoder, hash_parameters, save_checkpoint, train_one_step


class QuestionParityTest(unittest.TestCase):
    def test_training_question_matches_production_adapter(self):
        source = (Path(__file__).resolve().parents[1] / "backend/adapters.ts").read_text()
        question = QUESTION["phishing_risk"]
        for content in (question["instructions"], *question["criteria"].values()):
            self.assertIn("'" + content + "'", source)


@unittest.skipIf(torch is None, "PyTorch/Laya tests use localModel/.venv/bin/python")
class HeadTrainingTest(unittest.TestCase):
    def test_frozen_encoder_and_changed_head(self):
        from types import SimpleNamespace

        class TinyEncoder(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.config = SimpleNamespace(hidden_size=16)
                self.embedding = torch.nn.Embedding(40, 16)

            def forward(self, input_ids, attention_mask):
                return SimpleNamespace(last_hidden_state=self.embedding(input_ids))

        model = DecisionModel(TinyEncoder(), head_layers=1, n_act=2)
        freeze_encoder(model)
        before_encoder = hash_parameters(model.encoder)
        before_head = hash_parameters(model.head)
        before_type_emb = hash_parameters(model.type_emb)
        before_scorer = hash_parameters(model.scorer)
        params = [parameter for parameter in model.parameters() if parameter.requires_grad]
        optimizer = torch.optim.AdamW(params, lr=0.01)
        batch = {
            "input_ids": torch.tensor([[1, 2, 3, 4, 5, 6, 7, 8]]),
            "attention_mask": torch.ones((1, 8), dtype=torch.long),
            "marker_pos": torch.tensor([[2, 4, 6]]),
            "marker_mask": torch.ones((1, 3), dtype=torch.bool),
            "qtype": torch.tensor([0]),
        }
        loss = train_one_step(model, batch, "phishing", 1.0, optimizer)
        self.assertGreater(loss, 0)
        self.assertEqual(before_encoder, hash_parameters(model.encoder))
        self.assertNotEqual(before_head, hash_parameters(model.head))
        self.assertNotEqual(before_type_emb, hash_parameters(model.type_emb))
        self.assertNotEqual(before_scorer, hash_parameters(model.scorer))
        self.assertTrue(all(not p.requires_grad for p in model.encoder.parameters()))
        self.assertTrue(all(torch.isfinite(p.grad).all() and p.grad.abs().sum() > 0
                            for p in model.parameters() if p.requires_grad))

    def test_checkpoint_layout_contains_full_state(self):
        model = torch.nn.Linear(2, 2)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = root / "base"
            (base / "tokenizer").mkdir(parents=True)
            (base / "encoder").mkdir()
            (base / "rl_agent_config.json").write_text("{}")
            (base / "tokenizer/tokenizer_config.json").write_text("{}")
            (base / "encoder/config.json").write_text("{}")
            target = root / "epoch-01"
            digest = save_checkpoint(model, base, target, {"epoch": 1})
            self.assertEqual(len(digest), 64)
            self.assertTrue((target / "model.safetensors").is_file())
            self.assertTrue((target / "rl_agent_config.json").is_file())
            self.assertTrue((target / "tokenizer/tokenizer_config.json").is_file())
            self.assertTrue((target / "encoder/config.json").is_file())
            self.assertNotIn("message", (target / "training.json").read_text())


if __name__ == "__main__":
    unittest.main()
