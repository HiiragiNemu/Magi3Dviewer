import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { yieldLoadingFrame } from './magia-exedra-character-three/loadingProgress.ts'
import { loadingResourceLabel } from './src/viewer/loadingProgressPanel.ts'

test('resource decoding continues when an embedded tab stops animation frames', async () => {
  const oldDocument = globalThis.document, oldRAF = globalThis.requestAnimationFrame
  let paintRequests = 0, timeout
  globalThis.document = { hidden: false }
  globalThis.requestAnimationFrame = () => { paintRequests++; return 1 }
  try {
    const result = await Promise.race([
      yieldLoadingFrame().then(() => 'continued'),
      new Promise(resolve => { timeout = setTimeout(() => resolve('stalled'), 250) }),
    ])
    assert.equal(result, 'continued')
    assert.equal(paintRequests, 0, 'resource work must not wait for renderer paint callbacks')
  } finally {
    clearTimeout(timeout)
    globalThis.document = oldDocument; globalThis.requestAnimationFrame = oldRAF
  }
})

test('abort immediately interrupts the loading UI yield', async () => {
  const oldDocument = globalThis.document
  globalThis.document = { hidden: false }
  try {
    const controller = new AbortController(), pending = yieldLoadingFrame(controller.signal)
    controller.abort()
    await assert.rejects(pending, error => error.name === 'AbortError')
  } finally { globalThis.document = oldDocument }
})

test('compiled resource identities have useful labels, not translated hash fragments', () => {
  assert.equal(loadingResourceLabel('VisualRoot.fbx-Dsv0y9Ia.fbxdata'), '角色模型与骨骼')
  assert.equal(loadingResourceLabel('home-expressions-BKRhUicP.json'), '角色表情数据')
  assert.equal(loadingResourceLabel('chara_100101_eyehighlight_ctrl-DOgLr1cJ.png'), '眼部高光纹理')
  const panel = readFileSync(new URL('./src/viewer/loadingProgressPanel.ts', import.meta.url), 'utf8')
  assert.match(panel, /current.dataset.i18nIgnore = 'true'/)
  assert.match(panel, /current.title = state.currentName/)
})

test('hashed assets are reusable without making production HTML stale', () => {
  const headers = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8')
  assert.match(headers, /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/)
  assert.match(headers, /\/index\.html\s+Cache-Control: no-store, max-age=0/)
})
