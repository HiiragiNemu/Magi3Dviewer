import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import test from 'node:test'

const stageId = 'battle-603-00-00-001'
const stageRoot = `public/stages/official/${stageId}`
const catalogPath = `public/stages/catalog/${stageId}.json`
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function pngSize(path) {
  const bytes = readFileSync(path)
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG')
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

test('603 catalog is registered once and preserves the animated FBX carrier', () => {
  const root = JSON.parse(readFileSync('public/stages/catalog.json', 'utf8'))
  assert.equal(
    root.entries.filter((entry) => entry === `./stages/catalog/${stageId}.json`).length,
    1,
  )
  assert.equal(catalog.id, stageId)
  assert.equal(catalog.type, 'fbx')
  assert.equal(catalog.runtime.clipNames[0], 'bg3d6010_03')
  assert.equal(catalog.runtime.autoplay, true)
  assert.equal(catalog.dynamic.status, 'partial')
  assert.match(
    readFileSync(`${stageRoot}/bg_3d_603_00_00_001-animated.fbxdata`)
      .subarray(0, 20)
      .toString('ascii'),
    /^Kaydara FBX Binary/,
  )
})

test('603 runtime package reopens with exact hashes and byte total', () => {
  const entries = Object.entries(catalog.packageEvidence.files)
  assert.equal(entries.length, catalog.packageEvidence.fileCount)
  let bytes = 0
  for (const [name, expectedHash] of entries) {
    const path = `${stageRoot}/${name}`
    assert.equal(existsSync(path), true, `missing ${name}`)
    assert.equal(sha256(path), expectedHash, `hash drift: ${name}`)
    bytes += statSync(path).size
  }
  assert.equal(bytes, catalog.packageEvidence.totalBytes)
})

test('603 restores AssetStudio-dropped UV1, lightmaps and both cubemaps', () => {
  const uv1 = JSON.parse(readFileSync(`${stageRoot}/uv1-companion.json`, 'utf8'))
  const lightmaps = JSON.parse(readFileSync(`${stageRoot}/lightmap-bindings.json`, 'utf8'))
  assert.equal(uv1.schemaVersion, 3)
  assert.equal(uv1.nodes.length, 3)
  assert.equal(lightmaps.renderers.length, 3)
  assert.deepEqual(
    pngSize(`${stageRoot}/bg3d603_00_ReflectionProbe-equirect.png`),
    [512, 256],
  )
  assert.deepEqual(
    pngSize(`${stageRoot}/ReflectionProbe-0-equirect.png`),
    [256, 128],
  )
  assert.notEqual(
    catalog.packageEvidence.files['bg3d603_00_ReflectionProbe-equirect.png'],
    catalog.packageEvidence.files['ReflectionProbe-0-equirect.png'],
  )
})

test('603 binds recovered materials, flow, lights, volume and ReDrive values', () => {
  assert.equal(catalog.materialBindings.length, 6)
  assert.equal(catalog.materialBindings.find((x) => x.materialName.endsWith('_grd')).blending, 'additive')
  assert.equal(catalog.materialBindings.find((x) => x.materialName.endsWith('_ground')).vertexColorBlend, true)
  for (const name of ['bg3d603_00_foam', 'bg3d603_00_sky']) {
    const binding = catalog.materialBindings.find((x) => x.materialName === name)
    assert.ok(binding.multiUvScroll)
    assert.equal(binding.flowMap.textureUrl, `./stages/official/${stageId}/flowmap.png`)
  }
  const profile = catalog.renderProfile
  assert.equal(profile.lights.length, 2)
  assert.equal(profile.lights[0].role, 'character-key')
  assert.equal(profile.lights[1].role, 'background')
  assert.deepEqual(profile.fog.color, [0.6745283, 0.88464504, 1, 1])
  assert.equal(profile.fog.affectsCharacters, false)
  assert.equal(profile.postProcessing.colorAdjustments.contrast, 10)
  assert.equal(profile.postProcessing.colorAdjustments.saturation, 15)
  assert.equal(profile.postProcessing.vignette.intensity, 0.4)
  assert.equal(profile.reDriveVolume.shAmbient.length, 27)
  assert.equal(profile.reDriveVolume.characterLightingOverrideRatio, 0.35)
})

test('603 fidelity layers distinguish source truth from carrier and runtime', () => {
  const { source, carrier, runtime } = catalog.fidelity.layers
  assert.equal(source.meshCount, 25)
  assert.equal(source.materialCount, 9)
  assert.equal(source.particleSystemCount, 1)
  assert.equal(carrier.materialCount, 6)
  assert.equal(carrier.lightCount, 0)
  assert.equal(runtime.lightCount, 2)
  assert.equal(runtime.reflectionProbeCount, 2)
  assert.equal(runtime.lightmapBindingCount, 3)
  assert.equal(runtime.particleSystemCount, 0)
  assert.ok(catalog.fidelity.omissions.length >= 6)
})
