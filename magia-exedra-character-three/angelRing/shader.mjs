export const realtimeGLSL=`
uniform sampler2D tArfNodes;
uniform sampler2D tArfSegments;
uniform float uArfNodeWidth;
uniform vec2 uArfSegmentSize;
uniform float uArfNodeCount;
uniform float uArfLiveActive;
vec4 arfNodeTexel(int index) { return texture2D(tArfNodes,vec2((float(index)+0.5)/uArfNodeWidth,0.5)); }
vec4 arfSegmentTexel(int index) { float i=float(index);return texture2D(tArfSegments,(vec2(mod(i,uArfSegmentSize.x),floor(i/uArfSegmentSize.x))+0.5)/uArfSegmentSize); }
float arfBoxDistance(vec2 p,vec4 b) { vec2 d=max(max(b.xy-p,vec2(0.0)),p-b.zw);return dot(d,d); }
vec3 rdArfQueryUv(vec2 p) {
 if(uArfNodeCount<0.5)return vec3(0.0);
 int stack[16];int pending=1;stack[0]=0;
 float best=1.e30;float bestId=-1.0;vec3 result=vec3(0.0);
 for(int iteration=0;iteration<511;iteration++){
  if(pending==0)break;int n=stack[--pending];
  vec4 b=arfNodeTexel(n*2);if(arfBoxDistance(p,b)>best)continue;
  vec4 info=arfNodeTexel(n*2+1);int count=int(info.w+0.5);
  if(count==0){
   int left=int(info.x+0.5),right=int(info.y+0.5);
   float dl=arfBoxDistance(p,arfNodeTexel(left*2)),dr=arfBoxDistance(p,arfNodeTexel(right*2));
   if(dl<dr){if(dr<=best)stack[pending++]=right;if(dl<=best)stack[pending++]=left;}
   else {if(dl<=best)stack[pending++]=left;if(dr<=best)stack[pending++]=right;}
  }else{
   int start=int(info.z+0.5);
   for(int k=0;k<4;k++){
    if(k>=count)break;
    vec4 a=arfSegmentTexel((start+k)*4),b=arfSegmentTexel((start+k)*4+1),c=arfSegmentTexel((start+k)*4+2),j=arfSegmentTexel((start+k)*4+3);
    vec2 f=p-a.xy,direction=a.zw;float t=clamp(dot(f,direction)/b.x,0.0,1.0);vec2 delta=f-direction*t;float distance2=dot(delta,delta);
    if(distance2>best)continue;
    vec2 transverse=vec2(b.w+c.x*t,c.y+c.z*t);float jac=(1.0-t)*j.x+t*j.y;
    if(abs(jac)<1.e-10*sqrt(b.x*dot(transverse,transverse)))continue;
    if(distance2==best&&c.w<bestId)continue;
    best=distance2;bestId=c.w;
    result=vec3(b.y+b.z*t,0.5+(direction.x*delta.y-direction.y*delta.x)/jac,1.0);
   }
  }
 }
 return result;
}
vec3 rdArfLiveUv(vec2 originalUv) {
 if(uArfLiveActive<0.5)return vec3(originalUv,1.0);
 return rdArfQueryUv(2.0*gl_FragCoord.xy/uAngelRingViewportSize-1.0);
}
`;
export function patchLiveShader(shader,uniforms){
 const original=shader.fragmentShader;
 const declaration='uniform vec2 uAngelRingViewportSize;';
 if(!original.includes(declaration))throw Error('VIEWPORT_DECLARATION_MISSING');
 const target=/float\s+rdAngelMap\s*=\s*texture2D\(\s*tAngelRingMap\s*,\s*rdAngelMapUv\s*\)\.r\s*;/g;
 if([...original.matchAll(target)].length!==1)throw Error('PROJECTED_SAMPLE_MATCH_COUNT');
 for(const key of Object.keys(uniforms))if(Object.hasOwn(shader.uniforms,key))throw Error('UNIFORM_COLLISION:'+key);
 Object.assign(shader.uniforms,uniforms);
 shader.fragmentShader=original.replace(declaration,declaration+'\n'+realtimeGLSL).replace(target,'vec3 arfUv=rdArfLiveUv(rdAngelMapUv); float rdAngelMap=texture2D(tAngelRingMap,arfUv.xy).r*arfUv.z;');
 return ()=>{shader.fragmentShader=original;for(const k of Object.keys(uniforms))if(shader.uniforms[k]===uniforms[k])delete shader.uniforms[k];};
}
