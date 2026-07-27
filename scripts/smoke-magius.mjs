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

let loadedUrl
for (const url of ['https://127.0.0.1:4173/', 'http://127.0.0.1:4173/']) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    loadedUrl = url
    break
  } catch (error) {
    console.warn(`Preview URL failed: ${url}: ${error}`)
  }
}
if (!loadedUrl) throw new Error('Could not open the Vite preview server')

await page.waitForFunction(
  () => document.querySelectorAll('#stage-selector option').length >= 4,
  { timeout: 30_000 },
)
await page.waitForFunction(
  () => document.querySelector('#character-selector option[value="110701"]'),
  { timeout: 30_000 },
)
await page.waitForFunction(
  () => document.body.classList.contains('no-demo'),
  { timeout: 150_000 },
)

// Switch the visual regression target to Ashley Taylor and wait until materials,
// animation families and the Head-space AngelRing shader are fully attached.
await page.select('#character-selector', '110701')
await page.waitForFunction(
  () => window.scene?.characterSelected?.character?.userData?.characterId === 110701,
  { timeout: 180_000 },
)
await page.waitForFunction(
  () => {
    const character = window.scene?.characterSelected?.character
    if (!character) return false
    return (character.userData.meshes ?? [])
      .filter(mesh => mesh.name.toLowerCase().includes('hair'))
      .some(mesh => {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        return materials.some(material => Boolean(material?.userData?.shader?.uniforms?.uAngelRingEnabled))
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
await new Promise(resolve => setTimeout(resolve, 5_000))

// Freeze Ashley so the on/off AngelRing comparison is not contaminated by
// motion between frames.
await page.evaluate(() => {
  const character = window.scene?.characterSelected?.character
  if (character) character.animation.paused = true
  const viewerScene = window.scene
  if (!viewerScene) return
  viewerScene.camera.position.set(0, 1.60, 3.05)
  viewerScene.controls.target.set(0, 1.43, 0)
  viewerScene.controls.update()
})
await new Promise(resolve => setTimeout(resolve, 2_000))
await page.screenshot({ path: '/tmp/magius-smoke-ashley.png', fullPage: true })

const result = await page.evaluate(async () => {
  const waitFrames = count => new Promise(resolve => {
    let remaining = count
    const next = () => {
      remaining -= 1
      if (remaining <= 0) resolve()
      else requestAnimationFrame(next)
    }
    requestAnimationFrame(next)
  })

  const canvas = document.querySelector('#viewer canvas')
  const guiText = document.querySelector('#three-gui')?.textContent ?? ''
  const stageNames = [...document.querySelectorAll('#stage-selector option')]
    .map(option => option.textContent ?? '')
  const gl = canvas instanceof HTMLCanvasElement
    ? canvas.getContext('webgl2') || canvas.getContext('webgl')
    : null

  const viewerScene = window.scene
  const loadedCharacters = viewerScene?.characters
    ?.map(entry => entry.character)
    .filter(Boolean) ?? []
  const selectedCharacter = viewerScene?.characterSelected?.character
  const meshes = selectedCharacter?.userData.meshes ?? []
  const hairMeshes = meshes.filter(mesh => mesh.name.toLowerCase().includes('hair'))
  const angelRingShaders = hairMeshes.flatMap(mesh => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    return materials
      .map(material => material?.userData?.shader)
      .filter(shader => Boolean(shader?.uniforms?.uAngelRingEnabled))
  })

  const familySourceClips = selectedCharacter?.animation
    ?.getAnimationClipsByName?.('Wait_L') ?? []
  const preparedFamilyClips = selectedCharacter?.animation
    ?.getPreparedAnimationClipsByName?.('Wait_L') ?? []

  const planeUniforms = angelRingShaders.map(shader => ({
    enabled: Number(shader.uniforms.uAngelRingEnabled?.value ?? 0),
    useHeadPlane: Number(shader.uniforms.uAngelRingUseHeadPlane?.value ?? 0),
    position: shader.uniforms.uAngelRingPlanePosition?.value?.toArray?.() ?? null,
    up: shader.uniforms.uAngelRingPlaneUp?.value?.toArray?.() ?? null,
    right: shader.uniforms.uAngelRingPlaneRight?.value?.toArray?.() ?? null,
    forward: shader.uniforms.uAngelRingPlaneForward?.value?.toArray?.() ?? null,
    bandHalfWidth: Number(shader.uniforms.uAngelRingBandHalfWidth?.value ?? 0),
    projectionRadius: Number(shader.uniforms.uAngelRingProjectionRadius?.value ?? 0),
    uvMode: Number(shader.uniforms.uAngelRingUvMode?.value ?? 0),
  }))

  const sampleFrame = () => {
    if (!gl || !(canvas instanceof HTMLCanvasElement)) return null
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    const pixels = new Uint8Array(width * height * 4)
    gl.finish()
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    // Head occupies the centre/top region after the camera adjustment. Sampling
    // every second pixel keeps the report compact while retaining the ring band.
    const samples = []
    const x0 = Math.floor(width * 0.23)
    const x1 = Math.floor(width * 0.77)
    const y0 = Math.floor(height * 0.34)
    const y1 = Math.floor(height * 0.86)
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const index = (y * width + x) * 4
        samples.push(pixels[index], pixels[index + 1], pixels[index + 2])
      }
    }
    return samples
  }

  const originalEnabled = angelRingShaders.map(shader => Number(shader.uniforms.uAngelRingEnabled.value))
  angelRingShaders.forEach(shader => { shader.uniforms.uAngelRingEnabled.value = 0 })
  await waitFrames(4)
  const ringOff = sampleFrame()
  angelRingShaders.forEach((shader, index) => {
    shader.uniforms.uAngelRingEnabled.value = originalEnabled[index]
  })
  await waitFrames(4)
  const ringOn = sampleFrame()

  let angelRingPixelDelta = null
  if (ringOff && ringOn && ringOff.length === ringOn.length) {
    let absoluteDelta = 0
    let changedChannels = 0
    let maxDelta = 0
    for (let index = 0; index < ringOff.length; index += 1) {
      const delta = Math.abs(ringOn[index] - ringOff[index])
      absoluteDelta += delta
      if (delta >= 2) changedChannels += 1
      maxDelta = Math.max(maxDelta, delta)
    }
    angelRingPixelDelta = {
      sampledChannels: ringOff.length,
      changedChannels,
      meanAbsoluteDelta: absoluteDelta / Math.max(ringOff.length, 1),
      maxDelta,
    }
  }

  return {
    title: document.title,
    stageNames,
    characterCount: document.querySelectorAll('#character-selector option').length,
    selectedCharacterId: selectedCharacter?.userData?.characterId ?? null,
    selectedAnimation: selectedCharacter?.animation?.current ?? null,
    loadedCharacterCount: loadedCharacters.length,
    canvasWidth: canvas instanceof HTMLCanvasElement ? canvas.width : 0,
    canvasHeight: canvas instanceof HTMLCanvasElement ? canvas.height : 0,
    webgl: Boolean(gl),
    hasOfficialToonControls: guiText.includes('Official ReDrive Toon'),
    hasAngelRingControls: guiText.includes('AngelRing (Hair)'),
    hasStageControls: guiText.includes('3D Stage'),
    activeStagePresent: Boolean(
      viewerScene?.scene?.getObjectByName('Magius3DviewerStageRoot'),
    ),
    hairMeshCount: hairMeshes.length,
    angelRingShaderCount: angelRingShaders.length,
    angelRingPlaneUniforms: planeUniforms,
    angelRingPixelDelta,
    waitFamilySourceClips: familySourceClips.map(clip => ({
      name: clip.name,
      tracks: clip.tracks.length,
    })),
    waitFamilyPreparedClips: preparedFamilyClips.map(clip => ({
      name: clip.name,
      tracks: clip.tracks.length,
    })),
    demoHidden: document.body.classList.contains('no-demo'),
  }
})

await new Promise(resolve => setTimeout(resolve, 1_000))
await page.screenshot({ path: '/tmp/magius-smoke-closeup.png', fullPage: true })

const fatalConsolePatterns = [
  /THREE\.WebGLProgram: Shader Error/i,
  /VALIDATE_STATUS false/i,
  /Fragment shader is not compiled/i,
  /Vertex shader is not compiled/i,
  /Could not compile WebGL program/i,
]
const fatalConsoleErrors = consoleErrors.filter(text =>
  fatalConsolePatterns.some(pattern => pattern.test(text)),
)

const failures = []
if (!result.title.includes('Magius3Dviewer')) failures.push('wrong document title')
if (!result.webgl) failures.push('WebGL context unavailable')
if (result.canvasWidth <= 0 || result.canvasHeight <= 0) failures.push('renderer canvas has no size')
if (result.characterCount <= 0) failures.push('character selector is empty')
if (result.selectedCharacterId !== 110701) failures.push(`Ashley was not selected: ${result.selectedCharacterId}`)
if (result.selectedAnimation !== 'Wait_L') failures.push(`Ashley Wait_L was not selected: ${result.selectedAnimation}`)
if (result.loadedCharacterCount <= 0) failures.push('no character loaded')
if (!result.demoHidden) failures.push('initial character never became visible')
if (!result.hasOfficialToonControls) failures.push('official toon controls missing')
if (!result.hasAngelRingControls) failures.push('AngelRing controls missing')
if (!result.hasStageControls) failures.push('3D stage controls missing')
if (!result.activeStagePresent) failures.push('active 3D stage root missing')
if (result.stageNames.length < 4) failures.push('stage catalog infrastructure incomplete')
if (result.hairMeshCount <= 0) failures.push('Ashley has no detected hair mesh')
if (result.angelRingShaderCount <= 0) failures.push('AngelRing shader not attached to Ashley hair')
if (!result.angelRingPlaneUniforms.every(item => item.enabled >= 0.5)) failures.push('AngelRing uniform is disabled')
if (!result.angelRingPlaneUniforms.every(item => item.useHeadPlane >= 0.5)) failures.push('AngelRing is not using the animated Head plane')
if (!result.angelRingPlaneUniforms.every(item => item.bandHalfWidth > 0 && item.projectionRadius > 0)) failures.push('AngelRing Head-plane dimensions are invalid')
if (!result.angelRingPixelDelta || result.angelRingPixelDelta.changedChannels < 20 || result.angelRingPixelDelta.maxDelta < 2) {
  failures.push(`AngelRing produced no measurable visual change: ${JSON.stringify(result.angelRingPixelDelta)}`)
}
if (result.waitFamilySourceClips.length < 2) failures.push('Ashley Wait_L family does not expose companion clips')
if (result.waitFamilyPreparedClips.length <= 0) failures.push('Ashley Wait_L prepared family is empty')
if (result.waitFamilyPreparedClips.length > 0 && result.waitFamilySourceClips.length > 0) {
  const sourceTrackTotal = result.waitFamilySourceClips.reduce((sum, clip) => sum + clip.tracks, 0)
  const preparedTrackTotal = result.waitFamilyPreparedClips.reduce((sum, clip) => sum + clip.tracks, 0)
  if (preparedTrackTotal >= sourceTrackTotal) failures.push('Ashley companion channels were not deduplicated')
}
if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(' | ')}`)
if (fatalConsoleErrors.length > 0) failures.push(`shader errors: ${fatalConsoleErrors.join(' | ')}`)

const report = {
  loadedUrl,
  result,
  consoleErrors,
  pageErrors,
  failures,
}
fs.writeFileSync('/tmp/magius-smoke.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

await browser.close()
if (failures.length > 0) process.exit(1)
