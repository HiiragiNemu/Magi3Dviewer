import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(repositoryRoot, 'src', 'viewer', 'stageReflectionProbes.ts')
const runtimePath = join(
    repositoryRoot,
    `.stage-reflection-probes-under-test-${process.pid}-${Date.now()}.mjs`,
)
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')
const probes = await import(pathToFileURL(runtimePath).href)

after(() => {
    rmSync(runtimePath, { force: true })
})

function profile(overrides = {}) {
    return {
        id: 'probe-0',
        name: 'Fixture Probe',
        textureUrl: './ReflectionProbe-0-bc6h.dds',
        encoding: 'unity-bc6h-uf16',
        position: [0, 0, 0],
        boxMin: [-2, -2, -2],
        boxMax: [2, 2, 2],
        importance: 1,
        intensity: 3,
        blendDistance: 1,
        boxProjection: true,
        ...overrides,
    }
}

function cube(name) {
    const texture = new THREE.CubeTexture()
    texture.name = name
    texture.userData.stageEnvironment = { mipmapCount: 7 }
    return texture
}

test('matches Unity probe edge weights and dominant-probe blending', () => {
    assert.equal(
        probes.calculateUnityProbeWeight([0, 0, 0], [-2, -2, -2], [2, 2, 2], 1),
        1,
    )
    assert.equal(
        probes.calculateUnityProbeWeight([1.75, 0, 0], [-2, -2, -2], [2, 2, 2], 1),
        0.25,
    )
    assert.equal(
        probes.calculateUnityProbeWeight([3, 0, 0], [-2, -2, -2], [2, 2, 2], 1),
        0,
    )
    const dominant = probes.calculateUnityProbeBlendWeights([0, 0, 0], [
        profile({ id: 'dominant', importance: 2 }),
        profile({ id: 'subject', importance: 1 }),
    ])
    assert.deepEqual(dominant, { weights: [1, 0], totalWeight: 1 })
})

test('matches Unity box-projected cubemap direction fixture', () => {
    const direction = probes.boxProjectedCubemapDirection(
        new THREE.Vector3(1, 1, 1),
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.25, 0.5, 0.75),
        new THREE.Vector3(-1, -1, -1),
        new THREE.Vector3(1, 1, 1),
    )
    assert.deepEqual(direction.toArray(), [0.75, 0.5, 0.25])
})

test('installs raw BC6H global/local probe shader after existing material hooks', () => {
    const root = new THREE.Group()
    root.name = 'StageRoot'
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0,
        0.5, -0.5, 0,
        0, 0.5, 0,
    ], 3))
    const source = new THREE.MeshStandardMaterial()
    source.onBeforeCompile = shader => {
        shader.vertexShader += '\n// preserved-official-material-hook'
    }
    source.customProgramCacheKey = () => 'official-material'
    const mesh = new THREE.Mesh(geometry, source)
    mesh.name = 'Renderer'
    root.add(mesh)

    const global = cube('ReflectionProbe-1')
    const local = cube('ReflectionProbe-0')
    const application = probes.applyStageReflectionProbes(
        root,
        [{ profile: profile(), texture: local }],
        global,
        1.25,
    )
    assert.notEqual(mesh.material, source)
    assert.equal(application.rendererCount, 1)
    assert.equal(application.materialCount, 1)
    assert.equal(application.probeCount, 1)
    assert.deepEqual(
        application.getDebugState().selection,
        [{
            renderer: 'StageRoot/Renderer',
            probes: ['probe-0'],
            reflectionProbeUsage: 2,
            reflectionProbeUsageName: 'blend-probes-and-skybox',
            probeAnchorPosition: null,
            bindingSource: 'legacy-default',
        }],
    )
    assert.match(
        mesh.material.customProgramCacheKey(),
        /^official-material:unity-2022\.3-reflection-probes-v1$/,
    )

    const shader = {
        uniforms: { envMap: { value: null } },
        vertexShader: [
            '#include <common>',
            'void main() {',
            '#include <worldpos_vertex>',
            '}',
        ].join('\n'),
        fragmentShader: '#include <envmap_physical_pars_fragment>',
    }
    mesh.material.onBeforeCompile(shader, {})
    assert.match(shader.vertexShader, /preserved-official-material-hook/)
    assert.match(shader.vertexShader, /vStageProbeWorldPosition = worldPosition\.xyz/)
    assert.match(shader.fragmentShader, /BoxProjectedCubemapDirection/)
    assert.match(
        shader.fragmentShader,
        /perceptualRoughness \*= 1\.7 - 0\.7 \* perceptualRoughness/,
    )
    assert.match(shader.fragmentShader, /textureCubeLodEXT\(/)
    assert.match(shader.fragmentShader, /1\.0 - totalWeight/)
    assert.match(shader.fragmentShader, /return vec3\(0\.0\)/)
    assert.equal(shader.uniforms.uStageGlobalProbe.value, global)
    assert.equal(shader.uniforms.uStageGlobalIntensity.value, 1.25)
    assert.equal(shader.uniforms.uStageProbeCount.value, 1)
    assert.equal(shader.uniforms.uStageReflectionProbeUsage.value, 2)
    assert.equal(shader.uniforms.uStageProbe0.value, local)
    assert.deepEqual(shader.uniforms.uStageProbe0BoxMin.value.toArray(), [-2, -2, -2])
    assert.deepEqual(shader.uniforms.uStageProbe0BoxMax.value.toArray(), [2, 2, 2])
    assert.equal(shader.uniforms.uStageProbe0Intensity.value, 3)

    let disposed = 0
    mesh.material.addEventListener('dispose', () => disposed++)
    application.dispose()
    application.dispose()
    assert.equal(mesh.material, source)
    assert.equal(disposed, 1)
})

test('uses serialized Renderer usage and resolved probeAnchor instead of mesh bounds', () => {
    const root = new THREE.Group()
    root.name = 'ImportedWrapper'
    const group = new THREE.Group()
    group.name = 'Root'
    root.add(group)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        99, 99, 99,
        100, 99, 99,
        99, 100, 99,
    ], 3))
    const off = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
    off.name = 'OffRenderer'
    group.add(off)
    const simple = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
    simple.name = 'SimpleRenderer'
    group.add(simple)

    const global = cube('Global')
    const localLow = cube('LocalLow')
    const localHigh = cube('LocalHigh')
    const application = probes.applyStageReflectionProbes(
        root,
        [
            { profile: profile({ id: 'low', importance: 1 }), texture: localLow },
            { profile: profile({ id: 'high', importance: 2 }), texture: localHigh },
        ],
        global,
        1,
        [
            {
                rendererHierarchyPath: 'UnityScene/Root/OffRenderer',
                reflectionProbeUsage: 0,
                reflectionProbeUsageName: 'off',
                probeAnchorPosition: [0, 0, 0],
            },
            {
                rendererHierarchyPath: 'UnityScene/Root/SimpleRenderer',
                reflectionProbeUsage: 3,
                reflectionProbeUsageName: 'simple',
                probeAnchorPosition: [0, 0, 0],
            },
        ],
    )
    const debug = application.getDebugState()
    assert.equal(debug.bindingCount, 2)
    assert.deepEqual(debug.unmatchedBindingPaths, [])
    assert.deepEqual(debug.ambiguousBindingPaths, [])
    assert.deepEqual(debug.selection.map(item => ({
        renderer: item.renderer,
        probes: item.probes,
        usage: item.reflectionProbeUsage,
        anchor: item.probeAnchorPosition,
        source: item.bindingSource,
    })), [
        {
            renderer: 'ImportedWrapper/Root/OffRenderer',
            probes: [],
            usage: 0,
            anchor: [0, 0, 0],
            source: 'serialized-renderer',
        },
        {
            renderer: 'ImportedWrapper/Root/SimpleRenderer',
            probes: ['high'],
            usage: 3,
            anchor: [0, 0, 0],
            source: 'serialized-renderer',
        },
    ])
    const shader = {
        uniforms: { envMap: { value: null } },
        vertexShader: '#include <common>\n#include <worldpos_vertex>',
        fragmentShader: '#include <envmap_physical_pars_fragment>',
    }
    simple.material.onBeforeCompile(shader, {})
    assert.equal(shader.uniforms.uStageReflectionProbeUsage.value, 3)
    assert.match(shader.fragmentShader, /uStageReflectionProbeUsage > 2\.5/)
    application.dispose()
})

test('Stage 608 keeps the local probe separate from the global ReDrive cube', () => {
    const directory = join(
        repositoryRoot,
        'public',
        'stages',
        'official',
        'battle-608-00-00-001',
    )
    const document = JSON.parse(readFileSync(join(directory, 'scene-profile.json'), 'utf8'))
    const render = document.renderProfile
    assert.match(render.environmentTextureUrl, /ReflectionProbe-1-bc6h\.dds$/)
    assert.equal(render.reflectionProbes.length, 1)
    assert.deepEqual(render.reflectionProbes[0], {
        id: '3318311746613360191',
        name: 'Reflection Probe',
        textureUrl: './stages/official/battle-608-00-00-001/ReflectionProbe-0-bc6h.dds',
        encoding: 'unity-bc6h-uf16',
        position: [0, 0.5, 0],
        boxMin: [-35, -34.5, -35],
        boxMax: [35, 35.5, 35],
        importance: 1,
        intensity: 3,
        blendDistance: 1,
        boxProjection: true,
    })
})
