#!/usr/bin/env python3
"""Join raw Unity Material TexEnv and Texture2D sampler truth into a stage shard.

This is deliberately stage-name agnostic.  It consumes evidence documents and
updates every matching material slot; material names are never special-cased.
An incomplete PPtr/sampler join fails before the output file is replaced.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import unquote, urlparse


SLOT_SPECS = {
    "base": {
        "url": "baseMapUrl",
        "properties": ("_BaseMap", "_MainTex"),
        "colorSpace": "srgb",
        "coordinates": {"kind": "mesh-uv", "channel": 0},
    },
    "normal": {
        "url": "normalMapUrl",
        "properties": ("_BumpMap",),
        "colorSpace": "linear",
        "coordinates": {"kind": "mesh-uv", "channel": 0},
    },
    "smoothness": {
        "url": "smoothnessMapUrl",
        "properties": ("_MetallicGlossMap",),
        "colorSpace": "linear",
        "coordinates": {"kind": "mesh-uv", "channel": 0},
    },
    "blend": {
        "url": "blendMapUrl",
        "properties": ("_BlendTex",),
        "colorSpace": "srgb",
        "coordinates": {"kind": "mesh-uv", "channel": 0},
    },
    "matCap": {
        "url": "matCapMapUrl",
        "properties": ("_MatCapTex",),
        "colorSpace": "srgb",
        "coordinates": {"kind": "view-normal"},
    },
}


class BindingError(RuntimeError):
    pass


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise BindingError(f"failed to read JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise BindingError(f"root JSON value must be an object: {path}")
    return value


def write_atomic(path: Path, value: dict[str, Any]) -> None:
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(payload, encoding="utf-8", newline="\n")
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _texture_name_from_url(url: str) -> str:
    parsed = urlparse(url)
    return Path(unquote(PurePosixPath(parsed.path).name)).stem


def _resolved_texenv(material: dict[str, Any], properties: tuple[str, ...]) -> dict[str, Any] | None:
    by_property = {item.get("property"): item for item in material.get("textures", [])}
    for property_name in properties:
        candidate = by_property.get(property_name)
        pointer = candidate.get("pointer", {}) if candidate else {}
        if pointer.get("resolved") and pointer.get("resolvedType") == "Texture2D":
            return candidate
    return None


def _sampler_index(sampling: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    if sampling.get("unityVersion") != "2022.3.62f2":
        raise BindingError(
            f"unsupported sampler profile Unity version: {sampling.get('unityVersion')!r}"
        )
    result: dict[tuple[str, str], dict[str, Any]] = {}
    for sampler in sampling.get("textures", []):
        key = (str(sampler.get("sourceCab")), str(sampler.get("pathId")))
        if key in result:
            raise BindingError(f"ambiguous Texture2D sampler identity: {key}")
        result[key] = sampler
    return result


def _slot_texenv(
    slot: str,
    binding: dict[str, Any],
    material: dict[str, Any],
) -> dict[str, Any]:
    spec = SLOT_SPECS[slot]
    texenv = _resolved_texenv(material, spec["properties"])
    if texenv is None and slot == "smoothness":
        # Unity's standard albedo-alpha path owns no separate TexEnv.  Preserve
        # the exact base PPtr/ST but sample its alpha through a linear instance.
        if (
            "_SMOOTHNESS_TEXTURE_ALBEDO_CHANNEL_A" in material.get("validKeywords", [])
            and binding.get("smoothnessMapUrl") == binding.get("baseMapUrl")
        ):
            texenv = _resolved_texenv(material, SLOT_SPECS["base"]["properties"])
    if texenv is None:
        raise BindingError(
            f"{binding.get('materialName')}/{slot} has a runtime URL but no resolved Unity TexEnv"
        )
    return texenv


def build_exact_texture_bindings(
    raw: dict[str, Any],
    sampling: dict[str, Any],
    shard: dict[str, Any],
) -> dict[str, Any]:
    materials: dict[str, dict[str, Any]] = {}
    for material in raw.get("materials", []):
        name = material.get("name")
        if name in materials:
            raise BindingError(f"duplicate raw material name: {name!r}")
        materials[name] = material
    samplers = _sampler_index(sampling)

    bindings = shard.get("materialBindings")
    if not isinstance(bindings, list):
        raise BindingError("catalog shard has no materialBindings array")

    joined_slots = 0
    for binding in bindings:
        material_name = binding.get("materialName")
        material = materials.get(material_name)
        if material is None:
            raise BindingError(f"catalog material lacks raw truth: {material_name!r}")
        exact: dict[str, Any] = {}
        for slot, spec in SLOT_SPECS.items():
            url = binding.get(spec["url"])
            if not url:
                continue
            texenv = _slot_texenv(slot, binding, material)
            pointer = texenv["pointer"]
            key = (str(pointer.get("resolvedCab")), str(pointer.get("pathId")))
            sampler = samplers.get(key)
            if sampler is None:
                raise BindingError(
                    f"{material_name}/{slot} has no exact Texture2D sampler for {key}"
                )
            if sampler.get("name") != pointer.get("resolvedName"):
                raise BindingError(
                    f"{material_name}/{slot} PPtr name disagrees with sampler: "
                    f"{pointer.get('resolvedName')!r} != {sampler.get('name')!r}"
                )
            if _texture_name_from_url(url) != pointer.get("resolvedName"):
                raise BindingError(
                    f"{material_name}/{slot} runtime carrier does not match PPtr: {url!r}"
                )
            serialized_color_space = sampler.get("colorSpace")
            if serialized_color_space not in {"sRGB", "linear"}:
                raise BindingError(
                    f"{material_name}/{slot} has unsupported serialized color space"
                )
            exact[slot] = {
                "url": url,
                "sourceProperty": texenv["property"],
                "sourceTexturePathId": str(pointer["pathId"]),
                "sourceTextureBundle": pointer["resolvedSourceBundle"],
                "sourceTextureCab": pointer["resolvedCab"],
                "serializedColorSpace": "srgb" if serialized_color_space == "sRGB" else "linear",
                "colorSpace": spec["colorSpace"],
                "coordinates": spec["coordinates"],
                "transform": {
                    "scale": [float(value) for value in texenv["scale"]],
                    "offset": [float(value) for value in texenv["offset"]],
                },
                "wrap": {"u": sampler["wrapU"], "v": sampler["wrapV"]},
                "filter": sampler["filterMode"],
                "anisotropy": int(sampler["aniso"]),
                "mipBias": float(sampler["mipBias"]),
                "mipCount": int(sampler["mipCount"]),
                "evidence": "exact-unity-texture2d",
            }
            joined_slots += 1
        if exact:
            binding["textures"] = exact

    shard.setdefault("textureBindingEvidence", {})
    shard["textureBindingEvidence"].update({
        "schemaVersion": 1,
        "unityVersion": sampling["unityVersion"],
        "profile": sampling.get("profile"),
        "materialCount": len(bindings),
        "exactSlotCount": joined_slots,
        "joinKey": ["sourceCab", "pathId"],
    })
    return shard


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--raw-truth", required=True, type=Path)
    value.add_argument("--sampling", required=True, type=Path)
    value.add_argument("--catalog", required=True, type=Path)
    value.add_argument("--output", required=True, type=Path)
    return value


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        result = build_exact_texture_bindings(
            load_json(args.raw_truth),
            load_json(args.sampling),
            load_json(args.catalog),
        )
        write_atomic(args.output, result)
        return 0
    except BindingError as exc:
        print(f"error: {exc}", file=os.sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
