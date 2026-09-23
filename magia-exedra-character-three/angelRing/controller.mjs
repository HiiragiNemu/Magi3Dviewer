import * as THREE from 'three';
import * as F from './field.mjs';
import {projectNodesIndexed,createDepthWorkspace} from './depth-index.mjs';
import {buildSegmentTree} from './segment-bvh.mjs';
import {patchLiveShader} from './shader.mjs';
import {rollbackLiveRing} from './rollback.mjs';
import {targets,liveProjection,collectTriangles,stamp} from './helpers.mjs';
const owners=new WeakMap();
const projected=m=>{const a=m?.userData?.officialMaterialProfile?.angelRing;return !!(a?.isHair&&a.enabled&&!a.uvMode&&a.map==='common');};
export function createCharacterRingController(scene,character,curve,{onRemove}={}){
 const id=Number(character.userData.characterId);
 if(curve.status!=='success'||curve.characterId!==id||curve.count!==1024||curve.points?.length!==1025||!curve.points.every(p=>p.length===3&&p.every(Number.isFinite)))throw Error('CURVE_ID_OR_LAYOUT_MISMATCH');
 const t=targets(character);for(const material of t.materials)if(owners.has(material))throw Error('MATERIAL_ALREADY_OWNED:'+material.uuid);
 const nodeArray=new Float32Array(4096),segmentArray=new Float32Array(16384),depthWorkspace=createDepthWorkspace();
 const texture=(array,h)=>{const t=new THREE.DataTexture(array,1024,h,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.NearestFilter;t.generateMipmaps=false;t.flipY=false;t.colorSpace=THREE.NoColorSpace;return t;};
 const nodesTexture=texture(nodeArray,1),segmentsTexture=texture(segmentArray,4);
 const uniforms={tArfNodes:{value:nodesTexture},tArfSegments:{value:segmentsTexture},uArfNodeWidth:{value:1024},uArfSegmentSize:{value:new THREE.Vector2(1024,4)},uArfNodeCount:{value:0},uArfLiveActive:{value:0}};
 const records=[],updates=[],frameTimes=[];let enabled=false,removed=false,matches=null,last=null,error=null,lastFrame=-1,lastAt=0,disposing=false;
 function rebuild(p){const start=performance.now(),geometry=collectTriangles(character,t,p),gAt=performance.now(),built=projectNodesIndexed(curve.points,p,geometry.packed,depthWorkspace),dAt=performance.now(),segments=F.makeSegments(built.nodes),tree=buildSegmentTree(segments),bAt=performance.now();
  nodeArray.set(tree.nodeData);segmentArray.set(tree.segmentData);nodesTexture.needsUpdate=true;segmentsTexture.needsUpdate=true;uniforms.uArfNodeCount.value=tree.nodeCount;matches=stamp(scene,t,p);
  last={characterId:id,frame:scene.renderer.info.render.frame,counts:built.counts,segments:tree.segmentCount,nodes:tree.nodeCount,vertices:geometry.vertices,triangles:geometry.triangles,fov:scene.camera.fov,camera:scene.camera.position.toArray(),face:p.face,viewport:p.viewport,textureUuid:p.texture?.uuid,timing:{geometry:gAt-start,depth:dAt-gAt,tree:bAt-dAt,total:performance.now()-start}};updates.push(last.timing.total);if(updates.length>240)updates.shift();return {p,geometry,built,segments,tree};
 }
 function enable(){if(removed)throw Error('CONTROLLER_REMOVED');error=null;enabled=true;matches=null;}
 function disable(){enabled=false;uniforms.uArfLiveActive.value=0;}
 function resetStatistics(){updates.length=frameTimes.length=0;lastAt=0;}
 function statistics(){const a=updates.slice().sort((a,b)=>a-b);return {characterId:id,curveSha256:curve.curveSha256,inputSha256:curve.inputSha256,status:removed?'REMOVED':error?'ERROR':enabled?'LIVE_CANDIDATE':'ORIGINAL',error,last,updateSamples:a.length,updateMedianMs:a.length?a[a.length>>1]:null,updateMaxMs:a.length?a.at(-1):null,frameSamples:frameTimes.length,frameIntervalMeanMs:frameTimes.length?frameTimes.reduce((a,b)=>a+b,0)/frameTimes.length:null,textureBytes:nodeArray.byteLength+segmentArray.byteLength,patchedMaterials:t.materials.length,patchedMeshes:t.meshes.length};}
 const onDispose=()=>{disposing=true;remove();};
 function remove(){if(removed)return {characterId:id,status:'ALREADY_REMOVED',conflicts:[]};disable();if(!disposing){const callbacks=character.userData.disposeCallbacks,index=callbacks.indexOf(onDispose);if(index>=0)callbacks.splice(index,1);}const conflicts=rollbackLiveRing(records,uniforms,[nodesTexture,segmentsTexture]);for(const m of t.materials)if(owners.get(m)===character)owners.delete(m);records.length=0;removed=true;onRemove?.(character);return {characterId:id,status:'REMOVED',conflicts};}
 for(const material of t.materials){const compile=material.onBeforeCompile,key=material.customProgramCacheKey,undos=[];
  const wrap=function(shader,renderer){compile.call(this,shader,renderer);if(projected(this))undos.push(patchLiveShader(shader,uniforms));};const cache=function(){return key.call(this)+'|arf-character-carrier-v1';};
  material.onBeforeCompile=wrap;material.customProgramCacheKey=cache;material.needsUpdate=true;owners.set(material,character);records.push({kind:'material',material,compile,key,wrap,cache,undos});
 }
 for(const mesh of t.meshes){const old=mesh.onBeforeRender;const wrap=function(renderer,world,camera,geometry,material,group){old.call(this,renderer,world,camera,geometry,material,group);uniforms.uArfLiveActive.value=0;if(camera!==scene.camera||!projected(material))return;
  const frame=renderer.info.render.frame;if(frame!==lastFrame){const now=performance.now();if(lastAt){frameTimes.push(now-lastAt);if(frameTimes.length>240)frameTimes.shift();}lastAt=now;lastFrame=frame;}
  if(!enabled)return;
  try{const p=liveProjection(scene,t,material);if(!matches||!matches(p))rebuild(p);uniforms.uArfLiveActive.value=1;}
  catch(e){if(e?.message==='WAIT_FOR_EXISTING_HAIR_SHADER_DRAW')return;error=String(e);disable();}
 };mesh.onBeforeRender=wrap;records.push({kind:'mesh',mesh,old,wrap});}
 character.userData.disposeCallbacks.push(onDispose);
 return {id,character,t,uniforms,curve,enable,disable,remove,statistics,resetStatistics,measure:()=>rebuild(liveProjection(scene,t)),projection:()=>liveProjection(scene,t)};
}
