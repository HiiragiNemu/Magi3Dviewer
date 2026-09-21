#!/usr/bin/env python3
"""Extract serialized ReDrive FaceMeshSwitcher profiles from JP battle units.

The output is deliberately keyed by the component's semantic renderer names,
not by character ID.  A Viewer model consumes a profile only when its imported
FBX contains the complete serialized mesh set.
"""
from __future__ import annotations

import argparse
import json
import re
import warnings
from pathlib import Path
from typing import Any

import UnityPy
import UnityPy.config as unity_config
from UnityPy.exceptions import UnityVersionFallbackWarning


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUNDLE_ROOT = Path(
    r"D:\magia\ma-ex-data\gamedata\AssetBundles\battle\character"
)
DEFAULT_OUTPUT = (
    REPO_ROOT
    / "magia-exedra-character-three"
    / "official-face-mesh-switcher-profiles.generated.json"
)
UNITY_VERSION = "2022.3.62f2"

REQUIRED_FIELDS = (
    "head",
    "faceForwardDirection",
    "faceFrontRight",
    "faceFrontLeft",
    "faceSide",
    "facepartsFront",
    "facepartsSide",
    "mouthFrontRight",
    "mouthFrontLeft",
    "mouthSide",
    "switchAngle",
    "hysteresisAngle",
    "controlBone",
    "elevationMin",
    "elevationMax",
    "cameraDownOffsetAtMax",
    "yScaleAtMax",
    "localZElevationMin",
    "localZElevationMax",
    "localZOffsetAtMax",
    "localZFrontBackBlend",
    "boneHideAngle",
    "boneHideElevationAngle",
)

DIRECTION_NAMES = {
    0: "x",
    1: "y",
    2: "z",
    3: "-x",
    4: "-y",
    5: "-z",
}

MESH_FIELDS = {
    "faceFrontRight": "faceFrontRight",
    "faceFrontLeft": "faceFrontLeft",
    "faceSide": "faceSide",
    "facepartsFront": "facepartsFront",
    "facepartsSide": "facepartsSide",
    "mouthFrontRight": "mouthFrontRight",
    "mouthFrontLeft": "mouthFrontLeft",
    "mouthSide": "mouthSide",
}


def pointer_path_id(value: dict[str, Any]) -> int:
    return int(value["m_PathID"])


def object_name(reader: Any, path_id: int) -> str:
    target = reader.assets_file.objects[path_id].read()
    direct = getattr(target, "m_Name", None)
    if direct:
        return str(direct)
    game_object = getattr(target, "m_GameObject", None)
    if game_object and game_object.path_id:
        return str(game_object.read().m_Name)
    raise RuntimeError(f"PathID {path_id} has no named GameObject")


def transform_path(reader: Any, path_id: int) -> str:
    names: list[str] = []
    current = path_id
    visited: set[int] = set()
    while current and current not in visited:
        visited.add(current)
        transform = reader.assets_file.objects[current].read()
        names.append(str(transform.m_GameObject.read().m_Name))
        father = getattr(transform, "m_Father", None)
        current = int(father.path_id) if father else 0
    return "/".join(reversed(names))


def extract_profile(reader: Any, tree: dict[str, Any], bundle: Path) -> dict[str, Any]:
    raw_direction = int(tree["faceForwardDirection"])
    if raw_direction not in DIRECTION_NAMES:
        raise RuntimeError(
            f"{bundle.name}: unsupported TransformDirection {raw_direction}"
        )

    game_object_id = pointer_path_id(tree["m_GameObject"])
    head_id = pointer_path_id(tree["head"])
    control_id = pointer_path_id(tree["controlBone"])
    match = re.fullmatch(r"chara_(\d+)_battle_unit", bundle.name)
    if not match:
        raise RuntimeError(f"Unexpected battle-unit filename: {bundle.name}")

    meshes = {
        output_name: object_name(reader, pointer_path_id(tree[field_name]))
        for output_name, field_name in MESH_FIELDS.items()
    }
    if len(set(meshes.values())) != len(meshes):
        raise RuntimeError(f"{bundle.name}: FaceMeshSwitcher mesh names are not unique")

    return {
        "source": {
            "bundle": f"battle/character/{bundle.name}",
            "characterId": int(match.group(1)),
            "componentPathId": str(reader.path_id),
            "rootGameObjectPathId": str(game_object_id),
            "rootGameObjectName": object_name(reader, game_object_id),
        },
        "head": {
            "name": object_name(reader, head_id),
            "path": transform_path(reader, head_id),
        },
        "faceForwardDirection": raw_direction,
        "faceForwardAxis": DIRECTION_NAMES[raw_direction],
        "faceUpAxis": "y",
        "faceRightAxis": "z",
        "meshes": meshes,
        "switchAngle": float(tree["switchAngle"]),
        "hysteresisAngle": float(tree["hysteresisAngle"]),
        "controlBone": {
            "name": object_name(reader, control_id),
            "path": transform_path(reader, control_id),
        },
        "elevationMin": float(tree["elevationMin"]),
        "elevationMax": float(tree["elevationMax"]),
        "cameraDownOffsetAtMax": float(tree["cameraDownOffsetAtMax"]),
        "yScaleAtMax": float(tree["yScaleAtMax"]),
        "localZElevationMin": float(tree["localZElevationMin"]),
        "localZElevationMax": float(tree["localZElevationMax"]),
        "localZOffsetAtMax": float(tree["localZOffsetAtMax"]),
        "localZFrontBackBlend": float(tree["localZFrontBackBlend"]),
        "boneHideAngle": float(tree["boneHideAngle"]),
        "boneHideElevationAngle": float(tree["boneHideElevationAngle"]),
        "shouldDrawGizmo": bool(tree.get("shouldDrawGizmo", 0)),
    }


def scan_bundle(bundle: Path) -> list[dict[str, Any]]:
    environment = UnityPy.load(str(bundle))
    profiles: list[dict[str, Any]] = []
    for reader in environment.objects:
        if reader.type.name != "MonoBehaviour":
            continue
        try:
            tree = reader.read_typetree()
        except Exception:
            continue
        if not all(field in tree for field in REQUIRED_FIELDS):
            continue
        profiles.append(extract_profile(reader, tree, bundle))
    return profiles


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle-root", type=Path, default=DEFAULT_BUNDLE_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--unity-version", default=UNITY_VERSION)
    args = parser.parse_args()

    unity_config.FALLBACK_UNITY_VERSION = args.unity_version
    warnings.filterwarnings("ignore", category=UnityVersionFallbackWarning)

    bundles = sorted(args.bundle_root.glob("chara_*_battle_unit"))
    profiles = [
        profile
        for bundle in bundles
        for profile in scan_bundle(bundle)
    ]
    payload = {
        "schemaVersion": 1,
        "unityVersion": args.unity_version,
        "scannedBattleUnitCount": len(bundles),
        "profileCount": len(profiles),
        "profiles": profiles,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"wrote {len(profiles)} FaceMeshSwitcher profile(s) "
        f"from {len(bundles)} battle units to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
