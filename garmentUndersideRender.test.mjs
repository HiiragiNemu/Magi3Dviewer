import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as T from 'three';import ts from 'typescript';
const {GarmentSurfaceContact}=await import('./src/viewer/garmentSurfaceContact.ts');
const compiled=ts.transpileModule(fs.readFileSync('magia-exedra-character-three/shaders/outline.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;?\r?\n/gm,'');
fs.mkdirSync('.garment-render-test',{recursive:true});
fs.writeFileSync(new URL('./.garment-render-test/outline-test-module.mjs',import.meta.url),`import * as THREE from 'three';const toonStylizationOptions={characterTint:'#ffffff'};const ReDriveBakedNormalAttribute='reDriveBakedNormal';\n`+compiled);
const {createOutlineMaterial}=await import('./.garment-render-test/outline-test-module.mjs');
function fixture({reverse=false,gem=false,side=T.FrontSide}={}){
 const root=new T.Group(),bone=new T.Bone();root.add(bone);const g=new T.BufferGeometry();
 const p=[-.1,0,0,.1,0,0,0,.2,0, .4,0,0,.6,0,0,.5,.2,0];if(reverse)p.push(0,.2,0,.1,0,0,-.1,0,0);
 const count=p.length/3;g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('normal',new T.Float32BufferAttribute(Array(count).fill([0,0,1]).flat(),3));g.setAttribute('reDriveBakedNormal',g.getAttribute('normal').clone());g.setAttribute('skinIndex',new T.Uint16BufferAttribute(Array(count*4).fill(0),4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(Array(count).fill([1,0,0,0]).flat(),4));g.setAttribute('uv',new T.Float32BufferAttribute(Array(count).fill([.2,.3]).flat(),2));
 g.addGroup(0,3,1);g.addGroup(3,3,0);if(reverse)g.addGroup(6,3,1);
 const texture=new T.Texture(),body=new T.MeshStandardMaterial(),cloth=new T.MeshStandardMaterial({map:texture,alphaTest:.3,side});cloth.name='native-cloth';
 class Metadata{};cloth.userData=Object.assign(new Metadata(),{officialMaterialProfile:{gem:{enabled:gem}},shader:{uniforms:{}}});cloth.userData.shader.self=cloth.userData.shader;
 cloth.onBeforeCompile=function(s){this.userData.shader=s;s.uniforms.test={value:42}};cloth.customProgramCacheKey=()=> 'native-slot';
 const mesh=new T.SkinnedMesh(g,[body,cloth]);root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new T.Skeleton([bone]));
 const draw=new T.BufferGeometry();for(const [k,a]of Object.entries(g.attributes))draw.setAttribute(k,a);draw.setDrawRange(0,3);
 const outlineMaterial=createOutlineMaterial({outlineZOffset:.001}),outline=new T.SkinnedMesh(draw,outlineMaterial);outline.name='Body:official-outline:1';outline.bind(mesh.skeleton,mesh.bindMatrix);mesh.add(outline);
 const compile=outlineMaterial.onBeforeCompile,key=outlineMaterial.customProgramCacheKey;
 const solver=new GarmentSurfaceContact(root,[0,1,2].map(index=>({mesh,index,node:bone,preferred:new T.Vector3(0,0,1)})),1);
 const update=()=>{root.updateMatrixWorld(true);return solver.project([],new T.Quaternion(),()=>false)};update();
 return{root,mesh,g,body,cloth,texture,solver,outline,outlineMaterial,compile,key,update,Metadata};
}
function inner(f){return f.mesh.children.find(n=>n.name.includes(':official-cloth-inner:'))}
function program(material){const s={vertexShader:material.vertexShader,fragmentShader:material.fragmentShader,uniforms:{...material.uniforms}};material.onBeforeCompile(s,{});return s}
test('FRONT defect: cloth outline checks original winding instead of accepting an extrusion-flipped front triangle',()=>{
 const f=fixture(),s=program(f.outlineMaterial);assert.match(s.fragmentShader,/GARMENT_ORIGINAL_FRONT_GUARD/);assert.match(s.vertexShader,/vGarmentOriginalVS = mvPosition.xyz/);assert.match(s.fragmentShader,/dot\(originalCross, originalView\) <= 0.0/);assert.equal(s.uniforms.uGarmentFoldGuardEnabled.value,1);
 const mask=f.outline.geometry.getAttribute('garmentClothMask');assert.deepEqual([...mask.array],[1,1,1,0,0,0]);
 // The expanded triangle has clockwise screen winding but the source is
 // counter-clockwise. Its original-to-raster Jacobian is negative.
 const source=[[0,0],[2,0],[0,2]],raster=[[0,0],[-1,0],[0,2]];
 const area=t=>(t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0]);
 assert.ok(area(source)/area(raster)<0,'front-overpaint must be rejected');assert.ok(area(raster)/area(raster)>0,'a true silhouette backface remains admitted');
 f.solver.restore(true);assert.equal(s.uniforms.uGarmentFoldGuardEnabled.value,0);f.solver.dispose();assert.equal(f.outlineMaterial.onBeforeCompile,f.compile);assert.equal(f.outlineMaterial.customProgramCacheKey,f.key);assert.equal(f.mesh.geometry,f.g);
});
test('INNER defect: exposed cloth gets its native slot shader and exact same positions, normals, UV and skin/morph data',()=>{
 const f=fixture(),view=inner(f);assert.ok(view?.visible,'v4 leaves the coloured inner face missing');const m=view.material[0];
 assert.equal(m.side,T.BackSide);assert.equal(f.cloth.side,T.FrontSide);assert.equal(m.map,f.texture);assert.equal(m.alphaTest,.3);assert.equal(m.onBeforeCompile,f.cloth.onBeforeCompile);assert.ok(m.userData instanceof f.Metadata);assert.equal(m.userData.shader,undefined);assert.equal(m.userData.officialMaterialProfile,f.cloth.userData.officialMaterialProfile);
 for(const name of ['position','normal','reDriveBakedNormal','uv','skinIndex','skinWeight'])assert.equal(view.geometry.getAttribute(name),f.mesh.geometry.getAttribute(name));assert.deepEqual([...view.geometry.index.array],[0,1,2]);assert.equal(view.skeleton,f.mesh.skeleton);assert.equal(view.material.length,1);assert.ok(view.material.every(Boolean),'depth/shadow traversals must never see sparse material arrays');
 const shader={uniforms:{}};m.onBeforeCompile(shader,{});assert.equal(shader.uniforms.test.value,42);assert.notEqual(m.userData.shader,f.cloth.userData.shader);
 let seen;f.mesh.onBeforeRender=function(r,s,c,g,m,group){seen={self:this,material:m,slot:group.materialIndex}};view.onBeforeRender({},null,null,view.geometry,m,view.geometry.groups[0]);assert.equal(seen.self,f.mesh);assert.equal(seen.slot,1);assert.equal(seen.material,m);
 f.cloth.opacity=.4;f.update();assert.equal(m.opacity,.4);assert.equal(m.userData.shader,shader,'compiled inner uniforms survive per-frame material sync');
 const replacement=new T.MeshBasicMaterial({map:f.texture});f.mesh.material[1]=replacement;f.update();assert.equal(view.material[0].type,'MeshBasicMaterial','late texture/material delivery must replace the helper material class');assert.equal(view.material[0].map,f.texture);f.mesh.material[1]=f.cloth;f.update();
 f.solver.restore(true);assert.equal(view.visible,false);f.solver.dispose();assert.ok(!view.parent);assert.equal(f.mesh.geometry,f.g);assert.equal(f.mesh.material[1],f.cloth);
});
test('coloured underside really occludes the black hull while the original outer contour still exists',()=>{
 const f=fixture(),view=inner(f);assert.ok(view?.visible);f.root.updateMatrixWorld(true);
 const ray=new T.Raycaster(new T.Vector3(0,.05,-1),new T.Vector3(0,0,1));
 // raycast override intentionally omits helper from editor selection; use the
 // underlying render triangle's actual culling for this depth regression.
 const hit=[];T.SkinnedMesh.prototype.raycast.call(view,ray,hit);assert.ok(hit.length>0);assert.ok(ray.intersectObject(f.mesh,false).length===0);assert.equal(f.outlineMaterial.side,T.BackSide);assert.ok(f.outline.visible);
 f.solver.dispose();
});
test('body slots, gems and already double-sided slots do not become extra cloth colour draws',()=>{
 for(const settings of [{gem:true},{side:T.DoubleSide}]){const f=fixture(settings);assert.ok(!inner(f).visible);assert.equal(f.body.side,T.FrontSide);assert.equal(f.cloth.side,settings.side??T.FrontSide);f.solver.dispose()}
 const f=fixture({reverse:true});assert.equal(inner(f),undefined,'native opposite-face lining must not be doubled');f.solver.dispose();
});
test('deformed buffers and texture alpha remain coherent across contact toggles and independent actors',()=>{
 for(let n=0;n<3;n++){const a=fixture(),b=fixture(),native=a.g.getAttribute('position').array.slice();a.solver.project([{start:new T.Vector3(0,-.1,0),end:new T.Vector3(0,.3,0),worldRadius:.06}],new T.Quaternion(),()=>false);assert.notDeepEqual(a.mesh.geometry.getAttribute('position').array,native);assert.equal(inner(a).geometry.getAttribute('position'),a.mesh.geometry.getAttribute('position'));assert.deepEqual(b.g.getAttribute('position').array,native);a.solver.dispose();b.solver.dispose();assert.deepEqual(a.g.getAttribute('position').array,native)}
});
