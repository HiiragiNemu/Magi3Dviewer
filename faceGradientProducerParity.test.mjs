import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const facePath = path.join(root, 'magia-exedra-character-three', 'shaders', 'face.ts')
const officialPath = path.join(
  root,
  'artifacts',
  'research',
  '20260831-official-face-gradient-compiled',
  'main_face_gradient__blob-106.glsl',
)
const faceSource = fs.readFileSync(facePath, 'utf8')
const officialSource = fs.readFileSync(officialPath, 'utf8')

function faceProducer(source) {
  const start = source.indexOf('float rdCombinedFaceLight = mix(')
  const end = source.indexOf('faceColor.rgb = mix(', start)
  assert.notEqual(start, -1, 'FaceGradient producer start must exist')
  assert.notEqual(end, -1, 'FaceGradient Base/Shadow mix must exist')
  return source.slice(start, end)
}

function rotateY([x, y, z], angle) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [c * x + s * z, y, -s * x + c * z]
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function scale(v, s) { return [v[0] * s, v[1] * s, v[2] * s] }
function normalize(v) {
  const length = Math.hypot(...v)
  return v.map(value => value / length)
}
function officialDirection(light, forward, right) {
  const biased = normalize(add(add(light, scale(forward, 0.111)), scale(right, 0.333)))
  return normalize([dot(right, biased), dot(forward, biased), 0]).slice(0, 2)
}

test('compiled face variant does not consume per-material self shadow', () => {
  assert.match(officialSource, /Xhlslcc_UnusedX_ReceiveSelfShadow/)
  assert.doesNotMatch(officialSource, /_RdToonSelfShadowMap/)
  const gradientStart = officialSource.indexOf('u_xlatb42.x = u_xlat16_13.x>=0.899999976;')
  const baseMix = officialSource.indexOf('u_xlat16_7.xyz = vec3(u_xlat16_42)', gradientStart)
  assert.ok(gradientStart >= 0 && baseMix > gradientStart)
  assert.doesNotMatch(officialSource.slice(gradientStart, baseMix), /SelfShadow/)
})

test('Viewer FaceGradient producer preserves official gates without self-shadow multiply', () => {
  const producer = faceProducer(faceSource)
  assert.doesNotMatch(producer, /rdToonSelfShadowVisibility/)
  assert.match(faceSource, /rdGradientFaceLight \*= step\(0\.899999976, rdFaceGradientDepthSignal\);/)
  assert.match(faceSource, /rdGradientFaceLight \*= 1\.0 - step\(1\.4, length\(vFaceUv2\)\);/)
  assert.match(faceSource, /vFaceForwardVS = normalize\(mat3\(viewMatrix\) \* uFaceForwardWS\);/)
  assert.match(faceSource, /vFaceRightVS = normalize\(mat3\(viewMatrix\) \* uFaceRightWS\);/)
})

test('front side and rear view rotations preserve the official head-light direction', () => {
  const light = normalize([-0.35, 0.72, 0.60])
  const forward = normalize([0.023, -0.086, 0.996])
  const right = normalize([-0.991, 0.133, 0.034])
  const expected = officialDirection(light, forward, right)
  for (const yaw of [0, Math.PI / 2, Math.PI]) {
    const actual = officialDirection(rotateY(light, yaw), rotateY(forward, yaw), rotateY(right, yaw))
    assert.ok(Math.abs(actual[0] - expected[0]) < 1e-12)
    assert.ok(Math.abs(actual[1] - expected[1]) < 1e-12)
  }
})
