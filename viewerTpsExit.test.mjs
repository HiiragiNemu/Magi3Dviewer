import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const B=path.dirname(fileURLToPath(import.meta.url));
const base=B;
const req=createRequire(path.join(B,'package.json')),ts=req('typescript'),{build}=req('esbuild');
const THREE=await import(pathToFileURL(req.resolve('three')).href);
const runDir=path.join(B,'artifacts/verification/tps-exit-regression');fs.mkdirSync(runDir,{recursive:true});
globalThis.window={addEventListener(){},setTimeout};
const mods={};for(const [key,file]of Object.entries({core:path.join(base,'src/viewer/characterLocomotion.ts'),animation:path.join(B,'magia-exedra-character-three/character.ts')})){
 const out=path.join(runDir,key+'.mjs');await build({entryPoints:[file],outfile:out,bundle:true,platform:'node',format:'esm',target:'es2022',logLevel:'silent',plugins:[{name:'three',setup(b){b.onResolve({filter:/^three$/},()=>({path:pathToFileURL(req.resolve('three')).href,external:true}))}}]});mods[key]=await import(pathToFileURL(out).href+'?t='+Date.now());}
const {CharacterLocomotionController,FlatGroundCollisionWorld,normalizeAnimationFamilyName}=mods.core,{ChatacterAnimation}=mods.animation;
const vsrc=fs.readFileSync(path.join(base,'src/viewer/viewerLocomotion.ts'),'utf8'),ast=ts.createSourceFile('viewer.ts',vsrc,ts.ScriptTarget.Latest,true);
const names=['setViewerLocomotionEnabled','isViewerTpsLocomotionFamily','releaseViewerTpsMovement','createTargetRigLocomotionTransitionPolicy','isNativeDungeonAnimation','deactivateNativeDungeonPresentation','familyEquals'];
const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(ast).replace(/^export /,''));
const js=ts.transpileModule(functions.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const fakeElement=()=>({value:'',textContent:'',classList:{toggle(){},remove(){}},setAttribute(){}});
function fixture(native=false){
 const object=new THREE.Group(),leg=new THREE.Bone();leg.name='Leg';object.add(leg);object.position.set(3,0,5);
 object.animations=['HomeWait01_L','HomeWait02_L','OwnAction_L','Idle_L','Walk_L','Run_L'].map((name,i)=>new THREE.AnimationClip(name,2,[new THREE.QuaternionKeyframeTrack('Leg.quaternion',[0,2],[...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),i*.1).toArray(),...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),i*.1+.08).toArray()])]));
 const character={object,animations:object.animations.map(c=>c.name),userData:{animationLoops:[]},disposed:false};character.animation=new ChatacterAnimation(character);character.animation.play('HomeWait02_L',true);
 const animation={listClips:()=>object.animations.map(c=>({name:c.name,duration:c.duration})),play:(name,o)=>character.animation.play(name,o.loop,{transitionSeconds:o.fadeSeconds}),setRootMotionEnabled(){}};
 const controller=new CharacterLocomotionController({characterId:'fixture',transform:object,animation,initiallyGrounded:true,collisionWorld:new FlatGroundCollisionWorld(),locomotionAnimations:{idle:'Idle_L',walk:'Walk_L',run:'Run_L'},config:{walkSpeed:1,runSpeed:3,groundAcceleration:100}});
 character.animation.play('HomeWait02_L',true);
 const binding={character,controller,locomotionAnimations:{idle:'Idle_L',walk:'Walk_L',run:'Run_L'},snapshot:controller.snapshot(),safety:{},animationPlaybackRate:1,
  nativeDungeonActions:{status:native?'attached':'not-requested',entries:native?['Idle_L','Walk_L','Run_L'].map(name=>({clip:{runtimeName:name}})):[],baselineAnimation:'HomeWait02_L'},
  characterSpecificMotion:{status:native?'not-configured':'attached',baselineClip:'HomeWait01_L',generatedClips:native?[]:['Idle_L','Walk_L','Run_L'].map(name=>({name}))},
  tpsPoseTransition:{begin(){}},cameraHeadTracking:{setActive(){}},blocked:false};
 return binding;
}
function createViewer(bs){ // retain the actual closure, not a copied enabled getter
 const document={body:fakeElement(),pointerLockElement:null,exitPointerLock(){}},claims=new Map(),scene={renderer:{domElement:{}},controls:{enabled:true}};
 const deps={normalizeAnimationFamilyName,bindings:new Set(bs),selectedBinding:()=>bs[0],getViewerCharacterControlAuthority:()=>({tps:true}),pressed:new Set(),feedbackOutput:fakeElement(),document,viewerPerformanceClaims:claims,characterActionPlaybackBlocksLocomotion:b=>b.blocked,targetRigLocomotionTransitionSeconds:{recovery:.3},captureOrbitControlsLease(){},setNativeDungeonExternalAttachmentsHidden(){},activateNativeDungeonController(){},modeToggle:fakeElement(),hud:fakeElement(),scene,ensureOrbitControlsCurrentCanvas(){},syncCameraRigFromCurrentView(){},handoffFinalTpsCameraToOrbitControls(){},updateHud(){}};
 return {api:new Function(...Object.keys(deps),`let enabled=false,jumpQueued=false,virtualInput,cameraDragPointerId,cameraFreeLookFallbackActive=false;${js};return {set:setViewerLocomotionEnabled,get enabled(){return enabled}}`)(...Object.values(deps)),claims};
}
for(const native of [false,true])for(const run of [false,true])test(`${native?'native':'generated'} ${run?'run':'walk'} exit restores selected Home and releases motion without root teleport`,()=>{
 const b=fixture(native),{api}=createViewer([b]);api.set(true);b.controller.setInput({moveX:0,moveZ:1,run,jumpPressed:false});for(let i=0;i<30;i++){b.snapshot=b.controller.advance(1/60);b.character.animation.mixer.update(1/60)}
 assert.equal(b.snapshot.state,run?'run':'walk');const before=b.character.object.position.clone(),q=b.character.object.quaternion.clone();api.set(false);
 assert.equal(b.character.animation.current,'HomeWait02_L');assert.equal(b.snapshot.state,'idle');assert.equal(b.snapshot.velocity.length(),0);assert.ok(b.character.object.position.equals(before));assert.ok(b.character.object.quaternion.equals(q));
 b.character.animation.mixer.update(.4);for(const a of b.character.animation.mixer._actions)if(/^(Walk|Run)_L$/.test(a.getClip().name))assert.ok(!a.isRunning()||a.getEffectiveWeight()<1e-6);
 api.set(true);b.controller.setInput({moveX:0,moveZ:1,run,jumpPressed:false});b.snapshot=b.controller.advance(1/30);assert.equal(b.character.animation.current,run?'Run_L':'Walk_L');api.set(false);assert.equal(b.character.animation.current,'HomeWait02_L');
});
test('all attached actors release while explicit action and performance leases keep their pose',()=>{const bs=[fixture(),fixture(),fixture(),fixture()];const {api,claims}=createViewer(bs);api.set(true);for(const b of bs){b.controller.setInput({moveX:0,moveZ:1,run:false,jumpPressed:false});b.snapshot=b.controller.advance(.05)}bs[2].blocked=true;bs[2].character.animation.play('OwnAction_L',true);claims.set(bs[3].character.object,{channels:{action:true}});api.set(false);assert.equal(bs[0].character.animation.current,'HomeWait02_L');assert.equal(bs[1].character.animation.current,'HomeWait02_L');assert.equal(bs[2].character.animation.current,'OwnAction_L');assert.equal(bs[3].character.animation.current,'Walk_L')});
test('ordinary authored family selected during TPS is retained instead of overwritten by stored Home',()=>{const b=fixture(),{api}=createViewer([b]);api.set(true);b.character.animation.play('OwnAction_L',true);api.set(false);assert.equal(b.character.animation.current,'OwnAction_L')});
test('release clears queued jump and fractional step without stepping collision or changing grounded state',()=>{const b=fixture();b.controller.setInput({moveX:1,moveZ:0,run:true,jumpPressed:true});b.controller.advance(.001);const before=b.character.object.position.clone(),diag={...b.controller.getStepDiagnostics()};assert.equal(typeof b.controller.releaseMovement,'function');b.controller.releaseMovement();assert.deepEqual(b.controller.getStepDiagnostics(),diag);assert.ok(b.character.object.position.equals(before));assert.equal(b.controller.snapshot().grounded,true);b.controller.advance(1/60);assert.equal(b.controller.snapshot().state,'idle');assert.equal(b.controller.snapshot().takeoffRemainingSeconds,0)});
test('repeated off is idempotent for the current authored animation time',()=>{const b=fixture(),{api}=createViewer([b]);api.set(false);b.character.animation.mixer.update(.7);const time=b.character.animation.time;api.set(false);assert.equal(b.character.animation.time,time);assert.equal(b.character.animation.current,'HomeWait02_L')});
test('actual target-rig shared Home idle is a return destination, not a generated movement owner',()=>{const b=fixture();b.locomotionAnimations.idle='HomeWait01_L';b.character.animation.play('HomeWait01_L',true);const {api}=createViewer([b]);api.set(true);b.controller.setInput({moveX:0,moveZ:1,run:false,jumpPressed:false});b.snapshot=b.controller.advance(.05);assert.equal(b.character.animation.current,'Walk_L');api.set(false);assert.equal(b.character.animation.current,'HomeWait01_L');assert.equal(b.snapshot.state,'idle')});
