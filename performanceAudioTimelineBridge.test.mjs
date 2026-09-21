import assert from 'node:assert/strict'
import test from 'node:test'
import { Group } from 'three'
import { PerformanceEditorRuntime } from './src/viewer/performanceEditor/runtime.ts'
import { AudioTimelineBridge } from './src/viewer/performanceEditor/audioTimelineBridge.ts'
import { emptyPerformanceDocument } from './src/viewer/performanceEditor/timeline.ts'
import { VoiceCatalog } from './src/viewer/voice/catalog.ts'
import { resetRuntimeProductDeliveryForTests } from './src/viewer/runtimeProductDelivery.ts'

const stableKey = 'soundMstId=200016|cueSheetName=cv_100101_outgame|cueName=cv_100101_other_evo_fee_01'
const manifest = { schema: 'magius.voice-catalog.v1', entries: [{ stableKey, characterResourceId: '100101', order: 1,
  audio: { runtimeUrl: '/voice/sample.ogg', format: 'ogg', runtimeReady: true, failClosedReasons: [], sourceStableKey: 'cri-cue:cueSheetName=cv_100101_outgame|cueName=cv_100101_other_evo_fee_01' }, subtitles: {}, durationSeconds: 2 }] }

function fixture() {
  const object = new Group(); const descriptor = { object, generation: 1, label: 'SAMPLE', actions: [], isCurrent: () => true }; const callbacks = {}
  const runtime = new PerformanceEditorRuntime({ actorSource: { list: () => [descriptor], subscribe: () => () => {} },
    framePort: { subscribeBeforePhysics: cb => { callbacks.body = cb; return () => {} }, subscribeFinalPoseBeforeCamera: () => () => {} },
    channelHost: { acquire: () => ({ status: 'ready', value: { active: true, captureEvaluated: () => ({ root: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, bones: {}, morphs: {} }), sampleActionAt: () => {}, playActionBeat: () => {}, releaseFromEvaluated: () => {} } }), notifyRootTransformChanged: () => {} },
  }); return { runtime, object, callbacks }
}

class FakeAudio { src = ''; currentTime = 0; volume = 1; paused = true; ended = false; plays = 0; play() { this.paused = false; this.plays++; } pause() { this.paused = true } load() {} }

test('audio timeline bridge schedules one element per track and follows pause/seek', async () => {
  const f = fixture(); const created = []; const bridge = new AudioTimelineBridge(f.runtime, { catalog: new VoiceCatalog(manifest), resolveRuntimeUrl: entry => entry.audio.runtimeUrl, createAudio: () => { const value = new FakeAudio(); created.push(value); return value } })
  f.runtime.setDocument({ ...emptyPerformanceDocument(), duration: 3, audioTracks: [{ id: 'voice-a', sourceStableKey: stableKey, startTime: 0.5, durationSeconds: 1.5, volume: 0.7 }], tracks: [{ id: 'root', actorKey: f.object.uuid, channel: 'root-position', keys: [{ id: 'k0', time: 0, value: [0, 0, 0] }, { id: 'k1', time: 3, value: [0, 0, 0] }] }] })
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(created.length, 1); assert.equal(created[0].src, '/voice/sample.ogg')
  f.runtime.play(); f.callbacks.body(0.75, { frameId: 1, actorKey: f.object.uuid, generation: 1 }); assert.equal(created[0].paused, false); assert.equal(created[0].currentTime, 0.25)
  f.runtime.pause(); assert.equal(created[0].paused, true); f.runtime.seek(2.5); assert.equal(created[0].currentTime, 1.5)
  assert.equal(bridge.snapshot[0].status, 'paused'); bridge.dispose(); f.runtime.dispose()
})

test('bridge reports absent catalog entries without touching playback', async () => {
  const f = fixture(); const bridge = new AudioTimelineBridge(f.runtime, { catalog: new VoiceCatalog(manifest), createAudio: () => new FakeAudio() })
  f.runtime.setDocument({ ...emptyPerformanceDocument(), duration: 1, audioTracks: [{ id: 'missing', sourceStableKey: stableKey.replace('200016', '999999'), startTime: 0 }] })
  await new Promise(resolve => setTimeout(resolve, 0)); assert.match(bridge.snapshot[0].error, /VOICE_NOT_FOUND/); bridge.dispose(); f.runtime.dispose()
})

for (const fail of [false, true]) test(`bridge real default resolver consumes catalog file provenance through byte delivery (failure=${fail})`, async t => {
  const nativeFetch = globalThis.fetch
  const descriptors = Object.fromEntries(['document', 'location'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { baseURI: 'http://127.0.0.1:6595/' } })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('http://127.0.0.1:6595/?runtimeDelivery=local') })
  resetRuntimeProductDeliveryForTests()
  const requests = [], created = [], f = fixture()
  const key = 'soundMstId=1|cueSheetName=cv_100101_outgame|cueName=cv_100101_other_story_07'
  const catalog = new VoiceCatalog({ ...manifest, entries: [{ ...manifest.entries[0], stableKey: key,
    audio: { ...manifest.entries[0].audio, runtimeUrl: 'file:///D:/magia/ma-ex-data/gamedata/Resources/Sound/Cv/cv_100101_outgame/cv_100101_other_story_07.ogg',
      sourceStableKey: 'cri-cue:cueSheetName=cv_100101_outgame|cueName=cv_100101_other_story_07' } }] })
  globalThis.fetch = async url => {
    const value = String(url); requests.push(value)
    if (value.endsWith('/catalogs/runtime-product-delivery.v1.json')) return new Response(JSON.stringify({ schema: 'magius.runtime-product-delivery.v1',
      activation: { hosts: [] }, counts: { products: 0, releaseAssets: 0, voiceProducts: 0 }, entries: [] }))
    assert.equal(value, 'http://127.0.0.1:6595/__magius_voice__/cv_100101_outgame/cv_100101_other_story_07')
    return fail ? new Response('', { status: 404 }) : new Response('OggSfixture', { headers: { 'content-type': 'application/vnd.magius.voice-payload' } })
  }
  const bridge = new AudioTimelineBridge(f.runtime, { catalog, createAudio: () => { const a = new FakeAudio(); created.push(a); return a } })
  t.after(() => {
    bridge.dispose(); f.runtime.dispose(); resetRuntimeProductDeliveryForTests(); globalThis.fetch = nativeFetch
    for (const [k, value] of Object.entries(descriptors)) { if (value) Object.defineProperty(globalThis, k, value); else delete globalThis[k] }
  })
  const ready = new Promise(resolve => { const release = bridge.subscribe(rows => {
    if (rows.some(row => row.id === 'default' && row.status !== 'pending')) { release(); resolve() }
  }) })
  f.runtime.setDocument({ ...emptyPerformanceDocument(), duration: 2, audioTracks: [{ id: 'default', sourceStableKey: key, startTime: 0 }] })
  await ready
  assert.equal(created.length, fail ? 0 : 1)
  if (fail) assert.match(bridge.snapshot[0].error, /Local voice byte delivery failed/)
  else { assert.match(created[0].src, /^blob:/); assert.equal(await (await nativeFetch(created[0].src)).text(), 'OggSfixture') }
  assert.equal(requests.length, 2)
  assert.ok(requests.every(url => !/\.ogg|^file:/.test(url)))
})
