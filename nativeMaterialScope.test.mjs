import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from './node_modules/typescript/lib/typescript.js';
import Module from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const repo = path.resolve('.');
const packetPath = 'C:/Users/proje/Documents/Codex/2026-09-02/steam-exedra-runtime-capture-lab-20260902/outputs/20260905-101002-runtime-material-channel-package-v1/candidate/runtime-material-channel.json';
const scopePath = path.join(repo, 'magia-exedra-character-three', 'nativeMaterialScope.ts');
const loaderPath = path.join(repo, 'magia-exedra-character-three', 'loader.ts');

function loadScopeModule() {
  const source = fs.readFileSync(scopePath, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = new Module(scopePath.replace(/\.ts$/, '.cjs'), null);
  mod.filename = scopePath.replace(/\.ts$/, '.cjs');
  mod.paths = Module._nodeModulePaths(repo);
  mod._compile(js, mod.filename);
  return mod.exports;
}

function loadChannelsModule() {
  const temp = path.join(repo, 'artifacts', 'verification', '20260906-s6-native-material-behavioral-consumer', 'temp');
  mkdirSync(temp, { recursive: true });
  const scopeJs = ts.transpileModule(fs.readFileSync(scopePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const channelsPath = path.join(repo, 'magia-exedra-character-three', 'nativeMaterialChannels.ts');
  const channelsJs = ts.transpileModule(fs.readFileSync(channelsPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  writeFileSync(path.join(temp, 'nativeMaterialScope.js'), scopeJs);
  writeFileSync(path.join(temp, 'package.json'), '{"type":"commonjs"}');
  writeFileSync(path.join(temp, 'bakedNormal.js'), `exports.parseReDriveBakedNormals=()=>({characterId:7,meshes:new Map([['Tiny_Mesh',new Float32Array([0,0,1,0,0,1,0,0,1])]])});exports.selectReDriveBakedNormalValues=()=>({source:'official-path',values:new Float32Array([0,0,1,0,0,1,0,0,1])});exports.restoreReDriveBakedNormalAttribute=(g,v)=>g.setAttribute('reDriveBakedNormal',{array:v,itemSize:3,count:3});`);
  writeFileSync(path.join(temp, 'nativeMaterialChannels.js'), channelsJs);
  const mod = new Module(path.join(temp, 'nativeMaterialChannels.js'), null);
  mod.filename = path.join(temp, 'nativeMaterialChannels.js');
  mod.paths = Module._nodeModulePaths(repo);
  mod._compile(channelsJs, mod.filename);
  return mod.exports;
}

function tinyPacket() {
  const materialKey = 'CAB-tiny:1', meshKey = 'CAB-tiny:2:renderer:3';
  const blank = [
    { profilePath: 'outlineOffset', sourceProperty: '_OutlineOffset', status: 'BLANK', reason: 'absent' },
    { profilePath: 'skinOutlineOffset', sourceProperty: '_OutlineOffsetSkin', status: 'BLANK', reason: 'absent' },
    { profilePath: 'gem.fresnelThreshold', sourceProperty: '_GemFresnelThreshold', status: 'BLANK', reason: 'absent' },
    { profilePath: 'gem.fresnelFeather', sourceProperty: '_GemFresnelFeather', status: 'BLANK', reason: 'absent' },
    { profilePath: 'gem.fresnelMaskByMetallic', sourceProperty: '_GemFresnelMaskByMetallic', status: 'BLANK', reason: 'absent' },
  ];
  const material = { identity: { cab: 'CAB-tiny', pathId: '1', name: 'Tiny_Material' }, shader: { status: 'RESOLVED', type: 'Shader', name: 'Creative/Character/ReDriveToon', targetCab: 'CAB-shader', pathId: '9' }, profile: { outlineOffset: null, skinOutlineOffset: null, gem: { fresnelThreshold: null, fresnelFeather: null, fresnelMaskByMetallic: null } }, typedBlanks: blank, native: { cab: 'CAB-tiny', pathId: '1', name: 'Tiny_Material', savedFloats: [], savedInts: [], savedColors: [], textureEnvs: [] } };
  const channel = (semantic, sourceChannelIndex, attribute, componentCount = 2, offset = (sourceChannelIndex === 4 ? 0 : 24)) => ({ semantic, sourceChannelIndex, serialized: { stream: 0, offset: 0, format: 0, dimension: componentCount }, componentCount, attribute, data: { offset, byteLength: 3 * componentCount * 4, count: 3, itemSize: componentCount } });
  const mesh = { key: meshKey, sourceCab: 'CAB-tiny', meshPathId: '2', rendererPathId: '3', path: 'Tiny_Mesh', name: 'Tiny_Mesh', sourceVertexCount: 3, expandedVertexCount: 3, slots: [{ index: 0, start: 0, count: 3, materialKey, materialName: 'Tiny_Material', shaderKey: 'CAB-shader:9' }], channels: [channel('COLOR0', 3, 'reDriveNativeColor', 4, 120), channel('TEXCOORD0', 4, 'reDriveTexcoord0'), channel('TEXCOORD3', 7, 'reDriveTexcoord3')], fbxUvAliases: [{ attribute: 'uv', sourceSemantic: 'TEXCOORD0', components: [0, 1], vTransform: 'identity' }, { attribute: 'uv1', sourceSemantic: 'TEXCOORD3', components: [0, 1], vTransform: 'identity' }], positions: { offset: 48, byteLength: 36, count: 3, itemSize: 3 }, bakedNormal: { offset: 84, byteLength: 36, count: 3, itemSize: 3 }, sourceCornerIndices: 'tiny.bin' };
  const packet = { schema: 'magius.native-material-channel.v1', characterId: 7, styleId: 70, sourceCommit: 'tiny', serializedPlatform: 13, serializedFormat: 22, unityVersion: null, versionStatus: 'SANITIZED_NO_INHERITANCE', meshes: [mesh], materials: { [materialKey]: material }, textures: {}, channelFile: 'channels.bin', bakedNormalFile: 'bn.bin' };
  const expected = { ...packet, meshBindings: [((({ positions, bakedNormal, sourceCornerIndices, ...binding }) => binding)(mesh))] };
  return { packet, expected, mesh, channels: new Float32Array([...Array(3).fill(0).flatMap(() => [0, 0]), ...Array(3).fill(0).flatMap(() => [0, 0]), ...[0, 0, 0, 1, 0, 0, 0, 1, 0], ...[0, 0, 1, 0, 0, 1, 0, 0, 1], ...Array(3).fill(0).flatMap(() => [1, 1, 1, 1])]).buffer, corners: new Uint32Array([0, 1, 2]).buffer, baked: new ArrayBuffer(0) };
}

test('native scope uses exact composite identities and preserves typed BLANKs', () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const expected = { ...packet, meshBindings: packet.meshes.map(({ positions, bakedNormal, sourceCornerIndices, coordinateMapping, ...binding }) => binding) };
  const { createNativeMaterialScope, nativeSlotShaderProfile } = loadScopeModule();
  const scope = createNativeMaterialScope(packet, expected);
  assert.equal(scope.data.schema, 'magius.native-material-channel.v1');
  const hair = packet.meshes.find((mesh) => mesh.name === 'Hair_Mesh');
  assert.ok(hair, 'Hair_Mesh fixture exists');
  const hairSlot = hair.slots.find((slot) => scope.materialForSlot(hair.key, slot.index).profile.angelRing?.isHair === true);
  assert.ok(hairSlot, 'exact native hair slot exists');
  const texture = scope.textureForProperty(hair.key, hairSlot.index, '_AngelRingMap');
  assert.equal(texture.status, 'RESOLVED');
  assert.ok(texture.texture?.identity.pathId);
  const profile = nativeSlotShaderProfile(scope, hair.key, hairSlot.index);
  assert.equal(profile.outlineOffset, undefined);
  assert.equal(profile.gem.fresnelThreshold, undefined);
  assert.throws(() => createNativeMaterialScope(packet, { ...expected, sourceCommit: 'mismatch' }), /identity mismatch/);
});

test('loader exposes native producer path without global profile fallback', () => {
  const source = fs.readFileSync(loaderPath, 'utf8');
  assert.match(source, /loadNativeCharacterMaterialInput/);
  assert.match(source, /createNativeMeshMaterials/);
  assert.match(source, /prepareNativeMaterialChannels/);
  assert.match(source, /nativeMaterialConstruction/);
});

test('native TexEnv ST injection and channel preflight/apply are bounded', async () => {
  const { applyNativeSlotShaderBindings } = loadScopeModule();
  const shader = { vertexShader: '', fragmentShader: 'vec4 c=texture2D(tAngelRingMap, vUv); void main(){}', uniforms: {} };
  applyNativeSlotShaderBindings(shader, { bindings: { _AngelRingMap: { scale: { x: 2, y: 3, }, offset: { x: .1, y: .2 }, texture: {}, status: 'RESOLVED', property: '_AngelRingMap', key: 'k' } }, textures: { _AngelRingMap: {} }, unknowns: [] });
  assert.equal(shader.uniforms.rdNativeST_tAngelRingMap.value.z, .1);
  assert.match(shader.fragmentShader, /rdNativeSample_tAngelRingMap/);

  const { prepareNativeMaterialChannels } = loadChannelsModule();
  const { packet, expected, mesh, channels, corners, baked } = tinyPacket();
  const THREE = await import('three');
  const root = new THREE.Object3D();
  const object = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ name: 'Tiny_Material' }));
  object.name = 'Tiny_Mesh';
  object.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0]), 3));
  object.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0,0,1,0,0,1,0,0,1]), 3));
  object.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1,1,1,1,1,1,1,1,1,1,1,1]), 4));
  object.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0,0,0,0,0,0]), 2));
  object.geometry.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array([0,0,0,0,0,0]), 2));
  object.geometry.addGroup(0, 3, 0); root.add(object);
  const tx = prepareNativeMaterialChannels({ root, packet, expected, channels, cornerIndices: { 'tiny.bin': corners }, bakedNormalBuffer: baked });
  assert.equal(tx.meshCount, 1); assert.equal(tx.apply().status, 'BOUND');
  assert.equal(object.geometry.userData.nativeMaterialChannelKey, mesh.key);
  assert.throws(() => tx.apply(), /already applied/);
});

test('model scopes stay isolated and loader late-abort cleanup remains wired', () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  const expected = { ...packet, meshBindings: packet.meshes.map(({ positions, bakedNormal, sourceCornerIndices, coordinateMapping, ...binding }) => binding) };
  const { createNativeMaterialScope } = loadScopeModule();
  const first = createNativeMaterialScope(packet, expected);
  const second = createNativeMaterialScope(packet, expected);
  assert.notEqual(first.data, second.data);
  assert.notEqual(first.data.meshes, second.data.meshes);
  assert.equal(first.data.characterId, second.data.characterId);
  const loader = fs.readFileSync(loaderPath, 'utf8');
  assert.match(loader, /throwIfCharacterLoadAborted\(signal, 'texture-material'/);
  assert.match(loader, /transactionTextures\.forEach\(texture => texture\.dispose\(\)\)/);
  assert.match(loader, /character\.dispose\(\)/);
  assert.match(loader, /releaseTextureContext\(\)/);
});
