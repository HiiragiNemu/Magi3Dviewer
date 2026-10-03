// db8e279 is the explicitly selected runtime; the rejected v4 edge-cap
// expectations are not claims about it. Sharp-fold regression work remains open.
import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';import * as T from 'three';import {ThirdPersonCamera} from './src/viewer/ThirdPersonCamera.ts';
test('contacts follow each posed actor, never the selected character identity',()=>{
 const code=fs.readFileSync('src/viewer/index.ts','utf8'),a=code.indexOf('function updateGarmentContacts('),b=code.indexOf('function setupMotionContactOptions()',a),hook=code.slice(a,b);
 assert.doesNotMatch(hook,/isSelected|characterSelected|locomotion-mode-enabled/);assert.match(hook,/projectSurface/);assert.match(hook,/solve\(active/);
});
test('Ctrl pan uses actor depth after dolly crosses a near-zero pivot, not a slow near-plane scale',()=>{
 const old=globalThis.window;globalThis.window={}
 try{
  const camera=new T.PerspectiveCamera(40,1,.01,1000),actor=new T.Group(),hip=new T.Bone();hip.name='Hip';hip.position.y=1;actor.add(hip);actor.updateMatrixWorld(true)
  const target=new T.Vector3(0,1,5.98),controls={target,enabled:true,panSpeed:1,disconnect(){},connect(){},update(){}}
  camera.position.set(0,1,6);camera.lookAt(target);const owner=new ThirdPersonCamera({scene:()=>({camera,controls,renderer:{domElement:{clientHeight:1000}}}),actor:()=>actor,released(){},status(){}})
  owner.start();owner.update();const before=camera.position.clone(),q=camera.quaternion.clone();owner.pan(100,0);owner.update()
  const expected=2*6*Math.tan(20*Math.PI/180)*100/1000
  assert.ok(Math.abs(camera.position.x-before.x+expected)<1e-9);assert.ok(q.angleTo(camera.quaternion)<1e-7)
  const settled=camera.position.clone();for(let i=0;i<100;i++)owner.update();assert.ok(camera.position.equals(settled))
 }finally{if(old===undefined)delete globalThis.window;else globalThis.window=old}
})
