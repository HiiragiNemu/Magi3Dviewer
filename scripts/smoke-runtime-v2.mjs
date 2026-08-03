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

await page.goto('https://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
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

// Ashley remains the animation-regression target.
await page.select('#character-selector', '110701')
await page.waitForFunction(
  () => window.scene?.characterSelected?.character?.userData?.characterId === 110701,
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
  viewer.characterSelected.character.animation.paused = true
  viewer.camera.position.set(0, 1.60, 3.05)
  viewer.controls.target.set(0, 1.43, 0)
  viewer.controls.update()
})
await new Promise(resolve => setTimeout(resolve, 2_000))
await page.screenshot({ path: '/tmp/magius-smoke-ashley.png', fullPage: true })

const ashleyAnimation = await page.evaluate(() => {
  const character = window.scene.characterSelected.character
  const source = character.animation.getAnimationClipsByName?.('Wait_L') ?? []
  const prepared = character.animation.getPreparedAnimationClipsByName?.('Wait_L') ?? []
  return {
    selectedCharacterId: character.userData.characterId,
    selectedAnimation: character.animation.current,
    source: source.map(clip => ({ name: clip.name, tracks: clip.tracks.length })),
    prepared: prepared.map(clip => ({ name: clip.name, tracks: clip.tracks.length })),
  }
})

// Load the first exported official stage and verify actual geometry/runtime state.
const officialStageId = await page.evaluate(() =>
  document.querySelector('#stage-selector option[data-official="true"]')?.value ?? null,
)
if (!officialStageId) throw new Error('No official stage option was published')
await page.select('#stage-selector', officialStageId)
await page.waitForFunction(
  expected => {
    const viewer = window.scene
    const root = viewer?.backgroundScene?.getObjectByName('Magius3DviewerStageRoot')
      ?? viewer?.scene?.getObjectByName('Magius3DviewerStageRoot')
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

const stageResult = await page.evaluate(() => {
  const stageOptions = [...document.querySelectorAll('#stage-selector option')]
  const viewer = window.scene
  const root = viewer.backgroundScene?.getObjectByName('Magius3DviewerStageRoot')
    ?? viewer.scene?.getObjectByName('Magius3DviewerStageRoot')
  let meshes = 0
  let materials = 0
  let textures = 0
  root?.traverse(object => {
    if (!object.isMesh) return
    meshes += 1
    const list = Array.isArray(object.material) ? object.material : [object.material]
    materials += list.filter(Boolean).length
    for (const material of list) {
      if (!material) continue
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures += 1
      }
    }
  })
  return {
    names: stageOptions.map(option => option.textContent ?? ''),
    officialCount: stageOptions.filter(option => option.dataset.official === 'true').length,
    definition: root?.userData?.stageDefinition ?? null,
    meshes,
    materials,
    textures,
  }
})

// Madoka is the official AngelRing and Soul Gem regression target.
await page.select('#character-selector', '100107')
await page.waitForFunction(
  () => window.scene?.characterSelected?.character?.userData?.characterId === 100107,
  { timeout: 180_000 },
)
await page.evaluate(async () => {
  if (window.loadStageById) await window.loadStageById('none')
  const viewer = window.scene
  viewer.characterSelected.character.animation.paused = true
  viewer.camera.position.set(0, 1.42, 2.55)
  viewer.controls.target.set(0, 1.30, 0)
  viewer.controls.update()
})
await new Promise(resolve => setTimeout(resolve, 3_000))
await page.screenshot({ path: '/tmp/magius-smoke.png', fullPage: true })
await page.screenshot({ path: '/tmp/magius-smoke-closeup.png', fullPage: true })

const madokaMaterialResult = await page.evaluate(async () => {
  const waitFrames = count => new Promise(resolve => {
    let remaining = count
    const next = () => {
      remaining -= 1
      if (remaining <= 0) resolve()
      else requestAnimationFrame(next)
    }
    requestAnimationFrame(next)
  })
  const viewer = window.scene
  const character = viewer.characterSelected.character
  const canvas = document.querySelector('#viewer canvas')
  const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl')
  const body = character.userData.meshes.find(mesh => mesh.name.toLowerCase().includes('body'))
  const profiles = body?.userData?.officialMaterialProfiles ?? []
  const gemProfiles = profiles.filter(profile => profile?.gem?.enabled)
  const materials = body ? (Array.isArray(body.material) ? body.material : [body.material]) : []
  const shaders = [...new Set(materials)]
    .map(material => material?.userData?.shader)
    .filter(Boolean)

  const sample = () => {
    if (!gl) return null
    gl.finish()
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const values = []
    const x0 = Math.floor(width * 0.36)
    const x1 = Math.floor(width * 0.64)
    const y0 = Math.floor(height * 0.43)
    const y1 = Math.floor(height * 0.70)
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const index = (y * width + x) * 4
        values.push(pixels[index], pixels[index + 1], pixels[index + 2])
      }
    }
    return values
  }

  const previous = gemProfiles.map(profile => profile.gem.enabled)
  gemProfiles.forEach(profile => { profile.gem.enabled = false })
  await waitFrames(4)
  const gemOff = sample()
  gemProfiles.forEach((profile, index) => { profile.gem.enabled = previous[index] })
  await waitFrames(4)
  const gemOn = sample()

  let changedChannels = 0
  let maxDelta = 0
  let meanAbsoluteDelta = 0
  if (gemOff && gemOn) {
    let total = 0
    for (let index = 0; index < gemOff.length; index += 1) {
      const delta = Math.abs(gemOn[index] - gemOff[index])
      total += delta
      if (delta >= 2) changedChannels += 1
      maxDelta = Math.max(maxDelta, delta)
    }
    meanAbsoluteDelta = total / Math.max(gemOff.length, 1)
  }

  const hairShaders = character.userData.meshes
    .filter(mesh => mesh.name.toLowerCase().includes('hair'))
    .flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    .map(material => material?.userData?.shader)
    .filter(shader => shader?.uniforms?.uAngelRingEnabled)

  return {
    characterId: character.userData.characterId,
    bodyMaterialSlotCount: materials.length,
    bodyGroupCount: body?.geometry?.groups?.length ?? 0,
    materialProfileNames: profiles.map(profile => profile.name),
    gemProfileCount: gemProfiles.length,
    gemUniformAvailable: shaders.some(shader => Boolean(shader.uniforms?.uMaterialIsGem)),
    matCapUniformAvailable: shaders.some(shader => Boolean(shader.uniforms?.tGemMatCap)),
    gemPixelDelta: { changedChannels, maxDelta, meanAbsoluteDelta },
    angelRingShaderCount: hairShaders.length,
    angelRingEnabled: hairShaders.every(shader => Number(shader.uniforms.uAngelRingEnabled.value) >= 0.5),
  }
})

const guiText = await page.$eval('#three-gui', element => element.textContent ?? '')
const canvasResult = await page.evaluate(() => {
  const canvas = document.querySelector('#viewer canvas')
  const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl')
  return {
    title: document.title,
    webgl: Boolean(gl),
    canvasSize: canvas ? [canvas.width, canvas.height] : [0, 0],
    characterCount: document.querySelectorAll('#character-selector option').length,
  }
})

const failures = []
if (!canvasResult.title.includes('Magius3Dviewer')) failures.push('wrong title')
if (!canvasResult.webgl) failures.push('WebGL unavailable')
if (canvasResult.canvasSize.some(value => value <= 0)) failures.push('invalid canvas size')
if (canvasResult.characterCount < 90) failures.push(`only ${canvasResult.characterCount} characters`)
if (ashleyAnimation.selectedCharacterId !== 110701 || ashleyAnimation.selectedAnimation !== 'Wait_L') failures.push('Ashley Wait_L regression target unavailable')
const sourceTracks = ashleyAnimation.source.reduce((sum, clip) => sum + clip.tracks, 0)
const preparedTracks = ashleyAnimation.prepared.reduce((sum, clip) => sum + clip.tracks, 0)
if (ashleyAnimation.source.length < 2 || preparedTracks >= sourceTracks) failures.push('Ashley duplicate animation tracks were not removed')
if (stageResult.officialCount < 5 || !stageResult.definition?.official) failures.push('official stage catalog/runtime unavailable')
if (stageResult.meshes < 1 || stageResult.materials < 1) failures.push('official stage geometry unavailable')
if (!guiText.includes('Recovered ReDrive Toon base') || !guiText.includes('AngelRing')) failures.push('shader controls missing')
if (madokaMaterialResult.characterId !== 100107) failures.push('Madoka material regression target unavailable')
if (madokaMaterialResult.bodyMaterialSlotCount < 2 || madokaMaterialResult.bodyGroupCount < 2) failures.push('FBX material groups were collapsed')
if (madokaMaterialResult.gemProfileCount < 1) failures.push('Madoka Soul Gem material profile missing')
if (!madokaMaterialResult.gemUniformAvailable || !madokaMaterialResult.matCapUniformAvailable) failures.push('Gem/MatCap shader uniforms missing')
if (madokaMaterialResult.gemPixelDelta.changedChannels < 8 || madokaMaterialResult.gemPixelDelta.maxDelta < 2) failures.push(`Soul Gem produced no measurable visual response: ${JSON.stringify(madokaMaterialResult.gemPixelDelta)}`)
if (madokaMaterialResult.angelRingShaderCount < 1 || !madokaMaterialResult.angelRingEnabled) failures.push('Madoka official AngelRing path missing')

const fatalConsoleErrors = consoleErrors.filter(text =>
  /Shader Error|VALIDATE_STATUS false|shader is not compiled|Could not compile WebGL/i.test(text),
)
if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(' | ')}`)
if (fatalConsoleErrors.length) failures.push(`shader errors: ${fatalConsoleErrors.join(' | ')}`)

const report = {
  canvas: canvasResult,
  ashleyAnimation,
  stage: stageResult,
  madokaMaterial: madokaMaterialResult,
  consoleErrors,
  pageErrors,
  failures,
}
fs.writeFileSync('/tmp/magius-smoke.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
if (failures.length) process.exit(1)
