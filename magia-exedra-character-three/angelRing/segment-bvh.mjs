// Exact nearest-segment search over the existing fixed-Q segments. The tree
// changes traversal only: no curve simplification, texture field, or ROI crop.
export const STRIDE=11,LEAF=4,MAX_NODES=511,MAX_STACK=16;
export function buildSegmentTree(segments){
 const count=segments.ids.length;
 if(count>1024||segments.values.length!==count*STRIDE)throw Error('SEGMENT_LAYOUT');
 const ids=Array.from({length:count},(_,i)=>i),nodes=[],ordered=[];
 const s=segments.values;
 function visit(order){
  const index=nodes.length,node={bounds:[Infinity,Infinity,-Infinity,-Infinity],left:-1,right:-1,start:0,count:0};nodes.push(node);
  for(const id of order){const j=id*STRIDE,x=s[j],y=s[j+1],ex=x+s[j+2],ey=y+s[j+3];node.bounds[0]=Math.min(node.bounds[0],x,ex);node.bounds[1]=Math.min(node.bounds[1],y,ey);node.bounds[2]=Math.max(node.bounds[2],x,ex);node.bounds[3]=Math.max(node.bounds[3],y,ey);}
  if(order.length<=LEAF){node.start=ordered.length;node.count=order.length;ordered.push(...order);}
  else{const axis=node.bounds[2]-node.bounds[0]>=node.bounds[3]-node.bounds[1]?0:1;order.sort((a,b)=>(s[a*STRIDE+axis]+s[a*STRIDE+axis+2]*.5)-(s[b*STRIDE+axis]+s[b*STRIDE+axis+2]*.5)||a-b);const mid=order.length>>1;node.left=visit(order.slice(0,mid));node.right=visit(order.slice(mid));}
  return index;
 }
 if(count)visit(ids);
 if(nodes.length>MAX_NODES)throw Error('TREE_NODE_CAP');
 const nodeData=new Float32Array(Math.max(1,nodes.length)*8),segmentData=new Float32Array(Math.max(1,count)*16);
 nodes.forEach((node,i)=>{
  const b=node.bounds,pad=8*2**-23*Math.max(1,...b.map(Math.abs));
  nodeData.set([b[0]-pad,b[1]-pad,b[2]+pad,b[3]+pad,node.left,node.right,node.start,node.count],i*8);
 });
 ordered.forEach((id,i)=>{const j=id*STRIDE,k=i*16;segmentData.set(s.subarray(j,j+STRIDE),k);segmentData[k+11]=segments.ids[id];
  // Cross products are evaluated before Float32 packing to preserve near-parallel
  // transverse vectors that would otherwise collapse into a zero Jacobian.
  segmentData[k+12]=s[j+2]*s[j+9]-s[j+3]*s[j+7];
  segmentData[k+13]=s[j+2]*(s[j+9]+s[j+10])-s[j+3]*(s[j+7]+s[j+8]);
 });
 if(!nodeData.every(Number.isFinite)||!segmentData.every(Number.isFinite))throw Error('NONFINITE_GPU_TREE');
 return {segments,nodes,ordered,nodeData,segmentData,nodeCount:nodes.length,segmentCount:count};
}
const boxDistance=(x,y,b)=>{const dx=Math.max(b[0]-x,0,x-b[2]),dy=Math.max(b[1]-y,0,y-b[3]);return dx*dx+dy*dy;};
export function sampleTree(x,y,tree,out=new Float64Array(5),stats={}){
 let best=Infinity,found=0,bestId=-1;const stack=tree.nodeCount?[0]:[];stats.nodes=0;stats.segments=0;stats.maxStack=stack.length;
 const source=tree.segments.values;
 while(stack.length){
  const id=stack.pop(),node=tree.nodes[id];stats.nodes++;
  if(boxDistance(x,y,node.bounds)>best)continue;
  if(!node.count){const a=node.left,b=node.right,da=boxDistance(x,y,tree.nodes[a].bounds),db=boxDistance(x,y,tree.nodes[b].bounds);if(da<db){if(db<=best)stack.push(b);if(da<=best)stack.push(a);}else{if(da<=best)stack.push(a);if(db<=best)stack.push(b);}stats.maxStack=Math.max(stats.maxStack,stack.length);continue;}
  for(let i=node.start;i<node.start+node.count;i++){
   stats.segments++;const order=tree.ordered[i],j=order*STRIDE,fx=x-source[j],fy=y-source[j+1],dx=source[j+2],dy=source[j+3],l=source[j+4],t=Math.max(0,Math.min(1,(fx*dx+fy*dy)/l)),px=fx-dx*t,py=fy-dy*t,d=px*px+py*py;
   if(found&&best<d)continue;const tx=source[j+7]+source[j+8]*t,ty=source[j+9]+source[j+10]*t,jac=dx*ty-dy*tx;
   if(Math.abs(jac)<1e-10*Math.sqrt(l*(tx*tx+ty*ty)))continue;
   const sid=tree.segments.ids[order];if(found&&d===best&&sid<bestId)continue;
   best=d;found=1;bestId=sid;out[0]=source[j+5]+source[j+6]*t;out[1]=.5+(dx*py-dy*px)/jac;out[3]=sid;out[4]=d;
  }
 }
 out[2]=found;if(!found){out[0]=out[1]=0;out[3]=-1;out[4]=Infinity;}return out;
}
