import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import {sampleRecorded} from '../src/viewer/performanceEditor/recordings.ts'
const site=new URL(process.env.MAGIUS_SITE_URL||'http://127.0.0.1:6595/'),out=process.env.MAGIUS_EVIDENCE_DIR||'artifacts/studio/portable-multi'
const text=fs.readFileSync(process.env.MAGIUS_PROJECT_FILE||'artifacts/studio/final-source-handoff/recorded-project.json','utf8'),document=JSON.parse(text)
fs.mkdirSync(out,{recursive:true});const browser=await puppeteer.connect({browserWSEndpoint:JSON.parse(fs.readFileSync(process.env.MAGIUS_BROWSER_ENDPOINT_FILE||'artifacts/studio/browser.json')).endpoint,defaultViewport:null,protocolTimeout:240000}),context=await browser.createBrowserContext(),p=await context.newPage(),errors=[],rows=[];let passed=false
p.on('pageerror',e=>errors.push(String(e)))
let releaseCatalog=false;const heldCatalogRequests=[]
await p.setRequestInterception(true)
p.on('request',request=>{if(new URL(request.url()).pathname==='/stages/catalog.json'&&!releaseCatalog)heldCatalogRequests.push(request);else void request.continue().catch(()=>{})})
try{
 await p.setViewport({width:1280,height:900,deviceScaleFactor:1});await p.goto(new URL('?runtimeDelivery=release#100101',site).href,{waitUntil:'domcontentloaded',timeout:120000});await p.waitForFunction(()=>window.magiusPerformanceStudio&&window.scene?.characterSelected?.character,{timeout:240000,polling:250});await p.evaluate(text=>{window.__studioImportDone=false;window.__studioImportError='';window.__studioImportPromise=window.magiusPerformanceStudio.recorder.import(text).then(()=>{window.__studioImportDone=true}).catch(e=>{window.__studioImportError=String(e.message)})},text)
 await new Promise(r=>setTimeout(r,300));const pending=await p.evaluate(()=>({done:window.__studioImportDone,error:window.__studioImportError}));assert.equal(pending.done,false,'import did not wait for delayed scene initialization');assert.equal(pending.error,'','cold import incorrectly treated an unhydrated selector as unavailable');releaseCatalog=true;await Promise.all(heldCatalogRequests.splice(0).map(r=>r.continue()));await p.waitForFunction(()=>window.__studioImportDone||window.__studioImportError,{timeout:240000,polling:150});assert.equal(await p.evaluate(()=>window.__studioImportError),'');rows.push({test:'cold-project-import-waits-for-delayed-stage-catalog'})
 const actors=await p.evaluate(()=>window.magiusPerformanceStudio.recorder.host.actors().map(a=>({id:a.resourceId,key:a.actorKey,instance:a.instance})));assert.ok(actors.some(a=>a.id==='102001')&&actors.some(a=>a.id==='100101'));assert.ok(document.recordedLanes.filter(l=>l.target).every(l=>!actors.some(a=>a.key===l.target.actorKey)),'test must use fresh actor UUIDs')
 for(const time of [0,.3,.75,1.2]){
  await p.evaluate(t=>window.magiusPerformanceStudio.recorder.seek(t),time);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
  const state=await p.evaluate(()=>({error:window.magiusPerformanceStudio.recorder.error,actors:window.magiusPerformanceStudio.recorder.host.actors().map(a=>({id:a.resourceId,instance:a.instance,p:a.object.position.toArray(),q:a.object.quaternion.toArray()})),camera:[...window.scene.camera.position.toArray(),...window.scene.camera.quaternion.toArray(),...window.scene.controls.target.toArray(),window.scene.camera.fov,window.scene.camera.near,window.scene.camera.far,window.scene.camera.zoom]}));assert.equal(state.error,'')
  for(const lane of document.recordedLanes){const expected=sampleRecorded(lane,time);if(lane.kind==='motion'){const actual=state.actors.find(a=>a.id===lane.target.resourceId&&a.instance===lane.target.instance);assert.ok(actual);assert.ok(actual.p.every((v,i)=>Math.abs(v-expected[i])<1e-5));const d=Math.abs(actual.q.reduce((n,v,i)=>n+v*expected[i+3],0));assert.ok(1-d<1e-6)}if(lane.kind==='camera')assert.ok(state.camera.every((v,i)=>Math.abs(v-expected[i])<1e-5))}
  rows.push({time,actors:state.actors})
 }
 await p.evaluate(()=>window.magiusPerformanceStudio.open());await p.screenshot({path:path.join(out,'imported-multi-actor-project.png')});assert.deepEqual(errors,[]);passed=true;console.log('PASS portable five-lane project restores both actors and camera at four exact times')
}finally{if(!passed)await p.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({passed,rows,errors},null,2));await context.close();browser.disconnect()}
