import assert from 'node:assert/strict'
import test from 'node:test'
import * as T from 'three'
import {expressiveJumpArmSample,expressiveJumpName,readJumpStyle,isJumpStyle} from './src/viewer/jumpStyle.ts'
import {CharacterLocomotionController,FlatGroundCollisionWorld} from './src/viewer/characterLocomotion.ts'
const modes=['standing','walking','running'],phases=['takeoff','airborne','land']
const circular=(a,b)=>Math.abs(((a-b+1.5)%1)-.5)
for(const mode of modes)test(mode+' has continuous takeoff/air/landing paths and loopable air',()=>{
 const take=expressiveJumpArmSample(1,'takeoff',mode),air=expressiveJumpArmSample(0,'airborne',mode),end=expressiveJumpArmSample(1,'airborne',mode),land=expressiveJumpArmSample(0,'land',mode)
 for(const key of ['left','right']){assert.ok(circular(take[key],air[key])<1e-10);assert.ok(circular(air[key],end[key])<1e-10);assert.ok(circular(end[key],land[key])<1e-10)}
 for(const phase of phases){let previous;for(let i=0;i<=120;i++){const p=expressiveJumpArmSample(i/120,phase,mode);assert.ok(Object.values(p).every(Number.isFinite));assert.ok(p.left>=0&&p.left<1&&p.right>=0&&p.right<1);if(previous){assert.ok(circular(p.left,previous.left)<.03);assert.ok(circular(p.right,previous.right)<.03)}previous=p}}
})
test('standing and running no longer share the same fixed backwards arm timing',()=>{
 const s=expressiveJumpArmSample(.8,'takeoff','standing'),r=expressiveJumpArmSample(.8,'takeoff','running')
 assert.ok(circular(s.right,r.right)>.3);assert.ok(circular(s.left,s.right)>.49);assert.ok(circular(r.left,r.right)<1e-12)
 const start=expressiveJumpArmSample(0,'takeoff','standing'),end=expressiveJumpArmSample(1,'takeoff','standing');assert.ok(circular(start.left,end.left)>.2)
})
test('new names cannot replace any original jump family',()=>{
 const old='Magius100107StandingJumpLandV45TargetRigMorphology_SE'
 assert.equal(expressiveJumpName(old),'Magius100107StandingJumpLandV45TargetRigMorphology_ExpressiveV1_SE');assert.notEqual(expressiveJumpName(old),old)
})
test('rollback preference survives reload and blocked storage cannot break the viewer',()=>{
 assert.equal(readJumpStyle({getItem:()=> 'classic'}),'classic');assert.equal(readJumpStyle({getItem:()=> 'expressive'}),'expressive')
 assert.equal(readJumpStyle({getItem(){throw Error('private browsing')}}),'expressive')
 for(const value of ['',0,'delete',null,{}])assert.equal(isJumpStyle(value),false)
})
function fixture(){const root=new T.Group(),world=new FlatGroundCollisionWorld(0),plays=[];const map=(prefix)=>Object.fromEntries(modes.map(mode=>[mode,{jump:prefix+'Jump',fall:prefix+'Fall',land:prefix+'Land'}]));const c=new CharacterLocomotionController({characterId:'style-fixture',transform:root,collisionWorld:world,groundQuery:world,initiallyGrounded:true,animation:{listClips:()=>['old','new','donor'].flatMap(p=>['Jump','Fall','Land'].map(n=>({name:p+n,duration:.5}))),play:(name)=>plays.push(name)},jumpLocomotionAnimations:map('old')});return{root,c,plays,map}}
test('midair old/new/old switching preserves motion, collision state and phase',()=>{
 const {c,plays,map}=fixture();c.setInput({moveX:0,moveZ:1,run:true,jumpPressed:true});c.advance(1/30)
 const before=c.snapshot();assert.equal(before.grounded,false)
 c.setJumpLocomotionAnimations(map('new'));assert.equal(plays.at(-1),'newJump');const after=c.snapshot()
 assert.deepEqual(after.position,before.position);assert.deepEqual(after.velocity,before.velocity);assert.equal(after.state,before.state);assert.equal(after.grounded,before.grounded)
 c.setJumpLocomotionAnimations(map('old'));assert.equal(plays.at(-1),'oldJump');assert.deepEqual(c.snapshot().position,before.position)
})
test('changing ordinary jump style cannot overwrite a deliberate combat donor action',()=>{
 const {c,plays,map}=fixture();c.setInput({moveX:0,moveZ:0,jumpPressed:true});c.advance(1/30);c.setJumpLocomotionAnimationOverride(map('donor'));assert.equal(plays.at(-1),'donorJump')
 c.setJumpLocomotionAnimations(map('new'));assert.equal(plays.at(-1),'donorJump')
 c.setJumpLocomotionAnimationOverride(undefined);assert.equal(plays.at(-1),'newJump')
})
