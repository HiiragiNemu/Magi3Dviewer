import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const script = join(root, 'scripts', 'extract-stage-texture-sampling.py')
const python = process.env.PYTHON || process.env.PYTHON_EXECUTABLE || 'python'

function runPython(args) {
  return spawnSync(python, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
}

test('CLI help exposes the fixed JP Unity profile and output contract', () => {
  const result = runPython([script, '--help'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /2022\.3\.62f2/)
  assert.match(result.stdout, /asset_bundle/)
  assert.match(result.stdout, /--profile/)
  assert.match(result.stdout, /--output/)
})

test('synthetic Texture2D fields map exactly and unknown enums fail closed', () => {
  const probe = String.raw`
import importlib.util
import json
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("stage_texture_sampling", ${JSON.stringify(script)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

settings = SimpleNamespace(
    m_FilterMode=1,
    m_Aniso=3,
    m_MipBias=0.25,
    m_WrapU=0,
    m_WrapV=1,
    m_WrapW=2,
)
data = SimpleNamespace(
    m_Name="SyntheticTexture",
    m_TextureSettings=settings,
    m_MipCount=11,
    m_ColorSpace=1,
)
reader = SimpleNamespace(
    path_id=-42,
    assets_file=SimpleNamespace(name="CAB-synthetic"),
)
closed = False
try:
    module.filter_mode_name(99)
except module.ExtractionError:
    closed = True
print(json.dumps({"record": module.texture_record(reader, data), "closed": closed}, sort_keys=True))
`
  const result = runPython(['-c', probe])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    closed: true,
    record: {
      name: 'SyntheticTexture',
      pathId: '-42',
      sourceCab: 'CAB-synthetic',
      filterMode: 'bilinear',
      aniso: 3,
      mipBias: 0.25,
      mipCount: 11,
      colorSpace: 'sRGB',
      wrapU: 'repeat',
      wrapV: 'clamp',
      wrapW: 'mirror',
    },
  })
})

test('local stage 600-003 bundle yields stable official sampler truth', (t) => {
  const bundle = process.env.MAGIA_STAGE600003_BUNDLE
    || String.raw`D:\magia\ma-ex-data\gamedata\AssetBundles\battle\stage\bg_3d_600_00_01_003`
  if (!existsSync(bundle)) {
    t.skip(`local fixture not present: ${bundle}`)
    return
  }

  const dependency = runPython(['-c', 'import UnityPy'])
  if (dependency.status !== 0) {
    t.skip('UnityPy is not installed in the selected Python environment')
    return
  }

  const first = runPython([script, bundle])
  assert.equal(first.status, 0, first.stderr)
  const second = runPython([script, bundle])
  assert.equal(second.status, 0, second.stderr)
  assert.equal(second.stdout, first.stdout, 'identical input must produce byte-identical JSON')

  const document = JSON.parse(first.stdout)
  assert.equal(document.profile, 'jp-unity-2022.3.62f2')
  assert.equal(document.unityVersion, '2022.3.62f2')
  assert.deepEqual(document.inputs, [bundle])
  assert.equal(document.textureCount, document.textures.length)

  const tile = document.textures.find((entry) => entry.name === 'uwasa_hibi_tile')
  assert.deepEqual(tile, {
    name: 'uwasa_hibi_tile',
    pathId: '152010245842349894',
    sourceCab: 'CAB-6d00a6a133f5efb9190a4d49f0919890',
    filterMode: 'bilinear',
    aniso: 1,
    mipBias: 0,
    mipCount: 11,
    colorSpace: 'sRGB',
    wrapU: 'repeat',
    wrapV: 'repeat',
    wrapW: 'repeat',
  })

  const lightmap = document.textures.find((entry) => entry.name === 'Lightmap-0_comp_light')
  assert.deepEqual(lightmap, {
    name: 'Lightmap-0_comp_light',
    pathId: '-2751333060020589169',
    sourceCab: 'CAB-6d00a6a133f5efb9190a4d49f0919890',
    filterMode: 'bilinear',
    aniso: 3,
    mipBias: 0,
    mipCount: 10,
    colorSpace: 'sRGB',
    wrapU: 'clamp',
    wrapV: 'clamp',
    wrapW: 'clamp',
  })
})
