// Exact sealed curve/UV definition; allocation-free hot loops, Float64 CPU and
// Float32 texture storage. No per-fragment segment loop in the GPU shader.
export const K=100/(40*.875), N=1024, NODE=12, SEG=11;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function project(qx,qy,qz,p,out,offset=0){
 const f=p.face,r=p.right,u=p.up,d=p.forward;
 const x=f[0]+r[0]*qx+u[0]*qy+d[0]*qz,y=f[1]+r[1]*qx+u[1]*qy+d[1]*qz,z=f[2]+r[2]*qx+u[2]*qy+d[2]*qz;
 const v=p.view,m=p.projection,vx=v[0]*x+v[4]*y+v[8]*z+v[12],vy=v[1]*x+v[5]*y+v[9]*z+v[13],vz=v[2]*x+v[6]*y+v[10]*z+v[14],vw=v[3]*x+v[7]*y+v[11]*z+v[15];
 let cx=m[0]*vx+m[4]*vy+m[8]*vz+m[12]*vw,cy=m[1]*vx+m[5]*vy+m[9]*vz+m[13]*vw;
 const cz=m[2]*vx+m[6]*vy+m[10]*vz+m[14]*vw,cw=m[3]*vx+m[7]*vy+m[11]*vz+m[15]*vw;
 if(p.perspective){const factor=Math.max(1-Math.hypot(qx-(p.cancelDelta?.[0]??0),qy-(p.cancelDelta?.[1]??0),qz-(p.cancelDelta?.[2]??0))*2.25,0)*p.cancel*clamp(y,0,1);const scale=1+factor*(Math.abs(cw)/p.faceViewZ-1);cx*=scale;cy*=scale;}
 out[offset]=cx;out[offset+1]=cy;out[offset+2]=cz;out[offset+3]=cw;return out;
}
// triangles: packed final clip xyz/w, 12 doubles per triangle. Same all-hair,
// double-sided visibility predicate as the SEALED projectCurve; actual forward
// cull/depth/stencil still execute unmodified on the GPU, not in this mask.
export function frontDepth(x,y,triangles){
 let best=Infinity;
 for(let i=0;i<triangles.length;i+=12){
  const aw=triangles[i+3],bw=triangles[i+7],cw=triangles[i+11];if(aw<=0||bw<=0||cw<=0)continue;
  const ax=triangles[i]/aw,ay=triangles[i+1]/aw,bx=triangles[i+4]/bw,by=triangles[i+5]/bw,cx=triangles[i+8]/cw,cy=triangles[i+9]/cw;
  const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-14)continue;
  const a=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/den,b=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/den,c=1-a-b;
  if(Math.min(a,b,c)<-1e-8)continue;
  best=Math.min(best,a*triangles[i+2]/aw+b*triangles[i+6]/bw+c*triangles[i+10]/cw);
 }
 return best;
}
export function projectNodes(points,p,triangles){
 const nodes=new Float64Array((N+1)*NODE),tmp=new Float64Array(4),plus=new Float64Array(4),minus=new Float64Array(4),eps=1e-5,counts={visible:0,hidden:0,noHair:0,behindEye:0};
 const view=p.view,vx=view[2]*p.right[0]+view[6]*p.right[1]+view[10]*p.right[2],vz=view[2]*p.forward[0]+view[6]*p.forward[1]+view[10]*p.forward[2],len=Math.hypot(vx,vz),hx=len*len<1e-10?0:vx/len,hz=len*len<1e-10?1:vz/len,back=hz*-.5+.5;
 for(let i=0;i<=N;i++){
  const [qx,qy,qz]=points[i],j=i*NODE;project(qx,qy,qz,p,tmp);const x=tmp[0]/tmp[3],y=tmp[1]/tmp[3],z=tmp[2]/tmp[3],depth=tmp[3]>0?frontDepth(x,y,triangles):Infinity;
  const state=tmp[3]<=0?3:depth===Infinity?2:z>depth+1e-8?1:0;
  project(qx,qy+eps,qz,p,plus);project(qx,qy-eps,qz,p,minus);
  nodes.set([x,y,z,(qx*hz-qz*hx)*K+.5+back*back*.75,(plus[0]/plus[3]-minus[0]/minus[3])/(2*eps*K),(plus[1]/plus[3]-minus[1]/minus[3])/(2*eps*K),state,qx,qy,qz,depth,tmp[3]],j);
  if(i<N)counts[['visible','hidden','noHair','behindEye'][state]]++;
 }
 return {nodes,counts};
}
export function makeSegments(nodes){
 const list=[],ids=[];
 for(let i=0;i<N;i++){
  const a=i*NODE,b=a+NODE;if(nodes[a+6]!==0||nodes[b+6]!==0)continue;
  const dx=nodes[b]-nodes[a],dy=nodes[b+1]-nodes[a+1],l=dx*dx+dy*dy;if(l<1e-16)continue;
  list.push(nodes[a],nodes[a+1],dx,dy,l,nodes[a+3],nodes[b+3]-nodes[a+3],nodes[a+4],nodes[b+4]-nodes[a+4],nodes[a+5],nodes[b+5]-nodes[a+5]);ids.push(i);
 }
 return {values:new Float64Array(list),ids:new Uint16Array(ids)};
}
// Exact scalar translation of sealed C.sampleUv, including tie order, endpoint
// clamping and relative Jacobian rejection. out=[u,v,valid,segment,distance²].
export function sampleUv(x,y,segments,out){
 const s=segments.values;let best=Infinity,found=0;
 for(let j=0;j<s.length;j+=SEG){
  const fx=x-s[j],fy=y-s[j+1],dx=s[j+2],dy=s[j+3],l=s[j+4],t=clamp((fx*dx+fy*dy)/l,0,1),px=fx-dx*t,py=fy-dy*t,d=px*px+py*py;
  if(found&&best<d)continue;
  const tx=s[j+7]+s[j+8]*t,ty=s[j+9]+s[j+10]*t,jac=dx*ty-dy*tx;
  if(Math.abs(jac)<1e-10*Math.sqrt(l*(tx*tx+ty*ty)))continue;
  best=d;found=1;out[0]=s[j+5]+s[j+6]*t;out[1]=.5+(dx*py-dy*px)/jac;out[3]=segments.ids[j/SEG];out[4]=d;
 }
 out[2]=found;if(!found){out[0]=0;out[1]=0;out[3]=-1;out[4]=Infinity;}return out;
}
// Tight ROI initially comes from Q plus the full native V interval projected
// transversely. It is intersected with actual hair screen bounds and viewport.
// A mandatory outside audit is performed; if it finds nonzero original signal,
// installation stops instead of silently cropping a changed candidate.
export function fieldRect(nodes,hairBounds,viewport){
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(let i=0;i<=N;i++){
  const j=i*NODE;if(nodes[j+11]<=0)continue;
  for(const t of [-.5,.5]){const x=nodes[j]+nodes[j+4]*t,y=nodes[j+1]+nodes[j+5]*t;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
 }
 const [width,height]=viewport;
 const left=Math.max(0,Math.floor((Math.max(x0,hairBounds[0])*.5+.5)*width)-2),bottom=Math.max(0,Math.floor((Math.max(y0,hairBounds[1])*.5+.5)*height)-2);
 const right=Math.min(width,Math.ceil((Math.min(x1,hairBounds[2])*.5+.5)*width)+2),top=Math.min(height,Math.ceil((Math.min(y1,hairBounds[3])*.5+.5)*height)+2);
 if(right<=left||top<=bottom)throw Error('EMPTY_HEAD_REGION');
 if((right-left)*(top-bottom)>512*512)throw Error(`HEAD_REGION_EXCEEDS_MANUAL_DIAGNOSTIC_CAP:${right-left}x${top-bottom}`);
 return {left,bottom,width:right-left,height:top-bottom,viewport:[width,height]};
}
export function inRect(x,y,rect){return x>=rect.left&&x<rect.left+rect.width&&y>=rect.bottom&&y<rect.bottom+rect.height;}
export function rasterField(segments,rect){
 const data=new Float32Array(rect.width*rect.height*4),v=new Float64Array(5),[vw,vh]=rect.viewport;
 for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++){
  sampleUv(2*(rect.left+x+.5)/vw-1,2*(rect.bottom+y+.5)/vh-1,segments,v);const i=(y*rect.width+x)*4;
  data[i]=v[0];data[i+1]=v[1];data[i+2]=v[2];data[i+3]=1;
 }
 return data;
}
export async function rasterFieldManual(segments,rect,yieldFn){
 const data=new Float32Array(rect.width*rect.height*4),v=new Float64Array(5),[vw,vh]=rect.viewport;
 for(let y=0;y<rect.height;y++){
  for(let x=0;x<rect.width;x++){
   sampleUv(2*(rect.left+x+.5)/vw-1,2*(rect.bottom+y+.5)/vh-1,segments,v);const i=(y*rect.width+x)*4;
   data[i]=v[0];data[i+1]=v[1];data[i+2]=v[2];data[i+3]=1;
  }
  if(y%16===15)await yieldFn();
 }
 return data;
}
export function extendToSupport(rect,audit){
 if(!audit.nonzero)return {...rect};
 const b=audit.supportBoundsPixels,left=Math.min(rect.left,b[0]),bottom=Math.min(rect.bottom,b[1]),right=Math.max(rect.left+rect.width,b[2]),top=Math.max(rect.bottom+rect.height,b[3]);
 if((right-left)*(top-bottom)>1024*1024)throw Error(`SUPPORTED_HAIR_ROI_EXCEEDS_MANUAL_CAP:${right-left}x${top-bottom}`);
 return {...rect,left,bottom,width:right-left,height:top-bottom};
}
export function sampleMap(u,v,red,width=512,height=512){
 // Bytes are existing Steam raw DDS rows, not the vertically flipped PNG.
 // The current CompressedTexture uses flipY=false; row zero maps to V zero.
 const x=u*width-.5,y=v*height-.5,x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
 const at=(a,b)=>red[clamp(b,0,height-1)*width+clamp(a,0,width-1)]/255;
 return (1-fy)*((1-fx)*at(x0,y0)+fx*at(x0+1,y0))+fy*((1-fx)*at(x0,y0+1)+fx*at(x0+1,y0+1));
}
// Full pixel-center audit outside ROI but inside actual hair screen AABB. The
// native common map has a nonzero LEFT EDGE, so no U-outside assumption is used.
// Passing this test proves this diagnostic viewport grid, not subpixel coverage.
export async function auditOutside(segments,rect,hairBounds,red,yieldFn=async()=>{}){
 const [w,h]=rect.viewport,v=new Float64Array(5),x0=Math.max(0,Math.floor((hairBounds[0]*.5+.5)*w)),x1=Math.min(w,Math.ceil((hairBounds[2]*.5+.5)*w)),y0=Math.max(0,Math.floor((hairBounds[1]*.5+.5)*h)),y1=Math.min(h,Math.ceil((hairBounds[3]*.5+.5)*h));
 let checked=0,nonzero=0,maxSignal=0,example=null;const supportBoundsPixels=[Infinity,Infinity,-Infinity,-Infinity];
 for(let y=y0;y<y1;y++){
  for(let x=x0;x<x1;x++)if(!inRect(x+.5,y+.5,rect)){
   sampleUv(2*(x+.5)/w-1,2*(y+.5)/h-1,segments,v);const signal=v[2]?sampleMap(v[0],v[1],red):0;checked++;
   if(signal>0){nonzero++;supportBoundsPixels[0]=Math.min(supportBoundsPixels[0],x);supportBoundsPixels[1]=Math.min(supportBoundsPixels[1],y);supportBoundsPixels[2]=Math.max(supportBoundsPixels[2],x+1);supportBoundsPixels[3]=Math.max(supportBoundsPixels[3],y+1);if(signal>maxSignal){maxSignal=signal;example={pixel:[x+.5,y+.5],uv:[v[0],v[1]],signal,segment:v[3]};}}
  }
  if((y-y0)%16===15)await yieldFn();
 }
 return {checked,nonzero,maxSignal,example,supportBoundsPixels:nonzero?supportBoundsPixels:null,meaning:'all pixel centers outside ROI in the hair AABB; exact native DDS raw-row CPU sampling flipY=false; excludes subpixel, lighting and stencil'};
}
