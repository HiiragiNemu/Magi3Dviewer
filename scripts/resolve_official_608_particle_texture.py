#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"

import extract_official_100101_material_properties as base

ROOT_MANIFEST_BUNDLE = "android"
TARGET_STAGE_BUNDLE = "battle/stage/bg_3d_608_00_00_001"
TARGET_CAB = "cab-45fe6895e0364350e5df2d082222970e"
TARGET_TEXTURE_PATH_ID = -70738714532392232
OUTPUT_JSON = Path("research/official-608-particle-texture.json")
OUTPUT_PNG = Path("research/official-608-blue-bubble.png")
EXPECTED_STAGE_BUNDLE_COUNT = 15


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def normalize_name(value: Any) -> str:
    return str(value).replace("\\", "/").strip("/")


def pair_list(value: Any) -> list[tuple[int, Any]]:
    if isinstance(value, dict):
        return sorted((int(key), item) for key, item in value.items())
    if not isinstance(value, list):
        raise TypeError(f"Expected list/dict map, got {type(value).__name__}")
    result: list[tuple[int, Any]] = []
    for item in value:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            key, child = item
        elif isinstance(item, dict) and "first" in item and "second" in item:
            key, child = item["first"], item["second"]
        elif isinstance(item, dict) and "key" in item and "value" in item:
            key, child = item["key"], item["value"]
        else:
            raise TypeError(f"Unrecognized map entry: {type(item).__name__}")
        result.append((int(key), child))
    return sorted(result)


def child_value(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def read_manifest_graph(path: Path) -> tuple[dict[str, list[str]], dict[str, Any]]:
    env = UnityPy.load(str(path))
    candidates: list[dict[str, Any]] = []
    inventory: list[dict[str, Any]] = []
    for obj in env.objects:
        type_name = str(getattr(getattr(obj, "type", None), "name", ""))
        inventory.append({"pathId": int(getattr(obj, "path_id", 0) or 0), "type": type_name})
        if type_name == "AssetBundleManifest":
            tree = obj.read_typetree()
            if not isinstance(tree, dict):
                raise TypeError("AssetBundleManifest typetree is not a dictionary")
            candidates.append(tree)
    if len(candidates) != 1:
        raise RuntimeError(f"Expected exactly one AssetBundleManifest, found {len(candidates)}")
    tree = candidates[0]
    names = {index: normalize_name(name) for index, name in pair_list(tree.get("AssetBundleNames", []))}
    infos = dict(pair_list(tree.get("AssetBundleInfos", [])))
    if not names or set(names) != set(infos):
        raise RuntimeError("AssetBundleManifest names/info index mismatch")
    graph: dict[str, list[str]] = {}
    for index, name in names.items():
        info = infos[index]
        dependency_indices = [int(value) for value in (child_value(info, "AssetBundleDependencies", []) or [])]
        unknown = [value for value in dependency_indices if value not in names]
        if unknown:
            raise RuntimeError(f"{name}: unknown dependency indices {unknown}")
        graph[name] = [names[value] for value in dependency_indices]
    return graph, {
        "objectInventory": sorted(inventory, key=lambda item: (item["type"], item["pathId"])),
        "bundleCount": len(graph),
        "dependencyEdgeCount": sum(len(value) for value in graph.values()),
    }


def canonical_name(graph: dict[str, list[str]], requested: str) -> str:
    normalized = normalize_name(requested)
    if normalized in graph:
        return normalized
    folded = {name.lower(): name for name in graph}
    value = folded.get(normalized.lower())
    if value is None:
        raise KeyError(f"Bundle not present in current JP root manifest: {requested}")
    return value


def dependency_order(graph: dict[str, list[str]], requested: str) -> list[str]:
    root = canonical_name(graph, requested)
    visited: set[str] = set()
    active: list[str] = []
    ordered: list[str] = []

    def visit(name: str) -> None:
        if name in visited:
            return
        if name in active:
            cycle = " -> ".join(active[active.index(name):] + [name])
            raise RuntimeError(f"AssetBundle dependency cycle: {cycle}")
        active.append(name)
        for dependency in graph.get(name, []):
            visit(dependency)
        active.pop()
        visited.add(name)
        ordered.append(name)

    visit(root)
    return ordered


def internal_file_name(obj: Any) -> str:
    value = str(getattr(getattr(obj, "assets_file", None), "name", ""))
    return value.replace("\\", "/").rsplit("/", 1)[-1].lower()


def main() -> int:
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="magius-608-particle-texture-") as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        by_name = {normalize_name(entry.full_path).lower(): entry for entry in entries}

        manifest_entry = by_name.get(ROOT_MANIFEST_BUNDLE)
        if manifest_entry is None:
            candidates = sorted(
                entry.full_path for entry in entries
                if normalize_name(entry.full_path).lower().endswith("android")
            )
            raise RuntimeError(f"Current JP catalog has no root Android manifest entry; candidates={candidates[:20]}")
        manifest_path = base.download(manifest_entry, request_headers, token, temp)
        manifest_bytes = manifest_path.read_bytes()
        graph, manifest_summary = read_manifest_graph(manifest_path)
        order = dependency_order(graph, TARGET_STAGE_BUNDLE)
        if len(order) != EXPECTED_STAGE_BUNDLE_COUNT:
            raise RuntimeError(
                f"Current JP stage closure changed: expected {EXPECTED_STAGE_BUNDLE_COUNT} bundles, got {len(order)}"
            )

        closure_entries = []
        missing = []
        for bundle_name in order:
            entry = by_name.get(normalize_name(bundle_name).lower())
            if entry is None:
                missing.append(bundle_name)
            else:
                closure_entries.append(entry)
        if missing:
            raise RuntimeError(f"Manifest closure has {len(missing)} entries absent from catalog: {missing}")

        paths: list[tuple[Any, Path]] = []
        for entry in closure_entries:
            paths.append((entry, base.download(entry, request_headers, token, temp)))

        cab_sources: dict[str, str] = {}
        matches: list[tuple[Any, Any, Any, Path]] = []
        per_bundle: list[dict[str, Any]] = []
        for entry, path in paths:
            env = UnityPy.load(str(path))
            internal_names = sorted({
                str(name).replace("\\", "/").rsplit("/", 1)[-1]
                for name in getattr(env, "files", {}).keys()
            })
            for name in internal_names:
                cab_sources.setdefault(name.lower(), entry.full_path)
            object_count = 0
            for obj in env.objects:
                object_count += 1
                cab_name = internal_file_name(obj)
                if cab_name:
                    cab_sources.setdefault(cab_name, entry.full_path)
                if cab_name != TARGET_CAB:
                    continue
                if int(getattr(obj, "path_id", 0) or 0) != TARGET_TEXTURE_PATH_ID:
                    continue
                type_name = str(getattr(getattr(obj, "type", None), "name", ""))
                if type_name != "Texture2D":
                    raise RuntimeError(
                        f"Target CAB/pathID resolved to {type_name}, expected Texture2D"
                    )
                matches.append((entry, obj, env, path))
            per_bundle.append({
                "bundle": entry.full_path,
                "size": path.stat().st_size,
                "internalSerializedFiles": internal_names,
                "objectCount": object_count,
            })

        if len(matches) != 1:
            raise RuntimeError(
                f"Expected exactly one {TARGET_CAB}/{TARGET_TEXTURE_PATH_ID} Texture2D, found {len(matches)}; "
                f"CAB source={cab_sources.get(TARGET_CAB)}"
            )

        source_entry, obj, _env, source_path = matches[0]
        tree = obj.read_typetree()
        if not isinstance(tree, dict):
            raise TypeError("Target Texture2D typetree is not a dictionary")
        texture = obj.read()
        image = texture.image
        if image is None:
            raise RuntimeError("Target Texture2D decoded without a PIL image")
        rgba = image.convert("RGBA")
        pixel_bytes = rgba.tobytes()
        rgba.save(OUTPUT_PNG, format="PNG", optimize=False)
        png_bytes = OUTPUT_PNG.read_bytes()

        report = {
            "schemaVersion": 1,
            "source": "official-jp-current-root-manifest-and-assetbundle-closure",
            "metadata": metadata,
            "rootManifest": {
                "catalogPath": manifest_entry.full_path,
                "decryptedSize": len(manifest_bytes),
                "decryptedSha256": sha256_bytes(manifest_bytes),
                **manifest_summary,
            },
            "stage": {
                "rootBundle": canonical_name(graph, TARGET_STAGE_BUNDLE),
                "bundleCountIncludingRoot": len(order),
                "dependencyCount": len(order) - 1,
                "dependencyOrder": order,
                "totalDecryptedBytes": sum(path.stat().st_size for _, path in paths),
            },
            "targetPointer": {
                "externalFileId": 6,
                "serializedFile": TARGET_CAB,
                "pathId": TARGET_TEXTURE_PATH_ID,
            },
            "resolvedTexture": {
                "sourceBundle": source_entry.full_path,
                "sourceBundleSize": source_path.stat().st_size,
                "name": str(tree.get("m_Name", "")),
                "width": tree.get("m_Width"),
                "height": tree.get("m_Height"),
                "textureFormat": tree.get("m_TextureFormat"),
                "mipCount": tree.get("m_MipCount"),
                "imageCount": tree.get("m_ImageCount"),
                "dimension": tree.get("m_TextureDimension"),
                "colorSpace": tree.get("m_ColorSpace"),
                "decodedMode": rgba.mode,
                "decodedSize": list(rgba.size),
                "pixelSha256": sha256_bytes(pixel_bytes),
                "pngSha256": sha256_bytes(png_bytes),
                "pngBytes": len(png_bytes),
                "output": OUTPUT_PNG.as_posix(),
            },
            "closureBundleInventory": per_bundle,
        }
        OUTPUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "stageBundleCount": report["stage"]["bundleCountIncludingRoot"],
        "targetPointer": report["targetPointer"],
        "resolvedTexture": report["resolvedTexture"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
