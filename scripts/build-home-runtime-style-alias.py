#!/usr/bin/env python3
"""Retarget an official Home runtime through an authoritative style MST alias."""

from __future__ import annotations

import argparse
import gzip
import json
import re
from pathlib import Path


def read_json(path: Path) -> dict:
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            return json.load(stream)
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    payload = (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    if path.suffix == ".gz":
        path.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
    else:
        path.write_bytes(payload)


def directory_character_id(path: Path) -> int:
    match = re.fullmatch(r"chara_(\d+)(?:_battle_unit)?", path.name)
    if not match:
        raise SystemExit(f"unexpected model directory: {path}")
    return int(match.group(1))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mst", type=Path, required=True)
    parser.add_argument("--style-id", type=int, required=True)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--target-dir", type=Path, required=True)
    args = parser.parse_args()

    source_id = directory_character_id(args.source_dir)
    target_id = directory_character_id(args.target_dir)
    mst = read_json(args.mst)
    rows = mst["payload"]["mstList"]
    row = next((item for item in rows if int(item["style3dCharacterMstId"]) == args.style_id), None)
    if row is None:
        raise SystemExit(f"style {args.style_id} is absent from MST")
    expected_resource = f"chara_{source_id}_battle_unit"
    if row["resourceName"] != expected_resource:
        raise SystemExit(f"style resource mismatch: {row['resourceName']} != {expected_resource}")
    expected_home = f"chara_{source_id}01_home"
    if row["homeMotionResourceName"] != expected_home:
        raise SystemExit(f"style Home source mismatch: {row['homeMotionResourceName']} != {expected_home}")

    authority = {
        "kind": "style3dCharacterMst-alias",
        "style3dCharacterMstId": args.style_id,
        "sourceCharacterId": source_id,
        "targetCharacterId": target_id,
        "resourceName": row["resourceName"],
        "homeMotionResourceName": row["homeMotionResourceName"],
    }
    animation = read_json(args.source_dir / "home-animations.json.gz")
    if int(animation["characterId"]) != source_id or animation.get("schema") != 2:
        raise SystemExit("source animation runtime is not the exact schema-2 source character")
    source_anchor = f"chara_{source_id}"
    target_anchor = f"chara_{target_id}"
    animation["characterId"] = target_id
    animation["styleRetarget"] = authority
    animation["nodePaths"] = {
        node_id: path.replace(source_anchor, target_anchor)
        for node_id, path in animation["nodePaths"].items()
    }
    if any(source_anchor in path for path in animation["nodePaths"].values()):
        raise SystemExit("source character anchor remains after retarget")

    expression = read_json(args.source_dir / "home-expressions.json")
    if int(expression["characterId"]) != source_id:
        raise SystemExit("source expression runtime character mismatch")
    expression["characterId"] = target_id
    expression["styleRetarget"] = authority

    args.target_dir.mkdir(parents=True, exist_ok=True)
    write_json(args.target_dir / "home-animations.json.gz", animation)
    write_json(args.target_dir / "home-expressions.json", expression)
    print(json.dumps({
        "styleId": args.style_id,
        "sourceCharacterId": source_id,
        "targetCharacterId": target_id,
        "animationClips": len(animation["clips"]),
        "expressionCount": len(expression["expressions"]),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
