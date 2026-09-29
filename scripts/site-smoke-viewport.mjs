import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {execFileSync} from 'node:child_process'
import puppeteer from 'puppeteer-core'
const output=path.resolve(process.env.MAGIUS_DEPLOY_OUT_DIR||'dist-deploy')
const evidence=path.resolve(process.env.MAGIUS_EVIDENCE_DIR||'artifacts/viewport-browser')
fs.mkdirSync(evidence,{recursive:true})
const remote=process.env.MAGIUS_SITE_URL
if(remote)assert.match(remote,/^https:\/\/(?:[a-f0-9]{8}\.)?magius3dviewer\.pages\.dev\/$/)
const development=process.env.MAGIUS_VIEWPORT_DEV === '1'
assert.ok(!(development && remote))
const base=remote||(development?'https://127.0.0.1:4181/':'http://127.0.0.1:4180/')
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'}
let server,browser,page
const errors=[],missing=[],observations=[]
const record=value=>{observations.push(value);console.log(JSON.stringify(value));fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({observations,errors,missing},null,2))}
const pause=ms=>new Promise(r=>setTimeout(r,ms))
let result
try{
 if(!remote&&!development){server=http.createServer((req,res)=>{let rel;try{rel=decodeURIComponent(new URL(req.url,base).pathname).replace(/^\/+/, '')||'index.html'}catch{res.writeHead(400).end();return}const p=path.resolve(output,rel);if(!p.startsWith(output+path.sep)){res.writeHead(403).end();return}try{if(!fs.statSync(p).isFile())throw Error();res.setHeader('Content-Type',mime[path.extname(p)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');fs.createReadStream(p).on('error',()=>res.destroy()).pipe(res)}catch{res.writeHead(404).end('Missing '+rel)}});await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(4180,'127.0.0.1',resolve)})}
 const chrome=process.env.CHROME_BIN||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':execFileSync('bash',['-lc','command -v google-chrome-stable || command -v google-chrome || command -v chromium'],{encoding:'utf8'}).trim())
 browser=await puppeteer.launch({executablePath:chrome,headless:true,acceptInsecureCerts:development,protocolTimeout:240000,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage();await page.setViewport({width:1366,height:900,deviceScaleFactor:1})
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('response',r=>{if(r.status()>=400)missing.push({status:r.status(),url:r.url()})})
 await page.goto(base+'?diagnostic=pose-editor&runtimeDelivery=release',{waitUntil:'domcontentloaded',timeout:90000})
 await page.waitForFunction(()=>window.scene?.characterSelected?.character?.userData?.characterId===100107&&window.magiusPoseInspection,{timeout:180000})
 await page.waitForSelector('#viewport-editor-launch',{visible:true,timeout:30000})
 const frames=n=>page.evaluate(n=>new Promise(resolve=>{let i=0;const tick=()=>++i>=n?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick)}),n)
 const inspect=()=>page.evaluate(()=>window.magiusPoseInspection())
 const click=async selector=>{await page.waitForSelector(selector,{visible:true,timeout:20000});await page.click(selector);await frames(3)}
 const card=()=>page.$eval('#viewport-editor-dock',el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,overflow:el.scrollWidth-el.clientWidth}})
 record({test:'initial-position',ground:await page.evaluate(()=>window.magiusGroundInspection?.()),actor:await page.evaluate(()=>window.scene.characterSelected.character.object.position.toArray())})
 await click('#viewport-editor-launch');assert.equal(await page.$eval('#action-parameter-panel',e=>e.classList.contains('is-open')),false)
 assert.equal(await page.$eval('#viewport-move',e=>e.getAttribute('aria-pressed')),'true')
 await click('#viewport-rotate');assert.equal(await page.$eval('#viewport-rotate',e=>e.getAttribute('aria-pressed')),'true')
 record({test:'selected-position',ground:await page.evaluate(()=>window.magiusGroundInspection?.())})
 record({test:'whole-object-context-menu',card:await card(),world:await page.evaluate(()=>{const s=window.scene,o=s.characterSelected.character.object,meshes=[];o.traverse(m=>{if(m.isMesh)meshes.push({name:m.name,visible:m.visible,p:m.position.toArray(),s:m.scale.toArray(),min:m.boundingBox?.min?.toArray(),max:m.boundingBox?.max?.toArray()})});return{p:o.position.toArray(),s:o.scale.toArray(),camera:s.camera.position.toArray(),target:s.controls.target.toArray(),meshes:meshes.filter(m=>(m.min?.[1]??0)<-0.1||/weapon|wpn|bow/i.test(m.name))}})})
 await click('#viewport-pose');assert.equal((await inspect()).editing,true);assert.equal(await page.evaluate(()=>window.scene.controls.enabled),true)
 await click('#viewport-focus')
 const pin=async id=>page.$eval(`[data-viewport-joint="${id}"]`,e=>{const r=e.getBoundingClientRect();if(e.hidden||r.width<1)throw Error('Joint node not visible: '+e.dataset.viewportJoint);return{x:r.x+r.width/2,y:r.y+r.height/2}})
 let p=await pin('right-hand');await page.mouse.click(p.x,p.y);await frames(4)
 assert.equal((await inspect()).mode,'translate')
 const beforeDrag=await inspect();p=await pin('right-hand');await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+42,p.y-34,{steps:12});await frames(3);await page.mouse.up();await frames(12)
 const afterDrag=await inspect();const map=new Map(beforeDrag.bones.map(b=>[b.uuid,b]));const changed=afterDrag.bones.filter(b=>/^(Arm_[LR]|Forearm_[LR]|Hand_[LR]|UpLeg_[LR]|Leg_[LR]|Foot_[LR])$/.test(b.name)&&map.has(b.uuid)&&b.quaternion.some((x,i)=>Math.abs(x-map.get(b.uuid).quaternion[i])>1e-4))
 assert.ok(changed.length>0,'Real joint-node drag must edit skeletal rotations')
 for(const b of afterDrag.bones){const old=map.get(b.uuid);if(old&&/^(Root|Hip|Spine|Waist|Chest|Head|Neck|Arm_[LR]|Forearm_[LR]|Hand_[LR]|UpLeg_[LR]|Leg_[LR]|Foot_[LR])$/.test(b.name)){assert.deepEqual(b.position,old.position,'Node drag resized '+b.name);assert.deepEqual(b.scale,old.scale,'Node drag scaled '+b.name)}}
 assert.equal(await page.evaluate(()=>window.scene.controls.enabled),true)
 assert.equal(afterDrag.dragging,false)
 record({test:'panel-closed-visible-joint-drag',changed:changed.map(b=>b.name),nodes:await page.$$eval('.ve-joint-node',n=>n.map(e=>e.dataset.viewportJoint))})
 await page.screenshot({path:path.join(evidence,'viewport-pose-desktop.png'),fullPage:true})
 await click('#theme-set-light')
 await page.screenshot({path:path.join(evidence,'viewport-pose-light.png'),fullPage:true})
 await click('#viewport-parameters');await page.waitForSelector('#action-parameter-panel.is-open',{visible:true})
 await page.screenshot({path:path.join(evidence,'compact-parameters.png'),fullPage:true})
 await click('#bone-parameter-details > summary')
 await page.$eval('#action-parameter-panel .floating-panel-scroll',e=>{e.scrollTop=150})
 const scrollBefore=await page.$eval('#action-parameter-panel .floating-panel-scroll',e=>e.scrollTop)
 p=await pin('left-hand');await page.mouse.click(p.x,p.y);await frames(3)
 const scrollAfter=await page.$eval('#action-parameter-panel .floating-panel-scroll',e=>e.scrollTop)
 assert.ok(Math.abs(scrollBefore-scrollAfter)<2,'Selecting a hand scrolled the parameter panel')
 assert.equal(await page.$eval('#action-selected-part-visibility',e=>e.disabled),true,'A hand selection must not enable whole-Body_Mesh hiding')
 assert.equal(await page.$$eval('.model-part-select',n=>n.some(e=>/official-outline/.test(e.textContent))),false)
 const layout=await page.$eval('#action-parameter-panel',e=>({width:e.getBoundingClientRect().width,overflow:e.querySelector('.floating-panel-scroll').scrollWidth-e.querySelector('.floating-panel-scroll').clientWidth}))
 assert.ok(layout.width<=462&&layout.overflow<=1,JSON.stringify(layout))
 await page.screenshot({path:path.join(evidence,'parameter-scroll-preserved.png'),fullPage:true})
 record({test:'no-jump-no-mesh-hide-compact-panel',scrollBefore,scrollAfter,layout})
 await click('#action-panel-close');assert.equal((await inspect()).editing,true)
 assert.ok(await page.$eval('[data-viewport-joint="left-hand"]',e=>!e.hidden))
 // Empty canvas moves only the view, not the selected joint.
 const camera=()=>page.evaluate(()=>({p:window.scene.camera.position.toArray(),q:window.scene.camera.quaternion.toArray(),target:window.scene.controls.target.toArray()}))
 const beforeCamera=await camera(),poseBeforeCamera=await inspect()
 await page.mouse.move(150,320);await page.mouse.down();await page.mouse.move(290,410,{steps:12});await page.mouse.up();await frames(20)
 const afterCamera=await camera(),poseAfterCamera=await inspect()
 assert.ok(afterCamera.p.some((x,i)=>Math.abs(x-beforeCamera.p[i])>.01),'Blank drag must orbit during pose editing')
 const stable=new Map(poseBeforeCamera.bones.map(b=>[b.uuid,b.quaternion]));for(const b of poseAfterCamera.bones)if(stable.has(b.uuid)&&/^(Root|Hip|Spine|Waist|Chest|Head|Neck|Arm_[LR]|Forearm_[LR]|Hand_[LR]|UpLeg_[LR]|Leg_[LR]|Foot_[LR])$/.test(b.name))assert.ok(b.quaternion.every((x,i)=>Math.abs(x-stable.get(b.uuid)[i])<1e-4),'Camera drag changed '+b.name)
 await page.mouse.move(150,320);await page.mouse.down({button:'right'});await page.mouse.move(190,355,{steps:8});await page.mouse.up({button:'right'});await frames(10)
 const pan=await camera();assert.ok(pan.target.some((x,i)=>Math.abs(x-afterCamera.target[i])>.005),'Right drag must pan during editing')
 record({test:'orbit-and-pan-while-editing',before:beforeCamera,after:afterCamera,pan})
 // Controls are found and hovered geometrically; this never sets their axis.
 await click('#viewport-object');await click('#viewport-move')
 const gizmo=()=>page.evaluate(()=>{const scene=window.scene,roots=[];scene.scene.traverse(n=>{if(n.isTransformControlsRoot&&n.visible&&n.controls?.enabled&&n.controls.object===scene.characterSelected?.character?.object)roots.push(n)});const root=roots[0];if(!root)return null;const rect=scene.renderer.domElement.getBoundingClientRect(),points=[];root.traverse(n=>{if(!n.isMesh||!/^[XYZ]$/.test(n.name))return;for(let p=n;p;p=p.parent)if(!p.visible)return;const pos=n.geometry.getAttribute('position');if(!pos)return;for(let i=0;i<pos.count;i+=Math.max(1,Math.floor(pos.count/16))){const v=scene.camera.position.clone().fromBufferAttribute(pos,i).applyMatrix4(n.matrixWorld).project(scene.camera);points.push({axis:n.name,x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2,z:v.z})}});return{axis:root.controls.axis,mode:root.controls.mode,points}})
 let chosen
 for(const point of (await gizmo()).points.filter(p=>p.axis==='Y'&&Math.abs(p.z)<=1&&p.x>30&&p.x<1300&&p.y>90&&p.y<860)){const hit=await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',point);if(!hit)continue;await page.mouse.move(point.x,point.y);await pause(25);if((await gizmo()).axis==='Y'){chosen=point;break}}
 assert.ok(chosen,'Whole-object Y handle must be pointer-accessible')
 const actorBefore=await page.evaluate(()=>window.scene.characterSelected.character.object.position.toArray())
 await page.mouse.down();await page.mouse.move(chosen.x,Math.min(870,chosen.y+360),{steps:16});await page.mouse.up();await frames(10)
 const actorAfter=await page.evaluate(()=>window.scene.characterSelected.character.object.position.toArray())
 const bodyBottom=await page.evaluate(()=>{const m=window.scene.characterSelected.character.object.getObjectByName('Body_Mesh');return m.boundingBox.clone().applyMatrix4(m.matrixWorld).min.y})
 assert.ok(actorAfter[1]>=-0.015-1e-5,'Whole-character drag crossed the authored sky-reference floor at Y=-0.015')
 assert.ok(bodyBottom>=-0.015-1e-4,'Visible character geometry crossed the floor')
 record({test:'whole-object-floor-contact',chosen,before:actorBefore,after:actorAfter,bodyBottom})
 await click('#viewport-pose')
 await page.mouse.move(130,700);await page.mouse.down();await page.mouse.move(140,115,{steps:18});await page.mouse.up();await frames(20)
 const cameraLow=await camera();assert.ok(cameraLow.p[1]>=-0.015+.079,'Orbit camera crossed the floor')
 record({test:'camera-floor',camera:cameraLow})
 // Responsive controls and independent close: one UI does not secretly close the other.
 for(const size of [{width:430,height:932},{width:360,height:780}]){await page.setViewport({...size,deviceScaleFactor:1});await frames(5);const c=await card();assert.ok(c.x>=0&&c.y>=0&&c.x+c.w<=size.width+1&&c.y+c.h<=size.height+1&&c.overflow<=1,JSON.stringify(c));record({test:'responsive-card',size,card:c})}
 await page.screenshot({path:path.join(evidence,'viewport-mobile.png'),fullPage:true})
 await click('#viewport-editor-collapse');assert.equal((await inspect()).editing,true)
 assert.ok((await card()).h<65,'Collapsed tools must leave the viewport free')
 assert.equal(await page.$eval('.ve-joints',e=>e.hidden),false)
 await page.screenshot({path:path.join(evidence,'viewport-mobile-collapsed.png'),fullPage:true})
 await click('#viewport-editor-close');assert.equal((await inspect()).editing,false)
 assert.equal(await page.evaluate(()=>window.scene.controls.enabled),true)
 await page.waitForSelector('#viewport-editor-launch',{visible:true})
 assert.equal(await page.$eval('#viewport-editor-dock',e=>e.hidden),true)
 record({test:'explicit-close-and-reentry',passed:true})
 await page.setViewport({width:1366,height:900,deviceScaleFactor:1})
 await page.goto(base+'?diagnostic=pose-editor&runtimeDelivery=release',{waitUntil:'domcontentloaded',timeout:90000})
 await page.waitForFunction(()=>window.scene?.characterSelected?.character?.userData?.characterId===100107&&window.magiusJointLimitInspection,{timeout:180000})
 await click('#viewport-editor-launch');await click('#viewport-pose');await click('#viewport-focus')
 // Isolate toolbar input on a fresh page, before any camera gesture has
 // started Orbit damping. Previous floor-test inertia is not toolbar input.
 await click('#viewport-editor-collapse')
 const dockBefore=await card(),cameraBeforeDock=await camera()
 const handle=await page.$eval('#viewport-editor-dock .ve-drag-handle',e=>{const r=e.getBoundingClientRect();return{x:r.left+40,y:r.top+12}})
 await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(handle.x+12,handle.y-150,{steps:8});await page.mouse.up();await frames(3)
 const dockAfter=await card();assert.ok(dockAfter.y<dockBefore.y-100,'The viewport tool must be draggable')
 const cameraAfterDock=await camera()
 record({test:'collapsed-tool-keeps-editing-and-drags',before:dockBefore,after:dockAfter,cameraBefore:cameraBeforeDock,cameraAfter:cameraAfterDock})
 assert.ok(cameraBeforeDock.p.every((v,i)=>Math.abs(v-cameraAfterDock.p[i])<1e-4),'Dragging the toolbar moved the camera')
 assert.equal((await inspect()).editing,true)
 await click('#viewport-editor-collapse')
 const stableNames=/^(Root|Hip|Spine|Waist|Chest|Head|Neck|Arm_[LR]|Forearm_[LR]|Hand_[LR]|UpLeg_[LR]|Leg_[LR]|Foot_[LR])$/
 const stress=[]
 for(const [joint,dx,dy] of [['right-hand',-170,-150],['left-hand',180,80],['right-foot',30,220],['left-foot',-50,210],['right-elbow',55,30],['left-knee',-45,30]]){
   const q=await pin(joint);await page.mouse.click(q.x,q.y);await frames(2)
   const start=await inspect(),point=await pin(joint)
   await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(Math.max(15,Math.min(1350,point.x+dx)),Math.max(90,Math.min(870,point.y+dy)),{steps:12});await page.mouse.up();await frames(5)
   const end=await inspect(),beforeById=new Map(start.bones.map(b=>[b.uuid,b]))
   for(const b of end.bones)if(stableNames.test(b.name)&&beforeById.has(b.uuid)){assert.deepEqual(b.position,beforeById.get(b.uuid).position,'Extreme edit resized '+b.name);assert.deepEqual(b.scale,beforeById.get(b.uuid).scale);assert.ok(b.quaternion.every(Number.isFinite))}
   const limits=await page.evaluate(()=>window.magiusJointLimitInspection())
   for(const limit of limits.filter(s=>s.hinge))assert.ok(limit.flexion>=-1e-5&&limit.flexion<=limit.maximumFlexion+1e-5,'Elbow/knee limit exceeded: '+JSON.stringify(limit))
   const nodeWorld=await page.evaluate(id=>{const name=id==='left-foot'?'Foot_L':'Foot_R',o=window.scene.characterSelected.character.object,b=o.getObjectByName(name);return b?.getWorldPosition(window.scene.camera.position.clone()).toArray()},joint)
   if(joint.includes('foot'))assert.ok(nodeWorld[1]>=-0.015+0.06,'Direct foot drag crossed the floor: '+nodeWorld)
   stress.push({joint,mode:end.mode,limited:await page.$eval('.ve-guard',e=>e.classList.contains('is-limited')),hinges:limits.filter(s=>s.hinge).map(s=>({name:s.name,flexion:s.flexion,maximum:s.maximumFlexion})),footPosition:joint.includes('foot')?nodeWorld:undefined})
 }
 record({test:'extreme-limb-edits-lengths-hinges-floor',cases:stress})
 p=await pin('right-hand');await page.mouse.click(p.x,p.y);await frames(2);await click('#viewport-rotate')
 const wristBefore=await inspect();p=await pin('right-hand');await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+55,p.y-35,{steps:10});await page.mouse.up();await frames(4)
 const wristAfter=await inspect();assert.equal(wristAfter.mode,'rotate','Clicking a selected node must not silently return to XYZ')
 assert.ok(wristAfter.bones.some(b=>b.name==='Hand_R'&&wristBefore.bones.find(x=>x.uuid===b.uuid)?.quaternion.some((v,i)=>Math.abs(v-b.quaternion[i])>1e-5)),'Rotation-ring mode node gesture did not rotate the wrist')
 await click('#viewport-fine');await click('[data-nudge-axis="x"][data-nudge-sign="1"]');await click('#viewport-undo');await click('#viewport-redo')
 const steady=await inspect();await frames(40);const idle=await inspect(),byId=new Map(steady.bones.map(b=>[b.uuid,b]))
 for(const b of idle.bones)if(stableNames.test(b.name)&&byId.has(b.uuid))assert.ok(b.quaternion.every((v,i)=>Math.abs(v-byId.get(b.uuid).quaternion[i])<1e-4),'Limited pose drifted while idle: '+b.name)
 await page.screenshot({path:path.join(evidence,'bounded-extreme-pose.png'),fullPage:true})
 record({test:'wrist-mode-fine-undo-redo-stable',stableFrames:40})
 await page.select('#character-add-selector','100201')
 await page.waitForFunction(()=>String(window.scene?.characterSelected?.character?.userData?.characterId)==='100201',{timeout:180000})
 await frames(6)
 if(await page.$eval('#viewport-editor-launch',e=>!e.hidden))await click('#viewport-editor-launch')
 await click('#viewport-pose');await click('#viewport-focus')
 p=await pin('left-hand');await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+35,p.y-25,{steps:8});await page.mouse.up();await frames(5)
 assert.equal((await inspect()).actorCount,2)
 assert.equal(await page.evaluate(()=>window.scene.controls.enabled),true)
 record({test:'second-character-editor-rebind',actorCount:2,character:100201,selected:await page.$eval('#viewport-editor-selection',e=>e.textContent)})
 assert.equal(errors.filter(e=>/ReferenceError|TypeError|SyntaxError|GL_INVALID|VALIDATE_STATUS/i.test(e)).length,0,errors.join('\n'))
 result={passed:true,site:base,renderer:'Chrome ANGLE SwiftShader, not a user GPU benchmark',observations,errors,missing}
}catch(error){result={passed:false,site:base,error:String(error),observations,errors,missing};await page?.screenshot({path:path.join(evidence,'viewport-failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{fs.writeFileSync(path.join(evidence,'viewport-browser.json'),JSON.stringify(result,null,2));if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}}
