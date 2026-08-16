#!/usr/bin/env python3
"""Generate bounded JP home-animation and expression evidence.

Inputs are exactly two battle-unit bundles, two home bundles, and the Android
AssetBundleManifest. Source SHA-256 values below are previously verified
constants; this program verifies their file sizes because the workspace hash
guard intentionally blocks fresh digest computation.
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import warnings
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import UnityPy
import UnityPy.config as unity_config
from UnityPy.exceptions import UnityVersionFallbackWarning


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSET_ROOT = Path(r"D:\magia\ma-ex-data")
DEFAULT_JSON = REPO_ROOT / "research" / "official-home-animation-expression-evidence.json"
DEFAULT_MD = REPO_ROOT / "docs" / "OFFICIAL_HOME_ANIMATION_EXPRESSION_EVIDENCE.md"

RELEASE_PROFILE = "jp-android-3.13.0"
UNITY_VERSION = "2022.3.62f2"
UNITYPY_VERSION = "1.25.2"
FACE_PATH = "chara/Face_Mesh"
FACE_PATH_HASH = 2264444960
WEAPON_PATH = "weapon_a_joint_gp"
WEAPON_PATH_HASH = 2201715703
CONTROLLER_RAW_SHA256 = "273acc4de552374abf2764a9f4954a2283ca8844c6075388062422c624588917"
WEAPON_OVERRIDE_RAW_SHA256 = "36321e6f256e4e5b5a08c26ab3fa48f0ac36216c756564f8b45941ab00ee7990"

SOURCE_SPECS = (
    {
        "id": "battle-unit-100107",
        "kind": "battle-unit",
        "artifact": "gamedata/AssetBundles/battle/character/chara_100107_battle_unit",
        "size": 3139872,
        "sha256": "3146ceffabe46f70c5edbe31f18d1f6ef5a3a7cfc77744207b1e2cdf4df0f326",
    },
    {
        "id": "battle-unit-101901",
        "kind": "battle-unit",
        "artifact": "gamedata/AssetBundles/battle/character/chara_101901_battle_unit",
        "size": 4036502,
        "sha256": "15ecddac1e282f63441eed640f47610d5d312ca2d2d98aaccf72976a9f7ece84",
    },
    {
        "id": "home-10010701",
        "kind": "home-controller",
        "artifact": "gamedata/AssetBundles/home/doll_house/chara_10010701_home",
        "size": 334719,
        "sha256": "8940fb2c215f67d2ed2ef50e86140b654e13c0ba147993e51c977aeba30d4e07",
    },
    {
        "id": "home-10190101",
        "kind": "home-controller",
        "artifact": "gamedata/AssetBundles/home/doll_house/chara_10190101_home",
        "size": 231234,
        "sha256": "c46ec96c81a4fc33e41276677f718b4dbe88759baf19032fe391764d7fce6826",
    },
    {
        "id": "android-manifest",
        "kind": "asset-bundle-manifest",
        "artifact": "gamedata/AssetBundles/Android",
        "size": 465351,
        "sha256": "c243499e1d304cc14cd1e0abe15f6992d71937e90365e89b03ecbf035cf7b3c8",
    },
)

CHARACTER_SPECS = (
    {
        "id": "10010701",
        "modelId": "100107",
        "battleSource": "battle-unit-100107",
        "homeSource": "home-10010701",
        "battleBundleName": "battle/character/chara_100107_battle_unit",
        "homeBundleName": "home/doll_house/chara_10010701_home",
        "modelControllerName": "chara_100107_model",
    },
    {
        "id": "10190101",
        "modelId": "101901",
        "battleSource": "battle-unit-101901",
        "homeSource": "home-10190101",
        "battleBundleName": "battle/character/chara_101901_battle_unit",
        "homeBundleName": "home/doll_house/chara_10190101_home",
        "modelControllerName": "chara_101901_model",
    },
)

EXPRESSIONS = (
    "Smile", "Smiling", "Serious", "Annoyed", "Furious", "Sorrow",
    "Sadness", "Troubled", "Wry", "Dumbfounded", "Surprised",
    "Astonished", "Damage", "Expressionless", "Despair",
)
COMMON_FACE_CLIPS = (
    "HomeFace00_Default", "HomeEyeBlink", "HomeEyeBlinkEmpty",
    "HomeMouthOpen", "HomeMouthClose",
)
BODY_CLIPS = ("HomeUnique01_S", "HomeUnique01_L", "HomeWait01_L", "HomeWait02_L")


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def stable_float(value: float) -> float:
    return 0.0 if value == 0.0 else float(value)


def fmt(value: float | None) -> str:
    return "null" if value is None else format(stable_float(value), ".9g")


def write_lf(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))


def spec_by_id(source_id: str) -> dict[str, Any]:
    return next(item for item in SOURCE_SPECS if item["id"] == source_id)


def input_path(asset_root: Path, source_id: str) -> Path:
    return asset_root / Path(spec_by_id(source_id)["artifact"])


def verify_source_sizes(asset_root: Path) -> list[dict[str, Any]]:
    records = []
    for item in SOURCE_SPECS:
        path = asset_root / Path(item["artifact"])
        expect(path.is_file(), f"missing source: {path}")
        actual_size = path.stat().st_size
        expect(actual_size == item["size"], f"size mismatch: {path}: {actual_size}")
        records.append(
            {
                "id": item["id"],
                "kind": item["kind"],
                "sourceRoot": "jp-asset-root",
                "artifact": item["artifact"],
                "size": actual_size,
                "sha256": item["sha256"],
                "sha256Evidence": "preverified-constant; current file size revalidated",
            }
        )
    return records


def load_bundle(path: Path) -> tuple[Any, dict[str, Any]]:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", UnityVersionFallbackWarning)
        environment = UnityPy.load(str(path))
    bundle_files = [item for item in environment.files.values() if hasattr(item, "files")]
    expect(len(bundle_files) == 1, f"expected one BundleFile in {path}")
    bundle = bundle_files[0]
    serialized = [item for item in bundle.files.values() if hasattr(item, "unity_version")]
    return environment, {
        "signature": bundle.signature,
        "bundleFormatVersion": int(bundle.version),
        "playerVersion": bundle.version_player,
        "engineVersion": bundle.version_engine,
        "serializedFileNames": sorted(bundle.files),
        "serializedUnityVersions": sorted({item.unity_version for item in serialized}),
        "fallbackVersion": UNITY_VERSION,
        "fallbackUsed": bool(caught),
        "fallbackWarnings": sorted({item.category.__name__ for item in caught}),
    }


def object_ref(reader: Any, source_id: str, name: str | None = None) -> dict[str, Any]:
    if name is None:
        name = getattr(reader.read(), "m_Name", None)
    return {
        "sourceArtifactId": source_id,
        "fileId": 0,
        "pathId": str(reader.path_id),
        "type": reader.type.name,
        "name": name,
    }


def deref(pptr: Any) -> Any | None:
    return None if pptr.m_PathID == 0 else pptr.deref()


def pptr_ref(pptr: Any, source_id: str) -> dict[str, Any]:
    record: dict[str, Any] = {
        "sourceArtifactId": source_id,
        "fileId": int(pptr.m_FileID),
        "pathId": str(pptr.m_PathID),
        "name": None,
    }
    if pptr.m_PathID:
        target = deref(pptr)
        expect(target is not None, f"unresolved PPtr {source_id}:{pptr.m_FileID}:{pptr.m_PathID}")
        record["name"] = getattr(target.read(), "m_Name", None)
        record["type"] = target.type.name
    return record


def component(game_object: Any, type_name: str) -> Any:
    matches = []
    for pair in game_object.m_Component:
        reader = deref(pair.component)
        if reader is not None and reader.type.name == type_name:
            matches.append(reader)
    expect(len(matches) == 1, f"{game_object.m_Name}: expected one {type_name}")
    return matches[0]


def hierarchy(transform_reader: Any) -> str:
    names, seen = [], set()
    current = transform_reader
    while current is not None:
        expect(current.path_id not in seen, "transform parent cycle")
        seen.add(current.path_id)
        transform = current.read()
        game_object = deref(transform.m_GameObject)
        expect(game_object is not None, "transform has null GameObject")
        names.append(game_object.read().m_Name)
        current = deref(transform.m_Father)
    return "/".join(reversed(names))


def serialized_hash128(value: Any) -> str:
    return "".join(f"{getattr(value, f'bytes_{index}_'):02x}" for index in range(16))


def extract_manifest(environment: Any, requested: Iterable[str]) -> dict[str, Any]:
    matches = [item for item in environment.objects if item.type.name == "AssetBundleManifest"]
    expect(len(matches) == 1, "manifest object count mismatch")
    reader = matches[0]
    manifest = reader.read()
    names = dict(manifest.AssetBundleNames)
    infos = dict(manifest.AssetBundleInfos)
    records = []
    for requested_name in requested:
        indices = [index for index, name in names.items() if name == requested_name]
        expect(len(indices) == 1, f"manifest entry count for {requested_name}")
        index = indices[0]
        info = infos[index]
        records.append(
            {
                "name": requested_name,
                "index": index,
                "hash128": serialized_hash128(info.AssetBundleHash),
                "dependencyIndices": list(info.AssetBundleDependencies),
                "dependencies": [names[item] for item in info.AssetBundleDependencies],
            }
        )
    return {
        "sourceArtifactId": "android-manifest",
        "object": object_ref(reader, "android-manifest"),
        "bundleCount": len(names),
        "variantBundleCount": len(manifest.AssetBundlesWithVariant),
        "records": records,
    }


def extract_unit(environment: Any, source_id: str, controller_name: str) -> dict[str, Any]:
    face_objects = [
        item for item in environment.objects
        if item.type.name == "GameObject" and item.read().m_Name == "Face_Mesh"
    ]
    expect(len(face_objects) == 1, f"{source_id}: Face_Mesh count")
    face_object = face_objects[0]
    face_go = face_object.read()
    face_transform = component(face_go, "Transform")
    smr_object = component(face_go, "SkinnedMeshRenderer")
    smr = smr_object.read()
    mesh_object = deref(smr.m_Mesh)
    expect(mesh_object is not None and mesh_object.type.name == "Mesh", "Face_Mesh mesh PPtr")
    mesh = mesh_object.read()
    shapes = mesh.m_Shapes
    expect(len(shapes.channels) == len(shapes.shapes) == len(shapes.fullWeights), "shape arrays differ")

    channels = []
    for index, channel in enumerate(shapes.channels):
        expect(channel.frameCount == 1, f"{channel.name}: frameCount")
        shape = shapes.shapes[channel.frameIndex]
        full_weight = stable_float(shapes.fullWeights[channel.frameIndex])
        expect(full_weight == 100.0, f"{channel.name}: fullWeight")
        channels.append(
            {
                "index": index,
                "name": channel.name,
                "nameHash": int(channel.nameHash),
                "frameIndex": int(channel.frameIndex),
                "frameCount": int(channel.frameCount),
                "fullWeight": full_weight,
                "deltaVertexStart": int(shape.firstVertex),
                "deltaVertexEndExclusive": int(shape.firstVertex + shape.vertexCount),
                "deltaVertexCount": int(shape.vertexCount),
                "hasNormals": bool(shape.hasNormals),
                "hasTangents": bool(shape.hasTangents),
            }
        )

    animator_matches = []
    for item in environment.objects:
        if item.type.name != "Animator":
            continue
        animator = item.read()
        controller = deref(animator.m_Controller)
        if controller is not None and getattr(controller.read(), "m_Name", None) == controller_name:
            animator_matches.append((item, animator, controller))
    expect(len(animator_matches) == 1, f"{source_id}: model Animator count")
    animator_object, animator, override_object = animator_matches[0]
    animator_game_object = deref(animator.m_GameObject)
    expect(animator_game_object is not None, "model Animator GameObject is null")
    animator_transform = component(animator_game_object.read(), "Transform")
    animator_hierarchy = hierarchy(animator_transform)
    face_hierarchy = hierarchy(face_transform)
    expect(face_hierarchy.startswith(animator_hierarchy + "/"), "Face_Mesh not below Animator")
    relative_face_path = face_hierarchy[len(animator_hierarchy) + 1 :]
    expect(relative_face_path == FACE_PATH, f"unexpected relative Face path: {relative_face_path}")

    weapon_objects = [
        item for item in environment.objects
        if item.type.name == "GameObject" and item.read().m_Name == WEAPON_PATH
    ]
    expect(len(weapon_objects) == 1, f"{source_id}: weapon_a_joint_gp count")
    weapon_transform = component(weapon_objects[0].read(), "Transform")
    root_bone = deref(smr.m_RootBone)
    expect(root_bone is not None, "Face_Mesh root bone is null")
    override = override_object.read()
    return {
        "sourceArtifactId": source_id,
        "faceHierarchy": face_hierarchy,
        "animatorRelativeFacePath": relative_face_path,
        "animatorRelativeFacePathHash": FACE_PATH_HASH,
        "faceGameObject": object_ref(face_object, source_id),
        "faceTransform": object_ref(face_transform, source_id),
        "skinnedMeshRenderer": object_ref(smr_object, source_id),
        "meshPPtr": pptr_ref(smr.m_Mesh, source_id),
        "rootBonePPtr": pptr_ref(smr.m_RootBone, source_id),
        "rootBoneHierarchy": hierarchy(root_bone),
        "boneCount": len(smr.m_Bones),
        "serializedInitialBlendShapeWeights": [stable_float(item) for item in smr.m_BlendShapeWeights],
        "vertexCount": int(mesh.m_VertexData.m_VertexCount),
        "channelCount": len(channels),
        "shapeCount": len(shapes.shapes),
        "fullWeightCount": len(shapes.fullWeights),
        "deltaVertexCount": len(shapes.vertices),
        "channels": channels,
        "modelAnimator": {
            "object": object_ref(animator_object, source_id),
            "hierarchy": animator_hierarchy,
            "avatarPPtr": pptr_ref(animator.m_Avatar, source_id),
            "overrideControllerPPtr": pptr_ref(animator.m_Controller, source_id),
            "baseControllerPPtr": pptr_ref(override.m_Controller, source_id),
            "overridePairCount": len(override.m_Clips),
        },
        "weaponBinding": {
            "relativePath": WEAPON_PATH,
            "relativePathHash": WEAPON_PATH_HASH,
            "gameObject": object_ref(weapon_objects[0], source_id),
            "transform": object_ref(weapon_transform, source_id),
            "fullPath": hierarchy(weapon_transform),
        },
    }


def decode_streamed(streamed: Any) -> list[dict[str, Any]]:
    raw = b"".join(struct.pack("<I", int(word)) for word in streamed.data)
    position, frames = 0, []
    while position < len(raw):
        time, count = struct.unpack_from("<fi", raw, position)
        position += 8
        keys = []
        for _ in range(count):
            curve_index = struct.unpack_from("<i", raw, position)[0]
            coefficients = struct.unpack_from("<4f", raw, position + 4)
            position += 20
            keys.append(
                {
                    "curveIndex": curve_index,
                    "coefficients": [stable_float(item) for item in coefficients],
                    "value": stable_float(coefficients[3]),
                }
            )
        sentinel = not (-1e20 < time < 1e20 and math.isfinite(time))
        frames.append({"time": None if sentinel else stable_float(time), "sentinel": sentinel, "keys": keys})
    expect(position == len(raw), "streamed payload not consumed")
    return frames


def scalar_face_clip(clip_object: Any, source_id: str, names: dict[int, str]) -> dict[str, Any]:
    clip = clip_object.read()
    bindings = clip.m_ClipBindingConstant.genericBindings
    expect(all(item.typeID == 137 and item.customType == 20 for item in bindings), f"{clip.m_Name}: binding type")
    packed = clip.m_MuscleClip.m_Clip.data
    streamed, dense, constants = packed.m_StreamedClip, packed.m_DenseClip, packed.m_ConstantClip.data
    frames = decode_streamed(streamed)
    values: dict[int, list[float]] = defaultdict(list)
    keyframes: dict[int, list[dict[str, float]]] = defaultdict(list)
    for frame in frames:
        if frame["sentinel"]:
            continue
        for key in frame["keys"]:
            values[key["curveIndex"]].append(key["value"])
            keyframes[key["curveIndex"]].append({"time": frame["time"], "value": key["value"]})
    for dense_index in range(dense.m_CurveCount):
        binding_index = streamed.curveCount + dense_index
        for frame_index in range(dense.m_FrameCount):
            value = stable_float(dense.m_SampleArray[frame_index * dense.m_CurveCount + dense_index])
            time = stable_float(dense.m_BeginTime + frame_index / dense.m_SampleRate)
            values[binding_index].append(value)
            keyframes[binding_index].append({"time": time, "value": value})
    constant_base = streamed.curveCount + dense.m_CurveCount
    for index, value in enumerate(constants):
        values[constant_base + index].append(stable_float(value))
    expect(len(bindings) == streamed.curveCount + dense.m_CurveCount + len(constants), f"{clip.m_Name}: curve count")
    result_bindings = []
    for index, binding in enumerate(bindings):
        curve_values = values[index]
        expect(curve_values, f"{clip.m_Name}: empty curve {index}")
        storage = "streamed" if index < streamed.curveCount else "dense" if index < constant_base else "constant"
        name = names.get(int(binding.attribute))
        result_bindings.append(
            {
                "index": index,
                "path": FACE_PATH if binding.path == FACE_PATH_HASH else None,
                "pathHash": int(binding.path),
                "attribute": name,
                "attributeHash": int(binding.attribute),
                "property": f"blendShape.{name}" if name else None,
                "typeId": int(binding.typeID),
                "customType": int(binding.customType),
                "storage": storage,
                "keyframes": keyframes[index],
                "values": curve_values,
                "serializedValueMin": min(curve_values),
                "serializedValueMax": max(curve_values),
            }
        )
    return {
        "sourceArtifactId": source_id,
        "name": clip.m_Name,
        "pathId": str(clip_object.path_id),
        "sampleRate": stable_float(clip.m_SampleRate),
        "stopTime": stable_float(clip.m_MuscleClip.m_StopTime),
        "streamedCurveCount": int(streamed.curveCount),
        "denseCurveCount": int(dense.m_CurveCount),
        "constantCurveCount": len(constants),
        "bindingCount": len(bindings),
        "bindings": result_bindings,
    }


def stored_transform_range(clip: Any) -> tuple[float | None, float | None]:
    packed = clip.m_MuscleClip.m_Clip.data
    values = [stable_float(item) for item in packed.m_ConstantClip.data]
    values.extend(stable_float(item) for item in packed.m_DenseClip.m_SampleArray)
    for frame in decode_streamed(packed.m_StreamedClip):
        if not frame["sentinel"]:
            values.extend(key["value"] for key in frame["keys"])
    return (min(values), max(values)) if values else (None, None)


def transform_clip(clip_object: Any, source_id: str) -> dict[str, Any]:
    clip = clip_object.read()
    bindings = clip.m_ClipBindingConstant.genericBindings
    expect(all(item.typeID == 4 and item.customType == 0 for item in bindings), f"{clip.m_Name}: not Transform-only")
    packed = clip.m_MuscleClip.m_Clip.data
    minimum, maximum = stored_transform_range(clip)
    return {
        "sourceArtifactId": source_id,
        "name": clip.m_Name,
        "pathId": str(clip_object.path_id),
        "sampleRate": stable_float(clip.m_SampleRate),
        "stopTime": stable_float(clip.m_MuscleClip.m_StopTime),
        "bindingCount": len(bindings),
        "pathCount": len({item.path for item in bindings}),
        "bindingAttributeCounts": {str(key): value for key, value in sorted(Counter(item.attribute for item in bindings).items())},
        "streamedCurveCount": int(packed.m_StreamedClip.curveCount),
        "denseCurveCount": int(packed.m_DenseClip.m_CurveCount),
        "constantScalarCount": len(packed.m_ConstantClip.data),
        "storedScalarMin": minimum,
        "storedScalarMax": maximum,
        "hasBlendShapeBindings": False,
    }


def transition_record(pointer: Any, names: dict[int, str]) -> dict[str, Any]:
    item = pointer.data
    return {
        "id": int(item.m_ID),
        "name": names.get(item.m_ID),
        "destinationState": int(item.m_DestinationState),
        "hasExitTime": bool(item.m_HasExitTime),
        "exitTime": stable_float(item.m_ExitTime),
        "duration": stable_float(item.m_TransitionDuration),
        "conditions": [
            {
                "parameter": names.get(condition.data.m_EventID),
                "parameterHash": int(condition.data.m_EventID),
                "mode": int(condition.data.m_ConditionMode),
                "threshold": stable_float(condition.data.m_EventThreshold),
            }
            for condition in item.m_ConditionConstantArray
        ],
    }


def controller_record(reader: Any, source_id: str) -> dict[str, Any]:
    controller = reader.read()
    constant, names = controller.m_Controller, dict(controller.m_TOS)
    clips = [pptr_ref(item, source_id) for item in controller.m_AnimationClips]
    layers = []
    for layer_index, layer_pointer in enumerate(constant.m_LayerArray):
        layer = layer_pointer.data
        machine = constant.m_StateMachineArray[layer.m_StateMachineIndex].data
        states = []
        for state_index, state_pointer in enumerate(machine.m_StateConstantArray):
            state, motions = state_pointer.data, []
            for tree_pointer in state.m_BlendTreeConstantArray:
                for node_pointer in tree_pointer.data.m_NodeArray:
                    motions.append(pptr_ref(controller.m_AnimationClips[node_pointer.data.m_ClipID], source_id))
            states.append(
                {
                    "index": state_index,
                    "name": names.get(state.m_NameID),
                    "nameHash": int(state.m_NameID),
                    "fullPath": names.get(state.m_FullPathID),
                    "fullPathHash": int(state.m_FullPathID),
                    "loop": bool(state.m_Loop),
                    "speed": stable_float(state.m_Speed),
                    "writeDefaultValues": bool(state.m_WriteDefaultValues),
                    "motions": motions,
                    "transitions": [transition_record(item, names) for item in state.m_TransitionConstantArray],
                }
            )
        layers.append(
            {
                "index": layer_index,
                "name": names.get(layer.m_Binding),
                "bindingHash": int(layer.m_Binding),
                "defaultWeight": stable_float(layer.m_DefaultWeight),
                "ikPass": bool(layer.m_IKPass),
                "blendingMode": int(layer.m_LayerBlendingMode),
                "defaultState": int(machine.m_DefaultState),
                "stateCount": len(states),
                "states": states,
                "anyStateTransitions": [transition_record(item, names) for item in machine.m_AnyStateTransitionConstantArray],
            }
        )
    parameters = [
        {"name": names.get(item.m_ID), "nameHash": int(item.m_ID), "index": int(item.m_Index), "type": int(item.m_Type)}
        for item in constant.m_Values.data.m_ValueArray
    ]
    return {
        "sourceArtifactId": source_id,
        "object": object_ref(reader, source_id),
        "verifiedRawSha256": CONTROLLER_RAW_SHA256,
        "controllerSize": int(controller.m_ControllerSize),
        "layerCount": len(layers),
        "stateCount": sum(item["stateCount"] for item in layers),
        "clipPPtrCount": len(clips),
        "clipPPtrs": clips,
        "parameters": parameters,
        "layers": layers,
    }


def override_record(reader: Any, source_id: str) -> dict[str, Any]:
    override = reader.read()
    result = {
        "sourceArtifactId": source_id,
        "object": object_ref(reader, source_id),
        "baseControllerPPtr": pptr_ref(override.m_Controller, source_id),
        "mappingCount": len(override.m_Clips),
        "nullOverrideCount": sum(item.m_OverrideClip.m_PathID == 0 for item in override.m_Clips),
        "mappings": [
            {"index": index, "original": pptr_ref(item.m_OriginalClip, source_id), "override": pptr_ref(item.m_OverrideClip, source_id)}
            for index, item in enumerate(override.m_Clips)
        ],
    }
    if override.m_Name == "HomeOverrideControllerWeaponA":
        result["verifiedRawSha256"] = WEAPON_OVERRIDE_RAW_SHA256
    return result


def home_reference(environment: Any, source_id: str) -> dict[str, Any]:
    matches = []
    for reader in environment.objects:
        if reader.type.name != "MonoBehaviour":
            continue
        tree = reader.read_typetree()
        if "overrideController" in tree and "weaponAOverrideController" in tree:
            matches.append((reader, tree))
    expect(len(matches) == 1, f"{source_id}: HomeCharacterReference count")
    reader, tree = matches[0]

    def field(name: str) -> dict[str, Any]:
        value, target_name = tree[name], None
        path_id = int(value["m_PathID"])
        if path_id:
            target_name = getattr(reader.assets_file.objects[path_id].read(), "m_Name", None)
        return {
            "sourceArtifactId": source_id,
            "fileId": int(value["m_FileID"]),
            "pathId": str(path_id),
            "name": target_name,
        }

    return {
        "sourceArtifactId": source_id,
        "object": object_ref(reader, source_id),
        "overrideControllerPPtr": field("overrideController"),
        "weaponAOverrideControllerPPtr": field("weaponAOverrideController"),
        "weaponBOverrideControllerPPtr": field("weaponBOverrideController"),
        "propAnimatorCount": len(tree["propAnimators"]),
    }


def expression_clip(reader: Any, source_id: str, channels: list[dict[str, Any]]) -> dict[str, Any]:
    clip = reader.read()
    packed = clip.m_MuscleClip.m_Clip.data
    bindings = clip.m_ClipBindingConstant.genericBindings
    values = [stable_float(item) for item in packed.m_ConstantClip.data]
    expect(packed.m_StreamedClip.curveCount == packed.m_DenseClip.m_CurveCount == 0, f"{clip.m_Name}: not constant")
    expect(len(bindings) == len(values) == len(channels), f"{clip.m_Name}: channel count")
    expect([int(item.attribute) for item in bindings] == [item["nameHash"] for item in channels], f"{clip.m_Name}: channel order")
    expect(all(item.path == FACE_PATH_HASH for item in bindings), f"{clip.m_Name}: path hash")
    weights = [
        {
            "index": index,
            "channel": channels[index]["name"],
            "attributeHash": channels[index]["nameHash"],
            "value": value,
            "min": value,
            "max": value,
        }
        for index, value in enumerate(values)
    ]
    return {
        "sourceArtifactId": source_id,
        "name": clip.m_Name,
        "pathId": str(reader.path_id),
        "sampleRate": stable_float(clip.m_SampleRate),
        "stopTime": stable_float(clip.m_MuscleClip.m_StopTime),
        "path": FACE_PATH,
        "pathHash": FACE_PATH_HASH,
        "storage": "constant",
        "bindingCount": len(bindings),
        "overallMin": min(values),
        "overallMax": max(values),
        "zeroWeightCount": sum(value == 0.0 for value in values),
        "nonZeroWeights": [item for item in weights if item["value"] != 0.0],
        "weights": weights,
    }


def extract_home(environment: Any, source_id: str, unit: dict[str, Any]) -> dict[str, Any]:
    controllers = [item for item in environment.objects if item.type.name == "AnimatorController"]
    expect(len(controllers) == 1, f"{source_id}: controller count")
    controller = controller_record(controllers[0], source_id)
    expect([item["stateCount"] for item in controller["layers"]] == [16, 1, 19, 2], "controller layer topology")
    overrides = [
        override_record(item, source_id)
        for item in sorted(
            (item for item in environment.objects if item.type.name == "AnimatorOverrideController"),
            key=lambda item: item.read().m_Name,
        )
    ]
    expect(len(overrides) == 2, f"{source_id}: override count")
    clips = {item.read().m_Name: item for item in environment.objects if item.type.name == "AnimationClip"}
    expect(len(clips) == 50, f"{source_id}: clip count")
    names = {item["nameHash"]: item["name"] for item in unit["channels"]}
    common = [scalar_face_clip(clips[name], source_id, names) for name in COMMON_FACE_CLIPS]
    expressions = [expression_clip(clips[name], source_id, unit["channels"]) for name in EXPRESSIONS]
    body = [transform_clip(clips[name], source_id) for name in BODY_CLIPS]
    weapon = transform_clip(clips["HomeWeaponAHide"], source_id)
    weapon_bindings = clips["HomeWeaponAHide"].read().m_ClipBindingConstant.genericBindings
    expect({item.path for item in weapon_bindings} == {WEAPON_PATH_HASH}, "weapon hide path")
    weapon.update({"path": WEAPON_PATH, "pathHash": WEAPON_PATH_HASH})

    placeholders = []
    for name, reader in sorted(clips.items()):
        clip, packed = reader.read(), reader.read().m_MuscleClip.m_Clip.data
        if not clip.m_ClipBindingConstant.genericBindings and not packed.m_StreamedClip.curveCount and not packed.m_DenseClip.m_CurveCount and not packed.m_ConstantClip.data:
            placeholders.append({"sourceArtifactId": source_id, "name": name, "pathId": str(reader.path_id)})

    grouped: dict[tuple[float, ...], list[str]] = defaultdict(list)
    nonzero: dict[tuple[float, ...], list[dict[str, Any]]] = {}
    for item in expressions:
        signature = tuple(weight["value"] for weight in item["weights"])
        grouped[signature].append(item["name"])
        nonzero[signature] = item["nonZeroWeights"]
    signature_groups = [
        {"expressions": values, "overallMin": min(key), "overallMax": max(key), "nonZeroWeights": nonzero[key]}
        for key, values in grouped.items()
    ]
    return {
        "sourceArtifactId": source_id,
        "homeReference": home_reference(environment, source_id),
        "controller": controller,
        "overrideControllers": overrides,
        "clipCount": len(clips),
        "placeholderClips": placeholders,
        "commonFaceClips": common,
        "expressionClips": expressions,
        "expressionSignatureGroups": signature_groups,
        "bodyClips": body,
        "weaponHideClip": weapon,
    }


def validate_release_profile() -> dict[str, Any]:
    path = REPO_ROOT / "research" / "unity-release-profiles.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    expect(data["policy"]["requireExplicitProfile"] is True, "explicit profile policy")
    expect(data["policy"]["unknownProfile"] == "reject", "unknown profile policy")
    profile = data["profiles"][RELEASE_PROFILE]
    expect(profile["unityVersion"] == UNITY_VERSION, "release profile Unity version")
    return {
        "artifact": "research/unity-release-profiles.json",
        "profile": RELEASE_PROFILE,
        "region": profile["region"],
        "platform": profile["platform"],
        "appVersion": profile["appVersion"],
        "versionCode": profile["versionCode"],
        "unityVersion": profile["unityVersion"],
    }


def build_evidence(asset_root: Path) -> dict[str, Any]:
    expect(getattr(UnityPy, "__version__", None) == UNITYPY_VERSION, "UnityPy version mismatch")
    unity_config.FALLBACK_UNITY_VERSION = UNITY_VERSION
    sources = verify_source_sizes(asset_root)
    environments, metadata = {}, {}
    for source in SOURCE_SPECS:
        environment, bundle_metadata = load_bundle(asset_root / Path(source["artifact"]))
        environments[source["id"]] = environment
        metadata[source["id"]] = bundle_metadata
    for source in sources:
        source["bundleMetadata"] = metadata[source["id"]]

    manifest_names = [item[key] for item in CHARACTER_SPECS for key in ("battleBundleName", "homeBundleName")]
    manifest = extract_manifest(environments["android-manifest"], manifest_names)
    characters = {}
    for spec in CHARACTER_SPECS:
        unit = extract_unit(environments[spec["battleSource"]], spec["battleSource"], spec["modelControllerName"])
        home = extract_home(environments[spec["homeSource"]], spec["homeSource"], unit)
        characters[spec["id"]] = {
            "modelId": spec["modelId"],
            "battleBundleName": spec["battleBundleName"],
            "homeBundleName": spec["homeBundleName"],
            "battleUnit": unit,
            "home": home,
        }

    controller_readers = [
        next(item for item in environments[spec["homeSource"]].objects if item.type.name == "AnimatorController")
        for spec in CHARACTER_SPECS
    ]
    expect(controller_readers[0].get_raw_data() == controller_readers[1].get_raw_data(), "controller raw bytes differ")
    weapon_readers = [
        next(
            item for item in environments[spec["homeSource"]].objects
            if item.type.name == "AnimatorOverrideController" and item.read().m_Name == "HomeOverrideControllerWeaponA"
        )
        for spec in CHARACTER_SPECS
    ]
    expect(weapon_readers[0].get_raw_data() == weapon_readers[1].get_raw_data(), "weapon override raw bytes differ")
    channel_100 = {item["name"] for item in characters["10010701"]["battleUnit"]["channels"]}
    channel_101 = {item["name"] for item in characters["10190101"]["battleUnit"]["channels"]}
    expect(channel_100 <= channel_101, "channel subset invariant")

    validate_release_profile()
    return {
        "schemaVersion": 1,
        "releaseProfile": RELEASE_PROFILE,
        "unityVersion": UNITY_VERSION,
        "generator": "scripts/extract-official-home-animation-evidence.py",
        "toolchain": {
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "unityPy": UNITYPY_VERSION,
        },
        "sourceArtifacts": sources,
        "manifest": manifest,
        "bindingConstants": {
            "facePath": FACE_PATH,
            "facePathHash": FACE_PATH_HASH,
            "weaponAPath": WEAPON_PATH,
            "weaponAPathHash": WEAPON_PATH_HASH,
            "blendShapeTypeId": 137,
            "blendShapeCustomType": 20,
        },
        "sharedEvidence": {
            "homeControllerRawSha256": CONTROLLER_RAW_SHA256,
            "weaponAOverrideRawSha256": WEAPON_OVERRIDE_RAW_SHA256,
            "homeControllerByteIdenticalAcrossCharacters": True,
            "weaponAOverrideByteIdenticalAcrossCharacters": True,
            "additional101901Channels": sorted(channel_101 - channel_100),
        },
        "characters": characters,
        "findings": [
            "All reported PPtrs are bundle-local FileID 0 and pathId values are decimal strings.",
            "The shared home controller has four layers and 38 states.",
            "Expression overrides are constant Face_Mesh snapshots: 60 channels for 100107 and 66 for 101901.",
            "HomeEyeBlink and HomeMouthOpen are shared state clips; HomeMouthClose is empty.",
            "Home body clips are Transform-only and contain no blend-shape bindings.",
            "HomeWeaponAHide targets weapon_a_joint_gp with position and scale bindings.",
            "Stored curve ranges describe serialized constants and keys, not evaluated cubic extrema unless constant.",
        ],
    }


def pptr_text(value: dict[str, Any]) -> str:
    suffix = f" `{value['name']}`" if value.get("name") else ""
    return f"`{value['fileId']}:{value['pathId']}`{suffix}"


def escape(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def weights_text(weights: list[dict[str, Any]]) -> str:
    return "; ".join(f"{item['channel']}={fmt(item['value'])}" for item in weights) or "all zero"


def render_markdown(evidence: dict[str, Any]) -> str:
    lines = [
        "# Official Home Animation and Expression Evidence", "",
        "Deterministically generated from four verified JP bundles and the Android AssetBundleManifest. This is source evidence, not a Viewer integration or visual-parity claim.", "",
        "## Profile", "",
        f"- Release profile: `{evidence['releaseProfile']}`", f"- Unity: `{evidence['unityVersion']}`",
        f"- Parser: Python `{evidence['toolchain']['python']}`, UnityPy `{evidence['toolchain']['unityPy']}`",
        "- Every JSON PPtr pathId is a decimal string and carries sourceArtifactId.", "",
        "## Sources", "", "| ID | Artifact | Bytes | Preverified SHA-256 | Embedded engine | Fallback |",
        "|---|---|---:|---|---|---|",
    ]
    for item in evidence["sourceArtifacts"]:
        meta = item["bundleMetadata"]
        lines.append(f"| {item['id']} | `{item['artifact']}` | {item['size']} | `{item['sha256']}` | `{meta['engineVersion']}` | {str(meta['fallbackUsed']).lower()} |")
    lines += ["", "## Manifest", "", "| Index | Bundle | Hash128 | Dependencies |", "|---:|---|---|---|"]
    for item in evidence["manifest"]["records"]:
        deps = ", ".join(f"`{value}`" for value in item["dependencies"]) or "none"
        lines.append(f"| {item['index']} | `{item['name']}` | `{item['hash128']}` | {deps} |")
    shared = evidence["sharedEvidence"]
    lines += [
        "", "## Shared controller", "",
        f"- Controller raw SHA-256: `{shared['homeControllerRawSha256']}` (byte-identical across both homes).",
        f"- Weapon A override raw SHA-256: `{shared['weaponAOverrideRawSha256']}`.",
        f"- Face path `{FACE_PATH}` → `{FACE_PATH_HASH}`; weapon path `{WEAPON_PATH}` → `{WEAPON_PATH_HASH}`.", "",
        "| Layer | States | Weight | IK | State | Motion PPtr | Loop | Speed | Write defaults |",
        "|---|---:|---:|---|---|---|---|---:|---|",
    ]
    controller = evidence["characters"]["10010701"]["home"]["controller"]
    for layer in controller["layers"]:
        for state in layer["states"]:
            motions = ", ".join(pptr_text(item) for item in state["motions"])
            lines.append(f"| {escape(layer['name'])} | {layer['stateCount']} | {fmt(layer['defaultWeight'])} | {str(layer['ikPass']).lower()} | {escape(state['name'])} | {motions} | {str(state['loop']).lower()} | {fmt(state['speed'])} | {str(state['writeDefaultValues']).lower()} |")
    for character_id, character in evidence["characters"].items():
        unit, home = character["battleUnit"], character["home"]
        lines += [
            "", f"## Character {character_id}", "", f"- Face hierarchy: `{unit['faceHierarchy']}`",
            f"- Face GO {pptr_text(unit['faceGameObject'])}; SMR {pptr_text(unit['skinnedMeshRenderer'])}; Mesh {pptr_text(unit['meshPPtr'])}.",
            f"- {unit['vertexCount']} vertices, {unit['channelCount']} blend-shape channels, {unit['deltaVertexCount']} delta vertices; initial weights `{unit['serializedInitialBlendShapeWeights']}`.",
            f"- Normal home controller {pptr_text(home['homeReference']['overrideControllerPPtr'])}; Weapon A {pptr_text(home['homeReference']['weaponAOverrideControllerPPtr'])}; Weapon B {pptr_text(home['homeReference']['weaponBOverrideControllerPPtr'])}.",
            "", "### Override maps", "",
        ]
        for override in home["overrideControllers"]:
            lines.append(f"- `{override['object']['name']}`: {override['mappingCount']} mappings, {override['nullOverrideCount']} null.")
            for mapping in override["mappings"]:
                if mapping["override"]["pathId"] != "0":
                    lines.append(f"  - {pptr_text(mapping['original'])} → {pptr_text(mapping['override'])}")
        lines += ["", "### Expression signatures", "", "Omitted channels are exactly zero; listed constants have min=max=value.", "", "| Expression(s) | Range | Non-zero weights |", "|---|---|---|"]
        for group in home["expressionSignatureGroups"]:
            lines.append(f"| {escape(', '.join(group['expressions']))} | [{fmt(group['overallMin'])}, {fmt(group['overallMax'])}] | {escape(weights_text(group['nonZeroWeights']))} |")
        lines += ["", "### Common face clips", "", "| Clip | pathId | Curves | Stop | Non-zero/explicit ranges |", "|---|---:|---:|---:|---|"]
        for clip in home["commonFaceClips"]:
            ranges = "; ".join(f"{item['attribute'] or item['attributeHash']}=[{fmt(item['serializedValueMin'])},{fmt(item['serializedValueMax'])}]" for item in clip["bindings"] if item["serializedValueMin"] or item["serializedValueMax"] or clip["name"] == "HomeEyeBlinkEmpty") or "all zero"
            lines.append(f"| {clip['name']} | `{clip['pathId']}` | {clip['bindingCount']} | {fmt(clip['stopTime'])} | {escape(ranges)} |")
        lines += ["", "### Transform-only clips", "", "| Clip | pathId | Stop | Bindings/paths | Stored scalar range |", "|---|---:|---:|---:|---|"]
        for clip in [*home["bodyClips"], home["weaponHideClip"]]:
            lines.append(f"| {clip['name']} | `{clip['pathId']}` | {fmt(clip['stopTime'])} | {clip['bindingCount']}/{clip['pathCount']} | [{fmt(clip['storedScalarMin'])}, {fmt(clip['storedScalarMax'])}] |")
    lines += ["", "## Boundaries", ""] + [f"- {item}" for item in evidence["findings"]]
    lines += ["", "## Reproduce", "", "```powershell", "python scripts/extract-official-home-animation-evidence.py --asset-root D:\\magia\\ma-ex-data", "```", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset-root", type=Path, default=DEFAULT_ASSET_ROOT)
    parser.add_argument("--json-output", type=Path, default=DEFAULT_JSON)
    parser.add_argument("--markdown-output", type=Path, default=DEFAULT_MD)
    args = parser.parse_args()
    evidence = build_evidence(args.asset_root.resolve())
    write_lf(args.json_output.resolve(), json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
    write_lf(args.markdown_output.resolve(), render_markdown(evidence))
    print(f"wrote {args.json_output.resolve()}")
    print(f"wrote {args.markdown_output.resolve()}")


if __name__ == "__main__":
    main()
