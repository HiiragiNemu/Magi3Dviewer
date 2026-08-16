import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const evidencePath = join(root, 'research', 'official-home-animation-expression-evidence.json')
const rawEvidence = readFileSync(evidencePath, 'utf8')
const evidence = JSON.parse(rawEvidence)

const expectedSources = new Map([
  [
    'gamedata/AssetBundles/battle/character/chara_100107_battle_unit',
    {
      size: 3139872,
      sha256: '3146ceffabe46f70c5edbe31f18d1f6ef5a3a7cfc77744207b1e2cdf4df0f326',
    },
  ],
  [
    'gamedata/AssetBundles/battle/character/chara_101901_battle_unit',
    {
      size: 4036502,
      sha256: '15ecddac1e282f63441eed640f47610d5d312ca2d2d98aaccf72976a9f7ece84',
    },
  ],
  [
    'gamedata/AssetBundles/home/doll_house/chara_10010701_home',
    {
      size: 334719,
      sha256: '8940fb2c215f67d2ed2ef50e86140b654e13c0ba147993e51c977aeba30d4e07',
    },
  ],
  [
    'gamedata/AssetBundles/home/doll_house/chara_10190101_home',
    {
      size: 231234,
      sha256: 'c46ec96c81a4fc33e41276677f718b4dbe88759baf19032fe391764d7fce6826',
    },
  ],
])

const expectedExtra101901Channels = [
  'Bs.Eye_up_L',
  'Bs.Eye_up_R',
  'Bs.Eyelid_Forward_L',
  'Bs.Eyelid_Forward_R',
  'Bs.Tooth_ThinUnder',
  'Bs.Tooth_ThinUpper',
]

function assertPPtrPathIdsAreStrings(value, path = 'evidence') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPPtrPathIdsAreStrings(entry, `${path}[${index}]`))
    return
  }
  if (value === null || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    if (/pathId$/i.test(key)) {
      assert.equal(typeof child, 'string', `${childPath} must preserve its 64-bit PPtr as a string`)
      assert.match(child, /^-?\d+$/, `${childPath} must be a decimal PPtr pathId`)
    }
    assertPPtrPathIdsAreStrings(child, childPath)
  }
}

function getOverrideController(character, name) {
  const controller = character.home.overrideControllers.find(entry => entry.object.name === name)
  assert.ok(controller, `${character.homeBundleName} must preserve ${name}`)
  return controller
}

test('official Home evidence is canonical current-JP JSON tied to four exact character bundles', () => {
  // Python preserves float-valued JSON tokens such as `100.0`, while
  // JSON.stringify normalizes them to `100`.  Check the byte-format contract
  // without rewriting number lexemes through JavaScript.
  assert.ok(rawEvidence.endsWith('\n'), 'canonical evidence must end in one LF')
  assert.ok(!rawEvidence.endsWith('\n\n'), 'canonical evidence must not append a blank line')
  assert.ok(!rawEvidence.includes('\r'), 'canonical evidence must use LF line endings')
  assert.ok(!rawEvidence.includes('\t'), 'canonical evidence must use spaces, not tabs')
  assert.ok(
    rawEvidence.split('\n').every(line => !/[ \t]+$/.test(line)),
    'canonical evidence must not contain trailing horizontal whitespace',
  )
  assert.deepEqual(JSON.parse(JSON.stringify(evidence)), evidence)
  assert.deepEqual(Object.keys(evidence), [
    'schemaVersion',
    'releaseProfile',
    'unityVersion',
    'generator',
    'toolchain',
    'sourceArtifacts',
    'manifest',
    'bindingConstants',
    'sharedEvidence',
    'characters',
    'findings',
  ])
  assert.equal(evidence.schemaVersion, 1)
  assert.equal(evidence.releaseProfile, 'jp-android-3.13.0')
  assert.equal(evidence.unityVersion, '2022.3.62f2')
  assert.equal(evidence.sourceArtifacts.length, 5)

  const actualSources = new Map(
    evidence.sourceArtifacts.map(source => [source.artifact.replaceAll('\\', '/'), source]),
  )
  for (const [artifact, expected] of expectedSources) {
    const actual = actualSources.get(artifact)
    assert.ok(actual, `missing source artifact ${artifact}`)
    assert.equal(actual.size, expected.size)
    assert.equal(actual.sha256, expected.sha256)
    assert.match(actual.id, /^(battle-unit-(100107|101901)|home-(10010701|10190101))$/)
    assert.ok(actual.sourceRoot)
  }

  const manifest = actualSources.get('gamedata/AssetBundles/Android')
  assert.ok(manifest, 'missing Android AssetBundleManifest source')
  assert.equal(manifest.id, 'android-manifest')
  assert.equal(manifest.size, 465351)
  assert.equal(manifest.sha256, 'c243499e1d304cc14cd1e0abe15f6992d71937e90365e89b03ecbf035cf7b3c8')

  assert.deepEqual(Object.keys(evidence.characters), ['10010701', '10190101'])
  assertPPtrPathIdsAreStrings(evidence)
})

test('Home controller truth preserves the four official layers and override null semantics', () => {
  const expected = {
    '10010701': {
      modelId: '100107',
      battleBundleName: 'battle/character/chara_100107_battle_unit',
      homeBundleName: 'home/doll_house/chara_10010701_home',
      normalNullOverrides: 10,
    },
    '10190101': {
      modelId: '101901',
      battleBundleName: 'battle/character/chara_101901_battle_unit',
      homeBundleName: 'home/doll_house/chara_10190101_home',
      normalNullOverrides: 0,
    },
  }

  for (const [key, character] of Object.entries(evidence.characters)) {
    assert.equal(character.modelId, expected[key].modelId)
    assert.equal(character.battleBundleName, expected[key].battleBundleName)
    assert.equal(character.homeBundleName, expected[key].homeBundleName)
    assert.equal(character.home.controller.object.name, 'HomeCharacterAnimatorController')
    assert.equal(character.home.controller.layerCount, 4)
    assert.equal(character.home.controller.stateCount, 38)
    assert.deepEqual(
      character.home.controller.layers.map(layer => layer.stateCount),
      [16, 1, 19, 2],
    )
    assert.equal(
      character.home.controller.layers.reduce((sum, layer) => sum + layer.stateCount, 0),
      38,
    )

    const normal = getOverrideController(character, 'HomeOverrideController')
    const weaponA = getOverrideController(character, 'HomeOverrideControllerWeaponA')
    assert.equal(normal.mappingCount, key === '10010701' ? 30 : 20)
    assert.equal(normal.nullOverrideCount, expected[key].normalNullOverrides)
    assert.equal(weaponA.mappingCount, 30)
    assert.equal(weaponA.nullOverrideCount, 20)
  }
})

test('Face_Mesh morph inventory preserves all 60 common channels and six 101901 additions', () => {
  const madoka = evidence.characters['10010701'].battleUnit
  const touka = evidence.characters['10190101'].battleUnit
  assert.match(madoka.faceHierarchy, /\/chara\/Face_Mesh$/)
  assert.match(touka.faceHierarchy, /\/chara\/Face_Mesh$/)
  assert.equal(madoka.animatorRelativeFacePath, 'chara/Face_Mesh')
  assert.equal(touka.animatorRelativeFacePath, 'chara/Face_Mesh')
  assert.equal(madoka.animatorRelativeFacePathHash, 2264444960)
  assert.equal(touka.animatorRelativeFacePathHash, 2264444960)
  assert.equal(madoka.channelCount, 60)
  assert.equal(touka.channelCount, 66)
  assert.equal(madoka.channels.length, 60)
  assert.equal(touka.channels.length, 66)

  for (const unit of [madoka, touka]) {
    assert.deepEqual(
      unit.channels.map(channel => channel.index),
      Array.from({ length: unit.channelCount }, (_, index) => index),
    )
    for (const channel of unit.channels) {
      assert.equal(channel.frameCount, 1)
      assert.equal(channel.fullWeight, 100)
      assert.match(channel.name, /^Bs\./)
    }
  }

  const madokaNames = new Set(madoka.channels.map(channel => channel.name))
  const extra101901 = touka.channels
    .map(channel => channel.name)
    .filter(name => !madokaNames.has(name))
    .sort()
  assert.deepEqual(extra101901, expectedExtra101901Channels)
  assert.deepEqual(evidence.sharedEvidence.additional101901Channels, expectedExtra101901Channels)
})

test('blink and mouth evidence retains exact scalar bindings and fail-closed empty clips', () => {
  for (const character of Object.values(evidence.characters)) {
    const clips = new Map(character.home.commonFaceClips.map(clip => [clip.name, clip]))
    const blink = clips.get('HomeEyeBlink')
    const mouthOpen = clips.get('HomeMouthOpen')
    const mouthClose = clips.get('HomeMouthClose')
    assert.ok(blink)
    assert.ok(mouthOpen)
    assert.ok(mouthClose)

    assert.equal(blink.bindingCount, 4)
    assert.deepEqual(
      Object.fromEntries(blink.bindings.map(binding => [binding.attribute, binding.values[0]])),
      {
        'Bs.Eyelid_Close_L': 100,
        'Bs.Eyelid_Close_R': 100,
        'Bs.Blink_Eyebrows_Down_L': 30.000001907348633,
        'Bs.Blink_Eyebrows_Down_R': 30.000001907348633,
      },
    )
    for (const binding of blink.bindings) {
      assert.equal(binding.path, 'chara/Face_Mesh')
      assert.equal(binding.pathHash, 2264444960)
      assert.equal(binding.typeId, 137)
      assert.equal(binding.customType, 20)
      assert.equal(binding.storage, 'constant')
    }

    assert.equal(mouthOpen.bindingCount, 5)
    const vertical = mouthOpen.bindings.find(binding => binding.attribute === 'Bs.Mouth_OpenVertically')
    assert.ok(vertical)
    assert.equal(vertical.storage, 'streamed')
    assert.equal(vertical.serializedValueMin, 0)
    assert.equal(vertical.serializedValueMax, 50)
    assert.equal(
      mouthOpen.bindings.filter(
        binding => binding.storage === 'constant' && binding.values.length === 1 && binding.values[0] === 100,
      ).length,
      4,
    )
    assert.equal(mouthClose.bindingCount, 0)
    assert.deepEqual(mouthClose.bindings, [])
  }

  assert.match(evidence.findings.join('\n'), /Face_Mesh|blend-shape/i)
  assert.match(evidence.findings.join('\n'), /Transform-only/i)
})
