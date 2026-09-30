import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {execFileSync} from 'node:child_process'
import puppeteer from 'puppeteer-core'
const out=path.resolve(process.env.MAGIUS_EVIDENCE_DIR||'artifacts/jump-style')
fs.mkdirSync(out,{recursive:true})
const remote=process.env.MAGIUS_SITE_URL,dev=process.env.MAGIUS_VIEWPORT_DEV==='1'
assert.ok(!(remote&&dev));if(remote)assert.match(remote,/^https:\/\/(?:[a-f0-9]{8}\.)?magius3dviewer\.pages\.dev\/$/)
const base=remote||(dev?'https://127.0.0.1:4181/':'http://127.0.0.1:4184/')
const output=path.resolve(process.env.MAGIUS_DEPLOY_OUT_DIR||'dist-deploy')
const baseline=JSON.parse(fs.readFileSync(new URL('../testdata/classic-jump-baseline-20260930.json',import.meta.url),'utf8'))
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'}
let server,browser,page,result
const errors=[],observations=[]
const record=row=>{observations.push(row);fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({observations,errors},null,2));console.log(JSON.stringify(row))}
try{
 if(!remote&&!dev){server=http.createServer((req,res)=>{let rel;try{rel=decodeURIComponent(new URL(req.url,base).pathname).replace(/^\/+/, '')||'index.html'}catch{res.writeHead(400).end();return}const file=path.resolve(output,rel);if(!file.startsWith(output+path.sep)){res.writeHead(403).end();return}try{if(!fs.statSync(file).isFile())throw Error();res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res)}catch{res.writeHead(404).end(rel)}});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4184,'127.0.0.1',resolve)})}
 const chrome=process.env.CHROME_BIN||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':execFileSync('bash',['-lc','command -v google-chrome-stable || command -v google-chrome || command -v chromium'],{encoding:'utf8'}).trim())
 browser=await puppeteer.launch({executablePath:chrome,headless:true,acceptInsecureCerts:dev,protocolTimeout:300000,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage();await page.setViewport({width:900,height:760,deviceScaleFactor:1});page.on('pageerror',e=>errors.push(String(e)))
 await page.goto(base+'?diagnostic=pose-editor&runtimeDelivery=release',{waitUntil:'domcontentloaded',timeout:90000})
 await page.waitForFunction(()=>window.scene?.characterSelected?.character?.userData?.characterId===100107&&window.magiusViewerLocomotion?.setJumpStyle,{timeout:180000})
 const frames=n=>page.evaluate(n=>new Promise(r=>{let i=0;const f=()=>++i>=n?r():requestAnimationFrame(f);requestAnimationFrame(f)}),n)
 for(const original of baseline.rows){
  if(original.id!==100107){await page.reload({waitUntil:'domcontentloaded',timeout:90000});await page.waitForFunction(()=>window.scene?.characterSelected?.character?.userData?.characterId===100107&&window.magiusViewerLocomotion?.setJumpStyle,{timeout:180000})}
  await page.select('#character-selector',String(original.id));await page.waitForFunction(id=>window.scene?.characterSelected?.character?.userData?.characterId===id&&window.scene.characterSelected.character.object.animations.some(c=>c.name.includes('_ExpressiveV1_')),{timeout:180000},original.id)
  const proofs=await page.evaluate(async()=>{
   const c=window.scene.characterSelected.character,map=new Map();c.object.traverse(n=>map.set(n.uuid,n.name))
   const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),v=>v.toString(16).padStart(2,'0')).join('')
   const clips=c.object.animations.filter(c=>/Jump(?:Takeoff|Airborne|Land)V(?:37|45)/.test(c.name)),records=[]
   const data=c=>c.tracks.map(t=>({name:t.name.replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi,s=>map.get(s)||s),times:Array.from(t.times),values:Array.from(t.values),kind:t.ValueTypeName}))
   for(const old of clips.filter(c=>!c.name.includes('_ExpressiveV1_'))){const newer=clips.find(c=>c.name===old.name.replace(/_(SE|L)$/,'_ExpressiveV1_$1'));if(!newer)throw Error('No refined companion '+old.name);const a=data(old),b=data(newer);const changed=[];let maxArmStep=0
    if(a.length!==b.length)throw Error('Changed track count')
    for(let i=0;i<a.length;i++){if(a[i].name!==b[i].name||JSON.stringify(a[i].times)!==JSON.stringify(b[i].times))throw Error('Changed track identity or time axis')
     const same=JSON.stringify(a[i].values)===JSON.stringify(b[i].values)
     if(!same)changed.push(a[i].name)
     if(!same&&!/\.(?:quaternion)$/.test(a[i].name))throw Error('Refined pose changed translation or scale '+a[i].name)
     if(!same&&!/(?:Shoulder|Arm|Forearm|Hand|finger|thumb)/i.test(a[i].name))throw Error('Refined jump changed non-arm animation '+a[i].name)
     if(a[i].name.endsWith('.quaternion')){const v=b[i].values;for(let j=0;j<v.length;j+=4){const norm=Math.hypot(...v.slice(j,j+4));if(Math.abs(norm-1)>.002)throw Error('Non-unit quaternion');if(j&&/(?:Arm|Forearm)/.test(a[i].name)){const dot=Math.abs(v.slice(j,j+4).reduce((sum,x,k)=>sum+x*v[j-4+k],0));maxArmStep=Math.max(maxArmStep,2*Math.acos(Math.min(1,dot))*180/Math.PI)}}}
    }
    records.push({name:old.name,duration:old.duration,tracks:a.length,sha256:await hash(a),refinedSha256:await hash(b),changed,maxArmStep})
   }
   return records
  })
  assert.equal(proofs.length,9)
  for(const proof of proofs){const old=original.clips.find(c=>c.name===proof.name);assert.ok(old);assert.equal(proof.sha256,old.sha256,'Original motion bytes were not retained: '+proof.name);assert.ok(proof.changed.length>0);assert.ok(proof.maxArmStep<35,'Frame-to-frame arm jump: '+JSON.stringify(proof))}
  record({test:'unchanged-classic-tracks-and-arm-only-alternatives',id:original.id,baselineRevision:baseline.revision,clips:proofs})
  if(original.id===100107){
   await page.evaluate(()=>window.magiusViewerLocomotion.setEnabled(false))
   for(const mode of ['Standing','Run'])for(const style of ['classic','expressive']){
    const sample=await page.evaluate(({mode,style})=>{window.__jumpSampleDispose?.();const c=window.scene.characterSelected.character,clip=c.object.animations.find(a=>a.name.includes(mode+'JumpAirborne')&&(style==='expressive')===a.name.includes('_ExpressiveV1_'));c.animation.paused=true
     const samplers=clip.tracks.map(t=>{const at=t.name.lastIndexOf('.'),id=t.name.slice(0,at),property=t.name.slice(at+1),object=c.object.getObjectByProperty('uuid',id)||c.object.getObjectByName(id);if(!object||!['position','quaternion','scale'].includes(property))throw Error('Unresolved sample target '+t.name);return{object,property,sample:t.createInterpolant()}})
     const hidden=[];c.object.traverse(n=>{if(n.isMesh&&/weapon/i.test(n.name)){hidden.push([n,n.visible]);n.visible=false}})
     const apply=()=>{for(const s of samplers)s.object[s.property].fromArray(s.sample.evaluate(.16));c.object.updateMatrixWorld(true);c.object.traverse(n=>{if(n.isSkinnedMesh)n.skeleton.update()})}
     const remove=window.scene.addBeforeRenderCallback(apply);window.__jumpSampleDispose=()=>{remove();for(const [n,v]of hidden)n.visible=v;delete window.__jumpSampleDispose};apply();return clip.name},{mode,style})
    await page.evaluate(()=>{window.scene.controls.target.set(0,.86,0);window.scene.camera.position.set(1.2,1.15,3.2);window.scene.camera.lookAt(window.scene.controls.target);window.scene.controls.update()});await frames(3)
    await page.screenshot({path:path.join(out,`${mode.toLowerCase()}-${style}.png`)})
    record({test:'pose-comparison-sample',mode,style,clip:sample,time:.16,kind:'paused authored-curve sample, not a physical landing benchmark'})
   }
   await page.evaluate(()=>window.__jumpSampleDispose?.())
  }
  // Switch with the actual accessible control, then compare controller state
  // within one event turn: no advance may manufacture apparent stability.
  await page.evaluate(()=>{window.magiusViewerLocomotion.setEnabled(true);window.scene.characterSelected.character.animation.paused=false})
  await page.evaluate(()=>window.magiusViewerLocomotion.characterActions.ready())
  await frames(12)
  await page.waitForSelector('#jump-style-select',{visible:true})
  await page.select('#jump-style-select','classic')
  await page.evaluate(()=>window.magiusViewerLocomotion.setVirtualInput({moveZ:1,run:true,jumpPressed:true}))
  await page.waitForFunction(()=>window.magiusViewerLocomotion.capabilityManifest().find(x=>x.characterId===window.scene.characterSelected.character.userData.characterId)?.grounded===false,{timeout:30000})
  const switched=await page.evaluate(()=>{const api=window.magiusViewerLocomotion,get=()=>{const s=api.capabilityManifest().find(x=>x.characterId===window.scene.characterSelected.character.userData.characterId);return{p:s.position,v:s.velocity,state:s.state,grounded:s.grounded,clip:s.currentClip}},before=get();api.setJumpStyle('expressive');const refined=get();api.setJumpStyle('classic');const original=get();return{before,refined,original}})
  assert.ok(switched.refined.clip.includes('_ExpressiveV1_'));assert.ok(!switched.original.clip.includes('_ExpressiveV1_'))
  for(const next of [switched.refined,switched.original]){assert.deepEqual(next.p,switched.before.p);assert.deepEqual(next.v,switched.before.v);assert.equal(next.state,switched.before.state);assert.equal(next.grounded,switched.before.grounded)}
  await page.evaluate(()=>window.magiusViewerLocomotion.setVirtualInput({moveZ:0,run:false}))
  await page.waitForFunction(()=>{const s=window.magiusViewerLocomotion.capabilityManifest().find(x=>x.characterId===window.scene.characterSelected.character.userData.characterId);return s.grounded&&s.state==='idle'},{timeout:45000})
  await page.evaluate(()=>{window.magiusViewerLocomotion.clearVirtualInput();window.magiusViewerLocomotion.setEnabled(false)})
  record({test:'instant-midair-revert-preserves-physics',id:original.id,...switched})
 }
 await page.reload({waitUntil:'domcontentloaded',timeout:90000});await page.waitForFunction(()=>window.magiusViewerLocomotion?.jumpStyle==='classic'&&window.scene?.characterSelected?.character,{timeout:180000})
 assert.equal(await page.evaluate(()=>window.magiusViewerLocomotion.jumpStyle),'classic');record({test:'original-preference-persists-after-reload',passed:true})
 await page.evaluate(()=>window.magiusViewerLocomotion.setJumpStyle('expressive'))
 assert.deepEqual(errors,[]);result={passed:true,site:base,observations,errors}
}catch(error){result={passed:false,site:base,error:String(error),observations,errors,inspection:await page?.evaluate(()=>window.magiusViewerLocomotion?.capabilityManifest()).catch(()=>undefined)};await page?.screenshot({path:path.join(out,'jump-style-failure.png')}).catch(()=>{});throw error}
finally{fs.writeFileSync(path.join(out,'jump-style-browser.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result?.passed,error:result?.error}));if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}}
