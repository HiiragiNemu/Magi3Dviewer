#!/usr/bin/env python3
"""Audit official Home Transform paths against the generated Viewer runtime.

The important invariant is deliberately strict: an official Transform curve may
only bind to the exact Animator-relative path whose CRC32 is serialized in the
AnimationClip.  A missing terminal bone must never be rebound to its nearest
surviving ancestor.  AssetStudio's current FBX conversion violates this
invariant for some models, so this audit records both the omitted terminal path
and the ancestor whose exported curve has the omitted child's rest signature.
"""
from __future__ import annotations

import argparse
import gc
import gzip
import json
import math
import re
import warnings
import zlib
from collections import defaultdict
from pathlib import Path
from typing import Any

import UnityPy
import UnityPy.config as unity_config
from UnityPy.exceptions import UnityVersionFallbackWarning


UNITY_VERSION = "2022.3.62f2"
DEFAULT_MODEL_ROOT = Path(
    r"D:\magia\MyProducts\Magius3Dviewer-JP\magia-exedra-character-three\models"
)
DEFAULT_ASSET_ROOT = Path(r"D:\magia\ma-ex-data\gamedata\AssetBundles")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", type=Path, default=DEFAULT_MODEL_ROOT)
    parser.add_argument("--asset-root", type=Path, default=DEFAULT_ASSET_ROOT)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--character", action="append", default=[])
    return parser.parse_args()


def load_json_gzip(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def deref(pointer: Any) -> Any | None:
    return None if pointer is None or pointer.m_PathID == 0 else pointer.deref()


def component(game_object: Any, type_name: str) -> Any | None:
    for pair in game_object.m_Component:
        reader = deref(pair.component)
        if reader is not None and reader.type.name == type_name:
            return reader
    return None


def hierarchy(transform_reader: Any) -> str:
    names: list[str] = []
    seen: set[int] = set()
    current = transform_reader
    while current is not None:
        if current.path_id in seen:
            raise RuntimeError("Transform parent cycle")
        seen.add(current.path_id)
        transform = current.read()
        game_object_reader = deref(transform.m_GameObject)
        if game_object_reader is None:
            raise RuntimeError("Transform has null GameObject")
        names.append(game_object_reader.read().m_Name)
        current = deref(transform.m_Father)
    return "/".join(reversed(names))


def crc32_path(value: str) -> int:
    return zlib.crc32(value.encode("utf-8")) & 0xFFFFFFFF


def vector3(value: Any) -> list[float]:
    return [float(value.x), float(value.y), float(value.z)]


def quaternion(value: Any) -> list[float]:
    return [float(value.x), float(value.y), float(value.z), float(value.w)]


def unity_to_fbx_rest(transform: Any) -> dict[str, list[float]]:
    position = vector3(transform.m_LocalPosition)
    rotation = quaternion(transform.m_LocalRotation)
    scale = vector3(transform.m_LocalScale)
    return {
        "position": [-position[0], position[1], position[2]],
        "quaternion": [rotation[0], -rotation[1], -rotation[2], rotation[3]],
        "scale": scale,
    }


def approximate(left: list[float], right: list[float], epsilon: float = 1e-4) -> bool:
    return len(left) == len(right) and all(
        math.isfinite(a) and math.isfinite(b) and abs(a - b) <= epsilon
        for a, b in zip(left, right)
    )


def normalize_runtime_path(path: str, animator_root_name: str) -> str | None:
    segments = [item for item in path.replace("<root>/", "").split("/") if item]
    try:
        index = segments.index(animator_root_name)
    except ValueError:
        return None
    return "/".join(segments[index + 1 :])


def runtime_clip_paths(
    runtime: dict[str, Any], clip: dict[str, Any], animator_root_name: str
) -> tuple[set[str], dict[tuple[str, str], list[float]], list[str]]:
    paths: set[str] = set()
    first_values: dict[tuple[str, str], list[float]] = {}
    malformed: list[str] = []
    for track in clip.get("tracks", []):
        try:
            source_uuid, property_name = track["name"].rsplit(".", 1)
        except (KeyError, ValueError):
            malformed.append(str(track.get("name")))
            continue
        target = runtime.get("nodePaths", {}).get(source_uuid)
        if target is None:
            malformed.append(track["name"])
            continue
        relative = normalize_runtime_path(target, animator_root_name)
        if relative is None:
            # Weapon helpers intentionally live outside the model Animator root.
            continue
        paths.add(relative)
        width = 4 if property_name == "quaternion" else 3
        values = [float(item) for item in track.get("values", [])[:width]]
        first_values[(relative, property_name)] = values
    return paths, first_values, malformed


def runtime_base_name(name: str) -> str:
    """Undo AssetStudio's numeric duplicate-name suffix only."""
    return re.sub(r"_\d+$", "", name)


def action_family_names(value: Any) -> set[str]:
    result: set[str] = set()
    if isinstance(value, dict):
        for child in value.values():
            result.update(action_family_names(child))
    elif isinstance(value, list):
        for child in value:
            result.update(action_family_names(child))
    elif isinstance(value, str):
        result.add(value)
    return result


def build_transform_map(environment: Any, character_id: str) -> dict[str, Any]:
    animator_roots: list[tuple[str, Any]] = []
    for reader in environment.objects:
        if reader.type.name != "Animator":
            continue
        animator = reader.read()
        if animator.m_Controller.m_PathID == 0:
            continue
        game_object_reader = deref(animator.m_GameObject)
        controller_reader = deref(animator.m_Controller)
        if game_object_reader is None:
            continue
        game_object = game_object_reader.read()
        controller_name = (
            controller_reader.read().m_Name.lower() if controller_reader is not None else ""
        )
        spelling_variants = ("weapon", "wapon", "weaopn")
        if any(token in game_object.m_Name.lower() or token in controller_name for token in spelling_variants):
            continue
        transform_reader = component(game_object, "Transform")
        if transform_reader is not None:
            animator_roots.append((game_object.m_Name, transform_reader))
    if len(animator_roots) != 1:
        raise RuntimeError(
            f"expected one non-weapon controlled Animator for {character_id}, got {len(animator_roots)}"
        )
    root_name, root_reader = animator_roots[0]
    transforms: list[tuple[Any, Any, str]] = []
    root_paths: list[str] = []
    for reader in environment.objects:
        if reader.type.name != "Transform":
            continue
        transform = reader.read()
        game_object_reader = deref(transform.m_GameObject)
        if game_object_reader is None:
            continue
        game_object_name = game_object_reader.read().m_Name
        full_path = hierarchy(reader)
        transforms.append((reader, transform, full_path))
        if reader.path_id == root_reader.path_id:
            root_paths.append(full_path)
    if len(root_paths) != 1:
        raise RuntimeError(f"expected one {root_name} Transform, got {len(root_paths)}")
    root_path = root_paths[0]
    by_path: dict[str, dict[str, Any]] = {}
    by_hash: dict[int, list[str]] = defaultdict(list)
    for reader, transform, full_path in transforms:
        if full_path == root_path:
            relative = ""
        elif full_path.startswith(root_path + "/"):
            relative = full_path[len(root_path) + 1 :]
        else:
            continue
        record = {
            "path": relative,
            "pathHash": crc32_path(relative),
            "pathId": str(reader.path_id),
            "parent": relative.rpartition("/")[0] if "/" in relative else "",
            "restFbx": unity_to_fbx_rest(transform),
        }
        by_path[relative] = record
        by_hash[record["pathHash"]].append(relative)
    return {
        "rootName": root_name,
        "rootPath": root_path,
        "byPath": by_path,
        "byHash": dict(by_hash),
    }


def clip_record(
    raw_clip: Any,
    raw_path_id: int,
    runtime: dict[str, Any],
    runtime_clip: dict[str, Any],
    transform_map: dict[str, Any],
) -> dict[str, Any]:
    bindings = raw_clip.m_ClipBindingConstant.genericBindings
    raw_hashes = sorted({int(binding.path) for binding in bindings if int(binding.typeID) == 4})
    resolved, unresolved, ambiguous = resolve_raw_transform_paths(raw_clip, transform_map)

    output_paths, first_values, malformed = runtime_clip_paths(
        runtime, runtime_clip, transform_map["rootName"]
    )
    raw_paths = set(resolved)
    missing_paths = sorted(raw_paths - output_paths)
    extra_paths = sorted(output_paths - raw_paths)
    collapses: list[dict[str, Any]] = []
    for missing in missing_paths:
        ancestor = missing.rpartition("/")[0]
        while ancestor and ancestor not in output_paths:
            ancestor = ancestor.rpartition("/")[0]
        source = transform_map["byPath"].get(missing)
        expected = source["restFbx"] if source else None
        compared: dict[str, Any] = {}
        exact_parts: list[bool] = []
        for property_name in ("position", "quaternion", "scale"):
            actual = first_values.get((ancestor, property_name)) if ancestor else None
            target = expected.get(property_name) if expected else None
            match = bool(actual is not None and target is not None and approximate(actual, target))
            compared[property_name] = {"expectedChildRest": target, "actualParentFirst": actual, "match": match}
            if actual is not None and target is not None:
                exact_parts.append(match)
        collapses.append(
            {
                "missingTerminalPath": missing,
                "missingPathHash": crc32_path(missing),
                "nearestSurvivingAncestor": ancestor or None,
                "ancestorTrackHasOmittedChildRestSignature": bool(exact_parts) and all(exact_parts),
                "signature": compared,
            }
        )
    return {
        "rawClip": raw_clip.m_Name,
        "rawClipPathId": str(raw_path_id),
        "runtimeClip": runtime_clip.get("name"),
        "rawBindingCount": len(bindings),
        "rawTransformPathCount": len(raw_hashes),
        "runtimeTransformPathCount": len(output_paths),
        "resolvedRawPathCount": len(resolved),
        "unresolvedRawPathHashes": unresolved,
        "ambiguousRawPathHashes": ambiguous,
        "malformedRuntimeTracks": malformed,
        "missingRawPathsInRuntime": missing_paths,
        "extraRuntimePaths": extra_paths,
        "nearestParentCollapseCandidates": collapses,
        "strictExactPathSafe": not (
            unresolved or ambiguous or malformed or missing_paths or extra_paths
        ),
        "matchCost": (
            len(unresolved) * 1000
            + len(ambiguous) * 1000
            + len(malformed) * 1000
            + len(missing_paths)
            + len(extra_paths)
        ),
    }


def resolve_raw_transform_paths(
    raw_clip: Any, transform_map: dict[str, Any]
) -> tuple[list[str], list[int], list[dict[str, Any]]]:
    bindings = raw_clip.m_ClipBindingConstant.genericBindings
    raw_hashes = sorted({int(binding.path) for binding in bindings if int(binding.typeID) == 4})
    resolved: list[str] = []
    unresolved: list[int] = []
    ambiguous: list[dict[str, Any]] = []
    for path_hash in raw_hashes:
        candidates = transform_map["byHash"].get(path_hash, [])
        if len(candidates) == 1:
            resolved.append(candidates[0])
        elif not candidates:
            unresolved.append(path_hash)
        else:
            ambiguous.append({"pathHash": path_hash, "paths": sorted(candidates)})
    return resolved, unresolved, ambiguous


def audit_character(
    model_dir: Path, asset_root: Path, selected: set[str]
) -> dict[str, Any]:
    fallback_id = model_dir.name.removeprefix("chara_").removesuffix("_battle_unit")
    if selected and fallback_id not in selected:
        return {"skip": True}
    runtime_path = model_dir / "home-animations.json.gz"
    if not runtime_path.is_file():
        return {
            "characterId": fallback_id,
            "modelDirectory": str(model_dir),
            "classification": "indeterminate",
            "error": "home-animations.json.gz absent",
        }
    runtime = load_json_gzip(runtime_path)
    character_id = str(runtime.get("characterId", fallback_id))
    if selected and character_id not in selected:
        return {"skip": True}
    home_source = asset_root / Path(str(runtime["source"]))
    battle_source = asset_root / "battle" / "character" / f"chara_{character_id}_battle_unit"
    result: dict[str, Any] = {
        "characterId": character_id,
        "modelDirectory": str(model_dir),
        "runtime": str(runtime_path),
        "battleSource": str(battle_source),
        "homeSource": str(home_source),
        "unityVersion": runtime.get("unityVersion"),
    }
    missing_sources = [str(item) for item in (battle_source, home_source) if not item.is_file()]
    if missing_sources:
        result.update(
            classification="indeterminate",
            error="source bundle absent",
            missingSources=missing_sources,
        )
        return result
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UnityVersionFallbackWarning)
            battle_environment = UnityPy.load(str(battle_source))
            home_environment = UnityPy.load(str(home_source))
        transform_map = build_transform_map(battle_environment, character_id)
        helpers = set(runtime.get("helpers", [])) | set(runtime.get("externalHelpers", []))
        runtime_clips = [
            item
            for item in runtime.get("clips", [])
            if item.get("name") not in helpers and len(item.get("tracks", [])) > 2
        ]
        runtime_bases = {runtime_base_name(str(item.get("name"))) for item in runtime_clips}
        raw_entries: list[tuple[int, Any]] = []
        for reader in home_environment.objects:
            if reader.type.name != "AnimationClip":
                continue
            raw_clip = reader.read()
            bindings = raw_clip.m_ClipBindingConstant.genericBindings
            if raw_clip.m_Name in runtime_bases and any(int(item.typeID) == 4 for item in bindings):
                raw_entries.append((reader.path_id, raw_clip))

        # AssetStudio adds _1/_2 to duplicate clip names after combining model,
        # weapon and Home sources.  File-order matching is insufficient because
        # other input bundles can contribute the unsuffixed name.  Resolve a
        # bounded one-to-one assignment by exact path-set difference instead.
        candidate_pairs: list[tuple[int, int, int, dict[str, Any]]] = []
        for raw_index, (raw_path_id, raw_clip) in enumerate(raw_entries):
            for runtime_index, runtime_clip in enumerate(runtime_clips):
                if runtime_base_name(str(runtime_clip.get("name"))) != raw_clip.m_Name:
                    continue
                record = clip_record(
                    raw_clip,
                    raw_path_id,
                    runtime,
                    runtime_clip,
                    transform_map,
                )
                candidate_pairs.append((record["matchCost"], raw_index, runtime_index, record))
        assigned_raw: set[int] = set()
        assigned_runtime: set[int] = set()
        clips: list[dict[str, Any]] = []
        for _, raw_index, runtime_index, record in sorted(
            candidate_pairs,
            key=lambda item: (item[0], item[1], item[2]),
        ):
            if raw_index in assigned_raw or runtime_index in assigned_runtime:
                continue
            assigned_raw.add(raw_index)
            assigned_runtime.add(runtime_index)
            clips.append(record)

        unmatched_raw_records = []
        for index, (raw_path_id, raw_clip) in enumerate(raw_entries):
            if index in assigned_raw:
                continue
            resolved, unresolved, ambiguous = resolve_raw_transform_paths(
                raw_clip, transform_map
            )
            unmatched_raw_records.append(
                {
                    "rawClip": raw_clip.m_Name,
                    "rawClipPathId": str(raw_path_id),
                    "resolvedModelPathCount": len(resolved),
                    "unresolvedRawPathHashes": unresolved,
                    "ambiguousRawPathHashes": ambiguous,
                }
            )
        # Same-name clips owned wholly by a detached weapon/accessory Animator
        # are official, but cannot bind to the character Animator root. Keep
        # them visible as external evidence rather than treating them as a
        # missing body clip.
        absent_official_clips = [
            item for item in unmatched_raw_records
            if item["resolvedModelPathCount"] > 0
        ]
        external_official_clips = [
            item for item in unmatched_raw_records
            if item["resolvedModelPathCount"] == 0
        ]
        unmatched_runtime_clips = [
            str(runtime_clip.get("name"))
            for index, runtime_clip in enumerate(runtime_clips)
            if index not in assigned_runtime
        ]
        non_model_owned_clips = [
            {
                "rawClip": item["rawClip"],
                "rawClipPathId": item["rawClipPathId"],
                "runtimeClip": item["runtimeClip"],
                "rawTransformPathCount": item["rawTransformPathCount"],
            }
            for item in clips
            if item["rawTransformPathCount"] and item["resolvedRawPathCount"] == 0
        ]
        affected = [
            item["runtimeClip"]
            for item in clips
            if item["resolvedRawPathCount"] > 0 and not item["strictExactPathSafe"]
        ]
        missing_terminals = sorted(
            {
                path
                for clip in clips
                for path in clip["missingRawPathsInRuntime"]
            }
        )
        confirmed = [
            {
                "rawClip": clip["rawClip"],
                "rawClipPathId": clip["rawClipPathId"],
                "runtimeClip": clip["runtimeClip"],
                **collapse,
            }
            for clip in clips
            for collapse in clip["nearestParentCollapseCandidates"]
            if collapse["ancestorTrackHasOmittedChildRestSignature"]
        ]
        matched_by_runtime = {item["runtimeClip"]: item for item in clips}
        action_collisions: list[dict[str, Any]] = []
        for selected_name in sorted(action_family_names(runtime.get("actions", {}))):
            selected_record = matched_by_runtime.get(selected_name)
            alternatives = [
                item
                for item in clips
                if item["runtimeClip"] != selected_name
                and item["rawClip"] == runtime_base_name(selected_name)
                and item["resolvedRawPathCount"] > 0
            ]
            if selected_record is None and alternatives:
                action_collisions.append(
                    {
                        "selectedRuntimeClip": selected_name,
                        "reason": "selected name has no official Home Transform match",
                        "exactOfficialCandidates": [item["runtimeClip"] for item in alternatives],
                    }
                )
            elif (
                selected_record is not None
                and selected_record["resolvedRawPathCount"] == 0
                and alternatives
            ):
                action_collisions.append(
                    {
                        "selectedRuntimeClip": selected_name,
                        "reason": "selected duplicate resolves outside/incompletely against model Animator",
                        "selectedMatchCost": selected_record["matchCost"],
                        "exactOfficialCandidates": [item["runtimeClip"] for item in alternatives],
                    }
                )
        result.update(
            animatorRoot=transform_map["rootPath"],
            sourceTransformCount=len(transform_map["byPath"]),
            sourcePathHashCollisionCount=sum(
                len(paths) > 1 for paths in transform_map["byHash"].values()
            ),
            clips=clips,
            nonModelOwnedClips=non_model_owned_clips,
            absentOfficialClips=absent_official_clips,
            externalOfficialClips=external_official_clips,
            unmatchedRuntimeClips=unmatched_runtime_clips,
            actionFamilyCollisions=action_collisions,
            affectedClips=affected,
            missingTerminalPaths=missing_terminals,
            confirmedNearestParentOverwrites=confirmed,
            strictExactPathSafe=not affected and not absent_official_clips and not action_collisions,
            classification=(
                "high-risk-same-source"
                if affected or absent_official_clips or action_collisions
                else "no-same-source-evidence"
            ),
        )
    except Exception as error:  # keep a complete global inventory
        result.update(classification="indeterminate", error=f"{type(error).__name__}: {error}")
    finally:
        for name in ("battle_environment", "home_environment"):
            if name in locals():
                del locals()[name]
        gc.collect()
    return result


def main() -> int:
    args = parse_args()
    unity_config.FALLBACK_UNITY_VERSION = UNITY_VERSION
    selected = set(args.character)
    directories = sorted(
        item
        for item in args.model_root.iterdir()
        if item.is_dir() and item.name.startswith("chara_")
    )
    records: list[dict[str, Any]] = []
    for index, directory in enumerate(directories, 1):
        record = audit_character(directory, args.asset_root, selected)
        if not record.get("skip"):
            records.append(record)
            print(
                f"[{index}/{len(directories)}] {record.get('characterId')} "
                f"{record.get('classification')}",
                flush=True,
            )
    counts: dict[str, int] = defaultdict(int)
    for record in records:
        counts[record["classification"]] += 1
    output = {
        "schema": "magia-home-animation-source-binding-audit-v1",
        "releaseProfile": "jp-android-3.13.0",
        "unityVersion": UNITY_VERSION,
        "invariant": "exact Animator-relative Transform path only; no nearest-parent fallback",
        "modelRoot": str(args.model_root),
        "assetRoot": str(args.asset_root),
        "summary": {
            "characterCount": len(records),
            "classificationCounts": dict(sorted(counts.items())),
            "strictSafeCount": sum(bool(item.get("strictExactPathSafe")) for item in records),
            "charactersWithMissingTerminalPaths": sum(bool(item.get("missingTerminalPaths")) for item in records),
            "confirmedNearestParentOverwriteCount": sum(
                len(item.get("confirmedNearestParentOverwrites", [])) for item in records
            ),
        },
        "characters": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output["summary"], ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
