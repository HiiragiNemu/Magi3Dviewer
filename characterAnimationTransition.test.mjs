import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import * as THREE from 'three'

const artifactDirectory = path.resolve(
    'artifacts/verification/20260828-voice-scenario-motion-transition/runtime',
)
fs.mkdirSync(artifactDirectory, { recursive: true })
const bundledModule = path.join(artifactDirectory, 'character-under-test.mjs')

globalThis.window = {
    addEventListener() {},
}

await build({
    entryPoints: [path.resolve('magia-exedra-character-three/character.ts')],
    outfile: bundledModule,
    bundle: true,
    external: ['three'],
    format: 'esm',
    logLevel: 'silent',
    platform: 'node',
    target: 'es2022',
})

const { ChatacterAnimation } = await import(
    `${pathToFileURL(bundledModule).href}?transition-test=${Date.now()}`
)

function clip(name, duration, x) {
    return new THREE.AnimationClip(name, duration, [
        new THREE.VectorKeyframeTrack(
            '.position',
            [0, duration],
            [0, 0, 0, x, 0, 0],
        ),
    ])
}

function makeFixture() {
    const object = new THREE.Group()
    object.name = 'generic-scenario-transition-fixture'
    object.animations = [
        clip('HomeWait01_L', 4, 1),
        clip('HomeWait02_L', 5, 2),
    ]
    return {
        object,
        userData: {
            homeAnimationRuntime: {
                actions: {
                    unique01: {
                        startFamily: 'HomeUnique01_S',
                        loopFamily: 'HomeUnique01_L',
                        enterTransitionSeconds: 0.2,
                        startExitNormalizedTime: 1,
                        startToLoopTransitionSeconds: 0,
                    },
                },
            },
        },
    }
}

test('animation wrapper crossfades generic families at exact per-action local time', () => {
    const fixture = makeFixture()
    const animation = new ChatacterAnimation(fixture)
    const firstClip = fixture.object.animations[0]
    const secondClip = fixture.object.animations[1]

    animation.play('HomeWait01_L', true, { localTimeSeconds: 1 })
    const firstAction = animation.mixer.existingAction(firstClip)
    assert.ok(firstAction)
    assert.equal(firstAction.time, 1)
    animation.mixer.update(0.6)
    const mixerTimeBeforeTransition = animation.mixer.time

    animation.play('HomeWait02_L', true, {
        transitionSeconds: 0.2,
        localTimeSeconds: 2.5,
    })
    const secondAction = animation.mixer.existingAction(secondClip)
    assert.ok(secondAction)
    assert.equal(animation.current, 'HomeWait02_L')
    assert.equal(secondAction.time, 2.5)
    assert.equal(animation.time, 2.5)
    assert.equal(animation.mixer.time, mixerTimeBeforeTransition)
    assert.equal(firstAction.isRunning(), true)
    assert.equal(secondAction.isRunning(), true)

    animation.mixer.update(0.1)
    assert.ok(Math.abs(firstAction.getEffectiveWeight() - 0.5) < 1e-6)
    assert.ok(Math.abs(secondAction.getEffectiveWeight() - 0.5) < 1e-6)
})

test('zero-transition seek and cleanup stop old actions without resetting exact local time', () => {
    const fixture = makeFixture()
    const animation = new ChatacterAnimation(fixture)
    const firstClip = fixture.object.animations[0]
    const secondClip = fixture.object.animations[1]

    animation.play('HomeWait01_L', true)
    animation.play('HomeWait02_L', true, {
        transitionSeconds: 0.2,
        localTimeSeconds: 1.5,
    })
    const secondAction = animation.mixer.existingAction(secondClip)
    assert.ok(secondAction?.isRunning())

    animation.play('HomeWait01_L', true, {
        transitionSeconds: 0,
        localTimeSeconds: 3.25,
    })
    const firstAction = animation.mixer.existingAction(firstClip)
    assert.equal(firstAction?.time, 3.25)
    assert.equal(animation.time, 3.25)
    assert.equal(secondAction?.isRunning(), false)

    animation.play('MissingFamily', false, {
        transitionSeconds: 0.2,
        localTimeSeconds: 2,
    })
    assert.equal(animation.current, 'HomeWait01_L')
    assert.equal(animation.time, 3.25)

    animation.clear()
    assert.equal(animation.current, undefined)
    assert.equal(firstAction?.isRunning(), false)
})
