import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { yieldLoadingFrame, registerLoadingResourceName, loadingFileName, LoadingTask } from './magia-exedra-character-three/loadingProgress.ts'
import { createLoadingProgressPanel } from './src/viewer/loadingProgressPanel.ts'

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

test('hashed download URLs retain exact original filenames without generic replacement labels', () => {
  const files = {
    'characters/100107/VisualRoot.fbx.gz': '/assets/VisualRoot.fbx-Dsv0y9Ia.fbxdata',
    'characters/100107/home-expressions.json': '/assets/home-expressions-BKRhUicP.json',
    'characters/100107/chara_100101_eyehighlight_ctrl.png': '/assets/chara_100101_eyehighlight_ctrl-DOgLr1cJ.png',
  }
  const original = JSON.stringify(files), task = new LoadingTask('角色加载')
  for (const [path, url] of Object.entries(files)) {
    registerLoadingResourceName(url, path)
    task.phase('decoding', url)
    assert.equal(loadingFileName(url), path.split('/').pop())
    assert.equal(task.snapshot().currentName, path.split('/').pop())
    assert.equal(task.snapshot().currentUrl, url, 'actual download URL must be unchanged')
  }
  task.complete()
  assert.equal(JSON.stringify(files), original)
  const loader = readFileSync(new URL('./magia-exedra-character-three/loader.ts', import.meta.url), 'utf8')
  assert.ok(loader.indexOf('registerLoadingResourceName(url, sourcePath)') < loader.indexOf('const nativeInput = await'))
  const panel = readFileSync(new URL('./src/viewer/loadingProgressPanel.ts', import.meta.url), 'utf8')
  assert.match(panel, /current.dataset.i18nIgnore = 'true'/)
  assert.match(panel, /current.title = state.currentName/)
})

test('loading panel displays the original filename verbatim in its visible text', () => {
  const elements = new Map()
  const doc = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { dataset: {}, style: {}, textContent: '', setAttribute() {}, removeAttribute() {} })
    return elements.get(id)
  } }
  registerLoadingResourceName('/assets/VisualRoot.fbx-Dsv0y9Ia.fbxdata', 'characters/100107/VisualRoot.fbx.gz')
  const panel = createLoadingProgressPanel(doc), task = new LoadingTask('角色加载')
  try {
    task.phase('decoding', '/assets/VisualRoot.fbx-Dsv0y9Ia.fbxdata')
    assert.equal(elements.get('load-progress-file').textContent, 'VisualRoot.fbx.gz')
    assert.equal(elements.get('load-progress-file').dataset.i18nIgnore, 'true')
    assert.equal(elements.get('load-progress-count').textContent, '0 / 0 个已发现文件')
  } finally { panel.dispose(); task.cancel() }
})

test('hashed assets are reusable without making production HTML stale', () => {
  const headers = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8')
  assert.match(headers, /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/)
  assert.match(headers, /\/index\.html\s+Cache-Control: no-store, max-age=0/)
})
