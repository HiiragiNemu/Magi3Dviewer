#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def patch_effects() -> None:
    path = Path('magia-exedra-character-three/scene/effects.ts')
    text = path.read_text(encoding='utf-8')

    if "from './backgroundColorAdjustments'" not in text:
        text = replace_once(
            text,
            "import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';\n",
            "import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';\n"
            "import { ReDriveBackgroundColorAdjustmentsShader } from './backgroundColorAdjustments';\n",
            'background adjustment import',
        )

    if 'backgroundColorAdjustPass: ShaderPass' not in text:
        text = replace_once(
            text,
            "    backgroundRenderPass: RenderPass\n    renderPass: RenderPass\n",
            "    backgroundRenderPass: RenderPass\n"
            "    /** ReDriveVolume background-only ColorAdjustments. */\n"
            "    backgroundColorAdjustPass: ShaderPass\n"
            "    renderPass: RenderPass\n",
            'background pass property',
        )

    if 'new ShaderPass(ReDriveBackgroundColorAdjustmentsShader)' not in text:
        text = replace_once(
            text,
            "        this.backgroundRenderPass.enabled = false\n"
            "        this.renderPass = new RenderPass(this.scene.scene, this.scene.camera)\n",
            "        this.backgroundRenderPass.enabled = false\n"
            "        this.backgroundColorAdjustPass = new ShaderPass(\n"
            "            ReDriveBackgroundColorAdjustmentsShader,\n"
            "        )\n"
            "        this.backgroundColorAdjustPass.enabled = false\n"
            "        this.renderPass = new RenderPass(this.scene.scene, this.scene.camera)\n",
            'background pass construction',
        )

    if 'this.composer.addPass(this.backgroundColorAdjustPass)' not in text:
        text = replace_once(
            text,
            "        this.composer.addPass(this.backgroundRenderPass)\n"
            "        this.composer.addPass(this.taaRenderPass)\n",
            "        this.composer.addPass(this.backgroundRenderPass)\n"
            "        // Official ReDriveVolume background grading happens before\n"
            "        // characters are composited, so it cannot tint the actors.\n"
            "        this.composer.addPass(this.backgroundColorAdjustPass)\n"
            "        this.composer.addPass(this.taaRenderPass)\n",
            'composer pass order',
        )

    path.write_text(text, encoding='utf-8')


def patch_scene() -> None:
    path = Path('magia-exedra-character-three/scene/index.ts')
    text = path.read_text(encoding='utf-8')
    old = """            if (this.characterSelectionVisible || this.effects.bloomPass.enabled) {
                return true
            }
"""
    new = """            if (
                this.backgroundSceneEnabled
                || this.characterSelectionVisible
                || this.effects.bloomPass.enabled
                || this.effects.backgroundColorAdjustPass.enabled
            ) {
                return true
            }
"""
    if old in text:
        text = replace_once(text, old, new, 'composer enable conditions')
    elif 'this.effects.backgroundColorAdjustPass.enabled' not in text:
        raise RuntimeError('composer enable condition anchor missing')
    path.write_text(text, encoding='utf-8')


def patch_runtime() -> None:
    path = Path('src/viewer/reDriveVolumeRuntime.ts')
    text = path.read_text(encoding='utf-8')

    if 'backgroundBackgroundTint?: string | Rgba' not in text:
        text = replace_once(
            text,
            "    backgroundTint?: string | Rgba\n",
            "    /** _globalBackgroundTintColor: scene-global background multiply. */\n"
            "    backgroundTint?: string | Rgba\n"
            "    /** _bgBackgroundTintColor: background-only multiply. */\n"
            "    backgroundBackgroundTint?: string | Rgba\n",
            'background tint fields',
        )

    marker = 'function applyBackgroundColorAdjustments('
    if marker not in text:
        anchor = "function applyParaffin(profile?: ReDriveVolumeRuntimeProfile['paraffin']) {"
        index = text.find(anchor)
        if index < 0:
            raise RuntimeError('applyParaffin anchor missing')
        helper = """function profileOverride(
    profile: ReDriveVolumeRuntimeProfile,
    key: string,
    present: boolean,
) {
    return profile.overrides?.[key] ?? present
}

function applyBackgroundColorAdjustments(profile: ReDriveVolumeRuntimeProfile) {
    const pass = scene.effects.backgroundColorAdjustPass
    const globalTintEnabled = profileOverride(
        profile,
        'backgroundTint',
        profile.backgroundTint != undefined,
    )
    const backgroundTintEnabled = profileOverride(
        profile,
        'backgroundBackgroundTint',
        profile.backgroundBackgroundTint != undefined,
    )
    const exposureEnabled = profileOverride(
        profile,
        'backgroundPostExposure',
        profile.backgroundPostExposure != undefined,
    )
    const contrastEnabled = profileOverride(
        profile,
        'backgroundContrast',
        profile.backgroundContrast != undefined,
    )
    const saturationEnabled = profileOverride(
        profile,
        'backgroundSaturation',
        profile.backgroundSaturation != undefined,
    )
    const enabled =
        globalTintEnabled
        || backgroundTintEnabled
        || exposureEnabled
        || contrastEnabled
        || saturationEnabled

    pass.enabled = enabled
    pass.uniforms.uEnabled.value = enabled ? 1 : 0
    pass.uniforms.uGlobalTint.value.copy(
        color(globalTintEnabled ? profile.backgroundTint : undefined),
    )
    pass.uniforms.uBackgroundTint.value.copy(
        color(
            backgroundTintEnabled
                ? profile.backgroundBackgroundTint
                : undefined,
        ),
    )
    pass.uniforms.uPostExposure.value =
        exposureEnabled ? profile.backgroundPostExposure ?? 0 : 0
    pass.uniforms.uContrast.value =
        contrastEnabled ? profile.backgroundContrast ?? 0 : 0
    pass.uniforms.uSaturation.value =
        saturationEnabled ? profile.backgroundSaturation ?? 0 : 0

    scene.backgroundScene.userData.reDriveBackgroundColorAdjustments = enabled
        ? {
            globalTint: globalTintEnabled ? profile.backgroundTint ?? null : null,
            backgroundTint: backgroundTintEnabled
                ? profile.backgroundBackgroundTint ?? null
                : null,
            postExposure: pass.uniforms.uPostExposure.value,
            contrast: pass.uniforms.uContrast.value,
            saturation: pass.uniforms.uSaturation.value,
        }
        : null
}

"""
        text = text[:index] + helper + text[index:]

    if 'applyBackgroundColorAdjustments(profile)' not in text:
        text = replace_once(
            text,
            "    applySphericalHarmonics(profile.shAmbient)\n"
            "    applyParaffin(profile.paraffin)\n",
            "    applySphericalHarmonics(profile.shAmbient)\n"
            "    applyBackgroundColorAdjustments(profile)\n"
            "    applyParaffin(profile.paraffin)\n",
            'runtime background adjustments call',
        )

    reset_marker = 'scene.effects.backgroundColorAdjustPass.enabled = false'
    if reset_marker not in text:
        text = replace_once(
            text,
            "    scene.effects.paraffinPass.enabled = false\n"
            "    scene.effects.paraffinPass.uniforms.uEnabled.value = 0\n",
            "    const backgroundPass = scene.effects.backgroundColorAdjustPass\n"
            "    backgroundPass.enabled = false\n"
            "    backgroundPass.uniforms.uEnabled.value = 0\n"
            "    backgroundPass.uniforms.uGlobalTint.value.set(1, 1, 1)\n"
            "    backgroundPass.uniforms.uBackgroundTint.value.set(1, 1, 1)\n"
            "    backgroundPass.uniforms.uPostExposure.value = 0\n"
            "    backgroundPass.uniforms.uContrast.value = 0\n"
            "    backgroundPass.uniforms.uSaturation.value = 0\n"
            "    delete scene.backgroundScene.userData.reDriveBackgroundColorAdjustments\n"
            "    scene.effects.paraffinPass.enabled = false\n"
            "    scene.effects.paraffinPass.uniforms.uEnabled.value = 0\n",
            'runtime background adjustments reset',
        )

    path.write_text(text, encoding='utf-8')


def patch_stages() -> None:
    path = Path('src/viewer/stages.ts')
    text = path.read_text(encoding='utf-8')
    old = "    if (profile.colorFilter) scene.setColorFilter(profile.colorFilter)\n"
    new = """    // ReDriveVolume bg ColorAdjustments are background-only in the
    // official renderer. The historical CSS filter affects characters too and
    // would double-grade recovered scene profiles, so retain it only for manual
    // research/procedural presets.
    if (profile.colorFilter && profile.source !== 'ReDriveVolume') {
        scene.setColorFilter(profile.colorFilter)
    }
"""
    if old in text:
        text = replace_once(text, old, new, 'legacy global color filter gate')
    elif "profile.source !== 'ReDriveVolume'" not in text:
        raise RuntimeError('legacy global color filter anchor missing')
    path.write_text(text, encoding='utf-8')


def patch_package() -> None:
    path = Path('package.json')
    data = json.loads(path.read_text(encoding='utf-8'))
    script = data['scripts']['test:release']
    test_name = 'reDriveBackgroundRuntime.test.mjs'
    if test_name not in script:
        parts = script.split()
        try:
            node_test = parts.index('--test')
        except ValueError as exc:
            raise RuntimeError('test:release is not node --test') from exc
        parts.insert(node_test + 1, test_name)
        data['scripts']['test:release'] = ' '.join(parts)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main() -> None:
    patch_effects()
    patch_scene()
    patch_runtime()
    patch_stages()
    patch_package()
    print('Applied ReDriveVolume background-runtime patch')


if __name__ == '__main__':
    main()
