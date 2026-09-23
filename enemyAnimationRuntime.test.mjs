import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
const base=process.env.S6_TEST_ROOT ?? process.cwd()
const loader = fs.readFileSync(base+'/src/viewer/enemies/loader.ts','utf8')
const panel = fs.readFileSync(base+'/src/viewer/enemyPanel.ts','utf8')
test('enemy defaults choose semantic action', () => {
  assert.ok(loader.includes('options.idle ?? options.walk ?? options.run ?? options.jump'))
  assert.ok(loader.includes('this.playDefaultAnimation()'))
})
test('enemy transitions crossfade and clamp speed', () => {
  assert.ok(loader.includes('fadeOut(Math.max(0, transitionSeconds))'))
  assert.ok(loader.includes('fadeIn(Math.max(0, transitionSeconds))'))
  assert.ok(loader.includes('Math.max(0.05, Math.min(4, speed))'))
})
test('enemy panel exposes a chooser, one toggle and an actual timeline', () => {
  assert.ok(panel.includes('enemy-animation-select'))
  assert.ok(panel.includes('enemy-animation-toggle'))
  assert.ok(panel.includes('enemy-animation-slider'))
  assert.ok(panel.includes('instance.seekAnimation('))
  assert.ok(!panel.includes('animationSpeed'))
})

test('missing animation fails closed', () => {
  assert.ok(panel.includes('Animation is unavailable'))
  assert.ok(panel.includes('!instance.playAnimation(name'))
})
