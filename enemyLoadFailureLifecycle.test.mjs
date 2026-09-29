import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source=fs.readFileSync(new URL('./src/viewer/enemies/loader.ts',import.meta.url),'utf8')
const start=source.indexOf('export class FbxEnemyModelLoader')
const end=source.indexOf('export class EnemyInstance',start)
assert.ok(start>=0&&end>start)
const code=ts.transpileModule(source.slice(start,end).replace('export class','class'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
class ResourceError extends Error {constructor(code,message,details){super(message);this.code=code;this.details=details}}
const delay=(ms,value,reject=false)=>new Promise((resolve,fail)=>setTimeout(()=>reject?fail(value):resolve(value),ms))
const entry={enemyMstId:600001,enemyUniqueId:'fixture',modelPrefabName:'enemy_fixture',model:{renderReady:true,runtimeUrl:'/enemy.fbxdata'}}
function fixture(overrides={}) {
 const object={userData:{}},disposed=[],trace=[]
 const deps={
  THREE:{LoadingManager:class {setURLModifier(){}}},
  FBXLoader:class {parse(){trace.push('parse');return object}},
  EnemyResourceError:ResourceError,absoluteUrl:x=>'https://fixture.invalid'+x,
  resolveRuntimeAssetUrl:async x=>x,resolveCachedRuntimeAssetUrl:x=>x,
  fetchAndTryDecompressGzip:async()=>{trace.push('model');return new Blob(['model'])},
  fetchMaterialProfileProduct:async()=>{trace.push('material');return {schema:'fixture'}},
  loadEnemyMaterialRuntimeTextures:async()=>new Map(),applyEnemyMaterialProfileProduct:()=>trace.push('apply'),
  getLoadingTask:()=>undefined,yieldLoadingFrame:async()=>{},disposeObject:o=>disposed.push(o),...overrides,
 }
 const Loader=Function(...Object.keys(deps),code+'\nreturn FbxEnemyModelLoader')(...Object.values(deps))
 return {loader:new Loader(),object,disposed,trace}
}
test('model and later material failures are both observed, with no detached rejection',async()=>{
 const f=fixture({fetchAndTryDecompressGzip:()=>delay(1,new Error('model failed'),true),fetchMaterialProfileProduct:()=>delay(20,new Error('material failed later'),true)})
 await assert.rejects(f.loader.load(entry),error=>error.code==='MODEL_HTTP_ERROR'&&error.details.cause.message==='model failed')
 await delay(40)
 assert.equal(f.trace.includes('parse'),false)
})
test('material failure is observed before a slow model, retaining the typed diagnostic',async()=>{
 const error=new ResourceError('MODEL_PARSE_ERROR','invalid material identity')
 const f=fixture({fetchAndTryDecompressGzip:()=>delay(35,new Error('late model failure'),true),fetchMaterialProfileProduct:()=>delay(1,error,true)})
 await assert.rejects(f.loader.load(entry),actual=>actual===error)
 await delay(50)
})
test('successful parallel resources are parsed and retained, not disposed',async()=>{
 const f=fixture()
 assert.equal(await f.loader.load(entry),f.object)
 assert.equal(f.object.userData.enemyMstId,600001)
 assert.equal(f.disposed.length,0)
 assert.deepEqual(new Set(f.trace.slice(0,2)),new Set(['model','material']))
 assert.deepEqual(f.trace.slice(2),['parse','apply'])
})
test('texture loading failure disposes the parsed candidate, retaining the resource error',async()=>{
 const error=new ResourceError('TEXTURE_HTTP_ERROR','texture unavailable')
 const f=fixture({loadEnemyMaterialRuntimeTextures:async()=>{throw error}})
 await assert.rejects(f.loader.load(entry),actual=>actual===error)
 assert.deepEqual(f.disposed,[f.object])
})
test('material binding failure cleans up both temporary textures and parsed candidate',async()=>{
 let texturesDisposed=0
 const f=fixture({loadEnemyMaterialRuntimeTextures:async()=>new Map([['a',{dispose(){texturesDisposed++}}]]),applyEnemyMaterialProfileProduct:()=>{throw new Error('binding failed')}})
 await assert.rejects(f.loader.load(entry),error=>error.code==='MODEL_PARSE_ERROR')
 assert.equal(texturesDisposed,1);assert.deepEqual(f.disposed,[f.object])
})
test('abort during texture loading cannot publish a stale parsed model',async()=>{
 const controller=new AbortController()
 const f=fixture({loadEnemyMaterialRuntimeTextures:async()=>{controller.abort();return new Map()}})
 await assert.rejects(f.loader.load(entry,controller.signal))
 assert.deepEqual(f.disposed,[f.object])
})
test('unready model does not start either request',async()=>{
 const f=fixture()
 await assert.rejects(f.loader.load({...entry,model:{renderReady:false,runtimeUrl:null}}),error=>error.code==='MODEL_NOT_READY')
 assert.deepEqual(f.trace,[])
})
test('cancelled or rejected model parsing is not misreported as a successful load',async()=>{
 const f=fixture({FBXLoader:class {parse(){throw new Error('invalid FBX')}}})
 await assert.rejects(f.loader.load(entry),error=>error.code==='MODEL_PARSE_ERROR')
 assert.equal(f.disposed.length,0)
})
