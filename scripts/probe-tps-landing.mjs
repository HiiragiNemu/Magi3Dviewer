import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
const out=process.env.MAGIUS_EVIDENCE_DIR||'artifacts/tps-landing-probe'
fs.mkdirSync(out,{recursive:true})
const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,acceptInsecureCerts:true,protocolTimeout:300000,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const page=await browser.newPage();await page.setViewport({width:860,height:650,deviceScaleFactor:1})
const errors=[];page.on('pageerror',e=>errors.push(String(e)))
try{
 await page.goto((process.env.MAGIUS_SITE_URL||'https://127.0.0.1:4181/')+'?diagnostic=pose-editor&runtimeDelivery=release',{waitUntil:'domcontentloaded',timeout:90000})
 await page.waitForFunction(()=>window.magiusViewerLocomotion&&window.scene?.characterSelected?.character?.userData?.characterId===100107,{timeout:180000})
 await page.click('#locomotion-mode-toggle')
 const id=Number(process.env.MAGIUS_CHARACTER||100107)
 if(id!==100107){await page.select('#character-selector',String(id));await page.waitForFunction(id=>window.scene?.characterSelected?.character?.userData?.characterId===id,{timeout:180000},id)}
 await page.waitForFunction(()=>window.magiusViewerLocomotion.snapshot().enabled,{timeout:30000})
 const frames=await page.evaluate(async()=>{
  const api=window.magiusViewerLocomotion,rows=[]
  const frame=()=>new Promise(r=>requestAnimationFrame(r))
  api.setVirtualInput({moveZ:1,run:true})
  for(let i=0;i<24;i++)await frame()
  api.setVirtualInput({moveZ:1,run:true,jumpPressed:true})
  for(let i=0;i<150;i++){
   await frame()
   const s=api.capabilityManifest().find(s=>s.characterId===window.scene.characterSelected.character.userData.characterId)
   const c=window.scene.characterSelected.character,m=c.animation.mixer
   rows.push({i,now:performance.now(),state:s.state,grounded:s.grounded,p:s.position,v:s.velocity,clip:s.currentClip,mixerTime:m.time,clipTime:c.animation.time,speed:m.timeScale,root:c.object.position.toArray(),actions:m._actions?.filter(a=>a.enabled&&a.getEffectiveWeight()>.005).map(a=>({n:a.getClip().name,t:a.time,w:a.getEffectiveWeight(),paused:a.paused}))})
   if(i===60)api.setVirtualInput({moveZ:0,run:false})
  }
  api.clearVirtualInput();return rows
 })
 const p=path.join(out,`landing-${id}.json`);fs.writeFileSync(p,JSON.stringify({errors,frames},null,2)+'\n')
 const summary=frames.filter((f,i)=>i===0||f.state!==frames[i-1].state||f.grounded!==frames[i-1].grounded)
 console.log(JSON.stringify({errors,changes:summary,last:frames.at(-1)},null,2))
 await page.screenshot({path:path.join(out,`landing-${id}.png`)})
}catch(error){console.log(JSON.stringify({error:String(error),errors}));await page.screenshot({path:path.join(out,'probe-failure.png')}).catch(()=>{});throw error}
finally{await browser.close()}
