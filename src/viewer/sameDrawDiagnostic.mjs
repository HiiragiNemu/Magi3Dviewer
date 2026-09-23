// Development-only observer. No Three import, shader edits, injected draws, or texture reads/writes.
// The sole GL state change is ARRAY_BUFFER binding for getBufferSubData; finally restores it.
const I = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const arr = v => v == null ? null : typeof v === 'number' || typeof v === 'boolean' ? v : v.toArray ? v.toArray() : Array.from(v);
export const mul4 = (m,v) => [0,1,2,3].map(r=>m[r]*v[0]+m[r+4]*v[1]+m[r+8]*v[2]+m[r+12]*v[3]);
const matmul = (a,b) => b.flatMap((_,i)=>i%4 ? [] : mul4(a,b.slice(i,i+4)));
const diff = (a,b) => a && b && a.length===b.length ? Math.max(0,...a.map((v,i)=>Math.abs(v-b[i]))) : null;
const distance = (a,b) => Math.hypot(...a.slice(0,3).map((v,i)=>v-b[i]));
const clamp = x => Math.max(0,Math.min(1,x));
const required = (v,name) => { if(v==null) throw Error(`MISSING_ACTUAL_INPUT:${name}`); return v; };

/** Offline replay of captured inputs, not a GPU vertex-output/fragment readback. */
export function replayVertex(v,u,viewport) {
  let position=v.position.slice(0,3);
  if(v.morphs?.length) {
    const base=required(u.morphTargetBaseInfluence,'morphTargetBaseInfluence');
    position=position.map(x=>x*base);
    for(const m of v.morphs) position=position.map((x,i)=>x+m.position[i]*m.weight);
  }
  const morphed=position.slice();
  if(v.skin) {
    const p=mul4(required(u.bindMatrix,'bindMatrix'),[...position,1]);
    const sum=[0,0,0,0];
    for(const b of v.skin) { const q=mul4(b.uploadSourceMatrix,p); for(let i=0;i<4;i++)sum[i]+=q[i]*b.weight; }
    position=mul4(required(u.bindMatrixInverse,'bindMatrixInverse'),sum).slice(0,3);
  }
  const world=mul4(required(u.modelMatrix,'modelMatrix'),[...position,1]);
  const view=mul4(required(u.modelViewMatrix,'modelViewMatrix'),[...position,1]);
  const rawClip=mul4(required(u.projectionMatrix,'projectionMatrix'),view);
  const face=required(u.uRdCharacterFacePositionWS,'uRdCharacterFacePositionWS');
  const faceVS=mul4(required(u.viewMatrix,'viewMatrix'),[...face,1]);
  const factor=Math.max(1-distance(world,face)*2.25,0)*required(u.uRdCharacterCancelPerspective,'uRdCharacterCancelPerspective')*required(u.uRdGlobalCharacterCancelPerspective,'uRdGlobalCharacterCancelPerspective')*clamp(world[1]);
  const clip=rawClip.slice();
  const perspective=u.projectionMatrix[11]===-1;
  if(perspective) for(let i=0;i<2;i++)clip[i]=rawClip[i]+(Math.abs(rawClip[3])*rawClip[i]/Math.abs(faceVS[2])-rawClip[i])*factor;
  const ndc=clip.slice(0,3).map(x=>x/clip[3]);
  const screen=[viewport[0]+(ndc[0]*.5+.5)*viewport[2],viewport[1]+(ndc[1]*.5+.5)*viewport[3]];
  const ringFace=required(u.uAngelRingFacePosition,'uAngelRingFacePosition');
  const faceClip=mul4(u.projectionMatrix,mul4(u.viewMatrix,[...ringFace,1]));
  const up=mul4(u.viewMatrix,[...required(u.uAngelRingFaceUp,'uAngelRingFaceUp'),0]);
  const forward=mul4(u.viewMatrix,[...required(u.uAngelRingFaceForward,'uAngelRingFaceForward'),0]);
  const size=required(u.uAngelRingViewportSize,'uAngelRingViewportSize');
  const inverse=u.uAngelRingOrthographic>=.5 ? .875 : 1/distance(required(u.cameraPosition,'cameraPosition'),ringFace);
  const scale=required(u.uAngelRingAspectFix,'uAngelRingAspectFix').map(x=>x*required(u.uAngelRingFovOrOrthoFix,'uAngelRingFovOrOrthoFix')*inverse);
  const shift=[Math.sin(up[1]*1.57079637)*Math.pow(-.5*forward[2]+.5,2)*15*scale[0],-3*up[2]*scale[1]];
  const coord=[0,1].map(i=>(screen[i]/size[i]+shift[i]-(faceClip[i]/faceClip[3]*.5+.5))/(20*scale[i]));
  const q=[coord[0]*up[1]-coord[1]*up[0]+.5,coord[0]*up[0]+coord[1]*up[1]+.5];
  const arch=Math.sin(q[0]*3.14159274),lo=q[1]-arch*.414999992,hi=q[1]+arch*.5;
  return {morphed,skinnedLocal:position,world,view,rawClip,clip,ndc,screen,cancelFactor:factor,faceVS,ringFaceClip:faceClip,upVS:up,forwardVS:forward,ringUvAtProjectedVertex:[q[0],lo+(hi-lo)*(up[2]*.5+.5)],meaning:'CPU float64 replay at an indexed vertex projection, NOT ring contour/pixel readback'};
}

export function listHairDrawCandidates(root) {
  const rows=[];
  root.traverse(mesh=>{
    if(!mesh.isMesh || !mesh.geometry?.attributes?.position)return;
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    materials.forEach((m,i)=>{
      if(!m?.userData?.officialMaterialProfile?.angelRing?.isHair && !m?.userData?.shader?.uniforms?.uAngelRingFacePosition)return;
      rows.push({meshUuid:mesh.uuid,meshName:mesh.name,geometryUuid:mesh.geometry.uuid,materialUuid:m.uuid,materialName:m.name,materialIndex:i,stencilRole:mesh.userData.officialStencilRole??null,indexed:!!mesh.geometry.index,vertexCount:mesh.geometry.attributes.position.count,indexCount:mesh.geometry.index?.count??null,selectionSpace:mesh.geometry.index?'EBO index slot':'gl_VertexID',drawRange:{...mesh.geometry.drawRange},groups:mesh.geometry.groups.filter(g=>(g.materialIndex??0)===i).map(g=>({...g})),firstIndexPreview:mesh.geometry.index?Array.from(mesh.geometry.index.array.slice(0,12)):null});
    });
  });
  return rows;
}

const uniformNames=['modelMatrix','modelViewMatrix','viewMatrix','projectionMatrix','cameraPosition','bindMatrix','bindMatrixInverse','boneTexture','morphTargetBaseInfluence','morphTargetInfluences','morphTargetsTexture','uAngelRingFacePosition','uAngelRingFaceUp','uAngelRingFaceForward','uRdCharacterFacePositionWS','uRdCharacterCancelPerspective','uRdGlobalCharacterCancelPerspective','uAngelRingViewportSize','uAngelRingAspectFix','uAngelRingFovOrOrthoFix','uAngelRingOrthographic','uAngelRingEnabled','uAngelRingMaterialEnabled','uAngelRingUvMode','uAngelRingMapKind','tAngelRingMap'];

/** Select an absolute EBO slot or (non-indexed) gl_VertexID, divisible by three relative to actual draw start.
 * Install once for pitch A and again for pitch B; maxSamples=1 avoids consecutive-frame ambiguity.
 * Does not move camera, update bones, pause animation, or trigger any render.
 */
export function installSameDrawObserver({renderer,meshUuid,materialUuid,triangleIndexOffset,cameraUuid=null,maxSamples=1,timeoutMs=10000,label='',onComplete=()=>{}}) {
  if(!renderer || !meshUuid || !materialUuid || !Number.isInteger(triangleIndexOffset) || triangleIndexOffset<0)throw Error('EXPLICIT_MESH_MATERIAL_AND_INDEX_OFFSET_REQUIRED');
  if(!Number.isInteger(maxSamples)||maxSamples<1||maxSamples>8)throw Error('maxSamples must be 1..8');
  if(!(timeoutMs>0&&timeoutMs<=30000))throw Error('timeoutMs must be 1..30000');
  const gl=renderer.getContext();
  if(typeof gl.getBufferSubData!=='function')throw Error('WEBGL2_BUFFER_QUERY_REQUIRED');
  const originalRender=renderer.renderBufferDirect, originalDraw=gl.drawElements,originalArrays=gl.drawArrays;
  const records=[],errors=[];let context=null,depth=0,ordinal=0,done=false,pending=null,timer;
  const objectIds=new WeakMap();let nextId=1;
  const identity=o=>o ? (objectIds.has(o)?objectIds.get(o):(objectIds.set(o,nextId++),nextId-1)) : null;
  const result={schema:'s6.same-hair-draw.v1',label,selection:{meshUuid,materialUuid,triangleIndexOffset},records,errors,bufferRestoreChecks:[],status:'ARMED',restored:null};
  function finish(reason) {
    if(done)return;
    if(depth){pending=reason;return;}
    done=true;clearTimeout(timer);
    const ownRenderer=renderer.renderBufferDirect===wrappedRender,ownDraw=gl.drawElements===wrappedDraw,ownArrays=gl.drawArrays===wrappedArrays;
    if(ownRenderer)renderer.renderBufferDirect=originalRender;
    if(ownDraw)gl.drawElements=originalDraw;
    if(ownArrays)gl.drawArrays=originalArrays;
    result.restored={renderer:ownRenderer,drawElements:ownDraw,drawArrays:ownArrays};
    if(!ownRenderer||!ownDraw||!ownArrays)errors.push('HOOK_OWNERSHIP_CHANGED: preserved replacement hook');
    result.status=errors.length?'COMPLETE_WITH_ERRORS':'COMPLETE';result.reason=reason;
    queueMicrotask(()=>onComplete(result));
  }
  function gpuUniform(program,name) {
    let loc=gl.getUniformLocation(program,name);
    if(loc===null && name==='morphTargetInfluences')loc=gl.getUniformLocation(program,name+'[0]');
    return loc===null ? null : arr(gl.getUniform(program,loc));
  }
  function attribute(program,name,index) {
    const location=gl.getAttribLocation(program,name);
    if(location<0)return null;
    if(!gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_ENABLED))return {value:arr(gl.getVertexAttrib(location,gl.CURRENT_VERTEX_ATTRIB)),constant:true};
    const buffer=gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
    const count=gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_SIZE),type=gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_TYPE),normalized=gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),stride=gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_STRIDE),offset=gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER);
    const types={5126:[Float32Array,4,1],5125:[Uint32Array,4,4294967295],5123:[Uint16Array,2,65535],5122:[Int16Array,2,32767],5121:[Uint8Array,1,255],5120:[Int8Array,1,127]};
    if(!types[type])throw Error(`UNSUPPORTED_ATTRIBUTE_TYPE:${name}:${type}`);
    if(gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_DIVISOR)!==0)throw Error('INSTANCED_ATTRIBUTE_NOT_REPLAYED');
    const [Ctor,bytes,max]=types[type],data=new Ctor(count);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.getBufferSubData(gl.ARRAY_BUFFER,offset+index*(stride||count*bytes),data);
    const value=Array.from(data,x=>normalized&&type!==5126?Math.max(-1,x/max):x);
    return {value,location,bufferIdentity:identity(buffer),type,normalized,stride,offset,constant:false,provenance:'GPU getBufferSubData'};
  }
  function capture(draw) {
    const {camera,geometry,material,mesh,group}=context;
    if(mesh.isInstancedMesh||mesh.isBatchedMesh)throw Error('INSTANCED_OR_BATCHED_MESH_NOT_REPLAYED');
    const program=gl.getParameter(gl.CURRENT_PROGRAM),viewport=arr(gl.getParameter(gl.VIEWPORT));
    const u=Object.fromEntries(uniformNames.map(n=>[n,gpuUniform(program,n)]));
    if(u.uAngelRingFacePosition==null)throw Error('SELECTED_DRAW_HAS_NO_ACTIVE_PROJECTED_ANGELRING');
    const oldArray=gl.getParameter(gl.ARRAY_BUFFER_BINDING),oldElement=gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
    const row={ordinal,draw,meshUuid:mesh.uuid,meshName:mesh.name,geometryUuid:geometry.uuid,materialUuid:material.uuid,materialName:material.name,stencilRole:mesh.userData.officialStencilRole??null,group:group?{...group}:null,programIdentity:identity(program),frame:renderer.info?.render?.frame??null,viewport,gpuUniforms:u,vertices:[],queriesRestored:false,unsupported:[]};
    try {
      const Ctor={5121:Uint8Array,5123:Uint16Array,5125:Uint32Array}[draw.type];
      if(draw.kind==='elements'&&!Ctor)throw Error('UNSUPPORTED_INDEX_TYPE');
      const bytes=Ctor?.BYTES_PER_ELEMENT,start=draw.kind==='arrays'?draw.first:draw.offset/bytes;
      if(draw.mode!==gl.TRIANGLES || triangleIndexOffset<start || triangleIndexOffset+3>start+draw.count || (triangleIndexOffset-start)%3!==0)throw Error('TRIANGLE_NOT_IN_THIS_ACTUAL_DRAW_RANGE');
      const indices=draw.kind==='arrays'?[triangleIndexOffset,triangleIndexOffset+1,triangleIndexOffset+2]:new Ctor(3);
      if(draw.kind==='elements')gl.getBufferSubData(gl.ELEMENT_ARRAY_BUFFER,triangleIndexOffset*bytes,indices);
      row.indices=Array.from(indices);row.elementBufferIdentity=identity(oldElement);
      row.indexProvenance=draw.kind==='arrays'?'actual drawArrays first/count -> exact gl_VertexID':'GPU EBO getBufferSubData';
      for(const index of indices) {
        const a=Object.fromEntries(['position','skinIndex','skinWeight','uv'].map(n=>[n,attribute(program,n,index)]));
        const vertex={index,attributes:a,position:required(a.position,'GPU position').value.slice(0,3),morphs:[]};
        const influences=u.morphTargetInfluences??[];
        for(let k=0;k<influences.length;k++)if(influences[k]!==0) {
          const target=geometry.morphAttributes?.position?.[k];
          if(!target)throw Error(`ACTIVE_MORPH_POSITION_SOURCE_MISSING:${k}`);
          vertex.morphs.push({targetIndex:k,weight:influences[k],position:[target.getX(index),target.getY(index),target.getZ(index)],provenance:'CPU morph attribute upload source; GPU texture bytes not read'});
        }
        if(mesh.isSkinnedMesh) {
          const ids=required(a.skinIndex,'GPU skinIndex').value,weights=required(a.skinWeight,'GPU skinWeight').value;
          const skeleton=required(mesh.skeleton,'skeleton'),bank=required(skeleton.boneMatrices,'boneMatrices');vertex.skin=[];
          for(let k=0;k<4;k++)if(weights[k]!==0) {
            const bi=ids[k],uploaded=Array.from(bank.slice(bi*16,bi*16+16));
            if(uploaded.length!==16)throw Error('BONE_INDEX_OUT_OF_RANGE');
            const current=matmul(skeleton.bones[bi].matrixWorld.elements,skeleton.boneInverses[bi].elements);
            vertex.skin.push({boneIndex:bi,boneName:skeleton.bones[bi].name,weight:weights[k],uploadSourceMatrix:uploaded,currentBoneWorldTimesInverse:current,uploadSourceVsCurrentMaxAbs:diff(uploaded,current),provenance:'skeleton.boneMatrices Float32 CPU upload source; boneTexture GPU bytes not read'});
          }
        }
        vertex.replay=replayVertex(vertex,u,viewport);row.vertices.push(vertex);
      }
      const ref=mesh.userData.characterPerspectiveReference,head=ref?.headBone;
      row.cpuReference={headName:head?.name??null,headUuid:head?.uuid??null,headMatrixWorld:head?arr(head.matrixWorld):null,headOffset:ref?.headOffset??null,referenceFace:ref?arr(ref.facePosition):null,meshMatrixWorld:arr(mesh.matrixWorld),cameraMatrixWorldInverse:arr(camera.matrixWorldInverse),cameraProjection:arr(camera.projectionMatrix),cameraFov:camera.fov??null,cameraZoom:camera.zoom??null};
      const cpu=material.userData?.shader?.uniforms??{};
      row.cpuUniforms=Object.fromEntries(uniformNames.filter(n=>cpu[n]&&n!=='tAngelRingMap').map(n=>[n,arr(cpu[n].value)]));
      const texture=cpu.tAngelRingMap?.value;
      row.sampler={gpuUnit:u.tAngelRingMap,cpuTextureUuid:texture?.uuid??null,cpuTextureName:texture?.name??null,width:texture?.image?.width??null,height:texture?.image?.height??null,flipY:texture?.flipY??null,colorSpace:texture?.colorSpace??null,minFilter:texture?.minFilter??null,magFilter:texture?.magFilter??null,wrapS:texture?.wrapS??null,wrapT:texture?.wrapT??null,gpuTextureIdentity:'NOT_QUERIED: no activeTexture/texture binding mutation'};
      row.branch=u.uAngelRingUvMode===1?'UV':'PROJECTED';
      row.deltas={angelVsCancelFaceMaxAbs:diff(u.uAngelRingFacePosition,u.uRdCharacterFacePositionWS),cancelGpuVsCpuReferenceMaxAbs:diff(u.uRdCharacterFacePositionWS,row.cpuReference.referenceFace),gpuVsCpuUniforms:Object.fromEntries(Object.entries(row.cpuUniforms).map(([k,v])=>[k,typeof v==='number'?u[k]==null?null:Math.abs(v-u[k]):diff(v,u[k])])),boneUploadSourceVsCurrentMaxAbs:Math.max(0,...row.vertices.flatMap(v=>(v.skin??[]).map(b=>b.uploadSourceVsCurrentMaxAbs)))};
      Object.assign(row.deltas,{gpuModelVsCpu:diff(u.modelMatrix,row.cpuReference.meshMatrixWorld),gpuViewVsCpu:diff(u.viewMatrix,row.cpuReference.cameraMatrixWorldInverse),gpuProjectionVsCpu:diff(u.projectionMatrix,row.cpuReference.cameraProjection),ringSizeVsViewport:diff(u.uAngelRingViewportSize,viewport.slice(2))});
      row.provenance={gpuRead:['draw parameters',draw.kind==='arrays'?'drawArrays gl_VertexID range':'index buffer','position/skinIndex/skinWeight/uv buffers','active uniforms','viewport'],cpuUploadSource:['boneMatrices','nonzero morph target positions'],notMeasured:['GPU bone/morph texture bytes','GPU post-vertex output','fragment ring contour','native matched geometry']};
      return row;
    } finally {
      gl.bindBuffer(gl.ARRAY_BUFFER,oldArray);
      row.queriesRestored=gl.getParameter(gl.ARRAY_BUFFER_BINDING)===oldArray && gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)===oldElement;
      result.bufferRestoreChecks.push(row.queriesRestored);
      if(!row.queriesRestored)throw Error('BUFFER_BINDING_RESTORE_MISMATCH');
    }
  }
  function wrappedDraw(mode,count,type,offset) {
    const returnValue=originalDraw.apply(this,arguments);ordinal++;
    if(!done&&!pending&&context&&context.mesh.uuid===meshUuid&&context.material.uuid===materialUuid&&(!cameraUuid||context.camera.uuid===cameraUuid)) {
      const bytes={5121:1,5123:2,5125:4}[type],start=offset/bytes;
      if(bytes && (triangleIndexOffset<start || triangleIndexOffset+3>start+count))return returnValue;
      try { records.push(capture({kind:'elements',mode,count,type,offset}));if(records.length>=maxSamples)finish('sample-limit'); }
      catch(e){errors.push(String(e?.stack??e));finish('capture-error');}
    }
    return returnValue;
  }
  function wrappedArrays(mode,first,count) {
    const returnValue=originalArrays.apply(this,arguments);ordinal++;
    if(!done&&!pending&&context&&context.mesh.uuid===meshUuid&&context.material.uuid===materialUuid&&(!cameraUuid||context.camera.uuid===cameraUuid)&&triangleIndexOffset>=first&&triangleIndexOffset+3<=first+count) {
      try {records.push(capture({kind:'arrays',mode,first,count}));if(records.length>=maxSamples)finish('sample-limit');}
      catch(e){errors.push(String(e?.stack??e));finish('capture-error');}
    }
    return returnValue;
  }
  function wrappedRender(camera,scene,geometry,material,mesh,group) {
    const previous=context;context={camera,scene,geometry,material,mesh,group};depth++;
    try{return originalRender.apply(this,arguments);}
    catch(e){errors.push(`ORIGINAL_RENDER_ERROR:${String(e)}`);finish('original-render-error');throw e;}
    finally {context=previous;depth--;if(pending&&depth===0){const reason=pending;pending=null;finish(reason);}}
  }
  renderer.renderBufferDirect=wrappedRender;
  try {gl.drawElements=wrappedDraw;gl.drawArrays=wrappedArrays;if(gl.drawElements!==wrappedDraw||gl.drawArrays!==wrappedArrays)throw Error('DRAW_HOOK_NOT_WRITABLE');}
  catch(e){if(renderer.renderBufferDirect===wrappedRender)renderer.renderBufferDirect=originalRender;if(gl.drawElements===wrappedDraw)gl.drawElements=originalDraw;if(gl.drawArrays===wrappedArrays)gl.drawArrays=originalArrays;throw e;}
  timer=setTimeout(()=>finish('timeout-no-forced-render'),timeoutMs);
  return {result,stop:()=>finish('manual-stop')};
}

export function compareSameTriangle(a,b,tolerance=1e-6) {
  if(a.meshUuid!==b.meshUuid||a.geometryUuid!==b.geometryUuid||a.materialUuid!==b.materialUuid||JSON.stringify(a.indices)!==JSON.stringify(b.indices))throw Error('NOT_THE_SAME_EXACT_HAIR_TRIANGLE');
  return {sameTriangle:true,headPoseMaxAbs:diff(a.cpuReference.headMatrixWorld,b.cpuReference.headMatrixWorld),skinnedWorldMaxAbs:Math.max(...a.vertices.map((v,i)=>diff(v.replay.world,b.vertices[i].replay.world))),faceMaxAbs:diff(a.gpuUniforms.uAngelRingFacePosition,b.gpuUniforms.uAngelRingFacePosition),cameraVMaxAbs:diff(a.gpuUniforms.viewMatrix,b.gpuUniforms.viewMatrix),cameraPMaxAbs:diff(a.gpuUniforms.projectionMatrix,b.gpuUniforms.projectionMatrix),faceReferenceMismatch:[a.deltas.angelVsCancelFaceMaxAbs,b.deltas.angelVsCancelFaceMaxAbs],boneUploadMismatch:[a.deltas.boneUploadSourceVsCurrentMaxAbs,b.deltas.boneUploadSourceVsCurrentMaxAbs],vertices:a.vertices.map((v,i)=>({index:v.index,screenA:v.replay.screen,screenB:b.vertices[i].replay.screen,ringUvA:v.replay.ringUvAtProjectedVertex,ringUvB:b.vertices[i].replay.ringUvAtProjectedVertex})),fixedPose:diff(a.cpuReference.headMatrixWorld,b.cpuReference.headMatrixWorld)!==null&&diff(a.cpuReference.headMatrixWorld,b.cpuReference.headMatrixWorld)<=tolerance&&a.vertices.every((v,i)=>diff(v.replay.world,b.vertices[i].replay.world)<=tolerance),interpretation:'A same-vertex UV delta is not evidence of light-band movement; use this to locate input divergence before contour/image conclusions.'};
}
