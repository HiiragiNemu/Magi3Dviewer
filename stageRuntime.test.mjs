import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const nonce = `${process.pid}-${Date.now()}`
const mockPath = join(repositoryRoot, `.stage-runtime-renderer-${nonce}.mjs`)
const particleRuntimePath = join(
    repositoryRoot,
    `.stage-particle-runtime-under-test-${nonce}.mjs`,
)
const runtimePath = join(repositoryRoot, `.stage-runtime-under-test-${nonce}.mjs`)

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

const particleSourcePath = join(
    repositoryRoot,
    'src',
    'viewer',
    'stageParticleRuntime.ts',
)
const particleCompiled = ts.transpileModule(
    readFileSync(particleSourcePath, 'utf8'),
    {
        compilerOptions: {
            module: ts.ModuleKind.ES2022,
            target: ts.ScriptTarget.ES2022,
        },
        fileName: particleSourcePath,
    },
)
writeFileSync(particleRuntimePath, particleCompiled.outputText, 'utf8')

const sourcePath = join(repositoryRoot, 'src', 'viewer', 'stageRuntime.ts')
const source = readFileSync(sourcePath, 'utf8')
    .replace(
        "'magia-exedra-character-three/renderer'",
        `'./${basename(mockPath)}'`,
    )
    .replaceAll(
        "'./stageParticleRuntime'",
        `'./${basename(particleRuntimePath)}'`,
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
const rendererMock = await import(pathToFileURL(mockPath).href)

after(() => {
    rmSync(runtimePath, { force: true })
    rmSync(particleRuntimePath, { force: true })
    rmSync(mockPath, { force: true })
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

test('608 exact serialized particle evidence opts into an explicitly approximate runtime', () => {
    const root = new THREE.Group()
    root.name = 'Stage:battle-608-00-00-001'
    const loopCount = rendererMock.loops.length

    const controller = runtime.createStageRuntimeController(root, undefined)
    assert.ok(controller)
    assert.equal(rendererMock.loops.length, loopCount + 1)

    const particles = controller.getDebugState().particles
    assert.ok(particles)
    assert.equal(particles.source, 'official-jp-current-assetbundle')
    assert.equal(
        particles.fidelity,
        'serialized-parameter-driven-approximation',
    )
    assert.equal(particles.assetBundleRevision, '61ad830ca038a9efd58e67170a61c85e')
    assert.equal(particles.textureName, 'bg3d608_00_blue_bubble_col')
    assert.equal(
        particles.texturePixelSha256,
        '57fe4cf6e45c3061955dae3bfd8d923837a275085fa1678ada13f6f1d3471f1e',
    )
    assert.equal(particles.systemCount, 6)
    assert.equal(particles.maxParticles, 300)
    assert.equal(particles.loaded, false)
    assert.match(particles.loadError, /document unavailable/)
    assert.ok(particles.deferred.some(item => item.includes('autoRandomSeed')))

    controller.dispose()
    assert.equal(rendererMock.loops.length, loopCount)
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
