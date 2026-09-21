import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

const repository = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
const manifestPath = join(repository, 'public', 'character-actions', 'combat-jump', 'manifest.v1.json')
const representativeIds = ['100101', '100106', '100107', '100202', '100301', '101901', '108301', '111501', '114501']

function maximumVectorTrackDisplacement(track) {
    const values = [...track.values]
    const first = values.slice(0, 3)
    let maximum = 0
    for (let offset = 3; offset < values.length; offset += 3) {
        maximum = Math.max(maximum, Math.hypot(
            values[offset] - first[0],
            values[offset + 1] - first[1],
            values[offset + 2] - first[2],
        ))
    }
    return maximum
}

function isVisibilitySwitchScaleTrack(track) {
    const values = [...track.values]
    if (values.length < 6 || values.length % 3 !== 0) return false
    let hidden = false
    let visible = false
    for (let offset = 0; offset < values.length; offset += 3) {
        const sample = values.slice(offset, offset + 3)
        if (Math.max(...sample) - Math.min(...sample) > 1e-4) return false
        const uniformScale = (sample[0] + sample[1] + sample[2]) / 3
        if (uniformScale <= 0.01) hidden = true
        else if (Math.abs(uniformScale - 1) <= 0.01) visible = true
        else return false
    }
    return hidden && visible
}

async function readManifest() {
    return JSON.parse(await readFile(manifestPath, 'utf8'))
}

function installBrowserFixture() {
    class FakeImage {
        listeners = new Map()
        width = 1
        height = 1
        addEventListener(type, callback) { this.listeners.set(type, callback) }
        removeEventListener(type) { this.listeners.delete(type) }
        set src(value) {
            this.source = value
            queueMicrotask(() => this.listeners.get('load')?.({ target: this }))
        }
        get src() { return this.source }
    }
    globalThis.document = {
        baseURI: 'http://combat-jump.local/',
        createElementNS() { return new FakeImage() },
    }
    globalThis.fetch = async input => {
        const url = new URL(typeof input === 'string' ? input : input.url, globalThis.document.baseURI)
        const path = join(repository, 'public', decodeURIComponent(url.pathname).replace(/^\//, ''))
        try {
            const data = await readFile(path)
            return new Response(data, { status: 200, headers: { 'content-length': String(data.length) } })
        } catch {
            return new Response('missing', { status: 404 })
        }
    }
}

test('manifest preserves exact authority, runtime, action and donor counts', async () => {
    const manifest = await readManifest()
    assert.equal(manifest.schema, 'magius.all-character-combat-jump-resource-manifest.v1')
    assert.equal(manifest.catalogSchema, 'magius.official-character-action-catalog.v1')
    assert.equal(manifest.counts.viewerModels, 91)
    assert.equal(manifest.counts.mappedBattleModels, 89)
    assert.equal(manifest.counts.canonicalStyleVariants, 106)
    assert.equal(manifest.counts.combatEntries, 296)
    assert.equal(manifest.counts.sourceAvailableActions, 238)
    assert.equal(manifest.counts.playbackReadyCombatActions, 234)
    assert.equal(manifest.counts.consumerUnavailableCombatActions, 4)
    assert.equal(manifest.counts.unavailableActions, 58)
    assert.equal(manifest.counts.runtimeComponents, 1190)
    assert.equal(manifest.counts.runtimeClips, 1190)
    assert.equal(manifest.counts.jumpCandidateEntries, 527)
    assert.equal(manifest.counts.sourceAvailableJumpDonors, 177)
    assert.deepEqual(manifest.counts.jumpDonorGrades, { A: 144, B: 33, C: 350 })
    assert.equal(manifest.entries.length, 823)
    assert.equal(new Set(manifest.entries.map(entry => entry.id)).size, 823)
})

test('stable MasterData and pathID identities replace names and retain exact fail-closed gaps', async () => {
    const manifest = await readManifest()
    const normal = manifest.entries.find(entry => entry.id === 'official-combat:100107:10010701:1000:100001:chara_100107_normalattack_00')
    assert.ok(normal)
    assert.equal(normal.skill.skillUniqueId, '1000')
    assert.equal(normal.skill.skillMstId, '100001')
    assert.equal(normal.playback.synchronizedAction.targets.find(target => target.role === 'body').sequence.start.pathId, '2936301950776715863')
    assert.equal(normal.playback.synchronizedAction.targets.find(target => target.role === 'weapon-a').sequence.start.pathId, '8064167950458814151')
    const umbrella = manifest.entries.find(entry => entry.id === 'official-combat:101901:10190101:1174:117401:special_skill_direction_10190101')
    assert.equal(umbrella.availability.status, 'unavailable')
    assert.match(umbrella.availability.reason, /8 external weapon\/attachment copy clips/)
    assert.deepEqual(umbrella.playback.synchronizedAction.targets, [])
    for (const id of ['100205', '113501']) {
        const coverage = manifest.characters.find(character => character.characterId === id)
        assert.equal(coverage.battleAvailability.status, 'unavailable')
        assert.equal(coverage.runtime, null)
    }
})

test('all eighty-nine local runtime carriers reopen and match exact manifest clips', async () => {
    const manifest = await readManifest()
    const runtimeCharacters = manifest.characters.filter(character => character.runtime)
    assert.equal(runtimeCharacters.length, 89)
    let componentCount = 0
    for (const character of runtimeCharacters) {
        const bytes = await readFile(join(repository, 'public', character.runtime.url.replace(/^\//, '')))
        const runtime = JSON.parse(gunzipSync(bytes).toString('utf8'))
        assert.equal(runtime.schema, 'magius.combat-jump-action-runtime.v1')
        assert.equal(runtime.characterId, character.characterId)
        assert.equal(runtime.modelKey, character.modelKey)
        assert.equal(runtime.modelRootName, character.modelRootName)
        assert.equal(runtime.rigFingerprint, character.rigFingerprint)
        assert.equal(runtime.clips.length, runtime.components.length)
        assert.equal(Object.keys(runtime.nodePaths).length, Object.keys(runtime.nodeBindings).length)
        componentCount += runtime.components.length
        const runtimeKeys = new Set(runtime.clips.map(clip => `${clip.runtimeName}\0${clip.sourceClipPathId}`))
        for (const entry of manifest.entries.filter(entry => (
            entry.characterIdentity.characterId === character.characterId
            && entry.availability.status === 'source-available'
        ))) {
            const descriptors = entry.groupId === 'official-combat-complete-actions'
                ? entry.playback.synchronizedAction.targets.flatMap(target => Object.values(target.sequence))
                : entry.playback.jumpDonor.segments.map(segment => segment.sourceClip)
            for (const descriptor of descriptors) {
                assert.ok(runtimeKeys.has(`${descriptor.name}\0${descriptor.pathId}`), entry.id)
            }
        }
    }
    assert.equal(componentCount, 1190)
})

test('all 823 entries satisfy the action-layer catalog and all 411 available playbacks resolve', async () => {
    const manifest = await readManifest()
    const {
        createOfficialCharacterActionCatalog,
        createOfficialCharacterCatalogPlayback,
    } = await import('./src/viewer/characterTimeline.ts')
    const catalog = createOfficialCharacterActionCatalog(manifest.entries)
    let combat = 0
    let donors = 0
    for (const entry of catalog.entries) {
        if (entry.availability.status !== 'source-available') continue
        if ('synchronizedAction' in entry.playback) {
            const result = createOfficialCharacterCatalogPlayback(entry, {
                availableTargetIds: entry.playback.synchronizedAction.targets.map(target => target.targetId),
                availableExtensionTypes: entry.requiredExtensionTypes ?? [],
                holdSeconds: entry.playbackOptions?.holdSeconds ?? undefined,
            })
            assert.equal(result.ok, true, `${entry.id}: ${result.detail ?? ''}`)
            combat++
        } else {
            const clips = [...new Map(entry.playback.jumpDonor.segments.map(segment => [
                `${segment.sourceClip.name}\0${segment.sourceClip.pathId}`,
                { name: segment.sourceClip.name, pathId: segment.sourceClip.pathId },
            ])).values()]
            const result = createOfficialCharacterCatalogPlayback(entry, {
                runtime: {
                    dungeonCharacterId: 'typed BLANK: combat-only',
                    characterId: entry.characterIdentity.characterId,
                    resourceName: entry.characterIdentity.resourceName,
                    controllerPathId: 'typed BLANK: Timeline-driven',
                    bodyTargetId: `combat:${entry.characterIdentity.characterId}:body`,
                    clips,
                    externalWeaponTargetIds: [],
                },
                targetId: `combat:${entry.characterIdentity.characterId}:body`,
            })
            assert.equal(result.ok, true, `${entry.id}: ${result.detail ?? ''}`)
            donors++
        }
    }
    assert.equal(combat, 234)
    assert.equal(donors, 177)
})

test('every usable jump donor is exact-rig, body-only and controller-rooted', async () => {
    const manifest = await readManifest()
    const donors = manifest.entries.filter(entry => entry.groupId === 'official-combat-jump-donors')
    assert.equal(donors.length, 527)
    for (const entry of donors) {
        const donor = entry.playback.jumpDonor
        assert.equal(donor.attachmentPolicy, 'body-only-exclude-external-weapons')
        if (entry.availability.status === 'source-available') {
            assert.ok(['A', 'B'].includes(donor.grade))
            assert.equal(donor.compatibility, 'exact-rig')
            assert.deepEqual(donor.compatibleCharacterIds, [entry.characterIdentity.characterId])
            assert.deepEqual(donor.segments.map(segment => segment.phase), ['takeoff', 'airborne', 'land'])
            assert.ok(donor.segments.every(segment => segment.rootPolicy === 'controller-all'))
            assert.ok(donor.segments.every(segment => segment.bodyMask === 'full-body'))
        } else {
            assert.equal(donor.grade, 'C')
            assert.equal(donor.compatibility, 'incompatible')
            assert.deepEqual(donor.segments, [])
        }
    }
})

test('actual loader preserves authored eye and bow-string motion with discrete weapon variants', async () => {
    const originalDocument = globalThis.document
    const originalFetch = globalThis.fetch
    installBrowserFixture()
    try {
        const { CharacterActionResourceManager } = await import('./src/viewer/characterActions/index.ts')
        const manager = new CharacterActionResourceManager()
        const catalog = await manager.readyCombatJump()
        assert.equal(catalog.list().length, 823)
        for (const id of representativeIds) {
            const compressed = await readFile(join(
                repository,
                'magia-exedra-character-three',
                'models',
                `chara_${id}_battle_unit`,
                'VisualRoot.fbx.gz',
            ))
            const fbx = gunzipSync(compressed)
            const buffer = fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength)
            const object = new FBXLoader().parse(buffer, '')
            const eyeNodeIds = new Set()
            const stringNodeIds = new Set()
            const gripVariantNodeIds = new Set()
            object.traverse(node => {
                if (/^Eye_[LR]$/.test(node.name)) eyeNodeIds.add(node.uuid)
                if (node.name === 'String') stringNodeIds.add(node.uuid)
                if (/^Grip_[AB]_01$/.test(node.name)) gripVariantNodeIds.add(node.uuid)
            })
            assert.ok(eyeNodeIds.size >= 2, `${id} eye-bone fixture is incomplete`)
            if (id === '100101' || id === '100107') {
                assert.ok(stringNodeIds.size > 0, `${id} bow String fixture is incomplete`)
                assert.ok(gripVariantNodeIds.size >= 2, `${id} bow grip variants are incomplete`)
            }
            const modelKey = `battle/character/chara_${id}_battle_unit`
            const loaded = await manager.attachCombatJumpActions(id, modelKey, object)
            assert.equal(loaded.characterId, id)
            assert.ok(loaded.clips.length > 0)
            assert.ok(loaded.clips.some(clip => clip.role === 'body'))
            assert.ok(loaded.availableTargetIds.includes(`combat:${id}:body`))
            assert.deepEqual(loaded.runtimeInventory.externalWeaponTargetIds, [])
            assert.ok(loaded.clips.every(clip => object.animations.includes(clip.clip)))
            assert.ok(loaded.clips.every(clip => clip.clip.tracks.length > 0))
            assert.ok(loaded.clips.filter(clip => clip.role !== 'body').every(clip => clip.clip.name.includes('OfficialCombat_')))
            for (const loadedClip of loaded.clips.filter(clip => clip.role === 'body')) {
                assert.equal(
                    loadedClip.clip.tracks.some(track => /(?:^|\/)Root\.position$/i.test(track.name)),
                    false,
                    `${id}:${loadedClip.clip.name} must not carry controller-owned Root.position`,
                )
            }
            let authoredEyeTracks = 0
            for (const loadedClip of loaded.clips.filter(clip => clip.role === 'body')) {
                authoredEyeTracks += loadedClip.clip.tracks.filter(track => (
                    eyeNodeIds.has(track.name.slice(0, track.name.indexOf('.')))
                )).length
            }
            assert.ok(authoredEyeTracks > 0, `${id} lost all official eye-bone tracks`)
            let bowStringPositionTracks = 0
            let movingBowStringPositionTracks = 0
            let discreteGripVisibilityTracks = 0
            for (const loadedClip of loaded.clips) {
                for (const track of loadedClip.clip.tracks) {
                    const separator = track.name.indexOf('.')
                    const nodeId = track.name.slice(0, separator)
                    const property = track.name.slice(separator)
                    if (stringNodeIds.has(nodeId) && property === '.position') {
                        bowStringPositionTracks += 1
                        if (maximumVectorTrackDisplacement(track) > 2) movingBowStringPositionTracks += 1
                    }
                    if (
                        gripVariantNodeIds.has(nodeId)
                        && property === '.scale'
                        && isVisibilitySwitchScaleTrack(track)
                    ) {
                        discreteGripVisibilityTracks += 1
                        assert.equal(
                            track.getInterpolation(),
                            THREE.InterpolateDiscrete,
                            `${id}:${loadedClip.clip.name} linearly squashes a visibility-switched bow variant`,
                        )
                    }
                }
            }
            if (id === '100101' || id === '100107') {
                assert.ok(bowStringPositionTracks > 0, `${id} dropped every authored bow String position track`)
                assert.ok(movingBowStringPositionTracks > 0, `${id} bow String no longer has authored pull travel`)
                assert.ok(discreteGripVisibilityTracks > 0, `${id} bow variant visibility tracks were not attached`)
            }
            if (id === '100107') {
                const diffusioId = 'official-combat:100107:10010701:1001:100101:chara_100107_wholeskill_00'
                const expectedDiffusioPhases = [
                    ['body', 'start', '9176534122656470431'],
                    ['body', 'end', '396198928238560805'],
                    ['weapon-a', 'start', '560145341694190437'],
                    ['weapon-a', 'end', '2486588199174482533'],
                ]
                for (const [role, phase, pathId] of expectedDiffusioPhases) {
                    const exact = loaded.getClip(diffusioId, role, phase)
                    assert.ok(exact, `Diffusio Sagitta runtime omitted ${role}:${phase}`)
                    assert.equal(exact.pathId, pathId)
                }
                for (const phase of ['start', 'end']) {
                    const bodyPhase = loaded.getClip(diffusioId, 'body', phase)
                    assert.ok(bodyPhase.clip.tracks.some(track => (
                        eyeNodeIds.has(track.name.slice(0, track.name.indexOf('.')))
                    )), `Diffusio Sagitta ${phase} lost official Eye_L/Eye_R motion`)
                }
            }
            const mixer = new THREE.AnimationMixer(object)
            const body = loaded.clips.find(clip => clip.role === 'body')
            mixer.clipAction(body.clip).reset().play()
            mixer.update(1 / 60)
            mixer.stopAllAction()
            mixer.uncacheRoot(object)
        }
    } finally {
        globalThis.fetch = originalFetch
        if (originalDocument === undefined) delete globalThis.document
        else globalThis.document = originalDocument
    }
})

test('exact-model gate rejects cross-character attachment before rig traversal', async () => {
    const originalDocument = globalThis.document
    const originalFetch = globalThis.fetch
    installBrowserFixture()
    try {
        const { CharacterActionResourceManager, CharacterActionResourceError } = await import(
            './src/viewer/characterActions/index.ts'
        )
        const manager = new CharacterActionResourceManager()
        const object = new THREE.Group()
        object.name = 'chara_100107_battle_unit'
        await assert.rejects(
            manager.attachCombatJumpActions(
                '100107',
                'battle/character/chara_100106_battle_unit',
                object,
            ),
            error => error instanceof CharacterActionResourceError && error.code === 'MODEL_MISMATCH',
        )
    } finally {
        globalThis.fetch = originalFetch
        if (originalDocument === undefined) delete globalThis.document
        else globalThis.document = originalDocument
    }
})

test('resource source remains isolated from UI, Shader, scene and dist consumers', async () => {
    const index = await readFile(join(repository, 'src', 'viewer', 'characterActions', 'index.ts'), 'utf8')
    const loader = await readFile(join(repository, 'src', 'viewer', 'characterActions', 'combatLoader.ts'), 'utf8')
    assert.match(index, /readyCombatJump/)
    assert.match(index, /listCombatJumpActions/)
    assert.match(index, /attachCombatJumpActions/)
    assert.match(loader, /serialized\.role === 'body'/)
    assert.match(loader, /body-only|externalWeaponTargetIds: \[\]/)
    assert.doesNotMatch(index + loader, /enemyPanel|viewerLocomotion|stageMaterial|shader/i)
})

test('all 234 source-ready combat entries resolve as extension-free exact body-weapon previews', async () => {
    const manifest = await readManifest()
    const { createOfficialCharacterCatalogPlayback } = await import('./src/viewer/characterTimeline.ts')
    const entries = manifest.entries.filter(entry => (
        entry.groupId === 'official-combat-complete-actions'
        && entry.availability.status === 'source-available'
        && 'synchronizedAction' in entry.playback
    ))
    assert.equal(entries.length, 234)
    assert.deepEqual(
        Object.fromEntries([...Map.groupBy(entries, entry => entry.skill.semantic)]
            .map(([semantic, values]) => [semantic, values.length])
            .sort(([left], [right]) => left.localeCompare(right, 'en'))),
        { normalAttack: 95, skill: 70, special: 69 },
    )
    for (const entry of entries) {
        const bindings = Object.fromEntries(entry.playback.synchronizedAction.targets.map(target => [
            target.targetId,
            {
                setActionState() {},
                setAnimationClip() {},
            },
        ]))
        const preview = {
            ...entry,
            playback: {
                ...entry.playback,
                extensionEvents: [],
            },
            requiredExtensionTypes: [],
        }
        const result = createOfficialCharacterCatalogPlayback(preview, {
            availableTargetIds: entry.playback.synchronizedAction.targets.map(target => target.targetId),
            availableExtensionTypes: [],
            holdSeconds: entry.playbackOptions?.holdSeconds ?? undefined,
            bindings,
        })
        assert.equal(result.ok, true, `${entry.id}: ${result.detail ?? ''}`)
        if (!result.ok) continue
        assert.ok((result.document.events ?? []).every(event => !event.type.startsWith('official-combat-')))
        result.play()
        result.step(result.state().durationSeconds)
        assert.equal(result.state().playing, false)
    }
})
