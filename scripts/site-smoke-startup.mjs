import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const site = new URL(process.env.MAGIUS_SITE_URL || 'http://127.0.0.1:6599/')
assert.ok(['127.0.0.1', 'localhost'].includes(site.hostname) || /^(?:[a-f0-9]+\.)?magius3dviewer\.pages\.dev$/.test(site.hostname))
const output = path.resolve(process.env.MAGIUS_EVIDENCE_DIR || 'artifacts/android-startup/acceptance')
fs.mkdirSync(output, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 120000, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11'] })
const rows = []
const record = row => { rows.push(row); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(rows, null, 2)); console.log(row.test, 'PASS') }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function create() {
  const context = await browser.createBrowserContext(), page = await context.newPage()
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 1 })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  return { context, page, errors }
}
const state = page => page.evaluate(() => ({ diagnostic: window.__magiusStartup?.snapshot(), locale: document.documentElement.lang, actor: window.scene?.characterSelected?.character?.userData.characterId, panel: !!document.getElementById('magius-startup-diagnostic') }))
const ready = page => page.waitForFunction(() => window.__magiusStartup?.snapshot().status === 'ready' && window.scene?.characterSelected?.character, { timeout: 120000, polling: 250 })
try {
  {
    const { context, page, errors } = await create()
    await page.goto(new URL('?diagnostic=pose-editor', site).href, { waitUntil: 'domcontentloaded', timeout: 120000 }); await ready(page)
    const actual = await state(page); assert.equal(actual.panel, false); assert.equal(errors.length, 0)
    if (process.env.MAGIUS_EXPECTED_REVISION) assert.equal(actual.diagnostic.revision, process.env.MAGIUS_EXPECTED_REVISION)
    await page.screenshot({ path: path.join(output, 'normal-start.png') }); record({ test: 'normal-start', actual, errors }); await context.close()
  }
  {
    const { context, page, errors } = await create(); let block = true
    await page.setRequestInterception(true)
    page.on('request', request => block && /\/assets\/viewer-runtime-[^/]+\.js$/.test(new URL(request.url()).pathname) ? request.abort('failed') : request.continue())
    await page.goto(site.href, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForSelector('#magius-startup-diagnostic', { visible: true, timeout: 30000 })
    const failure = await state(page); assert.equal(failure.diagnostic.status, 'failed'); assert.ok(failure.diagnostic.errors.some(e => e.kind === 'resource-load'))
    await page.evaluate(() => localStorage.setItem('magius.startup-test-preserve', 'retained'))
    await page.screenshot({ path: path.join(output, 'script-failure.png') })
    block = false
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }), page.click('#magius-startup-diagnostic button')]); await ready(page)
    assert.equal(await page.evaluate(() => localStorage.getItem('magius.startup-test-preserve')), 'retained')
    const recovered = await state(page); assert.equal(recovered.panel, false); record({ test: 'blocked-script-visible-and-explicit-retry-recovers', failure, recovered, expectedErrors: errors }); await context.close()
  }
  {
    const { context, page, errors } = await create()
    await page.evaluateOnNewDocument(() => {
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/i.test(type) ? null : getContext.call(this, type, ...args) }
    })
    await page.goto(site.href, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForSelector('#magius-startup-diagnostic', { visible: true, timeout: 30000 })
    const failure = await state(page); assert.equal(failure.diagnostic.status, 'failed'); assert.ok(failure.diagnostic.errors.some(e => /WebGL|context/i.test(e.message)))
    await page.screenshot({ path: path.join(output, 'webgl-failure.png') }); record({ test: 'webgl-initialization-error-is-visible-before-main', failure, expectedErrors: errors }); await context.close()
  }
  {
    const { context, page, errors } = await create(); let held, release
    const wait = new Promise(resolve => { release = resolve })
    await page.setRequestInterception(true)
    page.on('request', request => {
      if (/\/assets\/viewer-runtime-[^/]+\.js$/.test(new URL(request.url()).pathname) && !held) { held = request; void wait.then(() => request.continue()); return }
      void request.continue()
    })
    const navigation = page.goto(site.href, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForSelector('#magius-startup-diagnostic', { visible: true, timeout: 35000 })
    const pending = await state(page); assert.equal(pending.diagnostic.status, 'pending-longer-than-expected'); assert.equal(pending.diagnostic.errors.length, 0)
    await page.screenshot({ path: path.join(output, 'slow-script-pending.png') }); release(); await navigation; await ready(page)
    assert.equal(errors.length, 0); const recovered = await state(page); assert.equal(recovered.panel, false); record({ test: 'slow-start-is-not-labeled-failed-and-finishes-without-refresh', pending, recovered }); await context.close()
  }
} finally { await browser.close() }
console.log(JSON.stringify({ passed: rows.length, output }))
