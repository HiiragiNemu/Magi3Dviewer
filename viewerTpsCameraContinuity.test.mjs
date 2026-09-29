import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import test, {after} from 'node:test';
import {ThirdPersonCamera} from './src/viewer/ThirdPersonCamera.ts';
const priorWindow=globalThis.window,priorDocument=globalThis.document;
if(!priorWindow)globalThis.window={};
if(!priorDocument)globalThis.document={pointerLockElement:null,body:{classList:{remove(){}}}};
after(()=>{if(!priorWindow)delete globalThis.window;if(!priorDocument)delete globalThis.document});
import assert from 'node:assert/strict';
const root=process.env.S6_TEST_ROOT??path.dirname(fileURLToPath(import.meta.url));
const runtime=process.env.S6_RUNTIME_ROOT??path.dirname(fileURLToPath(import.meta.url));
const THREE=await import(pathToFileURL(runtime+'/node_modules/three/build/three.module.js'));
const {OrbitControls}=await import(pathToFileURL(runtime+'/node_modules/three/examples/jsm/controls/OrbitControls.js'));
const sceneSource=fs.readFileSync(path.join(root,'magia-exedra-character-three/scene/index.ts'),'utf8');
const renderStatement=sceneSource.slice(sceneSource.indexOf('this.renderer.setAnimationLoop(timestamp => {')+'this.renderer.setAnimationLoop(timestamp => {'.length,sceneSource.indexOf('// apply user rotation'));
function fixture(){
 const camera=new THREE.PerspectiveCamera(40,1,.1,1000);camera.position.set(2,3,6);
 const controls=new OrbitControls(camera,null);controls.enableDamping=true;
 // Real OrbitControls owns damping, pan and dolly; only DOM listener plumbing
 // is replaced because this numerical test has no browser element.
 controls.connect=()=>{};controls.disconnect=()=>{};
 const scene={camera,controls,renderer:{domElement:{}}};const binding={character:{object:new THREE.Group()}};
 const owner=new ThirdPersonCamera({scene:()=>scene,actor:()=>binding.character.object,released(){},status(){}});
 owner.start();
 const rendered=new Function('scene',renderStatement.replaceAll('this.','scene.'));
 const api={input:(x,y)=>owner.move(x,y),step:()=>owner.update(),
  set:(yaw,pitch,distance)=>{owner.yaw=yaw;owner.pitch=pitch;owner.distance=distance},
  sync:()=>owner.start(),state:()=>({yaw:owner.yaw,pitch:owner.pitch,distance:owner.distance}),
  release:()=>owner.stop(),rendered:()=>rendered(scene)};
 return {scene,binding,api};
}
const angularError=(a,b)=>a.angleTo(b);
const closeQuaternion=(a,b,message)=>assert.ok(angularError(a,b)<1e-7,`${message}: ${THREE.MathUtils.radToDeg(angularError(a,b))} degrees`);
test('rendered TPS pose has one camera writer even when Orbit retains pending damping',()=>{
 const {scene,api}=fixture();scene.controls._rotateLeft(.8);scene.controls._rotateUp(.3);
 api.set(1.2,.4,2);api.step(1/60);const owned=scene.camera.quaternion.clone(),position=scene.camera.position.clone();
 for(let i=0;i<120;i++){api.step(1/60);api.rendered();closeQuaternion(scene.camera.quaternion,owned,'Orbit overwrote TPS');assert.ok(scene.camera.position.distanceTo(position)<1e-10)}
});
test('disabled Orbit cannot pan/dolly the rendered TPS pose; enabled normal Orbit still responds',()=>{
 const {scene,api}=fixture();scene.controls._panOffset.set(.4,.2,-.3);scene.controls._scale=.8;
 api.set(1.2,.4,2);api.step(1/60);const position=scene.camera.position.clone();api.rendered();assert.ok(position.distanceTo(scene.camera.position)<1e-10);
 scene.controls.enabled=true;api.rendered();assert.ok(position.distanceTo(scene.camera.position)>.001,'ordinary orbit must remain functional');
});
test('zero and tiny dolly distances retain the same angular frame with no hidden distance floor',()=>{
 for(const yaw of [-8,-Math.PI,-.2,0,1.2,Math.PI,8])for(const pitch of [-.3,0,.4,.95]){
  const {scene,api}=fixture();api.set(yaw,pitch,2);api.step(1/60);const expected=scene.camera.quaternion.clone();
  for(const distance of [.1,.0001,1e-12,0,1e-12,.0001,.1,2]){
   api.set(yaw,pitch,distance);api.step(1/60);api.rendered();closeQuaternion(expected,scene.camera.quaternion,'zero-distance angular snap');
   assert.ok(Math.abs(scene.camera.position.distanceTo(scene.controls.target)-distance)<1e-10,'zoom distance changed');
  }
 }
});
test('stationary near-target small drags stay linear across yaw wrap and frame rates',()=>{
 for(const fps of [12,30,60,144])for(const distance of [0,1e-12,.1,7.5]){
  const {scene,api}=fixture();api.set(Math.PI+.001,.4,distance);api.step(1/fps);
  for(let i=0;i<150;i++){
   const before=scene.camera.quaternion.clone();api.input(.5,0);api.step(1/fps);api.rendered();
   assert.ok(Math.abs(angularError(before,scene.camera.quaternion)-.00075)<1e-8,'small input amplified or dropped');
  }
  const stopped=scene.camera.quaternion.clone();for(let i=0;i<30;i++){api.step(1/fps);api.rendered();closeQuaternion(stopped,scene.camera.quaternion,'released input kept rotating')}
 }
});
test('zero-distance TPS to Orbit handoff preserves the next rendered frame, not only the handoff snapshot',()=>{
 const {scene,api}=fixture();api.set(1.2,.4,0);api.step(1/60);
 const q=scene.camera.quaternion.clone(),p=scene.camera.position.clone();api.release();api.rendered();
 closeQuaternion(q,scene.camera.quaternion,'Orbit first frame snapped after zero-distance TPS');assert.ok(p.distanceTo(scene.camera.position)<1e-10);
});
test('zero-distance TPS reentry recovers the visible yaw and pitch instead of undefined offset angles',()=>{
 const {scene,api}=fixture();api.set(1.2,.4,0);api.step(1/60);const q=scene.camera.quaternion.clone();api.release();api.sync();api.step(1/60);api.rendered();
 closeQuaternion(q,scene.camera.quaternion,'reentry lost zero-distance angular frame');
});
test('positive-distance orientation stays identical to the prior world-up lookAt convention',()=>{
 for(const yaw of [-7,-3.1416,-1,0,1,3.1416,7])for(const pitch of [-.3,0,.4,.95]){
  const {scene,api}=fixture();api.set(yaw,pitch,2);api.step(1/60);
  const expected=scene.camera.clone();expected.up.set(0,1,0);expected.lookAt(scene.controls.target);closeQuaternion(expected.quaternion,scene.camera.quaternion,'positive-distance view changed');
 }
});
