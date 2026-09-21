#!/usr/bin/env python3
"""Publish a bounded visual-product index for the existing official scenes.

The input set is deliberately limited to the already-published Viewer catalog,
scene products, and scene profiles.  It does not enumerate the source-game
inventory.  Missing shader names are resolved only when the same serialized
Shader pathID has one unique, already-resolved CAB/name pair elsewhere in the
published profile corpus.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


SCHEMA = "magius.scene-visual-products.v1"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def url_for(relative_path: Path) -> str:
    return "./" + relative_path.as_posix()


def source_materials(profile: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for material in profile.get("sourceRecords", {}).get("materials", []):
        result[str(material.get("name") or "")].append(material)
    return result


def shader_pointer(material: dict[str, Any] | None) -> tuple[str, str, int]:
    shader = (material or {}).get("shader") or {}
    path_id = str(shader.get("pathID") or "")
    cab = str(shader.get("cab") or "")
    file_id = int(shader.get("fileID") or 0)
    return path_id, cab, file_id


def exact_source_material(
    candidates: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not candidates:
        return None
    identities = {
        shader_pointer(candidate)
        for candidate in candidates
    }
    if len(identities) != 1:
        raise ValueError(f"ambiguous source material shader identities: {identities}")
    return candidates[0]


def profile_counts(profile: dict[str, Any]) -> dict[str, int]:
    bindings = profile.get("materialBindings", [])
    source_records = profile.get("sourceRecords", {})
    return {
        "materialBindings": len(bindings),
        "alphaTestBindings": sum(
            1 for binding in bindings if binding.get("alphaTest") is not None
        ),
        "transparentBindings": sum(
            1 for binding in bindings if binding.get("transparent") is True
        ),
        "particleSystems": len(source_records.get("particleSystems", [])),
        "particlePresets": len(source_records.get("particlePresets", [])),
        "lights": len(source_records.get("lights", [])),
        "reflectionProbes": len(source_records.get("reflectionProbes", [])),
    }


def build(repository: Path, output: Path) -> dict[str, Any]:
    public = repository / "public"
    official = public / "stages" / "official"
    catalog_path = public / "catalogs" / "official-resources.v1.json"
    catalog = read_json(catalog_path)
    scenes = catalog.get("scenes", [])
    if len(scenes) != 581:
        raise ValueError(f"expected 581 catalog scenes, found {len(scenes)}")

    profile_paths = sorted(official.glob("*/scene-profile.json"))
    product_paths = sorted(official.glob("*/scene-product.json"))
    if len(profile_paths) != 399:
        raise ValueError(f"expected 399 published scene profiles, found {len(profile_paths)}")
    if len(product_paths) != 191:
        raise ValueError(f"expected 191 published image/marker products, found {len(product_paths)}")

    profiles: dict[str, tuple[Path, dict[str, Any]]] = {}
    shader_authority: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for path in profile_paths:
        profile = read_json(path)
        stage_id = str(profile.get("stageId") or path.parent.name)
        if stage_id in profiles:
            raise ValueError(f"duplicate scene profile stageId: {stage_id}")
        profiles[stage_id] = (path, profile)
        for materials in source_materials(profile).values():
            for material in materials:
                shader = material.get("shader") or {}
                path_id = str(shader.get("pathID") or "")
                cab = str(shader.get("cab") or "")
                name = str(shader.get("name") or "")
                if shader.get("resolved") and path_id and cab and name:
                    shader_authority[path_id].add((cab, name))

    unique_shader_authority: dict[str, tuple[str, str]] = {}
    for path_id, identities in shader_authority.items():
        if len(identities) == 1:
            unique_shader_authority[path_id] = next(iter(identities))

    resolution_counts: Counter[str] = Counter()
    resolution_records: list[dict[str, Any]] = []
    modified_profiles: list[str] = []
    for stage_id, (path, profile) in profiles.items():
        changed = False
        materials = source_materials(profile)
        for index, binding in enumerate(profile.get("materialBindings", [])):
            material_name = str(binding.get("materialName") or "")
            if binding.get("sourceShader"):
                resolution = binding.get("sourceShaderResolution") or {}
                if resolution.get("authority") == "published-profile-exact-pathid":
                    status = "cross-profile-exact-pathid"
                    resolution_counts[status] += 1
                    resolution_records.append(
                        {
                            "stageId": stage_id,
                            "bindingIndex": index,
                            "materialName": material_name,
                            "sourceFileID": resolution.get("sourceFileID"),
                            "sourcePathID": resolution.get("sourcePathID"),
                            "sourceCab": None,
                            "sourceShader": binding.get("sourceShader"),
                            "sourceShaderStableKey": binding.get(
                                "sourceShaderStableKey"
                            ),
                            "status": status,
                        }
                    )
                else:
                    resolution_counts["serialized-name"] += 1
                continue
            source = exact_source_material(materials.get(material_name, []))
            path_id, cab, file_id = shader_pointer(source)
            authority = unique_shader_authority.get(path_id)
            if authority:
                authority_cab, shader_name = authority
                stable_key = f"unity-shader:cab={authority_cab}|pathID={path_id}"
                binding["sourceShader"] = shader_name
                binding["sourceShaderStableKey"] = stable_key
                binding["sourceShaderResolution"] = {
                    "status": "resolved",
                    "authority": "published-profile-exact-pathid",
                    "sourceFileID": file_id,
                    "sourcePathID": path_id,
                    "resolvedCab": authority_cab,
                }
                status = "cross-profile-exact-pathid"
                changed = True
            elif path_id == "10753" and file_id != 0:
                stable_key = f"unity-builtin-resource:fileID={file_id}|pathID={path_id}"
                binding["sourceShaderStableKey"] = stable_key
                binding["sourceShaderResolution"] = {
                    "status": "builtin-source-key-only",
                    "authority": "serialized-unity-builtin-pointer",
                    "sourceFileID": file_id,
                    "sourcePathID": path_id,
                    "reason": "builtin shader name is absent from player serialization",
                }
                status = "builtin-source-key-only"
                changed = True
            else:
                stable_key = f"unity-null-shader:fileID={file_id}|pathID={path_id or 'missing'}"
                binding["sourceShaderStableKey"] = stable_key
                binding["sourceShaderResolution"] = {
                    "status": "fail-closed",
                    "authority": "serialized-shader-pointer",
                    "sourceFileID": file_id,
                    "sourcePathID": path_id or None,
                    "reason": (
                        "serialized shader pointer is null"
                        if file_id == 0 and path_id in ("", "0")
                        else "serialized shader pointer has no exact published authority"
                    ),
                }
                status = "fail-closed"
                changed = True
            resolution_counts[status] += 1
            resolution_records.append(
                {
                    "stageId": stage_id,
                    "bindingIndex": index,
                    "materialName": material_name,
                    "sourceFileID": file_id,
                    "sourcePathID": path_id or None,
                    "sourceCab": cab or None,
                    "sourceShader": binding.get("sourceShader") or None,
                    "sourceShaderStableKey": stable_key,
                    "status": status,
                }
            )
        if changed:
            write_json(path, profile)
            modified_profiles.append(stage_id)

    # Re-read the modified products so counts and entries describe published bytes.
    profiles = {
        path.parent.name: (path, read_json(path))
        for path in profile_paths
    }
    products = {
        path.parent.name: (path, read_json(path))
        for path in product_paths
    }

    catalog_ids = {str(scene["id"]) for scene in scenes}
    entries: list[dict[str, Any]] = []
    mode_counts: Counter[str] = Counter()
    aggregate_profile_counts: Counter[str] = Counter()
    for scene in scenes:
        stage_id = str(scene["id"])
        stable_key = str(scene["stableKey"])
        if scene.get("sceneProfileUrl"):
            if stage_id not in profiles:
                raise ValueError(f"catalog profile missing: {stage_id}")
            path, profile = profiles[stage_id]
            counts = profile_counts(profile)
            aggregate_profile_counts.update(counts)
            mode = "serialized-scene-profile"
            entry = {
                "stageId": stage_id,
                "stableKey": stable_key,
                "family": scene.get("family"),
                "visualProductMode": mode,
                "runtimeUrl": scene.get("url"),
                "sceneProfileUrl": scene.get("sceneProfileUrl"),
                "productUrl": None,
                "runtimeReady": True,
                "profileCounts": counts,
            }
        else:
            if stage_id not in products:
                raise ValueError(f"catalog image/marker product missing: {stage_id}")
            path, product = products[stage_id]
            if product.get("stableKey") != stable_key:
                raise ValueError(f"stable key mismatch for {stage_id}")
            presentation = product.get("presentationMode")
            if presentation == "official-image-plane":
                mode = "official-image-plane"
            elif presentation == "exact-empty-root-marker" and product.get("syntheticMarker"):
                mode = "exact-empty-root-marker"
            else:
                raise ValueError(f"unsupported scene product mode for {stage_id}: {presentation}")
            entry = {
                "stageId": stage_id,
                "stableKey": stable_key,
                "family": scene.get("family"),
                "visualProductMode": mode,
                "runtimeUrl": scene.get("url"),
                "sceneProfileUrl": None,
                "productUrl": url_for(path.relative_to(public)),
                "runtimeReady": True,
                "imageCount": len(product.get("images", [])),
            }
        mode_counts[mode] += 1
        entries.append(entry)

    baseline_entries: list[dict[str, Any]] = []
    for stage_id in sorted(set(profiles) - catalog_ids):
        path, profile = profiles[stage_id]
        counts = profile_counts(profile)
        aggregate_profile_counts.update(counts)
        baseline_entries.append(
            {
                "stageId": stage_id,
                "visualProductMode": "serialized-scene-profile",
                "sceneProfileUrl": url_for(path.relative_to(public)),
                "runtimeReady": True,
                "profileCounts": counts,
            }
        )

    if mode_counts != Counter(
        {
            "serialized-scene-profile": 390,
            "official-image-plane": 190,
            "exact-empty-root-marker": 1,
        }
    ):
        raise ValueError(f"unexpected catalog visual modes: {dict(mode_counts)}")
    if len(baseline_entries) != 9:
        raise ValueError(f"expected 9 baseline-only profiles, found {len(baseline_entries)}")

    all_bindings = [
        binding
        for _, profile in profiles.values()
        for binding in profile.get("materialBindings", [])
    ]
    unresolved = [
        binding
        for binding in all_bindings
        if not binding.get("sourceShader")
    ]
    fail_closed = [
        binding
        for binding in unresolved
        if binding.get("sourceShaderResolution", {}).get("status") == "fail-closed"
    ]
    builtins = [
        binding
        for binding in unresolved
        if binding.get("sourceShaderResolution", {}).get("status")
        == "builtin-source-key-only"
    ]

    manifest = {
        "schema": SCHEMA,
        "authority": {
            "catalog": url_for(catalog_path.relative_to(public)),
            "inputs": [
                "published official resource catalog",
                "published scene-profile.json products",
                "published scene-product.json products",
            ],
            "inventoryRescan": False,
            "shaderResolution": "unique published Shader pathID to CAB/name authority only",
        },
        "counts": {
            "catalogScenes": len(entries),
            "catalogSerializedSceneProfiles": mode_counts["serialized-scene-profile"],
            "catalogOfficialImagePlanes": mode_counts["official-image-plane"],
            "catalogExactEmptyRootMarkers": mode_counts["exact-empty-root-marker"],
            "baselineOnlySceneProfiles": len(baseline_entries),
            "totalSceneProfiles": len(profiles),
            **dict(aggregate_profile_counts),
            "sourceShaderNamedBindings": len(all_bindings) - len(unresolved),
            "sourceShaderBuiltinKeyOnlyBindings": len(builtins),
            "sourceShaderFailClosedBindings": len(fail_closed),
            "sourceShaderTotalBindings": len(all_bindings),
            "shaderNamesResolvedByExactPathID": resolution_counts[
                "cross-profile-exact-pathid"
            ],
            "modifiedSceneProfiles": len(
                {record["stageId"] for record in resolution_records}
            ),
        },
        "shaderPointerAuthority": [
            {
                "stableKey": f"unity-shader:cab={cab}|pathID={path_id}",
                "cab": cab,
                "pathID": path_id,
                "name": name,
            }
            for path_id, (cab, name) in sorted(unique_shader_authority.items())
        ],
        "shaderResolutionRecords": resolution_records,
        "catalogProducts": entries,
        "baselineProfileProducts": baseline_entries,
    }
    write_json(output, manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/stages/official/scene-visual-products.v1.json"),
    )
    args = parser.parse_args()
    repository = args.repository.resolve()
    output = args.output
    if not output.is_absolute():
        output = repository / output
    manifest = build(repository, output)
    print(json.dumps({"schema": manifest["schema"], **manifest["counts"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
