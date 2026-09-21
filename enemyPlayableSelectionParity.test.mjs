import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
const S = process.env.ENEMY_BASELINE || 'D:/magia/.codex-work/magius3dviewer-s6-unified-build-20260906-v11'
const require = createRequire(`${S}/package.json`)
const ts = require('typescript')
const THREE = await import(pathToFileURL(`${S}/node_modules/three/build/three.module.js`))
const source = process.env.ENEMY_LOADER_SOURCE || fileURLToPath(new URL('./src/viewer/enemies/loader.ts',import.meta.url))
const imports = {
  three:THREE,
  'three/examples/jsm/loaders/FBXLoader.js':await import(pathToFileURL(`${S}/node_modules/three/examples/jsm/loaders/FBXLoader.js`)),
  '../../../magia-exedra-character-three/utils.ts':await import(pathToFileURL(`${S}/magia-exedra-character-three/utils.ts`)),
  './catalog.ts':await import(pathToFileURL(`${S}/src/viewer/enemies/catalog.ts`)),
  '../runtimeProductDelivery.ts':await import(pathToFileURL(`${S}/src/viewer/runtimeProductDelivery.ts`)),
}
const module = {exports:{}}
new Function('require','module','exports',ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(imports[name],name);return imports[name]},module,module.exports)
const {EnemyInstance}=module.exports
const motion=(name,duration=1)=>new THREE.AnimationClip(name,duration,[new THREE.NumberKeyframeTrack('.position[x]',[0,1],[0,1])])
const empty=name=>new THREE.AnimationClip(name,0,[])
function instance(clips) { const g=new THREE.Group();g.animations=clips;return new EnemyInstance('exact-enemy',{},g) }
test('empty source placeholders remain inspectable but are excluded from playable choices',()=>{
  const i=instance([empty('Attack'),motion('Wait_L'),empty('Wait')]);try {
    assert.deepEqual(i.animationNames,['Wait_L']);assert.equal(i.object.animations.length,3)
    assert.equal(i.currentAnimationName,'Wait_L');assert.equal(i.playAnimation('Attack'),undefined);assert.equal(i.currentAnimationName,'Wait_L')
  } finally{i.dispose()}
})
test('empty idle never outranks a valid walk when choosing the default',()=>{
  const i=instance([empty('Idle'),motion('Walk')]);try{assert.equal(i.defaultAnimationName,'Walk');assert.equal(i.currentAnimationName,'Walk')}finally{i.dispose()}
})
test('duration NaN, infinity and zero never appear as executable options',()=>{
  const bad=motion('Invalid');bad.duration=NaN;const inf=motion('Infinite');inf.duration=Infinity;const zero=motion('Zero');zero.duration=0
  const i=instance([bad,inf,zero,motion('Damage_SE')]);try{assert.deepEqual(i.animationNames,['Damage_SE']);assert.equal(i.currentAnimationName,'Damage_SE')}finally{i.dispose()}
})
test('all-empty fixture has no default or selected action',()=>{
  const i=instance([empty('Wait'),empty('Attack')]);try{assert.deepEqual(i.animationNames,[]);assert.equal(i.defaultAnimationName,undefined);assert.equal(i.currentAnimationName,undefined)}finally{i.dispose()}
})
test('valid playback still binds, advances, clamps and completes',()=>{
  const i=instance([motion('Wait_L'),motion('Attack_SE')]);try{
    const action=i.playAnimation('Attack_SE',false,0,1);assert.ok(action);i.update(0.5);assert.ok(i.object.position.x>0);i.update(0.6);assert.equal(action.paused,true);assert.equal(action.time,1)
  }finally{i.dispose()}
})
test('all 493 captured FBX inventories retain precisely 4057 playable clips and 5753 missing clips',()=>{
  const root=process.env.ENEMY_CPU_ROWS || fileURLToPath(new URL('../cpu-rows/',import.meta.url));let available=0,missing=0
  const files=fs.readdirSync(root).filter(f=>f.endsWith('.json'));assert.equal(files.length,493)
  for(const f of files){const row=JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));const clips=row.clips.map(c=>c.playAccepted?motion(c.name,c.duration):empty(c.name));const i=instance(clips);try{
    assert.deepEqual(i.animationNames,row.clips.filter(c=>c.playAccepted).map(c=>c.name).sort(),row.modelPrefabName)
    available+=i.animationNames.length;missing+=row.clips.filter(c=>!c.playAccepted).length;assert.equal(i.object.animations.length,row.clips.length)
  }finally{i.dispose()}}
  assert.equal(available,4057);assert.equal(missing,5753)
})
