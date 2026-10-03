import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {GarmentSurfaceContact} from './src/viewer/garmentSurfaceContact.ts';

function sheet({inner=true,separateBone=false,rotation=0}={}){
 const root=new T.Group(),bones=[new T.Bone(),new T.Bone()];root.add(...bones);
 const geometry=new T.BufferGeometry(),points=[-.1,0,0,.1,0,0,0,.2,0];
 if(inner)points.push(0,.2,-.004,.1,0,-.004,-.1,0,-.004);
 const n=points.length/3,q=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),rotation);
 for(let i=0;i<n;i++)new T.Vector3().fromArray(points,i*3).applyQuaternion(q).toArray(points,i*3);
 geometry.setAttribute('position',new T.Float32BufferAttribute(points,3));
 geometry.setAttribute('normal',new T.Float32BufferAttribute(Array.from({length:n},(_,i)=>new T.Vector3(0,0,i<3?1:-1).applyQuaternion(q).toArray()).flat(),3));
 geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(Array.from({length:n},(_,i)=>[separateBone&&i>=3?1:0,0,0,0]).flat(),4));
 geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(Array(n).fill([1,0,0,0]).flat(),4));
 geometry.setAttribute('uv',new T.Float32BufferAttribute(Array(n).fill([.5,.5]).flat(),2));
 geometry.addGroup(0,3,0);if(inner)geometry.addGroup(3,3,1);
 const mesh=new T.SkinnedMesh(geometry,[new T.MeshBasicMaterial({color:'white'}),new T.MeshBasicMaterial({color:'brown'})]);root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new T.Skeleton(bones));
 const solver=new GarmentSurfaceContact(root,Array.from({length:n},(_,index)=>({mesh,index,node:bones[separateBone&&index>=3?1:0],preferred:new T.Vector3(0,0,1)})),1,q);
 solver.project([],new T.Quaternion(),()=>false);return {mesh,solver,geometry};
}
test('native inner lining does not acquire an outward colour or outline pass; exterior retains coloured back',()=>{
 for(const rotation of [0,Math.PI/2,-1.1]){
  const f=sheet({rotation});assert.deepEqual([...f.solver.nativeLiningFaces.get(f.mesh)],[3]);
  assert.deepEqual(f.solver.linings.map(x=>x.slot),[0]);
  assert.deepEqual([...f.mesh.geometry.getAttribute('garmentNativeLiningMask').array],[0,0,0,1,1,1]);
  assert.equal(f.mesh.material[0].side,T.FrontSide);assert.equal(f.mesh.material[1].side,T.FrontSide);
  assert.equal(f.solver.linings[0].mesh.material[0].side,T.BackSide);
  f.solver.restore(true);assert.equal(f.solver.linings[0].mesh.visible,false);f.solver.dispose();assert.equal(f.mesh.geometry,f.geometry);
 }
});
test('unlined cloth and independently skinned nearby sheets retain their original underside coverage',()=>{
 for(const [options,count]of [[{inner:false},1],[{separateBone:true},2]]){
  const f=sheet(options);assert.equal(f.solver.nativeLiningFaces.get(f.mesh).size,0);assert.equal(f.solver.linings.length,count);assert.ok([...f.mesh.geometry.getAttribute('garmentNativeLiningMask').array].every(x=>x===0));f.solver.dispose();
 }
});
