import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
import test from 'node:test'
const source=process.env.S6_SOURCE_ROOT||path.dirname(fileURLToPath(import.meta.url))
const req=createRequire(path.join(source,'package.json')),ts=req('typescript')
const THREE=await import(pathToFileURL(path.join(source,'node_modules/three/build/three.module.js')))
const {FBXLoader}=await import(pathToFileURL(path.join(source,'node_modules/three/examples/jsm/loaders/FBXLoader.js')))
const {DDSLoader}=await import(pathToFileURL(path.join(source,'node_modules/three/examples/jsm/loaders/DDSLoader.js')))
const candidate=process.env.S6_INSTANCE_CANDIDATE
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''))
const asset=(id,file)=>{const rel=path.join('public/stages/official',id,file),p=candidate&&path.join(candidate,rel);return p&&fs.existsSync(p)?p:path.join(source,rel)}
const cache=new Map()
function load(name){
 if(name==='three')return THREE
 if(name==='three/addons/loaders/DDSLoader.js')return {DDSLoader}
 if(name==='./runtimeProductDelivery')return {resolveRuntimeAssetUrl:async url=>url}
 if(name==='./stageNativeLightmapMips')return {}
 if(cache.has(name))return cache.get(name)
 const rel=name.includes('coordinateSpace')?path.join('magia-exedra-character-three','coordinateSpace.ts')
  :path.join('src/viewer',name.replace(/^\.\//,'')+(name.endsWith('.ts')?'':'.ts'))
 const proposed=candidate&&path.join(candidate,rel),file=proposed&&fs.existsSync(proposed)?proposed:path.join(source,rel)
 const module={exports:{}};cache.set(name,module.exports)
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
 Function('exports','require','module',js)(module.exports,load,module);return module.exports
}
const lm=load('./stageLightmaps'),uv=load('./stageUv1Companion')
const cases=[
 ['battle-602-11-01-002','bg_3d_602_11_01_002',6],
 ['dungeon-60600-bg-3d-606-00-11-001-001','bg_3d_606_00_11_001_001',1091],
 ['dungeon-60600-bg-3d-606-00-11-001-002','bg_3d_606_00_11_001_002',943],
 ['dungeon-65000-bg-3d-652-01-12-001-001','bg_3d_652_01_12_001_001',229],
 ['dungeon-65000-bg-3d-652-01-12-001-002','bg_3d_652_01_12_001_002',259],
 ['dungeon-65000-bg-3d-652-01-12-001-003','bg_3d_652_01_12_001_003',212],
]
for(const [id,bundle,count] of cases)test(`${id} preserves complete native lightmap instances and UV1`,()=>{
 const data=zlib.gunzipSync(fs.readFileSync(asset(id,bundle+'.fbxdata')))
 const manager=new THREE.LoadingManager();manager.addHandler(/./,{setPath(){return this},load(){return new THREE.Texture()}})
 const root=new FBXLoader(manager).parse(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'')
 const nativeRootTransform={position:root.position.toArray(),rotation:root.quaternion.toArray(),scale:root.scale.toArray()}
 root.name='Stage:'+id
 const bindings=read(asset(id,'lightmap-bindings.json')).renderers
 try{
  const result=lm.matchStageLightmapBindings(root,bindings,{nativeRootTransform})
  assert.equal(bindings.length,count);assert.equal(result.matches.length,count)
  assert.deepEqual(result.ambiguousBindingPaths,[]);assert.deepEqual(result.unmatchedBindingPaths,[])
  assert.equal(new Set(result.matches.map(m=>m.mesh)).size,count)
  const owner=new Map(result.matches.map(m=>[m.binding,m.mesh]))
  root.traverse(o=>o.children.reverse())
  const reversed=lm.matchStageLightmapBindings(root,bindings.slice().reverse(),{nativeRootTransform})
  assert.equal(reversed.matches.length,count)
  for(const m of reversed.matches)assert.equal(owner.get(m.binding),m.mesh)
  const u=uv.applyStageUv1Companion(root,read(asset(id,'uv1-companion.json')),{strict:true,requiredRuntimePaths:result.matches.map(m=>m.rendererHierarchyPath)})
  assert.deepEqual(u.missingRequiredRuntimePaths,[]);assert.deepEqual(u.unmatchedCompanionPaths,[])
  if(id.startsWith('battle-602')){
   let nodes=0,meshes=0;root.traverse(o=>{nodes++;if(o.isMesh)meshes++;assert.equal(o.userData.transformData.inheritType,1)})
   assert.equal(nodes,643);assert.equal(meshes,411)
   const bottles=result.matches.filter(m=>m.binding.rendererIdentity)
   assert.equal(bottles.length,2)
   for(const m of bottles)for(const value of m.mesh.scale.toArray())assert.ok(Math.abs(value-1)<1e-6)
  }
  if(id.startsWith('dungeon-650')){
   const targets=result.matches.filter(m=>/__lm_/.test(m.mesh.name))
   assert.equal(targets.length,2,'both coincident native-ID instances survive')
   assert.notEqual(targets[0].mesh,targets[1].mesh)
  }
 }finally{root.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}})}
})
