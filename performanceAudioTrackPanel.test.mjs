import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import * as T from 'three'
const source=process.env.S6_SOURCE_ROOT||path.dirname(fileURLToPath(import.meta.url))
const {JSDOM}=await import(process.env.S6_DOM_MODULE||'jsdom')
globalThis.window={URL:globalThis.URL,addEventListener(){}}
const {mountPerformanceEditor}=await import('./src/viewer/performanceEditor/index.ts')
const {VoiceCatalog}=await import('./src/viewer/voice/catalog.ts')
const realManifest=JSON.parse(fs.readFileSync(path.join(source,'artifacts/research/20260827-voice-catalog-source-ready/manifest.v1.json'),'utf8'))
const actualCatalog=new VoiceCatalog(realManifest), stable=i=>`soundMstId=${i}|cueSheetName=cv_100101_outgame|cueName=fixture_${i}`
const catalog=new VoiceCatalog({schema:'magius.voice-catalog.v1',entries:[1,2,3].map(i=>({stableKey:stable(i),characterResourceId:'100101',order:i,audio:{runtimeUrl:i===3?null:`/fixture/voice-${i}.ogg`,format:'ogg',runtimeReady:i!==3,failClosedReasons:i===3?['EXACT_FIXTURE_MEDIA_MISSING']:[],sourceStableKey:`cri-cue:cueSheetName=cv_100101_outgame|cueName=fixture_${i}`},subtitles:{ja:`原文「声 ${i}」`, 'zh-CN':`译文测试 ${i}`},durationSeconds:8}))})
class Media{
 src='';currentTime=0;volume=1;paused=true;ended=false;duration=8;plays=0;amplitude=.2;events=new Map()
 play(){this.paused=false;++this.plays;return Promise.resolve()}pause(){this.paused=true}load(){}
 addEventListener(k,f){let set=this.events.get(k);if(!set)this.events.set(k,set=new Set());set.add(f)}
 removeEventListener(k,f){this.events.get(k)?.delete(f)}dispatch(k){for(const f of this.events.get(k)||[])f()}
}
class Context{
 destination={};state='running';closed=0
 createMediaElementSource(element){return{connect(to){to.element=element},disconnect(){}}}
 createAnalyser(){return{fftSize:256,frequencyBinCount:128,element:null,connect(){},disconnect(){},getFloatTimeDomainData(pcm){for(let i=0;i<pcm.length;i++)pcm[i]=(this.element?.amplitude??0)*Math.sin(i*Math.PI/8)}}}
 createGain(){return{connect(){},disconnect(){}}}async resume(){}async close(){++this.closed}
}
const labels={source:'声源 / Audio source',search:'搜索声源 / Search audio',target:'音轨目标 / Audio target',track:'编辑音轨 / Audio track',start:'开始秒 / Start',offset:'媒体偏移秒 / Offset',duration:'播放时长秒 / Duration',volume:'音量 / Volume',lip:'启用口型 / Lip sync'}
function fixture(voices=catalog){
 const dom=new JSDOM('<!doctype html><html><body><aside id="panel"></aside></body></html>',{url:'https://fixture.invalid/'})
 const document=dom.window.document,container=document.getElementById('panel'),actorListeners=new Set(),frameListeners=new Set(),media=[],ctx=new Context()
 const descriptors=Array.from({length:2},(_,i)=>{const object=new T.Group(),mesh=new T.Mesh();mesh.name='Face';mesh.morphTargetDictionary={Mouth_Open:0};mesh.morphTargetInfluences=[0];object.add(mesh);return {object,generation:i+1,label:'same resource '+i,actions:[],isCurrent:()=>descriptors.some(d=>d.object===object)}})
 const editor=mountPerformanceEditor(container,{actorSource:{list:()=>descriptors,subscribe:f=>{actorListeners.add(f);return()=>actorListeners.delete(f)}},framePort:{subscribeBeforePhysics:f=>{frameListeners.add(f);return()=>frameListeners.delete(f)},subscribeFinalPoseBeforeCamera:f=>{frameListeners.add(f);return()=>frameListeners.delete(f)}},channelHost:{acquire:()=>({status:'unavailable',reason:'POSE_NOT_REQUESTED'}),notifyRootTransformChanged(){}},voiceCatalog:voices,audioEnvironment:{createAudio:()=>{const m=new Media();media.push(m);return m},createAudioContext:()=>ctx,resolveRuntimeUrl:entry=>entry.audio.runtimeUrl}})
 const find=label=>{const el=document.querySelector(`[aria-label=${JSON.stringify(label)}]`);assert.ok(el,`missing ${label}`);return el}
 const input=(key,value,event='input')=>{const el=find(labels[key]||key);if(el.type==='checkbox')el.checked=!!value;else el.value=String(value);el.dispatchEvent(new dom.window.Event(event,{bubbles:true}));return el}
 const click=label=>{const el=[...document.querySelectorAll('button')].find(el=>el.textContent===label);assert.ok(el,label);el.click();return el}
 const choose=(index=0)=>input('target',JSON.stringify([descriptors[index].object.uuid,descriptors[index].generation]),'change')
 const sourceSelect=(key=stable(1))=>input('source',key,'change')
 const tracks=()=>editor.runtime.timeline.value.audioTracks||[]
 const notice=()=>container.querySelector('[data-testid="performance-audio-authoring-status"]').textContent
 return {dom,document,container,editor,descriptors,media,ctx,find,input,click,choose,sourceSelect,tracks,notice,refreshActors(){for(const f of actorListeners)f()},dispose(){editor.dispose();assert.equal(actorListeners.size,0);assert.equal(frameListeners.size,0);dom.window.close()}}
}
const next=()=>new Promise(resolve=>setTimeout(resolve,0))

test('C1 real DOM exposes full actual1302-entry catalog; last entry remains searchable/selectable',()=>{
 const f=fixture(actualCatalog);try{
  assert.equal(realManifest.entries.length,1302)
  const select=f.find(labels.source);assert.equal(select.options.length-1,realManifest.entries.length)
  assert.deepEqual([...select.options].slice(1).map(o=>o.value),realManifest.entries.map(e=>e.stableKey))
  const last=realManifest.entries.at(-1);f.input('search',last.stableKey);assert.equal(select.options.length,2);f.sourceSelect(last.stableKey)
  assert.ok(f.container.querySelector('[data-testid="performance-audio-source-info"]').textContent.includes(last.characterResourceId))
  assert.equal(f.media.length,0);assert.equal(f.editor.runtime.playing,false)
  console.log(JSON.stringify({catalogAuthority:'actual VoiceCatalog',entries:1302,selectableDenominator:realManifest.entries.length,filteredMatches:select.options.length-1,query:last.stableKey,network:0,browser:0}))
 }finally{f.dispose()}
})
test('C2 pending catalog arrives through notification without a polling loop or autoplay; snapshots are detached',async()=>{
 const f=fixture(null);try{
  assert.match(f.container.querySelector('[data-testid="performance-audio-catalog-status"]').textContent,/加载中/)
  assert.equal(f.find(labels.source).disabled,true)
  let notifications=0;const release=f.editor.audio.subscribeCatalog(()=>notifications++)
  f.editor.audio.setCatalog(catalog);await next()
  assert.equal(notifications,2);assert.equal(f.find(labels.source).disabled,false);assert.equal(f.find(labels.source).options.length,4)
  const candidate=f.editor.audio.catalogEntries;candidate[0].subtitles.ja='CHANGED';candidate[0].audio.failClosedReasons.push('CHANGED');assert.notEqual(catalog.get(stable(1)).subtitles.ja,'CHANGED');assert.equal(catalog.get(stable(1)).audio.failClosedReasons.length,0)
  f.editor.audio.setCatalog(catalog);assert.equal(notifications,2);release();assert.equal(f.media.length,0);assert.equal(f.editor.runtime.playing,false)
 }finally{f.dispose()}
})
test('C3 search includes raw/translated text, character ID and stable key; missing media shows reason',()=>{
 const f=fixture();try{
  for(const [query,count] of [['原文「声 2」',1],['译文测试 1',1],['100101',3],[stable(2),1]]){f.input('search',query);assert.equal(f.find(labels.source).options.length-1,count)}
  f.input('search','');f.sourceSelect(stable(3));assert.match(f.container.querySelector('[data-testid="performance-audio-source-info"]').textContent,/EXACT_FIXTURE_MEDIA_MISSING/)
  assert.equal(f.click('添加音轨 / Add track').disabled,true);assert.equal(f.tracks().length,0)
  f.sourceSelect(stable(1));f.input('search','nothing-matches');assert.equal(f.find(labels.source).options.length,1);f.click('添加音轨 / Add track');assert.equal(f.tracks()[0].sourceStableKey,stable(1))
 }finally{f.dispose()}
})
test('C4 add same source to two exact actor instances, edit one, delete one and round-trip without pose loss',async()=>{
 const f=fixture();try{
  const poseTrack={id:'preserved-pose',actorKey:f.descriptors[0].object.uuid,channel:'root-position',keys:[{id:'k0',time:0,value:[1,2,3]}]}
  f.editor.runtime.setDocument({schema:'performance-editor-v1',duration:10,loop:true,tracks:[poseTrack],audioTracks:[]})
  f.sourceSelect();f.choose(0);f.input('lip',true);f.input('start',.3);f.input('offset',.2);f.input('duration',2);f.input('volume',.65);f.click('添加音轨 / Add track')
  const first=structuredClone(f.tracks()[0]);assert.equal(first.actorKey,f.descriptors[0].object.uuid);assert.equal(first.generation,1)
  f.choose(1);f.click('添加音轨 / Add track');assert.equal(f.tracks().length,2);assert.notEqual(f.tracks()[1].id,first.id);assert.equal(f.tracks()[1].generation,2)
  f.input('volume',.25);f.click('保存音轨 / Save track');assert.deepEqual(f.tracks()[0],first);assert.equal(f.tracks()[1].volume,.25)
  assert.deepEqual(f.editor.runtime.timeline.value.tracks,[poseTrack]);assert.equal(f.editor.runtime.timeline.value.loop,true)
  const saved=f.editor.runtime.timeline.serialize();f.editor.runtime.importProject(saved);assert.equal(f.tracks()[1].actorKey,f.descriptors[1].object.uuid)
  assert.match(f.find(labels.target).selectedOptions[0].textContent,new RegExp(f.descriptors[1].object.uuid))
  f.click('删除音轨 / Delete track');assert.deepEqual(f.tracks(),[first]);assert.deepEqual(f.editor.runtime.timeline.value.tracks,[poseTrack]);await next();assert.equal(f.editor.runtime.playing,false)
 }finally{f.dispose()}
})
test('C5 stale UUID/generation stays explicit on actor replacement or imported documents; never falls back',async()=>{
 const f=fixture();try{
  f.sourceSelect();f.choose();f.click('添加音轨 / Add track');const original=structuredClone(f.tracks()[0])
  f.descriptors[0].generation=9;f.refreshActors();await next()
  assert.match(f.find(labels.target).selectedOptions[0].textContent,/Stale/);assert.equal(f.click('保存音轨 / Save track').disabled,true);assert.deepEqual(f.tracks()[0],original)
  assert.match(f.container.querySelector('[data-track-id="audio-1"]').textContent,/AUDIO_ACTOR_STALE/)
  f.editor.runtime.importProject(f.editor.runtime.timeline.serialize());assert.equal(f.tracks()[0].generation,1)
  f.choose();f.click('保存音轨 / Save track');assert.equal(f.tracks()[0].generation,9)
  f.input('target','background','change');f.click('保存音轨 / Save track');assert.equal(f.tracks()[0].actorKey,undefined);assert.equal(f.tracks()[0].generation,undefined)
 }finally{f.dispose()}
})
test('C6 invalid numeric edits and stale external document edits preserve the complete document',()=>{
 const f=fixture();try{
  f.sourceSelect();f.click('添加音轨 / Add track');const saved=f.editor.runtime.timeline.serialize()
  for(const [field,value]of [['start',-1],['start',11],['offset',-1],['duration',0],['volume',2],['volume','']]){
   f.input('track','audio-1','change');f.input(field,value);f.click('保存音轨 / Save track');assert.equal(f.editor.runtime.timeline.serialize(),saved)
  }
  f.input('track','audio-1','change');f.input('volume',.8)
  const external=f.editor.runtime.timeline.value;external.audioTracks[0].volume=.3;f.editor.runtime.setDocument(external)
  assert.match(f.notice(),/外部更新/);assert.equal(f.find(labels.volume).value,'0.8');assert.equal(f.click('保存音轨 / Save track').disabled,true)
  f.input('track','audio-1','change');assert.equal(f.find(labels.volume).value,'0.3');f.click('保存音轨 / Save track');assert.equal(f.tracks()[0].volume,.3)
 }finally{f.dispose()}
})
test('C7 per-row media/time/error/binding/PCM meter reflects the real bridge; backgrounds have no mouth target',async()=>{
 const f=fixture();try{
  f.sourceSelect();f.choose();f.input('lip',true);f.click('添加音轨 / Add track');await next()
  f.editor.runtime.advanceAudioOnlyFrame(0);f.editor.runtime.play();await next()
  for(let i=1;i<=20;i++){for(const m of f.media)m.currentTime+=.016;f.editor.runtime.advanceAudioOnlyFrame(i*16);f.editor.audio.flushMouthOutput()}
  const state=f.editor.audio.snapshot[0],row=f.container.querySelector('[data-track-id="audio-1"]')
  assert.equal(state.status,'playing');assert.ok(state.rawRms>0&&state.mouthOpen>0);assert.equal(row.querySelector('meter').value,state.rawRms);assert.ok(row.textContent.includes(state.currentTime.toFixed(3)+'s'));assert.ok(row.textContent.includes(state.mouthOpen.toFixed(4)));assert.ok(row.textContent.includes(state.actorKey))
  f.media[0].dispatch('error');assert.match(row.textContent,/AUDIO_MEDIA_ERROR/)
  f.click('新建音轨 / New track');f.click('添加音轨 / Add track');await next();assert.equal(f.editor.audio.snapshot[1].lipSyncStatus,'background');assert.equal(f.editor.audio.snapshot[1].actorKey,null)
  f.editor.runtime.pause();assert.equal(f.editor.audio.snapshot[1].mouthOpen,0)
 }finally{f.dispose()}
})
test('C8 clean external reimport updates editor, while selected removed tracks are not silently overwritten',()=>{
 const f=fixture();try{
  f.sourceSelect();f.click('添加音轨 / Add track');const changed=f.editor.runtime.timeline.value;changed.audioTracks[0].startTime=2;f.editor.runtime.importProject(JSON.stringify(changed));assert.equal(f.find(labels.start).value,'2')
  const empty=f.editor.runtime.timeline.value;empty.audioTracks=[];f.editor.runtime.setDocument(empty);assert.match(f.find(labels.track).selectedOptions[0].textContent,/Stale/);assert.equal(f.click('保存音轨 / Save track').disabled,true)
  f.click('新建音轨 / New track');f.click('添加音轨 / Add track');assert.equal(f.tracks().length,1)
 }finally{f.dispose()}
})
test('C9 teardown removes UI handlers/catalog subscription without owning runtime transport; native input text is literal',()=>{
 const f=fixture();const sourceInfo=f.container.querySelector('[data-testid="performance-audio-source-info"]')
 const malicious=structuredClone(catalog.manifest);malicious.entries[0].subtitles.ja='<img src=x onerror=alert(1)>'
 f.editor.audio.setCatalog(new VoiceCatalog(malicious));f.sourceSelect();assert.equal(sourceInfo.querySelector('img'),null);assert.ok(sourceInfo.textContent.includes('<img'))
 const button=f.click('添加音轨 / Add track'),count=f.tracks().length;f.editor.panel.dispose();button.click();assert.equal(f.tracks().length,count)
 f.editor.audio.setCatalog(actualCatalog);assert.equal(f.container.children.length,0);f.dispose()
})
test('C10 parent chartDuration/timeline bytes and audio-only CSS append remain intact',()=>{
 const root=process.env.S6_AUDIO_PACKAGE;if(!root)return
 const original=fs.readFileSync(path.join(root,'original/src/viewer/performanceEditor/panel.ts'),'utf8'),modified=fs.readFileSync(path.join(source,'src/viewer/performanceEditor/panel.ts'),'utf8')
 const region=text=>text.slice(text.indexOf('    const chart ='),text.indexOf('    const json ='))
 assert.equal(region(modified),region(original));assert.ok(modified.includes('let chartDuration'))
 const css=fs.readFileSync(path.join(root,'original/src/viewer/performanceEditor/workspace.css'));assert.ok(fs.readFileSync(path.join(source,'src/viewer/performanceEditor/workspace.css')).subarray(0,css.length).equals(css))
})


test('C11 real DOM workspace open/close preserves authoring controls, catalog arrival and exact media subscription',async()=>{
 const {mountPerformanceWorkspace}=await import('./src/viewer/performanceEditor/workspace.ts')
 const f=fixture(null);let layout
 try{
  const d=f.document,app=d.createElement('div'),menu=d.createElement('div'),workspace=d.createElement('div'),viewer=d.createElement('main'),canvas=d.createElement('canvas'),toggle=d.createElement('button')
  app.id='app';workspace.id='workspace';viewer.id='viewer';viewer.append(canvas);workspace.append(viewer,f.container);app.append(menu,workspace);d.body.append(app)
  for(const resource of ['characters','scenes','actions']){const group=d.createElement('div');group.setAttribute('data-performance-resource',resource);menu.append(group)}menu.append(toggle)
  const sourceControl=f.find(labels.source),targetControl=f.find(labels.target),editorRoot=f.editor.panel.element,originalParent=sourceControl.parentElement
  layout=mountPerformanceWorkspace({workspace,panel:f.editor.panel,toggle,onExit(){f.editor.runtime.stop()}})
  layout.setOpen(true);assert.equal(sourceControl.closest('[role=tabpanel]').id,'performance-audio-task-page-0');assert.equal(targetControl.closest('[role=tabpanel]').id,'performance-audio-task-page-1')
  f.editor.audio.setCatalog(catalog);await next();assert.equal(sourceControl.disabled,false);f.sourceSelect();f.choose(1);f.click('添加音轨 / Add track');await next()
  const stored=f.tracks()[0],plays=f.media.reduce((n,m)=>n+m.plays,0)
  for(let i=0;i<3;i++){layout.setOpen(false);layout.setOpen(true);assert.equal(f.find(labels.source),sourceControl);assert.equal(f.find(labels.target),targetControl);assert.equal(sourceControl.parentElement,originalParent);assert.equal(f.tracks()[0].actorKey,stored.actorKey);assert.equal(viewer.firstElementChild,canvas)}
  assert.equal(f.media.reduce((n,m)=>n+m.plays,0),plays);layout.dispose();layout=undefined;assert.equal(editorRoot.parentElement,f.container)
 }finally{layout?.dispose();f.dispose()}
})
