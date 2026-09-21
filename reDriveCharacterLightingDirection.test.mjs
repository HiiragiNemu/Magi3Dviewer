import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'

import { unityWorldToViewerVector } from './magia-exedra-character-three/coordinateSpace.ts'

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

test('native character-light direction uses the recovered Unity ZXY application chain', () => {
    const source = read('./magia-exedra-character-three/shaders/stylization.ts')
    assert.match(source, /enabled: false,/)
    assert.match(source, /lightOriginDirection: \[0, 0, -1\]/)
    assert.match(
        source,
        /characterLightingRotation[\s\S]*?\.copy\(characterLightingRotationY\)[\s\S]*?\.multiply\(characterLightingRotationX\)[\s\S]*?\.multiply\(characterLightingRotationZ\)/,
    )
    assert.doesNotMatch(source, /new THREE\.Euler\(0, 0, 0, 'ZXY'\)/)
    assert.match(source, /\.applyQuaternion\(characterLightingRotation\)/)
    assert.match(source, /unityWorldToViewerVector\(/)
    assert.match(source, /\.transformDirection\(camera\.matrixWorldInverse\)/)
})

test('601 official Volume Euler reproduces its serialized MainLight surface-to-light', () => {
    const stage601 = JSON.parse(
        read('./public/stages/official/battle-601-00-01-001/scene-profile.json'),
    )
    const volume = stage601.renderProfile.reDriveVolume
    const mainLight = stage601.renderProfile.lights.find(
        light => light.role === 'character-key',
    )
    assert.equal(volume.characterLightingOverrideDirectionEnabled, true)
    assert.deepEqual(volume.characterLightingOverrideDirection, [130, 40, 0])
    assert.ok(mainLight)

    const [x, y, z] = volume.characterLightingOverrideDirection.map(
        THREE.MathUtils.degToRad,
    )
    // Unity Quaternion.Euler applies Z, then X, then Y. For column vectors
    // that is the explicit quaternion product qY * qX * qZ.
    const recoveredUnityDirection = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(
            new THREE.Quaternion()
                .setFromAxisAngle(new THREE.Vector3(0, 1, 0), y)
                .multiply(
                    new THREE.Quaternion().setFromAxisAngle(
                        new THREE.Vector3(1, 0, 0),
                        x,
                    ),
                )
                .multiply(
                    new THREE.Quaternion().setFromAxisAngle(
                        new THREE.Vector3(0, 0, 1),
                        z,
                    ),
                ),
        )
        .normalize()
    const officialUnityDirection = new THREE.Vector3(...mainLight.position)
        .sub(new THREE.Vector3(...mainLight.target))
        .normalize()
    assert.ok(
        recoveredUnityDirection.dot(officialUnityDirection) > 1 - 1e-12,
        `Unity Euler drifted: recovered=${recoveredUnityDirection.toArray()} official=${officialUnityDirection.toArray()}`,
    )

    const legacyThreeZxyDirection = new THREE.Vector3(0, 0, -1)
        .applyEuler(new THREE.Euler(x, y, z, 'ZXY'))
        .normalize()
    assert.ok(
        legacyThreeZxyDirection.dot(officialUnityDirection) < 0.5,
        'the former Three ZXY composition must remain distinguishable',
    )

    const recoveredViewerDirection = new THREE.Vector3(
        ...unityWorldToViewerVector(recoveredUnityDirection.toArray()),
    )
    const officialViewerDirection = new THREE.Vector3(
        ...unityWorldToViewerVector(officialUnityDirection.toArray()),
    )
    assert.ok(
        recoveredViewerDirection.dot(officialViewerDirection) > 1 - 1e-12,
    )
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
        /toonStylizationOptions\.rimEnabled = false/,
    )
    const additionalRimApplyStart = runtime.indexOf('const rim = colorAndIntensity')
    const additionalRimApplyEnd = runtime.indexOf(
        'scene.scene.userData.reDriveVolumeRuntime = profile',
        additionalRimApplyStart,
    )
    assert.ok(additionalRimApplyStart >= 0 && additionalRimApplyEnd > additionalRimApplyStart)
    assert.doesNotMatch(
        runtime.slice(additionalRimApplyStart, additionalRimApplyEnd),
        /toonStylizationOptions\.rim(?:Color|Strength|DirectionX|DirectionY)\s*=/,
    )
    assert.match(
        runtime,
        /carrier: 'camera-depth-second-sample'[\s\S]*legacySurfaceCarrierEnabled: false/,
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


// Native TW SetGlobalShaderParams 0x4763170/3180 negate Vector2.one;
// 0x4763188/318C multiply effective Volume XY before SetGlobalVector.
// Execute the real producer blocks, not a reimplementation of their sign.
async function runAdditionalRimProducer(kind, input) {
    const ts = (await import('typescript')).default
    const volumeSource = read('./src/viewer/reDriveVolumeRuntime.ts')
    const combatSource = read('./src/viewer/combatVfx.ts')
    const colorHelper = volumeSource.slice(
        volumeSource.indexOf('function colorAndIntensity('),
        volumeSource.indexOf('function updateCharacterUniforms('),
    )
    const source = kind === 'volume' ? volumeSource : combatSource
    const start = kind === 'volume'
        ? '    const rim = colorAndIntensity(profile.characterAdditionalRimLightColor)'
        : "    const rim = weightedBehaviours(product, 'CharacterAdditionalRimLightTrack', time)"
    const end = kind === 'volume'
        ? '    scene.scene.userData.reDriveCharacterAdditionalRim ='
        : "    const tint = weightedBehaviours(product, 'CharacterTintColorTrack', time)"
    const from = source.indexOf(start), to = source.indexOf(end, from)
    assert.ok(from >= 0 && to > from, 'execute actual reachable producer')
    const js = ts.transpileModule(colorHelper + source.slice(from, to), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText
    const carrier = {
        additionalDirectionVS: new THREE.Vector2(77, 88),
        additionalColor: new THREE.Color(7, 8, 9),
    }
    const style = { rimEnabled: true }
    new Function('THREE', 'profile', 'DepthRimExperiment', 'toonStylizationOptions',
        'weightedBehaviours', 'weightedColor', 'record', 'finite', 'product', 'time', js)(
        THREE, input, carrier, style,
        () => input.rows ?? [],
        () => [2, 3, 4, 1], // Independent color consumer is deliberately unchanged.
        value => value ?? {}, value => Number.isFinite(value) ? value : 0, {}, 0,
    )
    return {
        direction: carrier.additionalDirectionVS.toArray(),
        color: carrier.additionalColor.toArray(),
        legacyRimEnabled: style.rimEnabled,
    }
}

test('native rim setter negates floor2 source XY once and preserves HDR', async () => {
    const profile = JSON.parse(read('./public/stages/official/battle-600-01-01-002/scene-profile.json')).renderProfile.reDriveVolume
    assert.deepEqual(profile.characterAdditionalRimLightDirection, [1, -1])
    const actual = await runAdditionalRimProducer('volume', profile)
    assert.deepEqual(actual.direction, [-1, 1])
    assert.deepEqual(actual.color, [2, 2, 2])
    assert.equal(actual.legacyRimEnabled, false)
})

test('native rim source-to-GPU sign handles all quadrants without normalizing magnitude', async () => {
    for (const x of [-3, -0.25, 0, 0.75, 4]) {
        for (const y of [-2, -0.5, 0, 0.125, 5]) {
            const actual = await runAdditionalRimProducer('volume', {
                characterAdditionalRimLightDirection: [x, y],
                characterAdditionalRimLightColor: [2, 3, 4, 1],
            })
            assert.deepEqual(actual.direction, [-x, -y], 'Volume input ' + JSON.stringify([x, y]))
            assert.deepEqual(actual.color, [2, 3, 4])
        }
    }
})

test('direction repair preserves the existing unresolved Volume activation boundary', async () => {
    for (const overrides of [
        { characterAdditionalRimLightColor: false, characterAdditionalRimLightDirection: true },
        { characterAdditionalRimLightColor: true, characterAdditionalRimLightDirection: false },
        { characterAdditionalRimLightColor: false, characterAdditionalRimLightDirection: false },
    ]) {
        const actual = await runAdditionalRimProducer('volume', {
            characterAdditionalRimLightDirection: [1, -1],
            characterAdditionalRimLightColor: [2, 3, 4, 1], overrides,
        })
        assert.deepEqual(actual.direction, [0, 0])
        assert.deepEqual(actual.color, [0, 0, 0])
    }
    // These are preservation checks, not native VolumeStack parity claims.
})

test('Timeline source XY reaches the same native signed GPU domain', async () => {
    for (const [x, y] of [[1, -1], [-2, 3], [0.25, 0.75], [0, 0]]) {
        const actual = await runAdditionalRimProducer('timeline', { rows: [{
            weight: 1, value: { _globalCharacterAdditionalRimLightDirection: { x, y } },
        }] })
        assert.deepEqual(actual.direction, [-x, -y])
        assert.deepEqual(actual.color, [2, 3, 4])
    }
    // Fade/overlap weighting and VolumeStack blending remain separate open items.
})

test('all currently enabled catalog rim profiles use the native sign', async t => {
    const dir = new URL('./public/stages/official/', import.meta.url)
    let inspected = 0, enabled = 0
    for (const file of fs.readdirSync(dir).filter(file => fs.existsSync(new URL(file + '/scene-profile.json', dir)))) {
        const profile = JSON.parse(fs.readFileSync(new URL(file + '/scene-profile.json', dir), 'utf8')).renderProfile?.reDriveVolume
        if (!profile) continue
        inspected++
        const d = profile.characterAdditionalRimLightDirection
        const c = profile.characterAdditionalRimLightColor
        if (!Array.isArray(d) || d.length !== 2 || !d.every(Number.isFinite) || !Array.isArray(c)) continue
        if ((profile.overrides?.characterAdditionalRimLightColor ?? true) === false
            || (profile.overrides?.characterAdditionalRimLightDirection ?? true) === false
            || Math.max(...c.slice(0, 3)) <= 0.0001) continue
        const actual = await runAdditionalRimProducer('volume', profile)
        assert.deepEqual(actual.direction, [-d[0], -d[1]], file)
        c.slice(0, 3).forEach((v, i) => assert.ok(Math.abs(actual.color[i] - v) < 1e-10, file))
        enabled++
    }
    assert.ok(enabled > 0)
    t.diagnostic('official scene Volume profiles=' + inspected + '; currently enabled rim=' + enabled)
})
