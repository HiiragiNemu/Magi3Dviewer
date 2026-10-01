import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(
    repositoryRoot,
    'src',
    'viewer',
    'stageMainLightCascades.ts',
)
const source = readFileSync(sourcePath, 'utf8')
const stagesSource = readFileSync(
    join(repositoryRoot, 'src', 'viewer', 'stages.ts'),
    'utf8',
)
const materialSource = readFileSync(
    join(repositoryRoot, 'src', 'viewer', 'stageMaterialBindings.ts'),
    'utf8',
)
const sceneSource = readFileSync(
    join(
        repositoryRoot,
        'magia-exedra-character-three',
        'scene',
        'index.ts',
    ),
    'utf8',
)
const rendererSource = readFileSync(
    join(
        repositoryRoot,
        'magia-exedra-character-three',
        'renderer.ts',
    ),
    'utf8',
)
const webglProgramSource = readFileSync(
    join(
        repositoryRoot,
        'node_modules',
        'three',
        'src',
        'renderers',
        'webgl',
        'WebGLProgram.js',
    ),
    'utf8',
)
const shadowChunkSource = readFileSync(
    join(
        repositoryRoot,
        'node_modules',
        'three',
        'src',
        'renderers',
        'shaders',
        'ShaderChunk',
        'shadowmap_pars_fragment.glsl.js',
    ),
    'utf8',
)
const runtimePath = join(
    repositoryRoot,
    `.stage-main-light-cascades-${process.pid}-${Date.now()}.mjs`,
)
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')
const {
    OFFICIAL_URP_MAIN_SHADOW_PROFILE,
    STAGE_SHADOW_QUALITY_PROFILES,
    StageMainLightCascadeController,
    resolveOfficialUrpDirectionalShadowPlan,
    resolveOfficialUrpDirectionalCascadeBias,
    resolveOfficialMainShadowDistance,
    resolveStageShadowQualityProfile,
} = await import(pathToFileURL(runtimePath).href)

after(() => rmSync(runtimePath, { force: true }))

test('uses the active URP four-cascade profile and observed battle distance', () => {
    assert.deepEqual(OFFICIAL_URP_MAIN_SHADOW_PROFILE.cascadeSplits, [
        0.05,
        0.25,
        0.5,
        1,
    ])
    assert.equal(OFFICIAL_URP_MAIN_SHADOW_PROFILE.cascadeCount, 4)
    assert.equal(OFFICIAL_URP_MAIN_SHADOW_PROFILE.atlasSize, 2048)
    assert.equal(OFFICIAL_URP_MAIN_SHADOW_PROFILE.cascadeMapSize, 1024)
    assert.equal(OFFICIAL_URP_MAIN_SHADOW_PROFILE.cascadeBorder, 0.1)
    assert.equal(resolveOfficialMainShadowDistance('battle'), 60)
    assert.equal(resolveOfficialMainShadowDistance('gallery'), 20)
    assert.equal(resolveOfficialMainShadowDistance('adv'), 20)
})

test('routes one explicit MainLight to CSM and keeps additional directionals unshadowed', () => {
    const common = {
        directional: true,
        active: true,
        affectsStageLayer: true,
        skippedAsBaked: false,
        requestsShadow: true,
    }
    const introPlan = resolveOfficialUrpDirectionalShadowPlan([
        { ...common, role: 'background' },
        {
            ...common,
            directional: false,
            role: 'background',
            requestsShadow: false,
        },
        { ...common, role: 'character-key' },
        { ...common, role: 'background' },
        {
            ...common,
            directional: false,
            role: 'background',
            active: false,
            requestsShadow: false,
        },
    ])
    assert.equal(introPlan.mainProfileIndex, 2)
    assert.deepEqual(introPlan.records, [
        {
            runtimeCastShadow: false,
            consumer: 'additional-directional-unshadowed',
        },
        { runtimeCastShadow: false, consumer: 'none' },
        { runtimeCastShadow: true, consumer: 'main-cascade' },
        {
            runtimeCastShadow: false,
            consumer: 'additional-directional-unshadowed',
        },
        { runtimeCastShadow: false, consumer: 'none' },
    ])

    const legacyPlan = resolveOfficialUrpDirectionalShadowPlan([
        { ...common, role: 'background' },
    ])
    assert.equal(legacyPlan.mainProfileIndex, -1)
    assert.deepEqual(legacyPlan.records, [{
        runtimeCastShadow: true,
        consumer: 'legacy-directional-shadow',
    }])
})

test('renderer selects the supported filtered PCF program instead of deprecated BASIC fallback', () => {
    assert.match(
        rendererSource,
        /renderer\.shadowMap\.type = THREE\.PCFShadowMap/,
    )
    assert.doesNotMatch(
        rendererSource,
        /renderer\.shadowMap\.type = THREE\.PCFSoftShadowMap/,
    )
    assert.match(
        webglProgramSource,
        /\[ PCFShadowMap \]: 'SHADOWMAP_TYPE_PCF'/,
    )
    assert.doesNotMatch(
        webglProgramSource,
        /\[ PCFSoftShadowMap \]: 'SHADOWMAP_TYPE_PCF'/,
    )
    assert.match(
        shadowChunkSource,
        /float getShadow\( sampler2DShadow shadowMap/,
    )
    assert.match(shadowChunkSource, /vogelDiskSample\( 4, 5, phi \)/)
    assert.match(
        shadowChunkSource,
        /#else \/\/ SHADOWMAP_TYPE_BASIC[\s\S]*float getShadow\( sampler2D shadowMap/,
    )
})

test('keeps official as the immutable default and exposes two explicit Viewer budgets', () => {
    assert.equal(STAGE_SHADOW_QUALITY_PROFILES.official.cascadeCount, 4)
    assert.equal(STAGE_SHADOW_QUALITY_PROFILES.official.cascadeMapSize, 1024)
    assert.deepEqual(STAGE_SHADOW_QUALITY_PROFILES.balanced.cascadeSplits, [
        0.1,
        0.4,
        1,
    ])
    assert.equal(STAGE_SHADOW_QUALITY_PROFILES.balanced.cascadeCount, 3)
    assert.equal(STAGE_SHADOW_QUALITY_PROFILES.balanced.cascadeMapSize, 768)
    assert.deepEqual(STAGE_SHADOW_QUALITY_PROFILES.performance.cascadeSplits, [
        0.25,
        1,
    ])
    assert.equal(STAGE_SHADOW_QUALITY_PROFILES.performance.cascadeCount, 2)
    assert.equal(STAGE_SHADOW_QUALITY_PROFILES.performance.cascadeMapSize, 512)
    assert.equal(resolveStageShadowQualityProfile('official').atlasSize, 2048)
    assert.throws(
        () => resolveStageShadowQualityProfile('unknown'),
        /Unknown stage shadow quality/,
    )
})

test('converts serialized Unity bias per cascade and rejects non-finite inputs', () => {
    const bias = resolveOfficialUrpDirectionalCascadeBias({
        frustumSize: 20,
        shadowResolution: 1024,
        shadowNear: 0.1,
        shadowFar: 120,
        unityShadowBias: 0.05,
        unityShadowNormalBias: 0.4,
    })
    assert.equal(bias.worldTexelSize, 20 / 1024)
    assert.equal(bias.casterDepthBiasWorld, -0.05 * (20 / 1024) * 1.5)
    assert.equal(bias.casterNormalBiasWorld, -0.4 * (20 / 1024) * 1.5)
    assert.equal(
        bias.receiverDepthBias,
        bias.casterDepthBiasWorld / (120 - 0.1),
    )
    assert.equal(bias.receiverNormalBias, -bias.casterNormalBiasWorld)
    assert.throws(
        () => resolveOfficialUrpDirectionalCascadeBias({
            frustumSize: 20,
            shadowResolution: 1024,
            shadowNear: 0.1,
            shadowFar: 120,
            unityShadowBias: Number.NaN,
            unityShadowNormalBias: 0.4,
        }),
        /unityShadowBias must be a finite number/,
    )
    assert.throws(
        () => resolveOfficialUrpDirectionalCascadeBias({
            frustumSize: 20,
            shadowResolution: 0,
            shadowNear: 0.1,
            shadowFar: 120,
            unityShadowBias: 0.05,
            unityShadowNormalBias: 0.4,
        }),
        /shadowResolution must be positive/,
    )
})

test('injects the exact URP LOW four half-texel comparison taps', () => {
    const match = source.match(
        /const officialUrpLowShadowFunction = `([\s\S]*?)`\r?\n\r?\nconst officialUrpShadowSample/,
    )
    assert.ok(match)
    const lowFunction = match[1]
    assert.equal((lowFunction.match(/texture\(shadowMap/g) ?? []).length, 4)
    assert.match(lowFunction, /vec2 halfTexel = vec2\(0\.5\) \/ shadowMapSize/)
    assert.match(lowFunction, /vec2\(-halfTexel\.x, -halfTexel\.y\)/)
    assert.match(lowFunction, /vec2\(halfTexel\.x, -halfTexel\.y\)/)
    assert.match(lowFunction, /vec2\(-halfTexel\.x, halfTexel\.y\)/)
    assert.match(lowFunction, /vec2\(halfTexel\.x, halfTexel\.y\)/)
    assert.doesNotMatch(lowFunction, /vogelDiskSample|shadowRadius\s*\*/)
})

test('installs four bounded shadow lights without replacing existing material hooks', t => {
    const originalFragmentChunk = THREE.ShaderChunk.lights_fragment_begin
    const originalParsChunk = THREE.ShaderChunk.lights_pars_begin
    const background = new THREE.Scene()
    const stage = new THREE.Group()
    background.add(stage)

    const material = new THREE.MeshStandardMaterial()
    const originalDefines = material.defines
    const originalDefineValues = { ...material.defines }
    const originalCompile = function (shader) {
        shader.uniforms.originalStageHook = { value: 7 }
    }
    material.onBeforeCompile = originalCompile
    const originalCacheKey = material.customProgramCacheKey
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material)
    stage.add(mesh)

    const sourceLight = new THREE.DirectionalLight('#d8c9a0', 2.5)
    sourceLight.name = 'MainLight:Background'
    sourceLight.position.set(2, 5, 3)
    sourceLight.target.position.set(0, 0, 0)
    sourceLight.castShadow = true
    sourceLight.shadow.intensity = 0.75
    sourceLight.shadow.bias = -0.0005
    sourceLight.shadow.normalBias = 0.25
    sourceLight.shadow.camera.near = 0.1
    stage.add(sourceLight, sourceLight.target)

    const controller = new StageMainLightCascadeController({
        camera: new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 1000),
        parent: background,
        stageObject: stage,
        sourceLight,
        stageLayer: 6,
        maxShadowDistance: 60,
        shadowCasterGateKey: 'magiusStageCharacterShadowCastersEnabled',
        characterCastersEnabled: true,
        unityShadowBias: 0.05,
        unityShadowNormalBias: 0.4,
    })
    t.after(() => controller.dispose())

    const debug = controller.getDebugState()
    assert.equal(debug.cascadeCount, 4)
    assert.equal(debug.shadowDistance, 60)
    assert.equal(debug.atlasSize, 2048)
    assert.equal(debug.cascadeMapSize, 1024)
    assert.equal(debug.materialCount, 1)
    assert.deepEqual(debug.shadowSampling, {
        quality: 'low',
        tapCount: 4,
        offsets: 'half-texel-corners',
    })
    assert.equal(debug.softKernelRadius, 1.5)
    assert.equal(debug.biasMode, 'per-cascade-receiver-equivalent')
    assert.equal(debug.unityShadowBias, 0.05)
    assert.equal(debug.unityShadowNormalBias, 0.4)
    assert.equal(debug.normalBiasAngleScale, '1-saturate(NdotL)')
    assert.equal(debug.shadowSamplerUpload, 'renderer-preallocated-once')
    assert.equal(debug.cascadeBiases.length, 4)
    debug.cascadeBiases.forEach(value => {
        assert.ok(Number.isFinite(value.worldTexelSize))
        assert.ok(Number.isFinite(value.receiverDepthBias))
        assert.ok(Number.isFinite(value.receiverNormalBias))
    })
    assert.ok(
        debug.cascadeBiases.at(-1).worldTexelSize
            > debug.cascadeBiases[0].worldTexelSize,
    )
    assert.equal(controller.lights.length, 4)
    for (const [index, light] of controller.lights.entries()) {
        assert.equal(light.castShadow, true)
        assert.deepEqual(light.shadow.mapSize.toArray(), [1024, 1024])
        assert.equal(light.shadow.intensity, 0.75)
        assert.equal(
            light.shadow.bias,
            debug.cascadeBiases[index].receiverDepthBias,
        )
        assert.equal(
            light.shadow.normalBias,
            debug.cascadeBiases[index].receiverNormalBias,
        )
        assert.equal(light.shadow.camera.near, 0.1)
        assert.equal(
            light.shadow.camera.userData.magiusStageCharacterShadowCastersEnabled,
            true,
        )
        assert.equal(light.layers.isEnabled(6), true)
    }
    assert.equal(sourceLight.visible, false)
    assert.equal(sourceLight.castShadow, false)
    assert.equal(material.defines.USE_CSM, 1)
    assert.equal(material.defines.CSM_CASCADES, 4)

    const shader = {
        uniforms: {
            directionalShadowMap: { value: ['cascade'], needsUpdate: true },
            spotShadowMap: { value: ['spot'], needsUpdate: true },
            pointShadowMap: { value: ['point'], needsUpdate: true },
        },
        fragmentShader: '',
        vertexShader: 'void main() {\n#include <shadowmap_vertex>\n}',
    }
    material.onBeforeCompile(shader, undefined)
    assert.equal(shader.uniforms.originalStageHook.value, 7)
    assert.equal(shader.uniforms.CSM_cascadeBorder.value, 0.1)
    assert.equal(shader.uniforms.CSM_cascades.value.length, 4)
    assert.equal(shader.uniforms.shadowFar.value, 60)
    assert.equal(shader.uniforms.directionalShadowMap.needsUpdate, false)
    assert.equal(shader.uniforms.spotShadowMap.needsUpdate, false)
    assert.equal(shader.uniforms.pointShadowMap.needsUpdate, false)
    assert.equal(
        shader.uniforms.CSM_mainLightToSourceDirection.value,
        controller.mainLightToSourceDirection,
    )
    assert.match(
        shader.vertexShader,
        /1\.0 - clamp\(dot\(CSM_mainLightToSourceDirection, shadowWorldNormal\), 0\.0, 1\.0\)/,
    )
    assert.match(THREE.ShaderChunk.lights_fragment_begin, /CSM_cascadeBorder/)
    assert.match(THREE.ShaderChunk.lights_fragment_begin, /stageMainShadowFade/)
    assert.match(
        THREE.ShaderChunk.lights_fragment_begin,
        /#if \( UNROLLED_LOOP_INDEX < CSM_CASCADES \)[\s\S]*#elif \( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS \)/,
    )

    controller.update()
    const expectedDirection = sourceLight.target
        .getWorldPosition(new THREE.Vector3())
        .sub(sourceLight.getWorldPosition(new THREE.Vector3()))
        .normalize()
    assert.ok(controller.lightDirection.distanceTo(expectedDirection) < 1e-12)
    assert.ok(
        controller.mainLightToSourceDirection.distanceTo(
            expectedDirection.clone().negate(),
        ) < 1e-12,
    )

    controller.dispose()
    controller.dispose()
    assert.equal(controller.lights.length, 0)
    assert.equal(sourceLight.visible, true)
    assert.equal(sourceLight.castShadow, true)
    assert.equal(material.onBeforeCompile, originalCompile)
    assert.equal(material.customProgramCacheKey, originalCacheKey)
    assert.equal(material.defines, originalDefines)
    assert.deepEqual(material.defines, originalDefineValues)
    assert.equal(THREE.ShaderChunk.lights_fragment_begin, originalFragmentChunk)
    assert.equal(THREE.ShaderChunk.lights_pars_begin, originalParsChunk)
})

test('restores global shader chunks and CSM lights after partial setup failure', () => {
    const originalFragmentChunk = THREE.ShaderChunk.lights_fragment_begin
    const originalParsChunk = THREE.ShaderChunk.lights_pars_begin
    const background = new THREE.Scene()
    const stage = new THREE.Group()
    background.add(stage)
    stage.traverse = () => {
        throw new Error('bounded material discovery failure')
    }

    const sourceLight = new THREE.DirectionalLight('#ffffff', 1)
    sourceLight.position.set(1, 3, 2)
    sourceLight.target.position.set(0, 0, 0)
    sourceLight.castShadow = true

    assert.throws(
        () => new StageMainLightCascadeController({
            camera: new THREE.PerspectiveCamera(35, 1, 0.1, 100),
            parent: background,
            stageObject: stage,
            sourceLight,
            stageLayer: 4,
            maxShadowDistance: 20,
            shadowCasterGateKey: 'shadowGate',
            characterCastersEnabled: true,
            unityShadowBias: 0.05,
            unityShadowNormalBias: 0.4,
        }),
        /bounded material discovery failure/,
    )
    assert.equal(
        background.children.filter(child => child.isDirectionalLight).length,
        0,
    )
    assert.equal(THREE.ShaderChunk.lights_fragment_begin, originalFragmentChunk)
    assert.equal(THREE.ShaderChunk.lights_pars_begin, originalParsChunk)
})

test('builds and fully disposes the explicit performance CSM budget', t => {
    const background = new THREE.Scene()
    const stage = new THREE.Group()
    background.add(stage)
    stage.add(new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial(),
    ))
    const sourceLight = new THREE.DirectionalLight('#ffffff', 1)
    sourceLight.position.set(1, 3, 2)
    sourceLight.target.position.set(0, 0, 0)
    sourceLight.castShadow = true
    stage.add(sourceLight, sourceLight.target)

    const controller = new StageMainLightCascadeController({
        camera: new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 1000),
        parent: background,
        stageObject: stage,
        sourceLight,
        stageLayer: 6,
        maxShadowDistance: 60,
        shadowCasterGateKey: 'shadowGate',
        characterCastersEnabled: true,
        unityShadowBias: 0.05,
        unityShadowNormalBias: 0.4,
        quality: 'performance',
    })
    t.after(() => controller.dispose())
    const debug = controller.getDebugState()
    assert.equal(debug.quality, 'performance')
    assert.equal(debug.officialDefaultsActive, false)
    assert.equal(debug.cascadeCount, 2)
    assert.equal(debug.cascadeMapSize, 512)
    assert.deepEqual(debug.cascadeSplits, [0.25, 1])
    assert.equal(controller.lights.length, 2)
    controller.lights.forEach(light => {
        assert.deepEqual(light.shadow.mapSize.toArray(), [512, 512])
    })

    controller.dispose()
    assert.equal(controller.lights.length, 0)
    assert.equal(sourceLight.visible, true)
    assert.equal(sourceLight.castShadow, true)
})

test('stage render chain updates and disposes CSM without per-frame scene traversal', () => {
    assert.match(sceneSource, /addBeforeRenderCallback/)
    assert.match(sceneSource, /this\.stageCharacterShadows\.update\(\)[\s\S]*beforeRenderCallbacks/)
    assert.match(stagesSource, /activeStageMainLightCascades\?\.update\(\)/)
    assert.match(stagesSource, /activeStageMainLightCascades\?\.dispose\(\)/)
    assert.match(stagesSource, /resolveOfficialMainShadowDistance\(stageCategory\)/)
    assert.match(source, /cascadeMapSize/)
    assert.doesNotMatch(source, /update\(\)[\s\S]{0,1200}\.traverse\(/)
})

test('stage API recreates CSM only on an explicit session quality change', () => {
    assert.match(stagesSource, /let stageShadowQuality: StageShadowQuality = 'official'/)
    assert.match(stagesSource, /export function getStageShadowQuality\(\)/)
    assert.match(stagesSource, /export function getStageShadowQualityState\(\)/)
    assert.match(stagesSource, /export function setStageShadowQuality\(quality: StageShadowQuality\): void/)
    assert.match(stagesSource, /magius:stage-shadow-quality-change/)
    assert.match(
        stagesSource,
        /activeStageMainLightCascades\?\.dispose\(\)[\s\S]*createStageMainLightCascades\(options\)/,
    )
    assert.match(stagesSource, /mainLightCascades:[\s\S]*shadowQuality:/)
    assert.doesNotMatch(stagesSource, /localStorage\.(?:setItem|removeItem)\([^\n]*stageShadowQuality/)
})

test('BgUber additive shadow samples the selected CSM cascade and distance fade', () => {
    assert.match(materialSource, /defined\( USE_CSM \) && defined\( CSM_CASCADES \)/)
    assert.match(materialSource, /CSM_cascades\[ UNROLLED_LOOP_INDEX \]/)
    assert.match(materialSource, /directionalShadowMap\[ i \]/)
    assert.match(materialSource, /CSM_cascadeBorder/)
    assert.match(materialSource, /stageBgMainShadowFade/)
})
