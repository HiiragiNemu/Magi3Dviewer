import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(root, path), 'utf8')
const source = process.env.STAGE_PARTICLE_SOURCE
    ? readFileSync(process.env.STAGE_PARTICLE_SOURCE, 'utf8')
    : read('src/viewer/stageParticles.ts')
const threeUrl = pathToFileURL(join(root, 'node_modules/three/build/three.module.js')).href
const dataModule = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = code => ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replaceAll("from 'three'", `from '${threeUrl}'`)
const hierarchy = dataModule(compile(read('src/viewer/stageHierarchy.ts')))
const coordinates = dataModule(compile(read('magia-exedra-character-three/coordinateSpace.ts')))
const particles = await import(dataModule(compile(source)
    .replace("'./stageHierarchy'", `'${hierarchy}'`)
    .replace("'magia-exedra-character-three/coordinateSpace'", `'${coordinates}'`)))
const product = JSON.parse(read('public/vfx/chara_101901/e/product.json'))
const core = product.particleRuntime.officialMaterials.find(m => m.name === 'eff_101901_dml_core_01_ab')
const system = product.particleRuntime.particleSystems.find(s => s.pathID === '4629656902011342632')
const preset = product.particleRuntime.particlePresets.find(p => p.id === system.presetId)

export function constructCommonMaterial(override = {}) {
    const official = { ...structuredClone(core), ...override }
    const parts = system.hierarchyPath.split('/')
    const group = new THREE.Group()
    group.name = parts.shift()
    let anchor = group
    for (const name of parts) {
        const child = new THREE.Group(); child.name = name
        anchor.add(child); anchor = child
    }
    const controller = new particles.StageParticleRuntimeController(
        group, [preset], [system],
        [{ materialName: core.name, color: [1, 1, 1, 1], transparent: true, depthWrite: false }], [],
        { officialMaterials: [official] },
    )
    const drawable = anchor.children.find(c => c.name === `UnityParticleSystem:${system.pathID}`)
    assert.ok(drawable?.isPoints)
    return { controller, material: drawable.material }
}

test('actual current constructor activates procedural core, preserving brightness and pass state', () => {
    const { controller, material } = constructCommonMaterial()
    assert.equal(material.uniforms.uParticleCommon?.value, 1)
    assert.equal(material.uniforms.uParticleRamp?.value, 1)
    assert.equal(material.uniforms.uBrightness.value, 20)
    assert.equal(material.uniforms.uHasDissolve.value, 0)
    assert.equal(material.uniforms.uMainMaskTex.value, 0)
    assert.equal(material.depthWrite, false)
    assert.equal(material.depthTest, true)
    assert.equal(material.depthFunc, THREE.LessEqualDepth)
    assert.equal(material.blendSrc, THREE.SrcAlphaFactor)
    assert.equal(material.blendDst, THREE.OneMinusSrcAlphaFactor)
    assert.match(material.fragmentShader, /rdParticleCommon\(pointUv, vStageColor\)/)
    controller.dispose()
})

test('every procedural uniform consumes literal source values including RampCentor despite invalid legacy keyword', () => {
    assert.ok(core.invalidKeywords.includes('RAMP_CENTOR'))
    const { controller, material } = constructCommonMaterial()
    for (const name of ['ParticleInAlpha', 'ParticleOutAlpha', 'ParticleInRadius', 'RampAlpha',
        'RampCentor', 'RampCenterPos', 'RampSmoothMin', 'RampSmoothMax',
        'AlphaSmoothMin', 'AlphaSmoothMax', 'MultipliedAlpha', 'IsGlobalBackgroundTintColor']) {
        assert.equal(material.uniforms[`u${name}`]?.value, core.floats[`_${name}`], name)
    }
    for (const name of ['ParticleColor', 'RampColorL', 'RampColorC', 'RampColorR', 'GlobalBackgroundTintColor']) {
        assert.deepEqual(material.uniforms[`u${name}`]?.value.toArray(), core.colors[`_${name}`], name)
    }
    assert.equal(material.uniforms.uRampCentor.value, 1)
    assert.doesNotMatch(material.fragmentShader, /uRampBlightness/)
    controller.dispose()
})

test('effective keyword gates never promote null textures, invalid keywords or IS_RAMP alone', () => {
    for (const [validKeywords, invalidKeywords, common, ramp] of [
        [[], [], 0, 0], [['IS_RAMP'], [], 0, 0],
        [['PARTICLE_COMMON'], [], 1, 0],
        [['PARTICLE_COMMON', 'IS_RAMP'], ['PARTICLE_COMMON'], 0, 0],
        [['PARTICLE_COMMON', 'IS_RAMP'], ['IS_RAMP'], 1, 0],
    ]) {
        const { controller, material } = constructCommonMaterial({ validKeywords, invalidKeywords })
        assert.equal(material.uniforms.uParticleCommon?.value, common)
        assert.equal(material.uniforms.uParticleRamp?.value, ramp)
        controller.dispose()
    }
})

test('Steam PS263/272 control flow retains exact alpha producer, ramp and smoothing math', () => {
    const { controller, material } = constructCommonMaterial()
    const fragment = material.fragmentShader
    assert.match(fragment, /weightedOuter \* weightedOuter \+ weightedInner/)
    assert.match(fragment, /vec3\(0\.3, 0\.59, 0\.11\)/)
    assert.match(fragment, /uAlphaIsGray >= 0\.5/)
    assert.match(fragment, /uRampCentor >= 0\.5/)
    assert.match(fragment, /min\(uAlphaSmoothMin \+ uAlphaSmoothMax, 1\.0\) - uAlphaSmoothMin/)
    assert.match(fragment, /ramp\.rgb \* vertexColor\.rgb \* uBrightness/)
    const helper = fragment.slice(fragment.indexOf('vec4 rdParticleCommon'), fragment.indexOf('void main()'))
    assert.doesNotMatch(helper, /texture2D|uEmissionColor|uMainMaskTex|uDissolve/)
    assert.ok(fragment.indexOf('rdParticleCommon(pointUv') < fragment.indexOf('if (uUseSoftParticle'))
    assert.match(fragment, /alpha \*= rdSoftFade/)
    assert.match(fragment, /alpha \*= mix\(1\.0, dissolveMask, uHasDissolve\)/)
    controller.dispose()
})
