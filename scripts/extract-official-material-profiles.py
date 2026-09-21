from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import UnityPy
from UnityPy import config as unitypy_config


SOFT_METALLIC_PATH_ID = 835141015512989441
COMMON_ANGEL_RING_PATH_ID = 2265012383630109063
CLOUD_NOISE_PATH_ID = 6159205007759442036
SURFACE_TEXTURE_SLOTS = (
    "_BaseMap",
    "_ShadowTex",
    "_ControlMap",
    "_FaceAdditionalMap",
    "_AngelRingMap",
    "_CosmicTex",
    "_CosmicNoiseTex",
)


def color3(value: Any) -> list[float]:
    return [float(value.r), float(value.g), float(value.b)]


def color4(value: Any) -> list[float]:
    return [float(value.r), float(value.g), float(value.b), float(value.a)]


def texture_sampler_profile(texture: Any) -> dict[str, Any]:
    settings = texture.m_TextureSettings
    return {
        "name": str(texture.m_Name).strip().lower(),
        "width": int(texture.m_Width),
        "height": int(texture.m_Height),
        "textureFormat": int(texture.m_TextureFormat),
        "mipCount": int(texture.m_MipCount),
        "colorSpace": int(texture.m_ColorSpace),
        "filterMode": int(settings.m_FilterMode),
        "aniso": int(settings.m_Aniso),
        "mipBias": float(settings.m_MipBias),
        "wrapU": int(settings.m_WrapU),
        "wrapV": int(settings.m_WrapV),
        "wrapW": int(settings.m_WrapW),
    }


def tex_env_pair(value: Any) -> list[float]:
    return [float(value.x), float(value.y)]


def material_profile(material: Any) -> dict[str, Any]:
    floats = dict(material.m_SavedProperties.m_Floats)
    colors = dict(material.m_SavedProperties.m_Colors)
    textures = dict(material.m_SavedProperties.m_TexEnvs)

    def number(name: str, default: float) -> float:
        return float(floats.get(name, default))

    def flag(name: str, default: bool = False) -> bool:
        return number(name, 1.0 if default else 0.0) != 0.0

    def rgb(name: str, default: tuple[float, float, float]) -> list[float]:
        value = colors.get(name)
        return color3(value) if value is not None else list(default)

    def texture_name(name: str) -> str | None:
        tex_env = textures.get(name)
        if tex_env is None or int(tex_env.m_Texture.m_PathID) == 0:
            return None
        if (
            name == "_CosmicNoiseTex"
            and int(tex_env.m_Texture.m_PathID) == CLOUD_NOISE_PATH_ID
        ):
            return "cloud_noise_tex"
        try:
            return str(tex_env.m_Texture.read().m_Name)
        except Exception:
            return None

    matcap = textures.get("_MatCapTex")
    matcap_path_id = int(matcap.m_Texture.m_PathID) if matcap else 0
    matcap_texture: str | None = None
    if matcap_path_id == SOFT_METALLIC_PATH_ID:
        matcap_texture = "matcap_SoftMetallic"
    elif matcap_path_id:
        try:
            matcap_texture = str(matcap.m_Texture.read().m_Name)
        except Exception:
            # Preserve the source class below even when the dependency is
            # external to the bounded character bundle. Known shared textures
            # are identified by their exact PPtr above.
            matcap_texture = None
    matcap_source = (
        "soft-metallic"
        if matcap_path_id == SOFT_METALLIC_PATH_ID
        else "character-or-fallback"
        if matcap_path_id
        else "default-linear-grey"
    )

    is_gem = flag("_IsGem")
    use_matcap = flag("_UseMatCap")
    is_hair = flag("_IsHair")
    angel_ring = textures.get("_AngelRingMap")
    angel_ring_path_id = (
        int(angel_ring.m_Texture.m_PathID) if angel_ring else 0
    )
    angel_ring_map = (
        "none"
        if not is_hair or not angel_ring_path_id
        else "common"
        if angel_ring_path_id == COMMON_ANGEL_RING_PATH_ID
        else "character"
    )
    angel_ring_texture: str | None = None
    if angel_ring_map == "common":
        angel_ring_texture = "RDToon_AngelRingMap"
    elif angel_ring_map == "character":
        try:
            angel_ring_texture = str(angel_ring.m_Texture.read().m_Name)
        except Exception:
            # The material still remains fail-closed as a character map. The
            # runtime requires a resolved serialized Texture2D identity before
            # it will bind a character-authored AngelRing texture.
            angel_ring_texture = None
    cosmic_base_scroll = colors.get("_CosBaseMapScroll")
    cosmic_scroll = colors.get("_CosmicScroll")
    cosmic_shadow_tint = colors.get("_CosmicShadowTintColor")
    profile = {
        "source": "official-export",
        # CameraDepthTexture draws the opaque render-queue range. Preserve
        # Unity's serialized override instead of guessing it from a material
        # name or from the Gem feature toggle.
        "customRenderQueue": int(material.m_CustomRenderQueue),
        "surface": {
            # These four serialized fields own the actual forward-pass render
            # state. A mesh-level alpha texture or another slot's name must
            # never make every draw group transparent.
            "transparency": flag("_Transparency"),
            "zWrite": flag("_ZWrite", True),
            "srcBlend": int(number("_SrcBlend", 1.0)),
            "dstBlend": int(number("_DstBlend", 0.0)),
        },
        "isAlphaAdditive": flag("_IsAlphaAdditive"),
        "anisotropy": flag("_IsAniso"),
        "anisotropyProfile": {
            "enabled": flag("_IsAniso"),
            "maskByMetallic": flag("_AnisoMaskByMetallic"),
            "color": rgb("_AnisoColor", (1.0, 1.0, 1.0)),
            "threshold": number("_AnisoThreshold", 0.9),
            "feather": number("_AnisoFeather", 0.0),
        },
        "fresnel": {
            "enabled": flag("_UseFresnel"),
            "maskByMetallic": flag("_FresnelMaskByMetallic"),
            "color": rgb("_FresnelColor", (1.0, 1.0, 1.0)),
            "threshold": number("_FresnelThreshold", 0.5),
            "feather": number("_FresnelFeather", 0.25),
        },
        "outlineOffset": flag("_OutlineOffset"),
        "skinOutlineOffset": flag("_OutlineOffsetSkin"),
        "outlineWidth": number("_OutlineWidth", 5.0),
        "outline": {
            "enabled": flag("_UseOutline", True),
            "color": rgb("_OutlineColor", (0.0, 0.0, 0.0)),
            "emissionColor": rgb(
                "_OutlineEmissionColor", (0.0, 0.0, 0.0)
            ),
            "texBlend": number("_OutlineTexBlend", 0.2),
            "zOffset": number("_OutlineZOffset", 0.0),
            "faceOutlineAdjust": number("_FaceOutlineAdjust", 0.0),
        },
        "face": {
            "isFace": flag("_IsFace"),
            "isEye": flag("_IsEye"),
            "useGradientMap": flag("_UseFaceGradientMap"),
            "shouldApplyAdditional": flag("_ShouldApplyFaceAdditional"),
            "additionalTexture": texture_name("_FaceAdditionalMap"),
            "cameraDepthTextureZWriteOffset": number(
                "_FaceAreaCameraDepthTextureZWriteOffset", 0.05
            ),
            "highlightThreshold": number("_HighlightThreshold", 0.5),
            "highlightRotation": number("_HighlightRotation", 0.0),
            "cheekValue": number("_CheekValue", 1.0),
            "cheekColor": rgb("_CheekColor", (1.0, 0.7, 0.7)),
        },
        "stencil": {
            "mode": number("_StencilMode", 0.0),
            "comparison": number("_StencilComp", 0.0),
            "reference": number("_StencilNum", 0.0),
            "passOperation": number("_StencilPassOp", 0.0),
            "transparency": number("_StencilTransparency", 0.75),
        },
        "matCap": {
            "enabled": use_matcap,
            "source": matcap_source,
            "texture": matcap_texture,
            "intensity": number("_MatCapIntensity", 1.0),
            "maskByMetallic": flag("_MaskMatcapMetallic"),
            "maskBySpecular": flag("_MaskMatcapSpecular"),
        },
        "gem": {
            "enabled": is_gem,
            "useMatCap": use_matcap,
            "matCapSource": matcap_source,
            "matCapIntensity": number("_MatCapIntensity", 0.0),
            "maskMatcapMetallic": flag("_MaskMatcapMetallic"),
            "maskMatcapSpecular": flag("_MaskMatcapSpecular"),
            "useDepthDiff": flag("_UseGemDepthDiff"),
            "transparency": flag("_Transparency"),
            "firstHighlightSize": number("_Gem1stHighlightSize", 0.0),
            "firstShadowSize": number("_Gem1stShadSize", 0.0),
            "secondHighlightSize": number("_Gem2ndHighlightSize", 0.0),
            "secondShadowSize": number("_Gem2ndShadSize", 0.0),
            "depthDiffThreshold": number("_GemDepthDiffThreshold", 0.5),
            "heightCorrection": number("_GemHeightCorrection", 0.0),
            "rimFresnel": number("_GemRimFresnel", 0.5),
            "fresnelThreshold": number("_GemFresnelThreshold", 0.5),
            "fresnelFeather": number("_GemFresnelFeather", 0.25),
            "fresnelMaskByMetallic": flag("_GemFresnelMaskByMetallic"),
        },
        "angelRing": {
            "isHair": is_hair,
            "enabled": is_hair and angel_ring_path_id != 0,
            "uvMode": is_hair and flag("_YuugenHighlight"),
            "map": angel_ring_map,
            "texture": angel_ring_texture,
            "rimLightColor": rgb("_RimLightColor", (1.0, 1.0, 1.0)),
        },
        "shadow": {
            "offset": number("_ShadowOffset", 0.3),
            "feather": number("_ShadowFeather", 0.0),
            "offsetMapOffset": number("_ShadowOffsetMapOffset", 0.0),
            "castSelfShadow": flag("_CastSelfShadow", True),
            "receiveSelfShadow": flag("_ReceiveSelfShadow", True),
        },
        "depthRim": {
            "useDepthTex": flag("_UseDepthTex", True),
            "useRimLight": flag("_UseRimLight", True),
            "ditherFade": number("_DitherFade", 0.0),
            "width": number("_DepthTexWidth", 1.0),
            "yOffset": number("_DepthTexYOffset", 0.0),
            "rimDiffThreshold": number(
                "_DepthRimLightDiffThreshold", 0.02
            ),
            "shadowDiffThreshold": number(
                "_DepthShadowDiffThreshold", 0.03
            ),
        },
        "additionalLightInfluenceByLuminance": number(
            "_AdditionalLightInfluenceByLuminance", 0.0
        ),
        "emissionColor": rgb("_EmissionColor", (0.0, 0.0, 0.0)),
        "cosmic": {
            "enabled": flag("_IsCosmic"),
            "alphaClipping": flag("_AlphaClipping"),
            "baseColor": (
                color4(colors.get("_BaseColor"))
                if colors.get("_BaseColor")
                else [1.0, 1.0, 1.0, 1.0]
            ),
            "isScreenBaseMap": flag("_IsScreenBaseMap"),
            "baseTexture": texture_name("_BaseMap"),
            "shadowTexture": texture_name("_ShadowTex"),
            "controlTexture": texture_name("_ControlMap"),
            "baseMapTiling": number("_CosBaseMapTilling", 1.0),
            "baseMapScroll": (
                [float(cosmic_base_scroll.r), float(cosmic_base_scroll.g)]
                if cosmic_base_scroll
                else [0.0, 0.0]
            ),
            "texture": texture_name("_CosmicTex"),
            "noiseTexture": texture_name("_CosmicNoiseTex"),
            "tiling": number("_CosmicTilling", 1.0),
            "scroll": (
                [float(cosmic_scroll.r), float(cosmic_scroll.g)]
                if cosmic_scroll
                else [0.0, 0.0]
            ),
            "maskByControlAlpha": flag("_CosmicMaskByCtrlA"),
            "noiseInfluence": number("_CosmicNoiseInfluence", 1.0),
            "noiseTiling": number("_CosmicNoiseTilling", 1.0),
            "noiseSpeed": number("_CosmicNoiseSpeed", 1.0),
            "getShadowTexture": flag("_CosmicGetShadowTex"),
            "getShadowTint": flag("_CosmicGetShadowTint"),
            "applyAmbientLighting": flag("_CosmicApplyAmbientLighting"),
            "overlay": flag("_IsCosmicOverlay"),
            "shadowTintColor": (
                color3(cosmic_shadow_tint)
                if cosmic_shadow_tint
                else [1.0, 1.0, 1.0]
            ),
        },
    }

    try:
        shader = material.m_Shader.read()
    except Exception:
        shader = None
    shader_name = (
        str(getattr(getattr(shader, "m_ParsedForm", None), "m_Name", ""))
        or str(getattr(shader, "m_Name", ""))
    )
    if shader_name and shader_name != "Creative/Character/ReDriveToon":
        base_color = colors.get("_Color") or colors.get("_BaseColor")
        emission_color = colors.get("_EmissionColor")
        fill_color = colors.get("_FillColor")
        cosmic_scroll = colors.get("_CosmicScroll")
        profile["customShader"] = {
            "name": shader_name,
            "baseColor": color4(base_color) if base_color else [1.0, 1.0, 1.0, 1.0],
            "emissionColor": (
                color4(emission_color)
                if emission_color
                else [0.0, 0.0, 0.0, 0.0]
            ),
            "baseTexture": texture_name("_BaseMap"),
            "shadowTexture": texture_name("_ShadowTex"),
            "controlTexture": texture_name("_ControlMap"),
            "noiseTexture": texture_name("_NoiseTex"),
            "noiseTiling": number("_NoiseTilling", 1.0),
            "noiseIntensity": number("_NoiseIntensity", 0.0),
            "noiseThreshold": number("_NoiseThreshold", 0.0),
            "ditherFade": number("_DitherFade", 0.0),
            "useVertexColorG": flag("_UseVertexColor_G"),
            "vertexColorThreshold": number("_VertexColThreshold", 0.0),
            # Literal compare constants from the compiled forward and outline
            # pixel programs. They belong to this shader implementation, not
            # to any character or material-name fixture.
            "forwardCutoff": 0.4,
            "outlineCutoff": 0.7,
            "isCosmic": flag("_IsCosmic"),
            "alphaClipping": flag("_AlphaClipping"),
            "fillColor": (
                color4(fill_color)
                if fill_color
                else [0.0, 0.0, 0.0, 0.0]
            ),
            "cosmicTexture": texture_name("_CosmicTex"),
            "cosmicNoiseTexture": texture_name("_CosmicNoiseTex"),
            "cosmicTiling": number("_CosmicTilling", 1.0),
            "cosmicScroll": (
                [float(cosmic_scroll.r), float(cosmic_scroll.g)]
                if cosmic_scroll
                else [0.0, 0.0]
            ),
            "cosmicMaskByControlAlpha": flag("_CosmicMaskByCtrlA"),
            "cosmicNoiseInfluence": number("_CosmicNoiseInfluence", 1.0),
            "cosmicNoiseTiling": number("_CosmicNoiseTilling", 1.0),
            "cosmicNoiseSpeed": number("_CosmicNoiseSpeed", 1.0),
        }
        # NamaeShader serializes `_Outline`, while ReDriveToon serializes
        # `_UseOutline`. Preserve the shader's own field without name guesses.
        profile["outline"]["enabled"] = flag("_Outline", True)
    return profile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset-root", required=True, type=Path)
    parser.add_argument("--additional-bundle", action="append", default=[], type=Path)
    parser.add_argument("--dependency-bundle", action="append", default=[], type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--unity-version", default="2022.3.62f2")
    args = parser.parse_args()
    if args.unity_version != "2022.3.62f2":
        raise RuntimeError("JP material extraction requires Unity 2022.3.62f2")
    unitypy_config.FALLBACK_UNITY_VERSION = args.unity_version

    profiles: dict[str, dict[str, Any]] = {}
    sources: dict[str, list[str]] = {}
    conflicts: list[dict[str, Any]] = []
    texture_samplers: dict[str, dict[str, Any]] = {}
    texture_sampler_slots: dict[str, set[str]] = {}
    texture_sampler_sources: dict[str, list[str]] = {}
    texture_sampler_conflicts: list[dict[str, Any]] = []
    texture_sampler_bindings = 0
    texture_sampler_unresolved: list[dict[str, Any]] = []
    bundles = sorted(args.asset_root.glob("chara_*_battle_unit"))
    bundles.extend(args.additional_bundle)
    bundles = list(dict.fromkeys(path.resolve() for path in bundles))
    dependency_asset_names: set[str] = set()
    for dependency in args.dependency_bundle:
        dependency_environment = UnityPy.load(str(dependency))
        dependency_asset_names.update(
            asset.name for asset in dependency_environment.assets
        )
    for bundle in bundles:
        environment = UnityPy.load(
            str(bundle),
            *(str(path) for path in args.dependency_bundle),
        )
        for obj in environment.objects:
            if obj.assets_file.name in dependency_asset_names:
                continue
            if obj.type.name != "Material":
                continue
            material = obj.read()
            name = material.m_Name.strip().lower()
            profile = material_profile(material)
            previous = profiles.get(name)
            if previous is not None and previous != profile:
                conflicts.append({"name": name, "bundles": sources[name] + [bundle.name]})
                continue
            profiles[name] = profile
            sources.setdefault(name, []).append(bundle.name)

            texture_envs = dict(material.m_SavedProperties.m_TexEnvs)
            for slot in SURFACE_TEXTURE_SLOTS:
                tex_env = texture_envs.get(slot)
                if tex_env is None or int(tex_env.m_Texture.m_PathID) == 0:
                    continue
                texture_sampler_bindings += 1
                scale = tex_env_pair(tex_env.m_Scale)
                offset = tex_env_pair(tex_env.m_Offset)
                if scale != [1.0, 1.0] or offset != [0.0, 0.0]:
                    raise RuntimeError(
                        "Non-identity ReDrive character TexEnv requires a "
                        f"runtime ST consumer: {bundle.name} {name} {slot} "
                        f"scale={scale} offset={offset}"
                    )
                try:
                    texture = tex_env.m_Texture.read()
                except Exception:
                    texture_sampler_unresolved.append({
                        "slot": slot,
                        "pathId": int(tex_env.m_Texture.m_PathID),
                    })
                    continue
                sampler = texture_sampler_profile(texture)
                texture_name = sampler["name"]
                previous_sampler = texture_samplers.get(texture_name)
                if previous_sampler is not None and previous_sampler != sampler:
                    texture_sampler_conflicts.append({
                        "name": texture_name,
                        "bundles": texture_sampler_sources[texture_name]
                        + [bundle.name],
                    })
                    continue
                texture_samplers[texture_name] = sampler
                texture_sampler_slots.setdefault(texture_name, set()).add(slot)
                texture_sampler_sources.setdefault(texture_name, []).append(
                    bundle.name
                )

    if conflicts:
        raise RuntimeError(f"Conflicting material names: {conflicts[:10]}")
    if texture_sampler_conflicts:
        raise RuntimeError(
            "Conflicting Texture2D sampler profiles: "
            f"{texture_sampler_conflicts[:10]}"
        )

    serialized_texture_samplers = {
        name: {
            **sampler,
            "slots": sorted(texture_sampler_slots[name]),
        }
        for name, sampler in sorted(texture_samplers.items())
    }

    output = {
        "schema": 4,
        "unityVersion": args.unity_version,
        "bundleCount": len(bundles),
        "materialCount": len(profiles),
        "textureSamplerCount": len(serialized_texture_samplers),
        "textureSamplerBindings": texture_sampler_bindings,
        "textureSamplerResolvedBindings": (
            texture_sampler_bindings - len(texture_sampler_unresolved)
        ),
        "textureSamplerUnresolvedBindings": len(texture_sampler_unresolved),
        "textureSamplerConflicts": len(texture_sampler_conflicts),
        "textureSamplerTexEnv": {
            "scale": [1, 1],
            "offset": [0, 0],
        },
        "textureSamplers": serialized_texture_samplers,
        "materials": dict(sorted(profiles.items())),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Emit repository-stable LF even when the extractor runs on Windows.
    with args.output.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(
            json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n"
        )
    print(json.dumps({
        "status": "PASS",
        "bundles": len(bundles),
        "materials": len(profiles),
        "textureSamplers": len(serialized_texture_samplers),
        "textureSamplerBindings": texture_sampler_bindings,
        "textureSamplerUnresolvedBindings": len(texture_sampler_unresolved),
        "bytes": args.output.stat().st_size,
        "output": str(args.output.resolve()),
    }))


if __name__ == "__main__":
    main()
