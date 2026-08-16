from __future__ import annotations

import argparse
import json
import math
import struct
import zlib
from pathlib import Path
from typing import Any

import UnityPy
from UnityPy import config as unitypy_config


def unwrap(value: Any) -> Any:
    return getattr(value, "data", value)


def read_streamed_frames(words: list[int]) -> list[dict[str, Any]]:
    """Decode Unity StreamedClip's big-endian frame/key records."""
    data = b"".join(struct.pack(">I", word) for word in words)
    offset = 0
    frames: list[dict[str, Any]] = []
    while offset + 8 <= len(data):
        time, key_count = struct.unpack_from(">fI", data, offset)
        offset += 8
        keys = []
        for _ in range(key_count):
            index = struct.unpack_from(">I", data, offset)[0]
            coeff = list(struct.unpack_from(">ffff", data, offset + 4))
            offset += 20
            keys.append({"index": index, "coeff": coeff, "value": coeff[3]})
        if math.isfinite(time) and time >= 0:
            frames.append({"time": time, "keys": keys})
    return frames


def clip_name(pointer: Any) -> str | None:
    if pointer is None or not pointer:
        return None
    value = pointer.read()
    return value.m_Name if value else None


def find_character_morph_names(
    evidence_path: Path,
    character_id: str,
) -> tuple[list[str], dict[int, str]]:
    evidence = json.loads(evidence_path.read_text(encoding="utf-8-sig"))
    marker = f"chara_{character_id}_battle_unit"
    record = next(item for item in evidence if marker in item["file"])
    face = next(item for item in record["meshesWithMorphTargets"] if item["name"] == "Face_Mesh")
    names = [
        name
        for name, _index in sorted(
            face["morphTargetDictionary"].items(),
            key=lambda pair: pair[1],
        )
    ]
    return names, {
        zlib.crc32(f"Bs.{name}".encode()) & 0xFFFFFFFF: name
        for name in names
    }


def read_character_morph_names(
    model_bundle: Path,
) -> tuple[list[str], dict[int, str]]:
    environment = UnityPy.load(str(model_bundle))
    meshes = [
        obj.read()
        for obj in environment.objects
        if obj.type.name == "Mesh"
    ]
    channels = [
        channel
        for mesh in meshes
        for channel in mesh.m_Shapes.channels
    ]
    if not channels:
        raise RuntimeError(f"No morph targets found in {model_bundle}")
    # AssetStudio keeps only the final blend-shape token in the FBX
    # morphTargetDictionary. Most characters serialize `Bs.Name`, while
    # multi-face characters use longer mesh-qualified paths. Preserve the raw
    # channel order (used by constant AnimationClip bindings) but normalize
    # every form to the exact FBX target token.
    def fbx_morph_name(channel_name: str) -> str:
        return channel_name.rsplit(".", 1)[-1]

    names = list(dict.fromkeys(
        fbx_morph_name(channel.name)
        for channel in channels
    ))
    attributes: dict[int, str] = {}
    for channel in channels:
        name = fbx_morph_name(channel.name)
        attribute = int(channel.nameHash)
        previous = attributes.get(attribute)
        if previous is not None and previous != name:
            raise RuntimeError(
                f"Morph hash collision {attribute}: {previous} != {name}"
            )
        attributes[attribute] = name
    return names, attributes


def nonzero_weights(names: list[str], values: list[float]) -> dict[str, float]:
    return {
        name: round(float(value) / 100.0, 7)
        for name, value in zip(names, values)
        if abs(float(value)) > 1e-5
    }


def sample_clip_values(clip: Any) -> list[float]:
    data = clip.m_MuscleClip.m_Clip.data
    streamed_count = int(data.m_StreamedClip.curveCount)
    dense_count = int(data.m_DenseClip.m_CurveCount)

    streamed_values = [0.0] * streamed_count
    for frame in read_streamed_frames(list(data.m_StreamedClip.data)):
        for key in frame["keys"]:
            index = int(key["index"])
            if 0 <= index < streamed_count:
                streamed_values[index] = float(key["value"])

    dense_values = [0.0] * dense_count
    if dense_count:
        samples = list(data.m_DenseClip.m_SampleArray)
        frame_count = int(data.m_DenseClip.m_FrameCount)
        if frame_count > 0 and len(samples) >= frame_count * dense_count:
            offset = (frame_count - 1) * dense_count
            dense_values = [float(value) for value in samples[offset : offset + dense_count]]

    return streamed_values + dense_values + [
        float(value) for value in data.m_ConstantClip.data
    ]


def controller_blink_constants(controller: Any) -> dict[str, float] | None:
    names = dict(controller.m_TOS)
    state_by_name: dict[str, Any] = {}
    for machine_ptr in controller.m_Controller.m_StateMachineArray:
        machine = unwrap(machine_ptr)
        for state_ptr in machine.m_StateConstantArray:
            state = unwrap(state_ptr)
            state_by_name[names.get(state.m_NameID, str(state.m_NameID))] = state

    required = {
        "Home_Eye_Empty",
        "Home_Eye_Blink",
        "Home_Eye_Empty_1",
        "Home_Eye_BlinkInterval",
    }
    if not required.issubset(state_by_name):
        return None
    empty = state_by_name["Home_Eye_Empty"]
    blink = state_by_name["Home_Eye_Blink"]
    empty_after = state_by_name["Home_Eye_Empty_1"]
    interval = state_by_name["Home_Eye_BlinkInterval"]
    empty_transition = unwrap(empty.m_TransitionConstantArray[0])
    blink_transition = unwrap(blink.m_TransitionConstantArray[0])
    empty_after_transition = unwrap(empty_after.m_TransitionConstantArray[0])
    interval_transition = unwrap(interval.m_TransitionConstantArray[0])
    return {
        "emptyExitTime": float(empty_transition.m_ExitTime),
        "fadeInSeconds": float(empty_transition.m_TransitionDuration),
        "blinkExitTime": float(blink_transition.m_ExitTime),
        "fadeOutSeconds": float(blink_transition.m_TransitionDuration),
        "afterBlinkExitTime": float(empty_after_transition.m_ExitTime),
        "afterBlinkTransitionSeconds": float(empty_after_transition.m_TransitionDuration),
        "intervalSpeed": float(interval.m_Speed),
        "intervalExitTime": float(interval_transition.m_ExitTime),
        "intervalTransitionSeconds": float(interval_transition.m_TransitionDuration),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--character-id", required=True)
    parser.add_argument("--home-bundle", required=True, type=Path)
    parser.add_argument("--model-bundle", type=Path)
    parser.add_argument("--morph-evidence", type=Path)
    parser.add_argument("--unity-version", default="2022.3.62f2")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    if args.unity_version != "2022.3.62f2":
        raise RuntimeError(
            "This JP exporter requires the explicit Unity 2022.3.62f2 release profile"
        )
    unitypy_config.FALLBACK_UNITY_VERSION = args.unity_version

    if args.model_bundle:
        morph_names, attribute_to_name = read_character_morph_names(
            args.model_bundle
        )
    elif args.morph_evidence:
        morph_names, attribute_to_name = find_character_morph_names(
            args.morph_evidence,
            args.character_id,
        )
    else:
        raise RuntimeError("Provide --model-bundle or --morph-evidence")
    environment = UnityPy.load(str(args.home_bundle))
    clips = {
        data.m_Name: data
        for obj in environment.objects
        if obj.type.name == "AnimationClip"
        for data in [obj.read()]
    }
    overrides = [
        obj.read()
        for obj in environment.objects
        if obj.type.name == "AnimatorOverrideController"
        and obj.read().m_Name == "HomeOverrideController"
    ]
    if len(overrides) != 1:
        raise RuntimeError("Expected one primary HomeOverrideController")
    controller = overrides[0].m_Controller.read()
    if not controller:
        raise RuntimeError("Primary Home override has no controller")

    expression_names: list[str] = []
    aliases: dict[str, str] = {}
    for mapping in overrides[0].m_Clips:
        original = clip_name(mapping.m_OriginalClip)
        replacement = clip_name(mapping.m_OverrideClip)
        if original and replacement and original.startswith("HomeFace"):
            aliases[original] = replacement
            if replacement not in expression_names:
                expression_names.append(replacement)

    expressions: dict[str, Any] = {}
    for name in expression_names:
        clip = clips[name]
        bindings = clip.m_ClipBindingConstant.genericBindings
        values = sample_clip_values(clip)
        if len(bindings) != len(values):
            raise RuntimeError(f"Expression {name} binding/value count differs")
        expression_morph_names = [
            attribute_to_name.get(int(binding.attribute))
            for binding in bindings
        ]
        unresolved = [
            int(binding.attribute)
            for binding, morph_name in zip(bindings, expression_morph_names)
            if morph_name is None
        ]
        resolved_names = [
            morph_name
            for morph_name in expression_morph_names
            if morph_name is not None
        ]
        resolved_values = [
            value
            for morph_name, value in zip(expression_morph_names, values)
            if morph_name is not None
        ]
        expressions[name] = {
            "duration": float(clip.m_MuscleClip.m_StopTime),
            "weights": nonzero_weights(resolved_names, resolved_values),
            "unresolvedAttributes": unresolved,
        }

    blink_clip = clips["HomeEyeBlink"]
    blink_bindings = blink_clip.m_ClipBindingConstant.genericBindings
    blink_names = [
        attribute_to_name.get(int(binding.attribute))
        for binding in blink_bindings
    ]
    blink_unresolved = [
        int(binding.attribute)
        for binding, name in zip(blink_bindings, blink_names)
        if name is None
    ]
    blink_values = list(blink_clip.m_MuscleClip.m_Clip.data.m_ConstantClip.data)

    mouth_clip = clips["HomeMouthOpen"]
    mouth_data = mouth_clip.m_MuscleClip.m_Clip.data
    mouth_bindings = mouth_clip.m_ClipBindingConstant.genericBindings
    mouth_attributes = [int(binding.attribute) for binding in mouth_bindings]
    mouth_names = [attribute_to_name.get(attribute) for attribute in mouth_attributes]
    streamed_count = int(mouth_data.m_StreamedClip.curveCount)
    dense_count = int(mouth_data.m_DenseClip.m_CurveCount)
    if streamed_count != 1 or dense_count != 0:
        raise RuntimeError("Unexpected HomeMouthOpen curve layout")
    mouth_constants = list(mouth_data.m_ConstantClip.data)
    mouth_constant_names = mouth_names[streamed_count + dense_count :]
    frames = read_streamed_frames(list(mouth_data.m_StreamedClip.data))
    stream_keys = [
        {"time": frame["time"], "coeff": frame["keys"][0]["coeff"]}
        for frame in frames
        if frame["keys"] and frame["keys"][0]["index"] == 0
    ]

    output = {
        "schema": 1,
        "characterId": int(args.character_id),
        "unityVersion": args.unity_version,
        "source": f"home/doll_house/chara_{args.character_id}01_home",
        "defaultExpression": aliases["HomeFace00_Default"],
        "morphTargetCount": len(attribute_to_name),
        "expressionOrder": expression_names,
        "aliases": aliases,
        "expressions": expressions,
        "blink": {
            "duration": float(blink_clip.m_MuscleClip.m_StopTime),
            "weights": nonzero_weights(
                [name for name in blink_names if name is not None],
                [
                    value
                    for name, value in zip(blink_names, blink_values)
                    if name is not None
                ],
            ),
            "controller": (
                controller_blink_constants(controller)
                if any(name is not None for name in blink_names)
                else None
            ),
            "unresolvedAttributes": blink_unresolved,
        },
        "mouth": {
            "duration": float(mouth_clip.m_MuscleClip.m_StopTime),
            "curveTarget": mouth_names[0],
            "curveSegments": stream_keys,
            "constantWeights": nonzero_weights(
                [name for name in mouth_constant_names if name is not None],
                [
                    value
                    for name, value in zip(mouth_constant_names, mouth_constants)
                    if name is not None
                ],
            ),
            "unresolvedAttributes": [
                attribute
                for attribute, name in zip(mouth_attributes, mouth_names)
                if name is None
            ],
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Keep generated runtime assets byte-identical on Windows and Unix.  The
    # repository stores JSON with LF line endings, so avoid pathlib's native
    # newline translation here.
    with args.output.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                "status": "PASS",
                "characterId": int(args.character_id),
                "expressions": len(expressions),
                "morphTargets": len(morph_names),
                "mouthCurveKeys": len(stream_keys),
                "output": str(args.output.resolve()),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
