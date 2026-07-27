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
  () => document.body.classList.contains('no-demo'),
  { timeout: 150_000 },
)

// Allow textures to finish, materials to compile and several WebGL frames to render.
await new Promise(resolve => setTimeout(resolve, 12_000))
await page.screenshot({ path: '/tmp/magius-smoke.png', fullPage: true })

const result = await page.evaluate(() => {
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
  const meshes = loadedCharacters.flatMap(character => character.userData.meshes ?? [])
  const hairMeshes = meshes.filter(mesh => mesh.name.toLowerCase().includes('hair'))
  const angelRingShaders = hairMeshes.flatMap(mesh => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    return materials
      .map(material => material?.userData?.shader)
      .filter(shader => Boolean(shader?.uniforms?.uAngelRingEnabled))
  })
  const angelRingEnabledValues = angelRingShaders.map(
    shader => Number(shader.uniforms.uAngelRingEnabled.value),
  )

  return {
    title: document.title,
    stageNames,
    characterCount: document.querySelectorAll('#character-selector option').length,
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
    angelRingEnabledValues,
    demoHidden: document.body.classList.contains('no-demo'),
  }
})

await page.evaluate(() => {
  const viewerScene = window.scene
  if (!viewerScene) return
  viewerScene.camera.position.set(0, 1.55, 3.8)
  viewerScene.controls.target.set(0, 1.42, 0)
  viewerScene.controls.update()
})
await new Promise(resolve => setTimeout(resolve, 2_000))
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
if (result.loadedCharacterCount <= 0) failures.push('no character loaded')
if (!result.demoHidden) failures.push('initial character never became visible')
if (!result.hasOfficialToonControls) failures.push('official toon controls missing')
if (!result.hasAngelRingControls) failures.push('AngelRing controls missing')
if (!result.hasStageControls) failures.push('3D stage controls missing')
if (!result.activeStagePresent) failures.push('active 3D stage root missing')
if (result.stageNames.length < 4) failures.push('built-in stage catalog incomplete')
if (result.hairMeshCount <= 0) failures.push('default character has no detected hair mesh')
if (result.angelRingShaderCount <= 0) failures.push('AngelRing shader not attached to hair')
if (!result.angelRingEnabledValues.every(value => value >= 0.5)) failures.push('AngelRing uniform is disabled')
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
