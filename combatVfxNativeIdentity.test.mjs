import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const candidate=path.dirname(fileURLToPath(import.meta.url))
const repo=process.env.VFX_REPO ?? candidate
const actionRoot=process.env.ACTION_CUE_CANDIDATE_ROOT ?? 'C:/Users/proje/Documents/Codex/2026-09-12/codex-threads-01a06bac-2bc0-7011-8471/outputs/combat-native-cue-producer-repair/modified'
const require=createRequire(path.join(repo,'package.json'))
const ts=require('typescript')
const THREE=await import(pathToFileURL(path.join(repo,'node_modules/three/build/three.module.js')))
const {FBXLoader}=await import(pathToFileURL(path.join(repo,'node_modules/three/examples/jsm/loaders/FBXLoader.js')))
const sourceRoot=process.env.VFX_SOURCE_ROOT ?? candidate
const read=rel=>fs.readFileSync(path.join(repo,rel),'utf8')
const official101901=JSON.parse(read('src/viewer/characterActions/data/official-combat-101901-runtime.json'))
const actionManifest=JSON.parse(read('public/character-actions/combat-jump/manifest.v1.json'))
const actionEntries=actionManifest.entries.filter(e=>e.groupId==='official-combat-complete-actions')
const readBinary=url=>{
 const relative=new URL(url,'http://fixture/').pathname.replace(/^\//,'')
 const file=path.resolve(repo,'public',relative)
 assert.ok(file.startsWith(path.resolve(repo,'public')+path.sep),'fixture path confinement')
 let data=fs.readFileSync(file)
 if(data[0]===31&&data[1]===139)data=zlib.gunzipSync(data)
 return data
}
const products=[
 ['101901','e','vfx/chara_101901/e/product.json'],
 ['101901','q','vfx/chara_101901/q/product.json'],
 ['100101','q','vfx/character/chara_100101_normalattack_00/product.vfxdata'],
 ['100101','e','vfx/character/chara_100101_wholeskill_00/product.vfxdata'],
 ['100201','q','vfx/character/chara_100201_normalattack_00/product.vfxdata'],
 ['100201','e','vfx/character/chara_100201_singleskill_00/product.vfxdata'],
].map(([id,key,url])=>({id,key,url,product:JSON.parse(readBinary(url))}))

function functions(source,names){
 const ast=ts.createSourceFile('fixture.ts',source,ts.ScriptTarget.Latest,true)
 const found=[]
 function visit(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))found.push(n.getText(ast));ts.forEachChild(n,visit)}visit(ast)
 assert.equal(found.length,names.length)
 return found.join('\n')
}
function compile(code,dependencies,globals={}){
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
 const exports={}
 new Function('exports','require',...Object.keys(globals),js)(exports,name=>{
  assert.ok(name in dependencies,`unbound fixture import ${name}`);return dependencies[name]
 },...Object.values(globals))
 return exports
}
const originalsLoad=THREE.TextureLoader.prototype.load
globalThis.window={URL:globalThis.URL}
THREE.TextureLoader.prototype.load=function(){return new THREE.Texture()}
const actors=new Map()
for(const id of ['101901','100101','100201']){
 const bytes=zlib.gunzipSync(fs.readFileSync(path.join(repo,`magia-exedra-character-three/models/chara_${id}_battle_unit/VisualRoot.fbx.gz`)))
 const actor=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 actor.userData.characterId=Number(id);actor.updateMatrixWorld(true);actors.set(id,actor)
}
THREE.TextureLoader.prototype.load=originalsLoad

function harness(id){
 const actor=actors.get(id)
 actor.position.set(1,0,-2);actor.quaternion.identity();actor.scale.setScalar(1)
 const scene={scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(45,1,.01,200),characters:[],effects:{
  bloomPass:{enabled:false,strength:1,radius:.7,threshold:.8},
  urpBloomPass:{enabled:true,intensity:1,scatter:.7,threshold:.8,clamp:65472,maxIterations:6,tint:new THREE.Color(1,1,1)},
  backgroundColorAdjustPass:{enabled:false,uniforms:{uEnabled:{value:0},uBackgroundTint:{value:new THREE.Color(1,1,1)}}}},
  addBeforeRenderCallback(callback){this.frame=callback;return ()=>{this.frame=undefined}},
 }
 scene.effects.combatVfxScreenPass={setState(value){this.state=value}}
 const character={object:actor,userData:{characterId:Number(id),meshes:[]}}
 scene.characters.push({character});scene.characterSelected={character};scene.scene.add(actor)
 scene.camera.position.set(0,3,10);scene.camera.lookAt(0,1,0);scene.camera.updateMatrixWorld(true)
 let clock=0,blocked=false,release
 const texturePaths=new Set()
 const document=new EventTarget(),window={}
 const globals={document,window,performance:{now:()=>clock},fetch:async url=>new Response(readBinary(url)),CustomEvent}
 class FixtureTextureLoader {
  async loadAsync(url){
   const b=readBinary(url);texturePaths.add(new URL(url).pathname)
   assert.equal(b.subarray(1,4).toString(),'PNG','texture input is a real local PNG')
   const texture=new THREE.Texture({width:b.readUInt32BE(16),height:b.readUInt32BE(20)})
   return texture
  }
 }
 const deps={three:{...THREE,TextureLoader:FixtureTextureLoader}}
 deps['magia-exedra-character-three/coordinateSpace']=compile(read('magia-exedra-character-three/coordinateSpace.ts'),{},globals)
 deps['./stageHierarchy']=compile(read('src/viewer/stageHierarchy.ts'),deps,globals)
 deps['./stageParticles']=compile(read('src/viewer/stageParticles.ts'),deps,globals)
 deps['./combatVfxCatalog']=compile(read('src/viewer/combatVfxCatalog.ts'),deps,globals)
 deps['./combatVfxScreenEffects']={EMPTY_COMBAT_VFX_SCREEN_STATE:{kawaseBlend:0,kawasePasses:1,kawaseDownsample:1,kawaseOffset:0,radialBlend:0,radialPower:0,radialCenter:[.5,.5],chromaticBlend:0,chromaticOffsetX:0}}
 deps['magia-exedra-character-three/shaders']={DepthRimExperiment:{additionalDirectionVS:new THREE.Vector2(),additionalColor:new THREE.Color()},toonStylizationOptions:{characterTint:'#ffffff',characterShadowTint:'#ffffff',characterLightingOverrideColor:'#ffffff',characterLightingOverrideRatio:0},getMeshToonStylizationUniforms:()=>[],getReDriveCharacterLightingDirectionState:()=>({enabled:false,eulerDegrees:[0,0,0]}),setReDriveCharacterLightingOverrideDirection:()=>{}}
 deps['./runtimeProductDelivery']={resolvePageAssetUrl:url=>new URL(url,'http://fixture/').href,resolveRuntimeAssetUrl:async url=>new URL(url,'http://fixture/').href,resolveCachedRuntimeAssetUrl:url=>url}
 deps['magia-exedra-character-three/utils']={fetchAndTryDecompressGzip:async url=>{
  if(blocked)await new Promise(resolve=>{release=resolve})
  return new Blob([readBinary(url)])
 }}
 const code=fs.readFileSync(path.join(sourceRoot,'src/viewer/combatVfx.ts'),'utf8')
 const api=compile(code+'\nexport const __test = { consumeCueDetail, activeInstances, resolveMainTargetBinding };',deps,globals)
 api.installCombatVfxRuntime(scene)
 // Execute the released ACTION identity-only producer. This is the exact
 // helper used by the candidate viewerLocomotion start path, not a legacy
 // metadata table or a test-side payload decorator.
 const nativeCueSource=fs.readFileSync(path.join(actionRoot,'src/viewer/combatNativeActionCue.ts'),'utf8')
 const nativeCueModule=compile(nativeCueSource+'\nexport { nativeCombatActionCue }',{},globals)
 const send=fixture=>{
  const p=fixture.product
  const entries=actionEntries.filter(e=>e.characterIdentity.characterId===fixture.id&&e.skill.bundleLogicalKey===p.bundleLogicalPath&&e.skill.directionName===p.effectId&&e.skill.skillUniqueId===String(p.skillUniqueId)&&e.skill.skillMstId===String(p.skillMstId))
  assert.equal(entries.length,1)
  const produced=nativeCueModule.nativeCombatActionCue(entries[0],fixture.id)
  assert.ok(produced,`ACTION producer did not emit ${entries[0].id}`)
  const definition=produced.cue
  const detail={characterId:fixture.id,actionId:entries[0].id,actionSequence:1,cueId:definition.id,effectId:definition.effectId,actionTimeSeconds:definition.timeSeconds,payload:definition.payload}
  let cue;document.addEventListener(api.COMBAT_VFX_CUE_EVENT,event=>{cue=event.detail},{once:true})
  document.dispatchEvent(new CustomEvent(api.COMBAT_VFX_CUE_EVENT,{detail}))
  return cue
 }
 const settle=async(rejectedBefore=0)=>{for(let i=0;i<100;i++){await new Promise(setImmediate);const state=api.getCombatVfxDebugState();if(state.active.length||state.rejectedCount>rejectedBefore)return}throw Error('cue did not settle')}
 return {api,scene,actor,texturePaths,send,settle,block(){blocked=true},async unblock(){while(!release)await new Promise(setImmediate);blocked=false;release()},step(seconds){clock+=seconds*1000;scene.frame()},dispose(){api.stopCombatVfx();api.installCombatVfxRuntime(scene)()}}
}

for(const fixture of products)test(`${fixture.id} ${fixture.key}: ACTION cue factory -> native product consumer/particles/target/lifetime`,async()=>{
 const h=harness(fixture.id)
 try{
  const cue=h.send(fixture);await h.settle();let state=h.api.getCombatVfxDebugState()
  assert.equal(state.lastError,null);assert.equal(state.active.length,1)
  assert.equal(cue.effectId,fixture.product.effectId)
  assert.equal(state.active[0].targetBinding,'actor-facing')
  const target=state.active[0].targetWorldPosition;assert.ok(target)
  assert.ok(Math.abs(new THREE.Vector3(...target).distanceTo(h.actor.position)-4)<1e-7)
  const samples=[],phases=new Set(),phasePeaks={};let peakParticles=0,travelPositions=[]
  // Authored Playable speed tracks alter wall duration. Bound by 60 seconds,
  // but drive the original timelineSpeed rather than overriding it to one.
  for(let frame=0;frame<60*120;frame++){
   h.step(1/120);state=h.api.getCombatVfxDebugState();const active=state.active[0]
   if(!active)break
   assert.deepEqual(active.targetWorldPosition,target,'target is fixed through lifecycle')
   active.activePhases.forEach(p=>phases.add(p));peakParticles=Math.max(peakParticles,active.activeParticles)
   for(const c of active.controlPhases.filter(c=>c.active&&!c.missingAnchor)){
    const vertices=c.particleDrawables.filter(d=>d.visible).reduce((n,d)=>n+d.activeVertexCount,0)
    phasePeaks[c.role]=Math.max(phasePeaks[c.role]??0,vertices)
   }
   assert.ok(!(h.scene.effects.bloomPass.enabled&&h.scene.effects.urpBloomPass.enabled))
   if(frame%60===0)samples.push({time:active.timelineTime,particles:active.activeParticles,phases:active.activePhases,target:active.targetWorldPosition,missing:active.missingAnchors})
   const instance=[...h.api.__test.activeInstances.values()][0]
   const tween=instance?.tweens.find(t=>!t.missingAnchor&&instance.timelineTime>=t.clip.start&&instance.timelineTime<=t.clip.end)
   if(tween)travelPositions.push(tween.binding.getWorldPosition(new THREE.Vector3()).toArray())
  }
  assert.ok(peakParticles>0,'real StageParticleRuntimeController spawned CPU particles')
  assert.ok(phases.has('impact'),'native target control activated')
  assert.ok(phasePeaks['main-target']>0,'active target controls contain real particle vertices')
  let travelDistance=0
  if(fixture.id==='101901'&&fixture.key==='e'){
   for(const phase of ['self','projectile','travel','impact'])assert.ok(phases.has(phase),phase)
   assert.ok(phasePeaks.prefab>0,'projectile has active CPU draw vertices')
   travelDistance=new THREE.Vector3(...travelPositions[0]).distanceTo(new THREE.Vector3(...travelPositions.at(-1)))
   assert.ok(travelDistance>1,'native tween binding moves toward the fixed hit anchor')
  }
  assert.equal(state.active.length,0);assert.equal(state.completedCount,1)
  assert.equal(h.scene.scene.children.filter(o=>o.name.startsWith('CombatVfx:')).length,0)
  assert.equal(h.scene.effects.bloomPass.enabled,false);assert.equal(h.scene.effects.urpBloomPass.enabled,true)
  console.log('MATRIX '+JSON.stringify({id:fixture.id,key:fixture.key,product:fixture.product.vfxKey,cue:cue.effectId,result:'PASS',scope:'CPU_CONSUMER_ONLY',cueMetadata:fixture.id==='101901'?'actual configured official runtime':'native product identity test seam; ACTION registration absent',peakParticles,phasePeaks,travelDistance,phases:[...phases],texturePaths:h.texturePaths.size,samples,completion:state.completedCount,gpuDraw:'PENDING_BROWSER',animationPlayback:'PENDING_BROWSER'}))
 }finally{h.dispose()}
})

test('cue snapshot survives delayed product load, actor turns/moves and camera movement',async()=>{
 const h=harness('101901');h.block()
 try{
  h.actor.rotation.y=Math.PI/2;h.actor.updateMatrixWorld(true)
  const original=h.actor.position.clone();h.send(products[0])
  h.actor.position.set(30,2,40);h.actor.rotation.y=-Math.PI/2;h.scene.camera.position.set(40,30,20)
  await h.unblock();await h.settle();const s=h.api.getCombatVfxDebugState()
  assert.equal(s.lastError,null)
  const target=new THREE.Vector3(...s.active[0].targetWorldPosition)
  assert.ok(target.distanceTo(original.clone().add(new THREE.Vector3(4,0,0)))<1e-5)
  const instance=[...h.api.__test.activeInstances.values()][0]
  h.api.setCombatVfxMainTarget(null)
  assert.deepEqual(h.api.getCombatVfxDebugState().active[0].targetWorldPosition,target.toArray())
  h.api.stopCombatVfx();assert.equal(instance.facingTarget,undefined);assert.equal(instance.target,undefined);assert.equal(instance.anchorCache.size,0)
 }finally{h.dispose()}
})

test('explicit and scene enemy retain priority; self/own child never becomes a target',async()=>{
 const h=harness('101901')
 try{
  const enemy=new THREE.Object3D();enemy.userData.enemyMstId=654001;enemy.position.set(8,0,0);h.scene.scene.add(enemy)
  h.send(products[0]);await h.settle();assert.equal(h.api.getCombatVfxDebugState().active[0].targetBinding,'scene-enemy')
  const explicit=new THREE.Object3D();h.api.setCombatVfxMainTarget(explicit)
  assert.equal(h.api.getCombatVfxDebugState().active[0].targetBinding,'explicit')
  h.api.setCombatVfxMainTarget(h.actor.getObjectByName('Hip'))
  assert.equal(h.api.getCombatVfxDebugState().active[0].targetBinding,'scene-enemy')
  enemy.removeFromParent();h.api.setCombatVfxMainTarget(h.actor)
  assert.equal(h.api.getCombatVfxDebugState().active[0].targetBinding,'actor-facing')
 }finally{h.dispose()}
})

test('missing product and replaced actor during load remain typed rejected with no leaked hierarchy',async()=>{
 const h=harness('101901')
 try{
  const cue={characterId:'101901',actionId:'key:e',actionSequence:1,cueId:'missing',effectId:'absent',actionTimeSeconds:0,payload:{schema:'magius-viewer-combat-vfx-slot-v1',bundleKey:'battle/skill/ABSENT',directionName:'absent',skillUniqueId:null,skillMstId:null}}
  const missing=await h.api.__test.consumeCueDetail(cue);assert.equal(missing.status,'rejected');assert.match(missing.error,/absent or not runtime-ready/)
  h.block();h.send(products[0]);h.scene.characters.length=0;h.scene.characterSelected=undefined
  await h.unblock();await h.settle(1);assert.equal(h.api.getCombatVfxDebugState().active.length,0)
  assert.match(h.api.getCombatVfxDebugState().lastError,/actor is ambiguous or absent/)
  assert.equal(h.scene.scene.children.filter(o=>o.name.startsWith('CombatVfx:')).length,0)
 }finally{h.dispose()}
})

test('actual parent rotation and scale still give four world Viewer units',async()=>{
 const h=harness('101901')
 try{
  const parent=new THREE.Group();parent.position.set(5,2,3);parent.rotation.y=Math.PI/2;parent.scale.setScalar(2)
  h.scene.scene.add(parent);parent.add(h.actor);h.actor.rotation.y=Math.PI/2;parent.updateMatrixWorld(true)
  const position=h.actor.getWorldPosition(new THREE.Vector3())
  h.send(products[0]);await h.settle();const state=h.api.getCombatVfxDebugState()
  assert.equal(state.lastError,null)
  const target=new THREE.Vector3(...state.active[0].targetWorldPosition)
  assert.ok(target.distanceTo(position.clone().add(new THREE.Vector3(0,0,-4)))<1e-5)
 }finally{h.dispose()}
})

test('unknown facing rig is typed rejected rather than guessing +Z or a self anchor',async()=>{
 const h=harness('101901')
 try{
  const actor=new THREE.Object3D();actor.userData.characterId=101901
  h.scene.characters[0].character.object=actor
  const p=products[0].product
  const result=await h.api.__test.consumeCueDetail({characterId:'101901',actionId:'key:e',actionSequence:1,cueId:'test',effectId:p.effectId,actionTimeSeconds:0,payload:{schema:'magius-viewer-combat-vfx-slot-v1',bundleKey:p.bundleLogicalPath,skillUniqueId:p.skillUniqueId,skillMstId:p.skillMstId}})
  assert.equal(result.status,'rejected');assert.match(result.error,/target-required product|identity mismatch/)
  assert.equal(h.api.getCombatVfxDebugState().active.length,0)
 }finally{h.dispose()}
})

test('typed nonbattle actor never gains an automatic front-point target',async()=>{
 const h=harness('101901')
 try{
  h.actor.userData.nonBattleCharacter={sourceFamily:'story-cutscene'}
  const enemy=new THREE.Object3D();enemy.userData.enemyMstId=654001;h.scene.scene.add(enemy)
  h.send(products[0]);await h.settle()
  const state=h.api.getCombatVfxDebugState()
  assert.equal(state.active.length,0);assert.match(state.lastError,/automatic cue is unavailable for typed nonbattle actor/)
 }finally{delete h.actor.userData.nonBattleCharacter;h.dispose()}
})

function identityGate(){
 const src=fs.readFileSync(path.join(sourceRoot,'src/viewer/combatVfx.ts'),'utf8')
 if(!/function normalizedCombatSkillId\(/.test(src))return undefined
 const code=functions(src,['normalizedCombatSkillId','sameCombatSkillId','nativeActionIdentityKey','combatVfxCueProductIdentityMatches'])
 const hierarchy=compile(read('src/viewer/stageHierarchy.ts'),{three:THREE})
 return compile(code+'\nexport { combatVfxCueProductIdentityMatches, normalizedCombatSkillId }',{}, {record:value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{},resolveStageHierarchyPath:hierarchy.resolveStageHierarchyPath})
}
const characterProducts=JSON.parse(read('public/vfx/catalog.v1.json')).entries.filter(e=>e.domain==='character').map(entry=>({entry,product:JSON.parse(readBinary(entry.productUrl))}))
const nativeRows=actionEntries.flatMap(entry=>{
 const rows=characterProducts.filter(p=>p.product.bundleLogicalPath===entry.skill.bundleLogicalKey)
 if(!rows.length)return []
 assert.equal(rows.length,1)
 return [{entry,product:rows[0].product}]
})
function nativeCue(entry){return {
 characterId:entry.characterIdentity.characterId,
 actionId:'viewer-combat-skeleton:'+entry.id,actionSequence:1,cueId:entry.id+':1',effectId:entry.skill.directionName,actionTimeSeconds:0,
 payload:{schema:'magius-viewer-combat-vfx-slot-v1',sourceActionId:entry.id,characterIdentity:structuredClone(entry.characterIdentity),directionName:entry.skill.directionName,bundleKey:entry.skill.bundleLogicalKey,skillUniqueId:entry.skill.skillUniqueId,skillMstId:entry.skill.skillMstId},
}}
function identityActor(id){
 const actor=actors.get(id)??new THREE.Object3D();actor.userData.characterId=Number(id)
 return actor
}

test('all 213 native character products and 238 declared action identity tuples pass without rewriting records',(t)=>{
 const gate=identityGate();if(!gate)return t.skip('baseline has no native identity consumer');assert.equal(characterProducts.length,213);assert.equal(nativeRows.length,238)
 let aliases=0,scalarRepresentations=0
 for(const {entry,product} of nativeRows){
  const cue=nativeCue(entry),actor=identityActor(cue.characterId)
  const before=JSON.stringify({product,cue})
  assert.equal(gate.combatVfxCueProductIdentityMatches(product,cue,actor,'character'),true,entry.id)
  assert.equal(JSON.stringify({product,cue}),before,'raw serialized records retained')
  if(String(product.skillUniqueId)!==entry.skill.skillUniqueId||String(product.skillMstId)!==entry.skill.skillMstId)aliases++
  const numeric=structuredClone(cue);numeric.payload.skillUniqueId=Number(cue.payload.skillUniqueId);numeric.payload.skillMstId=Number(cue.payload.skillMstId)
  assert.equal(gate.combatVfxCueProductIdentityMatches(product,numeric,actor,'character'),true,'equivalent safe number representation')
  scalarRepresentations++
 }
 assert.equal(aliases,25)
 console.log('IDENTITY_MATRIX '+JSON.stringify({products:213,tuples:238,aliases,numericStringEquivalent:scalarRepresentations,positive:238,rawUnchanged:238}))
})

test('238 native identities reject wrong actor, skill, bundle, direction, action ID and mixed style tuple',(t)=>{
 const gate=identityGate();if(!gate)return t.skip('baseline has no native identity consumer');let rejected=0
 for(const {entry,product} of nativeRows){
  const cue=nativeCue(entry),actor=identityActor(cue.characterId)
  const mutations=[
   c=>{c.characterId='999999'},
   c=>{c.payload.skillUniqueId='999999999'},
   c=>{c.payload.skillMstId='999999999'},
   c=>{c.payload.bundleKey+='-wrong'},
   c=>{c.effectId+='-wrong'},
   c=>{c.payload.sourceActionId+='-wrong'},
   c=>{c.payload.characterIdentity.styleMstId='99999999'},
   c=>{c.payload.characterIdentity.resourceName='chara_999999_battle_unit'},
   c=>{c.payload.skillUniqueId='01'},
   c=>{c.payload.skillMstId=9007199254740992},
  ]
  for(const mutate of mutations){const wrong=structuredClone(cue);mutate(wrong);assert.equal(gate.combatVfxCueProductIdentityMatches(product,wrong,actor,'character'),false,entry.id);rejected++}
 }
 assert.equal(rejected,2380)
 console.log('IDENTITY_NEGATIVE '+JSON.stringify({tuples:238,casesPerTuple:10,rejected}))
})

test('canonical integer comparison rejects lossy/ambiguous input and preserves huge decimal strings',(t)=>{
 const gate=identityGate();if(!gate)return t.skip('baseline has no native identity consumer')
 for(const value of [undefined,{},[],true,1.5,-1,Infinity,NaN,Number.MAX_SAFE_INTEGER+1,'','01',' 1','1 ','1e3','+1','-1','0x10'])assert.equal(gate.normalizedCombatSkillId(value),undefined)
 assert.equal(gate.normalizedCombatSkillId('900719925474099312345'),'900719925474099312345')
 assert.equal(gate.normalizedCombatSkillId(0),'0');assert.equal(gate.normalizedCombatSkillId('0'),'0');assert.equal(gate.normalizedCombatSkillId(null),null)
})

test('explicit catalog and enemy primary preview remain separate from automatic character alias routing',(t)=>{
 const gate=identityGate();if(!gate)return t.skip('baseline has no native identity consumer');const row=nativeRows.find(r=>r.entry.characterIdentity.characterId==='100101')
 const cue=nativeCue(row.entry),actor=identityActor('100201');cue.actionId='catalog:character|preview';cue.characterId='100201';delete cue.payload.characterIdentity;delete cue.payload.sourceActionId
 assert.equal(gate.combatVfxCueProductIdentityMatches(row.product,cue,actor,'character'),true)
 cue.actionId='enemy-action';assert.equal(gate.combatVfxCueProductIdentityMatches(row.product,cue,actor,'enemy'),true)
 cue.payload.skillUniqueId='999';assert.equal(gate.combatVfxCueProductIdentityMatches(row.product,cue,actor,'enemy'),false)
})
