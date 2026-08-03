import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(repositoryRoot, 'src', 'viewer', 'stageLightmaps.ts')
const runtimePath = join(
    repositoryRoot,
    `.stage-lightmaps-under-test-${process.pid}-${Date.now()}.mjs`,
)
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')
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
            'existing-stage-key:unity-2022.3-rgbm-lightmap-v1',
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
        /pow\( lightMapTexel\.a, 2\.2 \).*34\.493242/s,
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
