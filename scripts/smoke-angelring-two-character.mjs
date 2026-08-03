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
await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 })

const pageErrors = []
const shaderErrors = []
page.on('pageerror', error => pageErrors.push(String(error)))
page.on('console', message => {
  const text = message.text()
  if (/Shader Error|VALIDATE_STATUS false|shader is not compiled|Could not compile WebGL/i.test(text)) {
    shaderErrors.push(text)
  }
})

await page.goto('https://127.0.0.1:4173/', {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
})
await page.waitForFunction(
  () => document.body.classList.contains('no-demo') && window.scene,
  { timeout: 180_000 },
)
await page.evaluate(async () => {
  window.scene.composerEnabled = 'Never'
  window.scene.effects.bloomPass.enabled = false
  if (window.loadStageById) await window.loadStageById('none')
})

async function setView(back) {
  await page.evaluate(isBack => {
    const viewer = window.scene
    const character = viewer.characterSelected.character
    character.animation.paused = true
    viewer.camera.position.set(0, 1.57, isBack ? -3.05 : 3.05)
    viewer.controls.target.set(0, 1.48, 0)
    viewer.controls.update()
  }, back)
  await new Promise(resolve => setTimeout(resolve, 1_200))
}

async function selectCharacter(selectorValue, expectedResourceId) {
  await page.select('#character-selector', selectorValue)
  await page.waitForFunction(
    expected => window.scene?.characterSelected?.character?.userData?.characterId === expected,
    { timeout: 180_000 },
    expectedResourceId,
  )
  await page.waitForFunction(
    () => {
      const character = window.scene?.characterSelected?.character
      return character?.userData?.meshes
        ?.filter(mesh => mesh.name.toLowerCase().includes('hair'))
        .some(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          .some(material => Boolean(material?.userData?.shader?.uniforms?.uAngelRingEnabled)))
    },
    { timeout: 180_000 },
  )
  await new Promise(resolve => setTimeout(resolve, 2_000))
}

async function measureAngelRing() {
  return page.evaluate(async () => {
    const waitForRender = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
    const canvas = document.querySelector('#viewer canvas')
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl')
    if (!gl) throw new Error('WebGL unavailable')

    const character = window.scene.characterSelected.character
    const hairMeshes = character.userData.meshes
      .filter(mesh => mesh.name.toLowerCase().includes('hair'))
    const shaders = hairMeshes
      .flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      .map(material => material?.userData?.shader)
      .filter(shader => shader?.uniforms?.uAngelRingEnabled)
    const activeProfiles = hairMeshes
      .flatMap(mesh => mesh.userData?.officialMaterialProfiles ?? [])
      .filter(profile => profile?.angelRing?.enabled && profile?.angelRing?.map !== 'none')

    const sample = () => {
      gl.finish()
      const width = gl.drawingBufferWidth
      const height = gl.drawingBufferHeight
      const pixels = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return { width, height, pixels }
    }

    const original = shaders.map(shader => Number(shader.uniforms.uAngelRingEnabled.value))
    shaders.forEach(shader => { shader.uniforms.uAngelRingEnabled.value = 0 })
    await waitForRender(1_200)
    const off = sample()
    shaders.forEach((shader, index) => { shader.uniforms.uAngelRingEnabled.value = original[index] })
    await waitForRender(1_200)
    const on = sample()

    const x0 = Math.floor(on.width * 0.24)
    const x1 = Math.floor(on.width * 0.76)
    const y0 = Math.floor(on.height * 0.43)
    const y1 = Math.floor(on.height * 0.90)
    let changedPixels = 0
    let brightenedPixels = 0
    let absolute = 0
    let maxDelta = 0
    let minX = x1
    let maxX = x0
    let minY = y1
    let maxY = y0
    const rows = new Map()

    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = (y * on.width + x) * 4
        const dr = on.pixels[index] - off.pixels[index]
        const dg = on.pixels[index + 1] - off.pixels[index + 1]
        const db = on.pixels[index + 2] - off.pixels[index + 2]
        const signed = (dr + dg + db) / 3
        const delta = (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) / 3
        absolute += delta
        maxDelta = Math.max(maxDelta, delta)
        if (delta >= 2.5) {
          changedPixels += 1
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
          rows.set(y, (rows.get(y) ?? 0) + 1)
        }
        if (signed >= 4) brightenedPixels += 1
      }
    }

    const bboxWidth = changedPixels ? maxX - minX + 1 : 0
    const bboxHeight = changedPixels ? maxY - minY + 1 : 0
    const activeRows = [...rows.values()].filter(value => value >= 6).length
    const dominantRowWidth = rows.size ? Math.max(...rows.values()) : 0

    return {
      shaderCount: shaders.length,
      activeMaterialProfileCount: activeProfiles.length,
      activeMaterialProfiles: activeProfiles.map(profile => ({
        name: profile.name,
        map: profile.angelRing.map,
        uvMode: profile.angelRing.uvMode,
      })),
      uniforms: shaders.map(shader => ({
        globalEnabled: Number(shader.uniforms.uAngelRingEnabled?.value ?? 0),
        materialEnabled: Number(shader.uniforms.uAngelRingMaterialEnabled?.value ?? 0),
        mapKind: Number(shader.uniforms.uAngelRingMapKind?.value ?? 0),
        useHeadPlane: Number(shader.uniforms.uAngelRingUseHeadPlane?.value ?? 0),
        position: shader.uniforms.uAngelRingPlanePosition?.value?.toArray?.() ?? null,
        forward: shader.uniforms.uAngelRingFaceForward?.value?.toArray?.() ?? null,
        up: shader.uniforms.uAngelRingPlaneUp?.value?.toArray?.() ?? null,
        bandHalfWidth: Number(shader.uniforms.uAngelRingBandHalfWidth?.value ?? 0),
        offsetU: Number(shader.uniforms.uAngelRingOffsetU?.value ?? 0),
        offsetV: Number(shader.uniforms.uAngelRingOffsetV?.value ?? 0),
      })),
      sampledPixels: (x1 - x0) * (y1 - y0),
      changedPixels,
      brightenedPixels,
      meanAbsoluteDelta: absolute / Math.max((x1 - x0) * (y1 - y0), 1),
      maxDelta,
      bboxWidth,
      bboxHeight,
      bboxAspect: bboxWidth / Math.max(bboxHeight, 1),
      activeRows,
      dominantRowWidth,
    }
  })
}

async function inspectCharacter(selectorValue, resourceId, slug) {
  await selectCharacter(selectorValue, resourceId)
  await setView(false)
  const front = await measureAngelRing()
  await page.screenshot({ path: `/tmp/magius-angelring-${slug}-front.png`, fullPage: true })
  await setView(true)
  const back = await measureAngelRing()
  await page.screenshot({ path: `/tmp/magius-angelring-${slug}-back.png`, fullPage: true })
  return {
    resourceId,
    front,
    back,
    frontBackMeanRatio: front.meanAbsoluteDelta / Math.max(back.meanAbsoluteDelta, 0.0001),
  }
}

function validateCharacter(label, result, failures) {
  const { front, back, frontBackMeanRatio } = result
  if (front.shaderCount <= 0) failures.push(`${label}: no AngelRing shader`)
  if (front.activeMaterialProfileCount <= 0) failures.push(`${label}: no official AngelRing material profile`)
  if (!front.uniforms.every(item => item.useHeadPlane >= 0.5)) failures.push(`${label}: no official Head reference`)
  if (front.changedPixels < 70) failures.push(`${label}: only ${front.changedPixels} changed pixels`)
  if (front.brightenedPixels < 40) failures.push(`${label}: only ${front.brightenedPixels} brightened pixels`)
  if (front.maxDelta < 7) failures.push(`${label}: maximum delta ${front.maxDelta}`)
  if (front.bboxAspect < 1.6) failures.push(`${label}: highlight is not a horizontal strip; aspect ${front.bboxAspect.toFixed(3)}`)
  if (front.activeRows > Math.max(90, front.bboxWidth * 0.65)) failures.push(`${label}: highlight is vertically scattered across ${front.activeRows} rows`)
  if (frontBackMeanRatio < 1.8) failures.push(`${label}: rear effect too strong; front/back ratio ${frontBackMeanRatio.toFixed(3)}`)
  if (back.brightenedPixels > front.brightenedPixels * 0.38 + 20) failures.push(`${label}: rear brightening ${back.brightenedPixels} versus front ${front.brightenedPixels}`)
}

const madoka = await inspectCharacter('100107', 100107, 'madoka')
const ashley = await inspectCharacter('110701', 110701, 'ashley')

const failures = []
validateCharacter('madoka', madoka, failures)
validateCharacter('ashley', ashley, failures)
if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(' | ')}`)
if (shaderErrors.length) failures.push(`shader errors: ${shaderErrors.join(' | ')}`)

const report = {
  madoka,
  ashley,
  pageErrors,
  shaderErrors,
  failures,
}
fs.writeFileSync('/tmp/magius-angelring-two-character.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
if (failures.length) process.exit(1)
