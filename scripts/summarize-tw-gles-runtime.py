#!/usr/bin/env python3
"""Summarize bounded TW GLES runtime evidence into a reviewable contract.

The raw Frida/Revula captures are intentionally kept under artifacts/.  This
script extracts only evidence that changes Viewer implementation decisions:
active official shader interfaces, required vertex channels, UBO layouts and
the live stage/post-processing values observed in the same battle frame.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load_messages(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    return [
        item.get("payload", {})
        for item in payload.get("data", {}).get("messages", [])
        if isinstance(item, dict)
    ]


def uniform_names(program: dict[str, Any]) -> set[str]:
    return {str(item.get("name", "")) for item in program.get("uniforms", [])}


def has_suffix(names: set[str], suffix: str) -> bool:
    return any(name == suffix or name.endswith(suffix) for name in names)


def classify(program: dict[str, Any]) -> list[str]:
    names = uniform_names(program)
    tags: list[str] = []
    if has_suffix(names, "_Gem1stShadSize") and has_suffix(names, "_AnisoThreshold"):
        tags.append("ReDriveToon")
    # BgUber variants compile optional blend controls out of the active
    # interface (hlslcc emits Xhlslcc_UnusedX_* markers for those members).
    # The global background adjustment plus the base/normal material inputs
    # are stable across the live forward, depth and shadow variants.
    if (
        has_suffix(names, "_BgColorAdjustments")
        and has_suffix(names, "_BaseMap")
        and has_suffix(names, "_BumpMap")
    ):
        tags.append("BgUber")
    if has_suffix(names, "_ChigiriEdgeColor") and has_suffix(names, "_UwasaLineColor"):
        tags.append("EnemyUber")
    if "_Lut_Params" in names and "_HueSatCon" in names:
        tags.append("ColorGrading")
    return tags or ["Other"]


def value_map(program: dict[str, Any]) -> dict[str, list[float | int]]:
    return {
        str(item["name"]): item["values"]
        for item in program.get("uniforms", [])
        if item.get("location", -1) >= 0 and "values" in item
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--interfaces", type=Path, required=True)
    parser.add_argument("--values", type=Path, required=True)
    parser.add_argument("--screenshot", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    interface_programs = {
        int(item["program"]): item
        for item in load_messages(args.interfaces)
        if item.get("kind") == "gles-program-interface"
    }
    value_programs = {
        int(item["program"]): item
        for item in load_messages(args.values)
        if item.get("kind") == "gles-program-values-and-blocks"
    }

    classified: dict[str, list[int]] = {}
    interfaces: list[dict[str, Any]] = []
    for program_id, program in sorted(interface_programs.items()):
        tags = classify(program)
        for tag in tags:
            classified.setdefault(tag, []).append(program_id)
        interfaces.append({
            "program": program_id,
            "families": tags,
            "uniformCount": program.get("uniformCount"),
            "attributeCount": program.get("attributeCount"),
            "attributes": [item.get("name") for item in program.get("attributes", [])],
        })

    # The live battle yielded one active color-grading program and two full
    # BgUber forward variants.  Select by interface signature, never by an
    # assumed persistent GLES program number.
    color_program_id = next(
        program_id for program_id, program in interface_programs.items()
        if "ColorGrading" in classify(program)
    )
    full_bg_program_ids = [
        program_id for program_id, program in interface_programs.items()
        if "BgUber" in classify(program)
        and {"in_TANGENT0", "in_COLOR0", "in_TEXCOORD1"}.issubset(
            {item.get("name") for item in program.get("attributes", [])}
        )
    ]
    color_values = value_map(value_programs[color_program_id])
    bg_values = value_map(value_programs[full_bg_program_ids[0]])

    block_contracts: list[dict[str, Any]] = []
    for program_id, program in sorted(value_programs.items()):
        for block in program.get("blocks", []):
            block_contracts.append({
                "program": program_id,
                "name": block.get("name"),
                "binding": block.get("binding"),
                "dataSize": block.get("dataSize"),
                "memberCount": len(block.get("members", [])),
            })

    report = {
        "schemaVersion": 1,
        "capture": {
            "releaseProfile": "TW Android 1.1.2 / Unity 2022.3.62f3",
            "package": "tw.sonet.magiaexedra",
            "adbSerial": "127.0.0.1:16384",
            "displayId": 3,
            "surfaceFlingerDisplay": "4619826888814064386",
            "logicalResolution": [3840, 2160],
            "renderResolution": [1536, 864],
            "screenshot": args.screenshot.as_posix(),
            "screenshotBytes": args.screenshot.stat().st_size,
            "method": "Revula Frida attach; read-only GLES interface/value queries",
        },
        "programCount": len(interface_programs),
        "classifiedPrograms": classified,
        "interfaces": interfaces,
        "requiredGenericGroundVertexChannels": [
            "POSITION", "NORMAL", "TANGENT", "COLOR", "TEXCOORD0", "TEXCOORD1",
        ],
        "fullBgUberPrograms": full_bg_program_ids,
        "uniformBlockContracts": block_contracts,
        "liveStageValues": {
            key: bg_values[key]
            for key in [
                "_BgShadowStrengthAdditive",
                "_GlobalBackgroundTintColor",
                "_BgColorAdjustments",
                "_BgBackgroundTintColor",
                "_MainLightColor",
                "_AdditionalLightsCount",
                "unity_FogColor",
                "_MainLightPosition",
                "_ProjectionParams",
                "unity_FogParams",
                "_MainLightShadowParams",
            ]
        },
        "liveColorGradingValues": {
            key: color_values[key]
            for key in [
                "_ColorFilter", "_Lut_Params", "_ColorBalance", "_HueSatCon",
                "_Lift", "_Gamma", "_Gain", "_ShaHiLimits",
            ]
        },
        "implementationDecisions": [
            "Ground import must retain tangent, vertex color and UV1; UV0-only projection is invalid.",
            "BgUber must bind base/normal/blend/lightmap/reflection inputs and use live stage lighting/fog globals.",
            "The white-filter defect cannot be corrected with an arbitrary tint: the official frame uses saturation 1.15 and contrast 1.10 through URP color grading.",
            "ReDriveToon, BgUber, EnemyUber and color grading are distinct active program families and require separate dispatch.",
            "Material values stored in UnityPerMaterial UBOs require static Material/MPB evidence; inactive -1 uniforms are not valid runtime values.",
        ],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "programCount": report["programCount"],
        "classifiedPrograms": classified,
        "fullBgUberPrograms": full_bg_program_ids,
        "output": args.out.as_posix(),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
