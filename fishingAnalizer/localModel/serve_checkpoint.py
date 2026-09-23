"""Serve a verified local Laya checkpoint through the usual System-1 endpoint."""

import argparse
import hashlib
import json
import os
from pathlib import Path

import laya
import uvicorn
from laya.agent import Agent
from laya.router import Router
from laya.serve import create_app


def checkpoint_info(checkpoint: Path, device: str) -> dict:
    checkpoint = checkpoint.resolve()
    required = [checkpoint / "model.safetensors", checkpoint / "rl_agent_config.json",
                checkpoint / "tokenizer/tokenizer.json", checkpoint / "encoder/config.json",
                checkpoint / "training.json"]
    for file in required:
        if not file.is_file():
            raise FileNotFoundError(f"Checkpoint is incomplete: {file.name}")
    digest = hashlib.sha256()
    with required[0].open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    actual = digest.hexdigest()
    metadata = json.loads(required[-1].read_text())
    if metadata.get("weights_sha256") != actual:
        raise ValueError("Checkpoint hash does not match training metadata")
    return {"kind": "tuned", "sha256": actual, "device": device, "laya_version": laya.__version__}


def build_app(checkpoint: Path, device: str):
    info = checkpoint_info(checkpoint, device)
    agent = Agent(str(checkpoint.resolve()), device=device)
    router = Router(device=device)
    router.attach("multilingual", agent)
    app = create_app(router)

    @app.get("/checkpoint")
    def identity() -> dict:
        return info

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    device = os.environ.get("LAYA_DEVICE", "cuda")
    app = build_app(args.checkpoint, device)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning", access_log=False)
