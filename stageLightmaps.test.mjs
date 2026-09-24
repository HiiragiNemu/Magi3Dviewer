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

function nativeBgUnlit() {
    const material = new THREE.MeshBasicMaterial({ color: 0xd48668 })
    material.userData.stageUnityMaterialState = { sourceShader: 'Creative/Bg/BgUnlit' }
    return material
}

test('native BgUnlit slots ignore baked lightmaps without suppressing lit siblings', () => {
    const root = new THREE.Group(); root.name = 'Root'
    const unlit = nativeBgUnlit(), lit = new THREE.MeshStandardMaterial()
    const original = [unlit, unlit, lit]
    const mesh = makeRenderer(root, 'object_mid_grp', original)
    const texture = new THREE.Texture()
    let disposedUnlit = 0, disposedLit = 0
    unlit.addEventListener('dispose', () => disposedUnlit++)
    const r = lightmaps.applyStageLightmaps(root, texture, [{
        rendererHierarchyPath: 'Root/object_mid_grp',
        lightmapScaleOffset: [.5,.5,.25,.25],
    }], { strict: true })
    assert.equal(mesh.material.length, 3)
    assert.equal(mesh.material[0], unlit)
    assert.equal(mesh.material[1], unlit)
    assert.equal(unlit.lightMap, null)
    assert.notEqual(mesh.material[2], lit)
    assert.equal(mesh.material[2].lightMap, texture)
    assert.equal(r.matchedRendererCount, 1)
    assert.equal(r.skippedUnlitMaterialPaths.length, 2)
    assert.equal(lightmaps.hasCompleteActiveStageLightmapCoverage(r), true)
    mesh.material[2].addEventListener('dispose', () => disposedLit++)
    r.dispose(); r.dispose()
    assert.equal(mesh.material, original)
    assert.equal(disposedUnlit, 0)
    assert.equal(disposedLit, 1)
})

test('all native BgUnlit renderers require neither UV1 nor baked texture data', () => {
    const root = new THREE.Group(); root.name = 'Root'
    const unlit = nativeBgUnlit(), mesh = makeRenderer(root, 'near', unlit)
    mesh.geometry.deleteAttribute('uv1')
    const r = lightmaps.applyStageLightmaps(root, [], [{
        rendererHierarchyPath: 'Root/near', lightmapIndex: 12,
        lightmapScaleOffset: [1,1,0,0],
    }], { strict: true, directionalLightmaps: [new THREE.Texture()] })
    assert.equal(mesh.material, unlit)
    assert.equal(r.matchedRendererCount, 0)
    assert.equal(r.skippedUnlitMaterialPaths.length, 1)
    assert.deepEqual(r.missingSecondUvPaths, [])
    assert.deepEqual(r.missingLightmapPaths, [])
    assert.deepEqual(r.missingDirectionalLightmapPaths, [])
    r.dispose(); assert.equal(mesh.material, unlit)
})

test('only exact native BgUnlit identity skips lightmaps, not all MeshBasic materials', () => {
    const root = new THREE.Group(); root.name = 'Root'
    const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), new THREE.MeshStandardMaterial()]
    materials[1].userData.stageUnityMaterialState = { sourceShader: 'Other/BgUnlit' }
    materials[2].userData.stageUnityMaterialState = { sourceShader: 'Creative/Bg/Bg' }
    const mesh = makeRenderer(root, 'mixed', materials), texture = new THREE.Texture()
    const r = lightmaps.applyStageLightmaps(root, texture, [{
        rendererHierarchyPath: 'Root/mixed', lightmapScaleOffset: [1,1,0,0],
    }], { strict: true })
    mesh.material.forEach((m,i) => { assert.notEqual(m, materials[i]); assert.equal(m.lightMap, texture) })
    assert.deepEqual(r.skippedUnlitMaterialPaths, [])
    r.dispose(); assert.equal(mesh.material, materials)
})

test('mixed native Unlit and unsupported lit slots still fail closed before any mutation', () => {
    const root = new THREE.Group(); root.name = 'Root'
    const original = [nativeBgUnlit(), new THREE.ShaderMaterial()]
    const mesh = makeRenderer(root, 'mixed', original)
    assert.throws(() => lightmaps.applyStageLightmaps(root, new THREE.Texture(), [{
        rendererHierarchyPath: 'Root/mixed', lightmapScaleOffset: [1,1,0,0],
    }], { strict: true }), /unsupportedMaterial=1/)
    assert.equal(mesh.material, original)
})

function identityFixture() {
    const root = new THREE.Group(); root.name = 'native_scene';
    const meshes = [2, 7].map(x => {
        const parent = new THREE.Group(); parent.name = 'duplicate';
        parent.position.x = x; root.add(parent);
        return makeRenderer(parent, 'renderer', new THREE.MeshStandardMaterial());
    });
    const bindings = meshes.map((mesh, index) => ({
        rendererHierarchyPath: 'native_scene/duplicate/renderer',
        lightmapIndex: index,
        lightmapScaleOffset: [0.25, 0.5, index * 0.5, 0],
        rendererIdentity: {
            rendererPathID: index ? '9123456789012345678' : '-9123456789012345678',
            transformChain: [root, mesh.parent, mesh].map(object => ({
                name: object.name, position: object.position.toArray(),
                rotation: object.quaternion.toArray(), scale: object.scale.toArray(),
            })),
        },
    }));
    return { root, meshes, bindings };
}

test('native complete ancestry binds distinct ST without relying on duplicate order', () => {
    for (const reversed of [false, true]) {
        const { root, meshes, bindings } = identityFixture();
        if (reversed) { root.children.reverse(); bindings.reverse(); }
        root.name = 'Stage:test';
        const result = lightmaps.matchStageLightmapBindings(root, bindings);
        assert.equal(result.matches.length, 2);
        assert.deepEqual(result.ambiguousBindingPaths, []);
        for (const match of result.matches) {
            assert.equal(meshes.indexOf(match.mesh), match.binding.lightmapIndex);
        }
    }
});

test('native quaternion sign equivalence is retained', () => {
    const { root, bindings } = identityFixture();
    for (const binding of bindings) for (const node of binding.rendererIdentity.transformChain) {
        node.rotation = node.rotation.map(value => -value);
    }
    assert.equal(lightmaps.matchStageLightmapBindings(root, bindings).matches.length, 2);
});

test('ordinary loader preserves the decoded native root before applying asset placement', () => {
    const stages = readFileSync(join(repositoryRoot, 'src/viewer/stages.ts'), 'utf8')
    const start = stages.indexOf('object.userData.stageSerializedRootTransform = {')
    const end = stages.indexOf('\n    return object', start)
    assert.ok(start >= 0 && end > start)
    // Execute the actual loader tail, including its zero/identity defaults.
    const place = new Function('object', 'definition', stages.slice(start, end))
    const { root, bindings } = identityFixture()
    root.position.set(2, 0, 0); root.rotation.z = 0.2; root.scale.setScalar(1.5)
    for (const binding of bindings) Object.assign(binding.rendererIdentity.transformChain[0], {
        position: root.position.toArray(), rotation: root.quaternion.toArray(), scale: root.scale.toArray(),
    })
    place(root, {})
    assert.deepEqual(root.position.toArray(), [0, 0, 0])
    assert.deepEqual(root.scale.toArray(), [1, 1, 1])
    root.name = 'Stage:test'
    assert.equal(lightmaps.matchStageLightmapBindings(root, bindings, {
        nativeRootTransform: root.userData.stageSerializedRootTransform,
    }).matches.length, 2)
})

test('serialized root snapshot preserves native identity across Viewer placement', () => {
    const { root, bindings } = identityFixture();
    const nativeRootTransform = {
        position: root.position.toArray(), rotation: root.quaternion.toArray(),
        scale: root.scale.toArray(),
    };
    root.name = 'Stage:placed'; root.rotation.x = Math.PI / 2;
    root.position.y = 9; root.scale.setScalar(3);
    const carrier = new THREE.Group(); carrier.add(root); carrier.rotation.y = 0.3;
    assert.equal(lightmaps.matchStageLightmapBindings(root, bindings).matches.length, 0);
    const options = { nativeRootTransform, strict: true };
    assert.equal(lightmaps.matchStageLightmapBindings(root, bindings, options).matches.length, 2);
    const application = lightmaps.applyStageLightmaps(root,
        [new THREE.Texture(), new THREE.Texture()], bindings, options);
    assert.equal(application.matchedRendererCount, 2);
    application.dispose();
    assert.equal(root.position.y, 9); assert.equal(root.scale.x, 3);
});

test('native ancestor mismatch has no fallback to a same-name mesh', () => {
    const { root, meshes, bindings } = identityFixture();
    meshes[0].parent.position.x += 0.001;
    const result = lightmaps.matchStageLightmapBindings(root, bindings);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].mesh, meshes[1]);
    assert.equal(result.unmatchedBindingPaths.length, 1);
});

test('two native claims on one candidate remain ambiguous regardless of order', () => {
    const { root, bindings } = identityFixture();
    const duplicate = structuredClone(bindings[0]);
    duplicate.rendererIdentity.rendererPathID = '8123456789012345678';
    for (const rows of [[bindings[0], duplicate], [duplicate, bindings[0]]]) {
        const result = lightmaps.matchStageLightmapBindings(root, rows);
        assert.equal(result.matches.length, 0);
        assert.equal(result.ambiguousBindingPaths.length, 2);
    }
});

test('identical native chains on duplicate carriers remain ambiguous', () => {
    const { root, meshes, bindings } = identityFixture();
    meshes[1].parent.position.copy(meshes[0].parent.position);
    const result = lightmaps.matchStageLightmapBindings(root, [bindings[0]]);
    assert.equal(result.matches.length, 0);
    assert.equal(result.ambiguousBindingPaths.length, 1);
});

test('native identity must be finite, complete and consistent with the serialized path', () => {
    for (const mutate of [
        binding => { binding.rendererIdentity.transformChain.pop(); },
        binding => { binding.rendererIdentity.transformChain[0].position[0] = NaN; },
        binding => { binding.rendererIdentity.transformChain[1].name = 'wrong'; },
        binding => { binding.rendererHierarchyPath = 'other/renderer'; },
        binding => { binding.rendererIdentity.rendererPathID = 'rounded-identifier'; },
    ]) {
        const { root, bindings } = identityFixture(); mutate(bindings[0]);
        const result = lightmaps.matchStageLightmapBindings(root, [bindings[0]]);
        assert.equal(result.matches.length, 0);
        assert.equal(result.unmatchedBindingPaths.length, 1);
    }
});

test('legacy duplicate paths without native identity remain unresolved', () => {
    const { root, bindings } = identityFixture();
    const result = lightmaps.matchStageLightmapBindings(root,
        bindings.map(({ rendererIdentity, ...binding }) => binding));
    assert.equal(result.matches.length, 0);
    assert.equal(result.ambiguousBindingPaths.length, 2);
});

test('native identity installs correct per-instance maps while preserving Unlit siblings and rollback', () => {
    const { root, meshes, bindings } = identityFixture();
    const unlit = new THREE.MeshBasicMaterial();
    unlit.userData.stageUnityMaterialState = { sourceShader: 'Creative/Bg/BgUnlit' };
    for (const mesh of meshes) mesh.material = [unlit, mesh.material];
    const originals = meshes.map(mesh => mesh.material);
    const maps = [new THREE.Texture(), new THREE.Texture()];
    const application = lightmaps.applyStageLightmaps(root, maps, bindings, { strict: true });
    assert.equal(application.matchedRendererCount, 2);
    meshes.forEach((mesh, index) => {
        assert.equal(mesh.material[0], unlit);
        assert.equal(mesh.material[1].lightMap, maps[index]);
        assert.deepEqual(mesh.material[1].userData.stageBatchLightmap.scaleOffset,
            bindings[index].lightmapScaleOffset);
    });
    application.dispose(); application.dispose();
    meshes.forEach((mesh, index) => assert.equal(mesh.material, originals[index]));
});


test('native reflected scales match the equivalent FBX decomposition without mutation', () => {
    for (const scales of [[1,1,-1],[-1,-1,-1],[1,-1,1],[-.72,-.6,-.6]]) {
        const {root,meshes,bindings}=identityFixture();
        const original=bindings[0].rendererIdentity.transformChain[1];
        original.rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(.2,.7,-.1)).toArray();
        original.scale=scales;
        const matrix=new THREE.Matrix4().compose(new THREE.Vector3(...original.position),new THREE.Quaternion(...original.rotation),new THREE.Vector3(...scales));
        matrix.decompose(meshes[0].parent.position,meshes[0].parent.quaternion,meshes[0].parent.scale);
        const before=JSON.stringify([meshes[0].parent.position,meshes[0].parent.quaternion,meshes[0].parent.scale]);
        const match=lightmaps.matchStageLightmapBindings(root,bindings);
        assert.equal(match.matches.length,2);
        assert.equal(match.matches.find(m=>m.binding===bindings[0]).mesh,meshes[0]);
        assert.equal(JSON.stringify([meshes[0].parent.position,meshes[0].parent.quaternion,meshes[0].parent.scale]),before);
    }
});

test('equivalent reflected matrices still require unique native ownership', () => {
    const {root,meshes,bindings}=identityFixture();
    const native=bindings[0].rendererIdentity.transformChain[1];
    native.scale=[1,1,-1];
    meshes[0].parent.quaternion.set(0,1,0,0); meshes[0].parent.scale.set(-1,1,1);
    const duplicate=structuredClone(bindings[0]);
    duplicate.rendererIdentity.rendererPathID='777';
    duplicate.rendererIdentity.transformChain[1].rotation=[0,1,0,0];
    duplicate.rendererIdentity.transformChain[1].scale=[-1,1,1];
    for(const rows of [[bindings[0],duplicate],[duplicate,bindings[0]]]){
        const result=lightmaps.matchStageLightmapBindings(root,rows);
        assert.equal(result.matches.length,0);assert.equal(result.ambiguousBindingPaths.length,2);
    }
});

test('different inheritance scale is not mistaken for an equivalent transform', () => {
    const {root,meshes,bindings}=identityFixture();
    const m=meshes[0].parent;m.rotation.y=-Math.PI/2;m.scale.set(.75,1,4/3);
    bindings[0].rendererIdentity.transformChain[1].rotation=m.quaternion.toArray();
    m.userData.transformData={translation:m.position.toArray(),rotation:[0,-90,0],scale:[1,1,1],inheritType:0};
    const result=lightmaps.matchStageLightmapBindings(root,bindings);
    assert.equal(result.matches.length,1);assert.equal(result.unmatchedBindingPaths.length,1);
});

test('matrix-equivalent identity respects root snapshot and malformed dimensions', () => {
    const {root,bindings}=identityFixture();
    for(const binding of bindings)binding.rendererIdentity.transformChain[0].scale=[1,1,-1];
    root.position.set(9,8,7);root.scale.setScalar(3);root.name='Stage:test';
    const nativeRootTransform={position:[0,0,0],rotation:[0,1,0,0],scale:[-1,1,1]};
    assert.equal(lightmaps.matchStageLightmapBindings(root,bindings,{nativeRootTransform}).matches.length,2);
    for(const value of [[1,1], [1,1,-1,0], [1,NaN,-1]]){
        const bad=structuredClone(bindings[0]);bad.rendererIdentity.transformChain[0].scale=value;
        assert.equal(lightmaps.matchStageLightmapBindings(root,[bad],{nativeRootTransform}).matches.length,0);
    }
});
