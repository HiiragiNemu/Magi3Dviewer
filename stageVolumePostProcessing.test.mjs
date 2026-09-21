import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const shader = readFileSync(
  'magia-exedra-character-three/scene/volumePostProcessing.ts',
  'utf8',
)
const effects = readFileSync(
  'magia-exedra-character-three/scene/effects.ts',
  'utf8',
)
const bloom = readFileSync(
  'magia-exedra-character-three/scene/urpBloom.ts',
  'utf8',
)
const scene = readFileSync(
  'magia-exedra-character-three/scene/index.ts',
  'utf8',
)
const guiShader = readFileSync('src/viewer/controllers/GUIShader.ts', 'utf8')
const stages = readFileSync('src/viewer/stages.ts', 'utf8')

test('Unity Volume subset retains serialized ColorAdjustments units', () => {
  assert.match(shader, /color \*= exp2\(uPostExposure\)/)
  assert.match(shader, /uContrast \* 0\.01/)
  assert.match(shader, /uSaturation \* 0\.01/)
  assert.match(shader, /uColorFilter/)
  assert.match(shader, /uHueShift/)
})

test('ReDrive profiles use the Unity 2022.3 ACES operator instead of Three ACES', () => {
  assert.match(shader, /RD_ACESCC_MIDGRAY = 0\.4135884/)
  assert.match(shader, /vec3\(0\.4397010, 0\.3829780, 0\.1773350\)/)
  assert.match(shader, /rdAcesToAcesCc/)
  assert.match(shader, /rdAcesCcToAces/)
  assert.match(shader, /rdDarkToDimSurround/)
  assert.match(shader, /0\.0245786/)
  assert.match(shader, /0\.983729/)
  assert.match(shader, /mix\(vec3\(luma\), linearCv, 0\.93\)/)
  assert.match(shader, /if \(uToneMappingMode > 0\.5\)/)
  assert.match(
    stages,
    /const unityAces = profile\.source === 'ReDriveVolume'[\s\S]*THREE\.NoToneMapping/,
  )
  assert.match(stages, /pass\.uniforms\.uToneMappingMode\.value/)
})

test('serialized Vignette has an explicit full-composite runtime pass', () => {
  assert.match(shader, /uVignetteCenter/)
  assert.match(shader, /uVignetteIntensity/)
  assert.match(shader, /uVignetteSmoothness/)
  assert.match(shader, /uVignetteRounded/)
  assert.match(shader, /uVignetteAspectRatio/)
  assert.match(shader, /uVignetteIntensity \* 3\.0/)
  assert.match(shader, /uVignetteSmoothness \* 5\.0/)
  assert.match(shader, /1\.0 - dot\(dist, dist\)/)
  assert.match(shader, /color \*= mix\(uVignetteColor, vec3\(1\.0\), vfactor\)/)
  const vignette = shader.indexOf('if (uVignetteEnabled > 0.5')
  const grading = shader.indexOf('if (uToneMappingMode > 0.5')
  assert.ok(vignette >= 0 && grading > vignette)
  assert.doesNotMatch(shader.slice(vignette, grading), /smoothstep\(/)
  assert.match(effects, /volumePostProcessPass = new ReDriveVolumePostProcessingPass/)

  const paraffin = effects.indexOf('this.composer.addPass(this.paraffinPass)')
  const volume = effects.indexOf('this.composer.addPass(this.volumePostProcessPass)')
  const output = effects.indexOf('this.composer.addPass(this.outputPass)')
  assert.ok(paraffin >= 0 && volume > paraffin && output > volume)
  assert.match(scene, /this\.effects\.volumePostProcessPass\.enabled/)
})

test('serialized ChromaticAberration uses the exact URP 14 fast three-sample operator', () => {
  assert.match(shader, /uChromaticAberrationIntensity \* 0\.05/)
  assert.match(shader, /vec2 coords = 2\.0 \* vUv - 1\.0/)
  assert.match(shader, /coords \* dot\(coords, coords\) \* chromaAmount/)
  assert.match(shader, /vec2 delta = \(end - vUv\) \/ 3\.0/)
  assert.match(shader, /texture2D\(tDiffuse, vUv \+ delta\)\.g/)
  assert.match(shader, /texture2D\(tDiffuse, vUv \+ delta \* 2\.0\)\.b/)
  const chroma = shader.indexOf('if (\n                uChromaticAberrationEnabled')
  const vignette = shader.indexOf('if (uVignetteEnabled > 0.5')
  assert.ok(chroma >= 0 && vignette > chroma)
  assert.match(stages, /profile\?\.chromaticAberration/)
  assert.match(stages, /uChromaticAberrationEnabled\.value/)
})

test('serialized FilmGrain uses official texture alpha, tiling, response, and intensity units', () => {
  assert.match(shader, /class ReDriveVolumePostProcessingPass extends ShaderPass/)
  assert.match(shader, /texture2D\([\s\S]*uFilmGrainTexture[\s\S]*uFilmGrainScale \+ uFilmGrainOffset/)
  assert.match(shader, /grain = \(grain - 0\.5\) \* 2\.0/)
  assert.match(shader, /vec3\(0\.2126729, 0\.7151522, 0\.0721750\)/)
  assert.match(shader, /lum = 1\.0 - sqrt\(lum\)/)
  assert.match(shader, /mix\(1\.0, lum, uFilmGrainResponse\)/)
  assert.match(shader, /uFilmGrainIntensity \* 4\.0/)
  assert.match(shader, /getDrawingBufferSize\(this\.drawingBufferSize\)/)
  assert.match(shader, /this\.drawingBufferSize\.x \/ textureWidth/)
  assert.match(shader, /this\.drawingBufferSize\.y \/ textureHeight/)
  assert.match(shader, /const offsetX = Math\.random\(\)/)
  assert.match(shader, /const offsetY = Math\.random\(\)/)
  const grading = shader.indexOf('if (uToneMappingMode > 0.5')
  const grain = shader.indexOf('if (uFilmGrainEnabled > 0.5')
  assert.ok(grading >= 0 && grain > grading)
  assert.match(effects, /new ReDriveVolumePostProcessingPass\(\)/)
  assert.match(stages, /texture\.wrapS = THREE\.RepeatWrapping/)
  assert.match(stages, /texture\.wrapT = THREE\.RepeatWrapping/)
  assert.match(stages, /texture\.minFilter = THREE\.LinearFilter/)
  assert.match(stages, /texture\.magFilter = THREE\.LinearFilter/)
  assert.match(stages, /loaded\.filmGrain = await load\(filmGrain\.textureUrl, 'film-grain'\)/)
})

test('stage profiles apply and reset both recovered Volume components', () => {
  assert.match(stages, /interface StageVolumePostProcessingProfile/)
  assert.match(stages, /function applyStageVolumePostProcessing/)
  assert.match(stages, /pass\.uniforms\.uColorAdjustEnabled\.value/)
  assert.match(stages, /pass\.uniforms\.uVignetteEnabled\.value/)
  assert.match(stages, /pass\.uniforms\.uVignetteAspectRatio\.value/)
  assert.match(stages, /pass\.uniforms\.uChromaticAberrationIntensity\.value/)
  assert.match(stages, /pass\.uniforms\.uFilmGrainTexture\.value/)
  assert.match(stages, /runtime: pass\.filmGrainRuntime/)
  assert.match(
    stages,
    /profile\.source === 'ReDriveVolume'[\s\S]*scene\.setColorFilter\(\{ brightness: 1, contrast: 1, saturation: 1 \}\)/,
  )
  assert.match(stages, /applyStageVolumePostProcessing\(undefined\)/)
})

test('legacy recovered stage grading is promoted to full-composite Unity units', () => {
  assert.match(stages, /function resolveStageVolumePostProcessing/)
  assert.match(
    stages,
    /profile\.source === 'ReDriveVolume'[\s\S]*profile\.colorFilter/,
  )
  assert.match(stages, /explicit\?\.colorAdjustments/)
  assert.match(
    stages,
    /postExposure: Math\.log2\(Math\.max\(recovered\.brightness, 1e-6\)\)/,
  )
  assert.match(stages, /contrast: \(recovered\.contrast - 1\) \* 100/)
  assert.match(stages, /saturation: \(recovered\.saturation - 1\) \* 100/)
  assert.match(
    stages,
    /applyStageVolumePostProcessing\([\s\S]*resolveStageVolumePostProcessing\(profile\)/,
  )
})

test('recovered Unity Bloom uses the 2022.3 URP operator, not Unreal units', () => {
  assert.match(effects, /urpBloomPass: ReDriveUrpBloomPass/)
  assert.match(effects, /this\.composer\.addPass\(this\.urpBloomPass\)/)
  assert.match(bloom, /gammaToLinear\(Math\.max\(0, this\.threshold\)\)/)
  assert.match(bloom, /uThresholdKnee\.value = threshold \* 0\.5/)
  assert.match(bloom, /0\.01621622/)
  assert.match(bloom, /3\.23076923/)
  assert.match(bloom, /THREE\.MathUtils\.lerp\([\s\S]*0\.05,[\s\S]*0\.95/)
  assert.match(bloom, /mix\(highMip, lowMip, uScatter\)/)
  assert.match(bloom, /source\.rgb \+ bloom/)
  assert.match(
    stages,
    /profile\.source === 'ReDriveVolume'[\s\S]*scene\.effects\.bloomPass\.enabled = false[\s\S]*pass\.intensity = profile\.bloom\.strength[\s\S]*pass\.scatter = profile\.bloom\.radius[\s\S]*pass\.threshold = profile\.bloom\.threshold/,
  )
  assert.doesNotMatch(stages, /profile\.bloom\.strength \* 0\.08/)
})

test('composer Auto runs URP Bloom and recovered baseline cannot double Bloom', () => {
  const composerCondition = scene.slice(
    scene.indexOf('get shouldUseComposer'),
    scene.indexOf('get characterSelectionVisible'),
  )
  assert.match(composerCondition, /this\.effects\.urpBloomPass\.enabled/)
  assert.match(
    guiShader,
    /applyRecoveredBaseline\(\)[\s\S]*scene\.effects\.urpBloomPass\.enabled = false[\s\S]*scene\.effects\.bloomPass\.enabled = true/,
  )
})
