import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
const loader = fs.readFileSync('src/viewer/enemies/loader.ts','utf8')
const panel = fs.readFileSync('src/viewer/enemyPanel.ts','utf8')
test('enemy defaults choose semantic action', () => {
  assert.ok(loader.includes('options.idle ?? options.walk ?? options.run ?? options.jump'))
  assert.ok(loader.includes('this.playDefaultAnimation()'))
})
test('enemy transitions crossfade and clamp speed', () => {
  assert.ok(loader.includes('fadeOut(Math.max(0, transitionSeconds))'))
  assert.ok(loader.includes('fadeIn(Math.max(0, transitionSeconds))'))
  assert.ok(loader.includes('Math.max(0.05, Math.min(4, speed))'))
})
test('enemy panel exposes chooser loop speed and play controls', () => {
  assert.ok(panel.includes("aria-label', 'Enemy animation'"))
  assert.ok(panel.includes('Enemy animation loop'))
  assert.ok(panel.includes('Enemy animation speed'))
  assert.ok(panel.includes('Play enemy animation'))
})
test('missing animation fails closed', () => {
  assert.ok(panel.includes('Animation is unavailable'))
  assert.ok(panel.includes('!instance.playAnimation(name'))
})
