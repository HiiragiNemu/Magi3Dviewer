import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'
const source=fs.readFileSync('src/viewer/viewerLocomotion.ts','utf8')
const start=source.indexOf('    // A HomeWait is often a three-quarter'),end=source.indexOf('    const sampledBaselineTransforms',start)
assert.ok(start>0&&end>start)
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const apply=new Function('THREE','character','rig','motionPaths','savedBaselineTransforms','profile',code+'\nreturn generationYaw')
for(const sceneYaw of [0,Math.PI/2,-1.1])for(const homeYaw of [-.4,.32])test(`generation frame removes Home yaw ${homeYaw} independently of placement ${sceneYaw}`,()=>{
 const root=new THREE.Group(),hip=new THREE.Bone(),left=new THREE.Bone(),right=new THREE.Bone();root.position.set(7,.1,-20);root.rotation.y=sceneYaw;root.add(hip);hip.rotation.y=homeYaw;hip.add(left,right);left.position.set(.2,.4,0);right.position.set(-.2,.4,0);root.updateMatrixWorld(true)
 const before=hip.quaternion.clone(),saved=new Map([[hip,{position:hip.position.clone(),quaternion:before.clone(),scale:hip.scale.clone()}]])
 const angle=apply(THREE,{object:root},new Map([['hip',hip],['left',left],['right',right]]),{hip:'hip',upperArmL:'left',upperArmR:'right'},saved,{})
 assert.ok(Math.abs(angle+homeYaw)<1e-9);assert.ok(hip.quaternion.angleTo(new THREE.Quaternion())<1e-7)
 assert.deepEqual(saved.get(hip).quaternion.toArray(),before.toArray(),'original idle snapshot was mutated')
 assert.deepEqual(root.position.toArray(),[7,.1,-20]);assert.ok(Math.abs(root.rotation.y-sceneYaw)<1e-9)
})
test('rest-frame transport uses the immutable bind matrix, not AttachedBindMode moving inverse',()=>{
 const root=new THREE.Group(),hip=new THREE.Bone(),mesh=new THREE.SkinnedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());root.add(hip,mesh);hip.position.y=1;root.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton([hip]));root.position.set(8,0,-12);root.rotation.y=.7;root.updateMatrixWorld(true)
 const rest=mesh.matrixWorld.clone().multiply(mesh.bindMatrix.clone().invert()).multiply(mesh.skeleton.boneInverses[0].clone().invert())
 assert.ok(new THREE.Vector3().setFromMatrixPosition(rest).distanceTo(hip.getWorldPosition(new THREE.Vector3()))<1e-8)
 assert.match(source,/\.multiply\(mesh\.bindMatrix\.clone\(\)\.invert\(\)\)/)
})
