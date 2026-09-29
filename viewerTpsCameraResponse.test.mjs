import assert from 'node:assert/strict'
import test, {after} from 'node:test'
import * as THREE from 'three'
import {ThirdPersonCamera} from './src/viewer/ThirdPersonCamera.ts'

// Exercise the current camera owner instead of slicing removed functions out
// of viewerLocomotion.ts. The no-inertia/batching guarantees remain unchanged.
const previousWindow=globalThis.window
if (!previousWindow) globalThis.window={}
after(()=>{if(!previousWindow)delete globalThis.window})
function fixture() {
  const camera=new THREE.PerspectiveCamera(),actor=new THREE.Group()
  const controls={enabled:true,target:new THREE.Vector3(0,1.05,0),disconnect(){},connect(){},update(){}}
  const scene={camera,controls,renderer:{domElement:{}}}
  camera.position.set(0,1.05+Math.sin(Math.PI/10)*7.5,Math.cos(Math.PI/10)*7.5)
  camera.lookAt(controls.target);camera.updateMatrixWorld(true)
  const controller=new ThirdPersonCamera({scene:()=>scene,actor:()=>actor,released(){},status(){}})
  controller.start()
  return {scene,actor,controller,api:{input:(x,y)=>controller.move(x,y),step:()=>controller.update(),zoom:value=>controller.zoom((value-controller.distance)/.0035),state:()=>({yaw:controller.yaw,pitch:controller.pitch,position:camera.position.toArray(),quaternion:camera.quaternion.toArray()})}}
}
for (const fps of [12,30,60,144]) test(`${fps} FPS: small input consumed next frame, no angular or position catch-up`,()=>{
  const {api}=fixture();api.step(1/fps);api.input(10,8);api.step(1/fps)
  const first=api.state()
  const expected=new THREE.Quaternion().setFromEuler(new THREE.Euler(-(Math.PI/10+.012),-.015,0,'YXZ'))
  assert.ok(expected.angleTo(new THREE.Quaternion().fromArray(first.quaternion))<1e-7,'rendered camera has not consumed the complete pointer delta')
  for(let i=0;i<120;i++)api.step(1/fps)
  assert.deepEqual(api.state(),first,'camera continues to move after input has stopped')
  assert.ok(Math.abs(first.yaw+.015)<1e-12,'current input gain is 0.0015 radians per pixel')
})
test('same travel is independent of render/event batching',()=>{
  const a=fixture().api,b=fixture().api
  for(let i=0;i<90;i++){a.input(10,0);b.input(10,0);b.step(1/60)}
  a.step(1/12)
  assert.ok(Math.abs(a.state().yaw-b.state().yaw)<1e-12)
  assert.deepEqual(a.state().position,b.state().position)
})
test('wheel target has no delayed dolly and preserves exact camera target',()=>{
  const {api,scene}=fixture();const target=scene.controls.target.clone();api.zoom(1.8);api.step(1/60)
  assert.ok(Math.abs(scene.camera.position.distanceTo(scene.controls.target)-1.8)<1e-12)
  assert.ok(scene.controls.target.distanceTo(target)<1e-12)
  const first=api.state();api.step(1/12);assert.deepEqual(api.state(),first)
})
test('device angles remain unwrapped across turns; the independent ground guard owns world clearance',()=>{
  const {api}=fixture();for(let i=0;i<1000;i++){api.input(40,40);api.step(1/60)}
  assert.ok(Math.abs(api.state().yaw+60)<1e-8)
  assert.ok(Math.abs(api.state().pitch-(Math.PI/10+60))<1e-8)
})
test('invalid input and a stopped camera cannot move the scene',()=>{
  const {api,controller}=fixture();api.step();const initial=api.state()
  for(const pair of [[NaN,1],[1,Infinity],[-Infinity,0]])api.input(...pair)
  api.step();assert.deepEqual(api.state(),initial)
  controller.active=false;api.input(50,50);api.step();assert.deepEqual(api.state(),initial)
})
