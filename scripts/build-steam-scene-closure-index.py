from __future__ import annotations

import argparse
import json
import os
import re
import sys
import warnings
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import UnityPy


SCHEMA_VERSION = 1
CAB_RE = re.compile(r"CAB-[0-9a-f]{32}", re.IGNORECASE)
DEFAULT_UNITY_VERSION = "2022.3.62f2"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build a no-copy Steam scene inventory, CAB index and dependency closures. "
            "The source tree remains read-only; only JSON/Markdown evidence is written."
        )
    )
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--steam-root", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--unity-version", default=DEFAULT_UNITY_VERSION)
    parser.add_argument(
        "--sample-scene",
        action="append",
        default=[],
        help="Resource name to emit as a focused closure (repeatable).",
    )
    parser.add_argument(
        "--complete-cab-index",
        action="store_true",
        help="Inspect every catalogued AssetBundle instead of stopping after scene dependencies resolve.",
    )
    parser.add_argument("--checkpoint-every", type=int, default=250)
    return parser.parse_args()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    os.replace(temporary, path)


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value.rstrip() + "\n", encoding="utf-8", newline="\n")


def normalise_logical(value: str) -> str:
    return value.replace("\\", "/").lstrip("./")


def family_for(logical: str) -> str | None:
    if re.fullmatch(r"AssetBundles/battle/stage/bg_3d_.+_bosspoint", logical):
        return "battle-bosspoint-helper"
    if re.fullmatch(r"AssetBundles/battle/stage/bg_3d_.+", logical):
        return "battle-direct"
    if logical.startswith("AssetBundles/battle/stage/tower_data/"):
        return "battle-tower-data"
    # The official catalog contains one shipped typo, ``_originall``.  Treat it
    # as the same family rather than silently dropping a real gallery scene.
    if re.fullmatch(
        r"AssetBundles/gallery/library/diorama_background/.+_originall?", logical
    ):
        return "gallery-diorama-original"
    if logical in {
        "AssetBundles/gallery/bg3d_gallery",
        "AssetBundles/gallery/bg3d_gallery_story",
    }:
        return "gallery-3d-controller"
    if logical.startswith("AssetBundles/dungeon/bg/"):
        return "dungeon-background"
    if logical.startswith("AssetBundles/field/bg/"):
        return "field-background"
    if logical.startswith("AssetBundles/home/doll_house_3d_background/"):
        return "home-dollhouse-3d-background"
    if logical.startswith("AssetBundles/alternative_story/3d/"):
        return "alternative-story-3d"
    return None


def scan_priority(logical: str) -> tuple[int, str]:
    family = family_for(logical)
    if family == "battle-direct":
        return 0, logical
    if family in {
        "battle-bosspoint-helper",
        "battle-tower-data",
        "gallery-diorama-original",
        "gallery-3d-controller",
    }:
        return 1, logical
    if logical.startswith("AssetBundles/shader/") or logical.startswith(
        "AssetBundles/shaders/"
    ):
        return 2, logical
    if logical.startswith("AssetBundles/texture/bg/"):
        return 3, logical
    if logical.startswith("AssetBundles/texture/"):
        return 4, logical
    if logical.startswith("AssetBundles/common/"):
        return 5, logical
    if logical.startswith("AssetBundles/battle/"):
        return 6, logical
    return 7, logical


def iter_files(node: Any) -> Iterable[Any]:
    yield node
    nested = getattr(node, "files", None)
    if isinstance(nested, dict):
        for child in nested.values():
            yield from iter_files(child)


def inspect_bundle(path: Path, include_scene_truth: bool) -> dict[str, Any]:
    environment = UnityPy.load(str(path))
    serialized = [
        item
        for root in environment.files.values()
        for item in iter_files(root)
        if type(item).__name__ == "SerializedFile"
    ]
    serialized_cabs = sorted(
        {
            match.group(0)
            for item in serialized
            for match in [CAB_RE.fullmatch(str(getattr(item, "name", "")))]
            if match
        }
    )
    result: dict[str, Any] = {
        "serializedCabs": serialized_cabs,
        "serializedFileCount": len(serialized),
    }
    if include_scene_truth:
        external_cabs = set()
        object_types: Counter[str] = Counter()
        object_count = 0
        for item in serialized:
            for external in getattr(item, "externals", []):
                match = CAB_RE.search(str(getattr(external, "path", "")))
                if match:
                    external_cabs.add(match.group(0))
            objects = getattr(item, "objects", {})
            object_count += len(objects)
            for obj in objects.values():
                object_types[str(obj.type.name)] += 1
        result.update(
            {
                "externalCabs": sorted(external_cabs),
                "externalCabCount": len(external_cabs),
                "objectCount": object_count,
                "objectTypeCounts": dict(sorted(object_types.items())),
            }
        )
    return result


def load_viewer_resources(repo: Path) -> tuple[set[str], list[dict[str, Any]]]:
    root_catalog = repo / "public" / "stages" / "catalog.json"
    if not root_catalog.is_file():
        return set(), []
    root_value = json.loads(root_catalog.read_text(encoding="utf-8-sig"))
    stages = list(root_value.get("stages", []))
    for entry in root_value.get("entries", []):
        relative = normalise_logical(str(entry))
        entry_path = repo / "public" / relative
        if entry_path.is_file():
            stages.append(json.loads(entry_path.read_text(encoding="utf-8-sig")))
    resources: set[str] = set()
    for stage in stages:
        for field in ("assetBundleName", "url"):
            match = re.search(r"(bg_3d_[0-9_]+)", str(stage.get(field, "")))
            if match:
                resources.add(match.group(1).rstrip("_"))
    return resources, stages


def cache_record_is_current(record: dict[str, Any], path: Path) -> bool:
    try:
        stat = path.stat()
    except OSError:
        return False
    return (
        record.get("bytes") == stat.st_size
        and record.get("mtimeNs") == stat.st_mtime_ns
        and record.get("status") in {"ok", "error"}
    )


def make_cache_document(
    steam_root: Path,
    unity_version: str,
    records: dict[str, dict[str, Any]],
    complete: bool,
) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "sourceRoot": str(steam_root),
        "unityVersion": unity_version,
        "complete": complete,
        "records": [records[key] for key in sorted(records)],
    }


def main() -> int:
    args = parse_args()
    repo = args.repo.resolve()
    steam_root = args.steam_root.resolve()
    catalog_path = args.catalog.resolve()
    output = args.output.resolve()
    asset_root = steam_root / "AssetBundles"

    for required in (repo, steam_root, asset_root, catalog_path):
        if not required.exists():
            raise FileNotFoundError(required)
    output.mkdir(parents=True, exist_ok=True)

    UnityPy.config.FALLBACK_UNITY_VERSION = args.unity_version
    warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")

    catalog: dict[str, dict[str, Any]] = json.loads(
        catalog_path.read_text(encoding="utf-8-sig")
    )
    asset_entries = sorted(
        normalise_logical(key)
        for key, value in catalog.items()
        if isinstance(value, dict)
        and value.get("category") == "AssetBundles"
        and normalise_logical(key).startswith("AssetBundles/")
    )
    scene_entries = [key for key in asset_entries if family_for(key)]
    viewer_resources, viewer_stages = load_viewer_resources(repo)

    cache_path = output / "cab-scan-cache.json"
    cache_records: dict[str, dict[str, Any]] = {}
    if cache_path.is_file():
        prior = json.loads(cache_path.read_text(encoding="utf-8-sig"))
        if (
            prior.get("schemaVersion") == SCHEMA_VERSION
            and prior.get("sourceRoot") == str(steam_root)
            and prior.get("unityVersion") == args.unity_version
        ):
            cache_records = {
                record["logicalPath"]: record for record in prior.get("records", [])
            }

    scene_metadata: dict[str, dict[str, Any]] = {}
    scene_errors: list[dict[str, str]] = []
    for logical in sorted(scene_entries):
        path = steam_root / Path(logical)
        family = family_for(logical)
        include_truth = family in {
            "battle-direct",
            "gallery-diorama-original",
            "gallery-3d-controller",
        }
        prior = cache_records.get(logical)
        can_reuse = (
            prior is not None
            and cache_record_is_current(prior, path)
            and (
                not include_truth
                or "externalCabs" in prior
                or prior.get("status") == "error"
            )
        )
        if can_reuse:
            record = prior
        else:
            stat = path.stat()
            record = {
                "logicalPath": logical,
                "bytes": stat.st_size,
                "mtimeNs": stat.st_mtime_ns,
            }
            try:
                record.update(inspect_bundle(path, include_truth))
                record["status"] = "ok"
            except Exception as exc:  # preserve exact failed item for resumption
                record.update({"status": "error", "error": str(exc)})
            cache_records[logical] = record
        if include_truth and record.get("status") == "ok":
            scene_metadata[logical] = record
        elif include_truth:
            scene_errors.append({"logicalPath": logical, "error": record["error"]})

    required_external_cabs = {
        cab
        for record in scene_metadata.values()
        for cab in record.get("externalCabs", [])
    }

    processed_since_checkpoint = 0
    for logical in sorted(asset_entries, key=scan_priority):
        path = steam_root / Path(logical)
        prior = cache_records.get(logical)
        if prior is not None and cache_record_is_current(prior, path):
            pass
        else:
            stat = path.stat()
            record = {
                "logicalPath": logical,
                "bytes": stat.st_size,
                "mtimeNs": stat.st_mtime_ns,
            }
            try:
                record.update(inspect_bundle(path, False))
                record["status"] = "ok"
            except Exception as exc:
                record.update({"status": "error", "error": str(exc)})
            cache_records[logical] = record
            processed_since_checkpoint += 1

        if processed_since_checkpoint >= args.checkpoint_every:
            atomic_json(
                cache_path,
                make_cache_document(
                    steam_root, args.unity_version, cache_records, complete=False
                ),
            )
            processed_since_checkpoint = 0

        if not args.complete_cab_index:
            mapped_now = {
                cab
                for record in cache_records.values()
                if record.get("status") == "ok"
                for cab in record.get("serializedCabs", [])
            }
            if required_external_cabs <= mapped_now:
                break

    scan_is_complete = len(cache_records) >= len(asset_entries) and all(
        key in cache_records for key in asset_entries
    )
    atomic_json(
        cache_path,
        make_cache_document(
            steam_root, args.unity_version, cache_records, complete=scan_is_complete
        ),
    )

    cab_mappings: dict[str, list[dict[str, Any]]] = defaultdict(list)
    scan_errors = []
    for logical in sorted(cache_records):
        record = cache_records[logical]
        if record.get("status") != "ok":
            scan_errors.append(
                {"logicalPath": logical, "error": record.get("error", "unknown")}
            )
            continue
        for cab in record.get("serializedCabs", []):
            cab_mappings[cab].append(
                {"logicalPath": logical, "bytes": record["bytes"]}
            )
    for values in cab_mappings.values():
        values.sort(key=lambda value: scan_priority(value["logicalPath"]))

    cab_index = {
        "schemaVersion": SCHEMA_VERSION,
        "unityVersion": args.unity_version,
        "sourceRoot": str(steam_root),
        "catalog": str(catalog_path),
        "catalogEntryCount": len(catalog),
        "assetBundleEntryCount": len(asset_entries),
        "inspectedAssetBundleCount": len(cache_records),
        "complete": scan_is_complete,
        "cabCount": len(cab_mappings),
        "duplicateCabCount": sum(1 for values in cab_mappings.values() if len(values) > 1),
        "scanErrorCount": len(scan_errors),
        "scanErrors": scan_errors,
        "cabs": {cab: cab_mappings[cab] for cab in sorted(cab_mappings)},
    }
    atomic_json(output / "cab-index.json", cab_index)

    family_counts = Counter(family_for(key) for key in scene_entries)
    scene_records = []
    for logical in sorted(scene_entries):
        path = steam_root / Path(logical)
        resource = path.name
        record = cache_records.get(logical, {})
        scene_records.append(
            {
                "logicalPath": logical,
                "assetRelativePath": normalise_logical(str(Path(logical).relative_to("AssetBundles"))),
                "family": family_for(logical),
                "resourceName": resource,
                "bytes": path.stat().st_size,
                "catalogPresent": logical in catalog,
                "localPresent": path.is_file(),
                "viewerPresent": resource in viewer_resources,
                "inspectionStatus": record.get("status", "not-inspected"),
                "serializedCabs": record.get("serializedCabs", []),
            }
        )
    direct_battle = [x for x in scene_records if x["family"] == "battle-direct"]
    inventory = {
        "schemaVersion": SCHEMA_VERSION,
        "unityVersion": args.unity_version,
        "sources": {
            "steamRoot": str(steam_root),
            "resourceCatalog": str(catalog_path),
            "viewerCatalog": str(repo / "public" / "stages" / "catalog.json"),
        },
        "counts": {
            "catalogEntries": len(catalog),
            "catalogAssetBundles": len(asset_entries),
            "sceneRelatedBundles": len(scene_records),
            "viewerCatalogStageRecords": len(viewer_stages),
            "viewerReferencedBattleResources": len(viewer_resources),
            "directBattleScenes": len(direct_battle),
            "directBattleScenesInViewer": sum(x["viewerPresent"] for x in direct_battle),
            "directBattleScenesMissingFromViewer": sum(
                not x["viewerPresent"] for x in direct_battle
            ),
            "families": dict(sorted(family_counts.items())),
        },
        "directBattleCoverage": [
            {
                "resourceName": row["resourceName"],
                "bytes": row["bytes"],
                "viewerPresent": row["viewerPresent"],
                "gap": None if row["viewerPresent"] else "not-registered-in-viewer",
            }
            for row in direct_battle
        ],
        "sceneBundles": scene_records,
    }
    atomic_json(output / "steam-scene-inventory.json", inventory)

    closures = []
    for logical, metadata in sorted(scene_metadata.items()):
        external = metadata.get("externalCabs", [])
        dependency_rows = []
        unresolved = []
        for cab in external:
            mappings = cab_mappings.get(cab, [])
            if not mappings:
                unresolved.append(cab)
            dependency_rows.append(
                {
                    "cab": cab,
                    "resolved": bool(mappings),
                    "preferredLogicalPath": mappings[0]["logicalPath"] if mappings else None,
                    "allMappings": mappings,
                }
            )
        closures.append(
            {
                "logicalPath": logical,
                "resourceName": Path(logical).name,
                "family": family_for(logical),
                "sourceBytes": metadata["bytes"],
                "primaryCabs": metadata.get("serializedCabs", []),
                "externalCabCount": len(external),
                "externalCabs": external,
                "resolvedExternalCabCount": len(external) - len(unresolved),
                "unresolvedExternalCabs": unresolved,
                "fullyResolved": not unresolved,
                "dependencies": dependency_rows,
                "objectCount": metadata.get("objectCount", 0),
                "objectTypeCounts": metadata.get("objectTypeCounts", {}),
            }
        )
    direct_closures = [x for x in closures if x["family"] == "battle-direct"]
    closure_document = {
        "schemaVersion": SCHEMA_VERSION,
        "unityVersion": args.unity_version,
        "sourceRoot": str(steam_root),
        "copyMode": "none-read-source-in-place",
        "summary": {
            "sceneClosures": len(closures),
            "sceneInspectionErrors": len(scene_errors),
            "directBattleClosures": len(direct_closures),
            "directBattleFullyResolved": sum(x["fullyResolved"] for x in direct_closures),
            "directBattleWithUnresolved": sum(not x["fullyResolved"] for x in direct_closures),
            "requiredUniqueExternalCabs": len(required_external_cabs),
            "resolvedUniqueExternalCabs": sum(
                cab in cab_mappings for cab in required_external_cabs
            ),
            "unresolvedUniqueExternalCabs": len(
                required_external_cabs - set(cab_mappings)
            ),
        },
        "sceneInspectionErrors": scene_errors,
        "unresolvedUniqueExternalCabs": sorted(
            required_external_cabs - set(cab_mappings)
        ),
        "closures": closures,
    }
    atomic_json(output / "steam-scene-dependency-closures.json", closure_document)

    closure_by_resource = {row["resourceName"]: row for row in closures}
    for sample in args.sample_scene:
        if sample not in closure_by_resource:
            raise RuntimeError(f"sample scene was not discovered: {sample}")
        atomic_json(
            output / f"{sample}-dependency-closure.json",
            {
                "schemaVersion": SCHEMA_VERSION,
                "source": "steam-scene-dependency-closures.json",
                "closure": closure_by_resource[sample],
            },
        )

    unresolved_direct = [row for row in direct_closures if not row["fullyResolved"]]
    report = f"""# Steam official 3D scene inventory and no-copy closure

## Source contract

- Steam decrypted root: `{steam_root}`
- Resource catalog: `{catalog_path}`
- Unity profile: `{args.unity_version}`
- Source bundle copies made: **0**
- CAB scan complete: **{str(scan_is_complete).lower()}**
- CAB scan errors: **{len(scan_errors)}**

## Inventory

- Direct `battle/stage/bg_3d_*` scenes (excluding helpers): **{len(direct_battle)}**
- Direct battle scenes currently referenced by Viewer: **{sum(x['viewerPresent'] for x in direct_battle)}**
- Direct battle scene registration gaps: **{sum(not x['viewerPresent'] for x in direct_battle)}**
- Gallery diorama `_original` bundles: **{family_counts['gallery-diorama-original']}**
- Battle boss-point helpers: **{family_counts['battle-bosspoint-helper']}**
- Battle tower-data bundles: **{family_counts['battle-tower-data']}**
- Dungeon/field/home/alternative-story 3D-related bundles: **{family_counts['dungeon-background'] + family_counts['field-background'] + family_counts['home-dollhouse-3d-background'] + family_counts['alternative-story-3d']}**

## Dependency closure

- Direct battle closures: **{len(direct_closures)}**
- Fully mapped direct battle closures: **{sum(x['fullyResolved'] for x in direct_closures)}**
- Direct battle closures with unresolved CABs: **{len(unresolved_direct)}**
- Unique external CABs required by inspected scenes: **{len(required_external_cabs)}**
- Required CABs mapped to logical source paths: **{sum(cab in cab_mappings for cab in required_external_cabs)}**
- Unresolved required CABs: **{len(required_external_cabs - set(cab_mappings))}**

The inventory and resolver are generic: scene external tables are read from each official
bundle, CAB names are indexed from catalogued local bundles, and closure selection does not
contain per-stage dependency lists. Registration still remains gated on the separate material,
UV1/lightmap, animation/dynamic-object, Volume and visual parity work.
"""
    write_text(output / "REPORT.md", report)

    result = {
        "inventory": str(output / "steam-scene-inventory.json"),
        "cabIndex": str(output / "cab-index.json"),
        "closures": str(output / "steam-scene-dependency-closures.json"),
        "directBattleScenes": len(direct_battle),
        "directBattleFullyResolved": sum(x["fullyResolved"] for x in direct_closures),
        "directBattleWithUnresolved": len(unresolved_direct),
        "requiredExternalCabs": len(required_external_cabs),
        "resolvedRequiredExternalCabs": sum(
            cab in cab_mappings for cab in required_external_cabs
        ),
        "cabIndexComplete": scan_is_complete,
        "scanErrors": len(scan_errors),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
