import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import assert from 'node:assert/strict';import test from 'node:test';
const here=path.dirname(fileURLToPath(import.meta.url)),root=process.env.S6_TEST_ROOT??here,runtime=process.env.S6_RUNTIME_ROOT??here,req=createRequire(path.join(runtime,'package.json')),THREE=req('three'),ts=req('typescript');
const cache={};function compile(relative){if(cache[relative])return cache[relative];const file=path.join(fs.existsSync(path.join(root,relative))?root:runtime,relative),exports={};cache[relative]=exports;Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,name=>name==='three'?THREE:name==='./renderer'?{getClockDelta:()=>1/60,addAnimationLoop(){},removeAnimationLoop(){}}:name==='./utils'?{disposeObject(){}}:compile(path.join(path.dirname(relative),name.endsWith('.ts')?name:name+'.ts')));return exports}
const {ChatacterAnimation}=compile('magia-exedra-character-three/character.ts');
function fixture({prop=true,multi=false}={}){
 const object=new THREE.Group(),body=new THREE.Bone(),a=new THREE.Bone(),b=new THREE.Bone(),cup=new THREE.Bone();a.name=b.name='same-short-name';object.add(body,a,b);b.add(cup);
 const vector=(node,property,value)=>new THREE.VectorKeyframeTrack(node.uuid+'.'+property,[0,2],[...value,...value]);
 const hideTracks=node=>[vector(node,'position',[0,-10,0]),vector(node,'scale',[.01,.01,.01])];
 const homeBody=new THREE.AnimationClip('HomeUnique01_L',2,[vector(body,'position',[0,1,0])]);
 const homeProp=new THREE.AnimationClip('HomeUnique01_L_1',2,[vector(cup,'position',[0,0,0]),vector(cup,'scale',[1,1,1])]);
 const aHide=new THREE.AnimationClip('HomeWeaponAHide',2,hideTracks(a)),bHide=new THREE.AnimationClip('HomeWeaponBHide',2,multi?[...hideTracks(a),...hideTracks(b)]:hideTracks(b));
 object.animations=[homeBody,...(prop?[homeProp]:[]),aHide,bHide,new THREE.AnimationClip('HomeWait01_L',2,[vector(body,'position',[0,2,0])]),new THREE.AnimationClip('Attack',2,[vector(body,'position',[0,3,0])])];
 const character={object,userData:{homeAnimationRuntime:{helpers:['HomeWeaponAHide','HomeWeaponBHide']}},disposed:false},animation=new ChatacterAnimation(character);
 return{object,a,b,cup,aHide,bHide,homeProp,animation};
}
test('Home prop descendant keeps its authored branch; unrelated battle weapon remains hidden',()=>{
 const f=fixture();f.animation.play('HomeUnique01_L',true);for(let i=0;i<60;i++)f.animation.animationLoop();
 assert.deepEqual(f.b.position.toArray(),[0,0,0]);assert.deepEqual(f.b.scale.toArray(),[1,1,1]);assert.ok(Math.abs(f.a.scale.x-.01)<1e-7);assert.equal(f.a.position.y,-10);
 assert.deepEqual(f.animation.getAnimationClipsByName('HomeUnique01_L').map(c=>c.name).sort(),['HomeUnique01_L','HomeUnique01_L_1','HomeWeaponAHide']);
});
test('wait to prop and back restores original prop visibility without a permanent show override',()=>{
 const f=fixture();f.animation.play('HomeWait01_L',true);assert.ok(f.b.scale.x<.011);
 f.animation.play('HomeUnique01_L',true);f.animation.paused=true;f.animation.time=1;assert.equal(f.b.scale.x,1);assert.equal(f.b.position.y,0);
 f.animation.play('HomeWait01_L',true);assert.ok(f.b.scale.x<.011);assert.equal(f.b.position.y,-10);
});
test('partial helper is cloned and only its conflicting branch is removed',()=>{
 const f=fixture({multi:true}),before=f.bHide.tracks.slice();const clips=f.animation.getAnimationClipsByName('HomeUnique01_L');
 const scoped=clips.find(c=>c.name==='HomeWeaponBHide');assert.ok(scoped);assert.notEqual(scoped,f.bHide);assert.equal(scoped.tracks.length,2);assert.ok(scoped.tracks.every(t=>t.name.startsWith(f.a.uuid+'.')));assert.deepEqual(f.bHide.tracks,before);
});
test('without authored prop channels the normal hide helpers are retained',()=>{
 const f=fixture({prop:false});f.animation.play('HomeUnique01_L',true);assert.ok(f.a.scale.x<.011&&f.b.scale.x<.011);
});
test('non-Home actions do not receive Home hide helpers and independent actor state stays isolated',()=>{
 const f=fixture(),other=fixture();other.animation.play('HomeWait01_L',true);
 f.animation.play('Attack',false);assert.deepEqual(f.animation.getAnimationClipsByName('Attack').map(c=>c.name),['Attack']);assert.equal(f.a.scale.x,1);assert.equal(f.b.scale.x,1);assert.ok(other.b.scale.x<.011);
});
const viewerSource=fs.readFileSync(path.join(root,'src/viewer/viewerLocomotion.ts'),'utf8');
const viewerAst=ts.createSourceFile('viewer.ts',viewerSource,ts.ScriptTarget.Latest,true);
const names=['collectNativeDungeonExternalAttachments','restoreExternalAttachmentModelRoot','setNativeDungeonExternalAttachmentsHidden'];
const functions=viewerAst.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(viewerAst)).join('\n');
const visibility=new Function('THREE',ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return {collect:collectNativeDungeonExternalAttachments,set:setNativeDungeonExternalAttachmentsHidden}')(THREE);
test('async native recollection retains first visibility and placement for the exact same object',()=>{
 const object=new THREE.Group(),weapon=new THREE.Group();weapon.name='chara_100301_weapon_b_model';weapon.position.set(1,2,3);object.add(weapon);
 const character={object},binding={nativeDungeonActions:{externalAttachments:visibility.collect(character)}};
 visibility.set(binding,true);weapon.position.set(9,9,9);
 binding.nativeDungeonActions.externalAttachments=visibility.collect(character,binding.nativeDungeonActions.externalAttachments);
 visibility.set(binding,false);assert.equal(weapon.visible,true);assert.deepEqual(weapon.position.toArray(),[1,2,3]);
});
test('same-name replacement and new sibling keep their own initial state; authored invisible stays invisible',()=>{
 const object=new THREE.Group(),old=new THREE.Group();old.name='chara_100301_weapon_b_model';old.visible=false;object.add(old);const character={object};const first=visibility.collect(character);
 old.visible=true;const added=new THREE.Group();added.name=old.name;added.position.x=8;object.add(added);
 const next=visibility.collect(character,first);assert.equal(next[0],first[0]);assert.equal(next[0].visible,false);assert.equal(next[1].visible,true);assert.equal(next[1].restPosition.x,8);
 object.remove(old);const remaining=visibility.collect(character,next);assert.equal(remaining.length,1);assert.equal(remaining[0].object,added);
});
test('presentation-only attach does not apply the TPS blanket hide and both native refresh paths preserve snapshots',()=>{
 const attach=viewerAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='attachViewerLocomotion');assert.ok(attach);
 const target=[];function walk(n){if(ts.isIfStatement(n)&&n.thenStatement.getText(viewerAst).includes('setNativeDungeonExternalAttachmentsHidden(binding, true)'))target.push(n);ts.forEachChild(n,walk)}walk(attach);
 const initial=target.find(n=>n.expression.getText(viewerAst).includes('characterSpecificMotion.profile.status'));assert.ok(initial);
 const check=new Function('enabled','characterSpecificMotion', 'return '+initial.expression.getText(viewerAst));assert.equal(check(false,{profile:{status:'attached'}}),false);assert.equal(check(true,{profile:{status:'attached'}}),true);
 const ensure=viewerAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ensureNativeDungeonActions').getText(viewerAst);assert.equal((ensure.match(/collectNativeDungeonExternalAttachments\(binding.character, native.externalAttachments,/g)??[]).length,2);
});
test('an explicit SP rig is excluded by exact subtree identity even when its wrapper matches the weapon name',()=>{
 const object=new THREE.Group(),ordinary=new THREE.Group(),spRoot=new THREE.Group(),spWeapon=new THREE.Group();ordinary.name='chara_100301_weapon_b_model';spWeapon.name='chara_100301_weapon_a_sp_model';spRoot.add(spWeapon);object.add(ordinary,spRoot);
 const character={object},items=visibility.collect(character,[],[spRoot]);assert.deepEqual(items.map(i=>i.object),[ordinary]);const binding={nativeDungeonActions:{externalAttachments:items}};
 spWeapon.visible=false;visibility.set(binding,true);visibility.set(binding,false);assert.equal(ordinary.visible,true);assert.equal(spWeapon.visible,false);
});
