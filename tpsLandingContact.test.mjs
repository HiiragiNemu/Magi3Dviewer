import assert from 'node:assert/strict'
import test from 'node:test'
import * as T from 'three'
import {CharacterLocomotionController,FlatGroundCollisionWorld} from './src/viewer/characterLocomotion.ts'

function fixture() {
 const root=new T.Group(),world=new FlatGroundCollisionWorld(0),plays=[]
 const controller=new CharacterLocomotionController({characterId:'landing-fixture',transform:root,initiallyGrounded:true,collisionWorld:world,groundQuery:world,
  animation:{listClips:()=>['Idle','Walk','Run','Jump','Fall','Land'].map(name=>({name,duration:1,trackCount:1})),play:(name,options)=>plays.push({name,...options})},
  locomotionAnimations:{idle:'Idle',walk:'Walk',run:'Run',jump:'Jump',fall:'Fall',land:'Land'},
  config:{fixedStepSeconds:1/60,maxSubSteps:8,groundAcceleration:12,groundDeceleration:10,airAcceleration:1,gravity:15,jumpSpeed:5.4,landingDurationSeconds:.36}})
 return {root,controller,plays}
}
for(const fps of [12,30,60,144])for(const moving of [true,false])test(`landing at ${fps} FPS, ${moving?'direction held':'released in air'}: no grounded glide in the landing pose`,()=>{
 const {root,controller,plays}=fixture()
 controller.setInput({moveX:0,moveZ:1,run:true});for(let i=0;i<fps;i++)controller.advance(1/fps)
 controller.setInput({moveX:0,moveZ:1,run:true,jumpPressed:true})
 let airborne=false,contact,landFrames=0,groundTravel=0,previous
 for(let i=0;i<fps*4;i++){
  const old=root.position.clone(),state=controller.advance(1/fps)
  if(!state.grounded){airborne=true;if(!moving)controller.setInput({moveX:0,moveZ:0,run:false})}
  if(airborne&&state.grounded&&!contact){contact=root.position.clone();assert.ok(!['jump','fall'].includes(state.state));assert.equal(state.velocity.y,0);assert.equal(plays.at(-1).contactTransition,true)}
  if(contact&&state.state==='land'){
   landFrames++
   assert.ok(Math.hypot(state.velocity.x,state.velocity.z)<1e-9,'landing pose still carries airborne horizontal speed')
   if(previous==='land')groundTravel+=root.position.distanceTo(old)
  }
  if(contact&&previous==='land'&&state.state!=='land')assert.equal(plays.at(-1).contactTransition,true,'grounded handoff must not reuse the long airborne blend')
  previous=state.state
 }
 assert.ok(airborne&&contact&&landFrames>0)
 assert.ok(groundTravel<1e-9,'grounded recovery translated without a walking/running animation')
 assert.equal(controller.snapshot().state,moving?'run':'idle')
 if(!moving)assert.ok(root.position.distanceTo(contact)<1e-9,'releasing midair left post-contact drift')
})
test('landing with another queued jump is not permanently locked or replayed every frame',()=>{
 const {controller}=fixture();controller.setInput({moveX:0,moveZ:1,run:true,jumpPressed:true});let airborne=false
 for(let i=0;i<180;i++){const s=controller.advance(1/60);airborne ||= !s.grounded;if(airborne&&s.grounded)break}
 controller.setInput({moveX:0,moveZ:1,run:true,jumpPressed:true})
 let launches=0,lastGround=true
 for(let i=0;i<120;i++){const s=controller.advance(1/60);if(lastGround&&!s.grounded)launches++;lastGround=s.grounded}
 assert.equal(launches,1)
})
