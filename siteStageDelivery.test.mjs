import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
const source = fs.readFileSync(new URL('./scripts/site-smoke-stage-delivery.mjs', import.meta.url), 'utf8')
function extracted(name, end) {
  const start = source.indexOf('function ' + name + '(')
  assert.ok(start >= 0)
  const stop = source.indexOf(end, start)
  assert.ok(stop > start)
  return source.slice(start, stop)
}
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
