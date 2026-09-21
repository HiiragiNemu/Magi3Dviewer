#!/usr/bin/env python3
"""Extract one direct Home-character controller and its exact board actions."""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import UnityPy
from UnityPy import config as unitypy_config


def unwrap(value: Any) -> Any:
    return getattr(value, "data", value)


def pointer_target(pointer: Any) -> Any | None:
    try:
        return pointer.read()
    except Exception:
        return None


def pointer_record(pointer: Any) -> dict[str, Any]:
    target = pointer_target(pointer)
    return {
        "fileId": int(pointer.m_FileID),
        "pathId": str(pointer.m_PathID),
        "type": type(target).__name__ if target is not None else None,
        "name": getattr(target, "m_Name", None),
    }


def object_record(reader: Any) -> dict[str, Any]:
    value = reader.read()
    return {
        "pathId": str(reader.path_id),
        "type": reader.type.name,
        "name": getattr(value, "m_Name", None),
    }


def transition_record(pointer: Any, names: dict[int, str]) -> dict[str, Any]:
    value = unwrap(pointer)
    return {
        "id": int(value.m_ID),
        "name": names.get(int(value.m_ID)),
        "destinationState": int(value.m_DestinationState),
        "hasExitTime": bool(value.m_HasExitTime),
        "exitTime": float(value.m_ExitTime),
        "durationSeconds": float(value.m_TransitionDuration),
        "conditions": [
            {
                "parameter": names.get(int(unwrap(condition).m_EventID)),
                "parameterHash": int(unwrap(condition).m_EventID),
                "mode": int(unwrap(condition).m_ConditionMode),
                "threshold": float(unwrap(condition).m_EventThreshold),
            }
            for condition in value.m_ConditionConstantArray
        ],
    }


def controller_record(reader: Any) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    controller = reader.read()
    constant = controller.m_Controller
    names = {int(key): value for key, value in dict(controller.m_TOS).items()}
    clip_pointers = list(controller.m_AnimationClips)
    uses: dict[str, list[dict[str, Any]]] = defaultdict(list)
    layers: list[dict[str, Any]] = []

    for layer_index, layer_pointer in enumerate(constant.m_LayerArray):
        layer = unwrap(layer_pointer)
        machine = unwrap(constant.m_StateMachineArray[layer.m_StateMachineIndex])
        states: list[dict[str, Any]] = []
        for state_index, state_pointer in enumerate(machine.m_StateConstantArray):
            state = unwrap(state_pointer)
            motions: list[dict[str, Any]] = []
            for tree_pointer in state.m_BlendTreeConstantArray:
                tree = unwrap(tree_pointer)
                for node_pointer in tree.m_NodeArray:
                    node = unwrap(node_pointer)
                    clip_index = int(node.m_ClipID)
                    if clip_index < 0 or clip_index >= len(clip_pointers):
                        continue
                    motion = pointer_record(clip_pointers[clip_index])
                    motions.append(motion)
                    uses[motion["pathId"]].append(
                        {
                            "controllerPathId": str(reader.path_id),
                            "layerIndex": layer_index,
                            "layerName": names.get(int(layer.m_Binding)),
                            "stateIndex": state_index,
                            "stateName": names.get(int(state.m_NameID)),
                            "stateNameHash": int(state.m_NameID),
                            "fullPath": names.get(int(state.m_FullPathID)),
                            "fullPathHash": int(state.m_FullPathID),
                            "loop": bool(state.m_Loop),
                            "speed": float(state.m_Speed),
                        }
                    )
            states.append(
                {
                    "index": state_index,
                    "name": names.get(int(state.m_NameID)),
                    "nameHash": int(state.m_NameID),
                    "fullPath": names.get(int(state.m_FullPathID)),
                    "fullPathHash": int(state.m_FullPathID),
                    "loop": bool(state.m_Loop),
                    "speed": float(state.m_Speed),
                    "writeDefaultValues": bool(state.m_WriteDefaultValues),
                    "motions": motions,
                    "transitions": [
                        transition_record(item, names)
                        for item in state.m_TransitionConstantArray
                    ],
                }
            )
        layers.append(
            {
                "index": layer_index,
                "name": names.get(int(layer.m_Binding)),
                "bindingHash": int(layer.m_Binding),
                "defaultWeight": float(layer.m_DefaultWeight),
                "ikPass": bool(layer.m_IKPass),
                "blendingMode": int(layer.m_LayerBlendingMode),
                "defaultState": int(machine.m_DefaultState),
                "states": states,
                "anyStateTransitions": [
                    transition_record(item, names)
                    for item in machine.m_AnyStateTransitionConstantArray
                ],
            }
        )

    parameters = [
        {
            "name": names.get(int(item.m_ID)),
            "nameHash": int(item.m_ID),
            "index": int(item.m_Index),
            "type": int(item.m_Type),
        }
        for item in constant.m_Values.data.m_ValueArray
    ]
    return (
        {
            "pathId": str(reader.path_id),
            "name": controller.m_Name,
            "clipPPtrCount": len(clip_pointers),
            "layerCount": len(layers),
            "stateCount": sum(len(layer["states"]) for layer in layers),
            "parameters": parameters,
            "layers": layers,
        },
        uses,
    )


def hierarchy(game_object: Any) -> str:
    transform = pointer_target(game_object.m_Transform)
    parts: list[str] = []
    seen: set[int] = set()
    while transform is not None:
        path_id = int(transform.object_reader.path_id)
        if path_id in seen:
            raise RuntimeError("Transform hierarchy cycle")
        seen.add(path_id)
        current = pointer_target(transform.m_GameObject)
        parts.append(getattr(current, "m_Name", "<unnamed>"))
        transform = pointer_target(transform.m_Father) if transform.m_Father else None
    return "/".join(reversed(parts))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--character-id", required=True, type=int)
    parser.add_argument("--model-bundle", required=True, type=Path)
    parser.add_argument("--shader-bundle", required=True, type=Path)
    parser.add_argument("--thumbnail-bundle", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--thumbnail-output", required=True, type=Path)
    parser.add_argument("--unity-version", default="2022.3.62f2")
    args = parser.parse_args()

    unitypy_config.FALLBACK_UNITY_VERSION = args.unity_version
    environment = UnityPy.load(str(args.model_bundle), str(args.shader_bundle))
    expected_root = f"chara_{args.character_id}_model"

    animators = [item for item in environment.objects if item.type.name == "Animator"]
    if len(animators) != 1:
        raise RuntimeError(f"Expected one Animator, found {len(animators)}")
    animator_reader = animators[0]
    animator = animator_reader.read()
    active_controller_path_id = str(animator.m_Controller.m_PathID)

    controllers: list[dict[str, Any]] = []
    state_uses: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for reader in environment.objects:
        if reader.type.name != "AnimatorController":
            continue
        record, uses = controller_record(reader)
        record["active"] = record["pathId"] == active_controller_path_id
        controllers.append(record)
        for path_id, values in uses.items():
            state_uses[path_id].extend(values)
    controllers.sort(key=lambda item: (not item["active"], int(item["pathId"])))
    if sum(bool(item["active"]) for item in controllers) != 1:
        raise RuntimeError("Active AnimatorController identity is ambiguous")

    override_count = sum(
        item.type.name == "AnimatorOverrideController"
        for item in environment.objects
    )
    clips = []
    for reader in environment.objects:
        if reader.type.name != "AnimationClip":
            continue
        clip = reader.read()
        path_id = str(reader.path_id)
        uses = state_uses.get(path_id, [])
        binding_types = sorted(
            {
                (int(binding.typeID), int(binding.customType))
                for binding in clip.m_ClipBindingConstant.genericBindings
            }
        )
        clips.append(
            {
                "name": clip.m_Name,
                "sourceClipPathId": path_id,
                "durationSeconds": float(clip.m_MuscleClip.m_StopTime),
                "sampleRate": float(clip.m_SampleRate),
                "bindingCount": len(clip.m_ClipBindingConstant.genericBindings),
                "bindingTypes": [
                    {"typeId": type_id, "customType": custom_type}
                    for type_id, custom_type in binding_types
                ],
                "loopInActiveController": any(
                    bool(use["loop"])
                    and use["controllerPathId"] == active_controller_path_id
                    for use in uses
                ),
                "stateUses": uses,
            }
        )
    clips.sort(key=lambda item: (item["name"].casefold(), int(item["sourceClipPathId"])))
    if len(clips) != 67:
        raise RuntimeError(f"Expected 67 A-Q clips, found {len(clips)}")
    if {item["name"] for item in clips}.__len__() != len(clips):
        raise RuntimeError("A-Q clip names are not unique")
    if not any(item["name"] == "Wait" for item in clips):
        raise RuntimeError("A-Q default Wait clip is absent")

    roots = [
        item for item in environment.objects
        if item.type.name == "GameObject" and item.read().m_Name == expected_root
    ]
    if len(roots) != 1:
        raise RuntimeError(f"Expected one {expected_root} root, found {len(roots)}")

    meshes = [object_record(item) for item in environment.objects if item.type.name == "Mesh"]
    renderers = []
    for reader in environment.objects:
        if reader.type.name != "SkinnedMeshRenderer":
            continue
        value = reader.read()
        game_object = pointer_target(value.m_GameObject)
        renderers.append(
            {
                "pathId": str(reader.path_id),
                "hierarchyPath": hierarchy(game_object),
                "mesh": pointer_record(value.m_Mesh),
                "materials": [pointer_record(item) for item in value.m_Materials],
                "boneCount": len(value.m_Bones),
                "rootBone": pointer_record(value.m_RootBone),
            }
        )

    materials = []
    texture_outputs: dict[tuple[int, str], dict[str, Any]] = {}
    for reader in environment.objects:
        if reader.type.name != "Material":
            continue
        material = reader.read()
        if str(args.character_id) not in material.m_Name:
            continue
        textures = []
        for slot, value in material.m_SavedProperties.m_TexEnvs:
            pointer = value.m_Texture
            if not pointer.m_FileID and not pointer.m_PathID:
                continue
            record = pointer_record(pointer)
            record.update(
                {
                    "slot": slot,
                    "scale": [float(value.m_Scale.x), float(value.m_Scale.y)],
                    "offset": [float(value.m_Offset.x), float(value.m_Offset.y)],
                    "scope": "local" if int(pointer.m_FileID) == 0 else "dependency",
                    "outputFile": f"{record['name']}.png" if record["name"] else None,
                }
            )
            textures.append(record)
            if record["name"]:
                texture_outputs[(int(pointer.m_FileID), record["pathId"])] = record
        materials.append(
            {
                "pathId": str(reader.path_id),
                "name": material.m_Name,
                "shader": pointer_record(material.m_Shader),
                "textures": textures,
            }
        )
    materials.sort(key=lambda item: item["name"])
    referenced_textures = sorted(
        texture_outputs.values(),
        key=lambda item: (item["scope"], item["name"]),
    )
    local_textures = [item for item in referenced_textures if item["scope"] == "local"]
    dependency_textures = [
        item for item in referenced_textures if item["scope"] == "dependency"
    ]
    if len(local_textures) != 7 or len(dependency_textures) != 2:
        raise RuntimeError(
            "Expected seven local and two referenced dependency textures, found "
            f"{len(local_textures)} and {len(dependency_textures)}"
        )

    thumbnail_environment = UnityPy.load(str(args.thumbnail_bundle))
    thumbnails = [
        item for item in thumbnail_environment.objects
        if item.type.name == "Texture2D"
    ]
    if len(thumbnails) != 1:
        raise RuntimeError(f"Expected one thumbnail Texture2D, found {len(thumbnails)}")
    thumbnail_reader = thumbnails[0]
    thumbnail = thumbnail_reader.read()
    args.thumbnail_output.parent.mkdir(parents=True, exist_ok=True)
    thumbnail.image.save(args.thumbnail_output)

    payload = {
        "schema": "magius.direct-home-actions.v1",
        "runtimeSchema": 2,
        "characterId": args.character_id,
        "style3dCharacterMstId": args.character_id,
        "displayName": "A-Q" if args.character_id == 113501 else expected_root,
        "resourceName": expected_root,
        "unityVersion": args.unity_version,
        "source": f"home/{expected_root}",
        "sourceBundleLogicalKey": f"AssetBundles/home/{expected_root}",
        "dependencyBundleKeys": ["AssetBundles/shader/redrive_toon"],
        "defaultAction": "Wait",
        "requiredClips": ["Wait"],
        "expressionMode": "embedded-transform-clips",
        "root": object_record(roots[0]),
        "animator": {
            "pathId": str(animator_reader.path_id),
            "controller": pointer_record(animator.m_Controller),
            "avatar": pointer_record(animator.m_Avatar),
        },
        "activeControllerPathId": active_controller_path_id,
        "animatorOverrideControllerCount": override_count,
        "controllers": controllers,
        "boardActions": clips,
        "meshes": meshes,
        "renderers": renderers,
        "materials": materials,
        "textureClosure": {
            "localCount": len(local_textures),
            "dependencyCount": len(dependency_textures),
            "textures": referenced_textures,
        },
        "thumbnail": {
            "sourceBundleLogicalKey": (
                "AssetBundles/home/doll_house_character/thumbnail_3d/"
                f"{args.character_id}_thumbnail"
            ),
            "pathId": str(thumbnail_reader.path_id),
            "name": thumbnail.m_Name,
            "width": int(thumbnail.m_Width),
            "height": int(thumbnail.m_Height),
            "outputFile": args.thumbnail_output.name,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "status": "PASS",
                "characterId": args.character_id,
                "clips": len(clips),
                "controllers": len(controllers),
                "activeControllerPathId": active_controller_path_id,
                "localTextures": len(local_textures),
                "dependencyTextures": len(dependency_textures),
                "thumbnail": [int(thumbnail.m_Width), int(thumbnail.m_Height)],
                "output": str(args.output.resolve()),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
