import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { renderedActorBounds, frameActor, createViewportFraming } from './src/viewer/performanceEditor/viewportFraming.ts'
import { createJointNodeLayer } from './src/viewer/performanceEditor/jointNodes.ts'
import { PerformanceActorAdapter } from './src/viewer/performanceEditor/actorAdapter.ts'
import { mountPerformanceWorkspace } from './src/viewer/performanceEditor/workspace.ts'

class Canvas {
    listeners=new Map()
    getBoundingClientRect(){return {left:0,top:0,right:673,bottom:375,width:673,height:375}}
    addEventListener(type,fn){const set=this.listeners.get(type)||new Set();set.add(fn);this.listeners.set(type,set)}
    removeEventListener(type,fn){this.listeners.get(type)?.delete(fn)}
    dispatch(type){for(const fn of this.listeners.get(type)||[])fn()}
}
function cameraFixture(){
    const camera=new T.PerspectiveCamera(50,673/375,0.1,100)
    camera.position.set(0,1,8)
    const controls=new OrbitControls(camera,null);controls.target.set(0,.8,0);controls.update();controls.saveState()
    const actor=new T.Group(), body=new T.Mesh(new T.BoxGeometry(.55,1.7,.3),new T.MeshBasicMaterial())
    body.position.y=.85;actor.add(body)
    const canvas=new Canvas(), queue=new Map(),errors=[];let id=0, selectedActor=actor
    const helper=createViewportFraming({camera,controls,canvas,selectedActor:()=>selectedActor,report:r=>errors.push(r),schedule:fn=>{queue.set(++id,fn);return id},cancel:key=>queue.delete(key)})
    const tick=()=>{for(const [key,fn] of [...queue]){queue.delete(key);fn(0)}}
    return{camera,controls,actor,body,canvas,helper,queue,errors,tick,setActor(value){selectedActor=value},dispose(){helper.dispose();if(controls.domElement)controls.dispose()}}
}
const pose=actor=>{const rows=[];actor.traverse(o=>rows.push([o.uuid,o.position.toArray(),o.quaternion.toArray(),o.scale.toArray()]));return rows}
function snapshot(camera,controls){
    const fields=['target','cursor','target0','position0','_lastPosition','_lastQuaternion','_lastTargetPosition','_quat','_quatInverse','_spherical','_sphericalDelta','_panOffset','_rotateStart','_rotateEnd','_rotateDelta','_panStart','_panEnd','_panDelta','_dollyStart','_dollyEnd','_dollyDelta','_dollyDirection','_mouse','enabled','enableDamping','dampingFactor','autoRotate','autoRotateSpeed','zoom0','minDistance','maxDistance','minZoom','maxZoom','minTargetRadius','maxTargetRadius','_scale','_performCursorZoom','_controlActive','state']
    return{p:camera.position.toArray(),q:camera.quaternion.toArray(),up:camera.up.toArray(),zoom:camera.zoom,near:camera.near,far:camera.far,aspect:camera.aspect,projection:camera.projectionMatrix.toArray(),inverse:camera.projectionMatrixInverse.toArray(),orbit:fields.map(k=>[k,structuredClone(controls[k])])}
}
function coverage(camera,box){
    const p=[0,1,2,3,4,5,6,7].map(i=>new T.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).project(camera))
    assert.ok(p.every(v=>Math.abs(v.x)<=.84&&Math.abs(v.y)<=.84&&v.z>=-1&&v.z<=1),'head/hands/feet bounds stay in view')
    return (Math.max(...p.map(v=>v.y))-Math.min(...p.map(v=>v.y)))/2
}
test('one-shot frame occupies the editing viewport at ordinary and tiny story-like scales without model writes',()=>{
    for(const scale of [1,.01,8]){
        const f=cameraFixture();f.actor.scale.setScalar(scale);const before=pose(f.actor)
        f.helper.setEnabled(true);f.tick();f.tick()
        const fill=coverage(f.camera,renderedActorBounds(f.actor));assert.ok(fill>.75&&fill<.84,String(fill))
        assert.deepEqual(pose(f.actor),before);assert.equal(f.queue.size,0);f.dispose()
    }
})
test('view direction is preserved and narrow viewport constrains width rather than cropping hands',()=>{
    const f=cameraFixture();f.camera.position.set(4,2,6);f.controls.update();const before=f.camera.quaternion.clone()
    assert.equal(frameActor(f.camera,f.controls,f.actor,{width:260,height:420}).status,'ready')
    coverage(f.camera,renderedActorBounds(f.actor));assert.ok(f.camera.quaternion.angleTo(before)<1e-7);f.dispose()
})
test('close precisely restores camera matrices, Orbit public/reset state and pending damping',()=>{
    const f=cameraFixture();f.controls.enableDamping=true;f.controls.autoRotate=true;f.controls._sphericalDelta.phi=.007;f.controls._panOffset.x=.003
    const before=snapshot(f.camera,f.controls);f.helper.setEnabled(true);f.tick();f.tick()
    f.camera.position.x+=1;f.controls.target.z+=.4;f.controls.update();f.helper.setEnabled(false)
    assert.deepEqual(snapshot(f.camera,f.controls),before);f.dispose()
})
test('user input cancels initial fitting; later camera movement is never continuously overridden',()=>{
    const f=cameraFixture();f.helper.setEnabled(true);f.tick();f.canvas.dispatch('pointerdown');f.camera.position.x=9;f.tick()
    assert.equal(f.camera.position.x,9);assert.equal(f.queue.size,0)
    f.helper.frame();const p=f.camera.position.clone();f.camera.position.x+=1;f.tick();assert.equal(f.camera.position.x,p.x+1)
    f.dispose();assert.equal([...f.canvas.listeners.values()].reduce((n,s)=>n+s.size,0),0)
})
test('empty/invalid bounds and active Orbit interactions fail closed without a fit',()=>{
    const f=cameraFixture();const before=snapshot(f.camera,f.controls)
    assert.equal(frameActor(f.camera,f.controls,new T.Group(),{width:673,height:375}).status,'unavailable')
    assert.equal(frameActor(f.camera,f.controls,f.actor,{width:0,height:0}).status,'unavailable')
    assert.deepEqual(snapshot(f.camera,f.controls),before)
    f.controls.state=0;f.helper.setEnabled(true);assert.equal(f.queue.size,0);assert.equal(f.errors.length,1)
    f.controls.state=-1;f.dispose()
})
test('rendered bounds exclude invisible objects without changing any mesh or skin state',()=>{
    const f=cameraFixture();const invisible=new T.Mesh(new T.BoxGeometry(100,100,100),new T.MeshBasicMaterial());invisible.visible=false;f.actor.add(invisible)
    assert.ok(renderedActorBounds(f.actor).getSize(new T.Vector3()).y<2);f.dispose()
})
test('dense nodes use sparse hollow glyphs while every UUID remains an exact overlap candidate',()=>{
    const scene=new T.Scene(),camera=new T.PerspectiveCamera(50,673/375,.1,100),canvas=new Canvas()
    camera.position.z=5;camera.updateMatrixWorld(true)
    const actor=new T.Group(),bones=Array.from({length:80},()=>new T.Bone());bones.forEach(b=>{b.name='same';actor.add(b)})
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0],3))
    geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute([0,0,0,0],4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0],4))
    const mesh=new T.SkinnedMesh(geometry,new T.MeshBasicMaterial());actor.add(mesh);mesh.bind(new T.Skeleton(bones));scene.add(actor)
    const adapter=new PerformanceActorAdapter({object:actor,generation:1,label:'dense',actions:[],isCurrent:()=>true})
    const before=pose(actor),runtime={actors:new Map([[adapter.key,adapter]]),endDrag(){},subscribe:()=>()=>{}}
    const layer=createJointNodeLayer({scene,camera,canvas,runtime,selection:()=>({actorKey:adapter.key,generation:1,boneKey:[...adapter.bones.keys()][0]}),subscribeSelection:()=>()=>{},subscribeFrame:()=>()=>{},interactionBlocked:()=>false,select:()=>({status:'ready',value:undefined}),showCandidates(){},clearCandidates(){},report(){}})
    layer.setEnabled(true)
    assert.equal(layer.identities.length,80);assert.equal(layer.presentation.glyphs,1)
    assert.equal(layer.pick(336.5,187.5).length,80)
    assert.equal(new Set(layer.pick(336.5,187.5).map(x=>x.boneUuid)).size,80)
    const markers=scene.getObjectByName('PerformanceJointNodes').children.filter(o=>o.isMesh)
    assert.ok(markers.every(m=>m.geometry.type==='RingGeometry'&&m.geometry.parameters.innerRadius>.6))
    assert.deepEqual(pose(actor),before);layer.dispose()
})
test('real 100107 source FBX fits the reduced viewport without an ID-based correction',()=>{
    const source=process.env.S6_SOURCE_ROOT||path.dirname(fileURLToPath(import.meta.url))
    const bytes=gunzipSync(fs.readFileSync(path.join(source,'magia-exedra-character-three/models/chara_100107_battle_unit/VisualRoot.fbx.gz')))
    const previous=globalThis.document
    globalThis.document={createElementNS(){return{listeners:new Map(),addEventListener(k,f){this.listeners.set(k,f)},removeEventListener(k){this.listeners.delete(k)},set src(v){this._src=v},get src(){return this._src}}}}
    try{
        const actor=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
        const f=cameraFixture(),before=pose(actor)
        const result=frameActor(f.camera,f.controls,actor,{width:673,height:375});assert.equal(result.status,'ready')
        const box=renderedActorBounds(actor);const fill=coverage(f.camera,box);assert.ok(fill>.6,'actual actor must be readable within its full bound')
        assert.deepEqual(pose(actor),before)
        console.log(JSON.stringify({fixture:'100107',viewport:[673,375],heightOccupancy:fill,worldBounds:box.getSize(new T.Vector3()).toArray(),modelWrites:0}))
        f.dispose()
    }finally{globalThis.document=previous}
})

// The DOM fixture retains event identity; actual pixels are the parent browser gate.
class Element {
    constructor(tag,document){Object.assign(this,{tagName:tag,ownerDocument:document,children:[],attrs:{},listeners:new Map(),parentNode:null})}
    get parentElement(){return this.parentNode}
    setAttribute(k,v){this.attrs[k]=v} getAttribute(k){return this.attrs[k]??null} removeAttribute(k){delete this.attrs[k]}
    append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n)}}
    insertBefore(n,before){n.remove();const i=this.children.indexOf(before);assert.ok(i>=0);this.children.splice(i,0,n);n.parentNode=this}
    remove(){if(this.parentNode)this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null}
    addEventListener(k,f){const set=this.listeners.get(k)||new Set();set.add(f);this.listeners.set(k,set)}
    removeEventListener(k,f){this.listeners.get(k)?.delete(f)}
    dispatch(k){for(const f of this.listeners.get(k)||[])f()}
    focus(){this.ownerDocument.activeElement=this}
    find(fn){if(fn(this))return this;for(const n of this.children){const found=n.find(fn);if(found)return found}}
}
test('workspace button frames the currently selected actor only on request and exit restores the original view',()=>{
    const document={createElement:tag=>new Element(tag,document),createComment:()=>new Element('#comment',document)}
    const app=document.createElement('div'),workspace=document.createElement('div'),viewer=document.createElement('main'),storage=document.createElement('aside'),toggle=document.createElement('button')
    viewer.id='viewer';workspace.append(viewer,storage);app.append(workspace,toggle)
    document.getElementById=id=>app.find(n=>n.id===id)
    document.querySelector=q=>app.find(n=>`[data-performance-resource="${n.getAttribute('data-performance-resource')}"]`===q)
    for(const name of ['characters','scenes','actions']){const n=document.createElement('div');n.setAttribute('data-performance-resource',name);app.append(n)}
    const regions=Object.fromEntries(['resources','project','properties','timeline','audio'].map(k=>[k,document.createElement('section')]))
    const status=document.createElement('output');storage.append(...Object.values(regions),status)
    const f=cameraFixture(),before=snapshot(f.camera,f.controls)
    const layout=mountPerformanceWorkspace({workspace,panel:{regions,status},toggle,onExit(){},onOpenChange:open=>f.helper.setEnabled(open),onFrameActor:()=>f.helper.frame()})
    layout.setOpen(true);f.tick();f.tick();coverage(f.camera,renderedActorBounds(f.actor))
    const button=app.find(n=>n.getAttribute('aria-label')==='Frame selected actor');assert.equal(button.disabled,false)
    const next=f.actor.clone();next.scale.setScalar(.01);next.position.set(10,-1,0);f.setActor(next)
    const cameraBefore=f.camera.position.clone();f.tick();assert.deepEqual(f.camera.position,cameraBefore)
    button.dispatch('click');coverage(f.camera,renderedActorBounds(next));assert.ok(f.camera.position.distanceTo(cameraBefore)>5)
    f.setActor(undefined);const afterFrame=f.camera.position.clone();button.dispatch('click');assert.deepEqual(f.camera.position,afterFrame);assert.match(f.errors.at(-1),/先选择/)
    layout.setOpen(false);assert.deepEqual(snapshot(f.camera,f.controls),before)
    layout.dispose();assert.equal(button.listeners.get('click').size,0);f.dispose()
})
