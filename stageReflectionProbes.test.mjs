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

test('initializes reflection radiance across simple and blended probe branches', () => {
    const shader = probes.UNITY_REFLECTION_PROBE_SHADER
    const start = shader.indexOf('vec3 getIBLRadiance(')
    const end = shader.indexOf('\n#ifdef USE_ANISOTROPY', start)
    assert.ok(start >= 0 && end > start)
    const body = shader.slice(start, end)

    assert.equal((body.match(/\breturn\b/g) ?? []).length, 1)
    assert.match(body, /vec3 irradiance = vec3\(0\.0\);/)
    assert.match(body, /irradiance = stageSampleProbe0\(simpleDirection, mip\);\s*} else {/)
    assert.doesNotMatch(body, /return stageSampleProbe0/)
    assert.match(body, /weightProbe0 \/= max\(totalWeight, 1\.0\)/)
    assert.match(body, /weightProbe1 \/= max\(totalWeight, 1\.0\)/)
    assert.match(body, /irradiance \+= weightProbe0 \* stageSampleProbe0\(direction0, mip\)/)
    assert.match(body, /irradiance \+= weightProbe1 \* stageSampleProbe1\(direction1, mip\)/)
    assert.match(body, /\(1\.0 - totalWeight\) \* textureCubeLodEXT\(/)
    assert.match(body, /min\(mip, uStageGlobalMaxMip\)/)
    assert.match(body, /\.rgb \* uStageGlobalIntensity/)
})

test('accepts an official linear-image product after its equirectangular carrier is converted to a cubemap', () => {
    const root = new THREE.Group()
    root.name = 'StageRoot'
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0,
        0.5, -0.5, 0,
        0, 0.5, 0,
    ], 3))
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
    mesh.name = 'Renderer'
    root.add(mesh)
    const global = cube('GlobalLinearProduct')
    const local = cube('LocalLinearProduct')
    const application = probes.applyStageReflectionProbes(
        root,
        [{
            profile: profile({
                encoding: 'linear-image',
                textureUrl: './ReflectionProbe-0-equirectangular.png',
            }),
            texture: local,
        }],
        global,
        1,
    )
    assert.equal(application.probeCount, 1)
    assert.deepEqual(application.getDebugState().selection[0].probes, ['probe-0'])
    application.dispose()
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

function projectBoxFixture(direction, position = [0, 0, 0], probe = [0.25, 0.5, 0.75]) {
    return probes.boxProjectedCubemapDirection(
        new THREE.Vector3(...direction), new THREE.Vector3(...position),
        new THREE.Vector3(...probe), new THREE.Vector3(-1, -1, -1),
        new THREE.Vector3(1, 1, 1),
    ).toArray()
}

test('box projection keeps all six axial directions finite at interiors, faces and edges', () => {
    for (let axis = 0; axis < 3; axis++) {
        for (const sign of [-1, 1]) {
            for (const zero of [0, -0]) {
                const direction = [zero, zero, zero]
                direction[axis] = sign
                for (const edge of [-1, 0, 1]) {
                    const position = [edge, edge, edge]
                    position[axis] = 0
                    const hit = [...position]
                    hit[axis] = sign
                    const actual = projectBoxFixture(direction, position)
                    assert.ok(actual.every(Number.isFinite))
                    assert.deepEqual(actual, hit.map((v, i) => v - [0.25, 0.5, 0.75][i]))
                }
            }
        }
    }
})

test('box projection ignores only parallel axes and preserves negative exit distances', () => {
    assert.deepEqual(projectBoxFixture([1, 1, 0]), [0.75, 0.5, -0.75])
    assert.deepEqual(projectBoxFixture([1, 0, 1]), [0.75, -0.5, 0.25])
    assert.deepEqual(projectBoxFixture([0, 1, 1]), [-0.25, 0.5, 0.25])
    assert.deepEqual(projectBoxFixture([1, 0, 0], [2, 0, 0]), [0.75, -0.5, -0.75])
    assert.deepEqual(projectBoxFixture([-1, 0, 0], [2, 0, 0]), [-1.25, -0.5, -0.75])
    assert.deepEqual(projectBoxFixture([1, 0, 0], [1, 0, 0]), [0.75, -0.5, -0.75])
})

test('zero-length direction remains unprojected and input vectors are unchanged', () => {
    const args = [[0, -0, 0], [0.2, 0.3, 0.4], [0.5, 0.6, 0.7], [-1, -1, -1], [1, 1, 1]]
        .map(v => new THREE.Vector3(...v))
    const originals = args.map(v => v.toArray())
    const result = probes.boxProjectedCubemapDirection(...args)
    assert.notEqual(result, args[0])
    assert.deepEqual(result.toArray(), originals[0])
    assert.deepEqual(args.map(v => v.toArray()), originals)
})

test('nonzero directions retain the literal Unity slab result with no epsilon or distance clamp', () => {
    let cases = 0
    for (const x of [-1, -1e-30, 1e-30, 1]) {
        for (const y of [-1, -0.25, 0.25, 1]) {
            for (const z of [-1, -0.5, 0.5, 1]) {
                for (const position of [[0, 0, 0], [1, -1, 1], [2, -2, 0.5]]) {
                    const direction = [x, y, z]
                    const d = Math.min(...direction.map((v, i) => ((v > 0 ? 1 : -1) - position[i]) / v))
                    const expected = position.map((v, i) => (v - [0.25, 0.5, 0.75][i]) + direction[i] * d)
                    const actual = projectBoxFixture(direction, position)
                    assert.ok(actual.every(Number.isFinite))
                    assert.deepEqual(actual, expected)
                    cases++
                }
            }
        }
    }
    assert.equal(cases, 192)
})

test('GLSL box projection masks exact-zero divisors before division and omits inactive slabs', () => {
    const shader = probes.UNITY_REFLECTION_PROBE_SHADER
    const start = shader.indexOf('vec3 stageBoxProjectedCubemapDirection(')
    const end = shader.indexOf('\nfloat stagePerceptualRoughnessToMipmapLevel', start)
    const body = shader.slice(start, end)
    assert.ok(body.includes('bvec3 activeAxes = notEqual(reflectionWS, vec3(0.0))'))
    assert.ok(body.includes('if (enabled > 0.5 && any(activeAxes))'))
    for (const axis of ['x', 'y', 'z']) {
        assert.ok(body.includes('activeAxes.' + axis + ' ? reflectionWS.' + axis + ' : 1.0'))
    }
    assert.ok(body.includes('(boxMinMax - positionWS) / divisor'))
    assert.ok(!body.includes('/ reflectionWS'))
    assert.ok(body.includes('float fa = activeAxes.x ? rbMinMax.x : (activeAxes.y ? rbMinMax.y : rbMinMax.z)'))
    assert.ok(body.includes('if (activeAxes.y) fa = min(fa, rbMinMax.y)'))
    assert.ok(body.includes('if (activeAxes.z) fa = min(fa, rbMinMax.z)'))
    assert.ok(body.includes('return reflectionWS'))
    assert.ok(!/epsilon|1e-|0\.000|clamp\(/i.test(body))
})

test('reflection bindings distinguish original spaces from literal underscores', () => {
    const root = new THREE.Group(); root.name = 'Stage:fixture'; root.userData.originalName = 'UnityScene';
    const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const b = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    a.name=b.name='mesh_part'; a.userData.originalName='mesh part'; b.userData.originalName='mesh_part'; root.add(a,b);
    const bindings=['mesh part','mesh_part'].map(name=>({rendererHierarchyPath:'UnityScene/'+name,reflectionProbeUsage:1}));
    const r=probes.matchStageReflectionProbeBindings(root,bindings);
    assert.equal(r.matches.length,2); assert.equal(r.matches[0].mesh,a); assert.equal(r.matches[1].mesh,b);
    const c=a.clone(); root.add(c);
    assert.equal(probes.matchStageReflectionProbeBindings(root,[bindings[0]]).ambiguousBindingPaths.length,1);
});
