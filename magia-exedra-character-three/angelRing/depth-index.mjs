import {project,K,N,NODE,frontDepth} from './field.mjs';

const EPS=Number.EPSILON,TOL=1e-8,COEFF=7;
function grow(w,key,Type,length){if(!w[key]||w[key].length<length)w[key]=new Type(Math.max(length,w[key]?.length*2||16));return w[key];}
export function createDepthWorkspace(){return {};}
/** Rebuild for current final-clip triangles. Optional workspace owns mutable buffers. */
export function buildDepthIndex(clipTriangles,workspace={}){
 if(clipTriangles.length%12)throw Error('PACKED_CLIP_TRIANGLES_REQUIRE_12_VALUES_EACH');
 const w=workspace,n=clipTriangles.length/12,c=grow(w,'coeff',Float64Array,n*COEFF),b=grow(w,'bounds',Float64Array,n*4),kind=grow(w,'kind',Uint8Array,n),fallback=grow(w,'fallback',Uint32Array,n);
 let coordinateScale=1;
 for(let i=0;i<clipTriangles.length;i+=4){const x=clipTriangles[i]/clipTriangles[i+3],y=clipTriangles[i+1]/clipTriangles[i+3];if(Number.isFinite(x))coordinateScale=Math.max(coordinateScale,Math.abs(x));if(Number.isFinite(y))coordinateScale=Math.max(coordinateScale,Math.abs(y));}
 // Within this finite domain the padding bounds barycentric floating roundoff.
 // Queries outside it use the literal original loop, including NaN semantics.
 const queryBound=2*coordinateScale;
 let fallbackCount=0,regularCount=0,skipped=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(let id=0;id<n;id++){
  const i=id*12,j=id*COEFF,k=id*4,aw=clipTriangles[i+3],bw=clipTriangles[i+7],cw=clipTriangles[i+11];kind[id]=0;
  if(aw<=0||bw<=0||cw<=0){skipped++;continue;}
  const ax=clipTriangles[i]/aw,ay=clipTriangles[i+1]/aw,bx=clipTriangles[i+4]/bw,by=clipTriangles[i+5]/bw,cx=clipTriangles[i+8]/cw,cy=clipTriangles[i+9]/cw;
  const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
  if(Math.abs(den)<1e-14){skipped++;continue;}
  const edge=Math.abs(ax-cx)+Math.abs(ay-cy)+Math.abs(bx-cx)+Math.abs(by-cy),condition=edge*edge/Math.abs(den);
  if(!Number.isFinite(condition)||condition>1e6||coordinateScale>1e50||![ax,ay,bx,by,cx,cy,den,clipTriangles[i+2]/aw,clipTriangles[i+6]/bw,clipTriangles[i+10]/cw].every(Number.isFinite)){
   kind[id]=2;fallback[fallbackCount++]=id;continue;
  }
  c[j]=ax;c[j+1]=ay;c[j+2]=bx;c[j+3]=by;c[j+4]=cx;c[j+5]=cy;c[j+6]=den;
  const x0=Math.min(ax,bx,cx),x1=Math.max(ax,bx,cx),y0=Math.min(ay,by,cy),y1=Math.max(ay,by,cy);
  // a,b,c >= -TOL and a+b+c=1 can extend either axis by <=2*TOL*span.
  // The added IEEE guard covers arithmetic at queryBound and inverse condition;
  // ill-conditioned/nonfinite cases above deliberately take the original path.
  const guard=256*EPS*queryBound*(1+condition),padX=2*TOL*(x1-x0)+guard,padY=2*TOL*(y1-y0)+guard;
  b[k]=x0-padX;b[k+1]=y0-padY;b[k+2]=x1+padX;b[k+3]=y1+padY;kind[id]=1;regularCount++;
  minX=Math.min(minX,b[k]);minY=Math.min(minY,b[k+1]);maxX=Math.max(maxX,b[k+2]);maxY=Math.max(maxY,b[k+3]);
 }
 const dim=Math.max(1,Math.min(64,Math.ceil(Math.sqrt(regularCount/8)))),cells=dim*dim,sx=dim/(maxX-minX),sy=dim/(maxY-minY),counts=grow(w,'cellCounts',Uint32Array,cells),offsets=grow(w,'offsets',Uint32Array,cells+1),cursor=grow(w,'cursor',Uint32Array,cells);
 counts.fill(0,0,cells);
 const cellX=x=>Math.max(0,Math.min(dim-1,Math.floor((x-minX)*sx))),cellY=y=>Math.max(0,Math.min(dim-1,Math.floor((y-minY)*sy)));
 if(regularCount&&(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<=0||sy<=0)){
  for(let id=0;id<n;id++)if(kind[id]===1){kind[id]=2;fallback[fallbackCount++]=id;}
  regularCount=0;
 }
 if(regularCount)for(let id=0;id<n;id++)if(kind[id]===1){const k=id*4,x0=cellX(b[k]),x1=cellX(b[k+2]),y0=cellY(b[k+1]),y1=cellY(b[k+3]);for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)counts[y*dim+x]++;}
 offsets[0]=0;for(let i=0;i<cells;i++){offsets[i+1]=offsets[i]+counts[i];cursor[i]=offsets[i];}
 const refs=grow(w,'refs',Uint32Array,offsets[cells]);
 if(regularCount)for(let id=0;id<n;id++)if(kind[id]===1){const k=id*4,x0=cellX(b[k]),x1=cellX(b[k+2]),y0=cellY(b[k+1]),y1=cellY(b[k+3]);for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)refs[cursor[y*dim+x]++]=id;}
 const index=w.index??(w.index={});Object.assign(index,{triangles:clipTriangles,n,coeff:c,bounds:b,kind,fallback,fallbackCount,regularCount,skipped,queryBound,minX,minY,maxX,maxY,sx,sy,dim,offsets,refs,referenceCount:offsets[cells],stats:{queries:0,cellReferences:0,triangleTests:0,fullFallbackQueries:0}});return index;
}
function literalTriangleDepth(x,y,t,id){
 const i=id*12,aw=t[i+3],bw=t[i+7],cw=t[i+11];if(aw<=0||bw<=0||cw<=0)return Infinity;
 const ax=t[i]/aw,ay=t[i+1]/aw,bx=t[i+4]/bw,by=t[i+5]/bw,cx=t[i+8]/cw,cy=t[i+9]/cw;
 const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-14)return Infinity;
 const a=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/den,b=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/den,c=1-a-b;
 if(Math.min(a,b,c)<-1e-8)return Infinity;
 return a*t[i+2]/aw+b*t[i+6]/bw+c*t[i+10]/cw;
}
/** Same Math.min depth, both sides, tolerances and clip-w handling as frontDepth. */
export function frontDepthIndexed(x,y,index){
 const z=index,t=z.triangles,s=z.stats;s.queries++;
 if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z.queryBound)||Math.abs(x)>z.queryBound||Math.abs(y)>z.queryBound){s.fullFallbackQueries++;s.triangleTests+=z.n;return frontDepth(x,y,t);}
 let best=Infinity;
 for(let q=0;q<z.fallbackCount;q++){s.triangleTests++;best=Math.min(best,literalTriangleDepth(x,y,t,z.fallback[q]));}
 if(!z.regularCount||x<z.minX||y<z.minY||x>z.maxX||y>z.maxY)return best;
 const gx=Math.max(0,Math.min(z.dim-1,Math.floor((x-z.minX)*z.sx))),gy=Math.max(0,Math.min(z.dim-1,Math.floor((y-z.minY)*z.sy))),cell=gy*z.dim+gx,c=z.coeff;
 for(let q=z.offsets[cell];q<z.offsets[cell+1];q++){
  const id=z.refs[q],k=id*4;s.cellReferences++;if(x<z.bounds[k]||y<z.bounds[k+1]||x>z.bounds[k+2]||y>z.bounds[k+3])continue;
  s.triangleTests++;const i=id*12,j=id*COEFF,ax=c[j],ay=c[j+1],bx=c[j+2],by=c[j+3],cx=c[j+4],cy=c[j+5],den=c[j+6];
  const a=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/den,b=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/den,d=1-a-b;
  if(Math.min(a,b,d)<-1e-8)continue;
  best=Math.min(best,a*t[i+2]/t[i+3]+b*t[i+6]/t[i+7]+d*t[i+10]/t[i+11]);
 }
 return best;
}
/** With workspace, returned nodes/index are borrowed until its next call. */
export function projectNodesIndexed(points,p,triangles,workspace={}){
 const index=buildDepthIndex(triangles,workspace),nodes=grow(workspace,'nodes',Float64Array,(N+1)*NODE),tmp=grow(workspace,'tmp',Float64Array,4),plus=grow(workspace,'plus',Float64Array,4),minus=grow(workspace,'minus',Float64Array,4),eps=1e-5,counts={visible:0,hidden:0,noHair:0,behindEye:0};
 const view=p.view,vx=view[2]*p.right[0]+view[6]*p.right[1]+view[10]*p.right[2],vz=view[2]*p.forward[0]+view[6]*p.forward[1]+view[10]*p.forward[2],len=Math.hypot(vx,vz),hx=len*len<1e-10?0:vx/len,hz=len*len<1e-10?1:vz/len,back=hz*-.5+.5;
 for(let i=0;i<=N;i++){
  const [qx,qy,qz]=points[i],j=i*NODE;project(qx,qy,qz,p,tmp);const x=tmp[0]/tmp[3],y=tmp[1]/tmp[3],z=tmp[2]/tmp[3],depth=tmp[3]>0?frontDepthIndexed(x,y,index):Infinity;
  const state=tmp[3]<=0?3:depth===Infinity?2:z>depth+1e-8?1:0;
  project(qx,qy+eps,qz,p,plus);project(qx,qy-eps,qz,p,minus);
  nodes[j]=x;nodes[j+1]=y;nodes[j+2]=z;nodes[j+3]=(qx*hz-qz*hx)*K+.5+back*back*.75;nodes[j+4]=(plus[0]/plus[3]-minus[0]/minus[3])/(2*eps*K);nodes[j+5]=(plus[1]/plus[3]-minus[1]/minus[3])/(2*eps*K);nodes[j+6]=state;nodes[j+7]=qx;nodes[j+8]=qy;nodes[j+9]=qz;nodes[j+10]=depth;nodes[j+11]=tmp[3];
  if(i<N)counts[['visible','hidden','noHair','behindEye'][state]]++;
 }
 return {nodes,counts,index};
}
