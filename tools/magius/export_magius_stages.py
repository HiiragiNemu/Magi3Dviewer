#!/usr/bin/env python3
"""Export Magia Exedra 3D stage bundles for Magius3Dviewer.

This tool is deliberately local/private. It reads already-downloaded game bundles,
uses AssetStudioModCLI splitObjects mode, optionally converts FBX to self-contained
GLB files with FBX2glTF, and writes a Magius3Dviewer stage catalog.

It never uploads assets by itself.
"""

from __future__ import annotations

import argparse
import gzip
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

UNITY_VERSION = "2022.3.62f2"
DEFAULT_STAGE_ROOTS = (
    "battle/stage",
    "dungeon/bg",
    "dungeon/level",
    "field/bg",
    "gallery/bg3d_gallery",
)
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".tga", ".bmp"}


@dataclass(frozen=True)
class ExportedStage:
    source_root: str
    source_fbx: Path
    stage_id: str
    name: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export web-ready 3D stages and catalog for Magius3Dviewer"
    )
    parser.add_argument(
        "--gamedata",
        type=Path,
        default=Path("gamedata"),
        help="ma-ex-dataSP gamedata directory",
    )
    parser.add_argument(
        "--assetstudio",
        type=Path,
        default=Path("AssetStudioModCLI/AssetStudioModCLI"),
        help="AssetStudioModCLI executable",
    )
    parser.add_argument(
        "--unity-version",
        default=UNITY_VERSION,
        help="Source Unity version (JP default: 2022.3.62f2; current TW: 2022.3.62f3)",
    )
    parser.add_argument(
        "--fbx2gltf",
        type=Path,
        default=None,
        help="Optional FBX2glTF executable; GLB is preferred when available",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("research/magius_stage_export"),
        help="Output directory",
    )
    parser.add_argument(
        "--include",
        default=None,
        help="Optional case-insensitive regex applied to exported FBX paths",
    )
    parser.add_argument(
        "--max-stages",
        type=int,
        default=0,
        help="Maximum number of stages; 0 means unlimited",
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=1.0,
        help="Default scale written to catalog entries",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Delete previous extraction/output directories first",
    )
    parser.add_argument(
        "--scene-profile-manifest",
        action="append",
        default=[],
        metavar="STAGE_ID=PATH",
        help=(
            "Generate and attach a bundle-derived scene-profile.json for the "
            "named exported stage; repeat for multiple bounded closures"
        ),
    )
    return parser.parse_args()


def run(command: list[str | Path]) -> None:
    printable = " ".join(str(item) for item in command)
    print(f"+ {printable}", flush=True)
    subprocess.run([str(item) for item in command], check=True)


def safe_id(value: str) -> str:
    value = value.lower().replace("\\", "/")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "stage"


def unique_id(base: str, used: set[str]) -> str:
    candidate = base
    index = 2
    while candidate in used:
        candidate = f"{base}-{index}"
        index += 1
    used.add(candidate)
    return candidate


def parse_scene_profile_spec(value: str) -> tuple[str, Path]:
    stage_id, separator, path = value.partition("=")
    if not separator or not stage_id.strip() or not path.strip():
        raise ValueError(
            f"Invalid --scene-profile-manifest {value!r}; expected STAGE_ID=PATH"
        )
    return stage_id.strip(), Path(path.strip())


def load_scene_profile_module():
    path = Path(__file__).with_name("extract_magius_scene_profile.py")
    spec = importlib.util.spec_from_file_location("magius_scene_profile", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load scene profile extractor: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def find_source_roots(asset_bundle_root: Path) -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    for relative in DEFAULT_STAGE_ROOTS:
        path = asset_bundle_root / relative
        if path.exists():
            found.append((relative, path))
        else:
            print(f"Skipping missing source: {path}")
    return found


def extract_stage_root(
    assetstudio: Path,
    relative: str,
    source: Path,
    extraction_root: Path,
    unity_version: str,
) -> Path:
    destination = extraction_root / safe_id(relative)
    destination.mkdir(parents=True, exist_ok=True)
    run(
        [
            assetstudio,
            source,
            "-m",
            "splitObjects",
            "-o",
            destination,
            "--unity-version",
            unity_version,
            "--log-level",
            "warning",
        ]
    )
    return destination


def discover_stages(
    extraction_root: Path,
    include_pattern: re.Pattern[str] | None,
    maximum: int,
) -> list[ExportedStage]:
    used_ids: set[str] = set()
    discovered: list[ExportedStage] = []
    for fbx in sorted(extraction_root.rglob("*.fbx")):
        relative = fbx.relative_to(extraction_root)
        relative_text = relative.as_posix()
        if include_pattern and not include_pattern.search(relative_text):
            continue

        parts = relative.parts
        source_root = parts[0] if parts else "stage"
        stage_id = unique_id(safe_id(relative.with_suffix("").as_posix()), used_ids)
        name = relative.stem.replace("_", " ").replace("-", " ").strip()
        discovered.append(
            ExportedStage(
                source_root=source_root,
                source_fbx=fbx,
                stage_id=stage_id,
                name=name or stage_id,
            )
        )
        if maximum > 0 and len(discovered) >= maximum:
            break
    return discovered


def copy_related_textures(source_fbx: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for path in source_fbx.parent.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        target = destination / path.relative_to(source_fbx.parent)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)


def gzip_fbx(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with source.open("rb") as input_handle, gzip.open(
        destination, "wb", compresslevel=9
    ) as output_handle:
        shutil.copyfileobj(input_handle, output_handle)


def convert_with_fbx2gltf(executable: Path, source: Path, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    output_without_suffix = destination.with_suffix("")
    run(
        [
            executable,
            "--binary",
            "--input",
            source,
            "--output",
            output_without_suffix,
        ]
    )

    candidates = (
        destination,
        output_without_suffix.with_suffix(".glb"),
        Path(str(output_without_suffix) + ".glb"),
    )
    for candidate in candidates:
        if candidate.exists():
            if candidate != destination:
                candidate.replace(destination)
            return destination
    raise FileNotFoundError(f"FBX2glTF did not create {destination}")


def write_stage_package(
    stage: ExportedStage,
    public_root: Path,
    fbx2gltf: Path | None,
    scale: float,
) -> dict[str, object]:
    package_dir = public_root / stage.stage_id
    package_dir.mkdir(parents=True, exist_ok=True)

    if fbx2gltf and fbx2gltf.exists():
        model_path = convert_with_fbx2gltf(
            fbx2gltf,
            stage.source_fbx,
            package_dir / "stage.glb",
        )
        stage_type = "gltf"
    else:
        model_path = package_dir / "stage.fbx.gz"
        gzip_fbx(stage.source_fbx, model_path)
        copy_related_textures(stage.source_fbx, package_dir)
        stage_type = "fbx"

    return {
        "id": stage.stage_id,
        "name": stage.name,
        "type": stage_type,
        "url": f"./stages/{stage.stage_id}/{model_path.name}",
        "scale": scale,
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "credit": f"Extracted from {stage.source_root}",
    }


def main() -> int:
    args = parse_args()
    asset_bundle_root = args.gamedata / "AssetBundles"
    if not asset_bundle_root.exists():
        raise FileNotFoundError(
            f"AssetBundles directory not found: {asset_bundle_root}. "
            "Run the ma-ex-dataSP downloader first."
        )
    if not args.assetstudio.exists():
        raise FileNotFoundError(f"AssetStudioModCLI not found: {args.assetstudio}")

    extraction_root = args.out / "assetstudio"
    public_root = args.out / "public" / "stages"
    if args.clean:
        shutil.rmtree(args.out, ignore_errors=True)
    extraction_root.mkdir(parents=True, exist_ok=True)
    public_root.mkdir(parents=True, exist_ok=True)

    roots = find_source_roots(asset_bundle_root)
    if not roots:
        raise FileNotFoundError("No known 3D stage bundle directories were found")

    for relative, source in roots:
        extract_stage_root(
            args.assetstudio,
            relative,
            source,
            extraction_root,
            args.unity_version,
        )

    include_pattern = re.compile(args.include, re.IGNORECASE) if args.include else None
    stages = discover_stages(extraction_root, include_pattern, args.max_stages)
    if not stages:
        raise RuntimeError("AssetStudio exported no FBX stage objects")

    catalog_entries = [
        write_stage_package(stage, public_root, args.fbx2gltf, args.scale)
        for stage in stages
    ]
    if args.scene_profile_manifest:
        scene_profiles = load_scene_profile_module()
        entry_by_id = {str(entry["id"]): entry for entry in catalog_entries}
        for specification in args.scene_profile_manifest:
            stage_id, manifest_path = parse_scene_profile_spec(specification)
            entry = entry_by_id.get(stage_id)
            if entry is None:
                raise KeyError(
                    f"Scene profile stage {stage_id!r} was not exported in this run"
                )
            package_dir = public_root / stage_id
            profile = scene_profiles.build_scene_profile(
                manifest_path,
                stage_id,
                f"./stages/{stage_id}",
                package_dir,
            )
            profile_path = package_dir / "scene-profile.json"
            profile_path.write_text(
                json.dumps(profile, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            entry["sceneProfileUrl"] = f"./stages/{stage_id}/scene-profile.json"
    catalog = {"version": 1, "stages": catalog_entries}
    catalog_path = public_root / "catalog.json"
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    report = {
        "source_roots": [relative for relative, _ in roots],
        "stage_count": len(catalog_entries),
        "catalog": str(catalog_path),
        "unity_version": args.unity_version,
        "used_fbx2gltf": bool(args.fbx2gltf and args.fbx2gltf.exists()),
        "scene_profile_count": len(args.scene_profile_manifest),
    }
    (args.out / "export_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
