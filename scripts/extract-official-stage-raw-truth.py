#!/usr/bin/env python3
"""Extract one official stage's raw rendering truth from a local bundle closure.

The source AssetBundles are opened read-only. Generated JSON stays beside this
invocation's output directory; no source bundle, product runtime file, or host
network setting is changed. Candidate identities are fail-closed against the
checked-in audit manifest before any full closure is parsed.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.metadata
import json
import math
import platform
import re
import struct
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CANDIDATES = REPO_ROOT / "research" / "next-official-stage-candidates.json"
DEFAULT_ASSET_ROOT = Path(r"D:\magia\ma-ex-data\gamedata\AssetBundles")
DEFAULT_MAX_CLOSURE_BYTES = 6 * 1024**3

# Populated from the audited candidate manifest at the start of main(). Keeping
# these as module globals minimizes risk in the already-verified extraction body.
UNITY_FALLBACK = ""
OUT = Path()
ASSET_ROOT = Path()
ANDROID_MANIFEST = Path()
STAGE_ID = ""
STAGE_BUNDLE = ""
MAX_CLOSURE_BYTES = DEFAULT_MAX_CLOSURE_BYTES
EXPECTED_TARGET_ID = 0
EXPECTED_MANIFEST_HASH = ""
EXPECTED_ROOT_BYTES = 0
EXPECTED_ROOT_SHA256 = ""
EXPECTED_ROOT_GAME_OBJECT = ""
EXPECTED_DEPENDENCIES: list[str] = []
RELEASE_PROFILE = ""
CANDIDATES_PATH = Path()
CANDIDATES_SHA256 = ""
UnityPy: Any = None
MeshHandler: Any = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene-id", required=True, help="Candidate sceneId, for example 600_01_00_001")
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES)
    parser.add_argument("--asset-root", type=Path, default=DEFAULT_ASSET_ROOT)
    parser.add_argument("--out", type=Path, help="Output directory for raw-truth.json and audit-summary.json")
    parser.add_argument("--max-closure-bytes", type=int, default=DEFAULT_MAX_CLOSURE_BYTES)
    parser.add_argument(
        "--describe-only",
        action="store_true",
        help="Validate and print the selected candidate without opening AssetBundles",
    )
    return parser.parse_args()


def load_candidate(path: Path, scene_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    matches = [candidate for candidate in document.get("candidates", []) if candidate.get("sceneId") == scene_id]
    if len(matches) != 1:
        raise ValueError(f"scene-id must resolve exactly once: {scene_id!r}; matches={len(matches)}")
    candidate = matches[0]
    required = {
        "bundle", "expectedRootGameObject", "manifestKey", "manifestHash128",
        "directDependencies", "jpRoot", "jpRootSha256",
    }
    missing = sorted(required - candidate.keys())
    if missing:
        raise ValueError(f"candidate is missing required fields: {missing}")
    return document, candidate


def candidate_description(document: dict[str, Any], candidate: dict[str, Any], asset_root: Path) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "releaseProfile": document.get("releaseProfile"),
        "unityVersion": document.get("unityVersion"),
        "sceneId": candidate["sceneId"],
        "stageId": f"battle-{candidate['sceneId'].replace('_', '-')}",
        "bundle": candidate["bundle"],
        "expectedRootGameObject": candidate["expectedRootGameObject"],
        "manifestKey": int(candidate["manifestKey"]),
        "manifestHash128": candidate["manifestHash128"],
        "directDependencies": list(candidate["directDependencies"]),
        "closureFileCount": int(candidate.get("closureFileCount", 0)),
        "closureBytes": int(candidate.get("closureBytesJP", 0)),
        "assetRoot": str(asset_root.resolve()),
        "rootBytes": int(candidate["jpRoot"]["bytes"]),
        "rootSha256": candidate["jpRootSha256"],
    }


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(chunk_size):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def pid(ptr: Any) -> int:
    return int(getattr(ptr, "m_PathID", 0) or 0) if ptr is not None else 0


def fid(ptr: Any) -> int:
    return int(getattr(ptr, "m_FileID", 0) or 0) if ptr is not None else 0


def read_ptr(ptr: Any) -> Any | None:
    if ptr is None or pid(ptr) == 0:
        return None
    try:
        return ptr.read()
    except Exception:
        return None


def vec(value: Any, names: tuple[str, ...] = ("x", "y", "z", "w")) -> list[float]:
    if value is None:
        return []
    result = [float(getattr(value, name)) for name in names if hasattr(value, name)]
    if result:
        return result
    if isinstance(value, (list, tuple)):
        return [float(item) for item in value]
    return []


def color(value: Any) -> list[float]:
    return vec(value, ("r", "g", "b", "a"))


def json_clean(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return {"bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()}
    if isinstance(value, dict):
        return {str(key): json_clean(nested) for key, nested in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_clean(nested) for nested in value]
    vector = vec(value)
    if vector:
        return vector
    if hasattr(value, "__dict__"):
        return {
            str(key): json_clean(nested)
            for key, nested in vars(value).items()
            if not str(key).startswith("_")
        }
    return repr(value)


def stable_float(value: Any) -> float | None:
    number = float(value)
    return round(number, 9) if math.isfinite(number) else None


def streamed_clip_summary(streamed: Any) -> dict[str, Any]:
    """Summarize Unity packed animation words without retaining every keyframe."""
    raw = b"".join(struct.pack("<I", int(word)) for word in streamed.data)
    position = 0
    frame_count = 0
    sentinel_count = 0
    key_count = 0
    times: list[float] = []
    value_min: float | None = None
    value_max: float | None = None
    curve_indices: set[int] = set()
    while position < len(raw):
        if position + 8 > len(raw):
            raise ValueError("streamed animation frame header exceeds payload")
        time, count = struct.unpack_from("<fi", raw, position)
        position += 8
        if count < 0 or position + count * 20 > len(raw):
            raise ValueError("streamed animation key count exceeds payload")
        frame_count += 1
        sentinel = not (-1e20 < time < 1e20 and math.isfinite(time))
        if sentinel:
            sentinel_count += 1
        else:
            times.append(float(time))
        for _ in range(count):
            curve_index = struct.unpack_from("<i", raw, position)[0]
            coefficients = struct.unpack_from("<4f", raw, position + 4)
            position += 20
            curve_indices.add(curve_index)
            key_count += 1
            value = float(coefficients[3])
            if math.isfinite(value):
                value_min = value if value_min is None else min(value_min, value)
                value_max = value if value_max is None else max(value_max, value)
    if position != len(raw):
        raise ValueError("streamed animation payload was not consumed exactly")
    return {
        "wordCount": len(streamed.data),
        "byteCount": len(raw),
        "curveCount": int(streamed.curveCount),
        "frameCount": frame_count,
        "sentinelFrameCount": sentinel_count,
        "keyCount": key_count,
        "firstTime": stable_float(min(times)) if times else None,
        "lastTime": stable_float(max(times)) if times else None,
        "curveIndexMin": min(curve_indices) if curve_indices else None,
        "curveIndexMax": max(curve_indices) if curve_indices else None,
        "serializedValueMin": stable_float(value_min) if value_min is not None else None,
        "serializedValueMax": stable_float(value_max) if value_max is not None else None,
    }


def packed_clip_record(obj: Any) -> dict[str, Any]:
    muscle = getattr(obj, "m_MuscleClip", None)
    clip = getattr(muscle, "m_Clip", None)
    packed = getattr(clip, "data", None)
    if packed is None:
        return {"present": False}
    streamed = packed.m_StreamedClip
    dense = packed.m_DenseClip
    constants = list(packed.m_ConstantClip.data)
    bindings = list(obj.m_ClipBindingConstant.genericBindings)
    dense_values = [float(value) for value in dense.m_SampleArray if math.isfinite(float(value))]
    constant_values = [float(value) for value in constants if math.isfinite(float(value))]
    return {
        "present": True,
        "streamed": streamed_clip_summary(streamed),
        "dense": {
            "curveCount": int(dense.m_CurveCount),
            "frameCount": int(dense.m_FrameCount),
            "sampleRate": stable_float(dense.m_SampleRate),
            "beginTime": stable_float(dense.m_BeginTime),
            "sampleCount": len(dense.m_SampleArray),
            "serializedValueMin": stable_float(min(dense_values)) if dense_values else None,
            "serializedValueMax": stable_float(max(dense_values)) if dense_values else None,
        },
        "constant": {
            "scalarCount": len(constants),
            "serializedValueMin": stable_float(min(constant_values)) if constant_values else None,
            "serializedValueMax": stable_float(max(constant_values)) if constant_values else None,
        },
        "bindingCount": len(bindings),
        "bindings": [
            {
                "index": index,
                "pathHash": int(binding.path),
                "attribute": int(binding.attribute),
                "typeId": int(binding.typeID),
                "customType": int(binding.customType),
                "isPPtrCurve": int(binding.isPPtrCurve),
            }
            for index, binding in enumerate(bindings)
        ],
    }


def hash128_bytes(value: dict[str, Any]) -> str:
    return "".join(f"{int(value[f'bytes[{index}]']):02x}" for index in range(16))


def quat_matrix(rotation: list[float]) -> list[list[float]]:
    x, y, z, w = rotation
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    return [
        [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 0.0],
        [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 0.0],
        [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def trs_matrix(position: list[float], rotation: list[float], scale: list[float]) -> list[list[float]]:
    result = quat_matrix(rotation)
    for row in range(3):
        for column in range(3):
            result[row][column] *= scale[column]
    result[0][3], result[1][3], result[2][3] = position
    return result


def mat_mul(left: list[list[float]], right: list[list[float]]) -> list[list[float]]:
    return [[sum(left[row][k] * right[k][column] for k in range(4)) for column in range(4)] for row in range(4)]


def normalized_forward(matrix: list[list[float]]) -> list[float]:
    value = [matrix[0][2], matrix[1][2], matrix[2][2]]
    length = math.sqrt(sum(item * item for item in value)) or 1.0
    return [item / length for item in value]


def main() -> int:
    global UNITY_FALLBACK, OUT, ASSET_ROOT, ANDROID_MANIFEST, STAGE_ID, STAGE_BUNDLE
    global MAX_CLOSURE_BYTES, EXPECTED_TARGET_ID, EXPECTED_MANIFEST_HASH
    global EXPECTED_ROOT_BYTES, EXPECTED_ROOT_SHA256, EXPECTED_ROOT_GAME_OBJECT
    global EXPECTED_DEPENDENCIES, RELEASE_PROFILE, CANDIDATES_PATH, CANDIDATES_SHA256
    global UnityPy, MeshHandler

    args = parse_args()
    CANDIDATES_PATH = args.candidates.resolve()
    ASSET_ROOT = args.asset_root.resolve()
    document, candidate = load_candidate(CANDIDATES_PATH, args.scene_id)
    description = candidate_description(document, candidate, ASSET_ROOT)
    if args.describe_only:
        print(json.dumps(description, ensure_ascii=False, indent=2))
        return 0
    if args.out is None:
        raise ValueError("--out is required unless --describe-only is used")
    if args.max_closure_bytes <= 0:
        raise ValueError("--max-closure-bytes must be positive")

    UnityPy = importlib.import_module("UnityPy")
    MeshHandler = importlib.import_module("UnityPy.helpers.MeshHelper").MeshHandler

    UNITY_FALLBACK = str(document["unityVersion"])
    RELEASE_PROFILE = str(document["releaseProfile"])
    OUT = args.out.resolve()
    ANDROID_MANIFEST = ASSET_ROOT / "Android"
    STAGE_ID = description["stageId"]
    STAGE_BUNDLE = str(candidate["bundle"])
    MAX_CLOSURE_BYTES = int(args.max_closure_bytes)
    EXPECTED_TARGET_ID = int(candidate["manifestKey"])
    EXPECTED_MANIFEST_HASH = str(candidate["manifestHash128"])
    EXPECTED_ROOT_BYTES = int(candidate["jpRoot"]["bytes"])
    EXPECTED_ROOT_SHA256 = str(candidate["jpRootSha256"])
    EXPECTED_ROOT_GAME_OBJECT = str(candidate["expectedRootGameObject"])
    EXPECTED_DEPENDENCIES = [str(item) for item in candidate["directDependencies"]]
    CANDIDATES_SHA256 = sha256_file(CANDIDATES_PATH)
    UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_FALLBACK

    OUT.mkdir(parents=True, exist_ok=True)
    if not ANDROID_MANIFEST.is_file():
        raise FileNotFoundError("Android manifest is missing")

    manifest_env = UnityPy.load(str(ANDROID_MANIFEST))
    manifest_reader = next(reader for reader in manifest_env.objects if reader.type.name == "AssetBundleManifest")
    manifest_tree = manifest_reader.read_typetree()
    names = {int(index): str(name) for index, name in manifest_tree["AssetBundleNames"]}
    infos = {int(index): info for index, info in manifest_tree["AssetBundleInfos"]}
    target_id = next(index for index, name in names.items() if name == STAGE_BUNDLE)
    target_info = infos[target_id]
    dependency_ids = [int(item) for item in target_info["AssetBundleDependencies"]]
    dependencies = [names[index] for index in dependency_ids]
    manifest_hash = hash128_bytes(target_info["AssetBundleHash"])
    if target_id != EXPECTED_TARGET_ID:
        raise RuntimeError(f"manifest target id drift: {target_id} != {EXPECTED_TARGET_ID}")
    if manifest_hash != EXPECTED_MANIFEST_HASH:
        raise RuntimeError(f"manifest Hash128 drift: {manifest_hash} != {EXPECTED_MANIFEST_HASH}")
    if dependencies != EXPECTED_DEPENDENCIES:
        raise RuntimeError("manifest dependency order differs from the confirmed stage-candidate audit")

    relatives = [STAGE_BUNDLE, *dependencies]
    paths = [ASSET_ROOT.joinpath(*relative.split("/")) for relative in relatives]
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        raise FileNotFoundError(missing)
    closure_bytes = sum(path.stat().st_size for path in paths)
    if closure_bytes > MAX_CLOSURE_BYTES:
        raise RuntimeError(f"closure exceeds configured byte bound: {closure_bytes} > {MAX_CLOSURE_BYTES}")

    cab_to_bundle: dict[str, str] = {}
    inputs: list[dict[str, Any]] = []
    for relative, path in zip(relatives, paths):
        one = UnityPy.load(str(path))
        serialized_files = [
            name
            for outer in one.files.values()
            for name, nested in getattr(outer, "files", {}).items()
            if type(nested).__name__ == "SerializedFile"
        ]
        for cab in serialized_files:
            cab_to_bundle[cab] = relative
        counts = Counter(reader.type.name for reader in one.objects)
        inputs.append(
            {
                "relative": relative,
                "path": str(path),
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
                "serializedFiles": serialized_files,
                "objectCount": len(one.objects),
                "objectTypeCounts": dict(sorted(counts.items())),
            }
        )

    if inputs[0]["sha256"] != EXPECTED_ROOT_SHA256 or inputs[0]["bytes"] != EXPECTED_ROOT_BYTES:
        raise RuntimeError("stage source identity differs from the confirmed stage-candidate audit")

    environment = UnityPy.load(*[str(path) for path in paths])
    stage_cab = inputs[0]["serializedFiles"][0]
    stage_readers = [reader for reader in environment.objects if reader.assets_file.name == stage_cab]
    stage_by_pid = {int(reader.path_id): reader for reader in stage_readers}
    stage_serialized = next(
        nested
        for outer in environment.files.values()
        for name, nested in getattr(outer, "files", {}).items()
        if name == stage_cab
    )
    stage_counts = Counter(reader.type.name for reader in stage_readers)
    closure_counts = Counter(reader.type.name for reader in environment.objects)

    external_table: list[dict[str, Any]] = []
    for index, external in enumerate(stage_serialized.externals, start=1):
        match = re.search(r"(CAB-[0-9a-f]+)", external.path, re.I)
        cab = match.group(1) if match else external.name
        external_table.append(
            {
                "fileId": index,
                "externalPath": external.path,
                "cab": cab,
                "manifestBundle": cab_to_bundle.get(cab),
            }
        )
    external_bundles = [row["manifestBundle"] for row in external_table]
    external_set = {item for item in external_bundles if item}
    manifest_set = set(dependencies)
    unmapped_externals = [row for row in external_table if row["manifestBundle"] is None]
    manifest_only_dependencies = sorted(manifest_set - external_set)
    external_only_dependencies = sorted(external_set - manifest_set)

    def pointer_record(ptr: Any) -> dict[str, Any]:
        file_id, path_id = fid(ptr), pid(ptr)
        record: dict[str, Any] = {"fileId": file_id, "pathId": str(path_id)}
        if path_id == 0:
            record["null"] = True
            return record
        try:
            reader = ptr.deref()
            value = ptr.read()
            resolved_name = str(getattr(value, "m_Name", ""))
            resolved_name_source = "m_Name"
            if reader.type.name == "Shader" and not resolved_name:
                shader_tree = reader.read_typetree()
                resolved_name = str(shader_tree.get("m_ParsedForm", {}).get("m_Name", ""))
                resolved_name_source = "m_ParsedForm.m_Name"
            record.update(
                {
                    "resolved": True,
                    "resolvedType": reader.type.name,
                    "resolvedName": resolved_name,
                    "resolvedNameSource": resolved_name_source,
                    "resolvedCab": reader.assets_file.name,
                    "resolvedSourceBundle": cab_to_bundle.get(reader.assets_file.name),
                }
            )
        except Exception as exc:
            record.update({"resolved": False, "errorType": type(exc).__name__, "error": repr(exc)})
        return record

    game_objects: dict[int, dict[str, Any]] = {}
    transforms: dict[int, dict[str, Any]] = {}
    component_go: dict[int, int] = {}
    for reader in stage_readers:
        try:
            obj = reader.read()
        except Exception:
            continue
        if reader.type.name == "GameObject":
            game_objects[int(reader.path_id)] = {
                "pathId": str(reader.path_id),
                "name": str(obj.m_Name),
                "active": bool(getattr(obj, "m_IsActive", True)),
                "layer": int(getattr(obj, "m_Layer", 0)),
            }
            continue
        go_id = pid(getattr(obj, "m_GameObject", None))
        if go_id:
            component_go[int(reader.path_id)] = go_id
        if reader.type.name == "Transform":
            transforms[int(reader.path_id)] = {
                "pathId": int(reader.path_id),
                "gameObjectPathId": go_id,
                "fatherTransformPathId": pid(getattr(obj, "m_Father", None)),
                "localPosition": vec(obj.m_LocalPosition)[:3],
                "localRotation": vec(obj.m_LocalRotation),
                "localScale": vec(obj.m_LocalScale)[:3],
            }

    transform_by_go = {item["gameObjectPathId"]: item for item in transforms.values() if item["gameObjectPathId"]}
    go_by_transform = {item["pathId"]: item["gameObjectPathId"] for item in transforms.values()}

    def hierarchy_path(go_id: int) -> str:
        names_in_path: list[str] = []
        seen: set[int] = set()
        current = go_id
        while current and current not in seen:
            seen.add(current)
            if current in game_objects:
                names_in_path.append(game_objects[current]["name"])
            transform = transform_by_go.get(current)
            if transform is None:
                break
            current = go_by_transform.get(transform["fatherTransformPathId"], 0)
        return "/".join(reversed(names_in_path))

    root_game_objects = []
    for transform in transforms.values():
        if transform["fatherTransformPathId"] != 0:
            continue
        go_id = transform["gameObjectPathId"]
        if not go_id:
            continue
        root_game_objects.append(
            {
                **game_objects.get(go_id, {"pathId": str(go_id), "name": ""}),
                "hierarchyPath": hierarchy_path(go_id),
                "transformPathId": str(transform["pathId"]),
                "immediateChildCount": sum(
                    1 for candidate in transforms.values()
                    if candidate["fatherTransformPathId"] == transform["pathId"]
                ),
            }
        )
    root_names = [row["name"] for row in root_game_objects]
    if EXPECTED_ROOT_GAME_OBJECT not in root_names:
        raise RuntimeError(
            f"expected root GameObject missing: {EXPECTED_ROOT_GAME_OBJECT!r}; roots={root_names!r}"
        )

    world_cache: dict[int, list[list[float]]] = {}

    def world_matrix(transform_id: int) -> list[list[float]]:
        if transform_id in world_cache:
            return world_cache[transform_id]
        transform = transforms[transform_id]
        local = trs_matrix(transform["localPosition"], transform["localRotation"], transform["localScale"])
        father = transform["fatherTransformPathId"]
        result = mat_mul(world_matrix(father), local) if father in transforms else local
        world_cache[transform_id] = result
        return result

    materials: list[dict[str, Any]] = []
    for reader in stage_readers:
        if reader.type.name != "Material":
            continue
        obj = reader.read()
        textures = []
        for key, tex_env in obj.m_SavedProperties.m_TexEnvs:
            textures.append(
                {
                    "property": str(key),
                    "scale": vec(tex_env.m_Scale)[:2],
                    "offset": vec(tex_env.m_Offset)[:2],
                    "pointer": pointer_record(tex_env.m_Texture),
                }
            )
        materials.append(
            {
                "pathId": str(reader.path_id),
                "name": str(obj.m_Name),
                "customRenderQueue": int(obj.m_CustomRenderQueue),
                "validKeywords": list(getattr(obj, "m_ValidKeywords", []) or []),
                "invalidKeywords": list(getattr(obj, "m_InvalidKeywords", []) or []),
                "disabledShaderPasses": list(getattr(obj, "m_DisabledShaderPasses", []) or []),
                "doubleSidedGI": bool(getattr(obj, "m_DoubleSidedGI", False)),
                "enableInstancingVariants": bool(getattr(obj, "m_EnableInstancingVariants", False)),
                "shader": pointer_record(obj.m_Shader),
                "textures": textures,
                "floats": {str(key): float(value) for key, value in obj.m_SavedProperties.m_Floats},
                "ints": {str(key): int(value) for key, value in getattr(obj.m_SavedProperties, "m_Ints", [])},
                "colors": {str(key): color(value) for key, value in obj.m_SavedProperties.m_Colors},
            }
        )

    images: list[dict[str, Any]] = []
    for reader in environment.objects:
        if reader.type.name not in ("Texture2D", "Cubemap"):
            continue
        obj = reader.read()
        row: dict[str, Any] = {
            "type": reader.type.name,
            "name": str(obj.m_Name),
            "pathId": str(reader.path_id),
            "cab": reader.assets_file.name,
            "sourceBundle": cab_to_bundle.get(reader.assets_file.name),
            "width": int(obj.m_Width),
            "height": int(obj.m_Height),
            "textureFormat": int(obj.m_TextureFormat),
            "mipCount": int(obj.m_MipCount),
            "imageCount": int(getattr(obj, "m_ImageCount", 1)),
            "completeImageSize": int(obj.m_CompleteImageSize),
            "streamData": json_clean(getattr(obj, "m_StreamData", None)),
        }
        try:
            encoded = bytes(obj.get_image_data())
            row.update({"encodedImageDataBytes": len(encoded), "encodedImageDataSha256": hashlib.sha256(encoded).hexdigest()})
        except Exception as exc:
            row["encodedImageDataError"] = repr(exc)
        try:
            decoded = obj.image.convert("RGBA")
            row.update({"decodedFirstImageSize": list(decoded.size), "decodedFirstImageRgbaSha256": hashlib.sha256(decoded.tobytes()).hexdigest()})
        except Exception as exc:
            row["decodeError"] = repr(exc)
        images.append(row)

    renderer_readers: dict[int, Any] = {}
    mesh_filter_by_go: dict[int, Any] = {}
    for reader in stage_readers:
        if reader.type.name == "MeshFilter":
            mesh_filter_by_go[component_go[int(reader.path_id)]] = reader
        elif reader.type.name in ("MeshRenderer", "SkinnedMeshRenderer"):
            renderer_readers[int(reader.path_id)] = reader

    renderer_inventory: list[dict[str, Any]] = []
    for renderer_id, renderer_reader in sorted(renderer_readers.items()):
        obj = renderer_reader.read()
        go_id = component_go.get(renderer_id, 0)
        mesh_ptr = obj.m_Mesh if renderer_reader.type.name == "SkinnedMeshRenderer" else None
        if mesh_ptr is None and go_id in mesh_filter_by_go:
            mesh_ptr = mesh_filter_by_go[go_id].read().m_Mesh
        direct_st = getattr(obj, "m_LightmapTilingOffset", None)
        renderer_inventory.append(
            {
                "pathId": str(renderer_id),
                "type": renderer_reader.type.name,
                "gameObjectPathId": str(go_id),
                "gameObject": game_objects.get(go_id, {}).get("name"),
                "hierarchyPath": hierarchy_path(go_id) if go_id else None,
                "enabled": bool(getattr(obj, "m_Enabled", True)),
                "castShadows": int(getattr(obj, "m_CastShadows", 0)),
                "receiveShadows": bool(getattr(obj, "m_ReceiveShadows", False)),
                "staticShadowCaster": bool(getattr(obj, "m_StaticShadowCaster", False)),
                "lightProbeUsage": int(getattr(obj, "m_LightProbeUsage", 0)),
                "reflectionProbeUsage": int(getattr(obj, "m_ReflectionProbeUsage", 0)),
                "rayTracingMode": int(getattr(obj, "m_RayTracingMode", 0)),
                "sortingLayerId": int(getattr(obj, "m_SortingLayerID", 0)),
                "sortingOrder": int(getattr(obj, "m_SortingOrder", 0)),
                "directLightmapIndex": (
                    int(getattr(obj, "m_LightmapIndex")) if hasattr(obj, "m_LightmapIndex") else None
                ),
                "directLightmapScaleOffset": vec(direct_st) if direct_st is not None else None,
                "mesh": pointer_record(mesh_ptr),
                "materials": [pointer_record(ptr) for ptr in getattr(obj, "m_Materials", [])],
            }
        )

    mono_records: list[dict[str, Any]] = []
    mono_trees: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for reader in stage_readers:
        if reader.type.name != "MonoBehaviour":
            continue
        obj = reader.read()
        script = read_ptr(getattr(obj, "m_Script", None))
        class_name = str(getattr(script, "m_ClassName", "") or getattr(script, "m_Name", ""))
        tree = json_clean(reader.read_typetree())
        canonical = json.dumps(tree, sort_keys=True, separators=(",", ":")).encode()
        go_id = component_go.get(int(reader.path_id), 0)
        record = {
            "pathId": str(reader.path_id),
            "className": class_name,
            "name": str(getattr(obj, "m_Name", "")),
            "gameObject": game_objects.get(go_id, {}).get("name"),
            "hierarchyPath": hierarchy_path(go_id) if go_id else None,
            "enabled": bool(getattr(obj, "m_Enabled", True)),
            "typetreeSha256": hashlib.sha256(canonical).hexdigest(),
            "keys": list(tree.keys()),
        }
        mono_records.append(record)
        mono_trees[class_name].append(tree)

    focused_classes = {
        "PrefabLightmapData", "ReDriveVolume", "Volume", "VolumeProfile", "Bloom",
        "ColorAdjustments", "Tonemapping", "Vignette", "GlobalVolumeController",
        "VolumetricLightBeam", "VolumetricDustParticles", "LinearRotater",
        "UniversalAdditionalLightData", "BattleBackground",
    }
    focused_mono = {name: trees for name, trees in mono_trees.items() if name in focused_classes}

    lightmap_tree = (mono_trees.get("PrefabLightmapData") or [None])[0]
    renderer_bindings: list[dict[str, Any]] = []
    lightmap_mesh_ids: set[int] = set()
    if lightmap_tree:
        for info in lightmap_tree.get("m_RendererInfo", []):
            renderer_id = int(info["renderer"]["m_PathID"])
            renderer_reader = renderer_readers.get(renderer_id)
            if renderer_reader is None:
                continue
            renderer_obj = renderer_reader.read()
            go_id = component_go[renderer_id]
            mesh_ptr = renderer_obj.m_Mesh if renderer_reader.type.name == "SkinnedMeshRenderer" else None
            if mesh_ptr is None and go_id in mesh_filter_by_go:
                mesh_ptr = mesh_filter_by_go[go_id].read().m_Mesh
            mesh_id = pid(mesh_ptr)
            if mesh_id:
                lightmap_mesh_ids.add(mesh_id)
            st = info["lightmapOffsetScale"]
            renderer_bindings.append(
                {
                    "rendererPathId": str(renderer_id),
                    "rendererType": renderer_reader.type.name,
                    "rendererHierarchyPath": hierarchy_path(go_id),
                    "lightmapIndex": int(info["lightmapIndex"]),
                    "lightmapScaleOffset": [float(st[key]) for key in ("x", "y", "z", "w")],
                    "meshPathId": str(mesh_id),
                }
            )

    mesh_inventory: list[dict[str, Any]] = []
    mesh_failures: list[dict[str, Any]] = []
    mesh_by_id: dict[int, dict[str, Any]] = {}
    for reader in stage_readers:
        if reader.type.name != "Mesh":
            continue
        obj = reader.read()
        try:
            handler = MeshHandler(obj)
            handler.process()
            vertex_data = getattr(obj, "m_VertexData", None)
            active_channels = []
            for index, channel in enumerate(getattr(vertex_data, "m_Channels", []) or []):
                raw_dimension = int(channel.dimension)
                if raw_dimension == 0:
                    continue
                active_channels.append(
                    {
                        "index": index,
                        "stream": int(channel.stream),
                        "offset": int(channel.offset),
                        "format": int(channel.format),
                        "rawDimension": raw_dimension,
                        "dimension": raw_dimension & 0x0F,
                    }
                )
            stream_data = getattr(obj, "m_StreamData", None)
            compressed_mesh = getattr(obj, "m_CompressedMesh", None)
            compressed_uv = getattr(compressed_mesh, "m_UV", None) if compressed_mesh is not None else None
            row = {
                "pathId": str(reader.path_id),
                "name": str(obj.m_Name),
                "vertexCount": int(handler.m_VertexCount),
                "uv0Count": len(handler.m_UV0 or []),
                "uv1Count": len(handler.m_UV1 or []),
                "normalCount": len(handler.m_Normals or []),
                "tangentCount": len(handler.m_Tangents or []),
                "colorCount": len(handler.m_Colors or []),
                "usedByLightmap": int(reader.path_id) in lightmap_mesh_ids,
                "activeVertexChannels": active_channels,
                "hasSerializedUv0Channel": any(channel["index"] == 4 for channel in active_channels),
                "hasSerializedUv1Channel": any(channel["index"] == 5 for channel in active_channels),
                "vertexStream": {
                    "path": str(getattr(stream_data, "path", "")),
                    "offset": int(getattr(stream_data, "offset", 0) or 0),
                    "size": int(getattr(stream_data, "size", 0) or 0),
                },
                "compressedUv": {
                    "uvInfo": int(getattr(compressed_mesh, "m_UVInfo", 0) or 0),
                    "numItems": int(getattr(compressed_uv, "m_NumItems", 0) or 0),
                    "dataCount": len(getattr(compressed_uv, "m_Data", []) or []),
                },
            }
            mesh_inventory.append(row)
            mesh_by_id[int(reader.path_id)] = row
        except Exception as exc:
            mesh_failures.append({"pathId": str(reader.path_id), "name": str(getattr(obj, "m_Name", "")), "errorType": type(exc).__name__, "error": repr(exc)})
    for binding in renderer_bindings:
        mesh = mesh_by_id.get(int(binding["meshPathId"]))
        binding["sourceVertexCount"] = mesh["vertexCount"] if mesh else None
        binding["sourceHasUv1"] = bool(mesh and mesh["uv1Count"] == mesh["vertexCount"] and mesh["vertexCount"] > 0)

    animation_clips: list[dict[str, Any]] = []
    for reader in stage_readers:
        if reader.type.name != "AnimationClip":
            continue
        obj = reader.read()
        muscle = getattr(obj, "m_MuscleClip", None)
        clip = getattr(muscle, "m_Clip", None)
        animation_clips.append(
            {
                "pathId": str(reader.path_id),
                "name": str(obj.m_Name),
                "sampleRate": float(obj.m_SampleRate),
                "startTime": float(getattr(muscle, "m_StartTime", 0.0)),
                "stopTime": float(getattr(muscle, "m_StopTime", 0.0)),
                "legacy": bool(obj.m_Legacy),
                "wrapMode": int(obj.m_WrapMode),
                "loopTime": bool(getattr(clip, "m_LoopTime", False)),
                "floatCurveCount": len(obj.m_FloatCurves),
                "positionCurveCount": len(obj.m_PositionCurves),
                "rotationCurveCount": len(obj.m_RotationCurves),
                "scaleCurveCount": len(obj.m_ScaleCurves),
                "pptrCurveCount": len(obj.m_PPtrCurves),
                "packed": packed_clip_record(obj),
            }
        )

    controllers: list[dict[str, Any]] = []
    for reader in stage_readers:
        if reader.type.name == "AnimatorController":
            tree = json_clean(reader.read_typetree())
            controllers.append({"pathId": str(reader.path_id), "name": str(tree.get("m_Name", "")), "typetree": tree})

    animators: list[dict[str, Any]] = []
    for reader in stage_readers:
        if reader.type.name != "Animator":
            continue
        obj = reader.read()
        go_id = component_go[int(reader.path_id)]
        animators.append(
            {
                "pathId": str(reader.path_id),
                "gameObject": game_objects[go_id]["name"],
                "hierarchyPath": hierarchy_path(go_id),
                "enabled": bool(obj.m_Enabled),
                "controller": pointer_record(obj.m_Controller),
                "avatar": pointer_record(obj.m_Avatar),
                "cullingMode": int(obj.m_CullingMode),
                "updateMode": int(obj.m_UpdateMode),
                "applyRootMotion": bool(obj.m_ApplyRootMotion),
            }
        )

    lights: list[dict[str, Any]] = []
    for reader in stage_readers:
        if reader.type.name != "Light":
            continue
        obj = reader.read()
        go_id = component_go[int(reader.path_id)]
        transform = transform_by_go[go_id]
        world = world_matrix(transform["pathId"])
        shadow = obj.m_Shadows
        lights.append(
            {
                "pathId": str(reader.path_id),
                "name": game_objects[go_id]["name"],
                "hierarchyPath": hierarchy_path(go_id),
                "enabled": bool(obj.m_Enabled),
                "type": int(obj.m_Type),
                "shape": int(obj.m_Shape),
                "color": color(obj.m_Color),
                "intensity": float(obj.m_Intensity),
                "range": float(obj.m_Range),
                "spotAngle": float(obj.m_SpotAngle),
                "innerSpotAngle": float(obj.m_InnerSpotAngle),
                "cullingMask": int(obj.m_CullingMask.m_Bits),
                "lightmapping": int(obj.m_Lightmapping),
                "bounceIntensity": float(obj.m_BounceIntensity),
                "cookie": pointer_record(obj.m_Cookie),
                "shadow": {
                    "type": int(shadow.m_Type), "strength": float(shadow.m_Strength),
                    "bias": float(shadow.m_Bias), "normalBias": float(shadow.m_NormalBias),
                    "nearPlane": float(shadow.m_NearPlane),
                },
                "localPosition": transform["localPosition"],
                "localRotation": transform["localRotation"],
                "worldPosition": [world[0][3], world[1][3], world[2][3]],
                "worldForward": normalized_forward(world),
            }
        )

    probes: list[dict[str, Any]] = []
    for reader in stage_readers:
        if reader.type.name != "ReflectionProbe":
            continue
        obj = reader.read()
        go_id = component_go[int(reader.path_id)]
        probes.append(
            {
                "pathId": str(reader.path_id), "name": game_objects[go_id]["name"],
                "hierarchyPath": hierarchy_path(go_id), "enabled": bool(obj.m_Enabled),
                "type": int(obj.m_Type), "mode": int(obj.m_Mode), "refreshMode": int(obj.m_RefreshMode),
                "resolution": int(obj.m_Resolution), "boxSize": vec(obj.m_BoxSize)[:3],
                "boxOffset": vec(obj.m_BoxOffset)[:3], "nearClip": float(obj.m_NearClip),
                "farClip": float(obj.m_FarClip), "intensityMultiplier": float(obj.m_IntensityMultiplier),
                "blendDistance": float(obj.m_BlendDistance), "boxProjection": bool(obj.m_BoxProjection),
                "hdr": bool(obj.m_HDR), "bakedTexture": pointer_record(obj.m_BakedTexture),
                "customBakedTexture": pointer_record(obj.m_CustomBakedTexture),
            }
        )

    particle_renderers: dict[int, dict[str, Any]] = {}
    for reader in stage_readers:
        if reader.type.name != "ParticleSystemRenderer":
            continue
        obj = reader.read()
        go_id = component_go[int(reader.path_id)]
        particle_renderers[go_id] = {
            "pathId": str(reader.path_id), "enabled": bool(obj.m_Enabled),
            "renderMode": int(obj.m_RenderMode), "sortMode": int(obj.m_SortMode),
            "sortingFudge": float(obj.m_SortingFudge),
            "materials": [pointer_record(ptr) for ptr in obj.m_Materials],
            "mesh": pointer_record(obj.m_Mesh), "vertexStreams": list(obj.m_VertexStreams),
        }
    particles: list[dict[str, Any]] = []
    for reader in stage_readers:
        if reader.type.name != "ParticleSystem":
            continue
        tree = json_clean(reader.read_typetree())
        go_id = component_go[int(reader.path_id)]
        particles.append(
            {
                "pathId": str(reader.path_id), "gameObject": game_objects[go_id]["name"],
                "hierarchyPath": hierarchy_path(go_id),
                "typetreeSha256": hashlib.sha256(json.dumps(tree, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
                "typetree": tree, "renderer": particle_renderers.get(go_id),
            }
        )

    unresolved_material_pointers = []
    for material in materials:
        for scope, pointer in [("shader", material["shader"]), *[(item["property"], item["pointer"]) for item in material["textures"]]]:
            if pointer.get("pathId") != "0" and not pointer.get("resolved", False):
                unresolved_material_pointers.append({"material": material["name"], "scope": scope, "pointer": pointer})

    raw_truth = {
        "schemaVersion": 1,
        "stageId": STAGE_ID,
        "method": {
            "networkUsed": False, "downloadedBytes": 0, "sourceBundlesCopied": False,
            "writeBoundary": str(OUT), "closureByteLimit": MAX_CLOSURE_BYTES,
            "unityFallbackVersion": UNITY_FALLBACK, "python": sys.version.split()[0],
            "releaseProfile": RELEASE_PROFILE,
            "candidateManifest": str(CANDIDATES_PATH),
            "candidateManifestSha256": CANDIDATES_SHA256,
            "platform": platform.platform(), "unityPy": importlib.metadata.version("UnityPy"),
        },
        "manifest": {
            "path": str(ANDROID_MANIFEST), "bytes": ANDROID_MANIFEST.stat().st_size,
            "sha256": sha256_file(ANDROID_MANIFEST), "targetId": target_id,
            "targetName": STAGE_BUNDLE, "hash128BytesHex": manifest_hash,
            "dependencyIds": dependency_ids, "dependencies": dependencies,
        },
        "closure": {
            "fileCount": len(paths), "totalBytes": closure_bytes,
            "withinConfiguredBound": closure_bytes <= MAX_CLOSURE_BYTES, "inputs": inputs,
            "objectCount": len(environment.objects), "objectTypeCounts": dict(sorted(closure_counts.items())),
            "serializedExternalTable": external_table,
            "externalTableAllMapped": not unmapped_externals,
            "externalTableIsManifestSubset": not external_only_dependencies and not unmapped_externals,
            "manifestDependenciesNotInStageExternalTable": manifest_only_dependencies,
            "stageExternalBundlesNotInManifest": external_only_dependencies,
        },
        "stage": {
            "cab": stage_cab, "objectCount": len(stage_readers),
            "objectTypeCounts": dict(sorted(stage_counts.items())),
            "gameObjectCount": len(game_objects), "transformCount": len(transforms),
            "rootGameObjects": root_game_objects,
        },
        "materials": materials,
        "renderers": renderer_inventory,
        "unresolvedMaterialPointers": unresolved_material_pointers,
        "images": images,
        "meshes": {"inventory": mesh_inventory, "decodeFailures": mesh_failures},
        "lightmap": {
            "componentPresent": lightmap_tree is not None,
            "rendererCount": len(renderer_bindings), "renderers": renderer_bindings,
            "lightmaps": lightmap_tree.get("m_Lightmaps", []) if lightmap_tree else [],
            "directionalLightmaps": lightmap_tree.get("m_LightmapsDir", []) if lightmap_tree else [],
            "shadowMasks": lightmap_tree.get("m_ShadowMasks", []) if lightmap_tree else [],
            "lightInfo": lightmap_tree.get("m_LightInfo", []) if lightmap_tree else [],
        },
        "animation": {"clips": animation_clips, "controllers": controllers, "animators": animators},
        "lights": lights,
        "reflectionProbes": probes,
        "particleSystems": particles,
        "monoBehaviours": {
            "count": len(mono_records),
            "classCounts": dict(sorted(Counter(row["className"] for row in mono_records).items())),
            "records": mono_records, "focusedTypetrees": focused_mono,
        },
    }
    atomic_json(OUT / "raw-truth.json", raw_truth)

    summary = {
        "stageBundleSha256": inputs[0]["sha256"],
        "closureFileCount": len(paths), "closureBytes": closure_bytes,
        "stageCab": stage_cab, "stageObjectCount": len(stage_readers),
        "stageTypeCounts": dict(sorted(stage_counts.items())),
        "manifestDependencyCount": len(dependencies), "stageExternalTableCount": len(external_table),
        "manifestOnlyDependencies": manifest_only_dependencies,
        "externalTableAllMapped": not unmapped_externals,
        "materialCount": len(materials), "rendererCount": len(renderer_inventory),
        "unresolvedMaterialPointerCount": len(unresolved_material_pointers),
        "imageCount": len(images), "meshCount": len(mesh_inventory), "meshDecodeFailureCount": len(mesh_failures),
        "lightmapRendererCount": len(renderer_bindings),
        "lightmapAllHaveUv1": all(row["sourceHasUv1"] for row in renderer_bindings),
        "meshesWithSerializedUv1Channel": sum(row["hasSerializedUv1Channel"] for row in mesh_inventory),
        "lightmapMeshesWithSerializedUv1Channel": sum(
            row["hasSerializedUv1Channel"] for row in mesh_inventory if row["usedByLightmap"]
        ),
        "animationClipCount": len(animation_clips), "animatorCount": len(animators),
        "lightCount": len(lights), "reflectionProbeCount": len(probes),
        "particleSystemCount": len(particles),
        "monoBehaviourClassCounts": raw_truth["monoBehaviours"]["classCounts"],
    }
    atomic_json(OUT / "audit-summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
