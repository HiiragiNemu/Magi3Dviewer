#!/usr/bin/env python3
"""Generate the UI-neutral official scene, enemy and VFX catalog API."""

from __future__ import annotations

import argparse
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    args = parser.parse_args()
    repo = args.repo_root.resolve()
    public = repo / "public"

    scenes = []
    for shard_path in sorted((public / "stages/catalogs").glob("official-*.v1.json")):
        shard = read_json(shard_path)
        for entry in shard.get("stages") or []:
            scenes.append(
                {
                    "id": entry["id"],
                    "stableKey": entry["stableKey"],
                    "family": entry["family"],
                    "category": entry["category"],
                    "displayName": entry["name"],
                    "names": entry.get("names") or {},
                    "type": entry["type"],
                    "url": entry["url"],
                    "sceneProfileUrl": entry.get("sceneProfileUrl"),
                    "product": entry["product"],
                }
            )
    scenes.sort(key=lambda entry: (entry["family"], entry["id"]))

    enemy_manifest = read_json(public / "enemies/manifest.v1.json")
    model_groups: dict[str, list[dict[str, Any]]] = {}
    for entry in enemy_manifest["entries"]:
        model_groups.setdefault(entry["modelPrefabName"], []).append(entry)
    enemy_models = []
    for model_name, records in sorted(model_groups.items()):
        first = records[0]
        names = {
            locale: next(
                (
                    record.get("names", {}).get(locale)
                    for record in records
                    if record.get("names", {}).get(locale)
                ),
                None,
            )
            for locale in ("en", "ja", "zhHant", "runes")
        }
        enemy_models.append(
            {
                "modelPrefabName": model_name,
                "stableKey": first["model"]["bundleKey"],
                "recordIds": [record["enemyMstId"] for record in records],
                "enemyUniqueIds": sorted(
                    {record["enemyUniqueId"] for record in records}
                ),
                "displayName": names["en"] or names["ja"] or model_name,
                "names": names,
                "modelUrl": first["model"]["runtimeUrl"],
                "materialProfileUrl": first["model"].get("materialProfileUrl"),
                "thumbnailUrl": first["thumbnail"]["url"],
                "renderReady": all(record["model"]["renderReady"] for record in records),
                "materialProfileRuntimeReady": all(
                    record["model"].get("materialProfileUrl")
                    for record in records
                ),
            }
        )

    vfx_catalog = read_json(public / "vfx/catalog.v1.json")
    vfx = [
        {
            "stableKey": entry["stableKey"],
            "productStableKey": entry["productStableKey"],
            "domain": entry["domain"],
            "ownerKey": entry["ownerKey"],
            "directionKey": entry["directionKey"],
            "displayName": entry["directionKey"],
            "bundleKey": entry["bundleKey"],
            "productUrl": entry["productUrl"],
            "status": entry["status"],
            "runtimeReady": entry["runtimeReady"],
            "failClosedReasons": entry["failClosedReasons"],
        }
        for entry in vfx_catalog["entries"]
        if entry.get("publicationScope") == "target"
    ]
    vfx.sort(key=lambda entry: (entry["domain"], entry["ownerKey"], entry["directionKey"]))

    document = {
        "schema": "magius.official-resource-catalog.v1",
        "counts": {
            "scenes": len(scenes),
            "sceneTarget": 581,
            "enemyRecords": len(enemy_manifest["entries"]),
            "enemyModels": len(enemy_models),
            "enemyModelTarget": 493,
            "enemyMaterialProfiles": sum(
                bool(entry["materialProfileUrl"]) for entry in enemy_models
            ),
            "enemyMaterialProfileRuntimeReady": sum(
                bool(entry["materialProfileRuntimeReady"])
                for entry in enemy_models
            ),
            "enemyVfx": sum(entry["domain"] == "enemy" for entry in vfx),
            "enemyVfxTarget": 443,
            "enemyVfxRuntimeReady": sum(
                entry["domain"] == "enemy" and entry["runtimeReady"] for entry in vfx
            ),
            "characterVfx": sum(entry["domain"] == "character" for entry in vfx),
            "characterVfxTarget": 211,
            "characterVfxRuntimeReady": sum(
                entry["domain"] == "character" and entry["runtimeReady"] for entry in vfx
            ),
            "vfxFailClosed": sum(not entry["runtimeReady"] for entry in vfx),
        },
        "scenes": scenes,
        "enemyModels": enemy_models,
        "vfx": vfx,
    }
    if len({entry["stableKey"] for entry in scenes}) != len(scenes):
        raise ValueError("Duplicate official scene stable key")
    if len({entry["stableKey"] for entry in enemy_models}) != len(enemy_models):
        raise ValueError("Duplicate official enemy model stable key")
    if len({entry["stableKey"] for entry in vfx}) != len(vfx):
        raise ValueError("Duplicate official VFX stable key")
    expected = {
        "scenes": 581,
        "enemyRecords": 514,
        "enemyModels": 493,
        "enemyMaterialProfiles": 493,
        "enemyMaterialProfileRuntimeReady": 493,
        "enemyVfx": 443,
        "characterVfx": 211,
    }
    for field, target in expected.items():
        if document["counts"][field] != target:
            raise ValueError(
                f"Official resource catalog is incomplete: {field}="
                f"{document['counts'][field]} != {target}"
            )
    output = public / "catalogs/official-resources.v1.json"
    write_json(output, document)
    print(json.dumps({"output": str(output), **document["counts"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
