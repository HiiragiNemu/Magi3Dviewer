import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const combatSource = readFileSync('src/viewer/combatVfx.ts', 'utf8')
const particleSource = readFileSync('src/viewer/stageParticles.ts', 'utf8')
const product = JSON.parse(readFileSync('public/vfx/chara_101901/e/product.json', 'utf8'))
const core = product.particleRuntime.officialMaterials.find(
    material => material.name === 'eff_101901_dml_core_01_ab',
)
assert.ok(core)

test('MODEL binding admits the authored procedural core without inventing an ID rule', () => {
    assert.match(combatSource, /function isExplicitUntexturedRampMaterial\(/)
    assert.match(combatSource, /official\.validKeywords \?\? \[\]\)\.includes\('IS_RAMP'\)/)
    assert.match(combatSource, /finite\(official\.floats\?\._IsMask\) > 0\.5/)
    assert.match(combatSource, /function closeOfficialParticleMaterialBindings\(/)
    assert.match(combatSource, /materialBindings\.push\(\{[\s\S]*materialName: name/)
    assert.equal(core.validKeywords.includes('PARTICLE_COMMON'), true)
    assert.equal(core.validKeywords.includes('IS_RAMP'), true)
    assert.equal(core.floats._Blightness, 20)
    assert.equal(core.floats._ParticleInRadius, 0.10000000149011612)
})

test('VISUAL consumer capability is present for the binding and preserves authored fields', () => {
    assert.match(particleSource, /const particleCommon = official\?\.validKeywords\?\.includes\('PARTICLE_COMMON'\)/)
    assert.match(particleSource, /const particleRamp = particleCommon[\s\S]*official\?\.validKeywords\?\.includes\('IS_RAMP'\)/)
    for (const name of [
        'uParticleCommon', 'uParticleRamp', 'uParticleInAlpha',
        'uParticleOutAlpha', 'uParticleInRadius', 'uRampAlpha',
        'uRampCentor', 'uRampCenterPos', 'uRampSmoothMin', 'uRampSmoothMax',
    ]) assert.match(particleSource, new RegExp(name))
    assert.match(particleSource, /rdParticleCommon\(pointUv, vStageColor\)/)
    assert.match(particleSource, /ramp\.rgb \* vertexColor\.rgb \* uBrightness/)
    assert.doesNotMatch(particleSource, /eff_101901_dml_core_01_ab.*(?:if|switch)/s)
})

test('unresolved texture-driven materials remain fail-closed and are not white fallback carriers', () => {
    assert.match(combatSource, /if \(!official \|\| !isExplicitUntexturedRampMaterial\(official\)\) continue/)
    assert.match(particleSource, /if \(!binding\) \{[\s\S]*this\.missingMaterialNames\.push\(materialName[^)]*\)[\s\S]*continue/)
    const missing = [
        'eff_cmn_grain_07_ab', 'eff_cmn_glare_03_add', 'eff_101901_dml_glow_01_ab',
        'eff_cmn_far_05_ab', 'eff_cmn_far_04_ab', 'eff_101901_dml_flash_01_ab_ztest',
        'eff_cmn_glare_03_ab', 'eff_101901_dml_wave_02_ab', 'eff_cmn_refraction_01_ab',
    ]
    const names = new Set(product.particleRuntime.officialMaterials.map(material => material.name))
    for (const name of missing) assert.equal(names.has(name), true)
})

console.log('PASS: MODEL procedural-binding admission and VISUAL procedural consumer are joined; authored core fields preserved; unresolved materials fail closed.')
