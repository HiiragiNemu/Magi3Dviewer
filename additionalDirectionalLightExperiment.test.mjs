import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(
  'magia-exedra-character-three/shaders/general.ts',
  'utf8',
)
const faceSource = fs.readFileSync(
  'magia-exedra-character-three/shaders/face.ts',
  'utf8',
)

test('explicit additional-directional fixture is bounded and disabled', () => {
  assert.match(
    source,
    /export const AdditionalDirectionalLightExperiment = \{\s+enabled: false,[\s\S]*directionWorld: new THREE\.Vector3\([\s\S]*radiance: new THREE\.Color\([\s\S]*influenceByLuminance: 1\.0,/,
  )
  assert.match(
    source,
    /uRdAdditionalDirectionalLightEnabled =\s+AdditionalDirectionalLightExperiment\.enabled \? 1 : 0/,
  )
  assert.match(source, /uniform vec3 uRdAdditionalDirectionalLightDirectionWorld;/)
  assert.match(source, /uniform vec3 uRdAdditionalDirectionalLightColor;/)
  assert.match(source, /uniform float uRdAdditionalLightInfluenceByLuminance;/)
  assert.doesNotMatch(source, /uRdAdditionalDirectionalLightStrength/)
})

test('generic formula matches the compiled official directional slice', () => {
  assert.doesNotMatch(source, /directionalLights\[1\]/)
  assert.match(
    source,
    /step\(0\.0, dot\(normal, rdAdditionalLightDirectionVS\)\)/,
  )
  assert.match(source, /0\.200000003/)
  assert.match(
    source,
    /vec3\(0\.298911989, 0\.586610973, 0\.114478\)/,
  )
  assert.match(
    source,
    /mix\(\s+1\.0,\s+rdAdditionalLightBaseLuminance,\s+saturate\(uRdAdditionalLightInfluenceByLuminance\)/,
  )

  const sceneLightStart = source.indexOf('vec3 rdToonSceneLightColor')
  const sceneLightEnd = source.indexOf('outgoingLight =', sceneLightStart)
  assert.ok(sceneLightStart >= 0 && sceneLightEnd > sceneLightStart)
  assert.doesNotMatch(
    source.slice(sceneLightStart, sceneLightEnd),
    /Additional/,
  )

  const stylizationCall = source.lastIndexOf(
    'injectToonStylization(shader, uniforms)',
  )
  const additiveInjection = source.indexOf(
    '// Generic directional slice',
    stylizationCall,
  )
  assert.ok(additiveInjection > stylizationCall)
  assert.match(
    source.slice(additiveInjection),
    /outgoingLight \+=\s+uRdAdditionalDirectionalLightColor/,
  )
})

test('first phase stays generic and leaves FaceGradient isolated', () => {
  const prototype = source.match(
    /\/\/ Generic directional slice[\s\S]*?#include <opaque_fragment>/,
  )?.[0]
  assert.ok(prototype, 'missing bounded additional-light prototype')
  assert.doesNotMatch(prototype, /pointLights|spotLights|shadowMap|texture2D/)
  assert.match(prototype, /FaceGradient uses a per-light SDF selector/)
  assert.doesNotMatch(faceSource, /AdditionalDirectionalLight/)
  assert.match(faceSource, /uUseFaceGradient/)
})

test('CPU oracle preserves hard hemisphere and luminance behavior', () => {
  const contribution = ({ ndotl, baseLuma, influence, color }) => {
    const selector = ndotl >= 0 ? 1 : 0
    const t = Math.min(1, Math.max(0, influence))
    const luminanceFactor = 1 * (1 - t) + baseLuma * t
    return color.map(channel => (
      channel * selector * 0.200000003 * luminanceFactor
    ))
  }
  const close = (actual, expected) => {
    assert.equal(actual.length, expected.length)
    actual.forEach((value, index) => {
      assert.ok(Math.abs(value - expected[index]) <= 1e-9)
    })
  }

  close(
    contribution({ ndotl: -0.05, baseLuma: 0.2, influence: 1, color: [1, 2, 3] }),
    [0, 0, 0],
  )
  close(
    contribution({ ndotl: 0, baseLuma: 0.2, influence: 0, color: [1, 2, 3] }),
    [0.200000003, 0.400000006, 0.600000009],
  )
  close(
    contribution({ ndotl: 0.05, baseLuma: 0.2, influence: 1, color: [1, 2, 3] }),
    [0.0400000006, 0.0800000012, 0.1200000018],
  )
  close(
    contribution({ ndotl: 0.05, baseLuma: 0.8, influence: 0.5, color: [1, 2, 3] }),
    [0.1800000027, 0.3600000054, 0.5400000081],
  )
})
