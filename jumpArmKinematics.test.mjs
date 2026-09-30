import assert from 'node:assert/strict'
import test from 'node:test'
import {naturalJumpArmPose,jumpArmDirection} from './src/viewer/jumpArmKinematics.ts'
const modes=['standing','walking','running'],phases=['takeoff','airborne','land']
const close=(a,b)=>Math.abs(a-b)<1e-9
for(const mode of modes)test(mode+' preserves phase boundaries and finite moderate rotations',()=>{
 const take=naturalJumpArmPose(1,'takeoff',mode),air=naturalJumpArmPose(0,'airborne',mode),end=naturalJumpArmPose(1,'airborne',mode),land=naturalJumpArmPose(0,'land',mode)
 for(const side of ['left','right'])for(const key of ['upper','elbow','wrist','outward']){assert.ok(close(take[side][key],air[side][key]));assert.ok(close(air[side][key],end[side][key]));assert.ok(close(end[side][key],land[side][key]))}
 for(const phase of phases){let previous;for(let i=0;i<=120;i++){
  const pose=naturalJumpArmPose(i/120,phase,mode)
  for(const side of ['left','right']){
   const arm=pose[side];assert.ok(Object.values(arm).every(Number.isFinite));assert.ok(arm.upper>=-30&&arm.upper<=40);assert.ok(arm.elbow>=10&&arm.elbow<80);assert.ok(Math.abs(arm.wrist)<=5)
   const direction=jumpArmDirection(arm.upper+arm.elbow+arm.wrist,arm.outward,side==='left'?'L':'R');assert.ok(Math.abs(Math.hypot(...direction)-1)<1e-12)
   if(previous)for(const key of ['upper','elbow','wrist','outward'])assert.ok(Math.abs(arm[key]-previous[side][key])<2,'discontinuous sample')
  }
  previous=pose
 }}
})
test('standing swing is bilateral with relaxed elbows, not two running forearms held horizontally',()=>{
 for(const phase of phases)for(let i=0;i<=30;i++){
  const p=naturalJumpArmPose(i/30,phase,'standing');assert.deepEqual(p.left,p.right);assert.ok(p.left.elbow<30)
  const fore=jumpArmDirection(p.left.upper+p.left.elbow,p.left.outward,'L');assert.ok(fore[1]<-.45,'standing forearm remains propped horizontally')
 }
 const prep=naturalJumpArmPose(.28,'takeoff','standing'),lift=naturalJumpArmPose(1,'takeoff','standing')
 assert.ok(prep.left.upper<-10&&lift.left.upper>25,'missing backswing-to-lift movement')
})
test('walking and running have independently scaled lead/trail arms',()=>{
 const walk=naturalJumpArmPose(.5,'airborne','walking'),run=naturalJumpArmPose(.5,'airborne','running')
 assert.ok(Math.abs(walk.left.upper)<Math.abs(run.left.upper)*.6)
 assert.ok(Math.abs(walk.right.upper)<Math.abs(run.right.upper)*.6)
 assert.ok(walk.left.elbow<run.left.elbow*.6&&walk.right.elbow<run.right.elbow*.6)
 assert.ok(run.left.upper>0&&run.right.upper<0)
 assert.ok(walk.left.upper>0&&walk.right.upper<0)
})
test('invalid timing never yields NaN rotations and out-of-window times clamp',()=>{
 for(const value of [NaN,Infinity,-Infinity])assert.deepEqual(naturalJumpArmPose(value,'takeoff','standing'),naturalJumpArmPose(0,'takeoff','standing'))
 assert.deepEqual(naturalJumpArmPose(-1,'takeoff','walking'),naturalJumpArmPose(0,'takeoff','walking'))
 assert.deepEqual(naturalJumpArmPose(2,'takeoff','running'),naturalJumpArmPose(1,'takeoff','running'))
})
test('wrist directions follow forearms within 3 degrees instead of a drooping paw',()=>{
 for(const mode of modes)for(const phase of phases)for(let i=0;i<=30;i++){
  const p=naturalJumpArmPose(i/30,phase,mode)
  for(const [key,side]of [['left','L'],['right','R']]){
   const a=p[key],f=jumpArmDirection(a.upper+a.elbow,a.outward,side),w=jumpArmDirection(a.upper+a.elbow+a.wrist,a.outward,side),dot=f.reduce((s,x,k)=>s+x*w[k],0)
   assert.ok(Math.acos(Math.min(1,dot))*180/Math.PI<=3.001)
  }
 }
})
