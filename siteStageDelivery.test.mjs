import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
const source = fs.readFileSync(new URL('./scripts/site-smoke-stage-delivery.mjs', import.meta.url), 'utf8')
function extractFunction(text, name, end) {
  const start = text.indexOf('function ' + name + '(')
  assert.ok(start >= 0, 'Missing diagnostic function: ' + name)
  const stop = text.indexOf(end, start)
  assert.ok(stop > start, 'Missing diagnostic boundary: ' + name)
  return text.slice(start, stop)
}
function extracted(name, end) { return extractFunction(source, name, end) }
const read = viewer => Function('window', extracted('readStageState', '\nconst stageState =') + '\nreturn readStageState()')({scene: viewer})
const failures = Function(extracted('unresolvedStageFailures', '\nlet result') + '\nreturn unresolvedStageFailures')()
const mesh = texture => ({isMesh:true, material:{map:texture, uniforms:{same:{value:texture}}}})
const tree = nodes => ({isScene:true,traverse:visit=>nodes.forEach(visit)})
function fixture() {
  return {scene:tree([mesh(),mesh()]),backgroundScene:tree([]),backgroundSceneEnabled:false,
    renderer:{getPixelRatio:()=>1},effects:{effectiveAntiAliasing:'SMAA'}}
}
test('counts stage geometry in backgroundScene instead of unrelated foreground actors', () => {
  const viewer=fixture(), before=read(viewer)
  viewer.backgroundScene=tree([mesh({isTexture:true,image:{width:32,height:32}})])
  viewer.backgroundSceneEnabled=true
  const after=read(viewer)
  assert.equal(before.foregroundMeshes,after.foregroundMeshes)
  assert.equal(before.backgroundMeshes,0)
  assert.equal(after.backgroundMeshes,1)
  assert.equal(after.readyTextures,1)
  assert.equal(after.textures,1,'duplicate material references share one texture')
  assert.equal(after.enabled,true)
})
test('a new foreground actor cannot impersonate a loaded stage', () => {
  const viewer=fixture()
  viewer.scene=tree([mesh(),mesh(),mesh()])
  const state=read(viewer)
  assert.equal(state.backgroundMeshes,0)
  assert.equal(state.readyTextures,0)
})
test('material texture census handles arrays, cube faces and missing images', () => {
  const viewer=fixture()
  const ready={isTexture:true,image:Array.from({length:6},()=>({width:16,height:16}))}
  const pending={isTexture:true,image:undefined}
  viewer.backgroundScene=tree([{isMesh:true,material:[{uniforms:{cube:{value:ready},pending:{value:pending}}}]}])
  const state=read(viewer)
  assert.equal(state.textures,2);assert.equal(state.readyTextures,1)
})
test('absent stage scene fails rather than silently checking another Three.Scene', () => {
  const viewer=fixture();delete viewer.backgroundScene
  assert.throws(()=>read(viewer),/background scene/)
})
test('only canceled duplicate requests with a fully completed replacement may be ignored', () => {
  const url='https://fixture.test/stages/official/a/map.png'
  const aborted={url,error:'net::ERR_ABORTED'}
  assert.deepEqual(failures([aborted],new Set([url])),[])
  assert.deepEqual(failures([aborted],new Set()),[aborted])
  const broken={url,error:'net::ERR_FAILED'}
  assert.deepEqual(failures([broken],new Set([url])),[broken])
})
test('recorded network response URLs are strings and require completed transfers', () => {
  assert.match(source,/responses\.filter\(response => response\.url\.startsWith\(base \+ root\.slice\(1\)\) && completed\.has\(response\.url\)\)/)
  assert.match(source,/protocolTimeout: 300000/)
  assert.match(source,/await waitForBackground\(before\)/)
})

const cloudflare = fs.readFileSync(new URL('./scripts/site-smoke-cloudflare.mjs', import.meta.url), 'utf8')
const authored = Function(extractFunction(cloudflare, 'authoredProfileView', '\nfunction classifyStageTransferFailures') + '\nreturn authoredProfileView')()
const classify = Function(extractFunction(cloudflare, 'classifyStageTransferFailures', '\nfunction canonicalJson') + '\nreturn classifyStageTransferFailures')()
const canonical = Function(extractFunction(cloudflare, 'canonicalJson', '\nfunction sceneState') + '\nreturn canonicalJson')()
const profileUrl = 'https://magius3dviewer.pages.dev/stages/official/battle-616-00-01-001/scene-profile.json'
const abortedProfile = {url:profileUrl,method:'GET',error:'net::ERR_ABORTED'}
const proof = () => ({url:profileUrl,profileMatches:true,drawn:true,stageCorrect:true,httpStatus:200})

test('Cloudflare profile comparison removes only build-owned animation additions and leaves inputs intact', () => {
  const expected={schemaVersion:1,stageId:'fixture',runtime:{loop:false},sourceRecords:{stageCab:'native'}}
  const consumed={...structuredClone(expected),runtime:{loop:false,autoplay:true,transformAnimations:{tracks:[]}}}
  const saved=structuredClone(consumed)
  assert.deepEqual(authored(consumed,expected),expected)
  assert.deepEqual(consumed,saved)
  const withoutRuntime={schemaVersion:1}
  assert.deepEqual(authored({...withoutRuntime,runtime:{autoplay:true,transformAnimations:{}}},withoutRuntime),withoutRuntime)
})
test('authored animation fields and unrelated extra fields cannot be concealed by profile comparison', () => {
  const expected={schemaVersion:1,runtime:{autoplay:false,transformAnimations:{duration:1}}}
  const changed=structuredClone(expected);changed.runtime.autoplay=true
  assert.notDeepEqual(authored(changed,expected),expected)
  const extra={schemaVersion:1,runtime:{autoplay:true,transformAnimations:{},unexpected:'changed'}}
  assert.notDeepEqual(authored(extra,{schemaVersion:1}),{schemaVersion:1})
})
for(const [field,value] of [['schemaVersion',2],['stageId','wrong-stage'],['renderProfile',{exposure:99}],['materialBindings',[]]]) {
  test('profile comparison detects altered authored '+field, () => {
    const expected={schemaVersion:1,stageId:'fixture',renderProfile:{exposure:1},materialBindings:[{materialName:'floor'}]}
    const changed={...structuredClone(expected),[field]:value}
    assert.notDeepEqual(authored(changed,expected),expected)
  })
}
test('only a fully proven consumed and drawn profile resolves a lone CDP cancellation', () => {
  assert.deepEqual(classify([abortedProfile],new Set(),proof()),[])
  assert.deepEqual(classify([abortedProfile],new Set(),undefined),[abortedProfile])
  assert.deepEqual(classify([abortedProfile],new Set([profileUrl]),undefined),[])
})
for(const [field,value] of [['profileMatches',false],['drawn',false],['stageCorrect',false],['httpStatus',404],['url',profileUrl+'?another=1']]) {
  test('unproven profile cancellation stays an error when '+field+' is invalid', () => {
    assert.deepEqual(classify([abortedProfile],new Set(),{...proof(),[field]:value}),[abortedProfile])
  })
}
test('profile proof cannot hide a missing texture, CORS failure or a failed profile transfer', () => {
  const texture={url:profileUrl.replace('scene-profile.json','texture.png'),error:'net::ERR_ABORTED'}
  assert.deepEqual(classify([texture],new Set(),proof()),[texture])
  for(const error of ['net::ERR_FAILED','net::ERR_CONNECTION_RESET','net::ERR_BLOCKED_BY_RESPONSE']) {
    const failed={...abortedProfile,error}
    assert.deepEqual(classify([failed],new Set([profileUrl]),proof()),[failed])
  }
})
test('canonical profile evidence ignores object ordering but preserves array ordering and values', () => {
  assert.equal(canonical({b:2,a:[1,3]}),canonical({a:[1,3],b:2}))
  assert.notEqual(canonical({a:[1,3]}),canonical({a:[3,1]}))
  assert.notEqual(canonical({a:1}),canonical({a:'1'}))
})
test('Cloudflare acceptance requires actual draw submission, exact consumed JSON and all material textures', () => {
  assert.match(cloudflare,/after\.accepted && after\.drawnMeshes > 0 && after\.drawProbeComplete/)
  assert.match(cloudflare,/assert\.equal\(after\.readyTextures, after\.textures/)
  assert.match(cloudflare,/assert\.deepEqual\(authoredView,expectedProfile/)
  assert.match(cloudflare,/userData\.sceneProfilePackage/)
  assert.match(cloudflare,/assert\.deepEqual\(rejectedRepositoryRequests, \[\]/)
  assert.match(cloudflare,/assert\.equal\(catalog\.bundledStageBaseUrl, undefined/)
})
