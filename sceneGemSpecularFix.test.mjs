import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const catalog = JSON.parse(readFileSync('public/stages/catalog.json', 'utf8'))
const gem = readFileSync('magia-exedra-character-three/shaders/gem.ts', 'utf8')
const gemExtension = readFileSync('magia-exedra-character-three/shaders/gemExtension.ts', 'utf8')
const loader = readFileSync('magia-exedra-character-three/loader.ts', 'utf8')
const stylization = readFileSync('magia-exedra-character-three/shaders/stylization.ts', 'utf8')
const general = readFileSync('magia-exedra-character-three/shaders/general.ts', 'utf8')

test('600-00-00-001 no longer stacks unverified character-brightening effects', () => {
  const stage = catalog.stages.find(stage => stage.id === 'battle-600-00-00-001')
  assert.ok(stage)
  assert.equal(stage.renderProfile.source, 'manual-research')
  assert.equal(stage.renderProfile.directionalLight.intensity, 0.85)
  assert.equal(stage.renderProfile.ambientLight.intensity, 0.4)
  assert.equal(stage.renderProfile.renderer.exposure, 0.85)
  assert.equal(stage.renderProfile.bloom.enabled, false)
  assert.equal(stage.renderProfile.reDriveVolume, undefined)
  assert.equal(stage.dynamic.status, 'pending')
})

test('Gem uses character MatCap when exported and a camera-facing MatCap basis', () => {
  assert.match(gem, /matCapUrl \?\? DefaultGemMatCap/)
  assert.match(gem, /rdGemMatCapX/)
  assert.match(gem, /dot\(rdGemMatCapX, rdGemNormalVs\)/)
  assert.match(gemExtension, /official-gem-v4-depthdiff/)
  assert.match(loader, /gemMatCapMap/)
  assert.match(loader, /extendMaterialWithOfficialGem\([\s\S]*gemMatCapMap/)
})

test('Control G no longer drives an invented world-up colour gradient', () => {
  assert.doesNotMatch(stylization, /rdToonMetalGradientPosition/)
  assert.match(stylization, /metallicResponse: 0\.62/)
  assert.match(general, /rdSpecularMask = smoothstep/)
  assert.match(general, /rdSpecular = min\(rdSpecular, 1\.5\)/)
})
