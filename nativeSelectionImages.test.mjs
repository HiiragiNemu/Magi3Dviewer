import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import test from 'node:test'

const root = 'public/ui-thumbnails/runtime-selection/'
const manifest = JSON.parse(fs.readFileSync(root + 'manifest.v1.json', 'utf8'))
const source = JSON.parse(fs.readFileSync(root + 'source-projection-20261004.v1.json', 'utf8'))

test('every shipped character thumbnail uses the requested official 3D portrait, not a chibi style icon', () => {
  assert.equal(source.portraits.length, 99)
  assert.deepEqual(source.unresolved, [])
  assert.deepEqual(source.portraits.map(p => p.modelId).sort(), Object.keys(manifest.characters).sort())
  for (const portrait of source.portraits) {
    assert.match(portrait.sourceBundle, /^AssetBundles\/home\/doll_house_character\/thumbnail_3d\/\d+_thumbnail$/)
    assert.equal(portrait.output, manifest.characters[portrait.modelId])
    const image = fs.readFileSync('public' + portrait.output)
    assert.equal(image.subarray(8, 12).toString(), 'WEBP')
    assert.equal(createHash('sha256').update(image).digest('hex'), portrait.outputSha256)
    assert.ok(portrait.outputSize.every(n => n > 0 && n <= 256))
    assert.ok(portrait.transparentPaddingCrop.length === 4)
  }
})

test('model IDs join through the native resource name rather than matching unrelated 3D style IDs', () => {
  const get = id => source.portraits.find(p => p.modelId === id)
  assert.equal(get('100102').style3dCharacterMstId, 100106) // school uniform, not Ultimate Madoka
  assert.equal(get('100108').style3dCharacterMstId, 100105)
  assert.equal(get('100208').style3dCharacterMstId, 100207)
  assert.match(get('100101').legacyOutfitAlias, /^100107:/)
})

test('scene additions retain exact master resource IDs and the authored original suffix', () => {
  for (const row of source.newDioramaThumbnailBindings) {
    assert.equal(manifest.sceneResources[row.resourceName], row.output)
    assert.ok(fs.existsSync('public' + row.output))
  }
  const id = 'gallery-diorama-diorama-background-bg-3d-641-00-01-001-originall'
  assert.ok(manifest.scenes[id])
  assert.ok(fs.existsSync('public' + manifest.scenes[id]))
})
