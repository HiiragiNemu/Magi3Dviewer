#!/usr/bin/env python3
"""Extract authoritative ReDrive/Cinemachine stage camera presets.

Camera presets are stored separately from ``battle/stage`` geometry bundles in
``AssetBundles/dungeon/camera/camera_preset_*``.  This tool reads only that
bounded directory, preserves ``LevelCameraController.cameraList`` order, and
resolves each entry to its serialized Cinemachine lens and transform chain.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import warnings
from pathlib import Path
from typing import Any, Iterable


SCHEMA = "magius-camera-presets-v1"
RUNTIME_SCHEMA = "magius-camera-preset-runtime-profiles-v1"
DEFAULT_UNITY_VERSION = "2022.3.62f2"
BUNDLE_NAME = re.compile(r"^camera_preset_(\d+)$")


def pointer_path_id(value: Any) -> int:
    if not isinstance(value, dict):
        return 0
    try:
        return int(value.get("m_PathID", value.get("path_id", 0)) or 0)
    except (TypeError, ValueError):
        return 0


def finite_float(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def vector3(value: Any, fallback: tuple[float, float, float] = (0, 0, 0)) -> list[float]:
    if not isinstance(value, dict):
        return [float(item) for item in fallback]
    return [
        finite_float(value.get("x"), fallback[0]),
        finite_float(value.get("y"), fallback[1]),
        finite_float(value.get("z"), fallback[2]),
    ]


def quaternion(value: Any) -> list[float]:
    if not isinstance(value, dict):
        return [0.0, 0.0, 0.0, 1.0]
    return [
        finite_float(value.get("x")),
        finite_float(value.get("y")),
        finite_float(value.get("z")),
        finite_float(value.get("w"), 1.0),
    ]


def multiply_quaternions(left: list[float], right: list[float]) -> list[float]:
    lx, ly, lz, lw = left
    rx, ry, rz, rw = right
    return [
        lw * rx + lx * rw + ly * rz - lz * ry,
        lw * ry - lx * rz + ly * rw + lz * rx,
        lw * rz + lx * ry - ly * rx + lz * rw,
        lw * rw - lx * rx - ly * ry - lz * rz,
    ]


def rotate_vector(rotation: list[float], value: list[float]) -> list[float]:
    x, y, z, w = rotation
    vx, vy, vz = value
    tx = 2.0 * (y * vz - z * vy)
    ty = 2.0 * (z * vx - x * vz)
    tz = 2.0 * (x * vy - y * vx)
    return [
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    ]


def record_index(records: Iterable[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    return {int(record["pathId"]): record for record in records}


def game_object_for_component(
    records: dict[int, dict[str, Any]], component: dict[str, Any]
) -> dict[str, Any] | None:
    return records.get(pointer_path_id(component.get("tree", {}).get("m_GameObject")))


def components_for_game_object(
    records: dict[int, dict[str, Any]], game_object: dict[str, Any] | None
) -> list[dict[str, Any]]:
    if game_object is None:
        return []
    result: list[dict[str, Any]] = []
    for entry in game_object.get("tree", {}).get("m_Component", []):
        pointer = entry.get("component") if isinstance(entry, dict) else None
        record = records.get(pointer_path_id(pointer))
        if record is not None:
            result.append(record)
    return result


def transform_for_game_object(
    records: dict[int, dict[str, Any]], game_object: dict[str, Any] | None
) -> dict[str, Any] | None:
    return next(
        (
            component
            for component in components_for_game_object(records, game_object)
            if component.get("typeName") in {"Transform", "RectTransform"}
        ),
        None,
    )


def game_object_name(game_object: dict[str, Any] | None) -> str | None:
    if game_object is None:
        return None
    value = str(game_object.get("tree", {}).get("m_Name", ""))
    return value or None


def transform_path(
    records: dict[int, dict[str, Any]], transform: dict[str, Any] | None
) -> str | None:
    names: list[str] = []
    seen: set[int] = set()
    current = transform
    while current is not None:
        path_id = int(current["pathId"])
        if path_id in seen:
            break
        seen.add(path_id)
        names.append(game_object_name(game_object_for_component(records, current)) or "?")
        parent_id = pointer_path_id(current.get("tree", {}).get("m_Father"))
        current = records.get(parent_id)
    return "/".join(reversed(names)) if names else None


def local_transform(transform: dict[str, Any] | None) -> dict[str, list[float]] | None:
    if transform is None:
        return None
    tree = transform.get("tree", {})
    return {
        "position": vector3(tree.get("m_LocalPosition")),
        "rotation": quaternion(tree.get("m_LocalRotation")),
        "scale": vector3(tree.get("m_LocalScale"), (1, 1, 1)),
    }


def world_transform(
    records: dict[int, dict[str, Any]],
    transform: dict[str, Any] | None,
    stack: set[int] | None = None,
) -> dict[str, list[float]] | None:
    local = local_transform(transform)
    if transform is None or local is None:
        return None
    path_id = int(transform["pathId"])
    active = set() if stack is None else set(stack)
    if path_id in active:
        return local
    active.add(path_id)
    parent = records.get(pointer_path_id(transform.get("tree", {}).get("m_Father")))
    parent_world = world_transform(records, parent, active)
    if parent_world is None:
        return local
    scaled = [
        local["position"][index] * parent_world["scale"][index]
        for index in range(3)
    ]
    rotated = rotate_vector(parent_world["rotation"], scaled)
    return {
        "position": [
            parent_world["position"][index] + rotated[index]
            for index in range(3)
        ],
        "rotation": multiply_quaternions(
            parent_world["rotation"], local["rotation"]
        ),
        "scale": [
            parent_world["scale"][index] * local["scale"][index]
            for index in range(3)
        ],
    }


def transform_summary(
    records: dict[int, dict[str, Any]], transform: dict[str, Any] | None
) -> dict[str, Any] | None:
    if transform is None:
        return None
    return {
        "pathId": int(transform["pathId"]),
        "path": transform_path(records, transform),
        "local": local_transform(transform),
        "world": world_transform(records, transform),
    }


def lens_summary(tree: dict[str, Any]) -> dict[str, Any]:
    lens = tree.get("m_Lens", {})
    if not isinstance(lens, dict):
        lens = {}
    sensor_size = lens.get("m_SensorSize", {})
    lens_shift = lens.get("LensShift", {})
    return {
        "fieldOfView": finite_float(lens.get("FieldOfView")),
        "orthographicSize": finite_float(lens.get("OrthographicSize")),
        "nearClipPlane": finite_float(lens.get("NearClipPlane")),
        "farClipPlane": finite_float(lens.get("FarClipPlane")),
        "dutch": finite_float(lens.get("Dutch")),
        "modeOverride": int(lens.get("ModeOverride", 0) or 0),
        "gateFit": int(lens.get("GateFit", 0) or 0),
        "focusDistance": finite_float(lens.get("FocusDistance")),
        "lensShift": vector3(
            {"x": lens_shift.get("x", 0), "y": lens_shift.get("y", 0), "z": 0}
            if isinstance(lens_shift, dict)
            else None
        )[:2],
        "sensorSize": vector3(
            {"x": sensor_size.get("x", 0), "y": sensor_size.get("y", 0), "z": 0}
            if isinstance(sensor_size, dict)
            else None
        )[:2],
    }


def component_by_script(
    records: dict[int, dict[str, Any]],
    game_object: dict[str, Any] | None,
    script_name: str,
) -> dict[str, Any] | None:
    return next(
        (
            component
            for component in components_for_game_object(records, game_object)
            if component.get("scriptName") == script_name
        ),
        None,
    )


def transposer_summary(component: dict[str, Any] | None) -> dict[str, Any] | None:
    if component is None:
        return None
    tree = component.get("tree", {})
    return {
        "pathId": int(component["pathId"]),
        "bindingMode": int(tree.get("m_BindingMode", 0) or 0),
        "followOffset": vector3(tree.get("m_FollowOffset")),
        "damping": [
            finite_float(tree.get("m_XDamping")),
            finite_float(tree.get("m_YDamping")),
            finite_float(tree.get("m_ZDamping")),
        ],
    }


def composer_summary(component: dict[str, Any] | None) -> dict[str, Any] | None:
    if component is None:
        return None
    tree = component.get("tree", {})
    return {
        "pathId": int(component["pathId"]),
        "trackedObjectOffset": vector3(tree.get("m_TrackedObjectOffset")),
        "screen": [
            finite_float(tree.get("m_ScreenX"), 0.5),
            finite_float(tree.get("m_ScreenY"), 0.5),
        ],
        "deadZone": [
            finite_float(tree.get("m_DeadZoneWidth")),
            finite_float(tree.get("m_DeadZoneHeight")),
        ],
        "softZone": [
            finite_float(tree.get("m_SoftZoneWidth")),
            finite_float(tree.get("m_SoftZoneHeight")),
        ],
        "bias": [
            finite_float(tree.get("m_BiasX")),
            finite_float(tree.get("m_BiasY")),
        ],
    }


def collider_summary(
    records: dict[int, dict[str, Any]], collider: dict[str, Any] | None
) -> dict[str, Any] | None:
    if collider is None:
        return None
    tree = collider.get("tree", {})
    game_object = game_object_for_component(records, collider)
    return {
        "pathId": int(collider["pathId"]),
        "type": collider.get("typeName"),
        "gameObjectName": game_object_name(game_object),
        "transform": transform_summary(
            records, transform_for_game_object(records, game_object)
        ),
        "center": vector3(tree.get("m_Center")),
        "size": vector3(tree.get("m_Size")),
        "isTrigger": bool(tree.get("m_IsTrigger", 0)),
    }


def extract_camera_entry(
    records: dict[int, dict[str, Any]], entry_path_id: int, index: int
) -> dict[str, Any]:
    entry = records.get(entry_path_id)
    if entry is None:
        raise KeyError(f"cameraList[{index}] path {entry_path_id} is missing")
    entry_type = str(entry.get("scriptName") or entry.get("typeName"))
    if entry_type not in {"LevelCameraBase", "ZoningCamera"}:
        raise ValueError(f"unsupported cameraList[{index}] type {entry_type!r}")
    entry_tree = entry.get("tree", {})
    virtual_path_id = pointer_path_id(entry_tree.get("levelCamera"))
    virtual = records.get(virtual_path_id)
    if virtual is None or virtual.get("scriptName") != "CinemachineVirtualCamera":
        raise KeyError(
            f"cameraList[{index}] does not resolve to CinemachineVirtualCamera"
        )
    virtual_tree = virtual.get("tree", {})
    virtual_game_object = game_object_for_component(records, virtual)
    component_owner_transform = records.get(
        pointer_path_id(virtual_tree.get("m_ComponentOwner"))
    )
    component_owner_game_object = game_object_for_component(
        records, component_owner_transform or {}
    )
    entry_game_object = game_object_for_component(records, entry)
    zoning_collider = records.get(pointer_path_id(entry_tree.get("zoningCollider")))
    return {
        "index": index,
        "role": "default" if index == 0 else "zoning",
        "entryType": entry_type,
        "entryPathId": entry_path_id,
        "entryGameObjectName": game_object_name(entry_game_object),
        "entryTransform": transform_summary(
            records, transform_for_game_object(records, entry_game_object)
        ),
        "virtualCamera": {
            "pathId": virtual_path_id,
            "gameObjectName": game_object_name(virtual_game_object),
            "priority": int(virtual_tree.get("m_Priority", 0) or 0),
            "standbyUpdate": int(virtual_tree.get("m_StandbyUpdate", 0) or 0),
            "lens": lens_summary(virtual_tree),
            "transform": transform_summary(
                records, transform_for_game_object(records, virtual_game_object)
            ),
            "componentOwner": {
                "gameObjectName": game_object_name(component_owner_game_object),
                "transform": transform_summary(records, component_owner_transform),
                "transposer": transposer_summary(
                    component_by_script(
                        records, component_owner_game_object, "CinemachineTransposer"
                    )
                ),
                "composer": composer_summary(
                    component_by_script(
                        records, component_owner_game_object, "CinemachineComposer"
                    )
                ),
            },
        },
        "zoningCollider": collider_summary(records, zoning_collider),
    }


def extract_camera_preset_records(
    normalized_records: Iterable[dict[str, Any]],
    bundle_name: str,
    bundle_length: int,
) -> dict[str, Any]:
    match = BUNDLE_NAME.fullmatch(bundle_name)
    if match is None:
        raise ValueError(f"unsupported camera preset bundle name: {bundle_name}")
    records = record_index(normalized_records)
    controllers = [
        record
        for record in records.values()
        if record.get("scriptName") == "LevelCameraController"
    ]
    if len(controllers) != 1:
        raise ValueError(
            f"expected one LevelCameraController, found {len(controllers)}"
        )
    controller = controllers[0]
    controller_tree = controller.get("tree", {})
    camera_path_ids = [
        pointer_path_id(pointer) for pointer in controller_tree.get("cameraList", [])
    ]
    if not camera_path_ids or any(path_id == 0 for path_id in camera_path_ids):
        raise ValueError("LevelCameraController.cameraList is empty or unresolved")
    controller_game_object = game_object_for_component(records, controller)
    return {
        "cameraPresetId": match.group(1),
        "bundleName": bundle_name,
        "bundleLength": int(bundle_length),
        "controllerPathId": int(controller["pathId"]),
        "controllerGameObjectName": game_object_name(controller_game_object),
        "controllerTransform": transform_summary(
            records, transform_for_game_object(records, controller_game_object)
        ),
        "defaultCameraIndex": 0,
        "cameraCount": len(camera_path_ids),
        "cameraListPathIds": camera_path_ids,
        "cameras": [
            extract_camera_entry(records, path_id, index)
            for index, path_id in enumerate(camera_path_ids)
        ],
    }


def script_name(obj: Any) -> str:
    try:
        return str(obj.read().m_Script.read().m_Name)
    except Exception:
        return ""


def normalize_objects(objects: Iterable[Any]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    supported = {"MonoBehaviour", "GameObject", "Transform", "RectTransform", "BoxCollider"}
    for obj in objects:
        type_name = str(obj.type.name)
        if type_name not in supported:
            continue
        records.append(
            {
                "pathId": int(obj.path_id),
                "typeName": type_name,
                "scriptName": script_name(obj) if type_name == "MonoBehaviour" else "",
                "tree": obj.read_typetree(),
            }
        )
    return records


def extract_bundle(bundle: Path, unity_version: str) -> dict[str, Any]:
    import UnityPy

    UnityPy.config.FALLBACK_UNITY_VERSION = unity_version
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        environment = UnityPy.load(str(bundle))
        records = normalize_objects(environment.objects)
    return extract_camera_preset_records(records, bundle.name, bundle.stat().st_size)


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
    profiles: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for bundle in discover_bundles(bundle_root, include):
        try:
            profiles.append(extract_bundle(bundle, unity_version))
        except Exception as exc:
            errors.append({"bundleName": bundle.name, "error": str(exc)})
    return {
        "schema": SCHEMA,
        "unityVersion": unity_version,
        "bundleRoot": str(bundle_root.resolve()),
        "bundleCount": len(profiles) + len(errors),
        "profileCount": len(profiles),
        "errorCount": len(errors),
        "profiles": sorted(profiles, key=lambda row: row["cameraPresetId"]),
        "errors": errors,
    }


def build_runtime_report(report: dict[str, Any]) -> dict[str, Any]:
    profiles: list[dict[str, Any]] = []
    for profile in report.get("profiles", []):
        default_index = int(profile.get("defaultCameraIndex", 0))
        cameras = profile.get("cameras", [])
        if not (0 <= default_index < len(cameras)):
            continue
        camera = cameras[default_index]
        virtual = camera.get("virtualCamera", {})
        profiles.append(
            {
                "cameraPresetId": str(profile["cameraPresetId"]),
                "bundleName": str(profile["bundleName"]),
                "defaultCameraIndex": default_index,
                "defaultCameraEntryType": str(camera.get("entryType", "")),
                "lens": virtual.get("lens", {}),
                "transform": virtual.get("transform"),
                "transposer": virtual.get("componentOwner", {}).get("transposer"),
                "composer": virtual.get("componentOwner", {}).get("composer"),
            }
        )
    return {
        "schema": RUNTIME_SCHEMA,
        "unityVersion": report.get("unityVersion"),
        "profileCount": len(profiles),
        "profiles": profiles,
    }


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle_root", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runtime-output", type=Path)
    parser.add_argument("--unity-version", default=DEFAULT_UNITY_VERSION)
    parser.add_argument("--include", help="Optional regular expression for bundle names")
    args = parser.parse_args()
    include = re.compile(args.include) if args.include else None
    report = build_report(args.bundle_root, args.unity_version, include)
    write_json(args.output, report)
    if args.runtime_output is not None:
        write_json(args.runtime_output, build_runtime_report(report))
    print(
        json.dumps(
            {
                "bundleCount": report["bundleCount"],
                "profileCount": report["profileCount"],
                "errorCount": report["errorCount"],
                "output": str(args.output.resolve()),
                "runtimeOutput": (
                    str(args.runtime_output.resolve())
                    if args.runtime_output is not None
                    else None
                ),
            },
            ensure_ascii=False,
        )
    )
    return 0 if report["errorCount"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
