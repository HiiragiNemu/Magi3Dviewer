import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import zlib from 'node:zlib'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { CharacterExpressionController } from './magia-exedra-character-three/homeRuntime.ts'

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
    const base = `magia-exedra-character-three/models/chara_${characterId}_battle_unit`
    const root = parseFbxGzip(`${base}/VisualRoot.fbx.gz`)
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

test('official FaceLayer makes automatic blink and selected expressions mutually exclusive', () => {
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
    assert.match(runtime, /faceLayerState: 'automatic-blink' \| 'expression'/)
    assert.match(runtime, /this\.faceLayerState = 'expression'/)
    assert.match(runtime, /this\.faceLayerState = 'automatic-blink'/)
    assert.match(runtime, /this\.faceLayerState !== 'automatic-blink'/)
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
    controller.set('HomeFace02_Smiling')
    assert.equal(controller.automaticBlinkActive, false)

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
    assert.match(html, /id="expression-selector"/)
})

test('Home runtimes cover every Viewer character with an available local JP bundle', () => {
    const modelRoot = 'magia-exedra-character-three/models'
    const directories = fs.readdirSync(modelRoot, { withFileTypes: true })
        .filter(entry => /^chara_\d{6}_battle_unit$/.test(entry.name))
    const covered = []
    for (const directory of directories) {
        const characterId = Number(directory.name.slice(6, 12))
        const base = `${modelRoot}/${directory.name}`
        const animationPath = `${base}/home-animations.json.gz`
        const expressionPath = `${base}/home-expressions.json`
        if (!fs.existsSync(animationPath) || !fs.existsSync(expressionPath)) continue
        const animation = JSON.parse(zlib.gunzipSync(fs.readFileSync(animationPath)))
        const expression = JSON.parse(fs.readFileSync(expressionPath, 'utf8'))
        const root = parseFbxGzip(`${base}/VisualRoot.fbx.gz`)
        assert.equal(animation.characterId, characterId)
        assert.equal(expression.characterId, characterId)
        assert.equal(animation.unityVersion, '2022.3.62f2')
        assert.equal(expression.unityVersion, '2022.3.62f2')
        assert.ok(animation.clips.some(clip => clip.name === 'HomeWait01_L'))
        assert.equal(animation.actions.unique01.enterTransitionSeconds, 0.2)
        assert.equal(animation.actions.unique01.startExitNormalizedTime, 1)
        assert.equal(animation.actions.unique01.startToLoopTransitionSeconds, 0)

        const referencedPaths = new Set(Object.values(animation.nodePaths))
        const objectsByPath = new Map()
        root.traverse(object => {
            const path = objectPath(object)
            if (!referencedPaths.has(path)) return
            assert.equal(
                objectsByPath.has(path),
                false,
                `${characterId} ambiguous referenced Home path ${path}`,
            )
            objectsByPath.set(path, object)
        })
        const clips = animation.clips.map(serialized => {
            const tracks = serialized.tracks.map(track => {
                const separator = track.name.indexOf('.')
                const sourceId = track.name.slice(0, separator)
                const sourcePath = animation.nodePaths[sourceId]
                const target = objectsByPath.get(sourcePath)
                assert.ok(target, `${characterId} missing Home target ${sourcePath}`)
                return { ...track, name: `${target.uuid}${track.name.slice(separator)}` }
            })
            return THREE.AnimationClip.parse({ ...serialized, tracks })
        })
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
        assert.ok(expression.expressions[expression.defaultExpression])
        assert.ok(expression.expressionOrder.length >= 1)
        covered.push(characterId)
    }
    assert.equal(covered.length, 89)
    assert.equal(covered.includes(100101), false)

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
    for (const [characterId, [start, helper]] of specialActions) {
        const { animation } = loadRuntimeCharacter(characterId)
        assert.equal(animation.actions.unique01.startFamily, start)
        assert.ok(animation.helpers.includes(helper), `${characterId} helper ${helper}`)
    }
    const externalWeapon = loadRuntimeCharacter('100503').animation
    assert.ok(externalWeapon.externalHelpers.includes('HomeWeaponC_SPHide'))
})
