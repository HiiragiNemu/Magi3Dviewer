#!/usr/bin/env python3
"""Generate scene profiles for catalog stages from the game's own bundle index.

This is the repeatable path for future scenes: catalog ``assetBundleName`` ->
AssetBundleManifest dependency closure -> serialized Light/Volume/Material/
lightmap/probe records -> package ``scene-profile.json``.  It does not enumerate
the AssetBundle store and it does not require a per-scene runtime capture.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any


def load_sibling(name: str):
    path = Path(__file__).with_name(name + ".py")
    spec = importlib.util.spec_from_file_location("magius_" + name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def package_location(entry: dict[str, Any], public_root: Path) -> tuple[Path, str]:
    url = str(entry.get("url", "")).split("?", 1)[0].split("#", 1)[0]
    relative = PurePosixPath(url.removeprefix("./"))
    if relative.is_absolute() or ".." in relative.parts or len(relative.parts) < 2:
        raise ValueError(f"Stage {entry.get('id')} has an invalid asset URL: {url!r}")
    package_relative = relative.parent
    package_dir = public_root.joinpath(*package_relative.parts)
    resolved_public = public_root.resolve()
    resolved_package = package_dir.resolve()
    if resolved_public not in resolved_package.parents:
        raise ValueError(f"Stage package escaped public root: {url!r}")
    return package_dir, "./" + package_relative.as_posix()


def catalog_stage_targets(
    catalog_path: Path,
    public_root: Path,
) -> tuple[dict[str, Any], list[tuple[dict[str, Any], Path, dict[str, Any]]]]:
    catalog = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
    if not isinstance(catalog, dict):
        raise ValueError("Catalog root must be an object")
    targets: list[tuple[dict[str, Any], Path, dict[str, Any]]] = []
    inline = catalog.get("stages", [])
    if not isinstance(inline, list):
        raise ValueError("Catalog stages must be an array")
    targets.extend(
        (entry, catalog_path, catalog)
        for entry in inline
        if isinstance(entry, dict)
    )
    for url in catalog.get("entries", []) or []:
        relative = PurePosixPath(str(url).split("?", 1)[0].removeprefix("./"))
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"Catalog entry escaped public root: {url!r}")
        entry_path = public_root.joinpath(*relative.parts)
        resolved_public = public_root.resolve()
        resolved_entry = entry_path.resolve()
        if resolved_public not in resolved_entry.parents:
            raise ValueError(f"Catalog entry escaped public root: {url!r}")
        document = json.loads(entry_path.read_text(encoding="utf-8-sig"))
        if isinstance(document, dict) and isinstance(document.get("id"), str):
            targets.append((document, entry_path, document))
        elif isinstance(document, dict) and isinstance(document.get("stages"), list):
            targets.extend(
                (entry, entry_path, document)
                for entry in document["stages"]
                if isinstance(entry, dict)
            )
        else:
            raise ValueError(f"Unsupported catalog entry document: {entry_path}")
    return catalog, targets


def sync_profiles(
    catalog_path: Path,
    manifest_dump: Path,
    asset_root: Path,
    manifest_root: Path,
    public_root: Path,
    include: re.Pattern[str] | None,
    unity_version: str,
    write: bool,
) -> dict[str, Any]:
    resolver = load_sibling("resolve_magius_scene_closure")
    extractor = load_sibling("extract_magius_scene_profile")
    catalog, stage_targets = catalog_stage_targets(catalog_path, public_root)

    parsed_manifest = resolver.parse_manifest_dump(manifest_dump)
    generated: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    modified_documents: dict[Path, dict[str, Any]] = {}
    for entry, owner_path, owner_document in stage_targets:
        stage_id = str(entry.get("id", ""))
        bundle = str(entry.get("assetBundleName", ""))
        searchable = stage_id + "\n" + bundle
        if include and not include.search(searchable):
            continue
        if not bundle:
            skipped.append({"stageId": stage_id, "reason": "missing assetBundleName"})
            continue

        closure = resolver.build_reference_manifest(
            bundle,
            manifest_dump,
            asset_root,
            unity_version,
            parsed_manifest,
        )
        closure_path = manifest_root / (stage_id + "-closure.json")
        package_dir, asset_prefix = package_location(entry, public_root)
        profile_path = package_dir / "scene-profile.json"
        if write:
            closure_path.parent.mkdir(parents=True, exist_ok=True)
            closure_path.write_text(
                json.dumps(closure, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            package_dir.mkdir(parents=True, exist_ok=True)
        else:
            # The extractor intentionally consumes a concrete manifest path.
            # A check run keeps that evidence under the caller-selected root.
            closure_path.parent.mkdir(parents=True, exist_ok=True)
            closure_path.write_text(
                json.dumps(closure, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

        profile = extractor.build_scene_profile(
            closure_path,
            stage_id,
            asset_prefix,
            package_dir,
            write,
            str(entry.get("url", "")),
        )
        if write:
            profile_path.write_text(
                json.dumps(profile, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            entry["sceneProfileUrl"] = asset_prefix + "/scene-profile.json"
            modified_documents[owner_path] = owner_document

        source = profile["sourceRecords"]
        generated.append(
            {
                "stageId": stage_id,
                "assetBundleName": bundle,
                "closureFileCount": closure["fileCount"],
                "closureBytes": closure["totalBytes"],
                "lightCount": len(profile["renderProfile"].get("lights", [])),
                "materialCount": len(profile.get("materialBindings", [])),
                "volumeClasses": sorted(source["volumeComponents"]),
                "lightmapRecordCount": len(source["prefabLightmapData"]),
                "reflectionProbeCount": len(source["reflectionProbes"]),
                "lightmapBindingCount": source["lightmapAutomation"][
                    "bindingRendererCount"
                ],
                "uv1GeneratedNodeCount": source["lightmapAutomation"][
                    "generatedUv1NodeCount"
                ],
                "closureManifest": str(closure_path.resolve()),
                "profile": str(profile_path.resolve()),
            }
        )

    if write:
        for path, document in modified_documents.items():
            path.write_text(
                json.dumps(document, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
    return {
        "schemaVersion": 1,
        "mode": "write" if write else "check",
        "catalog": str(catalog_path.resolve()),
        "manifestDump": str(manifest_dump.resolve()),
        "assetRoot": str(asset_root.resolve()),
        "selectedCount": len(generated),
        "generated": generated,
        "skipped": skipped,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchronize Magius scene profiles from AssetBundleManifest data",
    )
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--manifest-dump", type=Path, required=True)
    parser.add_argument("--asset-root", type=Path, required=True)
    parser.add_argument("--manifest-root", type=Path, required=True)
    parser.add_argument("--public-root", type=Path)
    parser.add_argument("--include", help="Optional regex for stage ID or bundle name")
    parser.add_argument("--unity-version", default="2022.3.62f2")
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write profiles and update catalog; otherwise perform an evidence check",
    )
    parser.add_argument("--report", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    public_root = args.public_root or args.catalog.resolve().parent.parent
    include = re.compile(args.include, re.IGNORECASE) if args.include else None
    result = sync_profiles(
        args.catalog,
        args.manifest_dump,
        args.asset_root,
        args.manifest_root,
        public_root,
        include,
        args.unity_version,
        args.write,
    )
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
