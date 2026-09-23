import * as THREE from 'three';
import * as F from './field.mjs';


const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const projected=m=>{const a=m?.userData?.officialMaterialProfile?.angelRing;return !!(a?.isHair&&a.enabled&&!a.uvMode&&a.map==='common');};
const materialsOf=m=>Array.isArray(m.material)?m.material:[m.material];
function selected(scene){
 const character=scene.characterSelected?.character;
 if(!character||!Number.isInteger(Number(character.userData?.characterId)))throw Error('SELECT_LOADED_CHARACTER');
 return character;
}
function targets(character){
 const meshes=[],materials=new Map(),originalHair=[];
 character.object.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
  const mm=materialsOf(mesh).filter(projected);if(!mm.length)return;
  meshes.push(mesh);mm.forEach(m=>materials.set(m.uuid,m));
  // Selector clones have groups=[] and drawRange, not material-group arrays.
  // They ARE patched above; only duplicate geometry is omitted from CPU depth.
  if(!mesh.userData.officialStencilRole&&!/outline/i.test(mesh.name))originalHair.push(mesh);
 });
 if(!originalHair.length||!materials.size)throw Error('NO_PROJECTED_COMMON_HAIR');
 return {meshes,materials:[...materials.values()],originalHair};
}
function liveProjection(scene,t,drawMaterial){
 const material=drawMaterial??t.materials.find(m=>m.userData?.shader?.uniforms?.uAngelRingFacePosition),shader=material?.userData?.shader;
 if(!shader)throw Error('WAIT_FOR_EXISTING_HAIR_SHADER_DRAW');const u=shader.uniforms;
 const number=k=>{if(!Number.isFinite(u[k]?.value))throw Error(`MISSING_LIVE_UNIFORM:${k}`);return u[k].value;};
 const vec=k=>{const a=u[k]?.value;if(!a?.isVector3)throw Error(`MISSING_LIVE_UNIFORM:${k}`);return a.clone();};
 const face=vec('uAngelRingFacePosition'),up=vec('uAngelRingFaceUp').normalize(),forward=vec('uAngelRingFaceForward').normalize(),right=new THREE.Vector3().crossVectors(up,forward).normalize(),cancelFace=vec('uRdCharacterFacePositionWS');
 // Mirror the actual vertex path: late pose edits can leave its cancel origin distinct.
 const delta=cancelFace.clone().sub(face),cancelDelta=[delta.dot(right),delta.dot(up),delta.dot(forward)];
 if(Math.abs(up.dot(forward))>1e-6)throw Error('LIVE_HEAD_FRAME_NOT_ORTHONORMAL');
 scene.camera.updateMatrixWorld(true);const faceViewZ=Math.abs(cancelFace.clone().applyMatrix4(scene.camera.matrixWorldInverse).z);if(faceViewZ<1e-12)throw Error('FACE_ON_EYE_PLANE');
 const size=scene.renderer.getDrawingBufferSize(new THREE.Vector2());
 return {cancelDelta,cancelFace:cancelFace.toArray(),face:face.toArray(),up:up.toArray(),forward:forward.toArray(),right:right.toArray(),view:scene.camera.matrixWorldInverse.toArray(),projection:scene.camera.projectionMatrix.toArray(),perspective:!!scene.camera.isPerspectiveCamera,cancel:number('uRdCharacterCancelPerspective')*number('uRdGlobalCharacterCancelPerspective'),faceViewZ,viewport:[size.x,size.y],referenceUniforms:u,texture: u.tAngelRingMap?.value,referenceMaterial:material.uuid};
}
function collectTriangles(character,t,p){
 character.object.updateMatrixWorld(true);const chunks=[],bounds=[Infinity,Infinity,-Infinity,-Infinity],world=new THREE.Vector3(),clip=new Float64Array(4);let vertices=0,triangles=0;
 for(const mesh of t.originalHair){
  if(mesh.isSkinnedMesh)mesh.skeleton.update();const g=mesh.geometry,pos=g.attributes.position,index=g.index,clips=new Float64Array(pos.count*4);
  for(let i=0;i<pos.count;i++){
   mesh.getVertexPosition(i,world).applyMatrix4(mesh.matrixWorld);const x=world.x-p.face[0],y=world.y-p.face[1],z=world.z-p.face[2];
   const qx=x*p.right[0]+y*p.right[1]+z*p.right[2],qy=x*p.up[0]+y*p.up[1]+z*p.up[2],qz=x*p.forward[0]+y*p.forward[1]+z*p.forward[2];
   F.project(qx,qy,qz,p,clip);clips.set(clip,i*4);if(clip[3]>0){bounds[0]=Math.min(bounds[0],clip[0]/clip[3]);bounds[1]=Math.min(bounds[1],clip[1]/clip[3]);bounds[2]=Math.max(bounds[2],clip[0]/clip[3]);bounds[3]=Math.max(bounds[3],clip[1]/clip[3]);}
  }
  const count=index?.count??pos.count,a=new Float64Array(Math.floor(count/3)*12);for(let i=0;i<a.length/4;i++){const id=index?index.getX(i):i;a.set(clips.subarray(id*4,id*4+4),i*4);}chunks.push(a);vertices+=pos.count;triangles+=a.length/12;
 }
 const packed=new Float64Array(chunks.reduce((n,a)=>n+a.length,0));let offset=0;for(const a of chunks){packed.set(a,offset);offset+=a.length;}
 return {packed,bounds,vertices,triangles,meshNames:t.originalHair.map(m=>m.name)};
}
function stamp(scene,t,p){
 const arrays=[{get:()=>scene.camera.matrixWorld.elements},{get:()=>scene.camera.projectionMatrix.elements}];
 const seen=new Set();for(const mesh of t.originalHair){arrays.push({get:()=>mesh.matrixWorld.elements});if(mesh.skeleton&&!seen.has(mesh.skeleton)){seen.add(mesh.skeleton);arrays.push({get:()=>mesh.skeleton.boneMatrices});}if(mesh.morphTargetInfluences)arrays.push({get:()=>mesh.morphTargetInfluences});}
 for(const key of ['uAngelRingFacePosition','uAngelRingFaceUp','uAngelRingFaceForward','uRdCharacterFacePositionWS'])arrays.push({get:(current=p)=>current.referenceUniforms[key].value.toArray()});
 arrays.push({get:(current=p)=>['uRdCharacterCancelPerspective','uRdGlobalCharacterCancelPerspective'].map(k=>current.referenceUniforms[k].value)});
 arrays.forEach(a=>a.copy=Float64Array.from(a.get()));return (current=p)=>arrays.every(a=>{const v=a.get(current);return v.length===a.copy.length&&a.copy.every((x,i)=>x===v[i]);});
}


export {selected,targets,liveProjection,collectTriangles,stamp};
