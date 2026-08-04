import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

function chromePath() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN
  return execFileSync(
    'bash',
    ['-lc', 'command -v google-chrome-stable || command -v google-chrome || command -v chromium || command -v chromium-browser'],
    { encoding: 'utf8' },
  ).trim()
}

const browser = await puppeteer.launch({
  executablePath: chromePath(),
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
await page.setViewport({ width: 349, height: 768, deviceScaleFactor: 1 })
const pageErrors = []
const consoleErrors = []
page.on('pageerror', error => pageErrors.push(String(error)))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('requestfailed', request => {
  console.error(`[requestfailed] ${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`)
})

await page.goto('https://127.0.0.1:4173/', {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
})
await page.waitForFunction(
  () => window.scene
    && window.loadStageById
    && document.querySelector('#stage-selector option[value="battle-600-00-01-002"]'),
  { timeout: 180_000 },
)
await page.waitForFunction(
  () => window.scene?.characterSelected?.character?.userData?.characterId === 100107,
  { timeout: 180_000 },
)

const outputPath = '/tmp/magius-stage-occlusion.json'
const output = {
  generatedAt: new Date().toISOString(),
  viewport: { width: 349, height: 768 },
  pageErrors,
  consoleErrors,
  reports: [],
}
const persist = () => fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)

async function waitFrames(count = 2) {
  await page.evaluate(async frameCount => {
    const next = () => new Promise(resolve => requestAnimationFrame(resolve))
    for (let i = 0; i < frameCount; i++) await next()
  }, count)
}

async function captureBaseline() {
  return page.evaluate(() => {
    const gl = window.scene.renderer.getContext()
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    window.__stageOcclusionBaseline = pixels
    let sampled = 0
    let neutralDark = 0
    const histogram = new Map()
    for (let i = 0; i < pixels.length; i += 64) {
      sampled++
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      if (Math.max(r, g, b) - Math.min(r, g, b) <= 6 && r >= 20 && r <= 120) {
        neutralDark++
      }
      const key = `${r >> 4},${g >> 4},${b >> 4}`
      histogram.set(key, (histogram.get(key) ?? 0) + 1)
    }
    return {
      width,
      height,
      sampled,
      neutralDark,
      neutralDarkRatio: neutralDark / Math.max(sampled, 1),
      topColors: [...histogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    }
  })
}

for (const stageId of ['battle-600-00-01-001', 'battle-600-00-01-002']) {
  await page.evaluate(async id => {
    await window.loadStageById(id)
    const viewer = window.scene
    viewer.characterSelected.character.animation.paused = true
    viewer.camera.position.set(0, 1.5, 7.5)
    viewer.controls.target.set(0, 0.9, 0)
    viewer.controls.update()
  }, stageId)
  await page.waitForFunction(
    id => {
      const root = window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
      return root?.userData?.stageDefinition?.id === id
        && root.getObjectByName(`Stage:${id}`)
    },
    { timeout: 120_000 },
    stageId,
  )
  await waitFrames(4)

  const metadata = await page.evaluate(id => {
    const viewer = window.scene
    const root = viewer.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
    const object = root.getObjectByName(`Stage:${id}`)
    object.updateWorldMatrix(true, true)
    viewer.camera.updateMatrixWorld(true)
    const matched = new Set(object.userData.stageMaterialBindings?.matchedMaterials ?? [])
    const meshes = []
    object.traverse(mesh => {
      if (!mesh.isMesh) return
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld)
      const min = box.min
      const max = box.max
      const corners = [
        [min.x, min.y, min.z], [min.x, min.y, max.z],
        [min.x, max.y, min.z], [min.x, max.y, max.z],
        [max.x, min.y, min.z], [max.x, min.y, max.z],
        [max.x, max.y, min.z], [max.x, max.y, max.z],
      ].map(([x, y, z]) => min.clone().set(x, y, z).project(viewer.camera))
      const minX = Math.max(-1, Math.min(...corners.map(point => point.x)))
      const maxX = Math.min(1, Math.max(...corners.map(point => point.x)))
      const minY = Math.max(-1, Math.min(...corners.map(point => point.y)))
      const maxY = Math.min(1, Math.max(...corners.map(point => point.y)))
      const projectedArea = Math.max(0, maxX - minX) * Math.max(0, maxY - minY) / 4
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => ({
        name: material.name,
        type: material.type,
        color: material.color?.getHexString?.() ?? null,
        hasMap: Boolean(material.map),
        mapName: material.map?.name ?? null,
        matched: matched.has(material.name),
        transparent: material.transparent,
        opacity: material.opacity,
        alphaTest: material.alphaTest,
        depthWrite: material.depthWrite,
        side: material.side,
      }))
      meshes.push({
        uuid: mesh.uuid,
        name: mesh.name,
        projectedArea,
        containsCamera: box.containsPoint(viewer.camera.position),
        visible: mesh.visible,
        box: { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(min.clone()).toArray() },
        materials,
        allMaterialsMatched: materials.every(material => material.matched),
        anyMapMissing: materials.some(material => !material.hasMap),
      })
    })
    return {
      stageId: id,
      materialBindingDebug: object.userData.stageMaterialBindings ?? null,
      lightmapDebug: object.userData.stageLightmaps ?? null,
      meshes,
    }
  }, stageId)

  const baseline = await captureBaseline()
  const candidates = metadata.meshes
    .filter(mesh => mesh.visible)
    .sort((a, b) => {
      const score = mesh => (mesh.containsCamera ? 100 : 0)
        + (!mesh.allMaterialsMatched ? 20 : 0)
        + (mesh.anyMapMissing ? 10 : 0)
        + mesh.projectedArea
      return score(b) - score(a)
    })
    .slice(0, 16)

  const toggles = []
  for (const candidate of candidates) {
    const result = await page.evaluate(async uuid => {
      const viewer = window.scene
      const mesh = viewer.backgroundScene.getObjectByProperty('uuid', uuid)
      const baselinePixels = window.__stageOcclusionBaseline
      if (!mesh || !baselinePixels) return null
      const next = () => new Promise(resolve => requestAnimationFrame(resolve))
      const original = mesh.visible
      mesh.visible = false
      await next(); await next()
      const gl = viewer.renderer.getContext()
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      let sampled = 0
      let changed = 0
      let neutralChanged = 0
      let revealedColor = 0
      for (let i = 0; i < pixels.length; i += 64) {
        sampled++
        const delta = Math.abs(pixels[i] - baselinePixels[i])
          + Math.abs(pixels[i + 1] - baselinePixels[i + 1])
          + Math.abs(pixels[i + 2] - baselinePixels[i + 2])
        if (delta <= 24) continue
        changed++
        const br = baselinePixels[i]
        const bg = baselinePixels[i + 1]
        const bb = baselinePixels[i + 2]
        const baselineNeutral = Math.max(br, bg, bb) - Math.min(br, bg, bb) <= 6
          && br >= 20 && br <= 120
        if (baselineNeutral) {
          neutralChanged++
          const currentSpread = Math.max(pixels[i], pixels[i + 1], pixels[i + 2])
            - Math.min(pixels[i], pixels[i + 1], pixels[i + 2])
          if (currentSpread > 12) revealedColor++
        }
      }
      mesh.visible = original
      await next(); await next()
      return {
        sampled,
        changedRatio: changed / Math.max(sampled, 1),
        neutralChangedRatio: neutralChanged / Math.max(sampled, 1),
        revealedColorRatio: revealedColor / Math.max(sampled, 1),
      }
    }, candidate.uuid)
    if (result) toggles.push({ ...candidate, ...result })
  }
  toggles.sort((a, b) => b.revealedColorRatio - a.revealedColorRatio
    || b.neutralChangedRatio - a.neutralChangedRatio
    || b.changedRatio - a.changedRatio)

  await page.screenshot({
    path: `/tmp/magius-stage-occlusion-${stageId}.png`,
    fullPage: true,
  })
  output.reports.push({
    ...metadata,
    baseline,
    topOccluderCandidates: toggles,
  })
  persist()
}

output.pageErrors = pageErrors
output.consoleErrors = consoleErrors
persist()
console.log(JSON.stringify({
  outputPath,
  reports: output.reports.map(report => ({
    stageId: report.stageId,
    materialBindingDebug: report.materialBindingDebug,
    neutralDarkRatio: report.baseline.neutralDarkRatio,
    topOccluders: report.topOccluderCandidates.slice(0, 8).map(mesh => ({
      name: mesh.name,
      projectedArea: mesh.projectedArea,
      containsCamera: mesh.containsCamera,
      materials: mesh.materials,
      changedRatio: mesh.changedRatio,
      neutralChangedRatio: mesh.neutralChangedRatio,
      revealedColorRatio: mesh.revealedColorRatio,
    })),
  })),
}, null, 2))
await browser.close()
process.exitCode = 1
