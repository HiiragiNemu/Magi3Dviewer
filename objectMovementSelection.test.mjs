import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = process.env.TEST_SOURCE_ROOT || path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(process.env.TEST_DEPS_ROOT ? path.join(process.env.TEST_DEPS_ROOT, 'package.json') : import.meta.url)
const ts = require('typescript'), THREE = require('three')
const read = n => fs.readFileSync(path.join(root,n),'utf8')
function runtime() {
  const code=ts.transpileModule(read('src/viewer/objectMovementSelection.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const exports={}; new Function('require','exports',code)(name=>name==='three'?THREE:require(name),exports); return exports
}
test('all three object kinds share selection, latest add wins and removed selection stops editing',()=>{
  const {ObjectMovementSelection}=runtime(), scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(); camera.position.set(0,1,5);camera.lookAt(0,1,0)
  const objects=['character','witch','weapon'].map(name=>{const o=new THREE.Group();o.name=name;scene.add(o);return o})
  const state=new ObjectMovementSelection();let changes=0
  for(const object of objects){state.select({object,label:object.name,changed:()=>changes++}); state.move(camera,1,0);}
  assert.deepEqual(objects.map(o=>o.position.x),[1,1,1]);assert.equal(state.current.object,objects[2]);assert.equal(changes,3)
  state.select({object:objects[0],label:'character'});state.rotate(.1); assert.notEqual(objects[0].quaternion.y,0);assert.equal(objects[2].quaternion.y,0)
  state.select({object:objects[2],label:'weapon'});state.forget(objects[0]);assert.ok(state.current);state.forget(objects[2]);state.move(camera,1,0);assert.equal(objects[2].position.x,1)
})
test('reset restores authored scale and world delta handles scaled rotated parents without camera changes',()=>{
  const {ObjectMovementSelection}=runtime(), scene=new THREE.Scene(), parent=new THREE.Group(), weapon=new THREE.Group(),camera=new THREE.PerspectiveCamera()
  camera.position.set(0,1,5);camera.lookAt(0,1,0);scene.add(parent);parent.scale.setScalar(2);parent.rotation.y=.7;parent.add(weapon);weapon.scale.setScalar(3);scene.updateMatrixWorld(true)
  const before=camera.matrixWorld.clone(),state=new ObjectMovementSelection();state.select({object:weapon,label:'weapon'});state.move(camera,1,1,1)
  const pos=weapon.getWorldPosition(new THREE.Vector3());assert.ok(pos.distanceTo(new THREE.Vector3(1,1,-1))<1e-10)
  state.rotate(.5);state.tilt(camera,.2);weapon.scale.setScalar(8);state.reset();assert.deepEqual(weapon.position.toArray(),[0,0,0]);assert.deepEqual(weapon.scale.toArray(),[3,3,3]);assert.ok(camera.matrixWorld.equals(before))
})
test('existing performance root ownership and detached objects are preserved',()=>{
  const {ObjectMovementSelection}=runtime(),object=new THREE.Group(),parent=new THREE.Scene();parent.add(object)
  const state=new ObjectMovementSelection(()=>true);state.select({object,label:'leased'});state.rotate(1);assert.equal(object.rotation.y,0)
  const other=new ObjectMovementSelection();other.select({object,label:'removed'});parent.remove(object);other.rotate(1);assert.equal(object.rotation.y,0)
})
test('nearest visible object across characters enemies and weapons receives click',()=>{
  const {pickMovementTarget}=runtime(),scene=new THREE.Scene();const targets=[-4,-2,-1].map(z=>{const object=new THREE.Group();object.position.z=z;object.add(new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5),new THREE.MeshBasicMaterial()));scene.add(object);return {object}});scene.updateMatrixWorld(true)
  const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,0,-1));assert.equal(pickMovementTarget(ray,targets),targets[2]);targets[2].object.visible=false;assert.equal(pickMovementTarget(ray,targets),targets[1])
})
test('viewer routes clicks and movement pad to shared object selection',()=>{
  const s=read('src/viewer/index.ts');assert.match(s,/movementSelection\.move\(scene\.camera/);assert.match(s,/weaponPanelController\?\.getInstances/);assert.match(s,/enemyPanelController\?\.enemyResources\.getInstances/);assert.match(s,/pickMovementTarget\(raycaster, targets\)/);assert.match(s,/onInstanceSelected: instance => selectMovementTarget/)
  const html=read('index.html');assert.match(html,/>Move and rotate<\/button>/);assert.match(html,/id="movement-target"/);assert.doesNotMatch(html,/id="weapon-load"/);assert.doesNotMatch(html,/data-channel="position"/);assert.match(html,/data-transform="scale"/)
})
