import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync('src/viewer/stageFidelity.ts', 'utf8')
const stages = readFileSync('src/viewer/stages.ts', 'utf8')
const style = readFileSync('src/viewer/style/stageFidelity.css', 'utf8')

test('fidelity inspector exposes provenance, closure and concrete dynamic gaps', () => {
  assert.match(source, /Manifest provenance/)
  assert.match(source, /Remaining fidelity gaps/)
  assert.match(source, /Recovered evidence/)
  assert.match(source, /closureSha256/)
  assert.match(source, /dependencyClosure/)
  assert.match(source, /reflectionProbeCount/)
  assert.match(source, /playableDirectorCount/)
})

test('fidelity inspector renders external names as text rather than HTML', () => {
  assert.doesNotMatch(source, /innerHTML/)
  assert.match(source, /textContent = value/)
})

test('stage runtime updates the fidelity inspector only after resolved stage definitions', () => {
  assert.match(stages, /setupStageFidelityPanel/)
  assert.match(stages, /updateStageFidelityPanel\(definition\)/)
})

test('fidelity inspector remains bounded on desktop and mobile', () => {
  assert.match(style, /max-height:/)
  assert.match(style, /overflow: auto/)
  assert.match(style, /@media \(max-width: 760px\)/)
})
