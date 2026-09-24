import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(root, 'src', 'viewer', 'stageParticles.ts')
const hierarchySourcePath = join(root, 'src', 'viewer', 'stageHierarchy.ts')
const source = readFileSync(sourcePath, 'utf8')

const nonce = `${process.pid}-${Date.now()}`
const hierarchyPath = join(root, `.stage-blend-regression-hierarchy-${nonce}.mjs`)
const particlePath = join(root, `.stage-blend-regression-particles-${nonce}.mjs`)
const compile = (input, fileName) => ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName,
}).outputText
writeFileSync(hierarchyPath, compile(readFileSync(hierarchySourcePath, 'utf8'), hierarchySourcePath))
writeFileSync(particlePath, compile(source, sourcePath)
    .replace("'./stageHierarchy'", `'./${basename(hierarchyPath)}'`)
    .replace(
        "'magia-exedra-character-three/coordinateSpace'",
        "'./magia-exedra-character-three/coordinateSpace.ts'",
    ))
const particles = await import(pathToFileURL(particlePath).href)
after(() => {
    rmSync(hierarchyPath, { force: true })
    rmSync(particlePath, { force: true })
})


const stageProfile=JSON.parse(readFileSync(join(root,'public/stages/official/battle-601-00-01-001/scene-profile.json'),'utf8'));
function makeMaterial(binding, floats) {
 const scene=new THREE.Group();scene.name='Root';const anchor=new THREE.Group();anchor.name='Particle';scene.add(anchor);
 const texture=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1);texture.needsUpdate=true;
 texture.userData.stageTextureBinding={url:'/blend-regression.png'};
 const preset={id:'preset',duration:1,simulationSpeed:1,looping:false,playOnAwake:true,autoRandomSeed:false,randomSeed:1,initial:{maxNumParticles:1,startLifetime:{minMaxState:0,scalar:1},startSpeed:{minMaxState:0,scalar:0},startSize:{minMaxState:0,scalar:1},startColor:{maxColor:[1,1,1,1]}},emission:{enabled:true,rateOverTime:{minMaxState:0,scalar:0},m_Bursts:[]},modules:{},renderer:{enabled:true,renderMode:0,sortingOrder:0}};
 const controller=new particles.StageParticleRuntimeController(scene,[preset],[{pathID:'1',hierarchyPath:'Root/Particle',active:true,presetId:'preset',materials:['official']}],[{...binding,materialName:'official',textures:{base:{url:'/blend-regression.png'}}}],[texture],floats===undefined?{}:{officialMaterials:[{name:'official',floats}]});
 const drawable=anchor.children.find(c=>c.name==='UnityParticleSystem:1');assert.ok(drawable instanceof THREE.Points);
 return {material:drawable.material,dispose(){controller.dispose();texture.dispose()}};
}
test('601 glow uses native additive factor despite legacy profile lacking serialized floats',()=>{
 const binding=stageProfile.materialBindings.find(b=>b.materialName==='bg3d601_00_lightGlowParticle');
 const native=stageProfile.sourceRecords.materials.find(m=>m.name===binding.materialName);
 assert.equal(binding.blending,'additive');assert.equal(native.floats._SrcBlend,5);assert.equal(native.floats._DstBlend,1);
 const m=makeMaterial(binding);try {assert.equal(m.material.blendSrc,THREE.SrcAlphaFactor);assert.equal(m.material.blendDst,THREE.OneFactor);assert.equal(m.material.depthWrite,false)} finally {m.dispose()}
});
for(const [name,src,dst] of [['normal',THREE.SrcAlphaFactor,THREE.OneMinusSrcAlphaFactor],['additive',THREE.SrcAlphaFactor,THREE.OneFactor],['multiply',THREE.DstColorFactor,THREE.ZeroFactor]])test(name+' binding survives missing full native float payload',()=>{const m=makeMaterial({blending:name,transparent:true,depthWrite:false});try{assert.equal(m.material.blendSrc,src);assert.equal(m.material.blendDst,dst)}finally{m.dispose()}});
test('explicit serialized native blend factors retain priority over fallback',()=>{const m=makeMaterial({blending:'normal',transparent:true},{_SrcBlend:1,_DstBlend:1});try{assert.equal(m.material.blendSrc,THREE.OneFactor);assert.equal(m.material.blendDst,THREE.OneFactor)}finally{m.dispose()}});
