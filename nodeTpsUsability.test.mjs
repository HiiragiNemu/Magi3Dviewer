import assert from 'node:assert/strict'
import test,{after} from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {JSDOM} from 'jsdom'
import {build} from 'esbuild'
import * as T from 'three'
import {safePartFocusDistance,frameWholeObject} from './src/viewer/cameraFraming.ts'
import {createTpsTargetMenu} from './src/viewer/tpsTargetMenu.ts'
import {ThirdPersonCamera} from './src/viewer/ThirdPersonCamera.ts'
const temp=fs.mkdtempSync(path.resolve('.node-tps-tests-'))
after(()=>fs.rmSync(temp,{recursive:true,force:true}))
await build({entryPoints:['src/viewer/viewportPoseEditor.ts'],outfile:path.join(temp,'editor.mjs'),bundle:true,platform:'node',format:'esm',external:['three'],logLevel:'silent'})
const {createViewportPoseEditor,projectPoseAnchor}=await import(pathToFileURL(path.join(temp,'editor.mjs')))
function dom(t){
 const d=new JSDOM('<div id="menu"></div><canvas></canvas><div id="fine"></div><button id="toggle"></button>',{url:'https://example.test/',pretendToBeVisual:true}),w=d.window
 const previous=new Map(),globals={window:w,document:w.document,Element:w.Element,HTMLElement:w.HTMLElement,HTMLButtonElement:w.HTMLButtonElement,localStorage:w.localStorage,AbortController:w.AbortController,innerWidth:1000,innerHeight:800,ResizeObserver:class{observe(){}disconnect(){}},CSS:{escape:x=>x}}
 for(const [k,v] of Object.entries(globals)){previous.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true})}
 const canvas=w.document.querySelector('canvas');canvas.getBoundingClientRect=()=>({left:0,top:60,right:1000,bottom:800,width:1000,height:740});Object.defineProperty(canvas,'clientHeight',{value:740})
 const captures=new Map();w.HTMLElement.prototype.setPointerCapture=function(id){captures.set(id,this)};w.HTMLElement.prototype.hasPointerCapture=function(id){return captures.get(id)===this};w.HTMLElement.prototype.releasePointerCapture=function(id){captures.delete(id)}
 const original=w.HTMLElement.prototype.getBoundingClientRect
 w.HTMLElement.prototype.getBoundingClientRect=function(){if(this.id==='menu')return{x:0,y:0,left:0,top:0,right:1000,bottom:60,width:1000,height:60};if(this.classList.contains('ve-chip')){const [x,y]=(this.style.transform.match(/-?\d+(?:\.\d+)?/g)||[0,0]).map(Number);return{x,y,left:x,top:y,right:x+96,bottom:y+28,width:96,height:28}}return original.call(this)}
 const send=(target,type,x,y,id=1,button=0)=>target.dispatchEvent(new w.PointerEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:id,pointerType:'mouse',button,buttons:type==='pointerup'?0:1}))
 t.after(()=>{d.window.close();for(const[k,v]of previous){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k]}})
 return{w,canvas,send}
}
function rig(){const actor=new T.Group(),hip=new T.Bone(),chest=new T.Bone(),head=new T.Bone();hip.name='Hip';chest.name='Chest';head.name='Head';actor.name='test-model';actor.add(hip);hip.position.y=.8;hip.add(chest);chest.position.y=.3;chest.add(head);head.position.y=.35
 for(const side of ['L','R']){const shoulder=new T.Bone(),arm=new T.Bone(),fore=new T.Bone(),hand=new T.Bone();shoulder.name='Shoulder_'+side;arm.name='Arm_'+side;fore.name='Forearm_'+side;hand.name='Hand_'+side;chest.add(shoulder);shoulder.add(arm);arm.position.x=(side==='L'?1:-1)*.25;arm.add(fore);fore.position.y=-.25;fore.add(hand);hand.position.y=-.2
  for(const finger of ['Thumb','Indexfinger']){let parent=hand;for(let i=1;i<=3;i++){const b=new T.Bone();b.name=finger+i+'_'+side;b.position.set(.01,-.04,.01);parent.add(b);parent=b}}
 }actor.updateMatrixWorld(true);return actor}
function editorFixture(t){const d=dom(t),actor=rig(),camera=new T.PerspectiveCamera(40,1000/740,.05,100);camera.position.set(0,1,4);camera.lookAt(0,1,0);const state={actor,object:actor,active:true,pose:true,mode:'rotate',group:'primary',stretch:false,limited:false,canTranslate:true,history:{canUndo:true,canRedo:false}};let focuses=0,selects=0,begins=0
 const editor=createViewportPoseEditor({state:()=>state,camera,canvas:d.canvas,translate:x=>x,locale:()=> 'zh-CN',place(){},pose(){},mode(v){state.mode=v},close(){state.active=false},parameters(){},focus(){focuses++},focusPart(){focuses++},select(p){state.selected=p.bone;selects++},begin(p){state.selected=p.bone;begins++;return true},move(){},end(){},undo(){},redo(){},reset(){},nudge(){},group(v){state.group=v},fineHost:d.w.document.querySelector('#fine'),resetAll(){},save(){}})
 t.after(()=>editor.dispose());editor.update();return{...d,actor,camera,state,editor,get focuses(){return focuses},get selects(){return selects},get begins(){return begins}}
}
for(const angle of [0,.3,1.5,3,5.8])test('real anchor uses fresh transformed world/view matrices at yaw '+angle,()=>{
 const parent=new T.Group(),actor=rig(),camera=new T.PerspectiveCamera(48,1.6,.03,100);parent.add(actor);parent.position.set(.4,.1,-.3);parent.rotation.set(.2,-.4,.1);parent.scale.set(1.2,.8,1.1)
 const bone=actor.getObjectByName('Arm_R');camera.position.set(Math.sin(angle)*4,1.8,Math.cos(angle)*4);camera.lookAt(.2,1,0);camera.rotateZ(.6);bone.rotation.z=.4
 const rect={left:20,top:80,width:1280,height:800},actual=projectPoseAnchor(bone,camera,rect)
 parent.updateMatrixWorld(true);camera.updateMatrixWorld(true);const world=new T.Vector4(0,0,0,1).applyMatrix4(bone.matrixWorld),clip=world.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix)
 assert.ok(Math.abs(actual.x-(rect.left+(clip.x/clip.w+1)*rect.width/2))<1e-8);assert.ok(Math.abs(actual.y-(rect.top+(1-clip.y/clip.w)*rect.height/2))<1e-8)
})
test('all primary nodes have persistent names and leaders whose dot endpoint is the exact bone, not a displaced marker',t=>{
 const f=editorFixture(t),buttons=[...document.querySelectorAll('.ve-joint-node')];assert.ok(buttons.length>=9)
 for(const b of buttons){assert.ok(b.textContent.length>0);const dot=document.querySelector('circle[data-bone-uuid="'+b.dataset.boneUuid+'"]'),line=document.querySelector('line[data-bone-uuid="'+b.dataset.boneUuid+'"]');assert.ok(dot&&line);assert.equal(Number(dot.getAttribute('cx')),Number(b.dataset.anchorX));assert.equal(Number(dot.getAttribute('cy')),Number(b.dataset.anchorY));assert.equal(line.getAttribute('x1'),dot.getAttribute('cx'))}
 const positions=buttons.map(b=>b.parentElement.style.transform);f.camera.position.x=2.5;f.camera.lookAt(0,1,0);f.editor.update();assert.deepEqual(buttons.map(b=>b.parentElement.style.transform),positions,'camera movement must not reshuffle button positions')
})
test('a grip rearranges one named button, never starts a pose drag, and persists its position',t=>{
 const f=editorFixture(t),chip=document.querySelector('.ve-joint-node').parentElement,grip=chip.querySelector('.ve-chip-grip'),before=chip.style.transform,q=f.actor.getObjectByName('Head').quaternion.toArray()
 f.send(grip,'pointerdown',150,120);f.send(grip,'pointermove',200,160);f.send(grip,'pointerup',200,160);assert.notEqual(chip.style.transform,before);assert.equal(f.begins,0);assert.deepEqual(f.actor.getObjectByName('Head').quaternion.toArray(),q)
 const saved=JSON.parse(localStorage.getItem('magius.viewport-chip-layout.v1'));assert.ok(saved[chip.dataset.layoutKey]);const placed=chip.style.transform;f.editor.refresh();assert.equal(chip.style.transform,placed)
 grip.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.notEqual(chip.style.transform,placed)
})
test('detail focus is one shot; changing hand, finger or main node does not invoke focus again',t=>{
 const f=editorFixture(t);document.querySelector('#viewport-hands').click();document.querySelector('#viewport-focus-detail').click();assert.equal(f.focuses,1)
 const chain=document.querySelector('#viewport-node-chain');chain.value='1';chain.dispatchEvent(new f.w.Event('change'));const category=document.querySelector('#viewport-node-category');category.value='right';category.dispatchEvent(new f.w.Event('change'));document.querySelector('#viewport-joints').click();assert.equal(f.focuses,1);assert.ok(f.selects>=2)
 assert.equal(document.querySelector('.ve-node-hint'),null)
})
test('collapse preserves pose state and separate explicit close exits editing',t=>{const f=editorFixture(t);document.querySelector('#viewport-editor-collapse').click();assert.equal(f.state.active,true);assert.equal(f.state.pose,true);document.querySelector('#viewport-editor-close').click();assert.equal(f.state.active,false)})
for(const size of [1,10,40])test('a one-node focus cannot put the lens inside an enemy with extent '+size,()=>{const box=new T.Box3(new T.Vector3(-size,0,-size),new T.Vector3(size,size*2,size)),center=new T.Vector3(0,size,0),direction=new T.Vector3(.2,.05,1).normalize(),distance=safePartFocusDistance(center,direction,.2,box,.05);assert.equal(box.containsPoint(center.clone().addScaledVector(direction,distance)),false);assert.ok(distance>.2)})
test('whole-actor frame preserves optical roll and changes no model transform',()=>{const camera=new T.PerspectiveCamera(40,1.5,.05,100);camera.position.set(0,1,4);const target=new T.Vector3(0,1,0);camera.lookAt(target);camera.rotateZ(.7);const q=camera.quaternion.toArray();const box=new T.Box3(new T.Vector3(5,0,5),new T.Vector3(6,2,6));assert.equal(frameWholeObject(camera,target,box,{top:0,bottom:800,height:800},80),true);assert.deepEqual(camera.quaternion.toArray(),q);assert.ok(target.x>5)})
test('single actor toggles; multi-actor menu picks a concrete duplicate instance and offers off without resizing the button',t=>{
 const f=dom(t),button=document.querySelector('#toggle');button.style.width='112px';let targets=[{key:'a',label:'1. Same model',enabled:true}],selected='a',active=false
 const menu=createTpsTargetMenu({button,targets:()=>targets,selected:()=>selected,active:()=>active,setActive:v=>{active=v},select:k=>{selected=k},locale:()=> 'zh-CN'});t.after(()=>menu.dispose())
 const request=()=>document.dispatchEvent(new f.w.CustomEvent('magius:tps-toggle-request'))
 request();assert.equal(active,true);request();assert.equal(active,false)
 targets.push({key:'b',label:'2. Same model',enabled:true});menu.refresh();request();assert.equal(document.querySelector('#tps-target-menu').hidden,false);document.querySelector('[data-target-key=b]').click();assert.equal(selected,'b');assert.equal(active,true);assert.equal(button.style.width,'112px')
 request();document.querySelector('[data-target-key=off]').click();assert.equal(active,false)
})
test('unlocked TPS click is not capture; drag rotates, right drag pans, unlock callback leaves camera owner active',async t=>{
 const f=dom(t),camera=new T.PerspectiveCamera(40,1,.05,100);camera.position.set(0,1,5);const target=new T.Vector3(0,1,0);camera.lookAt(target);let locks=0,releases=0,locked=null;Object.defineProperty(document,'pointerLockElement',{get:()=>locked,configurable:true});document.exitPointerLock=()=>{locked=null;document.dispatchEvent(new f.w.Event('pointerlockchange'))};f.canvas.requestPointerLock=async()=>{locks++;locked=f.canvas;document.dispatchEvent(new f.w.Event('pointerlockchange'))}
 const controls={target,enabled:true,rotateSpeed:1,zoomSpeed:1,connect(){},disconnect(){},update(){}};const owner=new ThirdPersonCamera({scene:()=>({camera,controls,renderer:{domElement:f.canvas}}),actor:()=>undefined,released(){releases++},status(){}});owner.install();owner.start();owner.update();t.after(()=>owner.stop())
 f.send(f.canvas,'pointerdown',500,300);f.send(f.canvas,'pointerup',500,300);assert.equal(locks,0)
 f.send(f.canvas,'pointerdown',500,300);f.send(f.canvas,'pointermove',540,310);f.send(f.canvas,'pointerup',540,310);owner.update();assert.notEqual(owner.yaw,0);assert.equal(locks,0)
 const oldTarget=target.clone();f.send(f.canvas,'pointerdown',500,300,2,2);f.send(f.canvas,'pointermove',560,330,2,2);f.send(f.canvas,'pointerup',560,330,2,2);owner.update();assert.ok(target.distanceTo(oldTarget)>.1)
 await owner.capture();assert.equal(locks,1);owner.releasePointer();assert.equal(releases,1);assert.equal(owner.active,true);assert.equal(controls.enabled,false,'cursor release does not transfer camera to Orbit or end TPS')
 await owner.capture();assert.equal(locks,2);owner.stop();assert.equal(owner.active,false)
})

test('whole actor recovery remains in front of the lens after zooming through the previous pivot',()=>{
 const camera=new T.PerspectiveCamera(40,1.5,.05,100),target=new T.Vector3(0,1,0);camera.position.set(0,1,3);camera.lookAt(target);camera.position.z=-2
 const bounds=new T.Box3(new T.Vector3(-.4,0,-.4),new T.Vector3(.4,2,.4));assert.equal(frameWholeObject(camera,target,bounds,{top:0,bottom:800,height:800},80),true)
 const center=bounds.getCenter(new T.Vector3()).project(camera);assert.ok(Math.abs(center.x)<1&&Math.abs(center.y)<1&&center.z>-1&&center.z<1)
})

test('a selected non-TPS story actor does not disable choosing another controllable actor',t=>{const f=dom(t),button=document.querySelector('#toggle');button.disabled=true;const menu=createTpsTargetMenu({button,targets:()=>[{key:'story',label:'Story actor',enabled:false},{key:'girl',label:'Magical girl',enabled:true}],selected:()=> 'story',active:()=>false,setActive(){},select(){},locale:()=> 'zh-CN'});t.after(()=>menu.dispose());assert.equal(button.disabled,false);document.dispatchEvent(new f.w.CustomEvent('magius:tps-toggle-request'));assert.equal(document.querySelector('[data-target-key=story]').disabled,true);assert.equal(document.querySelector('[data-target-key=girl]').disabled,false)})
test('switching node chains aborts detached node handlers rather than retaining old DOM listeners',t=>{const f=editorFixture(t);document.querySelector('#viewport-hands').click();const old=document.querySelector('.ve-joint-node'),grip=old.parentElement.querySelector('.ve-chip-grip');const category=document.querySelector('#viewport-node-category');category.value='right';category.dispatchEvent(new f.w.Event('change'));f.send(old,'pointerdown',20,20);f.send(grip,'pointerdown',20,20);assert.equal(f.begins,0);assert.equal(old.parentElement.classList.contains('is-arranging'),false)})

test('the actual anchor remains directly draggable without an offset fake hit point',t=>{const f=editorFixture(t),hit=document.querySelector('.ve-anchor-hit');assert.ok(hit);const button=document.querySelector('[data-bone-uuid="'+hit.dataset.anchorBone+'"].ve-joint-node');assert.equal(hit.getAttribute('cx'),button.dataset.anchorX);assert.equal(hit.getAttribute('cy'),button.dataset.anchorY);f.send(hit,'pointerdown',Number(hit.getAttribute('cx')),Number(hit.getAttribute('cy')));assert.equal(f.begins,1);assert.equal(f.state.selected.uuid,hit.dataset.anchorBone);f.send(hit,'pointerup',Number(hit.getAttribute('cx')),Number(hit.getAttribute('cy')))})
