import assert from 'node:assert/strict'
import test from 'node:test'

import {
  unityLightColorToLinear,
  unityShL2ToThree,
  unityWorldToViewerVector,
} from './src/viewer/unityLighting.ts'

const close = (actual, expected, epsilon = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} differs from ${expected}`,
  )
}

test('Unity serialized Light colors reproduce captured linear GPU radiance', () => {
  const main = unityLightColorToLinear([1, 0.9764705896377563, 0.9372549057006836])
  close(main[0], 1)
  close(main[1], 0.9473066329956055)
  close(main[2], 0.8631572723388672)

  const local = unityLightColorToLinear([1, 0.949999988079071, 0.9809523820877075])
  close(local[0] * 500, 500)
  close(local[1] * 500, 445.0027770996094, 2e-4)
  close(local[2] * 500, 478.6076354980469, 2e-4)
})

test('Unity world vectors use the AssetStudio FBX X reflection', () => {
  assert.deepEqual(unityWorldToViewerVector([3, -2, 5]), [-3, -2, 5])
})

test('converted SH evaluates the same Unity polynomial in Viewer coordinates', () => {
  const values = Array.from({ length: 27 }, (_, index) => (index + 1) * 0.001)
  const coefficients = unityShL2ToThree(values)
  const viewerNormal = [0.36, -0.48, 0.8]
  const unityNormal = [-viewerNormal[0], viewerNormal[1], viewerNormal[2]]

  const evaluateUnity = (offset) => {
    const c = Array.from({ length: 9 }, (_, index) => values[offset + index])
    const [x, y, z] = unityNormal
    return c[0] + c[1] * y + c[2] * z + c[3] * x
      + c[4] * x * y + c[5] * y * z
      + c[6] * (3 * z * z - 1) + c[7] * x * z
      + c[8] * (x * x - y * y)
  }
  const evaluateThreeFinalDiffuse = (channel) => {
    const [x, y, z] = viewerNormal
    const c = coefficients.map(value => value[channel])
    const irradiance = c[0] * 0.886227
      + c[1] * (2 * 0.511664) * y
      + c[2] * (2 * 0.511664) * z
      + c[3] * (2 * 0.511664) * x
      + c[4] * (2 * 0.429043) * x * y
      + c[5] * (2 * 0.429043) * y * z
      + c[6] * 0.247708 * (3 * z * z - 1)
      + c[7] * (2 * 0.429043) * x * z
      + c[8] * 0.429043 * (x * x - y * y)
    return irradiance / Math.PI
  }

  close(evaluateThreeFinalDiffuse(0), evaluateUnity(0), 2e-8)
  close(evaluateThreeFinalDiffuse(1), evaluateUnity(9), 2e-8)
  close(evaluateThreeFinalDiffuse(2), evaluateUnity(18), 2e-8)
})

