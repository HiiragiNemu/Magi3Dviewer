import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stages = await Promise.all([
  'battle-600-00-01-003',
  'battle-616-00-01-001',
].map(async id => [
  id,
  JSON.parse(await readFile(
    new URL(`./public/stages/catalog/${id}.json`, import.meta.url),
    'utf8',
  )),
]))

const legacyFields = {
  base: 'baseMapUrl',
  normal: 'normalMapUrl',
  smoothness: 'smoothnessMapUrl',
  blend: 'blendMapUrl',
  matCap: 'matCapMapUrl',
}

test('official stage shards bind every published material texture to exact Unity sampling truth', () => {
  for (const [id, stage] of stages) {
    let slotCount = 0
    for (const binding of stage.materialBindings) {
      for (const [slot, field] of Object.entries(legacyFields)) {
        if (!binding[field]) continue
        const texture = binding.textures?.[slot]
        assert.ok(texture, `${id}/${binding.materialName}/${slot} is missing exact descriptor`)
        assert.equal(texture.url, binding[field])
        assert.equal(texture.evidence, 'exact-unity-texture2d')
        assert.match(texture.sourceTexturePathId, /^-?\d+$/)
        assert.match(texture.sourceTextureBundle, /\//)
        assert.match(texture.sourceTextureCab, /^CAB-/)
        assert.ok(['srgb', 'linear'].includes(texture.serializedColorSpace))
        assert.equal(texture.transform.scale.length, 2)
        assert.equal(texture.transform.offset.length, 2)
        assert.ok(['repeat', 'clamp', 'mirror'].includes(texture.wrap.u))
        assert.ok(['repeat', 'clamp', 'mirror'].includes(texture.wrap.v))
        assert.ok(['point', 'bilinear', 'trilinear'].includes(texture.filter))
        assert.ok(Number.isInteger(texture.mipCount) && texture.mipCount > 0)
        slotCount += 1
      }
    }
    assert.equal(stage.textureBindingEvidence.unityVersion, '2022.3.62f2')
    assert.equal(stage.textureBindingEvidence.exactSlotCount, slotCount)
  }
})

test('600-003 ground uses repeat independently for all four authored texture slots', () => {
  const stage = stages.find(([id]) => id === 'battle-600-00-01-003')[1]
  const ground = stage.materialBindings.find(binding =>
    binding.materialName === 'mt_bg3d600A_01_03_ground')
  assert.deepEqual(Object.keys(ground.textures).sort(), ['base', 'blend', 'normal', 'smoothness'])
  for (const texture of Object.values(ground.textures)) {
    assert.deepEqual(texture.wrap, { u: 'repeat', v: 'repeat' })
    assert.deepEqual(texture.transform, { scale: [1, 1], offset: [0, 0] })
  }
  assert.equal(ground.textures.blend.mipCount, 1)
  assert.equal(ground.textures.base.mipCount, 11)
})

test('616 ground preserves its non-identity 1.5x Unity TexEnv across color, normal and smoothness', () => {
  const stage = stages.find(([id]) => id === 'battle-616-00-01-001')[1]
  const ground = stage.materialBindings.find(binding =>
    binding.materialName === 'mt_bg3d616_01_01_ground')
  assert.ok(ground)
  for (const slot of ['base', 'normal', 'smoothness']) {
    assert.deepEqual(ground.textures[slot].transform, {
      scale: [1.5, 1.5],
      offset: [0, 0],
    })
    assert.deepEqual(ground.textures[slot].wrap, { u: 'repeat', v: 'repeat' })
  }
  assert.equal(ground.textures.smoothness.sourceProperty, '_BaseMap')
  assert.equal(ground.textures.smoothness.colorSpace, 'linear')
})
