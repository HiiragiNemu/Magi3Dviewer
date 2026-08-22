import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'

import { unityWorldToViewerVector } from './magia-exedra-character-three/coordinateSpace.ts'

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

test('native character-light direction uses the recovered Unity chain', () => {
    const source = read('./magia-exedra-character-three/shaders/stylization.ts')
    assert.match(source, /enabled: false,/)
    assert.match(source, /lightOriginDirection: \[0, 0, -1\]/)
    assert.match(source, /new THREE\.Euler\(0, 0, 0, 'ZXY'\)/)
    assert.match(source, /\.setFromEuler\(characterLightingEuler\)/)
    assert.match(source, /\.applyQuaternion\(characterLightingRotation\)/)
    assert.match(source, /unityWorldToViewerVector\(/)
    assert.match(source, /\.transformDirection\(camera\.matrixWorldInverse\)/)
})

test('nonzero Unity-world character direction receives the AssetStudio X reflection', () => {
    assert.deepEqual(
        unityWorldToViewerVector([0.4131758809, 0.7660443783, 0.4924039841]),
        [-0.4131758809, 0.7660443783, 0.4924039841],
    )
})

test('character root belongs to the normal chain and is not applied to the global light twice', () => {
    const root = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.37, -0.81, 0.22, 'ZXY'),
    )
    const localNormal = new THREE.Vector3(0.2, 0.9, 0.38).normalize()
    const globalLight = new THREE.Vector3(-0.41, 0.77, 0.49).normalize()
    const worldNormal = localNormal.clone().applyQuaternion(root)
    const officialWorldDot = worldNormal.dot(globalLight)
    const incorrectlyRootedLightDot = worldNormal.dot(
        globalLight.clone().applyQuaternion(root),
    )

    assert.ok(Math.abs(officialWorldDot - incorrectlyRootedLightDot) > 0.1)
    assert.ok(Math.abs(localNormal.dot(globalLight) - incorrectlyRootedLightDot) < 1e-12)
})

test('toon selector is separate from the physical CameraDepth light', () => {
    const general = read('./magia-exedra-character-three/shaders/general.ts')
    const depthRim = read('./magia-exedra-character-three/shaders/depthRim.ts')
    assert.match(general, /vec3 rdToonCharacterLightDirection = mix\(/)
    assert.match(general, /dot\(normal, rdToonCharacterLightDirection\)/)
    assert.match(general, /vec3 rdLightDirection = rdToonCharacterLightDirection/)
    assert.match(depthRim, /rdToonMainLightDirection\.xy/)
    assert.doesNotMatch(depthRim, /rdToonCharacterLightDirection\.xy/)
})

test('ReDriveVolume gate follows the effective serialized Volume stack', () => {
    const runtime = read('./src/viewer/reDriveVolumeRuntime.ts')
    const selfShadow = read('./magia-exedra-character-three/scene/selfShadow.ts')
    assert.match(runtime, /profile\.characterLightingOverrideDirectionEnabled/)
    assert.match(runtime, /\?\? stageOverridesDirection/)
    assert.match(runtime, /disabled-unoverridden-volume-parameter/)
    assert.doesNotMatch(runtime, /\?\? initial\.characterLightingOverrideDirection\.enabled/)
    assert.match(runtime, /setReDriveCharacterLightingOverrideDirection\(/)
    assert.match(selfShadow, /useNdotLFix: false/)
})

test('profile-free reset cannot inherit one captured scene direction gate', () => {
    const stylization = read('./magia-exedra-character-three/shaders/stylization.ts')
    const runtime = read('./src/viewer/reDriveVolumeRuntime.ts')

    assert.match(stylization, /officialReDriveCharacterLightingDirectionDefaults[\s\S]*?enabled: false,/)
    assert.match(
        runtime,
        /setReDriveCharacterLightingOverrideDirection\(\s*initial\.characterLightingOverrideDirection\.enabled,/,
    )
})

test('scene additional rim globals drive the official second CameraDepthTexture sample', () => {
    const runtime = read('./src/viewer/reDriveVolumeRuntime.ts')
    const depthRim = read('./magia-exedra-character-three/shaders/depthRim.ts')
    const stage601 = JSON.parse(
        read('./public/stages/catalog/battle-601-00-01-001.json'),
    )
    const profile = stage601.renderProfile.reDriveVolume

    assert.deepEqual(profile.characterAdditionalRimLightColor, [
        2.0,
        1.02983558177948,
        0.4464559555053711,
        1.0,
    ])
    assert.deepEqual(profile.characterAdditionalRimLightDirection, [1, -1])
    assert.equal(
        profile.overrides.characterAdditionalRimLightColor,
        true,
    )
    assert.equal(
        profile.overrides.characterAdditionalRimLightDirection,
        true,
    )

    assert.match(runtime, /DepthRimExperiment\.additionalDirectionVS\.set/)
    assert.match(runtime, /DepthRimExperiment\.additionalColor[\s\S]*?multiplyScalar\(rim\.intensity\)/)
    assert.match(
        runtime,
        /toonStylizationOptions\.rimEnabled = additionalRimEnabled/,
    )
    assert.match(
        depthRim,
        /rdDepthExtent \*[\s\S]*?uRdDepthRimAdditionalDirectionVS/,
    )
    assert.match(
        depthRim,
        /rdDepthRim\.y \*[\s\S]*?uRdDepthRimAdditionalColor/,
    )
})
