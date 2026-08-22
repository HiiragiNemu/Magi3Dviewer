import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import zlib from 'node:zlib'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import {
    attachHomeAnimationRuntime,
    CharacterExpressionController,
} from './magia-exedra-character-three/homeRuntime.ts'
import { resumeOrReplaySelectedAnimation } from './src/viewer/controls.ts'

globalThis.document = {
    createElementNS() {
        return {
            addEventListener() {},
            removeEventListener() {},
            set src(_value) {},
        }
    },
}

function parseFbxGzip(file) {
    const decoded = zlib.gunzipSync(fs.readFileSync(file))
    const buffer = decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength)
    return new FBXLoader().parse(buffer, '')
}

function objectPath(object) {
    const parts = []
    for (let current = object; current; current = current.parent) {
        parts.unshift(current.name || '<root>')
    }
    return parts.join('/')
}

function familyName(name) {
    return name
        .replace(/_weapon_[a-z0-9]+(?=_|$)/gi, '')
        .replace(/_\d+$/g, '')
}

function loadRuntimeCharacter(characterId) {
    const roots = [
        `magia-exedra-character-three/models/chara_${characterId}_battle_unit`,
        `magia-exedra-character-three/models/chara_${characterId}`,
    ]
    const base = roots.find(candidate => fs.existsSync(candidate))
    assert.ok(base, `missing Viewer model directory for ${characterId}`)
    const model = [
        `${base}/VisualRoot.fbx.gz`,
        `${base}/chara_${characterId}.fbx.gz`,
    ].find(candidate => fs.existsSync(candidate))
    assert.ok(model, `missing Viewer FBX for ${characterId}`)
    const root = parseFbxGzip(model)
    const animation = JSON.parse(zlib.gunzipSync(
        fs.readFileSync(`${base}/home-animations.json.gz`),
    ))
    const expression = JSON.parse(fs.readFileSync(`${base}/home-expressions.json`, 'utf8'))
    return { root, animation, expression }
}

test('official Home actions retarget every full hierarchy path and animate the production FBX', () => {
    for (const characterId of ['100107', '101901']) {
        const { root, animation } = loadRuntimeCharacter(characterId)
        const byPath = new Map()
        root.traverse(object => byPath.set(objectPath(object), object))

        const clips = animation.clips.map(serialized => {
            const tracks = serialized.tracks.map(track => {
                const separator = track.name.indexOf('.')
                const sourceId = track.name.slice(0, separator)
                const target = byPath.get(animation.nodePaths[sourceId])
                assert.ok(target, `${characterId} missing ${animation.nodePaths[sourceId]}`)
                return { ...track, name: `${target.uuid}${track.name.slice(separator)}` }
            })
            return THREE.AnimationClip.parse({ ...serialized, tracks })
        })

        assert.deepEqual(
            new Set(clips.map(clip => clip.name)),
            new Set([
                'HomeWait01_L',
                'HomeWait02_L',
                'HomeUnique01_L',
                'HomeUnique01_S',
                'HomeWeaponAHide',
            ]),
        )
        assert.ok(clips.find(clip => clip.name === 'HomeWait01_L').tracks.length >= 525)
        assert.equal(clips.find(clip => clip.name === 'HomeWeaponAHide').tracks.length, 2)

        const body = clips.find(clip => clip.name === 'HomeWait01_L')
        const changingTrack = body.tracks.find(track => (
            track.name.endsWith('.quaternion') && track.times.length > 3
        ))
        const target = root.getObjectByProperty('uuid', changingTrack.name.split('.')[0])
        const before = target.quaternion.toArray()
        const mixer = new THREE.AnimationMixer(root)
        mixer.clipAction(body).play()
        mixer.update(1)
        assert.notDeepEqual(target.quaternion.toArray(), before)
    }
})

test('Home facial registry exposes official expressions, blink timing and mouth curve', () => {
    for (const [characterId, morphCount] of [['100107', 60], ['101901', 66]]) {
        const { root, expression } = loadRuntimeCharacter(characterId)
        const faceMeshes = []
        root.traverse(object => {
            if (object.name === 'Face_Mesh' && object.morphTargetDictionary) {
                faceMeshes.push(object)
            }
        })
        assert.ok(faceMeshes.length > 0)
        assert.equal(expression.defaultExpression, 'Smile')
        assert.equal(expression.expressionOrder.length, 15)
        assert.equal(expression.morphTargetCount, morphCount)
        assert.equal(expression.aliases.HomeFace02_Smiling, 'Smiling')
        assert.deepEqual(expression.blink.weights, {
            Eyelid_Close_L: 1,
            Eyelid_Close_R: 1,
            Blink_Eyebrows_Down_L: 0.3,
            Blink_Eyebrows_Down_R: 0.3,
        })
        assert.equal(expression.blink.controller.fadeInSeconds, 0.05244868993759155)
        assert.equal(expression.mouth.curveTarget, 'Mouth_OpenVertically')
        assert.equal(expression.mouth.curveSegments.length, 4)
        assert.equal(expression.mouth.unresolvedAttributes.length, 2)

        const available = new Set(
            faceMeshes.flatMap(mesh => Object.keys(mesh.morphTargetDictionary)),
        )
        for (const definition of Object.values(expression.expressions)) {
            for (const name of Object.keys(definition.weights)) {
                assert.ok(available.has(name), `${characterId} expression target ${name}`)
            }
        }
        for (const name of Object.keys(expression.blink.weights)) {
            assert.ok(available.has(name), `${characterId} blink target ${name}`)
        }
    }
})

test('expression selector exposes only distinct morph snapshots for each character', () => {
    for (const [characterId, expected] of [
        ['100107', 10],
        ['101901', ['Smile', 'Smiling', 'Annoyed', 'Sorrow', 'Surprised']],
    ]) {
        const { root, expression } = loadRuntimeCharacter(characterId)
        const meshes = []
        root.traverse(object => {
            if (object.morphTargetDictionary && object.morphTargetInfluences) {
                meshes.push(object)
            }
        })
        const controller = new CharacterExpressionController(meshes, expression)
        if (Array.isArray(expected)) {
            assert.deepEqual(controller.expressions, expected)
        } else {
            assert.equal(controller.expressions.length, expected)
        }

        // Hidden duplicate state names remain valid for official controller
        // transitions and imported presets even when the UI omits them.
        if (characterId === '101901') {
            controller.set('Sadness')
            assert.equal(controller.current, 'Sadness')
        }
    }
})

test('official static FaceLayer selection remains mutually exclusive with automatic blink', () => {
    const evidence = JSON.parse(fs.readFileSync(
        'research/official-home-animation-expression-evidence.json',
        'utf8',
    ))
    const controller = evidence.characters['10010701'].home.controller
    const faceLayer = controller.layers.find(layer => layer.name === 'FaceLayer')
    assert.ok(faceLayer)
    assert.equal(faceLayer.blendingMode, 0)
    assert.ok(faceLayer.states.some(state => state.name === 'Home_Eye_Blink'))
    assert.ok(faceLayer.states.some(state => state.name === 'Face02_Smiling'))
    assert.equal(
        controller.layers.some(layer => (
            layer.name !== 'FaceLayer'
            && layer.states.some(state => state.name === 'Home_Eye_Blink')
        )),
        false,
    )

    const runtime = fs.readFileSync(
        'magia-exedra-character-three/homeRuntime.ts',
        'utf8',
    )
    assert.match(runtime, /'expression-auto-blink'/)
    assert.match(runtime, /\? 'expression-auto-blink'\s*:\s*'expression'/)
    assert.match(runtime, /this\.faceLayerState = 'automatic-blink'/)
    assert.match(runtime, /this\.faceLayerState === 'expression'/)
})

test('selected closed-eye expression never receives the automatic blink morphs over time', () => {
    const names = [
        'Eyelid_Close_Smile_L',
        'Eyelid_Close_Smile_R',
        'Eyelid_Close_L',
        'Eyelid_Close_R',
        'Blink_Eyebrows_Down_L',
        'Blink_Eyebrows_Down_R',
    ]
    const mesh = new THREE.Mesh()
    mesh.morphTargetDictionary = Object.fromEntries(names.map((name, index) => [name, index]))
    mesh.morphTargetInfluences = names.map(() => 0)
    const runtime = {
        schema: 1,
        characterId: 100107,
        unityVersion: '2022.3.62f2',
        source: 'synthetic official-layer regression',
        defaultExpression: 'Smile',
        morphTargetCount: names.length,
        expressionOrder: ['Smile', 'Smiling'],
        aliases: { HomeFace02_Smiling: 'Smiling' },
        expressions: {
            Smile: { duration: 0, weights: {} },
            Smiling: {
                duration: 0,
                weights: {
                    Eyelid_Close_Smile_L: 1,
                    Eyelid_Close_Smile_R: 1,
                },
            },
        },
        blink: {
            duration: 0.1,
            weights: {
                Eyelid_Close_L: 1,
                Eyelid_Close_R: 1,
                Blink_Eyebrows_Down_L: 0.3,
                Blink_Eyebrows_Down_R: 0.3,
            },
            controller: {
                emptyExitTime: 0.1,
                fadeInSeconds: 0.05,
                blinkExitTime: 0.5,
                fadeOutSeconds: 0.05,
                afterBlinkExitTime: 0.2,
                afterBlinkTransitionSeconds: 0.1,
                intervalSpeed: 1,
                intervalExitTime: 0.5,
                intervalTransitionSeconds: 0.1,
            },
        },
        mouth: {
            duration: 1,
            curveTarget: null,
            curveSegments: [],
            constantWeights: {},
            unresolvedAttributes: [],
        },
    }
    const controller = new CharacterExpressionController([mesh], runtime)
    assert.equal(controller.supportsAutomaticBlink('HomeFace02_Smiling'), false)
    controller.set('HomeFace02_Smiling', true)
    assert.equal(controller.automaticBlinkActive, false)
    assert.equal(controller.expressionAutoBlinkActive, false)

    for (const delta of [0.12, 0.04, 0.06, 0.7, 1.5, 4.2]) {
        controller.update(delta)
        assert.equal(mesh.morphTargetInfluences[0], 1)
        assert.equal(mesh.morphTargetInfluences[1], 1)
        assert.equal(mesh.morphTargetInfluences[2], 0)
        assert.equal(mesh.morphTargetInfluences[3], 0)
        assert.equal(mesh.morphTargetInfluences[4], 0)
        assert.equal(mesh.morphTargetInfluences[5], 0)
    }

    controller.resetToDefault()
    controller.update(0.125)
    assert.equal(controller.automaticBlinkActive, true)
    assert.ok(mesh.morphTargetInfluences[2] > 0)
    assert.ok(mesh.morphTargetInfluences[3] > 0)
})

test('open-eye expression auto-blink variant preserves the face and replaces conflicting eyelid channels', () => {
    const names = [
        'Eyelid_Close_Smile_L',
        'Eyelid_Close_Smile_R',
        'Eyelid_Open_L',
        'Eyelid_Open_R',
        'Eyelid_Close_L',
        'Eyelid_Close_R',
        'Blink_Eyebrows_Down_L',
        'Blink_Eyebrows_Down_R',
        'Mouth_Smile',
        'Eyelid_Anger_L',
        'Eyelid_Anger_R',
    ]
    const mesh = new THREE.Mesh()
    mesh.morphTargetDictionary = Object.fromEntries(names.map((name, index) => [name, index]))
    mesh.morphTargetInfluences = names.map(() => 0)
    const runtime = {
        schema: 1,
        characterId: 999998,
        unityVersion: '2022.3.62f2',
        source: 'synthetic expression auto-blink regression',
        defaultExpression: 'Smile',
        morphTargetCount: names.length,
        expressionOrder: ['Smile', 'Annoyed'],
        aliases: {},
        expressions: {
            Smile: { duration: 0, weights: {} },
            Annoyed: {
                duration: 0,
                weights: {
                    Eyelid_Close_Smile_L: 0.2,
                    Eyelid_Close_Smile_R: 0.2,
                    Eyelid_Open_L: 0.3,
                    Eyelid_Open_R: 0.3,
                    Mouth_Smile: 0.7,
                    Eyelid_Anger_L: 0.4,
                    Eyelid_Anger_R: 0.4,
                },
            },
        },
        blink: {
            duration: 0.1,
            weights: {
                Eyelid_Close_L: 1,
                Eyelid_Close_R: 1,
                Blink_Eyebrows_Down_L: 0.3,
                Blink_Eyebrows_Down_R: 0.3,
            },
            controller: {
                emptyExitTime: 0.1,
                fadeInSeconds: 0.05,
                blinkExitTime: 0.5,
                fadeOutSeconds: 0.05,
                afterBlinkExitTime: 0.2,
                afterBlinkTransitionSeconds: 0.1,
                intervalSpeed: 1,
                intervalExitTime: 0.5,
                intervalTransitionSeconds: 0.1,
            },
        },
        mouth: {
            duration: 1,
            curveTarget: null,
            curveSegments: [],
            constantWeights: {},
            unresolvedAttributes: [],
        },
    }
    const controller = new CharacterExpressionController([mesh], runtime)
    assert.equal(controller.supportsAutomaticBlink('Annoyed'), true)
    controller.set('Annoyed', true)
    assert.equal(controller.expressionAutoBlinkActive, true)
    assert.equal(mesh.morphTargetInfluences[8], 0.7)
    assert.equal(mesh.morphTargetInfluences[9], 0.4)
    assert.equal(mesh.morphTargetInfluences[10], 0.4)

    controller.update(0.125)
    assert.ok(Math.abs(mesh.morphTargetInfluences[0] - 0.1) < 1e-12)
    assert.ok(Math.abs(mesh.morphTargetInfluences[2] - 0.15) < 1e-12)
    assert.ok(Math.abs(mesh.morphTargetInfluences[4] - 0.5) < 1e-12)
    assert.ok(Math.abs(mesh.morphTargetInfluences[6] - 0.15) < 1e-12)
    assert.equal(mesh.morphTargetInfluences[8], 0.7)
    assert.ok(Math.abs(mesh.morphTargetInfluences[9] - 0.2) < 1e-12)
    assert.ok(Math.abs(mesh.morphTargetInfluences[10] - 0.2) < 1e-12)

    controller.update(0.025)
    assert.ok(Math.abs(mesh.morphTargetInfluences[0]) < 1e-12)
    assert.ok(Math.abs(mesh.morphTargetInfluences[2]) < 1e-12)
    assert.ok(Math.abs(mesh.morphTargetInfluences[4] - 1) < 1e-12)
    assert.ok(Math.abs(mesh.morphTargetInfluences[6] - 0.3) < 1e-12)
    assert.equal(mesh.morphTargetInfluences[8], 0.7)
    assert.ok(Math.abs(mesh.morphTargetInfluences[9]) < 1e-12)
    assert.ok(Math.abs(mesh.morphTargetInfluences[10]) < 1e-12)
})

test('manual face controls use character bindings and preserve closed-eye expressions', () => {
    const names = [
        'Eyelid_Anger_L',
        'Eyelid_Anger_R',
        'Eyelid_Close_Smile_L',
        'Eyelid_Close_Smile_R',
        'Eyelid_Close_L',
        'Eyelid_Close_R',
        'Blink_Eyebrows_Down_L',
        'Blink_Eyebrows_Down_R',
        'Mouth_Up_L',
        'Mouth_Up_R',
        'Mouth_Down_L',
        'Mouth_Down_R',
    ]
    const mesh = new THREE.Mesh()
    mesh.morphTargetDictionary = Object.fromEntries(names.map((name, index) => [name, index]))
    mesh.morphTargetInfluences = names.map(() => 0)
    const runtime = {
        schema: 1,
        characterId: 999997,
        unityVersion: '2022.3.62f2',
        source: 'synthetic per-character manual face controls',
        defaultExpression: 'Smile',
        morphTargetCount: names.length,
        expressionOrder: ['Smile', 'Annoyed', 'Smiling'],
        aliases: {},
        expressions: {
            Smile: {
                duration: 0,
                weights: { Mouth_Up_L: 0.2, Mouth_Up_R: 0.2 },
            },
            Annoyed: {
                duration: 0,
                weights: {
                    Eyelid_Anger_L: 0.4,
                    Eyelid_Anger_R: 0.4,
                    Mouth_Down_L: 0.6,
                    Mouth_Down_R: 0.6,
                },
            },
            Smiling: {
                duration: 0,
                weights: {
                    Eyelid_Close_Smile_L: 1,
                    Eyelid_Close_Smile_R: 1,
                    Mouth_Up_L: 1,
                    Mouth_Up_R: 1,
                },
            },
        },
        blink: {
            duration: 0.1,
            weights: {
                Eyelid_Close_L: 1,
                Eyelid_Close_R: 1,
                Blink_Eyebrows_Down_L: 0.3,
                Blink_Eyebrows_Down_R: 0.3,
            },
            controller: {
                emptyExitTime: 0.1,
                fadeInSeconds: 0.05,
                blinkExitTime: 0.5,
                fadeOutSeconds: 0.05,
                afterBlinkExitTime: 0.2,
                afterBlinkTransitionSeconds: 0.1,
                intervalSpeed: 1,
                intervalExitTime: 0.5,
                intervalTransitionSeconds: 0.1,
            },
        },
        mouth: {
            duration: 1,
            curveTarget: null,
            curveSegments: [],
            constantWeights: {},
            unresolvedAttributes: [],
        },
    }
    const controller = new CharacterExpressionController([mesh], runtime)
    assert.equal(controller.manualBlinkAvailable, true)
    assert.equal(controller.mouthCornerControlAvailable, true)

    controller.setExpressionTransitionSeconds(1)
    controller.set('Annoyed')
    assert.equal(mesh.morphTargetInfluences[8], 0.2)
    assert.equal(mesh.morphTargetInfluences[10], 0)
    controller.update(0.5)
    assert.ok(Math.abs(mesh.morphTargetInfluences[0] - 0.2) < 1e-12)
    assert.ok(Math.abs(mesh.morphTargetInfluences[8] - 0.1) < 1e-12)
    assert.ok(Math.abs(mesh.morphTargetInfluences[10] - 0.3) < 1e-12)
    controller.update(0.5)
    assert.equal(mesh.morphTargetInfluences[0], 0.4)
    assert.equal(mesh.morphTargetInfluences[8], 0)
    assert.equal(mesh.morphTargetInfluences[10], 0.6)

    controller.setExpressionWeight(0.5)
    assert.equal(mesh.morphTargetInfluences[0], 0.2)
    assert.equal(mesh.morphTargetInfluences[8], 0.1)
    assert.equal(mesh.morphTargetInfluences[10], 0.3)

    controller.setManualBlinkWeight(0.5)
    assert.equal(mesh.morphTargetInfluences[4], 0.5)
    assert.equal(mesh.morphTargetInfluences[5], 0.5)
    assert.equal(mesh.morphTargetInfluences[6], 0.15)
    assert.equal(mesh.morphTargetInfluences[7], 0.15)
    assert.equal(mesh.morphTargetInfluences[0], 0.1)

    controller.setMouthCornerWeight(0.5)
    assert.equal(mesh.morphTargetInfluences[8], 0.55)
    assert.equal(mesh.morphTargetInfluences[10], 0.15)
    controller.setMouthCornerWeight(-0.5)
    assert.equal(mesh.morphTargetInfluences[8], 0.05)
    assert.equal(mesh.morphTargetInfluences[10], 0.65)

    controller.setExpressionTransitionSeconds(0)
    controller.setExpressionWeight(1)
    controller.set('Smiling')
    controller.setManualBlinkWeight(1)
    assert.equal(controller.manualBlinkAvailable, false)
    assert.equal(mesh.morphTargetInfluences[2], 1)
    assert.equal(mesh.morphTargetInfluences[3], 1)
    assert.equal(mesh.morphTargetInfluences[4], 0)
    assert.equal(mesh.morphTargetInfluences[5], 0)

    controller.set('Annoyed')
    controller.setAutomaticBlink(true)
    assert.equal(controller.expressionAutoBlinkActive, true)
    controller.setAutomaticBlink(false)
    assert.equal(controller.expressionAutoBlinkActive, false)
})

test('Viewer exposes localized manual blink, expression blend, transition and mouth-corner controls', () => {
    const html = fs.readFileSync('index.html', 'utf8')
    const viewer = fs.readFileSync('src/viewer/index.ts', 'utf8')
    const locale = fs.readFileSync('src/viewer/localization/zhCN.ts', 'utf8')
    for (const id of [
        'expression-auto-blink',
        'expression-manual-blink',
        'expression-strength',
        'expression-transition',
        'expression-mouth-corner',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`))
    }
    assert.match(viewer, /setAutomaticBlink\(expressionAutoBlink\.checked\)/)
    assert.match(viewer, /setManualBlinkWeight/)
    assert.match(viewer, /setExpressionWeight/)
    assert.match(viewer, /setExpressionTransitionSeconds/)
    assert.match(viewer, /setMouthCornerWeight/)
    assert.match(locale, /'Manual blink': '手动闭眼'/)
    assert.match(locale, /'Expression strength': '表情幅度'/)
    assert.match(locale, /'Transition': '过渡时间'/)
    assert.match(locale, /'Mouth corner': '嘴角'/)
})

test('official signed and over-one expression weights survive the Viewer controller exactly', () => {
    const cases = [
        ['100207', 'Smile', 'Blink_Eyebrows_Down_L', -1],
        ['112601', 'Smile', 'Tooth_Back', 2],
    ]
    for (const [characterId, expressionName, channel, expected] of cases) {
        const { root, expression } = loadRuntimeCharacter(characterId)
        const meshes = []
        root.traverse(object => {
            if (object.morphTargetDictionary?.[channel] != undefined) meshes.push(object)
        })
        assert.ok(meshes.length > 0, `${characterId} has ${channel}`)
        const controller = new CharacterExpressionController(meshes, expression)
        controller.set(expressionName)
        for (const mesh of meshes) {
            const index = mesh.morphTargetDictionary[channel]
            assert.equal(mesh.morphTargetInfluences[index], expected)
        }
    }
})

test('Face and Mouth Override layers replace keyed channels instead of max-compositing them', () => {
    const names = ['Blink', 'Signed', 'OverOne', 'MouthCurve', 'MouthConstant']
    const mesh = new THREE.Mesh()
    mesh.morphTargetDictionary = Object.fromEntries(names.map((name, index) => [name, index]))
    mesh.morphTargetInfluences = names.map(() => 0)
    const runtime = {
        schema: 1,
        characterId: 999999,
        unityVersion: '2022.3.62f2',
        source: 'synthetic official Override-layer regression',
        defaultExpression: 'Default',
        morphTargetCount: names.length,
        expressionOrder: ['Default', 'Selected'],
        aliases: {},
        expressions: {
            Default: {
                duration: 0,
                weights: {
                    Blink: 0.2,
                    Signed: -1,
                    OverOne: 2,
                    MouthCurve: 0.75,
                    MouthConstant: 0.25,
                },
            },
            Selected: { duration: 0, weights: { Signed: -0.5 } },
        },
        blink: {
            duration: 0.1,
            weights: { Blink: 1 },
            controller: {
                emptyExitTime: 0.1,
                fadeInSeconds: 0.05,
                blinkExitTime: 0.5,
                fadeOutSeconds: 0.05,
                afterBlinkExitTime: 0.2,
                afterBlinkTransitionSeconds: 0.1,
                intervalSpeed: 1,
                intervalExitTime: 0.5,
                intervalTransitionSeconds: 0.1,
            },
        },
        mouth: {
            duration: 1,
            curveTarget: 'MouthCurve',
            curveSegments: [{ time: 0, coeff: [0, 0, 0, 50] }],
            constantWeights: { MouthConstant: -0.5 },
            unresolvedAttributes: [],
        },
    }
    const controller = new CharacterExpressionController([mesh], runtime)
    assert.equal(mesh.morphTargetInfluences[1], -1)
    assert.equal(mesh.morphTargetInfluences[2], 2)

    controller.update(0.125)
    assert.ok(Math.abs(mesh.morphTargetInfluences[0] - 0.6) < 1e-12)

    controller.mouthOpen = true
    controller.update(0)
    assert.equal(mesh.morphTargetInfluences[3], 0.5)
    assert.equal(mesh.morphTargetInfluences[4], -0.5)

    controller.mouthOpen = false
    controller.set('Selected')
    assert.equal(mesh.morphTargetInfluences[1], -0.5)
    assert.equal(mesh.morphTargetInfluences[2], 0)
    assert.equal(mesh.morphTargetInfluences[0], 0)
})

test('Viewer loads Home runtimes before character construction and exposes both selectors', () => {
    const loader = fs.readFileSync('magia-exedra-character-three/loader.ts', 'utf8')
    const character = fs.readFileSync('magia-exedra-character-three/character.ts', 'utf8')
    const viewerFiles = fs.readFileSync('src/viewer/character.ts', 'utf8')
    const viewer = fs.readFileSync('src/viewer/index.ts', 'utf8')
    const html = fs.readFileSync('index.html', 'utf8')

    assert.match(loader, /attachHomeAnimationRuntime\(modelObject, animationRuntime\)/)
    assert.match(loader, /homeExpressionRuntime,\s*\n\s*}/)
    assert.match(character, /new CharacterExpressionController/)
    assert.match(character, /x === 'HomeWait01_L'/)
    assert.match(character, /\^HomeWeapon\.\*Hide\$/)
    assert.match(character, /event\.action === this\._queuedHomeGateAction/)
    assert.match(character, /enterTransitionSeconds/)
    assert.match(viewerFiles, /home-\*\.json\*/)
    assert.match(viewer, /character\.expression\.expressions/)
    assert.match(viewer, /character\.expression\?\.resetToDefault\(\)/)
    assert.doesNotMatch(viewer, /expressionAutoBlinkPrefix/)
    assert.match(viewer, /expressionAutoBlink\.onchange/)
    assert.match(viewer, /setAutomaticBlink\(expressionAutoBlink\.checked\)/)
    assert.match(viewer, /expressionAutoBlink\.disabled = !expression\.automaticBlinkAvailable/)
    assert.match(viewer, /expressionAutoBlink\.checked = expression\.autoBlink/)
    assert.match(viewer, /character\.expression\?\.set\(value, expressionAutoBlink\.checked\)/)
    assert.match(html, /id="expression-auto-blink"/)
    assert.match(viewer, /animation\.paused \|\| animation\.clamped/)
    assert.match(html, /id="expression-selector"/)
})

test('animation play control restarts a clamped one-shot and only resumes an unfinished action', () => {
    const replayCalls = []
    const finished = {
        paused: false,
        clamped: true,
        play(name, loop) {
            replayCalls.push({ name, loop })
        },
    }

    resumeOrReplaySelectedAnimation(finished, 'HomeUnique01_SE')
    assert.deepEqual(replayCalls, [{ name: 'HomeUnique01_SE', loop: false }])

    const resumeCalls = []
    const paused = {
        paused: true,
        clamped: false,
        play(name, loop) {
            resumeCalls.push({ name, loop })
        },
    }

    resumeOrReplaySelectedAnimation(paused, 'HomeWait01_L')
    assert.equal(paused.paused, false)
    assert.deepEqual(resumeCalls, [])
})

test('legacy Viewer root prefixes retarget by an unambiguous character-local hierarchy', () => {
    const { root, animation } = loadRuntimeCharacter('100102')
    assert.equal(root.name, '100102')
    const clips = attachHomeAnimationRuntime(root, animation)
    assert.deepEqual(
        new Set(clips.map(clip => clip.name)),
        new Set(['HomeWait01_L', 'HomeWait02_L', 'HomeUnique01_S', 'HomeUnique01_L']),
    )
    assert.equal(clips.every(clip => clip.tracks.length === 435), true)
})

test('Home runtimes cover every Viewer character with an available local JP bundle', () => {
    const modelRoot = 'magia-exedra-character-three/models'
    const directories = fs.readdirSync(modelRoot, { withFileTypes: true })
        .filter(entry => /^chara_\d{6}(?:_battle_unit)?$/.test(entry.name))
    const covered = []
    for (const directory of directories) {
        const characterId = Number(directory.name.slice(6, 12))
        const base = `${modelRoot}/${directory.name}`
        const animationPath = `${base}/home-animations.json.gz`
        const expressionPath = `${base}/home-expressions.json`
        if (!fs.existsSync(animationPath) || !fs.existsSync(expressionPath)) continue
        const animation = JSON.parse(zlib.gunzipSync(fs.readFileSync(animationPath)))
        const expression = JSON.parse(fs.readFileSync(expressionPath, 'utf8'))
        const model = [
            `${base}/VisualRoot.fbx.gz`,
            `${base}/chara_${characterId}.fbx.gz`,
        ].find(candidate => fs.existsSync(candidate))
        assert.ok(model, `${characterId} missing Viewer FBX`)
        const root = parseFbxGzip(model)
        assert.equal(animation.characterId, characterId)
        assert.equal(expression.characterId, characterId)
        assert.equal(animation.unityVersion, '2022.3.62f2')
        assert.equal(expression.unityVersion, '2022.3.62f2')
        assert.ok([1, 2].includes(animation.schema))
        assert.ok(animation.clips.some(clip => clip.name === 'HomeWait01_L'))
        assert.equal(animation.actions.unique01.enterTransitionSeconds, 0.2)
        assert.equal(animation.actions.unique01.startExitNormalizedTime, 1)
        assert.equal(animation.actions.unique01.startToLoopTransitionSeconds, 0)
        if (animation.schema === 2) {
            const identities = new Map(animation.clipIdentities.map(identity => [
                identity.sourceClipPathId,
                identity,
            ]))
            for (const [importedName, sourceClipPathId] of [
                [animation.actions.wait01.loopFamily, animation.actions.wait01.sourceClipPathId],
                [animation.actions.wait02.loopFamily, animation.actions.wait02.sourceClipPathId],
                [animation.actions.unique01.startFamily, animation.actions.unique01.startSourceClipPathId],
                [animation.actions.unique01.loopFamily, animation.actions.unique01.loopSourceClipPathId],
            ]) {
                const identity = identities.get(sourceClipPathId)
                assert.ok(identity, `${characterId} missing exact source clip ${sourceClipPathId}`)
                assert.equal(identity.importedName, importedName)
                assert.ok(identity.transformTrackCount > 0)
                assert.ok(animation.clips.some(clip => clip.name === importedName))
            }
        }

        const clips = attachHomeAnimationRuntime(root, animation)
        const families = new Set(clips.map(clip => familyName(clip.name)))
        for (const required of [
            animation.actions.wait01.loopFamily,
            animation.actions.wait02.loopFamily,
            animation.actions.unique01.startFamily,
            animation.actions.unique01.loopFamily,
            ...animation.helpers,
        ]) {
            assert.ok(
                families.has(familyName(required)),
                `${characterId} missing Home family ${required}`,
            )
        }

        const availableMorphs = new Set()
        root.traverse(object => {
            for (const name of Object.keys(object.morphTargetDictionary ?? {})) {
                availableMorphs.add(name)
            }
        })
        for (const definition of Object.values(expression.expressions)) {
            for (const name of Object.keys(definition.weights)) {
                assert.ok(availableMorphs.has(name), `${characterId} expression target ${name}`)
            }
        }
        for (const name of [
            ...Object.keys(expression.blink.weights),
            ...Object.keys(expression.mouth.constantWeights),
            ...(expression.mouth.curveTarget ? [expression.mouth.curveTarget] : []),
        ]) {
            assert.ok(availableMorphs.has(name), `${characterId} face-controller target ${name}`)
        }
        const morphMeshes = []
        root.traverse(object => {
            if (object.morphTargetDictionary && object.morphTargetInfluences) {
                morphMeshes.push(object)
            }
        })
        const expressionController = new CharacterExpressionController(
            morphMeshes,
            expression,
        )
        for (const name of expressionController.expressions) {
            const hasClosedEye = Object.entries(
                expression.expressions[name].weights,
            ).some(([morphName, weight]) => (
                availableMorphs.has(morphName)
                && weight >= 0.8
                && /^Eyelid_Close(?:_[A-Za-z0-9]+)?_[LR]$/.test(morphName)
            ))
            assert.equal(
                expressionController.supportsAutomaticBlink(name),
                !!expression.blink.controller && !hasClosedEye,
                `${characterId} automatic-blink eligibility for ${name}`,
            )
        }
        if (characterId === 108001 || characterId === 113901) {
            assert.equal(expressionController.supportsAutomaticBlink('Damage'), false)
        }
        if (characterId === 114901 || characterId === 115201) {
            assert.equal(
                expressionController.expressions.some(name => (
                    expressionController.supportsAutomaticBlink(name)
                )),
                false,
            )
        }
        const visibleSignatures = expressionController.expressions.map(name => (
            JSON.stringify([...availableMorphs].sort().map(morphName => (
                expression.expressions[name].weights[morphName] ?? 0
            )))
        ))
        assert.equal(
            new Set(visibleSignatures).size,
            visibleSignatures.length,
            `${characterId} duplicate visible expression snapshot`,
        )
        assert.ok(expression.expressions[expression.defaultExpression])
        assert.ok(expression.expressionOrder.length >= 1)
        covered.push(characterId)
    }
    assert.equal(covered.length, 91)
    assert.equal(covered.includes(100101), true)
    assert.equal(covered.includes(100102), true)

    const noAutomaticBlink = JSON.parse(fs.readFileSync(
        `${modelRoot}/chara_114901_battle_unit/home-expressions.json`,
        'utf8',
    ))
    assert.equal(noAutomaticBlink.blink.controller, null)
    const specialFace = JSON.parse(fs.readFileSync(
        `${modelRoot}/chara_115201_battle_unit/home-expressions.json`,
        'utf8',
    ))
    assert.ok(specialFace.blink.unresolvedAttributes.length > 0)

    const specialTargets = [
        ['113801', 'Pupil_Upset_NohighlightShape'],
        ['113901', 'Unique_02_Nohighlight'],
        ['115201', 'Faceparts_Front_Close_Smile'],
    ]
    for (const [characterId, target] of specialTargets) {
        const { expression } = loadRuntimeCharacter(characterId)
        assert.ok(Object.values(expression.expressions).some(definition => (
            Object.hasOwn(definition.weights, target)
        )), `${characterId} normalized special morph ${target}`)
    }

    const specialActions = new Map([
        ['100504', ['mogumogu_HomeUnique01_SE', 'HomeWeaponAHide']],
        ['100503', ['HomeUnique01_S', 'HomeWeaponAHide']],
        ['109801', ['HomeUnique01_S', 'HomeWeaponCHide']],
        ['115201', ['HomeUnique01_L', 'HomeWeaponCHide']],
        ['100301', ['HomeUnique01_S', 'HomeWeaponBHide']],
    ])
    for (const [characterId, [sourceName, helper]] of specialActions) {
        const { animation } = loadRuntimeCharacter(characterId)
        const identity = animation.clipIdentities.find(item => (
            item.sourceClipPathId === animation.actions.unique01.startSourceClipPathId
        ))
        assert.ok(identity, `${characterId} missing selected start identity`)
        assert.equal(identity.sourceName, sourceName)
        assert.equal(identity.importedName, animation.actions.unique01.startFamily)
        assert.ok(animation.helpers.includes(helper), `${characterId} helper ${helper}`)
    }
    const externalWeapon = loadRuntimeCharacter('100503').animation
    assert.ok(externalWeapon.externalHelpers.some(name => familyName(name) === 'HomeWeaponC_SPHide'))
})
