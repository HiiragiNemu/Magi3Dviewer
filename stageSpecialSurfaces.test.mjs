import assert from 'node:assert/strict'
import test, {after} from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import * as THREE from 'three'
import ts from 'typescript'

const root=process.cwd(),temp=fs.mkdtempSync(path.join(root,'.special-surfaces-'))
after(()=>fs.rmSync(temp,{recursive:true,force:true}))
function compile(name,source){const f=path.join(temp,name+'.mjs');fs.writeFileSync(f,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);return pathToFileURL(f).href}
const shadow=await import(compile('shadow',fs.readFileSync('src/viewer/stageShadowOnlyMaterial.ts','utf8')))
compile('hierarchy',fs.readFileSync('src/viewer/stageHierarchy.ts','utf8'))
const particles=await import(compile('particles',fs.readFileSync('src/viewer/stageParticles.ts','utf8').replace("'./stageHierarchy'","'./hierarchy.mjs'").replace("'magia-exedra-character-three/coordinateSpace'","'../magia-exedra-character-three/coordinateSpace.ts'")))
const {BackgroundDepthPass}=await import(compile('depth',fs.readFileSync('magia-exedra-character-three/scene/backgroundDepth.ts','utf8')))
const source={sourceShader:shadow.SHADOW_ONLY_SOURCE,materialName:'native_shadow_receiver',shading:'lit',transparent:false,depthWrite:true,serializedColors:{_ShadowColor:[.08988963067531586,.12132267653942108,.18867921829223633,0]},serializedFloats:{_frenelPower:.3499999940395355}}
function compileMaterial(material){const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader,{});return shader}

test('native shadow-only surface is completely transparent without shadow, not a white ground plane',()=>{
 for(const dot of [0,.1,.5,1])assert.equal(shadow.nativeShadowOnlyAlpha(1,dot,.35),0)
 assert.equal(shadow.nativeShadowOnlyAlpha(0,0,.35),1)
 assert.equal(shadow.nativeShadowOnlyAlpha(0,1,.35),0)
 assert.ok(Math.abs(shadow.nativeShadowOnlyAlpha(.4,.6,.35)-.6*Math.pow(.4,.35))<1e-12)
})
test('native shadow-only uses pass blend/depth state; zero serialized colour alpha does not delete shadows',()=>{
 const m=shadow.createStageShadowOnlyMaterial(source)
 assert.ok(m.transparent);assert.equal(m.depthWrite,false);assert.equal(m.side,THREE.FrontSide);assert.equal(m.fog,false)
 assert.equal(m.blendSrc,THREE.SrcAlphaFactor);assert.equal(m.blendDst,THREE.OneMinusSrcAlphaFactor);assert.equal(m.blendSrcAlpha,THREE.OneFactor)
 const s=compileMaterial(m);assert.deepEqual(s.uniforms.stageOnlyColor.value.toArray(),source.serializedColors._ShadowColor.slice(0,3));assert.match(s.fragmentShader,/stageOnlyShadow = \( directLight.visible/);assert.match(s.fragmentShader,/UNROLLED_LOOP_INDEX == 0/);assert.doesNotMatch(s.fragmentShader,/#include <opaque_fragment>/)
 m.dispose()
})
test('cloned native shadow-only material preserves operator and uniforms for later lightmap/probe binding',()=>{
 const m=shadow.createStageShadowOnlyMaterial(source),c=m.clone();assert.notEqual(c,m);const s=compileMaterial(c)
 assert.equal(c.customProgramCacheKey(),'native-shadow-only-main-csm-v1');assert.equal(s.uniforms.stageOnlyFresnelPower.value,source.serializedFloats._frenelPower)
 m.dispose();c.dispose()
})
test('CSM branch captures existing attenuated native main shadow instead of multiplying cascades',()=>{
 const m=shadow.createStageShadowOnlyMaterial(source),before=THREE.ShaderChunk.lights_fragment_begin
 try{m.defines.USE_CSM=1;THREE.ShaderChunk.lights_fragment_begin='directLight.color *= mix( stageMainShadow, 1.0, stageMainShadowFade );';const s=compileMaterial(m);assert.match(s.fragmentShader,/stageOnlyShadow = mix\( stageMainShadow, 1.0, stageMainShadowFade \)/);assert.doesNotMatch(s.fragmentShader,/getShadowMask/)}finally{THREE.ShaderChunk.lights_fragment_begin=before;m.dispose()}
})
test('unsupported source and missing native shadow parameters fail rather than invent a colour',()=>{
 assert.throws(()=>shadow.createStageShadowOnlyMaterial({...source,sourceShader:'Creative/Bg/BgUberShader'}));assert.throws(()=>shadow.createStageShadowOnlyMaterial({...source,serializedColors:{}}));assert.equal(shadow.nativeShadowOnlyAlpha(NaN,0,.35),0)
})

function surfaceFixture({soft=false,vertexColors=true}={}){
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial());if(vertexColors)mesh.geometry.setAttribute('color',new THREE.Float32BufferAttribute([1,.5,.2,.1,1,.5,.2,.2,1,.5,.2,.3,1,.5,.2,.4],4))
 const stage=new THREE.Group();stage.add(mesh);stage.userData.stageRuntimeTime=2.75
 const tex=new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1);tex.userData.stageTextureBinding={url:'/native-mask'}
 const textureBinding={url:'/native-mask',transform:{scale:[2,3],offset:[.2,.3]},sourceProperty:'_MainTex'}
 const binding={sourceShader:'Creative/Effect/Particle/Common',materialName:'native_effect_mesh',shading:'lit',transparent:false,depthWrite:true,textures:{base:textureBinding},serializedTextures:{_MainTex:textureBinding},serializedFloats:{_SrcBlend:5,_DstBlend:10,_Culling:0,_ZTest:4,_IsSoftParticle:soft?1:0,_SurfaceFadeNear:0,_SurfaceFadeFar:2},serializedColors:{_Color:[.4,.5,.6,.7]},validKeywords:soft?['IS_SOFT_PARTICLE']:[],invalidKeywords:[]}
 let registered,releaseCount=0
 const registrar={registerBackgroundDepthConsumer(c){registered=c;c.depthTextureUniform.value=new THREE.Texture();return()=>{releaseCount++;c.depthTextureUniform.value=null}}}
 const textures=new Set([tex]),material=particles.createStageParticleSurfaceMaterial(binding,mesh,textures,registrar)
 return{mesh,stage,tex,binding,material,textures,get registered(){return registered},get releaseCount(){return releaseCount},dispose(){material.dispose();mesh.geometry.dispose();for(const t of textures)t.dispose()}}
}
test('static EffectCommon surface retains source mesh/UV/colour and does not invent emitter or billboard geometry',()=>{
 const f=surfaceFixture(),geometry=f.mesh.geometry,positions=Array.from(geometry.attributes.position.array)
 assert.equal(f.mesh.geometry,geometry);assert.deepEqual(Array.from(geometry.attributes.position.array),positions);assert.equal(f.stage.children.length,1)
 assert.match(f.material.vertexShader,/modelViewMatrix \* vec4\(position, 1.0\)/);assert.doesNotMatch(f.material.vertexShader,/gl_PointSize|attribute vec3 stagePosition/)
 assert.ok(f.material.vertexColors);assert.match(f.material.vertexShader,/vStageColor = color/);f.dispose()
})
test('native effect blend and fixed ZWrite Off override erroneous legacy opaque binding defaults',()=>{
 const f=surfaceFixture();assert.equal(f.material.depthWrite,false);assert.equal(f.material.transparent,true);assert.equal(f.material.side,THREE.DoubleSide);assert.equal(f.material.blendSrc,THREE.SrcAlphaFactor);assert.equal(f.material.blendDst,THREE.OneMinusSrcAlphaFactor);f.dispose()
})
test('effect texture identity and native UV transform stay exact without a neighbour texture fallback',()=>{
 const f=surfaceFixture();assert.equal(f.material.uniforms.uMap.value,f.tex);assert.deepEqual(f.material.uniforms.uMapTransform.value.toArray(),[2,3,.2,.3]);assert.equal(f.textures.size,1);f.dispose()
})
test('effect surface consumes shared stage clock and final draw camera without a new simulation timer',()=>{
 const f=surfaceFixture();const camera=new THREE.PerspectiveCamera(40,1,.2,400);f.material.onBeforeRender({},new THREE.Scene(),camera,f.mesh.geometry,f.mesh,{})
 assert.equal(f.material.uniforms.uTime.value,2.75);assert.equal(f.material.uniforms.uCameraNear.value,.2);assert.equal(f.material.uniforms.uCameraFar.value,400);assert.equal(f.material.uniformsNeedUpdate,true);f.dispose()
})
test('soft effect registers exact material, not an entire mixed mesh; disposal releases depth ownership',()=>{
 const f=surfaceFixture({soft:true});assert.equal(f.registered.object,f.mesh);assert.equal(f.registered.material,f.material);assert.equal(f.material.uniforms.uUseSoftParticle.value,1);f.dispose();assert.equal(f.releaseCount,1)
})
test('no-soft surface does not enable depth prepass or introduce hidden depth ownership',()=>{
 const f=surfaceFixture();assert.equal(f.registered,undefined);assert.equal(f.material.uniforms.uUseSoftParticle.value,0);f.dispose();assert.equal(f.releaseCount,0)
})
for(const fail of [false,true])test('mixed depth draw preserves opaque siblings and restores exact state, throw='+fail,()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),pass=new BackgroundDepthPass(scene,camera),opaque=new THREE.MeshBasicMaterial(),effect=new THREE.MeshBasicMaterial({transparent:true}),mesh=new THREE.Mesh(new THREE.PlaneGeometry(),[opaque,effect]);scene.add(mesh)
 const uniform={value:null},resolution={value:new THREE.Vector2()},release=pass.register({object:mesh,material:effect,depthTextureUniform:uniform,resolutionUniform:resolution})
 const initial=new THREE.WebGLRenderTarget(1,1);let current=initial,called=0
 const renderer={shadowMap:{autoUpdate:true,needsUpdate:true},autoClear:false,getRenderTarget:()=>current,setRenderTarget:t=>{current=t},clear(){},render(){called++;assert.equal(mesh.visible,true);assert.equal(opaque.visible,true);assert.equal(effect.visible,false);if(fail)throw Error('probe')}}
 if(fail)assert.throws(()=>pass.render(renderer),/probe/);else pass.render(renderer)
 assert.equal(called,1);assert.equal(effect.visible,true);assert.equal(opaque.visible,true);assert.equal(mesh.visible,true);assert.equal(current,initial);assert.equal(renderer.autoClear,false);assert.equal(renderer.shadowMap.autoUpdate,true);release();assert.equal(pass.enabled,false);assert.equal(uniform.value,null);pass.dispose();initial.dispose();mesh.geometry.dispose();opaque.dispose();effect.dispose()
})
test('special surface selection is exact shader-family keyed and leaves generic scene and character materials alone',()=>{
 const src=fs.readFileSync('src/viewer/stageMaterialBindings.ts','utf8');assert.match(src,/binding.sourceShader === SHADOW_ONLY_SOURCE/);assert.match(src,/binding.sourceShader === 'Creative\/Effect\/Particle\/Common'/)
 const helper=fs.readFileSync('src/viewer/stageShadowOnlyMaterial.ts','utf8');assert.doesNotMatch(helper,/dungeon-|battle-|characterId/)
})
