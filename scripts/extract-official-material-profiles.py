from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import UnityPy
from UnityPy import config as unitypy_config


SOFT_METALLIC_PATH_ID = 835141015512989441
COMMON_ANGEL_RING_PATH_ID = 2265012383630109063


def color3(value: Any) -> list[float]:
    return [float(value.r), float(value.g), float(value.b)]


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
    return {
        "source": "official-export",
        # CameraDepthTexture draws the opaque render-queue range. Preserve
        # Unity's serialized override instead of guessing it from a material
        # name or from the Gem feature toggle.
        "customRenderQueue": int(material.m_CustomRenderQueue),
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
            "highlightThreshold": number("_HighlightThreshold", 0.5),
            "highlightRotation": number("_HighlightRotation", 0.0),
            "cheekValue": number("_CheekValue", 1.0),
            "cheekColor": rgb("_CheekColor", (1.0, 0.7, 0.7)),
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
            "rimLightColor": rgb("_RimLightColor", (1.0, 1.0, 1.0)),
        },
        "shadow": {
            "offset": number("_ShadowOffset", 0.3),
            "feather": number("_ShadowFeather", 0.0),
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
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--unity-version", default="2022.3.62f2")
    args = parser.parse_args()
    if args.unity_version != "2022.3.62f2":
        raise RuntimeError("JP material extraction requires Unity 2022.3.62f2")
    unitypy_config.FALLBACK_UNITY_VERSION = args.unity_version

    profiles: dict[str, dict[str, Any]] = {}
    sources: dict[str, list[str]] = {}
    conflicts: list[dict[str, Any]] = []
    bundles = sorted(args.asset_root.glob("chara_*_battle_unit"))
    for bundle in bundles:
        environment = UnityPy.load(str(bundle))
        for obj in environment.objects:
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

    if conflicts:
        raise RuntimeError(f"Conflicting material names: {conflicts[:10]}")

    output = {
        "schema": 1,
        "unityVersion": args.unity_version,
        "bundleCount": len(bundles),
        "materialCount": len(profiles),
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
        "bytes": args.output.stat().st_size,
        "output": str(args.output.resolve()),
    }))


if __name__ == "__main__":
    main()
