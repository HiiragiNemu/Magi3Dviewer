import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [depthRim, cameraDepth, shadow, hair, gem, scene] = await Promise.all([
    readFile('magia-exedra-character-three/shaders/depthRim.ts', 'utf8'),
    readFile('magia-exedra-character-three/scene/cameraDepth.ts', 'utf8'),
    readFile('magia-exedra-character-three/shaders/shadow.ts', 'utf8'),
    readFile('magia-exedra-character-three/shaders/hair.ts', 'utf8'),
    readFile('magia-exedra-character-three/shaders/gem.ts', 'utf8'),
    readFile('magia-exedra-character-three/scene/index.ts', 'utf8'),
])

const clamp01 = value => Math.max(0, Math.min(1, value))

function linearEye(rawDepth, near, far, orthographic) {
    return orthographic
        ? rawDepth * (far - near) + near
        : (near * far) / (far - rawDepth * (far - near))
}

function rimReference({
    centerZ,
    sampledZ,
    rimThreshold = 0.02,
    shadowThreshold = 0.03,
    ndotV = 0,
    isHair = false,
}) {
    const depth = clamp01(10 * (sampledZ - (centerZ + rimThreshold)))
    const shadow = clamp01(
        50 * (sampledZ - (centerZ - shadowThreshold)),
    )
    const edge = 1 - Number(isHair) * ndotV
    const t = clamp01((edge * depth - 0.1) / 0.025)
    return { depth, shadow, rim: t * t * (3 - 2 * t) }
}

function gemDepthSelector({
    enabled,
    useDepthDiff,
    transparency,
    centerZ,
    sampledZ,
    threshold,
}) {
    if (!(enabled && useDepthDiff && transparency)) return 0
    const g = clamp01(5 * (sampledZ - (centerZ - 0.01)))
    return g >= 1 - threshold ? 0 : 1
}

test('prototype is default-off and owns an independent camera depth prepass', () => {
    assert.match(depthRim, /enabled:\s*false/)
    assert.match(cameraDepth, /new THREE\.DepthTexture/)
    assert.match(cameraDepth, /object\.customDepthMaterial \?\?/)
    assert.match(cameraDepth, /profile\?\.gem\.enabled && profile\.gem\.transparency/)
    assert.match(scene, /this\.cameraDepth\.render\(\)/)
    assert.doesNotMatch(cameraDepth, /backgroundScene\.traverse/)
})

test('alpha-cutout depth material owns its first-draw UV macro contract', () => {
    const mapAssignment = shadow.indexOf('material.map = alphaTex')
    const compileHook = shadow.indexOf('material.onBeforeCompile = shader =>')
    assert.ok(mapAssignment > 0 && mapAssignment < compileHook)
    assert.match(shadow, /texture2D\(tAlpha, vMapUv\)\.a < uAlphaTest/)
})

test('static GLSL keeps recovered coordinates, constants and debug channels', () => {
    for (const token of [
        'vRdDepthRimVertexColorG * uRdDepthTexWidth',
        '0.660000026',
        '0.850000024',
        'texelFetch(uRdCameraDepthTexture, pixel, 0)',
        '10.0 * (rdDepthMainZ - rdDepthRimReference)',
        '50.0 * (',
        'vec2(0.1)',
        'vec2(0.125)',
        'rdDepthShadowSignal,',
        'rdDepthRim.x,',
        'rdDepthRim.y',
    ]) assert.ok(depthRim.includes(token), `missing ${token}`)
    assert.match(depthRim, /uRdDepthRimVertexColorGAvailable > 0\.5/)
})

test('CPU depth linearization matches perspective and orthographic endpoints', () => {
    const near = 0.1
    const far = 100
    assert.equal(linearEye(0, near, far, false), near)
    assert.ok(Math.abs(linearEye(1, near, far, false) - far) < 1e-10)
    assert.equal(linearEye(0, near, far, true), near)
    assert.equal(linearEye(1, near, far, true), far)
    const rawAtThree = (far - near * far / 3) / (far - near)
    assert.ok(Math.abs(linearEye(rawAtThree, near, far, false) - 3) < 1e-10)
})

test('Body and Gem share depth signal while Hair alone applies 1-NdotV gate', () => {
    const common = { centerZ: 3, sampledZ: 3.14, ndotV: 0.95 }
    const body = rimReference(common)
    const gemClass = rimReference({ ...common, isHair: false })
    const hairClass = rimReference({ ...common, isHair: true })
    assert.deepEqual(gemClass, body)
    assert.equal(body.rim, 1)
    assert.equal(hairClass.rim, 0)
    assert.match(depthRim, /1\.0 - uRdDepthRimIsHair \* rdDepthNdotV/)
    assert.match(depthRim, /profile\?\.gem\.enabled \? 1 : 0/)
    assert.match(
        hair,
        /uRdDepthRimExperimentEnabled < 0\.5 \|\|\s*uRdDepthRimVertexColorGAvailable < 0\.5/,
    )
})

test('GemDepthDiff requires both official predicates and runs before MatCap', () => {
    const sample = {
        enabled: true,
        useDepthDiff: true,
        transparency: true,
        centerZ: 2,
        sampledZ: 1.99,
        threshold: 0.5,
    }
    assert.equal(gemDepthSelector(sample), 1)
    assert.equal(gemDepthSelector({ ...sample, transparency: false }), 0)
    assert.equal(gemDepthSelector({ ...sample, useDepthDiff: false }), 0)
    assert.equal(gemDepthSelector({ ...sample, enabled: false }), 0)
    const selectorIndex = gem.indexOf('float rdGemDepthBranchEnabled')
    const matCapIndex = gem.indexOf('if (uMaterialMatCapEnabled > 0.5)', selectorIndex)
    assert.ok(selectorIndex > 0 && selectorIndex < matCapIndex)
    assert.match(gem, /5\.0 \* \(/)
    assert.match(gem, /1\.0 - uGemDepthDiffThreshold/)
    assert.match(gem, /step\(0\.0000001, abs\(uGemUseDepthDiff\)\)/)
    assert.match(gem, /step\(0\.0000001, abs\(uGemTransparency\)\)/)
    assert.doesNotMatch(gem, /uGemUseDepthDiff \* uGemTransparency/)
    assert.doesNotMatch(gem, /rdGemTint \* rdGemDepthSelector/)
})
