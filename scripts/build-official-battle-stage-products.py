#!/usr/bin/env python3
"""Build and publish authority-indexed, dependency-closed battle stages.

This consumes the existing inventory and CAB-closure index. It does not scan
the game install or infer dependencies.
"""

from __future__ import annotations

import argparse
import gzip
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def run(command: list[str]) -> dict[str, Any]:
    completed = subprocess.run(
        command,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    record = {
        "command": command,
        "exitStatus": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }
    if completed.returncode:
        raise RuntimeError(json.dumps(record, ensure_ascii=False, indent=2))
    return record


def load_publisher(repo: Path):
    path = repo / "scripts/publish-official-resource-batch.py"
    spec = importlib.util.spec_from_file_location("official_resource_publisher", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load publisher: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def stage_id(row: dict[str, Any]) -> str:
    ids = {
        authority.get("viewerStageId")
        for authority in row.get("nameAuthority") or []
        if authority.get("viewerStageId")
    }
    if len(ids) == 1:
        return ids.pop()
    if len(ids) > 1:
        raise ValueError(f"Expected one Viewer stage ID for {row['logicalPath']}: {ids}")
    resource_name = row["resourceName"]
    if not resource_name.startswith("bg_3d_"):
        raise ValueError(f"No stable Viewer stage identity for {resource_name}")
    return "battle-" + resource_name.removeprefix("bg_3d_").replace("_", "-")


def stage_files(
    row: dict[str, Any],
    closure: dict[str, Any],
) -> list[str]:
    paths = [row["logicalPath"]]
    for dependency in closure["dependencies"]:
        if not dependency["resolved"] or not dependency.get("preferredLogicalPath"):
            raise ValueError(
                f"Unresolved dependency in fully-resolved closure: {row['logicalPath']}"
            )
        paths.append(dependency["preferredLogicalPath"])
    return list(dict.fromkeys(paths))


def safe_clear(path: Path, root: Path) -> None:
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()) or resolved == root.resolve():
        raise ValueError(f"Refusing to clear path outside work root: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)


def build_one(
    *,
    repo: Path,
    source_root: Path,
    assetstudio: Path,
    extractor: Path,
    work_root: Path,
    records_root: Path,
    unity_version: str,
    row: dict[str, Any],
    closure: dict[str, Any],
    publisher: Any,
    keep_work: bool,
) -> dict[str, Any]:
    identifier = stage_id(row)
    resource_name = row["resourceName"]
    stage_work = work_root / identifier
    safe_clear(stage_work, work_root)
    closure_root = stage_work / "closure"
    export_root = stage_work / "export"
    product_root = stage_work / "product"
    closure_root.mkdir(parents=True)
    export_root.mkdir(parents=True)
    product_root.mkdir(parents=True)

    files = []
    for logical_path in stage_files(row, closure):
        if not logical_path.startswith("AssetBundles/"):
            raise ValueError(f"Unexpected logical path: {logical_path}")
        relative = Path(logical_path.removeprefix("AssetBundles/"))
        source = source_root / "AssetBundles" / relative
        if not source.is_file():
            raise FileNotFoundError(source)
        destination = closure_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        files.append(
            {
                "logicalPath": logical_path,
                "staged": str(destination.resolve()),
                "bytes": destination.stat().st_size,
            }
        )

    closure_manifest = {
        "schema": "magius.stage-dependency-closure.v1",
        "scene": resource_name,
        "logicalPath": row["logicalPath"],
        "unityVersion": unity_version,
        "fullyResolved": True,
        "externalCabCount": closure["externalCabCount"],
        "resolvedExternalCabCount": closure["resolvedExternalCabCount"],
        "files": files,
    }
    closure_manifest_path = stage_work / "closure-manifest.v1.json"
    write_json(closure_manifest_path, closure_manifest)

    commands = []
    commands.append(
        run(
            [
                str(assetstudio),
                str(closure_root),
                "--mode",
                "splitObjects",
                "--group-option",
                "none",
                "--output",
                str(export_root),
                "--unity-version",
                unity_version,
                "--log-level",
                "warning",
            ]
        )
    )
    scene_export_root = export_root / resource_name
    fbx_path = scene_export_root / f"{resource_name}.fbx"
    if not fbx_path.is_file():
        candidates = list(export_root.rglob(f"{resource_name}.fbx"))
        if len(candidates) != 1:
            raise FileNotFoundError(
                f"Expected one exported FBX for {resource_name}, found {len(candidates)}"
            )
        fbx_path = candidates[0]
        scene_export_root = fbx_path.parent

    for exported in scene_export_root.iterdir():
        if exported.is_file() and exported != fbx_path:
            shutil.copy2(exported, product_root / exported.name)
    model_path = product_root / f"{resource_name}.fbxdata"
    with fbx_path.open("rb") as source, model_path.open("wb") as target:
        with gzip.GzipFile(
            filename="",
            mode="wb",
            compresslevel=9,
            fileobj=target,
            mtime=0,
        ) as compressed:
            shutil.copyfileobj(source, compressed)

    asset_prefix = f"./stages/official/{identifier}"
    commands.append(
        run(
            [
                sys.executable,
                str(extractor),
                str(closure_manifest_path),
                "--output",
                str(product_root / "scene-profile.json"),
                "--stage-id",
                identifier,
                "--asset-prefix",
                asset_prefix,
                "--product-dir",
                str(product_root),
                "--export-assets",
                "--model-url",
                f"{asset_prefix}/{model_path.name}",
            ]
        )
    )

    profile_path = product_root / "scene-profile.json"
    profile_document = read_json(profile_path)
    source_records = profile_document.setdefault("sourceRecords", {})
    source_records["closureManifest"] = (
        "authority:official-scene-closures.v2#" + row["logicalPath"]
    )
    source_records["authorityLogicalPath"] = row["logicalPath"]
    write_json(profile_path, profile_document)

    published = publisher.publish_stage(
        repo,
        repo / "public",
        identifier,
        product_root,
    )
    public_model = repo / "public/stages/official" / identifier / model_path.name
    with public_model.open("rb") as source:
        if source.read(2) != b"\x1f\x8b":
            raise ValueError(f"Published stage model is not gzip-compressed: {public_model}")
    profile = read_json(
        repo / "public/stages/official" / identifier / "scene-profile.json"
    )
    if profile.get("stageId") != identifier:
        raise ValueError(f"Published stage profile identity mismatch: {identifier}")

    record = {
        "schema": "magius.official-stage-build-record.v1",
        "stageId": identifier,
        "stableKey": row["logicalPath"],
        "family": row["family"],
        "fullyResolved": True,
        "closureFileCount": len(files),
        "sourceBytes": row["sourceBytes"],
        "publishedModel": str(public_model),
        "publishedProfile": str(
            repo / "public/stages/official" / identifier / "scene-profile.json"
        ),
        "profileCounts": {
            "lights": len((profile.get("renderProfile") or {}).get("lights") or []),
            "materialBindings": len(profile.get("materialBindings") or []),
            "particleSystems": len((profile.get("runtime") or {}).get("particleSystems") or []),
            "particlePresets": len((profile.get("runtime") or {}).get("particlePresets") or []),
        },
        "catalogEntry": published,
        "commands": commands,
    }
    write_json(records_root / f"{identifier}.json", record)
    if not keep_work:
        safe_clear(stage_work, work_root)
    return record


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    parser.add_argument("--assetstudio", type=Path, required=True)
    parser.add_argument("--work-root", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--stage-id", action="append", dest="stage_ids")
    parser.add_argument("--rebuild-existing", action="store_true")
    parser.add_argument("--keep-work", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo = args.repo_root.resolve()
    assetstudio = args.assetstudio.resolve()
    if not assetstudio.is_file():
        raise FileNotFoundError(assetstudio)
    work_root = args.work_root.resolve()
    work_root.mkdir(parents=True, exist_ok=True)
    inventory = read_json(
        repo
        / "artifacts/research/20260825-viewer-official-resource-gap-inventory"
        / "official-resource-gap-inventory.v1.json"
    )
    closure_index = read_json(
        repo
        / "artifacts/bulk-stage-expansion-20260817"
        / "steam-scene-dependency-closures.json"
    )
    source_root = Path(closure_index["sourceRoot"])
    extractor = repo / "tools/magius/extract_magius_scene_profile.py"
    records_root = (
        repo
        / "artifacts/delivery/20260826-scene-enemy-batch01"
        / "build-records/battle-direct"
    )
    publisher = load_publisher(repo)
    closures = {
        closure["logicalPath"]: closure for closure in closure_index["closures"]
    }
    current_shard_path = repo / "public/stages/catalogs/official-battle-direct.v1.json"
    current_ids = (
        {entry["id"] for entry in read_json(current_shard_path)["stages"]}
        if current_shard_path.is_file()
        else set()
    )
    rows = [
        row
        for row in inventory["sceneAudit"]["officialLocalUnlisted"]
        if row["family"] == "battle-direct"
        and row["closure"]["fullyResolved"]
        and (args.rebuild_existing or stage_id(row) not in current_ids)
        and (not args.stage_ids or stage_id(row) in set(args.stage_ids))
    ]
    if args.limit is not None:
        rows = rows[: args.limit]

    records = []
    for index, row in enumerate(rows, start=1):
        closure = closures.get(row["logicalPath"])
        if not closure or not closure["fullyResolved"]:
            raise ValueError(f"Missing exact closure: {row['logicalPath']}")
        print(f"[{index}/{len(rows)}] {stage_id(row)}", flush=True)
        records.append(
            build_one(
                repo=repo,
                source_root=source_root,
                assetstudio=assetstudio,
                extractor=extractor,
                work_root=work_root,
                records_root=records_root,
                unity_version=closure_index["unityVersion"],
                row=row,
                closure=closure,
                publisher=publisher,
                keep_work=args.keep_work,
            )
        )

    shard = read_json(current_shard_path)
    summary = {
        "requested": len(rows),
        "published": len(records),
        "stageIds": [record["stageId"] for record in records],
        "visibleBattleDirect": shard["counts"]["visible"],
        "targetBattleDirect": shard["counts"]["target"],
    }
    write_json(records_root.parent / "latest-battle-direct-summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
