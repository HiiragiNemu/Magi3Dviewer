import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const out=process.env.MAGIUS_EVIDENCE_DIR||'artifacts/resume-20261002/scenes-baseline'
fs.mkdirSync(out,{recursive:true})
const inventory=JSON.parse(fs.readFileSync('artifacts/resume-20261002/stage-ui-inventory.json','utf8'))
const indexes=(process.env.MAGIUS_SCENE_INDEXES||'8,36,204,241,269,297,311,325,339,353,367,381,395,398,402,407').split(',').map(Number)
const targets=indexes.map(i=>inventory.find(r=>r.enabledIndex===i)).filter(Boolean)
const browser=await puppeteer.connect({browserWSEndpoint:JSON.parse(fs.readFileSync(process.env.MAGIUS_BROWSER_ENDPOINT_FILE||'artifacts/resume-20261002/browser.json')).endpoint,defaultViewport:null,protocolTimeout:240000})
const context=await browser.createBrowserContext(),page=await context.newPage(),results=[]
const site=process.env.MAGIUS_SITE_URL||'https://magius3dviewer.pages.dev/'
let errors=[],responses=[]
page.on('pageerror',e=>errors.push(String(e)))
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
page.on('response',r=>{if(r.status()>=400)responses.push({url:r.url(),status:r.status()})})
const save=()=>fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({site,results},null,2))
try{
 await page.setViewport({width:1100,height:760,deviceScaleFactor:1})
 await page.goto(new URL('?runtimeDelivery=release&diagnostic=pose-editor#102001',site).href,{waitUntil:'domcontentloaded',timeout:120000})
 await page.waitForFunction(()=>window.scene?.characterSelected?.character&&document.querySelector('#stage-selector')?.options.length>500,{timeout:240000})
 await page.select('#language-toggle','zh-CN')
 for(const target of targets){
  errors=[];responses=[];const start=Date.now();let failure=''
  console.log('START',target.enabledIndex,target.id)
  try{
   await page.select('#stage-selector',target.id)
   await page.waitForFunction(id=>{const root=window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot');return root?.userData.stageDefinition?.id===id||!!root?.userData.stageLoadFailure},{timeout:90000,polling:250},target.id)
   await page.waitForFunction(()=>{const root=window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot');return !!root?.userData.stageLoadFailure||root?.userData.stageVisibleContent?.drawProbeComplete},{timeout:20000,polling:250})
  }catch(e){failure=String(e)}
  // Give loaded asynchronous texture/animation operators a bounded settling
  // window; eligibility and load success are recorded separately from pixels.
  await new Promise(r=>setTimeout(r,1800))
  const state=await page.evaluate(()=>{
   const s=window.scene,root=s.backgroundScene.getObjectByName('Magius3DviewerStageRoot'),children=root?.children||[],materials=[],maps=[];let visible=0,total=0
   const isVisible=n=>{for(let p=n;p;p=p.parent)if(!p.visible)return false;return true}
   root?.traverse(n=>{if(!n.isMesh)return;total++;if(isVisible(n))visible++;for(const m of Array.isArray(n.material)?n.material:[n.material]){if(!m)continue;materials.push({mesh:n.name,name:m.name,type:m.type,color:m.color?.getHexString(),transparent:m.transparent,opacity:m.opacity,side:m.side});for(const [key,v]of Object.entries({...m,...Object.fromEntries(Object.entries(m.uniforms||{}).map(([k,v])=>[k,v.value]))})){if(v?.isTexture){const image=v.image;maps.push({mesh:n.name,material:m.name,key,name:v.name,url:image?.src,width:image?.width,height:image?.height,colorSpace:v.colorSpace})}}}})
   return {rootData:root?.userData,childData:children.map(c=>({name:c.name,data:c.userData})),total,visible,materials,maps,camera:{p:s.camera.position.toArray(),q:s.camera.quaternion.toArray(),target:s.controls.target.toArray(),fov:s.camera.fov,far:s.camera.far},background:s.backgroundScene.background?.isColor?s.backgroundScene.background.getHexString():s.backgroundScene.background?.type}
  }).catch(e=>({error:String(e)}))
  const row={index:target.enabledIndex,id:target.id,label:target.label,seconds:(Date.now()-start)/1000,failure,errors:[...errors],responses:[...responses],state}
  const stem=String(target.enabledIndex).padStart(3,'0')+'-'+target.id
  await page.screenshot({path:path.join(out,stem+'.png')}).catch(()=>{})
  fs.writeFileSync(path.join(out,stem+'.json'),JSON.stringify(row,null,2));results.push({...row,state:{total:state.total,visible:state.visible,camera:state.camera,loadFailure:state.rootData?.stageLoadFailure,actual:state.rootData?.stageDefinition?.id,materialTypes:[...new Set(state.materials?.map(m=>m.type))],mapCount:state.maps?.length}});save()
  console.log('END',target.id,JSON.stringify(results.at(-1)))
 }
}finally{save();await context.close();browser.disconnect()}
