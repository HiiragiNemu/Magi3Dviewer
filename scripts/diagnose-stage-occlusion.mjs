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

const stageIds = [
  'battle-600-00-01-001',
  'battle-600-00-01-002',
]
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
await page.setViewport({ width: 698, height: 1536, deviceScaleFactor: 1 })
const consoleErrors = []
const pageErrors = []
page.on('console', message => {
  const text = message.text()
  if (message.type() === 'error') consoleErrors.push(text)
})
page.on('pageerror', error => pageErrors.push(String(error)))
page.on('requestfailed', request => {
  console.error(`[browser:requestfailed] ${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`)
})

await page.goto('https://127.0.0.1:4173/', {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
})
await page.waitForFunction(
  () => window.scene
    && window.loadStageById
    && document.querySelector('#character-selector option[value="100107"]')
    && document.querySelector('#stage-selector option[value="battle-600-00-01-002"]'),
  { timeout: 180_000 },
)
await page.waitForFunction(
  () => window.scene?.characterSelected?.character?.userData?.characterId === 100107,
  { timeout: 180_000 },
)

const reports = []
for (const stageId of stageIds) {
  await page.evaluate(async id => {
    await window.loadStageById(id)
    const viewer = window.scene
    viewer.characterSelected.character.animation.paused = true
    viewer.camera.position.set(0, 1.5, 7.5)
    viewer.controls.target.set(0, 0.9, 0)
    viewer.controls.update()
  }, stageId)
  await page.waitForFunction(
    expected => {
      const root = window.scene?.backgroundScene?.getObjectByName('Magius3DviewerStageRoot')
      return root?.userData?.stageDefinition?.id === expected
        && root.getObjectByName(`Stage:${expected}`)
    },
    { timeout: 180_000 },
    stageId,
  )
  await new Promise(resolve => setTimeout(resolve, 3_000))

  const metadata = await page.evaluate(id => {
    const viewer = window.scene
    const stageRoot = viewer.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
    const stageObject = stageRoot.getObjectByName(`Stage:${id}`)
    const camera = viewer.camera
    stageObject.updateWorldMatrix(true, true)
    camera.updateMatrixWorld(true)

    const matchedNames = new Set(
      stageObject.userData.stageMaterialBindings?.matchedMaterials ?? [],
    )
    const meshes = []
    stageObject.traverse(object => {
      if (!object.isMesh) return
      const geometry = object.geometry
      geometry.computeBoundingBox()
      const box = geometry.boundingBox.clone().applyMatrix4(object.matrixWorld)
      const min = box.min
      const max = box.max
      const corners = [
        [min.x, min.y, min.z], [min.x, min.y, max.z],
        [min.x, max.y, min.z], [min.x, max.y, max.z],
        [max.x, min.y, min.z], [max.x, min.y, max.z],
        [max.x, max.y, min.z], [max.x, max.y, max.z],
      ].map(([x, y, z]) => min.clone().set(x, y, z).project(camera))
      const minX = Math.max(-1, Math.min(...corners.map(point => point.x)))
      const maxX = Math.min(1, Math.max(...corners.map(point => point.x)))
      const minY = Math.max(-1, Math.min(...corners.map(point => point.y)))
      const maxY = Math.min(1, Math.max(...corners.map(point => point.y)))
      const projectedArea = Math.max(0, maxX - minX) * Math.max(0, maxY - minY) / 4
      const materials = (Array.isArray(object.material)
        ? object.material
        : [object.material]
      ).map(material => ({
        name: material.name,
        type: material.type,
        color: material.color?.getHexString?.() ?? null,
        hasMap: Boolean(material.map),
        mapName: material.map?.name ?? null,
        transparent: material.transparent,
        opacity: material.opacity,
        alphaTest: material.alphaTest,
        depthWrite: material.depthWrite,
        side: material.side,
        matched: matchedNames.has(material.name),
      }))
      meshes.push({
        uuid: object.uuid,
        name: object.name,
        visible: object.visible,
        renderOrder: object.renderOrder,
        projectedArea,
        containsCamera: box.containsPoint(camera.position),
        box: {
          min: min.toArray(),
          max: max.toArray(),
          size: box.getSize(min.clone()).toArray(),
        },
        materials,
        allMaterialsMatched: materials.every(material => material.matched),
        anyTextureMissing: materials.some(material => !material.hasMap),
      })
    })

    return {
      stageId: id,
      definition: stageRoot.userData.stageDefinition,
      materialBindingDebug: stageObject.userData.stageMaterialBindings ?? null,
      lightmapDebug: stageObject.userData.stageLightmaps ?? null,
      camera: {
        position: camera.position.toArray(),
        target: viewer.controls.target.toArray(),
        fov: camera.fov,
        aspect: camera.aspect,
      },
      meshes,
    }
  }, stageId)

  const baseline = await page.evaluate(async () => {
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
    await nextFrame(); await nextFrame()
    const gl = window.scene.renderer.getContext()
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    window.__magiusStageOcclusionBaseline = pixels
    const histogram = new Map()
    let neutralDark = 0
    let opaque = 0
    for (let i = 0; i < pixels.length; i += 16) {
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      const a = pixels[i + 3]
      if (a > 0) opaque++
      if (Math.max(r, g, b) - Math.min(r, g, b) <= 5 && r >= 20 && r <= 110) {
        neutralDark++
      }
      const key = `${r >> 4},${g >> 4},${b >> 4},${a >> 4}`
      histogram.set(key, (histogram.get(key) ?? 0) + 1)
    }
    return {
      width,
      height,
      sampledPixels: pixels.length / 16,
      opaque,
      neutralDark,
      neutralDarkRatio: neutralDark / Math.max(opaque, 1),
      topColors: [...histogram.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    }
  })

  const candidates = metadata.meshes
    .filter(mesh => mesh.visible)
    .sort((a, b) => {
      const score = mesh =>
        (mesh.containsCamera ? 100 : 0)
        + (!mesh.allMaterialsMatched ? 20 : 0)
        + (mesh.anyTextureMissing ? 10 : 0)
        + mesh.projectedArea
      return score(b) - score(a)
    })
    .slice(0, 48)

  const toggles = []
  for (const candidate of candidates) {
    const result = await page.evaluate(async uuid => {
      const viewer = window.scene
      const object = viewer.backgroundScene.getObjectByProperty('uuid', uuid)
      if (!object || !window.__magiusStageOcclusionBaseline) return null
      const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
      const wasVisible = object.visible
      object.visible = false
      await nextFrame(); await nextFrame()
      const gl = viewer.renderer.getContext()
      const current = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, current)
      const baselinePixels = window.__magiusStageOcclusionBaseline
      let changed = 0
      let neutralChanged = 0
      let revealedColor = 0
      let sampled = 0
      for (let i = 0; i < current.length; i += 16) {
        sampled++
        const dr = Math.abs(current[i] - baselinePixels[i])
        const dg = Math.abs(current[i + 1] - baselinePixels[i + 1])
        const db = Math.abs(current[i + 2] - baselinePixels[i + 2])
        if (dr + dg + db <= 24) continue
        changed++
        const br = baselinePixels[i]
        const bg = baselinePixels[i + 1]
        const bb = baselinePixels[i + 2]
        if (Math.max(br, bg, bb) - Math.min(br, bg, bb) <= 5 && br >= 20 && br <= 110) {
          neutralChanged++
          if (Math.max(current[i], current[i + 1], current[i + 2])
              - Math.min(current[i], current[i + 1], current[i + 2]) > 12) {
            revealedColor++
          }
        }
      }
      object.visible = wasVisible
      await nextFrame(); await nextFrame()
      return {
        sampled,
        changed,
        changedRatio: changed / Math.max(sampled, 1),
        neutralChanged,
        neutralChangedRatio: neutralChanged / Math.max(sampled, 1),
        revealedColor,
        revealedColorRatio: revealedColor / Math.max(sampled, 1),
      }
    }, candidate.uuid)
    if (result) toggles.push({
      uuid: candidate.uuid,
      name: candidate.name,
      projectedArea: candidate.projectedArea,
      containsCamera: candidate.containsCamera,
      allMaterialsMatched: candidate.allMaterialsMatched,
      anyTextureMissing: candidate.anyTextureMissing,
      materials: candidate.materials,
      ...result,
    })
  }

  toggles.sort((a, b) =>
    b.revealedColorRatio - a.revealedColorRatio
    || b.neutralChangedRatio - a.neutralChangedRatio
    || b.changedRatio - a.changedRatio
  )

  const screenshotPath = `/tmp/magius-stage-occlusion-${stageId}.png`
  await page.screenshot({ path: screenshotPath, fullPage: true })
  reports.push({
    ...metadata,
    baseline,
    topOccluderCandidates: toggles.slice(0, 24),
    screenshotPath,
  })
}

const output = {
  generatedAt: new Date().toISOString(),
  viewport: { width: 698, height: 1536 },
  consoleErrors,
  pageErrors,
  reports,
}
fs.writeFileSync(
  '/tmp/magius-stage-occlusion.json',
  `${JSON.stringify(output, null, 2)}\n`,
)
console.log(JSON.stringify({
  report: '/tmp/magius-stage-occlusion.json',
  stages: reports.map(report => ({
    id: report.stageId,
    meshCount: report.meshes.length,
    materialBindingDebug: report.materialBindingDebug,
    neutralDarkRatio: report.baseline.neutralDarkRatio,
    topCandidates: report.topOccluderCandidates.slice(0, 6),
  })),
}, null, 2))
await browser.close()

// This is a diagnostic-only gate. Do not publish the current scene build until
// the reported occluding geometry/materials have been reviewed and fixed.
process.exitCode = 1
