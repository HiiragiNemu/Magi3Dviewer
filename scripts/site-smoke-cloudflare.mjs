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
let server, browser, page, before, after, profileProof, geometryProofs = []
const errors = [], rejectedRepositoryRequests = [], responses = [], failures = [], finished = new Set()
const galleryRows = []
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
function classifyStageTransferFailures(failures, completed, proof, geometryProofs = []) {
  return failures.filter(request => {
    if (!request.url.includes('/stages/official/')) return false
    if (request.error !== 'net::ERR_ABORTED') return true
    if (completed.has(request.url)) return false
    if (geometryProofs.some(item => item.url === request.url && item.httpStatus === 200
      && item.bytesMatch === true && item.stageCorrect === true && item.drawn === true)) return false
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
  // Observe the body of the application's actual geometry fetch. A cloned
  // response adds no network request and cannot turn another stage into this
  // stage. This is stronger evidence than Chrome's requestfinished event,
  // which can report ERR_ABORTED after a stream was completely consumed.
  await page.evaluateOnNewDocument(() => {
    const originalFetch = globalThis.fetch.bind(globalThis)
    const records = [], pending = []
    globalThis.__magiusGeometryTransfers = { records, pending }
    globalThis.fetch = async (...args) => {
      const response = await originalFetch(...args)
      const input = args[0]
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href)
      const method = (args[1]?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (method === 'GET' && url.pathname.includes('/stages/official/') && /\.(fbxdata|fbx)(?:$)/i.test(url.pathname)) {
        const copy = response.clone(), record = { url: url.href, httpStatus: response.status }
        records.push(record)
        pending.push(copy.arrayBuffer().then(async buffer => {
          record.bytes = buffer.byteLength
          record.sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(b => b.toString(16).padStart(2, '0')).join('')
        }).catch(error => { record.error = error.name }))
      }
      return response
    }
  })
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
  const transfers = await page.evaluate(async () => {
    await Promise.all(globalThis.__magiusGeometryTransfers.pending)
    return globalThis.__magiusGeometryTransfers.records
  })
  geometryProofs = transfers.filter(item => !item.error && item.url.startsWith(site + root)).map(item => {
    const relative = decodeURIComponent(new URL(item.url).pathname).replace(/^\/+/, '')
    const file = path.resolve(output, relative)
    assert.ok(file.startsWith(output + path.sep), 'Geometry path escaped the delivery directory')
    const expected = fs.readFileSync(file)
    assert.equal(item.httpStatus, 200)
    assert.equal(item.bytes, expected.length, 'Consumed geometry byte length differs from current carrier')
    assert.equal(item.sha256, createHash('sha256').update(expected).digest('hex'), 'Consumed geometry bytes differ from current carrier')
    return { ...item, bytesMatch: true, stageCorrect: after.stageId === stageId, drawn: after.accepted && after.drawnMeshes > 0 && after.loadFailure === null }
  })
  assert.ok(geometryProofs.length > 0, 'No exact application geometry response was verified')
  const loaded = responses.filter(response => response.url.startsWith(site + root)
    && (finished.has(response.url) || geometryProofs.some(item => item.url === response.url && item.bytesMatch)))
  assert.ok(loaded.some(response => /\.(fbxdata|fbx)(?:\?|$)/i.test(response.url)), 'Current geometry was not served by this website')
  assert.ok(loaded.some(response => /\.(png|webp|jpg)(?:\?|$)/i.test(response.url)), 'Current textures were not served by this website')
  assert.deepEqual(rejectedRepositoryRequests, [], 'The browser still depends on the public source repository')
  assert.deepEqual(responses.filter(response => ![200,304].includes(response.status)), [])
  assert.deepEqual(classifyStageTransferFailures(failures,finished,profileProof,geometryProofs), [])
  assert.ok(!errors.some(error => /ReferenceError|TypeError|SyntaxError|VALIDATE_STATUS|Error compiling|GL_INVALID|CORS policy/i.test(error)), errors.join('\n'))
  assert.equal(after.pixelRatio,before.pixelRatio)
  assert.equal(after.antialiasing,before.antialiasing)
  await page.screenshot({path:path.join(evidence,remote?'cloudflare-live-stage.png':'cloudflare-candidate-stage.png'),fullPage:true})
  // Audit every newly enabled native Sprite, not an invented scene ID or a
  // handful of samples. A missing/disabled option must fail immediately rather
  // than silently selecting "none" and later being reported as a load timeout.
  const gallery = JSON.parse(fs.readFileSync(path.join(output,'stages/catalogs/official-gallery-diorama-original.v1.json'),'utf8')).stages
  assert.equal(gallery.length,79)
  const galleryDir = path.join(evidence,remote?'gallery-production':'gallery-candidate')
  fs.mkdirSync(galleryDir,{recursive:true})
  const saveGallery = () => fs.writeFileSync(path.join(galleryDir,'review.json'),JSON.stringify({site,total:gallery.length,rows:galleryRows},null,2)+'\n')
  const actorIdentity = await page.evaluate(()=>window.scene.characterSelected.character.object.uuid)
  for (const entry of gallery) {
    const started = Date.now()
    const row = {id:entry.id,implemented:true,payloadIdentity:'pending',browser:'pending',visualReview:'pending',humanAcceptance:'pending'}
    galleryRows.push(row)
    try {
      assert.equal(entry.type,'image')
      const option = await page.$eval('#stage-selector',(select,id)=>{
        const found=[...select.options].find(option=>option.value===id)
        return found?{disabled:found.disabled,availability:found.dataset.availability}:null
      },entry.id)
      assert.ok(option,'Catalog entry is missing from the actual selector: '+entry.id)
      assert.equal(option.disabled,false,entry.id)
      assert.equal(option.availability,'native-2d-background')
      assert.deepEqual(await page.select('#stage-selector',entry.id),[entry.id])
      await page.waitForFunction(id=>{
        const root=window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
        const visible=root?.userData.stageVisibleContent
        return root?.userData.stageLoadFailure?.requestedStageId===id
          || (root?.userData.stageDefinition?.id===id&&visible?.drawProbeComplete&&visible.drawnMeshCount>0)
      },{timeout:120000,polling:300},entry.id)
      const proof = await page.evaluate(()=>{
        const viewer=window.scene,root=viewer.backgroundScene.getObjectByName('Magius3DviewerStageRoot'),images=[]
        root.traverse(mesh=>{if(mesh.isMesh&&mesh.userData.nativeImageBackground){
          const texture=mesh.material.uniforms.uImage.value
          images.push({identity:mesh.userData.nativeImageBackground,width:texture.image.width,height:texture.image.height,
            scale:mesh.material.uniforms.uImageScale.value.toArray(),depthWrite:mesh.material.depthWrite,depthTest:mesh.material.depthTest})
        }})
        return {stageId:root.userData.stageDefinition.id,failure:root.userData.stageLoadFailure??null,
          visible:root.userData.stageVisibleContent,images,actor:viewer.characterSelected.character.object.uuid}
      })
      assert.equal(proof.stageId,entry.id);assert.equal(proof.failure,null)
      assert.equal(proof.visible.classification,'native-2d-background')
      assert.equal(proof.visible.accepted,true);assert.ok(proof.visible.drawnMeshCount>0)
      assert.equal(proof.actor,actorIdentity,'Scene switch replaced the foreground actor')
      assert.equal(proof.images.length,1,'A previous screen background survived the scene switch')
      assert.equal(proof.images[0].identity.sha256,entry.nativeImage.sha256)
      assert.equal(proof.images[0].width,entry.nativeImage.width);assert.equal(proof.images[0].height,entry.nativeImage.height)
      assert.equal(proof.images[0].depthWrite,false);assert.equal(proof.images[0].depthTest,false)
      await page.screenshot({path:path.join(galleryDir,entry.id+'.png')})
      Object.assign(row,{payloadIdentity:'pass',browser:'pass',seconds:(Date.now()-started)/1000,proof})
      console.log(JSON.stringify({test:'native-gallery-render',id:entry.id,seconds:row.seconds}))
    } catch(error) {
      Object.assign(row,{browser:'fail',error:String(error),seconds:(Date.now()-started)/1000})
      throw error
    } finally {saveGallery()}
  }
  assert.deepEqual(await page.select('#stage-selector',stageId),[stageId])
  await page.waitForFunction(id=>{
    const root=window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
    return root?.userData.stageDefinition?.id===id&&root.userData.stageVisibleContent?.drawProbeComplete
      &&root.userData.stageVisibleContent.drawnMeshCount>0
  },{timeout:240000},stageId)
  assert.equal(await page.evaluate(()=>{
    let images=0;window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot').traverse(mesh=>{if(mesh.userData.nativeImageBackground)images++});return images
  }),0,'The 2D background must be removed when returning to a 3D scene')
  assert.deepEqual(rejectedRepositoryRequests,[])
  assert.ok(!errors.some(error=>/ReferenceError|TypeError|SyntaxError|VALIDATE_STATUS|Error compiling|GL_INVALID|CORS policy/i.test(error)),errors.join('\n'))
  result = {passed:true,site,publicSourceRequestsBlocked:true,sceneState:{before,after},profileProof,geometryProofs,galleryRows,responses,errors,failures,rejectedRepositoryRequests}
} catch (error) {
  after = await page?.evaluate(sceneState).catch(()=>after)
  result = {...result,error:String(error),sceneState:{before,after},profileProof,geometryProofs,galleryRows,responses,errors,failures,rejectedRepositoryRequests,
    finishedStageRequests:[...finished].filter(url=>url.includes('/stages/official/'))}
  await page?.screenshot({path:path.join(evidence,'cloudflare-stage-failure.png'),fullPage:true}).catch(()=>{})
  throw error
} finally {
  fs.writeFileSync(path.join(evidence,remote?'cloudflare-live-browser.json':'cloudflare-candidate-browser.json'),JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result,null,2))
  if (browser) await browser.close()
  if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve))}
}
