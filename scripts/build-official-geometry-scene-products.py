#!/usr/bin/env python3
"""Build all non-battle official geometry scenes from the exact closure authority."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from typing import Any


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    parser.add_argument("--assetstudio", type=Path, required=True)
    parser.add_argument("--work-root", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--family", action="append", dest="families")
    args = parser.parse_args()
    repo = args.repo_root.resolve()
    assetstudio = args.assetstudio.resolve()
    work_root = args.work_root.resolve()
    work_root.mkdir(parents=True, exist_ok=True)
    publisher = load_module(
        "official_scene_publisher",
        repo / "scripts/publish-official-resource-batch.py",
    )
    builder = load_module(
        "official_geometry_builder",
        repo / "scripts/build-official-battle-stage-products.py",
    )
    # The underlying build pipeline is family-agnostic. Bind its identity hook
    # to the generic official scene schema rather than duplicating extraction.
    builder.stage_id = publisher.viewer_stage_id

    inventory = read_json(
        repo
        / "artifacts/research/20260825-viewer-official-resource-gap-inventory"
        / "official-resource-gap-inventory.v1.json"
    )
    closure_document = read_json(
        repo
        / "artifacts/delivery/20260826-scene-enemy-batch01/authority"
        / "official-scene-closures.v2.json"
    )
    closures = {row["logicalPath"]: row for row in closure_document["closures"]}
    current_ids = set()
    for shard in (repo / "public/stages/catalogs").glob("official-*.v1.json"):
        current_ids.update(entry["id"] for entry in read_json(shard).get("stages") or [])

    rows = []
    for row in inventory["sceneAudit"]["officialLocalUnlisted"]:
        closure = closures[row["logicalPath"]]
        types = closure["objectTypeCounts"]
        geometry = bool(
            types.get("Mesh")
            or types.get("MeshFilter")
            or types.get("SkinnedMeshRenderer")
        )
        identifier = publisher.viewer_stage_id(row)
        if row["family"] == "battle-direct" or not geometry or identifier in current_ids:
            continue
        if args.families and row["family"] not in set(args.families):
            continue
        rows.append(row)
    if args.limit is not None:
        rows = rows[: args.limit]

    records = []
    failures = []
    records_root = (
        repo
        / "artifacts/delivery/20260826-scene-enemy-batch01"
        / "build-records/geometry-scenes"
    )
    extractor = repo / "tools/magius/extract_magius_scene_profile.py"
    for index, row in enumerate(rows, start=1):
        identifier = publisher.viewer_stage_id(row)
        print(f"[{index}/{len(rows)}] {identifier}", flush=True)
        try:
            record = builder.build_one(
                repo=repo,
                source_root=Path(closure_document["sourceRoot"]),
                assetstudio=assetstudio,
                extractor=extractor,
                work_root=work_root,
                records_root=records_root / row["family"],
                unity_version=closure_document["unityVersion"],
                row=row,
                closure=closures[row["logicalPath"]],
                publisher=publisher,
                keep_work=False,
            )
            records.append(record)
        except Exception as error:
            failure = {
                "stageId": identifier,
                "stableKey": row["logicalPath"],
                "family": row["family"],
                "error": str(error),
            }
            write_json(records_root / "failures" / f"{identifier}.json", failure)
            failures.append(failure)

    summary = {
        "requested": len(rows),
        "published": len(records),
        "failed": len(failures),
        "stageIds": [record["stageId"] for record in records],
        "failures": failures,
    }
    write_json(records_root.parent / "latest-geometry-scenes-summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
