#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def patch_runtime() -> None:
    path = Path('src/viewer/reDriveVolumeRuntime.ts')
    text = path.read_text(encoding='utf-8')

    if 'type SceneWithImageBasedLighting' not in text:
        anchor = "export type Rgba = [number, number, number, number]\n\n"
        addition = """export type Rgba = [number, number, number, number]

type SceneWithImageBasedLighting = THREE.Scene & {
    environmentIntensity?: number
    backgroundIntensity?: number
}

"""
        text = replace_once(text, anchor, addition, 'IBL scene type')

    if 'sceneEnvironmentIntensity:' not in text:
        old = """const initial = {
    ambientIntensity: scene.ambientLight.intensity,
"""
        new = """const initial = {
    sceneEnvironmentIntensity:
        (scene.scene as SceneWithImageBasedLighting).environmentIntensity,
    backgroundSceneEnvironmentIntensity:
        (scene.backgroundScene as SceneWithImageBasedLighting).environmentIntensity,
    sceneBackgroundIntensity:
        (scene.scene as SceneWithImageBasedLighting).backgroundIntensity,
    backgroundSceneBackgroundIntensity:
        (scene.backgroundScene as SceneWithImageBasedLighting).backgroundIntensity,
    ambientIntensity: scene.ambientLight.intensity,
"""
        text = replace_once(text, old, new, 'initial IBL state')

    if 'function applySkyboxIntensity(' not in text:
        anchor = 'function applyBackgroundColorAdjustments(profile: ReDriveVolumeRuntimeProfile) {'
        index = text.find(anchor)
        if index < 0:
            raise RuntimeError('background adjustments anchor missing')
        helper = """function applySkyboxIntensity(profile: ReDriveVolumeRuntimeProfile) {
    const enabled = profileOverride(
        profile,
        'skyboxIntensity',
        profile.skyboxIntensity != undefined,
    )
    if (!enabled) {
        delete scene.scene.userData.reDriveSkyboxIntensity
        return
    }
    const intensity = Number.isFinite(profile.skyboxIntensity)
        ? Math.max(0, profile.skyboxIntensity ?? 1)
        : 1
    ;(scene.scene as SceneWithImageBasedLighting).environmentIntensity = intensity
    ;(scene.backgroundScene as SceneWithImageBasedLighting).environmentIntensity = intensity
    ;(scene.scene as SceneWithImageBasedLighting).backgroundIntensity = intensity
    ;(scene.backgroundScene as SceneWithImageBasedLighting).backgroundIntensity = intensity
    scene.scene.userData.reDriveSkyboxIntensity = intensity
}

"""
        text = text[:index] + helper + text[index:]

    if 'applySkyboxIntensity(profile)' not in text:
        text = replace_once(
            text,
            "    applySphericalHarmonics(profile.shAmbient)\n"
            "    applyBackgroundColorAdjustments(profile)\n",
            "    applySphericalHarmonics(profile.shAmbient)\n"
            "    applySkyboxIntensity(profile)\n"
            "    applyBackgroundColorAdjustments(profile)\n",
            'apply skybox intensity',
        )

    if 'backgroundSceneBackgroundIntensity' in text and 'reDriveSkyboxIntensity\n' not in text:
        # no-op: the field itself already proves this branch was partially patched
        pass

    reset_anchor = """    lightProbe.intensity = 0
    lightProbe.sh.zero()
"""
    if 'initial.sceneEnvironmentIntensity' not in text:
        reset = """    ;(scene.scene as SceneWithImageBasedLighting).environmentIntensity =
        initial.sceneEnvironmentIntensity
    ;(scene.backgroundScene as SceneWithImageBasedLighting).environmentIntensity =
        initial.backgroundSceneEnvironmentIntensity
    ;(scene.scene as SceneWithImageBasedLighting).backgroundIntensity =
        initial.sceneBackgroundIntensity
    ;(scene.backgroundScene as SceneWithImageBasedLighting).backgroundIntensity =
        initial.backgroundSceneBackgroundIntensity
    delete scene.scene.userData.reDriveSkyboxIntensity
"""
        text = replace_once(
            text,
            reset_anchor,
            reset_anchor + reset,
            'reset skybox intensity',
        )

    path.write_text(text, encoding='utf-8')


def patch_package() -> None:
    path = Path('package.json')
    data = json.loads(path.read_text(encoding='utf-8'))
    script = data['scripts']['test:release']
    test_name = 'reDriveSkyboxIntensity.test.mjs'
    if test_name not in script:
        parts = script.split()
        parts.insert(parts.index('--test') + 1, test_name)
        data['scripts']['test:release'] = ' '.join(parts)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    patch_runtime()
    patch_package()
    print('Applied ReDrive skybox/reflection intensity runtime patch')
