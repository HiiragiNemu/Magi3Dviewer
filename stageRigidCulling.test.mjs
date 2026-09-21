import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'
const require=createRequire(import.meta.url), source=readFileSync(new URL('./src/viewer/stageRigidCulling.ts',import.meta.url),'utf8')
const module={exports:{}}
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{require:name=>name==='three'?THREE:require(name),module,exports:module.exports})
const {enableRigidStageCulling}=module.exports
const make=()=>new THREE.Mesh(new THREE.BoxGeometry(2,3,4),new THREE.MeshStandardMaterial())
test('rigid objects cull separately against color and shadow-camera frusta without changing geometry/material',()=>{
    const mesh=make(),geometry=mesh.geometry,material=mesh.material
    assert.equal(enableRigidStageCulling(mesh),true);assert.notEqual(mesh.boundingSphere,geometry.boundingSphere)
    assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material)
    const camera=new THREE.PerspectiveCamera(45,1,.1,20),frustum=new THREE.Frustum()
    const update=()=>{camera.updateMatrixWorld();frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))}
    mesh.position.set(0,0,-8);mesh.updateMatrixWorld();update();assert.equal(frustum.intersectsObject(mesh),true)
    mesh.position.x=100;mesh.updateMatrixWorld();assert.equal(frustum.intersectsObject(mesh),false)
    camera.position.x=100;update();assert.equal(frustum.intersectsObject(mesh),true)
})
for(const kind of ['skin','instance','morph','dynamic-position','shader','displacement','custom-hook','custom-shadow','explicit-dynamic','shadow-proxy'])test(`${kind} retains unculled policy`,()=>{
    let mesh=make()
    if(kind==='skin')mesh=new THREE.SkinnedMesh(mesh.geometry,mesh.material)
    if(kind==='instance')mesh=new THREE.InstancedMesh(mesh.geometry,mesh.material,1)
    if(kind==='morph')mesh.geometry.morphAttributes.position=[mesh.geometry.attributes.position.clone()]
    if(kind==='dynamic-position')mesh.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage)
    if(kind==='shader')mesh.material=new THREE.ShaderMaterial()
    if(kind==='displacement')mesh.material.displacementMap=new THREE.Texture()
    if(kind==='custom-hook')mesh.material.onBeforeCompile=()=>{}
    if(kind==='custom-shadow')mesh.customDepthMaterial=new THREE.ShaderMaterial()
    if(kind==='explicit-dynamic')mesh.userData.stageDynamicVertexPosition=true
    if(kind==='shadow-proxy')mesh.name='stage-shadow-caster-actor'
    assert.equal(enableRigidStageCulling(mesh),false);assert.equal(mesh.frustumCulled,false)
})
test('known position-preserving stage hooks and alpha atlas remain eligible',()=>{const mesh=make();mesh.material.onBeforeCompile=()=>{};mesh.material.userData.stageRigidVertexPosition=true;mesh.material.transparent=true;mesh.material.alphaTest=.4;assert.equal(enableRigidStageCulling(mesh),true)})
test('non-finite or absent bounds never reject visible meshes',()=>{const mesh=make();mesh.geometry=new THREE.BufferGeometry();assert.equal(enableRigidStageCulling(mesh),false);mesh.geometry=make().geometry;mesh.geometry.computeBoundingSphere=()=>{mesh.geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),Infinity)};assert.equal(enableRigidStageCulling(mesh),false)})
test('conservative object bounds contain every vertex across sheared parent transforms',()=>{
    const mesh=make();enableRigidStageCulling(mesh);const root=new THREE.Group(),middle=new THREE.Group();root.add(middle);middle.add(mesh)
    for(let i=0;i<120;i++){
        root.scale.set(.1+(i%7),.3+(i%13),.2+(i%3));root.rotation.set(i*.27,i*.13,i*.17)
        middle.scale.set(.4+(i%5),.2+(i%8),2);middle.rotation.set(i*.73,i*.39,i*.51)
        mesh.rotation.set(i*.17,i*.71,i*.29);root.updateMatrixWorld(true)
        const sphere=mesh.boundingSphere.clone().applyMatrix4(mesh.matrixWorld),a=mesh.geometry.attributes.position
        for(let j=0;j<a.count;j++)assert.ok(sphere.containsPoint(new THREE.Vector3().fromBufferAttribute(a,j).applyMatrix4(mesh.matrixWorld)))
    }
})
test('stage preparation uses policy instead of unconditional false; bindings explicitly certify geometry',()=>{
    const stages=readFileSync(new URL('./src/viewer/stages.ts',import.meta.url),'utf8'),body=stages.slice(stages.indexOf('function prepareStageObject('),stages.indexOf('function disposeStageObject('))
    assert.match(body,/enableRigidStageCulling\(mesh\)/);assert.doesNotMatch(body,/mesh\.frustumCulled = false/)
    const bindings=readFileSync(new URL('./src/viewer/stageMaterialBindings.ts',import.meta.url),'utf8');assert.equal(bindings.split('material.userData.stageRigidVertexPosition = true').length-1,2)
})
