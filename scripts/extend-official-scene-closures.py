#!/usr/bin/env python3
"""Extend the existing scene closure authority to the exact 581-item gap set.

The inventory and complete CAB index are treated as immutable inputs. Only the
previously unindexed authority rows are opened to read their serialized external
CAB tables; the catalog and game installation are not enumerated again.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import warnings
from collections import Counter
from pathlib import Path
from typing import Any

import UnityPy


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def load_inspector(repo: Path):
    path = repo / "scripts/build-steam-scene-closure-index.py"
    spec = importlib.util.spec_from_file_location("scene_closure_inspector", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load closure inspector: {path}")
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
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    repo = args.repo_root.resolve()
    inventory = read_json(
        repo
        / "artifacts/research/20260825-viewer-official-resource-gap-inventory"
        / "official-resource-gap-inventory.v1.json"
    )
    prior_document = read_json(
        repo
        / "artifacts/bulk-stage-expansion-20260817"
        / "steam-scene-dependency-closures.json"
    )
    cab_index = read_json(
        repo / "artifacts/bulk-stage-expansion-20260817/cab-index.json"
    )
    if not cab_index.get("complete"):
        raise ValueError("Existing CAB index is not complete")
    source_root = Path(cab_index["sourceRoot"])
    unity_version = cab_index["unityVersion"]
    UnityPy.config.FALLBACK_UNITY_VERSION = unity_version
    warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")
    inspector = load_inspector(repo)

    prior = {row["logicalPath"]: row for row in prior_document["closures"]}
    cab_mappings = cab_index["cabs"]
    rows = inventory["sceneAudit"]["officialLocalUnlisted"]
    if len(rows) != 581 or len({row["logicalPath"] for row in rows}) != 581:
        raise ValueError("Exact scene-gap authority is not 581 unique logical keys")

    closures = []
    reused = 0
    inspected = 0
    for index, row in enumerate(rows, start=1):
        logical_path = row["logicalPath"]
        if logical_path in prior:
            closure = dict(prior[logical_path])
            reused += 1
        else:
            source = source_root / Path(logical_path)
            if not source.is_file():
                raise FileNotFoundError(source)
            metadata = inspector.inspect_bundle(source, True)
            external = metadata.get("externalCabs") or []
            dependencies = []
            unresolved = []
            for cab in external:
                mappings = cab_mappings.get(cab) or []
                if not mappings:
                    unresolved.append(cab)
                dependencies.append(
                    {
                        "cab": cab,
                        "resolved": bool(mappings),
                        "preferredLogicalPath": (
                            mappings[0]["logicalPath"] if mappings else None
                        ),
                        "allMappings": mappings,
                    }
                )
            closure = {
                "logicalPath": logical_path,
                "resourceName": row["resourceName"],
                "family": row["family"],
                "sourceBytes": source.stat().st_size,
                "primaryCabs": metadata.get("serializedCabs") or [],
                "externalCabCount": len(external),
                "externalCabs": external,
                "resolvedExternalCabCount": len(external) - len(unresolved),
                "unresolvedExternalCabs": unresolved,
                "fullyResolved": not unresolved,
                "dependencies": dependencies,
                "objectCount": metadata.get("objectCount", 0),
                "objectTypeCounts": metadata.get("objectTypeCounts") or {},
            }
            inspected += 1
        if closure["family"] != row["family"]:
            raise ValueError(f"Closure family mismatch: {logical_path}")
        closures.append(closure)
        if index % 50 == 0:
            print(f"[{index}/581] exact authority rows closed", flush=True)

    family_counts = Counter(row["family"] for row in closures)
    unresolved = [row for row in closures if not row["fullyResolved"]]
    document = {
        "schema": "magius.official-scene-closures.v2",
        "sourceInventory": (
            "artifacts/research/20260825-viewer-official-resource-gap-inventory/"
            "official-resource-gap-inventory.v1.json"
        ),
        "sourceCabIndex": "artifacts/bulk-stage-expansion-20260817/cab-index.json",
        "sourceRoot": str(source_root),
        "unityVersion": unity_version,
        "counts": {
            "authorityRows": len(closures),
            "reusedIndexedClosures": reused,
            "newExactInspections": inspected,
            "fullyResolved": len(closures) - len(unresolved),
            "unresolved": len(unresolved),
            "families": dict(sorted(family_counts.items())),
        },
        "unresolvedStableKeys": [row["logicalPath"] for row in unresolved],
        "closures": closures,
    }
    output = (
        args.output.resolve()
        if args.output
        else repo
        / "artifacts/delivery/20260826-scene-enemy-batch01/authority"
        / "official-scene-closures.v2.json"
    )
    write_json(output, document)
    print(json.dumps({"output": str(output), **document["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
