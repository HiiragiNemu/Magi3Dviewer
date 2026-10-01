import assert from 'node:assert/strict'
import test,{after} from 'node:test'
import fs from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import ts from 'typescript'
import * as T from 'three'
import {FBXLoader} from 'three/examples/jsm/loaders/FBXLoader.js'
import {poseBones,findDirectPoseParts} from './src/viewer/directPoseTools.ts'
import {groupedPoseParts,poseNodePages,posePartLabel,captureModelLocal,makeSavedPose,validateSavedPose,resolveSavedPose} from './src/viewer/poseWorkspace.ts'
import {capturePlaneGesture,resolvePlaneGesture} from './src/viewer/cameraPlaneGesture.ts'
import {TpsViewGesture} from './src/viewer/TpsViewTouch.ts'
import {ThirdPersonCamera} from './src/viewer/ThirdPersonCamera.ts'
import {pickMovementTarget} from './src/viewer/objectMovementSelection.ts'
const previousWindow=globalThis.window
if(!previousWindow)globalThis.window={}
after(()=>{if(!previousWindow)delete globalThis.window})
function loadRig(id){const original=T.TextureLoader.prototype.load;T.TextureLoader.prototype.load=()=>new T.Texture();try{const b=zlib.gunzipSync(fs.readFileSync(`magia-exedra-character-three/models/chara_${id}_battle_unit/VisualRoot.fbx.gz`));return new FBXLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')}finally{T.TextureLoader.prototype.load=original}}
for(const id of ['100101','101401','100201','101901'])test(`real ${id}: main anatomy and complete named fingers, no renderer-copy/root controls`,()=>{
 const actor=loadRig(id),before=captureModelLocal(actor),main=findDirectPoseParts(actor),more=groupedPoseParts(actor,'more'),hands=poseNodePages(actor,'hands')
 for(const name of ['Arm_L','Arm_R','UpLeg_L','UpLeg_R','Waist'])assert.ok(main.some(p=>p.bone.name===name),name+' absent from primary')
 assert.ok(more.every(p=>!main.some(m=>m.bone.name===p.bone.name)&&!/^(Root|chara_\d+)$/i.test(p.bone.name)))
 assert.equal(new Set([...main,...more,...groupedPoseParts(actor,'hands')].map(p=>p.bone)).size,main.length+more.length+groupedPoseParts(actor,'hands').length)
 assert.equal(hands.length,10,'five named fingers on each hand')
 for(const side of ['left','right']){
  assert.deepEqual(hands.filter(p=>p.side===side).map(p=>p.finger),['thumb','index','middle','ring','pinky'])
  for(const page of hands.filter(p=>p.side===side)){
   assert.equal(page.parts.length,page.finger==='thumb'?3:4)
   // Display side is now fixed to the FRONT observer, not native anatomical L/R.
   assert.ok(page.parts.every(p=>p.bone.name.endsWith(side==='left'?'_R':'_L')))
   const labels=page.parts.map(p=>posePartLabel(p,'zh-CN'));assert.equal(new Set(labels).size,labels.length)
  }
 }
 assert.deepEqual(captureModelLocal(actor),before,'classification must never mutate native bones')
 assert.ok(poseBones(actor).length>main.length)
 assert.ok(!main.some(p=>/^(?:Hip|Spine)$/i.test(p.bone.name)))
 assert.ok(!more.some(p=>/^(?:Hip|Hips|Pelvis)$/i.test(p.bone.name)))
 const spine=poseBones(actor).find(b=>b.name==='Spine'),waist=poseBones(actor).find(b=>b.name==='Waist')
 assert.ok(spine&&waist&&spine!==waist)
 assert.ok(more.some(p=>p.bone===spine),'independent lower-spine control was lost')
 assert.ok(poseNodePages(actor,'more').some(p=>p.category==='torso'&&p.parts.some(n=>n.bone===spine)))
 actor.updateMatrixWorld(true);assert.ok(spine.getWorldPosition(new T.Vector3()).distanceTo(waist.getWorldPosition(new T.Vector3()))>.04,'real pivots were incorrectly treated as identical')

})
test('Momoko matched-body atlas is pinned to the audited native texture identities',()=>{
 const report=JSON.parse(fs.readFileSync('docs/reports/2026-10-01-momoko-texture-identity.json','utf8'))
 assert.equal(report.renderMeshId,'-5932126041047460660');assert.equal(report.textures.filter(t=>t.restored).length,3)
 for(const row of report.textures.filter(t=>t.restored)){
  const b=fs.readFileSync(`magia-exedra-character-three/models/chara_101401_battle_unit/${row.name}.png`)
  assert.equal(crypto.createHash('sha256').update(b).digest('hex'),row.afterPngSha256)
  assert.notEqual(row.afterPngSha256,row.beforePngSha256)
  assert.ok(row.differentPixels>0)
 }
})
test('two-finger twist preserves optical orientation and exact position/target/separation, including interleaved events',()=>{
 const camera=new T.PerspectiveCamera(40,1,.05,100);camera.position.set(0,1,5);const target=new T.Vector3(0,1,0);camera.lookAt(target)
 const base=capturePlaneGesture(camera,target,900);let result
 const gesture=new TpsViewGesture({rotate(){throw Error('orbit leaked into two-finger roll')},pinch(){throw Error('legacy ratio zoom leaked')},two:d=>result=resolvePlaneGesture(base,d)})
 gesture.begin({id:1,x:200,y:300});gesture.begin({id:2,x:400,y:300})
 gesture.move([{id:1,x:300,y:200}]);gesture.move([{id:2,x:300,y:400}])
 assert.deepEqual(result.position.toArray(),camera.position.toArray());assert.deepEqual(result.target.toArray(),target.toArray());assert.ok(Math.abs(result.distance-5)<1e-12)
 assert.ok(result.quaternion.angleTo(camera.quaternion)<1e-7,'pinching must not roll the horizon')
 gesture.move([{id:2,x:400,y:300}]);gesture.move([{id:1,x:200,y:300}]);assert.ok(result.quaternion.angleTo(camera.quaternion)<1e-7);assert.deepEqual(result.position.toArray(),camera.position.toArray())
})
function cameraFixture(distance=5){const camera=new T.PerspectiveCamera(40,1,.05,100),target=new T.Vector3(0,1,0);camera.position.set(0,1,distance);camera.lookAt(target);const controls={target,enabled:true,rotateSpeed:1,zoomSpeed:1,connect(){},disconnect(){},update(){}};const scene={camera,controls,renderer:{domElement:{clientHeight:900,getBoundingClientRect:()=>({height:900})}}};const owner=new ThirdPersonCamera({scene:()=>scene,actor:()=>undefined,released(){},status(){}});owner.start();owner.update();return{camera,target,owner,scene}}
test('TPS screen drag has the same full-viewport angular gain as ordinary Orbit',()=>{const f=cameraFixture();f.owner.rotateViewport(90,45);f.owner.update();assert.ok(Math.abs(f.owner.yaw+Math.PI*.2)<1e-10);assert.ok(Math.abs(f.owner.pitch-Math.PI*.1)<1e-10);const q=f.camera.quaternion.toArray();for(let i=0;i<240;i++)f.owner.update();assert.deepEqual(f.camera.quaternion.toArray(),q)})
test('TPS equal wheel notches move equal distances before and beyond the pivot, without a hard range cap',()=>{
 const f=cameraFixture(.15),q=f.camera.quaternion.clone(),steps=[]
 for(let i=0;i<4;i++){const before=f.camera.position.clone();f.owner.zoom(-120);f.owner.update();steps.push(f.camera.position.distanceTo(before));assert.ok(f.camera.quaternion.angleTo(q)<1e-7)}
 for(const step of steps)assert.ok(Math.abs(step-.42)<1e-10)
 f.owner.zoom(50000);f.owner.update();assert.ok(f.owner.distance>40,'arbitrary 10/20/40 unit ceiling remains')
})
test('entering TPS does not discard an existing optical roll',()=>{const f=cameraFixture();f.owner.active=false;f.camera.quaternion.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),.8));const q=f.camera.quaternion.clone(),p=f.camera.position.clone();f.owner.start();f.owner.update();assert.ok(f.camera.quaternion.angleTo(q)<1e-7);assert.ok(f.camera.position.distanceTo(p)<1e-10)})
test('animated hit testing updates cached rest bounds and ignores hidden outline-only hits',()=>{
 const actor=new T.Group(),bone=new T.Bone();actor.add(bone)
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([-.2,-.2,0,.2,-.2,0,0,.2,0],3));g.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Array(12).fill(0),4));g.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4))
 const mesh=new T.SkinnedMesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));actor.add(mesh);actor.updateMatrixWorld(true);mesh.bind(new T.Skeleton([bone]));mesh.computeBoundingSphere();mesh.computeBoundingBox();bone.position.y=3
 const ray=new T.Raycaster(new T.Vector3(0,3,2),new T.Vector3(0,0,-1)),target={object:actor}
 assert.equal(pickMovementTarget(ray,[target]),target)
 const outline=new T.Mesh(new T.PlaneGeometry(20,20),new T.MeshBasicMaterial());outline.name='Body:official-outline:0';outline.position.z=1;const wrong={object:new T.Group()};wrong.object.add(outline)
 assert.equal(pickMovementTarget(ray,[wrong,target]),target)
 actor.visible=false;assert.equal(pickMovementTarget(ray,[target]),undefined)
})
test('generic pose authority follows the actual selected instance, never a stale enemy panel or last girl',()=>{
 const source=fs.readFileSync('src/viewer/index.ts','utf8'),ast=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true),names=['getPoseActor','getPoseActors','getPoseModel','pausePoseActor'];const selected=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text));assert.equal(selected.length,names.length)
 const girl=loadRig('100101'),a=loadRig('101401'),b=loadRig('101401'),movementSelection={current:{object:a}};let girlPauses=0
 const enemies=[a,b].map((object,i)=>({object,entry:{modelPrefabName:'enemy-fixture'},animationPaused:false,setAnimationPaused(v){this.animationPaused=v}}))
 const scene={characterSelected:{character:{object:girl,userData:{characterId:100101},animation:{paused:false}}}};scene.characters=[scene.characterSelected]
 const api=Function('THREE','scene','movementSelection','enemyPanelController','groupedPoseParts','pauseSelectedAnimation',`const poseActorCapabilities=new WeakMap();${ts.transpileModule(selected.map(n=>n.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText};return{actor:getPoseActor,model:getPoseModel,pause:pausePoseActor,all:getPoseActors}`)(T,scene,movementSelection,{enemyResources:{getInstances:()=>enemies},getSelectedInstance:()=>enemies[0]},groupedPoseParts,()=>{girlPauses++})
 assert.equal(api.actor(),a);api.pause(a);assert.equal(enemies[0].animationPaused,true);assert.equal(enemies[1].animationPaused,false);assert.equal(girlPauses,0)
 movementSelection.current.object=b;assert.equal(api.actor(),b);assert.equal(api.model(a),api.model(b));assert.equal(api.model(girl),'100101')
 movementSelection.current.object=new T.Mesh();assert.equal(api.actor(),undefined,'a rigid prop must not edit the girl')
 movementSelection.current.object=girl;assert.equal(api.actor(),girl);api.pause(girl);assert.equal(girlPauses,1)
 assert.equal(api.all().length,3)
})

test('native hidden/reflective subparts save losslessly but cannot be force-enabled through pose import',()=>{
 const actor=new T.Group(),hip=new T.Bone(),visible=new T.Bone(),hidden=new T.Bone(),child=new T.Bone(),mirror=new T.Bone();hip.name='Hip';visible.name='Body_01';hidden.name='HeadB_Root';child.name='HeadB_01';mirror.name='Ribbon_R';actor.add(hip);hip.add(visible,hidden,mirror);hidden.add(child);hidden.scale.set(0,0,0);mirror.scale.set(-1,1,1)
 const baseline=captureModelLocal(actor),pose=makeSavedPose(actor,'enemy:test','Native phases',baseline)
 assert.equal(pose.requiresStretch,false);assert.doesNotThrow(()=>validateSavedPose(pose));assert.equal(resolveSavedPose(actor,'enemy:test',pose,false,baseline).length,pose.nodes.length)
 assert.ok(!groupedPoseParts(actor,'more').some(p=>p.bone===hidden||p.bone===child));assert.ok(groupedPoseParts(actor,'more').some(p=>p.bone===mirror))
 const forged=structuredClone(pose);forged.nodes.find(n=>n.path.includes('HeadB_Root')&&!n.path.includes('HeadB_01')).transform.s=[1,1,1]
 assert.throws(()=>resolveSavedPose(actor,'enemy:test',forged,true,baseline),/不能通过姿态导入强制启用/)
})
