import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'
import { loadStageTransformModules } from './tests/helpers/loadStageTransformModules.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const temporary = []
after(() => temporary.forEach(file => rmSync(file, { force: true })))
function compile(name, replacements = []) {
    const source = readFileSync(join(root, 'src/viewer', name + '.ts'), 'utf8')
    let output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText
    for (const [before, next] of replacements) output = output.replaceAll(before, next)
    const file = join(root, `.visibility-${name}-${process.pid}.mjs`)
    writeFileSync(file, output)
    temporary.push(file)
    return file
}
const hierarchy = compile('stageHierarchy')
const source = compile('stageNativeVisibility', [
    ["'./stageHierarchy'", `'./${basename(hierarchy)}'`],
])
const { applyStageNativeVisibility: apply } = await import(pathToFileURL(source).href)
const { batching: { batchStaticStageMeshes: batch } } = loadStageTransformModules()
function fixture() {
    const scene = new THREE.Group(); scene.name = 'Root'
    const parent = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    parent.name = 'Parent'; parent.layers.set(3)
    const child = parent.clone(); child.name = 'Child'; parent.add(child); scene.add(parent)
    return { scene, parent, child }
}
const go = (hierarchyPath, activeSelf, gameObjectPathID = hierarchyPath) => ({ hierarchyPath, activeSelf, gameObjectPathID })
const renderer = (hierarchyPath, enabled) => ({ hierarchyPath, enabled, rendererPathID: hierarchyPath })

test('Renderer.disabled masks only its own draw, not its child renderer', () => {
    const f = fixture()
    const result = apply(f.scene, { renderers: [renderer('Root/Parent', false)] })
    assert.equal(f.parent.visible, true)
    assert.equal(f.parent.layers.mask, 0)
    assert.equal(f.child.visible, true)
    assert.equal(f.child.layers.mask, 8)
    assert.equal(result.debug.disabledRenderers, 1)
    result.restore(); result.restore()
    assert.equal(f.parent.layers.mask, 8)
})
test('GameObject.activeSelf hides the subtree and retains child activeSelf independently', () => {
    const f = fixture()
    const result = apply(f.scene, { gameObjects: [go('Root/Parent', false), go('Root/Parent/Child', true)] })
    assert.equal(f.parent.visible, false)
    assert.equal(f.child.visible, true)
    assert.equal(f.parent.layers.mask, 8)
    f.parent.visible = true // Timeline may subsequently activate this object.
    assert.equal(f.parent.visible, true) // No per-frame reapplication hook.
    result.restore()
    assert.equal(f.parent.visible, true)
})
test('ambiguous native identities and missing paths remain unresolved, not guessed', () => {
    const f = fixture()
    const result = apply(f.scene, { gameObjects: [go('Root/Parent', true, 'a'), go('Root/Parent', false, 'b')], renderers: [renderer('Root/absent', false), renderer('Root', false)] })
    assert.equal(f.parent.visible, true)
    assert.deepEqual(result.debug.ambiguousGameObjectPaths, ['Root/Parent'])
    assert.deepEqual(result.debug.unresolvedRendererPaths, ['Root/absent', 'Root'])
    assert.equal(f.child.layers.mask, 8)
})
test('absent profile leaves legacy scenes unchanged', () => {
    const f = fixture(); f.parent.visible = false
    assert.equal(apply(f.scene, undefined), undefined)
    assert.equal(f.parent.visible, false)
    assert.equal(f.child.layers.mask, 8)
})
test('different native paths resolving to the same sanitized carrier are not overwritten', () => {
    const scene = new THREE.Group(); scene.name = 'Root'
    const object = new THREE.Group(); object.name = 'A_B'; scene.add(object)
    const result = apply(scene, { gameObjects: [go('Root/A B', false), go('Root/A_B', true)] })
    assert.equal(object.visible, true)
    assert.equal(result.debug.appliedGameObjects, 0)
    assert.deepEqual(result.debug.ambiguousGameObjectPaths, ['Root/A B', 'Root/A_B'])
})
test('disabled renderers stay out of static batches and are not re-enabled by batch restore', () => {
    const scene = new THREE.Group(); scene.name = 'Root'
    for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
        m.name = `M${i}`
        m.material.userData.stageRigidBatchBinding = 'same'
        m.material.userData.stageRigidVertexPosition = true
        scene.add(m)
    }
    const visibility = apply(scene, { renderers: scene.children.map(m => renderer('Root/' + m.name, false)) })
    const result = batch(scene, { hasRuntimeOrTransformWriter: false })
    assert.equal(result.stats.batches, 0)
    result.restore()
    scene.children.forEach(m => assert.equal(m.layers.mask, 0))
    visibility.restore()
    scene.children.forEach(m => assert.equal(m.layers.mask, 1))
})
test('loader applies native states after layer preparation and before content gate and batching', () => {
    const loader = readFileSync(join(root, 'src/viewer/stages.ts'), 'utf8')
    const prepare = loader.indexOf('prepareStageObject(object, definition.renderProfile?.stageLayer)')
    const applyIndex = loader.indexOf('applyStageNativeVisibility(object, definition.nativeVisibility)')
    const gate = loader.indexOf('candidateVisibleContent = inspectStageVisibleContent')
    const batching = loader.indexOf('const batching = batchStaticStageMeshes')
    assert.ok(prepare >= 0 && applyIndex > prepare && gate > applyIndex && batching > gate)
    assert.match(loader, /nativeVisibility: generated\.nativeVisibility \?\? definition\.nativeVisibility/)
})
