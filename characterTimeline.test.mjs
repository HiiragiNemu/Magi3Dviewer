import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
    CHARACTER_TIMELINE_SCHEMA,
    CharacterTimeline,
    DIRECT_HOME_ACTIONS_MANIFEST_SCHEMA,
    OFFICIAL_CHARACTER_ACTION_CATALOG_SCHEMA,
    OFFICIAL_CHARACTER_ACTION_PROFILE_SCHEMA,
    OFFICIAL_SYNCHRONIZED_CHARACTER_ACTION_SCHEMA,
    createOfficialCharacterActionCatalog,
    createOfficialCharacterCatalogPlayback,
    createOfficialCharacterActionTimeline,
    createOfficialDirectControllerProfileFromManifest,
    createOfficialNativeDungeonActionCatalogFromRoster,
    createObjectTimelineBinding,
    deserializeCharacterTimeline,
    findOfficialCharacterActionCatalogEntries,
    selectPreferredOfficialJumpDonor,
    resolveOfficialCharacterBoardActionToken,
    resolveOfficialCharacterAction,
    resolveOfficialCharacterDefaultAction,
    serializeCharacterTimeline,
} from './src/viewer/characterTimeline.ts'

function createStateBinding() {
    const state = {
        position: null,
        rotation: null,
        scale: null,
        locomotion: null,
        action: null,
        clip: null,
        animationTime: null,
        speed: null,
        weight: null,
        morphs: {},
        secondaryPhysics: null,
    }
    const binding = {
        setPosition: value => { state.position = [...value] },
        setRotation: value => { state.rotation = [...value] },
        setScale: value => { state.scale = [...value] },
        setLocomotionState: value => { state.locomotion = value },
        setActionState: value => { state.action = value },
        setAnimationClip: value => { state.clip = { ...value } },
        setAnimationTime: value => { state.animationTime = value },
        setAnimationSpeed: value => { state.speed = value },
        setAnimationWeight: value => { state.weight = value },
        setMorph: (name, value) => { state.morphs[name] = value },
        setSecondaryPhysicsState: value => { state.secondaryPhysics = { ...value } },
    }
    return { state, binding }
}

function assertArrayNear(actual, expected, epsilon = 1e-9) {
    assert.equal(actual.length, expected.length)
    actual.forEach((value, index) => {
        assert.ok(Math.abs(value - expected[index]) <= epsilon, `${value} != ${expected[index]}`)
    })
}

test('built-in tracks sample vectors, quaternions, numbers and stable step keys', () => {
    const { state, binding } = createStateBinding()
    const timeline = new CharacterTimeline({
        schema: CHARACTER_TIMELINE_SCHEMA,
        duration: 2,
        tracks: [
            { id: 'p', targetId: 'a', kind: 'position', keyframes: [
                { time: 0, value: [0, 0, 0] },
                { time: 2, value: [2, 4, 6] },
            ] },
            { id: 'r', targetId: 'a', kind: 'rotation', keyframes: [
                { time: 0, value: [0, 0, 0, 1] },
                { time: 2, value: [0, 1, 0, 0] },
            ] },
            { id: 's', targetId: 'a', kind: 'scale', keyframes: [
                { time: 0, value: [1, 1, 1] },
                { time: 2, value: [2, 3, 4] },
            ] },
            { id: 'loc', targetId: 'a', kind: 'locomotion', keyframes: [
                { time: 0, value: 'idle' },
                { time: 1, value: 'walk' },
                { time: 1, value: 'run' },
            ] },
            { id: 'act', targetId: 'a', kind: 'action', keyframes: [
                { time: 0, value: null },
                { time: 1, value: 'skill-two' },
            ] },
            { id: 'clip', targetId: 'a', kind: 'clip', keyframes: [
                { time: 0, value: { name: 'Wait_L', loop: true } },
                { time: 1, value: { name: 'Skill02_SE', loop: false } },
            ] },
            { id: 'time', targetId: 'a', kind: 'animationTime', keyframes: [
                { time: 0, value: 0 },
                { time: 2, value: 1.5 },
            ] },
            { id: 'speed', targetId: 'a', kind: 'animationSpeed', keyframes: [
                { time: 0, value: 0.5 },
                { time: 2, value: 1.5 },
            ] },
            { id: 'weight', targetId: 'a', kind: 'animationWeight', keyframes: [
                { time: 0, value: 0 },
                { time: 2, value: 1 },
            ] },
            { id: 'morph', targetId: 'a', kind: 'morph', property: 'Mouth_A', keyframes: [
                { time: 0, value: 0 },
                { time: 2, value: 1 },
            ] },
            { id: 'cloth', targetId: 'a', kind: 'secondaryPhysics', keyframes: [
                { time: 0, value: { active: true, blendWeight: 1 } },
                { time: 1, value: { active: false, reset: true, blendWeight: 1, resetToken: 'special-off' } },
            ] },
        ],
    }, { bindings: { a: binding } })

    timeline.seek(1)
    assert.deepEqual(state.position, [1, 2, 3])
    assertArrayNear(state.rotation, [0, Math.SQRT1_2, 0, Math.SQRT1_2])
    assert.deepEqual(state.scale, [1.5, 2, 2.5])
    assert.equal(state.locomotion, 'run', 'later same-time key wins stably')
    assert.equal(state.action, 'skill-two')
    assert.deepEqual(state.clip, { name: 'Skill02_SE', loop: false })
    assert.equal(state.animationTime, 0.75)
    assert.equal(state.speed, 1)
    assert.equal(state.weight, 0.5)
    assert.equal(state.morphs.Mouth_A, 0.5)
    assert.deepEqual(state.secondaryPhysics, {
        active: false,
        reset: true,
        blendWeight: 1,
        resetToken: 'special-off',
    })
})

test('multiple character bindings remain isolated', () => {
    const a = createStateBinding()
    const b = createStateBinding()
    const timeline = new CharacterTimeline({
        schema: CHARACTER_TIMELINE_SCHEMA,
        duration: 1,
        tracks: [
            { id: 'a-pos', targetId: 'a', kind: 'position', keyframes: [
                { time: 0, value: [0, 0, 0] },
                { time: 1, value: [1, 0, 0] },
            ] },
            { id: 'b-pos', targetId: 'b', kind: 'position', keyframes: [
                { time: 0, value: [10, 0, 0] },
                { time: 1, value: [20, 0, 0] },
            ] },
        ],
    }, { bindings: { a: a.binding, b: b.binding } })
    timeline.seek(0.25)
    assert.deepEqual(a.state.position, [0.25, 0, 0])
    assert.deepEqual(b.state.position, [12.5, 0, 0])
})

test('play, pause, update, manual step and frame seek have explicit behavior', () => {
    const { state, binding } = createStateBinding()
    const timeline = new CharacterTimeline({
        schema: CHARACTER_TIMELINE_SCHEMA,
        duration: 1,
        tracks: [{ id: 'p', targetId: 'a', kind: 'position', keyframes: [
            { time: 0, value: [0, 0, 0] },
            { time: 1, value: [1, 0, 0] },
        ] }],
    }, { bindings: { a: binding } })

    timeline.seek(0)
    timeline.pause()
    timeline.update(0.25)
    assert.equal(timeline.time, 0)
    timeline.play()
    timeline.update(0.25)
    assert.equal(timeline.time, 0.25)
    assert.equal(state.position[0], 0.25)
    timeline.pause()
    timeline.step(0.25)
    assert.equal(timeline.time, 0.5)
    timeline.seekFrame(45, 60)
    assert.equal(timeline.time, 0.75)
    assert.equal(state.position[0], 0.75)
})

test('events are chronological, stable at equal times and correct across a loop boundary', () => {
    const seen = []
    const timeline = new CharacterTimeline({
        schema: CHARACTER_TIMELINE_SCHEMA,
        duration: 1,
        loop: true,
        tracks: [],
        events: [
            { id: 'zero', time: 0, type: 'effect' },
            { id: 'same-a', time: 0.5, type: 'effect' },
            { id: 'same-b', time: 0.5, type: 'effect' },
            { id: 'end', time: 1, type: 'effect' },
        ],
    }, { eventListeners: [context => seen.push(`${context.loopIndex}:${context.event.id}`)] })

    timeline.seek(0.4)
    timeline.step(0.2)
    assert.deepEqual(seen, ['0:same-a', '0:same-b'])
    timeline.step(0.8)
    assert.deepEqual(seen, ['0:same-a', '0:same-b', '0:end', '1:zero'])
    assert.ok(Math.abs(timeline.time - 0.4) < 1e-9)
    timeline.seek(0.5, true)
    assert.deepEqual(seen.slice(-2), ['1:same-a', '1:same-b'])
})

test('seek and fixed-frame playback produce the same sampled character state', () => {
    const document = {
        schema: CHARACTER_TIMELINE_SCHEMA,
        duration: 1,
        tracks: [
            { id: 'p', targetId: 'a', kind: 'position', keyframes: [
                { time: 0, value: [0, 0, 0] },
                { time: 1, value: [4, 2, -1] },
            ] },
            { id: 'r', targetId: 'a', kind: 'rotation', keyframes: [
                { time: 0, value: [0, 0, 0, 1] },
                { time: 1, value: [0, 1, 0, 0] },
            ] },
            { id: 'loc', targetId: 'a', kind: 'locomotion', keyframes: [
                { time: 0, value: 'idle' },
                { time: 0.5, value: 'run' },
            ] },
            { id: 'clip', targetId: 'a', kind: 'clip', keyframes: [
                { time: 0, value: 'Wait_L' },
                { time: 0.5, value: 'Attack01_SE' },
            ] },
            { id: 'time', targetId: 'a', kind: 'animationTime', keyframes: [
                { time: 0, value: 0 },
                { time: 1, value: 0.8 },
            ] },
            { id: 'm', targetId: 'a', kind: 'morph', property: 'Eye_Close', keyframes: [
                { time: 0, value: 0 },
                { time: 1, value: 1 },
            ] },
        ],
    }
    const seekState = createStateBinding()
    const stepState = createStateBinding()
    const seekTimeline = new CharacterTimeline(document, { bindings: { a: seekState.binding } })
    const stepTimeline = new CharacterTimeline(document, { bindings: { a: stepState.binding } })
    seekTimeline.seek(0.75)
    for (let frame = 0; frame < 45; frame += 1) stepTimeline.step(1 / 60)

    assertArrayNear(stepState.state.position, seekState.state.position)
    assertArrayNear(stepState.state.rotation, seekState.state.rotation)
    assert.equal(stepState.state.locomotion, seekState.state.locomotion)
    assert.deepEqual(stepState.state.clip, seekState.state.clip)
    assert.ok(Math.abs(stepState.state.animationTime - seekState.state.animationTime) < 1e-9)
    assert.ok(Math.abs(stepState.state.morphs.Eye_Close - seekState.state.morphs.Eye_Close) < 1e-9)
})

test('serialization round-trip is deterministic and rejects every non-finite value', () => {
    const document = {
        schema: CHARACTER_TIMELINE_SCHEMA,
        tracks: [{ id: 'p', targetId: 'a', kind: 'position', keyframes: [
            { time: 0, value: [0, 0, 0] },
            { time: 2, value: [2, 0, 0] },
        ] }],
        events: [{ id: 'cue', time: 1, type: 'combat-effect', payload: { radius: 2 } }],
    }
    const serialized = serializeCharacterTimeline(document)
    const parsed = deserializeCharacterTimeline(serialized)
    assert.equal(parsed.duration, 2)
    assert.equal(parsed.loop, false)
    assert.equal(serializeCharacterTimeline(parsed), serialized)
    assert.equal(new CharacterTimeline(parsed, { bindings: { a: createStateBinding().binding } }).serialize(), serialized)

    assert.throws(() => serializeCharacterTimeline({
        ...document,
        tracks: [{ id: 'bad', targetId: 'a', kind: 'animationSpeed', keyframes: [
            { time: 0, value: Number.NaN },
        ] }],
    }), /finite/)
    assert.throws(() => new CharacterTimeline({
        ...document,
        events: [{ id: 'bad-event', time: 0, type: 'effect', payload: { value: Infinity } }],
    }), /finite/)
    assert.throws(() => serializeCharacterTimeline({
        ...document,
        tracks: [{ id: 'bad-cloth', targetId: 'a', kind: 'secondaryPhysics', keyframes: [
            { time: 0, value: { active: true, blendWeight: Number.NaN } },
        ] }],
    }), /finite/)
    assert.throws(() => deserializeCharacterTimeline({
        ...document,
        duration: -1,
    }), /non-negative/)
})

test('extension track adapters interpolate and apply future visual-system values', () => {
    const applied = []
    const adapter = {
        kind: 'effectIntensity',
        validate(value) {
            assert.equal(typeof value, 'number')
            assert.ok(Number.isFinite(value))
        },
        interpolate(from, to, alpha) {
            return from + (to - from) * alpha
        },
        apply(value, context) {
            applied.push({ value, targetId: context.targetId, property: context.property })
        },
    }
    const timeline = new CharacterTimeline({
        schema: CHARACTER_TIMELINE_SCHEMA,
        duration: 1,
        tracks: [{
            id: 'future-effect',
            targetId: 'effect-system',
            kind: 'effectIntensity',
            property: 'skill-aura',
            keyframes: [{ time: 0, value: 0 }, { time: 1, value: 10 }],
        }],
    }, { trackAdapters: [adapter] })
    timeline.seek(0.5)
    assert.deepEqual(applied, [{ value: 5, targetId: 'effect-system', property: 'skill-aura' }])
    assert.doesNotThrow(() => timeline.serialize())
})

test('object binding updates transform, animation controls and all matching morph meshes', () => {
    const transform = { position: null, rotation: null, scale: null }
    const morphA = { morphTargetDictionary: { Smile: 0 }, morphTargetInfluences: [0] }
    const morphB = { morphTargetDictionary: { Smile: 1 }, morphTargetInfluences: [0, 0] }
    const animationCalls = []
    const physicsCalls = []
    const object = {
        position: { set: (...value) => { transform.position = value } },
        quaternion: { set: (...value) => { transform.rotation = value } },
        scale: { set: (...value) => { transform.scale = value } },
        traverse(callback) { callback(morphA); callback(morphB) },
    }
    const binding = createObjectTimelineBinding({
        object,
        animation: {
            play: (name, loop) => animationCalls.push(['play', name, loop]),
            clear: () => animationCalls.push(['clear']),
            setTime: value => animationCalls.push(['time', value]),
            setSpeed: value => animationCalls.push(['speed', value]),
            setWeight: value => animationCalls.push(['weight', value]),
        },
        onSecondaryPhysicsState: value => physicsCalls.push({ ...value }),
    })
    binding.setPosition([1, 2, 3])
    binding.setRotation([0, 0, 0, 1])
    binding.setScale([2, 2, 2])
    binding.setAnimationClip({ name: 'Skill02_SE', loop: false })
    binding.setAnimationTime(0.4)
    binding.setAnimationSpeed(1.2)
    binding.setAnimationWeight(0.75)
    binding.setMorph('Smile', 0.6)
    binding.setSecondaryPhysicsState({ active: false, reset: true, blendWeight: 1, resetToken: 'special-off' })
    assert.deepEqual(transform, {
        position: [1, 2, 3],
        rotation: [0, 0, 0, 1],
        scale: [2, 2, 2],
    })
    assert.deepEqual(animationCalls, [
        ['play', 'Skill02_SE', false],
        ['time', 0.4],
        ['speed', 1.2],
        ['weight', 0.75],
    ])
    assert.deepEqual(morphA.morphTargetInfluences, [0.6])
    assert.deepEqual(morphB.morphTargetInfluences, [0, 0.6])
    assert.deepEqual(physicsCalls, [{
        active: false,
        reset: true,
        blendWeight: 1,
        resetToken: 'special-off',
    }])
})

test('secondary-physics step states are stable per frame and distinct reset tokens remain observable', () => {
    const physicsCalls = []
    const object = {
        position: { set() {} },
        quaternion: { set() {} },
        scale: { set() {} },
    }
    const binding = createObjectTimelineBinding({
        object,
        onSecondaryPhysicsState: state => physicsCalls.push({ ...state }),
    })
    const timeline = new CharacterTimeline({
        schema: CHARACTER_TIMELINE_SCHEMA,
        duration: 1,
        tracks: [{ id: 'cloth', targetId: 'a', kind: 'secondaryPhysics', keyframes: [
            { time: 0, value: { active: true, blendWeight: 1 } },
            { time: 0.25, value: { active: false, reset: true, blendWeight: 1, resetToken: 'cut-a' } },
            { time: 0.5, value: { active: false, reset: true, blendWeight: 1, resetToken: 'cut-b' } },
            { time: 0.75, value: { active: true, blendWeight: 1 } },
        ] }],
    }, { bindings: { a: binding } })
    for (let frame = 0; frame < 60; frame += 1) timeline.step(1 / 60)
    assert.deepEqual(physicsCalls, [
        { active: true, blendWeight: 1 },
        { active: false, reset: true, blendWeight: 1, resetToken: 'cut-a' },
        { active: false, reset: true, blendWeight: 1, resetToken: 'cut-b' },
        { active: true, blendWeight: 1 },
    ])
})

test('object binding does not restart an unchanged clip on every sampled frame', () => {
    const animationCalls = []
    const object = {
        position: { set() {} },
        quaternion: { set() {} },
        scale: { set() {} },
    }
    const binding = createObjectTimelineBinding({
        object,
        animation: { play: (name, loop) => animationCalls.push([name, loop]) },
    })
    const timeline = new CharacterTimeline({
        schema: CHARACTER_TIMELINE_SCHEMA,
        duration: 1,
        tracks: [{ id: 'clip', targetId: 'a', kind: 'clip', keyframes: [
            { time: 0, value: { name: 'Wait_L', loop: true } },
            { time: 0.5, value: { name: 'Skill02_SE', loop: false } },
        ] }],
    }, { bindings: { a: binding } })
    for (let frame = 0; frame < 45; frame += 1) timeline.step(1 / 60)
    assert.deepEqual(animationCalls, [
        ['Wait_L', true],
        ['Skill02_SE', false],
    ])
})

function createDirectControllerActionFixture() {
    const clips = {
        wait: { name: 'Wait_L', pathId: '-900000000000000001', durationSeconds: 2, sampleRate: 60 },
        talkStart: { name: 'Talk_S', pathId: '-900000000000000002', durationSeconds: 0.5, sampleRate: 60 },
        talkLoop: { name: 'Talk_L', pathId: '-900000000000000003', durationSeconds: 1.5, sampleRate: 60 },
        talkEnd: { name: 'Talk_E', pathId: '-900000000000000004', durationSeconds: 0.75, sampleRate: 60 },
    }
    const profile = {
        schema: OFFICIAL_CHARACTER_ACTION_PROFILE_SCHEMA,
        characterId: 'DIRECT_FIXTURE',
        resourceName: 'chara_direct_fixture_model',
        controller: {
            kind: 'direct',
            pathId: '-800000000000000001',
            name: 'chara_direct_fixture_controller',
            layers: ['Base', 'Eyes'],
        },
        defaultActionId: 'wait',
        actions: [
            {
                id: 'wait',
                semantic: 'board-idle',
                presentation: 'standing',
                state: { layer: 'Base', name: 'Wait' },
                sequence: { loop: clips.wait },
            },
            {
                id: 'talk',
                semantic: 'board-talk',
                presentation: 'standing',
                state: { layer: 'Base', name: 'Talk' },
                parameters: [{ name: 'isTalk', hash: 1234, type: 'bool', value: true }],
                sequence: { start: clips.talkStart, loop: clips.talkLoop, end: clips.talkEnd },
            },
        ],
    }
    const inventory = {
        characterId: profile.characterId,
        resourceName: profile.resourceName,
        controller: {
            kind: 'direct',
            pathId: profile.controller.pathId,
            name: profile.controller.name,
            layers: ['Base', 'Eyes'],
        },
        clips: Object.values(clips).map(({ name, pathId }) => ({ name, pathId })),
    }
    return { clips, profile, inventory }
}

test('official action resolver requires the exact direct controller, layer and clip pathIDs', () => {
    const { profile, inventory } = createDirectControllerActionFixture()
    const resolved = resolveOfficialCharacterAction(profile, 'talk', inventory)
    assert.equal(resolved.ok, true)
    assert.equal(resolved.action.id, 'talk')
    assert.equal(resolveOfficialCharacterDefaultAction(profile, inventory).ok, true)

    const overrideInventory = {
        ...inventory,
        controller: { ...inventory.controller, kind: 'override' },
    }
    assert.deepEqual(resolveOfficialCharacterAction(profile, 'talk', overrideInventory), {
        ok: false,
        reason: 'controller-kind-mismatch',
        detail: 'override != direct',
        actionId: 'talk',
    })

    const missingEndInventory = {
        ...inventory,
        clips: inventory.clips.filter(clip => clip.name !== 'Talk_E'),
    }
    const missing = resolveOfficialCharacterAction(profile, 'talk', missingEndInventory)
    assert.equal(missing.ok, false)
    assert.equal(missing.reason, 'clip-missing')
    assert.deepEqual(missing.missingClips, ['Talk_E#-900000000000000004'])
})

test('official board action timeline plays S-L-E, restores exact default and never emits locomotion', () => {
    const { clips, profile, inventory } = createDirectControllerActionFixture()
    const result = createOfficialCharacterActionTimeline(profile, 'talk', inventory, {
        targetId: 'actor-a',
        holdSeconds: 2.25,
    })
    assert.equal(result.ok, true)
    assert.equal(result.document.duration, 3.5)
    assert.deepEqual(result.phases.map(phase => ({
        phase: phase.phase,
        start: phase.startTime,
        end: phase.endTime,
        clip: phase.clip.name,
        pathId: phase.clip.pathId,
    })), [
        { phase: 'start', start: 0, end: 0.5, clip: 'Talk_S', pathId: clips.talkStart.pathId },
        { phase: 'loop', start: 0.5, end: 2.75, clip: 'Talk_L', pathId: clips.talkLoop.pathId },
        { phase: 'end', start: 2.75, end: 3.5, clip: 'Talk_E', pathId: clips.talkEnd.pathId },
        { phase: 'restore', start: 3.5, end: 3.5, clip: 'Wait_L', pathId: clips.wait.pathId },
    ])
    assert.equal(result.document.tracks.some(track => track.kind === 'locomotion'), false)
    assert.deepEqual(result.document.tracks.map(track => track.kind), ['action', 'clip'])
    assert.deepEqual(result.document.tracks[1].keyframes, [
        { time: 0, value: { name: 'Talk_S', loop: false } },
        { time: 0.5, value: { name: 'Talk_L', loop: true } },
        { time: 2.75, value: { name: 'Talk_E', loop: false } },
        { time: 3.5, value: { name: 'Wait_L', loop: true } },
    ])
    assert.deepEqual(result.document.tracks[0].keyframes, [
        { time: 0, value: 'talk' },
        { time: 3.5, value: 'wait' },
    ])
    const serialized = serializeCharacterTimeline(result.document)
    assert.equal(serialized, serializeCharacterTimeline(JSON.parse(serialized)))
    assert.match(serialized, /-900000000000000002/)
    assert.match(serialized, /-900000000000000004/)
    assert.match(serialized, /-900000000000000001/)
})

test('official loop action fails closed without a finite hold and never substitutes a clip', () => {
    const { profile, inventory } = createDirectControllerActionFixture()
    const noHold = createOfficialCharacterActionTimeline(profile, 'talk', inventory, { targetId: 'actor-a' })
    assert.deepEqual(noHold, {
        ok: false,
        reason: 'hold-duration-required',
        detail: 'a positive finite holdSeconds is required for an official loop phase',
        actionId: 'talk',
    })
    const wrongPathInventory = {
        ...inventory,
        clips: inventory.clips.map(clip => clip.name === 'Talk_L'
            ? { ...clip, pathId: '-900000000000009999' }
            : clip),
    }
    const wrongPath = createOfficialCharacterActionTimeline(profile, 'talk', wrongPathInventory, {
        targetId: 'actor-a',
        holdSeconds: 1,
    })
    assert.equal(wrongPath.ok, false)
    assert.equal(wrongPath.reason, 'clip-missing')
    assert.deepEqual(wrongPath.missingClips, ['Talk_L#-900000000000000003'])
})

test('real A-Q direct Home manifest yields all exact clips, dual-layer states and default Wait', () => {
    const manifestUrl = new URL(
        './magia-exedra-character-three/models/chara_113501_model/home-actions.v1.json',
        import.meta.url,
    )
    const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'))
    assert.equal(manifest.schema, DIRECT_HOME_ACTIONS_MANIFEST_SCHEMA)
    const adapted = createOfficialDirectControllerProfileFromManifest(manifest)

    assert.equal(adapted.sourceClipCount, 67)
    assert.equal(adapted.groupedActionCount, 32)
    assert.equal(adapted.profile.characterId, '113501')
    assert.equal(adapted.profile.resourceName, 'chara_113501_model')
    assert.equal(adapted.profile.defaultActionId, 'Wait')
    assert.deepEqual(adapted.profile.controller, {
        kind: 'direct',
        pathId: '-4278097510018638778',
        name: 'chara_113501_a-q',
        layers: ['Base Layer', 'Eyes Layer'],
        parameters: adapted.profile.controller.parameters,
    })
    assert.equal(adapted.profile.controller.parameters.length, 20)
    assert.deepEqual(
        adapted.profile.controller.parameters.slice(0, 3).map(({ name, hash, type }) => ({ name, hash, type })),
        [
            { name: 'PostureId', hash: 98516416, type: 'int' },
            { name: 'TapMotion', hash: 2047766951, type: 'trigger' },
            { name: 'IsTapMotionSit', hash: 1039705420, type: 'bool' },
        ],
    )
    assert.equal(adapted.inventory.clips.length, 67)
    assert.equal(new Set(adapted.inventory.clips.map(clip => `${clip.name}#${clip.pathId}`)).size, 67)

    const defaultResolution = resolveOfficialCharacterDefaultAction(adapted.profile, adapted.inventory)
    assert.equal(defaultResolution.ok, true)
    assert.deepEqual(defaultResolution.action.sequence.loop, {
        name: 'Wait',
        pathId: '-5240203638914273105',
        durationSeconds: 1.6666666269302368,
        sampleRate: 60,
    })
    assert.deepEqual(
        defaultResolution.action.phaseStates.loop.map(state => ({
            layer: state.layer,
            fullPath: state.fullPath,
            fullPathHash: state.fullPathHash,
        })),
        [
            { layer: 'Base Layer', fullPath: 'Base Layer.Wait', fullPathHash: 4104353417 },
            { layer: 'Eyes Layer', fullPath: 'Eyes Layer.Wait', fullPathHash: 3448662738 },
        ],
    )

    const talk = adapted.profile.actions.find(action => action.id === 'TapMotion_Stand/Talk')
    assert.ok(talk)
    assert.equal(talk.semantic, 'board-talk')
    assert.equal(talk.presentation, 'standing')
    assert.deepEqual(
        [talk.sequence.start, talk.sequence.loop, talk.sequence.end].map(clip => [clip.name, clip.pathId]),
        [
            ['chara_113501_Talk_S', '9193240866992133290'],
            ['chara_113501_Talk_L', '6829239109970139435'],
            ['chara_113501_Talk_E', '-3955339342485019668'],
        ],
    )
    assert.deepEqual(
        talk.phaseStates.loop.map(state => [state.layer, state.fullPath, state.fullPathHash]),
        [
            ['Base Layer', 'Base Layer.TapMotion_Stand.Talk_L', 623829626],
            ['Eyes Layer', 'Eyes Layer.TapMotion_Stand.Talk_L', 1782498266],
        ],
    )

    const aqRun = adapted.profile.actions.find(action => action.id === 'UniqueMotion/AqRun')
    assert.ok(aqRun)
    assert.equal(aqRun.presentation, 'special')
    assert.deepEqual(aqRun.sequence.loop, {
        name: 'Take 001',
        pathId: '-7058141752745222705',
        durationSeconds: 16.30000114440918,
        sampleRate: 60,
    })

    const timeline = createOfficialCharacterActionTimeline(
        adapted.profile,
        'TapMotion_Stand/Talk',
        adapted.inventory,
        { targetId: 'aq-113501', holdSeconds: 2.5 },
    )
    assert.equal(timeline.ok, true)
    assert.equal(timeline.document.duration, 4.5)
    assert.equal(timeline.document.tracks.some(track => track.kind === 'locomotion'), false)
    assert.deepEqual(timeline.document.events[1].payload.stateUses.map(state => state.fullPath), [
        'Base Layer.TapMotion_Stand.Talk_L',
        'Eyes Layer.TapMotion_Stand.Talk_L',
    ])
    assert.deepEqual(timeline.document.events.at(-1).payload.stateUses.map(state => state.fullPath), [
        'Base Layer.Wait',
        'Eyes Layer.Wait',
    ])
    assert.equal(serializeCharacterTimeline(timeline.document), serializeCharacterTimeline(timeline.document))

    const overrideManifest = structuredClone(manifest)
    overrideManifest.animatorOverrideControllerCount = 1
    assert.throws(
        () => createOfficialDirectControllerProfileFromManifest(overrideManifest),
        /must not contain an AnimatorOverrideController/,
    )
})

test('formal Nameless and A-Q Home products expose 70 exact active-controller actions without inactive or story fallback', () => {
    const base = './src/viewer/characterActions/data/direct-home/'
    const declarations = JSON.parse(readFileSync(new URL(
        `${base}action-declarations.v1.json`,
        import.meta.url,
    ), 'utf8'))
    assert.equal(declarations.schema, 'magius.direct-home-action-declarations.v1')
    assert.deepEqual(declarations.counts, { characters: 2, entries: 70 })
    assert.equal(new Set(declarations.entries.map(entry => entry.id)).size, 70)

    const expected = {
        113401: { actions: 38, clips: 64, controller: '8103184246897463375' },
        113501: { actions: 32, clips: 67, controller: '-4278097510018638778' },
    }
    for (const [characterId, authority] of Object.entries(expected)) {
        const manifest = JSON.parse(readFileSync(new URL(
            `${base}${characterId}.direct-home-actions.active-controller.v1.json`,
            import.meta.url,
        ), 'utf8'))
        const adapted = createOfficialDirectControllerProfileFromManifest(manifest)
        const entries = declarations.entries.filter(entry => (
            String(entry.characterIdentity.characterId) === characterId
        ))
        assert.equal(adapted.profile.characterId, characterId)
        assert.equal(adapted.profile.controller.pathId, authority.controller)
        assert.equal(adapted.profile.actions.length, authority.actions)
        assert.equal(adapted.inventory.clips.length, authority.clips)
        assert.equal(entries.length, authority.actions)
        assert.equal(adapted.inventory.clips.some(clip => clip.pathId === '-2120183134003767011'), false)

        for (const entry of entries) {
            assert.equal(entry.groupId, 'official-home-direct-controller')
            assert.equal(entry.group, '官方看板动作')
            assert.equal(entry.sourceFamily.compatibility, 'native-only')
            assert.equal(entry.attachmentPolicy, 'embedded-rig-only-no-external-companion')
            assert.equal(entry.playback.controllerPathId, authority.controller)
            const action = adapted.profile.actions.find(candidate => (
                candidate.id === entry.playback.profileActionId
            ))
            assert.ok(action, entry.id)
            for (const phase of ['start', 'loop', 'end']) {
                if (!entry.playback.sequence[phase]) continue
                assert.equal(action.sequence[phase].pathId, entry.playback.sequence[phase].pathId)
                assert.ok(adapted.inventory.clips.some(clip => (
                    clip.pathId === entry.playback.sequence[phase].pathId
                    && clip.name === entry.playback.sequence[phase].name
                )))
            }
        }
    }

    const serialized = JSON.stringify(declarations)
    assert.doesNotMatch(serialized, /gallery-memory-room-story|scene-root|camera-cut/i)
})

test('A-Q ADV motion tokens resolve by official state family and blank cells preserve current pose', () => {
    const manifest = JSON.parse(readFileSync(new URL(
        './magia-exedra-character-three/models/chara_113501_model/home-actions.v1.json',
        import.meta.url,
    ), 'utf8'))
    const authority = JSON.parse(readFileSync(new URL(
        './artifacts/runtime/20260824-tw-memory-light-story-room-aq-02-full-run/resource-static-video-authority.json',
        import.meta.url,
    ), 'utf8'))
    const adapted = createOfficialDirectControllerProfileFromManifest(manifest)
    assert.deepEqual(authority.script.motionTokensByRole.Aq, ['Joy', 'Puzzled', 'Smile', 'Wait02', 'Yes'])
    const expected = {
        Yes: 'TapMotion_Stand/Yes',
        Puzzled: 'TapMotion_Stand/Puzzled',
        Wait02: 'WaitMotion/Wait02',
        Joy: 'TapMotion_Stand/Joy',
        Smile: 'TapMotion_Stand/Smile',
    }
    for (const [token, actionId] of Object.entries(expected)) {
        const resolved = resolveOfficialCharacterBoardActionToken(
            adapted.profile,
            token,
            adapted.inventory,
            'standing',
        )
        assert.equal(resolved.ok, true)
        assert.equal(resolved.behavior, 'play')
        assert.equal(resolved.actionId, actionId)
    }
    assert.deepEqual(
        resolveOfficialCharacterBoardActionToken(adapted.profile, '', adapted.inventory, 'standing'),
        { ok: true, behavior: 'preserve-current', token: null, actionId: null },
    )
    assert.equal(
        resolveOfficialCharacterBoardActionToken(adapted.profile, 'Puzzled', adapted.inventory, 'sitting').actionId,
        'TapMotion_Sit/Puzzled',
    )
    assert.equal(
        resolveOfficialCharacterBoardActionToken(adapted.profile, 'Puzzled', adapted.inventory, 'special').actionId,
        'UniqueMotion/Puzzled',
    )
    const unknown = resolveOfficialCharacterBoardActionToken(
        adapted.profile,
        'UnmappedMotion',
        adapted.inventory,
        'standing',
    )
    assert.equal(unknown.ok, false)
    assert.equal(unknown.reason, 'action-missing')
})

test('official dungeon roster produces 8 exact native body-only idle walk run catalogs', () => {
    const authority = JSON.parse(readFileSync(new URL(
        './artifacts/research/20260824-official-dungeon-character-roster/official-dungeon-character-roster.v1.json',
        import.meta.url,
    ), 'utf8'))
    const catalog = createOfficialNativeDungeonActionCatalogFromRoster(authority)
    assert.equal(catalog.schema, OFFICIAL_CHARACTER_ACTION_CATALOG_SCHEMA)
    assert.equal(authority.records.length, 8)
    assert.equal(catalog.entries.length, 24)
    assert.equal(new Set(catalog.entries.map(entry => entry.id)).size, 24)

    for (const record of authority.records) {
        const characterId = String(record.dungeonCharacterId)
        const entries = findOfficialCharacterActionCatalogEntries(catalog, characterId)
        assert.equal(entries.length, 3, characterId)
        assert.deepEqual(entries.map(entry => entry.id.split(':')[2]), ['idle', 'walk', 'run'])
        for (const entry of entries) {
            const sourceClip = record.movementClips.find(clip => (
                String(clip.pathID) === entry.playback.clip.pathId
            ))
            assert.ok(sourceClip)
            assert.equal(entry.groupId, 'official-dungeon-locomotion')
            assert.equal(entry.group, '官方探索动作')
            assert.equal(entry.playbackKind, 'loop')
            assert.equal(entry.playback.kind, 'loop')
            assert.equal(entry.playback.targetRole, 'body')
            assert.equal(entry.playback.controllerPathId, String(record.controller.pathID))
            assert.equal(entry.playback.bindingCount, sourceClip.genericBindings)
            assert.equal(entry.playback.attachmentPolicy, 'body-only-exclude-external-weapons')
            assert.equal(entry.sourceFamily.id, `official-dungeon:${characterId}`)
            assert.equal(entry.sourceFamily.compatibility, 'native-only')
            assert.equal(entry.characterIdentity.logicalBundleKey, record.logicalKey)
            assert.equal(entry.characterIdentity.style3dResourceName, record.modelMapping.style3dResourceName)
            assert.equal(entry.characterIdentity.styleFigureModelName, record.modelMapping.styleFigureModelName)
        }
    }

    const kyokoIdle = catalog.entries.find(entry => entry.id.startsWith('official-dungeon:100501:idle:'))
    assert.ok(kyokoIdle)
    assert.equal(kyokoIdle.playback.clip.name, 'Standby_L')
    assert.equal(kyokoIdle.playback.clip.pathId, '-7248231595885939743')

    const homuraRun = catalog.entries.find(entry => entry.id === 'official-dungeon:100201:run:2166187276406549931')
    assert.ok(homuraRun)
    const { state, binding } = createStateBinding()
    const runtime = {
        dungeonCharacterId: '100201',
        characterId: '100201',
        resourceName: '100201',
        controllerPathId: '6411218269470645876',
        bodyTargetId: 'actor-100201-body',
        clips: [{ name: 'DungeonRun_L', pathId: '2166187276406549931' }],
        externalWeaponTargetIds: [],
    }
    const playback = createOfficialCharacterCatalogPlayback(homuraRun, {
        runtime,
        bindings: { 'actor-100201-body': binding },
    })
    assert.equal(playback.ok, true)
    assert.equal(playback.state().loop, true)
    playback.play()
    assert.equal(playback.state().playing, true)
    assert.equal(state.action, homuraRun.id)
    assert.deepEqual(state.clip, { name: 'DungeonRun_L', loop: true })
    playback.step(homuraRun.playback.clip.durationSeconds + 0.1)
    assert.ok(playback.state().timeSeconds > 0 && playback.state().timeSeconds < 0.11)
    playback.pause()
    assert.equal(playback.state().playing, false)

    const wrongCharacter = createOfficialCharacterCatalogPlayback(homuraRun, {
        runtime: { ...runtime, characterId: '100202', dungeonCharacterId: '100202' },
    })
    assert.equal(wrongCharacter.ok, false)
    assert.equal(wrongCharacter.reason, 'catalog-character-mismatch')
    const wrongPath = createOfficialCharacterCatalogPlayback(homuraRun, {
        runtime: { ...runtime, clips: [{ name: 'DungeonRun_L', pathId: '6870887992539170635' }] },
    })
    assert.equal(wrongPath.ok, false)
    assert.equal(wrongPath.reason, 'clip-missing')
    const weaponPollution = createOfficialCharacterCatalogPlayback(homuraRun, {
        runtime: { ...runtime, externalWeaponTargetIds: ['weapon-a'] },
    })
    assert.equal(weaponPollution.ok, false)
    assert.match(weaponPollution.detail, /exclude external weapon/)
})

test('complete combat action synchronizes real body and weapon clips and gates required extensions', () => {
    const bodyStart = {
        name: 'Down_SE', pathId: '-4756294819561401985', durationSeconds: 1.5, sampleRate: 60,
    }
    const bodyLoop = {
        name: 'Down_L', pathId: '-3921604876931673317', durationSeconds: 2.333333254, sampleRate: 60,
    }
    const weaponStart = {
        name: 'Down_SE', pathId: '5430031890902061491', durationSeconds: 1.5, sampleRate: 60,
    }
    const weaponLoop = {
        name: 'Down_L', pathId: '8080327037515047898', durationSeconds: 2.333333254, sampleRate: 60,
    }
    const actionId = 'official-combat:108301:down'
    const entry = createOfficialCharacterActionCatalog([{
        id: actionId,
        label: '三栗菖蒲 / 倒地完整动作',
        groupId: 'official-combat-complete-actions',
        group: '完整攻击与状态动作',
        playbackKind: 'timeline',
        characterIdentity: {
            characterId: '108301',
            resourceName: 'chara_108301_battle_unit',
            logicalBundleKey: 'battle/character/chara_108301_battle_unit',
        },
        availability: { status: 'source-available' },
        playback: {
            kind: 'timeline',
            synchronizedAction: {
                schema: OFFICIAL_SYNCHRONIZED_CHARACTER_ACTION_SCHEMA,
                characterId: '108301',
                actionId,
                semantic: 'down',
                targets: [
                    {
                        role: 'body',
                        targetId: 'actor-108301-body',
                        resourceName: 'chara_108301_model',
                        sequence: { start: bodyStart, loop: bodyLoop },
                        inventory: [bodyStart, bodyLoop],
                    },
                    {
                        role: 'weapon-a',
                        targetId: 'actor-108301-weapon-a',
                        resourceName: 'chara_108301_weapon_a_model',
                        sequence: { start: weaponStart, loop: weaponLoop },
                        inventory: [weaponStart, weaponLoop],
                    },
                ],
            },
            extensionEvents: [{
                id: 'actor-108301:down:cloth',
                timeSeconds: 0,
                type: 'cloth-control',
                targetId: 'actor-108301-body',
                required: true,
                payload: { reset: true, active: true },
            }],
        },
        sourceFamily: { id: 'battle-character:108301', compatibility: 'native-only' },
    }]).entries[0]
    const body = createStateBinding()
    const weapon = createStateBinding()
    const playback = createOfficialCharacterCatalogPlayback(entry, {
        availableTargetIds: ['actor-108301-body', 'actor-108301-weapon-a'],
        availableExtensionTypes: ['cloth-control'],
        holdSeconds: 2,
        bindings: {
            'actor-108301-body': body.binding,
            'actor-108301-weapon-a': weapon.binding,
        },
    })
    assert.equal(playback.ok, true)
    assert.equal(playback.document.duration, 3.5)
    assert.equal(playback.document.tracks.some(track => track.kind === 'locomotion'), false)
    assert.equal(playback.document.tracks.length, 4)
    assert.ok(playback.document.events.some(event => event.type === 'official-combat-cloth-control'))
    playback.play()
    assert.deepEqual(body.state.clip, { name: 'Down_SE', loop: false })
    assert.deepEqual(weapon.state.clip, { name: 'Down_SE', loop: false })
    playback.seek(1.5)
    assert.deepEqual(body.state.clip, { name: 'Down_L', loop: true })
    assert.deepEqual(weapon.state.clip, { name: 'Down_L', loop: true })

    const missingWeapon = createOfficialCharacterCatalogPlayback(entry, {
        availableTargetIds: ['actor-108301-body'],
        availableExtensionTypes: ['cloth-control'],
        holdSeconds: 2,
    })
    assert.equal(missingWeapon.ok, false)
    assert.equal(missingWeapon.reason, 'target-missing')
    const missingClothConsumer = createOfficialCharacterCatalogPlayback(entry, {
        availableTargetIds: ['actor-108301-body', 'actor-108301-weapon-a'],
        holdSeconds: 2,
    })
    assert.equal(missingClothConsumer.ok, false)
    assert.equal(missingClothConsumer.reason, 'extension-consumer-missing')

    const wrongWeaponEntry = structuredClone(entry)
    wrongWeaponEntry.playback.synchronizedAction.targets[1].inventory[0].pathId = '1'
    const wrongWeapon = createOfficialCharacterCatalogPlayback(wrongWeaponEntry, {
        availableTargetIds: ['actor-108301-body', 'actor-108301-weapon-a'],
        availableExtensionTypes: ['cloth-control'],
        holdSeconds: 2,
    })
    assert.equal(wrongWeapon.ok, false)
    assert.equal(wrongWeapon.reason, 'clip-missing')
})

test('three-phase combat jump donor samples bounded pose windows without authoring controlled root motion', () => {
    const sourceClip = {
        name: 'AttackJump_SE',
        pathId: '-900000000000000111',
        durationSeconds: 3,
        sampleRate: 60,
    }
    const actionId = 'official-combat-jump:101901:attack-jump-a'
    const makeEntry = () => createOfficialCharacterActionCatalog([{
        id: actionId,
        label: '101901 / 战斗跳跃供体三段',
        groupId: 'official-combat-jump-donors',
        group: '跳跃供体三段',
        playbackKind: 'timeline',
        characterIdentity: {
            characterId: '101901',
            resourceName: 'chara_101901_battle_unit',
            logicalBundleKey: 'battle/skill/chara_101901_attack_jump',
        },
        availability: { status: 'source-available' },
        playback: {
            kind: 'timeline',
            jumpDonor: {
                grade: 'A',
                sourceActionId: 'combat:101901:attack-jump',
                sourceCharacterId: '101901',
                sourceRigFingerprint: 'rig:101901:exact',
                compatibleCharacterIds: ['101901'],
                compatibility: 'exact-rig',
                attachmentPolicy: 'body-only-exclude-external-weapons',
                segments: [
                    {
                        phase: 'takeoff', sourceClip, sourceStartSeconds: 0.2, sourceEndSeconds: 0.5,
                        bodyMask: 'full-body', rootPolicy: 'controller-all',
                    },
                    {
                        phase: 'airborne', sourceClip, sourceStartSeconds: 0.8, sourceEndSeconds: 1.1,
                        bodyMask: 'full-body', rootPolicy: 'controller-all',
                    },
                    {
                        phase: 'land', sourceClip, sourceStartSeconds: 1.5, sourceEndSeconds: 1.9,
                        bodyMask: 'full-body', rootPolicy: 'controller-all',
                    },
                ],
            },
        },
        sourceFamily: { id: 'combat-jump:101901', compatibility: 'exact-rig' },
    }]).entries[0]
    const runtime = {
        dungeonCharacterId: '101901',
        characterId: '101901',
        resourceName: 'chara_101901_battle_unit',
        controllerPathId: '-900000000000000222',
        bodyTargetId: 'actor-101901-body',
        clips: [{ name: sourceClip.name, pathId: sourceClip.pathId }],
        externalWeaponTargetIds: [],
    }
    const actor = createStateBinding()
    const playback = createOfficialCharacterCatalogPlayback(makeEntry(), {
        runtime,
        targetId: 'actor-101901-body',
        bindings: { 'actor-101901-body': actor.binding },
    })
    assert.equal(playback.ok, true)
    assert.ok(Math.abs(playback.document.duration - 1) < 1e-9)
    assert.deepEqual(playback.document.tracks.map(track => track.kind), ['action', 'clip', 'animationTime'])
    assert.equal(playback.document.tracks.some(track => ['position', 'rotation', 'locomotion'].includes(track.kind)), false)
    assert.deepEqual(playback.document.events.map(event => event.type), [
        'official-combat-jump-donor-phase',
        'official-combat-jump-donor-phase',
        'official-combat-jump-donor-phase',
        'official-combat-jump-donor-complete',
    ])
    playback.seek(0.15)
    assert.ok(Math.abs(actor.state.animationTime - 0.35) < 1e-9)
    playback.seek(0.3)
    assert.ok(Math.abs(actor.state.animationTime - 0.8) < 1e-9, 'same-time boundary selects next donor window')
    playback.seek(0.8)
    assert.ok(Math.abs(actor.state.animationTime - 1.7) < 1e-9)

    const rejected = makeEntry()
    rejected.playback.jumpDonor.grade = 'C'
    rejected.playback.jumpDonor.rejectionReason = 'no verified airborne pose'
    const gradeC = createOfficialCharacterCatalogPlayback(rejected, { runtime })
    assert.equal(gradeC.ok, false)
    assert.equal(gradeC.reason, 'jump-donor-rejected')

    const foreignRuntime = { ...runtime, characterId: '100203', dungeonCharacterId: '100203' }
    const mismatch = createOfficialCharacterCatalogPlayback(makeEntry(), { runtime: foreignRuntime })
    assert.equal(mismatch.ok, false)
    assert.equal(mismatch.reason, 'catalog-character-mismatch')

    const duplicateRoot = makeEntry()
    duplicateRoot.playback.jumpDonor.segments[0].rootPolicy = 'source-all'
    const sourceRoot = createOfficialCharacterCatalogPlayback(duplicateRoot, { runtime })
    assert.equal(sourceRoot.ok, false)
    assert.equal(sourceRoot.reason, 'jump-donor-rejected')
})

test('combat jump donor selection is same-character-first, fail-closed and deterministic', () => {
    const sourceClip = {
        name: 'AttackJump_SE',
        pathId: '-900000000000000333',
        durationSeconds: 2,
        sampleRate: 60,
    }
    const makeEntry = ({
        id,
        targetCharacterId = '101901',
        sourceCharacterId,
        grade = 'A',
        compatibility,
        compatibleCharacterIds = [targetCharacterId],
        availability = { status: 'source-available' },
    }) => ({
        id,
        label: id,
        groupId: 'official-combat-jump-donors',
        group: '跳跃供体三段',
        playbackKind: 'timeline',
        characterIdentity: {
            characterId: targetCharacterId,
            resourceName: `chara_${targetCharacterId}_battle_unit`,
            logicalBundleKey: `battle/skill/${id}`,
        },
        availability,
        playback: {
            kind: 'timeline',
            jumpDonor: {
                grade,
                sourceActionId: id,
                sourceCharacterId,
                sourceRigFingerprint: `rig:${sourceCharacterId}`,
                compatibleCharacterIds,
                compatibility,
                attachmentPolicy: 'body-only-exclude-external-weapons',
                segments: [
                    { phase: 'takeoff', sourceClip, sourceStartSeconds: 0, sourceEndSeconds: 0.2, bodyMask: 'full-body', rootPolicy: 'controller-all' },
                    { phase: 'airborne', sourceClip, sourceStartSeconds: 0.2, sourceEndSeconds: 0.4, bodyMask: 'full-body', rootPolicy: 'controller-all' },
                    { phase: 'land', sourceClip, sourceStartSeconds: 0.4, sourceEndSeconds: 0.6, bodyMask: 'full-body', rootPolicy: 'controller-all' },
                ],
            },
        },
    })

    const ownGradeB = makeEntry({
        id: 'jump:101901:own-b',
        sourceCharacterId: '101901',
        grade: 'B',
        compatibility: 'exact-rig',
    })
    const foreignGradeA = makeEntry({
        id: 'jump:100301:retarget-a',
        sourceCharacterId: '100301',
        grade: 'A',
        compatibility: 'verified-retarget',
    })
    const ownFirst = selectPreferredOfficialJumpDonor([foreignGradeA, ownGradeB], '101901')
    assert.equal(ownFirst.status, 'selected')
    assert.equal(ownFirst.priority, 'same-character-exact-rig')
    assert.equal(ownFirst.entry.id, ownGradeB.id)

    const retargetOnly = selectPreferredOfficialJumpDonor([foreignGradeA], '101901')
    assert.equal(retargetOnly.status, 'selected')
    assert.equal(retargetOnly.priority, 'verified-retarget')
    assert.equal(retargetOnly.entry.id, foreignGradeA.id)

    const rejected = [
        makeEntry({ id: 'jump:c', sourceCharacterId: '101901', grade: 'C', compatibility: 'exact-rig' }),
        makeEntry({ id: 'jump:foreign-exact', sourceCharacterId: '100301', compatibility: 'exact-rig' }),
        makeEntry({ id: 'jump:not-compatible', sourceCharacterId: '100301', compatibility: 'verified-retarget', compatibleCharacterIds: ['100301'] }),
        makeEntry({ id: 'jump:unavailable', sourceCharacterId: '101901', compatibility: 'exact-rig', availability: { status: 'unavailable', reason: 'missing body clip' } }),
    ]
    const unavailable = selectPreferredOfficialJumpDonor(rejected, '101901')
    assert.equal(unavailable.status, 'unavailable')
    assert.match(unavailable.reason, /no same-character exact-rig/)

    const deterministic = selectPreferredOfficialJumpDonor([
        makeEntry({ id: 'jump:z', sourceCharacterId: '100301', compatibility: 'verified-retarget' }),
        makeEntry({ id: 'jump:a', sourceCharacterId: '100301', compatibility: 'verified-retarget' }),
    ], '101901')
    assert.equal(deterministic.status, 'selected')
    assert.equal(deterministic.entry.id, 'jump:a')
})
