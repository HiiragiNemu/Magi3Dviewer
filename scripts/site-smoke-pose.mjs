import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const output = path.resolve(process.env.MAGIUS_DEPLOY_OUT_DIR || 'dist-deploy')
const evidence = process.env.MAGIUS_EVIDENCE_DIR || '/tmp/site-evidence'
fs.mkdirSync(evidence, { recursive: true })
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.woff2':'font/woff2' }
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  let relative
  try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') } catch { response.writeHead(400).end(); return }
  if (relative.startsWith('Magi3Dviewer/')) relative = relative.slice('Magi3Dviewer/'.length)
  if (!relative || relative.endsWith('/')) relative += 'index.html'
  const file = path.resolve(output, relative)
  if (!file.startsWith(output + path.sep)) { response.writeHead(403).end(); return }
  try {
    if (!fs.statSync(file).isFile()) throw new Error('not a file')
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
    response.setHeader('Cache-Control', 'no-store')
    fs.createReadStream(file).pipe(response)
  } catch { response.writeHead(404).end('Missing: '+relative) }
})
await new Promise(resolve => server.listen(4175, '127.0.0.1', resolve))
const chrome = process.env.CHROME_BIN || execFileSync('bash', ['-lc','command -v google-chrome-stable || command -v google-chrome || command -v chromium'], { encoding:'utf8' }).trim()
const browser = await puppeteer.launch({ executablePath: chrome, headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width:1600, height:1000, deviceScaleFactor:1 })
const errors = [], missing = [], observations = []
page.on('pageerror', error => errors.push(String(error)))
page.on('console', message => { if(message.type()==='error') errors.push(message.text()) })
page.on('response', response => { if(response.status()>=400) missing.push({status:response.status(),url:response.url()}) })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const inspect = () => page.evaluate(() => window.magiusPoseInspection())
const frameWait = (count=16) => page.evaluate(n => new Promise(resolve => {
  let left=n; const tick=()=> --left<=0 ? resolve() : requestAnimationFrame(tick); requestAnimationFrame(tick)
}), count)
function observe(result) {
  observations.push(result)
  fs.writeFileSync(path.join(evidence,'pose-progress.json'),JSON.stringify({observations,errors,missing},null,2))
  console.log(JSON.stringify(result))
}
const rotationDistance = (a,b) => {
  const dot=Math.abs(a.reduce((sum,n,i)=>sum+n*b[i],0))
  const norm=Math.sqrt(a.reduce((sum,n)=>sum+n*n,0)*b.reduce((sum,n)=>sum+n*n,0))
  return 2*Math.acos(Math.min(1,dot/norm))
}
// The shipped skeleton calls its upper arms Arm_R / Arm_L, not UpperArm.
// A fully extended forearm can keep its local angle while its upper arm turns.
const limbBone = /hand|wrist|upperarm|forearm|(?:^|[_. :/-])arm(?:$|[_. :/-])|thigh|calf|foot|ankle/i
function unchangedLengths(before, after) {
  const map=new Map(after.bones.map(b=>[b.uuid,b]))
  for(const b of before.bones.filter(b=>limbBone.test(b.name) && !/twist|cloth|weapon/i.test(b.name))) {
    const current=map.get(b.uuid);assert.ok(current, 'joint remains present: '+b.name)
    assert.ok(Math.hypot(...b.position.map((v,i)=>v-current.position[i]))<1e-5,'local bone offset changed: '+b.name)
    assert.ok(Math.hypot(...b.scale.map((v,i)=>v-current.scale[i]))<1e-6,'bone scale changed: '+b.name)
  }
}
function editedRotations(before, after) {
  const map=new Map(before.bones.map(b=>[b.uuid,b]))
  return after.bones.filter(b=>map.has(b.uuid) && limbBone.test(b.name)
    && rotationDistance(map.get(b.uuid).quaternion,b.quaternion)>1e-4)
}
async function click(selector) {
  await page.waitForSelector(selector, { visible:true, timeout:30000 })
  await page.$eval(selector, e=>e.scrollIntoView({block:'nearest'}))
  await page.click(selector)
  await frameWait(3)
}
async function openAction() {
  const open=await page.$eval('#action-panel-toggle', e=>e.getAttribute('aria-expanded')==='true')
  if(!open) await click('#action-panel-toggle')
}
async function selectHand() {
  await openAction()
  await click('[data-pose-part="right-hand"]')
  const state=await inspect();assert.equal(state.editing,true);assert.equal(state.mode,'translate')
  await click('#action-panel-close')
  await sleep(250)
  return inspect()
}
async function orbitToObliqueView() {
  // End-on Z translation is hidden by TransformControls. Reach a usable view
  // with actual pointer input, without setting a camera or gizmo axis directly.
  const before=await page.evaluate(()=>window.scene.camera.position.toArray())
  await page.mouse.move(1220,350)
  await page.mouse.down()
  await page.mouse.move(1070,415,{steps:10})
  await page.mouse.up()
  await frameWait(8)
  const after=await page.evaluate(()=>window.scene.camera.position.toArray())
  assert.ok(Math.hypot(...after.map((v,i)=>v-before[i]))>1e-5,'background pointer drag orbits the camera')
  observe({test:'pointer-oblique-camera',before,after})
}
async function hitAxis(axis) {
  const state=await inspect()
  const points=state.rings.filter(r=>r.axis===axis).flatMap(r=>r.points)
  for(const point of points) {
    if(point[0]<10 || point[0]>1590 || point[1]<85 || point[1]>990 || Math.abs(point[2])>1) continue
    await page.mouse.move(point[0],point[1]);await sleep(20)
    if((await inspect()).axis===axis) return point
  }
  await page.screenshot({path:path.join(evidence,'axis-not-found-'+axis+'.png')})
  throw new Error('No visible '+axis+' handle responds to actual pointer hover')
}
async function dragAxis(axis, rotate=false) {
  const before=await inspect(),point=await hitAxis(axis)
  const target=before.bones.find(b=>/Hand_R$/i.test(b.name)) ?? before.bones.find(b=>/hand/i.test(b.name) && /(?:_R|Right)/i.test(b.name))
  assert.ok(target,'right hand world pivot available')
  const dx=point[0]-target.screen[0],dy=point[1]-target.screen[1]
  let end
  if(rotate) {
    const a=.55;end=[target.screen[0]+dx*Math.cos(a)-dy*Math.sin(a),target.screen[1]+dx*Math.sin(a)+dy*Math.cos(a)]
  } else {
    const length=Math.hypot(dx,dy)||1;end=[point[0]-dx/length*45,point[1]-dy/length*45]
  }
  await page.mouse.down()
  await page.mouse.move(end[0],end[1],{steps:14})
  await frameWait(5)
  await page.mouse.up();await frameWait(4)
  const after=await inspect(),changed=editedRotations(before,after)
  fs.writeFileSync(path.join(evidence,'last-gesture.json'),JSON.stringify({axis,rotate,point,end,before,after},null,2))
  assert.equal(after.dragging,false,'pointerup ends control transaction')
  assert.ok(changed.length>0,'actual '+axis+' gesture changed the visible skeletal pose')
  unchangedLengths(before,after)
  await frameWait(40)
  const idle=await inspect(),map=new Map(idle.bones.map(b=>[b.uuid,b]))
  for(const bone of changed) assert.ok(rotationDistance(bone.quaternion,map.get(bone.uuid).quaternion)<1e-4,'idle pose drift: '+bone.name)
  observe({test:(rotate?'rotate-':'ik-')+axis,changed:changed.map(b=>b.name),solves:after.solves,stableFrames:40})
}
function median(values) { return values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)] ?? 0 }
try {
  await page.goto('http://127.0.0.1:4175/?diagnostic=pose-editor&runtimeDelivery=release', {waitUntil:'domcontentloaded',timeout:60000})
  await page.waitForFunction(()=>window.scene?.characterSelected?.character?.userData?.characterId===100107 && typeof window.magiusPoseInspection==='function',{timeout:180000})
  await orbitToObliqueView()
  await selectHand()
  for(const axis of ['X','Y','Z']) await dragAxis(axis)
  await openAction();await click('#pose-undo');await click('#pose-redo')
  await click('#action-direct-rotate');await click('#action-panel-close');await sleep(250)
  for(const axis of ['X','Y','Z']) await dragAxis(axis,true)
  await page.screenshot({path:path.join(evidence,'pose-edited.png'),fullPage:true})
  await openAction();await click('#action-direct-edit-toggle');await click('#action-panel-close')
  for(const id of ['100201','102001']) {
    await page.select('#character-add-selector',id)
    await page.waitForFunction(value=>String(window.scene?.characterSelected?.character?.userData?.characterId)===value,{timeout:180000},id)
  }
  await frameWait(50)
  const beforeSelection=await inspect();assert.equal(beforeSelection.actorCount,3)
  const ordinary=beforeSelection.frames.slice(-25)
  await openAction();await click('#pose-place-actor');await click('#action-panel-close');await frameWait(40)
  const selected=await inspect();assert.equal(selected.actorCount,3);assert.equal(selected.screenOutlinePass,false)
  assert.ok(selected.outlines>0,'existing outline uniforms show the selected actor')
  assert.equal(selected.pixelRatio,beforeSelection.pixelRatio,'native render scale was not reduced')
  assert.equal(selected.antialiasing,beforeSelection.antialiasing,'AA was not silently disabled')
  const counts={ordinary:median(ordinary.map(f=>f.renderCalls)),selected:median(selected.frames.slice(-25).map(f=>f.renderCalls))}
  assert.ok(counts.selected<=counts.ordinary,'selection added full-scene render passes: '+JSON.stringify(counts))
  const highlights=await page.evaluate(()=>window.scene.characters.map(entry=>{
    const mats=new Set();entry.character?.object.traverse(n=>{
      for(const m of n.material ? (Array.isArray(n.material)?n.material:[n.material]) : []) if(m.uniforms?.uSelectionWeight?.value>0)mats.add(m)
    });return {selected:entry===window.scene.characterSelected,materials:mats.size}
  }))
  assert.ok(highlights.every(x=>x.selected||x.materials===0),'highlight does not leak to another character')
  observe({test:'three-actor-highlight',renderCalls:counts,highlight:highlights,
    softwareRendererFrameMs:{ordinary:median(ordinary.map(f=>f.milliseconds)),selected:median(selected.frames.slice(-25).map(f=>f.milliseconds))}})
  await page.screenshot({path:path.join(evidence,'three-actors-selected.png'),fullPage:true})
  await click('#transform-close');await frameWait(20);assert.equal((await inspect()).outlines,0)
  await selectHand();await dragAxis('Y');await openAction();await click('#pose-undo');await click('#pose-redo')
  await page.setViewport({width:430,height:932,deviceScaleFactor:1})
  await frameWait(10)
  const controls=await page.$$eval('.direct-pose-parts button',nodes=>nodes.map(e=>({id:e.dataset.posePart,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})))
  assert.ok(controls.length>=4,'common hand/foot targets are exposed')
  assert.ok(controls.every(c=>c.width>=40&&c.height>=32),'body-part buttons remain usable in a phone viewport')
  await page.screenshot({path:path.join(evidence,'pose-phone.png'),fullPage:true})
  await page.setViewport({width:1280,height:900,deviceScaleFactor:1})
  await page.goto('http://127.0.0.1:4175/Magi3Dviewer/?diagnostic=pose-editor&runtimeDelivery=release',{waitUntil:'domcontentloaded',timeout:60000})
  await page.waitForFunction(()=>window.scene?.characterSelected?.character?.userData?.characterId===100107,{timeout:180000})
  observe({test:'github-pages-subdirectory',loaded:true})
  assert.equal(errors.filter(e=>/ReferenceError|TypeError|SyntaxError|VALIDATE_STATUS|Error compiling|GL_INVALID/i.test(e)).length,0,'browser execution/shader errors: '+errors.join('\n'))
  fs.writeFileSync(path.join(evidence,'pose-browser.json'),JSON.stringify({passed:true,renderer:'Chrome headless ANGLE SwiftShader; timing is not a user GPU benchmark',observations,errors,missing},null,2))
  console.log(JSON.stringify({passed:true,observations},null,2))
} catch(error) {
  await page.screenshot({path:path.join(evidence,'pose-failure.png'),fullPage:true}).catch(()=>{})
  const snapshot=await inspect().catch(()=>null)
  fs.writeFileSync(path.join(evidence,'pose-browser.json'),JSON.stringify({passed:false,error:String(error),observations,errors,missing,snapshot},null,2))
  throw error
} finally {
  await browser.close();await new Promise(resolve=>server.close(resolve))
}
