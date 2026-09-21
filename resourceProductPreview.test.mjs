import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { rollup } from 'rollup'
import ts from 'typescript'

const root = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
const publicRoot = join(root, 'public')

test('battle-direct shard exposes one dependency-closed visible product', async () => {
  const rootCatalog = JSON.parse(await readFile(join(publicRoot, 'stages', 'catalog.json'), 'utf8'))
  assert.ok(rootCatalog.catalogs.includes('./stages/catalogs/official-battle-direct.v1.json'))
  assert.ok(rootCatalog.entries.includes('./stages/catalog/battle-616-00-01-001.json'))
  const shard = JSON.parse(await readFile(
    join(publicRoot, 'stages', 'catalogs', 'official-battle-direct.v1.json'),
    'utf8',
  ))
  assert.equal(shard.schema, 'magius.official-stage-catalog.v1')
  assert.equal(shard.counts.visible, shard.stages.length)
  assert.equal(shard.counts.target, shard.stages.length)
  assert.equal(
    shard.counts.fullyResolved,
    shard.stages.filter(stage => stage.product.fullyResolved).length,
  )
  const stage = shard.stages.find(value => value.id === 'battle-612-00-00-002')
  assert.ok(stage)
  assert.equal(stage.id, 'battle-612-00-00-002')
  assert.equal(stage.stableKey, 'AssetBundles/battle/stage/bg_3d_612_00_00_002')
  assert.equal(stage.product.fullyResolved, true)
  assert.equal(stage.dynamic.status, 'recovered')
  assert.equal(stage.names.ja, '舞台装置の魔女 第2階層 ボス階層')
})

test('stage geometry and serialized runtime companions reopen literally', async () => {
  const shard = JSON.parse(await readFile(
    join(publicRoot, 'stages', 'catalogs', 'official-battle-direct.v1.json'),
    'utf8',
  ))
  const stage = shard.stages.find(value => value.id === 'battle-612-00-00-002')
  assert.ok(stage)
  const productRoot = join(publicRoot, 'stages', 'official', 'battle-612-00-00-002')
  const modelName = stage.url.split('/').at(-1)
  assert.match(modelName, /\.fbxdata$/)
  const fbx = gunzipSync(await readFile(join(productRoot, modelName)))
  assert.match(fbx.subarray(0, 24).toString('ascii'), /^Kaydara FBX Binary/)
  const profile = JSON.parse(await readFile(join(productRoot, 'scene-profile.json'), 'utf8'))
  assert.equal(profile.schemaVersion, 1)
  assert.equal(profile.stageId, 'battle-612-00-00-002')
  assert.equal(profile.renderProfile.lights.length, 15)
  assert.equal(profile.materialBindings.length, 15)
  assert.equal(profile.runtime.particleSystems.length, 6)
  assert.equal(profile.runtime.particlePresets.length, 6)
  await stat(join(productRoot, 'Lightmap-0_comp_light-bc6h.dds'))
  await stat(join(productRoot, 'lightmap-bindings.json'))
  await stat(join(productRoot, 'uv1-companion.json'))
  await stat(join(productRoot, 'ReflectionProbe-0-bc6h.dds'))
})

test('isolated preview route consumes stage, enemy and VFX APIs without main UI files', async () => {
  const html = await readFile(join(root, 'resource-preview.html'), 'utf8')
  const source = await readFile(join(root, 'src', 'previews', 'resourcePreview.ts'), 'utf8')
  assert.match(html, /src\/previews\/resourcePreview\.ts/)
  assert.match(source, /EnemyResourceManager/)
  assert.match(source, /createCombatVfxPreview/)
  assert.match(source, /loadStageCatalogTree/)
  assert.match(source, /value\.id === stageKey \|\| value\.stableKey === stageKey/)
  assert.doesNotMatch(source, /src\/main|viewer\/index/)
})

async function configuredChunkRule() {
  const text = await readFile(join(root, 'vite.config.ts'), 'utf8')
  const source = ts.createSourceFile('vite.config.ts', text, ts.ScriptTarget.Latest, true)
  let body
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'manualChunks') {
      assert.equal(body, undefined, 'exactly one manualChunks rule')
      body = node.body.getText(source).slice(1, -1)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(body, 'production manualChunks rule exists')
  return new Function('id', body)
}

const cycleRoot = '/magius-resource-preview-chunk-order'
const libraryId = `${cycleRoot}/magia-exedra-character-three/index.js`
const managerId = `${cycleRoot}/src/viewer/character.js`
const screenId = `${cycleRoot}/src/viewer/combatVfxScreenEffects.js`

async function executeBothEntryOrders(manualChunks) {
  // These are the production dependency edges: the character scene consumes a
  // Viewer pass, while the Viewer manager extends the character library class.
  // The source graph is acyclic; separating the two application groups creates
  // a chunk cycle whose startup behavior depends on which entry runs first.
  const modules = new Map([
    [libraryId, `import { screen } from '../src/viewer/combatVfxScreenEffects.js';
      export class CharacterBase { static label = 'character'; }
      export function inspect() { return CharacterBase.label + ':' + screen; }`],
    [screenId, `export const screen = 'screen';`],
    [managerId, `import { CharacterBase } from '../../magia-exedra-character-three/index.js';
      export class PhysicsEnabledCharacterManager extends CharacterBase {}`],
    [`${cycleRoot}/main.js`, `import { PhysicsEnabledCharacterManager } from './src/viewer/character.js';
      export const result = PhysicsEnabledCharacterManager.label;`],
    [`${cycleRoot}/preview.js`, `import { inspect } from './magia-exedra-character-three/index.js';
      export const result = inspect();`],
  ])
  const temporary = await mkdtemp(join(tmpdir(), 'magius-resource-preview-chunk-order-'))
  let bundle
  try {
    bundle = await rollup({
      input: { main: `${cycleRoot}/main.js`, preview: `${cycleRoot}/preview.js` },
      plugins: [{
        name: 'exact-application-cycle-fixture',
        resolveId(id, importer) {
          const resolved = importer && id.startsWith('.')
            ? posix.resolve(posix.dirname(importer), id) : id
          return modules.has(resolved) ? resolved : null
        },
        load(id) { return modules.get(id) ?? null },
      }],
      onwarn(warning, defaultHandler) {
        if (warning.code !== 'CIRCULAR_DEPENDENCY') defaultHandler(warning)
      },
    })
    const { output } = await bundle.generate({
      format: 'es', manualChunks, entryFileNames: '[name].mjs', chunkFileNames: '[name].mjs',
    })
    for (const item of output) {
      assert.equal(item.type, 'chunk')
      const destination = join(temporary, item.fileName)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, item.code)
    }
    const entries = {}
    for (const name of ['main', 'preview']) {
      const url = pathToFileURL(join(temporary, `${name}.mjs`)).href
      const execution = spawnSync(process.execPath, [
        '--input-type=module', '-e',
        `const module = await import(${JSON.stringify(url)}); console.log(module.result)`,
      ], { encoding: 'utf8', timeout: 10000 })
      assert.equal(execution.error, undefined)
      entries[name] = { exit: execution.status, stdout: execution.stdout.trim(), stderr: execution.stderr }
    }
    return { entries, applicationChunks: output.filter(item =>
      item.modules[libraryId] || item.modules[managerId] || item.modules[screenId]
    ).map(item => item.fileName) }
  } finally {
    await bundle?.close()
    const absolute = resolve(temporary)
    assert.equal(dirname(absolute), resolve(tmpdir()))
    assert.ok(absolute.startsWith(join(resolve(tmpdir()), 'magius-resource-preview-chunk-order-')))
    await rm(absolute, { recursive: true, force: true })
  }
}

test('production chunk ownership keeps the connected character and Viewer runtime together', async () => {
  const rule = await configuredChunkRule()
  for (const id of [libraryId, managerId, screenId]) assert.equal(rule(id), 'viewer-runtime')
  assert.equal(rule(`${cycleRoot}/src/viewer/localization/zhCN.ts`), 'viewer-localization')
  assert.equal(rule(`${cycleRoot}/node_modules/three/src/Three.js`), 'three-core')
})

test('both independent production entry orders execute without a class initialization TDZ', async () => {
  const result = await executeBothEntryOrders(await configuredChunkRule())
  assert.equal(result.entries.main.exit, 0, result.entries.main.stderr)
  assert.equal(result.entries.main.stdout, 'character')
  assert.equal(result.entries.preview.exit, 0, result.entries.preview.stderr)
  assert.equal(result.entries.preview.stdout, 'character:screen')
  assert.deepEqual(result.applicationChunks, ['viewer-runtime.mjs'])
})

test('the former split reproduces the preview-only TDZ and does not falsely fail main', async () => {
  const result = await executeBothEntryOrders(id => {
    if (id.includes('/magia-exedra-character-three/')) return 'character-runtime'
    if (id.includes('/src/viewer/')) return 'viewer-runtime'
  })
  assert.equal(result.entries.main.exit, 0, result.entries.main.stderr)
  assert.equal(result.entries.preview.exit, 1)
  assert.match(result.entries.preview.stderr, /ReferenceError: Cannot access .+ before initialization/)
  assert.equal(result.applicationChunks.length, 2)
})
