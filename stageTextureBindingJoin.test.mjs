import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(fileURLToPath(import.meta.url))
const script = join(root, 'scripts', 'apply-stage-texture-bindings.py')
const python = process.env.PYTHON || process.env.PYTHON_EXECUTABLE || 'python'

const raw = {
  materials: [{
    name: 'SyntheticGround',
    validKeywords: [],
    textures: [{
      property: '_BaseMap',
      scale: [1.5, 2.25],
      offset: [0.125, -0.25],
      pointer: {
        resolved: true,
        resolvedType: 'Texture2D',
        resolvedName: 'SyntheticGroundColor',
        pathId: '-42',
        resolvedCab: 'CAB-synthetic',
        resolvedSourceBundle: 'texture/bg/synthetic',
      },
    }],
  }],
}

const sampling = {
  profile: 'jp-unity-2022.3.62f2',
  unityVersion: '2022.3.62f2',
  textures: [{
    name: 'SyntheticGroundColor',
    pathId: '-42',
    sourceCab: 'CAB-synthetic',
    filterMode: 'bilinear',
    aniso: 3,
    mipBias: 0,
    mipCount: 11,
    colorSpace: 'sRGB',
    wrapU: 'repeat',
    wrapV: 'clamp',
  }],
}

const catalog = {
  id: 'synthetic-stage',
  materialBindings: [{
    materialName: 'SyntheticGround',
    baseMapUrl: './stages/synthetic/SyntheticGroundColor.png',
  }],
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'stage-texture-binding-'))
  const paths = {
    directory,
    raw: join(directory, 'raw.json'),
    sampling: join(directory, 'sampling.json'),
    catalog: join(directory, 'catalog.json'),
    output: join(directory, 'output.json'),
  }
  await Promise.all([
    writeFile(paths.raw, JSON.stringify(raw), 'utf8'),
    writeFile(paths.sampling, JSON.stringify(sampling), 'utf8'),
    writeFile(paths.catalog, JSON.stringify(catalog), 'utf8'),
  ])
  return paths
}

function run(paths) {
  return spawnSync(python, [
    script,
    '--raw-truth', paths.raw,
    '--sampling', paths.sampling,
    '--catalog', paths.catalog,
    '--output', paths.output,
  ], { cwd: root, encoding: 'utf8' })
}

test('generic join preserves exact per-slot Unity TexEnv and sampler state', async () => {
  const paths = await fixture()
  try {
    const result = run(paths)
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(await readFile(paths.output, 'utf8'))
    assert.deepEqual(output.materialBindings[0].textures.base, {
      url: './stages/synthetic/SyntheticGroundColor.png',
      sourceProperty: '_BaseMap',
      sourceTexturePathId: '-42',
      sourceTextureBundle: 'texture/bg/synthetic',
      sourceTextureCab: 'CAB-synthetic',
      serializedColorSpace: 'srgb',
      colorSpace: 'srgb',
      coordinates: { kind: 'mesh-uv', channel: 0 },
      transform: { scale: [1.5, 2.25], offset: [0.125, -0.25] },
      wrap: { u: 'repeat', v: 'clamp' },
      filter: 'bilinear',
      anisotropy: 3,
      mipBias: 0,
      mipCount: 11,
      evidence: 'exact-unity-texture2d',
    })
    assert.equal(output.textureBindingEvidence.exactSlotCount, 1)
    assert.deepEqual(output.textureBindingEvidence.joinKey, ['sourceCab', 'pathId'])
  } finally {
    await rm(paths.directory, { recursive: true, force: true })
  }
})

test('generic join fails closed and leaves no output when sampler truth is incomplete', async () => {
  const paths = await fixture()
  try {
    await writeFile(paths.sampling, JSON.stringify({ ...sampling, textures: [] }), 'utf8')
    const result = run(paths)
    assert.equal(result.status, 2)
    assert.match(result.stderr, /no exact Texture2D sampler/)
    await assert.rejects(readFile(paths.output, 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(paths.directory, { recursive: true, force: true })
  }
})
