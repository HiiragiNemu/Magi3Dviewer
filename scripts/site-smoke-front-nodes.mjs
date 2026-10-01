import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const site=new URL(process.env.MAGIUS_SITE_URL||'http://127.0.0.1:6595/')
assert.ok(['localhost','127.0.0.1'].includes(site.hostname)||/^(?:[a-f0-9]+\.)?magius3dviewer\.pages\.dev$/.test(site.hostname))
const out=path.resolve(process.env.MAGIUS_EVIDENCE_DIR||'artifacts/front-node-layout/browser')
fs.mkdirSync(out,{recursive:true})
const endpoint=process.env.MAGIUS_BROWSER_ENDPOINT_FILE||'artifacts/node-tps/browser.json'
const browser=await puppeteer.connect({browserWSEndpoint:JSON.parse(fs.readFileSync(endpoint)).endpoint,protocolTimeout:240000,defaultViewport:null})
const rows=[],errors=[];let context,p,passed=false
const record=row=>{rows.push(row);fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({rows,errors},null,2));console.log(row.test,'PASS')}
const overlaps=chips=>{const result=[];for(let i=0;i<chips.length;i++)for(let j=i+1;j<chips.length;j++){const a=chips[i].box,b=chips[j].box,area=Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y));if(area>2)result.push([chips[i].key,chips[j].key,area])}return result}
try{
 context=await browser.createBrowserContext();p=await context.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.setViewport({width:1366,height:900,deviceScaleFactor:1,isMobile:false,hasTouch:false})
 const frames=n=>p.evaluate(n=>new Promise(resolve=>{let i=0;const f=()=>++i>=n?resolve():requestAnimationFrame(f);requestAnimationFrame(f)}),n)
 const click=async selector=>{await p.waitForSelector(selector,{visible:true,timeout:30000});await p.click(selector);await frames(5)}
 const shot=name=>p.screenshot({path:path.join(out,name+'.png')})
 const camera=()=>p.evaluate(()=>({p:window.scene.camera.position.toArray(),t:window.scene.controls.target.toArray(),q:window.scene.camera.quaternion.toArray()}))
 const allBones=()=>p.evaluate(()=>{const values=[];window.scene.characterSelected.character.object.traverse(n=>{if(n.isBone)values.push([n.uuid,...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray()])});return values})
 const state=()=>p.evaluate(()=>{
  const s=window.scene,a=s.characterSelected.character.object,r=s.renderer.domElement.getBoundingClientRect(),byId=new Map();a.traverse(n=>byId.set(n.uuid,n))
  const joints=[...document.querySelectorAll('.ve-joint-node')].filter(e=>e.getClientRects().length).map(e=>{const bone=byId.get(e.dataset.boneUuid);if(!bone)throw Error('Joint belongs to a different actor');const v=bone.getWorldPosition(s.camera.position.clone()).project(s.camera),c=e.parentElement;return{id:e.dataset.viewportJoint,name:bone.name,uuid:bone.uuid,label:e.textContent,aria:e.getAttribute('aria-label'),key:c.dataset.layoutKey,region:c.dataset.primaryRegion,role:c.dataset.nodeRole,box:c.getBoundingClientRect().toJSON(),anchor:[Number(e.dataset.anchorX),Number(e.dataset.anchorY)],expected:[r.left+(v.x+1)*r.width/2,r.top+(1-v.y)*r.height/2]}})
  const chips=[...document.querySelectorAll('#viewport-editor .ve-chip')].filter(e=>e.getClientRects().length).map(e=>({key:e.dataset.layoutKey,box:e.getBoundingClientRect().toJSON()}))
  return{joints,chips,view:{width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,menu:document.querySelector('#menu').getBoundingClientRect().bottom},mirror:document.querySelector('#viewport-editor').dataset.primaryView}
 })
 const identities=s=>s.joints.map(j=>[j.id,j.name,j.label,j.box.x,j.box.y])
 const checkPrimary=s=>{
  assert.equal(s.joints.length,18)
  assert.ok(!s.joints.some(j=>/^(Hip|Spine)$/i.test(j.name)))
  const head=s.joints.find(j=>j.id==='head'),neck=s.joints.find(j=>j.id==='neck'),waist=s.joints.find(j=>j.id==='waist'),chest=s.joints.find(j=>j.id==='chest')
  assert.equal(head.region,'top');assert.equal(neck.region,'top');assert.ok(Math.abs(head.box.y-neck.box.y)<1);assert.ok(head.box.x<neck.box.x)
  assert.equal(waist.region,'bottom');assert.ok(Math.abs(waist.box.y-chest.box.y)<1)
  for(const role of ['shoulder','upper-arm','elbow','hand','upper-leg','knee','foot']){
   const l=s.joints.find(j=>j.id==='right-'+role),r=s.joints.find(j=>j.id==='left-'+role)
   assert.ok(l.name.endsWith('_R')&&l.label.startsWith('左'));assert.ok(r.name.endsWith('_L')&&r.label.startsWith('右'))
   assert.equal(l.region,'left');assert.equal(r.region,'right');assert.ok(Math.abs(l.box.y-r.box.y)<1)
   assert.ok(s.mirror==='back'?l.box.x>r.box.x:l.box.x<r.box.x)
  }
  for(const region of ['left','right'])for(const roles of [['shoulder','upper-arm','elbow','hand'],['upper-leg','knee','foot']]){
   const list=roles.map(role=>s.joints.find(j=>j.region===region&&j.role===role));for(let i=1;i<list.length;i++)assert.ok(list[i].box.y>list[i-1].box.y)
  }
  assert.ok(s.joints.every(j=>Math.hypot(j.anchor[0]-j.expected[0],j.anchor[1]-j.expected[1])<.5))
  assert.ok(s.view.scroll<=s.view.width+1)
  assert.ok(s.chips.every(c=>c.box.x>=-1&&c.box.right<=s.view.width+1&&c.box.y>=s.view.menu-1&&c.box.bottom<=s.view.height+1),'out-of-viewport control')
  assert.deepEqual(overlaps(s.chips),[],'default controls overlap')
 }
 await p.goto(new URL('?diagnostic=pose-editor&runtimeDelivery=release#100107',site).href,{waitUntil:'domcontentloaded',timeout:120000})
 await p.waitForFunction(()=>window.scene?.characterSelected?.character&&window.magiusPoseInspection,{timeout:180000,polling:100})
 await p.select('#language-toggle','zh-CN');await p.select('#character-selector','100107');await p.waitForFunction(()=>Number(window.scene.characterSelected?.character?.userData.characterId)===100107,{timeout:180000,polling:100})
 if(process.env.MAGIUS_EXPECTED_REVISION){const v=await p.evaluate(async()=>(await fetch('/site-version.json',{cache:'no-store'})).json());assert.equal(v.revision,process.env.MAGIUS_EXPECTED_REVISION);record({test:'production-version',version:v})}
 await click('#position-controls-toggle');await click('#viewport-pose');await click('#viewport-focus');await frames(8)
 const front=await state();checkPrimary(front);await shot('front-fixed-columns');record({test:'front-reference-layout',state:front})
 const before=await allBones(),cameraBefore=await camera();await click('#viewport-mirror-layout');const reverse=await state();checkPrimary(reverse)
 assert.deepEqual(await allBones(),before);assert.deepEqual(await camera(),cameraBefore)
 for(const a of front.joints){const z=reverse.joints.find(j=>j.id===a.id);assert.equal(z.label,a.label);assert.equal(z.uuid,a.uuid);assert.ok(Math.abs(z.box.y-a.box.y)<1);if(['left','right'].includes(a.region))assert.ok(Math.abs(a.box.x+z.box.x+a.box.width-front.view.width)<1);else assert.equal(z.box.x,a.box.x)}
 await click('#viewport-mirror-layout');assert.deepEqual(identities(await state()),identities(front));record({test:'manual-back-swap-layout-only',bonesAndCameraUnchanged:true})
 // Crucial regression: close in front, approach from behind, THEN enter pose editing.
 await click('#viewport-editor-close');await p.evaluate(()=>{const s=window.scene;s.cameraRotation=0;const t=s.controls.target;s.camera.position.set(t.x,t.y+.2,t.z-3.5);s.controls.update()});await frames(5)
 await click('#position-controls-toggle');await click('#viewport-pose');const backEntry=await state();checkPrimary(backEntry);assert.deepEqual(identities(backEntry),identities(front));await shot('opened-from-back-fixed-names')
 await p.evaluate(()=>{const s=window.scene,t=s.controls.target;s.camera.position.set(t.x,t.y+.2,t.z+3.5);s.controls.update()});await frames(8);const backToFront=await state();checkPrimary(backToFront);assert.deepEqual(identities(backToFront),identities(front));await shot('back-entry-return-to-front');record({test:'back-entry-return-to-front',state:backToFront})
 for(const yaw of [.7,1.6,2.9,-.9]){await p.evaluate(yaw=>{const s=window.scene,t=s.controls.target;s.camera.position.set(t.x+Math.sin(yaw)*3.5,t.y+.2,t.z+Math.cos(yaw)*3.5);s.controls.update()},yaw);await frames(5);const s=await state();checkPrimary(s);assert.deepEqual(identities(s),identities(front))}
 record({test:'four-camera-angles-do-not-relabel-or-reorder',angles:4})
 await click('#viewport-focus');const cf=await camera();await click('[data-viewport-joint="waist"]');assert.deepEqual(await camera(),cf)
 await click('#viewport-more');const categories=await p.$$eval('#viewport-node-category option',es=>es.map(e=>({value:e.value,text:e.textContent})));assert.ok(categories.some(c=>c.value==='torso'));await p.select('#viewport-node-category','torso');await frames(5)
 const choices=await p.$$eval('#viewport-node-chain option',es=>es.map(e=>({value:e.value,text:e.textContent}))),sp=choices.find(c=>c.text==='脊柱根部');assert.ok(sp,'the real Spine control has been lost');await p.select('#viewport-node-chain',sp.value);await frames(5);assert.equal((await state()).joints[0].name,'Spine');assert.deepEqual(await camera(),cf);await shot('lower-spine-retained-in-details');record({test:'waist-main-spine-details-no-sticky-focus',choices})
 await click('#viewport-hands');await p.select('#viewport-node-category','left');await frames(5);const hands=await state();assert.ok(hands.joints.every(j=>j.name.endsWith('_R')&&j.label.startsWith('左')));await click('#viewport-focus-detail');const once=await camera();await p.select('#viewport-node-category','right');await frames(5);assert.deepEqual(await camera(),once);assert.ok((await state()).joints.every(j=>j.name.endsWith('_L')&&j.label.startsWith('右')));await shot('hand-names-same-front-convention');record({test:'hand-convention-and-one-shot-focus'})
 await click('#viewport-editor-close')
 for(const [width,height]of [[360,780],[430,932],[932,430],[1366,900]]){
  await p.setViewport({width,height,deviceScaleFactor:1,isMobile:width<1000,hasTouch:width<1000});await p.waitForFunction(()=>window.scene?.characterSelected?.character&&window.magiusPoseInspection,{timeout:180000,polling:100})
  await p.select('#character-selector','100107');await p.waitForFunction(()=>Number(window.scene.characterSelected?.character?.userData.characterId)===100107,{timeout:180000,polling:100})
  if(await p.$eval('#viewport-editor',e=>!e.hidden))await click('#viewport-editor-close')
  await click('#position-controls-toggle');await click('#viewport-pose');await click('#viewport-joints');await click('#viewport-focus');await frames(5)
  const s=await state();checkPrimary(s);const h=s.joints.find(j=>j.id==='head');assert.ok(h.anchor[1]>h.box.bottom+20,'focused head remains underneath the head/neck control row');await shot('primary-front-'+width+'x'+height);record({test:'responsive-primary-'+width+'x'+height,state:s})
  await click('#viewport-mirror-layout');checkPrimary(await state());await click('#viewport-mirror-layout')
  await click('#viewport-editor-close')
 }
 assert.deepEqual(errors,[]);passed=true
}finally{
 if(p&&!passed){await p.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure-dom.txt'),await p.evaluate(()=>document.body.innerText).catch(()=>''));fs.writeFileSync(path.join(out,'failure-chips.json'),JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('#viewport-editor .ve-chip')].filter(e=>e.getClientRects().length).map(e=>({key:e.dataset.layoutKey,box:e.getBoundingClientRect().toJSON()}))).catch(()=>[]),null,2))}
 fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({passed,rows,errors},null,2));if(context)await context.close();browser.disconnect()
}
