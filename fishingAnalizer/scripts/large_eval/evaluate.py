"""Evaluate prepared mail through the production backend, emitting aggregates only."""

import argparse
import json
import os
import statistics
import sys
import tempfile
import time
from collections import Counter, defaultdict
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import urlopen

from scripts.evaluate_local import STATUS, preflight, sha256, start_core
from scripts.large_eval.metrics import summarize
from scripts.large_eval.prepare import _write_json, file_hash


def _year(source: str) -> str:
    if source.startswith("nazario-20"):
        return source[-4:]
    if source.startswith("trec0"):
        return "20" + source[-2:]
    if source.startswith("spamassassin-"):
        return "2003"
    return "unknown"


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    values = sorted(values)
    return round(values[int((len(values) - 1) * fraction)], 2)


def aggregate(rows: list[dict]) -> dict:
    output = {}
    for method in ("laya", "backend"):
        matrix = defaultdict(Counter)
        source_matrices = defaultdict(lambda: defaultdict(Counter))
        year_matrices = defaultdict(lambda: defaultdict(Counter))
        latency = []
        for row in rows:
            status = row[method] if row.get(method) in STATUS else "error"
            label = row["label"]
            matrix[label][status] += 1
            source_matrices[row["source"]][label][status] += 1
            year_matrices[_year(row["source"])][label][status] += 1
            elapsed = row.get(method + "Ms")
            if isinstance(elapsed, (int, float)) and 0 <= elapsed < 120_000:
                latency.append(float(elapsed))
        output[method] = {
            **summarize(matrix),
            "by_source": {name: summarize(data) for name, data in sorted(source_matrices.items())},
            "by_year": {year: summarize(data) for year, data in sorted(year_matrices.items())},
            "median_ms": round(statistics.median(latency), 2) if latency else None,
            "p95_ms": _percentile(latency, 0.95),
            "timed_count": len(latency),
        }
    return output


def laya_root() -> str:
    endpoint = urlsplit(os.environ.get("LAYA_URL", "http://127.0.0.1:8000/v1/systemone"))
    if (endpoint.scheme != "http" or endpoint.hostname not in ("127.0.0.1", "localhost", "::1")
            or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment
            or endpoint.path != "/v1/systemone" or not endpoint.port):
        raise ValueError("LAYA_URL must be a loopback /v1/systemone endpoint with an explicit port")
    return f"http://{endpoint.netloc}"


def _model_identity(root: Path, checkpoint: str) -> dict:
    endpoint = laya_root()
    with urlopen(endpoint + "/health", timeout=5) as response:
        health = json.load(response)
    if health.get("status") != "ok" or "multilingual" not in health.get("loaded", []):
        raise RuntimeError("Laya Multilingual is not ready")
    if health.get("device") != "cuda":
        raise RuntimeError("GPU benchmark requires Laya on CUDA")
    if checkpoint == "base":
        try:
            with urlopen(endpoint + "/checkpoint", timeout=5):
                raise RuntimeError("Active Laya is tuned; base benchmark cannot use it")
        except HTTPError as error:
            if error.code != 404:
                raise
        revision_path = root / "localModel/.cache/huggingface/hub/models--convaiinnovations--laya/refs/main"
        if not revision_path.is_file():
            raise RuntimeError("Base checkpoint revision is unavailable")
        revision = revision_path.read_text().strip()
        weights = revision_path.parent.parent / "snapshots" / revision / "multilingual/model.safetensors"
        if not weights.is_file():
            raise RuntimeError("Base checkpoint weights are unavailable")
        return {"kind": "base", "revision": revision, "sha256": file_hash(weights), "device": "cuda"}
    weights = Path(checkpoint).resolve() / "model.safetensors"
    if not weights.is_file():
        raise RuntimeError("Requested checkpoint weights are unavailable")
    with urlopen(endpoint + "/checkpoint", timeout=5) as response:
        active = json.load(response)
    digest = file_hash(weights)
    if active.get("kind") != "tuned" or active.get("device") != "cuda" or active.get("sha256") != digest:
        raise RuntimeError("Active Laya checkpoint does not match requested weights")
    return {"kind": "tuned", "sha256": digest, "device": "cuda"}


def _worker_result(worker, message: dict) -> dict:
    worker.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
    worker.stdin.flush()
    line = worker.stdout.readline()
    if not line:
        raise RuntimeError("Evaluation worker stopped")
    result = json.loads(line)
    return {
        "laya": result.get("laya") if result.get("laya") in STATUS else "error",
        "backend": result.get("backend") if result.get("backend") in STATUS else "error",
        "layaMs": result.get("layaMs"),
        "backendMs": result.get("backendMs"),
    }


def run(data_dir: Path, split: str, checkpoint: str, out: Path) -> dict:
    root = Path(__file__).resolve().parents[2]
    manifest_path = data_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    expected_ids = manifest["ids_by_split"][split]
    model = _model_identity(root, checkpoint)
    rows = []
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="fishing-large-eval-") as temporary:
        worker = start_core(root, temporary)
        try:
            preflight(worker, "core")
            with (data_dir / f"{split}.jsonl").open(encoding="utf-8") as stream:
                for index, line in enumerate(stream):
                    row = json.loads(line)
                    if index >= len(expected_ids) or row["id"] != expected_ids[index]:
                        raise RuntimeError("Prepared data differs from frozen manifest")
                    if row["label"] not in ("phishing", "ham"):
                        raise RuntimeError("Prepared data has an invalid label")
                    answer = _worker_result(worker, row["message"])
                    rows.append({"source": row["source"], "label": row["label"], **answer})
                    if (index + 1) % 1000 == 0:
                        print(f"{split}: {index + 1}/{len(expected_ids)}", file=sys.stderr, flush=True)
            if len(rows) != len(expected_ids):
                raise RuntimeError("Prepared data is shorter than frozen manifest")
        finally:
            worker.stdin.close()
            worker.wait(timeout=10)
    report = {
        "split": split,
        "checkpoint": model,
        "manifest_sha256": sha256(manifest_path),
        "adapter_sha256": sha256(root / "backend/adapters.ts"),
        "source_sha256": manifest["source_sha256"],
        "sample_count": len(rows),
        "results": aggregate(rows),
        "wall_time_s": round(time.monotonic() - started, 2),
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    _write_json(out, report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parents[2] / "localModel/.cache/evaluation")
    parser.add_argument("--split", choices=("validation", "test"), required=True)
    parser.add_argument("--checkpoint", default="base")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = run(args.data_dir, args.split, args.checkpoint, args.out)
    print(json.dumps({"split": result["split"], "sample_count": result["sample_count"],
                      "wall_time_s": result["wall_time_s"], "output": str(args.out)}))
