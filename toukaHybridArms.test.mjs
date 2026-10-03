import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import * as T from 'three';
const source=fs.readFileSync('src/viewer/viewerLocomotion.ts','utf8');
function expression(name){const ast=ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true);let value;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)value=n.initializer?.getText(ast);ts.forEachChild(n,visit)}visit(ast);assert.ok(value,name);return value;}
function evaluate(name,vars){return new Function(...Object.keys(vars),ts.transpileModule(`const result=${expression(name)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+'return result')(...Object.values(vars));}
test('only Touka switches donor; other wide skirts retain 114501',()=>{
 assert.equal(evaluate('wideSkirtArmDonorId',{characterId:101901}),111501);
 for(const characterId of [114501,102001,111501])assert.equal(evaluate('wideSkirtArmDonorId',{characterId}),114501);
});
test('actual walk/run blend uses 111501 wrist and finger curves, not 114501',()=>{
 const data=JSON.parse(fs.readFileSync('src/viewer/nativeUpperBodyMotionReference.generated.json'));
 const donors=data.donors.filter(d=>[111501,114501].includes(d.characterId));assert.equal(donors.length,2);
 const effectiveNaturalUpperBodyWeights=evaluate('effectiveNaturalUpperBodyWeights',{wideSkirtNativeArms:true,wideSkirtArmDonorId:111501});
 const sample=evaluate('sampleNativeUpperBodyDelta',{THREE:T,wrapReferencePhase:p=>((p%1)+1)%1});
 const blend=evaluate('blendNativeUpperBodyDelta',{THREE:T,characterId:101901,sampleNativeUpperBodyDelta:sample,naturalHandFingerDonors:donors.map(localRotations=>({localRotations})),effectiveNaturalUpperBodyWeights});
 const filter=evaluate('isNativeHandFingerRigPath',{});let checks=0,different=0;
 for(const semantic of ['walk','run']){
  const donor=donors.find(d=>d.characterId===111501),old=donors.find(d=>d.characterId===114501);
  const paths=Object.keys(donor.clips[semantic].frames[0].localRotationDeltas).filter(filter);assert.ok(paths.length>=20);
  for(const phase of [0,.13,.47,.75,.99])for(const path of paths){
   const actual=blend(semantic,phase,path),expected=sample(donor,semantic,phase,path);assert.ok(1-Math.abs(actual.dot(expected))<1e-10,JSON.stringify({semantic,phase,path,actual:actual.toArray(),expected:expected.toArray(),effectiveNaturalUpperBodyWeights}));checks++;
   const previous=sample(old,semantic,phase,path);if(previous&&1-Math.abs(actual.dot(previous))>1e-6)different++;
  }
 }
 assert.ok(different>10,'new donor must observably differ');console.log(`NATIVE_HAND_CHECKS=${checks}; DIFFERENT_FROM_114501=${different}`);
});
test('hybrid retains Tart swing and elbow bend but never folds inward below 114501',()=>{
 const reference=JSON.parse(fs.readFileSync('src/viewer/normalizedHumanoidMotionReference.generated.json'));
 const sample=(d,semantic,phase,fn)=>{const frames=d.clips[semantic].frames,x=(phase%1)*frames.length,i=Math.floor(x);return new T.Vector3().fromArray(fn(frames[i])).lerp(new T.Vector3().fromArray(fn(frames[(i+1)%frames.length])),x-i)};
 const vars={THREE:T,characterId:101901,normalizedHumanoidMotionReference:reference,sampleDonorVector:sample};
 const widen=evaluate('widenToukaArmDirection',vars),untouched=evaluate('widenToukaArmDirection',{...vars,characterId:114501});
 const tart=reference.donors.find(d=>d.characterId===111501),wide=reference.donors.find(d=>d.characterId===114501);let changed=0,minExtra=Infinity,maxExtra=0;
 for(const semantic of ['idle','walk','run'])for(let i=0;i<100;i++)for(const side of ['L','R']){
  const phase=i/100,sign=side==='L'?1:-1,upper=sample(tart,semantic,phase,f=>f.directions['upperArm'+side]).normalize(),fore=sample(tart,semantic,phase,f=>f.directions['forearm'+side]).normalize(),spread=sample(wide,semantic,phase,f=>f.directions['upperArm'+side]).normalize();
  const u=widen(upper.clone(),semantic,phase,'upperArm'+side),f=widen(fore.clone(),semantic,phase,'forearm'+side),out=v=>Math.atan2(sign*v.x,-v.y);
  assert.ok(out(u)>=out(spread)-1e-10);assert.ok(out(u)>=out(upper)-1e-10);
  assert.ok(Math.abs(u.dot(f)-upper.dot(fore))<1e-10,'elbow bend must be identical');assert.ok(Math.abs(u.z-upper.z)<1e-10&&Math.abs(f.z-fore.z)<1e-10,'forward swing preserved');
  assert.deepEqual(untouched(upper.clone(),semantic,phase,'upperArm'+side).toArray(),upper.toArray());
  const extra=(out(u)-out(upper))*180/Math.PI;if(extra>1e-5)changed++;minExtra=Math.min(minExtra,extra);maxExtra=Math.max(maxExtra,extra);
 }
 assert.ok(changed>100);console.log(JSON.stringify({armSamples:600,changed,minExtraDegrees:minExtra,maxExtraDegrees:maxExtra}));
});
