import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import * as THREE from 'three'

// Execute the shipped panel, substituting only its DOM/render/resource boundary.
// These are event/state regression tests, not rendered-browser acceptance.
class Element {
  constructor(tagName) {
    this.tagName = tagName
    this.children = []
    this.attributes = new Map()
    this.dataset = {}
    this._value = ''
    this.checked = false
    const classes = new Set()
    this.classList = {
      contains: name => classes.has(name),
      toggle(name, value) { value ? classes.add(name) : classes.delete(name) },
    }
  }
  setAttribute(name, value) { this.attributes.set(name, value) }
  removeAttribute(name) { this.attributes.delete(name) }
  append(...nodes) {
    for (const node of nodes) this.children.push(...(node.tagName === 'fragment' ? node.children : [node]))
  }
  replaceChildren(...nodes) {
    this.children = []
    this.append(...nodes)
    if (this.tagName === 'select') this._value = this.children[0]?.value ?? ''
  }
  get options() { return this.children }
  set value(value) { this._value = String(value) }
  get value() {
    return this.tagName !== 'select' || this.children.some(node => node.value === this._value)
      ? this._value : ''
  }
  get valueAsNumber() { return this.value === '' ? NaN : Number(this.value) }
  reportValidity() {
    if (this.value === '') return true
    const n = this.valueAsNumber
    return Number.isFinite(n) && n >= Number(this.min ?? '-Infinity')
      && n <= Number(this.max ?? 'Infinity') && (this.step !== '1' || Number.isInteger(n))
  }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  querySelector() { return { getAttribute: () => '/icon.svg' } }
  remove() {}
  click() { if (!this.disabled) return this.onclick?.() }
}

function instance(id, names = ['Wait_L', 'Damage_SE']) {
  return {
    instanceId: id,
    animationNames: names,
    currentAnimationName: 'Wait_L',
    defaultAnimationName: 'Wait_L',
    object: new THREE.Group(),
    entry: { enemyMstId: id, names: { en: id }, model: {}, thumbnail: {} },
    animationPaused: false, animationTime: 0, animationDuration: 2,
    seekAnimation(value) { this.animationTime = value; this.animationPaused = true },
    setAnimationPaused(value) { this.animationPaused = value },
    calls: [],
    playAnimation(...args) {
      this.calls.push(args)
      this.currentAnimationName = args[0]
      this.animationTime = 0
      this.animationPaused = false
      return {}
    },
  }
}

function mount(instances) {
  let tick
  const elements = new Map()
  const created = []
  const document = {
    documentElement: { lang: 'en' },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element(id.endsWith('-select') ? 'select' : 'div'))
      return elements.get(id)
    },
    createElement(tag) { const e = new Element(tag); created.push(e); return e },
    createDocumentFragment: () => new Element('fragment'),
    addEventListener() {}, removeEventListener() {},
  }
  class Manager {
    getInstances() { return instances }
    update(delta) { for (const i of instances) if (!i.animationPaused) i.animationTime += delta }
    async listEnemies() { return [] }
    clearEnemies() { const count = instances.length; instances.length = 0; return count }
    removeEnemy(id) {
      const index = instances.findIndex(row => row.instanceId === id)
      if (index < 0) return false
      instances.splice(index, 1)
      return true
    }
  }
  const imports = {
    'three': THREE,
    'magia-exedra-character-three/renderer': {
      addAnimationLoop(fn) { tick = fn }, removeAnimationLoop() {}, getClockDelta: () => 0.25,
    },
    './enemies': { EnemyResourceManager: Manager, EnemyResourceError: Error, resolveEnemyDisplayName: entry => entry.names.en },
    './localization/zhCN': { translateUiText: text => text },
    './scene': { scene: { characters: [] } },
  }
  const source = readFileSync(resolve(process.env.S6_TEST_ROOT ?? dirname(fileURLToPath(import.meta.url)), 'src/viewer/enemyPanel.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'document', 'window', 'navigator', outputText)(
    name => { assert.ok(imports[name], `Unexpected panel import ${name}`); return imports[name] },
    module, module.exports, document, { addEventListener() {}, removeEventListener() {} }, { language: 'en' },
  )
  const controller = module.exports.setupEnemyPanel()
  const control = label => created.find(e => e.tagName !== 'section' && e.attributes.get('aria-label') === label)
  return { controller, tick: () => tick(), select: control('Enemy animation'),
    apply: created.find(e => e.id === 'enemy-animation-apply'),
    repetitions: created.find(e => e.id === 'enemy-animation-repetitions'),
    toggle: created.find(e => e.id === 'enemy-animation-toggle'),
    slider: created.find(e => e.id === 'enemy-animation-slider'),
    progress: created.find(e => e.id === 'enemy-animation-progress'),
    toolbar: document.getElementById('enemy-toolbar-control') }
}

test('draft selection leaves current playback alone; only Play applies the chosen clip', () => {
 const a=instance('A'), ui=mount([a]);
 try {ui.controller.selectInstance('A');ui.select.value='Damage_SE';ui.select.onchange();
 assert.equal(a.calls.length,0);assert.equal(a.animationPaused,false);ui.tick();assert.equal(a.animationTime,.25);
 ui.toggle.click();assert.equal(a.animationPaused,true);ui.toggle.click();assert.equal(a.calls.length,0);assert.equal(a.animationTime,.25);
 ui.apply.click();assert.deepEqual(a.calls,[['Damage_SE',false,0.18,1,undefined]]);assert.equal(ui.select.value,'Damage_SE');
 assert.equal(ui.toolbar.children[0].children.filter(e=>e.tagName==='button').length,2);
 ui.select.value='Wait_L';ui.select.onchange();assert.equal(a.calls.length,1);ui.apply.click();assert.equal(a.calls[1][1],true);
 } finally {ui.controller.dispose()}
})
test('one compact toggle pauses/resumes only the selected instance without resetting time',()=>{
 const a=instance('A'),b=instance('B'),ui=mount([a,b]);
 try {ui.controller.selectInstance('A');ui.tick();assert.equal(a.animationTime,.25);
 ui.toggle.click();ui.tick();assert.equal(a.animationTime,.25);assert.equal(b.animationTime,.5);
 assert.equal(ui.toggle.attributes.get('aria-label'),'Resume enemy animation');
 ui.toggle.click();ui.tick();assert.equal(a.animationTime,.5);assert.equal(a.calls.length,0);
 }finally{ui.controller.dispose()}
})
test('slider pauses and seeks the selected instance and switching keeps individual time/state',()=>{
 const a=instance('A'),b=instance('B'),ui=mount([a,b]);
 try {ui.controller.selectInstance('A');ui.slider.value='1.3';ui.slider.oninput();ui.tick();
 assert.equal(a.animationTime,1.3);assert.equal(a.animationPaused,true);assert.equal(ui.progress.value,'65%');
 ui.controller.selectInstance('B');assert.equal(ui.slider.value,'0.25');assert.equal(b.animationPaused,false);
 ui.controller.selectInstance('A');assert.equal(ui.slider.value,'1.3');assert.equal(ui.toggle.attributes.get('aria-label'),'Resume enemy animation');
 }finally{ui.controller.dispose()}
})
test('empty controls occupy no toolbar space and disappear when the loaded enemy is removed',()=>{
 const enemies=[],ui=mount(enemies);
 try {assert.equal(ui.toolbar.children[0].hidden,true);enemies.push(instance('A'));ui.controller.selectInstance('A');
 assert.equal(ui.toolbar.children[0].hidden,false);
 ui.controller.enemyResources.removeEnemy('A');ui.controller.refreshInstances();
 assert.equal(ui.toolbar.children[0].hidden,true);assert.equal(ui.select.options.length,0);assert.equal(ui.toggle.disabled,true);
 }finally{ui.controller.dispose()}
})
test('a replacement instance with the same ID inherits no old clip, pause, or scrub position',()=>{
 const a=instance('A'),ui=mount([a]);
 try {ui.controller.selectInstance('A');ui.select.value='Damage_SE';ui.select.onchange();ui.apply.click();ui.slider.value='1.5';ui.slider.oninput();
 ui.controller.enemyResources.removeEnemy('A');ui.controller.enemyResources.getInstances().push(instance('A'));ui.controller.selectInstance('A');
 assert.equal(ui.select.value,'Wait_L');assert.equal(ui.slider.value,'0');assert.equal(ui.toggle.attributes.get('aria-label'),'Pause enemy animation');
 }finally{ui.controller.dispose()}
})

test('repeat count remains a draft until Play; invalid numbers preserve active motion',()=>{
 const a=instance('A'),ui=mount([a]);
 try {ui.controller.selectInstance('A');ui.repetitions.value='3';ui.repetitions.oninput();
 assert.equal(a.calls.length,0);ui.apply.click();assert.deepEqual(a.calls[0],['Wait_L',true,0.18,1,3]);
 ui.toggle.click();ui.toggle.click();assert.equal(a.calls.length,1);
 for(const value of ['-1','1.5','9007199254740992']){ui.repetitions.value=value;ui.repetitions.oninput();ui.apply.click();assert.equal(a.calls.length,1,value);}
 ui.repetitions.value='0';ui.repetitions.oninput();ui.apply.click();assert.equal(a.calls[1][4],0);
 }finally{ui.controller.dispose()}
})

test('repeat drafts are kept separately for each loaded instance',()=>{
 const a=instance('A'),b=instance('B'),ui=mount([a,b]);
 try {ui.controller.selectInstance('A');ui.repetitions.value='3';ui.repetitions.oninput();
 ui.controller.selectInstance('B');assert.equal(ui.repetitions.value,'');ui.repetitions.value='7';ui.repetitions.oninput();
 ui.controller.selectInstance('A');assert.equal(ui.repetitions.value,'3');ui.apply.click();assert.equal(a.calls[0][4],3);
 ui.controller.selectInstance('B');assert.equal(ui.repetitions.value,'7');ui.apply.click();assert.equal(b.calls[0][4],7);
 }finally{ui.controller.dispose()}
})
