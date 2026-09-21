import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const structure = JSON.parse(readFileSync(
  'artifacts/research/20260813-shader-reverse/official-shaders/redrive-toon-structure.json',
  'utf8',
))
const officialGem = readFileSync(
  'artifacts/research/20260813-shader-reverse/official-shaders/main_gem__blob-95__FOG_LINEAR___MAIN_LIGHT_SHADOWS___MAIN_LIGHT_SHADOWS_CASCADE___ADDITIONAL_LIGHT_SHADOWS___USE_RIM_LIGHT___ISGEM.glsl',
  'utf8',
)
const viewerGem = readFileSync(
  'magia-exedra-character-three/shaders/gem.ts',
  'utf8',
)
const loader = readFileSync(
  'magia-exedra-character-three/loader.ts',
  'utf8',
)

function collectUniversalForwardStates(value, result = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectUniversalForwardStates(entry, result)
  } else if (value && typeof value === 'object') {
    if (
      value.m_Name === 'ReDriveToon' &&
      String(value.m_Tags).includes("('LIGHTMODE', 'UniversalForward')")
    ) result.push(value)
    for (const entry of Object.values(value)) {
      collectUniversalForwardStates(entry, result)
    }
  }
  return result
}

test('official ReDriveToon UniversalForward passes serialize Cull Back', () => {
  const states = collectUniversalForwardStates(structure)
  assert.ok(states.length >= 2)
  assert.deepEqual([...new Set(states.map(state => state.culling))], [2])
})

test('Gem consumer keeps official Cull Back and has no free-orbit shell compensation', () => {
  assert.match(loader, /material\.side = profile\.gem\.enabled[\s\S]*?THREE\.FrontSide/)
  assert.doesNotMatch(loader, /profile\.gem\.enabled[\s\S]{0,160}?THREE\.DoubleSide/)
  assert.doesNotMatch(officialGem, /gl_FrontFacing/)
  assert.doesNotMatch(viewerGem, /gl_FrontFacing/)
  assert.match(viewerGem, /officialForwardCull: 'back'/)
  assert.match(viewerGem, /viewerBackfaceCompensation: false/)
})
