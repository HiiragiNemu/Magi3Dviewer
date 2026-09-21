import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const gemShader = await readFile(
    new URL('./magia-exedra-character-three/shaders/gem.ts', import.meta.url),
    'utf8',
)
const loader = await readFile(
    new URL('./magia-exedra-character-three/loader.ts', import.meta.url),
    'utf8',
)

test('per-slot gem uniforms update both the gem pass and special-jewel specular boost', () => {
    assert.match(gemShader, /set\('uMaterialIsGem', gem\.enabled \? 1 : 0\);/)
    assert.match(gemShader, /set\('uMaterialSpecialJewel', gem\.enabled \? 1 : 0\);/)
})

test('draw-group binding refreshes the official profile before each render', () => {
    assert.match(loader, /const profile = slotProfiles\[index\] \?\? slotProfiles\[0\]/)
    assert.match(loader, /setOfficialMaterialProfileUniforms\(shader, profile\)/)
})

test('draw-group diagnostics expose exact Gem uniforms and render state without changing them', () => {
    assert.match(gemShader, /export function createOfficialGemSlotRuntime\(/)
    assert.match(gemShader, /effectiveDepthDiff: gem\.useDepthDiff && transparency/)
    assert.match(gemShader, /officialForwardCull: 'back'/)
    assert.match(gemShader, /viewerBackfaceCompensation: false/)
    assert.match(gemShader, /uGemHeightCorrection: uniform\('uGemHeightCorrection'\)/)
    assert.match(loader, /createOfficialGemSlotRuntime\(shader, profile\)/)
    assert.match(
        loader,
        /officialGemRuntime[\s\S]*?materialIndex:[\s\S]*?groupStart:[\s\S]*?groupCount:[\s\S]*?renderState:/,
    )
    assert.match(loader, /transparent: renderMaterial\.transparent/)
    assert.match(loader, /side: renderMaterial\.side/)
})

test('serialized surface state is applied per slot instead of leaking mesh alpha inference', () => {
    assert.match(loader, /function applyOfficialSurfaceRenderState\(/)
    assert.match(loader, /const slotProfile = slotProfiles\[index\] \?\? slotProfiles\[0\]/)
    assert.match(loader, /applyOfficialSurfaceRenderState\(slotMaterial, slotProfile\)/)
    assert.match(loader, /material\.transparent = surface\.transparency \|\| usesBlending/)
    assert.match(
        loader,
        /material\.depthWrite = compiledPassState\?\.depthWrite \?\? surface\.zWrite/,
    )
    assert.match(
        loader,
        /material\.side = profile\.gem\.enabled[\s\S]*?THREE\.FrontSide/,
    )
    assert.doesNotMatch(loader, /profile\.gem\.enabled[\s\S]{0,160}?THREE\.DoubleSide/)
    assert.doesNotMatch(gemShader, /gl_FrontFacing/)
    assert.match(loader, /material\.blendSrc = getOfficialBlendFactor/)
    assert.match(loader, /material\.blendDst = getOfficialBlendFactor/)
})
