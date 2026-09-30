import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {execFileSync} from 'node:child_process'
import puppeteer from 'puppeteer-core'
const out=path.resolve(process.env.MAGIUS_EVIDENCE_DIR||'artifacts/mobile-tps')
fs.mkdirSync(out,{recursive:true})
const remote=process.env.MAGIUS_SITE_URL,dev=process.env.MAGIUS_VIEWPORT_DEV==='1'
assert.ok(!(remote&&dev))
if(remote)assert.match(remote,/^https:\/\/(?:[a-f0-9]{8}\.)?magius3dviewer\.pages\.dev\/$/)
const base=remote||(dev?'https://127.0.0.1:4181/':'http://127.0.0.1:4182/')
const output=path.resolve(process.env.MAGIUS_DEPLOY_OUT_DIR||'dist-deploy')
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'}
let server,browser,page,result
const errors=[],missing=[],observations=[]
const record=r=>{observations.push(r);fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({observations,errors,missing},null,2));console.log(JSON.stringify(r))}
try{
 if(!remote&&!dev){server=http.createServer((req,res)=>{let rel;try{rel=decodeURIComponent(new URL(req.url,base).pathname).replace(/^\/+/, '')||'index.html'}catch{res.writeHead(400).end();return}const file=path.resolve(output,rel);if(!file.startsWith(output+path.sep)){res.writeHead(403).end();return}try{if(!fs.statSync(file).isFile())throw Error();res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res)}catch{res.writeHead(404).end(rel)}});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4182,'127.0.0.1',resolve)})}
 const chrome=process.env.CHROME_BIN||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':execFileSync('bash',['-lc','command -v google-chrome-stable || command -v google-chrome || command -v chromium'],{encoding:'utf8'}).trim())
 browser=await puppeteer.launch({executablePath:chrome,headless:true,acceptInsecureCerts:dev,protocolTimeout:300000,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage();await page.setViewport({width:430,height:932,isMobile:true,hasTouch:true,deviceScaleFactor:1})
 page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)missing.push({status:r.status(),url:r.url()})})
 await page.goto(base+'?diagnostic=pose-editor&runtimeDelivery=release',{waitUntil:'domcontentloaded',timeout:90000})
 await page.waitForFunction(()=>window.scene?.characterSelected?.character?.userData?.characterId===100107&&window.magiusViewerLocomotion,{timeout:180000})
 const frames=n=>page.evaluate(n=>new Promise(resolve=>{let i=0;const next=()=>++i>=n?resolve():requestAnimationFrame(next);requestAnimationFrame(next)}),n)
 const snap=()=>page.evaluate(()=>{const api=window.magiusViewerLocomotion;const s=api.capabilityManifest().find(s=>s.characterId===window.scene.characterSelected.character.userData.characterId);const a=window.scene.characterSelected.character.animation;return{enabled:api.enabled,id:s.characterId,state:s.state,grounded:s.grounded,p:s.position,v:s.velocity,clip:s.currentClip,camera:s.camera,actions:a.mixer._actions.filter(x=>x.isScheduled()&&x.getEffectiveWeight()>.01).map(x=>({name:x.getClip().name,weight:x.getEffectiveWeight()}))}})
 const rect=selector=>page.$eval(selector,e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}})
 const tap=async selector=>{await page.waitForSelector(selector,{visible:true,timeout:20000});await page.$eval(selector,e=>e.scrollIntoView({block:'nearest',inline:'nearest'}));const r=await rect(selector);await page.touchscreen.tap(r.cx,r.cy);await frames(3)}
 const fingers=new Map()
 const send=async(type,id,x,y)=>{
  if(type==='touchStart'){assert.ok(!fingers.has(id));fingers.set(id,await page.touchscreen.touchStart(x,y));return}
  const finger=fingers.get(id);assert.ok(finger,'unknown touch finger '+id)
  if(type==='touchMove')await finger.move(x,y)
  else{await finger.end();fingers.delete(id)}
 }
 const layout=async(width,height)=>{
  await page.setViewport({width,height,isMobile:true,hasTouch:true,deviceScaleFactor:1});await frames(8)
  const selectors=['#tps-touch-stick','#tps-touch-run','#tps-touch-jump','#tps-touch-exit'],boxes={}
  for(const selector of selectors){const r=await rect(selector);assert.ok(r.w>=36&&r.h>=30,selector+' too small');assert.ok(r.x>=-1&&r.y>=0&&r.x+r.w<=width+1&&r.y+r.h<=height+1,selector+' outside viewport '+JSON.stringify(r));boxes[selector]=r;const center=await page.evaluate((selector)=>{const e=document.querySelector(selector),r=e.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!top&&(top===e||e.contains(top))},selector);assert.ok(center,selector+' is occluded')}
  const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))
  for(let i=0;i<selectors.length;i++)for(let j=i+1;j<selectors.length;j++)assert.equal(overlap(boxes[selectors[i]],boxes[selectors[j]]),0,'touch controls overlap')
  assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0,'page horizontally overflows')
  await page.screenshot({path:path.join(out,`touch-${width}x${height}.png`)})
  record({test:'responsive-touch-layout',width,height,boxes})
 }
 assert.equal(await page.$eval('#tps-touch-controls',e=>e.hidden),true)
 await tap('#locomotion-mode-toggle');assert.equal((await snap()).enabled,true)
 await layout(430,932);await layout(932,430);await layout(360,740)
 await page.setViewport({width:430,height:932,isMobile:true,hasTouch:true,deviceScaleFactor:1});await frames(5)
 const initial=await snap(),stick=await rect('#tps-touch-stick')
 await send('touchStart',1,stick.cx,stick.cy);await send('touchMove',1,stick.cx,stick.cy-stick.w*.4);await frames(12)
 const walking=await snap();assert.ok(Math.hypot(...walking.p.map((v,i)=>v-initial.p[i]))>.05,'real touch stick did not move actor')
 const run=await rect('#tps-touch-run');await send('touchStart',3,run.cx,run.cy);await send('touchEnd',3);await frames(25)
 assert.equal(await page.$eval('#tps-touch-run',e=>e.getAttribute('aria-pressed')),'true','one tap must toggle run exactly once')
 const running=await snap();record({test:'touch-movement-checkpoint',walking,running});assert.equal(running.state,'run','touch acceleration did not reach running')
 assert.ok(Math.hypot(running.v[0],running.v[2])>Math.hypot(walking.v[0],walking.v[2]),'run button did not increase speed')
 await send('touchStart',2,300,340);await send('touchMove',2,330,350);await frames(4)
 const looking=await snap();assert.ok(Math.abs(looking.camera.yaw-running.camera.yaw)>.01,'second finger did not rotate camera')
 const jump=await rect('#tps-touch-jump');await send('touchStart',3,jump.cx,jump.cy);await send('touchEnd',3)
 let airborne
 for(let i=0;i<45;i++){await frames(1);const s=await snap();if(!s.grounded){airborne=s;break}}
 assert.ok(airborne,'touch jump never left the ground')
 await send('touchEnd',1)
 const beforeLook=await snap();await send('touchMove',2,350,350);await frames(3);const afterLook=await snap()
 assert.ok(Math.abs(afterLook.camera.yaw-beforeLook.camera.yaw)>.01,'releasing the joystick incorrectly cancelled the camera finger')
 await send('touchEnd',2)
 const flight=[];let landed
 for(let i=0;i<120;i++){
  await frames(1);const s=await snap();flight.push(s)
  if(s.grounded&&!landed)landed=s
  if(landed&&flight.length>20&&s.state==='idle')break
 }
 assert.ok(landed,'jump never landed')
 assert.ok(!['jump','fall'].includes(landed.state),'grounded actor retained airborne controller state')
 for(const s of flight.filter(s=>s.grounded))assert.ok(Math.hypot(s.v[0],s.v[2])<1e-7,'released stick produced a post-landing glide')
 await frames(12);const settled=await snap()
 assert.equal(settled.state,'idle');assert.ok(Math.hypot(...settled.p.map((x,i)=>x-landed.p[i]))<1e-7,'root drift after touchdown')
 assert.ok(!settled.actions.some(a=>/Jump(?:Takeoff|Airborne)/i.test(a.name)&&a.weight>.02),'airborne action still contributes after grounded recovery')
 assert.equal(await page.evaluate(()=>document.pointerLockElement),null)
 fs.writeFileSync(path.join(out,'touch-jump-frames.json'),JSON.stringify(flight,null,2)+'\n')
 record({test:'real-multitouch-walk-run-jump-look-and-release',initial,walking,running,airborne,landed,settled})
 await tap('#tps-touch-exit');assert.equal((await snap()).enabled,false);assert.equal(await page.$eval('#tps-touch-controls',e=>e.hidden),true)
 await tap('#locomotion-mode-toggle');assert.equal((await snap()).enabled,true);assert.equal(await page.$eval('#tps-touch-run',e=>e.getAttribute('aria-pressed')),'false');await frames(5);assert.ok(Math.hypot(...(await snap()).v)<1e-7)
 await tap('#tps-touch-exit')
 record({test:'exit-clears-input-and-reentry-is-neutral',passed:true})
 for(const id of [100201,102001]){
  await page.select('#character-selector',String(id))
  await page.waitForFunction(id=>window.scene?.characterSelected?.character?.userData?.characterId===id,{timeout:180000},id)
  await frames(8);await tap('#locomotion-mode-toggle')
  await page.setViewport({width:932,height:430,isMobile:true,hasTouch:true,deviceScaleFactor:1});await frames(6)
  const stick=await rect('#tps-touch-stick'),run=await rect('#tps-touch-run'),jump=await rect('#tps-touch-jump')
  await send('touchStart',1,stick.cx,stick.cy);await send('touchMove',1,stick.cx,stick.cy-stick.w*.4)
  await send('touchStart',3,run.cx,run.cy);await send('touchEnd',3);await frames(30)
  const before=await snap();assert.ok(Math.hypot(before.v[0],before.v[2])>.4,'running actor does not move: '+id)
  await send('touchStart',3,jump.cx,jump.cy);await send('touchEnd',3)
  let flew=false,contact,resumed,prior
  const rows=[]
  for(let i=0;i<150;i++){
   await frames(1);const s=await snap();rows.push(s)
   if(!s.grounded)flew=true
   if(flew&&s.grounded&&!contact)contact=s
   if(contact&&s.state==='land'){
    assert.ok(Math.hypot(s.v[0],s.v[2])<1e-7,'held direction glides while landing: '+id)
    if(prior?.state==='land')assert.ok(Math.hypot(...s.p.map((x,i)=>x-prior.p[i]))<1e-7)
   }
   if(contact&&s.state==='run'){resumed=s;break}
   prior=s
  }
  assert.ok(flew&&contact&&resumed,'jump does not return to grounded running: '+id)
  await frames(10);const after=await snap()
  assert.ok(!after.actions.some(a=>/Jump(?:Takeoff|Airborne)/i.test(a.name)&&a.weight>.02),'grounded running retains airborne weight: '+id)
  await send('touchEnd',1);await frames(30);await tap('#tps-touch-exit')
  fs.writeFileSync(path.join(out,'held-jump-'+id+'.json'),JSON.stringify(rows,null,2)+'\n')
  record({test:'held-run-jump-contact-and-resume',id,before,contact,resumed,after})
 }
 assert.deepEqual(errors,[])
 assert.deepEqual(missing.filter(r=>new URL(r.url).origin===new URL(base).origin),[])
 result={passed:true,base,observations,errors,missing,renderer:'Chrome touch-device emulation and real CDP multi-touch, ANGLE SwiftShader; not a physical-phone performance benchmark'}
}catch(error){result={passed:false,base,error:String(error),observations,errors,missing};await page?.screenshot({path:path.join(out,'mobile-tps-failure.png')}).catch(()=>{});throw error}
finally{fs.writeFileSync(path.join(out,'mobile-tps-browser.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result?.passed,error:result?.error}));if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}}
