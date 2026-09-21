import { assertReleaseMaterialCorpus } from './releaseCorpusTestSupport.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import zlib from 'node:zlib'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import ts from 'typescript'

const profileDocument = JSON.parse(fs.readFileSync(
  'magia-exedra-character-three/official-material-profiles.json',
  'utf8',
))
const loaderSource = fs.readFileSync(
  'magia-exedra-character-three/loader.ts',
  'utf8',
)
const shaderSource = fs.readFileSync(
  'magia-exedra-character-three/shaders/namae.ts',
  'utf8',
)

function loadTypeScriptCommonJs(path, requireMap = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: path,
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics ?? [], [])
  const module = { exports: {} }
  Function('exports', 'require', 'module', compiled.outputText)(
    module.exports,
    specifier => {
      if (Object.hasOwn(requireMap, specifier)) return requireMap[specifier]
      throw new Error(`Unexpected import ${specifier} from ${path}`)
    },
    module,
  )
  return module.exports
}

const materialProfiles = loadTypeScriptCommonJs(
  'magia-exedra-character-three/materialProfile.ts',
  {
    './official-material-profiles.json?url':
      'fixture://official-material-profiles.json',
  },
)
await materialProfiles.loadOfficialMaterialProfiles(profileDocument)
const userDataModule = loadTypeScriptCommonJs(
  'magia-exedra-character-three/shaders/userdata.ts',
  { three: THREE },
)
const loadedNoiseTextures = []
const namaeShader = loadTypeScriptCommonJs(
  'magia-exedra-character-three/shaders/namae.ts',
  {
    three: THREE,
    '../texture': {
      async loadTexture(url, properties) {
        const texture = new THREE.Texture()
        Object.assign(texture, properties)
        texture.userData.fixtureUrl = url
        loadedNoiseTextures.push(texture)
        return texture
      },
    },
    '.': userDataModule,
    '../models/chara_113401_model/cloud_noise_tex.png':
      'fixture://cloud_noise_tex.png',
  },
)
const outlineShader = loadTypeScriptCommonJs(
  'magia-exedra-character-three/shaders/outline.ts',
  {
    three: THREE,
    './stylization': {
      toonStylizationOptions: { characterTint: '#ffffff' },
    },
    '../bakedNormal': {
      ReDriveBakedNormalAttribute: 'rdBakedNormal',
    },
  },
)

function parseModel() {
  const compressed = fs.readFileSync(
    'magia-exedra-character-three/models/chara_113401_model/chara_113401_model.fbx.gz',
  )
  const bytes = zlib.gunzipSync(compressed)
  const originalLoad = THREE.TextureLoader.prototype.load
  THREE.TextureLoader.prototype.load = function (_url, onLoad) {
    const texture = new THREE.Texture()
    queueMicrotask(() => onLoad?.(texture))
    return texture
  }
  try {
    return new FBXLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      'file:///namae-fixture/',
    )
  } finally {
    THREE.TextureLoader.prototype.load = originalLoad
  }
}

test('serialized custom shader profiles preserve black body, white eyes and compiled cutoffs', () => {
  const { historical, added } = assertReleaseMaterialCorpus(profileDocument)
  const body = materialProfiles.getOfficialMaterialProfile('NamaeShader_Body')
  const eye = materialProfiles.getOfficialMaterialProfile('NamaeShader_Eye')
  assert.deepEqual(body.customShader.baseColor, [0, 0, 0, 0])
  assert.deepEqual(eye.customShader.baseColor, [1, 1, 1, 0])
  assert.equal(body.customShader.name, 'Creative/Character/NamaeShader')
  assert.equal(body.customShader.noiseTexture, 'cloud_noise_tex')
  assert.equal(body.customShader.noiseTiling, 4)
  assert.equal(body.customShader.useVertexColorG, true)
  assert.equal(body.customShader.vertexColorThreshold, 3.9600000381469727)
  assert.equal(body.customShader.forwardCutoff, 0.4)
  assert.equal(body.customShader.outlineCutoff, 0.7)
  assert.equal(body.outlineWidth, 2.5)
  assert.equal(eye.outlineWidth, 0)
})

test('real 113401 FBX exposes all three official renderer/material slots and 65 clips', () => {
  const root = parseModel()
  const meshes = []
  root.traverse(object => {
    if (object.isMesh) meshes.push(object)
  })
  assert.deepEqual(
    meshes.map(mesh => mesh.name).sort(),
    ['Body_Mesh', 'Eye_Mesh_L', 'Eye_Mesh_R'],
  )
  assert.deepEqual(
    meshes.map(mesh => ({
      mesh: mesh.name,
      materials: (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        .map(material => material.name),
      groups: mesh.geometry.groups.length,
      drawCount: mesh.geometry.drawRange.count,
      positionCount: mesh.geometry.getAttribute('position').count,
      colorItemSize: mesh.geometry.getAttribute('color')?.itemSize,
    })).sort((a, b) => a.mesh.localeCompare(b.mesh)),
    [
      { mesh: 'Body_Mesh', materials: ['NamaeShader_Body'], groups: 0, drawCount: Infinity, positionCount: 20088, colorItemSize: 3 },
      { mesh: 'Eye_Mesh_L', materials: ['NamaeShader_Eye'], groups: 0, drawCount: Infinity, positionCount: 2304, colorItemSize: 3 },
      { mesh: 'Eye_Mesh_R', materials: ['NamaeShader_Eye'], groups: 0, drawCount: Infinity, positionCount: 2304, colorItemSize: 3 },
    ],
  )
  assert.equal(root.animations.length, 65)
  const runtime = JSON.parse(zlib.gunzipSync(fs.readFileSync(
    'magia-exedra-character-three/models/chara_113401_model/home-animations.json.gz',
  )))
  assert.equal(runtime.characterId, 113401)
  assert.equal(runtime.clips.length, 65)
})

test('runtime custom material consumes serialized noise and the literal compiled formula', async () => {
  const profile = materialProfiles
    .getOfficialMaterialProfile('NamaeShader_Body')
    .customShader
  const result = await namaeShader.createOfficialCustomCharacterMaterial({
    profile,
    noiseMap: 'fixture://cloud_noise_tex.png',
  })
  assert.ok(result.material instanceof THREE.ShaderMaterial)
  assert.equal(result.textures.length, 1)
  assert.equal(loadedNoiseTextures.length, 1)
  assert.equal(result.material.uniforms.uOfficialNoiseTiling.value, 4)
  assert.equal(result.material.uniforms.uOfficialForwardCutoff.value, 0.4)
  assert.deepEqual(
    result.material.uniforms.uOfficialBaseColor.value.toArray(),
    [0, 0, 0, 0],
  )
  assert.match(result.material.fragmentShader, /phase \* tiling \+ vec2\(fract\(-timeSeconds\)\)/)
  assert.match(result.material.fragmentShader, /noiseA \+ noiseB\) \* 0\.5/)
  assert.match(result.material.fragmentShader, /officialCoverage < uOfficialForwardCutoff/)
  assert.match(result.material.fragmentShader, /uOfficialBaseColor\.rgb \+ uOfficialEmissionColor\.rgb/)
})

test('custom outline composition declares the view-direction varying exactly once', () => {
  const profile = materialProfiles
    .getOfficialMaterialProfile('NamaeShader_Body')
    .customShader
  const material = outlineShader.createOutlineMaterial()
  namaeShader.installOfficialCustomCharacterOutline(material, {
    profile,
    noiseTexture: new THREE.Texture(),
  })
  const declarations = material.fragmentShader.match(
    /\bvarying\s+vec3\s+vOutlineViewDirectionVS\s*;/g,
  ) ?? []
  assert.equal(declarations.length, 1)
  assert.match(material.fragmentShader, /normalize\(vOutlineViewDirectionVS\)/)
})

test('loader dispatches by serialized shader identity and preserves six protected neighbors', () => {
  assert.match(loaderSource, /customShaderSlots/)
  assert.match(loaderSource, /profile\.customShader/)
  assert.match(loaderSource, /customMaterialOverrides/)
  assert.match(loaderSource, /createOfficialCustomCharacterMaterial/)
  assert.match(loaderSource, /installOfficialCustomCharacterOutline/)
  assert.doesNotMatch(loaderSource, /characterId\s*==={0,1}\s*113401/)
  assert.doesNotMatch(loaderSource, /name\.includes\(['"]namae/i)
  for (const [character, material] of [
    ['100102', 'mt_chara_100102_face'],
    ['108301', 'mt_chara_108301_face'],
    ['101901', 'mt_chara_101901_body_sj'],
    ['100107', 'mt_chara_100101_body_sj'],
    ['100101', 'mt_chara_100101_face'],
    ['100305', 'mt_chara_100305_face'],
  ]) {
    const profile = materialProfiles.getOfficialMaterialProfile(material)
    assert.equal(profile.customShader, undefined, `${character} custom branch regression`)
  }
  assert.match(shaderSource, /profile\?\.name === NAMAE_SHADER/)
  assert.match(shaderSource, /officialCoverage > uOfficialOutlineCutoff/)
})

test('official cloud-noise closure is a real 512 square PNG', () => {
  const png = fs.readFileSync(
    'magia-exedra-character-three/models/chara_113401_model/cloud_noise_tex.png',
  )
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(png.readUInt32BE(16), 512)
  assert.equal(png.readUInt32BE(20), 512)
})
