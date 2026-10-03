import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
const {GarmentSurfaceContact}=await import('./src/viewer/garmentSurfaceContact.ts');
test('different cloth skin frames preserve the FINAL face direction for lighting and black outline',()=>{
 const root=new T.Group(),bones=[new T.Bone(),new T.Bone(),new T.Bone()];for(const b of bones)root.add(b);
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([-.06,.4,0,.06,.4,0,0,.55,0],3));geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute([0,0,0,0,1,0,0,0,2,0,0,0],4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));geometry.setAttribute('normal',new T.Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));geometry.setAttribute('reDriveBakedNormal',geometry.getAttribute('normal').clone());
 const mesh=new T.SkinnedMesh(geometry,new T.MeshBasicMaterial());root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new T.Skeleton(bones));
 bones[0].rotation.y=.6;bones[1].rotation.y=-.45;bones[2].rotation.x=.3;root.updateMatrixWorld(true);
 const world=i=>mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld),a=world(0),b=world(1),c=world(2),normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
 const shaderMatrix=i=>new T.Matrix3().setFromMatrix4(new T.Matrix4().copy(mesh.bindMatrixInverse).multiply(new T.Matrix4().multiplyMatrices(bones[i].matrixWorld,mesh.skeleton.boneInverses[i])).multiply(mesh.bindMatrix));
 for(let i=0;i<3;i++){const n=normal.clone().applyMatrix3(shaderMatrix(i).invert()).normalize();geometry.getAttribute('normal').setXYZ(i,n.x,n.y,n.z);geometry.getAttribute('reDriveBakedNormal').setXYZ(i,n.x,n.y,n.z)}
 const solver=new GarmentSurfaceContact(root,[0,1,2].map(index=>({mesh,index,node:bones[index],preferred:new T.Vector3(0,0,1)})),1);
 solver.project([{start:new T.Vector3(-.04,.3,0),end:new T.Vector3(-.04,.65,0),worldRadius:.09}],new T.Quaternion(),()=>false);
 const after=world(1).sub(world(0)).cross(world(2).sub(world(0))).normalize();assert.ok(solver.diagnostics.correctedVertices>0);
 for(let i=0;i<3;i++)for(const name of ['normal','reDriveBakedNormal']){const actual=new T.Vector3().fromBufferAttribute(mesh.geometry.getAttribute(name),i).applyMatrix3(shaderMatrix(i)).normalize();assert.ok(actual.dot(after)>.9999,`${name}:${i} dot=${actual.dot(after)}`)}
 solver.dispose();assert.equal(mesh.geometry,geometry);
});
