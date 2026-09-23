/** Parent-invoked GPU test. No product imports or modifications. Pass the page's
 * actual Three constructors. Uses a separate canvas/context, never the live scene.
 * GPU result is not claimed until this function returns on an actual browser. */
export async function runFullscreenDepthPixelTest({THREE,SMAAPass,OutputPass,FXAAPass,width=256,height=144}){
 const renderer=new THREE.WebGLRenderer({canvas:document.createElement('canvas'),antialias:false,alpha:true});
 renderer.setPixelRatio(1);renderer.setSize(width,height,false);renderer.autoClear=false;
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
 const passes=[new SMAAPass(),new OutputPass(),new FXAAPass()];
 const targets=Array.from({length:3},()=>new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType,depthBuffer:true,stencilBuffer:true}));
 const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
 const geometry=new THREE.PlaneGeometry(2,2);
 const mat=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec2 v;void main(){float c=mod(floor(v.x*29.0)+floor(v.y*17.0),2.0);float s=step(v.x*.37+.19,v.y);gl_FragColor=vec4(c*4.0,s*.7,v.x*v.y,.25+.75*v.x);}'});
 const mesh=new THREE.Mesh(geometry,mat);const checks=[];
 const materials=[passes[0]._materialBlend,passes[1].material,passes[2].material];
 try{
  if(!renderer.extensions.has('EXT_color_buffer_float'))throw Error('HalfFloat color render support missing');
  await Promise.all([passes[0]._areaTexture.image,passes[0]._searchTexture.image].map(img=>img.decode()));
  passes[0]._areaTexture.needsUpdate=true;passes[0]._searchTexture.needsUpdate=true;
  for(const p of passes){p.setSize(width,height);p.renderToScreen=false;}
  function run(candidate,chain,seed){
   materials.forEach(m=>{m.depthWrite=!candidate});
   for(const t of targets){renderer.setRenderTarget(t);renderer.state.buffers.depth.setMask(true);renderer.state.buffers.depth.setClear(seed);renderer.setClearColor(0x123456,.37);renderer.clear(true,true,true)}
   renderer.setRenderTarget(targets[0]);renderer.render(mesh,camera);
   let read=targets[0],write=targets[1];
   for(const id of chain){passes[id].render(renderer,write,read,0,false);[read,write]=[write,read]}
   const pixels=new Uint16Array(width*height*4);renderer.readRenderTargetPixels(read,0,0,width,height,pixels);
   if(renderer.getContext().getError()!==0)throw Error('GL error during render/readPixels');
   return pixels;
  }
  for(const chain of [[0,1],[1,2],[1]])for(const depthSeed of [0,.125,.5,1])for(let repeat=0;repeat<2;repeat++){
   const a=run(false,chain,depthSeed),b=run(true,chain,depthSeed);let changed=0;for(let i=0;i<a.length;i++)changed+=a[i]!==b[i]?1:0;
   if(new Set(a).size<4)throw Error('Degenerate readback; image not demonstrated');
   checks.push({chain:chain.map(i=>['SMAA','Output','FXAA'][i]),depthSeed,repeat,comparedChannels:a.length,changedChannels:changed});
   if(changed)throw Error('Pixel mismatch '+JSON.stringify(checks.at(-1)));
  }
  return {status:'PASS_GPU_BIT_EXACT_COLOR',width,height,type:'HalfFloat Uint16 raw color bits',checks,limitations:['Synthetic color-only terminal chains; not full scene visual acceptance.','No FPS claim; profiling must omit readPixels test frames.','Uses isolated context and offscreen render targets, not default framebuffer compositor.']};
 } finally {materials.forEach(m=>{m.depthWrite=true});passes.forEach(p=>p.dispose());targets.forEach(t=>t.dispose());mat.dispose();geometry.dispose();renderer.dispose();renderer.forceContextLoss()}
}
