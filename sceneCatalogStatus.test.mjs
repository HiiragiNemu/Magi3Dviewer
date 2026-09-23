import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
const root=process.env.S6_SCENE_STATUS_ROOT || process.cwd()
const require=createRequire(path.join(process.env.S6_RUNTIME_ROOT || process.cwd(),'package.json'))
const ts=require('typescript')
const source=fs.readFileSync(path.join(root,'src/viewer/runtimeSelectionPanels.ts'),'utf8')
const module={}
new Function('exports','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,()=>({translateUiText:s=>s}))
const option=(official,disabled=false)=>({dataset:{...(official===undefined?{}:{official:String(official)})},disabled})

test('scene catalog counts disabled items without calling the catalog available',()=>{
 assert.equal(typeof module.formatSceneCatalogStatus,'function')
 const rows=[...Array.from({length:395},()=>option(true)),...Array.from({length:199},()=>option(true,true)),...Array.from({length:5},()=>option(false))]
 const before=JSON.stringify(rows)
 assert.equal(module.formatSceneCatalogStatus(rows,599),'Scene catalog: 599 / 599 · Official entries: 594 · Built-in references: 5 · Selectable entries: 400 · Awaiting restoration: 199')
 assert.equal(JSON.stringify(rows),before)
})
test('filter denominator remains the full catalog and pending items stay pending',()=>{
 assert.equal(module.formatSceneCatalogStatus([option(true,true),option(true,true)],599),'Scene catalog: 2 / 599 · Official entries: 2 · Built-in references: 0 · Selectable entries: 0 · Awaiting restoration: 2')
})
test('empty results retain truthful zero counts and total',()=>{
 assert.equal(module.formatSceneCatalogStatus([],599),'Scene catalog: 0 / 599 · Official entries: 0 · Built-in references: 0 · Selectable entries: 0 · Awaiting restoration: 0')
})
test('missing classification is explicit instead of counted as built-in',()=>{
 assert.match(module.formatSceneCatalogStatus([option(undefined)],1),/Built-in references: 0.*Unclassified entries: 1$/)
})
test('changing selector eligibility updates counts without changing provenance',()=>{
 const row=option(true,true)
 assert.match(module.formatSceneCatalogStatus([row],1),/Selectable entries: 0 · Awaiting restoration: 1/)
 row.disabled=false
 assert.match(module.formatSceneCatalogStatus([row],1),/Official entries: 1.*Selectable entries: 1 · Awaiting restoration: 0/)
})
test('scene summary is wired into refresh without changing character availability or selection gates',()=>{
 assert.match(source,/config\.thumbnailKind === 'scene'\s*\? formatSceneCatalogStatus\(visible, options\.length\)/)
 assert.match(source,/availableLabel: 'Available characters'/)
 assert.match(source,/if \(!sourceOption \|\| sourceOption\.disabled \|\| elements\.source\.disabled\) return/)
 assert.match(source,/attributeFilter: \['disabled', 'data-official'\]/)
 assert.doesNotMatch(source,/availableLabel: 'Available scenes'/)
})
test('both locales explain the distinction from tested or user-accepted counts',()=>{
 for(const locale of ['zhCN','jaJP']){
 const text=fs.readFileSync(path.join(root,`src/viewer/localization/${locale}.ts`),'utf8')
 for(const key of ['Scene catalog','Official entries','Built-in references','Selectable entries','Awaiting restoration','Unclassified entries','Catalog and selectable counts do not mean load-tested or user-accepted.'])assert.ok(text.includes(`'${key}':`),`${locale}:${key}`)
 }
})
