import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { magiusStartupGuardPlugin } from './viteStartupGuard.mjs'
const source = fs.readFileSync(new URL('./src/startupGuard.js', import.meta.url), 'utf8')
function fixture(t, { locale, denied = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><head><meta name="magius-build-revision" content="test-build"></head><body><div id="stat"><span class="demo">Loading</span></div></body></html>', { url: 'https://magius3dviewer.pages.dev/?private=hidden#100107', runScripts: 'outside-only' })
  const w = dom.window; let now = 0, tick, stopped = false
  w.Date.now = () => now
  w.setInterval = callback => { tick = callback; return 1 }
  w.clearInterval = () => { stopped = true }
  w.localStorage.setItem('saved-pose', 'must-survive')
  if (locale) w.localStorage.setItem('magius3dviewer.locale', locale)
  if (denied) Object.defineProperty(w, 'localStorage', { get() { throw new w.DOMException('Storage disabled', 'SecurityError') } })
  w.eval(source)
  t.after(() => dom.window.close())
  return { w, api: w.__magiusStartup, tick(ms) { now = ms; tick() }, get stopped() { return stopped }, panel: () => w.document.getElementById('magius-startup-diagnostic') }
}
test('guard is inline and independent of the application graph in the main HTML only', () => {
  const p = magiusStartupGuardPlugin()
  const tags = p.transformIndexHtml.handler('', { filename: 'D:\\project\\index.html' })
  assert.equal(tags.length, 1); assert.equal(tags[0].tag, 'script'); assert.equal(tags[0].injectTo, 'head-prepend')
  assert.equal(tags[0].attrs.type, undefined); assert.ok(tags[0].children.includes('__magiusStartup'))
  assert.deepEqual(p.transformIndexHtml.handler('', { filename: '/project/resource-preview.html' }), [])
})
test('normal startup has no diagnostic overlay and readiness removes the watchdog', t => {
  const f = fixture(t); f.tick(1000); assert.equal(f.panel(), null); assert.match(f.w.document.querySelector('#stat .demo').textContent, /正在加载/)
  f.w.dispatchEvent(new f.w.Event('magius:bootstrap-ready')); f.tick(100000)
  assert.equal(f.panel(), null); assert.equal(f.api.snapshot().status, 'ready'); assert.equal(f.stopped, true)
})
test('a slow module load is pending, not falsely reported as an Android failure', t => {
  const f = fixture(t); f.tick(21000); assert.ok(f.panel()); assert.equal(f.api.snapshot().status, 'pending-longer-than-expected')
  assert.match(f.panel().querySelector('p').textContent, /尚不能判定/)
  f.w.dispatchEvent(new f.w.Event('magius:bootstrap-ready')); assert.equal(f.panel(), null)
})
test('initial WebGL exception is shown even when main.ts never executes', t => {
  const f = fixture(t)
  f.w.dispatchEvent(new f.w.ErrorEvent('error', { message: 'Error creating WebGL context.', filename: 'https://magius3dviewer.pages.dev/assets/viewer.js', lineno: 1 }))
  assert.ok(f.panel()); assert.equal(f.api.snapshot().stage, 'module-loading')
  assert.equal(f.api.snapshot().errors[0].message, 'Error creating WebGL context.')
})
test('script and modulepreload download failure are caught before localization exists', t => {
  const f = fixture(t); const s = f.w.document.createElement('script'); s.src = '/assets/main-123.js'; f.w.document.body.append(s)
  s.dispatchEvent(new f.w.Event('error'))
  assert.equal(f.api.snapshot().errors[0].kind, 'resource-load'); assert.match(f.api.snapshot().errors[0].source, /main-123/)
  const link = f.w.document.createElement('link'); link.rel = 'modulepreload'; link.href = '/assets/viewer-456.js'; f.w.document.head.append(link); link.dispatchEvent(new f.w.Event('error'))
  assert.equal(f.api.snapshot().errors.length, 2)
})
test('image failure is not misdiagnosed as module initialization failure', t => {
  const f = fixture(t), image = f.w.document.createElement('img'); image.src = '/irrelevant.png'; f.w.document.body.append(image); image.dispatchEvent(new f.w.Event('error'))
  assert.equal(f.panel(), null); assert.equal(f.api.snapshot().errors.length, 0)
})
test('unhandled startup rejection retains its actual message', t => {
  const f = fixture(t), e = new f.w.Event('unhandledrejection'); e.reason = new Error('Initialization rejected'); f.w.dispatchEvent(e)
  assert.equal(f.api.snapshot().errors[0].message, 'Initialization rejected')
})
test('source URLs and current page do not disclose query or fragment data', t => {
  const f = fixture(t); f.api.fail('javascript', 'failed https://example.test/code.js?token=hidden#private', 'https://example.test/main.js?key=hidden#private', 2)
  const report = JSON.stringify(f.api.snapshot()); assert.doesNotMatch(report, /token=|key=|private=|#100107|#private/)
  assert.equal(f.api.snapshot().revision, 'test-build'); assert.ok(f.api.snapshot().userAgent)
})
test('the reporter does not touch saved poses, preferences, or auto-reload', t => {
  const f = fixture(t); f.api.fail('test', 'Failure', '', 0); f.tick(120000)
  assert.equal(f.w.localStorage.getItem('saved-pose'), 'must-survive')
  assert.equal(f.api.snapshot().status, 'failed')
  assert.equal(f.panel().querySelector('button').textContent, '重新尝试启动')
  assert.doesNotMatch(source, /localStorage\.(?:clear|removeItem)|sessionStorage\.(?:clear|removeItem)|sendBeacon|XMLHttpRequest|\bfetch\s*\(/)
})
test('denied storage does not disable error reporting', t => {
  const f = fixture(t, { denied: true }); f.api.fail('test', 'Error', '', 0); assert.ok(f.panel())
})
for (const [locale, label] of [['en', 'The viewer could not start'], ['ja-JP', 'ビューアーを起動できませんでした']]) test('startup UI honors ' + locale, t => {
  const f = fixture(t, { locale }); f.api.fail('test', 'Error', '', 0); assert.equal(f.panel().querySelector('strong').textContent, label)
})
test('diagnostics remain bounded and do not capture later in-session errors', t => {
  const f = fixture(t); for (let i = 0; i < 20; i++) f.api.fail('test', String(i), '', 0)
  assert.equal(f.api.snapshot().errors.length, 6)
  f.w.dispatchEvent(new f.w.Event('magius:bootstrap-ready')); f.api.fail('test', 'later', '', 0)
  assert.equal(f.api.snapshot().errors.length, 6); assert.equal(f.panel(), null)
})
