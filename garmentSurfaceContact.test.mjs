import test from 'node:test';import assert from 'node:assert/strict';
import {Bone,BufferGeometry,Float32BufferAttribute,Group,Matrix4,Mesh,MeshBasicMaterial,Quaternion,Skeleton,SkinnedMesh,Uint16BufferAttribute,Vector3} from 'three';
import {GarmentSurfaceContact} from './src/viewer/garmentSurfaceContact.ts';
function fixture(){
 const root=new Group(),hip=new Bone(),cloth=new Bone();hip.name='Hip';cloth.name='Skirt';root.add(hip);hip.add(cloth);cloth.position.y=.7;
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([-.02,.4,.02,.02,.4,.02,0,.45,.02,0,.8,0,-.02,.4,.02],3));geometry.setAttribute('normal',new Float32BufferAttribute(Array(5).fill([0,0,1]).flat(),3));geometry.setAttribute('uv',new Float32BufferAttribute([0,0,1,0,.5,1,.5,.5,0,0],2));geometry.setAttribute('skinIndex',new Uint16BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],4));geometry.setAttribute('skinWeight',new Float32BufferAttribute(Array(5).fill([1,0,0,0]).flat(),4));
 const mesh=new SkinnedMesh(geometry,new MeshBasicMaterial());mesh.name='Body_Mesh';root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new Skeleton([hip,cloth]));
 const helper=new SkinnedMesh(geometry,new MeshBasicMaterial());helper.name='Body:official-outline:0';root.add(helper);helper.bind(mesh.skeleton,mesh.bindMatrix);root.updateMatrixWorld(true);
 const independent=new Mesh(geometry,new MeshBasicMaterial());const source=[0,1,2,4].map(index=>({mesh,index,node:cloth,preferred:new Vector3(0,0,1)})),solver=new GarmentSurfaceContact(root,source,.8);
 const capsule={start:new Vector3(0,.3,0),end:new Vector3(0,.6,0),worldRadius:.08};return{root,hip,cloth,mesh,helper,independent,geometry,solver,capsule}
}
const vertexWorld=(mesh,i)=>mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld);
function distance(p,c){const d=c.end.clone().sub(c.start),t=Math.max(0,Math.min(1,p.clone().sub(c.start).dot(d)/d.lengthSq()));return p.distanceTo(d.multiplyScalar(t).add(c.start))}
test('cloth surface moves outside the collider immediately while body vertex and all bones stay exact',()=>{
 const f=fixture(),body=f.mesh.geometry.getAttribute('position').array.slice(9,12),bones=[f.hip,f.cloth].map(b=>[...b.position.toArray(),...b.quaternion.toArray(),...b.scale.toArray()]);
 const result=f.solver.project([f.capsule],new Quaternion(),()=>false);assert.ok(result.correctedVertices>=4);assert.ok(result.maxDisplacement<=.192001);assert.ok(result.remainingDepth<1e-6);
 for(const i of [0,1,2,4])assert.ok(distance(vertexWorld(f.mesh,i),f.capsule)>=f.capsule.worldRadius-1e-6);
 assert.deepEqual(f.mesh.geometry.getAttribute('position').array.slice(9,12),body);assert.deepEqual([f.hip,f.cloth].map(b=>[...b.position.toArray(),...b.quaternion.toArray(),...b.scale.toArray()]),bones)
});
test('projection uses an actor-local clone, including its outline but never another instance',()=>{
 const f=fixture(),base=f.geometry.getAttribute('position').array.slice();assert.notEqual(f.mesh.geometry,f.geometry);assert.equal(f.helper.geometry,f.mesh.geometry);assert.equal(f.independent.geometry,f.geometry);
 f.solver.project([f.capsule],new Quaternion(),()=>false);assert.deepEqual(f.independent.geometry.getAttribute('position').array,base);assert.notDeepEqual(f.mesh.geometry.getAttribute('position').array,base);
 for(const attr of ['uv','skinIndex','skinWeight'])assert.deepEqual(f.mesh.geometry.getAttribute(attr).array,f.geometry.getAttribute(attr).array);
 assert.deepEqual(f.mesh.geometry.getAttribute('normal').array.slice(9,12),f.geometry.getAttribute('normal').array.slice(9,12),'body normal stays exact');
 assert.notDeepEqual(f.mesh.geometry.getAttribute('normal').array.slice(0,3),f.geometry.getAttribute('normal').array.slice(0,3),'deformed cloth normals follow the fold');
 f.solver.dispose();assert.equal(f.mesh.geometry,f.geometry);assert.equal(f.helper.geometry,f.geometry);assert.deepEqual(f.mesh.geometry.getAttribute('position').array,base)
});
test('inverse skin transport stays correct with a rotated and nonuniformly scaled actor',()=>{
 const f=fixture();f.root.scale.set(.8,1.3,1.1);f.root.rotation.set(.1,.6,-.2);f.root.position.set(2,1,-3);f.cloth.rotation.set(.2,.1,.05);f.root.updateMatrixWorld(true);
 const p=vertexWorld(f.mesh,0);const capsule={start:p.clone().add(new Vector3(0,-.1,-.015)),end:p.clone().add(new Vector3(0,.1,-.015)),worldRadius:.075};
 const result=f.solver.project([capsule],new Quaternion().setFromEuler(f.root.rotation),()=>false,1.3);assert.ok(result.correctedVertices>0);assert.ok(distance(vertexWorld(f.mesh,0),capsule)>=capsule.worldRadius-1e-6)
});
test('blended bone weights do not leak the inverse-skin correction into a body vertex',()=>{
 const f=fixture();f.solver.dispose();const w=f.geometry.getAttribute('skinWeight'),idx=f.geometry.getAttribute('skinIndex');for(const i of [0,1,2,4]){w.setXYZW(i,.7,.3,0,0);idx.setXYZW(i,1,0,0,0)}
 const solver=new GarmentSurfaceContact(f.root,[0,1,2,4].map(index=>({mesh:f.mesh,index,node:f.cloth,preferred:new Vector3(0,0,1)})),.8);f.cloth.rotation.x=.3;f.root.updateMatrixWorld(true);
 const p=vertexWorld(f.mesh,0),body=vertexWorld(f.mesh,3).toArray(),capsule={start:p.clone().add(new Vector3(0,-.1,-.02)),end:p.clone().add(new Vector3(0,.1,-.02)),worldRadius:.07};solver.project([capsule],new Quaternion(),()=>false);
 assert.ok(distance(vertexWorld(f.mesh,0),capsule)>=capsule.worldRadius-1e-6);assert.deepEqual(vertexWorld(f.mesh,3).toArray(),body)
});
test('600 static surface evaluations have identical results, restore exact positions, and no stored spring velocity',()=>{
 const f=fixture();f.solver.project([f.capsule],new Quaternion(),()=>false);const first=f.mesh.geometry.getAttribute('position').array.slice();for(let i=0;i<600;i++){f.solver.project([f.capsule],new Quaternion(),()=>false);assert.deepEqual(f.mesh.geometry.getAttribute('position').array,first)}f.solver.restore();assert.deepEqual(f.mesh.geometry.getAttribute('position').array,f.geometry.getAttribute('position').array)
});
test('manually pinned cloth is not overwritten, and a later live pose evaluates once without history',()=>{
 const f=fixture(),base=f.geometry.getAttribute('position').array.slice();f.solver.project([f.capsule],new Quaternion(),()=>false);const contact=f.mesh.geometry.getAttribute('position').array.slice();f.solver.project([f.capsule],new Quaternion(),n=>n===f.cloth);assert.deepEqual(f.mesh.geometry.getAttribute('position').array,base);f.solver.project([f.capsule],new Quaternion(),()=>false);assert.deepEqual(f.mesh.geometry.getAttribute('position').array,contact)
});
test('overlarge or conflicting contacts stop at a bounded surface displacement rather than moving the actor',()=>{
 const f=fixture(),body=f.root.position.toArray(),result=f.solver.project([{start:new Vector3(0,0,0),end:new Vector3(0,2,0),worldRadius:3}],new Quaternion(),()=>false);assert.ok(result.limited);assert.ok(result.maxDisplacement<=.192001);assert.ok(result.remainingDepth>0);assert.deepEqual(f.root.position.toArray(),body);assert.ok([...f.mesh.geometry.getAttribute('position').array].every(Number.isFinite))
});
