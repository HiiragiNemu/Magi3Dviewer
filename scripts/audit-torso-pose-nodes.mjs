import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {createHash} from 'node:crypto'
import * as T from 'three'
import {FBXLoader} from 'three/examples/jsm/loaders/FBXLoader.js'
import {poseBones} from '../src/viewer/directPoseTools.ts'

// Offline evidence: compare the real bone hierarchy and skinned vertices after
// the same WORLD-space rotation. No model/texture/action files are written.
const output=path.resolve(process.env.MAGIUS_TORSO_AUDIT_OUT||'artifacts/front-node-layout/torso-audit.json')
fs.mkdirSync(path.dirname(output),{recursive:true})
const models='magia-exedra-character-three/models'
const requested=process.argv.slice(2)
const files=fs.readdirSync(models,{withFileTypes:true}).filter(d=>d.isDirectory()&&(!requested.length||requested.some(id=>d.name.includes(id))))
const original=T.TextureLoader.prototype.load
T.TextureLoader.prototype.load=()=>new T.Texture()
const rows=[]
const under=(b,root)=>{for(let n=b;n;n=n.parent)if(n===root)return true;return false}
try {
 for(const entry of files){
  const dir=path.join(models,entry.name),file=fs.readdirSync(dir).find(f=>/\.fbx(?:\.gz)?$/i.test(f))
  if(!file)continue
  let bytes=fs.readFileSync(path.join(dir,file));const sourceFile=path.join(dir,file).replaceAll('\\','/'),sourceSha256=createHash('sha256').update(bytes).digest('hex');if(file.endsWith('.gz'))bytes=zlib.gunzipSync(bytes)
  const actor=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
  actor.updateMatrixWorld(true)
  const bones=poseBones(actor),byName=n=>bones.find(b=>b.name===n),spine=byName('Spine'),waist=byName('Waist'),hip=byName('Hip')
  if(!spine||!waist){rows.push({model:entry.name,sourceFile,sourceSha256,spine:!!spine,waist:!!waist});continue}
  const meshes=[];actor.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n)})
  const node=n=>({name:n.name,parent:n.parent?.name,local:n.position.toArray(),world:n.getWorldPosition(new T.Vector3()).toArray(),quaternion:n.quaternion.toArray(),children:n.children.map(c=>c.name)})
  let vertexCount=0,spineVertices=0,waistVertices=0,distinctInfluences=0,maxWeightDifference=0
  const relevant=[]
  for(const mesh of meshes){const indices=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');if(!indices||!weights)continue
   const sm=mesh.skeleton.bones.map(b=>under(b,spine)),wm=mesh.skeleton.bones.map(b=>under(b,waist))
   for(let i=0;i<weights.count;i++){let sw=0,ww=0;for(let j=0;j<4;j++){const ix=indices.array[i*4+j],w=weights.array[i*4+j];if(sm[ix])sw+=w;if(wm[ix])ww+=w}
    vertexCount++;if(sw>1e-6)spineVertices++;if(ww>1e-6)waistVertices++;const d=Math.abs(sw-ww);if(d>1e-6)distinctInfluences++;maxWeightDifference=Math.max(d,maxWeightDifference)
    if(sw>1e-6||ww>1e-6)relevant.push({mesh,i})
   }
  }
  const positions=()=>{actor.updateMatrixWorld(true);for(const mesh of meshes)mesh.skeleton.update();const out=new Float64Array(relevant.length*3),v=new T.Vector3();for(let k=0;k<relevant.length;k++){const {mesh,i}=relevant[k];mesh.getVertexPosition(i,v).applyMatrix4(mesh.matrixWorld);v.toArray(out,k*3)}return out}
  const originals=new Map();actor.traverse(n=>originals.set(n,n.quaternion.clone()))
  const restore=()=>{for(const [n,q]of originals)n.quaternion.copy(q);actor.updateMatrixWorld(true)}
  const rotate=(bone,axis)=>{restore();const p=bone.parent.getWorldQuaternion(new T.Quaternion()),q=new T.Quaternion().setFromAxisAngle(axis,Math.PI/12);bone.quaternion.premultiply(p.clone().invert().multiply(q).multiply(p));return positions()}
  const comparisons=[]
  for(const [axis,v]of [['pitch',new T.Vector3(1,0,0)],['yaw',new T.Vector3(0,1,0)],['roll',new T.Vector3(0,0,1)]]){
   const a=rotate(spine,v),b=rotate(waist,v);let max=0,sum=0;for(let k=0;k<a.length;k+=3){const d=Math.hypot(a[k]-b[k],a[k+1]-b[k+1],a[k+2]-b[k+2]);max=Math.max(d,max);sum+=d*d}comparisons.push({axis,maxWorldDifference:max,rmsWorldDifference:Math.sqrt(sum/relevant.length)})
  }
  restore();const sp=node(spine),wa=node(waist)
  rows.push({model:entry.name,sourceFile,sourceSha256,spine:sp,waist:wa,hip:hip&&node(hip),spineAncestorOfWaist:under(waist,spine),vertexCount,spineVertices,waistVertices,distinctInfluences,maxWeightDifference,pivotDistance:new T.Vector3().fromArray(sp.world).distanceTo(new T.Vector3().fromArray(wa.world)),comparisons,armLeft:byName('Arm_L')&&node(byName('Arm_L')),armRight:byName('Arm_R')&&node(byName('Arm_R'))})
  console.log(entry.name,'pivot',rows.at(-1).pivotDistance,'different weights',distinctInfluences,'max rotated vertex delta',Math.max(...comparisons.map(c=>c.maxWorldDifference)))
  for(const m of meshes)m.geometry.dispose()
 }
} finally {T.TextureLoader.prototype.load=original}
fs.writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),method:'real FBX hierarchy + descendant skin weights + independent 15 degree world rotation, no asset writes',rows},null,2))
console.log('report',output)
