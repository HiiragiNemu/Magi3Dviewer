import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const introProfile = JSON.parse(readFileSync(join(
    repositoryRoot,
    'public',
    'stages',
    'official',
    'dungeon-intro-0001-001',
    'scene-profile.json',
), 'utf8'))
const memoryStoryProfile = JSON.parse(readFileSync(join(
    repositoryRoot,
    'public',
    'stages',
    'official',
    'gallery-memory-room-story',
    'scene-profile.json',
), 'utf8'))
const battle601Profile = JSON.parse(readFileSync(join(
    repositoryRoot,
    'public',
    'stages',
    'official',
    'battle-601-00-01-001',
    'scene-profile.json',
), 'utf8'))
const nonce = `${process.pid}-${Date.now()}`
const mockPath = join(repositoryRoot, `.stage-runtime-renderer-${nonce}.mjs`)
const runtimePath = join(repositoryRoot, `.stage-runtime-under-test-${nonce}.mjs`)
const hierarchyPath = join(repositoryRoot, `.stage-hierarchy-under-test-${nonce}.mjs`)
const transformPath = join(repositoryRoot, `.stage-transform-under-test-${nonce}.mjs`)
const particlePath = join(repositoryRoot, `.stage-particles-under-test-${nonce}.mjs`)

writeFileSync(mockPath, `
export const loops = []
export function addAnimationLoop(callback) {
    if (!loops.includes(callback)) loops.push(callback)
}
export function removeAnimationLoop(callback) {
    const index = loops.indexOf(callback)
    if (index >= 0) loops.splice(index, 1)
}
export function getClockDelta() {
    return 0
}
`, 'utf8')

const sourcePath = join(repositoryRoot, 'src', 'viewer', 'stageRuntime.ts')
const hierarchySourcePath = join(repositoryRoot, 'src', 'viewer', 'stageHierarchy.ts')
const hierarchyCompiled = ts.transpileModule(
    readFileSync(hierarchySourcePath, 'utf8'),
    {
        compilerOptions: {
            module: ts.ModuleKind.ES2022,
            target: ts.ScriptTarget.ES2022,
        },
        fileName: hierarchySourcePath,
    },
)
writeFileSync(hierarchyPath, hierarchyCompiled.outputText, 'utf8')

const particleSourcePath = join(repositoryRoot, 'src', 'viewer', 'stageParticles.ts')
const particleSource = readFileSync(particleSourcePath, 'utf8').replace(
    "'./stageHierarchy'",
    `'./${basename(hierarchyPath)}'`,
).replace(
    "'magia-exedra-character-three/coordinateSpace'",
    "'./magia-exedra-character-three/coordinateSpace.ts'",
)
const particleCompiled = ts.transpileModule(particleSource, {
    compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
    },
    fileName: particleSourcePath,
})
writeFileSync(particlePath, particleCompiled.outputText, 'utf8')

writeFileSync(transformPath, ts.transpileModule(
    readFileSync(join(repositoryRoot, 'src/viewer/stageTransformAnimations.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
).outputText, 'utf8')

const source = readFileSync(sourcePath, 'utf8')
    .replace("'./stageTransformAnimations'", `'./${basename(transformPath)}'`)
    .replace(
        "'magia-exedra-character-three/renderer'",
        `'./${basename(mockPath)}'`,
    )
    .replace(
        "'./stageHierarchy'",
        `'./${basename(hierarchyPath)}'`,
    )
    .replace(
        "'./stageParticles'",
        `'./${basename(particlePath)}'`,
    )
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')

const runtime = await import(pathToFileURL(runtimePath).href)
const particles = await import(pathToFileURL(particlePath).href)
const rendererMock = await import(pathToFileURL(mockPath).href)

after(() => {
    rmSync(runtimePath, { force: true })
    rmSync(mockPath, { force: true })
    rmSync(hierarchyPath, { force: true })
    rmSync(particlePath, { force: true })
    rmSync(transformPath, { force: true })
})

function makeAnimatedStageRoot() {
    const root = new THREE.Group()
    root.name = 'FiveLayerOfficialStage'

    const clips = []
    for (let index = 0; index < 5; index++) {
        const child = new THREE.Group()
        child.name = `Layer${index}`
        root.add(child)

        clips.push(new THREE.AnimationClip(
            `clip-${index}`,
            1,
            [new THREE.NumberKeyframeTrack(
                `${child.name}.position[x]`,
                [0, 1],
                [0, index + 1],
            )],
        ))
    }

    clips.push(new THREE.AnimationClip(
        'clip-0-companion',
        1,
        [new THREE.NumberKeyframeTrack(
            'Layer0.position[y]',
            [0, 1],
            [0, 100],
        )],
    ))
    root.animations = clips
    return root
}

test('stage runtime selects five exact clips and advances one shared clock', () => {
    const root = makeAnimatedStageRoot()
    const controller = new runtime.StageRuntimeController(root, {
        clipNames: [
            'clip-0',
            'clip-1',
            'clip-2',
            'clip-3',
            'clip-4',
            'clip-0',
            'missing-clip',
        ],
        autoplay: false,
        loop: true,
        timeScale: 2,
        voiceTracks: [{
            id: 'voice-100107',
            characterId: '100107',
            startTime: 1,
            offset: 0.1,
            duration: 0.5,
            loop: true,
            actionName: 'Talk',
            expressionName: 'Smile',
        }],
        rotators: [{
            objectName: 'Layer4',
            degreesPerSecond: [0, 90, 0],
            space: 'self',
        }],
    })

    assert.equal(rendererMock.loops.length, 1)
    assert.equal(root.userData.stageRuntimeTime, 0)
    assert.deepEqual(controller.getDebugState().playingClipNames, [
        'clip-0',
        'clip-1',
        'clip-2',
        'clip-3',
        'clip-4',
    ])
    assert.deepEqual(controller.getDebugState().missingClipNames, [
        'missing-clip',
    ])

    // A paused runtime must not advance either the mixer or shared clock.
    controller.update(0.25)
    assert.equal(controller.time, 0)
    assert.equal(root.children[0].position.x, 0)

    controller.play()
    controller.update(0.25)
    assert.equal(controller.time, 0.5)
    assert.equal(root.userData.stageRuntimeTime, 0.5)
    root.children.slice(0, 5).forEach((child, index) => {
        assert.ok(
            Math.abs(child.position.x - ((index + 1) * 0.5)) < 1e-6,
            `layer ${index} did not receive its simultaneous clip`,
        )
    })
    assert.equal(root.children[0].position.y, 0)
    assert.ok(
        Math.abs(root.children[4].rotation.y - Math.PI / 4) < 1e-6,
        'native LinearRotater degrees/second delta was not applied',
    )

    controller.pause()
    controller.update(1)
    assert.equal(controller.time, 0.5)

    // Seeking beyond the one-second clips proves LoopRepeat wraps every layer.
    controller.seek(1.25)
    assert.equal(root.userData.stageRuntimeTime, 1.25)
    root.children.slice(0, 5).forEach((child, index) => {
        assert.ok(
            Math.abs(child.position.x - ((index + 1) * 0.25)) < 1e-6,
            `layer ${index} did not wrap at seek time`,
        )
    })

    const pausedVoice = controller.getVoiceTrackStates()[0]
    assert.equal(pausedVoice.playback, 'paused')
    assert.ok(Math.abs(pausedVoice.localTime - 0.35) < 1e-6)

    controller.play()
    controller.setTimeScale(0.5)
    controller.update(0.2)
    assert.ok(Math.abs(controller.time - 1.35) < 1e-6)
    assert.ok(Math.abs(root.userData.stageRuntimeTime - 1.35) < 1e-6)
    assert.equal(controller.getVoiceTrackStates()[0].playback, 'playing')
    assert.deepEqual(controller.getDebugState().activeRotatorNames, ['Layer4'])

    controller.dispose()
    assert.equal(rendererMock.loops.length, 0)
    assert.equal(root.userData.stageRuntimeTime, undefined)
    assert.equal(controller.getDebugState().disposed, true)

    const disposedTime = controller.time
    controller.update(10)
    assert.equal(controller.time, disposedTime)
})

test('missing runtime profile remains a true static-stage no-op', () => {
    const root = makeAnimatedStageRoot()
    const loopCount = rendererMock.loops.length

    assert.equal(runtime.createStageRuntimeController(root, undefined), undefined)
    assert.equal(rendererMock.loops.length, loopCount)
    assert.equal(root.userData.stageRuntimeTime, undefined)
})

test('non-looping runtime clamps at the shared timeline end and publishes live state', () => {
    const root = makeAnimatedStageRoot()
    let postUpdateCount = 0
    const controller = new runtime.StageRuntimeController(root, {
        clipNames: ['clip-0'],
        autoplay: true,
        loop: false,
        voiceTracks: [{
            id: 'voice-after-animation',
            startTime: 0.75,
            duration: 0.75,
        }],
    }, () => {
        postUpdateCount++
    })

    assert.equal(postUpdateCount, 1)
    assert.equal(root.userData.stageRuntime.playing, true)
    assert.equal(root.userData.stageRuntime.timelineDuration, 1.5)

    controller.update(0.5)
    assert.equal(controller.time, 0.5)
    assert.equal(postUpdateCount, 2)
    assert.equal(root.userData.stageRuntime.time, 0.5)
    assert.equal(root.userData.stageRuntime.animationEnded, false)

    controller.update(2)
    assert.equal(controller.time, 1.5)
    assert.equal(controller.paused, true)
    assert.equal(postUpdateCount, 3)
    assert.equal(root.userData.stageRuntime.playing, false)
    assert.equal(root.userData.stageRuntime.animationEnded, true)
    assert.equal(
        controller.getVoiceTrackStates()[0].playback,
        'ended',
    )

    // Once clamped and paused, later renderer ticks must remain stable.
    controller.update(10)
    assert.equal(controller.time, 1.5)
    assert.equal(postUpdateCount, 3)

    controller.dispose()
    assert.equal(root.userData.stageRuntime, undefined)
})

test('voice source offset shortens the non-looping shared timeline', () => {
    const root = new THREE.Group()
    const controller = new runtime.StageRuntimeController(root, {
        autoplay: true,
        loop: false,
        voiceTracks: [{
            id: 'offset-voice',
            startTime: 1,
            offset: 0.4,
            duration: 1,
        }],
    })

    assert.equal(controller.getDebugState().timelineDuration, 1.6)
    controller.update(2)
    assert.equal(controller.time, 1.6)
    assert.equal(controller.getVoiceTrackStates()[0].playback, 'ended')
    controller.dispose()
})

function makeIntroActivationRoot() {
    const root = new THREE.Group()
    root.name = 'level_intro_0001_001'
    for (const state of introProfile.runtime.gameObjectStates) {
        const segments = state.hierarchyPath.split('/')
        assert.equal(segments[0], root.name)
        let parent = root
        for (const segment of segments.slice(1)) {
            let child = parent.children.find(candidate => candidate.name === segment)
            if (!child) {
                child = new THREE.Group()
                child.name = segment
                parent.add(child)
            }
            parent = child
        }
    }
    return root
}

test('serialized ActivationTracks restore Intro initial phase and seek exact directors', () => {
    const root = makeIntroActivationRoot()
    const runtimeProfile = {
        autoplay: false,
        loop: false,
        gameObjectStates: introProfile.runtime.gameObjectStates,
        activationDirectors: introProfile.runtime.activationDirectors,
    }
    const controller = new runtime.StageRuntimeController(root, runtimeProfile)
    const bg1 = root.getObjectByName('intro_3dbg_0001')
    const bg2 = root.getObjectByName('intro_3dbg_0002')
    const bg3 = root.getObjectByName('intro_3dbg_0003')
    assert.ok(bg1 && bg2 && bg3)

    assert.deepEqual([bg1.visible, bg2.visible, bg3.visible], [false, true, false])
    assert.equal(controller.getDebugState().activation.requestedDirectorPathIDs.length, 2)
    assert.equal(controller.getDebugState().activation.resolvedGameObjectStateCount, 6)
    assert.deepEqual(controller.getDebugState().activation.missingTargetPaths, [])

    const director01 = runtimeProfile.activationDirectors.find(
        director => director.hierarchyPath.endsWith('/01'),
    )
    const director02 = runtimeProfile.activationDirectors.find(
        director => director.hierarchyPath.endsWith('/02'),
    )
    assert.ok(director01 && director02)
    assert.equal(controller.setActivationDirector(director01.directorPathID), true)
    controller.seek(0)
    assert.deepEqual([bg1.visible, bg2.visible, bg3.visible], [true, false, false])
    controller.seek(13)
    assert.deepEqual([bg1.visible, bg2.visible, bg3.visible], [false, true, false])
    controller.seek(director01.duration)
    assert.deepEqual(
        [bg1.visible, bg2.visible, bg3.visible],
        [false, true, false],
        'LeaveAsIs must retain the final Bg02 ProcessFrame result',
    )

    assert.equal(controller.setActivationDirector(director02.directorPathID), true)
    controller.seek(0)
    assert.deepEqual([bg1.visible, bg2.visible, bg3.visible], [false, true, false])
    controller.seek(3)
    assert.deepEqual([bg1.visible, bg2.visible, bg3.visible], [false, false, true])
    controller.seek(director02.duration)
    assert.deepEqual([bg1.visible, bg2.visible, bg3.visible], [false, false, true])
    assert.equal(controller.setActivationDirector('missing-director'), false)
    assert.equal(
        controller.getDebugState().activation.selectedDirectorPathID,
        director02.directorPathID,
    )

    assert.equal(controller.setActivationDirector(undefined), true)
    assert.deepEqual([bg1.visible, bg2.visible, bg3.visible], [false, true, false])
    controller.dispose()
    assert.deepEqual([bg1.visible, bg2.visible, bg3.visible], [true, true, true])
})

test('generated Unity particle records bind exact hierarchy/material and share stage time', () => {
    assert.equal(particles.evaluateStageMinMaxCurve({
        minMaxState: 3,
        minScalar: 2,
        scalar: 6,
    }, 0.25), 3)
    assert.deepEqual(particles.evaluateStageMinMaxGradient({
        minMaxState: 2,
        minColor: [0, 0.25, 0.5, 0.75],
        maxColor: [1, 0.75, 0.5, 0.25],
    }, 0.25), [0.25, 0.375, 0.5, 0.625])
    const officialNoiseFixture = {
        enabled: true,
        frequency: 0.45,
        quality: 2,
        damping: true,
        octaves: 1,
        octaveMultiplier: 0.5,
        octaveScale: 2,
        scrollSpeed: { minMaxState: 0, scalar: 1 },
    }
    const highQualityNoise = particles.sampleStageParticleCurlNoise(
        [0.2, -0.4, 0.7],
        0.75,
        officialNoiseFixture,
        123,
    )
    assert.deepEqual(
        particles.sampleStageParticleCurlNoise(
            [0.2, -0.4, 0.7],
            0.75,
            officialNoiseFixture,
            123,
        ),
        highQualityNoise,
        'serialized seed/time/field sampling must be deterministic',
    )
    assert.ok(highQualityNoise.some(value => Math.abs(value) > 1e-6))
    assert.notDeepEqual(
        particles.sampleStageParticleCurlNoise(
            [0.2, -0.4, 0.7],
            0.75,
            { ...officialNoiseFixture, quality: 0 },
            123,
        ),
        highQualityNoise,
        'official Low=1D and High=3D quality paths must remain distinct',
    )

    const root = new THREE.Group()
    root.name = 'Root'
    const anchor = new THREE.Group()
    anchor.name = 'Particle System'
    root.add(anchor)

    const texture = new THREE.DataTexture(
        new Uint8Array([255, 255, 255, 255]),
        1,
        1,
    )
    texture.needsUpdate = true
    texture.userData.stageTextureBinding = { url: '/particle.png' }

    const controller = new runtime.StageRuntimeController(root, {
        autoplay: true,
        loop: true,
        timeScale: 1,
        particlePresets: [{
            id: 'preset',
            duration: 5,
            simulationSpeed: 1,
            looping: true,
            prewarm: false,
            playOnAwake: true,
            autoRandomSeed: false,
            randomSeed: 123,
            moveWithTransform: 0,
            scalingMode: 0,
            initial: {
                maxNumParticles: 4,
                startLifetime: { minMaxState: 0, scalar: 1 },
                startSpeed: { minMaxState: 0, scalar: 0 },
                gravityModifier: { minMaxState: 0, scalar: 0 },
                startSize: { minMaxState: 0, scalar: 1 },
                startRotation: { minMaxState: 0, scalar: 0 },
                startColor: { maxColor: [1, 1, 1, 1] },
            },
            emission: {
                rateOverTime: { minMaxState: 0, scalar: 2 },
            },
            shape: {
                type: 5,
                m_Position: [0, 0, 0],
                m_Rotation: [0, 0, 0],
                m_Scale: [1, 1, 1],
            },
            modules: {
                noise: {
                    ...officialNoiseFixture,
                    strength: { minMaxState: 0, scalar: 0.36 },
                    strengthY: { minMaxState: 0, scalar: 1 },
                    strengthZ: { minMaxState: 0, scalar: 1 },
                    separateAxes: false,
                    remapEnabled: false,
                    positionAmount: { minMaxState: 0, scalar: 1 },
                    rotationAmount: { minMaxState: 0, scalar: 0 },
                    sizeAmount: { minMaxState: 0, scalar: 0 },
                },
            },
            renderer: { sortingOrder: 7 },
        }],
        particleSystems: [{
            pathID: '1',
            hierarchyPath: 'Root/Particle System',
            active: true,
            presetId: 'preset',
            materials: ['particle-material'],
        }],
    }, undefined, [{
        materialName: 'particle-material',
        transparent: true,
        textures: {
            base: { url: '/particle.png' },
        },
    }], [texture])

    const initial = controller.getDebugState().particles
    assert.equal(initial.declaredSystemCount, 1)
    assert.equal(initial.inactiveSystemCount, 0)
    assert.equal(initial.nonDrawableSystemCount, 0)
    assert.equal(initial.drawableSystemCount, 1)
    assert.equal(initial.activeSystemCount, 1)
    assert.equal(initial.missingAnchorPaths.length, 0)
    assert.equal(initial.missingMaterialNames.length, 0)
    assert.equal(initial.randomSeedAuthority, 'serialized')
    assert.equal(initial.noiseModuleSystemCount, 1)
    assert.equal(initial.noiseModuleAppliedCount, 1)
    assert.deepEqual(initial.noiseQualityCounts, { '2:3D': 1 })
    assert.deepEqual(initial.unsupportedModules, [])
    assert.equal(anchor.children[0].name, 'UnityParticleSystem:1')
    assert.equal(anchor.children[0].renderOrder, 7)

    controller.update(0.5)
    assert.equal(controller.time, 0.5)
    assert.equal(controller.getDebugState().particles.activeParticleCount, 2)
    const positionValues = anchor.children[0].geometry.getAttribute('position').array
    assert.ok(
        [...positionValues.slice(0, 6)].some(value => Math.abs(value) > 1e-6),
        'serialized noise must alter an active particle position',
    )

    controller.dispose()
    assert.equal(anchor.children.length, 0)
    texture.dispose()
})

test('battle 601 consumes both serialized shooting-star trail slots and leaves no module fallback', () => {
    const presetsById = new Map(
        battle601Profile.runtime.particlePresets.map(preset => [preset.id, preset]),
    )
    const trailSystems = battle601Profile.runtime.particleSystems.filter(system =>
        presetsById.get(system.presetId)?.modules?.trails?.enabled === true)
    assert.equal(trailSystems.length, 2)
    assert.ok(trailSystems.every(system => system.materials.length === 2))
    assert.ok(trailSystems.every(system =>
        system.materials[0] === 'bg3d601_00_EffShootingStar_A'
        && system.materials[1] === 'bg3d601_00_EffShootingStar_B'))

    const root = new THREE.Group()
    root.name = 'bg_3d_601_00_01_001'
    for (const system of trailSystems) {
        let parent = root
        for (const segment of system.hierarchyPath.split('/').slice(1)) {
            let child = parent.children.find(candidate => candidate.name === segment)
            if (!child) {
                child = new THREE.Group()
                child.name = segment
                parent.add(child)
            }
            parent = child
        }
    }

    const controller = new particles.StageParticleRuntimeController(
        root,
        battle601Profile.runtime.particlePresets,
        trailSystems,
        battle601Profile.materialBindings,
        [],
    )
    const trails = []
    root.traverse(object => {
        if (object.name.startsWith('UnityParticleTrail:')) trails.push(object)
    })
    assert.equal(trails.length, 2)
    const maximumDrawCounts = new Map(trails.map(trail => [trail.name, 0]))
    let maximumActiveTrailSegments = 0
    const duration = Math.max(...trailSystems.map(system =>
        presetsById.get(system.presetId).duration))
    for (let phase = 1; phase <= 20; phase++) {
        controller.update(duration * phase / 20)
        maximumActiveTrailSegments = Math.max(
            maximumActiveTrailSegments,
            controller.getDebugState().activeTrailSegmentCount,
        )
        for (const trail of trails) {
            maximumDrawCounts.set(
                trail.name,
                Math.max(
                    maximumDrawCounts.get(trail.name),
                    trail.geometry.drawRange.count,
                ),
            )
        }
    }
    const debug = controller.getDebugState()
    assert.equal(debug.trailModuleSystemCount, 2)
    assert.equal(debug.trailModuleAppliedCount, 2)
    assert.ok(
        maximumActiveTrailSegments > 0,
        JSON.stringify(debug),
    )
    assert.deepEqual(debug.trailTextureModeCounts, { '0:stretch': 2 })
    assert.deepEqual(debug.missingTrailMaterialNames, [])
    assert.deepEqual(debug.unsupportedTrailModes, [])
    assert.deepEqual(debug.unsupportedModules, [])
    assert.ok([...maximumDrawCounts.values()].some(count => count > 0))

    for (const trail of trails) {
        assert.equal(
            trail.material.name,
            'StageParticleTrail:bg3d601_00_EffShootingStar_B',
        )
        const maximumDrawCount = maximumDrawCounts.get(trail.name)
        assert.equal(maximumDrawCount % 6, 0)
        for (const attribute of [
            'position',
            'stagePrevious',
            'stageNext',
            'stageSide',
            'stageWidth',
            'stageColor',
            'stageTrailUv',
        ]) {
            assert.ok(trail.geometry.getAttribute(attribute), `missing ${attribute}`)
        }
        if (maximumDrawCount > 0) {
            const sides = trail.geometry.getAttribute('stageSide').array.slice(
                0,
                maximumDrawCount,
            )
            assert.ok([...sides].every(value => value === -1 || value === 1))
            const widths = trail.geometry.getAttribute('stageWidth').array.slice(
                0,
                maximumDrawCount,
            )
            assert.ok([...widths].every(value => value > 0))
        }
    }
    controller.dispose()
    assert.equal(root.getObjectByName(`UnityParticleTrail:${trailSystems[0].pathID}`), undefined)
})

test('Memory story reports 20 declared systems and binds all 14 drawable active systems', () => {
    const root = new THREE.Group()
    root.name = 'bg3d_gallery_story'
    const ensurePath = value => {
        const segments = value.split('/')
        assert.equal(segments[0], root.name)
        let parent = root
        for (const segment of segments.slice(1)) {
            let child = parent.children.find(candidate => candidate.name === segment)
            if (!child) {
                child = new THREE.Group()
                child.name = segment
                parent.add(child)
            }
            parent = child
        }
    }
    for (const system of memoryStoryProfile.runtime.particleSystems) {
        if (system.active && system.materials.length > 0) {
            ensurePath(system.hierarchyPath)
        }
    }

    const depthTexture = new THREE.DepthTexture(64, 32)
    const depthRegistrations = []
    const depthRegistrar = {
        registerBackgroundDepthConsumer(consumer) {
            consumer.depthTextureUniform.value = depthTexture
            consumer.resolutionUniform.value.set(64, 32)
            const registration = { consumer, active: true }
            depthRegistrations.push(registration)
            return () => {
                registration.active = false
                consumer.depthTextureUniform.value = null
            }
        },
    }

    const controller = new runtime.StageRuntimeController(root, {
        autoplay: false,
        particlePresets: memoryStoryProfile.runtime.particlePresets,
        particleSystems: memoryStoryProfile.runtime.particleSystems,
        particleMeshes: memoryStoryProfile.runtime.particleMeshes,
    }, undefined, memoryStoryProfile.materialBindings, [], depthRegistrar)
    const debug = controller.getDebugState().particles
    assert.equal(debug.declaredSystemCount, 20)
    assert.equal(debug.inactiveSystemCount, 4)
    assert.equal(debug.nonDrawableSystemCount, 2)
    assert.equal(debug.drawableSystemCount, 14)
    assert.equal(debug.requestedSystemCount, 14)
    assert.deepEqual(debug.missingAnchorPaths, [])
    assert.deepEqual(debug.missingMaterialNames, [])
    assert.equal(debug.rendererModeCounts['4:mesh'], 6)
    assert.equal(debug.meshRendererSystemCount, 6)
    assert.equal(debug.meshRendererAppliedCount, 5)
    assert.equal(debug.noiseModuleSystemCount, 2)
    assert.equal(debug.noiseModuleAppliedCount, 2)
    assert.deepEqual(debug.noiseQualityCounts, { '2:3D': 2 })
    assert.equal(debug.trailModuleSystemCount, 0)
    assert.equal(debug.trailModuleAppliedCount, 0)
    assert.equal(debug.activeTrailSegmentCount, 0)
    assert.deepEqual(debug.trailTextureModeCounts, {})
    assert.equal(debug.softParticleDeclaredSystemCount, 9)
    assert.equal(debug.softParticleAppliedSystemCount, 9)
    assert.equal(debug.softParticleDepthConsumerCount, 9)
    assert.deepEqual(debug.depthFunctionCounts, {
        '4:less-equal': 13,
        '8:always': 1,
    })
    assert.deepEqual(
        [...new Set(debug.softParticleFields.map(field => field.surfaceFadeFar))]
            .sort((left, right) => left - right),
        [
            0.10000000149011612,
            0.20000000298023224,
            0.30000001192092896,
            0.4000000059604645,
            1,
            5,
        ],
    )
    assert.ok(debug.softParticleFields.every(field => (
        field.surfaceFadeNear === 0
        && field.depthRegistered
        && field.zTest === 4
    )))
    assert.equal(depthRegistrations.length, 9)
    assert.ok(depthRegistrations.every(({ consumer, active }) => (
        active
        && consumer.depthTextureUniform.value === depthTexture
        && consumer.resolutionUniform.value.equals(new THREE.Vector2(64, 32))
        && consumer.object.material.uniforms.uUseSoftParticle.value === 1
    )))
    assert.deepEqual(debug.missingTrailMaterialNames, [])
    assert.deepEqual(debug.unsupportedTrailModes, [])
    assert.deepEqual(debug.missingRendererMeshPathIDs, [])
    assert.deepEqual(debug.unsupportedShapeTypes, [])
    assert.deepEqual(debug.unsupportedModules, [])
    assert.equal(
        root.getObjectsByProperty('name', root.name).length,
        1,
    )
    const meshParticles = []
    root.traverse(object => {
        if (object.name.startsWith('UnityMeshParticleSystem:')) {
            meshParticles.push(object)
        }
    })
    assert.equal(meshParticles.length, 5)
    assert.ok(meshParticles.every(object => object.geometry.isInstancedBufferGeometry))
    controller.dispose()
    assert.ok(depthRegistrations.every(registration => !registration.active))
    assert.ok(depthRegistrations.every(
        registration => registration.consumer.depthTextureUniform.value === null,
    ))
    depthTexture.dispose()
})

test('Memory story reconstructs FBX-omitted particle anchors from serialized transforms', () => {
    const root = new THREE.Group()
    root.name = 'bg3d_gallery_story'
    const controller = new runtime.StageRuntimeController(root, {
        autoplay: false,
        particlePresets: memoryStoryProfile.runtime.particlePresets,
        particleSystems: memoryStoryProfile.runtime.particleSystems,
        particleMeshes: memoryStoryProfile.runtime.particleMeshes,
    }, undefined, memoryStoryProfile.materialBindings, [])
    const debug = controller.getDebugState().particles
    assert.equal(debug.drawableSystemCount, 14)
    assert.equal(debug.requestedSystemCount, 14)
    assert.deepEqual(debug.missingAnchorPaths, [])
    assert.equal(debug.carrierHierarchyFallbackCount, 0)
    assert.equal(debug.serializedTransformFallbackCount, 14)

    const anchors = root.children.filter(object =>
        object.name.startsWith('SerializedParticleAnchor:'))
    assert.equal(anchors.length, 14)
    const hikari = root.getObjectByName(
        'SerializedParticleAnchor:-4372603861926079263',
    )
    assert.ok(hikari)
    assert.deepEqual(hikari.position.toArray(), [0, 3, 0])
    assert.equal(hikari.children[0].name, 'UnityParticleSystem:-4372603861926079263')

    controller.dispose()
    assert.equal(
        root.children.filter(object =>
            object.name.startsWith('SerializedParticleAnchor:')).length,
        0,
    )
})
