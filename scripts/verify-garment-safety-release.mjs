import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

// Explicit safety-release acceptance. This is NOT a zero-clipping cloth test.
const base=process.env.BASE||'http://127.0.0.1:6602/';
const out=path.resolve(process.env.OUT||'artifacts/garment-regression-20261002/safety-source');
fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({
 executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
 headless:true,args:['--disable-extensions','--no-first-run','--disable-background-networking','--disable-background-timer-throttling','--disable-renderer-backgrounding'],
 defaultViewport:{width:1366,height:900},protocolTimeout:180000,
});
const p=await browser.newPage(),rows=[],errors=[],failures=[],downloads=[];
const report={purpose:'native-only-safety-revert; anti-clipping remains incomplete',base,rows,errors,failures,downloads};
const save=()=>fs.writeFileSync(path.join(out,'review.json'),JSON.stringify(report,null,2));
p.on('pageerror',e=>errors.push(String(e)));
p.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure()?.errorText}));
const cdp=await p.createCDPSession();await cdp.send('Page.enable');cdp.on('Page.downloadWillBegin',e=>downloads.push(e.url));
await p.setRequestInterception(true);
p.on('request',r=>/\.(?:bin|gz)(?:[?#]|$)/i.test(r.url())&&!new URL(r.url()).searchParams.has('url')?r.abort():r.continue());
await p.evaluateOnNewDocument(()=>{
 try{localStorage.setItem('magius.garment-contacts.v1','on');localStorage.setItem('magius.safety-test.sentinel','preserve-existing-state');}catch{}
});
const frames=n=>p.evaluate(n=>new Promise((resolve,reject)=>{
 let i=0;const timer=setTimeout(()=>{off();reject(Error('render frame timeout'))},90000);
 const off=scene.addBeforeRenderCallback(()=>{if(++i>=n){off();clearTimeout(timer);resolve()}});
}),n);
const guard=()=>p.evaluate(()=>{
 const api=magiusGarmentContacts;api.setEnabled(true);api.evaluateOnce();
 return{enabled:api.enabled,available:api.available,diagnostics:api.diagnostics(),checkboxDisabled:document.getElementById('garment-contacts-enabled').disabled,
 nativeGravityAvailable:!document.getElementById('pose-gravity-enabled').disabled,sentinel:localStorage.getItem('magius.safety-test.sentinel')};
});
function checkGuard(state){
 assert.equal(state.enabled,false);assert.equal(state.available,false);assert.equal(state.checkboxDisabled,true);
 assert.equal(state.nativeGravityAvailable,true);assert.equal(state.diagnostics.policy,'native-only-safety-revert');
 assert.deepEqual(state.diagnostics.contacts,[]);assert.equal(state.sentinel,'preserve-existing-state');
}
async function screenshot(id,mode){
 await p.evaluate(()=>{window.setRenderPaused(true);window.__cameraSnapshot={position:scene.camera.position.clone(),quaternion:scene.camera.quaternion.clone(),target:scene.controls.target.clone()};});
 for(const [view,x,z]of [['front',.15,3.05],['side',2.8,.3]]){
  await p.evaluate(({x,z})=>{
   const s=scene,a=s.characterSelected.character.object,c=s.camera,center=c.position.clone();a.getWorldPosition(center);center.y+=.82;
   const rotation=c.quaternion.clone();a.getWorldQuaternion(rotation);const offset=c.position.clone().set(x,.2,z).applyQuaternion(rotation);
   c.position.copy(center).add(offset);s.controls.target.copy(center);c.lookAt(center);c.updateMatrixWorld(true);s.selfShadow.render();s.cameraDepth.render();s.renderCurrentFrame();
  },{x,z});
  await p.screenshot({path:path.join(out,`${id}-${mode}-${view}.png`)});
 }
 await p.evaluate(()=>{const s=scene,v=window.__cameraSnapshot;s.camera.position.copy(v.position);s.camera.quaternion.copy(v.quaternion);s.controls.target.copy(v.target);s.camera.updateMatrixWorld(true);setRenderPaused(false)});
}
try{
 await p.goto(base+'?runtimeDelivery=release&diagnostic=pose-editor#101901',{waitUntil:'domcontentloaded',timeout:120000});
 await p.waitForFunction(()=>window.scene?.characterSelected?.character&&window.magiusGarmentContacts,{timeout:180000,polling:250});
 report.device=await p.evaluate(()=>{const gl=scene.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return{gpu:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'',userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight]}});
 report.version=await p.evaluate(async()=>{try{const r=await fetch('/site-version.json',{cache:'no-store'});return r.ok?await r.json():null}catch{return null}});
 checkGuard(await guard());
 for(const id of (process.env.IDS||'101901,102001,114501').split(',')){
  await p.evaluate(()=>{setRenderPaused(false);magiusViewerLocomotion.clearVirtualInput();magiusViewerLocomotion.setEnabled(false)});
  await p.select('#character-selector',id);
  await p.waitForFunction(id=>String(scene.characterSelected?.character?.userData.characterId)===id,{timeout:180000,polling:250},id);
  await p.evaluate(()=>magiusViewerLocomotion.characterActions.ready());await frames(40);
  await p.evaluate(()=>{
   const a=scene.characterSelected.character.object;window.__baseGeometries=[];
   a.traverse(n=>{if(n.isMesh&&n.geometry.getAttribute('position'))window.__baseGeometries.push({mesh:n,geometry:n.geometry,position:n.geometry.getAttribute('position'),values:n.geometry.getAttribute('position').array.slice()})});
   magiusViewerLocomotion.setEnabled(true);
  });
  for(const mode of ['idle','walk','run','jump']){
   await p.evaluate(mode=>magiusViewerLocomotion.setVirtualInput({moveZ:mode==='walk'||mode==='run'?1:0,run:mode==='run'}),mode);await frames(70);
   const data=await p.evaluate(mode=>new Promise((resolve,reject)=>{
    const times=[],floorY=scene.characterSelected.character.object.position.y;let previous=performance.now(),n=0,airFrames=0,maxHeight=-Infinity;
    const timer=setTimeout(()=>{off();reject(Error('benchmark timeout '+mode))},90000);
    const off=scene.addBeforeRenderCallback(()=>{
     const now=performance.now();times.push(now-previous);previous=now;
     const height=scene.characterSelected.character.object.position.y;maxHeight=Math.max(maxHeight,height);if(height>floorY+.02)airFrames++;
     if(mode==='jump'&&n%75===0)magiusViewerLocomotion.setVirtualInput({moveZ:0,jumpPressed:true});
     if(++n>=210){off();clearTimeout(timer);resolve({times,airFrames,maxHeight,diagnostics:magiusGarmentContacts.diagnostics()})}
    });
   }),mode);
   assert.deepEqual(data.diagnostics.contacts,[]);if(mode==='jump')assert.ok(data.airFrames>0,'jump must actually leave the ground');
   const sorted=[...data.times].sort((a,b)=>a-b),row={id,mode,fps:1000*data.times.length/data.times.reduce((a,b)=>a+b,0),frameP95:sorted[Math.floor(sorted.length*.95)],airFrames:data.airFrames,maxHeight:data.maxHeight,extraContactActors:data.diagnostics.contacts.length};
   rows.push(row);console.log(JSON.stringify(row));save();
   if(mode==='jump'){
    await p.evaluate(()=>magiusViewerLocomotion.clearVirtualInput());await frames(100);
    await p.evaluate(()=>new Promise((resolve,reject)=>{const floorY=scene.characterSelected.character.object.position.y;const timeout=setTimeout(()=>{off();reject(Error('jump capture timeout'))},15000);const off=scene.addBeforeRenderCallback(()=>{if(scene.characterSelected.character.object.position.y>floorY+.04){setRenderPaused(true);off();clearTimeout(timeout);resolve()}});magiusViewerLocomotion.setVirtualInput({moveZ:0,jumpPressed:true})}));
   }
   await screenshot(id,mode);checkGuard(await guard());
  }
  const integrity=await p.evaluate(()=>{
   let changedValues=0,changedGeometry=0;for(const item of window.__baseGeometries){if(item.mesh.geometry!==item.geometry||item.mesh.geometry.getAttribute('position')!==item.position)changedGeometry++;const now=item.mesh.geometry.getAttribute('position').array;for(let i=0;i<now.length;i++)if(now[i]!==item.values[i])changedValues++;}
   const actor=scene.characterSelected.character.object,outlines=[];actor.traverse(n=>{if(n.isMesh&&n.name.includes(':official-outline:')&&n.parent?.isMesh)outlines.push(n.geometry.getAttribute('position')===n.parent.geometry.getAttribute('position'))});
   magiusViewerLocomotion.clearVirtualInput();magiusViewerLocomotion.setEnabled(false);magiusGarmentContacts.evaluateOnce();
   return{changedValues,changedGeometry,outlineViews:outlines.length,staleOutlines:outlines.filter(x=>!x).length,contactActors:magiusGarmentContacts.diagnostics().contacts.length};
  });
  assert.equal(integrity.changedValues,0);assert.equal(integrity.changedGeometry,0);assert.equal(integrity.staleOutlines,0);assert.equal(integrity.contactActors,0);rows.push({id,integrity});save();
 }
 const gravity=await p.evaluate(()=>{magiusGarmentContacts.setPoseGravity(true);const enabled=magiusGarmentContacts.diagnostics().gravity.enabled;magiusGarmentContacts.setPoseGravity(false);return{enabled,disabled:!magiusGarmentContacts.diagnostics().gravity.enabled}});
 assert.equal(gravity.enabled,true);assert.equal(gravity.disabled,true);report.nativeGravity=gravity;
 assert.deepEqual(errors,[]);assert.deepEqual(downloads,[]);assert.ok(!failures.some(f=>/\.(?:bin|gz)(?:[?#]|$)/i.test(f.url)),JSON.stringify(failures));
 report.status='PASS_SAFETY_ROLLBACK_NOT_ANTI_CLIPPING_COMPLETION';save();
} catch(error){report.status='FAILED';report.error=String(error);save();throw error}finally{await browser.close()}
