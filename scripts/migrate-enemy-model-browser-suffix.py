#!/usr/bin/env python3
"""Publish gzip-compressed enemy FBX payloads under the Viewer `.fbxdata` suffix.

The bytes remain gzip-compressed. Only the browser-facing suffix changes so a
download-manager extension cannot intercept model fetches as raw `.gz` files.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


OLD_NAME = "VisualRoot.fbx.gz"
NEW_NAME = "VisualRoot.fbxdata"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    args = parser.parse_args()
    repo = args.repo_root.resolve()
    models_root = repo / "public/enemies/models"
    renamed = 0

    for old_path in sorted(models_root.glob(f"*/{OLD_NAME}")):
        with old_path.open("rb") as source:
            magic = source.read(2)
        if magic != b"\x1f\x8b":
            raise ValueError(f"Enemy model is not gzip-compressed: {old_path}")
        new_path = old_path.with_name(NEW_NAME)
        if new_path.exists():
            raise FileExistsError(new_path)
        old_path.rename(new_path)
        renamed += 1

    runtime_records = 0
    for runtime_path in sorted(models_root.glob("*/model-runtime.v1.json")):
        runtime = read_json(runtime_path)
        model_url = runtime.get("runtime", {}).get("modelUrl")
        if isinstance(model_url, str) and model_url.endswith(OLD_NAME):
            runtime["runtime"]["modelUrl"] = model_url.removesuffix(OLD_NAME) + NEW_NAME
            write_json(runtime_path, runtime)
            runtime_records += 1

    manifest_path = repo / "public/enemies/manifest.v1.json"
    manifest = read_json(manifest_path)
    manifest_records = 0
    for entry in manifest["entries"]:
        model_url = entry["model"].get("runtimeUrl")
        if isinstance(model_url, str) and model_url.endswith(OLD_NAME):
            entry["model"]["runtimeUrl"] = model_url.removesuffix(OLD_NAME) + NEW_NAME
            manifest_records += 1
    write_json(manifest_path, manifest)

    remaining = list(models_root.glob(f"*/{OLD_NAME}"))
    published = list(models_root.glob(f"*/{NEW_NAME}"))
    if remaining or len(published) != 493:
        raise RuntimeError(
            f"Enemy browser-suffix closure failed: remaining={len(remaining)} "
            f"published={len(published)}"
        )
    print(
        json.dumps(
            {
                "renamedModels": renamed,
                "publishedModels": len(published),
                "runtimeRecordsUpdated": runtime_records,
                "manifestRecordsUpdated": manifest_records,
                "rawGzipPathsRemaining": len(remaining),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
