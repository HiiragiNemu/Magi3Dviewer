import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {PerspectiveCamera,Vector3} from 'three';
import {createCameraCornerControls} from './src/viewer/cameraCornerControls.ts';
import {ThirdPersonCamera} from './src/viewer/ThirdPersonCamera.ts';
import {TpsViewGesture} from './src/viewer/TpsViewTouch.ts';
import {capturePlaneGesture,resolvePlaneGesture} from './src/viewer/cameraPlaneGesture.ts';
function fixture(t,mobile=false){
 const d=new JSDOM('<div id="menu"></div><div id="workspace"><canvas></canvas></div>',{url:'https://fixture.test/',pretendToBeVisual:true}),w=d.window,saved=new Map();
 for(const[k,v]of Object.entries({window:w,document:w.document,Element:w.Element,HTMLElement:w.HTMLElement,AbortController:w.AbortController,innerWidth:mobile?430:1280,innerHeight:932,matchMedia:query=>({matches:mobile,media:query}),ResizeObserver:class{observe(){}disconnect(){}}})){saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true})}
 const captures=new Map();w.Element.prototype.setPointerCapture=function(id){captures.set(id,this)};w.Element.prototype.hasPointerCapture=function(id){return captures.get(id)===this};w.Element.prototype.releasePointerCapture=function(id){captures.delete(id)};
 const canvas=document.querySelector('canvas');canvas.getBoundingClientRect=()=>({x:0,y:100,left:0,top:100,right:430,bottom:932,width:430,height:832});Object.defineProperty(canvas,'clientHeight',{value:832});document.querySelector('#menu').getBoundingClientRect=()=>({bottom:100});
 const camera=new PerspectiveCamera(40,430/832,.05,100),target=new Vector3(0,1,0);camera.position.set(0,1,5);camera.lookAt(target);const controls={target,enabled:true,enableDamping:false,zoomSpeed:1,rotateSpeed:1,connect(){},disconnect(){},update(){camera.lookAt(target)}};
 const host={camera,controls,renderer:{domElement:canvas}},owner=new ThirdPersonCamera({scene:()=>host,actor:()=>undefined,released(){},status(){}}),dispose=[];owner.install();owner.start();owner.update();
 t.after(()=>{for(const f of dispose)f();w.close();for(const[k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k]}});
 return{w,canvas,camera,target,owner,host,dispose,send:(element,type,x,id=1)=>element.dispatchEvent(new w.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:mobile?'touch':'mouse',button:0,clientX:x,clientY:160}))}
}
test('an accidental 90 degree twist during a pinch never changes optical roll',()=>{
 const camera=new PerspectiveCamera(40,1,.05,100),target=new Vector3(0,1,0);camera.position.set(0,1,5);camera.lookAt(target);camera.rotateZ(.3);const base=capturePlaneGesture(camera,target,800);let result,turnCalls=0;
 const gesture=new TpsViewGesture({rotate(){throw Error('unexpected orbit')},pinch(){},roll(){turnCalls++},two:delta=>{assert.equal(delta.roll,0);result=resolvePlaneGesture(base,delta)}});
 gesture.begin({id:1,x:200,y:300});gesture.begin({id:2,x:400,y:300});gesture.move([{id:1,x:300,y:150}]);gesture.move([{id:2,x:300,y:450}]);
 assert.ok(result.quaternion.angleTo(base.quaternion)<1e-7);assert.equal(turnCalls,0);assert.ok(result.position.distanceTo(base.position)>.6);
 gesture.move([{id:1,x:200,y:300},{id:2,x:400,y:300}]);assert.ok(result.position.distanceTo(base.position)<1e-10);assert.ok(result.target.distanceTo(base.target)<1e-10)
});
test('fallback two-finger pinch/pan also never invokes a roll hook',()=>{let calls=0,pinches=0;const g=new TpsViewGesture({rotate(){},pinch(){pinches++},roll(){calls++}});g.begin({id:1,x:0,y:0});g.begin({id:2,x:100,y:0});g.move([{id:2,x:80,y:50}]);assert.equal(pinches,1);assert.equal(calls,0)});
for(const mobile of [false,true])test(`one shared roll control: drag rotates, tap levels, keyboard is usable (mobile=${mobile})`,t=>{
 const f=fixture(t,mobile);let angle=17,focus=0;const corner=createCameraCornerControls({focus(){focus++},roll(d){angle+=d},angle:()=>angle,reset(){angle=0},locale:()=> 'zh-CN'});f.dispose.push(()=>corner.dispose());
 const b=document.querySelector('#camera-roll-control');assert.equal(document.querySelectorAll('#camera-corner-controls button').length,2);assert.equal(document.querySelector('#camera-roll-left'),null);
 f.send(b,'pointerdown',100);f.send(b,'pointermove',160);f.send(b,'pointerup',160);assert.equal(angle,47);assert.equal(b.getAttribute('aria-valuenow'),'47');
 f.send(b,'pointerdown',160);f.send(b,'pointerup',160);assert.equal(angle,0);
 b.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));assert.equal(angle,-5);b.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(angle,10);b.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));assert.equal(angle,0);
 document.querySelector('#camera-frame-actor').click();assert.equal(focus,1);if(mobile)assert.equal(document.querySelector('#camera-corner-controls').style.top,'108px')
});
test('pointer cancel and a second finger cannot leave the roll control stuck',t=>{const f=fixture(t,true);let angle=0;const c=createCameraCornerControls({focus(){},roll(d){angle+=d},angle:()=>angle,reset(){angle=0},locale:()=> 'en'});f.dispose.push(()=>c.dispose());const b=document.querySelector('#camera-roll-control');f.send(b,'pointerdown',100,1);f.send(b,'pointerdown',100,2);f.send(b,'pointermove',150,2);assert.equal(angle,0);f.send(b,'pointermove',160,1);assert.equal(angle,30);f.send(b,'pointercancel',160,1);f.send(b,'pointermove',260,1);assert.equal(angle,30);assert.equal(b.classList.contains('is-dragging'),false)});
test('TPS native touch events zoom and pan without changing an existing roll',t=>{
 const f=fixture(t,true);f.owner.rollBy(.45);const before=f.camera.quaternion.clone(),position=f.camera.position.clone();
 const send=(type,points)=>{const touches=points.map(p=>({identifier:p[0],clientX:p[1],clientY:p[2],target:f.canvas}));f.canvas.dispatchEvent(new f.w.TouchEvent(type,{bubbles:true,cancelable:true,changedTouches:touches,touches:type==='touchend'?[]:touches}))};
 send('touchstart',[[1,120,400],[2,300,400]]);send('touchmove',[[1,90,350],[2,340,470]]);f.owner.update();assert.ok(f.camera.position.distanceTo(position)>.1);assert.ok(f.camera.quaternion.angleTo(before)<1e-7);assert.ok(Math.abs(f.owner.roll-.45)<1e-12);send('touchend',[[1,90,350],[2,340,470]])
});
test('leveling a rolled TPS camera keeps position and viewing direction even past a pole',t=>{const f=fixture(t);f.owner.pitch=4.2;f.owner.yaw=3.7;f.owner.roll=1.1;f.owner.update();const before=f.camera.position.clone(),forward=f.camera.getWorldDirection(new Vector3());f.owner.resetRoll();assert.ok(f.camera.position.distanceTo(before)<1e-10);assert.ok(f.camera.getWorldDirection(new Vector3()).distanceTo(forward)<1e-10);assert.equal(f.owner.roll,0)});
