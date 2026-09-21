#!/usr/bin/env python3
"""Generate a reusable Viewer scene profile from one frozen Unity bundle closure.

The extractor is scene-agnostic: it follows the serialized Volume ->
VolumeProfile -> VolumeComponent graph, Light/Transform hierarchy, Material
texture PPtrs, PrefabLightmapData, ReflectionProbe and VLB component records.
An explicitly supplied player ``resources.assets`` contributes the one global
``VLBConfigOverride`` used by every scene; no installation scan is performed.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import re
import struct
import zlib
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import UnityPy
from PIL import Image
from UnityPy.enums import BuildTarget
from UnityPy.export.Texture2DConverter import parse_image_data
from UnityPy.helpers.MeshHelper import MeshHandler


LIGHT_TYPES = {0: "spot", 1: "directional", 2: "point"}
REFLECTION_PROBE_USAGE = {
    0: "off",
    1: "blend-probes",
    2: "blend-probes-and-skybox",
    3: "simple",
}
UNITY_TEXTURE_FORMAT_BC6H = 24
UNITY_TEXTURE_FORMAT_RGBA_HALF = 17
VOLUME_CLASSES = {
    "Bloom",
    "ChromaticAberration",
    "ColorAdjustments",
    "FilmGrain",
    "ReDriveVolume",
    "Tonemapping",
    "Vignette",
}
FILM_GRAIN_PRESET_NAMES = {
    0: "Thin01",
    1: "Thin02",
    2: "Medium01",
    3: "Medium02",
    4: "Medium03",
    5: "Medium04",
    6: "Medium05",
    7: "Medium06",
    8: "Large01",
    9: "Large02",
}
FILM_GRAIN_CUSTOM = 10
REDRIVE_PARAMETERS = {
    "_skyboxMaterial": "skyboxMaterial",
    "_skyboxIntensity": "skyboxIntensity",
    "_reflectionProbe": "reflectionProbe",
    "_fogColor": "fogColor",
    "_fogRange": "fogRange",
    "SH2": "shAmbient",
    "_globalCharacterTintColor": "characterTint",
    "_globalCharacterShadowTintColor": "characterShadowTint",
    "_globalBackgroundTintColor": "backgroundTint",
    "_globalCharacterLightingOverrideColor": "characterLightingOverrideColor",
    "_globalCharacterLightingOverrideRatio": "characterLightingOverrideRatio",
    "_globalCharacterLightingOverrideDirection": "characterLightingOverrideDirection",
    "_globalCharacterAdditionalRimLightColor": "characterAdditionalRimLightColor",
    "_globalCharacterAdditionalRimLightDirection": "characterAdditionalRimLightDirection",
    "_globalCharacterFaceAwayTintColor": "characterFaceAwayTint",
    "_globalCharacterCancelPerspective": "characterCancelPerspective",
    "_bgShadowStrengthAdditive": "backgroundShadowStrengthAdditive",
    "_bgPostExposure": "backgroundPostExposure",
    "_bgContrast": "backgroundContrast",
    "_bgSaturation": "backgroundSaturation",
    "_bgBackgroundTintColor": "backgroundBackgroundTint",
    "_useFixedLightDir": "useFixedLightDirection",
    "_tintTopColor": "paraffin",
    "_screenTexture": "screenTexture",
    "_lightScreenIntensity": "lightScreen",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract an automatic Magius scene/light/material profile"
    )
    parser.add_argument("closure_manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--stage-id", default=None)
    parser.add_argument(
        "--asset-prefix",
        default=".",
        help="Page-relative URL prefix for exported textures/profile companions",
    )
    parser.add_argument(
        "--product-dir",
        type=Path,
        default=None,
        help="Optional packaged stage directory; existing lightmap/probe files are linked",
    )
    parser.add_argument(
        "--export-assets",
        action="store_true",
        help="Export missing textures, lightmap bindings and UV1 data into product-dir",
    )
    parser.add_argument(
        "--model-url",
        default="",
        help="Catalog model URL recorded in generated UV1 evidence",
    )
    parser.add_argument(
        "--player-resources",
        type=Path,
        default=None,
        help=(
            "Optional exact player resources.assets containing the global "
            "VLBConfigOverride"
        ),
    )
    parser.add_argument(
        "--player-global-managers",
        type=Path,
        default=None,
        help=(
            "Optional exact player globalgamemanagers.assets containing the "
            "URP built-in FilmGrain preset textures"
        ),
    )
    return parser.parse_args()


def pointer_path_id(pointer: Any) -> int:
    if pointer is None:
        return 0
    if isinstance(pointer, dict):
        return int(pointer.get("m_PathID", 0) or 0)
    return int(getattr(pointer, "m_PathID", 0) or 0)


def vector(value: Any, names: tuple[str, ...] = ("x", "y", "z", "w")) -> list[float]:
    if value is None:
        return []
    if (
        isinstance(value, dict)
        and all(key in value for key in ("r", "g", "b"))
        and all(isinstance(value[key], (int, float)) for key in ("r", "g", "b"))
    ):
        return [float(value[key]) for key in ("r", "g", "b", "a") if key in value]
    if (
        isinstance(value, dict)
        and all(key in value for key in ("x", "y"))
        and all(isinstance(value[key], (int, float)) for key in ("x", "y"))
    ):
        return [float(value[key]) for key in ("x", "y", "z", "w") if key in value]
    if isinstance(value, dict):
        return [float(value[name]) for name in names if name in value]
    result = [float(getattr(value, name)) for name in names if hasattr(value, name)]
    if result:
        return result
    if isinstance(value, (list, tuple)):
        return [float(item) for item in value]
    return []


def _align4(offset: int) -> int:
    return (offset + 3) & ~3


def parse_vlb_config_override_raw(data: bytes) -> dict[str, Any]:
    """Decode VLB 1.970's serialized ConfigOverride without guessed defaults.

    Unity player resources do not carry a usable MonoBehaviour typetree for
    this plugin. The field order below is the public ``VLB.Config`` layout
    recovered from the matching IL2CPP metadata. Every bool is individually
    aligned by Unity serialization, so the five feature gates occupy four
    bytes each.
    """

    name = b"VLBConfigOverride"
    name_at = data.find(name)
    if name_at < 4 or struct.unpack_from("<I", data, name_at - 4)[0] != len(name):
        raise ValueError("MonoBehaviour is not a VLBConfigOverride")
    offset = _align4(name_at + len(name))

    def require(size: int) -> None:
        if offset + size > len(data):
            raise ValueError("VLBConfigOverride payload is truncated")

    def integer() -> int:
        nonlocal offset
        require(4)
        value = struct.unpack_from("<i", data, offset)[0]
        offset += 4
        return value

    def floating() -> float:
        nonlocal offset
        require(4)
        value = struct.unpack_from("<f", data, offset)[0]
        offset += 4
        return float(value)

    def boolean() -> bool:
        nonlocal offset
        require(1)
        value = data[offset] != 0
        offset = _align4(offset + 1)
        return value

    def string() -> str:
        nonlocal offset
        length = integer()
        if length < 0:
            raise ValueError("VLBConfigOverride string length is negative")
        require(length)
        value = data[offset : offset + length].decode("utf-8")
        offset = _align4(offset + length)
        return value

    def pointer() -> dict[str, int]:
        nonlocal offset
        require(12)
        file_id, path_id = struct.unpack_from("<iq", data, offset)
        offset += 12
        return {"fileID": int(file_id), "pathID": int(path_id)}

    result = {
        "name": name.decode("ascii"),
        "geometryOverrideLayer": boolean(),
        "geometryLayerID": integer(),
        "geometryTag": string(),
        "geometryRenderQueue": integer(),
        "renderPipeline": integer(),
        "renderingMode": integer(),
        "ditheringFactor": floating(),
        "sharedMeshSides": integer(),
        "sharedMeshSegments": integer(),
        "globalNoiseScale": floating(),
        "globalNoiseVelocity": [floating(), floating(), floating()],
        "fadeOutCameraTag": string(),
        "noiseTexture3D": pointer(),
        "dustParticlesPrefab": pointer(),
        "ditheringNoiseTexture": pointer(),
        "featureEnabledColorGradient": integer(),
        "featureEnabledDepthBlend": boolean(),
        "featureEnabledNoise3D": boolean(),
        "featureEnabledDynamicOcclusion": boolean(),
        "featureEnabledMeshSkewing": boolean(),
        "featureEnabledShaderAccuracyHigh": boolean(),
        "pluginVersion": integer(),
        "dummyMaterial": pointer(),
        "beamShader": pointer(),
    }
    if offset != len(data):
        raise ValueError(
            f"VLBConfigOverride has {len(data) - offset} unparsed bytes"
        )
    return result


def extract_vlb_player_config(resources_path: Path) -> dict[str, Any]:
    """Read the unique global VLBConfigOverride from one explicit asset file."""

    if not resources_path.is_file():
        raise FileNotFoundError(resources_path)
    environment = UnityPy.load(str(resources_path))
    matches: list[tuple[Any, bytes]] = []
    for reader in environment.objects:
        if reader.type.name != "MonoBehaviour":
            continue
        raw = reader.get_raw_data()
        if b"VLBConfigOverride" in raw:
            matches.append((reader, raw))
    if len(matches) != 1:
        raise ValueError(
            f"Expected one VLBConfigOverride in {resources_path}, found {len(matches)}"
        )
    reader, raw = matches[0]
    result = parse_vlb_config_override_raw(raw)
    result.update(
        {
            "source": str(resources_path.resolve()),
            "sourceBytes": resources_path.stat().st_size,
            "objectPathID": str(reader.path_id),
            "objectBytes": len(raw),
        }
    )
    return result


def rgba(value: Any) -> list[float]:
    return vector(value, ("r", "g", "b", "a"))


def clean(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return {"byteCount": len(value)}
    if (
        isinstance(value, dict)
        and all(key in value for key in ("r", "g", "b"))
        and all(isinstance(value[key], (int, float)) for key in ("r", "g", "b"))
    ):
        return [float(value[key]) for key in ("r", "g", "b", "a") if key in value]
    if (
        isinstance(value, dict)
        and all(key in value for key in ("x", "y"))
        and all(isinstance(value[key], (int, float)) for key in ("x", "y"))
    ):
        return [float(value[key]) for key in ("x", "y", "z", "w") if key in value]
    if isinstance(value, dict):
        return {str(key): clean(nested) for key, nested in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(nested) for nested in value]
    values = vector(value)
    if values:
        return values
    if hasattr(value, "__dict__"):
        return {
            str(key): clean(nested)
            for key, nested in vars(value).items()
            if not str(key).startswith("_")
        }
    return repr(value)


def json_safe_numbers(
    value: Any,
    path: str = "$",
    records: list[dict[str, str]] | None = None,
) -> Any:
    """Keep Python's non-finite floats as typed evidence while emitting strict JSON."""

    if isinstance(value, float) and not math.isfinite(value):
        label = "NaN" if math.isnan(value) else ("Infinity" if value > 0 else "-Infinity")
        if records is not None:
            records.append({"path": path, "value": label})
        return {"type": "non-finite-float", "value": label}
    if isinstance(value, dict):
        return {
            str(key): json_safe_numbers(nested, f"{path}.{key}", records)
            for key, nested in value.items()
        }
    if isinstance(value, list):
        return [
            json_safe_numbers(nested, f"{path}[{index}]", records)
            for index, nested in enumerate(value)
        ]
    if isinstance(value, tuple):
        return [
            json_safe_numbers(nested, f"{path}[{index}]", records)
            for index, nested in enumerate(value)
        ]
    return value


def streamed_clip_frames(words: Iterable[int]) -> list[dict[str, Any]]:
    """Decode Unity 2022 StreamedClip frame/key words without editor APIs."""

    payload = b"".join(struct.pack(">I", int(word)) for word in words)
    offset = 0
    frames: list[dict[str, Any]] = []
    while offset + 8 <= len(payload):
        time, key_count = struct.unpack_from(">fI", payload, offset)
        offset += 8
        keys: list[dict[str, Any]] = []
        required = offset + int(key_count) * 20
        if required > len(payload):
            raise ValueError("StreamedClip key payload exceeds serialized data")
        for _ in range(int(key_count)):
            index = struct.unpack_from(">I", payload, offset)[0]
            coefficients = struct.unpack_from(">ffff", payload, offset + 4)
            offset += 20
            keys.append(
                {
                    "curveIndex": int(index),
                    "coefficients": [float(value) for value in coefficients],
                    "value": float(coefficients[3]),
                }
            )
        if math.isfinite(time):
            # Unity stores the initial value of every streamed curve in a
            # sentinel frame at -FLT_MAX.  Object-reference curves rely on
            # that frame for their first Sprite, so retain it at clip time 0.
            initial = time <= -3.0e38
            if initial or time >= 0:
                frames.append(
                    {
                        "time": 0.0 if initial else float(time),
                        "serializedTime": float(time),
                        "initial": initial,
                        "keys": keys,
                    }
                )
    if offset != len(payload):
        raise ValueError("StreamedClip payload was not consumed exactly")
    return frames


def generic_binding_scalar_count(binding: Any) -> int:
    if int(binding.typeID) != 4:  # Transform
        return 1
    attribute = int(binding.attribute)
    if attribute in {1, 3, 4}:
        return 3
    if attribute == 2:
        return 4
    return 1


def _asset_file_name(value: Any) -> str | None:
    assets_file = getattr(value, "assets_file", None) or getattr(value, "assetsfile", None)
    return str(getattr(assets_file, "name", "")) or None


def _sprite_asset_record(sprite: Any) -> dict[str, Any]:
    reader = sprite.object_reader
    render_data = sprite.m_RD
    texture = render_data.texture
    texture_rect = render_data.textureRect
    texture_offset = render_data.textureRectOffset
    atlas_offset = getattr(render_data, "atlasRectOffset", None)
    asset_file = str(reader.assets_file.name)
    path_id = int(reader.path_id)
    return {
        "stableKey": f"sprite:{asset_file.lower()}#{path_id}",
        "pathID": str(path_id),
        "assetFile": asset_file,
        "name": str(sprite.m_Name),
        "rect": vector(sprite.m_Rect, ("x", "y", "width", "height")),
        "pivot": vector(sprite.m_Pivot, ("x", "y")),
        "offset": vector(sprite.m_Offset, ("x", "y")),
        "border": vector(sprite.m_Border),
        "pixelsPerUnit": float(sprite.m_PixelsToUnits),
        "extrude": int(sprite.m_Extrude),
        "isPolygon": bool(sprite.m_IsPolygon),
        "renderData": {
            "settingsRaw": int(render_data.settingsRaw),
            "textureRect": vector(texture_rect, ("x", "y", "width", "height")),
            "textureRectOffset": vector(texture_offset, ("x", "y")),
            "atlasRectOffset": vector(atlas_offset, ("x", "y"))
            if atlas_offset is not None
            else None,
            "downscaleMultiplier": float(render_data.downscaleMultiplier),
            "texture": {
                "fileID": int(texture.file_id),
                "pathID": str(texture.path_id),
                "assetFile": _asset_file_name(texture),
            },
        },
    }


def _pptr_curve_mapping_records(clip: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    mapping_records: list[dict[str, Any]] = []
    sprite_assets: dict[str, dict[str, Any]] = {}
    for mapping_index, pointer in enumerate(clip.m_ClipBindingConstant.pptrCurveMapping):
        pointer_record: dict[str, Any] = {
            "mappingIndex": mapping_index,
            "pointer": {
                "fileID": int(pointer.file_id),
                "pathID": str(pointer.path_id),
                "assetFile": _asset_file_name(pointer),
            },
            "objectType": None,
            "stableObjectKey": None,
        }
        if int(pointer.path_id):
            target = pointer.read()
            target_reader = target.object_reader
            target_asset_file = str(target_reader.assets_file.name)
            target_type = target.__class__.__name__
            stable_object_key = (
                f"{target_type.lower()}:{target_asset_file.lower()}#{int(target_reader.path_id)}"
            )
            pointer_record.update(
                {
                    "objectType": target_type,
                    "stableObjectKey": stable_object_key,
                    "targetPathID": str(target_reader.path_id),
                    "targetAssetFile": target_asset_file,
                    "targetName": str(getattr(target, "m_Name", "")),
                }
            )
            if target_type == "Sprite":
                sprite_record = _sprite_asset_record(target)
                pointer_record["spriteStableKey"] = sprite_record["stableKey"]
                sprite_assets[sprite_record["stableKey"]] = sprite_record
        mapping_records.append(pointer_record)
    return mapping_records, [sprite_assets[key] for key in sorted(sprite_assets)]


def validated_pptr_mapping_index(value: Any, mapping_count: int, clip_name: str) -> int:
    """Return one exact Unity PPtr mapping index or fail closed."""

    numeric_value = float(value)
    if not math.isfinite(numeric_value) or not numeric_value.is_integer():
        raise ValueError(f"{clip_name}: non-integral PPtr mapping index: {numeric_value}")
    mapping_index = int(numeric_value)
    if not 0 <= mapping_index < mapping_count:
        raise ValueError(f"{clip_name}: PPtr mapping index out of range: {mapping_index}")
    return mapping_index


def serialized_component_clip_record(
    reader: Any, *, include_transform_only: bool = False
) -> dict[str, Any] | None:
    """Return hash-addressed non-Transform curves retained in player data.

    Player bundles discard EditorCurveBinding.propertyName strings. The hash,
    component type, custom binding type and values remain authoritative; the
    missing string is deliberately not guessed here.
    """

    clip = reader.read()
    bindings = list(clip.m_ClipBindingConstant.genericBindings)
    if not bindings or (not include_transform_only and not any(int(binding.typeID) != 4 for binding in bindings)):
        return None
    packed = clip.m_MuscleClip.m_Clip.data
    scalar_owners: list[tuple[int, int]] = []
    for binding_index, binding in enumerate(bindings):
        scalar_owners.extend(
            (binding_index, component_index)
            for component_index in range(generic_binding_scalar_count(binding))
        )
    streamed_frames = streamed_clip_frames(packed.m_StreamedClip.data)
    serialized_streamed_count = int(packed.m_StreamedClip.curveCount)
    observed_streamed_count = max(
        (
            int(key["curveIndex"]) + 1
            for frame in streamed_frames
            for key in frame["keys"]
        ),
        default=0,
    )
    effective_streamed_count = max(serialized_streamed_count, observed_streamed_count)
    dense_count = int(packed.m_DenseClip.m_CurveCount)
    constant_count = len(packed.m_ConstantClip.data)
    packed_scalar_count = effective_streamed_count + dense_count + constant_count
    if len(scalar_owners) != packed_scalar_count:
        raise ValueError(
            f"{clip.m_Name}: packed scalar/binding count mismatch "
            f"(bindings={len(scalar_owners)}, packed={packed_scalar_count}, "
            f"serializedStreamed={serialized_streamed_count}, "
            f"observedStreamed={observed_streamed_count})"
        )

    pptr_mapping, sprite_assets = _pptr_curve_mapping_records(clip)
    values: list[list[dict[str, Any]]] = [[] for _ in scalar_owners]
    for frame in streamed_frames:
        for key in frame["keys"]:
            index = int(key["curveIndex"])
            if not 0 <= index < effective_streamed_count:
                raise ValueError(f"{clip.m_Name}: streamed curve index out of range: {index}")
            binding_index, _component_index = scalar_owners[index]
            binding = bindings[binding_index]
            key_record: dict[str, Any] = {
                "time": frame["time"],
                "serializedTime": frame["serializedTime"],
                "initial": bool(frame["initial"]),
                "coefficients": key["coefficients"],
                "storage": "streamed-initial" if frame["initial"] else "streamed",
            }
            if bool(binding.isPPtrCurve):
                key_record["mappingIndex"] = validated_pptr_mapping_index(
                    key["value"], len(pptr_mapping), str(clip.m_Name)
                )
                key_record["interpolation"] = "step"
            else:
                key_record["value"] = float(key["value"])
            values[index].append(key_record)
    for frame_index in range(int(packed.m_DenseClip.m_FrameCount)):
        time = float(
            packed.m_DenseClip.m_BeginTime
            + frame_index / packed.m_DenseClip.m_SampleRate
        )
        frame_offset = frame_index * dense_count
        for dense_index in range(dense_count):
            scalar_index = effective_streamed_count + dense_index
            binding_index, _component_index = scalar_owners[scalar_index]
            if bool(bindings[binding_index].isPPtrCurve):
                raise ValueError(f"{clip.m_Name}: PPtr curve stored in DenseClip")
            values[scalar_index].append(
                {
                    "time": time,
                    "value": float(
                        packed.m_DenseClip.m_SampleArray[frame_offset + dense_index]
                    ),
                    "storage": "dense",
                }
            )
    constant_base = effective_streamed_count + dense_count
    stop_time = float(clip.m_MuscleClip.m_StopTime)
    for constant_index, value in enumerate(packed.m_ConstantClip.data):
        scalar_index = constant_base + constant_index
        binding_index, _component_index = scalar_owners[scalar_index]
        if bool(bindings[binding_index].isPPtrCurve):
            raise ValueError(f"{clip.m_Name}: PPtr curve stored in ConstantClip")
        values[scalar_index] = [
            {"time": 0.0, "value": float(value), "storage": "constant"},
            {
                "time": stop_time,
                "value": float(value),
                "storage": "constant",
            },
        ]
    scalar_index = 0
    output_bindings: list[dict[str, Any]] = []
    for binding_index, binding in enumerate(bindings):
        scalar_count = generic_binding_scalar_count(binding)
        curves = values[scalar_index : scalar_index + scalar_count]
        scalar_index += scalar_count
        output_bindings.append(
            {
                "bindingIndex": binding_index,
                "transformPathHash": int(binding.path),
                "propertyNameHash": int(binding.attribute),
                "typeID": int(binding.typeID),
                "customType": int(binding.customType),
                "isPPtrCurve": bool(binding.isPPtrCurve),
                "isIntCurve": bool(getattr(binding, "isIntCurve", False)),
                "propertyName": None,
                "propertyNameAuthority": "hash-only-player-serialization",
                "curves": curves,
            }
        )
    return {
        "pathID": str(reader.path_id),
        "name": str(clip.m_Name),
        "decodeStatus": "complete",
        "sampleRate": float(clip.m_SampleRate),
        "duration": stop_time,
        "loop": bool(clip.m_MuscleClip.m_LoopTime),
        "streamedCurveCount": serialized_streamed_count,
        "observedStreamedCurveCount": observed_streamed_count,
        "effectiveStreamedCurveCount": effective_streamed_count,
        "denseCurveCount": dense_count,
        "constantCurveCount": constant_count,
        "genericBindingCount": len(bindings),
        "bindingScalarCount": len(scalar_owners),
        "packedScalarCount": packed_scalar_count,
        "pptrCurveMapping": pptr_mapping,
        "spriteAssets": sprite_assets,
        "bindings": output_bindings,
    }


def selected_particle_module(tree: dict[str, Any], keys: Iterable[str]) -> dict[str, Any]:
    return {key: tree[key] for key in keys if key in tree}


def quaternion_matrix(rotation: list[float]) -> list[list[float]]:
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


def transform_matrix(
    position: list[float], rotation: list[float], scale: list[float]
) -> list[list[float]]:
    result = quaternion_matrix(rotation)
    for row in range(3):
        for column in range(3):
            result[row][column] *= scale[column]
    result[0][3], result[1][3], result[2][3] = position
    return result


def matrix_multiply(
    left: list[list[float]], right: list[list[float]]
) -> list[list[float]]:
    return [
        [
            sum(left[row][index] * right[index][column] for index in range(4))
            for column in range(4)
        ]
        for row in range(4)
    ]


def matrix_transform_point(matrix: list[list[float]], point: list[float]) -> list[float]:
    return [
        sum(matrix[row][column] * point[column] for column in range(3))
        + matrix[row][3]
        for row in range(3)
    ]


def transformed_axis_aligned_box(
    matrix: list[list[float]],
    local_center: list[float],
    local_size: list[float],
) -> tuple[list[float], list[float]]:
    center = matrix_transform_point(matrix, local_center)
    half_extents = [
        sum(abs(matrix[row][column]) * local_size[column] * 0.5 for column in range(3))
        for row in range(3)
    ]
    return (
        [center[index] - half_extents[index] for index in range(3)],
        [center[index] + half_extents[index] for index in range(3)],
    )


def pptr_record(pointer: Any) -> dict[str, Any]:
    result: dict[str, Any] = {
        "fileID": int(getattr(pointer, "m_FileID", 0) or 0),
        "pathID": str(pointer_path_id(pointer)),
    }
    if not pointer_path_id(pointer):
        result["null"] = True
        return result
    try:
        reader = pointer.deref()
        obj = pointer.read()
        name = str(getattr(obj, "m_Name", ""))
        if reader.type.name == "Shader" and not name:
            tree = reader.read_typetree()
            name = str(tree.get("m_ParsedForm", {}).get("m_Name", ""))
        result.update(
            {
                "resolved": True,
                "type": reader.type.name,
                "name": name,
                "cab": reader.assets_file.name,
            }
        )
    except Exception as error:  # keep unresolved cross-file evidence visible
        result.update({"resolved": False, "error": repr(error)})
    return result


def renderer_reflection_probe_records(
    renderers: list[tuple[Any, Any]],
    component_go: dict[int, int],
    go_by_transform: dict[int, int],
    hierarchy: Any,
    world: Any,
    transforms: dict[int, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Recover Renderer reflection-probe mode and optional sampling anchor.

    Unity serializes these fields on every MeshRenderer/SkinnedMeshRenderer.
    The anchor points to a Transform; its resolved Unity-world position is
    emitted so the browser never needs a per-scene capture or matching object.
    """

    records: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for reader, renderer in renderers:
        renderer_id = int(reader.path_id)
        go_id = component_go.get(renderer_id, 0)
        renderer_path = hierarchy(go_id) if go_id else ""
        usage = int(getattr(renderer, "m_ReflectionProbeUsage", 1))
        anchor = getattr(renderer, "m_ProbeAnchor", None)
        anchor_transform_id = pointer_path_id(anchor)
        anchor_go_id = go_by_transform.get(anchor_transform_id, 0)
        anchor_path: str | None = None
        anchor_position: list[float] | None = None
        if anchor_transform_id:
            if anchor_transform_id in transforms:
                anchor_matrix = world(anchor_transform_id)
                anchor_position = [anchor_matrix[index][3] for index in range(3)]
                anchor_path = hierarchy(anchor_go_id) if anchor_go_id else None
            else:
                failures.append(
                    {
                        "rendererPathID": str(renderer_id),
                        "rendererHierarchyPath": renderer_path,
                        "reason": "unresolved-probe-anchor-transform",
                        "probeAnchor": pptr_record(anchor),
                    }
                )
        if usage not in REFLECTION_PROBE_USAGE:
            failures.append(
                {
                    "rendererPathID": str(renderer_id),
                    "rendererHierarchyPath": renderer_path,
                    "reason": "unsupported-reflection-probe-usage",
                    "reflectionProbeUsage": usage,
                }
            )
        records.append(
            {
                "rendererPathID": str(renderer_id),
                "rendererType": reader.type.name,
                "rendererHierarchyPath": renderer_path,
                "reflectionProbeUsage": usage,
                "reflectionProbeUsageName": REFLECTION_PROBE_USAGE.get(
                    usage, "unknown"
                ),
                "probeAnchor": pptr_record(anchor),
                "probeAnchorHierarchyPath": anchor_path,
                "probeAnchorPosition": anchor_position,
            }
        )
    return records, failures


def url_join(prefix: str, filename: str) -> str:
    return f"{prefix.rstrip('/')}/{filename.lstrip('/')}"


def texture_filename(name: str) -> str:
    return re.sub(r"[\\/:*?\"<>|]+", "_", name).strip("._") + ".png"


def export_texture(pointer: Any, destination: Path) -> bool:
    """Decode one exact Texture2D PPtr; never replace an existing product asset."""

    if destination.is_file():
        return False
    obj = pointer.read()
    image = obj.image
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination)
    return True


def film_grain_texture_source(
    preset_type: int,
    custom_pointer: Any,
    player_global_managers: Path | None,
    product_dir: Path | None,
    prefix: str,
    export_assets: bool,
) -> dict[str, Any]:
    """Resolve the exact URP FilmGrain Texture2D selected by serialized type.

    URP 14 stores ten built-in presets in the player global managers and uses
    the Volume texture PPtr only for FilmGrainLookup.Custom. The runtime sampler
    remains LinearRepeat regardless of the Texture2D import filter mode.
    """

    reader: Any = None
    source_kind: str
    if preset_type == FILM_GRAIN_CUSTOM:
        source_kind = "serialized-custom-pptr"
        if custom_pointer is not None and pointer_path_id(custom_pointer):
            reader = custom_pointer.deref()
    else:
        source_kind = "urp-player-preset"
        expected_name = FILM_GRAIN_PRESET_NAMES.get(preset_type)
        if expected_name is None:
            raise ValueError(f"Unsupported FilmGrainLookup value: {preset_type}")
        if player_global_managers is not None:
            if not player_global_managers.is_file():
                raise FileNotFoundError(player_global_managers)
            player = UnityPy.load(str(player_global_managers))
            matches = [
                candidate
                for candidate in player.objects
                if candidate.type.name == "Texture2D"
                and str(getattr(candidate.read(), "m_Name", "")) == expected_name
            ]
            if len(matches) != 1:
                raise ValueError(
                    f"FilmGrain preset {expected_name} resolved {len(matches)} textures"
                )
            reader = matches[0]

    record: dict[str, Any] = {
        "lookup": preset_type,
        "lookupName": FILM_GRAIN_PRESET_NAMES.get(preset_type, "Custom"),
        "sourceKind": source_kind,
        "sampler": {"filter": "linear", "wrapU": "repeat", "wrapV": "repeat"},
        "resolved": reader is not None,
    }
    if reader is None:
        return record

    data = reader.read()
    if reader.type.name != "Texture2D":
        raise ValueError(f"FilmGrain source is not Texture2D: {reader.type.name}")
    settings = data.m_TextureSettings
    filename = f"film-grain-{str(data.m_Name).lower()}.png"
    destination = product_dir / filename if product_dir is not None else None
    wrote = False
    if export_assets:
        if destination is None:
            raise ValueError("--export-assets FilmGrain requires --product-dir")
        wrote = export_texture(reader, destination)
    record.update(
        {
            "pathID": str(reader.path_id),
            "cab": str(reader.assets_file.name),
            "name": str(data.m_Name),
            "width": int(data.m_Width),
            "height": int(data.m_Height),
            "textureFormat": int(data.m_TextureFormat),
            "mipCount": int(data.m_MipCount),
            "serializedColorSpace": int(data.m_ColorSpace),
            "serializedTextureSettings": {
                "filterMode": int(settings.m_FilterMode),
                "aniso": int(settings.m_Aniso),
                "mipBias": float(settings.m_MipBias),
                "wrapU": int(settings.m_WrapU),
                "wrapV": int(settings.m_WrapV),
                "wrapW": int(settings.m_WrapW),
            },
            "url": url_join(prefix, filename)
            if destination is not None and (destination.is_file() or export_assets)
            else None,
            "wrote": wrote,
        }
    )
    return record


def cubemap_face_uv(
    direction_x: float,
    direction_y: float,
    direction_z: float,
) -> tuple[int, float, float]:
    """Map one Unity cubemap direction to +X,-X,+Y,-Y,+Z,-Z face UV."""

    abs_x, abs_y, abs_z = map(abs, (direction_x, direction_y, direction_z))
    if max(abs_x, abs_y, abs_z) == 0:
        raise ValueError("Cubemap direction must be non-zero")
    if abs_x >= abs_y and abs_x >= abs_z:
        if direction_x >= 0:
            return 0, -direction_z / abs_x, -direction_y / abs_x
        return 1, direction_z / abs_x, -direction_y / abs_x
    if abs_y >= abs_z:
        if direction_y >= 0:
            return 2, direction_x / abs_y, direction_z / abs_y
        return 3, direction_x / abs_y, -direction_z / abs_y
    if direction_z >= 0:
        return 4, direction_x / abs_z, -direction_y / abs_z
    return 5, -direction_x / abs_z, -direction_y / abs_z


def cubemap_to_equirectangular(
    faces: list[Image.Image],
    width: int,
    height: int,
) -> Image.Image:
    rgba_faces = [face.convert("RGBA") for face in faces]
    face_width, face_height = rgba_faces[0].size
    face_pixels = [face.load() for face in rgba_faces]
    output = Image.new("RGBA", (width, height))
    pixels = output.load()
    for y in range(height):
        latitude = math.pi / 2 - ((y + 0.5) / height) * math.pi
        latitude_cos = math.cos(latitude)
        direction_y = math.sin(latitude)
        for x in range(width):
            longitude = ((x + 0.5) / width) * (2 * math.pi) - math.pi
            direction_x = latitude_cos * math.sin(longitude)
            direction_z = latitude_cos * math.cos(longitude)
            face, u, v = cubemap_face_uv(
                direction_x,
                direction_y,
                direction_z,
            )
            pixel_x = round((u + 1) * 0.5 * (face_width - 1))
            pixel_y = round((v + 1) * 0.5 * (face_height - 1))
            pixels[x, y] = face_pixels[face][pixel_x, pixel_y]
    return output


def export_cubemap_equirectangular(pointer: Any, destination: Path) -> dict[str, Any]:
    data = pointer.read()
    payload = bytes(data.get_image_data())
    image_count = int(data.m_ImageCount)
    face_chain_size = int(data.m_CompleteImageSize)
    if (
        image_count != 6
        or face_chain_size <= 0
        or len(payload) != image_count * face_chain_size
    ):
        raise ValueError(f"Unsupported Cubemap layout: {data.m_Name}")
    faces: list[Image.Image] = []
    for index in range(image_count):
        chain = payload[index * face_chain_size:(index + 1) * face_chain_size]
        faces.append(
            parse_image_data(
                chain,
                int(data.m_Width),
                int(data.m_Height),
                int(data.m_TextureFormat),
                getattr(data.object_reader, "version", (0, 0, 0, 0)),
                getattr(data.object_reader, "platform", BuildTarget.UnknownPlatform),
                getattr(data, "m_PlatformBlob", None),
                flip=True,
            ).convert("RGBA")
        )
    image = cubemap_to_equirectangular(
        faces,
        int(data.m_Width) * 4,
        int(data.m_Height) * 2,
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format="PNG", compress_level=9)
    return {
        "pathID": str(pointer_path_id(pointer)),
        "name": str(data.m_Name),
        "width": image.width,
        "height": image.height,
        "faceOrder": ["+X", "-X", "+Y", "-Y", "+Z", "-Z"],
        "coordinateConvention": "equirect center +Z, top +Y",
    }


def bc6h_mip_byte_counts(width: int, height: int, mip_count: int) -> list[int]:
    result: list[int] = []
    for _ in range(mip_count):
        result.append(max(1, (width + 3) // 4) * max(1, (height + 3) // 4) * 16)
        width = max(1, width >> 1)
        height = max(1, height >> 1)
    return result


def build_bc6h_cubemap_dds(
    payload: bytes,
    width: int,
    height: int,
    mip_count: int,
    face_chain_size: int,
) -> tuple[bytes, list[int]]:
    """Wrap Unity's exact face-major BC6H mip chains in a DDS DX10 container."""

    mip_byte_counts = bc6h_mip_byte_counts(width, height, mip_count)
    expected_face_chain_size = sum(mip_byte_counts)
    if face_chain_size != expected_face_chain_size:
        raise ValueError(
            "Unsupported BC6H face-chain layout: "
            f"serialized={face_chain_size}, expected={expected_face_chain_size}"
        )
    if len(payload) != face_chain_size * 6:
        raise ValueError(
            f"Unsupported BC6H cubemap payload: {len(payload)} != {face_chain_size} * 6"
        )

    ddsd_caps = 0x1
    ddsd_height = 0x2
    ddsd_width = 0x4
    ddsd_pixel_format = 0x1000
    ddsd_mipmap_count = 0x20000
    ddsd_linear_size = 0x80000
    ddpf_fourcc = 0x4
    ddscaps_complex = 0x8
    ddscaps_texture = 0x1000
    ddscaps_mipmap = 0x400000
    ddscaps2_all_cubemap_faces = 0xFE00
    dxgi_format_bc6h_uf16 = 95
    d3d10_resource_dimension_texture2d = 3
    d3d11_resource_misc_texturecube = 0x4

    flags = (
        ddsd_caps
        | ddsd_height
        | ddsd_width
        | ddsd_pixel_format
        | ddsd_mipmap_count
        | ddsd_linear_size
    )
    caps = ddscaps_texture | ddscaps_complex | ddscaps_mipmap
    header = (
        struct.pack(
            "<7I",
            124,
            flags,
            height,
            width,
            mip_byte_counts[0],
            0,
            mip_count,
        )
        + struct.pack("<11I", *([0] * 11))
        + struct.pack("<II4s5I", 32, ddpf_fourcc, b"DX10", 0, 0, 0, 0, 0)
        + struct.pack("<5I", caps, ddscaps2_all_cubemap_faces, 0, 0, 0)
    )
    extended_header = struct.pack(
        "<5I",
        dxgi_format_bc6h_uf16,
        d3d10_resource_dimension_texture2d,
        d3d11_resource_misc_texturecube,
        1,
        0,
    )
    return b"DDS " + header + extended_header + payload, mip_byte_counts


def rgba16f_mip_byte_counts(width: int, height: int, mip_count: int) -> list[int]:
    result: list[int] = []
    for _ in range(mip_count):
        result.append(width * height * 4 * 2)
        width = max(1, width >> 1)
        height = max(1, height >> 1)
    return result


def build_rgba16f_cubemap_dds(
    payload: bytes,
    width: int,
    height: int,
    mip_count: int,
    face_chain_size: int,
) -> tuple[bytes, list[int]]:
    """Wrap Unity's exact RGBAHalf face-major mip chains in DDS DX10."""

    mip_byte_counts = rgba16f_mip_byte_counts(width, height, mip_count)
    expected_face_chain_size = sum(mip_byte_counts)
    if face_chain_size != expected_face_chain_size:
        raise ValueError(
            "Unsupported RGBAHalf face-chain layout: "
            f"serialized={face_chain_size}, expected={expected_face_chain_size}"
        )
    if len(payload) != face_chain_size * 6:
        raise ValueError(
            f"Unsupported RGBAHalf cubemap payload: {len(payload)} "
            f"!= {face_chain_size} * 6"
        )

    ddsd_caps = 0x1
    ddsd_height = 0x2
    ddsd_width = 0x4
    ddsd_pitch = 0x8
    ddsd_pixel_format = 0x1000
    ddsd_mipmap_count = 0x20000
    ddpf_fourcc = 0x4
    ddscaps_complex = 0x8
    ddscaps_texture = 0x1000
    ddscaps_mipmap = 0x400000
    ddscaps2_all_cubemap_faces = 0xFE00
    dxgi_format_r16g16b16a16_float = 10
    d3d10_resource_dimension_texture2d = 3
    d3d11_resource_misc_texturecube = 0x4

    header = (
        struct.pack(
            "<7I",
            124,
            ddsd_caps
            | ddsd_height
            | ddsd_width
            | ddsd_pitch
            | ddsd_pixel_format
            | ddsd_mipmap_count,
            height,
            width,
            width * 4 * 2,
            0,
            mip_count,
        )
        + struct.pack("<11I", *([0] * 11))
        + struct.pack("<II4s5I", 32, ddpf_fourcc, b"DX10", 0, 0, 0, 0, 0)
        + struct.pack(
            "<5I",
            ddscaps_texture | ddscaps_complex | ddscaps_mipmap,
            ddscaps2_all_cubemap_faces,
            0,
            0,
            0,
        )
    )
    extended_header = struct.pack(
        "<5I",
        dxgi_format_r16g16b16a16_float,
        d3d10_resource_dimension_texture2d,
        d3d11_resource_misc_texturecube,
        1,
        0,
    )
    return b"DDS " + header + extended_header + payload, mip_byte_counts


def build_bc6h_texture2d_dds(
    payload: bytes,
    width: int,
    height: int,
    mip_count: int,
) -> tuple[bytes, list[int]]:
    """Wrap one exact Unity BC6H Texture2D mip chain in a DDS DX10 container."""

    mip_byte_counts = bc6h_mip_byte_counts(width, height, mip_count)
    expected_size = sum(mip_byte_counts)
    if len(payload) != expected_size:
        raise ValueError(
            f"Unsupported BC6H Texture2D payload: {len(payload)} != {expected_size}"
        )

    flags = 0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000
    caps = 0x1000 | (0x8 | 0x400000 if mip_count > 1 else 0)
    header = (
        struct.pack(
            "<7I",
            124,
            flags,
            height,
            width,
            mip_byte_counts[0],
            0,
            mip_count,
        )
        + struct.pack("<11I", *([0] * 11))
        + struct.pack("<II4s5I", 32, 0x4, b"DX10", 0, 0, 0, 0, 0)
        + struct.pack("<5I", caps, 0, 0, 0, 0)
    )
    extended_header = struct.pack("<5I", 95, 3, 0, 1, 0)
    return b"DDS " + header + extended_header + payload, mip_byte_counts


def export_texture2d_bc6h_dds(pointer: Any, destination: Path) -> dict[str, Any]:
    data = pointer.read()
    if int(data.m_TextureFormat) != UNITY_TEXTURE_FORMAT_BC6H:
        raise ValueError(f"Texture2D is not BC6H: {data.m_Name}")
    payload = bytes(data.get_image_data())
    dds, mip_byte_counts = build_bc6h_texture2d_dds(
        payload,
        int(data.m_Width),
        int(data.m_Height),
        int(data.m_MipCount),
    )
    wrote = not destination.is_file()
    if wrote:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(dds)
    elif destination.read_bytes() != dds:
        raise ValueError(
            f"Existing BC6H DDS differs from serialized Texture2D: {destination}"
        )
    return {
        "pathID": str(pointer_path_id(pointer)),
        "name": str(data.m_Name),
        "width": int(data.m_Width),
        "height": int(data.m_Height),
        "mipCount": int(data.m_MipCount),
        "encoding": "BC6H_UF16",
        "container": "DDS_DX10",
        "dataOffset": len(dds) - len(payload),
        "sourcePayloadByteCount": len(payload),
        "mipByteCounts": mip_byte_counts,
        "serializedColorSpace": int(data.m_ColorSpace),
        "wrote": wrote,
    }


def export_cubemap_bc6h_dds(pointer: Any, destination: Path) -> dict[str, Any]:
    data = pointer.read()
    if int(data.m_TextureFormat) != UNITY_TEXTURE_FORMAT_BC6H:
        raise ValueError(f"Cubemap is not BC6H: {data.m_Name}")
    payload = bytes(data.get_image_data())
    dds, mip_byte_counts = build_bc6h_cubemap_dds(
        payload,
        int(data.m_Width),
        int(data.m_Height),
        int(data.m_MipCount),
        int(data.m_CompleteImageSize),
    )
    wrote = not destination.is_file()
    if wrote:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(dds)
    elif destination.read_bytes() != dds:
        raise ValueError(f"Existing BC6H DDS differs from serialized cubemap: {destination}")
    return {
        "pathID": str(pointer_path_id(pointer)),
        "name": str(data.m_Name),
        "width": int(data.m_Width),
        "height": int(data.m_Height),
        "mipCount": int(data.m_MipCount),
        "faceOrder": ["+X", "-X", "+Y", "-Y", "+Z", "-Z"],
        "coordinateConvention": "Unity world; Three external cubemap X flip maps Viewer reflected X",
        "encoding": "BC6H_UF16",
        "container": "DDS_DX10",
        "dataOffset": len(dds) - len(payload),
        "sourcePayloadByteCount": len(payload),
        "faceChainByteCount": int(data.m_CompleteImageSize),
        "mipByteCounts": mip_byte_counts,
        "serializedColorSpace": int(data.m_ColorSpace),
        "wrote": wrote,
    }


def export_cubemap_rgba16f_dds(pointer: Any, destination: Path) -> dict[str, Any]:
    data = pointer.read()
    if int(data.m_TextureFormat) != UNITY_TEXTURE_FORMAT_RGBA_HALF:
        raise ValueError(f"Cubemap is not RGBAHalf: {data.m_Name}")
    payload = bytes(data.get_image_data())
    dds, mip_byte_counts = build_rgba16f_cubemap_dds(
        payload,
        int(data.m_Width),
        int(data.m_Height),
        int(data.m_MipCount),
        int(data.m_CompleteImageSize),
    )
    wrote = not destination.is_file()
    if wrote:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(dds)
    elif destination.read_bytes() != dds:
        raise ValueError(
            f"Existing RGBAHalf DDS differs from serialized cubemap: {destination}"
        )
    return {
        "pathID": str(pointer_path_id(pointer)),
        "name": str(data.m_Name),
        "width": int(data.m_Width),
        "height": int(data.m_Height),
        "mipCount": int(data.m_MipCount),
        "encoding": "R16G16B16A16_FLOAT",
        "container": "DDS_DX10",
        "dataOffset": len(dds) - len(payload),
        "sourcePayloadByteCount": len(payload),
        "faceChainByteCount": int(data.m_CompleteImageSize),
        "mipByteCounts": mip_byte_counts,
        "faceOrder": ["+X", "-X", "+Y", "-Y", "+Z", "-Z"],
        "serializedColorSpace": int(data.m_ColorSpace),
        "wrote": wrote,
    }


def texture_binding(
    pointer: Any,
    tex_env: Any,
    slot: str,
    prefix: str,
    product_dir: Path | None = None,
    export_assets: bool = False,
) -> dict[str, Any] | None:
    record = pptr_record(pointer)
    if not record.get("resolved") or record.get("type") != "Texture2D":
        return None
    try:
        obj = pointer.read()
        settings = obj.m_TextureSettings
        wrap_names = {0: "repeat", 1: "clamp", 2: "mirror", 3: "mirror"}
        filter_names = {0: "point", 1: "bilinear", 2: "trilinear"}
        color_space = "srgb" if int(getattr(obj, "m_ColorSpace", 1)) == 1 else "linear"
        coordinates: dict[str, Any] = (
            {"kind": "view-normal"}
            if slot == "matCap"
            else {"kind": "mesh-uv", "channel": 0}
        )
        filename = texture_filename(record["name"])
        if export_assets and product_dir is not None:
            export_texture(pointer, product_dir / filename)
        return {
            "url": url_join(prefix, filename),
            "sourceProperty": slot,
            "sourceTexturePathId": record["pathID"],
            "sourceTextureCab": record["cab"],
            "serializedColorSpace": color_space,
            "colorSpace": (
                "srgb"
                if slot in {"base", "blend", "matCap", "emission"}
                else "linear"
                if slot in {"normal", "smoothness"}
                else color_space
            ),
            "coordinates": coordinates,
            "transform": {
                "scale": vector(tex_env.m_Scale)[:2],
                "offset": vector(tex_env.m_Offset)[:2],
            },
            "wrap": {
                "u": wrap_names.get(int(getattr(settings, "m_WrapU", 0)), "repeat"),
                "v": wrap_names.get(int(getattr(settings, "m_WrapV", 0)), "repeat"),
            },
            "filter": filter_names.get(
                int(getattr(settings, "m_FilterMode", 2)), "trilinear"
            ),
            "anisotropy": int(getattr(settings, "m_Aniso", 1)),
            "mipBias": float(getattr(settings, "m_MipBias", 0.0)),
            "mipCount": int(getattr(obj, "m_MipCount", 0)),
            "evidence": "exact-unity-texture2d",
        }
    except Exception:
        return {
            "url": url_join(prefix, texture_filename(record["name"])),
            "sourceProperty": slot,
            "sourceTexturePathId": record["pathID"],
            "sourceTextureCab": record["cab"],
            "colorSpace": "srgb"
            if slot in {"base", "blend", "matCap", "emission"}
            else "linear",
            "coordinates": {"kind": "view-normal"}
            if slot == "matCap"
            else {"kind": "mesh-uv", "channel": 0},
            "transform": {
                "scale": vector(tex_env.m_Scale)[:2],
                "offset": vector(tex_env.m_Offset)[:2],
            },
            "wrap": {"u": "repeat", "v": "repeat"},
            "filter": "trilinear",
            "anisotropy": 1,
            "mipBias": 0,
            "mipCount": 0,
            "evidence": "legacy-default",
        }


def material_records(
    stage_objects: Iterable[Any],
    prefix: str,
    product_dir: Path | None = None,
    export_assets: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    raw: list[dict[str, Any]] = []
    bindings: list[dict[str, Any]] = []
    slot_properties = {
        "base": ("_BaseMap", "_MainTex"),
        "normal": ("_BumpMap",),
        "smoothness": ("_MetallicGlossMap",),
        "blend": ("_BlendTex",),
        "matCap": ("_MatCapTex",),
        "emission": ("_EmissionMap",),
    }
    for reader in stage_objects:
        if reader.type.name != "Material":
            continue
        obj = reader.read()
        tex_envs = {str(key): value for key, value in obj.m_SavedProperties.m_TexEnvs}
        floats = {str(key): float(value) for key, value in obj.m_SavedProperties.m_Floats}
        colors = {str(key): rgba(value) for key, value in obj.m_SavedProperties.m_Colors}
        shader = pptr_record(obj.m_Shader)
        shader_name = str(shader.get("name", ""))
        valid_keywords = sorted(
            str(value) for value in (getattr(obj, "m_ValidKeywords", []) or [])
        )
        invalid_keywords = sorted(
            str(value) for value in (getattr(obj, "m_InvalidKeywords", []) or [])
        )
        legacy_shader_keywords = getattr(obj, "m_ShaderKeywords", None)
        has_keyword_state = getattr(obj, "m_ValidKeywords", None) is not None
        disabled_shader_passes = list(
            getattr(
                obj,
                "disabledShaderPasses",
                getattr(obj, "m_DisabledShaderPasses", []),
            )
            or []
        )
        textures = {
            key: {
                "property": key,
                "scale": vector(value.m_Scale)[:2],
                "offset": vector(value.m_Offset)[:2],
                "pointer": pptr_record(value.m_Texture),
            }
            for key, value in tex_envs.items()
        }
        raw.append(
            {
                "pathID": str(reader.path_id),
                "name": str(obj.m_Name),
                "customRenderQueue": int(obj.m_CustomRenderQueue),
                "shader": shader,
                "validKeywords": valid_keywords,
                "invalidKeywords": invalid_keywords,
                "legacyShaderKeywords": legacy_shader_keywords,
                "textures": textures,
                "floats": floats,
                "colors": colors,
                "disabledShaderPasses": disabled_shader_passes,
            }
        )

        mapped_textures: dict[str, dict[str, Any]] = {}
        for slot, properties in slot_properties.items():
            for property_name in properties:
                tex_env = tex_envs.get(property_name)
                if tex_env is None or not pointer_path_id(tex_env.m_Texture):
                    continue
                mapped = texture_binding(
                    tex_env.m_Texture,
                    tex_env,
                    slot,
                    prefix,
                    product_dir,
                    export_assets,
                )
                if mapped:
                    mapped["sourceProperty"] = property_name
                    mapped_textures[slot] = mapped
                    break
        serialized_textures: dict[str, dict[str, Any]] = {}
        for property_name, tex_env in tex_envs.items():
            if not pointer_path_id(tex_env.m_Texture):
                continue
            mapped = texture_binding(
                tex_env.m_Texture,
                tex_env,
                property_name,
                prefix,
                product_dir,
                export_assets,
            )
            if mapped:
                mapped["sourceProperty"] = property_name
                serialized_textures[property_name] = mapped
        name = str(obj.m_Name)
        if has_keyword_state and shader_name == "Creative/Bg/BgUberShader":
            if "_METALLICSPECGLOSSMAP" not in valid_keywords:
                mapped_textures.pop("smoothness", None)
            if "_VERTEX_COLOR_BLEND" not in valid_keywords:
                mapped_textures.pop("blend", None)
        emission_color = colors.get("_EmissionColor")
        has_visible_emission = bool(
            emission_color
            and any(abs(float(value)) > 1e-8 for value in emission_color[:3])
        )
        is_supported_untextured_background = shader_name in {
            "Creative/Bg/BgUberShader",
            "Creative/Bg/BgUnlit",
        }
        unlitness = floats.get("_Unlitness", 0.0)
        binding: dict[str, Any] = {
            "materialName": name,
            "materialPattern": rf"^{re.escape(name)}(?:\.\d+)?$",
            "sourceShader": shader_name,
            "renderQueue": int(obj.m_CustomRenderQueue),
            "validKeywords": valid_keywords,
            "invalidKeywords": invalid_keywords,
            "disabledShaderPasses": disabled_shader_passes,
            "shading": "unlit"
            if unlitness >= 0.999 or "unlit" in shader_name.lower()
            else "lit",
            "textures": mapped_textures,
            "serializedTextures": serialized_textures,
            "serializedFloats": floats,
            "serializedColors": colors,
            "unlitness": unlitness,
            "smoothness": floats.get("_Smoothness", 0.0),
            "metallic": floats.get("_Metallic", 0.0),
            "normalScale": floats.get("_NormalStrength", floats.get("_BumpScale", 1.0)),
            "normalPacking": (
                "unity-dxt5nm-ag"
                if shader_name == "Creative/Bg/BgUberShader"
                and "normal" in mapped_textures
                else None
            ),
            "vertexColorBlend": (
                "_VERTEX_COLOR_BLEND" in valid_keywords
                if has_keyword_state
                else floats.get("_USE_VERTEX_COLOR_BLEND", 0.0) != 0
            ),
            "metallicFromSmoothnessMap": "smoothness" in mapped_textures,
            "smoothnessFromBaseAlpha": (
                "_SMOOTHNESS_TEXTURE_ALBEDO_CHANNEL_A" in valid_keywords
            ),
            "smoothnessChannel": "a",
            "matCapIntensity": floats.get("_MatCapIntensity", 1.0),
            "useMatCap": floats.get("_UseMatCap", 0.0) >= 0.5,
            "useSmoothnessMaskMatCap": (
                floats.get("_UseSmoothnessMaskMatcap", 0.0) != 0
            ),
            "fogInfluence": floats.get("_FogInfluence", 1.0),
            "transparent": floats.get("_Surface", 0.0) > 0.5
            or int(obj.m_CustomRenderQueue) >= 3000,
            "depthWrite": floats.get("_ZWrite", 1.0) != 0,
            "alphaToCoverage": floats.get("_AlphaToMask", 0.0) != 0,
            "castShadow": (
                "SHADOWCASTER" not in {
                    str(value).upper() for value in disabled_shader_passes
                }
                and floats.get("_CastShadows", 1.0) != 0
            ),
            "receiveShadow": (
                "_RECEIVE_SHADOWS_OFF" not in valid_keywords
                and floats.get("_ReceiveShadows", 1.0) != 0
            ),
            "side": {0: "double", 1: "back", 2: "front"}.get(
                int(floats.get("_Cull", 2.0)), "front"
            ),
        }
        if binding["normalPacking"] is None:
            binding.pop("normalPacking")
        color_value = colors.get("_BaseColor") or colors.get("_Color")
        if color_value:
            binding["color"] = color_value
        if emission_color:
            binding["emissionColor"] = emission_color
        alpha_test_enabled = (
            "_ALPHATEST_ON" in valid_keywords
            if has_keyword_state
            else floats.get("_AlphaClip", 0.0) != 0
        )
        if alpha_test_enabled:
            binding["alphaTest"] = floats.get(
                "_Alpha_Clip", floats.get("_Cutoff", 0.5)
            )
        src_dst = (floats.get("_SrcBlend"), floats.get("_DstBlend"))
        if binding["transparent"]:
            binding["blending"] = (
                "additive" if src_dst == (5.0, 1.0)
                else "multiply" if src_dst == (2.0, 0.0)
                else "normal"
            )
        flipbook_enabled = (
            "_FLIPBOOK" in valid_keywords
            if has_keyword_state
            else floats.get("_UseFlipbook", 0.0) != 0
        )
        if flipbook_enabled:
            grid = colors.get("_FlipbookTileGrid", [1, 1, 0, 0])
            binding["atlas"] = {
                "columns": max(1, int(grid[0])),
                "rows": max(1, int(grid[1])),
                "offset": int(floats.get("_FlipbookOffset", 0.0)),
                "framesPerSecond": floats.get("_FlipbookFrameRate", 0.0),
            }
        bindings.append(binding)
    return raw, bindings


def class_name(reader: Any) -> str:
    try:
        obj = reader.read()
        script = obj.m_Script.read()
        return str(getattr(script, "m_ClassName", "") or getattr(script, "m_Name", ""))
    except Exception:
        return ""


def parameter(component: dict[str, Any] | None, key: str, default: Any = None) -> Any:
    if not component:
        return default
    value = component.get(key)
    if not isinstance(value, dict) or not value.get("m_OverrideState"):
        return default
    return value.get("m_Value", default)


def resolved_volume_components(
    volumes: list[dict[str, Any]],
    profile_components: dict[int, list[int]],
    components: dict[int, tuple[str, dict[str, Any]]],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    resolved: dict[str, dict[str, Any]] = {}
    trace: list[dict[str, Any]] = []
    for volume in sorted(volumes, key=lambda item: (item["priority"], item["pathID"])):
        if not (
            volume["enabled"]
            and volume["activeInHierarchy"]
            and volume["isGlobal"]
            and volume["weight"] > 0
        ):
            continue
        component_ids = profile_components.get(volume["profilePathID"], [])
        trace.append({**volume, "componentPathIDs": [str(value) for value in component_ids]})
        for component_id in component_ids:
            entry = components.get(component_id)
            if not entry:
                continue
            name, tree = entry
            if not bool(tree.get("m_Enabled", 1)) or not bool(tree.get("active", 1)):
                continue
            target = resolved.setdefault(name, {"active": True})
            for key, value in tree.items():
                if isinstance(value, dict) and value.get("m_OverrideState"):
                    target[key] = value
    return resolved, trace


def rgba_hex(value: Any) -> str:
    values = rgba(value)
    if len(values) < 3:
        return "#000000"
    return "#" + "".join(
        f"{round(max(0.0, min(1.0, channel)) * 255):02x}" for channel in values[:3]
    )


def sh_coefficients(value: Any) -> list[float]:
    if not isinstance(value, dict):
        return []
    indexed: list[tuple[int, float]] = []
    for key, nested in value.items():
        match = re.search(r"\[(\s*\d+)\]", str(key))
        if match:
            indexed.append((int(match.group(1)), float(nested)))
    return [nested for _, nested in sorted(indexed)]


def infer_stage_layer(
    lights: list[dict[str, Any]], renderer_layers: list[int]
) -> int | None:
    masks = Counter(
        int(math.log2(light["cullingMask"]))
        for light in lights
        if light["role"] == "background"
        and light["cullingMask"] > 0
        and light["cullingMask"] & (light["cullingMask"] - 1) == 0
    )
    if masks:
        return masks.most_common(1)[0][0]
    layers = Counter(layer for layer in renderer_layers if layer != 0)
    return layers.most_common(1)[0][0] if layers else None


def existing_companion(
    product_dir: Path | None, prefix: str, names: tuple[str, ...]
) -> str | None:
    if product_dir is None:
        return None
    for name in names:
        if (product_dir / name).is_file():
            return url_join(prefix, name)
    return None


def existing_lightmap_urls(
    product_dir: Path | None,
    prefix: str,
    suffix: str = "comp_light",
) -> list[str]:
    if product_dir is None or not product_dir.is_dir():
        return []
    indexed: dict[int, str] = {}
    suffix_pattern = "[_-]".join(map(re.escape, suffix.split("_")))
    pattern = re.compile(
        rf"^Lightmap-(\d+)[_-]{suffix_pattern}(?:-bc6h)?\.(?:png|dds)$",
        re.IGNORECASE,
    )
    for path in sorted(product_dir.glob("Lightmap-*")):
        match = pattern.match(path.name)
        if match:
            index = int(match.group(1))
            candidate = url_join(prefix, path.name)
            current = indexed.get(index)
            if current is None or (
                candidate.lower().endswith(".dds")
                and not current.lower().endswith(".dds")
            ):
                indexed[index] = candidate
    if not indexed:
        return []
    last = max(indexed)
    if set(indexed) != set(range(last + 1)):
        return []
    return [indexed[index] for index in range(last + 1) if index in indexed]


def lightmap_encoding_from_urls(urls: list[str]) -> str | None:
    if not urls:
        return None
    encodings = {
        "unity-bc6h-linear" if url.lower().endswith(".dds")
        else "unity-rgbm-linear"
        for url in urls
    }
    return next(iter(encodings)) if len(encodings) == 1 else None


def build_lightmap_binding_document(
    lightmap_sources: list[Any],
    component_go: dict[int, int],
    hierarchy: Any,
    scene: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    renderers: list[dict[str, Any]] = []
    unsupported: list[dict[str, Any]] = []
    lightmap_base = 0
    for source_index, source in enumerate(lightmap_sources):
        source_lightmaps = list(getattr(source, "m_Lightmaps", []) or [])
        for renderer_info in list(getattr(source, "m_RendererInfo", []) or []):
            pointer = getattr(renderer_info, "renderer", None)
            renderer_id = pointer_path_id(pointer)
            go_id = component_go.get(renderer_id, 0)
            local_index = int(getattr(renderer_info, "lightmapIndex", -1))
            scale_offset = vector(
                getattr(renderer_info, "lightmapOffsetScale", None)
            )[:4]
            if not go_id or local_index < 0 or len(scale_offset) != 4:
                unsupported.append(
                    {
                        "sourceIndex": source_index,
                        "rendererPathID": str(renderer_id),
                        "localLightmapIndex": local_index,
                        "reason": "unresolved-renderer-or-scale-offset",
                    }
                )
                continue
            renderers.append(
                {
                    "rendererHierarchyPath": hierarchy(go_id),
                    "lightmapIndex": lightmap_base + local_index,
                    "lightmapScaleOffset": scale_offset,
                }
            )
        lightmap_base += len(source_lightmaps)
    return (
        {
            "schemaVersion": 1,
            "scene": scene,
            "encoding": "unity-rgbm-linear",
            "renderers": renderers,
        },
        unsupported,
    )


def export_lightmap_textures(
    lightmap_sources: list[Any],
    product_dir: Path | None,
    prefix: str,
    export_assets: bool,
) -> dict[str, Any]:
    channels = (
        ("color", "m_Lightmaps", "comp_light"),
        ("directional", "m_LightmapsDir", "comp_dir"),
        ("shadowMask", "m_ShadowMasks", "shadowmask"),
    )
    result: dict[str, Any] = {
        "colorUrls": [],
        "directionalUrls": [],
        "shadowMaskUrls": [],
        "colorEncoding": None,
        "failures": [],
        "nullPointers": [],
    }
    for channel, attribute, suffix in channels:
        output_key = channel + "Urls" if channel != "shadowMask" else "shadowMaskUrls"
        existing_urls = existing_lightmap_urls(product_dir, prefix, suffix)
        index = 0
        for source in lightmap_sources:
            for pointer in list(getattr(source, attribute, []) or []):
                if not pointer_path_id(pointer):
                    result["nullPointers"].append(
                        {"channel": channel, "index": index}
                    )
                    index += 1
                    continue
                try:
                    texture = pointer.read()
                    is_bc6h = int(texture.m_TextureFormat) == UNITY_TEXTURE_FORMAT_BC6H
                    extension = "-bc6h.dds" if is_bc6h else ".png"
                    filename = f"Lightmap-{index}_{suffix}{extension}"
                    destination = (
                        product_dir / filename if product_dir is not None else None
                    )
                    existing_url = existing_urls[index] if index < len(existing_urls) else None
                    existing_matches_format = bool(existing_url) and (
                        existing_url.lower().endswith(".dds") == is_bc6h
                    )
                    if existing_matches_format:
                        result[output_key].append(existing_url)
                    elif export_assets and destination is not None:
                        if is_bc6h:
                            export_texture2d_bc6h_dds(pointer, destination)
                        else:
                            export_texture(pointer, destination)
                        result[output_key].append(url_join(prefix, filename))
                except Exception as error:
                    result["failures"].append(
                        {
                            "channel": channel,
                            "index": index,
                            "pathID": str(pointer_path_id(pointer)),
                            "error": repr(error),
                        }
                    )
                index += 1
    result["colorEncoding"] = lightmap_encoding_from_urls(result["colorUrls"])
    return result


def build_uv1_companion(
    stage_objects: list[Any],
    component_go: dict[int, int],
    hierarchy: Any,
    stage_id: str,
    source_bundle: str,
    source_revision: str,
    model_url: str,
    lightmapped_paths: set[str] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    lightmapped_paths = lightmapped_paths or set()
    mesh_filters: dict[int, Any] = {}
    renderers: list[tuple[Any, Any]] = []
    unsupported: list[dict[str, Any]] = []
    for reader in stage_objects:
        if reader.type.name not in {
            "MeshFilter",
            "MeshRenderer",
            "SkinnedMeshRenderer",
        }:
            continue
        try:
            obj = reader.read()
        except Exception as error:
            unsupported.append(
                {
                    "componentPathID": str(reader.path_id),
                    "componentType": reader.type.name,
                    "reason": repr(error),
                }
            )
            continue
        go_id = component_go.get(int(reader.path_id), 0)
        if reader.type.name == "MeshFilter" and go_id:
            mesh_filters[go_id] = getattr(obj, "m_Mesh", None)
        elif reader.type.name in {"MeshRenderer", "SkinnedMeshRenderer"}:
            renderers.append((reader, obj))

    geometries: dict[str, dict[str, Any]] = {}
    nodes: list[dict[str, str]] = []
    seen_paths: set[str] = set()
    for renderer_reader, renderer in renderers:
        go_id = component_go.get(int(renderer_reader.path_id), 0)
        pointer = (
            getattr(renderer, "m_Mesh", None)
            if renderer_reader.type.name == "SkinnedMeshRenderer"
            else mesh_filters.get(go_id)
        )
        if not pointer_path_id(pointer):
            continue
        path = hierarchy(go_id) if go_id else ""
        try:
            mesh_reader = pointer.deref()
            handler = MeshHandler(pointer.read())
            handler.process()
            indices = [
                index
                for submesh in handler.get_triangles()
                for triangle in submesh
                for index in (triangle[2], triangle[1], triangle[0])
            ]
            if not indices:
                continue
            if handler.m_UV1:
                values = [
                    coordinate
                    for index in indices
                    for coordinate in handler.m_UV1[index][:2]
                ]
                uv1_source = "serialized-mesh-uv1"
            elif path in lightmapped_paths:
                # Unity's official LIGHTMAP_ON vertex program consumes
                # TEXCOORD1 exclusively. A mesh that omits that attribute
                # therefore supplies the generic zero value before the
                # serialized unity_LightmapST transform; preserve that exact
                # input instead of substituting UV0 or dropping the binding.
                values = [0.0] * (len(indices) * 2)
                uv1_source = "missing-attribute-zero"
            else:
                continue
            payload = struct.pack("<" + "f" * len(values), *values)
        except Exception as error:
            unsupported.append(
                {
                    "rendererPathID": str(renderer_reader.path_id),
                    "hierarchyPath": path,
                    "meshPathID": str(pointer_path_id(pointer)),
                    "reason": repr(error),
                }
            )
            continue
        if path in seen_paths:
            unsupported.append(
                {
                    "rendererPathID": str(renderer_reader.path_id),
                    "hierarchyPath": path,
                    "meshPathID": str(mesh_reader.path_id),
                    "reason": "duplicate-renderer-hierarchy-path",
                }
            )
            continue
        seen_paths.add(path)
        mesh_cab = str(mesh_reader.assets_file.name)
        geometry_key = f"{mesh_cab}:{mesh_reader.path_id}:{len(indices)}"
        geometries.setdefault(
            geometry_key,
            {
                "vertexCount": len(indices),
                "sourceMeshPathID": str(mesh_reader.path_id),
                "sourceMeshCab": mesh_cab,
                "uv1Source": uv1_source,
                "uv1Base64": base64.b64encode(payload).decode("ascii"),
            },
        )
        nodes.append({"hierarchyPath": path, "geometryKey": geometry_key})

    return (
        {
            "schemaVersion": 4,
            "stageId": stage_id,
            "sourceRevision": source_revision,
            "sourceBundle": source_bundle,
            "fbxPath": model_url,
            "uvConvention": "Unity triangle corners CBA -> Three r182; U/V unchanged",
            "mappedMeshCount": len(nodes),
            "zeroFilledLightmapMeshCount": sum(
                geometry["uv1Source"] == "missing-attribute-zero"
                for geometry in geometries.values()
            ),
            "geometries": geometries,
            "nodes": nodes,
        },
        unsupported,
    )


def manifest_file_paths(manifest: dict[str, Any]) -> list[Path]:
    """Accept both preserved staged closures and read-only source references."""

    return [
        Path(item.get("staged") or item["source"])
        for item in manifest["files"]
    ]


def mesh_channel_values(
    values: Any,
    components: int,
    *,
    reflect_x: bool = False,
    normalize_color32: bool = False,
) -> list[float]:
    """Flatten UnityPy MeshHandler vector/tuple channels into float32 values."""

    source = list(values or [])
    vectors: list[list[float]] = []
    for value in source:
        if hasattr(value, "x"):
            vector_values = [
                getattr(value, component)
                for component in ("x", "y", "z", "w")[:components]
            ]
        else:
            vector_values = list(value[:components])
        numeric = [float(component) for component in vector_values]
        if reflect_x and numeric:
            numeric[0] = -numeric[0]
        vectors.append(numeric)
    color32 = normalize_color32 and any(
        abs(component) > 1.0
        for vector_value in vectors
        for component in vector_value
    )
    return [
        component / 255.0 if color32 else component
        for vector_value in vectors
        for component in vector_value
    ]


def particle_mesh_geometry(reader: Any) -> dict[str, Any]:
    """Serialize one exact ParticleSystemRenderer Mesh for browser instancing."""

    mesh = reader.read()
    handler = MeshHandler(mesh)
    handler.process()
    vertex_count = int(handler.m_VertexCount)
    positions = mesh_channel_values(handler.m_Vertices, 3, reflect_x=True)
    normals = mesh_channel_values(handler.m_Normals, 3, reflect_x=True)
    uv0 = mesh_channel_values(handler.m_UV0, 2)
    colors = mesh_channel_values(
        handler.m_Colors,
        4,
        normalize_color32=True,
    )
    indices = [
        int(index)
        for submesh in handler.get_triangles()
        for triangle in submesh
        # Reflecting X changes winding; CBA restores Unity's visible front face.
        for index in (triangle[2], triangle[1], triangle[0])
    ]
    if vertex_count <= 0 or len(positions) != vertex_count * 3 or not indices:
        raise ValueError(
            f"invalid particle mesh vertices={vertex_count} "
            f"positionValues={len(positions)} indices={len(indices)}"
        )
    if normals and len(normals) != vertex_count * 3:
        raise ValueError("particle mesh normal channel mismatch")
    if uv0 and len(uv0) != vertex_count * 2:
        raise ValueError("particle mesh UV0 channel mismatch")
    if colors and len(colors) != vertex_count * 4:
        raise ValueError("particle mesh color channel mismatch")

    index_type = "uint16" if vertex_count <= 0xFFFF else "uint32"
    index_format = "H" if index_type == "uint16" else "I"

    def float32_base64(values: list[float]) -> str | None:
        if not values:
            return None
        return base64.b64encode(
            struct.pack("<" + "f" * len(values), *values)
        ).decode("ascii")

    return {
        "pathID": str(reader.path_id),
        "name": str(getattr(mesh, "m_Name", "")),
        "vertexCount": vertex_count,
        "indexCount": len(indices),
        "indexType": index_type,
        "positionsBase64": float32_base64(positions),
        "normalsBase64": float32_base64(normals),
        "uv0Base64": float32_base64(uv0),
        "colorsBase64": float32_base64(colors),
        "indicesBase64": base64.b64encode(
            struct.pack("<" + index_format * len(indices), *indices)
        ).decode("ascii"),
        "coordinateConvention": "Unity mesh reflect X; triangle CBA",
    }


def build_scene_profile(
    manifest_path: Path,
    stage_id: str | None,
    asset_prefix: str,
    product_dir: Path | None = None,
    export_assets: bool = False,
    model_url: str = "",
    player_resources: Path | None = None,
    player_global_managers: Path | None = None,
) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    unity_version = str(manifest.get("unityVersion") or "2022.3.62f2")
    UnityPy.config.FALLBACK_UNITY_VERSION = unity_version
    paths = manifest_file_paths(manifest)
    inferred_id = re.sub(r"^bg_3d_", "battle-", Path(str(manifest["scene"])).name)
    inferred_id = inferred_id.replace("_", "-")
    resolved_stage_id = stage_id or inferred_id
    for path, item in zip(paths, manifest["files"]):
        if not path.is_file():
            raise FileNotFoundError(path)
        if item.get("bytes") is not None and path.stat().st_size != int(item["bytes"]):
            raise ValueError(f"Closure byte count changed: {path}")
    vlb_player_config = (
        extract_vlb_player_config(player_resources)
        if player_resources is not None
        else None
    )

    root_environment = UnityPy.load(str(paths[0]))
    stage_cab = next(
        name
        for outer in root_environment.files.values()
        for name, nested in getattr(outer, "files", {}).items()
        if type(nested).__name__ == "SerializedFile"
    )
    environment = UnityPy.load(*map(str, paths))
    stage_objects = [
        reader for reader in environment.objects if reader.assets_file.name == stage_cab
    ]
    reader_by_path_id = {int(reader.path_id): reader for reader in stage_objects}

    game_objects: dict[int, dict[str, Any]] = {}
    transforms: dict[int, dict[str, Any]] = {}
    component_go: dict[int, int] = {}
    renderer_go_ids: list[int] = []
    renderer_components: list[tuple[Any, Any]] = []
    for reader in stage_objects:
        try:
            obj = reader.read()
        except Exception:
            continue
        if reader.type.name == "GameObject":
            game_objects[int(reader.path_id)] = {
                "name": str(obj.m_Name),
                "active": bool(getattr(obj, "m_IsActive", True)),
                "layer": int(getattr(obj, "m_Layer", 0)),
            }
            continue
        go_id = pointer_path_id(getattr(obj, "m_GameObject", None))
        if go_id:
            component_go[int(reader.path_id)] = go_id
            if reader.type.name in {"MeshRenderer", "SkinnedMeshRenderer"}:
                renderer_go_ids.append(go_id)
                renderer_components.append((reader, obj))
        if reader.type.name in {"Transform", "RectTransform"}:
            transforms[int(reader.path_id)] = {
                "pathID": int(reader.path_id),
                "gameObjectPathID": go_id,
                "fatherTransformPathID": pointer_path_id(getattr(obj, "m_Father", None)),
                "localPosition": vector(obj.m_LocalPosition)[:3],
                "localRotation": vector(obj.m_LocalRotation),
                "localScale": vector(obj.m_LocalScale)[:3],
            }
    transform_by_go = {row["gameObjectPathID"]: row for row in transforms.values()}
    go_by_transform = {row["pathID"]: row["gameObjectPathID"] for row in transforms.values()}
    renderer_path_ids_by_go: dict[int, list[int]] = defaultdict(list)
    for renderer_reader, _ in renderer_components:
        renderer_id = int(renderer_reader.path_id)
        renderer_go_id = component_go.get(renderer_id, 0)
        if renderer_go_id:
            renderer_path_ids_by_go[renderer_go_id].append(renderer_id)
    renderer_layers = [
        int(game_objects.get(go_id, {}).get("layer", 0)) for go_id in renderer_go_ids
    ]

    def hierarchy(go_id: int) -> str:
        names: list[str] = []
        seen: set[int] = set()
        current = go_id
        while current and current not in seen:
            seen.add(current)
            names.append(game_objects.get(current, {}).get("name", f"PathID-{current}"))
            row = transform_by_go.get(current)
            if not row:
                break
            current = go_by_transform.get(row["fatherTransformPathID"], 0)
        return "/".join(reversed(names))

    def active_in_hierarchy(go_id: int) -> bool:
        seen: set[int] = set()
        current = go_id
        while current and current not in seen:
            seen.add(current)
            if not game_objects.get(current, {}).get("active", True):
                return False
            row = transform_by_go.get(current)
            if not row:
                break
            current = go_by_transform.get(row["fatherTransformPathID"], 0)
        return True

    def parent_game_object(go_id: int) -> int:
        row = transform_by_go.get(go_id)
        return go_by_transform.get(row["fatherTransformPathID"], 0) if row else 0

    def carrier_component_path(go_id: int) -> str | None:
        """Derive the collision-safe FBX path used by UV1/lightmap exports."""
        component_parts = hierarchy(go_id).split("/") if go_id else []
        current = go_id
        while current:
            renderer_ids = renderer_path_ids_by_go.get(current, [])
            if len(renderer_ids) == 1:
                anchor_parts = hierarchy(current).split("/")
                if component_parts[: len(anchor_parts)] != anchor_parts:
                    return None
                renderer_id = renderer_ids[0]
                token = f"n{abs(renderer_id)}" if renderer_id < 0 else str(renderer_id)
                anchor_parts[-1] += f"__lm_{token}"
                return "/".join(anchor_parts + component_parts[len(anchor_parts) :])
            current = parent_game_object(current)
        return None

    world_cache: dict[int, list[list[float]]] = {}

    def world(transform_id: int) -> list[list[float]]:
        if transform_id in world_cache:
            return world_cache[transform_id]
        row = transforms[transform_id]
        result = transform_matrix(
            row["localPosition"], row["localRotation"], row["localScale"]
        )
        father = row["fatherTransformPathID"]
        if father in transforms:
            result = matrix_multiply(world(father), result)
        world_cache[transform_id] = result
        return result

    renderer_reflection_records, renderer_reflection_failures = (
        renderer_reflection_probe_records(
            renderer_components,
            component_go,
            go_by_transform,
            hierarchy,
            world,
            transforms,
        )
    )

    mono_components: dict[int, tuple[str, dict[str, Any]]] = {}
    mono_typed: dict[int, Any] = {}
    mono_raw: dict[str, list[dict[str, Any]]] = defaultdict(list)
    profile_components: dict[int, list[int]] = {}
    volumes: list[dict[str, Any]] = []
    additional_light_data: dict[int, dict[str, Any]] = {}
    lightmap_records: list[dict[str, Any]] = []
    lightmap_sources: list[Any] = []
    for reader in stage_objects:
        if reader.type.name != "MonoBehaviour":
            continue
        name = class_name(reader)
        try:
            tree = clean(reader.read_typetree())
        except Exception as error:
            tree = {"error": repr(error)}
        mono_components[int(reader.path_id)] = (name, tree)
        try:
            mono_typed[int(reader.path_id)] = reader.read()
        except Exception:
            pass
        if name:
            mono_raw[name].append({"pathID": str(reader.path_id), "fields": tree})
        go_id = component_go.get(int(reader.path_id), 0)
        if name == "VolumeProfile":
            profile_components[int(reader.path_id)] = [
                pointer_path_id(pointer) for pointer in tree.get("components", [])
            ]
        elif name == "Volume":
            volumes.append(
                {
                    "pathID": int(reader.path_id),
                    "hierarchyPath": hierarchy(go_id) if go_id else None,
                    "enabled": bool(tree.get("m_Enabled", 1)),
                    "activeInHierarchy": active_in_hierarchy(go_id) if go_id else True,
                    "isGlobal": bool(tree.get("m_IsGlobal", 0)),
                    "priority": float(tree.get("priority", 0.0)),
                    "weight": float(tree.get("weight", 1.0)),
                    "blendDistance": float(tree.get("blendDistance", 0.0)),
                    "profilePathID": pointer_path_id(tree.get("sharedProfile")),
                }
            )
        elif name == "UniversalAdditionalLightData" and go_id:
            additional_light_data[go_id] = tree
        elif name == "PrefabLightmapData":
            try:
                lightmap_sources.append(reader.read())
            except Exception:
                pass
            lightmap_records.append(
                {
                    "pathID": str(reader.path_id),
                    "hierarchyPath": hierarchy(go_id) if go_id else None,
                    "rendererInfo": tree.get("m_RendererInfo", []),
                    "lightmaps": tree.get("m_Lightmaps", []),
                    "directionalLightmaps": tree.get("m_LightmapsDir", []),
                    "shadowMasks": tree.get("m_ShadowMasks", []),
                    "lightInfo": tree.get("m_LightInfo", []),
                }
            )

    animation_playable_clip_by_asset = {
        path_id: pointer_path_id(tree.get("m_Clip"))
        for path_id, (name, tree) in mono_components.items()
        if name == "AnimationPlayableAsset" and pointer_path_id(tree.get("m_Clip"))
    }
    animation_track_trees = {
        path_id: tree
        for path_id, (name, tree) in mono_components.items()
        if name == "AnimationTrack"
    }
    timeline_binding_roots_by_clip_path_id: dict[int, list[dict[str, Any]]] = (
        defaultdict(list)
    )
    activation_track_trees = {
        path_id: tree
        for path_id, (name, tree) in mono_components.items()
        if name == "ActivationTrack"
    }
    activation_directors: list[dict[str, Any]] = []
    playable_director_records: list[dict[str, Any]] = []
    activation_game_object_ids: set[int] = set()
    for reader in stage_objects:
        if reader.type.name != "PlayableDirector":
            continue
        try:
            tree = clean(reader.read_typetree())
        except Exception as error:
            playable_director_records.append(
                {
                    "directorPathID": str(reader.path_id),
                    "error": repr(error),
                }
            )
            continue
        director_path_id = int(reader.path_id)
        director_go_id = component_go.get(director_path_id, 0)
        playable_asset_path_id = pointer_path_id(tree.get("m_PlayableAsset"))
        initial_state = int(tree.get("m_InitialState", 0))
        wrap_mode = int(tree.get("m_WrapMode", 0))
        bindings = tree.get("m_SceneBindings", [])
        if not isinstance(bindings, list):
            bindings = []
        playable_director_records.append(
            {
                "directorPathID": str(director_path_id),
                "gameObjectPathID": str(director_go_id),
                "hierarchyPath": hierarchy(director_go_id)
                if director_go_id
                else None,
                "enabled": bool(tree.get("m_Enabled", 1)),
                "playableAssetPathID": str(playable_asset_path_id),
                "initialState": initial_state,
                "wrapMode": wrap_mode,
                "bindingCount": len(bindings),
            }
        )
        tracks: list[dict[str, Any]] = []
        for binding in bindings:
            if not isinstance(binding, dict):
                continue
            track_path_id = pointer_path_id(binding.get("key"))
            target_object_path_id = pointer_path_id(binding.get("value"))
            target_go_id = component_go.get(
                target_object_path_id,
                target_object_path_id if target_object_path_id in game_objects else 0,
            )
            animation_track = animation_track_trees.get(track_path_id)
            if animation_track is not None and target_go_id:
                clip_segments: list[dict[str, Any]] = []
                infinite_clip_path_id = pointer_path_id(
                    animation_track.get("m_InfiniteClip")
                )
                if infinite_clip_path_id:
                    clip_segments.append(
                        {
                            "clipPathID": infinite_clip_path_id,
                            "assetPathID": 0,
                            "start": 0.0,
                            "duration": None,
                            "clipIn": float(
                                animation_track.get("m_InfiniteClipTimeOffset", 0.0)
                            ),
                            "timeScale": 1.0,
                            "source": "animation-track-infinite-clip",
                        }
                    )
                for timeline_clip in animation_track.get("m_Clips", []):
                    if not isinstance(timeline_clip, dict):
                        continue
                    asset_path_id = pointer_path_id(timeline_clip.get("m_Asset"))
                    clip_path_id = animation_playable_clip_by_asset.get(asset_path_id, 0)
                    if not clip_path_id:
                        continue
                    clip_segments.append(
                        {
                            "clipPathID": clip_path_id,
                            "assetPathID": asset_path_id,
                            "start": float(timeline_clip.get("m_Start", 0.0)),
                            "duration": float(timeline_clip.get("m_Duration", 0.0)),
                            "clipIn": float(timeline_clip.get("m_ClipIn", 0.0)),
                            "timeScale": float(timeline_clip.get("m_TimeScale", 1.0)),
                            "source": "animation-playable-asset",
                        }
                    )
                for segment in clip_segments:
                    timeline_binding_roots_by_clip_path_id[segment["clipPathID"]].append(
                        {
                            "source": segment.pop("source"),
                            "directorPathID": str(director_path_id),
                            "trackPathID": str(track_path_id),
                            "trackName": str(animation_track.get("m_Name", "")),
                            "targetObjectPathID": str(target_object_path_id),
                            "targetObjectType": reader_by_path_id[
                                target_object_path_id
                            ].type.name
                            if target_object_path_id in reader_by_path_id
                            else None,
                            "gameObjectPathID": str(target_go_id),
                            "hierarchyPath": hierarchy(target_go_id),
                            **{
                                key: value
                                for key, value in segment.items()
                                if key != "clipPathID"
                            },
                        }
                    )
            track = activation_track_trees.get(track_path_id)
            if track is None:
                continue
            target_go_id = pointer_path_id(binding.get("value"))
            clips = []
            for clip in track.get("m_Clips", []):
                if not isinstance(clip, dict):
                    continue
                clips.append(
                    {
                        "start": float(clip.get("m_Start", 0.0)),
                        "duration": float(clip.get("m_Duration", 0.0)),
                        "clipIn": float(clip.get("m_ClipIn", 0.0)),
                        "timeScale": float(clip.get("m_TimeScale", 1.0)),
                        "assetPathID": str(pointer_path_id(clip.get("m_Asset"))),
                        "displayName": str(clip.get("m_DisplayName", "")),
                    }
                )
            clips.sort(key=lambda clip: (clip["start"], clip["assetPathID"]))
            tracks.append(
                {
                    "trackPathID": str(track_path_id),
                    "name": str(track.get("m_Name", "")),
                    "enabled": bool(track.get("m_Enabled", 1)),
                    "muted": bool(track.get("m_Muted", 0)),
                    "locked": bool(track.get("m_Locked", 0)),
                    "postPlaybackState": int(track.get("m_PostPlaybackState", 3)),
                    "targetGameObjectPathID": str(target_go_id),
                    "targetHierarchyPath": hierarchy(target_go_id)
                    if target_go_id
                    else None,
                    "targetInitialSelfActive": bool(
                        game_objects.get(target_go_id, {}).get("active", True)
                    ),
                    "targetInitialActiveInHierarchy": active_in_hierarchy(target_go_id)
                    if target_go_id
                    else True,
                    "clips": clips,
                }
            )
            current_go_id = target_go_id
            seen_game_objects: set[int] = set()
            while current_go_id and current_go_id not in seen_game_objects:
                seen_game_objects.add(current_go_id)
                activation_game_object_ids.add(current_go_id)
                current_go_id = parent_game_object(current_go_id)
        if tracks:
            tracks.sort(key=lambda track: (track["trackPathID"], track["name"]))
            duration = max(
                (
                    clip["start"] + clip["duration"]
                    for track in tracks
                    for clip in track["clips"]
                ),
                default=0.0,
            )
            activation_directors.append(
                {
                    "directorPathID": str(director_path_id),
                    "gameObjectPathID": str(director_go_id),
                    "hierarchyPath": hierarchy(director_go_id)
                    if director_go_id
                    else None,
                    "enabled": bool(tree.get("m_Enabled", 1)),
                    "playableAssetPathID": str(playable_asset_path_id),
                    "initialState": initial_state,
                    "initialStateName": {0: "paused", 1: "playing"}.get(
                        initial_state, "unknown"
                    ),
                    "wrapMode": wrap_mode,
                    "wrapModeName": {0: "hold", 1: "loop", 2: "none"}.get(
                        wrap_mode, "unknown"
                    ),
                    "duration": duration,
                    "tracks": tracks,
                }
            )
    activation_directors.sort(
        key=lambda director: (
            director.get("hierarchyPath") or "",
            director["directorPathID"],
        )
    )
    playable_director_records.sort(key=lambda director: director["directorPathID"])
    activation_game_object_states = [
        {
            "gameObjectPathID": str(go_id),
            "hierarchyPath": hierarchy(go_id),
            "activeSelf": bool(game_objects.get(go_id, {}).get("active", True)),
            "activeInHierarchy": active_in_hierarchy(go_id),
        }
        for go_id in sorted(
            activation_game_object_ids,
            key=lambda candidate: (hierarchy(candidate), str(candidate)),
        )
        if go_id in game_objects
    ]

    component_clips = [
        record
        for record in (
            serialized_component_clip_record(reader)
            for reader in stage_objects
            if reader.type.name == "AnimationClip"
        )
        if record is not None
    ]
    component_clips.sort(key=lambda record: (record["name"], record["pathID"]))

    def pointer_name(pointer: Any) -> str | None:
        if not pointer_path_id(pointer):
            return None
        try:
            value = pointer.read()
            return str(value.m_Name) if value is not None else None
        except Exception:
            reader = reader_by_path_id.get(pointer_path_id(pointer))
            try:
                return str(reader.read().m_Name) if reader is not None else None
            except Exception:
                return None

    particle_renderers: dict[int, dict[str, Any]] = {}
    for reader in stage_objects:
        if reader.type.name != "ParticleSystemRenderer":
            continue
        try:
            typed = reader.read()
            tree = clean(reader.read_typetree())
        except Exception:
            continue
        go_id = component_go.get(int(reader.path_id), 0)
        renderer_meshes: list[dict[str, Any]] = []
        for index, field in enumerate(("m_Mesh", "m_Mesh1", "m_Mesh2", "m_Mesh3")):
            pointer = getattr(typed, field, None)
            mesh_path_id = pointer_path_id(pointer)
            if not mesh_path_id:
                continue
            renderer_meshes.append(
                {
                    "pathID": str(mesh_path_id),
                    "name": pointer_name(pointer),
                    "weight": float(
                        tree.get(
                            "m_MeshWeighting" if index == 0 else f"m_MeshWeighting{index}",
                            1.0,
                        )
                    ),
                }
            )
        particle_renderers[go_id] = {
            "pathID": str(reader.path_id),
            "enabled": bool(tree.get("m_Enabled", True)),
            "renderMode": int(tree.get("m_RenderMode", 0)),
            "meshDistribution": int(tree.get("m_MeshDistribution", 0)),
            "sortMode": int(tree.get("m_SortMode", 0)),
            "sortingLayerID": int(tree.get("m_SortingLayerID", 0)),
            "sortingOrder": int(tree.get("m_SortingOrder", 0)),
            "minParticleSize": float(tree.get("m_MinParticleSize", 0.0)),
            "maxParticleSize": float(tree.get("m_MaxParticleSize", 0.5)),
            "renderAlignment": int(tree.get("m_RenderAlignment", 0)),
            "pivot": tree.get("m_Pivot"),
            "flip": tree.get("m_Flip"),
            "enableGPUInstancing": bool(tree.get("m_EnableGPUInstancing", False)),
            "applyActiveColorSpace": bool(tree.get("m_ApplyActiveColorSpace", True)),
            "allowRoll": bool(tree.get("m_AllowRoll", True)),
            "meshes": renderer_meshes,
            "materials": [
                name
                for name in (pointer_name(pointer) for pointer in typed.m_Materials)
                if name
            ],
        }

    particle_mesh_ids = sorted(
        {
            int(mesh["pathID"])
            for renderer in particle_renderers.values()
            if renderer.get("renderMode") == 4
            for mesh in renderer.get("meshes", [])
        }
    )
    particle_meshes: list[dict[str, Any]] = []
    particle_mesh_failures: list[dict[str, str]] = []
    for path_id in particle_mesh_ids:
        mesh_reader = reader_by_path_id.get(path_id)
        if mesh_reader is None or mesh_reader.type.name != "Mesh":
            particle_mesh_failures.append(
                {"pathID": str(path_id), "reason": "mesh-reader-missing"}
            )
            continue
        try:
            particle_meshes.append(particle_mesh_geometry(mesh_reader))
        except Exception as error:
            particle_mesh_failures.append(
                {"pathID": str(path_id), "reason": repr(error)}
            )

    particle_candidates: list[dict[str, Any]] = []
    for reader in stage_objects:
        if reader.type.name != "ParticleSystem":
            continue
        tree = clean(reader.read_typetree())
        go_id = component_go.get(int(reader.path_id), 0)
        initial = tree.get("InitialModule", {})
        shape = tree.get("ShapeModule", {})
        emission = tree.get("EmissionModule", {})
        renderer = particle_renderers.get(go_id, {})
        shape_mesh_id = pointer_path_id(shape.get("m_Mesh"))
        shape_mesh_name = None
        if shape_mesh_id:
            shape_reader = reader_by_path_id.get(shape_mesh_id)
            try:
                shape_mesh_name = str(shape_reader.read().m_Name) if shape_reader else None
            except Exception:
                shape_mesh_name = None
        enabled_modules = {
            target: tree.get(source)
            for source, target in (
                ("SizeModule", "sizeOverLifetime"),
                ("RotationModule", "rotationOverLifetime"),
                ("ColorModule", "colorOverLifetime"),
                ("UVModule", "textureSheetAnimation"),
                ("VelocityModule", "velocityOverLifetime"),
                ("ForceModule", "forceOverLifetime"),
                ("NoiseModule", "noise"),
                ("TrailModule", "trails"),
            )
            if isinstance(tree.get(source), dict) and tree[source].get("enabled")
        }
        preset = {
            "duration": float(tree.get("lengthInSec", 5.0)),
            "simulationSpeed": float(tree.get("simulationSpeed", 1.0)),
            "looping": bool(tree.get("looping", True)),
            "prewarm": bool(tree.get("prewarm", False)),
            "playOnAwake": bool(tree.get("playOnAwake", True)),
            "useUnscaledTime": bool(tree.get("useUnscaledTime", False)),
            "autoRandomSeed": bool(tree.get("autoRandomSeed", True)),
            "randomSeed": int(tree.get("randomSeed", 0)),
            "moveWithTransform": int(tree.get("moveWithTransform", 1)),
            "scalingMode": int(tree.get("scalingMode", 0)),
            "initial": selected_particle_module(
                initial,
                (
                    "startLifetime",
                    "startSpeed",
                    "startColor",
                    "startSize",
                    "startSizeY",
                    "startSizeZ",
                    "startRotationX",
                    "startRotationY",
                    "startRotation",
                    "randomizeRotationDirection",
                    "gravityModifier",
                    "maxNumParticles",
                    "size3D",
                    "rotation3D",
                ),
            ),
            "emission": selected_particle_module(
                emission,
                ("enabled", "rateOverTime", "rateOverDistance", "m_Bursts"),
            ),
            "shape": {
                **selected_particle_module(
                    shape,
                    (
                        "enabled",
                        "type",
                        "angle",
                        "length",
                        "boxThickness",
                        "radiusThickness",
                        "donutRadius",
                        "m_Position",
                        "m_Rotation",
                        "m_Scale",
                        "placementMode",
                        "m_MeshMaterialIndex",
                        "m_MeshNormalOffset",
                        "m_UseMeshMaterialIndex",
                        "m_UseMeshColors",
                        "alignToDirection",
                        "randomDirectionAmount",
                        "sphericalDirectionAmount",
                        "randomPositionAmount",
                        "radius",
                        "arc",
                    ),
                ),
                "meshPathID": str(shape_mesh_id) if shape_mesh_id else None,
                "meshName": shape_mesh_name,
            },
            "modules": enabled_modules,
            "renderer": {
                key: renderer[key]
                for key in (
                    "enabled",
                    "renderMode",
                    "sortMode",
                    "sortingLayerID",
                    "sortingOrder",
                    "minParticleSize",
                    "maxParticleSize",
                    "renderAlignment",
                    "pivot",
                    "flip",
                    "meshDistribution",
                    "enableGPUInstancing",
                    "applyActiveColorSpace",
                    "allowRoll",
                    "meshes",
                )
                if key in renderer
            },
        }
        particle_candidates.append(
            {
                "pathID": str(reader.path_id),
                "hierarchyPath": hierarchy(go_id) if go_id else None,
                "carrierHierarchyPath": carrier_component_path(go_id)
                if go_id
                else None,
                "serializedWorldMatrix": [
                    value
                    for row in world(transform_by_go[go_id]["pathID"])
                    for value in row
                ]
                if go_id in transform_by_go
                else None,
                "active": active_in_hierarchy(go_id) if go_id else True,
                "materials": renderer.get("materials", []),
                "preset": preset,
            }
        )

    particle_signatures = sorted(
        {
            json.dumps(candidate["preset"], ensure_ascii=False, sort_keys=True)
            for candidate in particle_candidates
        }
    )
    particle_preset_ids = {
        signature: f"particle-preset-{index + 1:03d}"
        for index, signature in enumerate(particle_signatures)
    }
    particle_presets = [
        {"id": particle_preset_ids[signature], **json.loads(signature)}
        for signature in particle_signatures
    ]
    particle_systems = [
        {
            "pathID": candidate["pathID"],
            "hierarchyPath": candidate["hierarchyPath"],
            "carrierHierarchyPath": candidate["carrierHierarchyPath"],
            "serializedWorldMatrix": candidate["serializedWorldMatrix"],
            "active": candidate["active"],
            "presetId": particle_preset_ids[
                json.dumps(candidate["preset"], ensure_ascii=False, sort_keys=True)
            ],
            "materials": candidate["materials"],
        }
        for candidate in sorted(
            particle_candidates,
            key=lambda candidate: (candidate["hierarchyPath"] or "", candidate["pathID"]),
        )
    ]

    rotators = []
    for path_id, (name, tree) in mono_components.items():
        if name != "LinearRotater":
            continue
        go_id = component_go.get(path_id, 0)
        rotation = vector(tree.get("rotation"))[:3]
        if len(rotation) != 3:
            continue
        rotators.append(
            {
                "componentPathID": str(path_id),
                "hierarchyPath": hierarchy(go_id) if go_id else None,
                "objectName": game_objects.get(go_id, {}).get("name"),
                "degreesPerSecond": rotation,
                "space": "self",
            }
        )
    rotators.sort(key=lambda record: record.get("hierarchyPath") or "")

    animator_records: dict[int, dict[str, Any]] = {}
    for reader in stage_objects:
        if reader.type.name != "Animator":
            continue
        animator = reader.read()
        go_id = component_go.get(int(reader.path_id), 0)
        controller = animator.m_Controller
        controller_name = pointer_name(controller)
        clip_records: list[dict[str, str]] = []
        try:
            controller_value = controller.read() if controller else None
            clip_records = list({
                pointer_path_id(pointer): {
                    "pathID": str(pointer_path_id(pointer)),
                    "name": name,
                }
                for pointer in getattr(controller_value, "m_AnimationClips", [])
                if pointer_path_id(pointer)
                and (name := pointer_name(pointer))
            }.values())
        except Exception:
            pass
        animator_records[int(reader.path_id)] = {
            "pathID": str(reader.path_id),
            "gameObjectPathID": str(go_id),
            "hierarchyPath": hierarchy(go_id) if go_id else None,
            "controllerPathID": str(pointer_path_id(controller)),
            "controllerName": controller_name,
            "clipNames": [record["name"] for record in clip_records],
            "clips": clip_records,
        }

    animator_randomizers = []
    for path_id, (name, tree) in mono_components.items():
        if name != "AnimatorRandomizer":
            continue
        go_id = component_go.get(path_id, 0)
        animator_id = pointer_path_id(tree.get("animator"))
        animator_randomizers.append(
            {
                "componentPathID": str(path_id),
                "hierarchyPath": hierarchy(go_id) if go_id else None,
                "enabled": bool(tree.get("m_Enabled", 1)),
                "animatorPathID": str(animator_id),
                "animator": animator_records.get(animator_id),
                "selectionAuthority": "serialized-controller-state-machine-pending",
            }
        )
    animator_randomizers.sort(key=lambda record: record.get("hierarchyPath") or "")

    lights: list[dict[str, Any]] = []
    lights_by_game_object: dict[int, dict[str, Any]] = {}
    for reader in stage_objects:
        if reader.type.name != "Light":
            continue
        obj = reader.read()
        go_id = component_go[int(reader.path_id)]
        transform = transform_by_go[go_id]
        matrix = world(transform["pathID"])
        forward = [matrix[0][2], matrix[1][2], matrix[2][2]]
        length = math.sqrt(sum(value * value for value in forward)) or 1.0
        forward = [value / length for value in forward]
        position = [matrix[0][3], matrix[1][3], matrix[2][3]]
        kind = LIGHT_TYPES.get(int(obj.m_Type), "point")
        shadow = obj.m_Shadows
        additional = additional_light_data.get(go_id, {})
        light_record = {
                "pathID": str(reader.path_id),
                "name": game_objects[go_id]["name"],
                "hierarchyPath": hierarchy(go_id),
                "activeSelf": bool(game_objects[go_id].get("active", True)),
                "active": active_in_hierarchy(go_id),
                "enabled": bool(obj.m_Enabled),
                "type": kind,
                "color": rgba(obj.m_Color),
                "intensity": float(obj.m_Intensity),
                "range": float(obj.m_Range),
                "outerAngleDegrees": float(obj.m_SpotAngle),
                "innerAngleDegrees": float(obj.m_InnerSpotAngle),
                "cullingMask": int(obj.m_CullingMask.m_Bits),
                "lightmapping": int(obj.m_Lightmapping),
                "worldPosition": position,
                "worldForward": forward,
                "target": [position[index] + forward[index] for index in range(3)],
                "shadow": {
                    "type": int(shadow.m_Type),
                    "strength": float(shadow.m_Strength),
                    "bias": float(shadow.m_Bias),
                    "normalBias": float(shadow.m_NormalBias),
                    "nearPlane": float(shadow.m_NearPlane),
                },
                "additionalLightData": {
                    "renderingLayers": additional.get("m_RenderingLayers"),
                    "lightLayerMask": additional.get("m_LightLayerMask"),
                    "shadowResolutionTier": additional.get(
                        "m_AdditionalLightsShadowResolutionTier"
                    ),
                    "softShadowQuality": additional.get("m_SoftShadowQuality"),
                },
            }
        lights.append(light_record)
        lights_by_game_object[go_id] = light_record

    active_lights = [light for light in lights if light["active"] and light["enabled"]]
    enabled_lights = [light for light in lights if light["enabled"]]
    main_candidates = [
        light
        for light in active_lights
        if light["type"] == "directional" and light["cullingMask"] & 1
    ]
    main_light = max(main_candidates, key=lambda light: light["intensity"], default=None)
    runtime_lights: list[dict[str, Any]] = []
    for light in enabled_lights:
        light["role"] = "character-key" if light is main_light else "background"
        profile: dict[str, Any] = {
            "name": light["name"],
            "type": light["type"],
            "activeSelf": light["activeSelf"],
            "active": light["active"],
            "enabled": light["enabled"],
            "anchorPath": light["hierarchyPath"],
            "anchorNode": light["name"],
            "color": light["color"],
            "intensity": light["intensity"],
            "cullingMask": light["cullingMask"],
            "lightmapping": light["lightmapping"],
            "role": light["role"],
            "position": light["worldPosition"],
            "castShadow": light["shadow"]["type"] != 0,
            "additionalLightData": light["additionalLightData"],
        }
        if light["type"] != "point":
            profile["target"] = light["target"]
        if light["type"] in {"point", "spot"}:
            profile["range"] = light["range"]
        if light["type"] == "spot":
            profile["outerAngleDegrees"] = light["outerAngleDegrees"]
            profile["innerAngleDegrees"] = light["innerAngleDegrees"]
        if profile["castShadow"]:
            profile["shadow"] = light["shadow"]
        runtime_lights.append(profile)

    volumetric_light_beams: list[dict[str, Any]] = []
    volumetric_dust_particles: list[dict[str, Any]] = []
    beam_path_by_game_object: dict[int, str] = {}
    for path_id, (name, tree) in mono_components.items():
        if name != "VolumetricLightBeam":
            continue
        go_id = component_go.get(path_id, 0)
        linked_light = lights_by_game_object.get(go_id)
        active = bool(tree.get("m_Enabled", 1)) and (
            active_in_hierarchy(go_id) if go_id else True
        )
        beam_path_by_game_object[go_id] = str(path_id)
        volumetric_light_beams.append(
            {
                "componentPathID": str(path_id),
                "gameObjectPathID": str(go_id),
                "hierarchyPath": hierarchy(go_id) if go_id else None,
                "active": active,
                "lightAnchorPath": linked_light.get("hierarchyPath")
                if linked_light
                else None,
                "linkedLight": {
                    key: linked_light[key]
                    for key in (
                        "pathID",
                        "name",
                        "hierarchyPath",
                        "active",
                        "enabled",
                        "type",
                        "color",
                        "intensity",
                        "range",
                        "outerAngleDegrees",
                        "innerAngleDegrees",
                        "worldPosition",
                        "worldForward",
                    )
                }
                if linked_light
                else None,
                "colorFromLight": bool(tree.get("colorFromLight", 0)),
                "colorMode": int(tree.get("colorMode", 0)),
                "color": vector(tree.get("color"))[:4],
                "colorGradient": tree.get("colorGradient"),
                "intensityFromLight": bool(tree.get("intensityFromLight", 0)),
                "intensityModeAdvanced": int(
                    tree.get("intensityModeAdvanced", 0)
                ),
                "intensityInside": float(tree.get("intensityInside", 1.0)),
                "intensityOutside": float(tree.get("intensityOutside", 1.0)),
                "blendingMode": int(tree.get("blendingMode", 0)),
                "spotAngleFromLight": bool(tree.get("spotAngleFromLight", 0)),
                "spotAngle": float(tree.get("spotAngle", 35.0)),
                "coneRadiusStart": float(tree.get("coneRadiusStart", 0.1)),
                "shaderAccuracy": int(tree.get("shaderAccuracy", 0)),
                "geomMeshType": int(tree.get("geomMeshType", 0)),
                "geomCustomSides": int(tree.get("geomCustomSides", 18)),
                "geomCustomSegments": int(tree.get("geomCustomSegments", 5)),
                "skewingLocalForwardDirection": vector(
                    tree.get("skewingLocalForwardDirection")
                )[:3],
                "geomCap": bool(tree.get("geomCap", 0)),
                "fallOffEndFromLight": bool(tree.get("fallOffEndFromLight", 0)),
                "attenuationEquation": int(tree.get("attenuationEquation", 0)),
                "attenuationCustomBlending": float(
                    tree.get("attenuationCustomBlending", 0.5)
                ),
                "fallOffStart": float(tree.get("fallOffStart", 0.0)),
                "fallOffEnd": float(tree.get("fallOffEnd", 3.0)),
                "depthBlendDistance": float(tree.get("depthBlendDistance", 2.0)),
                "cameraClippingDistance": float(
                    tree.get("cameraClippingDistance", 0.5)
                ),
                "glareFrontal": float(tree.get("glareFrontal", 0.5)),
                "glareBehind": float(tree.get("glareBehind", 0.5)),
                "fresnelPow": float(tree.get("fresnelPow", 8.0)),
                "noiseMode": int(tree.get("noiseMode", 0)),
                "noiseIntensity": float(tree.get("noiseIntensity", 0.5)),
                "noiseScaleUseGlobal": bool(tree.get("noiseScaleUseGlobal", 0)),
                "noiseScaleLocal": float(tree.get("noiseScaleLocal", 0.5)),
                "noiseVelocityUseGlobal": bool(
                    tree.get("noiseVelocityUseGlobal", 0)
                ),
                "noiseVelocityLocal": vector(tree.get("noiseVelocityLocal"))[:3],
                "dimensions": int(tree.get("dimensions", 0)),
                "tiltFactor": vector(tree.get("tiltFactor"))[:2],
                "pluginVersion": int(tree.get("pluginVersion", 0)),
                "sortingLayerID": int(tree.get("_SortingLayerID", 0)),
                "sortingOrder": int(tree.get("_SortingOrder", 0)),
                "fadeOutBegin": float(tree.get("_FadeOutBegin", -150.0)),
                "fadeOutEnd": float(tree.get("_FadeOutEnd", -200.0)),
            }
        )
    volumetric_light_beams.sort(
        key=lambda record: record.get("hierarchyPath") or ""
    )
    for path_id, (name, tree) in mono_components.items():
        if name != "VolumetricDustParticles":
            continue
        go_id = component_go.get(path_id, 0)
        volumetric_dust_particles.append(
            {
                "componentPathID": str(path_id),
                "gameObjectPathID": str(go_id),
                "beamComponentPathID": beam_path_by_game_object.get(go_id),
                "hierarchyPath": hierarchy(go_id) if go_id else None,
                "active": bool(tree.get("m_Enabled", 1)) and (
                    active_in_hierarchy(go_id) if go_id else True
                ),
                "alpha": float(tree.get("alpha", 1.0)),
                "size": float(tree.get("size", 0.02)),
                "direction": int(tree.get("direction", 0)),
                "velocity": vector(tree.get("velocity"))[:3],
                "speed": float(tree.get("speed", 0.03)),
                "density": float(tree.get("density", 5.0)),
                "spawnDistanceRange": tree.get("spawnDistanceRange"),
                "spawnMinDistance": float(tree.get("spawnMinDistance", 0.0)),
                "spawnMaxDistance": float(tree.get("spawnMaxDistance", 0.7)),
                "cullingEnabled": bool(tree.get("cullingEnabled", 0)),
                "cullingMaxDistance": float(tree.get("cullingMaxDistance", 10.0)),
                "alphaAdditionalRuntime": float(
                    tree.get("m_AlphaAdditionalRuntime", 1.0)
                ),
            }
        )
    volumetric_dust_particles.sort(
        key=lambda record: record.get("hierarchyPath") or ""
    )

    resolved, volume_trace = resolved_volume_components(
        volumes, profile_components, mono_components
    )
    reflection_probe_pointer: Any = None
    reflection_probe_component_path_id: int | None = None
    film_grain_texture_pointer: Any = None
    film_grain_component_path_id: int | None = None
    for volume in volume_trace:
        for component_path_id in volume["componentPathIDs"]:
            numeric_path_id = int(component_path_id)
            component = mono_components.get(numeric_path_id)
            if not component:
                continue
            if component[0] == "FilmGrain":
                film_grain_component_path_id = numeric_path_id
                parameter_tree = component[1].get("texture")
                if not (
                    isinstance(parameter_tree, dict)
                    and parameter_tree.get("m_OverrideState")
                ):
                    continue
                typed = mono_typed.get(numeric_path_id)
                typed_parameter = getattr(typed, "texture", None)
                pointer = getattr(typed_parameter, "m_Value", None)
                if pointer_path_id(pointer):
                    film_grain_texture_pointer = pointer
                    film_grain_component_path_id = numeric_path_id
                continue
            if component[0] == "ReDriveVolume":
                parameter_tree = component[1].get("_reflectionProbe")
                if not (
                    isinstance(parameter_tree, dict)
                    and parameter_tree.get("m_OverrideState")
                ):
                    continue
                typed = mono_typed.get(numeric_path_id)
                typed_parameter = getattr(typed, "_reflectionProbe", None)
                pointer = getattr(typed_parameter, "m_Value", None)
                if pointer_path_id(pointer):
                    reflection_probe_pointer = pointer
                    reflection_probe_component_path_id = numeric_path_id
    redrive = resolved.get("ReDriveVolume")
    bloom = resolved.get("Bloom")
    chromatic_aberration = resolved.get("ChromaticAberration")
    film_grain = resolved.get("FilmGrain")
    tonemapping = resolved.get("Tonemapping")
    adjustments = resolved.get("ColorAdjustments")
    vignette = resolved.get("Vignette")

    re_drive_profile: dict[str, Any] = {"overrides": {}}
    if redrive:
        for source, target in REDRIVE_PARAMETERS.items():
            re_drive_profile["overrides"][target] = source in redrive

        def rd(source: str, default: Any = None) -> Any:
            return parameter(redrive, source, default)

        direct_fields = {
            "skyboxIntensity": "_skyboxIntensity",
            "characterTint": "_globalCharacterTintColor",
            "characterShadowTint": "_globalCharacterShadowTintColor",
            "backgroundTint": "_globalBackgroundTintColor",
            "characterLightingOverrideColor": "_globalCharacterLightingOverrideColor",
            "characterLightingOverrideRatio": "_globalCharacterLightingOverrideRatio",
            "characterLightingOverrideDirection": "_globalCharacterLightingOverrideDirection",
            "characterAdditionalRimLightColor": "_globalCharacterAdditionalRimLightColor",
            "characterAdditionalRimLightDirection": "_globalCharacterAdditionalRimLightDirection",
            "characterFaceAwayTint": "_globalCharacterFaceAwayTintColor",
            "characterCancelPerspective": "_globalCharacterCancelPerspective",
            "backgroundShadowStrengthAdditive": "_bgShadowStrengthAdditive",
            "backgroundPostExposure": "_bgPostExposure",
            "backgroundContrast": "_bgContrast",
            "backgroundSaturation": "_bgSaturation",
            "backgroundBackgroundTint": "_bgBackgroundTintColor",
            "useFixedLightDirection": "_useFixedLightDir",
        }
        for target, source in direct_fields.items():
            value = rd(source)
            if value is not None:
                re_drive_profile[target] = (
                    bool(value)
                    if target == "useFixedLightDirection"
                    else clean(value)
                )
        sh = sh_coefficients(rd("SH2"))
        if len(sh) == 27:
            re_drive_profile["shAmbient"] = sh
        re_drive_profile["characterLightingOverrideDirectionEnabled"] = bool(
            re_drive_profile["overrides"].get("characterLightingOverrideDirection")
        )
        paraffin_sources = ("_tintTopColor", "_tintBottomColor", "_opacity", "_paraWidth")
        if all(source in redrive for source in paraffin_sources):
            paraffin_opacity = float(rd("_opacity", 0.0))
            re_drive_profile["paraffin"] = {
                "enabled": paraffin_opacity > 0.0001,
                # resolved_volume_components only returns active components on
                # enabled, active, global Volumes with positive weight.
                "runtimeVerified": paraffin_opacity > 0.0001,
                "operatorVerified": True,
                "activationSource": "serialized-effective-global-volume",
                "operatorSource": (
                    "globalgamemanagers.assets:MaterialPathID4:"
                    "ShaderPathID62:D3D11-fragment-69-89-93"
                ),
                "topColor": clean(rd("_tintTopColor")),
                "bottomColor": clean(rd("_tintBottomColor")),
                "opacity": paraffin_opacity,
                "width": float(rd("_paraWidth", 1.0)),
                "topBlendMode": int(rd("_topBlendMode", 0)),
                "bottomBlendMode": int(rd("_bottomBlendMode", 0)),
                "useFixedLightDirection": bool(rd("_useFixedLightDir", False)),
            }

    stage_layer = infer_stage_layer(runtime_lights, renderer_layers)
    render_profile: dict[str, Any] = {
        "id": Path(str(manifest["scene"])).name,
        "source": "ReDriveVolume" if redrive else "exported-prefab",
        "lights": runtime_lights,
        "renderer": {"toneMapping": "none", "exposure": 1},
    }
    if stage_layer is not None:
        render_profile["stageLayer"] = stage_layer
    if redrive:
        fog_color = parameter(redrive, "_fogColor")
        fog_range = vector(parameter(redrive, "_fogRange"))
        if fog_color is not None:
            # Keep Unity's serialized float channels. Converting through an
            # 8-bit hex string changes the linear GPU fog/background value.
            render_profile["backgroundColor"] = clean(fog_color)
        if fog_color is not None and len(fog_range) >= 2:
            render_profile["fog"] = {
                "color": clean(fog_color),
                "near": fog_range[0],
                "far": fog_range[1],
                "affectsCharacters": False,
            }
        render_profile["reDriveVolume"] = re_drive_profile

    tone_mode = int(parameter(tonemapping, "mode", 0))
    render_profile["renderer"]["toneMapping"] = {
        0: "none",
        2: "aces",
    }.get(tone_mode, "none")
    if bloom:
        bloom_intensity = float(parameter(bloom, "intensity", 0.0))
        render_profile["bloom"] = {
            "enabled": bloom_intensity > 0,
            "strength": bloom_intensity,
            "radius": float(parameter(bloom, "scatter", 0.7)),
            "threshold": float(parameter(bloom, "threshold", 0.9)),
            "clamp": float(parameter(bloom, "clamp", 65472.0)),
            "maxIterations": int(parameter(bloom, "maxIterations", 6)),
            "tint": clean(parameter(bloom, "tint", [1, 1, 1, 1])),
        }
    post: dict[str, Any] = {}
    film_grain_texture_record: dict[str, Any] | None = None
    if chromatic_aberration:
        intensity = float(parameter(chromatic_aberration, "intensity", 0.0))
        post["chromaticAberration"] = {
            "active": intensity > 0,
            "intensity": intensity,
            "operator": "urp-2022.3-fast-3-sample",
            "amountScale": 0.05,
        }
    if adjustments:
        color_adjustments: dict[str, Any] = {"active": True}
        for source, target in (
            ("postExposure", "postExposure"),
            ("contrast", "contrast"),
            ("colorFilter", "colorFilter"),
            ("hueShift", "hueShift"),
            ("saturation", "saturation"),
        ):
            value = parameter(adjustments, source)
            if value is not None:
                color_adjustments[target] = clean(value)
        post["colorAdjustments"] = color_adjustments
    if film_grain:
        grain_type = int(parameter(film_grain, "type", 0))
        grain_intensity = float(parameter(film_grain, "intensity", 0.0))
        grain_response = float(parameter(film_grain, "response", 0.8))
        film_grain_texture_record = film_grain_texture_source(
            grain_type,
            film_grain_texture_pointer,
            player_global_managers,
            product_dir,
            asset_prefix,
            export_assets,
        )
        film_grain_profile: dict[str, Any] = {
            "active": grain_intensity > 0 and film_grain_texture_record["resolved"],
            "type": grain_type,
            "lookupName": film_grain_texture_record["lookupName"],
            "intensity": grain_intensity,
            "response": grain_response,
            "intensityScale": 4.0,
            "sampler": film_grain_texture_record["sampler"],
        }
        if film_grain_texture_record.get("url"):
            film_grain_profile["textureUrl"] = film_grain_texture_record["url"]
        post["filmGrain"] = film_grain_profile
    if vignette:
        intensity = float(parameter(vignette, "intensity", 0.0))
        post["vignette"] = {
            "active": intensity > 0,
            "color": clean(parameter(vignette, "color", [0, 0, 0, 1])),
            "center": vector(parameter(vignette, "center", [0.5, 0.5]))[:2],
            "intensity": intensity,
            "smoothness": float(parameter(vignette, "smoothness", 0.2)),
            "rounded": bool(parameter(vignette, "rounded", False)),
        }
    if post:
        render_profile["postProcessing"] = post

    lightmap_binding_document, lightmap_binding_failures = (
        build_lightmap_binding_document(
            lightmap_sources,
            component_go,
            hierarchy,
            str(manifest["scene"]),
        )
    )
    exported_lightmaps: dict[str, Any] = {
        "colorUrls": existing_lightmap_urls(product_dir, asset_prefix),
        "directionalUrls": existing_lightmap_urls(
            product_dir, asset_prefix, "comp_dir"
        ),
        "shadowMaskUrls": existing_lightmap_urls(
            product_dir, asset_prefix, "shadowmask"
        ),
        "colorEncoding": None,
        "failures": [],
        "nullPointers": [],
    }
    exported_lightmaps["colorEncoding"] = lightmap_encoding_from_urls(
        exported_lightmaps["colorUrls"]
    )
    if export_assets:
        exported_lightmaps = export_lightmap_textures(
            lightmap_sources,
            product_dir,
            asset_prefix,
            True,
        )
    lightmap_urls = exported_lightmaps["colorUrls"]
    lightmap_encoding = exported_lightmaps["colorEncoding"]
    if lightmap_encoding:
        lightmap_binding_document["encoding"] = lightmap_encoding
    lightmap_bindings = existing_companion(
        product_dir, asset_prefix, ("lightmap-bindings.json",)
    )
    if (
        export_assets
        and product_dir is not None
        and not lightmap_bindings
        and lightmap_binding_document["renderers"]
        and not lightmap_binding_failures
    ):
        path = product_dir / "lightmap-bindings.json"
        path.write_text(
            json.dumps(lightmap_binding_document, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        lightmap_bindings = url_join(asset_prefix, path.name)

    uv1 = existing_companion(product_dir, asset_prefix, ("uv1-companion.json",))
    generated_uv1: dict[str, Any] | None = None
    uv1_failures: list[dict[str, Any]] = []
    uv1_blocking_failures: list[dict[str, Any]] = []
    if export_assets and product_dir is not None and not uv1:
        lightmapped_paths = {
            record["rendererHierarchyPath"]
            for record in lightmap_binding_document["renderers"]
        }
        generated_uv1, uv1_failures = build_uv1_companion(
            stage_objects,
            component_go,
            hierarchy,
            resolved_stage_id,
            str(manifest["scene"]),
            f"{unity_version}:{manifest['scene']}:{sum(path.stat().st_size for path in paths)}",
            model_url,
            lightmapped_paths,
        )
        generated_paths = {
            record["hierarchyPath"] for record in generated_uv1["nodes"]
        }
        uv1_blocking_failures = [
            record
            for record in uv1_failures
            if not record.get("hierarchyPath")
            or (
                record["hierarchyPath"] in lightmapped_paths
                and record["hierarchyPath"] not in generated_paths
            )
        ]
        failed_paths = {
            record.get("hierarchyPath") for record in uv1_blocking_failures
        }
        uv1_blocking_failures.extend(
            {
                "hierarchyPath": path,
                "reason": "lightmapped-renderer-has-no-uv1-companion",
            }
            for path in sorted(lightmapped_paths - generated_paths)
            if path not in failed_paths
        )
        if generated_uv1["nodes"] and not uv1_blocking_failures:
            path = product_dir / "uv1-companion.json"
            path.write_text(
                json.dumps(generated_uv1, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            uv1 = url_join(asset_prefix, path.name)

    if (
        lightmap_records
        and lightmap_urls
        and lightmap_bindings
        and lightmap_encoding
    ):
        lightmap: dict[str, Any] = {
            "bindingsUrl": lightmap_bindings,
            "encoding": lightmap_encoding,
            "intensity": 1,
        }
        if len(lightmap_urls) == 1:
            lightmap["textureUrl"] = lightmap_urls[0]
        else:
            lightmap["textureUrls"] = lightmap_urls
        directional_urls = exported_lightmaps["directionalUrls"]
        if len(directional_urls) == len(lightmap_urls):
            if len(directional_urls) == 1:
                lightmap["directionalTextureUrl"] = directional_urls[0]
            else:
                lightmap["directionalTextureUrls"] = directional_urls
        if uv1:
            lightmap["uv1CompanionUrl"] = uv1
        render_profile["lightmap"] = lightmap

    probe_url: str | None = None
    probe_encoding: str | None = None
    probe_filename: str | None = None
    reflection_probe_data: Any = None
    if reflection_probe_pointer is not None:
        reflection_probe_data = reflection_probe_pointer.read()
        if int(reflection_probe_data.m_TextureFormat) == UNITY_TEXTURE_FORMAT_BC6H:
            probe_filename = texture_filename(str(reflection_probe_data.m_Name)).replace(
                ".png", "-bc6h.dds"
            )
            probe_encoding = "unity-bc6h-uf16"
        elif (
            int(reflection_probe_data.m_TextureFormat)
            == UNITY_TEXTURE_FORMAT_RGBA_HALF
        ):
            probe_filename = texture_filename(str(reflection_probe_data.m_Name)).replace(
                ".png", "-rgba16f.dds"
            )
            probe_encoding = "unity-rgba16f"
        else:
            probe_filename = texture_filename(str(reflection_probe_data.m_Name)).replace(
                ".png", "-equirectangular.png"
            )
            probe_encoding = (
                "linear-image"
                if int(getattr(reflection_probe_data, "m_ColorSpace", 0)) == 1
                else "srgb-image"
            )
        probe_url = existing_companion(
            product_dir,
            asset_prefix,
            (probe_filename,),
        )
    reflection_probe_export: dict[str, Any] | None = None
    reflection_probe_export_error: str | None = None
    should_validate_exact_cubemap = (
        reflection_probe_data is not None
        and int(reflection_probe_data.m_TextureFormat)
        in {UNITY_TEXTURE_FORMAT_BC6H, UNITY_TEXTURE_FORMAT_RGBA_HALF}
    )
    if (
        export_assets
        and product_dir is not None
        and reflection_probe_pointer is not None
        and (not probe_url or should_validate_exact_cubemap)
    ):
        try:
            if not probe_filename or reflection_probe_data is None:
                raise ValueError("Reflection probe filename was not resolved")
            destination = product_dir / probe_filename
            if int(reflection_probe_data.m_TextureFormat) == UNITY_TEXTURE_FORMAT_BC6H:
                reflection_probe_export = export_cubemap_bc6h_dds(
                    reflection_probe_pointer,
                    destination,
                )
            elif (
                int(reflection_probe_data.m_TextureFormat)
                == UNITY_TEXTURE_FORMAT_RGBA_HALF
            ):
                reflection_probe_export = export_cubemap_rgba16f_dds(
                    reflection_probe_pointer,
                    destination,
                )
            else:
                reflection_probe_export = export_cubemap_equirectangular(
                    reflection_probe_pointer,
                    destination,
                )
            probe_url = url_join(asset_prefix, probe_filename)
        except Exception as error:
            reflection_probe_export_error = repr(error)
    if probe_url:
        render_profile["environmentTextureUrl"] = probe_url
        render_profile["environmentEncoding"] = probe_encoding
        render_profile["environmentIntensity"] = float(
            re_drive_profile.get("skyboxIntensity", 1.0)
        )

    probes: list[dict[str, Any]] = []
    runtime_probes: list[dict[str, Any]] = []
    for reader in stage_objects:
        if reader.type.name != "ReflectionProbe":
            continue
        obj = reader.read()
        go_id = component_go[int(reader.path_id)]
        transform = transform_by_go.get(go_id)
        matrix = world(transform["pathID"]) if transform else None
        position = [matrix[index][3] for index in range(3)] if matrix else [0.0, 0.0, 0.0]
        box_size = vector(obj.m_BoxSize)[:3]
        box_offset = vector(obj.m_BoxOffset)[:3]
        box_min, box_max = transformed_axis_aligned_box(
            matrix if matrix else transform_matrix([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]),
            box_offset,
            box_size,
        )
        texture_pointer = (
            obj.m_CustomBakedTexture
            if pointer_path_id(obj.m_CustomBakedTexture)
            else obj.m_BakedTexture
        )
        texture_url: str | None = None
        texture_encoding: str | None = None
        texture_export: dict[str, Any] | None = None
        texture_export_error: str | None = None
        if pointer_path_id(texture_pointer):
            try:
                texture_data = texture_pointer.read()
                if int(texture_data.m_TextureFormat) == UNITY_TEXTURE_FORMAT_BC6H:
                    filename = texture_filename(str(texture_data.m_Name)).replace(
                        ".png", "-bc6h.dds"
                    )
                    texture_encoding = "unity-bc6h-uf16"
                elif (
                    int(texture_data.m_TextureFormat)
                    == UNITY_TEXTURE_FORMAT_RGBA_HALF
                ):
                    filename = texture_filename(str(texture_data.m_Name)).replace(
                        ".png", "-rgba16f.dds"
                    )
                    texture_encoding = "unity-rgba16f"
                else:
                    filename = texture_filename(str(texture_data.m_Name)).replace(
                        ".png", "-equirectangular.png"
                    )
                    texture_encoding = (
                        "linear-image"
                        if int(getattr(texture_data, "m_ColorSpace", 0)) == 1
                        else "srgb-image"
                    )
                texture_url = existing_companion(product_dir, asset_prefix, (filename,))
                if export_assets and product_dir is not None:
                    destination = product_dir / filename
                    if int(texture_data.m_TextureFormat) == UNITY_TEXTURE_FORMAT_BC6H:
                        texture_export = export_cubemap_bc6h_dds(
                            texture_pointer,
                            destination,
                        )
                    elif (
                        int(texture_data.m_TextureFormat)
                        == UNITY_TEXTURE_FORMAT_RGBA_HALF
                    ):
                        texture_export = export_cubemap_rgba16f_dds(
                            texture_pointer,
                            destination,
                        )
                    elif not texture_url:
                        texture_export = export_cubemap_equirectangular(
                            texture_pointer,
                            destination,
                        )
                    texture_url = url_join(asset_prefix, filename)
            except Exception as error:
                texture_export_error = repr(error)
        active = bool(obj.m_Enabled) and active_in_hierarchy(go_id)
        probe_record = {
            "pathID": str(reader.path_id),
            "name": game_objects[go_id]["name"],
            "hierarchyPath": hierarchy(go_id),
            "enabled": bool(obj.m_Enabled),
            "activeInHierarchy": active_in_hierarchy(go_id),
            "mode": int(obj.m_Mode),
            "resolution": int(obj.m_Resolution),
            "position": position,
            "boxSize": box_size,
            "boxOffset": box_offset,
            "boxMin": box_min,
            "boxMax": box_max,
            "importance": int(obj.m_Importance),
            "intensityMultiplier": float(obj.m_IntensityMultiplier),
            "blendDistance": float(obj.m_BlendDistance),
            "boxProjection": bool(obj.m_BoxProjection),
            "hdr": bool(obj.m_HDR),
            "cullingMask": int(obj.m_CullingMask.m_Bits),
            "bakedTexture": pptr_record(obj.m_BakedTexture),
            "customBakedTexture": pptr_record(obj.m_CustomBakedTexture),
            "effectiveTexture": pptr_record(texture_pointer),
            "textureUrl": texture_url,
            "textureEncoding": texture_encoding,
            "textureExport": texture_export,
            "textureExportError": texture_export_error,
        }
        probes.append(probe_record)
        if active and texture_url and texture_encoding:
            runtime_probes.append(
                {
                    "id": str(reader.path_id),
                    "name": game_objects[go_id]["name"],
                    "textureUrl": texture_url,
                    "encoding": texture_encoding,
                    "position": position,
                    "boxMin": box_min,
                    "boxMax": box_max,
                    "importance": int(obj.m_Importance),
                    "intensity": float(obj.m_IntensityMultiplier),
                    "blendDistance": float(obj.m_BlendDistance),
                    "boxProjection": bool(obj.m_BoxProjection),
                }
            )
    if runtime_probes:
        render_profile["reflectionProbes"] = runtime_probes
    runtime_renderer_reflection_records = [
        {
            "rendererHierarchyPath": record["rendererHierarchyPath"],
            "reflectionProbeUsage": record["reflectionProbeUsage"],
            "reflectionProbeUsageName": record["reflectionProbeUsageName"],
            "probeAnchorHierarchyPath": record["probeAnchorHierarchyPath"],
            "probeAnchorPosition": record["probeAnchorPosition"],
        }
        for record in renderer_reflection_records
        if record["reflectionProbeUsage"] in REFLECTION_PROBE_USAGE
        and record["rendererHierarchyPath"]
        and (
            record["probeAnchorPosition"] is not None
            or pointer_path_id(record["probeAnchor"]) == 0
        )
    ]
    if runtime_renderer_reflection_records:
        render_profile["reflectionProbeBindings"] = (
            runtime_renderer_reflection_records
        )

    raw_materials, bindings = material_records(
        stage_objects,
        asset_prefix,
        product_dir,
        export_assets,
    )

    # Player AnimationClips retain CRC32 transform/property hashes, while the
    # same frozen closure still contains the Animator roots, full GameObject
    # hierarchy, renderer material slots and serialized material property
    # names. Join those authorities here so the browser consumer never guesses
    # a scene name, material slot or shader field.
    animators_by_clip_path_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for animator in animator_records.values():
        for clip in animator.get("clips", []):
            animators_by_clip_path_id[clip["pathID"]].append(animator)

    renderer_material_names_by_go: dict[int, list[str]] = defaultdict(list)
    for renderer_reader, renderer in renderer_components:
        go_id = component_go.get(int(renderer_reader.path_id), 0)
        if not go_id:
            continue
        names = renderer_material_names_by_go[go_id]
        for pointer in getattr(renderer, "m_Materials", []):
            name = pointer_name(pointer)
            if name and name not in names:
                names.append(name)

    material_colors_by_low_hash: dict[int, list[str]] = defaultdict(list)
    for material in raw_materials:
        for property_name in material.get("colors", {}):
            low_hash = zlib.crc32(property_name.encode("utf-8")) & 0x0FFFFFFF
            if property_name not in material_colors_by_low_hash[low_hash]:
                material_colors_by_low_hash[low_hash].append(property_name)

    rgba_components = ("r", "g", "b", "a")

    components_by_go: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for component_path_id, go_id in component_go.items():
        component_reader = reader_by_path_id.get(component_path_id)
        if component_reader is None:
            continue
        component_record: dict[str, Any] = {
            "componentPathID": str(component_path_id),
            "type": component_reader.type.name,
        }
        if component_reader.type.name == "SpriteRenderer":
            try:
                sprite_renderer_tree = clean(component_reader.read_typetree())
                component_record["fields"] = {
                    key: sprite_renderer_tree[key]
                    for key in (
                        "m_Enabled",
                        "m_Color",
                        "m_FlipX",
                        "m_FlipY",
                        "m_DrawMode",
                        "m_Size",
                        "m_MaskInteraction",
                        "m_SortingLayerID",
                        "m_SortingOrder",
                    )
                    if key in sprite_renderer_tree
                }
            except Exception:
                component_record["fields"] = {}
        mono = mono_components.get(component_path_id)
        if mono is not None:
            component_record["className"] = mono[0]
            component_record["fields"] = mono[1]
        components_by_go[go_id].append(component_record)

    def hashed_component_properties(
        tree: Any,
        property_hash: int,
        prefix: str = "",
    ) -> list[str]:
        if not isinstance(tree, dict):
            return []
        matches: list[str] = []
        for name, nested in tree.items():
            path = f"{prefix}.{name}" if prefix else name
            if zlib.crc32(name.encode("utf-8")) & 0xFFFFFFFF == property_hash:
                matches.append(path)
            matches.extend(hashed_component_properties(nested, property_hash, path))
        return matches

    for clip in component_clips:
        clip_animators = animators_by_clip_path_id.get(clip["pathID"], [])
        binding_roots = [
            {
                "source": "animator-controller",
                "animatorPathID": animator["pathID"],
                "hierarchyPath": animator["hierarchyPath"],
            }
            for animator in clip_animators
            if animator.get("hierarchyPath")
        ]
        binding_roots.extend(
            timeline_binding_roots_by_clip_path_id.get(int(clip["pathID"]), [])
        )
        deduplicated_roots: list[dict[str, Any]] = []
        seen_roots: set[tuple[str, str, str]] = set()
        for root in binding_roots:
            key = (
                str(root.get("hierarchyPath") or ""),
                str(root.get("directorPathID") or ""),
                str(root.get("trackPathID") or root.get("animatorPathID") or ""),
            )
            if not key[0] or key in seen_roots:
                continue
            seen_roots.add(key)
            deduplicated_roots.append(root)
        clip["bindingRoots"] = deduplicated_roots
        targets_by_hash: dict[int, list[dict[str, Any]]] = defaultdict(list)
        binding_hierarchy_by_path: dict[str, dict[str, Any]] = {}
        for binding_root in deduplicated_roots:
            root_path = binding_root.get("hierarchyPath")
            if not root_path:
                continue
            prefix = f"{root_path}/"
            for go_id in game_objects:
                full_path = hierarchy(go_id)
                if full_path == root_path:
                    relative_path = ""
                elif full_path.startswith(prefix):
                    relative_path = full_path[len(prefix) :]
                else:
                    continue
                transform = transform_by_go.get(go_id, {})
                binding_hierarchy_by_path[full_path] = {
                    "gameObjectPathID": str(go_id),
                    "hierarchyPath": full_path,
                    "active": bool(game_objects.get(go_id, {}).get("active", True)),
                    "localPosition": transform.get("localPosition", [0.0, 0.0, 0.0]),
                    "localRotation": transform.get(
                        "localRotation", [0.0, 0.0, 0.0, 1.0]
                    ),
                    "localScale": transform.get("localScale", [1.0, 1.0, 1.0]),
                }
                transform_hash = zlib.crc32(relative_path.encode("utf-8")) & 0xFFFFFFFF
                targets_by_hash[transform_hash].append(
                    {
                        "animatorPathID": binding_root.get("animatorPathID"),
                        "directorPathID": binding_root.get("directorPathID"),
                        "trackPathID": binding_root.get("trackPathID"),
                        "bindingRootHierarchyPath": root_path,
                        "relativePath": relative_path,
                        "hierarchyPath": full_path,
                        "gameObjectPathID": str(go_id),
                        "materialNames": renderer_material_names_by_go.get(go_id, []),
                        "pathAuthority": "binding-root-relative-crc32",
                    }
                )
        clip["bindingHierarchy"] = [
            binding_hierarchy_by_path[path]
            for path in sorted(
                binding_hierarchy_by_path,
                key=lambda value: (value.count("/"), value),
            )
        ]

        for binding in clip["bindings"]:
            transform_hash = int(binding["transformPathHash"])
            binding["targets"] = targets_by_hash.get(transform_hash, [])
            property_hash = int(binding["propertyNameHash"])
            component_candidates: list[dict[str, Any]] = []
            for target in binding["targets"]:
                go_id = int(target["gameObjectPathID"])
                for component in components_by_go.get(go_id, []):
                    if int(binding["typeID"]) == 212 and component["type"] == "SpriteRenderer":
                        component_candidates.append(
                            {
                                "hierarchyPath": target["hierarchyPath"],
                                "componentPathID": component["componentPathID"],
                                "componentType": component["type"],
                                "propertyName": "m_Sprite",
                                "propertyAuthority": "unity-sprite-renderer-pptr-binding",
                                "serializedState": component.get("fields", {}),
                            }
                        )
                    elif int(binding["typeID"]) == 114 and component["type"] == "MonoBehaviour":
                        for property_path in hashed_component_properties(
                            component.get("fields"), property_hash
                        ):
                            component_candidates.append(
                                {
                                    "hierarchyPath": target["hierarchyPath"],
                                    "componentPathID": component["componentPathID"],
                                    "componentType": component["type"],
                                    "componentClass": component.get("className"),
                                    "propertyName": property_path.split(".")[-1],
                                    "propertyPath": property_path,
                                    "propertyAuthority": "exact-component-field-crc32",
                                    "serializedState": component.get("fields", {}),
                                }
                            )
            binding["componentCandidates"] = component_candidates
            if (
                int(binding["typeID"]) == 1
                and property_hash == zlib.crc32(b"m_IsActive") & 0xFFFFFFFF
            ):
                binding["propertyName"] = "m_IsActive"
                binding["propertyNameAuthority"] = "exact-component-crc32"
            elif bool(binding.get("isPPtrCurve")) and component_candidates:
                property_names = {
                    candidate["propertyName"] for candidate in component_candidates
                }
                if len(property_names) == 1:
                    binding["propertyName"] = next(iter(property_names))
                    binding["propertyNameAuthority"] = component_candidates[0][
                        "propertyAuthority"
                    ]
            elif int(binding["typeID"]) == 23 and int(binding["customType"]) == 22:
                property_candidates = material_colors_by_low_hash.get(
                    property_hash & 0x0FFFFFFF,
                    [],
                )
                if len(property_candidates) == 1:
                    material_property = property_candidates[0]
                    component = rgba_components[(property_hash >> 28) & 0x3]
                    binding["materialPropertyName"] = material_property
                    binding["materialPropertyComponent"] = component
                    binding["propertyName"] = f"{material_property}.{component}"
                    binding["propertyNameAuthority"] = (
                        "serialized-material-color-crc32-low28+packed-component"
                    )

    runtime_profile: dict[str, Any] = {}
    if volumetric_light_beams:
        runtime_profile["volumetricLightBeams"] = volumetric_light_beams
        if vlb_player_config is not None:
            runtime_profile["volumetricLightBeamConfig"] = vlb_player_config
    if volumetric_dust_particles:
        runtime_profile["volumetricDustParticles"] = volumetric_dust_particles
    if particle_systems:
        runtime_profile["particlePresets"] = particle_presets
        runtime_profile["particleSystems"] = particle_systems
        if particle_meshes:
            runtime_profile["particleMeshes"] = particle_meshes
    if rotators:
        runtime_profile["rotators"] = rotators
    if component_clips:
        runtime_profile["serializedComponentClips"] = component_clips
    if animator_randomizers:
        runtime_profile["animatorRandomizers"] = animator_randomizers
    if activation_directors:
        runtime_profile["gameObjectStates"] = activation_game_object_states
        runtime_profile["activationDirectors"] = activation_directors
    if particle_systems or rotators or volumetric_dust_particles or component_clips:
        # Serialized playOnAwake particle systems and native Update-driven
        # components need the shared stage clock even when no transform clip
        # survived the FBX carrier export.
        runtime_profile["autoplay"] = True
        runtime_profile["loop"] = True
        runtime_profile["timeScale"] = 1.0
    result = {
        "schemaVersion": 1,
        "stageId": resolved_stage_id,
        "bundle": manifest["scene"],
        "unityVersion": unity_version,
        "coordinateSpace": {
            "source": "unity-world",
            "viewer": "assetstudio-fbx-reflect-x",
        },
        "renderProfile": render_profile,
        "materialBindings": bindings,
        "sourceRecords": {
            "stageCab": stage_cab,
            "closureManifest": str(manifest_path.resolve()),
            "closureMode": manifest.get(
                "mode",
                "staged-copy" if all("staged" in item for item in manifest["files"])
                else "source-reference",
            ),
            "closureFileCount": len(paths),
            "closureBytes": sum(path.stat().st_size for path in paths),
            "objectTypeCounts": dict(
                sorted(Counter(reader.type.name for reader in stage_objects).items())
            ),
            "lights": lights,
            "materials": raw_materials,
            "serializedComponentClips": component_clips,
            "animators": list(animator_records.values()),
            "animatorRandomizers": animator_randomizers,
            "playableDirectors": playable_director_records,
            "activationGameObjectStates": activation_game_object_states,
            "activationDirectors": activation_directors,
            "particlePresets": particle_presets,
            "particleSystems": particle_systems,
            "particleMeshes": particle_meshes,
            "particleMeshFailures": particle_mesh_failures,
            "rotators": rotators,
            "volumetricLightBeamConfig": vlb_player_config,
            "volumetricLightBeams": volumetric_light_beams,
            "volumetricDustParticles": volumetric_dust_particles,
            "volumeStack": volume_trace,
            "volumeComponents": {
                name: records for name, records in sorted(mono_raw.items())
                if name in VOLUME_CLASSES or name in {"Volume", "VolumeProfile"}
            },
            "unsupportedVolumeComponents": {
                name: records for name, records in sorted(mono_raw.items())
                if name and name not in VOLUME_CLASSES
                and name not in {
                    "Volume",
                    "VolumeProfile",
                    "UniversalAdditionalLightData",
                    "PrefabLightmapData",
                    "VolumetricLightBeam",
                    "VolumetricDustParticles",
                }
            },
            "prefabLightmapData": lightmap_records,
            "lightmapAutomation": {
                "bindingRendererCount": len(lightmap_binding_document["renderers"]),
                "bindingFailures": lightmap_binding_failures,
                "colorTextureUrls": lightmap_urls,
                "directionalTextureUrls": exported_lightmaps["directionalUrls"],
                "shadowMaskTextureUrls": exported_lightmaps["shadowMaskUrls"],
                "textureFailures": exported_lightmaps["failures"],
                "nullTexturePointers": exported_lightmaps["nullPointers"],
                "uv1CompanionUrl": uv1,
                "generatedUv1NodeCount": len(generated_uv1["nodes"])
                if generated_uv1
                else None,
                "uv1Failures": uv1_failures,
                "uv1BlockingFailures": uv1_blocking_failures,
            },
            "reflectionProbes": probes,
            "rendererReflectionProbeBindings": renderer_reflection_records,
            "rendererReflectionProbeFailures": renderer_reflection_failures,
            "reDriveReflectionProbe": {
                "componentPathID": str(reflection_probe_component_path_id)
                if reflection_probe_component_path_id is not None
                else None,
                "pointer": pptr_record(reflection_probe_pointer)
                if reflection_probe_pointer is not None
                else None,
                "environmentTextureUrl": probe_url,
                "environmentEncoding": probe_encoding,
                "export": reflection_probe_export,
                "exportError": reflection_probe_export_error,
            },
            "filmGrainTexture": {
                "componentPathID": str(film_grain_component_path_id)
                if film_grain_component_path_id is not None
                else None,
                "texture": film_grain_texture_record,
            },
            "unsupportedTonemappingMode": tone_mode
            if tone_mode not in {0, 2}
            else None,
        },
    }
    if runtime_profile:
        result["runtime"] = runtime_profile
    non_finite_numbers: list[dict[str, str]] = []
    result = json_safe_numbers(result, records=non_finite_numbers)
    result["sourceRecords"]["nonFiniteNumbers"] = non_finite_numbers
    return result


def main() -> int:
    args = parse_args()
    result = build_scene_profile(
        args.closure_manifest,
        args.stage_id,
        args.asset_prefix,
        args.product_dir,
        args.export_assets,
        args.model_url,
        args.player_resources,
        args.player_global_managers,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output.resolve()),
                "stageId": result["stageId"],
                "lights": len(result["renderProfile"].get("lights", [])),
                "materials": len(result.get("materialBindings", [])),
                "volumeClasses": sorted(
                    result["sourceRecords"]["volumeComponents"].keys()
                ),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
