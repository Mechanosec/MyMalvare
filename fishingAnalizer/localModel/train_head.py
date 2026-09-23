"""Train Laya Multilingual's decision head on prepared, labelled local mail."""

import argparse
import hashlib
import json
import os
import random
import shutil
import sys
from contextlib import nullcontext
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(MODEL_DIR / ".cache/huggingface"))
os.environ.setdefault("USE_TF", "0")

import torch
import torch.nn.functional as F
import numpy as np
from laya.agent import Agent
from laya.common import build_sequence
from safetensors.torch import save_file

from scripts.evaluate_local import QUESTION
from scripts.large_eval.prepare import file_hash


SEED = 20260924
QUESTION_DEF = QUESTION["phishing_risk"]
INTERNAL_QUESTION = {"t": "choice", "ins": QUESTION_DEF["instructions"],
                     "crit": QUESTION_DEF["criteria"]}


def freeze_encoder(model: torch.nn.Module) -> None:
    for name, parameter in model.named_parameters():
        parameter.requires_grad_(name.startswith(("head.", "type_emb.", "scorer.")))
    model.encoder.eval()


def hash_parameters(module: torch.nn.Module) -> str:
    digest = hashlib.sha256()
    for name, parameter in module.named_parameters():
        digest.update(name.encode())
        digest.update(parameter.detach().cpu().contiguous().view(torch.uint8).numpy().tobytes())
    return digest.hexdigest()


def sample_loss(model: torch.nn.Module, batch: dict, label: str, weight: float) -> torch.Tensor:
    device = batch["input_ids"].device
    context = torch.autocast("cuda", dtype=torch.bfloat16) if device.type == "cuda" else nullcontext()
    with context:
        logits, _ = model(batch["input_ids"], batch["attention_mask"],
                          batch["marker_pos"], batch["marker_mask"], batch["qtype"],
                          detach_encoder=True)
    target = torch.tensor([0 if label == "phishing" else 2], device=device)
    return F.cross_entropy(logits.float(), target) * weight


def train_one_step(model: torch.nn.Module, batch: dict, label: str, weight: float,
                   optimizer: torch.optim.Optimizer) -> float:
    optimizer.zero_grad(set_to_none=True)
    model.train()
    model.encoder.eval()
    loss = sample_loss(model, batch, label, weight)
    if not torch.isfinite(loss):
        raise RuntimeError("Training loss is not finite")
    loss.backward()
    torch.nn.utils.clip_grad_norm_((p for p in model.parameters() if p.requires_grad), 1.0)
    optimizer.step()
    return float(loss.detach())


def encode_message(agent: Agent, message: dict) -> dict[str, torch.Tensor]:
    ids, markers = build_sequence(agent.tok, {"message": message}, INTERNAL_QUESTION,
                                  max_len=agent.cfg["max_len"],
                                  head_max_len=agent.cfg["head_max_len"])
    if len(markers) != 3:
        raise RuntimeError("Phishing question did not fit the Laya head")
    device = agent.device
    return {
        "input_ids": torch.tensor([ids], dtype=torch.long, device=device),
        "attention_mask": torch.ones((1, len(ids)), dtype=torch.long, device=device),
        "marker_pos": torch.tensor([markers], dtype=torch.long, device=device),
        "marker_mask": torch.ones((1, 3), dtype=torch.bool, device=device),
        "qtype": torch.zeros((1,), dtype=torch.long, device=device),
    }


def base_checkpoint_dir() -> Path:
    cache = MODEL_DIR / ".cache/huggingface/hub/models--convaiinnovations--laya"
    ref = cache / "refs/main"
    if not ref.is_file():
        raise RuntimeError("Base Laya checkpoint is missing; run localModel/setup.sh first")
    base = cache / "snapshots" / ref.read_text().strip() / "multilingual"
    if not (base / "model.safetensors").is_file():
        raise RuntimeError("Base Laya weights are missing")
    return base


def save_checkpoint(model: torch.nn.Module, base: Path, target: Path, metadata: dict) -> str:
    if target.exists():
        raise FileExistsError(f"Checkpoint directory already exists: {target}")
    target.mkdir(parents=True, mode=0o700)
    try:
        shutil.copy2(base / "rl_agent_config.json", target / "rl_agent_config.json")
        shutil.copytree(base / "tokenizer", target / "tokenizer")
        shutil.copytree(base / "encoder", target / "encoder")
        temporary = target / ".model.safetensors.partial"
        state = {name: tensor.detach().cpu().contiguous()
                 for name, tensor in model.state_dict().items()}
        save_file(state, str(temporary))
        temporary.replace(target / "model.safetensors")
        digest = file_hash(target / "model.safetensors")
        (target / "training.json").write_text(
            json.dumps({**metadata, "weights_sha256": digest}, sort_keys=True) + "\n")
        return digest
    except Exception:
        shutil.rmtree(target)
        raise


def _load_training(data_dir: Path) -> tuple[list[dict], str]:
    manifest_path = data_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    expected = manifest["ids_by_split"]["train"]
    rows = []
    with (data_dir / "train.jsonl").open(encoding="utf-8") as stream:
        for index, line in enumerate(stream):
            row = json.loads(line)
            if index >= len(expected) or row["id"] != expected[index]:
                raise RuntimeError("Training data differs from frozen manifest")
            if row["label"] not in ("phishing", "ham"):
                raise RuntimeError("Training data has an invalid label")
            rows.append(row)
    if len(rows) != len(expected) or not rows:
        raise RuntimeError("Training data is empty or incomplete")
    return rows, file_hash(manifest_path)


def _agent() -> Agent:
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for this training run")
    agent = Agent("convaiinnovations/laya", subfolder="multilingual", device="cuda")
    if agent.device.type != "cuda":
        raise RuntimeError("Laya did not stay on CUDA")
    freeze_encoder(agent.model)
    return agent


def smoke(out_dir: Path) -> dict:
    agent = _agent()
    before = hash_parameters(agent.model.head)
    params = [p for name, p in agent.model.named_parameters()
              if name.startswith(("head.", "type_emb.", "scorer."))]
    optimizer = torch.optim.AdamW(params, lr=1e-4, weight_decay=0.01)
    synthetic = [
        ("phishing", "Confirm your password at example.invalid. " * 450),
        ("ham", "Team meeting on Tuesday. " * 20),
    ]
    peak = 0
    for label, text in synthetic:
        message = {"sender": {"name": "Test", "email": "test@example.org"},
                   "subject": "Synthetic test", "text": text, "links": [],
                   "attachments": [], "truncated": False}
        batch = encode_message(agent, message)
        train_one_step(agent.model, batch, label, 1.0, optimizer)
        peak = max(peak, torch.cuda.max_memory_allocated())
    after = hash_parameters(agent.model.head)
    if before == after:
        raise RuntimeError("Decision head did not change during CUDA smoke test")
    target = out_dir / "smoke"
    digest = save_checkpoint(agent.model, base_checkpoint_dir(), target,
                             {"kind": "synthetic_smoke", "head_changed": True})
    del agent
    torch.cuda.empty_cache()
    loaded = Agent(str(target), device="cuda")
    if loaded.device.type != "cuda":
        raise RuntimeError("Saved checkpoint did not reload on CUDA")
    return {"weights_sha256": digest, "peak_vram_bytes": peak,
            "device": loaded.device.type}


def train(data_dir: Path, out_dir: Path) -> list[dict]:
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.cuda.manual_seed_all(SEED)
    rows, manifest_hash = _load_training(data_dir)
    counts = {label: sum(row["label"] == label for row in rows)
              for label in ("phishing", "ham")}
    if not all(counts.values()):
        raise RuntimeError("Both phishing and ham are required for training")
    class_weight = {label: len(rows) / (2 * count) for label, count in counts.items()}
    agent = _agent()
    model = agent.model
    model.head_checkpointing = True
    params = [p for name, p in model.named_parameters()
              if name.startswith(("head.", "type_emb.", "scorer."))]
    optimizer = torch.optim.AdamW(params, lr=1e-4, weight_decay=0.01)
    base = base_checkpoint_dir()
    out_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    metadata = []
    for epoch in range(1, 6):
        model.train()
        model.encoder.eval()
        order = list(range(len(rows)))
        random.Random(SEED + epoch).shuffle(order)
        optimizer.zero_grad(set_to_none=True)
        losses = []
        before = hash_parameters(model.head)
        for position, index in enumerate(order, start=1):
            row = rows[index]
            batch = encode_message(agent, row["message"])
            loss = sample_loss(model, batch, row["label"], class_weight[row["label"]])
            if not torch.isfinite(loss):
                raise RuntimeError("Training loss is not finite")
            (loss / 8).backward()
            losses.append(float(loss.detach()))
            if position % 8 == 0 or position == len(order):
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
            if position % 1000 == 0:
                print(f"epoch {epoch}: {position}/{len(order)}", file=sys.stderr, flush=True)
        after = hash_parameters(model.head)
        if before == after:
            raise RuntimeError("Decision head weights did not change")
        info = {"epoch": epoch, "train_count": len(rows), "class_counts": counts,
                "mean_loss": sum(losses) / len(losses), "manifest_sha256": manifest_hash,
                "question_sha256": hashlib.sha256(json.dumps(QUESTION, sort_keys=True).encode()).hexdigest(),
                "adapter_sha256": file_hash(Path(__file__).resolve().parents[1] / "backend/adapters.ts"),
                "seed": SEED, "learning_rate": 1e-4, "weight_decay": 0.01,
                "gradient_accumulation": 8, "device": torch.cuda.get_device_name(0),
                "torch_version": torch.__version__}
        digest = save_checkpoint(model, base, out_dir / f"epoch-{epoch:02d}", info)
        metadata.append({**info, "weights_sha256": digest})
        print(f"epoch {epoch}: mean_loss={info['mean_loss']:.4f}; checkpoint_sha256={digest}",
              file=sys.stderr, flush=True)
    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=MODEL_DIR / ".cache/evaluation")
    parser.add_argument("--out-dir", type=Path, default=MODEL_DIR / ".cache/checkpoints")
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()
    if args.smoke:
        print(json.dumps(smoke(args.out_dir), sort_keys=True))
    else:
        print(json.dumps({"epochs": len(train(args.data_dir, args.out_dir))}))
