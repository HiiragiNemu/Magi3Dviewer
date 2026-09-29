import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const output = path.resolve(process.env.MAGIUS_DEPLOY_OUT_DIR || 'dist-deploy')
const evidence = process.env.MAGIUS_EVIDENCE_DIR || '/tmp/site-evidence'
const remote = process.env.MAGIUS_SITE_URL
const site = remote || 'http://127.0.0.1:4176/'
if (remote) assert.match(remote, /^https:\/\/(?:[a-f0-9]{8}\.)?magius3dviewer\.pages\.dev\/$/)
const catalog = JSON.parse(fs.readFileSync(path.join(output, 'catalogs/runtime-product-delivery.v1.json'), 'utf8'))
assert.equal(catalog.bundledStageBaseUrl, undefined, 'Cloudflare must serve current stages itself, not public GitHub raw files')
assert.equal(catalog.deliveryGateway, 'https://magius3dviewer-runtime-products.crynetsystemscell.workers.dev')
const stageId = 'battle-616-00-01-001'
const root = 'stages/official/' + stageId + '/'
const profileUrl = site + root + 'scene-profile.json'
assert.ok(catalog.bundledStageRoots.includes('/' + root))
assert.ok(fs.statSync(path.join(output, root)).isDirectory(), 'Full current stage must be retained')
const expectedProfile = JSON.parse(fs.readFileSync(path.join(output, root, 'scene-profile.json'), 'utf8'))
fs.mkdirSync(evidence, {recursive: true})
const types = {'.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.woff2':'font/woff2'}
let server, browser, page, before, after, profileProof
const errors = [], rejectedRepositoryRequests = [], responses = [], failures = [], finished = new Set()
let result = {passed: false, site}

// The loader may ADD the two build-owned animation defaults. Compare every
// authored field exactly; never discard or normalize any field from the file.
function authoredProfileView(profile, expected) {
  const value = structuredClone(profile)
  if (value?.runtime && typeof value.runtime === 'object') {
    for (const key of ['autoplay', 'transformAnimations']) {
      if (!Object.hasOwn(expected.runtime ?? {}, key)) delete value.runtime[key]
    }
    if (!Object.hasOwn(expected, 'runtime') && Object.keys(value.runtime).length === 0) delete value.runtime
  }
  return value
}
function classifyStageTransferFailures(failures, completed, proof) {
  return failures.filter(request => {
    if (!request.url.includes('/stages/official/')) return false
    if (request.error !== 'net::ERR_ABORTED') return true
    if (completed.has(request.url)) return false
    // A CDP cancellation alone cannot contradict the exact authored JSON
    // already parsed and committed by the application. No retry/prefetch by
    // this verifier is used to manufacture this evidence.
    return !(proof?.profileMatches === true && proof?.drawn === true
      && proof?.stageCorrect === true && proof?.httpStatus === 200
      && request.url === proof.url)
  })
}
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
  return JSON.stringify(value)
}
function sceneState() {
  const viewer = window.scene
  if (!viewer?.backgroundScene?.isScene) throw new Error('Background scene unavailable')
  const stage = viewer.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
  const visible = stage?.userData.stageVisibleContent
  let meshes = 0
  const textures = new Set()
  viewer.backgroundScene.traverse(node => {
    if (!node.isMesh) return
    meshes++
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!material) continue
      for (const value of [...Object.values(material), ...Object.values(material.uniforms ?? {}).map(uniform => uniform?.value)]) if (value?.isTexture) textures.add(value)
    }
  })
  const ready = image => Array.isArray(image) ? image.length > 0 && image.every(ready) : !!image && ((image.width > 0 && image.height > 0) || (image.image?.width > 0 && image.image?.height > 0))
  return {meshes, textures: textures.size, readyTextures: [...textures].filter(texture => ready(texture.image)).length,
    enabled: viewer.backgroundSceneEnabled, pixelRatio: viewer.renderer.getPixelRatio(), antialiasing: viewer.effects.effectiveAntiAliasing,
    stageId: stage?.userData.stageDefinition?.id, loadFailure: stage?.userData.stageLoadFailure ?? null,
    accepted: visible?.accepted ?? false, drawnMeshes: visible?.drawnMeshCount ?? 0, drawProbeComplete: visible?.drawProbeComplete ?? false}
}
try {
  if (!remote) {
    server = http.createServer((request, response) => {
      let relative
      try {relative = decodeURIComponent(new URL(request.url, site).pathname).replace(/^\/+/, '') || 'index.html'} catch {response.writeHead(400).end(); return}
      const file = path.resolve(output, relative)
      if (!file.startsWith(output + path.sep)) {response.writeHead(403).end(); return}
      try {
        if (!fs.statSync(file).isFile()) throw new Error('Not a file')
        response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
        response.setHeader('Cache-Control', 'no-store')
        fs.createReadStream(file).on('error', () => response.destroy()).pipe(response)
      } catch {response.writeHead(404).end('Missing resource')}
    })
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(4176, '127.0.0.1', resolve)})
  }
  const chrome = process.env.CHROME_BIN || execFileSync('bash', ['-lc', 'command -v google-chrome-stable || command -v google-chrome || command -v chromium'], {encoding:'utf8'}).trim()
  browser = await puppeteer.launch({executablePath:chrome,headless:true,protocolTimeout:300000,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']})
  page = await browser.newPage()
  await page.setViewport({width:1280,height:900,deviceScaleFactor:1})
  await page.setRequestInterception(true)
  page.on('request', request => {
    const url = new URL(request.url())
    if (['raw.githubusercontent.com','api.github.com','github.com'].includes(url.hostname) && /\/HiiragiNemu\/Magi3Dviewer\//i.test(url.pathname)) {
      rejectedRepositoryRequests.push(url.origin + url.pathname)
      void request.abort()
    } else void request.continue()
  })
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text())})
  page.on('response', response => {if (response.url().includes('/stages/official/')) responses.push({url:response.url(),method:response.request().method(),status:response.status()})})
  page.on('requestfailed', request => failures.push({url:request.url(),method:request.method(),error:request.failure()?.errorText}))
  page.on('requestfinished', request => finished.add(request.url()))
  await page.goto(site + '?diagnostic=pose-editor&runtimeDelivery=release', {waitUntil:'domcontentloaded',timeout:90000})
  await page.waitForFunction(() => window.scene?.characterSelected?.character?.userData?.characterId === 100107, {timeout:180000})
  await page.waitForNetworkIdle({idleTime:1000,timeout:120000})
  before = await page.evaluate(sceneState)
  await page.select('#stage-selector', stageId)
  const deadline = Date.now() + 240000
  do {
    after = await page.evaluate(sceneState)
    if (after.enabled && after.meshes > before.meshes && after.readyTextures > 0 && after.drawnMeshes > 0 && after.drawProbeComplete) break
    await new Promise(resolve => setTimeout(resolve,500))
  } while (Date.now() < deadline)
  assert.ok(after.enabled && after.meshes > before.meshes && after.readyTextures > 0, JSON.stringify({before,after}))
  assert.equal(after.stageId,stageId)
  assert.equal(after.loadFailure,null)
  assert.ok(after.accepted && after.drawnMeshes > 0 && after.drawProbeComplete, 'Actual stage geometry must be submitted to the renderer')
  await page.waitForNetworkIdle({idleTime:2000,timeout:120000})
  after = await page.evaluate(sceneState)
  assert.equal(after.readyTextures, after.textures, 'Every bound material texture must be ready')
  const consumedProfile = await page.evaluate(() => window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot').userData.sceneProfilePackage)
  const authoredView = authoredProfileView(consumedProfile,expectedProfile)
  assert.deepEqual(authoredView,expectedProfile,'The application did not consume the exact current authored profile')
  const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex')
  profileProof = {url:profileUrl,stageCorrect:after.stageId===stageId,drawn:after.accepted&&after.drawnMeshes>0&&after.loadFailure===null,
    httpStatus:responses.find(response=>response.url===profileUrl&&response.status===200)?.status,
    profileMatches:true,expectedAuthoredSha256:hash(expectedProfile),consumedAuthoredSha256:hash(authoredView)}
  const loaded = responses.filter(response => response.url.startsWith(site + root) && finished.has(response.url))
  assert.ok(loaded.some(response => /\.(fbxdata|fbx)(?:\?|$)/i.test(response.url)), 'Current geometry was not served by this website')
  assert.ok(loaded.some(response => /\.(png|webp|jpg)(?:\?|$)/i.test(response.url)), 'Current textures were not served by this website')
  assert.deepEqual(rejectedRepositoryRequests, [], 'The browser still depends on the public source repository')
  assert.deepEqual(responses.filter(response => ![200,304].includes(response.status)), [])
  assert.deepEqual(classifyStageTransferFailures(failures,finished,profileProof), [])
  assert.ok(!errors.some(error => /ReferenceError|TypeError|SyntaxError|VALIDATE_STATUS|Error compiling|GL_INVALID|CORS policy/i.test(error)), errors.join('\n'))
  assert.equal(after.pixelRatio,before.pixelRatio)
  assert.equal(after.antialiasing,before.antialiasing)
  await page.screenshot({path:path.join(evidence,remote?'cloudflare-live-stage.png':'cloudflare-candidate-stage.png'),fullPage:true})
  result = {passed:true,site,publicSourceRequestsBlocked:true,sceneState:{before,after},profileProof,responses,errors,failures,rejectedRepositoryRequests}
} catch (error) {
  after = await page?.evaluate(sceneState).catch(()=>after)
  result = {...result,error:String(error),sceneState:{before,after},profileProof,responses,errors,failures,rejectedRepositoryRequests,
    finishedStageRequests:[...finished].filter(url=>url.includes('/stages/official/'))}
  await page?.screenshot({path:path.join(evidence,'cloudflare-stage-failure.png'),fullPage:true}).catch(()=>{})
  throw error
} finally {
  fs.writeFileSync(path.join(evidence,remote?'cloudflare-live-browser.json':'cloudflare-candidate-browser.json'),JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result,null,2))
  if (browser) await browser.close()
  if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve))}
}
