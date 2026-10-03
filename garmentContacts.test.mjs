import fs from'node:fs';
import assert from'node:assert/strict';import test from'node:test';import{Bone,Group,BufferGeometry,Float32BufferAttribute,Uint16BufferAttribute,SkinnedMesh,MeshBasicMaterial,Skeleton,Quaternion,Vector3}from'three';import{StableGarmentContacts}from'./src/viewer/garmentContacts.ts';
function fixture(){const root=new Group(),hip=new Bone();hip.name='Hip';hip.position.y=.9;root.add(hip);const bones=[hip];for(const side of ['L','R']){const upper=new Bone(),lower=new Bone(),foot=new Bone();upper.name='UpLeg_'+side;lower.name='Leg_'+side;foot.name='Foot_'+side;upper.position.set(side==='L'?.1:-.1,0,0);lower.position.y=-.4;foot.position.y=-.4;hip.add(upper);upper.add(lower);lower.add(foot);bones.push(upper,lower,foot)}const skirt=new Bone();skirt.name='Skirt_F_L_01_Sp';skirt.position.set(.1,0,.025);hip.add(skirt);bones.push(skirt);const hair=new Bone();hair.name='Hair_F_L_01_Sp';hip.add(hair);bones.push(hair);const points=[];for(let row=0;row<5;row++)for(let col=0;col<4;col++)points.push(.065+col*.02,.59+row*.05,.024);const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(points,3));const weights=[],indices=[];for(let i=0;i<points.length/3;i++){weights.push(1,0,0,0);indices.push(7,0,0,0)}g.setAttribute('skinWeight',new Float32BufferAttribute(weights,4));g.setAttribute('skinIndex',new Uint16BufferAttribute(indices,4));const mesh=new SkinnedMesh(g,new MeshBasicMaterial());mesh.name='Body_Mesh';root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new Skeleton(bones));return{root,hip,skirt,hair,bones,mesh,solver:new StableGarmentContacts(root)}}
test('actual weighted garment samples respond to body-capsule penetration without moving root or legs',()=>{const f=fixture(),positions=f.bones.map(b=>b.position.toArray()),scales=f.bones.map(b=>b.scale.toArray()),legs=f.bones.slice(0,7).map(b=>b.quaternion.toArray());const s=f.solver.solve();assert.equal(s.supported,true);assert.ok(s.contacts>0);assert.ok(s.afterDepth<s.beforeDepth*.9);assert.ok(s.maxRotation<=.401);assert.deepEqual(f.bones.map(b=>b.position.toArray()),positions);assert.deepEqual(f.bones.map(b=>b.scale.toArray()),scales);assert.deepEqual(f.bones.slice(0,7).map(b=>b.quaternion.toArray()),legs);assert.deepEqual(f.hair.quaternion.toArray(),[0,0,0,1])});
test('600 repeated solves on an unchanged pose have zero accumulated drift or jitter',()=>{const f=fixture();f.solver.solve();const first=f.skirt.quaternion.toArray();for(let i=0;i<600;i++){f.solver.solve();assert.deepEqual(f.skirt.quaternion.toArray(),first)}f.solver.restore();assert.deepEqual(f.skirt.quaternion.toArray(),[0,0,0,1])});
test('turning contacts off restores the exact base and preserves authored/native transforms',()=>{const f=fixture();f.skirt.quaternion.set(.001,.02,.03,.999349789);const base=f.skirt.quaternion.toArray();f.solver.solve();f.solver.solve(false);assert.deepEqual(f.skirt.quaternion.toArray(),base);for(let i=0;i<5;i++){f.solver.solve();f.solver.restore();assert.deepEqual(f.skirt.quaternion.toArray(),base)}});
test('a fresh external writer is not overwritten by stale contact restoration',()=>{const f=fixture();f.solver.solve();f.skirt.quaternion.setFromAxisAngle(new Vector3(0,1,0),.4);const fresh=f.skirt.quaternion.toArray();f.solver.restore();assert.deepEqual(f.skirt.quaternion.toArray(),fresh)});
test('arms, hands, torso and legs are immutable colliders even when touching clothing',()=>{
 const f=fixture();
 for(const side of ['L','R']){const arm=new Bone(),fore=new Bone(),hand=new Bone();arm.name='Arm_'+side;fore.name='Forearm_'+side;hand.name='Hand_'+side;f.hip.add(arm);arm.add(fore);fore.add(hand);arm.position.set(side==='L'?.2:-.2,.25,.01);fore.position.y=-.2;hand.position.set(side==='L'?-.11:.11,-.25,0)}
 f.root.updateMatrixWorld(true);const solver=new StableGarmentContacts(f.root),body=[];f.root.traverse(n=>{if(n.isBone&&!/skirt/i.test(n.name))body.push(n)});
 const snapshot=()=>body.map(n=>[...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray(),...n.matrixWorld.toArray()]);const before=snapshot();
 for(let i=0;i<120;i++){const result=solver.solve(true,()=>false,1/60);assert.ok(result.contacts>0);assert.deepEqual(snapshot(),before,'contact changed a body/arm transform')}
 assert.ok(body.some(n=>n.name==='Arm_L')&&body.some(n=>n.name==='Hand_R'),'test must actually include the arms, not just the old fixture leg array')
});
test('unsupported or absent humanoid/garment rig is an inert capability, not an invented skeleton',()=>{const root=new Group(),bone=new Bone();bone.name='Tentacle';root.add(bone);const solver=new StableGarmentContacts(root),old=bone.quaternion.toArray();assert.equal(solver.solve().supported,false);assert.deepEqual(bone.quaternion.toArray(),old);solver.dispose()});
test('a rotated/scaled actor keeps finite bounded contacts and original segment lengths',()=>{const f=fixture(),parent=new Group();parent.add(f.root);parent.rotation.set(.1,.4,.1);parent.scale.setScalar(1.5);f.root.updateWorldMatrix(true,true);const before=f.bones.map(b=>b.position.length());for(let i=0;i<60;i++){const state=f.solver.solve();assert.ok(Number.isFinite(state.afterDepth));assert.ok(state.maxRotation<=.401)}assert.deepEqual(f.bones.map(b=>b.position.length()),before)});

test('independent build rollback cannot be overridden by a browser preference and does not remove studio',()=>{const source=fs.readFileSync('src/viewer/index.ts','utf8'),build=fs.readFileSync('scripts/build-deployment.mjs','utf8');assert.match(source,/garmentContactsAvailable = import\.meta\.env\.VITE_MAGIUS_GARMENT_CONTACTS !== 'off'/);assert.match(source,/Boolean\(value&&garmentContactsAvailable\)/);assert.match(source,/poseGravity\.setEnabled\(gravity\.checked&&poseGravityAvailable\)/);assert.match(build,/VITE_MAGIUS_GARMENT_CONTACTS: garmentContacts/);assert.match(source,/mountPerformanceStudio/);assert.match(source,/new PerformanceRecorder/);assert.match(build,/garmentContacts, garmentContactPolicy/)});

const legBones=f=>f.bones.filter(b=>/^UpLeg_/.test(b.name));
function clearLegs(f){for(const b of legBones(f))b.position.x=b.name.endsWith('L')?2:-2;f.root.updateMatrixWorld(true)}
test('unconstrained cloth recovery is passive, monotonic and has no rebound',()=>{
 const f=fixture();f.solver.solve(true,()=>false,1/60);clearLegs(f);let last=f.skirt.quaternion.angleTo(new Quaternion());
 for(let i=0;i<180;i++){const state=f.solver.solve(true,()=>false,1/60),angle=f.skirt.quaternion.angleTo(new Quaternion());assert.ok(angle<=last+1e-7);assert.equal(state.contacts,0);last=angle}
 assert.ok(last<1e-5)
});
test('recovery damping is independent of frame rate',()=>{
 const results=[];for(const fps of [24,60,120]){const f=fixture();f.solver.solve(true,()=>false,1/60);clearLegs(f);for(let i=0;i<fps;i++)f.solver.solve(true,()=>false,1/fps);results.push(f.skirt.quaternion.clone())}
 for(const result of results)assert.ok(result.angleTo(results[0])<1e-6)
});
test('strong recovery damping does not delay a newly incoming leg contact',()=>{
 const f=fixture(),original=legBones(f).map(b=>b.position.clone());clearLegs(f);f.solver.setRecoveryHalfLife(.3);f.solver.solve(true,()=>false,1/240);
 legBones(f).forEach((b,i)=>b.position.copy(original[i]));f.root.updateMatrixWorld(true);f.solver.solve(true,()=>false,1/240);const immediate=f.solver.projectSurface();
 f.solver.restore(true);f.solver.solve();const reference=f.solver.projectSurface();assert.ok(immediate.contacts>0);assert.ok(immediate.afterDepth<=reference.afterDepth+1e-6,'damping delayed the contact projection');assert.ok(immediate.afterDepth<immediate.beforeDepth*.9)
});
test('settled stationary contact has no perpetual vibration',()=>{
 const f=fixture();let last;let worst=0;for(let i=0;i<360;i++){f.solver.solve(true,()=>false,1/60);const now=f.skirt.quaternion.clone();if(i>240)worst=Math.max(worst,now.angleTo(last));last=now}assert.ok(worst<1e-5,'unprovoked cloth vibration '+worst)
});
test('manual garment ownership and disabling both restore precisely',()=>{
 const f=fixture(),base=f.skirt.quaternion.toArray();f.solver.solve(true,()=>false,1/60);f.solver.solve(true,n=>n===f.skirt,1/60);assert.deepEqual(f.skirt.quaternion.toArray(),base);f.solver.solve(true,()=>false,1/60);f.solver.solve(false);assert.deepEqual(f.skirt.quaternion.toArray(),base)
});
