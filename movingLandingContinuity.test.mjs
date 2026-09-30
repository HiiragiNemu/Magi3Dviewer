import assert from 'node:assert/strict'
import test from 'node:test'
import * as T from 'three'
import {CharacterLocomotionController,FlatGroundCollisionWorld} from './src/viewer/characterLocomotion.ts'
function fixture(){const root=new T.Group(),world=new FlatGroundCollisionWorld(0),plays=[];const c=new CharacterLocomotionController({characterId:'contact-continuity',transform:root,collisionWorld:world,groundQuery:world,initiallyGrounded:true,animation:{listClips:()=>['Idle','Walk','Run','Jump','Fall','Land'].map(name=>({name,duration:.8})),play:(name,options)=>plays.push({name,...options})},locomotionAnimations:{idle:'Idle',walk:'Walk',run:'Run',jump:'Jump',fall:'Fall',land:'Land'},config:{fixedStepSeconds:1/120,maxSubSteps:16,walkSpeed:1.6,runSpeed:3.8,groundAcceleration:20,groundDeceleration:12,airAcceleration:1,gravity:15,jumpSpeed:5.4,landingDurationSeconds:.18}});return{root,c,plays}}
for(const fps of [12,30,60,144])for(const run of [false,true])test(`${run?'run':'walk'} held through contact stays moving at ${fps} FPS`,()=>{
 const {c,plays}=fixture();c.setInput({moveX:0,moveZ:1,run});for(let i=0;i<fps;i++)c.advance(1/fps)
 c.setInput({moveX:0,moveZ:1,run,jumpPressed:true});let flew=false,hit=false,last
 for(let i=0;i<fps*2;i++){const s=c.advance(1/fps);if(!s.grounded)flew=true;if(flew&&s.grounded){if(!hit){assert.ok(Math.hypot(s.velocity.x,s.velocity.z)>=Math.hypot(last.velocity.x,last.velocity.z)*.95,'landing erased requested horizontal motion');assert.equal(s.state,run?'run':'walk','landing inserted a stationary clip');assert.equal(plays.at(-1).resumeGroundedGait,true);assert.equal(plays.at(-1).contactTransition,true);hit=true}assert.ok(Math.hypot(s.velocity.x,s.velocity.z)>.8)}last=s}
 assert.ok(flew&&hit)
})
for(const fps of [12,30,60,144])test(`airborne release still stops exactly at ground at ${fps} FPS`,()=>{
 const {c,root}=fixture();c.setInput({moveX:0,moveZ:1,run:true});for(let i=0;i<fps;i++)c.advance(1/fps)
 c.setInput({moveX:0,moveZ:1,run:true,jumpPressed:true});let flew=false,contact
 for(let i=0;i<fps*3;i++){const s=c.advance(1/fps);if(!s.grounded){flew=true;c.setInput({moveX:0,moveZ:0,run:false})}if(flew&&s.grounded){contact??=root.position.clone();assert.equal(s.velocity.x,0);assert.equal(s.velocity.z,0);assert.ok(root.position.distanceTo(contact)<1e-9)}}
 assert.ok(contact);assert.equal(c.snapshot().state,'idle')
})
