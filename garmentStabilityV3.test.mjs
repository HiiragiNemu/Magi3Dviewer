import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import * as T from 'three'
import {GarmentSurfaceContact} from './src/viewer/garmentSurfaceContact.ts'
import {ThirdPersonCamera} from './src/viewer/ThirdPersonCamera.ts'

function clothFixture(){
 const root=new T.Group(),hip=new T.Bone(),cloth=new T.Bone();hip.name='Hip';cloth.name='Skirt_F_C_01_Sp';root.add(hip);hip.add(cloth)
 const positions=[],weights=[],skin=[],triangles=[],source=[],size=13
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){positions.push((x/(size-1)-.5)*.6,.5+y/(size-1)*.6,0);skin.push(y===size-1?0:1,0,0,0);weights.push(1,0,0,0);if(x<size-1&&y<size-1){let a=y*size+x;triangles.push(a,a+1,a+size,a+1,a+size+1,a+size)}}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(skin,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));geometry.setIndex(triangles)
 const mesh=new T.SkinnedMesh(geometry,new T.MeshBasicMaterial()),skeleton=new T.Skeleton([hip,cloth]);root.add(mesh);root.updateMatrixWorld(true);mesh.bind(skeleton)
 for(let i=0;i<size*(size-1);i++)source.push({mesh,index:i,node:cloth,preferred:new T.Vector3(0,0,1)})
 const native=new Float32Array(geometry.getAttribute('position').array),solver=new GarmentSurfaceContact(root,source,1)
 const capsule={start:new T.Vector3(0,.68,-.025),end:new T.Vector3(0,.86,-.025),worldRadius:.07}
 return{root,hip,cloth,mesh,geometry,native,solver,capsule,size}
}
function solve(f,dt=1/60){f.root.updateMatrixWorld(true);return f.solver.project([f.capsule],new T.Quaternion(),()=>false,1,dt)}
test('dense real triangle cloth cannot inflate by stretching edges; pinned body boundary and native bones stay exact',()=>{
 const f=clothFixture(),q=f.cloth.quaternion.toArray(),p=f.cloth.position.toArray(),result=solve(f)
 assert.ok(result.correctedVertices>0);assert.ok(result.maxEdgeRatio<=1.120001);assert.ok(result.maxDisplacement<=.200001)
 assert.deepEqual(f.cloth.quaternion.toArray(),q);assert.deepEqual(f.cloth.position.toArray(),p)
 const values=f.mesh.geometry.getAttribute('position').array
 assert.deepEqual([...values.slice(f.size*(f.size-1)*3)],[...f.native.slice(f.size*(f.size-1)*3)])
 f.solver.dispose();assert.equal(f.mesh.geometry,f.geometry);assert.deepEqual([...f.geometry.getAttribute('position').array],[...f.native])
})
test('unchanged contact converges without spring energy, alternating side or persistent cloth vibration',()=>{
 const f=clothFixture();let previous,tailMax=0
 for(let i=0;i<240;i++){const result=solve(f),now=[...f.mesh.geometry.getAttribute('position').array];assert.ok(result.maxEdgeRatio<=1.120001);if(previous&&i>190)tailMax=Math.max(tailMax,...now.map((v,k)=>Math.abs(v-previous[k])));previous=now}
 assert.ok(tailMax<1e-6,'static contact oscillation: '+tailMax);f.solver.dispose()
})
test('an exterior hand dents fabric toward the body instead of flipping a skirt outward',()=>{
 const f=clothFixture();f.capsule.arm=true;f.capsule.start.z=.025;f.capsule.end.z=.025;solve(f,0)
 const values=f.mesh.geometry.getAttribute('position').array
 assert.ok(values.some((v,i)=>i%3===2&&v<-.001));for(let i=0;i<values.length/3;i++){const x=f.native[i*3],y=f.native[i*3+1];if(Math.abs(x)<.04&&y>.69&&y<.85)assert.ok(values[i*3+2]<-.005,'contact region moved through the wrong cloth side')}f.solver.dispose()
})
test('turning off after repeated moving contacts restores exact original mesh bytes',()=>{
 const f=clothFixture();for(let i=0;i<120;i++){f.capsule.start.x=f.capsule.end.x=Math.sin(i*.1)*.12;solve(f)}f.solver.restore();f.solver.clearHistory()
 assert.deepEqual([...f.mesh.geometry.getAttribute('position').array],[...f.native]);f.solver.dispose()
})
test('native cloth bones are no longer contacts writers or a second absolute-pose low-pass',()=>{
 const code=fs.readFileSync('src/viewer/garmentContacts.ts','utf8')
 assert.doesNotMatch(code,/rotateBone|setAxisRotation|\.node\.quaternion\.(?:copy|multiply|slerp)/)
 const index=fs.readFileSync('src/viewer/index.ts','utf8'),a=index.indexOf('function updateGarmentContacts('),b=index.indexOf('function setupMotionContactOptions()',a),hook=index.slice(a,b)
 assert.doesNotMatch(hook,/isSelected|characterSelected|locomotion-mode-enabled|inMotion/)
 assert.match(hook,/solve\(garmentContactsEnabled/)
})
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
