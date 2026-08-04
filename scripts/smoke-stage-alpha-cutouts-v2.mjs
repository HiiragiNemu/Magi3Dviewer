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

const viewport = { width: 698, height: 1536, deviceScaleFactor: 1 }
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
await page.setViewport(viewport)
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

async function waitForRenderedFrames(minimumRenderCalls = 4) {
  const start = await page.evaluate(() => window.scene.renderer.info.render.frame)
  await page.waitForFunction(
    ({ startFrame, calls }) =>
      window.scene.renderer.info.render.frame >= startFrame + calls,
    { timeout: 45_000, polling: 100 },
    { startFrame: start, calls: minimumRenderCalls },
  )
  await new Promise(resolve => setTimeout(resolve, 350))
}

async function setView(position, target) {
  await page.evaluate(({ position: cameraPosition, target: cameraTarget }) => {
    const viewer = window.scene
    viewer.camera.position.set(...cameraPosition)
    viewer.controls.target.set(...cameraTarget)
    viewer.controls.update()
  }, { position, target })
  await waitForRenderedFrames(4)
}

function analyzeComposedScreenshot(buffer) {
  const png = PNG.sync.read(buffer)
  const startY = Math.min(115, png.height - 1)
  const endY = Math.max(startY + 1, png.height - 70)
  let sampled = 0
  let pageGray = 0
  let colorful = 0
  let dark = 0
  let longestGrayRun = 0
  let currentGrayRun = 0
  let sampledRows = 0

  for (let y = startY; y < endY; y += 3) {
    sampledRows++
    let rowSamples = 0
    let rowGray = 0
    for (let x = 0; x < png.width; x += 3) {
      const offset = (y * png.width + x) * 4
      const r = png.data[offset]
      const g = png.data[offset + 1]
      const b = png.data[offset + 2]
      const spread = Math.max(r, g, b) - Math.min(r, g, b)
      const isPageGray = spread <= 3 && r >= 62 && r <= 74
      sampled++
      rowSamples++
      if (isPageGray) {
        pageGray++
        rowGray++
      }
      if (spread >= 18) colorful++
      if (r + g + b < 30) dark++
    }
    if (rowGray / Math.max(rowSamples, 1) >= 0.94) {
      currentGrayRun++
      longestGrayRun = Math.max(longestGrayRun, currentGrayRun)
    } else {
      currentGrayRun = 0
    }
  }

  return {
    width: png.width,
    height: png.height,
    sampled,
    pageGrayRatio: pageGray / Math.max(sampled, 1),
    colorfulRatio: colorful / Math.max(sampled, 1),
    darkRatio: dark / Math.max(sampled, 1),
    longestPageGrayRunRatio:
      longestGrayRun / Math.max(sampledRows, 1),
  }
}

const cases = [
  {
    stageId: 'battle-600-00-01-001',
    materialPatterns: [
      '^mt_bg3d600A_01_01_propA(?:\\.\\d+)?$',
      '^mt_bg3d600A_01_01_propB(?:\\.\\d+)?$',
    ],
  },
  {
    stageId: 'battle-600-00-01-002',
    materialPatterns: [
      '^mt_bg3d600A_01_02_propA(?:\\.\\d+)?$',
      '^mt_bg3d600A_01_02_propC(?:\\.\\d+)?$',
    ],
  },
]
const views = [
  { name: 'front', position: [0, 1.5, 7.5], target: [0, 0.9, 0] },
  { name: 'low', position: [0, 0.15, 3.8], target: [0, 1.35, 0] },
  { name: 'high', position: [0, 4.6, 5.6], target: [0, 0.7, 0] },
]
const reports = []
const failures = []

for (const testCase of cases) {
  await page.evaluate(async id => window.loadStageById(id), testCase.stageId)
  await page.waitForFunction(
    id => {
      const root = window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
      return root?.userData?.stageDefinition?.id === id
        && root.getObjectByName(`Stage:${id}`)
        && !document.querySelector('#stage-selector')?.disabled
    },
    { timeout: 180_000 },
    testCase.stageId,
  )
  await waitForRenderedFrames(6)

  const materialState = await page.evaluate(({ stageId, materialPatterns }) => {
    const root = window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
    const object = root.getObjectByName(`Stage:${stageId}`)
    const patterns = materialPatterns.map(pattern => new RegExp(pattern))
    const materials = new Map()
    object.traverse(candidate => {
      if (!candidate.isMesh) return
      const list = Array.isArray(candidate.material)
        ? candidate.material
        : [candidate.material]
      for (const material of list) {
        if (!patterns.some(pattern => pattern.test(material.name))) continue
        materials.set(material.uuid, {
          name: material.name,
          alphaTest: material.alphaTest,
          alphaToCoverage: material.alphaToCoverage,
          transparent: material.transparent,
          depthWrite: material.depthWrite,
          mapName: material.map?.name ?? null,
        })
      }
    })
    return {
      debug: object.userData.stageAlphaCutoutFixes ?? null,
      materials: [...materials.values()],
    }
  }, testCase)

  for (const pattern of testCase.materialPatterns) {
    const regex = new RegExp(pattern)
    const matching = materialState.materials.filter(material => regex.test(material.name))
    if (matching.length === 0) {
      failures.push(`${testCase.stageId}: no material matched ${pattern}`)
      continue
    }
    for (const material of matching) {
      if (material.alphaTest < 0.49) {
        failures.push(`${testCase.stageId}/${material.name}: alphaTest=${material.alphaTest}`)
      }
      if (material.alphaToCoverage !== true) {
        failures.push(`${testCase.stageId}/${material.name}: alphaToCoverage disabled`)
      }
      if (material.transparent !== false || material.depthWrite !== true) {
        failures.push(`${testCase.stageId}/${material.name}: invalid cutout render state`)
      }
    }
  }

  const viewReports = []
  for (const view of views) {
    await setView(view.position, view.target)
    const screenshotPath = `/tmp/magius-stage-cutout-v2-${testCase.stageId}-${view.name}.png`
    const screenshot = Buffer.from(await page.screenshot({
      path: screenshotPath,
      type: 'png',
      fullPage: true,
    }))
    const stats = analyzeComposedScreenshot(screenshot)
    viewReports.push({ ...view, stats, screenshotPath })

    if (stats.pageGrayRatio > 0.45) {
      failures.push(
        `${testCase.stageId}/${view.name}: page-gray ratio ${stats.pageGrayRatio.toFixed(4)}`,
      )
    }
    if (stats.longestPageGrayRunRatio > 0.28) {
      failures.push(
        `${testCase.stageId}/${view.name}: page-gray row run ${stats.longestPageGrayRunRatio.toFixed(4)}`,
      )
    }
    if (stats.colorfulRatio < 0.025) {
      failures.push(
        `${testCase.stageId}/${view.name}: insufficient colored output ${stats.colorfulRatio.toFixed(4)}`,
      )
    }
  }

  reports.push({ ...testCase, materialState, views: viewReports })
}

const output = {
  generatedAt: new Date().toISOString(),
  viewport,
  reports,
  pageErrors,
  consoleErrors,
  failures,
}
fs.writeFileSync(
  '/tmp/magius-stage-alpha-cutout-v2.json',
  `${JSON.stringify(output, null, 2)}\n`,
)
console.log(JSON.stringify(output, null, 2))
await browser.close()

if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(' | ')}`)
if (consoleErrors.some(error => /shader|webgl|compile/i.test(error))) {
  failures.push(`WebGL/shader console errors: ${consoleErrors.join(' | ')}`)
}
if (failures.length > 0) {
  throw new Error(`Stage alpha-cutout v2 smoke failed:\n${failures.join('\n')}`)
}
