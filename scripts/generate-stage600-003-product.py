from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path


REPO = Path(r"D:\magia\MyProducts\Magius3Dviewer-StageP0-20260809")
EVIDENCE = REPO / "artifacts" / "stage-600-003-build"
RAW_PATH = REPO / "artifacts" / "research" / "20260813-stage600-003-truth" / "raw-truth.json"
PRODUCT = REPO / "public" / "stages" / "official" / "battle-600-00-01-003"
SHARD = REPO / "public" / "stages" / "catalog" / "battle-600-00-01-003.json"
PUBLIC_PREFIX = "./stages/official/battle-600-00-01-003/"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    # Keep generated metadata byte-stable across Windows/Linux and compatible
    # with the repository whitespace gate.
    with temp.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    os.replace(temp, path)


def hardlink_exact(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if destination.stat().st_size != source.stat().st_size or sha256(destination) != sha256(source):
            raise RuntimeError(f"existing destination differs: {destination}")
        return
    os.link(source, destination)
    if not os.path.samefile(source, destination):
        raise RuntimeError(f"hard-link identity failed: {destination}")


raw = load(RAW_PATH)
export_result = load(EVIDENCE / "export-result.json")
textures = load(EVIDENCE / "texture-companion.json")
inventory = load(EVIDENCE / "fbx-runtime-inventory.json")
mapping = load(EVIDENCE / "uv1-lightmap-mapping.json")
verification = load(EVIDENCE / "verification.json")
if verification["summary"]["failed"] != 0:
    raise RuntimeError("export evidence verification is not green")
if raw["closure"]["fileCount"] != 14 or raw["closure"]["totalBytes"] != 17_769_135:
    raise RuntimeError("source closure no longer matches the audited 14-file fixture")
if raw["closure"]["inputs"][0]["sha256"] != "827d8fe45f0b345a544de09982a0737146832021c080ed48deb9c618472db5e4":
    raise RuntimeError("source root bundle hash drifted")
if not mapping["strictlyClosed"] or mapping["mappedRendererCount"] != 128:
    raise RuntimeError("UV1/lightmap mapping is not strictly closed at 128/128")
if mapping["failures"] or mapping["uniqueUv1GeometryCount"] != 77:
    raise RuntimeError("UV1/lightmap mapping identity drifted")
if inventory["meshCount"] != 182 or inventory["uniqueMaterialCount"] != 7:
    raise RuntimeError("FBX carrier mesh/material identity drifted")
if inventory["animationCount"] != 5:
    raise RuntimeError("FBX carrier animation identity drifted")

PRODUCT.mkdir(parents=True, exist_ok=True)

# AssetStudio/ModelConverter's FBX and PNGs remain a consistent carrier pair.
# os.link keeps this D: worktree at zero duplicate data blocks.
fbx_source = Path(export_result["files"][0]["path"])
fbx_name = "bg_3d_600_00_01_003-animated.fbxdata"
hardlink_exact(fbx_source, PRODUCT / fbx_name)
for file_record in export_result["files"][1:]:
    source = Path(file_record["path"])
    hardlink_exact(source, PRODUCT / source.name)

# Preserve the color lightmap Texture2D that ModelConverter omitted.
for record in textures["records"]:
    if record["type"] == "Texture2D" and "file" in record:
        source = Path(record["file"]["path"])
        hardlink_exact(source, PRODUCT / source.name)

# Only equirectangular views are consumed by the current browser runtime. Raw
# faces and horizontal crosses remain in the evidence directory.
for record in textures["records"]:
    if record["type"] == "Cubemap":
        source = Path(record["equirectangular"]["path"])
        hardlink_exact(source, PRODUCT / source.name)

bindings = load(EVIDENCE / "lightmap-bindings.proposed.json")
bindings["status"] = "verified-runtime"
companion = load(EVIDENCE / "uv1-companion.proposed.json")
companion["status"] = "verified-runtime"
companion["fbxPath"] = f"public/stages/official/battle-600-00-01-003/{fbx_name}"

# Bind each raw Unity renderer path through the strict mapper's explicit
# source-to-carrier record; this preserves AssetStudio's exact FBX node names.
target_path_by_source = {
    record["sourceHierarchyPath"]: record["targetHierarchyPath"]
    for record in mapping["mappings"]
}
if len(target_path_by_source) != 128:
    raise RuntimeError("strict mapper source hierarchy paths are not unique")
for binding in bindings["renderers"]:
    target_path = target_path_by_source.get(binding["rendererHierarchyPath"])
    if target_path is None:
        raise RuntimeError(f"lightmap binding has no exact carrier target: {binding['rendererHierarchyPath']}")
    binding["rendererHierarchyPath"] = target_path
binding_paths = {record["rendererHierarchyPath"] for record in bindings["renderers"]}
uv1_paths = {record["hierarchyPath"] for record in companion["nodes"]}
if len(binding_paths) != 128 or binding_paths != uv1_paths:
    raise RuntimeError("lightmap and UV1 carrier path sets do not close at 128/128")

atomic_json(PRODUCT / "lightmap-bindings.json", bindings)
atomic_json(PRODUCT / "uv1-companion.json", companion)

provenance = {
    "schemaVersion": 1,
    "stageId": "battle-600-00-01-003",
    "sourceBundle": "battle/stage/bg_3d_600_00_01_003",
    "sourceBundleSha256": raw["closure"]["inputs"][0]["sha256"],
    "rawTruthSha256": sha256(RAW_PATH),
    "exportVerificationSha256": sha256(EVIDENCE / "verification.json"),
    "networkUsed": False,
    "sourceBundlesCopied": False,
    "publicAssetStorage": "NTFS hard links for immutable binary carriers; generated JSON for runtime bindings",
    "assetStudioBoundary": {
        "modelConverterTextureCount": 14,
        "texture2dObjectCount": 15,
        "cubemapObjectCount": 1,
        "assetStudioOmittedTexture2dCount": 1,
        "modelConverterVsUnityPyPixelDifferenceCount": 14,
        "runtimeCarrierChoice": "ModelConverter PNGs preserve the FBX carrier convention; UnityPy comparison PNGs remain evidence-only",
        "unityVersion": "2022.3.62f2",
    },
    "animationBoundary": {
        "fbxAnimationCount": 5,
        "trackCounts": {
            "bg3d600A_01_02_circleA": 1,
            "bg3d600A_01_02_circleCD": 1,
            "bg3d600A_01_02_circleE": 1,
            "bg3d600A_01_02_window": 0,
            "bg3d600A_01_02_window02": 4,
        },
        "zeroTrackClips": ["bg3d600A_01_02_window"],
    },
    "uv1Closure": {
        "rendererCount": 128,
        "mappedRendererCount": mapping["mappedRendererCount"],
        "uniqueUv1GeometryCount": mapping["uniqueUv1GeometryCount"],
        "maxUv0Error": mapping["maxUv0Error"],
        "cornerModes": mapping["cornerModes"],
        "strictlyClosed": mapping["strictlyClosed"],
    },
    "transport": {
        "fbxEncoding": "raw binary FBX 7.3",
        "publicAssetsContainRawBundles": False,
        "aggregateCatalogChanged": False,
    },
}
atomic_json(PRODUCT / "asset-provenance.json", provenance)

asset_names = {path.name for path in PRODUCT.iterdir() if path.is_file()}
expected_asset_names = {
    fbx_name,
    *(Path(record["path"]).name for record in export_result["files"][1:]),
    *(Path(record["file"]["path"]).name for record in textures["records"] if record["type"] == "Texture2D" and "file" in record),
    *(Path(record["equirectangular"]["path"]).name for record in textures["records"] if record["type"] == "Cubemap"),
    "asset-provenance.json",
    "lightmap-bindings.json",
    "uv1-companion.json",
}
if asset_names != expected_asset_names or len(asset_names) != 20:
    raise RuntimeError(
        f"isolated product surface drifted: missing={sorted(expected_asset_names - asset_names)}, "
        f"unexpected={sorted(asset_names - expected_asset_names)}"
    )


def tex_url(name: str | None) -> str | None:
    if not name:
        return None
    file_name = f"{name}.png"
    if file_name not in asset_names:
        raise RuntimeError(f"material texture is absent from product: {file_name}")
    return PUBLIC_PREFIX + file_name


materials_by_name = {item["name"]: item for item in raw["materials"]}
bindings_out = []
for name in inventory["materialNames"]:
    source = materials_by_name[name]
    shader_name = source["shader"]["resolvedName"]
    texture_by_property = {
        item["property"]: item["pointer"].get("resolvedName")
        for item in source["textures"]
        if item["pointer"].get("resolved")
    }
    floats = source["floats"]
    colors = source["colors"]
    base_name = texture_by_property.get("_BaseMap") or texture_by_property.get("_MainTex")
    entry = {
        "materialName": name,
        "materialPattern": f"^{re.escape(name)}(?:\\.\\d+)?$",
        "shading": "unlit" if ("Unlit" in shader_name or "Particles/Common" in shader_name) else "lit",
        "color": colors.get("_BaseColor", colors.get("_Color", [1, 1, 1, 1])),
        "baseMapUrl": tex_url(base_name),
        "smoothness": floats.get("_Smoothness", 0),
        "metallic": floats.get("_Metallic", 0),
        "normalScale": floats.get("_NormalStrength", floats.get("_BumpScale", 1)),
        "transparent": floats.get("_Surface", 0) == 1,
        "depthWrite": floats.get("_ZWrite", 1) != 0,
        "unlitness": floats.get("_Unlitness", 1 if "Unlit" in shader_name else 0),
        "castShadow": floats.get("_CastShadows", 1) != 0,
        "receiveShadow": floats.get("_ReceiveShadows", 1) != 0,
        "side": "double" if floats.get("_Cull", 2) == 0 else "front",
    }
    blend_name = texture_by_property.get("_BlendTex")
    if blend_name:
        entry["blendMapUrl"] = tex_url(blend_name)
        entry["vertexColorBlend"] = floats.get("_USE_VERTEX_COLOR_BLEND", 0) == 1
    bump_name = texture_by_property.get("_BumpMap")
    if bump_name:
        entry["normalMapUrl"] = tex_url(bump_name)
    metallic_map = texture_by_property.get("_MetallicGlossMap")
    if metallic_map:
        entry["smoothnessMapUrl"] = tex_url(metallic_map)
        entry["smoothnessChannel"] = "a"
        entry["metallicFromSmoothnessMap"] = True
    elif "_SMOOTHNESS_TEXTURE_ALBEDO_CHANNEL_A" in source["validKeywords"]:
        entry["smoothnessMapUrl"] = tex_url(base_name)
        entry["smoothnessChannel"] = "a"
    if floats.get("_AlphaClip", 0) == 1:
        entry["alphaTest"] = floats.get("_Alpha_Clip", floats.get("_Cutoff", 0.5))
        entry["alphaToCoverage"] = floats.get("_AlphaToMask", 0) == 1
    if entry["transparent"]:
        entry["blending"] = "additive" if floats.get("_Blend") == 2 else "normal"
    if floats.get("_UseMatCap", 0) == 1:
        entry["matCapMapUrl"] = tex_url(texture_by_property.get("_MatCapTex"))
        entry["matCapIntensity"] = floats.get("_MatCapIntensity", 1)
    if floats.get("_UseFlipbook", 0) == 1:
        entry["atlas"] = {
            "columns": 6,
            "rows": 3,
            "offset": int(floats["_FlipbookOffset"]),
            "framesPerSecond": floats["_FlipbookFrameRate"],
        }
    scroll_name = texture_by_property.get("_ScrollTexture") or texture_by_property.get("_ScrollTexutre")
    if floats.get("_USE_MULTI_UV_SCROLL", 0) == 1 and scroll_name:
        entry["multiUvScroll"] = {
            "textureUrl": tex_url(scroll_name),
            "first": {
                "tiling": colors["_1stTilling"][:2],
                "offset": colors["_1stOffset"][:2],
                "speed": colors["_1stScrollSpeed"][:2],
                "color": colors["_1stColor"],
                "opacity": floats["_1stOpacity"],
            },
            "second": {
                "tiling": colors["_2ndTilling"][:2],
                "offset": colors["_2ndOffset"][:2],
                "speed": colors["_2ndScrollSpeed"][:2],
                "color": colors["_2ndColor"],
                "opacity": floats["_2ndOpacity"],
            },
            "additiveToMultiply": floats["_Additive_to_Multiply"],
            "dropFrame": floats.get("_DropFrame_MultiScroll", 0) == 1,
        }
    bindings_out.append(entry)


def light_to_runtime(source: dict) -> dict:
    type_name = {0: "spot", 1: "directional", 2: "point", 3: "area"}[source["type"]]
    target = [
        source["worldPosition"][index] + source["worldForward"][index]
        for index in range(3)
    ]
    result = {
        "name": source["name"],
        "type": type_name,
        "anchorPath": source["hierarchyPath"],
        "position": source["worldPosition"],
        "target": target,
        "color": source["color"],
        "intensity": source["intensity"],
        "cullingMask": source["cullingMask"],
        "lightmapping": source["lightmapping"],
        "role": "character-key" if source["name"] == "MainLight" else "background",
        "castShadow": source["shadow"]["type"] != 0,
    }
    if type_name != "directional":
        result["range"] = source["range"]
    if type_name == "spot":
        result["outerAngleDegrees"] = source["spotAngle"]
        result["innerAngleDegrees"] = source["innerSpotAngle"]
    if result["castShadow"]:
        result["shadow"] = source["shadow"]
    return result


# Preserve all eight serialized lights in the isolated render profile.
runtime_lights = [light_to_runtime(item) for item in raw["lights"]]

focused = raw["monoBehaviours"]["focusedTypetrees"]
redrive = focused["ReDriveVolume"][0]


def rgba(value: dict) -> list[float]:
    return [value["r"], value["g"], value["b"], value["a"]]


def override_value(field: str):
    return redrive[field]["m_Value"]


sh = override_value("SH2")
sh_ambient = [sh[f"sh[{index:2d}]"] for index in range(27)]
fog_color = rgba(override_value("_fogColor"))
fog_range = override_value("_fogRange")
bloom = focused["Bloom"][0]
color_adjustments = focused["ColorAdjustments"][0]
vignette = focused["Vignette"][0]

runtime_urls = set()
for binding in bindings_out:
    for key in ("baseMapUrl", "normalMapUrl", "smoothnessMapUrl", "blendMapUrl", "matCapMapUrl"):
        if binding.get(key):
            runtime_urls.add(binding[key])
    if binding.get("multiUvScroll"):
        runtime_urls.add(binding["multiUvScroll"]["textureUrl"])
runtime_urls.update(
    {
        PUBLIC_PREFIX + "Lightmap-0_comp_light.png",
        PUBLIC_PREFIX + "ReflectionProbe-0-equirectangular.png",
    }
)

product_files = sorted(path for path in PRODUCT.iterdir() if path.is_file())
package_files = {path.name: sha256(path) for path in product_files}
package_total = sum(path.stat().st_size for path in product_files)

stage = {
    "id": "battle-600-00-01-003",
    "name": "[Official dynamic partial/Battle] 600-00-01-003",
    "category": "battle",
    "official": True,
    "assetBundleName": "battle/stage/bg_3d_600_00_01_003",
    "bundleProvenance": {
        "rootBundle": "battle/stage/bg_3d_600_00_01_003",
        "unityVersion": "2022.3.62f2",
        "manifest": {
            "region": "jp",
            "kind": "AssetBundleManifest binary",
            "path": raw["manifest"]["path"].replace("\\", "/"),
            "sha256": raw["manifest"]["sha256"],
        },
        "closureEvidence": {
            "path": "artifacts/research/20260813-stage600-003-truth/closure-manifest.json",
            "sha256": sha256(EVIDENCE / "closure-manifest.json"),
        },
        "directDependencies": raw["manifest"]["dependencies"],
        "dependencyClosure": raw["manifest"]["dependencies"],
        "closureSha256": sha256(EVIDENCE / "closure-manifest.json"),
        "manifestTargetId": 10992,
        "manifestHash128BytesHex": "6b9b4bcb258eb5f3af8ba028d449cb68",
        "dependencyCount": 13,
        "closureFileCount": 14,
        "closureBytes": 17_769_135,
        "sourceBundleSha256": provenance["sourceBundleSha256"],
    },
    "type": "fbx",
    "url": PUBLIC_PREFIX + fbx_name,
    "scale": 1,
    "position": [0, 0, 0],
    "rotation": [0, 0, 0],
    "spawnPoints": [
        {
            "id": "actor-0",
            "name": "Actor 0",
            "role": "actor",
            "position": [0, 0, 0],
            "rotation": [0, 0, 0],
        }
    ],
    "materialBindings": bindings_out,
    "renderProfile": {
        "id": "bg_3d_600_00_01_003",
        "source": "ReDriveVolume",
        "stageLayer": 6,
        "backgroundColor": fog_color,
        "environmentTextureUrl": PUBLIC_PREFIX + "ReflectionProbe-0-equirectangular.png",
        "environmentIntensity": override_value("_skyboxIntensity"),
        "lightmap": {
            "textureUrl": PUBLIC_PREFIX + "Lightmap-0_comp_light.png",
            "bindingsUrl": PUBLIC_PREFIX + "lightmap-bindings.json",
            "uv1CompanionUrl": PUBLIC_PREFIX + "uv1-companion.json",
            "encoding": "unity-rgbm-linear",
            "intensity": 1,
        },
        "fog": {
            "color": fog_color,
            "near": fog_range["x"],
            "far": fog_range["y"],
            "affectsCharacters": False,
        },
        "lights": runtime_lights,
        "renderer": {"toneMapping": "aces", "exposure": 1},
        "bloom": {
            "enabled": bloom["active"] == 1,
            "strength": bloom["intensity"]["m_Value"],
            "radius": bloom["scatter"]["m_Value"],
            "threshold": bloom["threshold"]["m_Value"],
        },
        "postProcessing": {
            "colorAdjustments": {
                "active": color_adjustments["active"] == 1,
                "contrast": color_adjustments["contrast"]["m_Value"],
                "saturation": color_adjustments["saturation"]["m_Value"],
                "sourceValues": {
                    "postExposure": color_adjustments["postExposure"]["m_Value"],
                },
                "overrideStates": {
                    "postExposure": color_adjustments["postExposure"]["m_OverrideState"] == 1,
                    "contrast": color_adjustments["contrast"]["m_OverrideState"] == 1,
                    "saturation": color_adjustments["saturation"]["m_OverrideState"] == 1,
                },
            },
            "vignette": {
                "active": vignette["active"] == 1,
                "color": rgba(vignette["color"]["m_Value"]),
                "center": [vignette["center"]["m_Value"]["x"], vignette["center"]["m_Value"]["y"]],
                "intensity": vignette["intensity"]["m_Value"],
                "smoothness": vignette["smoothness"]["m_Value"],
                "rounded": vignette["rounded"]["m_Value"] == 1,
            },
        },
        "reDriveVolume": {
            "skyboxIntensity": override_value("_skyboxIntensity"),
            "shAmbient": sh_ambient,
            "characterShadowTint": rgba(override_value("_globalCharacterShadowTintColor")),
            "characterLightingOverrideColor": rgba(override_value("_globalCharacterLightingOverrideColor")),
            "characterLightingOverrideRatio": override_value("_globalCharacterLightingOverrideRatio"),
            "characterAdditionalRimLightColor": rgba(override_value("_globalCharacterAdditionalRimLightColor")),
            "characterAdditionalRimLightDirection": [
                override_value("_globalCharacterAdditionalRimLightDirection")["x"],
                override_value("_globalCharacterAdditionalRimLightDirection")["y"],
            ],
            "backgroundShadowStrengthAdditive": override_value("_bgShadowStrengthAdditive"),
            "backgroundPostExposure": override_value("_bgPostExposure"),
            "backgroundContrast": override_value("_bgContrast"),
            "backgroundSaturation": override_value("_bgSaturation"),
            "paraffin": {
                "enabled": True,
                "topColor": rgba(override_value("_tintTopColor")),
                "bottomColor": rgba(override_value("_tintBottomColor")),
                "opacity": override_value("_opacity"),
                "width": override_value("_paraWidth"),
                "topBlendMode": override_value("_topBlendMode"),
                "bottomBlendMode": override_value("_bottomBlendMode"),
            },
            "overrides": {
                "skyboxMaterial": True,
                "skyboxIntensity": True,
                "reflectionProbe": True,
                "fogColor": True,
                "fogRange": True,
                "shAmbient": True,
                "characterTint": False,
                "characterShadowTint": True,
                "backgroundTint": False,
                "characterLightingOverrideColor": True,
                "characterLightingOverrideRatio": True,
                "characterLightingOverrideDirection": False,
                "characterAdditionalRimLightColor": True,
                "characterAdditionalRimLightDirection": False,
                "characterFaceAwayTint": False,
                "characterCancelPerspective": False,
                "backgroundShadowStrengthAdditive": True,
                "backgroundPostExposure": True,
                "backgroundContrast": True,
                "backgroundSaturation": False,
                "backgroundBackgroundTint": False,
                "useFixedLightDirection": True,
                "paraffin": True,
                "screenTexture": False,
                "lightScreen": False,
            },
        },
    },
    "runtime": {
        "clipNames": ["bg3d600A_01_02_circleA", "bg3d600A_01_02_circleCD", "bg3d600A_01_02_circleE", "bg3d600A_01_02_window", "bg3d600A_01_02_window02"],
        "autoplay": True,
        "loop": True,
        "timeScale": 1,
        "voiceTracks": [],
    },
    "fidelity": {
        "exact": False,
        "sourceRevision": sha256(RAW_PATH),
        "layers": {
            "source": {
                "gameObjectCount": raw["stage"]["gameObjectCount"],
                "meshCount": len(raw["meshes"]["inventory"]),
                "materialCount": len(raw["materials"]),
                "textureCount": len(raw["images"]),
                "lightCount": len(raw["lights"]),
                "reDriveVolumeCount": 1,
                "reflectionProbeCount": len(raw["reflectionProbes"]),
                "particleSystemCount": len(raw["particleSystems"]),
                "monoBehaviourCount": raw["monoBehaviours"]["count"],
                "animatorCount": len(raw["animation"]["animators"]),
                "animationClipCount": len(raw["animation"]["clips"]),
                "lightmapBindingCount": raw["lightmap"]["rendererCount"],
            },
            "carrier": {
                "nodeCount": inventory["objectCount"],
                "meshCount": inventory["meshCount"],
                "materialCount": inventory["uniqueMaterialCount"],
                "textureCount": export_result["modelConverter"]["textures"],
                "lightCount": 0,
                "reDriveVolumeCount": 0,
                "reflectionProbeCount": 0,
                "particleSystemCount": 0,
                "monoBehaviourCount": 0,
                "animatorCount": 0,
                "animationClipCount": inventory["animationCount"],
                "lightmapBindingCount": 0,
            },
            "runtime": {
                "nodeCount": inventory["objectCount"],
                "meshCount": inventory["meshCount"],
                "materialCount": len(bindings_out),
                "textureCount": len(runtime_urls),
                "lightCount": len(runtime_lights),
                "reDriveVolumeCount": 1,
                "reflectionProbeCount": 1,
                "particleSystemCount": 0,
                "monoBehaviourCount": 5,
                "animatorCount": 1,
                "animationClipCount": 5,
                "lightmapBindingCount": mapping["mappedRendererCount"],
            },
        },
        "omissions": [
            "bg3d600A_01_02_window is present in the FBX but has zero exported tracks; its exact property animation remains raw evidence.",
            "The browser runtime plays all five exported clips concurrently, but does not reproduce the official AnimatorController state machines, transitions, masks, or layer weights.",
            "The mesh-sky scroll/noise composition and compiled Creative/Bg shader operators remain evidence-only.",
            "The equirectangular environment is derived from the Cubemap base faces; original seven-mip convolution is not reproduced.",
            "All 14 AssetStudio/ModelConverter PNGs differ at pixel level from UnityPy decodes; the matched FBX carrier convention is used and both remain auditable.",
            "Eight serialized lights and URP/ReDrive volume values are translated declaratively; operator-level and visual parity remain partial.",
        ],
    },
    "dynamic": {
        "expected": True,
        "status": "partial",
        "clipNames": ["bg3d600A_01_02_circleA", "bg3d600A_01_02_circleCD", "bg3d600A_01_02_circleE", "bg3d600A_01_02_window", "bg3d600A_01_02_window02"],
        "missing": [
            "bg3d600A_01_02_window zero-track property animation",
            "exact five-layer AnimatorController states, transitions, masks, and weights",
            "mesh-sky scroll and noise composition",
            "original Cubemap mip convolution",
            "compiled Creative/Bg and Unity URP/ReDrive operator parity",
            "browser visual acceptance, aggregate registration, and deployment",
        ],
        "evidence": [
            "Five FBX clips are present with track counts 1, 1, 1, 0, and 4.",
            "Anthony A/B use the existing isolated material atlas operator at 6x3, 8 fps, with source offsets 0 and 3.",
            "Strict UV1 mapping closes 128/128 lightmapped renderers with max UV0 error 0 and 77 deduplicated runtime geometries.",
            "Eight serialized materials resolve to seven FBX mesh materials plus one source-only Skybox material; ground keeps BaseMap groundB and BlendTex groundA.",
            "All eight serialized lights are retained in the isolated render profile.",
        ],
    },
    "evidence": [
        "JP AssetBundleManifest target 10992 and exact 14-file dependency closure; no network acquisition.",
        "Unity 2022.3.62f2 fallback plus exact raw PPtr closure for eight materials, 16 images, 142 meshes, 182 renderers, and eight lights.",
        "AssetStudio.ModelConverter FBX reopens with Three r182 as 279 objects, 182 meshes, seven materials, and five clips.",
        "UnityPy retains the omitted color lightmap and derives the directly referenced Cubemap equirectangular environment without box projection.",
        "PrefabLightmapData, ReDriveVolume, Bloom, Tonemapping, ColorAdjustments, Vignette, and five clip layers are mapped without common Viewer or aggregate catalog edits.",
    ],
    "packageEvidence": {
        "sourceFbxSha256": sha256(PRODUCT / fbx_name),
        "rawTruthSha256": sha256(RAW_PATH),
        "exportVerificationSha256": sha256(EVIDENCE / "verification.json"),
        "uv1MappingSha256": sha256(EVIDENCE / "uv1-lightmap-mapping.json"),
        "runtimeUv1CompanionSha256": sha256(PRODUCT / "uv1-companion.json"),
        "runtimeLightmapBindingsSha256": sha256(PRODUCT / "lightmap-bindings.json"),
        "assetProvenanceSha256": sha256(PRODUCT / "asset-provenance.json"),
        "fileCount": len(product_files),
        "totalBytes": package_total,
        "files": package_files,
    },
    "restorationStatus": {
        "phase": "verified-isolated-product",
        "generatedAt": "2026-08-16",
        "commonLoaderChanges": False,
        "aggregateCatalogChanged": False,
        "gameDirectoryTouched": False,
    },
    "transport": {
        "scope": "local isolated product; aggregate catalog remains unchanged",
        "fbx": {
            "path": fbx_name,
            "encoding": "raw binary FBX 7.3",
            "sourceBytes": (PRODUCT / fbx_name).stat().st_size,
            "encodedBytes": (PRODUCT / fbx_name).stat().st_size,
            "decodedByteExact": True,
        },
        "textures": {
            "encoding": "PNG",
            "losslessFileTransport": True,
        },
    },
}
atomic_json(SHARD, stage)

result = {
    "stageId": stage["id"],
    "productDirectory": str(PRODUCT),
    "catalogShard": str(SHARD),
    "productFileCount": len(product_files),
    "productBytes": package_total,
    "materialBindings": len(bindings_out),
    "runtimeTextureUrls": len(runtime_urls),
    "runtimeLights": len(runtime_lights),
    "mappedLightmapRenderers": mapping["mappedRendererCount"],
    "hardlinkBinaryAssets": sum(path.is_file() and path.name not in {"lightmap-bindings.json", "uv1-companion.json", "asset-provenance.json"} for path in product_files),
    "duplicatedBinaryBytes": 0,
}
atomic_json(EVIDENCE / "product-generation.json", result)
print(json.dumps(result, ensure_ascii=False))
