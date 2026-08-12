import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const stageId = 'battle-608-00-00-001'
const stageRoot = `public/stages/official/${stageId}`
const catalog = JSON.parse(
  readFileSync(`public/stages/catalog/${stageId}.json`, 'utf8'),
)
const uv1 = JSON.parse(readFileSync(`${stageRoot}/uv1-companion.json`, 'utf8'))
const lightmaps = JSON.parse(
  readFileSync(`${stageRoot}/lightmap-bindings.json`, 'utf8'),
)

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

test('stage 608 installs the exact raw-bundle UV1 companion', () => {
  assert.equal(uv1.schemaVersion, 3)
  assert.equal(uv1.stageId, stageId)
  assert.equal(uv1.mappedMeshCount, 20)
  assert.equal(uv1.nodes.length, 20)
  assert.equal(Object.keys(uv1.geometries).length, 6)
  assert.match(uv1.uvConvention, /CBA/)

  for (const node of uv1.nodes) {
    const geometry = uv1.geometries[node.geometryKey]
    assert.ok(geometry, `missing geometry ${node.geometryKey}`)
    const bytes = Buffer.from(geometry.uv1Base64, 'base64')
    assert.equal(bytes.length, geometry.vertexCount * 2 * 4)
    assert.equal(sha256(bytes), geometry.uv1Sha256)
  }
})

test('stage 608 binds all 20 official lightmapped renderers', () => {
  assert.equal(lightmaps.schemaVersion, 1)
  assert.equal(lightmaps.renderers.length, 20)
  assert.equal(new Set(lightmaps.renderers.map((x) => x.rendererHierarchyPath)).size, 20)
  for (const binding of lightmaps.renderers) {
    assert.equal(binding.lightmapIndex, 0)
    assert.equal(binding.lightmapScaleOffset.length, 4)
    assert.ok(binding.lightmapScaleOffset.every(Number.isFinite))
  }
})

test('stage 608 opts into strict UV1 restoration before baked-lightmap binding', () => {
  assert.deepEqual(catalog.renderProfile.lightmap, {
    textureUrl: `./stages/official/${stageId}/Lightmap-0_comp_light.png`,
    bindingsUrl: `./stages/official/${stageId}/lightmap-bindings.json`,
    encoding: 'unity-rgbm-linear',
    intensity: 1,
    uv1CompanionUrl: `./stages/official/${stageId}/uv1-companion.json`,
  })

  const stages = readFileSync('src/viewer/stages.ts', 'utf8')
  const uv1Apply = stages.indexOf('if (profileTextures.uv1Companion)')
  const lightmapApply = stages.indexOf(
    'if (profileTextures.lightmap && profileTextures.lightmapBindings)',
    uv1Apply,
  )
  assert.ok(uv1Apply >= 0)
  assert.ok(lightmapApply > uv1Apply)
  assert.match(stages, /applyStageUv1Companion\([\s\S]*?strict:\s*true/)

  assert.ok(
    !catalog.dynamic.missing.some((entry) =>
      entry.includes('lightmap offset/scale bindings and secondary UV'),
    ),
    'the restored 20/20 UV1 and lightmap bindings must not remain listed as missing',
  )
  assert.ok(
    catalog.dynamic.evidence.some((entry) =>
      entry.includes('20/20 lightmapped renderers'),
    ),
  )
})
