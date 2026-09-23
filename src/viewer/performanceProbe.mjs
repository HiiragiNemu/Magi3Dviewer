import {listHairDrawCandidates,installSameDrawObserver} from './sameDrawDiagnostic.mjs';
// Temporary, opt-in local measurement. Does not alter scene quality or shaders.
export function installPerformanceProbe(scene) {
  if (new URLSearchParams(location.search).get('diagnosticPerf') !== '1') return;
  const renderer = scene.renderer, gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const panel = document.createElement('details');
  panel.id = 'magius-perf-probe'; panel.open = true; panel.setAttribute('data-i18n-ignore','true');
  Object.assign(panel.style, {position:'fixed',bottom:'0',right:'0',zIndex:'2147483646',background:'#111',color:'#fff',maxWidth:'460px',maxHeight:'100px',overflow:'auto',fontSize:'11px'});
  panel.innerHTML = '<summary>本机性能测量（不改变画质）</summary><button type="button">采样性能（60帧）</button><pre id="magius-perf-result">ready</pre>';
  document.body.append(panel);
  const button = panel.querySelector('button'), output = panel.querySelector('pre');
  let useGpuTimer = false; let recording = false, warmup = 0, frames = [], current = null, previous = 0, pending = [], queryActive = false;
  const stats = values => {
    const a = values.slice().sort((a,b)=>a-b);
    return {n:a.length,mean:a.reduce((s,n)=>s+n,0)/(a.length||1),median:a[Math.floor(a.length*.5)]??null,p95:a[Math.min(a.length-1,Math.floor(a.length*.95))]??null};
  };
  const phase = (object, key, name) => {
    const original = object[key];
    object[key] = function(...args) {
      if (!current) return original.apply(this,args);
      const t=performance.now();
      try { return original.apply(this,args); }
      finally { current.cpu[name]=(current.cpu[name]??0)+performance.now()-t; }
    };
  };
  phase(scene.selfShadow,'render','selfShadow');
  phase(scene.cameraDepth,'render','cameraDepth');
  phase(scene.stageCharacterShadows,'update','stageCharacterShadowUpdate');
  phase(scene.effects.composer,'render','composer');
  const render = renderer.render;
  renderer.render = function(root,camera) {
    if (!current) return render.call(this,root,camera);
    const frame=current, target=this.getRenderTarget();
    const label=(root===scene.backgroundScene?'stage':root===scene.scene?'character':'fullscreen')+':'+(target?.texture?.name||'screen/composer');
    const auto=this.info.autoReset; this.info.autoReset=false;
    const before={calls:this.info.render.calls,triangles:this.info.render.triangles};
    const q=ext&&useGpuTimer&&!queryActive?gl.createQuery():null;
    if(q){queryActive=true;gl.beginQuery(ext.TIME_ELAPSED_EXT,q);}
    const start=performance.now();
    try { return render.call(this,root,camera); }
    finally {
      frame.render.push({label,targetSize:target?[target.width,target.height,target.samples]:null,cpu:performance.now()-start,calls:this.info.render.calls-before.calls,triangles:this.info.render.triangles-before.triangles});
      this.info.autoReset=auto;
      if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);queryActive=false;pending.push({q,frame,label});}
    }
  };
  const poll=()=>{
    if(!ext||pending.length===0)return;
    const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);
    pending=pending.filter(item=>{
      if(!disjoint&&!gl.getQueryParameter(item.q,gl.QUERY_RESULT_AVAILABLE))return true;
      if(!disjoint)item.frame.gpu.push({label:item.label,ms:gl.getQueryParameter(item.q,gl.QUERY_RESULT)/1e6});
      gl.deleteQuery(item.q);return false;
    });
  };
  const finish=()=>{
    const labels=[...new Set(frames.flatMap(f=>f.render.map(r=>r.label)))];
    const phaseNames=[...new Set(frames.flatMap(f=>Object.keys(f.cpu)))];
    const size={width:renderer.domElement.width,height:renderer.domElement.height,pixelRatio:renderer.getPixelRatio()};
    const stageRoot=scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot');
    const gpuInfo=gl.getExtension('WEBGL_debug_renderer_info'); const result={targets:{composer1:[scene.effects.composer.renderTarget1.width,scene.effects.composer.renderTarget1.height],composer2:[scene.effects.composer.renderTarget2.width,scene.effects.composer.renderTarget2.height],smaaEdges:[scene.effects.smaaPass._edgesRT.width,scene.effects.smaaPass._edgesRT.height],smaaWeights:[scene.effects.smaaPass._weightsRT.width,scene.effects.smaaPass._weightsRT.height]},gpu:gpuInfo?gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),visible:document.visibilityState,focused:document.hasFocus(),at:new Date().toISOString(),frames:frames.length,interval:stats(frames.slice(1).map(f=>f.interval)),cpuFrame:stats(frames.map(f=>f.total)),gpuAvailable:Boolean(ext),gpuTimerEnabled:useGpuTimer,size,characterIds:scene.characters.map(c=>c.character?.userData.characterId),stageId:stageRoot?.userData.stageDefinition?.id??null,phases:Object.fromEntries(phaseNames.map(k=>[k,stats(frames.map(f=>f.cpu[k]??0))])),passes:Object.fromEntries(labels.map(k=>[k,{cpu:stats(frames.map(f=>f.render.filter(r=>r.label===k).reduce((s,r)=>s+r.cpu,0))),gpu:stats(frames.map(f=>f.gpu.filter(r=>r.label===k).reduce((s,r)=>s+r.ms,0))),calls:stats(frames.map(f=>f.render.filter(r=>r.label===k).reduce((s,r)=>s+r.calls,0))),triangles:stats(frames.map(f=>f.render.filter(r=>r.label===k).reduce((s,r)=>s+r.triangles,0)))}])),raw:frames};
    output.textContent=JSON.stringify(result); recording=false;button.disabled=false;
  };
  const hairPanel=document.createElement('details');hairPanel.id='magius-hair-draw';
  hairPanel.innerHTML='<summary>本机头发同一绘制诊断</summary><button id="hair-catalog" type="button">列出当前头发绘制</button><select id="hair-draw-select" aria-label="头发实际绘制槽"></select><input id="hair-triangle" aria-label="头发三角形起点" type="number" value="0"><button id="hair-capture" type="button">记录所选头发绘制</button><button id="hair-pitch-low" type="button">诊断镜头仰视15度</button><button id="hair-pitch-high" type="button">诊断镜头俯视30度</button><pre id="hair-catalog-result"></pre><pre id="hair-draw-result"></pre>';
  panel.append(hairPanel);
  const hairSelect=hairPanel.querySelector('select'),hairTriangle=hairPanel.querySelector('input'),hairResult=hairPanel.querySelector('#hair-draw-result');let rows=[];
  hairPanel.querySelector('#hair-catalog').onclick=()=>{rows=listHairDrawCandidates(scene.scene);hairSelect.replaceChildren();rows.forEach((r,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`${r.meshName} | ${r.materialName} | ${r.stencilRole} | ${r.meshUuid}`;hairSelect.append(option);});hairPanel.querySelector('#hair-catalog-result').textContent=JSON.stringify(rows);};
  hairSelect.onchange=()=>{const row=rows[Number(hairSelect.value)];hairTriangle.value=String(row.groups[0]?.start??row.drawRange.start);};
  hairPanel.querySelector('#hair-capture').onclick=()=>{const row=rows[Number(hairSelect.value)];hairResult.textContent='armed';installSameDrawObserver({renderer,meshUuid:row.meshUuid,materialUuid:row.materialUuid,cameraUuid:scene.camera.uuid,triangleIndexOffset:Number(hairTriangle.value),label:'main-camera-explicit-slot',onComplete:r=>{r.cameraState={position:scene.camera.position.toArray(),target:scene.controls.target.toArray(),fov:scene.camera.fov};hairResult.textContent=JSON.stringify(r);}});};
  function pitch(degrees){const a=degrees*Math.PI/180;scene.controls.target.set(0,1.4,0);scene.camera.position.set(0,1.4+Math.sin(a)*1.2,Math.cos(a)*1.2);scene.controls.update();}
  hairPanel.querySelector('#hair-pitch-low').onclick=()=>pitch(-15);
  hairPanel.querySelector('#hair-pitch-high').onclick=()=>pitch(30);
  const gpuCheck=document.createElement('input');gpuCheck.type='checkbox';gpuCheck.id='magius-perf-gpu';const gpuLabel=document.createElement('label');gpuLabel.textContent='启用 GPU 分段计时';gpuLabel.append(gpuCheck);panel.insertBefore(gpuLabel,output);button.addEventListener('click',()=>{useGpuTimer=gpuCheck.checked;if(recording)return;recording=true;warmup=30;frames=[];previous=0;button.disabled=true;output.textContent='sampling';});
  const setAnimationLoop=renderer.setAnimationLoop;
  renderer.setAnimationLoop=function(callback){
    return setAnimationLoop.call(this,callback?timestamp=>{
      poll();
      if(recording&&warmup>0){warmup--;callback(timestamp);return;}
      if(recording&&frames.length<60){
        current={interval:previous?timestamp-previous:0,cpu:{},render:[],gpu:[],total:0};previous=timestamp;
        const frame=current,start=performance.now();
        try{callback(timestamp);}finally{frame.total=performance.now()-start;frames.push(frame);current=null;}
      }else callback(timestamp);
      if(recording&&frames.length===60&&pending.length===0)finish();
    }:null);
  };
}
