import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const {JSDOM}=await import(process.env.S6_DOM_MODULE||'jsdom')
const source=fs.readFileSync(new URL('./src/viewer/voicePanel.ts',import.meta.url),'utf8')
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8')
// The complete production panel/controller executes on a real DOM. Only audio/media
// clocks and localization/catalog boundaries are deterministic, with no external I/O.
export function makeFixture(window,compiled){
 const entry={stableKey:'soundMstId=1|cueSheetName=cv_100101_outgame|cueName=fixture',characterResourceId:'100101',order:1,audio:{runtimeUrl:'/fixture.ogg',runtimeReady:true,format:'ogg',failClosedReasons:[],sourceStableKey:'fixture'},durationSeconds:20};
 const players=[],workspaceCalls=[],voiceCalls=[];let locale='en',track={trackId:'background-fixture',kind:'background',fileName:'fixture.ogg',status:'paused',positionSeconds:0,durationSeconds:20,volume:1,loop:false,lipSync:false};
 class Player {
  entries=[entry];listeners=new Set();positionSeconds=0;durationSeconds=20;status='idle';currentStableKey=null;autoSequence=false;revision=0;
  constructor(){players.push(this)}
  get snapshot(){return{status:this.status,characterResourceId:'100101',currentStableKey:this.currentStableKey,currentIndex:this.currentStableKey?0:-1,trackCount:1,autoSequence:this.autoSequence,analysisMode:'fixture-media',mouthCarrier:{kind:'none'},scenario:{status:'ready',motion:null,faceType:null,motionApplied:false,faceApplied:false},error:null}}
  emit(){for(const f of this.listeners)f(this.snapshot)}
  subscribe(f){this.listeners.add(f);f(this.snapshot);return()=>this.listeners.delete(f)}
  setCharacter(){this.emit()}setScenarioOptions(){}setAutoSequence(v){this.autoSequence=v}
  async playStableKey(key){this.currentStableKey=key;this.status='playing';this.emit();return true}
  async playQueue(){return this.playStableKey(entry.stableKey)}async previous(){return false}async next(){return false}
  pause(){this.status='paused';this.emit();return true}async resume(){this.status='playing';this.emit();return true}
  stop(){this.status='idle';this.currentStableKey=null;this.positionSeconds=0;this.emit()}
  seek(value){this.positionSeconds=Math.max(0,Math.min(20,value))}
  update(delta){voiceCalls.push(delta);if(this.status==='playing')this.positionSeconds+=delta}
  subtitleState(mode){if(mode==='off'||!this.currentStableKey)return null;return{text:`${mode}: subtitle ${Math.floor(this.positionSeconds)} / ${this.revision}`,resolvedLocale:mode,requestedLocale:mode,fallbackApplied:false,sourceRegion:'JP',status:'ready'}}
  async dispose(){this.listeners.clear()}
 }
 const runtime={snapshot:()=>[{...track}],subscribe:f=>{f([{...track}]);return()=>{}},setBeforeCharacterPlay(){},setCharacters(){},uploadCharacterTrack(){},uploadBackgroundTrack(){},dispatch(){},update(delta){workspaceCalls.push(delta);if(track.status==='playing')track.positionSeconds+=delta},dispose(){}};
 const voice={VoicePlayer:Player,VOICE_UPLOAD_ACCEPT:'audio/*',VOICE_SUBTITLE_DEFAULT_MODE:'zh-Hans',fetchVoiceCatalogManifest:async()=>({entries:[entry]}),fetchVoiceScenarioManifest:async()=>({entries:[]}),isVoiceRuntimeReady:()=>true};
 const modules={'./voice/poseChannels.ts':{createVoicePoseChannelProvider:()=>({acquirePoseChannels(){return{status:'unavailable',reason:'fixture'}},dispose(){}})},'./voice/index':voice,'./localization/characterNames':{getCharacterTrilingualName:()=>({ja:'まどか',romaji:'Madoka',zh:'圆'})},'./localization/zhCN':{getUiLocale:()=>locale,translateUiText:t=>t},'./runtimeProductDelivery':{resolveRuntimeVoiceUrl:async()=>'/fixture.ogg'}};
 const exports={};window.Function('require','exports',compiled)(key=>{if(!modules[key])throw Error('UNEXPECTED_IMPORT:'+key);return modules[key]},exports);
 const controller=exports.setupVoicePanel({workspaceRuntime:runtime}),doc=window.document;
 const observer=new window.MutationObserver(()=>{});observer.observe(doc.body,{attributes:true,childList:true,characterData:true,subtree:true});
 let now=window.performance.now();
 const el=id=>doc.getElementById(id),read=()=>({text:el('voice-subtitle-overlay').textContent,hidden:el('voice-subtitle-overlay').hidden,lang:el('voice-subtitle-overlay').lang,locale:el('voice-panel').lang,selected:el('voice-subtitle-mode').value,progress:el('voice-progress').value,max:el('voice-progress').max,disabled:el('voice-progress').disabled,time:el('voice-progress-value').textContent,status:el('voice-panel').dataset.status,workspaceSeek:doc.querySelector('[data-workspace-role="seek"]')?.value,workspaceTime:doc.querySelector('[data-workspace-role="time"]')?.textContent});
 return {controller,players,voiceCalls,workspaceCalls,observer,el,read,entry,runtime,
  setTrackPlaying(){track.status='playing'},setTrackPosition(v){track.positionSeconds=v},setLocale(v){locale=v;doc.dispatchEvent(new window.Event('magius:localechange'))},
  clear(){observer.takeRecords()},take(){return observer.takeRecords().map(m=>({type:m.type,id:m.target.id||m.target.parentElement?.id||m.target.tagName,attribute:m.attributeName,workspaceRole:m.target.dataset?.workspaceRole||null}))},
  tick(){now+=1000/60;controller.update(now)},pump(n){for(let i=0;i<n;i++)this.tick()},
  async ready(){await new Promise(resolve=>window.setTimeout(resolve,0));if(players.length!==1)throw Error('VOICE_SETUP_FAILED');controller.setCharacter('100101',null);this.clear()},
  async dispose(){observer.disconnect();await controller.dispose()}
 }
}
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function fixture(){const dom=new JSDOM(html,{url:'https://voice-panel-fixture.invalid/',runScripts:'outside-only',pretendToBeVisual:true});dom.window.requestAnimationFrame=f=>{f(0);return 1};const f=makeFixture(dom.window,compiled);await f.ready();return{...f,dom,async dispose(){await f.dispose();dom.window.close()}}}

test('D1 hidden idle has zero repeated DOM mutations; both runtime clocks update all 480 frames',async()=>{
 const f=await fixture();try{f.controller.update(10000);f.clear();const v=f.voiceCalls.length,w=f.workspaceCalls.length;f.pump(480);const mutations=f.take();assert.equal(mutations.length,0);assert.equal(f.voiceCalls.length-v,480);assert.equal(f.workspaceCalls.length-w,480)}finally{await f.dispose()}
})
test('D2 closed-panel playback keeps subtitles live while progress DOM waits until synchronous open',async()=>{
 const f=await fixture();try{await f.players[0].playStableKey(f.entry.stableKey);f.setTrackPlaying();f.clear();const old=f.read();f.pump(480);const mutations=f.take(),now=f.read();assert.notEqual(now.text,old.text);assert.equal(now.hidden,false);assert.equal(now.progress,old.progress);assert.ok(mutations.length<40,JSON.stringify(mutations));f.el('voice-panel-toggle').click();const opened=f.read();assert.ok(Math.abs(Number(opened.progress)-f.players[0].positionSeconds)<.001);assert.ok(Number(opened.workspaceSeek)>7)}finally{await f.dispose()}
})
test('D3 visible seek, duration, pause and resume state stay immediately synchronized and idle mutations settle',async()=>{
 const f=await fixture();try{await f.players[0].playStableKey(f.entry.stableKey);f.el('voice-panel-toggle').click();f.el('voice-progress').value='9';f.el('voice-progress').dispatchEvent(new f.dom.window.Event('input'));assert.equal(f.players[0].positionSeconds,9);assert.equal(f.read().time,'0:09 / 0:20');assert.match(f.read().text,/subtitle 9/);f.el('voice-pause').click();assert.equal(f.read().status,'paused');f.clear();f.pump(120);assert.equal(f.take().length,0);f.el('voice-resume').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.read().status,'playing');f.pump(120);assert.ok(Number(f.read().progress)>10);f.players[0].durationSeconds=null;f.tick();assert.equal(f.read().disabled,true);assert.equal(f.read().max,'1');f.players[0].durationSeconds=12;f.tick();assert.equal(f.read().disabled,false);assert.equal(f.read().max,'12')}finally{await f.dispose()}
})
test('D4 language changes, off/on subtitles and UI locale still update with the panel closed',async()=>{
 const f=await fixture();try{await f.players[0].playStableKey(f.entry.stableKey);f.el('voice-subtitle-toggle').checked=true;f.tick();assert.equal(f.read().hidden,false);f.el('voice-subtitle-toggle').checked=false;f.el('voice-subtitle-toggle').dispatchEvent(new f.dom.window.Event('change'));assert.equal(f.read().hidden,true);assert.equal(f.read().text,'');f.el('voice-subtitle-toggle').checked=true;f.el('voice-subtitle-toggle').dispatchEvent(new f.dom.window.Event('change'));assert.equal(f.read().hidden,false);
 f.el('voice-subtitle-mode').value='ja-Jpan';f.el('voice-subtitle-mode').dispatchEvent(new f.dom.window.Event('change'));assert.equal(f.read().selected,'ja-Jpan');assert.equal(f.read().hidden,true);assert.equal(f.players[0].status,'idle');await f.players[0].playStableKey(f.entry.stableKey);assert.match(f.read().text,/ja-Jpan/);assert.equal(f.read().lang,'ja-JP');f.setLocale('zh-CN');assert.equal(f.read().locale,'zh-CN');f.clear();f.pump(20);assert.equal(f.take().length,0);
 }finally{await f.dispose()}
})
test('D5 current DOM values—not stale cached snapshots—repair changed subtitle nodes next frame',async()=>{
 const f=await fixture();try{await f.players[0].playStableKey(f.entry.stableKey);const text=f.read().text;f.el('voice-subtitle-overlay').textContent='stale external edit';f.el('voice-panel').dataset.resolvedLocale='wrong';f.tick();assert.equal(f.read().text,text);assert.equal(f.el('voice-panel').dataset.resolvedLocale,'zh-Hans')}finally{await f.dispose()}
})

test('D6 pausing voice does not suppress a playing workspace clock or meaningful workspace progress',async()=>{
 const f=await fixture();try{f.setTrackPlaying();f.el('voice-panel-toggle').click();f.clear();f.pump(120);const mutations=f.take();assert.ok(mutations.length>0&&mutations.length<5);assert.ok(mutations.every(m=>m.workspaceRole==='time'));assert.ok(Number(f.read().workspaceSeek)>1);assert.equal(f.read().progress,'0')}finally{await f.dispose()}
})
