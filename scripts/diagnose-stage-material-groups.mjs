import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'
import { PNG } from 'pngjs'

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

async function waitFrames(count = 4) {
  await page.evaluate(async n => {
    const next = () => new Promise(resolve => requestAnimationFrame(resolve))
    for (let index = 0; index < n; index++) await next()
  }, count)
}

function analyzePng(buffer, baseline) {
  const png = PNG.sync.read(buffer)
  const startY = Math.min(110, png.height - 1)
  const endY = Math.max(startY + 1, png.height - 55)
  let sampled = 0
  let gray = 0
  let colorful = 0
  let changed = 0
  let grayRevealed = 0
  let colorRevealed = 0
  for (let y = startY; y < endY; y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      const offset = (y * png.width + x) * 4
      const r = png.data[offset]
      const g = png.data[offset + 1]
      const b = png.data[offset + 2]
      const spread = Math.max(r, g, b) - Math.min(r, g, b)
      const isPageGray = spread <= 3 && r >= 62 && r <= 74
      sampled++
      if (isPageGray) gray++
      if (spread >= 18) colorful++
      if (!baseline) continue
      const br = baseline.data[offset]
      const bg = baseline.data[offset + 1]
      const bb = baseline.data[offset + 2]
      const baseSpread = Math.max(br, bg, bb) - Math.min(br, bg, bb)
      const baselineGray = baseSpread <= 3 && br >= 62 && br <= 74
      const delta = Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb)
      if (delta > 24) changed++
      if (baselineGray && !isPageGray && delta > 24) {
        grayRevealed++
        if (spread >= 12) colorRevealed++
      }
    }
  }
  return {
    png,
    stats: {
      sampled,
      grayRatio: gray / Math.max(sampled, 1),
      colorfulRatio: colorful / Math.max(sampled, 1),
      changedRatio: changed / Math.max(sampled, 1),
      grayRevealedRatio: grayRevealed / Math.max(sampled, 1),
      colorRevealedRatio: colorRevealed / Math.max(sampled, 1),
    },
  }
}

async function capture() {
  const buffer = await page.screenshot({ type: 'png', fullPage: true })
  return Buffer.from(buffer)
}

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
        && !document.querySelector('#stage-selector')?.disabled
    },
    { timeout: 180_000 },
    stageId,
  )
  await waitFrames(8)
}

const report = {
  generatedAt: new Date().toISOString(),
  viewport: { width: 349, height: 768 },
  pageErrors,
  consoleErrors,
  stages: [],
}

for (const stageId of ['battle-600-00-01-001', 'battle-600-00-01-002']) {
  await loadStage(stageId)
  const groups = await page.evaluate(id => {
    const root = window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
    const stage = root.getObjectByName(`Stage:${id}`)
    const map = new Map()
    stage.traverse(mesh => {
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        let entry = map.get(material.name)
        if (!entry) {
          entry = {
            name: material.name,
            materialUuids: [],
            meshUuids: [],
            meshNames: [],
            materialStates: [],
          }
          map.set(material.name, entry)
        }
        if (!entry.materialUuids.includes(material.uuid)) {
          entry.materialUuids.push(material.uuid)
          entry.materialStates.push({
            uuid: material.uuid,
            name: material.name,
            type: material.type,
            mapName: material.map?.name ?? null,
            hasMap: Boolean(material.map),
            alphaTest: material.alphaTest,
            alphaToCoverage: material.alphaToCoverage,
            transparent: material.transparent,
            opacity: material.opacity,
            depthWrite: material.depthWrite,
            depthTest: material.depthTest,
            side: material.side,
            blending: material.blending,
          })
        }
        if (!entry.meshUuids.includes(mesh.uuid)) {
          entry.meshUuids.push(mesh.uuid)
          entry.meshNames.push(mesh.name)
        }
      }
    })
    return [...map.values()]
  }, stageId)

  const baselineBuffer = await capture()
  fs.writeFileSync(`/tmp/stage-material-${stageId}-baseline.png`, baselineBuffer)
  const baseline = analyzePng(baselineBuffer).png
  const baselineStats = analyzePng(baselineBuffer).stats
  const tests = []

  for (const group of groups) {
    for (const mode of ['cutout', 'no-depth', 'hide']) {
      await page.evaluate(({ name, mode }) => {
        const root = window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
        const id = root.userData.stageDefinition.id
        const stage = root.getObjectByName(`Stage:${id}`)
        const touchedMaterials = new Set()
        stage.traverse(mesh => {
          if (!mesh.isMesh) return
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          const matches = materials.filter(material => material.name === name)
          if (matches.length === 0) return
          if (mode === 'hide') {
            mesh.userData.__stageMaterialDiagnosticVisible = mesh.visible
            mesh.visible = false
            return
          }
          for (const material of matches) {
            if (touchedMaterials.has(material.uuid)) continue
            touchedMaterials.add(material.uuid)
            material.userData.__stageMaterialDiagnostic = {
              alphaTest: material.alphaTest,
              alphaToCoverage: material.alphaToCoverage,
              transparent: material.transparent,
              depthWrite: material.depthWrite,
              needsUpdate: material.needsUpdate,
            }
            if (mode === 'cutout') {
              material.alphaTest = Math.max(material.alphaTest, 0.5)
              material.alphaToCoverage = true
              material.transparent = false
              material.depthWrite = true
            } else if (mode === 'no-depth') {
              material.depthWrite = false
            }
            material.needsUpdate = true
          }
        })
      }, { name: group.name, mode })
      await waitFrames(5)
      const currentBuffer = await capture()
      const analyzed = analyzePng(currentBuffer, baseline)
      tests.push({
        materialName: group.name,
        mode,
        stats: analyzed.stats,
      })
      await page.evaluate(({ name, mode }) => {
        const root = window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
        const id = root.userData.stageDefinition.id
        const stage = root.getObjectByName(`Stage:${id}`)
        const restoredMaterials = new Set()
        stage.traverse(mesh => {
          if (!mesh.isMesh) return
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          const matches = materials.filter(material => material.name === name)
          if (matches.length === 0) return
          if (mode === 'hide') {
            mesh.visible = mesh.userData.__stageMaterialDiagnosticVisible
            delete mesh.userData.__stageMaterialDiagnosticVisible
            return
          }
          for (const material of matches) {
            if (restoredMaterials.has(material.uuid)) continue
            restoredMaterials.add(material.uuid)
            const state = material.userData.__stageMaterialDiagnostic
            if (!state) continue
            material.alphaTest = state.alphaTest
            material.alphaToCoverage = state.alphaToCoverage
            material.transparent = state.transparent
            material.depthWrite = state.depthWrite
            material.needsUpdate = true
            delete material.userData.__stageMaterialDiagnostic
          }
        })
      }, { name: group.name, mode })
      await waitFrames(5)
    }
  }

  tests.sort((left, right) =>
    right.stats.colorRevealedRatio - left.stats.colorRevealedRatio
      || right.stats.grayRevealedRatio - left.stats.grayRevealedRatio
      || right.stats.changedRatio - left.stats.changedRatio,
  )
  report.stages.push({
    stageId,
    baselineStats,
    materialGroups: groups,
    tests,
  })
  fs.writeFileSync(
    '/tmp/magius-stage-material-groups.json',
    `${JSON.stringify(report, null, 2)}\n`,
  )
}

report.pageErrors = pageErrors
report.consoleErrors = consoleErrors
fs.writeFileSync(
  '/tmp/magius-stage-material-groups.json',
  `${JSON.stringify(report, null, 2)}\n`,
)
console.log(JSON.stringify({
  stages: report.stages.map(stage => ({
    stageId: stage.stageId,
    baselineStats: stage.baselineStats,
    topTests: stage.tests.slice(0, 12),
  })),
  pageErrors,
  consoleErrors,
}, null, 2))
await browser.close()
process.exitCode = 1
