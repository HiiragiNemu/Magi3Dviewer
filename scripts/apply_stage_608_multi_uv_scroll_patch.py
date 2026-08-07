#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TS = ROOT / 'src' / 'viewer' / 'stageMaterialBindings.ts'
STAGE = ROOT / 'public' / 'stages' / 'catalog' / 'battle-608-00-00-001.json'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def patch_typescript() -> None:
    text = TS.read_text(encoding='utf-8')

    text = replace_once(
        text,
        "export interface StageMaterialBinding {\n",
        """export interface StageMultiUvScrollLayer {\n    tiling: [number, number]\n    offset: [number, number]\n    speed: [number, number]\n    color?: [number, number, number, number]\n    opacity?: number\n}\n\nexport interface StageMultiUvScrollProfile {\n    /** Separately serialized Unity `_ScrollTexture` / `_ScrollTexutre`. */\n    textureUrl: string\n    first: StageMultiUvScrollLayer\n    second: StageMultiUvScrollLayer\n    /** Serialized `_Additive_to_Multiply`: 0 additive, 1 multiply. */\n    additiveToMultiply: number\n    /** `_DropFrame_MultiScroll`; exact dropped-frame quantization is deferred. */\n    dropFrame?: boolean\n}\n\nexport interface StageMaterialBinding {\n""",
        'multi-uv interfaces',
    )

    text = replace_once(
        text,
        "    atlas?: StageAtlasProfile\n}\n",
        "    atlas?: StageAtlasProfile\n    multiUvScroll?: StageMultiUvScrollProfile\n}\n",
        'multi-uv binding field',
    )

    text = replace_once(
        text,
        "        binding.matCapMapUrl ? loadTexture(binding.matCapMapUrl, 'color') : undefined,\n",
        "        binding.matCapMapUrl ? loadTexture(binding.matCapMapUrl, 'color') : undefined,\n        binding.multiUvScroll?.textureUrl\n            ? loadTexture(binding.multiUvScroll.textureUrl, 'color')\n            : undefined,\n",
        'multi-uv preload',
    )

    text = replace_once(
        text,
        "                        matCapMap: await resolveTexture(binding.matCapMapUrl, 'color'),\n                        ownedTextures,\n",
        "                        matCapMap: await resolveTexture(binding.matCapMapUrl, 'color'),\n                        multiUvScrollMap: await resolveTexture(\n                            binding.multiUvScroll?.textureUrl,\n                            'color',\n                        ),\n                        ownedTextures,\n",
        'multi-uv resolve',
    )

    text = replace_once(
        text,
        "    matCapMap?: THREE.Texture\n    ownedTextures: Set<THREE.Texture>\n",
        "    matCapMap?: THREE.Texture\n    multiUvScrollMap?: THREE.Texture\n    ownedTextures: Set<THREE.Texture>\n",
        'multi-uv texture set',
    )

    text = replace_once(
        text,
        "        material.alphaToCoverage = binding.alphaToCoverage ?? false\n        installAtlasAnimation(material, map, binding.atlas, mesh)\n        return material\n",
        "        material.alphaToCoverage = binding.alphaToCoverage ?? false\n        installAtlasAnimation(material, map, binding.atlas, mesh)\n        installMultiUvScroll(\n            material,\n            binding.multiUvScroll,\n            textures.multiUvScrollMap,\n            mesh,\n        )\n        return material\n",
        'unlit multi-uv install',
    )

    text = replace_once(
        text,
        "    installOfficialLitExtensions(material, binding, textures)\n    installAtlasAnimation(material, map, binding.atlas, mesh)\n    return material\n}\n\nfunction createAtlasTexture(\n",
        "    installOfficialLitExtensions(material, binding, textures)\n    installAtlasAnimation(material, map, binding.atlas, mesh)\n    installMultiUvScroll(\n        material,\n        binding.multiUvScroll,\n        textures.multiUvScrollMap,\n        mesh,\n    )\n    return material\n}\n\nfunction installMultiUvScroll(\n    material: THREE.Material,\n    profile: StageMultiUvScrollProfile | undefined,\n    scrollTexture: THREE.Texture | undefined,\n    mesh: THREE.Object3D,\n) {\n    if (!profile || !scrollTexture) return\n\n    scrollTexture.wrapS = THREE.RepeatWrapping\n    scrollTexture.wrapT = THREE.RepeatWrapping\n    scrollTexture.needsUpdate = true\n\n    const firstColor = profile.first.color ?? [1, 1, 1, 1]\n    const secondColor = profile.second.color ?? [1, 1, 1, 1]\n    const baseCacheKey = material.customProgramCacheKey()\n    const previousOnBeforeCompile = material.onBeforeCompile\n    const previousOnBeforeRender = material.onBeforeRender\n    let timeUniform: THREE.IUniform<number> | undefined\n\n    material.userData.stageMultiUvScroll = {\n        ...profile,\n        timingMode: profile.dropFrame\n            ? 'continuous-until-dropped-frame-time-is-recovered'\n            : 'continuous',\n    }\n    material.customProgramCacheKey = () =>\n        `${baseCacheKey}:stage-multi-uv:${JSON.stringify(profile)}`\n\n    material.onBeforeCompile = function (shader, renderer) {\n        shader.uniforms.uStageMultiUvTexture = { value: scrollTexture }\n        shader.uniforms.uStageMultiUvTime = { value: 0 }\n        shader.uniforms.uStageMultiUvFirstTiling = {\n            value: new THREE.Vector2(...profile.first.tiling),\n        }\n        shader.uniforms.uStageMultiUvFirstOffset = {\n            value: new THREE.Vector2(...profile.first.offset),\n        }\n        shader.uniforms.uStageMultiUvFirstSpeed = {\n            value: new THREE.Vector2(...profile.first.speed),\n        }\n        shader.uniforms.uStageMultiUvFirstColor = {\n            value: new THREE.Vector4(...firstColor),\n        }\n        shader.uniforms.uStageMultiUvFirstOpacity = {\n            value: profile.first.opacity ?? 1,\n        }\n        shader.uniforms.uStageMultiUvSecondTiling = {\n            value: new THREE.Vector2(...profile.second.tiling),\n        }\n        shader.uniforms.uStageMultiUvSecondOffset = {\n            value: new THREE.Vector2(...profile.second.offset),\n        }\n        shader.uniforms.uStageMultiUvSecondSpeed = {\n            value: new THREE.Vector2(...profile.second.speed),\n        }\n        shader.uniforms.uStageMultiUvSecondColor = {\n            value: new THREE.Vector4(...secondColor),\n        }\n        shader.uniforms.uStageMultiUvSecondOpacity = {\n            value: profile.second.opacity ?? 1,\n        }\n        shader.uniforms.uStageMultiUvAdditiveToMultiply = {\n            value: profile.additiveToMultiply,\n        }\n        timeUniform = shader.uniforms.uStageMultiUvTime as THREE.IUniform<number>\n\n        shader.fragmentShader = shader.fragmentShader\n            .replace(\n                '#include <map_pars_fragment>',\n                `#include <map_pars_fragment>\nuniform sampler2D uStageMultiUvTexture;\nuniform float uStageMultiUvTime;\nuniform vec2 uStageMultiUvFirstTiling;\nuniform vec2 uStageMultiUvFirstOffset;\nuniform vec2 uStageMultiUvFirstSpeed;\nuniform vec4 uStageMultiUvFirstColor;\nuniform float uStageMultiUvFirstOpacity;\nuniform vec2 uStageMultiUvSecondTiling;\nuniform vec2 uStageMultiUvSecondOffset;\nuniform vec2 uStageMultiUvSecondSpeed;\nuniform vec4 uStageMultiUvSecondColor;\nuniform float uStageMultiUvSecondOpacity;\nuniform float uStageMultiUvAdditiveToMultiply;`,\n            )\n            .replace(\n                '#include <map_fragment>',\n                `#include <map_fragment>\n#ifdef USE_MAP\n    vec2 rdStageUv1 =\n        vMapUv * uStageMultiUvFirstTiling +\n        uStageMultiUvFirstOffset +\n        uStageMultiUvFirstSpeed * uStageMultiUvTime;\n    vec2 rdStageUv2 =\n        vMapUv * uStageMultiUvSecondTiling +\n        uStageMultiUvSecondOffset +\n        uStageMultiUvSecondSpeed * uStageMultiUvTime;\n    vec4 rdStageScroll1 =\n        texture2D(uStageMultiUvTexture, rdStageUv1) *\n        uStageMultiUvFirstColor;\n    vec4 rdStageScroll2 =\n        texture2D(uStageMultiUvTexture, rdStageUv2) *\n        uStageMultiUvSecondColor;\n    float rdStageAlpha1 = saturate(\n        rdStageScroll1.a * uStageMultiUvFirstOpacity\n    );\n    float rdStageAlpha2 = saturate(\n        rdStageScroll2.a * uStageMultiUvSecondOpacity\n    );\n\n    // The two texture inputs, ST, colors, opacities and speeds are exact\n    // serialized JP Material values. The final additive/multiply interpolation\n    // remains an explicit Web approximation until the compiled background\n    // shader subprogram is decoded.\n    vec3 rdStageAdditive = diffuseColor.rgb +\n        rdStageScroll1.rgb * rdStageAlpha1 +\n        rdStageScroll2.rgb * rdStageAlpha2;\n    vec3 rdStageMultiply = diffuseColor.rgb *\n        mix(vec3(1.0), rdStageScroll1.rgb, rdStageAlpha1) *\n        mix(vec3(1.0), rdStageScroll2.rgb, rdStageAlpha2);\n    diffuseColor.rgb = mix(\n        rdStageAdditive,\n        rdStageMultiply,\n        saturate(uStageMultiUvAdditiveToMultiply)\n    );\n#endif`,\n            )\n\n        previousOnBeforeCompile.call(this, shader, renderer)\n    }\n\n    material.onBeforeRender = function (\n        renderer,\n        scene,\n        camera,\n        geometry,\n        object,\n        group,\n    ) {\n        previousOnBeforeRender.call(\n            this,\n            renderer,\n            scene,\n            camera,\n            geometry,\n            object,\n            group,\n        )\n        if (timeUniform) {\n            timeUniform.value =\n                findStageRuntimeTime(mesh) ?? performance.now() * 0.001\n        }\n    }\n}\n\nfunction createAtlasTexture(\n",
        'multi-uv runtime',
    )

    TS.write_text(text, encoding='utf-8')


def patch_stage() -> None:
    data = json.loads(STAGE.read_text(encoding='utf-8'))
    fish = next(
        binding for binding in data['materialBindings']
        if binding.get('materialName') == 'bg3d608_00_blue_Fish'
    )
    fish['multiUvScroll'] = {
        'textureUrl': './stages/official/battle-608-00-00-001/bg3d608_00_blue_objects_uvscroll_col.png',
        'first': {
            'tiling': [1, 1],
            'offset': [0, 0],
            'speed': [-0.009999999776482582, 0],
            'color': [1, 1, 1, 1],
            'opacity': 1,
        },
        'second': {
            'tiling': [1, 1],
            'offset': [0, 0],
            'speed': [-0.009999999776482582, 0],
            'color': [1, 1, 1, 1],
            'opacity': 1,
        },
        'additiveToMultiply': 0.9800000190734863,
        'dropFrame': True,
    }
    fish['alphaTest'] = 0.5

    dynamic = data.setdefault('dynamic', {})
    missing = dynamic.setdefault('missing', [])
    missing = [
        item for item in missing
        if 'Fish two-layer UV scroll' not in item
        and 'multi-UV' not in item
    ]
    missing.append(
        'exact _DropFrame_MultiScroll time quantization and compiled background-shader blend formula'
    )
    dynamic['missing'] = missing
    evidence = dynamic.setdefault('evidence', [])
    exact = (
        'Current JP Material bg3d608_00_blue_Fish: _MULTI_UV_SCROLL=1, '
        'BaseMap and separate ScrollTexture PPtrs, both layers speed [-0.01,0], '
        'tiling [1,1], opacity 1, _Additive_to_Multiply=0.98, alpha clip 0.5'
    )
    if exact not in evidence:
        evidence.append(exact)

    STAGE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )


def main() -> int:
    patch_typescript()
    patch_stage()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
