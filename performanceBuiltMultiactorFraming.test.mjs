import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import * as T from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
const source = process.env.S6_SOURCE_ROOT || path.dirname(fileURLToPath(import.meta.url))
const {renderedActorBounds,frameActor,createViewportFraming} = await import(process.env.S6_FRAMING_MODULE || './src/viewer/performanceEditor/viewportFraming.ts')
const {attachHomeAnimationRuntime} = await import(pathToFileURL(path.join(source,'magia-exedra-character-three/homeRuntime.ts')))
const {addOfficialOutlineGroupsToMesh} = await import(pathToFileURL(path.join(source,'magia-exedra-character-three/shaders/outline.ts')))
const viewport={width:673,height:375}
const arrays=box=>[box.min.toArray(),box.max.toArray()]
const pose=actor=>{const rows=[];actor.traverse(o=>rows.push([o.uuid,o.position.toArray(),o.quaternion.toArray(),o.scale.toArray(),o.visible,o.layers.mask]));return rows}
function evaluatedBounds(actor,include=()=>true){
 actor.updateWorldMatrix(true,true);const box=new T.Box3(),point=new T.Vector3()
 actor.traverseVisible(mesh=>{if(!mesh.isMesh||!include(mesh))return;for(let i=0;i<mesh.geometry.attributes.position.count;i++)box.expandByPoint(mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld))})
 return box
}
function realActor(id){
 const dir=path.join(source,`magia-exedra-character-three/models/chara_${id}_battle_unit`)
 const bytes=gunzipSync(fs.readFileSync(path.join(dir,'VisualRoot.fbx.gz'))),previous=globalThis.document
 globalThis.document={createElementNS(){return{addEventListener(){},removeEventListener(){},set src(v){}}}}
 let actor
 try{actor=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')}finally{globalThis.document=previous}
 const runtime=JSON.parse(gunzipSync(fs.readFileSync(path.join(dir,'home-animations.json.gz'))))
 const clips=attachHomeAnimationRuntime(actor,runtime);actor.userData.homeAnimationRuntime=runtime
 const mixer=new T.AnimationMixer(actor),body=clips.find(c=>c.name==='HomeWait01_L')
 mixer.clipAction(body).play()
 const helpers=clips.filter(c=>runtime.helpers.includes(c.name));for(const clip of helpers)mixer.clipAction(clip).play()
 mixer.setTime(body.duration*.46)
 const meshes=[];actor.traverse(m=>{if(m.isSkinnedMesh)meshes.push(m)})
 for(const mesh of meshes)addOfficialOutlineGroupsToMesh(mesh,[{}])
 const scene=new T.Scene();scene.add(actor);scene.updateMatrixWorld(true)
 return {actor,mixer,helpers,scene}
}
function cameraFixture(){
 const camera=new T.PerspectiveCamera(50,viewport.width/viewport.height,.1,100);camera.position.set(0,1,8)
 const controls=new OrbitControls(camera,null);controls.target.set(0,.8,0);controls.update();controls.saveState()
 return {camera,controls}
}
function occupancy(camera,box){
 const corners=Array.from({length:8},(_,i)=>new T.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).project(camera))
 assert.ok(corners.every(p=>Math.abs(p.x)<.84&&Math.abs(p.y)<.84&&p.z>=-1&&p.z<=1),'body stays fully in viewport')
 return (Math.max(...corners.map(p=>p.y))-Math.min(...corners.map(p=>p.y)))/2
}
for(const id of [100107,100202])test(`real ${id}: Home hide helper + outline do not expand framing to hidden weapon at Y=-10`,()=>{
 const f=realActor(id),raw=evaluatedBounds(f.actor)
 // These fixture mesh names establish an independent expected body oracle;
 // production exclusion uses only the source helper UUID/skin-influence joins.
 const body=evaluatedBounds(f.actor,m=>!/weapon/i.test(m.name))
 assert.ok(raw.getSize(new T.Vector3()).y>11)
 assert.ok(body.getSize(new T.Vector3()).y<1.7)
 const before=pose(f.actor),time=f.mixer.time
 const actual=renderedActorBounds(f.actor)
 assert.deepEqual(arrays(actual),arrays(body))
 const {camera,controls}=cameraFixture();assert.equal(frameActor(camera,controls,f.actor,viewport).status,'ready')
 const fill=occupancy(camera,body);assert.ok(fill>.70&&fill<.84)
 assert.deepEqual(pose(f.actor),before);assert.equal(f.mixer.time,time)
 console.log(JSON.stringify({fixture:id,helpers:f.helpers.map(c=>c.name),rawHeight:raw.getSize(new T.Vector3()).y,framedHeight:actual.getSize(new T.Vector3()).y,heightOccupancy:fill,actorWrites:0}))
})

function synthetic(){
 const actor=new T.Group(),body=new T.Mesh(new T.BoxGeometry(.6,1.8,.3),new T.MeshBasicMaterial());body.position.y=.9;actor.add(body)
 const hideRoot=new T.Bone(),bone=new T.Bone(),other=new T.Bone();hideRoot.name='arbitrary source transform';hideRoot.add(bone);actor.add(hideRoot,other)
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,1,1],3))
 geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute([0,0,0,0,0,0,0,0],4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,1,0,0,0],4))
 const mesh=new T.SkinnedMesh(geometry,new T.MeshBasicMaterial());actor.add(mesh);actor.updateMatrixWorld(true);mesh.bind(new T.Skeleton([bone,other]))
 const clip=new T.AnimationClip('HomeWeaponBHide',1,[new T.VectorKeyframeTrack(`${hideRoot.uuid}.position`,[0,1],[17,-37,8,17,-37,8]),new T.VectorKeyframeTrack(`${hideRoot.uuid}.scale`,[0,1],[.017,.023,.031,.017,.023,.031])])
 actor.animations=[clip];actor.userData.homeAnimationRuntime={schema:2,helpers:[clip.name],clips:[T.AnimationClip.toJSON(clip)]}
 const mixer=new T.AnimationMixer(actor);mixer.clipAction(clip).play();mixer.update(.4);actor.updateMatrixWorld(true)
 return{actor,body,hideRoot,bone,other,mesh,clip,mixer}
}
test('source UUID/skin mapping has no ID, mesh-name, unit-scale or fixed-distance dependency',()=>{
 const f=synthetic();f.actor.position.set(3,7,-2);f.actor.scale.setScalar(.015);f.actor.updateMatrixWorld(true)
 assert.deepEqual(arrays(renderedActorBounds(f.actor)),arrays(evaluatedBounds(f.actor,m=>m===f.body)))
})
test('paused authored hide pose remains excluded; stop or manual edit makes visible weapon contribute again',()=>{
 const f=synthetic();f.mixer.clipAction(f.clip).paused=true
 assert.deepEqual(arrays(renderedActorBounds(f.actor)),arrays(evaluatedBounds(f.actor,m=>m===f.body)))
 f.hideRoot.position.x+=.5;f.actor.updateMatrixWorld(true)
 assert.deepEqual(arrays(renderedActorBounds(f.actor)),arrays(evaluatedBounds(f.actor)))
 f.mixer.stopAllAction();f.actor.updateMatrixWorld(true)
 assert.deepEqual(arrays(renderedActorBounds(f.actor)),arrays(evaluatedBounds(f.actor)))
})
test('missing or ambiguous typed hide authority never infers invisibility from a remote or tiny weapon',()=>{
 for(const variant of ['missing','unconfigured','duplicate-clip','duplicate-source','duplicate-uuid','nonconstant']){
  const f=synthetic()
  if(variant==='missing')delete f.actor.userData.homeAnimationRuntime
  if(variant==='unconfigured')f.actor.userData.homeAnimationRuntime.helpers=[]
  if(variant==='duplicate-clip')f.actor.animations.push(f.clip.clone())
  if(variant==='duplicate-source')f.actor.userData.homeAnimationRuntime.clips.push(T.AnimationClip.toJSON(f.clip))
  if(variant==='duplicate-uuid'){const duplicate=new T.Bone();duplicate.uuid=f.hideRoot.uuid;f.actor.add(duplicate)}
  if(variant==='nonconstant')f.clip.tracks[0].values[3]+=1
  assert.deepEqual(arrays(renderedActorBounds(f.actor)),arrays(evaluatedBounds(f.actor)),variant)
 }
})
test('mixed skin influences remain included, while a wholly hidden subtree mesh is excluded',()=>{
 const f=synthetic();f.mesh.geometry.attributes.skinIndex.setXYZW(1,0,1,0,0);f.mesh.geometry.attributes.skinWeight.setXYZW(1,.5,.5,0,0)
 const expected=new T.Box3().copy(evaluatedBounds(f.actor,m=>m===f.body)),p=new T.Vector3()
 expected.expandByPoint(f.mesh.getVertexPosition(1,p).applyMatrix4(f.mesh.matrixWorld))
 assert.deepEqual(arrays(renderedActorBounds(f.actor)),arrays(expected))
 const attached=new T.Mesh(new T.BoxGeometry(100,100,100),new T.MeshBasicMaterial());f.hideRoot.add(attached)
 assert.deepEqual(arrays(renderedActorBounds(f.actor)),arrays(expected))
})
test('two real actors: Performance selection, not current character, drives fit; exit restores view',()=>{
 const a=realActor(100107),b=realActor(100202);a.scene.add(b.actor);b.actor.position.x=3;a.scene.updateMatrixWorld(true)
 const rootCurrent=b.actor;let selected=a.actor
 const {camera,controls}=cameraFixture(),queue=new Map(),errors=[],listeners=new Map();let next=0
 const snapshot=()=>({p:camera.position.toArray(),q:camera.quaternion.toArray(),projection:camera.projectionMatrix.toArray(),target:controls.target.toArray(),cursor:controls.cursor.toArray(),near:camera.near,far:camera.far})
 const before=snapshot(),actorsBefore=[pose(a.actor),pose(b.actor)]
 const helper=createViewportFraming({camera,controls,canvas:{getBoundingClientRect:()=>viewport,addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)},selectedActor:()=>selected,report:r=>errors.push(r),schedule:fn=>{queue.set(++next,fn);return next},cancel:k=>queue.delete(k)})
 const tick=()=>{for(const [id,fn]of [...queue]){queue.delete(id);fn(0)}}
 helper.setEnabled(true);tick();tick();assert.notEqual(selected.uuid,rootCurrent.uuid)
 assert.ok(occupancy(camera,evaluatedBounds(a.actor,m=>!/weapon/i.test(m.name)))>.7)
 selected=b.actor;helper.frame();assert.ok(occupancy(camera,evaluatedBounds(b.actor,m=>!/weapon/i.test(m.name)))>.7)
 assert.deepEqual([pose(a.actor),pose(b.actor)],actorsBefore);assert.equal(errors.length,0)
 helper.setEnabled(false);assert.deepEqual(snapshot(),before);assert.equal(queue.size,0);assert.equal(listeners.size,0);helper.dispose()
})
test('host remains joined to selected Performance actor generation and keeps manual callback',()=>{
 const host=fs.readFileSync(path.join(source,'src/viewer/index.ts'),'utf8')
 const framing=host.slice(host.indexOf('framing = createViewportFraming'),host.indexOf('framing = createViewportFraming')+1400)
 assert.match(framing,/getPoseSelection\(\)/);assert.match(framing,/actors\.get\(selection\.actorKey\)/)
 assert.match(framing,/descriptor\.generation === selection!\.generation/);assert.match(framing,/onFrameActor: \(\) => framing\?\.frame\(\)/)
})
