import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import postcss from 'postcss'
import {fixture} from './performanceWorkspaceLayout.test.mjs'
// Imports and runs the ten existing lifecycle gates once alongside the compact-specific gates.
function all(root){return [root,...root.children.flatMap(all)]}
test('C1 task pages are mutually exclusive; project never shares the actors scroll surface',()=>{
 const f=fixture();try{f.layout.setOpen(true);const nav=f.document.getElementById('performance-task-tab-0').parentNode
 for(let i=0;i<6;i++){nav.children[i].dispatch('click');assert.equal(nav.children[i].getAttribute('aria-selected'),'true');const pages=nav.parentNode.children.filter(e=>e.getAttribute('role')==='tabpanel');assert.equal(pages.filter(e=>!e.hidden).length,1);assert.equal(pages[i].hidden,false)}
 assert.notEqual(f.panel.regions.project.parentElement,f.panel.regions.resources.parentElement)
 }finally{f.dispose()}
})
test('C2 keyboard tabs support arrows, Home and End with joined accessible relationships',()=>{
 const f=fixture();try{f.layout.setOpen(true);const tab=f.document.getElementById('performance-task-tab-0');let prevented=0
 for(const fn of tab.listeners.keydown)fn({key:'End',preventDefault(){prevented++}})
 const last=f.document.getElementById('performance-task-tab-5');assert.equal(f.document.activeElement,last);assert.equal(last.getAttribute('tabindex'),'0');assert.equal(prevented,1)
 for(const fn of last.listeners.keydown)fn({key:'ArrowRight',preventDefault(){}})
 assert.equal(f.document.activeElement,tab)
 for(const el of all(f.app).filter(e=>e.getAttribute('role')==='tab')){const page=f.document.getElementById(el.getAttribute('aria-controls'));assert.ok(page);assert.equal(page.getAttribute('aria-labelledby'),el.id)}
 }finally{f.dispose()}
})
test('C3 all original audio/control nodes retain exact identity and order after three workspace sessions',()=>{
 const f=fixture();try{const parents=new Map(all(f.panel.element).map(n=>[n,[...n.children]]));const controls=all(f.panel.element).filter(e=>['button','input','select','textarea'].includes(e.tagName));
 for(let round=0;round<3;round++){f.layout.setOpen(true);const mounted=all(f.app);for(const el of controls)assert.equal(mounted.filter(n=>n===el).length,1);f.layout.setOpen(false);for(const [parent,children]of parents)assert.deepEqual(parent.children,children)}
 assert.equal(f.audioSubscriptions,1);assert.equal(f.catalogSubscriptions,1)
 }finally{f.dispose()}
})
test('C4 explicit dock collapse retains transport and can be reversed without destroying controls',()=>{
 const f=fixture();try{f.layout.setOpen(true);const dock=f.button('收起工具');dock.dispatch('click');assert.equal(f.workspace.getAttribute('data-performance-dock'),'collapsed');assert.equal(dock.getAttribute('aria-expanded'),'false');assert.equal(f.button('Play').parentElement.parentElement.id,'performance-workspace-timeline');dock.dispatch('click');assert.equal(f.workspace.getAttribute('data-performance-dock'),'open');assert.equal(dock.getAttribute('aria-expanded'),'true')
 }finally{f.dispose()}
})

test('C5 real add selector is in normal flow and sticky track ruler has scroll clearance',()=>{
 const css=fs.readFileSync(new URL('./src/viewer/performanceEditor/workspace.css',import.meta.url),'utf8'),rules=[];postcss.parse(css).walkRules(r=>rules.push(r))
 const selector=rules.find(r=>r.selector==='.performance-task-page .button-dropdown > div');assert.ok(selector.nodes.some(d=>d.prop==='position'&&d.value==='static'));assert.ok(selector.nodes.some(d=>d.prop==='opacity'&&d.value==='1'))
 assert.ok(rules.some(r=>r.selector.includes('.performance-timeline-chart')&&r.nodes.some(d=>d.prop==='scroll-padding-top'&&d.value==='32px')))
 assert.ok(rules.some(r=>r.selector.includes('.performance-timeline-key')&&r.nodes.some(d=>d.prop==='scroll-margin-top'&&d.value==='32px')))
})
