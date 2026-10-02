import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as T from 'three';
import { GarmentSurfaceContact } from './src/viewer/garmentSurfaceContact.ts';

function fixture() {
 const root=new T.Group(),hip=new T.Bone(),cloth=new T.Bone();hip.name='Hip';cloth.name='Skirt';root.add(hip);hip.add(cloth);
 const source=new T.BufferGeometry();source.setAttribute('position',new T.Float32BufferAttribute([-.06,.4,0,.06,.4,0,0,.5,0,-.06,.6,0,.06,.6,0,0,.7,0],3));source.setAttribute('normal',new T.Float32BufferAttribute(Array(6).fill([0,0,1]).flat(),3));source.setAttribute('skinIndex',new T.Uint16BufferAttribute(Array(6).fill([1,0,0,0]).flat(),4));source.setAttribute('skinWeight',new T.Float32BufferAttribute(Array(6).fill([1,0,0,0]).flat(),4));source.addGroup(0,3,0);source.addGroup(3,3,1);
 const mesh=new T.SkinnedMesh(source,new T.MeshBasicMaterial());root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new T.Skeleton([hip,cloth]));
 const views=[];
 for(let i=0;i<2;i++){
  const geometry=new T.BufferGeometry();for(const [key,attribute] of Object.entries(source.attributes))geometry.setAttribute(key,attribute);geometry.setDrawRange(i*3,3);geometry.name='official-outline-group';
  const view=new T.SkinnedMesh(geometry,new T.MeshBasicMaterial({side:T.BackSide}));view.name='Body:official-outline:'+i;view.bind(mesh.skeleton,mesh.bindMatrix);mesh.add(view);views.push({view,original:geometry});
 }
 const other=new T.SkinnedMesh(source,new T.MeshBasicMaterial());other.bind(mesh.skeleton,mesh.bindMatrix);
 const solver=new GarmentSurfaceContact(root,Array.from({length:6},(_,index)=>({mesh,index,node:cloth,preferred:new T.Vector3(0,0,1)})),1);
 root.updateMatrixWorld(true);
 return{root,hip,cloth,source,mesh,views,other,solver,capsule:{arm:true,start:new T.Vector3(0,.38,.02),end:new T.Vector3(0,.73,.02),worldRadius:.075}};
}

test('real material-slot outline Geometry views share deformed positions but preserve independent draw ranges',()=>{
 const f=fixture(),original=f.source.getAttribute('position').array.slice();
 const result=f.solver.project([f.capsule],new T.Quaternion(),()=>false);
 assert.ok(result.correctedVertices>0,'the test must exercise deformation');
 for(const [i,{view,original:geometry}] of f.views.entries()){
  assert.notEqual(view.geometry,geometry);
  assert.notEqual(view.geometry,f.mesh.geometry,'do not replace the slot view with an all-material draw');
  assert.deepEqual(view.geometry.drawRange,{start:i*3,count:3});
  assert.equal(view.geometry.getAttribute('position'),f.mesh.geometry.getAttribute('position'));
  for(let j=i*3;j<(i+1)*3;j++)assert.ok(view.getVertexPosition(j,new T.Vector3()).distanceTo(f.mesh.getVertexPosition(j,new T.Vector3()))<1e-9,'stale outline protrudes into the cloth');
 }
 assert.equal(f.other.geometry,f.source);assert.deepEqual(f.source.getAttribute('position').array,original);
 f.solver.restore();assert.deepEqual(f.mesh.geometry.getAttribute('position').array,original);
 f.solver.dispose();assert.equal(f.mesh.geometry,f.source);for(const {view,original:geometry} of f.views)assert.equal(view.geometry,geometry);
});

test('repeated opt-out and recreation never leaves stale helper buffers or modifies another actor',()=>{
 for(let i=0;i<15;i++){
  const f=fixture(),native=f.source.getAttribute('position').array.slice();
  for(let j=0;j<10;j++){f.solver.project([f.capsule],new T.Quaternion(),()=>false,1,1/60);f.solver.restore();for(const {view}of f.views)assert.deepEqual(view.geometry.getAttribute('position').array,native)}
  f.solver.dispose();assert.equal(f.other.geometry,f.source);assert.deepEqual(f.source.getAttribute('position').array,native);
 }
});

test('body collision cannot be hidden by the rejected +10 degree arm pose or forcing 114501 onto Touka',()=>{
 const source=fs.readFileSync('src/viewer/viewerLocomotion.ts','utf8');
 assert.doesNotMatch(source,/angles\.outward\s*\+=\s*10|101901-114501-native-arms-target-hoop/);
 assert.match(source,/const naturalUpperBodyWeights = naturalUpperBodyTrajectoryWeights\[naturalUpperBodyProfileId\]/);
 assert.match(source,/controller-aligned-transient-generation-v1/,'retain the independent facing correction');
});
