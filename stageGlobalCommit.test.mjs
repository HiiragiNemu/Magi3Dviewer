import * as loadingProgress from './magia-exedra-character-three/loadingProgress.ts'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import * as THREE from 'three'
import { CSM } from 'three/examples/jsm/csm/CSM.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const sourceRoot = process.env.STAGE_SOURCE_ROOT ?? here
const inputs = process.env.STAGE_INPUT_ROOT ?? sourceRoot
const read = relative => fs.readFileSync(path.join(inputs, relative), 'utf8')
const selected = relative => fs.readFileSync(path.join(sourceRoot, relative), 'utf8')
function evaluate(source, context, names = []) {
    const file = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)
    const body = file.statements.filter(n => !ts.isImportDeclaration(n)
        && !ts.isExportDeclaration(n)).map(n => n.getText(file)
        .replace(/^export /, '')).join('\n')
    const code = ts.transpileModule(body, { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
    } }).outputText
    return vm.runInContext(`(()=>{${code}\nreturn {${names.join(',')}}})()`, context)
}
function fixture() {
    const events = [], loops = new Set(), depths = new Set()
    const scene = {
        scene: new THREE.Scene(), backgroundScene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(45, 1, 0.1, 300),
        ambientLight: new THREE.AmbientLight(), backgroundAmbientLight: new THREE.AmbientLight(),
        directionalLight: new THREE.DirectionalLight(), backgroundSceneEnabled: true,
        stageCharacterShadows: { stageLayer: 0 }, characters: [],
        renderer: { toneMapping: THREE.NoToneMapping, toneMappingExposure: 1,
            domElement: { style: { filter: 'old-filter' } },
            capabilities: { getMaxAnisotropy: () => 8 },
            getClearAlpha: () => scene.alpha,
            setClearAlpha: value => { scene.alpha = value },
            getDrawingBufferSize: vector => vector.set(800, 600) }, alpha: 1,
        setColorFilter: value => { scene.renderer.domElement.style.filter = JSON.stringify(value) },
        getColorFilterCSS: () => scene.renderer.domElement.style.filter,
    }
    scene.camera.position.set(0, 2, 8)
    scene.controls = new OrbitControls(scene.camera, null)
    const uniforms = keys => Object.fromEntries(keys.map(key => [key, { value:
        /Color|Tint/.test(key) ? new THREE.Color() : 0 }]))
    scene.effects = {
        bloomPass: { enabled: false, strength: 1, radius: 0, threshold: 1 },
        urpBloomPass: { enabled: false, intensity: 1, scatter: 0.7,
            threshold: 1, clamp: 65472, maxIterations: 6, tint: new THREE.Color() },
        backgroundColorAdjustPass: { enabled: false, uniforms: uniforms([
            'uEnabled', 'uGlobalTint', 'uBackgroundTint', 'uPostExposure', 'uContrast', 'uSaturation']) },
        paraffinPass: { enabled: false, uniforms: uniforms(['uEnabled', 'uTopColor', 'uBottomColor',
            'uOpacity', 'uParaWidth', 'uTopBlendMode', 'uBottomBlendMode', 'uUseFixedLightDirection']) },
        registerBackgroundDepthConsumer: value => { depths.add(value); return () => depths.delete(value) },
    }
    const context = vm.createContext({ ...loadingProgress, THREE, CSM, ShaderPass, AbortController, DOMException, Error,
        AggregateError, console: { log() {}, warn: (...args) => events.push(['warn', ...args]),
            error: (...args) => events.push(['error', ...args]) }, scene,
        window: {}, recoveredHemisphereLight: new THREE.HemisphereLight(),
        recoveredFillLight: new THREE.DirectionalLight(),
        toonStylizationOptions: { characterTint: '#ffffff', characterShadowTint: '#ffffff',
            characterLightingOverrideColor: '#ffffff', characterLightingOverrideRatio: 0,
            rimEnabled: true, rimColor: '#ffffff', rimStrength: 1, rimDirectionX: 0, rimDirectionY: 0 },
        DepthRimExperiment: { additionalDirectionVS: new THREE.Vector2(), additionalColor: new THREE.Color() },
        direction: { enabled: false, eulerDegrees: [0, 0, 0] },
        getMeshToonStylizationUniforms: mesh => mesh.controllers ?? [],
        getReDriveCharacterLightingDirectionState: () => ({ ...context.direction }),
        setReDriveCharacterLightingOverrideDirection: (enabled, eulerDegrees) =>
            (context.direction = { enabled, eulerDegrees: [...eulerDegrees] }),
        addAnimationLoop: loop => loops.add(loop), removeAnimationLoop: loop => loops.delete(loop),
        getClockDelta: () => 0.016,
    })
    const helper = path.join(sourceRoot, 'src/viewer/stageCommitState.ts')
    const cullingHelper = path.join(sourceRoot, 'src/viewer/stageRigidCulling.ts')
    if (fs.existsSync(cullingHelper)) Object.assign(context, evaluate(fs.readFileSync(cullingHelper, 'utf8'), context,
        ['enableRigidStageCulling']))
    Object.assign(context, evaluate(selected('src/viewer/stageTransformAnimations.ts'), context,
        ['prepareStageTransformAnimations', 'hasStageTransformBatchUpdater', 'registerStageTransformBatchUpdater']))
    const batchingHelper = path.join(sourceRoot, 'src/viewer/stageStaticBatching.ts')
    if (fs.existsSync(batchingHelper)) Object.assign(context, evaluate(fs.readFileSync(batchingHelper, 'utf8'), context,
        ['batchStaticStageMeshes', 'hasStageRuntimeMeshWriters']))
    if (fs.existsSync(helper)) Object.assign(context, evaluate(fs.readFileSync(helper, 'utf8'), context,
        ['captureStageFields', 'captureStageRecord', 'captureStageUniforms']))
    Object.assign(context, evaluate(read('magia-exedra-character-three/coordinateSpace.ts'), context,
        ['unityWorldToViewerVector']))
    Object.assign(context, evaluate(read('magia-exedra-character-three/shaders/userdata.ts'), context,
        ['MaterialUserData', 'ShaderUniformsController']))
    Object.assign(context, evaluate(read('magia-exedra-character-three/shaders/stylization.ts'), context,
        ['toonStylizationOptions', 'ToonStylizationUniforms', 'getMeshToonStylizationUniforms',
            'getReDriveCharacterLightingDirectionState', 'setReDriveCharacterLightingOverrideDirection']))
    const characterMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    const materialData = new context.MaterialUserData()
    materialData.shader = { uniforms: {} }
    materialData.shaderUniforms = new context.ToonStylizationUniforms(materialData.shader)
    characterMesh.material.userData = materialData
    scene.characters.push({ character: { userData: { meshes: [characterMesh] } } })
    Object.assign(context, evaluate(read('src/viewer/unityLighting.ts'), context,
        ['unityShL2ToThree', 'unityWorldToViewerVector', 'unityLightColorToLinear',
            'unityDiffuseRadianceToThree', 'UNITY_TO_THREE_DIFFUSE_IRRADIANCE']))
    Object.assign(context, evaluate(read('src/viewer/stageHierarchy.ts'), context,
        ['resolveStageHierarchyPath', 'resolveStageAnchor']))
    Object.assign(context, evaluate(selected('src/viewer/stageNativeVisibility.ts'), context,
        ['applyStageNativeVisibility']))
    Object.assign(context, evaluate(selected('src/viewer/stageMainLightCascades.ts'), context,
        ['StageMainLightCascadeController', 'resolveOfficialMainShadowDistance',
            'resolveOfficialUrpDirectionalShadowPlan', 'resolveOfficialUrpDirectionalCascadeBias',
            'resolveStageShadowQualityProfile']))
    const volume = evaluate(read('magia-exedra-character-three/scene/volumePostProcessing.ts'), context,
        ['ReDriveVolumePostProcessingPass'])
    scene.effects.volumePostProcessPass = new volume.ReDriveVolumePostProcessingPass()
    const rdNames = ['applyReDriveVolumeRuntime', 'resetReDriveVolumeRuntime']
    if (selected('src/viewer/reDriveVolumeRuntime.ts').includes('captureReDriveVolumeRuntime'))
        rdNames.push('captureReDriveVolumeRuntime')
    Object.assign(context, evaluate(selected('src/viewer/reDriveVolumeRuntime.ts'), context, rdNames))
    Object.assign(context, evaluate(read('src/viewer/stageRuntime.ts'), context,
        ['createStageRuntimeController']))
    Object.assign(context, evaluate(read('src/viewer/stageVolumetricLightBeams.ts'), context,
        ['createStageVolumetricLightBeamController']))
    const stageRoot = new THREE.Group(), foregroundStageLightRoot = new THREE.Group()
    scene.backgroundScene.add(stageRoot); scene.scene.add(foregroundStageLightRoot)
    const source = selected('src/viewer/stages.ts')
    const ast = ts.createSourceFile('stages.ts', source, ts.ScriptTarget.Latest, true)
    const constants = new Set(['initialSceneState', 'officialUrpShadowResolution',
        'keyLightAnchorPosition', 'keyLightAnchorDirection', 'foregroundLightPosition',
        'foregroundLightTarget', 'foregroundLightDirection', 'stageLightProfilePosition',
        'stageLightProfileTarget', 'stageLightProfileDirection'])
    const code = ast.statements.filter(node => ts.isFunctionDeclaration(node)
        || (ts.isVariableStatement(node) && node.declarationList.declarations.some(
            d => constants.has(d.name.getText(ast))))).map(n => n.getText(ast).replace(/^export /, '')).join('\n')
    const definitions = ['old', 'candidate'].map(id => ({ id, name: id, type: 'fbx', category: 'battle',
        position: id === 'old' ? [3, 2, 1] : [0, 0, 0], scale: 1,
        renderProfile: { source: 'ReDriveVolume', stageLayer: 4,
            backgroundColor: id === 'old' ? '#234567' : '#fedcba',
            reDriveVolume: { skyboxIntensity: id === 'old' ? 0.7 : 4,
                shAmbient: Array(27).fill(id === 'old' ? 0.2 : 0.9),
                characterTint: id === 'old' ? '#ff0000' : '#00ff00' },
            ambientLight: { color: '#ffffff', intensity: id === 'old' ? 0.6 : 3 },
            renderer: { toneMapping: 'aces', exposure: id === 'old' ? 0.8 : 5 },
            postProcessing: { vignette: { intensity: 0.3, center: [0.2, 0.7] },
                colorAdjustments: { active: true, postExposure: 2 } },
            lights: [{ name: 'Key', type: 'directional', role: 'character-key',
                color: '#ffffff', intensity: 1, position: [0, 4, -5], target: [0, 0, 0],
                castShadow: true, shadow: { type: 2, bias: 1, normalBias: 1, strength: 0.8 } }],
            camera: { position: id === 'old' ? [1, 3, 9] : [9, 4, 2], target: [0, 1, 0], fov: 40 } },
        runtime: { clipNames: [], rotators: [{ objectName: 'moving', degreesPerSecond: [0, 1, 0] }] },
    }))
    const beamSource = JSON.parse(read('public/stages/official/battle-608-00-00-001/scene-profile.json')).runtime
    for (const definition of definitions) Object.assign(definition.runtime, {
        volumetricLightBeamConfig: beamSource.volumetricLightBeamConfig,
        volumetricLightBeams: [{ ...beamSource.volumetricLightBeams[0],
            lightAnchorPath: 'moving', hierarchyPath: 'moving' }],
    })
    const objects = [], textures = []
    Object.assign(context, { definitions, builtInStages: [{ id: 'none', name: 'none' }],
        stageRoot, foregroundStageLightRoot, stageLoadEpoch: 0, pendingStageLoad: undefined,
        stageSelector: { disabled: false, value: 'none' }, currentStageId: 'none',
        stageOptions: { id: 'none', X: 0, Y: 0, Z: 0, RotateY: 0, Scale: 1, Visible: true },
        stageRuntimeOptions: { SeekSeconds: 0, TimeScale: 1 },
        activeProfileTextures: [], activeForegroundStageLightBindings: [],
        stageShadowQuality: 'official', officialCameraPresetById: new Map(),
        STAGE_CHARACTER_SHADOW_CASTERS_ENABLED: 'test-stage-casters',
        stageFolder: { controllersRecursive: () => [] },
        isCubeTexture: value => value?.isCubeTexture,
        hasCompleteActiveStageLightmapCoverage: () => false,
        disposeStageEnvironmentTexture: texture => texture.dispose(),
        requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    })
    for (const name of ['activeStageObject', 'activeStageDefinition', 'activeStageRuntime',
        'activeStageVolumetricLightBeams', 'activeStageVisibleContent', 'activeStageReflectionProbes',
        'activeStageLightmap', 'activeStageMainLightCascades', 'activeStageMainLightCascadeOptions',
        'activeCharacterKeyLightAnchor', 'lastStageLoadFailure', 'lastCandidateVisibleContent',
        'cancelActiveStageDrawProbe']) context[name] = undefined
    context.activeCharacterKeyLightBaseVisible = true
    vm.runInContext(ts.transpileModule(code, { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
    } }).outputText, context)
    // Only file/catalog boundaries are replaced. Actual global consumers and
    // actual clear/restore/dynamic bindings run, including Three CSM and mixer.
    Object.assign(context, {
        applyOfficialCameraPreset: value => value, resolveStageCameraPresetId: () => undefined,
        async loadExternalStage() {
            const object = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(),
                new THREE.MeshStandardMaterial())
            mesh.name = 'moving'; object.add(mesh); objects.push(object)
            return { object, textures: [] }
        },
        async preloadStageProfileTextures() {
            const environment = new THREE.Texture(); textures.push(environment)
            return { environment, textures: [environment] }
        },
        inspectStageVisibleContent: definition => ({ snapshot: { accepted: true, stageId: definition.id }, meshes: [] }),
        updateStageCameraEvidence() {}, armBoundedStageDrawProbe() {},
    })
    return { context, scene, definitions, objects, textures, loops, depths, events, materialData,
        async dispose() { await context.loadStageById('none'); scene.effects.volumePostProcessPass.dispose() } }
}
function observed(h) {
    const c = h.context, s = h.scene, p = s.effects.volumePostProcessPass
    return { object: c.activeStageObject, definition: c.activeStageDefinition, id: c.currentStageId,
        selector: c.stageSelector.value, root: c.stageRoot.position.toArray(), options: { ...c.stageOptions },
        environment: s.scene.environment, background: s.backgroundScene.background,
        backgroundEnabled: s.backgroundSceneEnabled, intensity: s.scene.environmentIntensity,
        exposure: s.renderer.toneMappingExposure, toneMapping: s.renderer.toneMapping,
        ambient: s.ambientLight.intensity, color: c.toonStylizationOptions.characterTint,
        uniformColor: h.materialData.shader.uniforms.uGlobalCharacterTint?.value.getHexString(),
        direction: c.getReDriveCharacterLightingDirectionState(),
        camera: s.camera.position.toArray(), quaternion: s.camera.quaternion.toArray(),
        projection: s.camera.projectionMatrix.toArray(), target: s.controls.target.toArray(),
        postExposure: p.uniforms.uPostExposure.value, postVignette: p.uniforms.uVignetteCenter.value.toArray(),
        grain: JSON.stringify(p.filmGrainRuntime), runtime: c.activeStageRuntime,
        runtimeTime: c.activeStageRuntime?.time, runtimePaused: c.activeStageRuntime?.paused,
        cascades: c.activeStageMainLightCascades, cascadeLightIds: c.activeStageMainLightCascades?.lights.map(l => l.uuid),
        depthIds: [...h.depths].map(value => value.object.uuid), volumetric: c.activeStageVolumetricLightBeams,
        shadow: s.directionalLight.shadow,
        shaders: [THREE.ShaderChunk.lights_fragment_begin, THREE.ShaderChunk.lights_pars_begin],
        sh: s.scene.children.filter(o => o.isLightProbe).map(o => [o.intensity, ...o.sh.toArray()]),
        loops: [...h.loops] }
}
for (const failure of ['csm-bias', 'volume-center', 'redrive-direction', 'character-uniform', 'runtime-director', 'vlb-constructor', 'none-reset']) {
    test(`global ${failure} failure retains exact old scene and live resources`, async () => {
        const h = fixture(), c = h.context
        try {
            await c.loadStageById('old')
            assert.equal(c.currentStageId, 'old', 'fixture old load must succeed: ' + JSON.stringify(c.lastStageLoadFailure))
            c.activeStageRuntime.seek(3.75); c.activeStageRuntime.pause()
            h.scene.effects.volumePostProcessPass.filmGrainRuntime.frameIndex = 83
            const before = observed(h), disposed = []
            before.object.children[0].geometry.addEventListener('dispose', () => disposed.push('old-geometry'))
            before.environment.addEventListener('dispose', () => disposed.push('old-environment'))
            const map = new THREE.WebGLRenderTarget(4, 4)
            before.shadow.map = map; map.addEventListener('dispose', () => disposed.push('old-shadow'))
            const target = h.definitions[1]
            if (failure === 'csm-bias') target.renderProfile.lights[0].shadow.bias = -1
            if (failure === 'volume-center') target.renderProfile.postProcessing.vignette.center = 3
            if (failure === 'redrive-direction') target.renderProfile.reDriveVolume.characterLightingOverrideDirection = { length: 3 }
            if (failure === 'runtime-director') target.runtime.activationDirectors = [{ tracks: null }]
            if (failure === 'vlb-constructor') target.runtime.volumetricLightBeams.push(null)
            if (failure === 'character-uniform') {
                const uniform = h.materialData.shader.uniforms.uOfficialBrightness
                let value = uniform.value
                Object.defineProperty(uniform, 'value', { configurable: true, get: () => value,
                    set: next => {
                        if (c.toonStylizationOptions.characterTint === '#00ff00') throw Error('uniform-consumer-failed')
                        value = next
                    } })
            }
            const originalReset = h.scene.effects.volumePostProcessPass.resetFilmGrainRuntime
            if (failure === 'none-reset') h.scene.effects.volumePostProcessPass.resetFilmGrainRuntime = () => { throw Error('reset-runtime-failed') }
            await c.loadStageById(failure === 'none-reset' ? 'none' : 'candidate')
            h.scene.effects.volumePostProcessPass.resetFilmGrainRuntime = originalReset
            assert.ok(c.lastStageLoadFailure, 'must reach an actual failing consumer')
            console.log(JSON.stringify({ failure, ...c.lastStageLoadFailure }))
            const after = observed(h)
            for (const key of Object.keys(before)) {
                if (['object', 'definition', 'environment', 'background', 'runtime', 'cascades', 'shadow', 'volumetric'].includes(key))
                    assert.ok(after[key] === before[key], `preserve ${key} identity`)
                else assert.deepEqual(after[key], before[key], `preserve ${key}`)
            }
            assert.equal(before.object.parent, c.stageRoot)
            assert.equal(h.scene.directionalLight.shadow.map, map)
            assert.deepEqual(disposed, [])
            assert.equal(c.stageSelector.disabled, false)
            assert.equal(before.runtime.disposed, false)
            before.cascades.update()
            before.runtime.play(); before.runtime.update(0.1)
            assert.equal(before.runtime.time, 3.85, 'restored controller still advances')
            console.log(JSON.stringify({ failure, checkpoint: c.lastStageLoadFailure.checkpoint,
                message: c.lastStageLoadFailure.message, oldRuntimeTime: before.runtime.time,
                disposed, loopCount: h.loops.size }))
        } finally { await h.dispose() }
    })
}
test('successful global commit retires old resources after all consumers and none clears', async () => {
    const h = fixture(), c = h.context
    try {
        await c.loadStageById('old')
        assert.equal(c.currentStageId, 'old', JSON.stringify(c.lastStageLoadFailure))
        const old = observed(h), disposed = []
        old.environment.addEventListener('dispose', () => disposed.push('texture'))
        await c.loadStageById('candidate')
        assert.equal(c.lastStageLoadFailure, undefined)
        assert.equal(c.currentStageId, 'candidate')
        assert.equal(c.activeStageObject, h.objects[1])
        assert.equal(old.runtime.disposed, true)
        assert.deepEqual(disposed, ['texture'])
        assert.equal(h.loops.size, 1)
        assert.equal(h.depths.size, 1)
        await c.loadStageById('none')
        assert.equal(c.currentStageId, 'none'); assert.equal(h.loops.size, 0)
        assert.equal(h.depths.size, 0)
        assert.equal(c.activeStageMainLightCascades, undefined)
    } finally { await h.dispose() }
})
