import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';

// Execute the actual pre-track-generation foot-frame statements. Whole-clip
// contact/sole behavior (including the existing cyclic limiter) has a separate
// all-character gate; this contract tests the missing orientation degree of freedom.
const sourceFile=process.env.GAIT_SOURCE??new URL('./src/viewer/viewerLocomotion.ts',import.meta.url);
const source=fs.readFileSync(sourceFile,'utf8');
const syntax=ts.createSourceFile('viewerLocomotion.ts',source,ts.ScriptTarget.Latest,true);
function declaration(name){let found;const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(syntax)===name)found=node;ts.forEachChild(node,visit)};visit(syntax);assert.ok(found,`actual source declaration ${name} exists`);return found;}
function statement(node){while(node.parent&&!ts.isVariableStatement(node))node=node.parent;return node;}
function compile(legacy=false){
 const frame=statement(declaration('baselineFootWorldRotations')),siblings=frame.parent.statements,index=siblings.indexOf(frame);
 const initialization=siblings[index+1];assert.ok(ts.isForOfStatement(initialization),'bind foot-frame initialization follows its declaration');
 const helper=statement(declaration('setObjectWorldQuaternion')),legacyHelper=statement(declaration('alignSegmentDirection'));
 const rotation=statement(declaration('footWorldRotation')),body=rotation.parent.statements,apply=body[body.indexOf(rotation)+1];
 assert.ok(ts.isExpressionStatement(apply)&&ts.isCallExpression(apply.expression)&&apply.expression.expression.getText(syntax)==='setObjectWorldQuaternion','actual foot-frame result is consumed');
 const code=[frame,initialization,helper,legacyHelper].map(node=>node.getText(syntax)).join('\n')+'\nreturn (side,flatDirection)=>{'+(legacy ? "alignSegmentDirection(rig.get(side),rig.get(side+'toe'),flatDirection);" : rotation.getText(syntax)+'\n'+apply.getText(syntax))+'};';
 return new Function('THREE','rig','motionPaths','skeletonRestWorld','modelWorld','baselineToeDirections','character',ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
}
function fixture(yaw=0,legacy=false){
 const scene=new THREE.Group(),object=new THREE.Group(),rig=new Map(),motionPaths={},rest=new Map(),parents={},feet={},directions={},restQuaternions={};
 scene.add(object);object.rotation.y=yaw;object.position.set(.4,.1,-.2);object.updateMatrixWorld(true);
 const modelWorld=object.getWorldQuaternion(new THREE.Quaternion());
 for(const side of ['L','R']){
  const parent=new THREE.Bone(),foot=new THREE.Bone(),toe=new THREE.Bone();object.add(parent);parent.add(foot);foot.add(toe);
  parent.position.set(side==='L'?.08:-.08,.6,0);foot.position.set(0,-.4,0);toe.position.set(.03,-.02,.12);
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(side==='L'?.27:-.39,.17,side==='L'?-.21:.31));
  rest.set(foot,new THREE.Matrix4().compose(new THREE.Vector3(),q,new THREE.Vector3(1,1,1)));
  motionPaths['foot'+side]=side;rig.set(side,foot);rig.set(side+'toe',toe);parents[side]=parent;feet[side]=foot;
  restQuaternions[side]=modelWorld.clone().multiply(q).normalize();
  directions[side]=toe.position.clone().normalize().applyQuaternion(restQuaternions[side]);
 }
 object.updateMatrixWorld(true);
 const matrixBytes=[...rest.values()].map(m=>JSON.stringify(m.elements));
 return {scene,object,parents,feet,directions,restQuaternions,rest,matrixBytes,apply:compile(legacy)(THREE,rig,motionPaths,rest,modelWorld,directions,{object})};
}
for(const side of ['L','R'])test(`actual ${side} foot solve removes posed-parent axial roll without moving the leg`,()=>{
 const f=fixture(),direction=f.directions[side].clone().applyAxisAngle(new THREE.Vector3(0,1,0),.22).normalize();
 const expected=new THREE.Quaternion().setFromUnitVectors(f.directions[side],direction).multiply(f.restQuaternions[side]);
 for(const roll of [0,.35,-.91,1.2]){
  f.parents[side].quaternion.setFromEuler(new THREE.Euler(.31,roll,-.28));f.feet[side].quaternion.setFromEuler(new THREE.Euler(-.2,.72,roll));f.object.updateMatrixWorld(true);
  const parentBefore=f.parents[side].quaternion.clone(),positionBefore=f.feet[side].position.clone(),otherBefore=f.feet[side==='L'?'R':'L'].quaternion.clone();
  f.apply(side,direction);
  assert.ok(f.feet[side].getWorldQuaternion(new THREE.Quaternion()).angleTo(expected)<1e-6,'complete target bind frame, not only toe direction');
  assert.ok(f.parents[side].quaternion.equals(parentBefore));assert.ok(f.feet[side].position.equals(positionBefore));
  assert.ok(f.feet[side==='L'?'R':'L'].quaternion.equals(otherBefore));
 }
 assert.deepEqual([...f.rest.values()].map(m=>JSON.stringify(m.elements)),f.matrixBytes,'inverse-bind evidence remains immutable');
});
for(const yaw of [Math.PI/2,-Math.PI/2])test(`actual foot-frame solve is covariant under scene yaw ${yaw}`,()=>{
 const a=fixture(),b=fixture(yaw),world=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
 for(const side of ['L','R']){
  const direction=a.directions[side].clone().applyAxisAngle(new THREE.Vector3(1,0,0),.18).normalize();
  a.parents[side].rotation.set(.2,.6,-.3);b.parents[side].rotation.copy(a.parents[side].rotation);a.object.updateMatrixWorld(true);b.object.updateMatrixWorld(true);
  a.apply(side,direction);b.apply(side,direction.clone().applyQuaternion(world));
  assert.ok(a.feet[side].quaternion.angleTo(b.feet[side].quaternion)<1e-6,'model-local solution is independent of placement');
 }
});

test('negative control: legacy one-axis solve aligns the toe but retains incorrect shoe-frame roll',()=>{
 const f=fixture(0,true),side='L';
 const direction=f.directions[side].clone(),expected=f.restQuaternions[side];
 f.parents[side].quaternion.setFromEuler(new THREE.Euler(.6,.9,-.5));f.object.updateMatrixWorld(true);
 const rolled=new THREE.Quaternion().setFromAxisAngle(direction,.6).multiply(expected);
 f.feet[side].quaternion.copy(f.parents[side].getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rolled));f.object.updateMatrixWorld(true);f.apply(side,direction);
 const foot=f.feet[side],toe=foot.children[0],actualDirection=toe.getWorldPosition(new THREE.Vector3()).sub(foot.getWorldPosition(new THREE.Vector3())).normalize();
 assert.ok(actualDirection.angleTo(direction)<1e-6,'old solve gets Foot-Toe direction right');
 assert.ok(foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(expected)>.1,'but complete skinned-shoe frame is wrong');
});
