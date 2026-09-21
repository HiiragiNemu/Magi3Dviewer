import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import * as THREE from 'three'

const read = path => readFileSync(path, 'utf8')
const hairSource = read('magia-exedra-character-three/shaders/hair.ts')
const renderProfileSource = read('magia-exedra-character-three/renderProfile.ts')
const textureSource = read('magia-exedra-character-three/texture.ts')
const materialProfiles = JSON.parse(read(
  'magia-exedra-character-three/official-material-profiles.json',
))

function sourceCallable(source, name, bindings = {}) {
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true)
  let declaration
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node))
      && node.name?.getText(ast) === name) declaration = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(declaration, `Missing source callable: ${name}`)
  const text = ts.isVariableDeclaration(declaration)
    ? `const ${name} = ${declaration.initializer.getText(ast)};`
    : declaration.getText(ast).replace(/^export\s+/, '')
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return Function(...Object.keys(bindings), `${js}; return ${name}`)(...Object.values(bindings))
}

test('draw-time AngelRing reference follows final head pose and preserves the existing draw hook', () => {
  const loader = read('magia-exedra-character-three/loader.ts')
  const install = sourceCallable(loader, 'installAngelRingDrawReferenceUpdate')
  assert.match(loader, /installAngelRingDrawReferenceUpdate\(mesh, result\.updateAngelRingReference\)/)
  assert.doesNotMatch(loader, /animationLoops\.push\(result\.updateAngelRingReference\)/)
  const head = new THREE.Bone()
  head.position.set(0, 1, 0)
  const shader = { uniforms: Object.fromEntries(['uAngelRingFacePosition', 'uAngelRingFaceUp', 'uAngelRingFaceForward'].map(key => [key, { value: new THREE.Vector3() }])) }
  const update = sourceCallable(hairSource, 'updateAngelRingReference', {
    reference: { headBone: head, localUp: new THREE.Vector3(0, 1, 0), localForward: new THREE.Vector3(1, 0, 0), headOffset: 0.167 },
    projectedShaders: new Set([shader]),
    headPosition: new THREE.Vector3(), headQuaternion: new THREE.Quaternion(),
    facePosition: new THREE.Vector3(), faceUp: new THREE.Vector3(), faceForward: new THREE.Vector3(),
  })
  let requestedAngle = 0
  let calls = 0
  const args = [{}, {}, { camera: 'first' }, {}, {}, {}]
  const mesh = { onBeforeRender(...actual) {
    assert.equal(this, mesh)
    assert.deepEqual(actual, args)
    head.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), requestedAngle)
    calls++
  } }
  install(mesh, update)
  update() // Earlier animation-time sample is deliberately stale.
  for (const degrees of [30, -20, 0]) {
    requestedAngle = THREE.MathUtils.degToRad(degrees)
    mesh.onBeforeRender(...args)
    const expectedUp = new THREE.Vector3(0, Math.cos(requestedAngle), Math.sin(requestedAngle))
    assert.ok(shader.uniforms.uAngelRingFaceUp.value.distanceTo(expectedUp) < 1e-12)
    const expectedOrigin = new THREE.Vector3(0, 1, 0).addScaledVector(expectedUp, 0.167)
    assert.ok(shader.uniforms.uAngelRingFacePosition.value.distanceTo(expectedOrigin) < 1e-12)
  }
  assert.equal(calls, 3)
  const pose = head.quaternion.clone()
  update()
  assert.ok(head.quaternion.equals(pose), 'Uniform refresh never changes the bone pose')
})

test('UV AngelRing contribution is composed before global tint and opaque output', () => {
  // This fragment extension runs after stylization creates the tint statement.
  // The full material-construction tests separately verify the real hook order.
  const start = hairSource.indexOf('onAfterStylization(shader)')
  assert.ok(start >= 0)
  const end = hairSource.indexOf('onBeforeCompile(shader)', start)
  assert.ok(end > start)
  const uvBranch = hairSource.slice(start, end)
  const ast = ts.createSourceFile('uv.ts', `const extension = {${uvBranch}}`, ts.ScriptTarget.Latest, true)
  assert.equal(ast.parseDiagnostics.length, 0)
  let assignment
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === 'shader.fragmentShader') assignment = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(assignment)
  const shader = { fragmentShader: 'vec3 outgoingLight = base;\noutgoingLight *= uGlobalCharacterTint;\n#include <opaque_fragment>' }
  const js = ts.transpileModule(assignment.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  Function('shader', js)(shader)
  const contribution = shader.fragmentShader.indexOf('outgoingLight +=')
  const tint = shader.fragmentShader.indexOf('outgoingLight *= uGlobalCharacterTint;')
  const output = shader.fragmentShader.indexOf('#include <opaque_fragment>')
  assert.ok(contribution >= 0 && contribution < tint && tint < output, 'Source injection must add UV highlight before tint/output')
  assert.equal((shader.fragmentShader.match(/outgoingLight \*= uGlobalCharacterTint;/g) ?? []).length, 1)
  assert.doesNotMatch(uvBranch, /gl_FragColor\.rgb \+=/)
  const base = [0.2, 0.25, 0.3], highlight = [0.192, 0.1008, 0.0432], tintRgb = [0.5, 0.75, 0.25]
  const native = base.map((v, i) => (v + highlight[i]) * tintRgb[i])
  const old = base.map((v, i) => v * tintRgb[i] + highlight[i])
  const delta = old.map((v, i) => v - native[i])
  for (const [i, expected] of [0.096, 0.0252, 0.0324].entries()) assert.ok(Math.abs(delta[i] - expected) < 1e-12)
})
const officialBlob = read(
  'artifacts/research/20260813-shader-reverse/official-shaders/' +
  'main_hair__blob-98__FOG_LINEAR___MAIN_LIGHT_SHADOWS___' +
  'MAIN_LIGHT_SHADOWS_CASCADE___ADDITIONAL_LIGHT_SHADOWS___' +
  'IS_HAIR___USE_DEPTHTEX_RIM_SHADOW.glsl',
)

const rejectedViewerCompensation =
  /FreeOrbitBasisBlend|angelRingHeadAttachment|ProjectedRectMask|MapLowerBounds|MIN_FACE_UP_VIEW_Z|MAX_FACE_UP_VIEW_Z|HeadAttachment|projectionRadius|bandHalfWidth/

function officialProjectedUv({
  fragmentUv,
  faceUv,
  faceUpVS,
  faceForwardVS,
  inverseDistance,
  aspectFix,
  fovFix,
  orthographic = false,
}) {
  const distanceScale = orthographic ? 0.875 : inverseDistance
  const unitScale = [
    aspectFix[0] * fovFix * distanceScale,
    aspectFix[1] * fovFix * distanceScale,
  ]
  const rectHalf = [unitScale[0] * 10, unitScale[1] * 10]
  const back = faceForwardVS[2] * -0.5 + 0.5
  const shift = [
    Math.sin(faceUpVS[1] * 1.57079637) * back * back * 15 * unitScale[0],
    faceUpVS[2] * -3 * unitScale[1],
  ]
  const rect = [
    (fragmentUv[0] + shift[0] - (faceUv[0] - rectHalf[0])) /
      (rectHalf[0] * 2) - 0.5,
    (fragmentUv[1] + shift[1] - (faceUv[1] - rectHalf[1])) /
      (rectHalf[1] * 2) - 0.5,
  ]
  const rotated = [
    rect[0] * faceUpVS[1] + rect[1] * -faceUpVS[0] + 0.5,
    rect[0] * faceUpVS[0] + rect[1] * faceUpVS[1] + 0.5,
  ]
  const arch = Math.sin(rotated[0] * 3.14159274)
  const lower = rotated[1] - arch * 0.414999992
  const upper = rotated[1] + arch * 0.5
  const zBlend = faceUpVS[2] * 0.5 + 0.5
  return [rotated[0], lower + (upper - lower) * zBlend]
}

test('projected AngelRing is a literal main_hair blob 98 port', () => {
  assert.match(officialBlob, /float\(1\.0\) \/ float\(u_xlat66\)/)
  assert.match(officialBlob, /\? 0\.875 : u_xlat66/)
  assert.match(officialBlob, /u_xlat16_7\.y \* 1\.57079637/)
  assert.match(officialBlob, /u_xlat16_83 = u_xlat16_7\.x \* 3\.14159274/)
  assert.match(officialBlob, /0\.414999992/)
  assert.match(officialBlob, /texture\(_AngelRingMap, u_xlat16_7\.xz/)

  const projectedStart = hairSource.indexOf('projectedShaders.add(shader)')
  assert.ok(projectedStart >= 0)
  const projected = hairSource.slice(projectedStart)
  assert.match(projected, /gl_FragCoord\.xy \/ uAngelRingViewportSize/)
  assert.match(projected, /1\.0 \/ distance\(\s*cameraPosition,\s*uAngelRingFacePosition/)
  assert.match(projected, /0\.875/)
  assert.match(projected, /rdAngelUnitScale \* 10\.0/)
  assert.match(projected, /rdAngelFaceUpVS\.y \* 1\.57079637/)
  assert.match(projected, /rdAngelBackFactor \*\s*rdAngelBackFactor \*\s*15\.0/)
  assert.match(projected, /rdAngelFaceUpVS\.z \* -3\.0/)
  assert.match(projected, /rdAngelRotated\.x \* 3\.14159274/)
  assert.match(projected, /rdAngelArch \* 0\.414999992/)
  assert.match(projected, /texture2D\(\s*tAngelRingMap,\s*rdAngelMapUv\s*\)\.r/)
  assert.doesNotMatch(hairSource, rejectedViewerCompensation)
  assert.match(hairSource, /viewerCompensation: false/)
  assert.match(hairSource, /outsideRangeSampling: 'serialized-sampler'/)
  assert.match(hairSource, /official-angel-ring-main-hair-blob98-v1/)
  assert.doesNotMatch(hairSource, /100102|108301|101901|100107|100805/)
})

test('official common sampler remains ClampToEdge with no Viewer bounds mask', () => {
  const begin = textureSource.indexOf('export function ApplyOfficialCommonAngelRingSampling')
  const end = textureSource.indexOf('\n}', begin) + 2
  const commonSampler = textureSource.slice(begin, end)
  assert.match(commonSampler, /THREE\.ClampToEdgeWrapping[\s\S]*THREE\.ClampToEdgeWrapping/)
  assert.doesNotMatch(hairSource, /step\(\s*vec2\(0\.0\),\s*rdAngelMapUv|rdAngelProjectedRectMask/)

  const farHairUv = officialProjectedUv({
    fragmentUv: [0, 0],
    faceUv: [0.5, 0.5],
    faceUpVS: [0, 1, 0],
    faceForwardVS: [0, 0, 0],
    inverseDistance: 1 / 3,
    aspectFix: [0.5625, 1],
    fovFix: 1 / 40,
  })
  assert.ok(
    farHairUv.some(value => value < 0 || value > 1),
    `expected official projected UV outside [0,1], got ${farHairUv}`,
  )
  assert.equal(
    hairSource.includes('rdAngelProjectedRectMask'),
    false,
    'official ClampToEdge sampling is preserved even outside [0,1]',
  )
})

test('all official controller profiles provide serialized head origin fields', () => {
  const rows = [...renderProfileSource.matchAll(/\[\d{6}, \{ characterId:/g)]
  const offsets = [...renderProfileSource.matchAll(/headOffset: [0-9]/g)]
  assert.equal(rows.length, 95)
  assert.equal(offsets.length, rows.length)
  assert.match(
    renderProfileSource,
    /if \(!profile\.angelRingEnabled \|\| profile\.headOffset == undefined\) return undefined/,
  )
  const createStart = renderProfileSource.indexOf('export function createAngelRingReference')
  const createEnd = renderProfileSource.indexOf('\n}', createStart) + 2
  const createReference = renderProfileSource.slice(createStart, createEnd)
  assert.match(createReference, /headOffset: profile\.headOffset/)
  assert.doesNotMatch(createReference, /Box3|MathUtils|estimated|skin|attachment/)
  assert.doesNotMatch(renderProfileSource, /installAngelRingHeadAttachment|angelRingHeadAttachment/)
})

test('101901, 100107, 100805 and neighbors keep serialized branch routing', () => {
  assert.match(
    renderProfileSource,
    /\[100107, \{ characterId: 100107, styleId: 100101,[^\n]*headOffset: 0\.167,[^\n]*hairUvAngelRing: false/,
  )
  assert.match(
    renderProfileSource,
    /\[100805, \{ characterId: 100805, styleId: 100802,[^\n]*headOffset: 0\.2,[^\n]*hairUvAngelRing: false/,
  )
  assert.match(
    renderProfileSource,
    /\[101901, \{ characterId: 101901, styleId: 101901,[^\n]*headOffset: 0\.18,[^\n]*hairUvAngelRing: false/,
  )
  assert.match(
    renderProfileSource,
    /\[108301, \{ characterId: 108301, styleId: 108301,[^\n]*headOffset: 0\.201,[^\n]*hairUvAngelRing: true/,
  )

  const cases = {
    mt_chara_101901_hair: [true, false, 'common'],
    mt_chara_101901_hair_out: [true, false, 'common'],
    mt_chara_100805_hair: [true, false, 'common'],
    mt_chara_100805_hair_out: [true, false, 'common'],
    mt_chara_100805_hair_alpha: [false, false, 'none'],
    mt_chara_100102_hair: [true, false, 'common'],
    mt_chara_100102_hair_out: [true, false, 'common'],
    mt_chara_100101_hair: [true, false, 'common'],
    mt_chara_100101_hair_out: [true, false, 'common'],
    mt_chara_108301_hair: [true, true, 'character'],
    mt_chara_108301_hair_out: [true, true, 'character'],
  }
  for (const [name, expected] of Object.entries(cases)) {
    const profile = materialProfiles.materials[name]?.angelRing
    assert.ok(profile, name)
    assert.deepEqual(
      [profile.enabled, profile.uvMode, profile.map],
      expected,
      name,
    )
  }
})
