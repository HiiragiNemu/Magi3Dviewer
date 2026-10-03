import assert from 'node:assert/strict'
import test,{after} from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import ts from 'typescript'
import {JSDOM} from 'jsdom'
import * as THREE from 'three'
const tmp=fs.mkdtempSync(path.resolve('.resource-panel-tests-'))
after(()=>fs.rmSync(tmp,{recursive:true,force:true}))
await build({entryPoints:['src/viewer/runtimeSelectionPanels.ts','src/viewer/resourcePanelUi.ts','src/viewer/resourceSearch.ts','src/viewer/resourcePanelSizing.ts','src/viewer/viewportPoseEditor.ts'],outdir:tmp,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},external:['three'],logLevel:'silent'})
const {setupRuntimeSelectionPanels,formatSceneCatalogStatus}=await import(pathToFileURL(path.join(tmp,'runtimeSelectionPanels.mjs')))
const helpers=await import(pathToFileURL(path.join(tmp,'resourcePanelUi.mjs')))
const searchHelpers=await import(pathToFileURL(path.join(tmp,'resourceSearch.mjs')))
const sizeHelpers=await import(pathToFileURL(path.join(tmp,'resourcePanelSizing.mjs')))
const {avoidDefaultChipOverlap}=await import(pathToFileURL(path.join(tmp,'viewportPoseEditor.mjs')))
const html=fs.readFileSync('index.html','utf8')
const flush=()=>new Promise(r=>setTimeout(r,0))
function fixture(t){
 const dom=new JSDOM(html,{url:'https://example.test/',pretendToBeVisual:true}),w=dom.window,old=new Map(),cleanups=[]
 const globals={window:w,document:w.document,Element:w.Element,HTMLElement:w.HTMLElement,MutationObserver:w.MutationObserver,Event:w.Event,CustomEvent:w.CustomEvent,DOMException:w.DOMException,AbortController:w.AbortController,localStorage:w.localStorage,navigator:w.navigator,getComputedStyle:w.getComputedStyle.bind(w),fetch:async()=>({ok:true,json:async()=>({schema:'magius.runtime-selection-thumbnails.v1',characters:{a:'/a.png',b:'/b.png'},scenes:{s1:'/s1.png',s2:'/s2.png'},sceneResources:{}})})}
 for(const[k,v]of Object.entries(globals)){old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true})}
 w.HTMLElement.prototype.scrollIntoView=function(){}
 document.documentElement.lang='en'
 t.after(()=>{for(const fn of cleanups)fn();w.close();for(const[k,v]of old){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k]}})
 const fill=(id,rows)=>{const e=document.getElementById(id);e.replaceChildren(...rows.map(([v,label,disabled=false])=>{const o=document.createElement('option');o.value=v;o.textContent=label;o.disabled=disabled;return o}));e.disabled=false;return e}
 const source=fill('character-selector',[['a','a - Alpha / アルファ / Alpha'],['b','b - Beta / ベータ / Beta']])
 fill('stage-selector',[['s1','Scene 1'],['s2','Scene 2'],['pending','Unrestored',true]])
 return{w,dom,source,cleanups}
}
function actors(){let items=[{key:'A1',id:'a',selected:true}],serial=1,fail=false,pending=false,rejectReplace=false;const calls=[]
 return{get items(){return items},get calls(){return calls},set fail(v){fail=v},set rejectReplace(v){rejectReplace=v},get pending(){return pending},hooks:{
  instances:()=>items,
  async add(id,count){pending=true;calls.push(['add',id,count]);await flush();pending=false;if(fail)throw Error('asset failed');items=items.map(x=>({...x,selected:false}));for(let i=0;i<count;i++)items.push({key:'A'+(++serial),id,selected:i===count-1})},
  async replace(id,key){calls.push(['replace',id,key]);await flush();if(rejectReplace)throw Error('replacement failed');items=items.map(x=>x.key===key?{...x,id}:x)},
  select(key){items=items.map(x=>({...x,selected:x.key===key}))},remove(key){items=items.filter(x=>x.key!==key)},
 }}
}
const clickTile=(kind,id)=>document.querySelector(`#${kind}-list-grid [data-value="${id}"]`).click()
test('resource shells keep only the grid scrollable and preserve fixed footer, search/count row and shared enemy grid',t=>{
 fixture(t)
 for(const id of ['character-list-panel','stage-list-panel','enemy-panel']){const p=document.getElementById(id);assert.ok(p.classList.contains('resource-browser-panel'));assert.ok(p.querySelector('.resource-search input'));assert.ok(p.querySelector('.resource-search-tools output'));assert.equal(p.querySelectorAll('.resource-search-tools button').length,1);assert.equal(p.querySelector('.resource-catalog-heading'),null);assert.ok(p.querySelector('.runtime-selection-thumbnail-grid'));assert.ok(p.querySelector('.resource-panel-footer .resource-selection-row button'));assert.equal(p.querySelector('.floating-panel-scroll'),null);assert.equal(p.querySelector('select.runtime-selection-native-list').hidden,true)}
 assert.ok(document.querySelector('#character-list-add'));assert.ok(document.querySelector('#character-add-quantity'));assert.ok(document.querySelector('#character-instance-list'));assert.ok(document.querySelector('#enemy-replace-button'))
 assert.ok(document.querySelector('#action-basic-controls #animation-repetitions'));assert.equal(document.querySelector('#menu-controls #animation-repetitions'),null)
})
test('character quantity add appends duplicate independent instances without replacing A; counts match and remove updates',async t=>{
 fixture(t);const a=actors(),ui=setupRuntimeSelectionPanels(a.hooks);await flush();clickTile('character','b');document.getElementById('character-add-quantity').value='2';document.getElementById('character-list-add').click();assert.ok(document.getElementById('character-list-add').disabled);await flush();await flush()
 assert.deepEqual(a.items.map(x=>x.id),['a','b','b']);assert.equal(new Set(a.items.map(x=>x.key)).size,3);assert.match(document.getElementById('character-list-status').textContent,/3$/);assert.equal(document.querySelectorAll('#character-instance-list .resource-instance-row').length,3)
 document.querySelector('#character-instance-list .resource-instance-row button:last-child').click();assert.equal(a.items.length,2);assert.match(document.getElementById('character-list-status').textContent,/2$/)
 a.hooks.remove(a.items[0].key);ui.refreshActors();assert.match(document.getElementById('character-list-status').textContent,/1$/)
})
test('character replacement captures explicit live instance identity and preserves other instances',async t=>{
 fixture(t);const a=actors();await a.hooks.add('a',1);setupRuntimeSelectionPanels(a.hooks);await flush();document.querySelector('#character-instance-list .resource-instance-select').click();clickTile('character','b');document.getElementById('character-list-use').click();await flush();await flush();assert.deepEqual(a.items.map(x=>x.id),['b','a']);assert.deepEqual(a.calls.at(-1),['replace','b','A1']);assert.equal(a.items.length,2)
})
test('failed add/replace restores action availability and does not falsely increment live count',async t=>{
 fixture(t);const a=actors();setupRuntimeSelectionPanels(a.hooks);await flush();a.fail=true;clickTile('character','b');document.getElementById('character-list-add').click();await flush();await flush();assert.equal(a.items.length,1);assert.match(document.getElementById('character-list-feedback').textContent,/asset failed/);assert.equal(document.getElementById('character-list-add').disabled,false)
 a.rejectReplace=true;document.getElementById('character-list-use').click();await flush();await flush();assert.equal(a.items[0].id,'a');assert.match(document.getElementById('character-list-feedback').textContent,/replacement failed/)
})
test('external actor refresh cannot steal a manually chosen catalog entry and selected thumbnail remains inspectable',async t=>{
 const f=fixture(t),a=actors(),ui=setupRuntimeSelectionPanels(a.hooks);await flush();clickTile('character','b');f.source.value='a';ui.refreshActors();assert.equal(document.getElementById('character-list-select').value,'b');assert.ok(document.querySelector('#character-list-grid [data-value=b]').classList.contains('is-selected'));assert.match(document.getElementById('character-list-preview').src,/b.png/)
})
test('repeated scene picks preserve scroll, green selected card and disabled entry inspection without enabling its load',async t=>{
 fixture(t);setupRuntimeSelectionPanels();await flush();const grid=document.getElementById('stage-list-grid');grid.scrollTop=123;const first=grid.firstElementChild;document.getElementById('stage-list-panel-toggle').click();assert.equal(grid.firstElementChild,first);assert.equal(grid.scrollTop,123)
 let selected=[];document.getElementById('stage-selector').addEventListener('change',e=>selected.push(e.target.value));clickTile('stage','s1');document.getElementById('stage-list-use').click();clickTile('stage','pending');assert.equal(document.getElementById('stage-list-use').disabled,true);document.getElementById('stage-list-use').click();clickTile('stage','s2');document.getElementById('stage-list-use').click();assert.deepEqual(selected,['s1','s2']);assert.equal(document.getElementById('stage-list-select').value,'s2');assert.match(document.getElementById('stage-list-detail').textContent,/s2/)
 assert.doesNotMatch(document.getElementById('stage-list-status').textContent,/restoration|待恢/)
})
test('compact scene count still distinguishes selectable from total and excludes disabled cards from denominator numerator',()=>{
 const rows=[{disabled:false,dataset:{official:'true'}},{disabled:true,dataset:{official:'true'}},{disabled:false,dataset:{official:'false'}}]
 assert.match(formatSceneCatalogStatus(rows,3),/2 \/ 3/);assert.match(formatSceneCatalogStatus(rows.slice(1),3),/1 \/ 3/)
})
test('resource tile text is inert, key navigation selects without loading and all IDs remain exact',t=>{
 const {w}=fixture(t),grid=document.createElement('div');grid.style.gridTemplateColumns='1fr 1fr';document.body.append(grid);let selected=[],loads=0
 for(let i=0;i<5;i++)grid.append(helpers.createResourceTile({value:String(i),label:'<script>bad()</script>'},()=>selected.push(i),()=>loads++))
 helpers.installResourceGridKeys(grid);grid.firstChild.focus();grid.firstChild.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.deepEqual(selected,[2]);assert.equal(loads,0);assert.equal(grid.querySelector('script'),null);assert.equal(document.activeElement.dataset.value,'2')
})
test('priority camera rectangles are avoided while default buttons use same-row space; manual placement remains unchanged',()=>{
 const items=[{key:'roll',x:4,y:4,width:58,height:44,manual:true},{key:'focus',x:312,y:4,width:44,height:44,manual:true},{key:'normal',x:4,y:4,width:76,height:32,manual:false}];const r=avoidDefaultChipOverlap(items,{left:4,right:356,top:4,bottom:300});assert.equal(r.get('normal').y,4);assert.ok(r.get('normal').x>=65);assert.deepEqual(r.get('roll'),{x:4,y:4})
})
function enemyFixture(t){const f=fixture(t),entries=[{enemyMstId:600001,enemyUniqueId:1,modelPrefabName:'a',names:{en:'Rose'},model:{},thumbnail:{url:'/e1.png'}},{enemyMstId:600002,enemyUniqueId:2,modelPrefabName:'b',names:{en:'Servant'},model:{},thumbnail:{url:'/e2.png'}}];let manager,tick,serial=0;const removed=[],selects=[]
 class Manager{items=[];fail=false;constructor(){manager=this}async listEnemies(){return entries}getInstances(){return this.items}update(){}async addEnemy(id,parent,options){await flush();if(this.fail)throw Error('enemy load failed');const obj=new THREE.Group();obj.position.fromArray(options.position);const item={instanceId:'e'+(++serial),entry:entries.find(x=>x.enemyMstId===id),object:obj,animationNames:['Wait_L'],currentAnimationName:'Wait_L',animationDuration:1,animationTime:0,animationPaused:true,playAnimation(){return{}},setAnimationPaused(v){this.animationPaused=v}};this.items.push(item);return item}removeEnemy(id){const at=this.items.findIndex(x=>x.instanceId===id);if(at<0)return false;this.items.splice(at,1);return true}clearEnemies(){const n=this.items.length;this.items=[];return n}}
 const module={exports:{}},deps={three:THREE,'./pageLifecycle':{onPermanentPageExit(){}},'magia-exedra-character-three/renderer':{addAnimationLoop(fn){tick=fn},removeAnimationLoop(){},getClockDelta:()=>.016},'./enemies':{EnemyResourceManager:Manager,EnemyResourceError:class extends Error{},resolveEnemyDisplayName:e=>e.names.en},'./resourcePanelUi':helpers,'./localization/zhCN':{translateUiText:x=>x},'./scene':{scene:{characters:[],scene:new THREE.Scene()}}}
 const code=ts.transpileModule(fs.readFileSync('src/viewer/enemyPanel.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
 Function('require','module','exports',code)(name=>{if(name==='./resourceSearch')return searchHelpers;if(name==='./resourcePanelSizing')return sizeHelpers;assert.ok(deps[name],name);return deps[name]},module,module.exports)
 const api=module.exports.setupEnemyPanel({onInstanceSelected:x=>selects.push(x.instanceId),onInstanceWillRemove:x=>removed.push(x.instanceId)})
 f.cleanups.push(()=>api.dispose());return{...f,api,get manager(){return manager},tick:()=>tick(),removed,selects}
}
test('enemy image grid selects actual resource and two additions yield accurate count and independent instance rows',async t=>{
 const f=enemyFixture(t);await flush();assert.equal(document.querySelectorAll('#enemy-catalog-grid button').length,2);document.querySelector('#enemy-catalog-grid [data-value="600002"]').click();assert.equal(document.getElementById('enemy-catalog-select').value,'600002');document.getElementById('enemy-add-quantity').value='2';await document.getElementById('enemy-add-button').onclick();assert.equal(f.manager.items.length,2);assert.equal(new Set(f.manager.items.map(x=>x.instanceId)).size,2);assert.match(document.getElementById('enemy-catalog-status').textContent,/Added 2/);assert.equal(document.getElementById('enemy-panel-feedback').textContent,'','counts must not be repeated in the action row');assert.equal(document.querySelectorAll('#enemy-instance-list .resource-instance-select').length,2)
 f.manager.removeEnemy(f.manager.items[0].instanceId);f.tick();assert.match(document.getElementById('enemy-catalog-status').textContent,/Added 1/)
})
test('enemy replace loads first then replaces only chosen instance and preserves its full placement',async t=>{
 const f=enemyFixture(t);await flush();document.getElementById('enemy-add-quantity').value='2';await document.getElementById('enemy-add-button').onclick();const original=f.manager.items[0],other=f.manager.items[1];original.object.position.set(3,4,5);original.object.rotation.y=.4;original.object.scale.set(1.2,.8,1.1);f.api.selectInstance(original.instanceId);document.querySelector('#enemy-catalog-grid [data-value="600002"]').click();const q=original.object.quaternion.toArray();await document.getElementById('enemy-replace-button').onclick();assert.equal(f.manager.items.length,2);assert.equal(f.manager.items[0],other);const n=f.manager.items[1];assert.equal(n.entry.enemyMstId,600002);assert.deepEqual(n.object.position.toArray(),[3,4,5]);assert.deepEqual(n.object.quaternion.toArray(),q);assert.deepEqual(n.object.scale.toArray(),[1.2,.8,1.1]);assert.deepEqual(f.removed,[original.instanceId]);assert.equal(f.api.getSelectedInstance(),n)
})
test('enemy failed replacement keeps old object, count, transform and selection intact, and unlocks UI',async t=>{
 const f=enemyFixture(t);await flush();await document.getElementById('enemy-add-button').onclick();const original=f.manager.items[0];original.object.position.x=5;f.manager.fail=true;document.querySelector('#enemy-catalog-grid [data-value="600002"]').click();await document.getElementById('enemy-replace-button').onclick();assert.deepEqual(f.manager.items,[original]);assert.equal(original.object.position.x,5);assert.equal(f.api.getSelectedInstance(),original);assert.deepEqual(f.removed,[]);assert.equal(document.getElementById('enemy-replace-button').disabled,false);assert.match(document.getElementById('enemy-panel-feedback').textContent,/enemy load failed/);assert.match(document.getElementById('enemy-catalog-status').textContent,/Added 1/)
})


test('portrait catalogs keep square frames and full width-wrapped names without changing landscape scene rules', () => {
 const css=fs.readFileSync('src/viewer/style/resource-browser.css','utf8')
 assert.match(css,/\.runtime-selection-tile-image \{[^}]*aspect-ratio:1\/1;[^}]*height:auto;/)
 assert.match(css,/\.runtime-selection-thumbnail-grid \{[^}]*repeat\(auto-fill,minmax\(88px,1fr\)\)/)
 assert.match(css,/:not\(\.scene-thumbnail-grid\) \.runtime-selection-tile-label[\s\S]*white-space:normal;overflow:visible/)
 assert.doesNotMatch(css,/\.runtime-selection-tile-image \{height:(?:48|64|68)px;/)
 assert.match(css,/\.scene-thumbnail-grid \.runtime-selection-tile-image \{aspect-ratio:16\/9;height:auto;max-height:96px;/)
 assert.match(css,/\.scene-thumbnail-grid \{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
})

test('character search finds Japanese and reversed romaji names in a Chinese-labelled catalog and one button switches display',async t=>{
 const f=fixture(t);f.source.options[0].value='102001';f.source.options[0].textContent='柊音梦';setupRuntimeSelectionPanels();await flush()
 const input=document.getElementById('character-list-search'),button=document.getElementById('character-list-name-language')
 for(const query of ['Hiiragi Nemu','柊ねむ','Ｎｅｍｕ','102001']){input.value=query;input.oninput();assert.equal(document.querySelector('#character-list-grid button').dataset.value,'102001')}
 button.click();assert.match(document.querySelector('#character-list-grid button').textContent,/Nemu/)
 button.click();assert.match(document.querySelector('#character-list-grid button').textContent,/柊ねむ/)
 assert.equal(input.getAttribute('placeholder'),'Search using romaji or Japanese')
})

test('scene search uses both source languages regardless of displayed name, and the same button alternates them',async t=>{
 fixture(t);const option=document.getElementById('stage-selector').options[0];option.textContent='蔷薇园的魔女';Object.assign(option.dataset,{searchText:'Rose Garden Witch 薔薇園の魔女',nameEn:'Rose Garden Witch',nameJa:'薔薇園の魔女'});setupRuntimeSelectionPanels();await flush()
 const input=document.getElementById('stage-list-search'),button=document.getElementById('stage-list-name-language')
 for(const query of ['Rose Garden','薔薇園']){input.value=query;input.oninput();assert.equal(document.querySelector('#stage-list-grid button').dataset.value,'s1')}
 button.click();assert.match(document.querySelector('#stage-list-grid button').textContent,/Rose Garden/)
 button.click();assert.match(document.querySelector('#stage-list-grid button').textContent,/薔薇園/)
})

test('all currently named witches have Latin search readings while native and rune names remain searchable',()=>{
 const entries=JSON.parse(fs.readFileSync('public/enemies/manifest.v1.json','utf8')).entries
 for(const entry of entries){if(!entry.names.ja)continue;const latin=searchHelpers.enemyRomanizedName(entry.names.ja);assert.doesNotMatch(latin,/[\u3040-\u30ff\u3400-\u9fff]/,entry.names.ja);assert.ok(searchHelpers.matchesResourceSearch(latin,[entry.names.ja,latin]))}
 assert.ok(searchHelpers.matchesResourceSearch('BARAEN NO MAJO',[searchHelpers.enemyRomanizedName('薔薇園の魔女')]))
 assert.ok(searchHelpers.matchesResourceSearch('ハコ',['はこ']))
})

test('added actors use bounded portrait blocks with independent accessible remove controls',async t=>{
 const f=fixture(t),a=actors();setupRuntimeSelectionPanels(a.hooks);await flush();const row=document.querySelector('#character-instance-list .resource-instance-row')
 assert.match(row.querySelector('img').src,/a.png$/);assert.equal(row.querySelector('button:last-child').textContent,'×');assert.match(row.querySelector('button:last-child').getAttribute('aria-label'),/(?:Remove|移除) 1\./)
})

test('one-click compact sizing restores the prior user size without switching locale',async t=>{
 const f=fixture(t),a=actors();setupRuntimeSelectionPanels(a.hooks);await flush()
 const panel=document.getElementById('character-list-panel');panel.style.cssText='width: 810px; height: 640px; left: 22px; top: 18px;'
 const previous=panel.style.cssText,button=panel.querySelector('.resource-size-toggle');assert.ok(button)
 button.click();assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(panel.style.width,'536px');assert.equal(document.documentElement.lang,'en')
 button.click();assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(panel.style.cssText,previous)
 const scene=document.getElementById('stage-list-panel').querySelector('.resource-size-toggle');assert.match(scene.title,/3/)
})
