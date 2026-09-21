import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import { buildSync } from 'esbuild'

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(repositoryRoot, 'src', 'viewer', 'stageLightmaps.ts')
const runtimePath = join(
    repositoryRoot,
    `.stage-lightmaps-under-test-${process.pid}-${Date.now()}.mjs`,
)
// Bundle the actual source and its native-mip dependency; no resolver stubs.
const compiled = buildSync({entryPoints:[sourcePath],bundle:true,platform:'node',format:'esm',packages:'external',write:false})
writeFileSync(runtimePath,compiled.outputFiles[0].contents)
const lightmaps = await import(pathToFileURL(runtimePath).href)

after(() => {
    rmSync(runtimePath, { force: true })
})

function addSecondUv(geometry) {
    geometry.setAttribute('uv1', new THREE.Float32BufferAttribute([
        0, 0,
        1, 0,
        0, 1,
    ], 2))
}

function makeRenderer(parent, name, material) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
    ], 3))
    addSecondUv(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    parent.add(mesh)
    return mesh
}

test('baked coverage follows active FBX carriers, not dormant serialized bindings', () => {
    const completeActiveCoverage = {
        matchedRendererCount: 25,
        unmatchedBindingPaths: Array.from(
            { length: 222 },
            (_, index) => `DormantPrefab/Renderer${index}`,
        ),
        ambiguousBindingPaths: [],
        missingSecondUvPaths: [],
        unsupportedMaterialPaths: [],
        missingLightmapPaths: [],
        missingDirectionalLightmapPaths: [],
    }
    assert.equal(
        lightmaps.hasCompleteActiveStageLightmapCoverage(completeActiveCoverage),
        true,
    )

    for (const field of [
        'ambiguousBindingPaths',
        'missingSecondUvPaths',
        'unsupportedMaterialPaths',
        'missingLightmapPaths',
        'missingDirectionalLightmapPaths',
    ]) {
        assert.equal(
            lightmaps.hasCompleteActiveStageLightmapCoverage({
                ...completeActiveCoverage,
                [field]: ['Active/Renderer'],
            }),
            false,
            field,
        )
    }
    assert.equal(
        lightmaps.hasCompleteActiveStageLightmapCoverage({
            ...completeActiveCoverage,
            matchedRendererCount: 0,
        }),
        false,
    )
})

test('binds 104 hierarchy suffixes with shared RGBM texture and independent ST', () => {
    const root = new THREE.Group()
    root.name = 'FbxWrapper'
    const scene = new THREE.Group()
    scene.name = 'bg_3d_600_00_01_002'
    root.add(scene)

    const sourceMaterial = new THREE.MeshStandardMaterial()
    sourceMaterial.onBeforeCompile = shader => {
        shader.vertexShader += '\n// preserved-stage-extension'
    }
    sourceMaterial.customProgramCacheKey = () => 'existing-stage-key'

    const meshes = []
    const bindings = []
    for (let index = 0; index < 104; index++) {
        const branch = new THREE.Group()
        branch.name = `branch${index}`
        scene.add(branch)
        const rendererName = `duplicateRenderer${index % 7}`
        meshes.push(makeRenderer(branch, rendererName, sourceMaterial))
        bindings.push({
            rendererHierarchyPath:
                `UnityScene/bg_3d_600_00_01_002/branch${index}/${rendererName}`,
            lightmapIndex: 0,
            lightmapScaleOffset: [
                0.01 + index * 0.0001,
                0.02,
                index * 0.001,
                0.25,
            ],
        })
    }

    const sharedLightmap = new THREE.Texture()
    sharedLightmap.flipY = true
    sharedLightmap.colorSpace = THREE.SRGBColorSpace
    const application = lightmaps.applyStageLightmaps(
        root,
        sharedLightmap,
        bindings,
        { intensity: 0.75, strict: true },
    )

    assert.equal(application.matchedRendererCount, 104)
    assert.deepEqual(application.unmatchedBindingPaths, [])
    assert.deepEqual(application.ambiguousBindingPaths, [])
    assert.deepEqual(application.missingSecondUvPaths, [])
    assert.equal(sharedLightmap.channel, 1)
    assert.equal(sharedLightmap.flipY, false)
    assert.equal(sharedLightmap.colorSpace, THREE.NoColorSpace)

    const installedMaterials = meshes.map(mesh => mesh.material)
    assert.equal(new Set(installedMaterials).size, 104)
    for (const material of installedMaterials) {
        assert.notEqual(material, sourceMaterial)
        assert.equal(material.lightMap, sharedLightmap)
        assert.equal(material.lightMapIntensity, 0.75)
        assert.equal(
            material.customProgramCacheKey(),
            'existing-stage-key:unity-2022.3-rgbm-lightmap-v2-pi',
        )
    }

    const shader = {
        uniforms: {},
        vertexShader: [
            '#include <uv_pars_vertex>',
            'void main() {',
            '#include <uv_vertex>',
            '}',
        ].join('\n'),
        fragmentShader: '#include <lights_fragment_maps>',
    }
    installedMaterials[37].onBeforeCompile(shader, {})
    assert.match(shader.vertexShader, /preserved-stage-extension/)
    assert.match(shader.vertexShader, /uniform vec4 uStageLightmapST/)
    assert.match(
        shader.vertexShader,
        /LIGHTMAP_UV \* uStageLightmapST\.xy/,
    )
    assert.match(
        shader.fragmentShader,
        /pow\( lightMapTexel\.a, 2\.2 \).*34\.4932404 \* 3\.141592653589793/s,
    )
    assert.deepEqual(
        shader.uniforms.uStageLightmapST.value.toArray(),
        bindings[37].lightmapScaleOffset,
    )

    let disposedCloneCount = 0
    installedMaterials.forEach(material => {
        material.addEventListener('dispose', () => {
            disposedCloneCount++
        })
    })
    let sharedTextureDisposed = false
    sharedLightmap.addEventListener('dispose', () => {
        sharedTextureDisposed = true
    })

    application.dispose()
    application.dispose()
    assert.equal(disposedCloneCount, 104)
    assert.equal(sharedTextureDisposed, false)
    meshes.forEach(mesh => assert.equal(mesh.material, sourceMaterial))
})

test('reports ambiguous suffixes and validates the second UV set before mutation', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    const left = new THREE.Group()
    const right = new THREE.Group()
    left.name = 'left'
    right.name = 'right'
    root.add(left, right)
    const leftMesh = makeRenderer(left, 'same', material)
    makeRenderer(right, 'same', material)

    const ambiguous = lightmaps.matchStageLightmapBindings(root, [{
        rendererHierarchyPath: 'same',
        lightmapScaleOffset: [1, 1, 0, 0],
    }])
    assert.deepEqual(ambiguous.ambiguousBindingPaths, ['same'])
    assert.equal(ambiguous.matches.length, 0)

    leftMesh.geometry.deleteAttribute('uv1')
    assert.throws(
        () => lightmaps.applyStageLightmaps(
            root,
            new THREE.Texture(),
            [{
                rendererHierarchyPath: 'left/same',
                lightmapScaleOffset: [1, 1, 0, 0],
            }],
            { strict: true },
        ),
        /missingUv1=1/,
    )
    assert.equal(leftMesh.material, material)
})

test('selects the exact Unity lightmap by each renderer lightmapIndex', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    const left = makeRenderer(root, 'left', material)
    const right = makeRenderer(root, 'right', material)
    const first = new THREE.Texture()
    const second = new THREE.Texture()
    const bindings = [
        {
            rendererHierarchyPath: 'left',
            lightmapIndex: 0,
            lightmapScaleOffset: [1, 1, 0, 0],
        },
        {
            rendererHierarchyPath: 'right',
            lightmapIndex: 1,
            lightmapScaleOffset: [0.5, 0.5, 0.25, 0.25],
        },
    ]
    const application = lightmaps.applyStageLightmaps(
        root,
        [first, second],
        bindings,
        { strict: true },
    )
    assert.equal(left.material.lightMap, first)
    assert.equal(right.material.lightMap, second)
    assert.deepEqual(application.missingLightmapPaths, [])
    application.dispose()

    assert.throws(
        () => lightmaps.applyStageLightmaps(
            root,
            [first],
            bindings,
            { strict: true },
        ),
        /missingLightmap=1/,
    )

    assert.throws(
        () => lightmaps.applyStageLightmaps(
            root,
            [first, second],
            bindings,
            {
                directionalLightmaps: [new THREE.Texture()],
                strict: true,
            },
        ),
        /missingDirectionalLightmap=1/,
    )
})

test('evaluates Unity directional lightmaps in reflected Viewer world space', () => {
    const root = new THREE.Group()
    const source = new THREE.MeshStandardMaterial()
    const mesh = makeRenderer(root, 'directional', source)
    const color = new THREE.Texture()
    const direction = new THREE.Texture()
    direction.flipY = true
    direction.colorSpace = THREE.SRGBColorSpace
    const application = lightmaps.applyStageLightmaps(
        root,
        color,
        [{
            rendererHierarchyPath: 'directional',
            lightmapIndex: 0,
            lightmapScaleOffset: [1, 1, 0, 0],
        }],
        { directionalLightmaps: [direction], strict: true },
    )
    assert.equal(direction.flipY, false)
    assert.equal(direction.colorSpace, THREE.NoColorSpace)
    assert.match(
        mesh.material.customProgramCacheKey(),
        /unity-2022\.3-rgbm-directional-lightmap-v2-pi/,
    )
    const shader = {
        uniforms: {},
        vertexShader: '#include <uv_pars_vertex>\n#include <uv_vertex>',
        fragmentShader: '#include <common>\n#include <lights_fragment_maps>',
    }
    mesh.material.onBeforeCompile(shader, {})
    assert.equal(shader.uniforms.uStageLightmapDirection.value, direction)
    assert.match(shader.fragmentShader, /stageDirection\.xyz - vec3\( 0\.5 \)/)
    assert.match(shader.fragmentShader, /stageDirectionVector\.x = -stageDirectionVector\.x/)
    assert.match(shader.fragmentShader, /inverseTransformDirection\( normal, viewMatrix \)/)
    assert.match(shader.fragmentShader, /stageHalfLambert \/ max\( 1e-4, stageDirection\.w \)/)
    assert.match(
        shader.fragmentShader,
        /\* 3\.141592653589793 \* lightMapIntensity/,
        'Unity baked irradiance must cancel Three MeshStandard BRDF_Lambert 1/pi',
    )
    application.dispose()
})

test('uses exact linear BC6H lightmaps without applying the RGBM alpha decoder', () => {
    const root = new THREE.Group()
    const source = new THREE.MeshStandardMaterial()
    const mesh = makeRenderer(root, 'bc6h', source)
    const color = new THREE.Texture()
    const application = lightmaps.applyStageLightmaps(
        root,
        color,
        [{
            rendererHierarchyPath: 'bc6h',
            lightmapIndex: 0,
            lightmapScaleOffset: [1, 1, 0, 0],
        }],
        { encoding: 'unity-bc6h-linear', strict: true },
    )
    assert.match(
        mesh.material.customProgramCacheKey(),
        /unity-2022\.3-bc6h-lightmap-v1-pi/,
    )
    const shader = {
        uniforms: {},
        vertexShader: '#include <uv_pars_vertex>\n#include <uv_vertex>',
        fragmentShader: '#include <lights_fragment_maps>',
    }
    mesh.material.onBeforeCompile(shader, {})
    assert.match(
        shader.fragmentShader,
        /lightMapTexel\.rgb \* 3\.141592653589793 \* lightMapIntensity/,
    )
    assert.doesNotMatch(shader.fragmentShader, /pow\( lightMapTexel\.a/)
    application.dispose()
})

test('FBX original names preserve spaces and the runtime root prefix', () => {
    const root = new THREE.Group(); root.name = 'Stage:fixture'; root.userData.originalName = 'UnityScene';
    const material = new THREE.MeshStandardMaterial();
    const a = makeRenderer(root, 'mesh_part', material); a.userData.originalName = 'mesh part';
    const b = makeRenderer(root, 'mesh_part', material); b.userData.originalName = 'mesh_part';
    const bindings = ['mesh part', 'mesh_part'].map(name => ({rendererHierarchyPath:'UnityScene/'+name,lightmapIndex:0,lightmapScaleOffset:[1,1,0,0]}));
    const r = lightmaps.matchStageLightmapBindings(root, bindings);
    assert.equal(r.matches.length, 2); assert.equal(r.matches[0].mesh, a); assert.equal(r.matches[1].mesh, b);
    assert.equal(lightmaps.getStageHierarchyPath(a, root), 'Stage:fixture/mesh part');
    makeRenderer(root, 'mesh_part', material).userData.originalName = 'mesh part';
    assert.equal(lightmaps.matchStageLightmapBindings(root, [bindings[0]]).ambiguousBindingPaths.length, 1);
});
test('lightmap clones retain render-time animation callbacks and restore originals', () => {
    const root = new THREE.Group(); root.name = 'Root';
    const material = new THREE.MeshStandardMaterial(); material.userData.advance = 0;
    material.onBeforeRender = function () { this.userData.advance++; };
    const mesh = makeRenderer(root, 'atlas', material);
    const r = lightmaps.applyStageLightmaps(root, new THREE.Texture(), [{rendererHierarchyPath:'Root/atlas',lightmapIndex:0,lightmapScaleOffset:[1,1,0,0]}], {strict:true});
    assert.notEqual(mesh.material, material); assert.equal(mesh.material.onBeforeRender, material.onBeforeRender);
    mesh.material.onBeforeRender(); assert.equal(mesh.material.userData.advance, 1); assert.equal(material.userData.advance, 0);
    r.dispose(); assert.equal(mesh.material, material);
});
