import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(root, 'src', 'viewer', 'stageHierarchy.ts')
const runtimePath = join(root, `.stage-hierarchy-${process.pid}-${Date.now()}.mjs`)
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')
const api = await import(pathToFileURL(runtimePath).href)
after(() => rmSync(runtimePath, { force: true }))

function makeTree() {
  const wrapper = new THREE.Group(); wrapper.name = 'AssetStudioWrapper'
  const prefab = new THREE.Group(); prefab.name = 'StageRoot'; wrapper.add(prefab)
  const a = new THREE.Group(); a.name = 'SectorA'; prefab.add(a)
  const b = new THREE.Group(); b.name = 'SectorB'; prefab.add(b)
  const lightA = new THREE.Group(); lightA.name = 'MainLight'; a.add(lightA)
  const lightB = new THREE.Group(); lightB.name = 'MainLight'; b.add(lightB)
  return { wrapper, lightA, lightB }
}

test('hierarchy path resolves the intended duplicate-named stage node', () => {
  const { wrapper, lightA, lightB } = makeTree()
  assert.equal(api.resolveStageHierarchyPath(wrapper, 'StageRoot/SectorA/MainLight'), lightA)
  assert.equal(api.resolveStageHierarchyPath(wrapper, 'StageRoot\\SectorB\\MainLight'), lightB)
})

test('anchorPath wins while legacy anchorNode remains a fallback', () => {
  const { wrapper, lightB } = makeTree()
  assert.equal(api.resolveStageAnchor(wrapper, {
    anchorPath: 'StageRoot/SectorB/MainLight',
    anchorNode: 'MainLight',
  }), lightB)
  assert.equal(api.resolveStageAnchor(wrapper, { anchorNode: 'MainLight' }).name, 'MainLight')
})

test('invalid hierarchy path does not loosely skip missing intermediate nodes', () => {
  const { wrapper } = makeTree()
  assert.equal(api.resolveStageHierarchyPath(wrapper, 'StageRoot/Unknown/MainLight'), undefined)
})

test('serialized path joins a uniquely renamed runtime carrier root', () => {
  const carrier = new THREE.Group(); carrier.name = 'Stage:dungeon-intro-0001-001'
  const direction = new THREE.Group(); direction.name = 'PrologueDungeonDirection'; carrier.add(direction)
  const background = new THREE.Group(); background.name = 'Background'; direction.add(background)
  const bg02 = new THREE.Group(); bg02.name = 'intro_3dbg_0002'; background.add(bg02)

  assert.equal(
    api.resolveStageHierarchyPath(carrier, 'level_intro_0001_001'),
    carrier,
  )
  assert.equal(
    api.resolveStageHierarchyPath(
      carrier,
      'level_intro_0001_001/PrologueDungeonDirection/Background/intro_3dbg_0002',
    ),
    bg02,
  )
})

test('renamed-root suffix join remains fail-closed when two carriers match', () => {
  const wrapper = new THREE.Group(); wrapper.name = 'Wrapper'
  for (const name of ['Stage:first', 'Stage:second']) {
    const carrier = new THREE.Group(); carrier.name = name; wrapper.add(carrier)
    const direction = new THREE.Group(); direction.name = 'PrologueDungeonDirection'; carrier.add(direction)
    const background = new THREE.Group(); background.name = 'Background'; direction.add(background)
    const bg02 = new THREE.Group(); bg02.name = 'intro_3dbg_0002'; background.add(bg02)
  }

  assert.equal(
    api.resolveStageHierarchyPath(
      wrapper,
      'level_intro_0001_001/PrologueDungeonDirection/Background/intro_3dbg_0002',
    ),
    undefined,
  )
})

test('raw Unity paths resolve FBXLoader-sanitized component node names', () => {
  const wrapper = new THREE.Group(); wrapper.name = 'Wrapper'
  const prefab = new THREE.Group(); prefab.name = 'StageRoot'; wrapper.add(prefab)
  const effect = new THREE.Group(); effect.name = 'Eff_ShootingStar_(1)'; prefab.add(effect)
  const particles = new THREE.Group(); particles.name = 'Particle_System'; effect.add(particles)
  assert.equal(
    api.resolveStageHierarchyPath(
      wrapper,
      'StageRoot/Eff_ShootingStar (1)/Particle System',
    ),
    particles,
  )
})

test('a renderer PathID suffix disambiguates duplicate raw sibling paths', () => {
  const wrapper = new THREE.Group(); wrapper.name = 'Wrapper'
  const prefab = new THREE.Group(); prefab.name = 'StageRoot'; wrapper.add(prefab)
  const duplicates = [11, 22].map((pathID) => {
    const duplicate = new THREE.Group(); duplicate.name = 'Duplicate'; prefab.add(duplicate)
    const mesh = new THREE.Group(); mesh.name = `Mesh__lm_${pathID}`; duplicate.add(mesh)
    const particles = new THREE.Group(); particles.name = 'Particle_System'; mesh.add(particles)
    return particles
  })
  assert.equal(
    api.resolveStageHierarchyPath(wrapper, 'StageRoot/Duplicate/Mesh/Particle System'),
    undefined,
  )
  assert.equal(
    api.resolveStageHierarchyPath(wrapper, 'StageRoot/Duplicate/Mesh__lm_22/Particle System'),
    duplicates[1],
  )
})


test('native edge whitespace is identity, not formatting to trim', () => {
  const root = new THREE.Group(); root.name = 'StageRoot'
  const names = ['Smoke', 'Smoke_', '_Smoke', '_']
  const objects = names.map(name => { const object = new THREE.Group(); object.name = name; root.add(object); return object })
  for (const [path, object] of [['StageRoot/Smoke', objects[0]], ['StageRoot/Smoke ', objects[1]], ['StageRoot/ Smoke', objects[2]], ['StageRoot/ ', objects[3]]]) {
    assert.equal(api.resolveStageHierarchyPath(root, path), object, JSON.stringify(path))
  }
})

test('raw trailing whitespace name wins over its sanitized sibling', () => {
  const root = new THREE.Group(); root.name = 'StageRoot'
  const raw = new THREE.Group(); raw.name = 'VolumeLight '; root.add(raw)
  const sanitized = new THREE.Group(); sanitized.name = 'VolumeLight_'; root.add(sanitized)
  const trimmed = new THREE.Group(); trimmed.name = 'VolumeLight'; root.add(trimmed)
  assert.equal(api.resolveStageHierarchyPath(root, 'StageRoot/VolumeLight '), raw)
})

test('space-bearing intermediate segments preserve exact direct-child chains', () => {
  const root = new THREE.Group(); root.name = 'Stage:renamed'
  const group = new THREE.Group(); group.name = 'Section_'; root.add(group)
  const leaf = new THREE.Group(); leaf.name = '_Effect_'; group.add(leaf)
  assert.equal(api.resolveStageHierarchyPath(root, 'NativeRoot/Section / Effect '), leaf)
  const duplicate = leaf.clone(); group.add(duplicate)
  assert.equal(api.resolveStageHierarchyPath(root, 'NativeRoot/Section / Effect '), undefined)
})

test('empty separators stay compatible without erasing meaningful spaces', () => {
  const { wrapper, lightA } = makeTree()
  assert.equal(api.resolveStageHierarchyPath(wrapper, '/StageRoot//SectorA/MainLight/'), lightA)
})
