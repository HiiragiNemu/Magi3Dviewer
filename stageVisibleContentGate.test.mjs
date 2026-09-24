import * as loadingProgress from './magia-exedra-character-three/loadingProgress.ts'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import * as THREE from 'three'
import { enableRigidStageCulling } from './src/viewer/stageRigidCulling.ts'
import { loadStageTransformModules } from './tests/helpers/loadStageTransformModules.mjs'
const { batching: { batchStaticStageMeshes, hasStageRuntimeMeshWriters }, visibility: { applyStageNativeVisibility } } = loadStageTransformModules()

const root = path.dirname(fileURLToPath(import.meta.url))
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const stagesSource = read('src/viewer/stages.ts')
const rootCatalog = JSON.parse(read('public/stages/catalog.json'))
const dungeonCatalog = JSON.parse(read(
    'public/stages/catalogs/official-dungeon-background.v1.json',
))

test('catalog status distinguishes formal scenes from presentation products', () => {
    const formalPending = rootCatalog.stages.find(
        stage => stage.id === 'battle-600-00-00-001',
    )
    assert.ok(formalPending)
    assert.equal(formalPending.type, 'fbx')
    assert.equal(formalPending.dynamic.status, 'pending')
    assert.equal(formalPending.materialBindings, undefined)
    assert.equal(formalPending.sceneProfileUrl,
        './stages/official/battle-600-00-00-001/scene-profile.json')
    const partialProfile = JSON.parse(read(`public/${formalPending.sceneProfileUrl.slice(2)}`))
    assert.equal(partialProfile.stageId, formalPending.id)
    assert.equal(partialProfile.materialBindings.length, 13)
    assert.equal(partialProfile.sourceRecords.affectedRendererCount, 18)
    // A usable partial profile is not completion of native lighting or runtime.
    assert.ok(formalPending.dynamic.missing.length > 0)
    assert.match(formalPending.dynamic.evidence.join('\n'), /geometry is present/)

    const marker = dungeonCatalog.stages.find(
        stage => stage.id === 'dungeon-10000-bg-3d-intro-0001-001',
    )
    assert.ok(marker)
    assert.equal(marker.dynamic.status, 'product-presentation')
    assert.ok(marker.dynamic.evidence.includes('exact-empty-root-marker'))
})

test('activation-time gate rejects incomplete candidates before prior stage is cleared', () => {
    assert.match(stagesSource, /'product-presentation' \| 'absent'/)
    const inspectCall = stagesSource.indexOf(
        'candidateVisibleContent = inspectStageVisibleContent(definition, candidateObject!)',
    )
    const rejection = stagesSource.indexOf(
        'if (!candidateVisibleContent.snapshot.accepted)',
        inspectCall,
    )
    const clear = stagesSource.slice(rejection).search(/clearStageObject\((?:true)?\)/) + rejection
    assert.ok(inspectCall >= 0 && rejection > inspectCall && clear > rejection)
    assert.match(stagesSource, /classification === 'formal-scene'/)
    assert.match(stagesSource, /official geometry is present but material\/profile closure is pending/)
    assert.match(stagesSource, /definition\.dynamic\?\.status === 'pending'/)
    assert.match(stagesSource, /mappedMaterialSlotCount === 0/)
})

test('visible-content evidence is bounded to activation and records bounds camera and draws', () => {
    const inspectStart = stagesSource.indexOf('function inspectStageVisibleContent(')
    const loadStart = stagesSource.indexOf('export async function loadStageById(', inspectStart)
    const inspectBlock = stagesSource.slice(inspectStart, loadStart)
    assert.match(inspectBlock, /new THREE\.Box3\(\)\.setFromObject\(object\)/)
    assert.match(inspectBlock, /new THREE\.Frustum\(\)\.setFromProjectionMatrix/)
    assert.match(inspectBlock, /drawHits\.add\(mesh\.uuid\)/)
    assert.match(inspectBlock, /snapshot\.drawProbeFrames >= 2/)

    const debugStart = stagesSource.indexOf('export function getCurrentStageDebugState()')
    const debugEnd = stagesSource.indexOf('export async function applyStagePreset', debugStart)
    const debugBlock = stagesSource.slice(debugStart, debugEnd)
    assert.doesNotMatch(debugBlock, /\.traverse\(/)
    assert.match(debugBlock, /visibleContent: visibleContent \?\? null/)
    assert.match(debugBlock, /lastCandidateVisibleContent:/)
})

// Run the production loader, not a second implementation of its transition.
// The asset boundaries are deterministic doubles so every late validation
// failure and overlapping request can be exercised without a GPU or network.
function stageLoadHarness(failure) {
    const sourceFile = ts.createSourceFile('stages.ts', stagesSource,
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const names = ['loadStageById', 'prepareStageObject']
    const functions = sourceFile.statements.filter(node =>
        ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    assert.equal(functions.length, names.length)
    const code = ts.transpileModule(functions.map(node =>
        node.getText(sourceFile).replace(/^export /, '')).join('\n'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText
    const events = []
    const old = new THREE.Group()
    old.name = 'old-visible-stage'
    const stageRoot = new THREE.Group()
    stageRoot.add(old)
    stageRoot.position.set(3, 2, 1)
    stageRoot.userData.stageDefinition = { id: 'old' }
    const oldData = stageRoot.userData.stageDefinition
    const candidates = []
    const resources = []
    const released = []
    const profile = { stageLayer: 4 }
    const makeResource = kind => {
        const value = { kind, dispose: () => released.push(kind),
            getDebugState: () => ({ kind }) }
        resources.push(value)
        return value
    }
    const context = {
        THREE, AbortController, Error, enableRigidStageCulling, batchStaticStageMeshes, hasStageRuntimeMeshWriters, applyStageNativeVisibility,
        console: { error: (...args) => events.push(['error', ...args]),
            warn() {}, log() {} },
        definitions: ['candidate', 'newer'].map(id => ({ id, name: id,
            type: 'fbx', renderProfile: profile, position: [2, 1, 4],
            rotation: [0.2, 0.3, 0.1], scale: 2 })),
        builtInStages: [{ id: 'none', name: 'none' }],
        stageLoadEpoch: 0, pendingStageLoad: undefined,
        stageSelector: { disabled: false, value: 'old' },
        stageOptions: { id: 'old', X: 3, Y: 2, Z: 1, RotateY: 0, Scale: 1, Visible: true },
        stageRuntimeOptions: { SeekSeconds: 0, TimeScale: 1 },
        activeStageObject: old, activeStageDefinition: oldData,
        activeProfileTextures: [], activeStageLightmap: undefined,
        activeStageReflectionProbes: undefined, activeStageRuntime: undefined,
        activeStageVolumetricLightBeams: undefined, activeStageVisibleContent: undefined,
        currentStageId: 'old', lastStageLoadFailure: undefined,
        lastCandidateVisibleContent: undefined, stageRoot,
        officialCameraPresetById: new Map(), initialSceneState: { background: null },
        resolveStageCameraPresetId: () => undefined,
        applyOfficialCameraPreset: value => value,
        scene: { backgroundSceneEnabled: true, scene: new THREE.Scene(),
            backgroundScene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
            stageCharacterShadows: { stageLayer: 0 }, effects: {},
            renderer: { capabilities: { getMaxAnisotropy: () => 8 } } },
        assertCurrentStageLoad(epoch, signal) {
            if (epoch !== context.stageLoadEpoch || signal.aborted)
                throw Object.assign(new Error('superseded'), { name: 'AbortError' })
        },
        isAbortError: error => error?.name === 'AbortError',
        async loadExternalStage(definition) {
            const object = new THREE.Group()
            object.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
            candidates.push(object)
            return { object, textures: [new THREE.Texture()] }
        },
        async preloadStageProfileTextures() {
            return { textures: [new THREE.Texture()],
                uv1Companion: { stageId: failure === 'identity' ? 'wrong' : 'candidate' },
                lightmaps: [new THREE.Texture()], lightmapBindings: [],
                environment: new THREE.CubeTexture() }
        },
        inspectStageVisibleContent: definition => ({ snapshot: {
            stageId: definition.id, accepted: true, classification: 'formal-scene' }, meshes: [] }),
        matchStageLightmapBindings: () => ({ matches: [] }),
        applyStageUv1Companion() {
            events.push('uv1')
            if (failure === 'uv1') throw new Error('invalid uv1')
            return { installedMeshCount: 1 }
        },
        applyStageLightmaps() {
            events.push('lightmap')
            if (failure === 'lightmap') throw new Error('invalid lightmap')
            return { ...makeResource('lightmap'), matches: [] }
        },
        hasCompleteActiveStageLightmapCoverage: value => Boolean(value),
        isCubeTexture: value => value?.isCubeTexture === true,
        applyStageReflectionProbes() {
            events.push('reflection')
            if (failure === 'reflection') throw new Error('invalid reflection')
            return makeResource('reflection')
        },
        // Global transaction behavior is covered by stageGlobalCommit.test.mjs.
        // This harness keeps its original candidate-only validation denominator.
        createStageCommitTransaction: () => ({ begin() {}, commit() {}, rollback() {},
            depthRegistrar: {} }),
        clearStageObject() {
            events.push('clear')
            context.stageRoot.clear()
            context.stageRoot.userData = {}
            context.activeStageObject = undefined
        },
        restoreSceneProfile: () => events.push('restore-profile'),
        updateStageTransform() {
            const { X, Y, Z, RotateY, Scale } = context.stageOptions
            stageRoot.position.set(X, Y, Z)
            stageRoot.rotation.y = THREE.MathUtils.degToRad(RotateY)
            stageRoot.scale.setScalar(Scale)
        },
        applyStageRenderProfile: () => events.push('profile'),
        createStageVolumetricLightBeamController: () => undefined,
        createStageRuntimeController: () => undefined,
        updateActiveStageDynamicBindings() {}, updateStageCameraEvidence() {},
        armBoundedStageDrawProbe() {},
        stageFolder: { controllersRecursive: () => [] },
        disposeStageObject: object => { released.push('object'); object.removeFromParent() },
        disposeStageEnvironmentTexture: () => released.push('texture'),
    }
    Object.assign(context, loadingProgress)
    vm.createContext(context)
    vm.runInContext(code, context)
    return { context, events, released, old, oldData, candidates, resources }
}

for (const failure of ['identity', 'uv1', 'lightmap', 'reflection']) {
    test(`late ${failure} validation preserves prior visible scene, transforms and resources`, async () => {
        const h = stageLoadHarness(failure)
        await h.context.loadStageById('candidate')
        assert.equal(h.context.activeStageObject, h.old, 'old scene must remain active')
        assert.equal(h.old.parent, h.context.stageRoot)
        assert.equal(h.context.stageRoot.userData.stageDefinition, h.oldData)
        assert.deepEqual(h.context.stageRoot.position.toArray(), [3, 2, 1])
        assert.equal(h.context.currentStageId, 'old')
        assert.equal(h.context.stageSelector.value, 'old')
        assert.equal(h.context.scene.camera.layers.mask, 1)
        assert.equal(h.context.scene.stageCharacterShadows.stageLayer, 0)
        assert.ok(!h.events.includes('clear'))
        assert.ok(!h.events.includes('restore-profile'))
        assert.equal(h.context.lastStageLoadFailure.requestedStageId, 'candidate')
        assert.equal(h.context.stageSelector.disabled, false)
        assert.equal(h.released.filter(value => value === 'object').length, 1)
        assert.equal(h.released.filter(value => value === 'texture').length, 2)
        for (const resource of h.resources) assert.ok(h.released.includes(resource.kind))
    })
}

test('successful stage preflight transfers prepared resources only after local gates', async () => {
    const h = stageLoadHarness()
    await h.context.loadStageById('candidate')
    assert.equal(h.context.currentStageId, 'candidate')
    assert.equal(h.context.stageSelector.value, 'candidate')
    assert.equal(h.context.activeStageObject, h.candidates[0])
    assert.equal(h.context.activeStageObject.parent, h.context.stageRoot)
    assert.ok(h.events.indexOf('clear') > h.events.indexOf('reflection'))
    assert.equal(h.context.activeStageLightmap.kind, 'lightmap')
    assert.equal(h.context.activeStageReflectionProbes.kind, 'reflection')
    assert.equal(h.context.scene.stageCharacterShadows.stageLayer, 4)
    assert.equal(h.context.scene.camera.layers.isEnabled(4), true)
    assert.equal(h.context.lastStageLoadFailure, undefined)
    assert.deepEqual(h.released, [])
    assert.deepEqual(h.context.stageRoot.position.toArray(), [2, 1, 4])
})

test('superseded stage request releases its candidate without overwriting latest success', async () => {
    const h = stageLoadHarness()
    let rejectFirst
    let firstLoaded
    const loaded = new Promise(resolve => { firstLoaded = resolve })
    h.context.loadExternalStage = async definition => {
        if (definition.id === 'candidate') {
            firstLoaded()
            return new Promise((_resolve, reject) => { rejectFirst = reject })
        }
        const object = new THREE.Group()
        h.candidates.push(object)
        return { object, textures: [] }
    }
    h.context.preloadStageProfileTextures = async () => ({ textures: [] })
    const first = h.context.loadStageById('candidate')
    await loaded
    await h.context.loadStageById('newer')
    rejectFirst(new Error('late failure from old request'))
    await first
    assert.equal(h.context.currentStageId, 'newer')
    assert.equal(h.context.stageSelector.value, 'newer')
    assert.equal(h.context.lastStageLoadFailure, undefined)
    assert.equal(h.context.stageRoot.userData.stageLoadFailure, null)
    assert.equal(h.context.stageSelector.disabled, false)
})

for (const boundary of ['external', 'profile']) {
    test(`superseded ${boundary} resolution disposes returned payload before returning`, async () => {
        const h = stageLoadHarness()
        let releaseFirst
        let arrived
        const ready = new Promise(resolve => { arrived = resolve })
        const texture = new THREE.Texture()
        const candidate = new THREE.Group()
        const oldExternal = h.context.loadExternalStage
        if (boundary === 'external') {
            h.context.loadExternalStage = async definition => {
                if (definition.id !== 'candidate') return oldExternal(definition)
                arrived()
                return new Promise(resolve => { releaseFirst = () => resolve({
                    object: candidate, textures: [texture],
                }) })
            }
            h.context.preloadStageProfileTextures = async () => ({ textures: [] })
        } else {
            let first = true
            h.context.preloadStageProfileTextures = async () => {
                if (!first) return { textures: [] }
                first = false
                arrived()
                return new Promise(resolve => { releaseFirst = () => resolve({ textures: [texture] }) })
            }
        }
        const first = h.context.loadStageById('candidate')
        await ready
        await h.context.loadStageById('newer')
        releaseFirst()
        await first
        assert.equal(h.context.currentStageId, 'newer')
        assert.equal(h.context.lastStageLoadFailure, undefined)
        assert.equal(h.released.filter(value => value === 'object').length, 1)
        assert.equal(h.released.filter(value => value === 'texture').length,
            boundary === 'external' ? 1 : 2)
    })
}

test('none remains an explicit successful scene removal', async () => {
    const h = stageLoadHarness()
    await h.context.loadStageById('none')
    assert.equal(h.context.currentStageId, 'none')
    assert.equal(h.context.scene.backgroundSceneEnabled, false)
    assert.equal(h.context.activeStageObject, undefined)
    assert.equal(h.context.lastStageLoadFailure, undefined)
    assert.deepEqual(h.events, ['clear', 'restore-profile'])
})
