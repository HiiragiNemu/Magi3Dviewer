import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.env.MAGIUS_TEST_SOURCE_ROOT??path.dirname(fileURLToPath(import.meta.url));
const runtime=process.env.MAGIUS_TEST_RUNTIME_ROOT??root;
const req=createRequire(path.join(runtime,'package.json')),ts=req('typescript');
const T=await import(pathToFileURL(path.join(runtime,'node_modules/three/build/three.module.js')));
const {TransformControls}=await import(pathToFileURL(path.join(runtime,'node_modules/three/examples/jsm/controls/TransformControls.js')));
const source=fs.readFileSync(path.join(root,'src/viewer/index.ts'),'utf8'),ast=ts.createSourceFile('viewer.ts',source,ts.ScriptTarget.Latest,true);
const names=['getPoseEntries','applyPoseEntry','applyManualPoseOverrides','resetActionParameters','getPoseEntryBase','getPoseEntryPositionBase','syncPoseEntryControls','setDirectPoseTransformMode','updateDirectPoseUi','selectDirectPoseBone','clearDirectPoseSelection','setDirectPoseEditing','syncDirectPoseOffsetsFromBone','setupDirectPoseEditing'];
const optional=['directPoseScreenTranslationDelta','poseQuaternionMatches','finishDirectPoseDrag','updateDirectPoseTarget','requestDirectPoseFeedback'];
const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&[...names,...optional].includes(n.name?.text));
assert.ok(functions.length>=names.length);
const js=ts.transpileModule(functions.map(n=>n.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function element(){const attrs=new Map(),listeners=new Map(),captures=new Set(),classes=new Set();return {listeners,style:{},hidden:false,disabled:false,value:'',textContent:'',title:'',setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k),addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(fn);},removeEventListener(){},setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id),getBoundingClientRect:()=>({left:0,top:0,width:1200,height:800}),querySelectorAll:()=>[],querySelector:()=>null,replaceChildren(){},classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k),toggle(k,v){if(v)classes.add(k);else classes.delete(k);}}};}
function fixture({scaled=false,orthographic=false}={}){
 const window=element();const document=element();document.body=element();document.pointerLockElement=null;
 const canvas=element();canvas.ownerDocument=document;canvas.getRootNode=()=>document;
 const actor=new T.Group(),parent=new T.Bone(),hand=new T.Bone(),foot=new T.Bone();parent.name='Root';hand.name='Hand_R';foot.name='Foot_L';actor.add(parent);parent.add(hand,foot);hand.position.set(.1,1,0);foot.position.set(-.2,.1,0);
 if(scaled){actor.scale.set(.01,.02,.03);actor.rotation.set(.2,.4,.1);parent.rotation.set(.1,-.3,.2);}
 const other=new T.Group();other.position.x=4;
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([.1,1,0,.2,1,0,.1,1.1,0],3));geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
 const mesh=new T.SkinnedMesh(geometry,new T.MeshBasicMaterial());actor.add(mesh);actor.updateMatrixWorld(true);mesh.bind(new T.Skeleton([parent,hand,foot]));
 const camera=orthographic?new T.OrthographicCamera(-2,2,1.5,-1.5,.01,100):new T.PerspectiveCamera(40,1.5,.01,100);camera.position.set(2,2,5);camera.lookAt(0,.7,0);camera.updateMatrixWorld(true);camera.updateProjectionMatrix();
 const scene={camera,scene:new T.Scene(),controls:{enabled:true},renderer:{domElement:canvas},effects:{outlinePass:{selectedObjects:[actor]}},characterSelected:{character:{object:actor,animation:{paused:false}}},characters:[{character:{object:actor}},{character:{object:other}}]};scene.scene.add(actor,other);
 const leases=new Set(),translate=element(),rotate=element(),toggle=element(),target=element();let weighted;
 const feedback=[];let partUiCalls=0;const deps={requestAnimationFrame:fn=>feedback.push(fn),THREE:T,TransformControls,scene,document,window,actionDirectEditToggle:toggle,actionDirectTranslate:translate,actionDirectRotate:rotate,actionDirectEditTarget:target,actionChannelList:element(),translateUiText:s=>s,translateBoneChannelLabel:s=>s,isPerformanceBoneLeased:b=>leases.has(b),updateModelPartVisibilityUi(){partUiCalls++;},clearSingleCharacterTransform(){},updateAnimationControls(){},getWeightedBoneAtPointer:()=>weighted,getModelPartEntries:()=>new Map(),selectModelPart(){},restoreModelPartVisibility(){},setSelectedAnimationPlaybackRate(){},rebuildActionParameterChannels(){},rebuildModelPartVisibilityControls(){}};
 const api=Function(...Object.keys(deps),`const manualPoseByCharacter=new WeakMap();let directPoseControls,directPoseControlsHelper,directPoseSelection,selectedModelPart,directPosePointerDrag,directPoseGizmoPointerId,directPoseFeedbackPending=false,directPoseEditingEnabled=false,directPoseTransformMode='rotate',directPoseGizmoDragging=false,directPoseOrbitControlsWasEnabled=true,directPoseOutlineSelection=[],performanceGizmoActive=false;${js};setupDirectPoseEditing();return {entries:getPoseEntries,apply:applyPoseEntry,frame:applyManualPoseOverrides,reset:resetActionParameters,mode:setDirectPoseTransformMode,edit:setDirectPoseEditing,select:selectDirectPoseBone,sync:syncDirectPoseOffsetsFromBone,get selection(){return directPoseSelection},get drag(){return directPosePointerDrag},get controls(){return directPoseControls}};`)(...Object.values(deps));
 const event=(x=600,y=400,extra={})=>({pointerId:1,pointerType:'mouse',button:0,buttons:1,clientX:x,clientY:y,shiftKey:false,altKey:false,preventDefault(){},stopPropagation(){},...extra});
 const direct=(name,e)=>{const list=canvas.listeners.get(name)??[];const fn=name==='pointermove'?list.find(fn=>fn.toString().includes('const drag = directPosePointerDrag')):list.at(-1);fn?.(e);};
 const vertex=()=>{actor.updateMatrixWorld(true);mesh.skeleton.update();return mesh.getVertexPosition(0,new T.Vector3()).applyMatrix4(mesh.matrixWorld);};
 const choose=(bone=hand)=>{api.edit(true);api.select(actor,bone);scene.scene.updateMatrixWorld(true);};
 const startBody=(bone=hand)=>{weighted={object:actor,bone,part:mesh};api.controls.axis=null;direct('pointerdown',event());};
 return {feedback,partUiCalls:()=>partUiCalls,flushFeedback:()=>{for(const fn of feedback.splice(0))fn()},window,canvas,api,actor,parent,hand,foot,other,mesh,scene,leases,translate,rotate,target,choose,startBody,direct,event,vertex,cleanup(){geometry.dispose();mesh.material.dispose();api.controls.dispose();}};
}

test('Move XYZ is available for a selected joint and remains translate rather than rotate',()=>{
 const f=fixture();f.choose();f.api.mode('translate');assert.equal(f.translate.disabled,false);assert.equal(f.translate.textContent,'Move XYZ');assert.equal(f.api.controls.mode,'translate');assert.equal(f.translate.getAttribute('aria-pressed'),'true');assert.deepEqual([f.api.controls.showX,f.api.controls.showY,f.api.controls.showZ],[true,true,true]);f.api.mode('rotate');assert.equal(f.api.controls.mode,'rotate');f.cleanup();
});
for(const axis of ['X','Y','Z'])test(`real TransformControls ${axis} drag changes a selected joint and skinned geometry`,()=>{
 const f=fixture();f.choose();f.api.mode('translate');const c=f.api.controls;c.axis=axis;f.scene.scene.updateMatrixWorld(true);
 const localBefore=f.hand.position.clone(),v=f.vertex(),origin=f.hand.getWorldPosition(new T.Vector3());
 const worldAxis=new T.Vector3(axis==='X'?1:0,axis==='Y'?1:0,axis==='Z'?1:0).applyQuaternion(f.hand.getWorldQuaternion(new T.Quaternion()));
 const from=origin.clone().project(f.scene.camera),to=origin.clone().addScaledVector(worldAxis,.15).project(f.scene.camera);
 c.pointerDown({x:from.x,y:from.y,button:0});assert.equal(c.dragging,true);
 c.pointerMove({x:to.x,y:to.y,button:-1});c.pointerUp({button:0});
 const delta=f.hand.position.clone().sub(localBefore);assert.ok(Math.abs(delta[axis.toLowerCase()]-.15)<1e-6,JSON.stringify(delta.toArray()));assert.ok(f.vertex().distanceTo(v)>.1,'actual weighted vertex moved');
 const after=f.hand.position.clone();for(let i=0;i<180;i++)f.api.frame();assert.ok(f.hand.position.distanceTo(after)<1e-10,'no accumulated translation');assert.equal(f.other.position.x,4);f.api.reset();assert.ok(f.hand.position.distanceTo(localBefore)<1e-10);f.cleanup();
});
for(const scaled of [false,true])for(const orthographic of [false,true])test(`body-plane drag respects full parent transform (${scaled?'FBX-scaled':'unit'}, ${orthographic?'ortho':'perspective'})`,()=>{
 const f=fixture({scaled,orthographic});f.choose();f.api.mode('translate');const before=f.hand.getWorldPosition(new T.Vector3()).project(f.scene.camera);f.startBody();f.direct('pointermove',f.event(660,360));const after=f.hand.getWorldPosition(new T.Vector3()).project(f.scene.camera);
 assert.ok(Math.abs((after.x-before.x)*600-60)<1e-6);assert.ok(Math.abs((after.y-before.y)*400-40)<1e-6);assert.ok(Math.abs(after.z-before.z)<1e-7);assert.ok(f.api.selection.entry.positionOffsets.length()>0);
 f.direct('pointerup',f.event(660,360));const p=f.hand.position.clone();for(let i=0;i<100;i++)f.api.frame();assert.ok(f.hand.position.distanceTo(p)<1e-10);f.cleanup();
});
test('Alt changes camera depth and Shift reduces translation to one quarter',()=>{
 const f=fixture({scaled:true});f.choose();f.api.mode('translate');const start=f.hand.getWorldPosition(new T.Vector3()),forward=f.scene.camera.getWorldDirection(new T.Vector3());f.startBody();f.direct('pointermove',f.event(600,360,{altKey:true}));const delta=f.hand.getWorldPosition(new T.Vector3()).sub(start);assert.ok(delta.length()>.01);assert.ok(delta.clone().normalize().dot(forward)>.999999);f.direct('pointerup',f.event());f.api.reset();
 const ndc=f.hand.getWorldPosition(new T.Vector3()).project(f.scene.camera);f.startBody();f.direct('pointermove',f.event(680,400,{shiftKey:true}));const n=f.hand.getWorldPosition(new T.Vector3()).project(f.scene.camera);assert.ok(Math.abs((n.x-ndc.x)*600-20)<1e-6);f.cleanup();
});
test('authored animated positions plus translation remain additive; reset restores current animation and rotation',()=>{
 const f=fixture();f.choose();const entry=f.api.selection.entry,mixer=new T.AnimationMixer(f.actor),clip=new T.AnimationClip('motion',2,[new T.VectorKeyframeTrack(f.hand.uuid+'.position',[0,1,2],[0,1,0,.1,1.2,.3,.2,1.1,.4])]);mixer.clipAction(clip).play();entry.positionOffsets.set(.2,-.1,.3);entry.offsets.set(15,10,5);
 for(let i=0;i<30;i++){mixer.update(1/60);const base=f.hand.position.clone();f.api.frame();assert.ok(f.hand.position.distanceTo(base.add(entry.positionOffsets))<1e-7);}
 const p=f.hand.position.clone(),q=f.hand.quaternion.clone();for(let i=0;i<120;i++)f.api.frame();assert.ok(f.hand.position.distanceTo(p)<1e-10);assert.ok(f.hand.quaternion.angleTo(q)<1e-7);const base=entry.lastBasePosition.clone();f.api.reset();assert.ok(f.hand.position.distanceTo(base)<1e-10);assert.equal(entry.positionOffsets.length(),0);assert.equal(entry.offsets.length(),0);f.cleanup();
});
test('switching modes or bones retains independent offsets; closing editing does not erase them',()=>{
 const f=fixture();f.choose();f.api.mode('translate');f.startBody();f.direct('pointermove',f.event(635,380));f.direct('pointerup',f.event());const p=f.hand.position.clone();f.api.mode('rotate');f.startBody();f.direct('pointermove',f.event(640,380));f.direct('pointerup',f.event());assert.ok(f.api.selection.entry.offsets.length()>0);assert.ok(f.hand.position.distanceTo(p)<1e-10);f.choose(f.foot);f.api.mode('translate');f.startBody(f.foot);f.direct('pointermove',f.event(630,390));f.direct('pointerup',f.event());assert.ok(f.hand.position.distanceTo(p)<1e-10);f.api.edit(false);for(let i=0;i<60;i++)f.api.frame();assert.ok(f.hand.position.distanceTo(p)<1e-10);f.cleanup();
});
test('leased weighted pick does not drag the previous joint; leased channels ignore offsets',()=>{
 const f=fixture();f.choose();f.api.mode('translate');f.leases.add(f.foot);f.startBody(f.foot);assert.ok(f.api.drag === undefined, "pointer drag released");const entry=f.api.selection.entry,p=f.hand.position.clone();f.leases.add(f.hand);entry.positionOffsets.set(1,2,3);f.api.frame();assert.ok(f.hand.position.equals(p));f.cleanup();
});
test('performance-editor joint/root/IK policy is left separate from direct pose manipulation',()=>{
 assert.match(source,/request\.mode === 'joint' \? 'rotate' : 'translate'/);
 assert.match(source,/bones\.includes\(directPoseSelection\.entry\.bone\)[\s\S]{0,80}clearDirectPoseSelection\(\)/);
});

test('Float32 animation quaternions do not compound manual rotation on idle frames',()=>{
 const f=fixture();const floats=new Float32Array(new T.Quaternion().setFromEuler(new T.Euler(.7,1.2,-.35)).toArray());
 f.hand.quaternion.fromArray(floats);f.choose();const e=f.api.selection.entry;e.offsets.set(12,8,5);f.api.frame();const first=f.hand.quaternion.clone();
 for(let i=0;i<180;i++)f.api.frame();const drift=first.clone().normalize().angleTo(f.hand.quaternion.clone().normalize());
 assert.ok(drift<1e-7,`rotation drift ${drift} radians after input stopped; base norm2=${new T.Quaternion().fromArray(floats).lengthSq()}`);
 f.api.reset();assert.ok(f.hand.quaternion.clone().normalize().angleTo(new T.Quaternion().fromArray(floats).normalize())<1e-7);f.cleanup();
});

for(const kind of ['pointerup','pointercancel','lostpointercapture','blur','mode','exit'])test(`rotation input ends on ${kind}, retaining the final pose`,()=>{
 const f=fixture();f.choose();f.api.mode('rotate');f.startBody();f.direct('pointermove',f.event(640,370));const q=f.hand.quaternion.clone();
 if(kind==='blur')f.window.listeners.get('blur')?.forEach(fn=>fn());else if(kind==='mode')f.api.mode('translate');else if(kind==='exit')f.api.edit(false);else f.direct(kind,f.event());
 assert.ok(f.api.drag === undefined, "pointer drag released");assert.equal(f.api.controls.dragging,false);f.direct('pointermove',f.event(880,470));for(let i=0;i<180;i++)f.api.frame();assert.ok(q.angleTo(f.hand.quaternion)<1e-7);f.cleanup();
});
for(const axis of ['X','Y','Z'])test(`real rotation ring ${axis} stops on release and has no idle inertia`,()=>{
 const f=fixture();f.choose();f.api.mode('rotate');const c=f.api.controls;c.axis=axis;f.scene.scene.updateMatrixWorld(true);
 const origin=f.hand.getWorldPosition(new T.Vector3()),u=new T.Vector3(axis==='X'?0:1,axis==='X'?1:0,0),v=axis==='Z'?new T.Vector3(0,1,0):new T.Vector3(0,0,1);
 const start=origin.clone().addScaledVector(u,.4).project(f.scene.camera),end=origin.clone().addScaledVector(u,.35).addScaledVector(v,.18).project(f.scene.camera);const before=f.hand.quaternion.clone();
 c.pointerDown({x:start.x,y:start.y,button:0});assert.equal(c.dragging,true);c.pointerMove({x:end.x,y:end.y,button:-1});assert.ok(before.angleTo(f.hand.quaternion)>1e-4);c.pointerUp({button:0});const after=f.hand.quaternion.clone();for(let i=0;i<180;i++)f.api.frame();assert.ok(after.angleTo(f.hand.quaternion)<1e-7);f.cleanup();
});

test('500 drag events coalesce feedback to one frame with no full model-part UI traversal',()=>{
 const f=fixture();f.choose();f.api.mode('rotate');f.startBody();const calls=f.partUiCalls();for(let i=0;i<500;i++)f.direct('pointermove',f.event(600+i/10,400+i/20));
 assert.equal(f.partUiCalls()-calls,0,'drag must not rebuild model-part trees');assert.equal(f.feedback.length,1,'one pending UI frame');const q=f.hand.quaternion.clone();f.flushFeedback();assert.equal(f.partUiCalls()-calls,0);assert.ok(f.target.value.includes('Selected bone'));assert.ok(q.angleTo(f.hand.quaternion)<1e-7);f.cleanup();
});
