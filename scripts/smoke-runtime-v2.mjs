import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

function resolveChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN
  return execFileSync(
    'bash',
    ['-lc', 'command -v google-chrome-stable || command -v google-chrome || command -v chromium || command -v chromium-browser'],
    { encoding: 'utf8' },
  ).trim()
}

const browser = await puppeteer.launch({
  executablePath: resolveChrome(),
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--ignore-certificate-errors',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
  ],
})

const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
const consoleErrors = []
const pageErrors = []
page.on('console', message => {
  const text = message.text()
  if (message.type() === 'error') consoleErrors.push(text)
})
page.on('pageerror', error => pageErrors.push(String(error)))

await page.goto('https://127.0.0.1:4173/', {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
})
await page.waitForFunction(
  () => document.body.classList.contains('no-demo') && window.scene,
  { timeout: 180_000 },
)
await page.waitForFunction(
  () => document.querySelector('#character-selector option[value="110701"]'),
  { timeout: 30_000 },
)
await page.waitForFunction(
  () => document.querySelector('#stage-selector option[data-official="true"]'),
  { timeout: 60_000 },
)

await page.select('#character-selector', '110701')
await page.waitForFunction(
  () => window.scene?.characterSelected?.character?.userData?.characterId === 110701,
  { timeout: 180_000 },
)
await page.waitForFunction(
  () => {
    const character = window.scene?.characterSelected?.character
    if (!character) return false
    return (character.userData.meshes ?? []).some(mesh => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      return materials.some(material => material?.userData?.shader)
    })
  },
  { timeout: 180_000 },
)
await page.waitForFunction(
  () => [...document.querySelectorAll('#animation-selector option')]
    .some(option => option.value === 'Wait_L'),
  { timeout: 30_000 },
)
await page.select('#animation-selector', 'Wait_L')
await page.evaluate(() => {
  const viewer = window.scene
  const character = viewer.characterSelected.character
  character.animation.paused = true
  viewer.camera.position.set(0, 1.60, 3.05)
  viewer.controls.target.set(0, 1.43, 0)
  viewer.controls.update()
})
await new Promise(resolve => setTimeout(resolve, 2_000))
await page.screenshot({ path: '/tmp/magius-smoke-ashley.png', fullPage: true })
await page.screenshot({ path: '/tmp/magius-smoke-closeup.png', fullPage: true })

const officialStageId = await page.evaluate(() => {
  const option = document.querySelector('#stage-selector option[data-official="true"]')
  return option?.value ?? null
})
if (!officialStageId) throw new Error('No official stage option was published')

await page.select('#stage-selector', officialStageId)
await page.waitForFunction(
  expected => {
    const root = window.scene?.scene?.getObjectByName('Magius3DviewerStageRoot')
    const definition = root?.userData?.stageDefinition
    let meshes = 0
    root?.traverse(object => { if (object.isMesh) meshes += 1 })
    return definition?.id === expected && definition?.official === true && meshes > 0
  },
  { timeout: 180_000 },
  officialStageId,
)
await page.evaluate(() => {
  const viewer = window.scene
  viewer.camera.position.set(4.6, 3.2, 7.2)
  viewer.controls.target.set(0, 0.8, 0)
  viewer.controls.update()
})
await new Promise(resolve => setTimeout(resolve, 2_000))
await page.screenshot({ path: '/tmp/magius-smoke-official-stage.png', fullPage: true })

const result = await page.evaluate(() => {
  const canvas = document.querySelector('#viewer canvas')
  const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl')
  const viewer = window.scene
  const character = viewer.characterSelected.character
  const source = character.animation.getAnimationClipsByName?.('Wait_L') ?? []
  const prepared = character.animation.getPreparedAnimationClipsByName?.('Wait_L') ?? []
  const guiText = document.querySelector('#three-gui')?.textContent ?? ''
  const stageOptions = [...document.querySelectorAll('#stage-selector option')]
  const stageRoot = viewer.scene.getObjectByName('Magius3DviewerStageRoot')
  let officialStageMeshCount = 0
  let officialStageMaterialCount = 0
  let officialStageTextureCount = 0
  stageRoot?.traverse(object => {
    if (!object.isMesh) return
    officialStageMeshCount += 1
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    officialStageMaterialCount += materials.filter(Boolean).length
    for (const material of materials) {
      if (!material) continue
      for (const value of Object.values(material)) {
        if (value?.isTexture) officialStageTextureCount += 1
      }
    }
  })
  const hairMeshes = character.userData.meshes.filter(mesh => mesh.name.toLowerCase().includes('hair'))
  const angelRingShaders = hairMeshes.flatMap(mesh => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    return materials.map(material => material?.userData?.shader)
      .filter(shader => shader?.uniforms?.uAngelRingEnabled)
  })
  return {
    title: document.title,
    webgl: Boolean(gl),
    canvasSize: canvas ? [canvas.width, canvas.height] : [0, 0],
    characterCount: document.querySelectorAll('#character-selector option').length,
    selectedCharacterId: character.userData.characterId,
    selectedAnimation: character.animation.current,
    sourceClips: source.map(clip => ({ name: clip.name, tracks: clip.tracks.length })),
    preparedClips: prepared.map(clip => ({ name: clip.name, tracks: clip.tracks.length })),
    stageNames: stageOptions.map(option => option.textContent ?? ''),
    officialStageCount: stageOptions.filter(option => option.dataset.official === 'true').length,
    activeStageDefinition: stageRoot?.userData?.stageDefinition ?? null,
    officialStageMeshCount,
    officialStageMaterialCount,
    officialStageTextureCount,
    hasStageRoot: Boolean(stageRoot),
    hasShaderControls: guiText.includes('Recovered ReDrive Toon base'),
    hasAngelRingControls: guiText.includes('AngelRing (UV3 + view normal)'),
    hairMeshCount: hairMeshes.length,
    angelRingShaderCount: angelRingShaders.length,
    angelRingUniforms: angelRingShaders.map(shader => ({
      enabled: Number(shader.uniforms.uAngelRingEnabled?.value ?? 0),
      hasUv1: Number(shader.uniforms.uAngelRingHasUv1?.value ?? 0),
      useHead: Number(shader.uniforms.uAngelRingUseHeadPlane?.value ?? 0),
    })),
  }
})

const failures = []
if (!result.title.includes('Magius3Dviewer')) failures.push('wrong title')
if (!result.webgl) failures.push('WebGL unavailable')
if (result.canvasSize.some(value => value <= 0)) failures.push('invalid canvas size')
if (result.characterCount < 90) failures.push(`only ${result.characterCount} characters`)
if (result.selectedCharacterId !== 110701) failures.push('Ashley not selected')
if (result.selectedAnimation !== 'Wait_L') failures.push('Wait_L not selected')
if (result.sourceClips.length < 2 || result.preparedClips.length < 1) failures.push('animation family unavailable')
const sourceTracks = result.sourceClips.reduce((sum, clip) => sum + clip.tracks, 0)
const preparedTracks = result.preparedClips.reduce((sum, clip) => sum + clip.tracks, 0)
if (preparedTracks >= sourceTracks) failures.push('duplicate animation tracks were not removed')
if (result.stageNames.length < 9 || !result.hasStageRoot) failures.push('official stage catalog/runtime unavailable')
if (result.officialStageCount < 5) failures.push(`only ${result.officialStageCount} official stages`)
if (!result.activeStageDefinition?.official) failures.push('active stage is not official geometry')
if (result.officialStageMeshCount < 1) failures.push('official stage contains no meshes')
if (result.officialStageMaterialCount < 1) failures.push('official stage contains no materials')
if (!result.hasShaderControls) failures.push('ReDrive controls missing')
if (!result.hasAngelRingControls) failures.push('UV3 AngelRing controls missing')
if (result.hairMeshCount < 1 || result.angelRingShaderCount < 1) failures.push('hair AngelRing shader missing')
if (!result.angelRingUniforms.every(item => item.enabled >= 0.5 && item.hasUv1 >= 0.5 && item.useHead >= 0.5)) {
  failures.push(`AngelRing runtime uniforms invalid: ${JSON.stringify(result.angelRingUniforms)}`)
}

const fatalConsoleErrors = consoleErrors.filter(text =>
  /Shader Error|VALIDATE_STATUS false|shader is not compiled|Could not compile WebGL/i.test(text),
)
if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(' | ')}`)
if (fatalConsoleErrors.length) failures.push(`shader errors: ${fatalConsoleErrors.join(' | ')}`)

const report = { result, consoleErrors, pageErrors, failures }
fs.writeFileSync('/tmp/magius-smoke.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
if (failures.length) process.exit(1)
