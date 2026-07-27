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

  await page.evaluate(() => {
    const viewer = window.scene
    const character = viewer.characterSelected.character
    character.animation.paused = true
    viewer.camera.position.set(0, 1.57, 3.05)
    viewer.controls.target.set(0, 1.48, 0)
    viewer.controls.update()
  })
  await new Promise(resolve => setTimeout(resolve, 2_000))

  const result = await page.evaluate(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
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
      return pixels
    }

    const original = shaders.map(shader => Number(shader.uniforms.uAngelRingEnabled.value))
    shaders.forEach(shader => { shader.uniforms.uAngelRingEnabled.value = 0 })
    await frame()
    const off = sample()
    shaders.forEach((shader, index) => { shader.uniforms.uAngelRingEnabled.value = original[index] })
    await frame()
    const on = sample()

    let absolute = 0
    let changedChannels = 0
    let maxDelta = 0
    let brightenedChannels = 0
    for (let index = 0; index < off.length; index += 1) {
      if (index % 4 === 3) continue
      const signed = on[index] - off[index]
      const delta = Math.abs(signed)
      absolute += delta
      if (delta >= 2) changedChannels += 1
      if (signed >= 4) brightenedChannels += 1
      maxDelta = Math.max(maxDelta, delta)
    }

    return {
      resourceId: character.userData.characterId,
      shaderCount: shaders.length,
      uniforms: shaders.map(shader => ({
        useHeadPlane: Number(shader.uniforms.uAngelRingUseHeadPlane?.value ?? 0),
        position: shader.uniforms.uAngelRingPlanePosition?.value?.toArray?.() ?? null,
        forward: shader.uniforms.uAngelRingPlaneForward?.value?.toArray?.() ?? null,
        up: shader.uniforms.uAngelRingPlaneUp?.value?.toArray?.() ?? null,
        right: shader.uniforms.uAngelRingPlaneRight?.value?.toArray?.() ?? null,
        bandHalfWidth: Number(shader.uniforms.uAngelRingBandHalfWidth?.value ?? 0),
      })),
      sampledColorChannels: off.length / 4 * 3,
      changedChannels,
      brightenedChannels,
      meanAbsoluteDelta: absolute / Math.max(off.length / 4 * 3, 1),
      maxDelta,
    }
  })

  await page.screenshot({
    path: `/tmp/magius-angelring-${label}.png`,
    fullPage: true,
  })
  return result
}

const madoka = await testCharacter('100107', 100107, 'madoka')
const ashley = await testCharacter('110701', 110701, 'ashley')
const failures = []
for (const [name, result] of Object.entries({ madoka, ashley })) {
  if (result.shaderCount <= 0) failures.push(`${name}: no AngelRing shader`)
  if (!result.uniforms.every(item => item.useHeadPlane >= 0.5)) failures.push(`${name}: not using Head plane`)
  if (result.changedChannels < 150) failures.push(`${name}: only ${result.changedChannels} changed channels`)
  if (result.brightenedChannels < 80) failures.push(`${name}: only ${result.brightenedChannels} brightened channels`)
  if (result.maxDelta < 8) failures.push(`${name}: maximum pixel delta ${result.maxDelta}`)
}
if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(' | ')}`)
if (shaderErrors.length) failures.push(`shader errors: ${shaderErrors.join(' | ')}`)

const report = { madoka, ashley, pageErrors, shaderErrors, failures }
fs.writeFileSync('/tmp/magius-angelring-two-character.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
if (failures.length) process.exit(1)
