import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

// Overlay keeps production frozen; NODE_NATIVE_CANDIDATE_ROOT selects original
// for the negative control. These paths are test transport, never runtime IDs.
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.dirname(here);
const planPath = path.join(packageRoot, 'plan.json');
const packaged = fs.existsSync(planPath);
const plan = packaged ? JSON.parse(fs.readFileSync(planPath)) : { sourceRoot: here, candidateRoles: [] };
const sourceRoot = process.env.NATIVE_SOURCE_ROOT || plan.sourceRoot;
const overlay = process.env.NODE_NATIVE_CANDIDATE_ROOT || here;
const req = createRequire(path.join(sourceRoot, 'package.json'));
const THREE = req('three'), ts = req('typescript');
const picomatch = req('picomatch');
const moduleDir = 'magia-exedra-character-three';
const modelDir = `${moduleDir}/models/chara_101002_battle_unit`;
function location(relative) {
  const snapshot=process.env.NATIVE_PERSPECTIVE_SNAPSHOT;
  if(snapshot && fs.existsSync(path.join(snapshot,relative)))return path.join(snapshot,relative);
  if (process.env.NATIVE_CODE_CONTROL === 'original' && ['magia-exedra-character-three/loader.ts','src/viewer/character.ts'].includes(relative)) return path.join(packageRoot,'original',relative);
  if (plan.candidateRoles.includes(relative)) return path.join(overlay, relative);
  return path.join(sourceRoot, relative);
}
const read = relative => fs.readFileSync(location(relative), 'utf8').replace(/^\uFEFF/, '');
function compile(source, name, imports) {
  const result = ts.transpileModule(source, { fileName: name, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  assert.deepEqual(result.diagnostics, []);
  const module = { exports: {} };
  Function('exports','require','module','window',result.outputText)(module.exports, spec => {
    assert.ok(Object.hasOwn(imports, spec), `unmapped import ${name}: ${spec}`);
    return imports[spec];
  }, module, {});
  return module.exports;
}
function functions(relative, names, imports) {
  const source = read(relative), ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
  const rows = ast.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name?.text));
  assert.equal(rows.length, names.length);
  return compile(rows.map(s => 'export '+s.getText(ast).replace(/^export\s+/, '')).join('\n'), relative, imports);
}
const native = compile(read(`${moduleDir}/nativeMaterialScope.ts`), 'nativeMaterialScope.ts', { three: THREE });
const profile = compile(read(`${moduleDir}/renderProfile.ts`), 'renderProfile.ts', {
  three: THREE, './materialProfile': { getOfficialMaterialProfiles() { throw Error('global profiles must not supply native references'); } },
  './official-character-controller-profiles.generated.json': JSON.parse(read(`${moduleDir}/official-character-controller-profiles.generated.json`)),
});
let controller = {};
if (fs.existsSync(location(`${moduleDir}/nativeCharacterController.ts`))) controller = compile(read(`${moduleDir}/nativeCharacterController.ts`), 'nativeCharacterController.ts', { three: THREE, './renderProfile': profile });
const userdata = compile(read(`${moduleDir}/shaders/userdata.ts`), 'userdata.ts', { three: THREE });
const depthRim = compile(read(`${moduleDir}/shaders/depthRim.ts`), 'depthRim.ts', { three: THREE });
const stylization = compile(read(`${moduleDir}/shaders/stylization.ts`), 'stylization.ts', {
  three: THREE, './userdata': userdata, '../scene/selfShadow': { injectReDriveSelfShadowShader() {} }, '../coordinateSpace': { unityWorldToViewerVector: v=>v },
});
const texture = { async loadTexture() { throw Error('native construction leaked into legacy texture transport'); },
  ApplyOfficialCharacterSurfaceSampling: () => ({}), ApplyOfficialSpecularGradientSampling() {},
  ApplyOfficialCommonAngelRingSampling() {}, ApplyOfficialCharacterAngelRingSampling: () => ({}) };
const perspective = compile(read(moduleDir+'/shaders/perspective.ts'), 'perspective.ts', {});
const general = compile(read(`${moduleDir}/shaders/general.ts`), 'general.ts', {
  three: THREE, '.': userdata, '../texture': texture, '../materialProfile': { getOfficialTextureSamplerProfile() {} },
  './stylization': stylization, './depthRim': depthRim, './gem': { setOfficialMaterialProfileUniforms: depthRim.setDepthRimMaterialProfileUniforms },
  './perspective': perspective, '../nativeMaterialScope': native,
});
const hair = compile(read(`${moduleDir}/shaders/hair.ts`), 'hair.ts', { three: THREE, '.': {...userdata,...general}, '../texture': texture, './RDToon_AngelRingMap.png': 'unused-legacy-common-map' });
const observedReferences = [];
const deps = { THREE, ...native, ...controller, ...general, ...profile,
  resolveNativeFaceDirectionReference: controller.resolveNativeFaceDirectionReference,
  createHairMaterial: async options => { observedReferences.push(options.angelRingReference); return hair.createHairMaterial(options); },
  createFaceMaterial() { throw Error('hair fixture unexpectedly invoked face constructor'); },
  injectOfficialGemShader() { throw Error('hair fixture unexpectedly invoked gem pass'); },
};
const loaderSource = read(`${moduleDir}/loader.ts`);
const loaderAst = ts.createSourceFile('loader.ts', loaderSource, ts.ScriptTarget.Latest, true);
const names = ['loadNativeCharacterMaterialInput','createNativeSlotResourceLoader','createNativeMeshMaterials','installAngelRingDrawReferenceUpdate'];
const functionSource = loaderAst.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name?.text)).map(s => s.getText(loaderAst)).join('\n');
assert.equal(loaderAst.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name?.text)).length, 4);
const readBlob = async url => {
  let bytes = fs.readFileSync(url);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return new Blob([bytes]);
};
const body = ts.transpileModule(functionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
const runtimeDeps = {...deps, fetchAndTryDecompressGzip: readBlob, throwIfCharacterLoadAborted: signal=>{if(signal?.aborted)throw Error('aborted');}, ...texture};
Function('exports',...Object.keys(runtimeDeps),body)(exports,...Object.values(runtimeDeps));

const baselinePacket = JSON.parse(fs.readFileSync(path.join(packaged ? path.join(packageRoot,'original') : sourceRoot, modelDir, 'runtime-material-channel.json')));
delete baselinePacket.controllerBindings;
const packet = JSON.parse(read(`${modelDir}/runtime-material-channel.json`));
const contractAuthority = plan.contractSource || location(`${modelDir}/model-binding-contract.json`);
const expected = JSON.parse(fs.readFileSync(contractAuthority));
const meshBinding = packet.meshes.find(m=>m.rendererPathId === '7503204719309455427');
const headPath = 'chara_101002_battle_unit/VisualRoot/chara_101002_model/chara_101002/Root/Hip/Spine/Waist/Chest/Neck/Head';
function rig() {
  const parts = headPath.split('/'), root = new THREE.Group(); root.name=parts.shift(); let node=root;
  for (const name of parts) { const child=new THREE.Bone();child.name=name;node.add(child);node=child; }
  return {root, head:node};
}
function resolve(p=packet,r=rig(),m=meshBinding) {
  assert.equal(typeof controller.resolveNativeAngelRingReference,'function','native controller module required');
  return controller.resolveNativeAngelRingReference(r.root,p,m);
}
function productionFiles() {
  const source = read('src/viewer/character.ts');
  const match = /import\.meta\.glob\((\[[\s\S]*?\]),\s*\{/.exec(source); assert.ok(match);
  const patterns=Function(`return ${match[1]}`)(); const matches=picomatch(patterns);
  const names=new Set(fs.readdirSync(path.join(sourceRoot,modelDir)));
  for(const role of plan.candidateRoles) if(path.posix.dirname(role)===modelDir && fs.existsSync(location(role))) names.add(path.posix.basename(role));
  return Object.fromEntries([...names].map(name=>[`../../node_modules/magia-exedra-character-three/models/chara_101002_battle_unit/${name}`,location(`${modelDir}/${name}`)])
    .filter(([key])=>matches(key)));
}
function shader(material) {
  const s={ uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),defines:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(s,{}); return s;
}
// Execute the exact call expression in the actual native early-return branch,
// with the already loaded model. This catches dropped root forwarding.
function constructViaProductionCall(mesh,input,resourceLoader,root,cache=new Map()) {
  let call;
  function visit(node) {
    if(ts.isCallExpression(node) && node.expression.getText(loaderAst)==='createNativeMeshMaterials') call=node;
    ts.forEachChild(node,visit);
  }
  visit(loaderAst);assert.ok(call);
  return Function('createNativeMeshMaterials','mesh','materialInput','materialResourceLoader','modelObject','nativePerspectiveReferences','homePropInput',`return ${call.getText(loaderAst)}`)(exports.createNativeMeshMaterials,mesh,input,resourceLoader,root,cache,undefined);
}
async function withNativeHair(check, p=packet) {
  const scope=native.createNativeMaterialScope(p,expected);
  const input={scope,packet:p,textureUrls:Object.fromEntries(Object.entries(p.textures).map(([key,row])=>[key,path.join(sourceRoot,modelDir,row.png)]))};
  const {root,head}=rig(), mesh=new THREE.Mesh();mesh.geometry.userData.nativeMaterialChannelKey=meshBinding.key;root.add(mesh);
  // Only image decoding is adapted: the real resource loader still reads and
  // validates each exact source PNG signature, dimensions, PPtr, ST and cache.
  const original=THREE.TextureLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();
  let latePose=()=>{};mesh.onBeforeRender=()=>latePose();
  try {
    observedReferences.length=0;
    const result=await constructViaProductionCall(mesh,input,exports.createNativeSlotResourceLoader(input),root);
    await check({result,root,head,mesh,setLatePose:fn=>{latePose=fn;}});
  } finally { THREE.TextureLoader.prototype.loadAsync=original; }
}

test('native contract is exact delivered bytes and current admission glob includes it', async()=>{
  assert.equal(fs.existsSync(location(`${modelDir}/model-binding-contract.json`)),true,'delivered companion must be present');
  assert.deepEqual(fs.readFileSync(location(`${modelDir}/model-binding-contract.json`)),fs.readFileSync(contractAuthority));
  const input=await exports.loadNativeCharacterMaterialInput(productionFiles());
  assert.equal(input.scope.data.characterId,101002);
  assert.equal(input.channels.byteLength,7275024);
  assert.equal(Object.keys(input.cornerIndices).length,8);
});
test('production admission preserves exact failure for a missing contract', async()=>{
  const files=productionFiles();for(const key of Object.keys(files))if(key.endsWith('/model-binding-contract.json'))delete files[key];
  await assert.rejects(exports.loadNativeCharacterMaterialInput(files),/Exact native companion missing: model-binding-contract.json/);
});
test('carrier preserves all previous material/texture/mesh/unknown fields plus three raw controllers',()=>{
  const copy=structuredClone(packet);delete copy.controllerBindings;assert.deepEqual(copy,baselinePacket);
  assert.equal(packet.controllerBindings?.controllers.length,3);
  assert.equal(packet.controllerBindings.controllers.filter(c=>c.tree.IsCharacter===0).length,2);
  assert.equal(packet.controllerBindings.controllers[0].tree.headOffset,0.20000000298023224);
});
test('exact PPtr resolves Head path and source directions without character-ID dispatch',()=>{
  const r=rig(); const p=structuredClone(packet);p.characterId=765432;p.styleId=76543201;
  const result=resolve(p,r);assert.equal(result.diagnostic.status,'BOUND');assert.equal(result.reference.headBone,r.head);
  assert.deepEqual(result.reference.localForward.toArray(),[1,0,0]);assert.deepEqual(result.reference.localUp.toArray().map(v=>v||0),[0,1,0]);
  assert.equal(result.reference.headOffset,0.20000000298023224);
  assert.equal(result.reference.characterCancelPerspective,1);
  assert.equal(result.diagnostic.headTransformKey,`${meshBinding.sourceCab}:8344468830038724395`);
});
test('attachment parent controller resolves the same exact Head without substituting null local Head',()=>{
  const attachment=packet.controllerBindings?.controllers.find(c=>c.tree.IsCharacter===0);assert.ok(attachment);
  const binding={...meshBinding,rendererPathId:attachment.tree.reDriveToonRenderers[0].m_PathID};
  const result=resolve(packet,rig(),binding);assert.equal(result.diagnostic.status,'BOUND');
  assert.equal(result.diagnostic.controllerKey,`${meshBinding.sourceCab}:370666263696119599`);
});
test('old packet without carrier remains BLANK and creates no AngelRing reference',async()=>{
  const p=structuredClone(packet);delete p.controllerBindings;
  if (controller.resolveNativeAngelRingReference) assert.equal(resolve(p).diagnostic.status,'BLANK');
  await withNativeHair(({result})=>{
    assert.equal(result.slots.length,2); assert.deepEqual(observedReferences,[undefined,undefined]);
    for(const slot of result.slots){assert.ok(slot.unresolved.some(s=>s.includes('controller/head reference BLANK')));assert.equal(shader(slot.result.material).uniforms.uAngelRingFacePosition,undefined);}
  },p);
});
test('missing, ambiguous, external and unknown fields stay BLANK rather than guessing',()=>{
  const mutations=[
    p=>{p.controllerBindings.controllers=[];},
    p=>{p.controllerBindings.controllers.push(structuredClone(p.controllerBindings.controllers[0]));},
    p=>{p.controllerBindings.transforms=[];},
    p=>{p.controllerBindings.controllers[0].tree.headBoneTransform.m_FileID=1;},
    p=>{p.controllerBindings.controllers[0].tree.faceForwardDirection=99;},
    p=>{delete p.controllerBindings.controllers[0].tree.headOffset;},
    p=>{delete p.controllerBindings.controllers[0].tree.CharacterCancelPerspective;},
  ];
  for(const mutate of mutations){const p=structuredClone(packet);assert.ok(p.controllerBindings);mutate(p);assert.equal(resolve(p).diagnostic.status,'BLANK');}
  const r=rig();r.head.parent.add(r.head.clone());assert.equal(resolve(packet,r).diagnostic.status,'BLANK');
  assert.equal(resolve(packet,rig(),{...meshBinding,sourceCab:'other-cab'}).diagnostic.status,'BLANK');
});
test('actual native two-slot factory receives one shared source reference and exact native samplers',async()=>{
  await withNativeHair(({result,head})=>{
    assert.equal(observedReferences.length,2);assert.ok(observedReferences[0]);assert.equal(observedReferences[0],observedReferences[1]);assert.equal(observedReferences[0].headBone,head);
    assert.equal(result.controllerBinding.diagnostic.status,'BOUND');
    for(const slot of result.slots){
      assert.deepEqual(slot.unresolved,[]); const s=shader(slot.result.material);
      assert.equal(s.uniforms.tAngelRingMap.value,slot.resources.textures._AngelRingMap);
      assert.equal(s.uniforms.tAngelRingMap.value.userData.nativeTextureKey,slot.resources.bindings._AngelRingMap.key);
      const binding=slot.resources.bindings._AngelRingMap;
      assert.deepEqual([binding.scale.x,binding.scale.y,binding.offset.x,binding.offset.y],[1,1,0,0]);
      assert.match(s.fragmentShader,/texture2D\(\s*tAngelRingMap\s*,\s*rdAngelMapUv\s*\)/);
      assert.doesNotMatch(s.fragmentShader,/vec4 rdNativeSample_tAngelRingMap\(/);
      const nonIdentity={...slot.resources,bindings:{...slot.resources.bindings,_AngelRingMap:{...binding,scale:{x:2,y:3},offset:{x:.125,y:-.25}}}};
      native.applyNativeSlotShaderBindings(s,nonIdentity);
      assert.match(s.fragmentShader,/rdNativeSample_tAngelRingMap\(\s*rdAngelMapUv\s*\)/);
      assert.deepEqual(s.uniforms.rdNativeST_tAngelRingMap.value.toArray(),[2,3,.125,-.25]);
      assert.equal(slot.result.material.name,meshBinding.slots[slot.index].materialName);
      assert.equal(slot.result.material.userData.nativeMaterialKey,`${meshBinding.key}:slot:${slot.index}`);
      assert.equal(slot.result.material.userData.nativeControllerReference.status,'BOUND');
    }
  });
});
test('both compiled production shaders follow late pose translation/rotation on every draw',async()=>{
  await withNativeHair(({result,head,mesh,setLatePose})=>{
    const shaders=result.slots.map(s=>shader(s.result.material));
    let phase=0;setLatePose(()=>{phase++;head.position.set(phase,2*phase,3*phase);head.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),phase*Math.PI/6);});
    for(let i=1;i<=3;i++){
      mesh.onBeforeRender();assert.equal(phase,i);
      const q=head.getWorldQuaternion(new THREE.Quaternion()),up=new THREE.Vector3(0,1,0).applyQuaternion(q),forward=new THREE.Vector3(1,0,0).applyQuaternion(q);
      const position=head.getWorldPosition(new THREE.Vector3()).addScaledVector(up,0.20000000298023224);
      for(const s of shaders){
        assert.ok(s.uniforms.uAngelRingFacePosition,'shader must have source Head reference');
        assert.ok(s.uniforms.uRdCharacterFacePositionWS,'native perspective must follow the same late pose');
        assert.ok(s.uniforms.uRdCharacterFacePositionWS.value.distanceTo(position)<1e-12);
        assert.ok(s.uniforms.uAngelRingFacePosition.value.distanceTo(position)<1e-12);
        assert.ok(s.uniforms.uAngelRingFaceForward.value.distanceTo(forward)<1e-12);
        assert.ok(s.uniforms.uAngelRingFaceUp.value.distanceTo(up)<1e-12);
      }
    }
  });
});
test('existing sealed FBX parses read-only and resolves the exact authored Head path',async()=>{
  const {FBXLoader}=await import(pathToFileURL(path.join(sourceRoot,'node_modules/three/examples/jsm/loaders/FBXLoader.js')));
  const bytes=fs.readFileSync(path.join(sourceRoot,modelDir,'chara_101002.fbx'));
  const manager=new THREE.LoadingManager();
  manager.addHandler(/./, {path:'',setPath(value){this.path=value;return this;},load(){return new THREE.Texture();}});
  const root=new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const result=controller.resolveNativeAngelRingReference(root,packet,meshBinding);
  assert.equal(result.diagnostic.status,'BOUND',JSON.stringify(result.diagnostic));
  assert.equal(result.reference.headBone.name,'Head');assert.equal(result.reference.headBone.isBone,true);
  assert.equal(result.diagnostic.headPath,headPath);
});


test('native forward and depth carrier use the exact same resolved moving face anchor',async()=>{
  await withNativeHair(({result,mesh,head})=>{
    const ref=result.perspectiveReference;
    assert.ok(ref,'native perspective reference required');
    assert.equal(ref.headBone,head);
    assert.equal(mesh.userData.characterPerspectiveReference,ref);
    assert.equal(ref.characterCancelPerspective,1);
    for(const slot of result.slots){const s=shader(slot.result.material);
      assert.equal(s.uniforms.uRdCharacterFacePositionWS.value,ref.facePosition);
      assert.equal(s.uniforms.uRdCharacterCancelPerspective.value,1);
      assert.match(s.vertexShader,/rdPerspectiveCancelledXY/);
    }
  });
});
test('same native controller shares perspective across meshes, separate actors stay independent',async()=>{
  const scope=native.createNativeMaterialScope(packet,expected),input={scope,packet,textureUrls:Object.fromEntries(Object.entries(packet.textures).map(([key,row])=>[key,path.join(sourceRoot,modelDir,row.png)]))};
  const original=THREE.TextureLoader.prototype.loadAsync;THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();
  try{
    const r=rig(),cache=new Map(),load=exports.createNativeSlotResourceLoader(input);
    const create=async(root,map)=>{const m=new THREE.Mesh();m.geometry.userData.nativeMaterialChannelKey=meshBinding.key;root.add(m);return constructViaProductionCall(m,input,load,root,map);};
    const a=await create(r.root,cache),b=await create(r.root,cache),r2=rig(),c=await create(r2.root,new Map());
    assert.ok(a.perspectiveReference);
    assert.equal(a.perspectiveReference,b.perspectiveReference);
    assert.equal(cache.size,1);
    assert.notEqual(a.perspectiveReference,c.perspectiveReference);
    assert.notEqual(a.perspectiveReference.facePosition,c.perspectiveReference.facePosition);
  }finally{THREE.TextureLoader.prototype.loadAsync=original;}
});
test('missing native controller creates neither a guessed perspective anchor nor perspective shader',async()=>{
  const p=structuredClone(packet);delete p.controllerBindings;
  await withNativeHair(({result,mesh})=>{
    assert.equal(result.perspectiveReference,undefined);
    assert.equal(mesh.userData.characterPerspectiveReference,undefined);
    for(const slot of result.slots)assert.equal(shader(slot.result.material).uniforms.uRdCharacterFacePositionWS,undefined);
  },p);
});
test('serialized zero cancel factor is preserved instead of promoted to one',async()=>{
  const p=structuredClone(packet);for(const c of p.controllerBindings.controllers)c.tree.CharacterCancelPerspective=0;
  await withNativeHair(({result})=>{
    assert.ok(result.perspectiveReference);
    assert.equal(result.perspectiveReference.characterCancelPerspective,0);
    for(const slot of result.slots)assert.equal(shader(slot.result.material).uniforms.uRdCharacterCancelPerspective.value,0);
  },p);
});

const outlineRuntime = compile(read(`${moduleDir}/shaders/outline.ts`), 'outline.ts', {three:THREE,'./stylization':stylization,'../bakedNormal':{ReDriveBakedNormalAttribute:'reDriveBakedNormal'}});
const cameraDepthRuntime = compile(read(`${moduleDir}/scene/cameraDepth.ts`), 'cameraDepth.ts', {three:THREE,'../shaders/userdata':userdata,'../shaders/perspective':perspective,'../shaders/depthRim':depthRim});
const stencilRuntime = compile(read(`${moduleDir}/officialStencilRuntime.ts`), 'officialStencilRuntime.ts', {three:THREE,'./shaders/userdata':userdata});
test('production outline call and actual CameraDepth wrapper bind the native forward anchor',async()=>{
  await withNativeHair(({result,mesh,head})=>{
    mesh.material=[...result.materials.values()];
    mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(18),3));
    mesh.geometry.addGroup(0,3,0);mesh.geometry.addGroup(3,3,1);
    let call;
    const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(loaderAst)==='addOfficialOutlineGroupsToMesh'&&node.getText(loaderAst).includes('exact.profiles'))call=node;ts.forEachChild(node,visit);};visit(loaderAst);assert.ok(call);
    const outlines=Function('addOfficialOutlineGroupsToMesh','mesh','exact','isOfficialOutlineExtrusionEnabled','THREE',`return ${call.getText(loaderAst)}`)(outlineRuntime.addOfficialOutlineGroupsToMesh,mesh,result,stencilRuntime.isOfficialOutlineExtrusionEnabled,THREE);
    assert.ok(outlines.length>0,'real native hair outlines required');
    const ref=result.perspectiveReference;assert.ok(ref);
    const ctl=new cameraDepthRuntime.ReDriveCameraDepthController({stageCharacterShadows:{root:new THREE.Group()}});
    const assignment=ctl.createDepthMaterialAssignment(mesh,new Set()),compiled=[];
    for(const material of Array.isArray(assignment)?assignment:[assignment]){
      const s={vertexShader:THREE.ShaderLib.depth.vertexShader,fragmentShader:THREE.ShaderLib.depth.fragmentShader,uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.depth.uniforms)};
      material.onBeforeCompile(s,{});compiled.push(s);
      assert.equal(s.uniforms.uRdCharacterFacePositionWS.value,ref.facePosition);
      assert.equal(s.uniforms.uRdCharacterCancelPerspective.value,ref.characterCancelPerspective);
    }
    for(const m of outlines){assert.equal(m.material.uniforms.uRdCharacterFacePositionWS.value,ref.facePosition);assert.equal(m.material.uniforms.uRdCharacterCancelPerspective.value,1);}
    head.position.set(.3,1.1,-.6);head.rotation.set(.2,.5,.7);ref.update();
    for(const s of compiled)assert.equal(s.uniforms.uRdCharacterFacePositionWS.value,ref.facePosition);
    assert.ok(ref.facePosition.length()>0);
  });
});
test('source early-return native path registers a frame update once per shared controller',()=>{
  let nativeBranch;
  const visit=node=>{if(ts.isIfStatement(node)&&node.expression.getText(loaderAst)==='materialInput && materialResourceLoader')nativeBranch=node.thenStatement;ts.forEachChild(node,visit);};visit(loaderAst);assert.ok(nativeBranch);
  const statement=nativeBranch.statements.find(node=>ts.isIfStatement(node)&&node.expression.getText(loaderAst).includes('animationLoops.includes'));assert.ok(statement,'frame update registration required');
  let count=0;const exact={perspectiveReference:{update:()=>count++}},userData={animationLoops:[]};
  const register=Function('exact','userData',statement.getText(loaderAst));register(exact,userData);register(exact,userData);
  assert.equal(userData.animationLoops.length,1);userData.animationLoops[0]();assert.equal(count,1);
  register({perspectiveReference:undefined},userData);assert.equal(userData.animationLoops.length,1);
});
test('common profile factory retains authored Head position axes offset and zero multiplier',()=>{
  const r=rig(),p={headBoneName:'Head',faceUpAxis:'y',faceForwardAxis:'-x',headOffset:.2,characterCancelPerspective:0};
  const ref=profile.createCharacterPerspectiveReference(r.root,p);assert.ok(ref);
  for(let i=0;i<24;i++){
    r.root.position.set(i*.01,-i*.02,i*.03);r.root.rotation.set(i*.07,i*.02,-i*.01);
    r.head.position.set(i*.02,.9,-i*.01);r.head.rotation.set(i*.1,-i*.05,i*.03);ref.update();
    const up=new THREE.Vector3(0,1,0).applyQuaternion(r.head.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const expected=r.head.getWorldPosition(new THREE.Vector3()).addScaledVector(up,.2);
    assert.ok(ref.facePosition.distanceTo(expected)<1e-12);assert.equal(ref.characterCancelPerspective,0);
  }
});
