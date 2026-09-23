// Called by the local candidate's visible Remove button. Restore only callbacks
// still owned by this layer; never overwrite a later writer.
export function rollbackLiveRing(records,uniforms,textures){
 uniforms.uArfLiveActive.value=0;
 const conflicts=[];
 for(const r of records.slice().reverse()){
  if(r.kind==='mesh'){
   if(r.mesh.onBeforeRender===r.wrap)r.mesh.onBeforeRender=r.old;
   else conflicts.push(r.mesh.uuid);
  }else{
   if(r.material.onBeforeCompile===r.wrap)r.material.onBeforeCompile=r.compile;
   else conflicts.push(r.material.uuid);
   if(r.material.customProgramCacheKey===r.cache)r.material.customProgramCacheKey=r.key;
   else conflicts.push(r.material.uuid+':key');
   r.undos.forEach(f=>f());r.material.needsUpdate=true;
  }
 }
 textures.forEach(t=>t.dispose());return conflicts;
}
