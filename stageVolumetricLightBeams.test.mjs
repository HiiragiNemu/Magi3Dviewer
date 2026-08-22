import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const nonce = `${process.pid}-${Date.now()}`
const hierarchyPath = join(root, `.vlb-hierarchy-${nonce}.mjs`)
const lightingPath = join(root, `.vlb-lighting-${nonce}.mjs`)
const runtimePath = join(root, `.vlb-runtime-${nonce}.mjs`)

function transpile(source, fileName) {
    return ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ES2022,
            target: ts.ScriptTarget.ES2022,
        },
        fileName,
    }).outputText
}

const hierarchySourcePath = join(root, 'src', 'viewer', 'stageHierarchy.ts')
writeFileSync(
    hierarchyPath,
    transpile(readFileSync(hierarchySourcePath, 'utf8'), hierarchySourcePath),
    'utf8',
)
const lightingSourcePath = join(root, 'src', 'viewer', 'unityLighting.ts')
const lightingSource = readFileSync(lightingSourcePath, 'utf8').replace(
    /export \{ unityWorldToViewerVector \}[^\n]+/,
    'export const unityWorldToViewerVector = value => [-value[0], value[1], value[2]]',
)
writeFileSync(
    lightingPath,
    transpile(lightingSource, lightingSourcePath),
    'utf8',
)
const runtimeSourcePath = join(root, 'src', 'viewer', 'stageVolumetricLightBeams.ts')
const runtimeSource = readFileSync(runtimeSourcePath, 'utf8')
    .replace("'./stageHierarchy'", `'./${basename(hierarchyPath)}'`)
    .replace("'./unityLighting'", `'./${basename(lightingPath)}'`)
writeFileSync(
    runtimePath,
    transpile(runtimeSource, runtimeSourcePath),
    'utf8',
)

const vlb = await import(pathToFileURL(runtimePath).href)
const profile608 = JSON.parse(readFileSync(
    join(root, 'public', 'stages', 'official', 'battle-608-00-00-001', 'scene-profile.json'),
    'utf8',
))

after(() => {
    rmSync(hierarchyPath, { force: true })
    rmSync(lightingPath, { force: true })
    rmSync(runtimePath, { force: true })
})

test('VLB 1.970 shared cone topology matches native count formulas', () => {
    const geometry = vlb.createVlbSharedConeGeometry(24, 5, true)
    assert.equal(geometry.getAttribute('position').count, 386)
    assert.equal(geometry.getAttribute('uv').count, 386)
    assert.equal(geometry.index.count, 1872)
    assert.deepEqual(geometry.userData.vlb1970, {
        sides: 24,
        segments: 5,
        ringCount: 7,
        doubleSided: true,
        frontVertexCount: 193,
        frontIndexCount: 936,
    })
    const position = geometry.getAttribute('position')
    assert.ok(Math.abs(position.getZ(24) - 1 / 6) < 1e-7)
    geometry.dispose()
})

test('Stage 608 beam derives exact linked spotlight dimensions', () => {
    const profile = profile608.runtime.volumetricLightBeams[0]
    const dimensions = vlb.resolveVlbBeamDimensions(profile)
    assert.equal(dimensions.length, 30)
    assert.equal(dimensions.angleDegrees, 90)
    assert.equal(dimensions.radiusStart, 0)
    assert.ok(Math.abs(dimensions.radiusEnd - 30) < 1e-12)
})

test('generated VLB profile binds exact anchor, queue and depth consumer', () => {
    const stage = new THREE.Group()
    stage.name = 'Stage:608'
    const sourceRoot = new THREE.Group()
    sourceRoot.name = 'bg_3d_608_00_00_001'
    const lightGroup = new THREE.Group()
    lightGroup.name = 'Light'
    const anchor = new THREE.Group()
    anchor.name = 'VolumeLight'
    stage.add(sourceRoot)
    sourceRoot.add(lightGroup)
    lightGroup.add(anchor)

    const consumers = new Set()
    const registrar = {
        registerBackgroundDepthConsumer(consumer) {
            consumers.add(consumer)
            consumer.depthTextureUniform.value = new THREE.DepthTexture(1, 1)
            consumer.resolutionUniform.value.set(1920, 1080)
            return () => consumers.delete(consumer)
        },
    }
    const controller = vlb.createStageVolumetricLightBeamController(
        stage,
        profile608.runtime.volumetricLightBeamConfig,
        profile608.runtime.volumetricLightBeams,
        profile608.runtime.volumetricDustParticles,
        registrar,
    )
    assert.ok(controller)
    assert.equal(anchor.children.length, 1)
    assert.equal(anchor.children[0].renderOrder, 3000)
    assert.equal(consumers.size, 1)
    assert.deepEqual(controller.getDebugState(), {
        requestedBeamCount: 1,
        activeBeamCount: 1,
        missingAnchorPaths: [],
        rejectedComponentPathIDs: [],
        depthBlendConsumerCount: 1,
        deferredDustParticleCount: 1,
        configAuthority:
            'D:\\SteamLibrary\\steamapps\\common\\MadokaExedra\\MadokaExedra_Data\\resources.assets',
        pluginVersion: 1970,
        sharedMeshSides: 24,
        sharedMeshSegments: 5,
        geometryRenderQueue: 3000,
    })
    controller.dispose()
    assert.equal(anchor.children.length, 0)
    assert.equal(consumers.size, 0)
})

test('composer depth prepass remains before the normal background draw', () => {
    const effects = readFileSync(
        join(root, 'magia-exedra-character-three', 'scene', 'effects.ts'),
        'utf8',
    )
    assert.match(
        effects,
        /addPass\(this\.backgroundDepthPass\)[\s\S]*addPass\(this\.backgroundRenderPass\)/,
    )
})
