import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(repositoryRoot, 'src', 'viewer', 'stageCharacterShadowBridge.ts')
const runtimePath = join(
    repositoryRoot,
    `.stage-character-shadow-bridge-${process.pid}-${Date.now()}.mjs`,
)
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')
const {
    STAGE_CHARACTER_SHADOW_CASTERS_ENABLED,
    StageCharacterShadowBridge,
} = await import(pathToFileURL(runtimePath).href)

after(() => rmSync(runtimePath, { force: true }))

test('mirrors animated character casters into the background shadow scene only', () => {
    const background = new THREE.Scene()
    const root = new THREE.Group()
    root.position.set(3, 2, -4)
    const bone = new THREE.Bone()
    const skeleton = new THREE.Skeleton([bone])
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
    ], 3))
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
    ], 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
        1, 0, 0, 0,
        1, 0, 0, 0,
        1, 0, 0, 0,
    ], 4))
    const source = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial())
    source.add(bone)
    source.bind(skeleton)
    source.castShadow = true
    source.morphTargetInfluences = [0.25]
    source.morphTargetDictionary = { smile: 0 }
    source.customDepthMaterial = new THREE.MeshDepthMaterial()
    root.add(source)

    const bridge = new StageCharacterShadowBridge(background)
    bridge.stageLayer = 6
    bridge.add(root)
    bridge.update()

    const proxy = bridge.root.children[0]
    assert.equal(proxy.isSkinnedMesh, true)
    assert.equal(proxy.skeleton, source.skeleton)
    assert.equal(proxy.morphTargetInfluences, source.morphTargetInfluences)
    assert.equal(proxy.customDepthMaterial, source.customDepthMaterial)
    assert.equal(proxy.castShadow, true)
    assert.equal(proxy.receiveShadow, false)
    assert.equal(proxy.material.colorWrite, false)
    assert.equal(proxy.material.depthWrite, false)
    assert.equal(proxy.layers.isEnabled(6), true)
    assert.deepEqual(proxy.matrixWorld.elements, source.matrixWorld.elements)

    const contactGeometry=source.geometry.clone()
    source.geometry=contactGeometry
    bridge.update()
    assert.equal(proxy.geometry,contactGeometry,'late actor-local contact geometry must reach the stage caster')
    source.geometry=geometry
    bridge.update()
    assert.equal(proxy.geometry,geometry,'disabling/disposal restores the caster as well')
    contactGeometry.dispose()

    const depthMaterial = new THREE.MeshDepthMaterial()
    const backgroundOnlyShadowCamera = new THREE.PerspectiveCamera()
    backgroundOnlyShadowCamera.userData[
        STAGE_CHARACTER_SHADOW_CASTERS_ENABLED
    ] = false
    proxy.onBeforeShadow(
        undefined,
        proxy,
        new THREE.PerspectiveCamera(),
        backgroundOnlyShadowCamera,
        proxy.geometry,
        depthMaterial,
        null,
    )
    assert.equal(depthMaterial.depthWrite, false)
    assert.equal(depthMaterial.colorWrite, false)
    proxy.onAfterShadow(
        undefined,
        proxy,
        new THREE.PerspectiveCamera(),
        backgroundOnlyShadowCamera,
        proxy.geometry,
        depthMaterial,
        null,
    )
    assert.equal(depthMaterial.depthWrite, true)
    assert.equal(depthMaterial.colorWrite, true)

    const characterShadowCamera = new THREE.PerspectiveCamera()
    characterShadowCamera.userData[
        STAGE_CHARACTER_SHADOW_CASTERS_ENABLED
    ] = true
    proxy.onBeforeShadow(
        undefined,
        proxy,
        new THREE.PerspectiveCamera(),
        characterShadowCamera,
        proxy.geometry,
        depthMaterial,
        null,
    )
    assert.equal(depthMaterial.depthWrite, true)

    source.visible = false
    bridge.update()
    assert.equal(proxy.visible, false)
    bridge.remove(root)
    assert.equal(bridge.root.children.length, 0)
})
