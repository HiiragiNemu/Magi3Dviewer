import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import puppeteer from 'puppeteer-core'
const out=path.resolve(process.env.MAGIUS_EVIDENCE_DIR||'artifacts/entry-landing');fs.mkdirSync(out,{recursive:true})
const remote=process.env.MAGIUS_SITE_URL,dev=process.env.MAGIUS_VIEWPORT_DEV==='1'
if(remote)assert.equal(remote,'https://magius3dviewer.pages.dev/')
const base=remote||(dev?'https://127.0.0.1:4181/':'http://127.0.0.1:4185/'),output=path.resolve(process.env.MAGIUS_DEPLOY_OUT_DIR||'dist-deploy')
const version=dev?undefined:JSON.parse(fs.readFileSync(path.join(output,'site-version.json'),'utf8'))
const errors=[],observations=[];let browser,server,page,result
const record=row=>{observations.push(row);fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({observations,errors},null,2));console.log(JSON.stringify(row))}
const hash=s=>createHash('sha256').update(s).digest('hex')
try{
 if(!remote&&!dev){const mime={'.js':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.png':'image/png','.woff2':'font/woff2'};server=http.createServer((req,res)=>{const rel=decodeURIComponent(new URL(req.url,base).pathname).replace(/^\/+/, '')||'index.html',file=path.resolve(output,rel);if(!file.startsWith(output+path.sep)){res.writeHead(403).end();return}try{if(!fs.statSync(file).isFile())throw Error('missing');res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');if(rel==='index.html'){res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('X-Magius-Revision',version.revision)}fs.createReadStream(file).pipe(res)}catch{res.writeHead(404).end()}});await new Promise((yes,no)=>{server.once('error',no);server.listen(4185,'127.0.0.1',yes)})}
 const chrome=process.env.CHROME_BIN||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':execFileSync('bash',['-lc','command -v google-chrome-stable || command -v google-chrome || command -v chromium'],{encoding:'utf8'}).trim())
 browser=await puppeteer.launch({executablePath:chrome,headless:true,acceptInsecureCerts:dev,protocolTimeout:180000,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage();await page.setViewport({width:430,height:932,isMobile:true,hasTouch:true,deviceScaleFactor:1});page.on('pageerror',e=>errors.push(String(e)))
 await page.evaluateOnNewDocument(()=>{try{localStorage.setItem('magius.jump-style.v1','classic')}catch{}})
 const frames=n=>page.evaluate(n=>new Promise(resolve=>{let i=0;const f=()=>++i>=n?resolve():requestAnimationFrame(f);requestAnimationFrame(f)}),n)
 const ready=()=>page.waitForFunction(()=>window.scene?.characterSelected?.character?.userData?.characterId===100107&&window.magiusViewerLocomotion?.enabled===false,{timeout:180000})
 const entries=[]
 // No diagnostic parameter or cache-busting revision is used for production
 // entry tests. The literal URL reported by the user is part of the test.
 for(const suffix of ['?runtimeDelivery=release','','?runtimeDelivery=release','']){
  const actual=(!remote&&suffix==='')?'?runtimeDelivery=release':suffix
  const response=await page.goto(base+actual,{waitUntil:'domcontentloaded',timeout:90000});await ready()
  const html=await response.text(),headers=response.headers(),body=await page.evaluate(()=>({revision:document.querySelector('meta[name="magius-build-revision"]')?.content,icons:document.querySelectorAll('#menu-controls img[alt="Model"],#menu-controls img[alt="Animation"],#menu-controls img[alt="Expression"],#menu-controls img[alt="Enemy"]').length,voiceAfterScene:document.getElementById('stage-list-panel-toggle').nextElementSibling?.id==='voice-panel-toggle',jumpControls:document.querySelectorAll('#jump-style-control,#jump-style-select').length,jumpStyle:window.magiusViewerLocomotion.jumpStyle,canonical:location.href}))
  assert.equal(body.icons,0);assert.equal(body.voiceAfterScene,true);assert.equal(body.jumpControls,0);assert.equal(body.jumpStyle,version?.jumpStyle||'expressive')
  if(!dev){assert.equal(body.revision,version.revision);assert.match(headers['cache-control'],/no-store/);assert.equal(headers['x-magius-revision'],version.revision)}
  entries.push({requested:base+suffix,actual:base+actual,hash:hash(html),status:response.status(),headers:{cacheControl:headers['cache-control'],revision:headers['x-magius-revision'],'cf-ray':headers['cf-ray']},...body})
 }
 if(remote)assert.equal(new Set(entries.map(e=>e.hash)).size,1,'root and release entry serve different HTML')
 record({test:'exact-entry-cold-and-warm-coherence',production:!!remote,entries})
 await page.touchscreen.tap(...await page.$eval('#locomotion-mode-toggle',e=>{const r=e.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]}));await frames(6)
 assert.equal(await page.$eval('#locomotion-hud',e=>getComputedStyle(e).display),'none');assert.equal(await page.$('#jump-style-control'),null)
 await page.screenshot({path:path.join(out,'phone-no-rollback-no-keyboard-hud.png')})
 await page.evaluate(()=>window.magiusViewerLocomotion.setEnabled(false))
 await page.setViewport({width:1000,height:760,isMobile:false,hasTouch:false,deviceScaleFactor:1})
 for(const id of (process.env.MAGIUS_ONLY_CHARACTER?[Number(process.env.MAGIUS_ONLY_CHARACTER)]:[100107,100201,102001])){
  await page.select('#character-selector',String(id));await page.waitForFunction(id=>window.scene?.characterSelected?.character?.userData?.characterId===id,{timeout:180000},id)
  await page.evaluate(()=>{window.magiusViewerLocomotion.setEnabled(true);window.scene.characterSelected.character.animation.paused=false});await page.evaluate(()=>window.magiusViewerLocomotion.characterActions.ready());await frames(12)
  for(const run of [false,true]){
   const sample=await page.evaluate(async({run})=>{
    const api=window.magiusViewerLocomotion,c=window.scene.characterSelected.character,next=()=>new Promise(r=>requestAnimationFrame(r))
    const get=()=>{const s=api.capabilityManifest().find(s=>s.characterId===c.userData.characterId),bones={};c.object.traverse(n=>{if(/^(?:UpLeg|Leg|Foot|Arm|Forearm)_[LR]$/.test(n.name)&&n.isBone)bones[n.name]=n.quaternion.toArray()});return{state:s.state,grounded:s.grounded,p:s.position,v:s.velocity,clip:s.currentClip,match:c.object.userData.magiusLandingGait,bones,time:c.animation.mixer.time,actions:c.animation.mixer._actions.filter(a=>a.isScheduled()&&a.getEffectiveWeight()>.01).map(a=>({name:a.getClip().name,time:a.time,weight:a.getEffectiveWeight()}))}}
    api.setVirtualInput({moveZ:1,run});for(let i=0;i<30;i++)await next();const before=get()
    api.setVirtualInput({moveZ:1,run,jumpPressed:true});let flew=false,contact=-1;const rows=[]
    for(let i=0;i<150;i++){await next();const row=get();rows.push(row);if(!row.grounded)flew=true;if(flew&&row.grounded&&contact<0)contact=i;if(contact>=0&&i-contact>=18)break}
    api.setVirtualInput({moveZ:0,run:false});for(let i=0;i<30;i++)await next()
    return{before,rows,contact}
   },{run})
   fs.writeFileSync(path.join(out,`${id}-${run?'run':'walk'}-landing.json`),JSON.stringify(sample,null,2))
   assert.ok(sample.contact>0,'jump never completed');const {rows,contact}=sample,first=rows[contact],previous=rows[contact-1],wanted=run?'run':'walk'
   assert.equal(first.state,wanted);assert.ok(!rows.slice(contact).some(r=>r.state==='land'||r.state==='idle'),'a stationary recovery still interrupts gait')
   const speed=r=>Math.hypot(r.v[0],r.v[2]);assert.ok(speed(first)>=speed(previous)*.95,'contact loses speed')
   assert.ok(first.match&&first.match.score<=first.match.zeroPhaseScore+1e-8,'missing evaluated gait-phase match')
   assert.ok(first.match.fadeSeconds>=.12&&first.match.fadeSeconds<=.18)
   const minSpeed=Math.min(...rows.slice(contact).map(speed));assert.ok(minSpeed>=speed(sample.before)*.9)
   const angle=(a,b)=>2*Math.acos(Math.min(1,Math.abs(a.reduce((sum,x,i)=>sum+x*b[i],0))))*180/Math.PI
   let maxContactStep=0,maxStepAt60Hz=0
   // A software-rendered frame may advance 150ms. Measure changes against
   // the actual animation time, not as though every sample were 16.7ms apart.
   for(let i=contact;i<Math.min(rows.length,contact+9);i++)for(const [name,q]of Object.entries(rows[i].bones)){const old=rows[i-1]?.bones[name];if(old){const degrees=angle(q,old),dt=Math.max(1/120,rows[i].time-rows[i-1].time);maxContactStep=Math.max(maxContactStep,degrees);maxStepAt60Hz=Math.max(maxStepAt60Hz,degrees/(dt*60))}}
   assert.ok(maxStepAt60Hz<25,'large time-normalized post-contact bone jump: '+maxStepAt60Hz)
   assert.ok(!rows.at(-1).actions.some(a=>/Jump(?:Takeoff|Airborne)/i.test(a.name)&&a.weight>.02),'airborne pose survives the moving handoff')
   fs.writeFileSync(path.join(out,`${id}-${wanted}-landing.json`),JSON.stringify(sample,null,2))
   record({test:'continuous-moving-landing',id,mode:wanted,beforeSpeed:speed(sample.before),preContactSpeed:speed(previous),contactSpeed:speed(first),minimumAfterSpeed:minSpeed,contactState:first.state,gaitMatch:first.match,maxContactStepDegrees:maxContactStep,maxStepAt60Hz,afterActions:rows.at(-1).actions})
  }
  await page.evaluate(()=>{window.magiusViewerLocomotion.clearVirtualInput();window.magiusViewerLocomotion.setEnabled(false)})
 }
 assert.deepEqual(errors,[]);result={passed:true,base,revision:version?.revision,observations,errors,scope:'Exact production URLs plus real rendered controller frames. Touch/keyboard emulation, not physical phone certification.'}
}catch(error){result={passed:false,base,error:String(error),observations,errors};await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error}
finally{fs.writeFileSync(path.join(out,'entry-landing-browser.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result?.passed,error:result?.error}));if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}}
