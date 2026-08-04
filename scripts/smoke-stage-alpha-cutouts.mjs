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

async function waitFrames(count = 4) {
  await page.evaluate(async n => {
    const next = () => new Promise(resolve => requestAnimationFrame(resolve))
    for (let i = 0; i < n; i++) await next()
  }, count)
}

async function setView(position, target) {
  await page.evaluate(({ position: p, target: t }) => {
    const viewer = window.scene
    viewer.camera.position.set(...p)
    viewer.controls.target.set(...t)
    viewer.controls.update()
  }, { position, target })
  await waitFrames(6)
}

async function captureCanvasStats() {
  return page.evaluate(() => {
    const source = window.scene.renderer.domElement
    const copy = document.createElement('canvas')
    copy.width = source.width
    copy.height = source.height
    const context = copy.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Could not create 2D canvas context')
    context.drawImage(source, 0, 0)
    const pixels = context.getImageData(0, 0, copy.width, copy.height).data

    const stepX = Math.max(1, Math.floor(copy.width / 175))
    const stepY = Math.max(1, Math.floor(copy.height / 384))
    let sampled = 0
    let transparent = 0
    let neutralGray = 0
    let colorful = 0
    let dark = 0
    let longestUniformGrayRun = 0
    let currentUniformGrayRun = 0
    let sampledRows = 0

    for (let y = 0; y < copy.height; y += stepY) {
      sampledRows++
      let rowSamples = 0
      let rowGray = 0
      let rowTransparent = 0
      for (let x = 0; x < copy.width; x += stepX) {
        const i = (y * copy.width + x) * 4
        const r = pixels[i]
        const g = pixels[i + 1]
        const b = pixels[i + 2]
        const a = pixels[i + 3]
        const spread = Math.max(r, g, b) - Math.min(r, g, b)
        const isTransparent = a < 8
        const isPageGray = spread <= 5 && r >= 48 && r <= 80
        rowSamples++
        sampled++
        if (isTransparent) {
          transparent++
          rowTransparent++
        }
        if (isPageGray) {
          neutralGray++
          rowGray++
        }
        if (spread >= 18 && a > 8) colorful++
        if (r + g + b < 30 && a > 8) dark++
      }
      const uniformRatio = Math.max(rowGray, rowTransparent) / Math.max(rowSamples, 1)
      if (uniformRatio >= 0.94) {
        currentUniformGrayRun++
        longestUniformGrayRun = Math.max(longestUniformGrayRun, currentUniformGrayRun)
      } else {
        currentUniformGrayRun = 0
      }
    }

    return {
      canvas: {
        width: copy.width,
        height: copy.height,
        clientWidth: source.clientWidth,
        clientHeight: source.clientHeight,
      },
      sampled,
      sampledRows,
      transparentRatio: transparent / Math.max(sampled, 1),
      neutralGrayRatio: neutralGray / Math.max(sampled, 1),
      colorfulRatio: colorful / Math.max(sampled, 1),
      darkRatio: dark / Math.max(sampled, 1),
      longestUniformGrayRunRatio:
        longestUniformGrayRun / Math.max(sampledRows, 1),
    }
  })
}

const cases = [
  {
    stageId: 'battle-600-00-01-001',
    materialPattern: '^mt_bg3d600A_01_01_propB(?:\\.\\d+)?$',
  },
  {
    stageId: 'battle-600-00-01-002',
    materialPattern: '^mt_bg3d600A_01_02_propA(?:\\.\\d+)?$',
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
      const object = root?.getObjectByName(`Stage:${id}`)
      return root?.userData?.stageDefinition?.id === id
        && object
        && !document.querySelector('#stage-selector')?.disabled
    },
    { timeout: 180_000 },
    testCase.stageId,
  )
  await waitFrames(8)

  const materialState = await page.evaluate(({ stageId, materialPattern }) => {
    const root = window.scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
    const object = root.getObjectByName(`Stage:${stageId}`)
    const pattern = new RegExp(materialPattern)
    const materials = new Map()
    object.traverse(candidate => {
      if (!candidate.isMesh) return
      const list = Array.isArray(candidate.material)
        ? candidate.material
        : [candidate.material]
      for (const material of list) {
        if (!pattern.test(material.name)) continue
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

  if (materialState.materials.length === 0) {
    failures.push(`${testCase.stageId}: no target cutout material was found`)
  }
  for (const material of materialState.materials) {
    if (material.alphaTest < 0.49) {
      failures.push(`${testCase.stageId}/${material.name}: alphaTest=${material.alphaTest}`)
    }
    if (material.alphaToCoverage !== true) {
      failures.push(`${testCase.stageId}/${material.name}: alphaToCoverage is disabled`)
    }
    if (material.transparent !== false || material.depthWrite !== true) {
      failures.push(`${testCase.stageId}/${material.name}: invalid opaque-cutout queue state`)
    }
  }

  const viewReports = []
  for (const view of views) {
    await setView(view.position, view.target)
    const stats = await captureCanvasStats()
    const screenshotPath = `/tmp/magius-stage-cutout-${testCase.stageId}-${view.name}.png`
    await page.screenshot({ path: screenshotPath, fullPage: true })
    viewReports.push({ ...view, stats, screenshotPath })

    if (stats.transparentRatio > 0.12) {
      failures.push(
        `${testCase.stageId}/${view.name}: canvas transparent ratio ${stats.transparentRatio.toFixed(4)}`,
      )
    }
    if (stats.longestUniformGrayRunRatio > 0.28) {
      failures.push(
        `${testCase.stageId}/${view.name}: uniform gray row run ${stats.longestUniformGrayRunRatio.toFixed(4)}`,
      )
    }
    if (stats.neutralGrayRatio > 0.55) {
      failures.push(
        `${testCase.stageId}/${view.name}: neutral gray ratio ${stats.neutralGrayRatio.toFixed(4)}`,
      )
    }
    if (stats.colorfulRatio < 0.025) {
      failures.push(
        `${testCase.stageId}/${view.name}: insufficient colored output ${stats.colorfulRatio.toFixed(4)}`,
      )
    }
  }

  reports.push({
    ...testCase,
    materialState,
    views: viewReports,
  })
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
  '/tmp/magius-stage-alpha-cutout.json',
  `${JSON.stringify(output, null, 2)}\n`,
)
console.log(JSON.stringify(output, null, 2))
await browser.close()

if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(' | ')}`)
if (consoleErrors.some(error => /shader|webgl|compile/i.test(error))) {
  failures.push(`WebGL/shader console errors: ${consoleErrors.join(' | ')}`)
}
if (failures.length > 0) {
  throw new Error(`Stage alpha-cutout smoke failed:\n${failures.join('\n')}`)
}
