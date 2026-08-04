import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(
  new URL('./src/viewer/stageAlphaCutoutFixes.ts', import.meta.url),
  'utf8',
)
const mainSource = fs.readFileSync(
  new URL('./src/main.ts', import.meta.url),
  'utf8',
)

test('fixes only the two proven opaque alpha-card materials', () => {
  assert.match(source, /battle-600-00-01-001/)
  assert.match(source, /mt_bg3d600A_01_01_propB/)
  assert.match(source, /battle-600-00-01-002/)
  assert.match(source, /mt_bg3d600A_01_02_propA/)
  assert.doesNotMatch(
    source,
    /baseMapUrl.*Alpha|map\.name.*Alpha/i,
    'the repair must not infer alpha clipping globally from texture names',
  )
})

test('restores Unity cutout render state without transparent sorting', () => {
  assert.match(source, /material\.alphaTest = alphaTest/)
  assert.match(source, /material\.alphaToCoverage = true/)
  assert.match(source, /material\.transparent = false/)
  assert.match(source, /material\.depthWrite = true/)
  assert.match(source, /material\.needsUpdate = true/)
})

test('runs after asynchronous stage loads complete', () => {
  assert.match(source, /MutationObserver/)
  assert.match(source, /attributeFilter: \['disabled'\]/)
  assert.match(source, /if \(scheduled \|\| selector\.disabled\) return/)
  assert.match(mainSource, /installOfficialStageAlphaCutoutFixes\(\)/)
  assert.ok(
    mainSource.indexOf('installOfficialStageAlphaCutoutFixes()')
      < mainSource.indexOf('setupStageSelector()'),
    'the observer must be installed before the first stage load starts',
  )
})
