import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import puppeteer from 'puppeteer-core';
const out=process.env.MAGIUS_EVIDENCE_DIR||'artifacts/garment-v2/continuous';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.connect({browserWSEndpoint:JSON.parse(fs.readFileSync(process.env.MAGIUS_BROWSER_ENDPOINT_FILE||'artifacts/studio/browser.json','utf8')).endpoint,defaultViewport:null,protocolTimeout:240000}),context=await browser.createBrowserContext(),p=await context.newPage(),errors=[],rows=[];p.on('pageerror',e=>errors.push(String(e)));let passed=false;
const frames=n=>p.evaluate(n=>new Promise(resolve=>{let i=0;function next(){if(++i>=n)resolve();else requestAnimationFrame(next)}requestAnimationFrame(next)}),n);
try{
 await p.setViewport({width:1280,height:900,deviceScaleFactor:1});await p.goto(new URL('?runtimeDelivery=release&diagnostic=pose-editor#102001',process.env.MAGIUS_SITE_URL||'http://127.0.0.1:6595/').href,{waitUntil:'domcontentloaded',timeout:120000});await p.waitForFunction(()=>window.scene?.characterSelected?.character&&window.magiusGarmentContacts,{timeout:240000,polling:250});
 await p.evaluate(async()=>{
  const resource=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/viewer/garmentContacts.ts');if(!resource)throw Error('No live contact module resource');const {StableGarmentContacts}=await import(resource.name);const original=StableGarmentContacts.prototype.solve;
  window.__clothAudit={rows:[],watched:undefined,bodyDelta:0,bodyChanges:[],samples:0};
  StableGarmentContacts.prototype.solve=function(...args){
   const audit=window.__clothAudit;if(this.root!==audit.watched||!args[0]||!(args[2]>0))return original.apply(this,args);
   const bones=[];this.root.traverse(n=>{if(n.isBone)bones.push(n)});const raw=bones.map(n=>({name:n.name,p:n.position.toArray(),q:n.quaternion.toArray(),s:n.scale.toArray()})),now=performance.now(),result=original.apply(this,args);
   const body=[];bones.forEach((n,i)=>{if(/skirt|dress|coat|mantle|cape|hem|cloth/i.test(n.name))return;const delta=Math.max(...n.position.toArray().map((v,k)=>Math.abs(v-raw[i].p[k])),...n.quaternion.toArray().map((v,k)=>Math.abs(v-raw[i].q[k])),...n.scale.toArray().map((v,k)=>Math.abs(v-raw[i].s[k])));if(delta!==0)body.push({name:n.name,delta})});
   audit.samples++;if(body.length)audit.bodyChanges.push(...body);audit.bodyDelta=Math.max(audit.bodyDelta,...body.map(b=>b.delta));
   if(audit.rows.length<1200)audit.rows.push({time:now,dt:args[2],raw:raw.filter(n=>/skirt|dress|coat|mantle|cape|hem|cloth/i.test(n.name)),display:bones.filter(n=>/skirt|dress|coat|mantle|cape|hem|cloth/i.test(n.name)).map(n=>({name:n.name,q:n.quaternion.toArray()})),stats:result});return result;
  };
  const originalSurface=StableGarmentContacts.prototype.projectSurface;
  StableGarmentContacts.prototype.projectSurface=function(...args){
   const audit=window.__clothAudit;if(this.root!==audit.watched)return originalSurface.apply(this,args);
   const protectedPositions=this.surface?.geometries.map(g=>{const allowed=new Set(this.surface.vertices.filter(v=>v.position===g.position).flatMap(v=>v.indices));return{g,allowed}})??[];
   const result=originalSurface.apply(this,args);
   for(const {g,allowed}of protectedPositions)for(let i=0;i<g.position.count;i++){if(allowed.has(i))continue;const o=i*3;for(let k=0;k<3;k++)if(g.position.array[o+k]!==g.base[o+k])audit.bodyChanges.push({name:'body vertex '+i,delta:g.position.array[o+k]-g.base[o+k]})}
   if(audit.rows.length)audit.rows.at(-1).stats=result;return result;
  };
 });
 for(const id of ['102001','101901']){
  await p.select('#character-selector',id);await p.waitForFunction(id=>String(window.scene.characterSelected?.character?.userData.characterId)===id,{timeout:240000,polling:250},id);await p.evaluate(()=>window.magiusViewerLocomotion.characterActions.ready());
  await p.evaluate(()=>{window.magiusGarmentContacts.setEnabled(true);window.magiusViewerLocomotion.setEnabled(true);window.__clothAudit.watched=window.scene.characterSelected.character.object});
  for(const [mode,input]of [['walk',{moveZ:1}],['run',{moveZ:1,run:true}],['jump',{moveZ:0,jumpPressed:true}],['reverse',{moveZ:-1}],['rest',{moveZ:0}]]){
   await p.evaluate(input=>{window.__clothAudit.rows=[];window.__clothAudit.samples=0;window.__clothAudit.bodyChanges=[];window.__clothAudit.bodyDelta=0;window.magiusViewerLocomotion.setVirtualInput(input)},input);
   await frames(mode==='rest'?360:180);
   const data=await p.evaluate(()=>({rows:window.__clothAudit.rows,samples:window.__clothAudit.samples,bodyDelta:window.__clothAudit.bodyDelta,bodyChanges:window.__clothAudit.bodyChanges}));
   fs.writeFileSync(path.join(out,id+'-'+mode+'.json'),JSON.stringify(data));assert.ok(data.samples>100,'hook did not observe live frames: '+data.samples);assert.equal(data.bodyDelta,0,'body modified by clothes');assert.deepEqual(data.bodyChanges,[]);
   const bodyRows=data.rows;const values=key=>bodyRows.map(r=>r.stats[key]).sort((a,b)=>a-b),ms=values('milliseconds'),maxDepth=values('afterDepth'),before=values('beforeDepth');
   const angles=(key)=>{const output=[];for(let i=1;i<bodyRows.length;i++){let max=0;for(let j=0;j<bodyRows[i][key].length;j++){const a=bodyRows[i][key][j].q,b=bodyRows[i-1][key][j].q,dot=Math.min(1,Math.abs(a.reduce((n,v,k)=>n+v*b[k],0))/Math.hypot(...a)/Math.hypot(...b));max=Math.max(max,2*Math.acos(dot))}output.push(max)}return output};
   const rawChanges=angles('raw'),displayChanges=angles('display'),tail=displayChanges.slice(-90),row={id,mode,frames:data.samples,bodyDelta:data.bodyDelta,solveMs:{p50:ms[Math.floor(ms.length*.5)],p95:ms[Math.floor(ms.length*.95)],max:ms.at(-1)},depth:{beforeP95:before[Math.floor(before.length*.95)],afterP95:maxDepth[Math.floor(maxDepth.length*.95)],max:maxDepth.at(-1),surfaceRemaining:Math.max(...bodyRows.map(r=>r.stats.surface?.remainingDepth??0))},rotation:{rawMax:Math.max(...rawChanges),displayMax:Math.max(...displayChanges),tailMax:Math.max(...tail)}};
   assert.ok(bodyRows.every(r=>Number.isFinite(r.stats.afterDepth)&&r.stats.maxRotation<=.400001));
   if(mode==='rest')assert.ok(row.rotation.tailMax<.01,'persistent stationary cloth vibration '+row.rotation.tailMax);
   rows.push(row);fs.writeFileSync(path.join(out,id+'-'+mode+'.json'),JSON.stringify(data));fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(row));
   await p.evaluate(()=>{const s=window.scene,a=s.characterSelected.character.object,center=a.getWorldPosition(s.controls.target.clone());center.y+=.8;const offset=center.clone().set(.3,.1,3.4).applyQuaternion(a.getWorldQuaternion(s.camera.quaternion.clone()));s.camera.position.copy(center).add(offset);s.controls.target.copy(center);s.camera.lookAt(center);window.magiusViewerLocomotion.adoptCamera?.();});
   if(mode==='jump')await p.evaluate(()=>window.magiusViewerLocomotion.clearVirtualInput());
  }
  await p.evaluate(()=>{window.__clothAudit.watched=undefined;window.magiusViewerLocomotion.clearVirtualInput();window.magiusViewerLocomotion.setEnabled(false)});await frames(10);
 }
 assert.deepEqual(errors,[]);passed=true;
}finally{fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({passed,rows,errors},null,2));await p.evaluate(()=>{window.setRenderPaused?.(false);window.magiusViewerLocomotion?.clearVirtualInput()}).catch(()=>{});await context.close();browser.disconnect()}
