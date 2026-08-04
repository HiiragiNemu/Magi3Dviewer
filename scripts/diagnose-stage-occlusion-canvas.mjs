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

async function waitFrames(count = 3) {
  await page.evaluate(async n => {
    const next = () => new Promise(resolve => requestAnimationFrame(resolve))
    for (let i = 0; i < n; i++) await next()
  }, count)
}

const captureFunctions = `
  function magiusCanvasPixels() {
    const source = window.scene.renderer.domElement
    let copy = window.__magiusCanvasCopy
    if (!copy) {
      copy = document.createElement('canvas')
      window.__magiusCanvasCopy = copy
    }
    copy.width = source.width
    copy.height = source.height
    const context = copy.getContext('2d', { willReadFrequently: true })
    context.clearRect(0, 0, copy.width, copy.height)
    context.drawImage(source, 0, 0)
    return context.getImageData(0, 0, copy.width, copy.height).data
  }
  function magiusPixelStats(pixels) {
    let sampled = 0
    let transparent = 0
    let opaque = 0
    let neutralDark = 0
    let colorful = 0
    let nonBlack = 0
    const histogram = new Map()
    for (let i = 0; i < pixels.length; i += 64) {
      sampled++
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      const a = pixels[i + 3]
      if (a < 8) transparent++
      if (a > 247) opaque++
      if (r + g + b > 12) nonBlack++
      const spread = Math.max(r, g, b) - Math.min(r, g, b)
      if (spread <= 6 && r >= 20 && r <= 120 && a > 8) neutralDark++
      if (spread >= 18 && a > 8) colorful++
      const key = \`${'${'}r >> 4},${'${'}g >> 4},${'${'}b >> 4},${'${'}a >> 4}\`
      histogram.set(key, (histogram.get(key) ?? 0) + 1)
    }
    return {
      sampled,
      transparent,
      transparentRatio: transparent / Math.max(sampled, 1),
      opaque,
      opaqueRatio: opaque / Math.max(sampled, 1),
      neutralDark,
      neutralDarkRatio: neutralDark / Math.max(sampled, 1),
      colorful,
      colorfulRatio: colorful / Math.max(sampled, 1),
      nonBlack,
      nonBlackRatio: nonBlack / Math.max(sampled, 1),
      topColors: [...histogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    }
  }
  function magiusComparePixels(baseline, current) {
    let sampled = 0
    let changed = 0
    let alphaChanged = 0
    let neutralRevealed = 0
    let colorRevealed = 0
    for (let i = 0; i < current.length; i += 64) {
      sampled++
      const deltaRgb = Math.abs(current[i] - baseline[i])
        + Math.abs(current[i + 1] - baseline[i + 1])
        + Math.abs(current[i + 2] - baseline[i + 2])
      const deltaAlpha = Math.abs(current[i + 3] - baseline[i + 3])
      if (deltaRgb + deltaAlpha > 24) changed++
      if (deltaAlpha > 16) alphaChanged++
      const br = baseline[i]
      const bg = baseline[i + 1]
      const bb = baseline[i + 2]
      const ba = baseline[i + 3]
      const baselineNeutral = ba > 8
        && Math.max(br, bg, bb) - Math.min(br, bg, bb) <= 6
        && br >= 20 && br <= 120
      if (baselineNeutral && deltaRgb > 24) {
        neutralRevealed++
        const spread = Math.max(current[i], current[i + 1], current[i + 2])
          - Math.min(current[i], current[i + 1], current[i + 2])
        if (spread > 12) colorRevealed++
      }
    }
    return {
      sampled,
      changedRatio: changed / Math.max(sampled, 1),
      alphaChangedRatio: alphaChanged / Math.max(sampled, 1),
      neutralRevealedRatio: neutralRevealed / Math.max(sampled, 1),
      colorRevealedRatio: colorRevealed / Math.max(sampled, 1),
    }
  }
`
await page.evaluate(source => { window.eval(source) }, captureFunctions)

async function loadStage(stageId) {
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
  await waitFrames(5)
}

async function captureBaseline() {
  return page.evaluate(() => {
    const pixels = window.magiusCanvasPixels()
    window.__magiusStageBaseline = new Uint8ClampedArray(pixels)
    return window.magiusPixelStats(pixels)
  })
}

async function captureComparison() {
  return page.evaluate(() => {
    const pixels = window.magiusCanvasPixels()
    return {
      stats: window.magiusPixelStats(pixels),
      difference: window.magiusComparePixels(window.__magiusStageBaseline, pixels),
    }
  })
}

async function withMutation(label, mutate, restore) {
  await page.evaluate(mutate)
  await waitFrames(4)
  const result = await captureComparison()
  await page.evaluate(restore)
  await waitFrames(4)
  return { label, ...result }
}

const output = {
  generatedAt: new Date().toISOString(),
  viewport: { width: 349, height: 768 },
  pageErrors,
  consoleErrors,
  reports: [],
}

for (const stageId of ['battle-600-00-01-001', 'battle-600-00-01-002']) {
  await loadStage(stageId)
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
        depthTest: material.depthTest,
        side: material.side,
        blending: material.blending,
      }))
      meshes.push({
        uuid: mesh.uuid,
        name: mesh.name,
        containsCamera: box.containsPoint(viewer.camera.position),
        visible: mesh.visible,
        renderOrder: mesh.renderOrder,
        box: {
          min: box.min.toArray(),
          max: box.max.toArray(),
          size: box.getSize(box.min.clone()).toArray(),
        },
        materials,
        allMaterialsMatched: materials.every(material => material.matched),
        anyMapMissing: materials.some(material => !material.hasMap),
      })
    })
    return {
      stageId: id,
      materialBindingDebug: object.userData.stageMaterialBindings ?? null,
      lightmapDebug: object.userData.stageLightmaps ?? null,
      composer: {
        shouldUseComposer: viewer.shouldUseComposer,
        composerEnabled: viewer.composerEnabled,
        bloom: viewer.effects.bloomPass.enabled,
        paraffin: viewer.effects.paraffinPass.enabled,
        backgroundPass: viewer.effects.backgroundRenderPass.enabled,
        characterPass: viewer.effects.renderPass.enabled,
        characterPassClear: viewer.effects.renderPass.clear,
        characterPassClearDepth: viewer.effects.renderPass.clearDepth,
        outputPass: viewer.effects.outputPass.enabled,
        fxaa: viewer.effects.fxaaPass.enabled,
        smaa: viewer.effects.smaaPass.enabled,
      },
      renderer: {
        clearAlpha: viewer.renderer.getClearAlpha(),
        autoClear: viewer.renderer.autoClear,
        canvasWidth: viewer.renderer.domElement.width,
        canvasHeight: viewer.renderer.domElement.height,
      },
      meshes,
    }
  }, stageId)

  const baseline = await captureBaseline()
  const globalTests = []
  globalTests.push(await withMutation(
    'hide-stage-object',
    () => {
      const root = window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
      const id = root.userData.stageDefinition.id
      const object = root.getObjectByName(`Stage:${id}`)
      object.userData.__diagnosticVisible = object.visible
      object.visible = false
    },
    () => {
      const root = window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
      const id = root.userData.stageDefinition.id
      const object = root.getObjectByName(`Stage:${id}`)
      object.visible = object.userData.__diagnosticVisible
    },
  ))
  globalTests.push(await withMutation(
    'disable-background-scene',
    () => {
      window.scene.__diagnosticBackgroundEnabled = window.scene.backgroundSceneEnabled
      window.scene.backgroundSceneEnabled = false
    },
    () => {
      window.scene.backgroundSceneEnabled = window.scene.__diagnosticBackgroundEnabled
    },
  ))
  globalTests.push(await withMutation(
    'force-non-composer-render',
    () => {
      window.scene.__diagnosticComposerEnabled = window.scene.composerEnabled
      window.scene.composerEnabled = 'Never'
    },
    () => {
      window.scene.composerEnabled = window.scene.__diagnosticComposerEnabled
    },
  ))
  globalTests.push(await withMutation(
    'disable-bloom',
    () => {
      window.scene.effects.bloomPass.userData.__diagnosticEnabled = window.scene.effects.bloomPass.enabled
      window.scene.effects.bloomPass.enabled = false
    },
    () => {
      const pass = window.scene.effects.bloomPass
      pass.enabled = pass.userData.__diagnosticEnabled
    },
  ))
  globalTests.push(await withMutation(
    'disable-paraffin',
    () => {
      window.scene.effects.paraffinPass.userData.__diagnosticEnabled = window.scene.effects.paraffinPass.enabled
      window.scene.effects.paraffinPass.enabled = false
    },
    () => {
      const pass = window.scene.effects.paraffinPass
      pass.enabled = pass.userData.__diagnosticEnabled
    },
  ))

  const candidates = metadata.meshes
    .filter(mesh => mesh.visible)
    .sort((a, b) => {
      const score = mesh => (mesh.containsCamera ? 100 : 0)
        + (!mesh.allMaterialsMatched ? 20 : 0)
        + (mesh.anyMapMissing ? 10 : 0)
        + Math.max(...mesh.box.size) / 100
      return score(b) - score(a)
    })
    .slice(0, 24)

  const meshTests = []
  for (const candidate of candidates) {
    await page.evaluate(uuid => {
      const mesh = window.scene.backgroundScene.getObjectByProperty('uuid', uuid)
      if (!mesh) return
      mesh.userData.__diagnosticVisible = mesh.visible
      mesh.visible = false
    }, candidate.uuid)
    await waitFrames(3)
    const result = await captureComparison()
    await page.evaluate(uuid => {
      const mesh = window.scene.backgroundScene.getObjectByProperty('uuid', uuid)
      if (!mesh) return
      mesh.visible = mesh.userData.__diagnosticVisible
    }, candidate.uuid)
    await waitFrames(3)
    meshTests.push({ ...candidate, ...result })
  }
  meshTests.sort((a, b) =>
    b.difference.colorRevealedRatio - a.difference.colorRevealedRatio
    || b.difference.neutralRevealedRatio - a.difference.neutralRevealedRatio
    || b.difference.alphaChangedRatio - a.difference.alphaChangedRatio
    || b.difference.changedRatio - a.difference.changedRatio
  )

  await page.screenshot({
    path: `/tmp/magius-stage-occlusion-${stageId}.png`,
    fullPage: true,
  })
  output.reports.push({
    ...metadata,
    baseline,
    globalTests,
    topOccluderCandidates: meshTests,
  })
  fs.writeFileSync('/tmp/magius-stage-occlusion.json', `${JSON.stringify(output, null, 2)}\n`)
}

output.pageErrors = pageErrors
output.consoleErrors = consoleErrors
fs.writeFileSync('/tmp/magius-stage-occlusion.json', `${JSON.stringify(output, null, 2)}\n`)
console.log(JSON.stringify({
  reports: output.reports.map(report => ({
    stageId: report.stageId,
    baseline: report.baseline,
    composer: report.composer,
    globalTests: report.globalTests,
    topOccluders: report.topOccluderCandidates.slice(0, 10).map(item => ({
      name: item.name,
      containsCamera: item.containsCamera,
      materials: item.materials,
      difference: item.difference,
      stats: item.stats,
    })),
  })),
}, null, 2))
await browser.close()
process.exitCode = 1
