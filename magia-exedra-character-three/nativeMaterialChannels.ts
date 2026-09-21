import * as THREE from 'three';
import * as bakedNormal from './bakedNormal';
import { createNativeMaterialScope, nativeMeshBinding, type NativeMaterialPacket, type NativeMeshPacket, type NativeModelBindingContract, type NativeChannelRange } from './nativeMaterialScope';
function fail(message: string): never { throw new Error(message); }
const equal = (a: Float32Array,b: ArrayLike<number>,epsilon=0) => a.length === b.length && a.every((v,i)=>Number.isFinite(v) && Number.isFinite(b[i]) && Math.abs(v-b[i]) <= epsilon);
function objectPath(object: THREE.Object3D,root: THREE.Object3D) {
  const parts=[];
  for(let node: THREE.Object3D | null=object;node;node=node.parent){if(node.name)parts.push(node.name);if(node===root)break;}
  return parts.reverse().join('/');
}
/** Caller provides bytes and the existing Three/baked-normal/color consumers.
 * This seam does not fetch, infer a texture from a name, or construct a fallback
 * profile. All checks finish before the first scene-object mutation.
 */
export function prepareNativeMaterialChannels({root,packet,expected,channels,cornerIndices,bakedNormalBuffer}: {
 root: THREE.Object3D; packet: NativeMaterialPacket; expected: NativeModelBindingContract;
 channels: ArrayBuffer; cornerIndices: Record<string, ArrayBuffer>; bakedNormalBuffer: ArrayBuffer;
}) {
  const scope = createNativeMaterialScope(packet,expected);
  const data=scope.data;
  const bindings=data.meshes.map(nativeMeshBinding);
  if(JSON.stringify(bindings)!==JSON.stringify(expected.meshBindings))fail('Sealed mesh/slot/channel contract drift');
  const buffer = channels;
  const read = (range: NativeChannelRange,itemSize: number,count: number) => {
    if (!range || range.itemSize!==itemSize || range.count!==count || range.byteLength!==count*itemSize*4 || !Number.isSafeInteger(range.offset) || range.offset<0 || range.offset%4 || range.offset+range.byteLength>buffer.byteLength) fail('Channel range/count/dimension mismatch');
    const values=new Float32Array(buffer.slice(range.offset,range.offset+range.byteLength));
    if(values.some(v=>!Number.isFinite(v)))fail('Non-finite channel value');
    return values;
  };
  const actual = new Map<string, THREE.Mesh>();
  root.traverse(node=>{const object=node as THREE.Mesh;if(object.isMesh){const path=objectPath(object,root);if(actual.has(path))fail('Ambiguous FBX object path');actual.set(path,object);}});
  if(actual.size!==data.meshes.length)fail('Mesh denominator mismatch');
  const bn=bakedNormal.parseReDriveBakedNormals(bakedNormalBuffer);
  if(bn.characterId!==data.characterId || bn.meshes.size!==data.meshes.length)fail('Baked-normal identity/denominator mismatch');
  const staged: {mesh:NativeMeshPacket;object:THREE.Mesh;g:THREE.BufferGeometry;attrs:Map<string,{values:Float32Array;size:number}>;indices:Uint32Array;selection:bakedNormal.ReDriveBakedNormalSelection;color:THREE.BufferAttribute}[]=[];const paths=new Set();
  for(const mesh of data.meshes){
    if(paths.has(mesh.path))fail('Duplicate source mesh path');paths.add(mesh.path);
    const object=actual.get(mesh.path),n=mesh.expandedVertexCount;
    if(!object)fail('Exact expanded FBX mesh/path missing');
    const g=object.geometry;
    if(object.name!==mesh.name || g.index!==null)fail('Exact expanded FBX mesh/path missing');
    if(g.userData.nativeMaterialChannelKey)fail('Already applied native channel scope');
    const positions=read(mesh.positions,3,n);
    if(g.getAttribute('position')?.itemSize!==3 || !equal(positions,g.getAttribute('position').array))fail('Vertex/corner order or positions drift');
    const materials=Array.isArray(object.material)?object.material:[object.material];
    if(materials.length!==mesh.slots.length)fail('Material slot count drift');
    let cursor=0;
    for(const [i,slot] of mesh.slots.entries()){
      scope.materialForSlot(mesh.key,i);
      if(slot.index!==i || slot.start!==cursor || !Number.isSafeInteger(slot.count) || slot.count<=0 || slot.count%3 || materials[i]?.name!==slot.materialName)fail('Material slot order/range drift');
      cursor+=slot.count;
    }
    if(cursor!==n)fail('Submesh corner coverage mismatch');
    if(g.groups.length && JSON.stringify(g.groups)!==JSON.stringify(mesh.slots.map(s=>({start:s.start,count:s.count,materialIndex:s.index}))))fail('Existing submesh groups drift');
    const ci=cornerIndices[mesh.sourceCornerIndices];
    if(!ci || ci.byteLength!==n*4)fail('Source corner denominator mismatch');
    const ciBuffer=ci;
    const indices=new Uint32Array(ciBuffer);
    if(indices.some(i=>i>=mesh.sourceVertexCount))fail('Source vertex index out of range');
    const attrs=new Map<string,{values:Float32Array;size:number}>(),semantics=new Map<string,{values:Float32Array;size:number}>();
    for(const channel of mesh.channels){
      const size=channel.componentCount;
      if(size<1 || size>4 || size!==(channel.serialized.dimension&15) || attrs.has(channel.attribute) || semantics.has(channel.semantic))fail('Channel dimension/identity drift');
      const expectedSemantic=channel.sourceChannelIndex===3?'COLOR0':channel.sourceChannelIndex===2?'TANGENT0':`TEXCOORD${channel.sourceChannelIndex-4}`;
      const expectedAttribute=channel.sourceChannelIndex===3?'reDriveNativeColor':channel.sourceChannelIndex===2?'reDriveNativeTangentUnity':`reDriveTexcoord${channel.sourceChannelIndex-4}`;
      if(channel.semantic!==expectedSemantic || channel.attribute!==expectedAttribute)fail('Channel semantic mapping drift');
      if(g.hasAttribute(channel.attribute))fail('Existing extra-channel attribute');
      const values=read(channel.data,size,n);
      attrs.set(channel.attribute,{values,size});semantics.set(channel.semantic,{values,size});
    }
    if(JSON.stringify(mesh.fbxUvAliases)!==JSON.stringify([{attribute:'uv',sourceSemantic:'TEXCOORD0',components:[0,1],vTransform:'identity'},{attribute:'uv1',sourceSemantic:'TEXCOORD3',components:[0,1],vTransform:'identity'}]))fail('UV convention drift');
    for(const alias of mesh.fbxUvAliases){
      const source=semantics.get(alias.sourceSemantic),uv=g.getAttribute(alias.attribute);
      if(!source || !uv || uv.itemSize!==2 || uv.count!==n)fail('UV alias dimension drift');
      for(let v=0;v<n;v++)for(let lane=0;lane<2;lane++)if(uv.array[v*2+lane]!==source.values[v*source.size+lane])fail('UV component/order/convention drift');
    }
    const selection=bakedNormal.selectReDriveBakedNormalValues(bn,mesh.name,mesh.path,n);
    if(selection.source!=='official-path' || !selection.values || !equal(selection.values,read(mesh.bakedNormal,3,n)))fail('Exact baked-normal path/value mismatch');
    if(g.hasAttribute('reDriveBakedNormal') || g.getAttribute('normal')?.itemSize!==3 || g.getAttribute('normal').count!==n)fail('Existing baked-normal or normal count drift');
    const color=semantics.get('COLOR0');
    if(!color || color.size!==4 || g.getAttribute('color')?.count!==n)fail('Native color shape mismatch');
    // Bind exact retained numeric COLOR0, not another inverse conversion.
    // RGB feeds the current shader; all four lanes remain in the extra attribute.
    const rawRgb=new Float32Array(n*3);
    for(let v=0;v<n;v++)for(let lane=0;lane<3;lane++)rawRgb[v*3+lane]=color.values[v*4+lane];
    staged.push({mesh,object,g,attrs,indices,selection,color:new THREE.BufferAttribute(rawRgb,3)});
  }
  let applied=false;
  return Object.freeze({scope,meshCount:staged.length,slotCount:staged.reduce((n,s)=>n+s.mesh.slots.length,0),apply(){
    if(applied)fail('Native channel transaction already applied');
    // The caller must apply synchronously while retaining this exact model.
    for(const {mesh,object,g,attrs,indices,selection,color} of staged){
      for(const [name,a] of attrs)g.setAttribute(name,new THREE.BufferAttribute(a.values,a.size));
      g.setAttribute('reDriveSourceVertexIndex',new THREE.BufferAttribute(indices,1));
      g.setAttribute('color',color);g.userData.reDriveVertexColorSpace='raw';
      bakedNormal.restoreReDriveBakedNormalAttribute(g,selection.values);
      g.clearGroups();for(const s of mesh.slots)g.addGroup(s.start,s.count,s.index);
      g.userData.nativeMaterialChannelKey=mesh.key;
      object.userData.nativeMaterialSlots=mesh.slots.map(s=>({index:s.index,materialKey:s.materialKey,shaderKey:s.shaderKey,typedBlanks:scope.materialForSlot(mesh.key,s.index).typedBlanks}));
    }
    applied=true;
    return {status:'BOUND',meshes:staged.length,slots:this.slotCount,renderParity:'NOT_CLAIMED'};
  }});
}
