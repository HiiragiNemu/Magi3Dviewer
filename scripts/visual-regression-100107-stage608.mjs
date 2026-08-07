import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const baseUrl = process.env.MAGIUS_TEST_URL || 'https://127.0.0.1:4173/'
const outputDir = process.env.MAGIUS_VISUAL_OUTPUT || 'visual-regression-output'
await fs.mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-gl=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ],
})

const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
})
const page = await context.newPage()
const consoleRows = []
const pageErrors = []

page.on('console', message => {
  const row = { type: message.type(), text: message.text() }
  consoleRows.push(row)
  console.log(`[browser:${row.type}] ${row.text}`)
})
page.on('pageerror', error => {
  pageErrors.push(String(error?.stack || error))
  console.error('[browser:pageerror]', error)
})

try {
  await page.goto(`${baseUrl}#100107`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  })

  await page.waitForFunction(() => {
    const character = document.querySelector('#character-selector')
    const stage = document.querySelector('#stage-selector')
    return character instanceof HTMLSelectElement
      && character.value === '100107'
      && stage instanceof HTMLSelectElement
      && [...stage.options].some(option => option.value === 'battle-608-00-00-001')
  }, undefined, { timeout: 180_000 })

  await page.selectOption('#stage-selector', 'battle-608-00-00-001')
  await page.waitForFunction(() => {
    const stage = document.querySelector('#stage-selector')
    return stage instanceof HTMLSelectElement
      && stage.value === 'battle-608-00-00-001'
      && !stage.disabled
  }, undefined, { timeout: 180_000 })

  // Give textures, character animation and the post-processing chain several frames to settle.
  await page.waitForTimeout(8_000)

  const state = await page.evaluate(() => {
    const canvas = document.querySelector('#viewer canvas')
    const stage = document.querySelector('#stage-selector')
    const character = document.querySelector('#character-selector')
    const gl = canvas instanceof HTMLCanvasElement
      ? (canvas.getContext('webgl2') || canvas.getContext('webgl'))
      : null
    const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info')
    return {
      character: character instanceof HTMLSelectElement ? character.value : null,
      stage: stage instanceof HTMLSelectElement ? stage.value : null,
      stageDisabled: stage instanceof HTMLSelectElement ? stage.disabled : null,
      canvas: canvas instanceof HTMLCanvasElement
        ? { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight }
        : null,
      webgl: gl ? {
        version: gl.getParameter(gl.VERSION),
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      } : null,
      bodyClasses: [...document.body.classList],
    }
  })

  const canvas = page.locator('#viewer canvas')
  if (await canvas.count() !== 1) throw new Error(`Expected one #viewer canvas, got ${await canvas.count()}`)
  await canvas.screenshot({ path: `${outputDir}/100107-battle-608-canvas.png` })
  await page.screenshot({ path: `${outputDir}/100107-battle-608-full.png`, fullPage: true })

  const consoleErrors = consoleRows.filter(row => row.type === 'error')
  const webglValidationWarnings = consoleRows.filter(row =>
    row.type === 'warning'
    && /GL_INVALID_(?:OPERATION|FRAMEBUFFER_OPERATION)|feedback loop/i.test(row.text)
  )
  const report = {
    ...state,
    pageErrors,
    consoleErrors,
    webglValidationWarnings,
    consoleWarnings: consoleRows.filter(row => row.type === 'warning'),
    allConsole: consoleRows,
  }
  await fs.writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2) + '\n')

  if (state.character !== '100107') throw new Error(`Wrong character loaded: ${state.character}`)
  if (state.stage !== 'battle-608-00-00-001') throw new Error(`Wrong stage loaded: ${state.stage}`)
  if (!state.webgl) throw new Error('WebGL context unavailable')
  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join('\n')}`)
  if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.map(row => row.text).join('\n')}`)
  if (webglValidationWarnings.length) {
    throw new Error(
      `WebGL validation warnings: ${webglValidationWarnings.map(row => row.text).join('\n')}`,
    )
  }
} finally {
  await browser.close()
}
