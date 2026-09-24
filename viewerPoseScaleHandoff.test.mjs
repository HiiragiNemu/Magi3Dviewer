import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=process.env.S6_TEST_ROOT??here, runtime=process.env.S6_RUNTIME_ROOT??here;
const req=createRequire(path.join(runtime,'package.json')), THREE=req('three'), ts=req('typescript');
const source=fs.readFileSync(path.join(root,'src/viewer/viewerLocomotion.ts'),'utf8');
const start=source.indexOf('interface ViewerTpsPoseTransitionNode'), end=source.indexOf('class ViewerProceduralLocomotion',start);
assert(start>=0&&end>start);
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(){
 const claims=new WeakMap();let attachment;
 const Transition=new Function('THREE','getClockDelta','getViewerCharacterPhysicsAttachment','viewerPerformanceClaims',code+';return ViewerTpsPoseTransition')(THREE,()=>1/60,()=>attachment,claims);
 const object=new THREE.Group(),hand=new THREE.Bone();hand.name='Hand_R';object.add(hand);
 const mixer=new THREE.AnimationMixer(object), character={object,animation:{mixer}},transition=new Transition(character);
 const clip=(value,component=false)=>new THREE.AnimationClip('pose',2,[component?new THREE.NumberKeyframeTrack(hand.uuid+'.scale[x]',[0,2],[value,value]):new THREE.VectorKeyframeTrack(hand.uuid+'.scale',[0,2],[value,value,value,value,value,value])]);
 const play=(value,weight=1,component=false)=>mixer.clipAction(clip(value,component)).reset().setEffectiveWeight(weight).play();
 return{claims,object,hand,mixer,transition,play,attach(value){attachment=value}};
}
for(const scale of [1.8,2])for(const transport of ['playing','paused','seek-paused','seek-playing'])test(`SP ${scale}x hand returns to evaluated ordinary scale with ${transport}`,()=>{
 const f=fixture();f.play(scale);f.mixer.update(0);f.transition.begin();f.mixer.stopAllAction();
 const normal=f.play(1);f.mixer.update(0);const samples=[];
 for(let i=0;i<61;i++){
  if(i===1&&transport.startsWith('seek')){normal.time=.5;f.mixer.update(0)}
  if(transport==='playing'||transport==='seek-playing')f.mixer.update(1/60);
  f.transition.update();samples.push(f.hand.scale.x);
 }
 assert.ok(Math.abs(samples[0]-scale)<1e-7,'first rendered frame retains outgoing pose');
 assert.ok(samples[6]>1&&samples[6]<scale,'actual smooth intermediate values, not snap-to-one');
 assert.ok(samples.slice(1).every((s,i)=>s<=samples[i]+1e-7),'return is monotonic');
 assert.deepEqual(f.hand.scale.toArray(),[1,1,1]);assert.equal(f.transition.diagnostics.active,false);
});
test('incoming animated and weighted native scale is preserved rather than clamped to unit scale',()=>{
 const f=fixture();f.play(1);f.mixer.update(0);f.transition.begin();f.mixer.stopAllAction();
 f.play(1.8,.25);f.play(2.4,.75);f.mixer.update(0);
 for(let i=0;i<61;i++){f.mixer.update(1/60);f.transition.update()}
 for(const value of f.hand.scale.toArray())assert.ok(Math.abs(value-2.25)<1e-6);
});
test('constant component scale uses the exact resolved property and actor',()=>{
 const f=fixture();f.hand.scale.set(2,3,4);f.transition.begin();f.hand.scale.x=1;f.play(1,1,true);f.mixer.update(0);
 for(let i=0;i<61;i++){f.mixer.update(1/60);f.transition.update()}
 assert.deepEqual(f.hand.scale.toArray(),[1,3,4]);
});
test('performance lease and native physics p/q ownership are retained',()=>{
 const f=fixture();f.play(2);f.mixer.update(0);f.transition.begin();f.mixer.stopAllAction();f.play(1);f.mixer.update(0);
 f.claims.set(f.object,{leasedBones:new Set([f.hand])});f.hand.scale.setScalar(7);f.transition.update();assert.equal(f.hand.scale.x,7);
 f.claims.delete(f.object);f.hand.position.set(5,6,7);f.hand.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.4);const q=f.hand.quaternion.clone();
 f.attach({status:'ready',root:f.object,runtime:{getWritableChannelSnapshot:()=>({status:'ready',active:true,runtimeStatus:'ready',root:f.object,outputs:[{object:f.hand,channels:['position','quaternion']}]})}});
 for(let i=0;i<61;i++){f.mixer.update(1/60);f.transition.update()}
 assert.deepEqual(f.hand.position.toArray(),[5,6,7]);assert.ok(f.hand.quaternion.angleTo(q)<1e-7);assert.equal(f.hand.scale.x,1);
});
test('interrupted transition starts from displayed scale and still reaches the new evaluated scale',()=>{
 const f=fixture();f.play(2);f.mixer.update(0);f.transition.begin();f.mixer.stopAllAction();f.play(1);f.mixer.update(0);
 for(let i=0;i<5;i++){f.mixer.update(1/60);f.transition.update()}
 const displayed=f.hand.scale.x;f.transition.begin();f.mixer.stopAllAction();f.play(1.5);f.mixer.update(0);f.transition.update();assert.equal(f.hand.scale.x,displayed);
 for(let i=0;i<61;i++){f.mixer.update(1/60);f.transition.update()}
 assert.equal(f.hand.scale.x,1.5);
});
