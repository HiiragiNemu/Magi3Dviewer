import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import ts from 'typescript'
import { startLoadingTask, readLoadingResponse, subscribeLoadingProgress, withLoadingTask } from './magia-exedra-character-three/loadingProgress.ts'
import { createLoadingProgressPanel } from './src/viewer/loadingProgressPanel.ts'
import { JSDOM } from 'file:///D:/magia/.codex-work/magius3dviewer-s6-unified-build-20260906-v11-verification/worker-dispatch-20260908/ui/audio-track-authoring/dom-fixture/node_modules/jsdom/lib/api.js'
const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const pause = n => new Promise(resolve => setTimeout(resolve, n))
function response(headers = {}, fail = false) {
    let cursor = 0
    return new Response(new ReadableStream({ async pull(controller) {
        await pause(2)
        if (fail && cursor === 2) { controller.error(new Error('stream failed')); return }
        if (cursor === 4) { controller.close(); return }
        controller.enqueue(new Uint8Array([cursor * 2, cursor * 2 + 1])); cursor++
    } }), { headers })
}
test('throttled stream publishes at least 3 genuine intermediate byte/ratio values before EOF', async () => {
    const task = startLoadingTask('fixture'), snapshots = []
    const stop = subscribeLoadingProgress(state => { if (state.taskId === task.id) snapshots.push(state) })
    const bytes = await readLoadingResponse(response({'content-length':'8'}), {url:'https://fixture/a%20b.bin', signal:task.signal})
    assert.deepEqual([...new Uint8Array(bytes)], [0,1,2,3,4,5,6,7])
    const middle = snapshots.filter(x => x.downloadedBytes > 0 && x.downloadedBytes < 8)
    assert.deepEqual([...new Set(middle.map(x => x.downloadedBytes))], [2,4,6])
    assert.deepEqual([...new Set(middle.map(x => x.ratio))], [.25,.5,.75])
    assert.equal(middle[0].currentName, 'a b.bin')
    assert.equal(task.snapshot().status,'loading')
    console.log('STREAM_INTERMEDIATE_BYTES=[2,4,6] RATIOS=[0.25,0.5,0.75] EOF_STATUS=loading')
    task.complete();stop()
})
for (const headers of [{}, {'content-length':'3','content-encoding':'gzip'}, {'content-length':'3','content-encoding':'br'}]) {
    test(`unknown/encoded length never fabricates total ${JSON.stringify(headers)}`, async () => {
        const task=startLoadingTask('unknown'), states=[];const stop=subscribeLoadingProgress(s=>{if(s.taskId===task.id)states.push(s)})
        await readLoadingResponse(response(headers), {url:'https://fixture/unknown',signal:task.signal})
        for(const state of states.filter(s=>s.downloadedBytes>0&&s.downloadedBytes<8)){assert.equal(state.totalBytes,undefined);assert.equal(state.ratio,undefined)}
        assert.equal(task.snapshot().downloadedBytes,8);task.complete();stop()
    })
}
test('explicit exact archive size allows honest ratios and reports complete file once',async()=>{
 const task=startLoadingTask('archive');await readLoadingResponse(response(),{url:'https://fixture/a.zip',signal:task.signal,expectedBytes:8})
 assert.equal(task.snapshot().totalFiles,1);assert.equal(task.snapshot().completedFiles,1);assert.equal(task.snapshot().downloadedBytes,8);task.complete()
})
test('second filename and blob cache read do not duplicate network bytes',async()=>{
 const task=startLoadingTask('cached');await readLoadingResponse(response(),{url:'https://fixture/a.zip',signal:task.signal})
 await readLoadingResponse(response(),{url:'blob:cached',signal:task.signal})
 assert.equal(task.snapshot().downloadedBytes,8);assert.equal(task.snapshot().totalFiles,2);assert.equal(task.snapshot().currentUrl,'blob:cached');task.complete()
})
test('abort cancels reader and late file/phase callbacks cannot revive task',async()=>{
 const controller=new AbortController(),task=startLoadingTask('abort',controller.signal)
 const promise=readLoadingResponse(response(),{url:'https://fixture/abort',signal:controller.signal,onProgress:loaded=>{if(loaded===2)controller.abort()}})
 await assert.rejects(promise,e=>e.name==='AbortError');const sealed=task.snapshot();task.file('late',99,100);task.phase('assembling');assert.deepEqual(task.snapshot(),sealed);assert.equal(sealed.status,'cancelled')
})
test('error remains terminal, same-channel retry owns a new ID, genuine error rethrows',async()=>{
 let failed;await assert.rejects(withLoadingTask('fail',undefined,async(signal,task)=>{failed=task;await readLoadingResponse(response({},true),{url:'https://fixture/broken',signal})}),/stream failed/)
 assert.equal(failed.snapshot().status,'error');failed.file('late',9,9);assert.equal(failed.snapshot().currentName,'broken')
 const a=startLoadingTask('old',undefined,'stage'),b=startLoadingTask('retry',undefined,'stage');a.phase('downloading');assert.equal(a.snapshot().status,'cancelled');assert.ok(b.id>a.id);b.complete()
})
test('download EOF/decode/assemble stay loading until the true work commit resolves',async()=>{
 let task,release;const pending=withLoadingTask('assemble',undefined,async(signal,t)=>{task=t;await readLoadingResponse(response(),{url:'https://fixture/model',signal});t.phase('decoding');t.phase('assembling');await new Promise(resolve=>{release=resolve});return 'committed'})
 while(!release)await pause(2);assert.equal(task.snapshot().status,'loading');assert.equal(task.snapshot().phase,'assembling');release();assert.equal(await pending,'committed');assert.equal(task.snapshot().status,'complete')
})
function panelFixture(){const dom=new JSDOM(read('index.html'));return{dom,doc:dom.window.document,panel:createLoadingProgressPanel(dom.window.document)}}
test('panel uses Demo sprite/card; no percent while unknown and assembly still visible after EOF',async()=>{
 const {doc,panel,dom}=panelFixture(),task=startLoadingTask('角色加载');await readLoadingResponse(response(),{url:'https://fixture/model',signal:task.signal});task.phase('assembling')
 assert.equal(doc.getElementById('load-progress-card').hidden,false);assert.match(doc.getElementById('load-progress').textContent,/组装/)
 await pause(190);assert.equal(doc.getElementById('load-progress-card').hidden,false)
 task.complete();await pause(190);assert.equal(doc.getElementById('load-progress-card').hidden,true);panel.dispose();dom.window.close()
})
test('initial concurrent character/stage: late callbacks never cover newer, remaining task resumes',async()=>{
 const {doc,panel,dom}=panelFixture(),character=startLoadingTask('角色加载'),stage=startLoadingTask('场景加载');character.phase('decoding','char.fbx');assert.match(doc.getElementById('load-progress').textContent,/场景/)
 stage.complete();await pause(190);assert.match(doc.getElementById('load-progress').textContent,/角色/);assert.equal(doc.getElementById('load-progress-card').hidden,false)
 character.complete();panel.dispose();dom.window.close()
})
test('failure text persists through old legacy clear and old async values; retry can replace it',()=>{
 const {doc,panel,dom}=panelFixture(),old=startLoadingTask('old'),broken=startLoadingTask('broken');broken.phase('decoding','broken.json');broken.fail(new Error('bad material'))
 panel.legacy('');old.phase('assembling');assert.match(doc.getElementById('load-progress-file').textContent,/bad material/);assert.equal(doc.getElementById('load-progress-card').dataset.state,'error')
 const retry=startLoadingTask('retry');assert.match(doc.getElementById('load-progress').textContent,/retry/);old.cancel();retry.complete();panel.dispose();dom.window.close()
})
test('dispose removes subscription and completion timeout cannot hide another task',async()=>{
 const {doc,panel,dom}=panelFixture(),a=startLoadingTask('a');a.complete();const b=startLoadingTask('b');await pause(190);assert.equal(doc.getElementById('load-progress-card').hidden,false)
 panel.dispose();b.phase('assembling','do-not-render');assert.doesNotMatch(doc.getElementById('load-progress-file').textContent,/do-not-render/);b.cancel();dom.window.close()
})
function stageOptionFactory(doc){const text=read('src/viewer/stages.ts'),start=text.indexOf('function createStageSelectorOption('),end=text.indexOf('function refreshStageSelectorLabels',start),code=ts.transpileModule(text.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 return new Function('document','getStageSceneNameRecord','stageSceneNameIndex','stageDisplayName','getUiLocale',code+';return createStageSelectorOption')(doc,()=>undefined,{},d=>d.name,()=> 'zh-CN')}
test('product-presentation is labelled/disabled without removing identity; previous partial/pending untouched',()=>{
 const dom=new JSDOM(),create=stageOptionFactory(dom.window.document)
 for(const status of ['product-presentation','partial','pending']){const o=create({id:status,name:'source',official:true,dynamic:{status}});assert.equal(o.value,status);assert.equal(o.disabled,true);if(status==='product-presentation')assert.match(o.textContent,/真实场景待恢复/)}
 assert.equal(create({id:'ready',name:'ready',official:true,dynamic:{status:'recovered'}}).disabled,false);dom.window.close()
})
test('thumbnail/list/apply route inherits disabled source option rather than bypassing it',async()=>{
 const dom=new JSDOM(read('index.html'),{url:'http://fixture/'}),doc=dom.window.document,old={};for(const key of ['document','window','MutationObserver','Event']){old[key]=globalThis[key];globalThis[key]=key==='document'?doc:key==='window'?dom.window:dom.window[key]}
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({schema:'magius.runtime-selection-thumbnails.v1',characters:{},scenes:{},sceneResources:{}}))
 try{
  const create=stageOptionFactory(doc),source=doc.getElementById('stage-selector');source.replaceChildren(create({id:'blocked',name:'card',dynamic:{status:'product-presentation'}}),create({id:'ready',name:'ready'}))
  const text=read('src/viewer/runtimeSelectionPanels.ts').replace(/import .*?from '\.\/localization\/zhCN'/,"const translateUiText = text => text"),code=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText
  const api=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));api.setupRuntimeSelectionPanels();await pause(10)
  assert.equal(doc.querySelector('#stage-list-select option[value="blocked"]').disabled,true);assert.equal(doc.querySelector('#stage-list-grid button[data-value="blocked"]').disabled,true)
  doc.getElementById('stage-list-select').value='blocked';doc.getElementById('stage-list-select').dispatchEvent(new dom.window.Event('change'))
  assert.equal(doc.getElementById('stage-list-use').disabled,true);let changes=0;source.addEventListener('change',()=>changes++);doc.getElementById('stage-list-use').dispatchEvent(new dom.window.Event('click'));assert.equal(changes,0)
 }finally{globalThis.fetch=oldFetch;for(const [key,value]of Object.entries(old))globalThis[key]=value;dom.window.close()}
})
