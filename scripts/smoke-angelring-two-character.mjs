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

async function measureRing() {
  return page.evaluate(async () => {
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
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl')
    if (!gl) throw new Error('WebGL unavailable')
    const character = window.scene.characterSelected.character
    const hairMeshes = character.userData.meshes.filter(mesh => mesh.name.toLowerCase().includes('hair'))
    const shaders = hairMeshes.flatMap(mesh => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      return materials.map(material => material?.userData?.shader)
        .filter(shader => shader?.uniforms?.uAngelRingEnabled)
    })

    const sample = () => {
      gl.finish()
      const width = gl.drawingBufferWidth
      const height = gl.drawingBufferHeight
      const pixels = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      // Head/hair region for the fixed close-up camera. readPixels uses a
      // bottom-left origin, hence the relatively high Y interval.
      const x0 = Math.floor(width * 0.24)
      const x1 = Math.floor(width * 0.76)
      const y0 = Math.floor(height * 0.43)
      const y1 = Math.floor(height * 0.90)
      const roi = []
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const index = (y * width + x) * 4
          roi.push(pixels[index], pixels[index + 1], pixels[index + 2])
        }
      }
      return roi
    }

    const original = shaders.map(shader => Number(shader.uniforms.uAngelRingEnabled.value))
    shaders.forEach(shader => { shader.uniforms.uAngelRingEnabled.value = 0 })
    await waitFrames(4)
    const off = sample()
    shaders.forEach((shader, index) => { shader.uniforms.uAngelRingEnabled.value = original[index] })
    await waitFrames(4)
    const on = sample()

    let absolute = 0
    let changedChannels = 0
    let maxDelta = 0
    let brightenedChannels = 0
    for (let index = 0; index < off.length; index += 1) {
      const signed = on[index] - off[index]
      const delta = Math.abs(signed)
      absolute += delta
      if (delta >= 2) changedChannels += 1
      if (signed >= 4) brightenedChannels += 1
      maxDelta = Math.max(maxDelta, delta)
    }

    return {
      shaderCount: shaders.length,
      uniforms: shaders.map(shader => ({
        useHeadPlane: Number(shader.uniforms.uAngelRingUseHeadPlane?.value ?? 0),
        hasUv1: Number(shader.uniforms.uAngelRingHasUv1?.value ?? 0),
        uv1Signed: Number(shader.uniforms.uAngelRingUv1Signed?.value ?? 0),
        uvMode: Number(shader.uniforms.uAngelRingUvMode?.value ?? 0),
        position: shader.uniforms.uAngelRingPlanePosition?.value?.toArray?.() ?? null,
        forward: shader.uniforms.uAngelRingFaceForward?.value?.toArray?.() ?? null,
        up: shader.uniforms.uAngelRingPlaneUp?.value?.toArray?.() ?? null,
        bandHalfWidth: Number(shader.uniforms.uAngelRingBandHalfWidth?.value ?? 0),
        offsetU: Number(shader.uniforms.uAngelRingOffsetU?.value ?? 0),
        offsetV: Number(shader.uniforms.uAngelRingOffsetV?.value ?? 0),
      })),
      sampledColorChannels: off.length,
      changedChannels,
      brightenedChannels,
      meanAbsoluteDelta: absolute / Math.max(off.length, 1),
      maxDelta,
    }
  })
}

async function testCharacter(selectorValue, expectedResourceId, label) {
  await page.select('#character-selector', selectorValue)
  await page.waitForFunction(
    expected => window.scene?.characterSelected?.character?.userData?.characterId === expected,
    { timeout: 180_000 },
    expectedResourceId,
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

  await setView(false)
  const front = await measureRing()
  await page.screenshot({
    path: `/tmp/magius-angelring-${label}-front.png`,
    fullPage: true,
  })

  await setView(true)
  const back = await measureRing()
  await page.screenshot({
    path: `/tmp/magius-angelring-${label}-back.png`,
    fullPage: true,
  })

  return {
    resourceId: expectedResourceId,
    front,
    back,
    frontBackMeanRatio: front.meanAbsoluteDelta / Math.max(back.meanAbsoluteDelta, 0.0001),
    frontBackBrightRatio: front.brightenedChannels / Math.max(back.brightenedChannels, 1),
  }
}

const madoka = await testCharacter('100107', 100107, 'madoka')
const ashley = await testCharacter('110701', 110701, 'ashley')
const failures = []
for (const [name, result] of Object.entries({ madoka, ashley })) {
  const { front, back } = result
  if (front.shaderCount <= 0) failures.push(`${name}: no AngelRing shader`)
  if (!front.uniforms.every(item => item.useHeadPlane >= 0.5)) failures.push(`${name}: not using Head reference`)
  if (!front.uniforms.every(item => item.hasUv1 >= 0.5)) failures.push(`${name}: FBX UV3/uv1 is not active`)
  if (front.changedChannels < 160) failures.push(`${name}: only ${front.changedChannels} frontal changed channels`)
  if (front.brightenedChannels < 90) failures.push(`${name}: only ${front.brightenedChannels} frontal brightened channels`)
  if (front.maxDelta < 8) failures.push(`${name}: frontal maximum pixel delta ${front.maxDelta}`)
  if (result.frontBackMeanRatio < 1.35) {
    failures.push(`${name}: rear band too strong; front/back mean ratio ${result.frontBackMeanRatio.toFixed(3)}`)
  }
  if (back.brightenedChannels > front.brightenedChannels * 0.65 + 40) {
    failures.push(`${name}: rear brightened channels ${back.brightenedChannels} versus front ${front.brightenedChannels}`)
  }
}
if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(' | ')}`)
if (shaderErrors.length) failures.push(`shader errors: ${shaderErrors.join(' | ')}`)

const report = { madoka, ashley, pageErrors, shaderErrors, failures }
fs.writeFileSync('/tmp/magius-angelring-two-character.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
if (failures.length) process.exit(1)
