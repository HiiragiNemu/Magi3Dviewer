import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { loadStageTransformModules } from './tests/helpers/loadStageTransformModules.mjs'
const { batching: { batchStaticStageMeshes: batch } } = loadStageTransformModules()
function fixture(count=3){
 const root=new THREE.Group(), meshes=[]
 for(let i=0;i<count;i++){
  const material=new THREE.MeshStandardMaterial({color:0x774433,roughness:.8,alphaTest:.4})
  material.userData.stageRigidBatchBinding='exact-authored-binding'
  material.userData.stageRigidVertexPosition=true
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,2,3),material)
  mesh.position.set(i*3,2,-4);mesh.rotation.y=i*.3;mesh.scale.set(2,3,1)
  mesh.name='AuthoredMesh_'+i;mesh.castShadow=true;mesh.receiveShadow=true
  root.add(mesh);meshes.push(mesh)
 }
 root.updateMatrixWorld(true);return {root,meshes}
}
function run(f){return batch(f.root,{hasRuntimeOrTransformWriter:false})}
test('static replicas batch without changing source geometry, paths, visibility, lights or material',()=>{
 const f=fixture(),before=f.meshes.map(m=>({world:m.matrixWorld.clone(),geometry:m.geometry,material:m.material,name:m.name,positions:[...m.geometry.attributes.position.array]}))
 const result=run(f);assert.equal(result.stats.batches,1);assert.equal(result.stats.batchedSourceMeshes,3)
 const combined=result.meshes[0];assert.equal(combined.count,3);assert.equal(combined.castShadow,true);assert.equal(combined.receiveShadow,true)
 assert.equal(combined.material,before[0].material)
 f.root.updateMatrixWorld(true)
 f.meshes.forEach((m,i)=>{
  assert.equal(m.geometry,before[i].geometry);assert.equal(m.material,before[i].material);assert.equal(m.name,before[i].name)
  assert.equal(m.parent,f.root);assert.equal(m.visible,true);assert.equal(m.layers.mask,0);assert.deepEqual([...m.geometry.attributes.position.array],before[i].positions)
  const mat=new THREE.Matrix4();combined.getMatrixAt(i,mat);mat.premultiply(combined.matrixWorld)
  mat.elements.forEach((x,j)=>assert.ok(Math.abs(x-before[i].world.elements[j])<1e-6))
 })
})
test('restore returns exact layers and releases instance allocation without disposing shared resources',()=>{
 const f=fixture();f.meshes.forEach(m=>m.layers.mask=5);const result=run(f);let disposed=0,shared=0
 result.meshes[0].addEventListener('dispose',()=>disposed++)
 f.meshes.forEach(m=>{m.geometry.addEventListener('dispose',()=>shared++);m.material.addEventListener('dispose',()=>shared++)})
 result.restore();result.restore();assert.equal(disposed,1);assert.equal(shared,0);assert.equal(f.root.children.length,3)
 f.meshes.forEach(m=>{assert.equal(m.layers.mask,5);assert.equal(m.visible,true);assert.equal(m.userData.stageStaticBatchSource,undefined)})
})
for(const variation of ['uv1','index','groups','drawRange','lightmapST','probe','sampler','material','binding','layers','order','castShadow','receiveShadow'])test(`different final ${variation} stays in a separate render group`,()=>{
 const f=fixture(6)
 if(variation==='uv1')f.meshes.forEach(m=>m.geometry.setAttribute('uv1',m.geometry.attributes.uv.clone()))
 for(const m of f.meshes.slice(3)){
  if(variation==='uv1')m.geometry.attributes.uv1.array[0]=.125
  if(variation==='index')[m.geometry.index.array[0],m.geometry.index.array[1]]=[m.geometry.index.array[1],m.geometry.index.array[0]]
  if(variation==='groups')m.geometry.groups[0].materialIndex=2
  if(variation==='drawRange')m.geometry.setDrawRange(0,6)
  if(variation==='lightmapST')m.material.userData.stageBatchLightmap={texture:'same',scaleOffset:[.5,.5,0,0]}
  if(variation==='probe')m.userData.stageReflectionProbes={selected:[{id:'probe2',weight:1}]}
  if(variation==='sampler')m.material.map=new THREE.Texture()
  if(variation==='material')m.material.roughness=.3
  if(variation==='binding')m.material.userData.stageRigidBatchBinding='another-exact-binding'
  if(variation==='layers')m.layers.mask=3
  if(variation==='order')m.renderOrder=2
  if(variation==='castShadow')m.castShadow=false
  if(variation==='receiveShadow')m.receiveShadow=false
 }
 const r=run(f);assert.equal(r.stats.batchedSourceMeshes,variation==='sampler'?3:6);assert.equal(r.stats.batches,variation==='sampler'?1:2)
})
for(const kind of ['runtime','animation','lod','skin','morph','atlas','scroll','flow','transparent','shader','uncertified','negative','shear','customDepth','customRender','hidden','hiddenParent','dynamicAttribute','dynamicPosition','instance','multiMaterial','depthWrite','stencil'])test(`${kind} is excluded rather than changing rendering behavior`,()=>{
 const f=fixture()
 if(kind==='runtime'){assert.equal(batch(f.root,{hasRuntimeOrTransformWriter:true}).stats.excludedDynamicStage,true);return}
 if(kind==='animation')f.root.animations=[new THREE.AnimationClip('native',1,[])]
 if(kind==='lod')f.root.add(new THREE.LOD())
 for(const m of f.meshes){
  if(kind==='skin')m.isSkinnedMesh=true
  if(kind==='instance')m.isInstancedMesh=true
  if(kind==='morph')m.geometry.morphAttributes.position=[m.geometry.attributes.position.clone()]
  if(kind==='atlas')m.material.userData.stageAtlas={columns:4}
  if(kind==='scroll')m.material.userData.stageBaseUvScroll={speed:[1,0]}
  if(kind==='flow')m.material.userData.stageFlowMap={map:'flow'}
  if(kind==='transparent')m.material.transparent=true
  if(kind==='shader')m.material=new THREE.ShaderMaterial()
  if(kind==='uncertified')delete m.material.userData.stageRigidBatchBinding
  if(kind==='negative')m.scale.x=-1
  if(kind==='shear'){m.matrixAutoUpdate=false;m.matrix.makeShear(.3,.2,0,0,0,0)}
  if(kind==='customDepth')m.customDepthMaterial=new THREE.MeshDepthMaterial()
  if(kind==='customRender')m.onBeforeRender=()=>{}
  if(kind==='hidden')m.visible=false
  if(kind==='hiddenParent')f.root.visible=false
  if(kind==='dynamicAttribute')m.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage)
  if(kind==='dynamicPosition')m.userData.stageDynamicVertexPosition=true
  if(kind==='multiMaterial')m.material=[m.material,m.material]
  if(kind==='depthWrite')m.material.depthWrite=false
  if(kind==='stencil')m.material.stencilWrite=true
 }
 const r=run(f);assert.equal(r.stats.batches,0);assert.equal(r.stats.batchedSourceMeshes,0);f.meshes.forEach(m=>assert.equal(m.layers.mask,1))
})
test('bounded groups never drop the final small remainder',()=>{
 const f=fixture(130),r=run(f);assert.deepEqual(Array.from(r.meshes,m=>m.count),[64,64]);assert.equal(r.stats.batchedSourceMeshes,128)
 assert.equal(f.meshes.filter(m=>m.layers.mask!==0).length,2)
})
test('instances follow the original stage-root transform after batching',()=>{
 const f=fixture(),r=run(f);f.root.position.set(80,6,-13);f.root.rotation.set(.2,.8,.7);f.root.scale.setScalar(1.7);f.root.updateMatrixWorld(true)
 f.meshes.forEach((m,i)=>{const a=new THREE.Matrix4();r.meshes[0].getMatrixAt(i,a);a.premultiply(r.meshes[0].matrixWorld);a.elements.forEach((x,j)=>assert.ok(Math.abs(x-m.matrixWorld.elements[j])<1e-5))})
})
test('single-slot arrays retain partial-group draw semantics and never mix with scalar materials',()=>{
 const f=fixture(6)
 for(const m of f.meshes){m.geometry.clearGroups();m.geometry.addGroup(0,6,0)}
 f.meshes.slice(3).forEach(m=>m.material=[m.material])
 const r=run(f);assert.equal(r.stats.batches,2)
 assert.equal(Array.isArray(r.meshes[0].material),false);assert.equal(Array.isArray(r.meshes[1].material),true)
 assert.equal(r.meshes[1].material,f.meshes[3].material);assert.deepEqual(r.meshes[1].geometry.groups,[{start:0,count:6,materialIndex:0}])
})
test('empty groups on material arrays remain empty after batching',()=>{
 const f=fixture();f.meshes.forEach(m=>{m.geometry.clearGroups();m.material=[m.material]})
 const r=run(f);assert.equal(r.stats.batches,1);assert.equal(Array.isArray(r.meshes[0].material),true);assert.equal(r.meshes[0].geometry.groups.length,0)
})
test('aggregate bounds remain conservative under a sheared stage root',()=>{
 const f=fixture(),r=run(f),batchMesh=r.meshes[0]
 f.root.matrixAutoUpdate=false;f.root.matrix.makeShear(.3,.2,.5,.9,.2,.8);f.root.updateMatrixWorld(true)
 const sphere=batchMesh.boundingSphere.clone().applyMatrix4(batchMesh.matrixWorld)
 for(const m of f.meshes){const positions=m.geometry.attributes.position;for(let i=0;i<positions.count;i++)assert.ok(sphere.containsPoint(new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(m.matrixWorld)))}
})
