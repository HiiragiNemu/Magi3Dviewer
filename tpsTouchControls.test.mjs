import assert from 'node:assert/strict'
import test from 'node:test'
import {JSDOM} from 'jsdom'
import * as THREE from 'three'
import {TpsTouchControls,joystickIntent} from './src/viewer/TpsTouchControls.ts'
import {ThirdPersonCamera} from './src/viewer/ThirdPersonCamera.ts'

function fixture(t,{touch=true}={}) {
 const dom=new JSDOM('<canvas></canvas>',{pretendToBeVisual:true,url:'https://fixture.test/'})
 const w=dom.window,keys=['window','document','Element','navigator','AbortController','matchMedia','innerWidth','innerHeight']
 const saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]))
 const media=new w.EventTarget();Object.assign(media,{matches:touch,media:'(any-pointer: coarse)'})
 Object.defineProperty(w.navigator,'maxTouchPoints',{value:touch?5:0,configurable:true})
 const globals={window:w,document:w.document,Element:w.Element,navigator:w.navigator,AbortController:w.AbortController,matchMedia:()=>media,innerWidth:430,innerHeight:932}
 for(const [k,v] of Object.entries(globals))Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v})
 const captured=new WeakMap()
 w.Element.prototype.setPointerCapture=function(id){const set=captured.get(this)||new Set();set.add(id);captured.set(this,set)}
 w.Element.prototype.hasPointerCapture=function(id){return captured.get(this)?.has(id)||false}
 w.Element.prototype.releasePointerCapture=function(id){captured.get(this)?.delete(id)}
 const canvas=w.document.querySelector('canvas')
 canvas.getBoundingClientRect=()=>({left:0,top:100,right:430,bottom:932,width:430,height:832})
 let exits=0,locks=0
 canvas.requestPointerLock=()=>{locks++;return Promise.resolve()}
 const controls=new TpsTouchControls({canvas:()=>canvas,exit:()=>{exits++;controls.setEnabled(false)}})
 const stick=w.document.querySelector('#tps-touch-stick')
 stick.getBoundingClientRect=()=>({left:20,top:750,right:156,bottom:886,width:136,height:136})
 const nativeTouches=new Map()
 const send=(selector,type,id,x=88,y=818)=>{
  const target=typeof selector==='string'?w.document.querySelector(selector):selector
  const e=new w.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',isPrimary:id===1,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y})
  target.dispatchEvent(e)
  const touch={identifier:id,clientX:x,clientY:y,target}
  if(type==='pointerdown'||type==='pointermove')nativeTouches.set(id,touch)
  else nativeTouches.delete(id)
  const touchType={pointerdown:'touchstart',pointermove:'touchmove',pointerup:'touchend',pointercancel:'touchcancel'}[type]
  if(touchType)target.dispatchEvent(new w.TouchEvent(touchType,{bubbles:true,cancelable:true,touches:[...nativeTouches.values()],targetTouches:[...nativeTouches.values()].filter(t=>t.target===target),changedTouches:[touch]}))
  return e
 }
 const cleanup=[]
 t.after(()=>{for(const dispose of cleanup)dispose();controls.dispose();dom.window.close();for(const [k,d] of saved){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k]}})
 return {w,controls,canvas,stick,send,cleanup,get exits(){return exits},get locks(){return locks}}
}

test('joystick has a radial dead zone, normalized diagonals and bounded magnitude',()=>{
 assert.deepEqual(joystickIntent(0,0,40),{x:0,z:0})
 assert.deepEqual(joystickIntent(2,2,40),{x:0,z:0})
 const v=joystickIntent(100,-100,40);assert.ok(Math.abs(Math.hypot(v.x,v.z)-1)<1e-12);assert.ok(v.x>0&&v.z>0)
 for(const args of [[NaN,0,40],[0,Infinity,40],[1,1,0]])assert.deepEqual(joystickIntent(...args),{x:0,z:0})
 assert.ok(joystickIntent(20,0,40).x<1&&joystickIntent(20,0,40).x>0)
})
test('touch controls exist only during TPS, non-touch desktops stay uncluttered',t=>{
 const f=fixture(t,{touch:false});assert.equal(f.controls.element.hidden,true)
 f.controls.setEnabled(true);assert.equal(f.controls.element.hidden,true)
 f.send(f.canvas,'pointerdown',1,250,400);assert.equal(f.controls.element.hidden,false)
 f.controls.setEnabled(false);assert.equal(f.controls.element.hidden,true)
})
test('moving, running, jumping and camera fingers do not cancel each other',t=>{
 const f=fixture(t);f.controls.setEnabled(true)
 f.send('#tps-touch-stick','pointerdown',1);f.send('#tps-touch-stick','pointermove',1,88,765)
 assert.ok(f.controls.consume().moveZ>.99)
 f.send('#tps-touch-run','pointerdown',2);assert.equal(f.controls.consume().run,true)
 f.send('#tps-touch-jump','pointerdown',3)
 let state=f.controls.consume();assert.equal(state.jumpPressed,true);assert.ok(state.moveZ>.99);assert.equal(state.run,true)
 assert.equal(f.controls.consume().jumpPressed,false,'held jump fires only one takeoff')
 f.send('#tps-touch-jump','pointerup',3);assert.ok(f.controls.consume().moveZ>.99)
 f.send('#tps-touch-stick','pointerup',8);assert.ok(f.controls.consume().moveZ>.99,'unrelated release must not cancel the stick')
 f.send('#tps-touch-stick','pointerup',1);assert.equal(f.controls.consume().moveZ,0)
})
for(const type of ['pointercancel','lostpointercapture'])test(type+' releases only the correct stick pointer',t=>{
 const f=fixture(t);f.controls.setEnabled(true);f.send('#tps-touch-stick','pointerdown',1,140,818)
 f.send('#tps-touch-stick',type,2);assert.ok(f.controls.consume().moveX>.99)
 f.send('#tps-touch-stick',type,1);assert.equal(f.controls.consume().moveX,0)
})
for(const event of ['resize','blur'])test(event+' clears stuck movement and pending jump',t=>{
 const f=fixture(t);f.controls.setEnabled(true);f.send('#tps-touch-stick','pointerdown',1,140,818);f.send('#tps-touch-run','pointerdown',2);f.send('#tps-touch-jump','pointerdown',3)
 f.w.dispatchEvent(new f.w.Event(event));assert.deepEqual(f.controls.consume(),{moveX:0,moveZ:0,run:false,jumpPressed:false})
})
test('exit and re-entry never reuse a held joystick or queued jump',t=>{
 const f=fixture(t);f.controls.setEnabled(true);f.send('#tps-touch-stick','pointerdown',1,140,818);f.send('#tps-touch-jump','pointerdown',2)
 f.w.document.querySelector('#tps-touch-exit').click();assert.equal(f.exits,1);assert.equal(f.controls.element.hidden,true)
 f.controls.setEnabled(true);assert.deepEqual(f.controls.consume(),{moveX:0,moveZ:0,run:false,jumpPressed:false})
})
test('touch camera never requests mouse lock and survives releasing a movement finger',t=>{
 const f=fixture(t);f.controls.setEnabled(true)
 const camera=new THREE.PerspectiveCamera(),target=new THREE.Vector3(0,1,0);camera.position.set(0,1,6);camera.lookAt(target)
 const orbit={enabled:true,target,connect(){},disconnect(){},update(){}}
 const owner=new ThirdPersonCamera({scene:()=>({camera,controls:orbit,renderer:{domElement:f.canvas}}),actor:()=>undefined,released:()=>owner.stop(),status(){}})
 owner.install();owner.start();f.cleanup.push(()=>owner.stop())
 f.send('#tps-touch-stick','pointerdown',1,88,765)
 f.send(f.canvas,'pointerdown',2,300,400);f.send(f.canvas,'pointermove',2,330,405)
 const yaw=owner.yaw;assert.ok(Math.abs(yaw)>.01);assert.equal(f.locks,0)
 f.send('#tps-touch-stick','pointerup',1)
 f.send(f.canvas,'pointermove',2,350,405);assert.ok(Math.abs(owner.yaw-yaw)>.01)
 f.send(f.canvas,'pointerdown',3,200,400);f.send(f.canvas,'pointermove',3,350,400)
 const held=owner.yaw;f.send(f.canvas,'pointerup',3);f.send(f.canvas,'pointermove',2,370,405)
 assert.ok(Math.abs(owner.yaw-held)>.01,'third finger must not replace camera owner')
 f.send(f.canvas,'pointerup',2);const released=owner.yaw;f.send(f.canvas,'pointermove',2,390,405);assert.equal(owner.yaw,released)
})
test('layout is constrained to the rendered canvas, not the browser toolbar area',t=>{
 const f=fixture(t);f.controls.setEnabled(true)
 assert.equal(f.controls.element.style.top,'100px');assert.equal(f.controls.element.style.height,'832px')
})
