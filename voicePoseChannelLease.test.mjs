import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'
import { createVoicePoseChannelProvider, createVoicePoseWriteGuard, voicePoseOperationBlock, registerVoicePoseParticipant } from './src/viewer/voice/poseChannels.ts'
import { resolveMouthCarrier } from './src/viewer/voice/mouthCarrier.ts'
import { VoiceScenarioRunner, VoiceScenarioCatalog } from './src/viewer/voice/scenario.ts'
import { VoiceCatalog } from './src/viewer/voice/catalog.ts'
import { VoicePlayer } from './src/viewer/voice/player.ts'
import { VoiceUploadWorkspace } from './src/viewer/voice/uploadWorkspace.ts'
import { CharacterExpressionController } from './magia-exedra-character-three/homeRuntime.ts'

function character() {
    const root = new THREE.Group()
    root.name = 'SameResource'
    root.userData.disposeCallbacks = []
    root.userData.animationLoops = []
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    mesh.name = 'Face'
    mesh.morphTargetDictionary = { Eye_Blink: 0, Brow: 1, Mouth_OpenVertically: 2, Mouth_Wide: 3, Mouth_Narrow: 4 }
    mesh.morphTargetInfluences = [0.2, 0.3, 0, 0, 0]
    const jaw = new THREE.Bone()
    jaw.name = 'Jaw'
    root.add(mesh, jaw)
    return { root, mesh, jaw }
}

function observe(object, key) {
    let value = object[key], writes = 0
    Object.defineProperty(object, key, { configurable: true, enumerable: true,
        get: () => value, set: next => { value = next; writes++ } })
    return { get writes() { return writes }, reset() { writes = 0 } }
}

function request(root, fields = {}) {
    return { actor: { object: root, uuid: root.uuid, generation: 1, isCurrent: () => true }, bones: [], morphs: [], action: false, ...fields }
}

function ready(provider, input) {
    const result = provider.acquirePoseChannels(input)
    assert.equal(result.status, 'ready', result.reason)
    return result.value
}

test('exact morph apply AND restore are excluded; other bindings and same-named actors continue', () => {
    const a = character(), b = character(), provider = createVoicePoseChannelProvider()
    const ca = resolveMouthCarrier(a.root), cb = resolveMouthCarrier(b.root)
    ca.setDrive(0.5, 0)
    const lease = ready(provider, request(a.root, { morphs: [{ mesh: a.mesh, index: 2 }] }))
    a.mesh.morphTargetInfluences[2] = 0.71
    const writes = observe(a.mesh.morphTargetInfluences, 2)
    ca.setDrive(1, 0.5); cb.setDrive(1, 0.5)
    assert.equal(writes.writes, 0)
    assert.equal(a.mesh.morphTargetInfluences[2], 0.71)
    assert.ok(a.mesh.morphTargetInfluences[3] > 0)
    assert.ok(b.mesh.morphTargetInfluences[2] > 0)
    ca.close(); assert.equal(writes.writes, 0)
    lease.release(); lease.release(); assert.equal(writes.writes, 0)
    ca.close(); assert.equal(a.mesh.morphTargetInfluences[2], 0.71)
    ca.setDrive(0.5, 0); assert.ok(a.mesh.morphTargetInfluences[2] > 0.71)
    provider.dispose()
})

test('acquire/release rebases even when no drive occurred while borrowed and value equals last applied', () => {
    const a = character(), carrier = resolveMouthCarrier(a.root), provider = createVoicePoseChannelProvider()
    carrier.setDrive(0.5, 0)
    const displayed = a.mesh.morphTargetInfluences[2]
    const lease = ready(provider, request(a.root, { morphs: [{ mesh: a.mesh, index: 2 }] }))
    lease.release(); carrier.close()
    assert.equal(a.mesh.morphTargetInfluences[2], displayed)
    provider.dispose()
})

test('one paired endpoint is leased without disabling the unleased endpoint', () => {
    const a = character()
    a.mesh.morphTargetDictionary = { Mouth_L_Normal: 0, Mouth_L_Close_Normal: 1 }
    a.mesh.morphTargetInfluences = [0.2, 0.8]
    const carrier = resolveMouthCarrier(a.root), provider = createVoicePoseChannelProvider()
    const lease = ready(provider, request(a.root, { morphs: [{ mesh: a.mesh, index: 0 }] }))
    const writes = observe(a.mesh.morphTargetInfluences, 0)
    carrier.setDrive(0.5, 0)
    assert.equal(writes.writes, 0)
    assert.notEqual(a.mesh.morphTargetInfluences[1], 0.8)
    carrier.close(); assert.equal(writes.writes, 0)
    lease.release(); provider.dispose()
})

test('bone guard retains exact object and scalar vector; same-name actor still moves', () => {
    const a = character(), b = character()
    for (const c of [a, b]) c.root.userData.voiceMouthCarrier = { kind: 'bone', objectPath: 'Jaw', channel: 'position', axis: 'y', closedValue: 0, openValue: 1 }
    const ca = resolveMouthCarrier(a.root), cb = resolveMouthCarrier(b.root), provider = createVoicePoseChannelProvider()
    const lease = ready(provider, request(a.root, { bones: [a.jaw] }))
    const watched = observe(a.jaw.position, 'y')
    ca.setDrive(1, 0); ca.close(); cb.setDrive(1, 0)
    assert.equal(watched.writes, 0); assert.equal(b.jaw.position.y, 1)
    lease.release(); ca.setDrive(1, 0); assert.equal(a.jaw.position.y, 1)
    provider.dispose()
})

test('foreign refs, invalid indices, duplicate channels, UUID and generation failures make no partial claim', () => {
    const a = character(), b = character(), provider = createVoicePoseChannelProvider()
    const good = request(a.root, { morphs: [{ mesh: a.mesh, index: 2 }] })
    const cases = [
        { ...good, actor: { ...good.actor, uuid: b.root.uuid } },
        { ...good, actor: { ...good.actor, generation: -1 } },
        { ...good, actor: { ...good.actor, isCurrent: () => false } },
        { ...good, actor: { ...good.actor, isCurrent: () => { throw Error('stale') } } },
        { ...good, bones: [b.jaw] }, { ...good, bones: [a.jaw, a.jaw] },
        { ...good, morphs: [{ mesh: b.mesh, index: 2 }] },
        { ...good, morphs: [{ mesh: a.mesh, index: -1 }] },
        { ...good, morphs: [{ mesh: a.mesh, index: 99 }] },
        { ...good, morphs: [...good.morphs, ...good.morphs] },
    ]
    for (const item of cases) assert.equal(provider.acquirePoseChannels(item).status, 'unavailable')
    ready(provider, good).release(); provider.dispose()
})

test('disjoint providers coexist; cleanup and old release never remove another lease', () => {
    const a = character(), first = createVoicePoseChannelProvider(), second = createVoicePoseChannelProvider()
    const x = ready(first, request(a.root, { morphs: [{ mesh: a.mesh, index: 2 }] }))
    const y = ready(second, request(a.root, { morphs: [{ mesh: a.mesh, index: 3 }] }))
    assert.equal(second.acquirePoseChannels(request(a.root, { morphs: [{ mesh: a.mesh, index: 2 }] })).status, 'unavailable')
    first.dispose(); assert.equal(x.active, false); assert.equal(y.active, true)
    const z = ready(second, request(a.root, { morphs: [{ mesh: a.mesh, index: 2 }] }))
    x.release(); assert.equal(z.active, true)
    assert.equal(first.acquirePoseChannels(request(a.root)).reason, 'voice-pose-provider-disposed')
    second.dispose()
})

test('stale actor and replaced influence arrays stay fail-closed without restoration writes', () => {
    const a = character(), carrier = resolveMouthCarrier(a.root), provider = createVoicePoseChannelProvider()
    let current = true
    const req = request(a.root, { morphs: [{ mesh: a.mesh, index: 2 }] })
    req.actor.isCurrent = () => current
    const lease = ready(provider, req)
    current = false
    const watch = observe(a.mesh.morphTargetInfluences, 2)
    assert.equal(lease.active, false); carrier.close(); lease.release(); carrier.setDrive(1, 0)
    assert.equal(watch.writes, 0)
    const b = character(), old = resolveMouthCarrier(b.root)
    const held = ready(provider, request(b.root, { morphs: [{ mesh: b.mesh, index: 2 }] }))
    b.mesh.morphTargetInfluences = [0, 0, 0.64, 0, 0]
    assert.equal(held.active, false)
    held.release(); old.close(); old.setDrive(1, 0)
    assert.equal(b.mesh.morphTargetInfluences[2], 0.64)
    provider.dispose()
})

function scenarioFixture({ animation = true, expression = true } = {}) {
    const c = character(), calls = []
    c.root.userData.homeAnimationRuntime = { actions: { wait01: { loopFamily: 'Wait_L' }, wait02: { loopFamily: 'Other_L' } } }
    let paused = false
    const anim = { current: 'Wait_L', time: 0, duration: 10,
        get paused() { return paused }, set paused(value) { calls.push('paused'); paused = value },
        play(name) { calls.push(`play:${name}`); this.current = name; c.jaw.position.y += 1 },
        clear() { calls.push('clear'); this.current = undefined; c.jaw.position.y = 0 },
        getAnimationClipsByName: () => [{ duration: 10 }],
    }
    const expr = { current: 'Smile', expressions: ['Smile', 'Serious'], meshes: [c.mesh],
        runtime: { aliases: {}, expressions: { Smile: { weights: { Mouth_OpenVertically: 0.2 } }, Serious: { weights: { Mouth_OpenVertically: 0.1 } } }, blink: { weights: { Eye_Blink: 1 } }, mouth: { constantWeights: {} } },
        set(name) { calls.push(`face:${name}`); this.current = name; c.mesh.morphTargetInfluences[0] += 0.1 },
        resetToDefault() { calls.push('face-reset'); c.mesh.morphTargetInfluences[0] = 0.2 },
    }
    const target = { object: c.root, userData: c.root.userData, animations: ['Wait_L', 'Other_L'], ...(animation ? { animation: anim } : {}), ...(expression ? { expression: expr } : {}) }
    const runner = new VoiceScenarioRunner(); runner.setTarget(target)
    return { ...c, calls, anim, expr, target, runner }
}

const entry = { runtimeReady: true, voiceStableKey: 'voice-fixture', scenarioStableKey: 'scenario-fixture', rows: [
    { rowNumber: 1, ActionType: 'Talk', Variable: '0', Motion: 'HomeWait01', FaceType: 'Smile' },
    { rowNumber: 2, ActionType: 'Talk', Variable: '1', Motion: 'HomeWait02', FaceType: 'Serious' },
] }

test('action lease fences rows/reassert/pause/resume/seek/handoff/restore, independent expression continues', () => {
    const c = scenarioFixture(), provider = createVoicePoseChannelProvider()
    c.runner.begin(entry, 0)
    const lease = ready(provider, request(c.root, { action: true }))
    c.calls.length = 0
    const jaw = observe(c.jaw.position, 'y')
    c.runner.update(2); c.runner.seek(0, true); c.runner.pause(); c.runner.resume(2)
    c.runner.prepareHandoff(); c.runner.begin(entry, 2); c.runner.stop()
    assert.equal(jaw.writes, 0)
    assert.equal(c.calls.filter(name => !name.startsWith('face')).length, 0)
    assert.ok(c.calls.some(name => name.startsWith('face')))
    lease.release(); c.runner.setTarget(null); provider.dispose()
})

test('release retries the latest suppressed row at same timestamp without old baseline restore', () => {
    const c = scenarioFixture(), provider = createVoicePoseChannelProvider()
    c.runner.begin(entry, 0)
    const lease = ready(provider, request(c.root, { action: true }))
    c.runner.update(2); c.calls.length = 0
    lease.release(); assert.deepEqual(c.calls, [])
    c.runner.update(2)
    assert.equal(c.calls.filter(row => row === 'play:Other_L').length, 1)
    c.runner.update(2)
    assert.equal(c.calls.filter(row => row === 'play:Other_L').length, 1)
    c.runner.setTarget(null); provider.dispose()
})

test('known full Home/blink coverage and opaque compound writers are honest unavailable, disjoint refs ready', () => {
    const c = scenarioFixture({ animation: false }), provider = createVoicePoseChannelProvider()
    for (const index of [0, 2]) assert.equal(provider.acquirePoseChannels(request(c.root, { morphs: [{ mesh: c.mesh, index }] })).reason, 'voice-pose-home-expression-channel-yield-unavailable')
    ready(provider, request(c.root, { morphs: [{ mesh: c.mesh, index: 4 }] })).release()
    delete c.expr.runtime
    assert.equal(provider.acquirePoseChannels(request(c.root, { morphs: [{ mesh: c.mesh, index: 4 }] })).reason, 'voice-pose-expression-side-effects-unavailable')
    const d = scenarioFixture({ expression: false })
    assert.equal(provider.acquirePoseChannels(request(d.root, { bones: [d.jaw] })).reason, 'voice-pose-animation-channel-yield-unavailable')
    ready(provider, request(d.root, { bones: [d.jaw], action: true })).release()
    c.runner.setTarget(null); d.runner.setTarget(null); provider.dispose()
})

test('producer attached during a lease fences future conflicting calls before invocation', () => {
    const c = scenarioFixture(), provider = createVoicePoseChannelProvider()
    c.runner.setTarget(null)
    const lease = ready(provider, request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }] }))
    c.runner.setTarget(c.target); c.calls.length = 0
    c.runner.begin(entry, 0); c.runner.update(2); c.runner.stop()
    assert.deepEqual(c.calls, [])
    lease.release(); c.runner.setTarget(null); provider.dispose()
})

test('pending opaque producer persists after retarget and blocks generation replacement until settlement', async () => {
    const c = scenarioFixture({ expression: false }), provider = createVoicePoseChannelProvider()
    let finish
    const delayed = new Promise(resolve => { finish = resolve })
    c.anim.play = () => delayed
    c.runner.begin(entry, 0)
    c.runner.setTarget(null)
    const next = request(c.root, { action: true }); next.actor.generation = 2
    assert.equal(provider.acquirePoseChannels(next).reason, 'voice-pose-pending-opaque-side-effect')
    const other = character(); ready(provider, request(other.root, { action: true })).release()
    finish(); await Promise.resolve(); await Promise.resolve()
    ready(provider, next).release(); provider.dispose()
})

class Audio {
    src = ''; crossOrigin = null; preload = ''; currentTime = 0; duration = 8
    paused = true; ended = false; volume = 1; loop = false; pauses = 0
    listeners = new Map()
    async play() { this.paused = false }
    pause() { this.paused = true; this.pauses++ }
    load() {}
    removeAttribute() {}
    addEventListener(type, listener) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set) }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }
}
function environment() {
    const audios = []
    return { audios, options: {
        createAudioElement() { const audio = new Audio(); audios.push(audio); return audio },
        createAudioContext: () => null,
        createObjectUrl: () => 'blob:fixture', revokeObjectUrl() {},
        resolveRuntimeUrl: () => 'https://fixture.invalid/audio.ogg',
        beforePlayback() {}, setTimeout: () => 1, clearTimeout() {},
        loadScenarioCatalog: async () => null,
    } }
}
const official = JSON.parse(fs.readFileSync('./artifacts/research/20260827-voice-catalog-source-ready/manifest.v1.json', 'utf8'))
function file() { return new File(['fixture'], 'voice.ogg', { type: 'audio/ogg' }) }

test('playing official/upload/background audio continues while exact shared carrier drive and stop restores yield', async () => {
    const a = character(), b = character(), env = environment(), provider = createVoicePoseChannelProvider()
    const player = new VoicePlayer(new VoiceCatalog(official), env.options)
    const workspace = new VoiceUploadWorkspace(env.options)
    player.setCharacter(official.entries[0].characterResourceId, a.root)
    assert.equal(await player.playAt(0), true)
    workspace.setCharacters([{ key: 'a', characterResourceId: 'fixture', target: a.root }, { key: 'b', characterResourceId: 'fixture', target: b.root }])
    workspace.loadCharacterFile('a', file()); workspace.loadCharacterFile('b', file())
    const background = workspace.addBackgroundFile(file())
    await workspace.playCharacter('a'); await workspace.playCharacter('b'); await workspace.playBackground(background)
    const lease = ready(provider, request(a.root, { morphs: [{ mesh: a.mesh, index: 2 }] }))
    a.mesh.morphTargetInfluences[2] = 0.51
    const watched = observe(a.mesh.morphTargetInfluences, 2)
    const pauseCounts = env.audios.map(audio => audio.pauses)
    b.mesh.morphTargetInfluences[2] = 0
    for (const audio of env.audios) audio.currentTime = 2
    player.update(0.1); workspace.update(0.1)
    assert.equal(watched.writes, 0); assert.ok(b.mesh.morphTargetInfluences[2] > 0)
    assert.ok(env.audios.every(audio => !audio.paused && audio.currentTime === 2))
    assert.deepEqual(env.audios.map(audio => audio.pauses), pauseCounts)
    try { player.stop(); workspace.stopCharacter('a'); assert.equal(watched.writes, 0) }
    finally { lease.release(); await player.dispose(); await workspace.dispose(); provider.dispose() }
})

test('delayed official media resolution starts audio but cannot reassert leased scenario action', async () => {
    const c = scenarioFixture(), env = environment(), provider = createVoicePoseChannelProvider()
    c.runner.setTarget(null)
    let resolveMedia
    const pending = new Promise(resolve => { resolveMedia = resolve })
    const manifest = JSON.parse(fs.readFileSync('./artifacts/research/20260827-voice-scenario-source-ready/manifest.v1.json', 'utf8'))
    const player = new VoicePlayer(new VoiceCatalog(official), { ...env.options,
        resolveRuntimeUrl: () => pending, loadScenarioCatalog: async () => new VoiceScenarioCatalog(manifest),
    })
    player.setCharacter(official.entries[0].characterResourceId, c.target)
    const playing = player.playAt(0)
    const lease = ready(provider, request(c.root, { action: true }))
    c.calls.length = 0
    resolveMedia('https://fixture.invalid/audio.ogg')
    assert.equal(await playing, true)
    assert.ok(env.audios.every(audio => !audio.paused))
    assert.equal(c.calls.filter(row => !row.startsWith('face')).length, 0)
    await player.dispose(); lease.release(); provider.dispose()
})

test('panel exposes the real provider and retains its leases through cleanup finally', () => {
    const source = fs.readFileSync('./src/viewer/voicePanel.ts', 'utf8')
    assert.match(source, /acquirePoseChannels\(request\).*poseChannels\.acquirePoseChannels\(request\)/)
    assert.match(source, /await current\?\.dispose\(\)[\s\S]*?finally\s*\{\s*poseChannels\.dispose\(\)/)
})

function nativeScenario() {
    const c = character()
    const runtime = {
        schema: 1, characterId: 1, unityVersion: 'fixture', source: 'fixture',
        defaultExpression: 'Smile', morphTargetCount: 5,
        expressionOrder: ['Smile', 'Serious'], aliases: {},
        expressions: {
            Smile: { duration: 0, weights: { Mouth_OpenVertically: 0.1, Brow: 0.2 } },
            Serious: { duration: 0, weights: { Mouth_OpenVertically: 0.9, Brow: 0.8 } },
        },
        blink: { duration: 0.1, weights: { Eye_Blink: 1 }, controller: null },
        mouth: { duration: 1, curveTarget: null, curveSegments: [], constantWeights: {}, unresolvedAttributes: [] },
    }
    const expression = new CharacterExpressionController([c.mesh], runtime)
    const target = { object: c.root, expression }
    const runner = new VoiceScenarioRunner(); runner.setTarget(target)
    return { ...c, expression, target, runner }
}

test('real Home provider masks only requested field while scenario/native clocks and other face fields continue', () => {
    const c = nativeScenario(), provider = createVoicePoseChannelProvider(), carrier = resolveMouthCarrier(c.root)
    c.runner.begin(entry, 0)
    const lease = ready(provider, request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds: 0.18 }))
    c.mesh.morphTargetInfluences[2] = 0.6
    const watched = observe(c.mesh.morphTargetInfluences, 2)
    c.runner.update(2); c.expression.update(0.1); carrier.setDrive(1, 0); carrier.close()
    assert.equal(watched.writes, 0)
    assert.equal(c.expression.current, 'Serious')
    assert.equal(c.mesh.morphTargetInfluences[1], 0.8)
    lease.release(); assert.equal(watched.writes, 0)
    c.expression.update(0.09)
    assert.ok(Math.abs(c.mesh.morphTargetInfluences[2] - 0.75) < 1e-10)
    c.expression.update(0.09)
    assert.equal(c.mesh.morphTargetInfluences[2], 0.9)
    c.runner.setTarget(null); provider.dispose()
})

test('Home transition is positive caller configuration, never inferred from blink or a hidden default', () => {
    const c = nativeScenario(), provider = createVoicePoseChannelProvider()
    for (const releaseTransitionSeconds of [undefined, 0, -1, NaN, Infinity]) {
        assert.equal(provider.acquirePoseChannels(request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds })).reason, 'voice-pose-home-transition-unavailable')
    }
    ready(provider, request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds: 0.4 })).release()
    c.runner.setTarget(null); provider.dispose()
})

test('two players share one physical Home lease and detaching either does not unmask the live borrowed field', () => {
    const c = nativeScenario(), provider = createVoicePoseChannelProvider(), second = new VoiceScenarioRunner()
    second.setTarget(c.target)
    let acquisitions = 0, releases = 0
    const native = c.expression.acquireMorphChannels.bind(c.expression)
    c.expression.acquireMorphChannels = request => {
        acquisitions++
        const result = native(request)
        return result.status === 'ready' ? { status: 'ready', release() { releases++; result.release() } } : result
    }
    const lease = ready(provider, request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds: 0.18 }))
    assert.equal(acquisitions, 1)
    c.runner.setTarget(null); assert.equal(releases, 0)
    c.mesh.morphTargetInfluences[2] = 0.65
    second.begin(entry, 2); c.expression.update(0.1)
    assert.equal(c.mesh.morphTargetInfluences[2], 0.65)
    second.setTarget(null); assert.equal(releases, 0)
    lease.release(); lease.release(); assert.equal(releases, 1)
    provider.dispose()
})

test('a later lower-layer rejection unwinds already acquired providers and reserves no outer channels', () => {
    const c = nativeScenario(), provider = createVoicePoseChannelProvider(), second = new VoiceScenarioRunner()
    const opaque = Object.create(c.expression)
    opaque.acquireMorphChannels = () => ({ status: 'unavailable', reason: 'overlap' })
    second.setTarget({ object: c.root, expression: opaque })
    const input = request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds: 0.18 })
    assert.equal(provider.acquirePoseChannels(input).reason, 'voice-pose-home-overlap')
    second.setTarget(null)
    ready(provider, input).release()
    c.runner.setTarget(null); provider.dispose()
})

test('reentrant actor callbacks receive typed unavailable without stealing the outer lease', () => {
    const c = character(), provider = createVoicePoseChannelProvider()
    let nested
    const input = request(c.root, { action: true })
    input.actor.isCurrent = () => {
        nested = provider.acquirePoseChannels(request(c.root, { action: true }))
        return true
    }
    const lease = ready(provider, input)
    assert.equal(nested.reason, 'voice-pose-reentrant')
    lease.release(); provider.dispose()
})

test('failed lower-layer acquisition does not advance actor epoch or invalidate existing carrier references', () => {
    const c = nativeScenario(), provider = createVoicePoseChannelProvider()
    ready(provider, request(c.root, { action: true })).release()
    const carrier = resolveMouthCarrier(c.root)
    c.expression.acquireMorphChannels = () => ({ status: 'unavailable', reason: 'overlap' })
    const rejected = request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds: 0.18 })
    rejected.actor.generation = 2
    assert.equal(provider.acquirePoseChannels(rejected).reason, 'voice-pose-home-overlap')
    const watched = observe(c.mesh.morphTargetInfluences, 2)
    carrier.setDrive(1, 0)
    assert.ok(watched.writes > 0)
    c.runner.setTarget(null); provider.dispose()
})

test('beginMorphReturn keeps real active reservation and action/bone masks while exact morph evaluation resumes', () => {
    const c = nativeScenario(), provider = createVoicePoseChannelProvider()
    const morphGuard = createVoicePoseWriteGuard(c.root, c.mesh, 2)
    const boneGuard = createVoicePoseWriteGuard(c.root, c.jaw)
    const input = request(c.root, { bones: [c.jaw], morphs: [{ mesh: c.mesh, index: 2 }], action: true, releaseTransitionSeconds: 0.18 })
    const lease = ready(provider, input)
    c.expression.set('Serious'); c.mesh.morphTargetInfluences[2] = 0.8
    const watched = observe(c.mesh.morphTargetInfluences, 2)
    const revision = morphGuard.revision(), boneRevision = boneGuard.revision()
    assert.deepEqual(lease.beginMorphReturn(), { status: 'ready', value: undefined })
    assert.equal(watched.writes, 0); assert.equal(lease.active, true)
    assert.equal(morphGuard.allowed(), true); assert.equal(boneGuard.allowed(), false)
    assert.equal(morphGuard.revision(), revision + 1); assert.equal(boneGuard.revision(), boneRevision)
    assert.equal(voicePoseOperationBlock(c.root, r => r.action ? 'action-held' : null), 'action-held')
    assert.equal(provider.acquirePoseChannels(input).reason, 'voice-pose-channel-already-leased')
    assert.deepEqual(lease.beginMorphReturn(), { status: 'ready', value: undefined })
    assert.equal(morphGuard.revision(), revision + 1)
    c.expression.update(0.09); assert.equal(c.mesh.morphTargetInfluences[2], 0.9)
    lease.release(); assert.equal(lease.active, false); assert.equal(boneGuard.allowed(), true)
    assert.equal(lease.beginMorphReturn().status, 'unavailable')
    c.runner.setTarget(null); provider.dispose()
})

// This is an external-compositor fixture, not a substitute for MODEL/ACTION's
// real frame-host gate. It proves the provider supplies fresh targets immediately.
for (const mode of ['home', 'moving-home', 'voice']) {
    test(`provider supplies immediate evaluator targets for one configured return: ${mode}`, () => {
        const c = nativeScenario(), other = nativeScenario(), provider = createVoicePoseChannelProvider()
        const carrier = resolveMouthCarrier(c.root)
        const lease = ready(provider, request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds: 0.18 }))
        c.expression.set('Serious'); other.expression.set('Serious')
        c.mesh.morphTargetInfluences[2] = 0.8
        const from = c.mesh.morphTargetInfluences[2], output = [], targets = []
        assert.equal(lease.beginMorphReturn().status, 'ready')
        assert.equal(c.mesh.morphTargetInfluences[2], 0.8)
        for (const elapsed of [0.09, 0.18]) {
            if (mode === 'moving-home' && elapsed === 0.18) c.expression.set('Smile')
            c.expression.update(0.09); other.expression.update(0.09)
            if (mode === 'voice') carrier.setDrive(0.5, 0)
            const target = c.mesh.morphTargetInfluences[2]; targets.push(target)
            const displayed = THREE.MathUtils.lerp(from, target, elapsed / 0.18)
            c.mesh.morphTargetInfluences[2] = displayed; output.push(displayed)
            assert.equal(lease.active, true)
            assert.equal(other.mesh.morphTargetInfluences[2], 0.9)
        }
        const expected = mode === 'voice' ? [0.87, 0.94] : mode === 'moving-home' ? [0.85, 0.1] : [0.85, 0.9]
        output.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-10))
        assert.ok(targets.every((value, i) => Math.abs(value - (mode === 'moving-home' && i === 1 ? 0.1 : mode === 'voice' ? 0.94 : 0.9)) < 1e-10))
        lease.release(); c.expression.update(0)
        assert.equal(c.mesh.morphTargetInfluences[2], mode === 'moving-home' ? 0.1 : 0.9)
        c.runner.setTarget(null); other.runner.setTarget(null); provider.dispose()
    })
}

test('morph phase revision discards old voice restore baselines even when displayed equals last applied', () => {
    const c = character(), provider = createVoicePoseChannelProvider(), carrier = resolveMouthCarrier(c.root)
    carrier.setDrive(1, 0)
    const last = c.mesh.morphTargetInfluences[2]
    const lease = ready(provider, request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }] }))
    c.mesh.morphTargetInfluences[2] = last
    assert.equal(lease.beginMorphReturn().status, 'ready')
    carrier.close(); assert.equal(c.mesh.morphTargetInfluences[2], last)
    c.mesh.morphTargetInfluences[2] = 0.9
    carrier.setDrive(0.5, 0); assert.ok(Math.abs(c.mesh.morphTargetInfluences[2] - 0.94) < 1e-10)
    lease.release(); carrier.close()
    assert.ok(Math.abs(c.mesh.morphTargetInfluences[2] - 0.94) < 1e-10)
    provider.dispose()
})

test('every retained lower capability is preflighted before unmasking any Home participant', () => {
    const c = nativeScenario(), provider = createVoicePoseChannelProvider(); let releases = 0
    const unregister = registerVoicePoseParticipant(c.root, {
        check: () => null, acquire: () => ({ status: 'ready', value: { release() { releases++ } } }),
        acquired() {}, released() {},
    })
    const lease = ready(provider, request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds: 0.18 }))
    c.expression.set('Serious'); c.mesh.morphTargetInfluences[2] = 0.8
    assert.equal(lease.beginMorphReturn().reason, 'voice-pose-morph-return-unavailable')
    assert.equal(releases, 0); assert.equal(lease.active, true)
    c.expression.update(0.09); assert.equal(c.mesh.morphTargetInfluences[2], 0.8)
    lease.release(); assert.equal(releases, 1)
    c.expression.update(0.09); assert.ok(Math.abs(c.mesh.morphTargetInfluences[2] - 0.85) < 1e-10)
    unregister(); c.runner.setTarget(null); provider.dispose()
})

test('missing native evaluator seam never falls back to ordinary release', () => {
    const c = nativeScenario(), provider = createVoicePoseChannelProvider(); let releases = 0
    const native = c.expression.acquireMorphChannels.bind(c.expression)
    c.expression.acquireMorphChannels = input => {
        const h = native(input)
        return h.status === 'ready' ? { status: 'ready', release() { releases++; h.release() } } : h
    }
    const lease = ready(provider, request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds: 0.18 }))
    c.mesh.morphTargetInfluences[2] = 0.8
    assert.equal(lease.beginMorphReturn().reason, 'voice-pose-home-evaluator-return-unavailable')
    assert.equal(releases, 0); c.expression.update(0.09); assert.equal(c.mesh.morphTargetInfluences[2], 0.8)
    lease.release(); assert.equal(releases, 1)
    c.runner.setTarget(null); provider.dispose()
})

test('failed later commit rolls earlier Home masks back without a release or native blend', () => {
    const c = nativeScenario(), provider = createVoicePoseChannelProvider(); let releases = 0, rollbacks = 0
    const unregister = registerVoicePoseParticipant(c.root, {
        check: () => null, acquired() {}, released() {},
        acquire: () => ({ status: 'ready', value: {
            release() { releases++ },
            prepareMorphReturn: () => ({ status: 'ready', value: {
                commit: () => ({ status: 'unavailable', reason: 'fixture-late-commit-denied' }),
                rollback() { rollbacks++ },
            } }),
        } }),
    })
    const lease = ready(provider, request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds: 0.18 }))
    c.expression.set('Serious'); c.mesh.morphTargetInfluences[2] = 0.8
    assert.equal(lease.beginMorphReturn().reason, 'fixture-late-commit-denied')
    assert.equal(releases, 0); assert.equal(rollbacks, 1); assert.equal(lease.active, true)
    c.expression.update(0.09); assert.equal(c.mesh.morphTargetInfluences[2], 0.8)
    lease.release(); unregister(); c.runner.setTarget(null); provider.dispose()
})

test('shared and late players inherit evaluator phase without remasking or early native release', () => {
    const c = nativeScenario(), second = new VoiceScenarioRunner(), late = new VoiceScenarioRunner()
    const provider = createVoicePoseChannelProvider(); second.setTarget(c.target)
    let acquisitions = 0, releases = 0
    const native = c.expression.acquireMorphChannels.bind(c.expression)
    c.expression.acquireMorphChannels = input => {
        acquisitions++; const h = native(input)
        return h.status === 'ready' ? { ...h, release() { releases++; h.release() } } : h
    }
    const lease = ready(provider, request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds: 0.18 }))
    c.expression.set('Serious'); c.mesh.morphTargetInfluences[2] = 0.8
    assert.equal(lease.beginMorphReturn().status, 'ready')
    late.setTarget(c.target); assert.equal(c.mesh.morphTargetInfluences[2], 0.8)
    assert.equal(acquisitions, 1)
    c.runner.setTarget(null); second.setTarget(null)
    assert.equal(releases, 0); assert.equal(lease.active, true)
    c.expression.update(0.09); assert.equal(c.mesh.morphTargetInfluences[2], 0.9)
    late.setTarget(null); lease.release(); lease.release(); assert.equal(releases, 1)
    c.mesh.morphTargetInfluences[2] = 0.85; c.expression.update(0)
    assert.equal(c.mesh.morphTargetInfluences[2], 0.9)
    provider.dispose()
})

test('new native participant inherits returning phase, unsupported late participant revokes real authority', () => {
    const c = nativeScenario(), provider = createVoicePoseChannelProvider(), late = new VoiceScenarioRunner()
    const another = new CharacterExpressionController([c.mesh], c.expression.runtime)
    const lease = ready(provider, request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds: 0.18 }))
    c.expression.set('Serious'); another.set('Serious'); c.mesh.morphTargetInfluences[2] = 0.8
    assert.equal(lease.beginMorphReturn().status, 'ready')
    late.setTarget({ object: c.root, expression: another })
    assert.equal(c.mesh.morphTargetInfluences[2], 0.8)
    assert.equal(lease.active, true); another.update(0.09); assert.equal(c.mesh.morphTargetInfluences[2], 0.9)
    const unregister = registerVoicePoseParticipant(c.root, {
        check: () => null, acquired() {}, released() {},
        acquire: () => ({ status: 'ready', value: { release() {} } }),
    })
    assert.equal(lease.active, false)
    c.mesh.morphTargetInfluences[2] = 0.81
    c.expression.update(0.09); another.update(0.09)
    assert.equal(c.mesh.morphTargetInfluences[2], 0.81)
    assert.equal(createVoicePoseWriteGuard(c.root, c.mesh, 2).allowed(), false)
    lease.release(); unregister(); late.setTarget(null); c.runner.setTarget(null); provider.dispose()
})

test('returning lease keeps stale actor and storage guards, and old release cannot revoke a regrab', () => {
    const c = nativeScenario(), provider = createVoicePoseChannelProvider(); let current = true
    const input = request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }], releaseTransitionSeconds: 0.18 })
    input.actor.isCurrent = () => current
    const first = ready(provider, input); assert.equal(first.beginMorphReturn().status, 'ready')
    c.mesh.morphTargetInfluences[2] = 0.85; first.release()
    const next = ready(provider, input)
    first.release(); assert.equal(next.active, true); c.expression.update(0.09)
    assert.equal(c.mesh.morphTargetInfluences[2], 0.85)
    assert.equal(next.beginMorphReturn().status, 'ready')
    current = false; assert.equal(next.active, false); c.expression.update(0.09)
    assert.equal(c.mesh.morphTargetInfluences[2], 0.85)
    assert.equal(next.beginMorphReturn().reason, 'voice-pose-stale-retained-reference')
    current = true; c.mesh.morphTargetInfluences = [0, 0, 0.77, 0, 0]
    assert.equal(next.active, false); c.expression.update(0.09)
    assert.equal(c.mesh.morphTargetInfluences[2], 0.77)
    next.release(); c.runner.setTarget(null); provider.dispose()
})

test('beginMorphReturn rejects callback reentry and releases after provider disposal without synthetic active', () => {
    const c = character(), provider = createVoicePoseChannelProvider(); let lease, nested
    const input = request(c.root, { morphs: [{ mesh: c.mesh, index: 2 }] })
    input.actor.isCurrent = () => { if (lease) nested = lease.beginMorphReturn(); return true }
    lease = ready(provider, input)
    assert.equal(lease.beginMorphReturn().status, 'ready')
    assert.equal(nested.reason, 'voice-pose-reentrant')
    provider.dispose()
    assert.equal(lease.active, false)
    assert.equal(lease.beginMorphReturn().status, 'unavailable')
})
