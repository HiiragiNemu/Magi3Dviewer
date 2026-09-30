import fs from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
const out=path.resolve(process.env.MAGIUS_EVIDENCE_DIR||'artifacts/jump-silhouette');fs.mkdirSync(out,{recursive:true})
const base=process.env.MAGIUS_SITE_URL||'https://127.0.0.1:4181/'
const ids=(process.env.MAGIUS_CHARACTERS||'101501').split(',').map(Number)
const b=await puppeteer.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,acceptInsecureCerts:true,protocolTimeout:300000,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const records=[],errors=[]
let passed=false
try{for(const id of ids){
 const p=await b.newPage();await p.setViewport({width:700,height:780,deviceScaleFactor:1});p.on('pageerror',e=>errors.push(String(e)))
 await p.goto(base+'?diagnostic=pose-editor&runtimeDelivery=release',{waitUntil:'domcontentloaded',timeout:90000})
 await p.waitForFunction(()=>window.scene?.characterSelected?.character?.userData?.characterId===100107&&window.magiusViewerLocomotion,{timeout:180000})
 if(id!==100107){await p.select('#character-selector',String(id));await p.waitForFunction(id=>window.scene?.characterSelected?.character?.userData?.characterId===id&&window.scene.characterSelected.character.object.animations.some(a=>a.name.includes('_ExpressiveV1_')),{timeout:180000},id)}
 await p.addStyleTag({content:'#menu,.ve-shell,#viewport-editor,#perf-stat,#locomotion-hud,#tps-touch-controls{visibility:hidden!important}'});
 for(const mode of ['Standing','Walk','Run'])for(const phase of ['Takeoff','Airborne','Land']){
  const info=await p.evaluate(({mode,phase})=>{
   window.__silhouetteDispose?.();const c=window.scene.characterSelected.character,scene=window.scene
   const clip=c.object.animations.find(a=>a.name.includes(mode+'Jump'+phase)&&a.name.includes('_ExpressiveV1_'))
   if(!clip)throw Error('No requested clip '+mode+phase)
   c.animation.paused=true
   const tracks=clip.tracks.map(t=>{const i=t.name.lastIndexOf('.'),id=t.name.slice(0,i),property=t.name.slice(i+1),node=c.object.getObjectByProperty('uuid',id)||c.object.getObjectByName(id);if(!node)throw Error(t.name);return{node,property,sample:t.createInterpolant()}})
   const t=phase==='Airborne'?.45:phase==='Takeoff'?.8:.12
   const hidden=[];c.object.traverse(n=>{if(n.isMesh&&/weapon/i.test(n.name)){hidden.push([n,n.visible]);n.visible=false}})
   const apply=()=>{for(const s of tracks)s.node[s.property].fromArray(s.sample.evaluate(clip.duration*t));c.object.updateMatrixWorld(true);c.object.traverse(n=>{if(n.isSkinnedMesh)n.skeleton.update()})}
   const remove=scene.addBeforeRenderCallback(apply);window.__silhouetteDispose=()=>{remove();for(const[n,v]of hidden)n.visible=v};apply()
   scene.controls.target.set(0,.9,0);scene.camera.position.set(0,1.06,3.05);scene.camera.lookAt(scene.controls.target);scene.controls.update()
   const arms=[]
   for(const side of ['L','R']){
    const bone=name=>c.object.getObjectByName(name+'_'+side)
    const upper=bone('Arm'),forearm=bone('Forearm'),hand=bone('Hand'),middle=bone('Middlefinger1')||bone('MetaMiddlefinger')
    if(!upper||!forearm||!hand||!middle)throw Error('Missing anatomical sample '+side)
    const w=n=>n.getWorldPosition(scene.camera.position.clone()),a=w(forearm).sub(w(upper)).normalize(),f=w(hand).sub(w(forearm)).normalize(),p=w(middle).sub(w(hand)).normalize()
    arms.push({side,elbowDegrees:a.angleTo(f)*180/Math.PI,wristDegrees:f.angleTo(p)*180/Math.PI,upperDirection:a.toArray(),forearmDirection:f.toArray(),palmDirection:p.toArray(),hand:w(hand).toArray()})
   }
   return{clip:clip.name,ratio:t,arms}
  },{mode,phase})
  await new Promise(r=>setTimeout(r,150));await p.screenshot({path:path.join(out,`${id}-${mode}-${phase}-front.png`)})
  await p.evaluate(()=>{window.scene.camera.position.set(2.9,1.05,.4);window.scene.camera.lookAt(window.scene.controls.target);window.scene.controls.update()});await new Promise(r=>setTimeout(r,100));await p.screenshot({path:path.join(out,`${id}-${mode}-${phase}-side.png`)})
  records.push({id,mode,phase,...info});console.log(JSON.stringify(records.at(-1)))
 }
 await p.close()
}
if(process.env.MAGIUS_VERIFY_JUMP_ARMS==='1')for(const id of ids){
 const rows=records.filter(r=>r.id===id);assert.equal(rows.length,9)
 for(const row of rows)for(const arm of row.arms){
  assert.ok(arm.wristDegrees<8,`Wrist alignment failed on ${id}/${row.mode}/${row.phase}: ${arm.wristDegrees}`)
  if(row.mode==='Standing')assert.ok(arm.elbowDegrees<35,`Standing jump has a running elbow pose: ${id}`)
 }
 const w=rows.find(r=>r.mode==='Walk'&&r.phase==='Airborne'),r=rows.find(r=>r.mode==='Run'&&r.phase==='Airborne')
 for(let side=0;side<2;side++)assert.ok(w.arms[side].elbowDegrees<r.arms[side].elbowDegrees*.7,`Walk/run arm amplitude is not distinct: ${id}`)
}
assert.deepEqual(errors,[]);passed=true
}finally{fs.writeFileSync(path.join(out,'silhouette.json'),JSON.stringify({passed,records,errors,scope:'Paused clip samples for arm geometry and visual inspection, not a flight or hardware performance measurement'},null,2)+'\n');await b.close()}
