#!/usr/bin/env python3
"""Build a compact, deterministic deployment audit from raw stage truth.

The input is the bounded output of extract-official-stage-raw-truth.py. This
tool does not open AssetBundles, copy payloads, or use the network. It records
what is proven and keeps the stage fail-closed when a required runtime carrier
or shader input is still missing.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


EXPECTED_STAGE_ID = "battle-600-01-00-001"
EXPECTED_RELEASE_PROFILE = "jp-android-3.13.0"
EXPECTED_UNITY_VERSION = "2022.3.62f2"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--shader-evidence", type=Path, required=True)
    parser.add_argument("--out-json", type=Path, required=True)
    parser.add_argument("--out-md", type=Path, required=True)
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
    temporary.replace(path)


def write_json_atomic(path: Path, value: Any) -> None:
    write_text_atomic(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def image_record(raw: dict[str, Any], name: str) -> dict[str, Any]:
    matches = [item for item in raw["images"] if item.get("name") == name]
    if len(matches) != 1:
        raise ValueError(f"image must resolve exactly once: {name!r}; matches={len(matches)}")
    item = matches[0]
    return {
        "name": item["name"],
        "type": item["type"],
        "pathId": item["pathId"],
        "sourceBundle": item["sourceBundle"],
        "width": item["width"],
        "height": item["height"],
        "mipCount": item["mipCount"],
        "imageCount": item["imageCount"],
        "encodedBytes": item["encodedImageDataBytes"],
        "encodedSha256": item["encodedImageDataSha256"],
        "decodedFirstImageRgbaSha256": item["decodedFirstImageRgbaSha256"],
    }


def material_record(raw: dict[str, Any], name: str) -> dict[str, Any]:
    matches = [item for item in raw["materials"] if item.get("name") == name]
    if len(matches) != 1:
        raise ValueError(f"material must resolve exactly once: {name!r}; matches={len(matches)}")
    item = matches[0]
    textures = []
    for entry in item.get("textures", []):
        pointer = entry.get("pointer", {})
        if pointer.get("resolved"):
            textures.append(
                {
                    "property": entry.get("property"),
                    "pathId": pointer.get("pathId"),
                    "name": pointer.get("resolvedName"),
                    "sourceBundle": pointer.get("resolvedSourceBundle"),
                    "scale": entry.get("scale"),
                    "offset": entry.get("offset"),
                }
            )
    return {
        "name": item["name"],
        "pathId": item["pathId"],
        "shader": item["shader"].get("resolvedName"),
        "shaderPathId": item["shader"].get("pathId"),
        "shaderSourceBundle": item["shader"].get("resolvedSourceBundle"),
        "validKeywords": item.get("validKeywords", []),
        "textures": textures,
        "floats": {
            key: item.get("floats", {}).get(key)
            for key in (
                "_BlendPow",
                "_BlendTexScale",
                "_NormalStrength",
                "_ReceiveShadows",
                "_Smoothness",
                "_USE_VERTEX_COLOR_BLEND",
                "_Unlitness",
            )
            if key in item.get("floats", {})
        },
        "colors": {
            key: item.get("colors", {}).get(key)
            for key in ("_BaseColor", "_BlendTexTillingOffset")
            if key in item.get("colors", {})
        },
    }


def focused(raw: dict[str, Any], class_name: str) -> list[dict[str, Any]]:
    values = raw["monoBehaviours"]["focusedTypetrees"].get(class_name, [])
    if not isinstance(values, list):
        raise ValueError(f"focused typetree is not a list: {class_name}")
    return values


def compact_clip(clip: dict[str, Any]) -> dict[str, Any]:
    packed = clip.get("packed", {})
    summary = packed.get("streamed", {})
    return {
        "name": clip.get("name"),
        "pathId": clip.get("pathId"),
        "legacy": clip.get("legacy"),
        "sampleRate": clip.get("sampleRate"),
        "stopTime": clip.get("stopTime"),
        "loopTime": clip.get("loopTime"),
        "bindingCount": packed.get("bindingCount", 0),
        "bindings": packed.get("bindings", []),
        "streamed": {
            "wordCount": summary.get("wordCount"),
            "byteCount": summary.get("byteCount"),
            "frameCount": summary.get("frameCount"),
            "curveCount": summary.get("curveCount"),
            "sentinelFrameCount": summary.get("sentinelFrameCount"),
            "keyCount": summary.get("keyCount"),
            "serializedValueMin": summary.get("serializedValueMin"),
            "serializedValueMax": summary.get("serializedValueMax"),
        },
        "dense": packed.get("dense", {}),
        "constant": packed.get("constant", {}),
    }


def compact_controller(controller: dict[str, Any]) -> dict[str, Any]:
    typetree = controller.get("typetree", {})
    clip_pointers = []
    for pointer in typetree.get("m_AnimationClips", []):
        path_id = pointer.get("m_PathID") if isinstance(pointer, dict) else None
        if path_id not in (None, 0, "0"):
            clip_pointers.append(str(path_id))
    tos = []
    for entry in typetree.get("m_TOS", []):
        if isinstance(entry, list) and len(entry) == 2:
            tos.append({"hash": entry[0], "name": entry[1]})
    return {
        "name": controller.get("name"),
        "pathId": controller.get("pathId"),
        "clipPathIds": clip_pointers,
        "tos": tos,
    }


def non_null_pointer_count(values: list[Any]) -> int:
    count = 0
    for value in values:
        if not isinstance(value, dict):
            continue
        path_id = value.get("m_PathID", value.get("pathId", 0))
        if path_id not in (None, 0, "0"):
            count += 1
    return count


def build(raw: dict[str, Any], shader: dict[str, Any]) -> dict[str, Any]:
    if raw.get("stageId") != EXPECTED_STAGE_ID:
        raise ValueError(f"unexpected stageId: {raw.get('stageId')!r}")
    method = raw.get("method", {})
    if method.get("releaseProfile") != EXPECTED_RELEASE_PROFILE:
        raise ValueError(f"unexpected release profile: {method.get('releaseProfile')!r}")
    if method.get("unityFallbackVersion") != EXPECTED_UNITY_VERSION:
        raise ValueError(f"unexpected Unity version: {method.get('unityFallbackVersion')!r}")
    if shader.get("shader") != "Creative/Bg/BgUberShader":
        raise ValueError("shader evidence does not describe Creative/Bg/BgUberShader")
    if shader.get("unityVersion") != EXPECTED_UNITY_VERSION:
        raise ValueError("shader evidence Unity version does not match the JP release profile")

    closure = raw["closure"]
    stage = raw["stage"]
    manifest = raw["manifest"]
    meshes = raw["meshes"]["inventory"]
    valid_meshes = [item for item in meshes if int(item.get("vertexCount", 0)) > 0]
    lightmapped_meshes = [item for item in valid_meshes if item.get("usedByLightmap")]
    uv1_meshes = [item for item in valid_meshes if int(item.get("uv1Count", 0)) > 0]
    lightmapped_uv1_meshes = [item for item in lightmapped_meshes if int(item.get("uv1Count", 0)) > 0]

    if closure.get("fileCount") != 13 or closure.get("totalBytes") != 16309195:
        raise ValueError("closure identity drifted from the audited manifest")
    if stage.get("objectCount") != 2071 or stage.get("gameObjectCount") != 517:
        raise ValueError("stage hierarchy counts drifted")
    if raw.get("unresolvedMaterialPointers"):
        raise ValueError("material PPtr resolution is incomplete")
    if len(raw.get("materials", [])) != 14 or len(raw.get("renderers", [])) != 353:
        raise ValueError("material or renderer counts drifted")
    if len(valid_meshes) != 258 or len(lightmapped_meshes) != 225:
        raise ValueError("mesh inventory drifted")
    if uv1_meshes or lightmapped_uv1_meshes:
        raise ValueError("source UV1 absence gate drifted")
    if raw["lightmap"].get("rendererCount") != 319:
        raise ValueError("lightmap renderer count drifted")
    if shader.get("lightmapUvFormula") != "UV1 * unity_LightmapST.xy + unity_LightmapST.zw":
        raise ValueError("compiled shader UV1 formula is missing or changed")

    post_processing = {
        "tonemapping": focused(raw, "Tonemapping"),
        "bloom": focused(raw, "Bloom"),
        "vignette": focused(raw, "Vignette"),
        "colorAdjustments": focused(raw, "ColorAdjustments"),
        "globalVolumeController": focused(raw, "GlobalVolumeController"),
        "reDriveVolume": focused(raw, "ReDriveVolume"),
    }
    prefab_lightmap = focused(raw, "PrefabLightmapData")
    if len(prefab_lightmap) != 1:
        raise ValueError(f"expected one PrefabLightmapData component; got {len(prefab_lightmap)}")
    prefab_lightmap_keys = sorted(prefab_lightmap[0])
    if any("uv" in key.lower() for key in prefab_lightmap_keys):
        raise ValueError("PrefabLightmapData unexpectedly gained a UV carrier field")
    dynamic = {
        "animators": raw["animation"]["animators"],
        "controllers": [compact_controller(item) for item in raw["animation"]["controllers"]],
        "clips": [compact_clip(item) for item in raw["animation"]["clips"]],
        "particleSystems": raw["particleSystems"],
        "volumetricDustParticles": focused(raw, "VolumetricDustParticles"),
        "volumetricLightBeams": focused(raw, "VolumetricLightBeam"),
    }

    blockers = [
        {
            "id": "official-uv1-runtime-provider",
            "severity": "blocking",
            "fact": "225 unique lightmapped source meshes and 319 renderer bindings exist, but all 258 valid serialized meshes contain zero UV1 values.",
            "requiredEvidence": "Identify the official runtime or export carrier that supplies TEXCOORD1; do not substitute UV0.",
        },
        {
            "id": "deployable-geometry-carrier",
            "severity": "blocking",
            "fact": "No browser-ready hierarchy carrier with proven official UV1 is registered for this stage.",
            "requiredEvidence": "A strict hierarchy/vertex mapping with official UV1 and zero ambiguous or mismatched nodes.",
        },
        {
            "id": "bg-uber-operator-parity",
            "severity": "blocking",
            "fact": "PPtrs and material parameters are resolved, while the full compiled BgUber operator chain has not yet been translated into the Viewer.",
            "requiredEvidence": "Compiled-shader-backed bindings and an external-Chrome A/B capture.",
        },
        {
            "id": "dynamic-component-parity",
            "severity": "partial",
            "fact": "Two clips, two controllers, one particle system, two dust components, and two volumetric beams are inventoried but not yet reproduced in the browser runtime.",
            "requiredEvidence": "Bound runtime playback with component/property parity and visual evidence.",
        },
    ]

    return {
        "schemaVersion": 1,
        "stageId": raw["stageId"],
        "releaseProfile": method["releaseProfile"],
        "unityVersion": method["unityFallbackVersion"],
        "readiness": {
            "state": "evidence-complete-runtime-blocked",
            "deploymentSafe": False,
            "visibleReviewReady": False,
            "reason": "The raw component/material truth is closed, but the official UV1 runtime provider and a strict browser carrier are unresolved.",
        },
        "source": {
            "networkUsed": method["networkUsed"],
            "sourceBundlesCopied": method["sourceBundlesCopied"],
            "manifestPath": manifest["path"],
            "manifestBytes": manifest["bytes"],
            "manifestSha256": manifest["sha256"],
            "manifestTargetId": manifest["targetId"],
            "manifestTargetName": manifest["targetName"],
            "manifestHash128": manifest["hash128BytesHex"],
            "rootBundle": closure["inputs"][0]["relative"],
            "rootBundleBytes": closure["inputs"][0]["bytes"],
            "rootBundleSha256": closure["inputs"][0]["sha256"],
            "closureFiles": closure["fileCount"],
            "closureBytes": closure["totalBytes"],
            "externalTableAllMapped": closure["externalTableAllMapped"],
            "stageExternalBundlesNotInManifest": closure["stageExternalBundlesNotInManifest"],
        },
        "hierarchy": {
            "cab": stage["cab"],
            "objects": stage["objectCount"],
            "gameObjects": stage["gameObjectCount"],
            "transforms": stage["transformCount"],
            "rootGameObjects": stage["rootGameObjects"],
            "objectTypeCounts": stage["objectTypeCounts"],
        },
        "materials": {
            "materialCount": len(raw["materials"]),
            "rendererCount": len(raw["renderers"]),
            "unresolvedPointers": len(raw["unresolvedMaterialPointers"]),
            "ground": material_record(raw, "bg3d600B_00_ground"),
            "skybox": material_record(raw, "SkyBox_bg3d600B_00"),
            "all": [
                {"name": item["name"], "pathId": item["pathId"], "shader": item["shader"].get("resolvedName")}
                for item in raw["materials"]
            ],
        },
        "uv1AndLightmaps": {
            "sourceMeshCount": len(meshes),
            "validSourceMeshCount": len(valid_meshes),
            "lightmappedUniqueMeshCount": len(lightmapped_meshes),
            "sourceUv1MeshCount": len(uv1_meshes),
            "lightmappedSourceUv1MeshCount": len(lightmapped_uv1_meshes),
            "meshDecodeFailures": raw["meshes"]["decodeFailures"],
            "rendererBindingCount": raw["lightmap"]["rendererCount"],
            "lightmapCount": len(raw["lightmap"]["lightmaps"]),
            "directionalLightmapCount": non_null_pointer_count(raw["lightmap"]["directionalLightmaps"]),
            "shadowMaskCount": non_null_pointer_count(raw["lightmap"]["shadowMasks"]),
            "lightmap": image_record(raw, "Lightmap-0_comp_light"),
            "prefabLightmapData": {
                "componentCount": len(prefab_lightmap),
                "rendererInfoCount": len(prefab_lightmap[0].get("m_RendererInfo", [])),
                "serializedFields": prefab_lightmap_keys,
                "containsUvCarrierField": False,
                "conclusion": "PrefabLightmapData stores renderer PPtrs, lightmap indices, ST offsets, lightmap textures, and light metadata; it does not serialize mesh UV1 values.",
            },
            "compiledShaderEvidence": shader,
            "conclusion": "The official LIGHTMAP_ON path requires TEXCOORD1/UV1. The serialized source meshes have no UV1, so deployment remains fail-closed until the official provider/carrier is found.",
        },
        "lighting": raw["lights"],
        "environment": {
            "skyboxReflection": image_record(raw, "ReflectionProbe-bg3d600B_00"),
            "reDriveReflection": image_record(raw, "ReflectionProbe-0"),
            "supportingTextures": [
                image_record(raw, name)
                for name in (
                    "bg3d600B_00_groundEdge_col",
                    "bg3d600B_00_farTree_col",
                    "matcap02",
                    "bg3d600B_00_prop_nml",
                    "bg3d600B_00_wall_col",
                    "bg3d600B_00_groundSiba_nml",
                    "cloud_noise_tex",
                    "bg3d600B_00_groundSiba_col",
                    "bg3d600B_00_roofRose_col",
                    "bg3d600B_00_groundTuti_col",
                    "bg3d600B_00_prop_col",
                )
            ],
        },
        "postProcessing": post_processing,
        "dynamicComponents": dynamic,
        "confirmedFacts": [
            "The 13-file local JP closure is complete, hash-bound, and required no network or payload copy.",
            "All 14 material PPtrs resolve and the stage contains 353 renderers.",
            "The stage contains one baked lightmap and 319 renderer lightmap bindings.",
            "All 258 valid serialized meshes contain UV0 but no UV1; 225 unique lightmapped meshes are affected.",
            "The official compiled LIGHTMAP_ON vertex path reads TEXCOORD1 and applies unity_LightmapST.",
            "The raw stage contains six Lights, two Cubemaps, two AnimationClips, two AnimatorControllers, one ParticleSystem, two volumetric dust components, and two volumetric light beams.",
        ],
        "inferences": [
            "An official runtime or build/export step supplies the missing UV1/TEXCOORD1 data; its implementation has not yet been identified.",
            "A visually faithful browser result will require both the UV1 carrier and compiled BgUber operator parity, not a global brightness adjustment.",
        ],
        "blockers": blockers,
    }


def md_table(rows: list[tuple[str, Any]]) -> list[str]:
    result = ["| Field | Value |", "| --- | --- |"]
    result.extend(f"| {name} | `{value}` |" for name, value in rows)
    return result


def render_markdown(audit: dict[str, Any]) -> str:
    source = audit["source"]
    uv = audit["uv1AndLightmaps"]
    dynamic = audit["dynamicComponents"]
    lines = [
        "# Official Stage 600-01-00-001 audit",
        "",
        "> This is a deployment gate, not a visual-parity claim. Raw truth is closed; runtime deployment is deliberately blocked until official UV1 provenance is recovered.",
        "",
        "## Identity",
        "",
        *md_table(
            [
                ("Stage", audit["stageId"]),
                ("Release profile", audit["releaseProfile"]),
                ("Unity", audit["unityVersion"]),
                ("Readiness", audit["readiness"]["state"]),
                ("Deployment safe", str(audit["readiness"]["deploymentSafe"]).lower()),
                ("Visible review ready", str(audit["readiness"]["visibleReviewReady"]).lower()),
            ]
        ),
        "",
        "## Source closure",
        "",
        *md_table(
            [
                ("Manifest target", source["manifestTargetName"]),
                ("Manifest key", source["manifestTargetId"]),
                ("Manifest hash128", source["manifestHash128"]),
                ("Root bundle SHA-256", source["rootBundleSha256"]),
                ("Closure", f"{source['closureFiles']} files / {source['closureBytes']} bytes"),
                ("Network used", str(source["networkUsed"]).lower()),
                ("Source bundles copied", str(source["sourceBundlesCopied"]).lower()),
            ]
        ),
        "",
        "## UV1 and baked-lightmap gate",
        "",
        *md_table(
            [
                ("Valid source meshes", uv["validSourceMeshCount"]),
                ("Unique lightmapped meshes", uv["lightmappedUniqueMeshCount"]),
                ("Source meshes with UV1", uv["sourceUv1MeshCount"]),
                ("Renderer lightmap bindings", uv["rendererBindingCount"]),
                ("Mesh decode failures", uv["meshDecodeFailures"]),
                ("Official formula", uv["compiledShaderEvidence"]["lightmapUvFormula"]),
            ]
        ),
        "",
        uv["conclusion"],
        "",
        "## Material and environment truth",
        "",
        f"- Materials: **{audit['materials']['materialCount']}**, renderers: **{audit['materials']['rendererCount']}**, unresolved PPtrs: **{audit['materials']['unresolvedPointers']}**.",
        f"- Ground: `{audit['materials']['ground']['shader']}` with `{', '.join(audit['materials']['ground']['validKeywords'])}`.",
        f"- Lights: **{len(audit['lighting'])}**; reflection cubemaps: **2**; supporting textures: **{len(audit['environment']['supportingTextures'])}**.",
        "- Post-processing truth includes Tonemapping, Bloom, Vignette, ColorAdjustments, GlobalVolumeController, and ReDriveVolume typetrees.",
        "",
        "## Dynamic truth",
        "",
        f"- Animators: **{len(dynamic['animators'])}**; controllers: **{len(dynamic['controllers'])}**; clips: **{len(dynamic['clips'])}**.",
        f"- Particle systems: **{len(dynamic['particleSystems'])}**; volumetric dust: **{len(dynamic['volumetricDustParticles'])}**; volumetric beams: **{len(dynamic['volumetricLightBeams'])}**.",
        "",
        "## Confirmed facts",
        "",
        *[f"- {item}" for item in audit["confirmedFacts"]],
        "",
        "## Inferences",
        "",
        *[f"- {item}" for item in audit["inferences"]],
        "",
        "## Blocking gates",
        "",
        *[
            f"- **{item['id']}** ({item['severity']}): {item['fact']} Required: {item['requiredEvidence']}"
            for item in audit["blockers"]
        ],
        "",
        "## Next reproducible action",
        "",
        "Locate the official UV1/TEXCOORD1 provider in `PrefabLightmapData` or the official runtime/export path. A product carrier may be generated only after strict hierarchy, vertex-count, and UV1 provenance checks pass with zero ambiguity.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    raw = load_json(args.raw)
    shader = load_json(args.shader_evidence)
    audit = build(raw, shader)
    write_json_atomic(args.out_json, audit)
    write_text_atomic(args.out_md, render_markdown(audit))
    print(
        json.dumps(
            {
                "stageId": audit["stageId"],
                "state": audit["readiness"]["state"],
                "deploymentSafe": audit["readiness"]["deploymentSafe"],
                "blockerCount": len(audit["blockers"]),
                "outJson": str(args.out_json.resolve()),
                "outMarkdown": str(args.out_md.resolve()),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
