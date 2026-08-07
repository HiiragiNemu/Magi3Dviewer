#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise RuntimeError(f'patch anchor missing in {path}: {old[:160]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8', newline='\n')


def patch_profiles() -> None:
    path = ROOT / 'magia-exedra-character-three/materialProfile.ts'
    replace_once(
        path,
        "export interface OfficialGemProfile {\n",
        "export interface OfficialAnisotropyProfile {\n"
        "    /** Serialized `_IsAniso`. */\n"
        "    enabled: boolean;\n"
        "    /** Serialized `_AnisoMaskByMetallic`. */\n"
        "    maskByMetallic: boolean;\n"
        "    /** Serialized `_AnisoColor` RGB. */\n"
        "    color: readonly [number, number, number];\n"
        "    /** Serialized `_AnisoThreshold`. */\n"
        "    threshold: number;\n"
        "    /** Serialized `_AnisoFeather`. */\n"
        "    feather: number;\n"
        "}\n\n"
        "export interface OfficialFresnelProfile {\n"
        "    /** Serialized `_UseFresnel`; Timeline may override this per renderer later. */\n"
        "    enabled: boolean;\n"
        "    /** Serialized `_FresnelMaskByMetallic`. */\n"
        "    maskByMetallic: boolean;\n"
        "    /** Serialized `_FresnelColor` RGB. */\n"
        "    color: readonly [number, number, number];\n"
        "    threshold: number;\n"
        "    feather: number;\n"
        "}\n\n"
        "export interface OfficialGemProfile {\n",
    )
    replace_once(
        path,
        "    anisotropy: boolean;\n    outlineOffset: boolean;",
        "    /** Legacy aggregate flag retained for existing feature-variant selection. */\n"
        "    anisotropy: boolean;\n"
        "    anisotropyProfile: OfficialAnisotropyProfile;\n"
        "    fresnel: OfficialFresnelProfile;\n"
        "    outlineOffset: boolean;",
    )
    replace_once(
        path,
        "const GEM_DISABLED: OfficialGemProfile = {",
        "const ANISO_DISABLED: OfficialAnisotropyProfile = {\n"
        "    enabled: false,\n"
        "    maskByMetallic: false,\n"
        "    color: [1, 1, 1],\n"
        "    threshold: 0.9,\n"
        "    feather: 0,\n"
        "};\n\n"
        "const GENERIC_ANISO: OfficialAnisotropyProfile = {\n"
        "    enabled: true,\n"
        "    maskByMetallic: false,\n"
        "    color: [1, 1, 1],\n"
        "    threshold: 0.9,\n"
        "    feather: 0,\n"
        "};\n\n"
        "const FRESNEL_DISABLED: OfficialFresnelProfile = {\n"
        "    enabled: false,\n"
        "    maskByMetallic: false,\n"
        "    color: [1, 1, 1],\n"
        "    threshold: 0.5,\n"
        "    feather: 0.25,\n"
        "};\n\n"
        "const GEM_DISABLED: OfficialGemProfile = {",
    )
    # Add exact current-JP profiles to the existing official map.
    replace_once(
        path,
        "const OFFICIAL_MATERIALS = new Map<string, Partial<OfficialMaterialProfile>>([\n    ['mt_chara_100101_body_sj', {",
        "const OFFICIAL_MATERIALS = new Map<string, Partial<OfficialMaterialProfile>>([\n"
        "    ['mt_chara_100101_body_aniso', {\n"
        "        source: 'official-export',\n"
        "        anisotropy: true,\n"
        "        anisotropyProfile: {\n"
        "            enabled: true,\n"
        "            maskByMetallic: false,\n"
        "            color: [\n"
        "                0.7519999742507935,\n"
        "                0.2753385901451111,\n"
        "                0.4024481475353241,\n"
        "            ],\n"
        "            threshold: 0.9139999747276306,\n"
        "            feather: 0,\n"
        "        },\n"
        "    }],\n"
        "    ['mt_chara_100101_body_sj', {",
    )
    replace_once(
        path,
        "    ['mt_chara_100101_weapon_a_sj', {\n        source: 'official-export',\n        gem: {",
        "    ['mt_chara_100101_weapon_a_sj', {\n"
        "        source: 'official-export',\n"
        "        fresnel: {\n"
        "            enabled: true,\n"
        "            maskByMetallic: true,\n"
        "            color: [\n"
        "                1,\n"
        "                0.5047169923782349,\n"
        "                0.9053794741630554,\n"
        "            ],\n"
        "            threshold: 0.6000000238418579,\n"
        "            feather: 0.20000000298023224,\n"
        "        },\n"
        "        gem: {",
    )
    replace_once(
        path,
        "        anisotropy: normalized.includes('aniso'),\n        outlineOffset:",
        "        anisotropy: normalized.includes('aniso'),\n"
        "        anisotropyProfile: {\n"
        "            ...(normalized.includes('aniso') ? GENERIC_ANISO : ANISO_DISABLED),\n"
        "        },\n"
        "        fresnel: { ...FRESNEL_DISABLED },\n"
        "        outlineOffset:",
    )
    replace_once(
        path,
        "        gem: official.gem ? copyGem(official.gem as OfficialGemProfile) : base.gem,\n        angelRing:",
        "        anisotropyProfile: official.anisotropyProfile\n"
        "            ? { ...official.anisotropyProfile }\n"
        "            : { ...base.anisotropyProfile },\n"
        "        fresnel: official.fresnel\n"
        "            ? { ...official.fresnel }\n"
        "            : { ...base.fresnel },\n"
        "        gem: official.gem ? copyGem(official.gem as OfficialGemProfile) : base.gem,\n"
        "        angelRing:",
    )


def patch_material_uniforms() -> None:
    path = ROOT / 'magia-exedra-character-three/shaders/gem.ts'
    replace_once(
        path,
        "    const set = (key: string, uniformValue: number) => {\n        shader.uniforms[key] ??= { value: uniformValue };\n        shader.uniforms[key].value = uniformValue;\n    };",
        "    const set = (key: string, uniformValue: number) => {\n"
        "        shader.uniforms[key] ??= { value: uniformValue };\n"
        "        shader.uniforms[key].value = uniformValue;\n"
        "    };\n"
        "    const setColor = (\n"
        "        key: string,\n"
        "        rgb: readonly [number, number, number],\n"
        "    ) => {\n"
        "        const current = shader.uniforms[key]?.value;\n"
        "        if (current instanceof THREE.Color) current.setRGB(...rgb);\n"
        "        else shader.uniforms[key] = { value: new THREE.Color(...rgb) };\n"
        "    };",
    )
    replace_once(
        path,
        "    set('uMaterialAnisotropy', value.anisotropy ? 1 : 0);\n    set('uMaterialOutlineOffset',",
        "    const aniso = value.anisotropyProfile;\n"
        "    const fresnel = value.fresnel;\n"
        "    set('uMaterialAnisotropy', aniso.enabled ? 1 : 0);\n"
        "    set('uMaterialAnisoMaskByMetallic', aniso.maskByMetallic ? 1 : 0);\n"
        "    setColor('uMaterialAnisoColor', aniso.color);\n"
        "    set('uMaterialAnisoThreshold', aniso.threshold);\n"
        "    set('uMaterialAnisoFeather', aniso.feather);\n"
        "    // Material defaults are authoritative. FresnelAnimationAttributeReceiver\n"
        "    // will eventually overwrite the same per-renderer uniforms from Timeline.\n"
        "    set('uFresnelEnabled', fresnel.enabled ? 1 : 0);\n"
        "    setColor('uFresnelColor', fresnel.color);\n"
        "    set('uFresnelStrength', fresnel.enabled ? 1 : 0);\n"
        "    set('uFresnelThreshold', fresnel.threshold);\n"
        "    set('uFresnelFeather', fresnel.feather);\n"
        "    set('uFresnelMaskByMetallic', fresnel.maskByMetallic ? 1 : 0);\n"
        "    set('uMaterialOutlineOffset',",
    )


def patch_fresnel_mask() -> None:
    path = ROOT / 'magia-exedra-character-three/shaders/stylization.ts'
    replace_once(
        path,
        "        this.setValue('uFresnelFeather', options.fresnelFeather);\n",
        "        this.setValue('uFresnelFeather', options.fresnelFeather);\n"
        "        this.setValue('uFresnelMaskByMetallic', 0);\n",
    )
    replace_once(
        path,
        "        uniform float uFresnelFeather;\n",
        "        uniform float uFresnelFeather;\n"
        "        uniform float uFresnelMaskByMetallic;\n",
    )
    replace_once(
        path,
        "        float rdToonFresnelMask = smoothstep(\n            rdToonFresnelStart,\n            rdToonFresnelEnd,\n            rdToonEdge\n        );\n        outgoingLight +=",
        "        float rdToonFresnelMask = smoothstep(\n"
        "            rdToonFresnelStart,\n"
        "            rdToonFresnelEnd,\n"
        "            rdToonEdge\n"
        "        );\n"
        "        rdToonFresnelMask *= mix(\n"
        "            1.0,\n"
        "            rdToonMetallicMask,\n"
        "            saturate(uFresnelMaskByMetallic)\n"
        "        );\n"
        "        outgoingLight +=",
    )


def patch_aniso_runtime() -> None:
    path = ROOT / 'magia-exedra-character-three/shaders/general.ts'
    replace_once(
        path,
        "        shader.uniforms.uMaterialAnisotropy = { value: anisotropy ? 1 : 0 }\n        shader.uniforms.uMaterialSpecialJewel",
        "        shader.uniforms.uMaterialAnisotropy = { value: anisotropy ? 1 : 0 }\n"
        "        shader.uniforms.uMaterialAnisoMaskByMetallic = { value: 0 }\n"
        "        shader.uniforms.uMaterialAnisoColor = { value: new THREE.Color(1, 1, 1) }\n"
        "        shader.uniforms.uMaterialAnisoThreshold = { value: 0.9 }\n"
        "        shader.uniforms.uMaterialAnisoFeather = { value: 0 }\n"
        "        shader.uniforms.uMaterialSpecialJewel",
    )
    replace_once(
        path,
        "            uniform float uMaterialAnisotropy;\n            uniform float uMaterialSpecialJewel;",
        "            uniform float uMaterialAnisotropy;\n"
        "            uniform float uMaterialAnisoMaskByMetallic;\n"
        "            uniform vec3 uMaterialAnisoColor;\n"
        "            uniform float uMaterialAnisoThreshold;\n"
        "            uniform float uMaterialAnisoFeather;\n"
        "            uniform float uMaterialSpecialJewel;",
    )
    replace_once(
        path,
        "                float rdSpecularCoordinate = mix(\n                    rdNdotH,\n                    rdAnisoNdotH,\n                    saturate(uMaterialAnisotropy)\n                );\n\n                float rdSpecularGradient",
        "                float rdSpecularCoordinate = mix(\n"
        "                    rdNdotH,\n"
        "                    rdAnisoNdotH,\n"
        "                    saturate(uMaterialAnisotropy)\n"
        "                );\n"
        "                float rdAnisoStart = clamp(\n"
        "                    uMaterialAnisoThreshold - uMaterialAnisoFeather,\n"
        "                    0.0, 1.0\n"
        "                );\n"
        "                float rdAnisoEnd = max(\n"
        "                    rdAnisoStart + 0.00001,\n"
        "                    clamp(\n"
        "                        uMaterialAnisoThreshold + uMaterialAnisoFeather,\n"
        "                        0.0, 1.0\n"
        "                    )\n"
        "                );\n"
        "                float rdAnisoBand = uMaterialAnisoFeather > 0.00001\n"
        "                    ? smoothstep(rdAnisoStart, rdAnisoEnd, rdAnisoNdotH)\n"
        "                    : step(uMaterialAnisoThreshold, rdAnisoNdotH);\n"
        "                rdAnisoBand *= mix(\n"
        "                    1.0,\n"
        "                    rdToonMetallicMask,\n"
        "                    saturate(uMaterialAnisoMaskByMetallic)\n"
        "                );\n\n"
        "                float rdSpecularGradient",
    )
    replace_once(
        path,
        "                vec3 rdSpecularColor = mix(\n                    vec3(1.0),\n                    max(diffuseColor.rgb, vec3(0.04)),\n                    saturate(rdToonMetallicMask * uMetallicResponse)\n                );\n                outgoingLight += rdSpecularColor * rdSpecular;",
        "                vec3 rdSpecularColor = mix(\n"
        "                    vec3(1.0),\n"
        "                    max(diffuseColor.rgb, vec3(0.04)),\n"
        "                    saturate(rdToonMetallicMask * uMetallicResponse)\n"
        "                );\n"
        "                // Exact current-JP per-material Aniso colour/threshold are\n"
        "                // recovered. The directional coordinate remains the current\n"
        "                // Web approximation until the compiled ReDrive subprogram is\n"
        "                // decoded; keep that uncertainty local to this one term.\n"
        "                float rdAnisoInfluence =\n"
        "                    saturate(uMaterialAnisotropy) * rdAnisoBand;\n"
        "                rdSpecularColor = mix(\n"
        "                    rdSpecularColor,\n"
        "                    uMaterialAnisoColor,\n"
        "                    rdAnisoInfluence\n"
        "                );\n"
        "                rdSpecular *= mix(1.0, 1.22, rdAnisoInfluence);\n"
        "                outgoingLight += rdSpecularColor * rdSpecular;",
    )


def patch_tests() -> None:
    package = ROOT / 'package.json'
    replace_once(
        package,
        '"test:release": "node --test ',
        '"test:release": "node --test officialMaterialFresnelAniso.test.mjs ',
    )


if __name__ == '__main__':
    patch_profiles()
    patch_material_uniforms()
    patch_fresnel_mask()
    patch_aniso_runtime()
    patch_tests()
    print('Applied exact current-JP per-material Fresnel / Aniso parameters')
