import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
    animationPaused: false,
    setAnimationPaused(value) { this.animationPaused = value },
    calls: [],
    playAnimation(...args) {
      this.calls.push(args)
      this.currentAnimationName = args[0]
      return {}
    },
  }
}

function mount(instances) {
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
      addAnimationLoop() {}, removeAnimationLoop() {}, getClockDelta: () => 0,
    },
    './enemies': { EnemyResourceManager: Manager, EnemyResourceError: Error, resolveEnemyDisplayName: entry => entry.names.en },
    './localization/zhCN': { translateUiText: text => text },
    './scene': { scene: { characters: [] } },
  }
  const source = readFileSync(new URL('./src/viewer/enemyPanel.ts', import.meta.url), 'utf8')
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
  return { controller, select: control('Enemy animation'), loop: control('Enemy animation loop'),
    speed: control('Enemy animation speed'), play: control('Play enemy animation'),
    pause: control('Pause enemy animation'), toolbar: document.getElementById('enemy-toolbar-control') }
}

test('changing the enemy clip survives onchange and Play executes the chosen clip', () => {
  const enemy = instance('A')
  const ui = mount([enemy])
  try {
    ui.controller.selectInstance('A')
    ui.select.value = 'Damage_SE'
    ui.select.onchange()
    assert.equal(ui.select.value, 'Damage_SE')
    ui.play.click()
    assert.deepEqual(enemy.calls, [['Damage_SE', true, 0.18, 1]])
  } finally { ui.controller.dispose() }
})

test('loop edits and refreshes retain the chosen clip until explicit Play', () => {
  const enemy = instance('A')
  const ui = mount([enemy])
  try {
    ui.controller.selectInstance('A')
    ui.select.value = 'Damage_SE'
    ui.select.onchange()
    ui.loop.checked = false
    ui.loop.onchange()
    ui.speed.value = '1.5'
    ui.speed.onchange()
    ui.controller.refreshInstances()
    assert.equal(enemy.calls.length, 0)
    assert.equal(ui.select.value, 'Damage_SE')
    ui.play.click()
    assert.deepEqual(enemy.calls, [['Damage_SE', false, 0.18, 1.5]])
  } finally { ui.controller.dispose() }
})

test('pending clip, loop and speed belong to the exact enemy instance', () => {
  const a = instance('A'), b = instance('B')
  const ui = mount([a, b])
  try {
    ui.controller.selectInstance('A')
    ui.select.value = 'Damage_SE'; ui.select.onchange()
    ui.loop.checked = false; ui.loop.onchange()
    ui.speed.value = '1.5'; ui.speed.onchange()
    ui.controller.selectInstance('B')
    assert.equal(ui.select.value, 'Wait_L')
    assert.equal(ui.loop.checked, true)
    assert.equal(ui.speed.value, '1')
    ui.controller.selectInstance('A')
    assert.equal(ui.select.value, 'Damage_SE')
    assert.equal(ui.loop.checked, false)
    assert.equal(ui.speed.value, '1.5')
    ui.play.click()
    assert.equal(b.calls.length, 0)
    assert.deepEqual(a.calls, [['Damage_SE', false, 0.18, 1.5]])
  } finally { ui.controller.dispose() }
})

test('removing an enemy clears the controls; a replacement object inherits no draft', () => {
  const a = instance('A')
  const ui = mount([a])
  try {
    ui.controller.selectInstance('A')
    ui.select.value = 'Damage_SE'; ui.select.onchange()
    ui.controller.enemyResources.removeEnemy('A')
    ui.controller.refreshInstances()
    assert.equal(ui.play.disabled, true)
    assert.equal(ui.select.options.length, 0)
    ui.controller.enemyResources.getInstances().push(instance('A'))
    ui.controller.selectInstance('A')
    assert.equal(ui.select.value, 'Wait_L')
  } finally { ui.controller.dispose() }
})

test('selected enemy controls stay reachable outside the closed panel; pause belongs to one instance', () => {
  const a = instance('A'), b = instance('B'), ui = mount([a, b])
  try {
    ui.controller.selectInstance('A')
    assert.equal(ui.toolbar.children.length, 1)
    assert.equal(ui.toolbar.children[0].hidden, false)
    ui.pause.click()
    assert.equal(a.animationPaused, true)
    assert.equal(b.animationPaused, false)
    ui.controller.selectInstance('B')
    assert.equal(ui.pause.textContent, 'Pause enemy animation')
    ui.controller.selectInstance('A')
    assert.equal(ui.pause.textContent, 'Resume enemy animation')
    ui.pause.click()
    assert.equal(a.animationPaused, false)
  } finally { ui.controller.dispose() }
})
