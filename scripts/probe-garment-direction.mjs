import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
const site=process.env.MAGIUS_SITE_URL||'http://127.0.0.1:6595/';
const out=process.env.MAGIUS_EVIDENCE_DIR||'artifacts/garment-v2/baseline';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.connect({browserWSEndpoint:JSON.parse(fs.readFileSync(process.env.MAGIUS_BROWSER_ENDPOINT_FILE||'artifacts/studio/browser.json','utf8')).endpoint,defaultViewport:null,protocolTimeout:240000});
const context=await browser.createBrowserContext(),p=await context.newPage(),rows=[];
const frames=n=>p.evaluate(n=>new Promise(resolve=>{let i=0;function f(){if(++i>=n)resolve();else requestAnimationFrame(f)}requestAnimationFrame(f)}),n);
try{
 await p.setViewport({width:1280,height:900,deviceScaleFactor:1});await p.goto(new URL('?runtimeDelivery=release#102001',site).href,{waitUntil:'domcontentloaded',timeout:120000});
 await p.waitForFunction(()=>window.scene?.characterSelected?.character&&window.magiusGarmentContacts,{timeout:240000,polling:250});
 for(const id of ['102001','101901']){
  await p.select('#character-selector',id);await p.waitForFunction(id=>String(window.scene.characterSelected?.character?.userData.characterId)===id,{timeout:240000,polling:250},id);await p.evaluate(()=>window.magiusViewerLocomotion.characterActions.ready());
  await p.evaluate(()=>{window.magiusGarmentContacts.setEnabled(true);window.magiusViewerLocomotion.setEnabled(true);window.magiusViewerLocomotion.setVirtualInput({moveZ:1,run:true})});
  await p.waitForFunction(()=>window.magiusGarmentContacts.diagnostics().contacts.some(d=>d.uuid===window.scene.characterSelected.character.object.uuid&&d.supported),{timeout:120000,polling:150});
  for(const mode of ['walk','run','jump']){
   const live=await p.evaluate(mode=>new Promise((resolve,reject)=>{const api=window.magiusViewerLocomotion,s=window.scene,id=s.characterSelected.character.userData.characterId;let matched=0;const timeout=setTimeout(()=>{release();reject(Error('motion not reached '+mode))},20000);const release=s.addBeforeRenderCallback(()=>{const state=api.capabilityManifest().find(v=>v.characterId===id);if(state?.state===mode){if(++matched>=(mode==='jump'?1:40)&&(mode!=='jump'||!state.grounded)){window.setRenderPaused(true);release();clearTimeout(timeout);resolve({state:state.state,clip:state.currentClip,grounded:state.grounded})}}});api.setVirtualInput({moveZ:mode==='jump'?0:1,run:mode==='run',jumpPressed:mode==='jump'})}),mode);
   const result=await p.evaluate(()=>{
    const s=window.scene,a=s.characterSelected.character.object,bones=[];a.traverse(n=>{if(n.isBone)bones.push(n)});
    const snapshot=()=>bones.map(n=>({name:n.name,uuid:n.uuid,p:n.position.toArray(),q:n.quaternion.toArray(),s:n.scale.toArray()}));
    window.magiusGarmentContacts.setEnabled(false);const before=snapshot();window.magiusGarmentContacts.setEnabled(true);window.magiusGarmentContacts.evaluateOnce();const after=snapshot();
    const changes=after.flatMap((n,i)=>{const delta=Math.max(...n.q.map((v,k)=>Math.abs(v-before[i].q[k])));return delta>1e-9?[{name:n.name,delta}]:[]});
    const center=a.getWorldPosition(s.controls.target.clone());center.y+=.82;const offset=center.clone().set(.2,.1,3.3).applyQuaternion(a.getWorldQuaternion(s.camera.quaternion.clone()));s.camera.position.copy(center).add(offset);s.controls.target.copy(center);s.camera.lookAt(center);s.camera.updateMatrixWorld(true);s.selfShadow.render();s.cameraDepth.render();s.renderCurrentFrame();
    return{changes,diag:window.magiusGarmentContacts.diagnostics().contacts.find(d=>d.uuid===a.uuid),before,after};
   });
   rows.push({id,mode,live,...result});fs.writeFileSync(path.join(out,'poses.json'),JSON.stringify(rows));await p.screenshot({path:path.join(out,id+'-'+mode+'.png')});console.log(JSON.stringify({id,mode,changes:result.changes,diag:result.diag}));
   await p.evaluate(()=>{window.magiusViewerLocomotion.clearVirtualInput();window.magiusViewerLocomotion.setVirtualInput({moveZ:0});window.setRenderPaused(false)});await frames(40);
  }
  await p.evaluate(()=>{window.magiusViewerLocomotion.clearVirtualInput();window.magiusViewerLocomotion.setEnabled(false)});await frames(5);
 }
}finally{await p.evaluate(()=>{window.setRenderPaused?.(false);window.magiusViewerLocomotion?.clearVirtualInput()}).catch(()=>{});await context.close();browser.disconnect()}
