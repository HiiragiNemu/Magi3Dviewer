#!/usr/bin/env python3
"""Resolve one or more exact AssetBundle dependency closures without scanning payloads.

The AssetBundleManifest is the game's authoritative bundle-name/dependency index.
This tool parses that index once, follows only the requested target's dependency
keys, and writes a reference manifest.  Payloads stay in their existing read-only
store; the downstream scene-profile extractor reads the listed files directly.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path, PurePosixPath
from typing import Any


FIRST_RE = re.compile(r"^\s*int first = (\d+)\s*$")
NAME_RE = re.compile(r'^\s*string second = "(.*)"\s*$')
HASH_RE = re.compile(r"^\s*UInt8 bytes\[(\d+)\] = (\d+)\s*$")
DEP_RE = re.compile(r"^\s*int data = (\d+)\s*$")


def parse_manifest_dump(path: Path) -> tuple[dict[int, str], dict[int, dict[str, Any]]]:
    """Parse AssetStudio's AssetBundleManifest typetree dump in one bounded pass."""

    names: dict[int, str] = {}
    infos: dict[int, dict[str, Any]] = {}
    phase = "names"
    pending_name_key: int | None = None
    current_info_key: int | None = None
    current_hash: list[int] = []
    current_dependencies: list[int] = []

    def finish_info() -> None:
        nonlocal current_info_key, current_hash, current_dependencies
        if current_info_key is not None:
            infos[current_info_key] = {
                "manifestHash128": bytes(current_hash).hex()
                if len(current_hash) == 16
                else None,
                "dependencies": list(current_dependencies),
            }
        current_info_key = None
        current_hash = []
        current_dependencies = []

    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if phase == "names" and line.strip() == "map AssetBundleInfos":
                phase = "infos"
                pending_name_key = None
                continue

            first = FIRST_RE.match(line)
            if first:
                key = int(first.group(1))
                if phase == "names":
                    pending_name_key = key
                else:
                    finish_info()
                    current_info_key = key
                continue

            if phase == "names":
                name = NAME_RE.match(line)
                if name and pending_name_key is not None:
                    names[pending_name_key] = name.group(1)
                    pending_name_key = None
                continue

            manifest_hash = HASH_RE.match(line)
            if manifest_hash and current_info_key is not None:
                index = int(manifest_hash.group(1))
                if index == len(current_hash):
                    current_hash.append(int(manifest_hash.group(2)))
                continue

            dependency = DEP_RE.match(line)
            if dependency and current_info_key is not None:
                current_dependencies.append(int(dependency.group(1)))

    finish_info()
    return names, infos


def resolve_closure_keys(
    target: str,
    names: dict[int, str],
    infos: dict[int, dict[str, Any]],
) -> list[int]:
    inverse_names = {name: key for key, name in names.items()}
    target_key = inverse_names.get(target)
    if target_key is None:
        raise KeyError(f"Target is absent from AssetBundleManifest: {target}")

    visited: set[int] = set()
    stack = [target_key]
    while stack:
        key = stack.pop()
        if key in visited:
            continue
        if key not in names or key not in infos:
            raise KeyError(f"Unresolved AssetBundleManifest key {key} for {target}")
        visited.add(key)
        stack.extend(int(value) for value in infos[key]["dependencies"])
    return [target_key, *sorted(visited - {target_key})]


def source_path(asset_root: Path, bundle_name: str) -> Path:
    relative = PurePosixPath(bundle_name)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"Invalid AssetBundle name: {bundle_name!r}")
    root = asset_root.resolve()
    path = root.joinpath(*relative.parts).resolve()
    if path != root and root not in path.parents:
        raise ValueError(f"AssetBundle escaped source root: {bundle_name!r}")
    return path


def build_reference_manifest(
    target: str,
    manifest_dump: Path,
    asset_root: Path,
    unity_version: str,
    parsed: tuple[dict[int, str], dict[int, dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    names, infos = parsed or parse_manifest_dump(manifest_dump)
    keys = resolve_closure_keys(target, names, infos)
    files: list[dict[str, Any]] = []
    for key in keys:
        name = names[key]
        path = source_path(asset_root, name)
        if not path.is_file():
            raise FileNotFoundError(f"Missing AssetBundle payload: {path}")
        files.append(
            {
                "manifestKey": key,
                "name": name,
                "role": "main" if name == target else "dependency",
                "bytes": path.stat().st_size,
                "manifestHash128": infos[key]["manifestHash128"],
                "directDependencyKeys": infos[key]["dependencies"],
                "source": str(path),
            }
        )
    return {
        "schemaVersion": 1,
        "mode": "read-only-source-reference",
        "scene": target,
        "unityVersion": unity_version,
        "sourceManifestDump": str(manifest_dump.resolve()),
        "sourceManifestDumpBytes": manifest_dump.stat().st_size,
        "assetRoot": str(asset_root.resolve()),
        "targetManifestKey": keys[0],
        "fileCount": len(files),
        "totalBytes": sum(int(item["bytes"]) for item in files),
        "files": files,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Resolve a bounded Magia Exedra AssetBundle dependency closure",
    )
    parser.add_argument("target", help="Exact AssetBundleManifest bundle name")
    parser.add_argument("--manifest-dump", type=Path, required=True)
    parser.add_argument("--asset-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--unity-version", default="2022.3.62f2")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = build_reference_manifest(
        args.target,
        args.manifest_dump,
        args.asset_root,
        args.unity_version,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "target": result["scene"],
                "fileCount": result["fileCount"],
                "totalBytes": result["totalBytes"],
                "mode": result["mode"],
                "output": str(args.output.resolve()),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
