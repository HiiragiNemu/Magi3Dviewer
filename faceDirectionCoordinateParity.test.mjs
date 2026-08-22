import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const faceProfile = readFileSync(
  new URL('./magia-exedra-character-three/faceProfile.ts', import.meta.url),
  'utf8',
)
const renderProfile = readFileSync(
  new URL('./magia-exedra-character-three/renderProfile.ts', import.meta.url),
  'utf8',
)

test('face and AngelRing consume the same Unity-to-FBX direction conversion', () => {
  assert.match(
    renderProfile,
    /export function unityDirectionToThreeFbx\(axis: ReDriveAxis\)/,
  )
  assert.match(
    renderProfile,
    /const direction = axisToVector\(axis\);\s*direction\.x \*= -1;/,
  )

  const faceReference = faceProfile.match(
    /export function createFaceDirectionReference[\s\S]*?^}/m,
  )?.[0]
  assert.ok(faceReference)
  assert.match(
    faceReference,
    /localForward:\s*unityDirectionToThreeFbx\(profile\.faceForwardAxis\)/,
  )
  assert.match(
    faceReference,
    /localUp:\s*unityDirectionToThreeFbx\(profile\.faceUpAxis\)/,
  )
  assert.match(
    faceReference,
    /localRight:\s*unityDirectionToThreeFbx\(profile\.faceRightAxis\)/,
  )
  assert.doesNotMatch(faceReference, /local(?:Forward|Up|Right):\s*axisToVector/)

  const angelReference = renderProfile.match(
    /export function createAngelRingReference[\s\S]*?^}/m,
  )?.[0]
  assert.ok(angelReference)
  assert.match(
    angelReference,
    /localForward:\s*unityDirectionToThreeFbx\(profile\.faceForwardAxis\)/,
  )
})
