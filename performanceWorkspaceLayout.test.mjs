import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import postcss from 'postcss'
import { Group, Bone } from 'three'
import { mountPerformancePanel } from './src/viewer/performanceEditor/panel.ts'
import { PerformanceEditorRuntime } from './src/viewer/performanceEditor/runtime.ts'
import { mountPerformanceWorkspace } from './src/viewer/performanceEditor/workspace.ts'

// Executed DOM semantics, not a rendered-browser or pixel acceptance claim.
class Element {
    constructor(tagName, ownerDocument) {
        Object.assign(this, { tagName, ownerDocument, children: [], attributes: {}, listeners: {}, style: {}, dataset: {}, _value: '', textContent: '', disabled: false, checked: false, hidden: false, parentNode: null })
    }
    get parentElement() { return this.parentNode }
    set value(v) { this._value = String(v) }
    get value() { return this._value || (this.tagName === 'select' ? this.children[0]?.value || '' : '') }
    setAttribute(k,v) { this.attributes[k] = String(v) }
    getAttribute(k) { return this.attributes[k] ?? null }
    removeAttribute(k) { delete this.attributes[k] }
    append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child) } }
    insertBefore(child, before) { child.remove(); const i = this.children.indexOf(before); assert.notEqual(i,-1); child.parentNode = this; this.children.splice(i,0,child) }
    remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this),1); this.parentNode = null }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this._value=''; this.append(...children) }
    addEventListener(type,fn) { (this.listeners[type] ||= new Set()).add(fn) }
    removeEventListener(type,fn) { this.listeners[type]?.delete(fn) }
    dispatch(type) { for(const fn of this.listeners[type]||[]) fn({target:this}) }
    focus() { this.ownerDocument.activeElement=this }
    find(fn) { if(fn(this)) return this; for(const child of this.children){const r=child.find(fn);if(r)return r} }
}
export function fixture(onOpenChange) {
    const document = { activeElement: null, createElement: tag => new Element(tag,document), createComment: () => new Element('#comment',document) }
    const app=document.createElement('div'), menu=document.createElement('div'), workspace=document.createElement('div'), viewer=document.createElement('main'), canvas=document.createElement('canvas')
    app.id='app';workspace.id='workspace';viewer.id='viewer'; viewer.append(canvas);workspace.append(viewer);app.append(menu,workspace)
    document.getElementById=id=>app.find(e=>e.id===id)
    document.querySelector=selector=>app.find(e=>`[data-performance-resource="${e.getAttribute('data-performance-resource')}"]`===selector)
    const resourceGroups=['characters','scenes','actions'].map(name=>{ const e=document.createElement('div');e.setAttribute('data-performance-resource',name);menu.append(e);return e })
    const characterSelect=document.createElement('select');characterSelect.id='character-selector';characterSelect.value='113501';let selections=0
    characterSelect.addEventListener('change',()=>selections++);resourceGroups[0].append(characterSelect)
    const toggle=document.createElement('button');toggle.setAttribute('aria-controls','performance-editor-panel');toggle.setAttribute('aria-expanded','false');menu.append(toggle)
    const storage=document.createElement('aside');storage.hidden=true;workspace.append(storage)
    const object=new Group(), bone=new Bone();bone.name='joint';object.add(bone)
    const runtime=new PerformanceEditorRuntime({actorSource:{list:()=>[{object,generation:1,label:'Actor',actions:['Wait_L'],isCurrent:()=>true}],subscribe:()=>()=>{}},framePort:{subscribeBeforePhysics:()=>()=>{},subscribeFinalPoseBeforeCamera:()=>()=>{}},channelHost:{acquire:()=>({status:'unavailable',reason:'fixture is layout only'}),notifyRootTransformChanged(){}},transitionSeconds:0})
    let audioSubscriptions=0, catalogSubscriptions=0
    const audioState=[{id:'voice-1',sourceStableKey:'fixture-voice',status:'paused',error:null,currentTime:0,actorKey:null,generation:null,lipSyncStatus:'background',lipSyncError:null,rawRms:0,mouthOpen:0}]
    const audio={get snapshot(){return structuredClone(audioState)},get catalogEntries(){return undefined},
        subscribe:fn=>{audioSubscriptions++;fn(structuredClone(audioState));return()=>audioSubscriptions--},
        subscribeCatalog:fn=>{catalogSubscriptions++;fn(undefined);return()=>catalogSubscriptions--}}
    const panel=mountPerformancePanel(storage,runtime,audio)
    let exits=0
    const layout=mountPerformanceWorkspace({workspace,panel,toggle,onExit:()=>{runtime.stop();exits++},onOpenChange})
    const byLabel=label=>app.find(e=>e.getAttribute('aria-label')===label)
    const button=label=>app.find(e=>e.tagName==='button'&&e.textContent===label)
    return {app,menu,workspace,viewer,canvas,storage,resourceGroups,toggle,panel,runtime,layout,characterSelect,byLabel,button,document,get selections(){return selections},get exits(){return exits},get audioSubscriptions(){return audioSubscriptions},get catalogSubscriptions(){return catalogSubscriptions},dispose(){layout.dispose();panel.dispose();runtime.dispose()}}
}
test('open creates a task dock and persistent transport without replacing the viewport or controls',()=>{
    const f=fixture();f.toggle.dispatch('click')
    assert.equal(f.layout.isOpen,true)
    assert.equal(f.workspace.getAttribute('data-performance-mode'),'editing')
    const dock=f.document.getElementById('performance-workspace-resources'),pose=f.document.getElementById('performance-workspace-properties'),bottom=f.document.getElementById('performance-workspace-timeline')
    for(const e of [dock,bottom]){assert.equal(e.parentNode,f.workspace);assert.equal(e.hidden,false)}
    assert.equal(pose.parentNode,dock);assert.equal(pose.hidden,true)
    assert.equal(f.viewer.parentNode,f.workspace);assert.deepEqual(f.viewer.children,[f.canvas]);assert.equal(f.storage.hidden,true)
    assert.equal(f.panel.regions.resources.parentNode,f.document.getElementById('performance-task-page-0'))
    assert.equal(f.panel.regions.properties.parentNode,pose)
    assert.equal(f.panel.regions.project.parentNode,f.document.getElementById('performance-task-page-5'))
    assert.equal(f.panel.regions.timeline.parentNode,f.document.getElementById('performance-task-page-3'))
    assert.equal(f.panel.workspaceControls.chart.parentNode.parentNode,bottom)
    assert.equal(f.button('Drag selected').parentNode,f.panel.regions.properties)
    assert.equal(f.button('Play').parentNode.parentNode,bottom)
    assert.equal(f.byLabel('Performance action').parentNode,f.panel.regions.resources)
    f.dispose()
})
test('joint layer lifecycle is notified once per open/close, including disposal',()=>{
    const changes=[], f=fixture(open=>changes.push(open))
    f.layout.setOpen(true);f.layout.setOpen(true);f.layout.setOpen(false);f.layout.setOpen(true);f.dispose()
    assert.deepEqual(changes,[true,false,true,false])
})
test('real panel timeline editing and audio subscriptions survive layout switches',()=>{
    const f=fixture(); f.layout.setOpen(true)
    f.byLabel('Duration seconds').value='24';f.byLabel('Duration seconds').dispatch('change')
    assert.equal(f.runtime.timeline.value.duration,24)
    assert.equal(f.audioSubscriptions,1);assert.equal(f.catalogSubscriptions,1)
    f.layout.setOpen(false);f.layout.setOpen(true)
    assert.equal(f.byLabel('Duration seconds').value,'24');assert.equal(f.audioSubscriptions,1);assert.equal(f.catalogSubscriptions,1)
    f.dispose();assert.equal(f.audioSubscriptions,0);assert.equal(f.catalogSubscriptions,0)
})
test('same original character IDs, selected values, disabled capabilities and events are retained',()=>{
    const f=fixture();f.characterSelect.disabled=true;f.layout.setOpen(true)
    assert.equal(f.document.getElementById('character-selector'),f.characterSelect)
    assert.equal(f.characterSelect.value,'113501');assert.equal(f.characterSelect.disabled,true)
    f.characterSelect.dispatch('change');assert.equal(f.selections,1)
    f.layout.setOpen(false);f.characterSelect.dispatch('change');assert.equal(f.selections,2)
    f.dispose()
})
test('Return to Viewer restores exact toolbar/editor order, focus and viewport identity repeatedly',()=>{
    const f=fixture();const menu=[...f.menu.children],sections=[...f.panel.element.children]
    for(let i=0;i<3;i++){
        f.toggle.dispatch('click');assert.equal(f.document.activeElement,f.button('Return to Viewer'))
        f.button('Return to Viewer').dispatch('click')
        assert.deepEqual(f.menu.children,menu);assert.deepEqual(f.panel.element.children,sections)
        assert.equal(f.document.activeElement,f.toggle);assert.equal(f.app.getAttribute('data-performance-mode'),null)
        assert.equal(f.viewer.children[0],f.canvas)
    }
    assert.equal(f.exits,3);f.dispose()
})
test('dispose is idempotent, releases listeners and restores controls while open',()=>{
    const f=fixture();const original=[...f.menu.children];f.layout.setOpen(true);f.layout.dispose();f.layout.dispose()
    assert.deepEqual(f.menu.children,original);assert.equal(f.exits,1)
    assert.equal(f.toggle.listeners.click.size,0);assert.equal(f.document.getElementById('performance-workspace-timeline'),undefined)
    assert.equal(f.toggle.getAttribute('aria-controls'),'performance-editor-panel')
    f.toggle.dispatch('click');assert.equal(f.layout.isOpen,false);f.dispose()
})
test('missing resource entry fails before constructing or moving layout nodes',()=>{
    const f=fixture();f.layout.dispose();f.resourceGroups[2].remove();const nodes=[...f.workspace.children]
    assert.throws(()=>mountPerformanceWorkspace({workspace:f.workspace,panel:f.panel,toggle:f.toggle,onExit(){}}),/requires the existing viewport/)
    assert.deepEqual(f.workspace.children,nodes);f.dispose()
})
test('joint edit choices are rotation/IK-only while root TRS and authored actions remain selectable',()=>{
    const f=fixture();f.layout.setOpen(true)
    const channels=f.byLabel('Keyframe channel').children.map(e=>e.value)
    assert.deepEqual(channels,['root-position','root-rotation','root-scale','bone-rotation','morph','action'])
    assert.deepEqual(f.byLabel('Drag mode').children.map(e=>e.value),['root','joint','ik'])
    assert.equal(f.byLabel('Performance action').value,'Wait_L')
    f.dispose()
})
test('CSS bounds the workspace and gives active task pages one scroll surface',()=>{
    const css=fs.readFileSync(new URL('./src/viewer/performanceEditor/workspace.css',import.meta.url),'utf8')
    const ast=postcss.parse(css),rules=[];ast.walkRules(rule=>rules.push(rule))
    const layout=rules.find(r=>r.selector==='#workspace[data-performance-mode="editing"]')
    assert.ok(layout.nodes.some(d=>d.prop==='grid-template-areas'&&d.value==='"header header" "resources viewport" "timeline timeline"'))
    assert.ok(layout.nodes.some(d=>d.prop==='grid-template-rows'&&d.value.includes('minmax(0, 1fr)')))
    assert.match(css,/data-performance-dock="collapsed"/)
    assert.match(css,/\.performance-task-page[^}]*overflow:\s*auto/s)
    assert.match(css,/\.performance-transport/)
    assert.doesNotMatch(css,/minmax\(240px,\s*40vh\)|position:\s*fixed/)
    assert.ok(rules.some(r=>r.selector.includes('[hidden]')&&r.nodes.some(d=>d.prop==='display'&&d.value==='none'&&d.important)))
})
test('HTML tags existing resource groups once; preserves all IDs and loads scoped stylesheet',()=>{
    const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8')
    for(const group of ['characters','scenes','actions'])assert.equal(html.split(`data-performance-resource="${group}"`).length-1,1)
    assert.match(html,/performanceEditor\/workspace.css/)
    for(const id of ['viewer','character-selector','stage-selector','animation-selector']) assert.equal(html.split(`id="${id}"`).length-1,1)
    for(const id of ['load-progress-card','load-progress-bar','load-progress-file','load-progress-percent']) assert.equal(html.split(`id="${id}"`).length-1,1)
    assert.match(html,/id="load-progress-track"[^>]*role="progressbar"/)
})
