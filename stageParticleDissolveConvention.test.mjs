import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(root, 'src', 'viewer', 'stageParticles.ts')
const hierarchySourcePath = join(root, 'src', 'viewer', 'stageHierarchy.ts')
const productPath = join(root, 'public', 'vfx', 'chara_101901', 'e', 'product.json')
const source = readFileSync(sourcePath, 'utf8')
const product = JSON.parse(readFileSync(productPath, 'utf8'))

const nonce = `${process.pid}-${Date.now()}`
const hierarchyPath = join(root, `.stage-dissolve-hierarchy-${nonce}.mjs`)
const particlePath = join(root, `.stage-dissolve-particles-${nonce}.mjs`)
const compile = (input, fileName) => ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName,
}).outputText
writeFileSync(hierarchyPath, compile(readFileSync(hierarchySourcePath, 'utf8'), hierarchySourcePath))
writeFileSync(particlePath, compile(source, sourcePath)
    .replace("'./stageHierarchy'", `'./${basename(hierarchyPath)}'`)
    .replace(
        "'magia-exedra-character-three/coordinateSpace'",
        "'./magia-exedra-character-three/coordinateSpace.ts'",
    ))
const particles = await import(pathToFileURL(particlePath).href)
after(() => {
    rmSync(hierarchyPath, { force: true })
    rmSync(particlePath, { force: true })
})

const smoothstep = (edge0, edge1, value) => {
    const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
}

test('101901 official dissolve products serialize progress one as their visible authored state', () => {
    const enabled = product.particleRuntime.officialMaterials.filter(material =>
        material.validKeywords.includes('IS_DISSOLVE')
        && !material.invalidKeywords.includes('IS_DISSOLVE')
        && material.floats._IsDissolve > 0.5
        && !material.textures._DissolveTex.pointer.null)
    assert.equal(enabled.length, 12)
    assert.equal(Math.max(...enabled.map(material => material.floats._DissolveProgress)), 1)
    assert.ok(Math.min(...enabled.map(material => material.floats._DissolveProgress)) > 0.99)

    const progress = enabled[0].floats._DissolveProgress
    const range = enabled[0].floats._DissolveTexSmoothRange
    const oldAlphaMask = smoothstep(progress - range, progress + range, 0.5)
    const officialAlphaMask = 1 - oldAlphaMask
    assert.equal(oldAlphaMask, 0)
    assert.equal(officialAlphaMask, 1)
})

test('particle fragment uses the official keyword/property gate and inverted alpha threshold', () => {
    assert.match(source, /function officialDissolveState\(/)
    assert.match(source, /validKeywords\?\.includes\('IS_DISSOLVE'\) === true/)
    assert.match(source, /invalidKeywords\?\.includes\('IS_DISSOLVE'\) === true/)
    assert.match(source, /finite\(floats\._IsDissolve\) > 0\.5/)
    assert.match(source, /uHasDissolve: \{ value: dissolveState\.enabled \? 1 : 0 \}/)
    assert.match(source, /uDissolveProgress: \{ value: dissolveState\.progress \}/)
    assert.match(source, /float dissolveMask = 1\.0 - smoothstep\(/)
    assert.doesNotMatch(source, /uHasDissolve: \{ value: dissolve\.present \? 1 : 0 \}/)
    assert.doesNotMatch(source, /float dissolveMask = smoothstep\(/)
})

function runtimeMaterial(isDissolve, validKeywords = ['IS_DISSOLVE']) {
    const scene = new THREE.Group()
    scene.name = 'Root'
    const anchor = new THREE.Group()
    anchor.name = 'Particle'
    scene.add(anchor)
    const texture = url => {
        const value = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)
        value.userData.stageTextureBinding = { url }
        value.needsUpdate = true
        return value
    }
    const textures = [texture('/base.png'), texture('/dissolve.png')]
    const constant = scalar => ({ minMaxState: 0, minScalar: scalar, scalar })
    const preset = {
        id: 'preset', duration: 1, simulationSpeed: 1, looping: false,
        playOnAwake: true, autoRandomSeed: false, randomSeed: 1,
        initial: {
            maxNumParticles: 1, startLifetime: constant(1), startSpeed: constant(0),
            gravityModifier: constant(0), startSize: constant(1),
            startRotation: constant(0), startColor: { maxColor: [1, 1, 1, 1] },
        },
        emission: { enabled: true, rateOverTime: constant(0), m_Bursts: [] },
        modules: {}, renderer: { enabled: true, renderMode: 0, sortingOrder: 0 },
    }
    const controller = new particles.StageParticleRuntimeController(
        scene,
        [preset],
        [{ pathID: '1', hierarchyPath: 'Root/Particle', active: true, presetId: 'preset', materials: ['official'] }],
        [{ materialName: 'official', transparent: true, textures: { base: { url: '/base.png' } } }],
        textures,
        { officialMaterials: [{
            name: 'official', validKeywords, invalidKeywords: [],
            textures: { _DissolveTex: { url: '/dissolve.png', scale: [1, 1], offset: [0, 0] } },
            floats: { _IsDissolve: isDissolve, _DissolveProgress: 1, _DissolveTexSmoothRange: 0.02 },
        }] },
    )
    const drawable = anchor.children.find(child => child.name === 'UnityParticleSystem:1')
    assert.ok(drawable instanceof THREE.Points)
    return { controller, material: drawable.material, textures }
}

test('runtime keeps serialized progress and applies dissolve only to an enabled official pass', () => {
    const enabled = runtimeMaterial(1)
    assert.equal(enabled.material.uniforms.uHasDissolve.value, 1)
    assert.equal(enabled.material.uniforms.uDissolveProgress.value, 1)
    assert.match(enabled.material.fragmentShader, /float dissolveMask = 1\.0 - smoothstep\(/)
    enabled.controller.dispose()
    enabled.textures.forEach(texture => texture.dispose())

    const disabled = runtimeMaterial(0)
    assert.equal(disabled.material.uniforms.uHasDissolve.value, 0)
    assert.equal(disabled.material.uniforms.uDissolveProgress.value, 1)
    disabled.controller.dispose()
    disabled.textures.forEach(texture => texture.dispose())
})
