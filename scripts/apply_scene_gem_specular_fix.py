#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise RuntimeError(f'expected patch anchor missing in {path}: {old[:120]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8', newline='\n')


def patch_stage_catalog() -> None:
    path = ROOT / 'public/stages/catalog.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    stage = next(
        item for item in data['stages']
        if item.get('id') == 'battle-600-00-00-001'
    )
    profile = stage['renderProfile']

    # This stage predates the component-backed reconstruction pipeline.  The old
    # hand-tuned profile stacked a 2x directional light, a 50% warm character
    # lighting override, white additional Rim and UnrealBloom.  On the current
    # ReDrive runtime those approximations compound and visibly clip white hair,
    # costume and outline.  Until its real ReDriveVolume/Light components are
    # recovered, keep the scene deliberately neutral instead of pretending the
    # old values are official evidence.
    profile['ambientLight'] = {
        'color': '#ffffff',
        'intensity': 0.4,
    }
    profile['directionalLight'] = {
        'color': '#ffffff',
        'intensity': 0.85,
        'position': [-4, 7, 6],
        'target': [0, 1, 0],
        'castShadow': True,
    }
    profile['renderer'] = {
        'toneMapping': 'aces',
        'exposure': 0.85,
    }
    profile['colorFilter'] = {
        'brightness': 1.0,
        'contrast': 1.0,
        'saturation': 1.0,
    }
    profile['bloom'] = {
        'enabled': False,
        'strength': 0.0,
        'radius': 0.0,
        'threshold': 1.0,
    }
    profile.pop('reDriveVolume', None)
    stage['dynamic'] = {
        'expected': True,
        'status': 'pending',
        'missing': [
            'component-backed ReDriveVolume and official Light profile',
            'ReflectionProbe / lightmap evidence audit',
            'scene runtime component audit',
        ],
        'evidence': [
            'official AssetBundle geometry is present',
            'legacy manual lighting was intentionally neutralized because it was not source-backed',
        ],
    }
    evidence = stage.setdefault('evidence', [])
    note = (
        'temporary conservative lighting fallback: legacy manual character '
        'LightingOverride/AdditionalRim/Bloom removed pending component recovery'
    )
    if note not in evidence:
        evidence.append(note)

    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
        newline='\n',
    )


def patch_character_matcap() -> None:
    gem = ROOT / 'magia-exedra-character-three/shaders/gem.ts'
    replace_once(
        gem,
        "export async function loadOfficialGemResources(\n    profiles: OfficialMaterialProfile[] | undefined,\n): Promise<OfficialGemResources> {",
        "export async function loadOfficialGemResources(\n    profiles: OfficialMaterialProfile[] | undefined,\n    matCapUrl?: string,\n): Promise<OfficialGemResources> {",
    )
    replace_once(
        gem,
        "    const matCap = await loadTexture(DefaultGemMatCap, { colorSpace: THREE.NoColorSpace });",
        "    // Character bundles may ship their own Gem MatCap.  Use that exact\n"
        "    // texture first; the historical 109801 texture is only a fallback for\n"
        "    // bundles where no dedicated MatCap was exported.\n"
        "    const matCap = await loadTexture(matCapUrl ?? DefaultGemMatCap, {\n"
        "        colorSpace: THREE.NoColorSpace,\n"
        "    });",
    )
    replace_once(
        gem,
        "            vec2 rdGemMatCapUv = rdGemNormalVs.xy * 0.5 + 0.5;\n            vec3 rdGemMatCap = texture2D(tGemMatCap, rdGemMatCapUv).rgb;",
        "            // MatCap lives in view space.  Mapping normal.xy directly made\n"
        "            // highlights stick to the model instead of the camera and erased\n"
        "            // the rotating/glassy response of Soul Gems.  Build the same\n"
        "            // camera-facing tangent basis used by conventional MatCap shading.\n"
        "            vec3 rdGemViewAxis = normalize(rdGemView);\n"
        "            vec3 rdGemMatCapX = vec3(rdGemViewAxis.z, 0.0, -rdGemViewAxis.x);\n"
        "            if (dot(rdGemMatCapX, rdGemMatCapX) < 0.0001) {\n"
        "                rdGemMatCapX = vec3(1.0, 0.0, 0.0);\n"
        "            } else {\n"
        "                rdGemMatCapX = normalize(rdGemMatCapX);\n"
        "            }\n"
        "            vec3 rdGemMatCapY = normalize(cross(rdGemViewAxis, rdGemMatCapX));\n"
        "            vec2 rdGemMatCapUv = clamp(\n"
        "                vec2(\n"
        "                    dot(rdGemMatCapX, rdGemNormalVs),\n"
        "                    dot(rdGemMatCapY, rdGemNormalVs)\n"
        "                ) * 0.495 + 0.5,\n"
        "                vec2(0.002),\n"
        "                vec2(0.998)\n"
        "            );\n"
        "            vec3 rdGemMatCap = texture2D(tGemMatCap, rdGemMatCapUv).rgb;",
    )

    extension = ROOT / 'magia-exedra-character-three/shaders/gemExtension.ts'
    replace_once(
        extension,
        "export async function extendMaterialWithOfficialGem(\n    material: THREE.Material,\n    profiles: OfficialMaterialProfile[],\n): Promise<ExtendedGemMaterial> {\n    const resources = await loadOfficialGemResources(profiles);",
        "export async function extendMaterialWithOfficialGem(\n    material: THREE.Material,\n    profiles: OfficialMaterialProfile[],\n    matCapUrl?: string,\n): Promise<ExtendedGemMaterial> {\n    const resources = await loadOfficialGemResources(profiles, matCapUrl);",
    )
    replace_once(
        extension,
        "    material.customProgramCacheKey = () => `${previousKey()}|official-gem-v2|${profiles.map(x => x.name).join('|')}`;",
        "    material.customProgramCacheKey = () =>\n"
        "        `${previousKey()}|official-gem-v3|${matCapUrl ? 'character-matcap' : 'fallback-matcap'}|${profiles.map(x => x.name).join('|')}`;",
    )

    loader = ROOT / 'magia-exedra-character-three/loader.ts'
    replace_once(
        loader,
        "    const characterProfile = getCharacterReDriveProfile(characterId)",
        "    const gemMatCapMap = ObjFindByKey(\n"
        "        texturePathUrl,\n"
        "        path => {\n"
        "            const lower = path.toLowerCase()\n"
        "            return (\n"
        "                lower.includes('gem_matcap') ||\n"
        "                (lower.includes('matcap') && !lower.includes('metallic_gradient'))\n"
        "            )\n"
        "        },\n"
        "    )\n"
        "    const characterProfile = getCharacterReDriveProfile(characterId)",
    )
    replace_once(
        loader,
        "                        const extension = await extendMaterialWithOfficialGem(material, materialProfiles)",
        "                        const extension = await extendMaterialWithOfficialGem(\n"
        "                            material,\n"
        "                            materialProfiles,\n"
        "                            gemMatCapMap,\n"
        "                        )",
    )


def patch_specular_response() -> None:
    stylization = ROOT / 'magia-exedra-character-three/shaders/stylization.ts'
    replace_once(
        stylization,
        "    metallicResponse: 0.12,",
        "    // Control G is the authored Metallic mask.  Keep it out of the old\n"
        "    // normal-Y colour gradient and use it mainly to tint the recovered\n"
        "    // Control-B/specular-gradient response.\n    metallicResponse: 0.62,",
    )
    replace_once(
        stylization,
        "        float rdToonMetalGradientPosition = saturate(normal.y * 0.5 + 0.5);\n"
        "        vec3 rdToonMetalGradient = mix(\n"
        "            uShadowTint,\n"
        "            uHighlightTint,\n"
        "            smoothstep(0.05, 0.95, rdToonMetalGradientPosition)\n"
        "        );\n"
        "        vec3 rdToonMetalColor =\n"
        "            rdToonMetalGradient * mix(rdToonAlbedo, vec3(1.0), 0.20);\n"
        "        rdToonOfficial = mix(\n"
        "            rdToonOfficial,\n"
        "            rdToonMetalColor,\n"
        "            saturate(rdToonMetallicMask * uMetallicResponse)\n"
        "        );\n\n",
        "        // Do not invent a world-up metallic colour gradient.  Official\n"
        "        // Control G marks the material response; its view-dependent colour\n"
        "        // is applied by the recovered specular-gradient branch below.\n\n",
    )

    general = ROOT / 'magia-exedra-character-three/shaders/general.ts'
    replace_once(
        general,
        "                float rdSpecular =\n"
        "                    rdSpecularGradient *\n"
        "                    rdToonSpecularMask *\n"
        "                    uOfficialSpecularStrength;",
        "                float rdSpecularMask = smoothstep(\n"
        "                    0.04,\n"
        "                    0.96,\n"
        "                    rdToonSpecularMask\n"
        "                );\n"
        "                float rdSpecular =\n"
        "                    rdSpecularGradient *\n"
        "                    rdSpecularMask *\n"
        "                    uOfficialSpecularStrength;",
    )
    replace_once(
        general,
        "                rdSpecular *= mix(1.0, 1.35, saturate(uMaterialSpecialJewel));\n\n                vec3 rdSpecularColor = mix(",
        "                rdSpecular *= mix(1.0, 1.35, saturate(uMaterialSpecialJewel));\n"
        "                // Preserve a strong authored highlight without feeding\n"
        "                // unbounded HDR values into scene Bloom/tone mapping.\n"
        "                rdSpecular = min(rdSpecular, 1.5);\n\n"
        "                vec3 rdSpecularColor = mix(",
    )


def patch_release_test() -> None:
    package = ROOT / 'package.json'
    replace_once(
        package,
        '"test:release": "node --test ',
        '"test:release": "node --test sceneGemSpecularFix.test.mjs ',
    )


if __name__ == '__main__':
    patch_stage_catalog()
    patch_character_matcap()
    patch_specular_response()
    patch_release_test()
    print('Applied scene exposure / Gem MatCap / specular response fix')
