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
const hierarchyPath = join(root, `.stage-alpha-mask-hierarchy-${nonce}.mjs`)
const particlePath = join(root, `.stage-alpha-mask-particles-${nonce}.mjs`)
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

const officialMaterial = name => {
    const row = product.particleRuntime.officialMaterials.find(material => material.name === name)
    assert.ok(row, `missing official material ${name}`)
    return row
}

test('101901 implicated materials carry exact official alpha-source selectors', () => {
    const fire02 = officialMaterial('eff_101901_dml_fire_02_ab')
    assert.ok(fire02.validKeywords.includes('IS_MASK_TEX'))
    assert.equal(fire02.floats._IsMask, 1)
    assert.equal(fire02.floats._IsMaskTex, 1)
    assert.equal(fire02.floats._AlphaIsGrayScale, 0)
    assert.equal(fire02.textures._MainTex.pointer.resolved, true)

    const fire03 = officialMaterial('eff_101901_dml_fire_03_ab')
    assert.equal(fire03.floats._IsSecondMap, 1)
    assert.equal(fire03.floats._IsTex2AlphaMask, 1)
    assert.equal(fire03.floats._AlphaIsGrayScale2, 1)
    assert.equal(fire03.textures._SecondTex.pointer.resolved, true)

    const smoke = officialMaterial('eff_cmn_smoke_07_ab')
    assert.ok(smoke.validKeywords.includes('IS_MASK_TEX'))
    assert.equal(smoke.floats._IsMask, 1)
    assert.equal(smoke.floats._IsMaskTex, 1)
    assert.equal(smoke.floats._IsTex2AlphaMask, 1)
    assert.equal(smoke.floats._AlphaIsGrayScale2, 1)

    const impact02 = officialMaterial('eff_101901_dml_impact_02_ab')
    assert.equal(impact02.floats._AlphaIsGrayScale, 1)
    assert.equal(impact02.floats._IsMask, 0)
    assert.equal(impact02.floats._IsMaskTex, 0)
    assert.equal(impact02.floats._IsTex2AlphaMask, 0)
})

test('particle fragment consumes mask keyword/properties and second grayscale alpha', () => {
    assert.match(source, /function officialAlphaMaskState\(/)
    assert.match(source, /validKeywords\?\.includes\('IS_MASK_TEX'\) === true/)
    assert.match(source, /finite\(floats\._IsMask\) > 0\.5/)
    assert.match(source, /finite\(floats\._IsMaskTex\) > 0\.5/)
    assert.match(source, /finite\(floats\._AlphaIsGrayScale2\) > 0\.5/)
    assert.match(source, /uMainMaskTex: \{ value: alphaMaskState\.mainMaskTexture \? 1 : 0 \}/)
    assert.match(source, /uAlphaIsGray2: \{ value: alphaMaskState\.secondGrayScale \? 1 : 0 \}/)
    assert.match(source, /max\(uAlphaIsGray, uMainMaskTex\)/)
    assert.match(source, /float secondGrayAlpha = dot\(secondTexel\.rgb, alphaLuminance\);/)
    assert.match(source, /secondAlphaSource,[\s\S]*uTex2AlphaMask/)
    assert.doesNotMatch(source, /float secondAlpha = mix\(1\.0, secondTexel\.a, uTex2AlphaMask\);/)
})

function runtimeMaterial({
    validKeywords = [],
    floats = {},
    secondTexture = false,
}) {
    const scene = new THREE.Group()
    scene.name = 'Root'
    const anchor = new THREE.Group()
    anchor.name = 'Particle'
    scene.add(anchor)
    const texture = url => {
        const value = new THREE.DataTexture(new Uint8Array([96, 160, 224, 255]), 1, 1)
        value.userData.stageTextureBinding = { url }
        value.needsUpdate = true
        return value
    }
    const textures = [texture('/main.png')]
    if (secondTexture) textures.push(texture('/second.png'))
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
    const officialTextures = {
        _MainTex: { url: '/main.png', scale: [1, 1], offset: [0, 0] },
    }
    if (secondTexture) {
        officialTextures._SecondTex = { url: '/second.png', scale: [1, 1], offset: [0, 0] }
    }
    const controller = new particles.StageParticleRuntimeController(
        scene,
        [preset],
        [{ pathID: '1', hierarchyPath: 'Root/Particle', active: true, presetId: 'preset', materials: ['official'] }],
        [{ materialName: 'official', transparent: true, textures: { base: { url: '/main.png' } } }],
        textures,
        { officialMaterials: [{
            name: 'official', validKeywords, invalidKeywords: [],
            textures: officialTextures,
            floats,
        }] },
    )
    const drawable = anchor.children.find(child => child.name === 'UnityParticleSystem:1')
    assert.ok(drawable instanceof THREE.Points)
    return { controller, material: drawable.material, textures }
}

test('runtime selects only the authored main-mask and second-grayscale branches', () => {
    const mainMask = runtimeMaterial({
        validKeywords: ['IS_MASK_TEX'],
        floats: { _IsMask: 1, _IsMaskTex: 1, _AlphaIsGrayScale: 0 },
    })
    assert.equal(mainMask.material.uniforms.uAlphaIsGray.value, 0)
    assert.equal(mainMask.material.uniforms.uMainMaskTex.value, 1)
    assert.equal(mainMask.material.uniforms.uAlphaIsGray2.value, 0)
    assert.equal(mainMask.material.uniforms.uTex2AlphaMask.value, 0)
    mainMask.controller.dispose()
    mainMask.textures.forEach(texture => texture.dispose())

    const secondMask = runtimeMaterial({
        floats: { _IsSecondMap: 1, _IsTex2AlphaMask: 1, _AlphaIsGrayScale2: 1 },
        secondTexture: true,
    })
    assert.equal(secondMask.material.uniforms.uMainMaskTex.value, 0)
    assert.equal(secondMask.material.uniforms.uAlphaIsGray2.value, 1)
    assert.equal(secondMask.material.uniforms.uTex2AlphaMask.value, 1)
    secondMask.controller.dispose()
    secondMask.textures.forEach(texture => texture.dispose())

    const impact = runtimeMaterial({ floats: { _AlphaIsGrayScale: 1 } })
    assert.equal(impact.material.uniforms.uAlphaIsGray.value, 1)
    assert.equal(impact.material.uniforms.uMainMaskTex.value, 0)
    assert.equal(impact.material.uniforms.uAlphaIsGray2.value, 0)
    assert.equal(impact.material.uniforms.uTex2AlphaMask.value, 0)
    impact.controller.dispose()
    impact.textures.forEach(texture => texture.dispose())
})
