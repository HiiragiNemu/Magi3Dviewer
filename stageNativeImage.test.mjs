import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import * as THREE from 'three'
const source=fs.readFileSync('src/viewer/stageNativeImage.ts','utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function instantiate(overrides={}) {
 const exports={};new Function('require','exports',compiled)(name=>{
  if(name==='three')return overrides.THREE??THREE
  if(name.includes('runtimeProductDelivery'))return {resolveRuntimeAssetUrl:overrides.resolve??(async x=>x)}
  if(name.includes('loadingProgress'))return {readLoadingResponse:async response=>response.arrayBuffer()}
  throw Error('Unexpected module '+name)
 },exports);return exports
}
const api=instantiate(),entries=JSON.parse(fs.readFileSync('public/stages/catalogs/official-gallery-diorama-original.v1.json')).stages
const evidence=JSON.parse(fs.readFileSync('docs/research/native-gallery-backgrounds.v1.json'))

test('all 79 gallery entries identify exact native Sprite pixels, not substitute 3D reconstruction',()=>{
 assert.equal(entries.length,79);assert.equal(evidence.verified.length,79);assert.equal(evidence.failures.length,0)
 for(const entry of entries){const proof=evidence.verified.find(x=>x.id===entry.id),p=api.validateNativeImageBackground(entry);assert.ok(proof)
  assert.equal(entry.type,'image');assert.equal(entry.dynamic.status,'static');assert.equal(p.sha256,proof.fileSha256);assert.equal(p.pixelSha256,proof.pixelSha256)
  assert.equal(entry.url,proof.url);assert.deepEqual(proof.sourceTypes,{Texture2D:1,AssetBundle:1,Sprite:1});assert.equal(proof.notA3DReconstruction,true)
  assert.equal(p.spritePathId,proof.spritePathId);assert.equal(p.texturePathId,proof.texturePathId);assert.equal(p.sourceBundle,proof.sourceBundle)
 }
})
test('generic presentation products or mismatched/native identities are not enabled by an image URL',()=>{
 const valid=entries[0]
 for(const invalid of [{...valid,nativeImage:undefined},{...valid,assetBundleName:'field/bg/map_bg_60000'},
  {...valid,url:'https://elsewhere.invalid/preview.png'},{...valid,nativeImage:{...valid.nativeImage,sha256:'incorrect'}},
  {...valid,nativeImage:{...valid.nativeImage,width:Infinity}}])assert.throws(()=>api.validateNativeImageBackground(invalid),/Unverified/)
})
for(const [w,h]of [[360,780],[430,932],[932,430],[1366,900]])test(`original image retains full aspect without crop or stretch at ${w}x${h}`,()=>{
 const [x,y]=api.nativeImageViewportScale(2048/1000,w/h);assert.ok(x<=1&&y<=1&&x>0&&y>0)
 assert.ok(Math.abs(x*w/(y*h)-2048/1000)<1e-10)
})
test('native image is a screen background, not a ground raycast, shadow caster or static world-space batch',()=>{
 const texture=new THREE.Texture(),mesh=api.createNativeImageScreen(texture,entries[0].id,entries[0].nativeImage)
 assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,false);assert.equal(mesh.frustumCulled,false)
 assert.equal(mesh.material.depthWrite,false);assert.equal(mesh.material.depthTest,false);assert.equal(mesh.material.toneMapped,false)
 assert.equal(mesh.material.userData.stageRigidVertexPosition,false);const hits=[];mesh.raycast(new THREE.Raycaster(),hits);assert.equal(hits.length,0)
 mesh.onBeforeRender({getCurrentViewport:v=>v.set(0,0,360,780)})
 assert.deepEqual(mesh.material.uniforms.uImageScale.value.toArray(),api.nativeImageViewportScale(2.048,360/780))
 assert.equal(mesh.userData.nativeImageBackground.sha256,entries[0].nativeImage.sha256)
 mesh.geometry.dispose();mesh.material.dispose();texture.dispose()
})
test('payload verification rejects changed or truncated release PNG before decode',async()=>{
 const oldFetch=globalThis.fetch;let decoded=0
 class Loader {async loadAsync(){decoded++;return new THREE.Texture()}}
 const loader=instantiate({THREE:{...THREE,TextureLoader:Loader}})
 try{globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]));await assert.rejects(loader.loadNativeImageBackground(entries[0],new AbortController().signal),/identity mismatch/);assert.equal(decoded,0)}finally{globalThis.fetch=oldFetch}
})
