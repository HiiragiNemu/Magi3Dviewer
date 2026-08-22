#!/usr/bin/env python3
"""Extract per-character ReDriveToon controller and AngelRing parameters.

The extractor reads only top-level ``chara_*_battle_unit`` bundles from the
requested character bundle directory.  It selects the serialized
``ReDriveToonMaterialController`` whose ``IsCharacter`` flag is set, so weapon
and auxiliary controllers do not overwrite the character's head offset.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import warnings
from pathlib import Path
from typing import Any, Iterable


SCHEMA = "magius-character-render-profiles-v1"
RUNTIME_SCHEMA = "magius-character-controller-runtime-profiles-v1"
DEFAULT_UNITY_VERSION = "2022.3.62f2"
BUNDLE_NAME = re.compile(r"^chara_(\d+)_battle_unit$")
AXIS_NAMES = {
    0: "x",
    1: "y",
    2: "z",
    3: "-x",
    4: "-y",
    5: "-z",
}


def pair_map(items: Any) -> dict[str, Any]:
    """Convert Unity's serialized pair arrays to a normal dictionary."""

    result: dict[str, Any] = {}
    if not isinstance(items, list):
        return result
    for item in items:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            result[str(item[0])] = item[1]
        elif isinstance(item, dict) and "first" in item and "second" in item:
            result[str(item["first"])] = item["second"]
    return result


def pointer_path_id(value: Any) -> int:
    if not isinstance(value, dict):
        return 0
    raw = value.get("m_PathID", value.get("path_id", 0))
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def axis_name(value: Any) -> str | None:
    try:
        return AXIS_NAMES.get(int(value))
    except (TypeError, ValueError):
        return None


def extract_character_controller(tree: dict[str, Any]) -> dict[str, Any] | None:
    """Return the official character controller fields, excluding attachments."""

    try:
        is_character = int(tree.get("IsCharacter", 0)) == 1
    except (TypeError, ValueError):
        is_character = False
    if not is_character:
        return None

    try:
        head_offset = float(tree["headOffset"])
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(head_offset):
        return None

    forward_raw = tree.get("faceForwardDirection")
    up_raw = tree.get("faceUpDirection")
    right_raw = tree.get("faceRightDirection")
    return {
        "headOffset": head_offset,
        "faceForwardDirectionRaw": int(forward_raw),
        "faceUpDirectionRaw": int(up_raw),
        "faceRightDirectionRaw": int(right_raw),
        "faceForwardAxis": axis_name(forward_raw),
        "faceUpAxis": axis_name(up_raw),
        "faceRightAxis": axis_name(right_raw),
        "headBonePathId": pointer_path_id(tree.get("headBoneTransform")),
        "pelvisBonePathId": pointer_path_id(tree.get("pelvisBoneTransform")),
        "gameObjectPathId": pointer_path_id(tree.get("m_GameObject")),
        "rendererPathIds": [
            pointer_path_id(value)
            for value in tree.get("reDriveToonRenderers", [])
            if pointer_path_id(value)
        ],
        "characterCancelPerspective": float(
            tree.get("CharacterCancelPerspective", 1.0)
        ),
        "additionalLightInfluenceByLuminance": float(
            tree.get("AdditionalLightInfluenceByLuminance", 0.0)
        ),
    }


def extract_hair_material(tree: dict[str, Any]) -> dict[str, Any] | None:
    saved = tree.get("m_SavedProperties", {})
    if not isinstance(saved, dict):
        return None
    floats = pair_map(saved.get("m_Floats"))
    if float(floats.get("_IsHair", 0.0)) <= 0.5:
        return None
    textures = pair_map(saved.get("m_TexEnvs"))
    angel = textures.get("_AngelRingMap", {})
    texture_ptr = pointer_path_id(
        angel.get("m_Texture") if isinstance(angel, dict) else None
    )
    return {
        "name": str(tree.get("m_Name", "")),
        "angelRingTexturePathId": texture_ptr,
        "angelRingEnabled": texture_ptr != 0,
        "hairUvAngelRing": float(floats.get("_YuugenHighlight", 0.0)) > 0.5,
    }


def object_name(objects_by_path: dict[int, Any], path_id: int) -> str | None:
    obj = objects_by_path.get(path_id)
    if obj is None:
        return None
    try:
        tree = obj.read_typetree()
    except Exception:
        return None
    if obj.type.name == "GameObject":
        return str(tree.get("m_Name", "")) or None
    if obj.type.name == "Transform":
        return object_name(objects_by_path, pointer_path_id(tree.get("m_GameObject")))
    return str(tree.get("m_Name", "")) or None


def script_name(obj: Any) -> str:
    try:
        return str(obj.read().m_Script.read().m_Name)
    except Exception:
        return ""


def extract_bundle(bundle: Path, unity_version: str) -> dict[str, Any]:
    match = BUNDLE_NAME.fullmatch(bundle.name)
    if match is None:
        raise ValueError(f"unsupported character bundle name: {bundle.name}")

    import UnityPy

    UnityPy.config.FALLBACK_UNITY_VERSION = unity_version
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        env = UnityPy.load(str(bundle))
        objects = list(env.objects)
        objects_by_path = {int(obj.path_id): obj for obj in objects}

        controllers: list[tuple[int, dict[str, Any]]] = []
        hair_materials: list[dict[str, Any]] = []
        for obj in objects:
            if obj.type.name == "MonoBehaviour" and (
                script_name(obj) == "ReDriveToonMaterialController"
            ):
                record = extract_character_controller(obj.read_typetree())
                if record is not None:
                    controllers.append((int(obj.path_id), record))
            elif obj.type.name == "Material":
                material = extract_hair_material(obj.read_typetree())
                if material is not None:
                    hair_materials.append(material)

    if len(controllers) != 1:
        raise ValueError(
            f"expected one IsCharacter ReDriveToonMaterialController, found "
            f"{len(controllers)}"
        )
    controller_path_id, controller = controllers[0]
    axes = (
        controller["faceForwardAxis"],
        controller["faceUpAxis"],
        controller["faceRightAxis"],
    )
    if any(axis is None for axis in axes):
        raise ValueError(f"unknown serialized face direction enum: {axes}")

    return {
        "characterId": int(match.group(1)),
        "bundleName": bundle.name,
        "bundleLength": bundle.stat().st_size,
        "controllerPathId": controller_path_id,
        **controller,
        "headBoneName": object_name(
            objects_by_path, int(controller["headBonePathId"])
        ),
        "controllerGameObjectName": object_name(
            objects_by_path, int(controller["gameObjectPathId"])
        ),
        "angelRingEnabled": any(
            material["angelRingEnabled"] for material in hair_materials
        ),
        "hairUvAngelRing": any(
            material["hairUvAngelRing"] for material in hair_materials
        ),
        "hairMaterials": sorted(hair_materials, key=lambda row: row["name"]),
    }


def discover_bundles(root: Path, include: re.Pattern[str] | None) -> Iterable[Path]:
    for path in sorted(root.iterdir(), key=lambda item: item.name):
        if not path.is_file() or BUNDLE_NAME.fullmatch(path.name) is None:
            continue
        if include is not None and include.search(path.name) is None:
            continue
        yield path


def build_report(
    bundle_root: Path,
    unity_version: str,
    include: re.Pattern[str] | None = None,
) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for bundle in discover_bundles(bundle_root, include):
        try:
            records.append(extract_bundle(bundle, unity_version))
        except Exception as exc:
            errors.append({"bundleName": bundle.name, "error": str(exc)})
    return {
        "schema": SCHEMA,
        "unityVersion": unity_version,
        "bundleRoot": str(bundle_root.resolve()),
        "bundleCount": len(records) + len(errors),
        "profileCount": len(records),
        "errorCount": len(errors),
        "profiles": sorted(records, key=lambda row: row["characterId"]),
        "errors": errors,
    }


RUNTIME_PROFILE_KEYS = (
    "characterId",
    "headOffset",
    "faceForwardAxis",
    "faceUpAxis",
    "faceRightAxis",
    "headBoneName",
    "characterCancelPerspective",
    "additionalLightInfluenceByLuminance",
    "angelRingEnabled",
    "hairUvAngelRing",
)


def build_runtime_report(report: dict[str, Any]) -> dict[str, Any]:
    """Build the compact table consumed directly by renderProfile.ts."""
    profiles = [
        {key: row[key] for key in RUNTIME_PROFILE_KEYS}
        for row in report["profiles"]
    ]
    return {
        "schema": RUNTIME_SCHEMA,
        "unityVersion": report["unityVersion"],
        "profileCount": len(profiles),
        "profiles": profiles,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle_root", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--runtime-output",
        type=Path,
        help="Optional compact JSON table consumed by the Viewer runtime.",
    )
    parser.add_argument("--unity-version", default=DEFAULT_UNITY_VERSION)
    parser.add_argument(
        "--include",
        help="Optional regular expression matched against top-level bundle names.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Return a failing exit status when any selected bundle cannot be read.",
    )
    args = parser.parse_args()
    if not args.bundle_root.is_dir():
        parser.error(f"bundle root does not exist: {args.bundle_root}")
    include = re.compile(args.include) if args.include else None
    report = build_report(args.bundle_root, args.unity_version, include)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if args.runtime_output is not None:
        args.runtime_output.parent.mkdir(parents=True, exist_ok=True)
        args.runtime_output.write_text(
            json.dumps(
                build_runtime_report(report),
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    print(
        json.dumps(
            {
                "output": str(args.output.resolve()),
                "bundleCount": report["bundleCount"],
                "profileCount": report["profileCount"],
                "errorCount": report["errorCount"],
                "runtimeOutput": (
                    str(args.runtime_output.resolve())
                    if args.runtime_output is not None
                    else None
                ),
            },
            ensure_ascii=False,
        )
    )
    return 1 if args.strict and report["errorCount"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
