import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {test,after} from 'node:test';
import {fileURLToPath} from 'node:url';
const P=process.env.S6_RUNTIME_ROOT||path.dirname(fileURLToPath(import.meta.url));
const S=process.env.SOURCE_ROOT||P,O=path.dirname(fileURLToPath(import.meta.url));
const req=createRequire(P+'/package.json'),T=req('three'),ts=req('typescript');
const compiled={};let delta=1/60;
function compile(f){if(compiled[f])return compiled[f];const e={};compiled[f]=e;
  Function('exports','require',ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(e,s=>{
    if(s==='three')return T;if(s==='./renderer')return{getClockDelta:()=>delta,addAnimationLoop(){},removeAnimationLoop(){}};if(s==='./utils')return{disposeObject(){}};
    let p=path.resolve(path.dirname(f),s.endsWith('.ts')?s:s+'.ts');if(!fs.existsSync(p))p=path.resolve(P,'magia-exedra-character-three',s.endsWith('.ts')?s:s+'.ts');return compile(p);
  });return e;}
const {ChatacterAnimation}=compile(S+'/magia-exedra-character-three/character.ts');
const reports=[];
function fixture(){
  const object=new T.Group(),body=new T.Bone(),face=new T.Bone(),prop=new T.Bone(),other=new T.Bone();
  body.name='Body';face.name='Face';prop.name='Weapon_B_Root';other.name='weapon_a_joint_gp';object.add(body,face,prop,other);
  const bodyClip=(name,d)=>new T.AnimationClip(name,d,[new T.VectorKeyframeTrack(body.uuid+'.position',[0,d],[0,0,0,1,0,0]),new T.QuaternionKeyframeTrack(face.uuid+'.quaternion',[0,d],[0,0,0,1,0,0,0,1])]);
  const propClip=(name,d,start)=>new T.AnimationClip(name,d,[new T.VectorKeyframeTrack(prop.uuid+'.scale',start?[0,.05,d]:[0,d],start?[0,0,0,0,0,0,1,1,1]:name.startsWith('HomeWait')?[0,0,0,0,0,0]:[1,1,1,1,1,1])]);
  object.animations=[bodyClip('HomeWait01_L_1',1),propClip('HomeWait01_L',1,false),bodyClip('HomeUnique01_S',.2),propClip('HomeUnique01_S_1',.2,true),bodyClip('HomeUnique01_L_1',.3),propClip('HomeUnique01_L',.3,false),new T.AnimationClip('HomeWeaponAHide',.03,[new T.VectorKeyframeTrack(other.uuid+'.scale',[0,.03],[.01,.01,.01,.01,.01,.01])])];
  const character={object,userData:{homeAnimationRuntime:{helpers:['HomeWeaponAHide'],actions:{unique01:{startFamily:'HomeUnique01_S',loopFamily:'HomeUnique01_L',enterTransitionSeconds:.05}}}},disposed:false};
  const a=new ChatacterAnimation(character);let depth=0,maxDepth=0;const update=a.mixer.update;
  a.mixer.update=function(...args){depth++;maxDepth=Math.max(maxDepth,depth);try{return update.apply(this,args);}finally{depth--;}};
  const tick=(n=1)=>{for(let i=0;i<n;i++)a.animationLoop();};
  a.play('HomeWait01_L',true);tick(10);
  return{a,prop,tick,object,maxDepth:()=>maxDepth,cleanup(){a.clear();a.mixer.uncacheRoot(object);}};
}
for(const mode of ['playing','pause-loop','seek-loop-playing','seek-loop-paused','seek-through-start'])test(`automatic Home start/loop keeps constant prop scale with short helper: ${mode}`,()=>{
  const f=fixture(),{a,prop,tick}=f;
  try{
    a.play('HomeUnique01_S');
    if(mode==='seek-through-start')a.time=.25;else tick(13);
    assert.equal(a.current,'HomeUnique01_L');
    assert.equal(a.clamped,false,'outgoing short helper completion must not clamp incoming loop');
    if(mode==='pause-loop'||mode==='seek-loop-paused')a.paused=true;
    if(mode.startsWith('seek-loop'))a.time=.15;
    tick(30);
    assert.deepEqual(prop.scale.toArray(),[1,1,1]);
    assert.equal(f.maxDepth(),1,'automatic continuation runs after outer mixer update');
    reports.push({mode,status:'PASS',maxDepth:f.maxDepth(),scale:prop.scale.toArray(),current:a.current});
  }catch(e){reports.push({mode,status:'FAIL',error:e.message,maxDepth:f.maxDepth(),scale:prop.scale.toArray(),current:a.current});throw e;}finally{f.cleanup();}
});
for(const repetitions of [0,2])test(`automatic loop preserves requested repetitions ${repetitions} despite short helper`,()=>{
  const f=fixture(),{a,prop,tick}=f;
  try{a.play('HomeUnique01_S',false,{repetitions});tick(13);assert.equal(a.current,'HomeUnique01_L');assert.equal(a.repetitions,repetitions);assert.equal(a.clamped,false);tick(60);
    assert.deepEqual(prop.scale.toArray(),[1,1,1]);assert.equal(a.paused,repetitions===2);assert.equal(a.clamped,repetitions===2);assert.equal(f.maxDepth(),1);
    if(repetitions===2)assert.equal(a._repeatCompleted,2);
    reports.push({mode:'repetitions-'+repetitions,status:'PASS',maxDepth:f.maxDepth(),scale:prop.scale.toArray(),completed:a._repeatCompleted});
  }catch(e){reports.push({mode:'repetitions-'+repetitions,status:'FAIL',error:e.message,maxDepth:f.maxDepth(),scale:prop.scale.toArray()});throw e;}finally{f.cleanup();}
});
for(const operation of ['clear','explicit-play'])test(`synchronous ${operation} cancels pending automatic Home continuation`,()=>{
  const f=fixture(),{a,tick}=f;
  try{a.play('HomeUnique01_S');const gate=a._queuedHomeGateAction;a.mixer.addEventListener('finished',event=>{if(event.action!==gate)return;if(operation==='clear')a.clear();else a.play('HomeWait01_L',true);});tick(13);
    assert.equal(a.current,operation==='clear'?undefined:'HomeWait01_L');assert.equal(a._pendingHomeLoop,undefined);
    reports.push({mode:operation,status:'PASS',current:a.current??null});
  }catch(e){reports.push({mode:operation,status:'FAIL',error:e.message});throw e;}finally{f.cleanup();}
});
after(()=>{const report={sourceRoot:S,tests:reports.length,passed:reports.filter(r=>r.status==='PASS').length,failed:reports.filter(r=>r.status==='FAIL').length,reports};if(process.env.REPORT_PATH)fs.writeFileSync(process.env.REPORT_PATH,JSON.stringify(report,null,2)+'\n');});
