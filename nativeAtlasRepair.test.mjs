import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const report=JSON.parse(fs.readFileSync('docs/reports/2026-10-01-atlas-repair.json','utf8')),census=JSON.parse(fs.readFileSync('docs/reports/2026-10-01-atlas-census.json','utf8')),inputs=JSON.parse(fs.readFileSync('docs/reports/2026-10-01-atlas-inputs.json','utf8'));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),root=new Map(inputs.map(r=>[r.model,r.assetDirectory])),repaired=new Map(report.repairedFiles.map(r=>[r.name,r]));
test('atlas census covers all shipped ordinary/story FBX resource directories, not only VisualRoot filenames',()=>{
 const actual=[];for(const base of ['magia-exedra-character-three/models','magia-exedra-character-three/nonbattle-models'])for(const folder of fs.readdirSync(base,{withFileTypes:true})){if(folder.isDirectory()&&fs.readdirSync(path.join(base,folder.name)).some(n=>/\.fbx(?:\.gz)?$/.test(n)))actual.push(folder.name)}
 assert.equal(actual.length,98);assert.deepEqual(census.models.map(r=>r.model).sort(),actual.sort());assert.equal(new Set(census.models.map(r=>r.model)).size,98);assert.equal(census.models.reduce((n,r)=>n+r.textures.length,0),1619)
 assert.equal(census.proceduralModelException.model,'chara_113401_model');assert.equal(census.models.find(r=>r.model==='chara_113401_model').textures.length,0)
})
test('only native-material-linked, exact-mesh-UV proven complete texture triples replace the affected atlas sets',()=>{
 assert.equal(repaired.size,12);assert.deepEqual([...new Set(report.repairedFiles.map(r=>r.model))].sort(),['chara_101401_battle_unit','chara_101501_battle_unit'])
 for(const r of report.repairedFiles){assert.equal(sha(path.join(root.get(r.model),r.name+'.png')),r.afterPngSha256);assert.notEqual(r.beforePngSha256,r.afterPngSha256);assert.ok(r.meshes.length);assert.ok(r.meshes.every(m=>m.maxUVError<1e-5&&m.vertexCount>0));assert.ok(r.materialBindings.some(m=>m.textures.some(t=>t.textureName===r.name&&t.texturePathId===r.texturePathId)));assert.equal(r.nativeRGBA256.length,64)}
 const groups=new Map();for(const r of report.repairedFiles){const k=r.model+'|'+r.pairedSet;groups.set(k,[...(groups.get(k)||[]),r.name.split('_').at(-1)])}for(const kinds of groups.values())assert.deepEqual(kinds.sort(),['color','ctrl','shadow'])
})
test('the 1,619 audited atlas files remain byte-identical outside the twelve specifically proven repairs',()=>{
 let count=0;for(const model of census.models)for(const t of model.textures){const expected=repaired.get(t.name)?.afterPngSha256??t.fileSha256;assert.equal(sha(path.join(root.get(model.model),t.name+'.png')),expected,model.model+'/'+t.name);count++}assert.equal(count,1619)
})
test('common exporter UV triangle-order/triangulation differences are not mislabeled as atlas corruption',()=>{
 assert.equal(report.nonAtlasMeshComparisonDetails.length,5);for(const r of report.nonAtlasMeshComparisonDetails){assert.equal(r.uvIslandVertexSetEqual,true);assert.equal(r.uvBoundaryEqual,true);assert.equal(r.boundaryDifference,0);assert.ok(r.totalUVAreaDifference<1e-7)}
 assert.equal(report.excludedCandidates.length,2);for(const r of report.excludedCandidates){assert.equal(r.edited,false);assert.ok(r.rgbCorrelation>.99)}
 assert.deepEqual(report.newAffectedCharacterIds,['101501']);assert.ok(report.provenanceClarification['101002'].includes('Git revision'))
})
