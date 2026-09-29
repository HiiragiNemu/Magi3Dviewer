import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const output = path.resolve(process.env.MAGIUS_DEPLOY_OUT_DIR || 'dist-deploy')
const evidence = process.env.MAGIUS_EVIDENCE_DIR || '/tmp/site-evidence'
const catalog = JSON.parse(fs.readFileSync(path.join(output, 'catalogs/runtime-product-delivery.v1.json'), 'utf8'))
const base = catalog.bundledStageBaseUrl
assert.ok(typeof base === 'string' && (
  /^https:\/\/[a-f0-9]{8}\.magius3dviewer\.pages\.dev\/$/.test(base)
  || /^https:\/\/raw\.githubusercontent\.com\/HiiragiNemu\/Magi3Dviewer\/[a-f0-9]{40}\/public\/$/.test(base)
), 'The stage route must be an immutable current deployment or public source commit')
assert.ok(!fs.existsSync(path.join(output, 'stages/official')), 'Smoke must exercise the actual slim artifact, not locally available stage copies')
const root = '/stages/official/battle-616-00-01-001/'
assert.ok(catalog.bundledStageRoots.includes(root), 'Reviewed current stage must be delegated')
fs.mkdirSync(evidence, { recursive: true })
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.woff2':'font/woff2' }
const server = http.createServer((request, response) => {
  let relative
  try { relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') } catch { response.writeHead(400).end(); return }
  if (relative.startsWith('Magi3Dviewer/')) relative = relative.slice('Magi3Dviewer/'.length)
  if (!relative || relative.endsWith('/')) relative += 'index.html'
  const file = path.resolve(output, relative)
  if (!file.startsWith(output + path.sep)) { response.writeHead(403).end(); return }
  try {
    if (!fs.statSync(file).isFile()) throw new Error('not a file')
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
    response.setHeader('Cache-Control', 'no-store')
    fs.createReadStream(file).pipe(response)
  } catch { response.writeHead(404).end('Missing: ' + relative) }
})
await new Promise(resolve => server.listen(4176, '127.0.0.1', resolve))
const chrome = process.env.CHROME_BIN || execFileSync('bash', ['-lc', 'command -v google-chrome-stable || command -v google-chrome || command -v chromium'], { encoding: 'utf8' }).trim()
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
const errors = [], responses = [], failedRequests = []
page.on('pageerror', error => errors.push(String(error)))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('response', response => { if (response.url().includes('/stages/official/')) responses.push({ url: response.url(), status: response.status() }) })
page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }))
// Locate the real Three.Scene by its public type flag, without assuming an
// implementation-specific property name on the viewer's scene wrapper.
const countSceneMeshes = () => {
  const viewer = window.scene
  const scene = viewer?.isScene ? viewer : Object.values(viewer ?? {}).find(value => value?.isScene && typeof value.traverse === 'function')
  if (!scene) throw new Error('The viewer does not expose its real Three.Scene')
  let count = 0
  scene.traverse(node => { if (node.isMesh) count++ })
  return count
}
const meshCount = () => page.evaluate(countSceneMeshes)
let result
try {
  await page.goto('http://127.0.0.1:4176/Magi3Dviewer/?diagnostic=pose-editor&runtimeDelivery=release', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => window.scene?.characterSelected?.character?.userData?.characterId === 100107, { timeout: 180000 })
  const before = await meshCount()
  await page.waitForFunction(() => [...document.querySelectorAll('select')].some(select => [...select.options].some(option => option.value.includes('battle-616-00-01-001'))), { timeout: 60000 })
  const choice = await page.evaluate(() => {
    for (const select of document.querySelectorAll('select')) {
      const option = [...select.options].find(option => option.value.includes('battle-616-00-01-001'))
      if (option && select.id) return { selector: '#' + CSS.escape(select.id), value: option.value }
    }
  })
  assert.ok(choice, 'The actual scene selector exposes the current stage')
  await page.select(choice.selector, choice.value)
  await page.waitForFunction(previous => {
    const viewer = window.scene
    const scene = viewer?.isScene ? viewer : Object.values(viewer ?? {}).find(value => value?.isScene && typeof value.traverse === 'function')
    if (!scene) return false
    let count = 0; scene.traverse(node => { if (node.isMesh) count++ })
    return count > previous
  }, { timeout: 240000 }, before)
  await page.waitForNetworkIdle({ idleTime: 2000, timeout: 180000 })
  const loaded = responses.filter(response => response.url().startsWith(base + root.slice(1)))
  assert.ok(loaded.some(response => /\.(fbxdata|fbx)(?:\?|$)/i.test(response.url)), 'Actual current scene geometry was fetched from the pinned deployment')
  assert.ok(loaded.some(response => /\.(png|webp|jpg)(?:\?|$)/i.test(response.url)), 'Actual scene textures were fetched from the same pinned deployment')
  assert.ok(responses.every(response => response.status === 200 || response.status === 304), 'A stage resource failed: ' + JSON.stringify(responses.filter(response => response.status >= 400)))
  assert.ok(!failedRequests.some(request => request.url.includes('/stages/official/')), 'A scene request failed, including CORS')
  assert.ok(!errors.some(error => /ReferenceError|TypeError|SyntaxError|VALIDATE_STATUS|Error compiling|GL_INVALID|CORS policy/i.test(error)), errors.join('\n'))
  result = { passed: true, base, choice, meshCount: { before, after: await meshCount() }, responses, errors, failedRequests }
  await page.screenshot({ path: path.join(evidence, 'github-pages-delegated-stage.png'), fullPage: true })
} catch (error) {
  result = { passed: false, base, error: String(error), responses, errors, failedRequests,
    controls: await page.$$eval('select', elements => elements.map(select => ({ id: select.id, options: [...select.options].slice(0, 4).map(option => ({ value: option.value, text: option.text })) }))).catch(() => []) }
  await page.screenshot({ path: path.join(evidence, 'github-pages-stage-failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  fs.writeFileSync(path.join(evidence, 'github-pages-stage-browser.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  await browser.close(); await new Promise(resolve => server.close(resolve))
}
