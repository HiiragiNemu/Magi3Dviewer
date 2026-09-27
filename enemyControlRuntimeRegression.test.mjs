import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import * as THREE from 'three'
const root=process.env.S6_TEST_ROOT??dirname(fileURLToPath(import.meta.url))
const runtime=process.env.S6_RUNTIME_ROOT??root
function compile(source,extras={}) {const m={exports:{}};const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','exports','module',...Object.keys(extras),code)(id=>{if(id==='three')return THREE;throw Error(id)},m.exports,m,...Object.values(extras));return m.exports}
const file=p=>readFileSync(resolve(root,p),'utf8')
const {EnemyInstance}=compile('import * as THREE from "three";\n'+file('src/viewer/enemies/loader.ts').split('export class EnemyInstance')[1].replace(/^/,'export class EnemyInstance'),{disposeObject:()=>{}})
function actor(){const o=new THREE.Group();const bone=new THREE.Bone();bone.name='Arm';o.add(bone);o.animations=[new THREE.AnimationClip('Wait_L',2,[new THREE.NumberKeyframeTrack('Arm.position[x]',[0,1,2],[0,2,0])]),new THREE.AnimationClip('Damage',1,[new THREE.NumberKeyframeTrack('Arm.position[y]',[0,.5,1],[0,1,0])])];return {i:new EnemyInstance('test',{},o),bone}}
test('real mixer pause freezes time and pose, seek evaluates pose while paused, resume continues',()=>{
 const {i,bone}=actor();i.update(.3);const time=i.animationTime;i.setAnimationPaused(true);const x=bone.position.x;i.update(.5);assert.equal(i.animationTime,time);assert.equal(bone.position.x,x);
 i.seekAnimation(.75);assert.equal(i.animationTime,.75);assert.equal(bone.position.x,1.5);i.update(1);assert.equal(bone.position.x,1.5);
 i.setAnimationPaused(false);i.update(.1);assert.ok(Math.abs(i.animationTime-.85)<1e-8);assert.ok(Math.abs(bone.position.x-1.7)<1e-8);
})
test('seeking both endpoints and a crossfade produces the exact active clip pose, not a blend',()=>{
 const {i,bone}=actor();i.update(.5);i.playAnimation('Damage',false,.18);i.seekAnimation(.5);assert.equal(bone.position.y,1);assert.equal(bone.position.x,0);
 i.seekAnimation(0);assert.equal(bone.position.y,0);i.seekAnimation(1);assert.equal(i.animationTime,1);assert.equal(i.animationPaused,true);i.setAnimationPaused(false);i.update(.1);assert.equal(i.animationTime,1);
 i.playAnimation('Wait_L',true,0);i.seekAnimation(2);assert.equal(i.animationTime,2);assert.equal(bone.position.x,0);
})
test('completed one-shot stays at its end until the separate Play button explicitly restarts it',()=>{
 const {i}=actor();i.playAnimation('Damage',false,0);i.update(2);assert.equal(i.animationPaused,true);i.setAnimationPaused(false);i.update(.1);assert.equal(i.animationTime,1);i.playAnimation('Damage',false,0);i.update(.1);assert.ok(Math.abs(i.animationTime-.1)<1e-8);
})
test('600001 actual exported bone tracks move and deterministic scrub changes skinned vertices',async()=>{
 const originalDocument=globalThis.document,originalFetch=globalThis.fetch
 class Image {listeners=new Map();width=1;height=1;addEventListener(t,c){this.listeners.set(t,c)}removeEventListener(t){this.listeners.delete(t)}set src(v){queueMicrotask(()=>this.listeners.get('load')?.({target:this}))}}
 globalThis.document={baseURI:'http://enemy.local/',createElementNS(){return new Image()}};
 globalThis.fetch=async input=>{const u=new URL(typeof input==='string'?input:input.url);return new Response(readFileSync(resolve(runtime,'public',decodeURIComponent(u.pathname).slice(1))),{status:200})}
 try {const {FbxEnemyModelLoader}=await import(pathToFileURL(resolve(runtime,'src/viewer/enemies/loader.ts')));const m=JSON.parse(readFileSync(resolve(runtime,'public/enemies/manifest.v1.json'),'utf8'));const o=await new FbxEnemyModelLoader().load(m.entries.find(x=>x.enemyMstId===600001));const i=new EnemyInstance('native',{},o);
 const sample=()=>{o.updateMatrixWorld(true);const a=[];o.traverse(n=>{if(n.isSkinnedMesh){n.skeleton.update();for(let v=0;v<n.geometry.attributes.position.count;v+=13){const p=n.getVertexPosition(v,new THREE.Vector3());a.push(...p.toArray())}}});return a};
 for(const name of i.animationNames){i.playAnimation(name,false,0);i.seekAnimation(Math.min(.01,i.animationDuration));const a=sample();i.seekAnimation(Math.min(.3,i.animationDuration));const b=sample();assert.ok(b.some((v,j)=>Math.abs(v-a[j])>1e-5),name+' moves visible vertices');assert.equal(i.animationPaused,true)}
 }finally{globalThis.document=originalDocument;globalThis.fetch=originalFetch}
})
function extract(name){const s=file('src/viewer/index.ts');let start=s.indexOf('function '+name+'(');if(s.slice(start-6,start)==='async ')start-=6;assert.ok(start>=0,name);const open=s.indexOf('{',start);let depth=1,end=open+1;while(depth){if(s[end]==='{')depth++;if(s[end]==='}')depth--;end++}return s.slice(start,end)}
test('closing handles detaches both controls, preserves actor selection and hides the close button',()=>{
 const obj={},scene={characterSelected:{object:obj},characterSelectionVisible:true,effects:{outlinePass:{enabled:true}},controls:{enabled:true},transformControls:{object:obj,detach(){this.object=undefined},enabled:true,mode:'translate'},transformControlsHelper:{visible:true}};
 const controls={object:obj,detach(){this.object=undefined},enabled:true};const helper={visible:true};const close={hidden:false};const button=()=>({style:{removeProperty(){}}});
 const src=['clearSingleCharacterTransform','closeObjectTransform','updateTransformModeButtons'].map(extract).join('\n');const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('scene','singleCharacterTransformControls','singleCharacterTransformControlsHelper','transformCloseBtn','transformTranslateBtn','transformRotateBtn',`let singleCharacterTransformActive=true,singleCharacterTransformOrbitWasEnabled=true,directPoseEditingEnabled=false,singleObjectTransformOnChange; ${js};closeObjectTransform();assertState(); function assertState(){if(singleCharacterTransformActive)throw Error('active')}`)(scene,controls,helper,close,button(),button());
 assert.equal(scene.characterSelected.object,obj);assert.equal(scene.transformControls.object,undefined);assert.equal(controls.object,undefined);assert.equal(helper.visible,false);assert.equal(scene.transformControlsHelper.visible,false);assert.equal(close.hidden,true);assert.equal(scene.controls.enabled,true);
})
test('magical-girl selection is a draft; Apply switches and Resume never restarts',async()=>{
 const calls=[];const animation={paused:false,clamped:false,current:'Wait_L',time:.75,play:(...a)=>calls.push(a)};
 const src=['onAnimationSelectionChanged','playSelectedAnimation','currentCatalogPlayback','resumeCurrentAnimation'].map(extract).join('\n');
 const code=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const run=new Function('scene','characterActionsApi','updateAnimationControls','selectedCharacterActionOption','disposeCharacterActionPlayback',`const animationSelector={value:'Damage_SE'};const animationRepetitions={value:'',disabled:false,reportValidity:()=>true};${code};return {choose:onAnimationSelectionChanged,play:playSelectedAnimation,resume:resumeCurrentAnimation}`)({characterSelected:{character:{animation}}},()=>({state:()=>({status:'idle'})}),()=>{},()=>undefined,()=>{});
 await run.choose();assert.deepEqual(calls,[]);assert.equal(animation.paused,false);await run.play();assert.deepEqual(calls,[['Damage_SE',false]]);
 animation.paused=true;await run.resume();assert.equal(animation.paused,false);assert.equal(animation.time,.75);assert.equal(calls.length,1);
 animation.paused=true;animation.clamped=true;await run.resume();assert.equal(calls.length,1);assert.equal(animation.paused,true);
})
const {applyLinearOrbitWheel,installLinearOrbitWheel}=compile(file('magia-exedra-character-three/scene/linearOrbitWheel.ts'))
test('equal wheel notches translate equally at long and near distances, including past the pivot without a flip',()=>{
 for(const d of [10,1,.21,.001]){const camera=new THREE.PerspectiveCamera(40,1,.1,1000);camera.position.set(0,0,d);const target=new THREE.Vector3();camera.lookAt(target);const q=camera.quaternion.clone();for(let k=0;k<8;k++){const old=camera.position.clone();applyLinearOrbitWheel(camera,target,-100,0,800);assert.ok(Math.abs(camera.position.distanceTo(old)-.35)<1e-8);camera.lookAt(target);assert.ok(q.angleTo(camera.quaternion)<1e-7);assert.ok(camera.position.distanceTo(target)>=.199999)}}
})
test('pixel/line/page wheel units are consistent; disabled TPS ownership is not intercepted',()=>{
 const result=[];for(const [delta,mode,height] of [[100,0,800],[6.25,1,800],[.125,2,800]]){const c=new THREE.PerspectiveCamera();c.position.z=5;applyLinearOrbitWheel(c,new THREE.Vector3(),delta,mode,height);result.push(c.position.z)}assert.deepEqual(result,[5.35,5.35,5.35]);
 let handler,prevented=0;const controls={enabled:false,enableZoom:true,target:new THREE.Vector3(),zoomSpeed:1,dispatchEvent(){},domElement:{clientHeight:800,addEventListener(type,h){handler=h}}};const c=new THREE.PerspectiveCamera();c.position.z=5;installLinearOrbitWheel(controls,c);handler({deltaY:-100,deltaMode:0,preventDefault(){prevented++},stopImmediatePropagation(){}});assert.equal(prevented,0);assert.equal(c.position.z,5);controls.enabled=true;handler({deltaY:-100,deltaMode:0,preventDefault(){prevented++},stopImmediatePropagation(){}});assert.equal(prevented,1);assert.equal(c.position.z,4.65)
})
