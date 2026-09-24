import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root=process.env.TEST_SOURCE_ROOT||path.dirname(fileURLToPath(import.meta.url));const require=createRequire(process.env.TEST_DEPS_ROOT?path.join(process.env.TEST_DEPS_ROOT,'package.json'):import.meta.url)
const ts=require('typescript'),THREE=require('three')
const jsdomPath=process.env.TEST_JSDOM_PATH||'D:/magia/.codex-work/magius3dviewer-s6-unified-build-20260906-v11-verification/worker-dispatch-20260908/ui/audio-track-authoring/dom-fixture/node_modules/jsdom/lib/api.js'
const {JSDOM}=require(jsdomPath)
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function harness({failure=false,delayed=false}={}) {
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'));const document=dom.window.document;const calls=[],pending=[],selected=[],modes=[];const scene=new THREE.Scene()
 const donor=id=>({object:new THREE.Group(),id,dispose(){calls.push('dispose:'+id)}})
 class Manager {loadCharacterById(id){calls.push('load:'+id);if(delayed)return new Promise(resolve=>pending.push(()=>resolve(donor(id))));return failure?Promise.reject(Error('body unavailable')):Promise.resolve(donor(id))}}
 const specials=[{characterId:'100301',name:'Tiro Finale · SP',modelName:'tiro'}]
 const dependencies={'three':THREE,'magia-exedra-character-three':{default:Manager},'magia-exedra-character-three/loadingProgress':{startLoadingTask:()=>({complete(){},fail(){}})},'./localization/zhCN':{translateUiText:s=>s},'./specialWeapons':{specialWeaponDefinitions:specials,loadSpecialWeapon:async()=>{calls.push('load:tiro');return donor('tiro')}},'./independentWeapons':{listIndependentWeapons:d=>[{name:'normal',key:'normal'}],createIndependentWeapon:(d,id,key)=>{const object=new THREE.Group();return {object,characterId:id,weaponName:key,dispose(){object.removeFromParent();d.dispose()}}}}}
 const code=ts.transpileModule(fs.readFileSync(path.join(root,'src/viewer/weaponPanel.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const exports={};new Function('require','exports','document','window','Option',code)(n=>dependencies[n],exports,document,dom.window,dom.window.Option)
 const panel=exports.setupWeaponPanel({files:{},characters:[{id:'100301',name:'Mami'},{id:'113901',name:'Holy Mami'}],scene,initialPosition:()=>new THREE.Vector3(1,1,0),currentCharacterId:()=> '100301',select:o=>selected.push(o),transform:(o,mode)=>modes.push(mode),detach:o=>calls.push('detach'),closeTransform:()=>calls.push('close')})
 const el=id=>document.getElementById(id);return {panel,el,calls,pending,selected,modes,scene,dom}
}
test('opening and changing character auto-discovers weapons; no read button or numeric transform form',async()=>{
 const h=harness();h.el('weapon-panel-toggle').click();await tick();assert.ok(h.calls.includes('load:100301'));assert.equal(h.el('weapon-load'),null);assert.equal(h.el('weapon-choice').options.length,2)
 h.el('weapon-character').value='113901';h.el('weapon-character').dispatchEvent(new h.dom.window.Event('change'));await tick();assert.ok(h.calls.includes('load:113901'));assert.equal(h.el('weapon-choice').options.length,1);h.panel.dispose()
})
test('Tiro Finale remains addable without a successful whole-character load',async()=>{
 const h=harness({failure:true});h.el('weapon-panel-toggle').click();await tick();h.el('weapon-choice').value='tiro';h.el('weapon-add').click();await tick();assert.equal(h.panel.getInstances().length,1);assert.ok(h.calls.includes('load:tiro'));assert.equal(h.selected.at(-1),h.panel.getInstances()[0].object);h.panel.dispose()
})
test('ordinary add, latest selection, all three modes, removal and close survive repeated use',async()=>{
 const h=harness();h.el('weapon-panel-toggle').click();await tick();h.el('weapon-choice').value='normal';h.el('weapon-add').click();await tick();h.el('weapon-add').click();await tick();assert.equal(h.panel.getInstances().length,2);assert.equal(h.selected.at(-1),h.panel.getInstances()[1].object)
 h.panel.selectObject(h.panel.getInstances()[0].object);for(const b of h.el('weapon-transform-fields').querySelectorAll('[data-transform]'))b.click();assert.deepEqual(h.modes.slice(-3),['translate','rotate','scale']);h.el('weapon-axis-close').click();assert.ok(h.calls.includes('close'));h.el('weapon-remove').click();assert.equal(h.panel.getInstances().length,1);h.el('weapon-clear').click();assert.equal(h.panel.getInstances().length,0);h.panel.dispose()
})
test('out-of-order character discovery never installs stale choices or leaks donor',async()=>{
 const h=harness({delayed:true});h.el('weapon-panel-toggle').click();h.el('weapon-character').value='113901';h.el('weapon-character').dispatchEvent(new h.dom.window.Event('change'));h.pending[1]();await tick();h.pending[0]();await tick();assert.ok(h.calls.includes('dispose:100301'));assert.equal(h.el('weapon-choice').options.length,1);assert.equal(h.el('weapon-character').value,'113901');h.panel.dispose()
})
