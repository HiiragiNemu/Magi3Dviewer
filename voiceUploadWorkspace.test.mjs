import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'
import { VoiceCatalog } from './src/viewer/voice/catalog.ts'
import { VoicePlayer } from './src/viewer/voice/player.ts'
import { ViewerVoiceWorkspaceRuntime } from './src/viewer/voiceWorkspaceRuntime.ts'
import {
    VOICE_UPLOAD_ACCEPT,
    VoiceUploadWorkspace,
    isVoiceUploadFileSupported,
} from './src/viewer/voice/uploadWorkspace.ts'

class FakeNode {
    connections = []
    disconnectCount = 0

    connect(destination) {
        this.connections.push(destination)
        return destination
    }

    disconnect() {
        this.disconnectCount++
    }
}

class FakeGain extends FakeNode {
    gain = { value: 0 }
}

class FakeAnalyser extends FakeNode {
    fftSize = 0
    frequencyBinCount = 128
    samples = new Float32Array(128).fill(0.2)
    throwOnRead = false

    getFloatTimeDomainData(array) {
        if (this.throwOnRead) throw new Error('analyser fixture failure')
        array.set(this.samples)
    }
}

class FakeAudioContext {
    destination = { kind: 'destination' }
    state = 'running'
    graphs = []
    closeCount = 0
    resumeCount = 0

    createMediaElementSource(audio) {
        const source = new FakeNode()
        this.graphs.push({ audio, source })
        return source
    }

    createGain() {
        const gain = new FakeGain()
        this.graphs.at(-1).gain = gain
        return gain
    }

    createAnalyser() {
        const analyser = new FakeAnalyser()
        this.graphs.at(-1).analyser = analyser
        return analyser
    }

    async resume() {
        this.state = 'running'
        this.resumeCount++
    }

    async close() {
        this.closeCount++
    }
}

class FakeAudio {
    src = ''
    crossOrigin = null
    preload = ''
    currentTime = 0
    duration = 8
    paused = true
    ended = false
    volume = 1
    loop = false
    loadCount = 0
    playCount = 0
    pauseCount = 0
    listeners = new Map()

    async play() {
        this.paused = false
        this.ended = false
        this.playCount++
    }

    pause() {
        this.paused = true
        this.pauseCount++
    }

    load() {
        this.loadCount++
    }

    removeAttribute(name) {
        if (name === 'src') this.src = ''
    }

    addEventListener(type, listener) {
        const values = this.listeners.get(type) ?? new Set()
        values.add(listener)
        this.listeners.set(type, values)
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener)
    }

    emit(type) {
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
    }
}

function audioFile(name, type = 'audio/ogg') {
    const file = new Blob([new Uint8Array([1, 2, 3])], { type })
    Object.defineProperty(file, 'name', { value: name, enumerable: true })
    return file
}

function makeMorphTarget(name) {
    const root = new THREE.Group()
    root.name = name
    root.userData.disposeCallbacks = []
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    mesh.name = `${name}_Face`
    mesh.morphTargetDictionary = {
        Eye_Blink: 0,
        Eyebrow_Up: 1,
        Mouth_OpenVertically: 2,
        Mouth_Wide: 3,
        Mouth_Narrow: 4,
    }
    mesh.morphTargetInfluences = [0.2, 0.35, 0, 0, 0]
    root.add(mesh)
    return { root, mesh }
}

function makeNoCarrierTarget(name) {
    const root = new THREE.Group()
    root.name = name
    root.userData.disposeCallbacks = []
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    mesh.name = `${name}_Face`
    mesh.morphTargetDictionary = { Eye_Blink: 0, Eyebrow_Up: 1 }
    mesh.morphTargetInfluences = [0.2, 0.35]
    root.add(mesh)
    return { root, mesh }
}

function makeEnvironment() {
    const context = new FakeAudioContext()
    const audios = []
    const createdUrls = []
    const revokedUrls = []
    const beforeCharacterPlay = []
    return {
        context,
        audios,
        createdUrls,
        revokedUrls,
        beforeCharacterPlay,
        environment: {
            createAudioElement() {
                const audio = new FakeAudio()
                audios.push(audio)
                return audio
            },
            createAudioContext() {
                return context
            },
            createObjectUrl(file) {
                const url = `blob:voice-${createdUrls.length + 1}-${file.name}`
                createdUrls.push(url)
                return url
            },
            revokeObjectUrl(url) {
                revokedUrls.push(url)
            },
            beforeCharacterPlay(descriptor) {
                beforeCharacterPlay.push(descriptor.key)
            },
        },
    }
}

test('upload contract exposes browser-decodable voice formats and rejects unrelated files', () => {
    for (const extension of ['ogg', 'flac', 'wav', 'mp3', 'm4a', 'aac', 'webm', 'opus']) {
        assert.equal(isVoiceUploadFileSupported(audioFile(`voice.${extension}`, '')), true)
        assert.match(VOICE_UPLOAD_ACCEPT, new RegExp(`\\.${extension}`))
    }
    assert.equal(isVoiceUploadFileSupported(audioFile('voice.bin', 'audio/ogg')), true)
    assert.equal(isVoiceUploadFileSupported(audioFile('notes.txt', 'text/plain')), false)
    assert.doesNotMatch(VOICE_UPLOAD_ACCEPT, /\.hca|\.awb/)
})

test('two uploaded character voices play simultaneously with independent Demo multiwave mouth drive', async () => {
    const env = makeEnvironment()
    const a = makeMorphTarget('A')
    const b = makeMorphTarget('B')
    const workspace = new VoiceUploadWorkspace(env.environment)
    workspace.setCharacters([
        { key: a.root.uuid, characterResourceId: '100101', label: 'A', target: a.root },
        { key: b.root.uuid, characterResourceId: '100201', label: 'B', target: b.root },
    ])
    assert.equal(workspace.loadCharacterFile(a.root.uuid, audioFile('a.ogg')), true)
    assert.equal(workspace.loadCharacterFile(b.root.uuid, audioFile('b.wav', 'audio/wav')), true)
    assert.equal(env.context.graphs.length, 2)
    env.context.graphs[0].analyser.samples.fill(0.2)
    env.context.graphs[1].analyser.samples.fill(0.08)

    assert.equal(await workspace.playCharacter(a.root.uuid), true)
    assert.equal(await workspace.playCharacter(b.root.uuid), true)
    workspace.update(1 / 60)

    assert.deepEqual(env.beforeCharacterPlay, [a.root.uuid, b.root.uuid])
    assert.equal(workspace.snapshot.characterTracks.every(track => track.status === 'playing'), true)
    assert.equal(workspace.snapshot.characterTracks.every(track => track.analysisMode === 'multiwave'), true)
    assert.ok(a.mesh.morphTargetInfluences[2] > 0)
    assert.ok(b.mesh.morphTargetInfluences[2] > 0)
    assert.equal(a.mesh.morphTargetInfluences[0], 0.2)
    assert.equal(a.mesh.morphTargetInfluences[1], 0.35)
    assert.equal(b.mesh.morphTargetInfluences[0], 0.2)
    assert.equal(b.mesh.morphTargetInfluences[1], 0.35)
    await workspace.dispose()
})

test('background multitracks have independent transport and never acquire or write a mouth carrier', async () => {
    const env = makeEnvironment()
    const character = makeMorphTarget('Character')
    const workspace = new VoiceUploadWorkspace(env.environment)
    workspace.setCharacters([
        { key: character.root.uuid, characterResourceId: '100101', label: 'Character', target: character.root },
    ])
    workspace.loadCharacterFile(character.root.uuid, audioFile('voice.ogg'))
    const bgmA = workspace.addBackgroundFile(audioFile('bgm-a.mp3', 'audio/mpeg'))
    const bgmB = workspace.addBackgroundFile(audioFile('bgm-b.flac', 'audio/flac'))
    assert.ok(bgmA)
    assert.ok(bgmB)
    assert.equal(env.context.graphs.length, 3)
    assert.equal(env.context.graphs.slice(1).every(graph => graph.analyser === undefined), true)
    assert.equal(workspace.setBackgroundLoop(bgmA, true), true)
    assert.equal(workspace.setBackgroundVolume(bgmA, 1.5), true)
    assert.equal(await workspace.playBackground(bgmA), true)
    assert.equal(await workspace.playBackground(bgmB), true)
    workspace.update(1 / 60)

    const backgrounds = workspace.snapshot.backgroundTracks
    assert.equal(backgrounds.length, 2)
    assert.equal(backgrounds.every(track => track.status === 'playing'), true)
    assert.equal(backgrounds.every(track => track.analysisMode === 'none'), true)
    assert.equal(backgrounds.every(track => track.mouthCarrier.kind === 'none'), true)
    assert.equal(backgrounds[0].volume, 1.5)
    assert.equal(env.context.graphs[1].gain.gain.value, 1.5)
    assert.equal(character.mesh.morphTargetInfluences[2], 0)
    assert.equal(workspace.seekBackground(bgmA, 3.25), true)
    assert.equal(workspace.snapshot.backgroundTracks[0].positionSeconds, 3.25)
    assert.equal(workspace.pauseBackground(bgmB), true)
    assert.equal(workspace.snapshot.backgroundTracks[1].status, 'paused')
    await workspace.dispose()
})

test('pause, stop, seek and lipsync gate close only the addressed character mouth', async () => {
    const env = makeEnvironment()
    const a = makeMorphTarget('A')
    const b = makeMorphTarget('B')
    const workspace = new VoiceUploadWorkspace(env.environment)
    workspace.setCharacters([
        { key: a.root.uuid, characterResourceId: '100101', label: 'A', target: a.root },
        { key: b.root.uuid, characterResourceId: '100201', label: 'B', target: b.root },
    ])
    workspace.loadCharacterFile(a.root.uuid, audioFile('a.ogg'))
    workspace.loadCharacterFile(b.root.uuid, audioFile('b.ogg'))
    await workspace.playCharacter(a.root.uuid)
    await workspace.playCharacter(b.root.uuid)
    workspace.update(1 / 60)
    assert.ok(a.mesh.morphTargetInfluences[2] > 0)
    assert.ok(b.mesh.morphTargetInfluences[2] > 0)

    assert.equal(workspace.pauseCharacter(a.root.uuid), true)
    assert.equal(a.mesh.morphTargetInfluences[2], 0)
    workspace.update(1 / 60)
    assert.ok(b.mesh.morphTargetInfluences[2] > 0)
    assert.equal(workspace.seekCharacter(a.root.uuid, 5.5), true)
    assert.equal(workspace.snapshot.characterTracks[0].positionSeconds, 5.5)
    assert.equal(workspace.setCharacterLipSync(b.root.uuid, false), true)
    assert.equal(b.mesh.morphTargetInfluences[2], 0)
    assert.equal(workspace.stopCharacter(a.root.uuid), true)
    assert.equal(workspace.snapshot.characterTracks[0].positionSeconds, 0)
    assert.equal(workspace.snapshot.characterTracks[0].status, 'ready')
    await workspace.dispose()
})

test('analyser failure falls back to official playing-open and natural end closes the mouth', async () => {
    const env = makeEnvironment()
    const character = makeMorphTarget('Fallback')
    const workspace = new VoiceUploadWorkspace(env.environment)
    workspace.setCharacters([
        { key: character.root.uuid, characterResourceId: '100101', label: 'Fallback', target: character.root },
    ])
    workspace.loadCharacterFile(character.root.uuid, audioFile('fallback.ogg'))
    env.context.graphs[0].analyser.throwOnRead = true
    await workspace.playCharacter(character.root.uuid)
    workspace.update(1 / 60)
    assert.equal(workspace.snapshot.characterTracks[0].analysisMode, 'official-binary')
    assert.ok(character.mesh.morphTargetInfluences[2] > 0)

    env.audios[0].ended = true
    env.audios[0].emit('ended')
    assert.equal(workspace.snapshot.characterTracks[0].status, 'ended')
    assert.equal(character.mesh.morphTargetInfluences[2], 0)
    await workspace.dispose()
})

test('file replacement, character removal and workspace disposal release only owned media and nodes', async () => {
    const env = makeEnvironment()
    const a = makeMorphTarget('A')
    const b = makeMorphTarget('B')
    const workspace = new VoiceUploadWorkspace(env.environment)
    workspace.setCharacters([
        { key: a.root.uuid, characterResourceId: '100101', label: 'A', target: a.root },
        { key: b.root.uuid, characterResourceId: '100201', label: 'B', target: b.root },
    ])
    workspace.loadCharacterFile(a.root.uuid, audioFile('a-1.ogg'))
    workspace.loadCharacterFile(b.root.uuid, audioFile('b.ogg'))
    const firstGraph = env.context.graphs[0]
    const firstUrl = env.createdUrls[0]
    assert.equal(workspace.loadCharacterFile(a.root.uuid, audioFile('a-2.ogg')), true)
    assert.equal(firstGraph.source.disconnectCount, 1)
    assert.equal(firstGraph.gain.disconnectCount, 1)
    assert.equal(firstGraph.analyser.disconnectCount, 1)
    assert.ok(env.revokedUrls.includes(firstUrl))

    await workspace.playCharacter(a.root.uuid)
    await workspace.playCharacter(b.root.uuid)
    workspace.update(1 / 60)
    workspace.setCharacters([
        { key: b.root.uuid, characterResourceId: '100201', label: 'B', target: b.root },
    ])
    assert.equal(workspace.snapshot.characterTracks.length, 1)
    assert.equal(workspace.snapshot.characterTracks[0].key, b.root.uuid)
    assert.equal(a.mesh.morphTargetInfluences[2], 0)
    assert.equal(workspace.snapshot.characterTracks[0].status, 'playing')

    await workspace.dispose()
    assert.equal(b.mesh.morphTargetInfluences[2], 0)
    assert.equal(env.context.closeCount, 1)
    assert.equal(new Set(env.revokedUrls).size, env.createdUrls.length)
    assert.equal(env.audios.every(audio => audio.src === '' && audio.paused), true)
})

test('target disposal and no-carrier neighbors remain fail-closed without touching face channels', async () => {
    const env = makeEnvironment()
    const noCarrier = makeNoCarrierTarget('Neighbor')
    const workspace = new VoiceUploadWorkspace(env.environment)
    workspace.setCharacters([
        {
            key: noCarrier.root.uuid,
            characterResourceId: 'enemy-neighbor',
            label: 'Neighbor',
            target: noCarrier.root,
        },
    ])
    workspace.loadCharacterFile(noCarrier.root.uuid, audioFile('neighbor.ogg'))
    await workspace.playCharacter(noCarrier.root.uuid)
    workspace.update(1 / 60)
    assert.equal(workspace.snapshot.characterTracks[0].mouthCarrier.kind, 'none')
    assert.deepEqual(noCarrier.mesh.morphTargetInfluences, [0.2, 0.35])

    assert.equal(noCarrier.root.userData.disposeCallbacks.length, 1)
    noCarrier.root.userData.disposeCallbacks[0]()
    assert.equal(workspace.snapshot.characterTracks.length, 0)
    assert.deepEqual(noCarrier.mesh.morphTargetInfluences, [0.2, 0.35])
    await workspace.dispose()
})

test('official/upload handoff can stop only the upload bound to the same selected target', async () => {
    const env = makeEnvironment()
    const a = makeMorphTarget('A')
    const b = makeMorphTarget('B')
    const workspace = new VoiceUploadWorkspace(env.environment)
    workspace.setCharacters([
        { key: a.root.uuid, characterResourceId: '100101', label: 'A', target: a.root },
        { key: b.root.uuid, characterResourceId: '100201', label: 'B', target: b.root },
    ])
    workspace.loadCharacterFile(a.root.uuid, audioFile('a.ogg'))
    workspace.loadCharacterFile(b.root.uuid, audioFile('b.ogg'))
    await workspace.playCharacter(a.root.uuid)
    await workspace.playCharacter(b.root.uuid)
    assert.equal(workspace.stopCharacterForTarget(a.root), true)
    assert.equal(workspace.snapshot.characterTracks[0].status, 'ready')
    assert.equal(workspace.snapshot.characterTracks[1].status, 'playing')
    await workspace.dispose()
})

test('official catalog and uploaded voice perform bidirectional same-target ownership handoff', async () => {
    const uploadEnv = makeEnvironment()
    const officialEnv = makeEnvironment()
    const character = makeMorphTarget('SharedTarget')
    let officialPlayer
    const workspace = new VoiceUploadWorkspace({
        ...uploadEnv.environment,
        beforeCharacterPlay() {
            officialPlayer?.stop()
        },
    })
    workspace.setCharacters([
        {
            key: character.root.uuid,
            characterResourceId: '100101',
            label: 'SharedTarget',
            target: character.root,
        },
    ])
    workspace.loadCharacterFile(character.root.uuid, audioFile('upload.ogg'))
    await workspace.playCharacter(character.root.uuid)
    assert.equal(workspace.snapshot.characterTracks[0].status, 'playing')

    const manifest = JSON.parse(fs.readFileSync(
        './artifacts/research/20260827-voice-catalog-source-ready/manifest.v1.json',
        'utf8',
    ))
    officialPlayer = new VoicePlayer(new VoiceCatalog(manifest), {
        createAudioElement: officialEnv.environment.createAudioElement,
        createAudioContext: officialEnv.environment.createAudioContext,
        resolveRuntimeUrl(entry) {
            return `https://voice.invalid/${entry.order}.ogg`
        },
        beforePlayback(_entry, target) {
            workspace.stopCharacterForTarget(target)
        },
        setTimeout(callback) {
            return setTimeout(callback, 0)
        },
        clearTimeout(handle) {
            clearTimeout(handle)
        },
        autoSequenceGapMilliseconds: 0,
        async loadScenarioCatalog() {
            return null
        },
    })
    officialPlayer.setCharacter('100101', character.root)
    assert.equal(await officialPlayer.playAt(0), true)
    assert.equal(officialPlayer.snapshot.status, 'playing')
    assert.equal(workspace.snapshot.characterTracks[0].status, 'ready')

    assert.equal(await workspace.playCharacter(character.root.uuid), true)
    assert.equal(officialPlayer.snapshot.status, 'idle')
    assert.equal(workspace.snapshot.characterTracks[0].status, 'playing')
    await officialPlayer.dispose()
    await workspace.dispose()
})

test('Viewer panel adapter maps loaded actors and every typed character transport command', async () => {
    const env = makeEnvironment()
    const character = makeMorphTarget('PanelActor')
    const runtime = new ViewerVoiceWorkspaceRuntime({ environment: env.environment })
    const descriptor = {
        actorKey: character.root.uuid,
        characterResourceId: '100101',
        label: 'Panel Actor',
        target: character.root,
    }
    const handoffs = []
    runtime.setBeforeCharacterPlay(value => handoffs.push(value.actorKey))
    runtime.setCharacters([descriptor])
    assert.deepEqual(runtime.snapshot(), [{
        trackId: character.root.uuid,
        kind: 'character',
        actorKey: character.root.uuid,
        fileName: '',
        status: 'empty',
        positionSeconds: 0,
        durationSeconds: 0,
        volume: 1,
        loop: false,
        lipSync: true,
        reason: undefined,
    }])

    runtime.uploadCharacterTrack(descriptor, audioFile('panel.ogg'))
    await runtime.dispatch({ type: 'play', trackId: character.root.uuid })
    runtime.update(1 / 60)
    assert.deepEqual(handoffs, [character.root.uuid])
    assert.equal(runtime.snapshot()[0].status, 'playing')
    assert.ok(character.mesh.morphTargetInfluences[2] > 0)
    await runtime.dispatch({ type: 'volume', trackId: character.root.uuid, value: 1.75 })
    await runtime.dispatch({ type: 'seek', trackId: character.root.uuid, seconds: 4.25 })
    assert.equal(runtime.snapshot()[0].volume, 1.75)
    assert.equal(runtime.snapshot()[0].positionSeconds, 4.25)
    await runtime.dispatch({ type: 'lip-sync', trackId: character.root.uuid, enabled: false })
    assert.equal(character.mesh.morphTargetInfluences[2], 0)
    await runtime.dispatch({ type: 'pause', trackId: character.root.uuid })
    assert.equal(runtime.snapshot()[0].status, 'paused')
    await runtime.dispatch({ type: 'remove', trackId: character.root.uuid })
    assert.equal(runtime.snapshot()[0].status, 'empty')
    await runtime.dispose()
})

test('Viewer panel adapter adds, mixes, loops and removes independent background tracks', async () => {
    const env = makeEnvironment()
    const runtime = new ViewerVoiceWorkspaceRuntime({ environment: env.environment })
    runtime.uploadBackgroundTrack(audioFile('panel-bgm.ogg'))
    const trackId = runtime.snapshot()[0].trackId
    assert.equal(runtime.snapshot()[0].kind, 'background')
    await runtime.dispatch({ type: 'loop', trackId, enabled: true })
    await runtime.dispatch({ type: 'volume', trackId, value: 1.25 })
    await runtime.dispatch({ type: 'play', trackId })
    assert.equal(runtime.snapshot()[0].loop, true)
    assert.equal(runtime.snapshot()[0].volume, 1.25)
    assert.equal(runtime.snapshot()[0].status, 'playing')
    await runtime.dispatch({ type: 'stop', trackId })
    assert.equal(runtime.snapshot()[0].status, 'ready')
    await runtime.dispatch({ type: 'remove', trackId })
    assert.equal(runtime.snapshot().length, 0)
    await runtime.dispose()
})
