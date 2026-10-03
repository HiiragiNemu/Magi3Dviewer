import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const site = process.env.MAGIUS_SITE_URL || 'http://127.0.0.1:4178/'
const evidence = process.env.MAGIUS_EVIDENCE_DIR || 'artifacts/resource-panel-layout'
fs.mkdirSync(evidence, { recursive: true })
const chrome = process.env.CHROME_BIN || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : execFileSync('bash', ['-lc', 'command -v google-chrome-stable || command -v google-chrome || command -v chromium'], { encoding: 'utf8' }).trim())
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 300000,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const results = [], errors = []
try {
  const page = await browser.newPage()
  const portraitRequests = new Set()
  page.on('request', request => { if (request.url().includes('/ui-thumbnails/runtime-selection/characters/')) portraitRequests.add(request.url()) })
  page.on('pageerror', error => errors.push(String(error)))
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
  await page.goto(site + '?diagnostic=pose-editor&runtimeDelivery=release', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForFunction(() => window.scene?.characterSelected?.character, { timeout: 180000 })
  assert.ok(portraitRequests.size <= 3, 'Closed catalogs must not eagerly download the entire portrait library')
  results.push({ test:'startup-lazy-portraits', requested:portraitRequests.size, urls:[...portraitRequests] })
  await page.select('#language-toggle', 'zh-CN')
  for (const [width, height] of [[1280, 900], [360, 780], [430, 932], [932, 430]]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    for (const [kind, toggle, panel, grid, close] of [
      ['character', '#character-list-panel-toggle', '#character-list-panel', '#character-list-grid', '#character-list-panel-close'],
      ['enemy', '#enemy-panel-toggle', '#enemy-panel', '#enemy-catalog-grid', '#enemy-panel-close'],
      ['scene', '#stage-list-panel-toggle', '#stage-list-panel', '#stage-list-grid', '#stage-list-panel-close'],
    ]) {
      await page.click(toggle)
      await page.waitForSelector(panel + '.is-open ' + grid + ' button', { visible: true, timeout: 30000 })
      const prefix = kind === 'character' ? '#character-list' : kind === 'enemy' ? '#enemy-catalog' : '#stage-list'
      const search = prefix + '-search', language = prefix + '-name-language'
      assert.equal(await page.$eval(search, e => e.placeholder), kind === 'scene' ? '支持使用英文或者日文搜索' : '支持使用罗马音或者日文搜索')
      assert.equal(await page.$$eval(panel + ' .resource-catalog-heading', e => e.length), 0)
      assert.equal(await page.$$eval(panel + ' .resource-search button', e => e.length), 1)
      if (width === 1280) {
        const queries = kind === 'character' ? ['madoka', 'まどか'] : kind === 'enemy' ? ['baraen no majo', '薔薇園'] : ['Rose Garden', '薔薇園']
        for (const query of queries) {
          await page.click(search); await page.type(search, query)
          await page.waitForFunction(selector => document.querySelectorAll(selector + ' button').length > 0, {}, grid)
          results.push({ kind, query, matches: await page.$$eval(grid + ' button', rows => rows.length) })
          await page.click(search); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace')
        }
        await page.click(language)
        assert.match(await page.$eval(language, e => e.textContent), /日/)
        const latinText = await page.$eval(grid, e => e.textContent)
        assert.match(latinText, kind === 'character' ? /Madoka/ : kind === 'enemy' ? /baraen/ : /Rose Garden/i)
        await page.click(language)
        assert.match(await page.$eval(language, e => e.textContent), kind === 'scene' ? /English|英语|英文/ : /Romaji|罗马音/)
        assert.match(await page.$eval(grid, e => e.textContent), kind === 'character' ? /まどか/ : /薔薇園/)
        // Return to default Chinese without changing the application's locale.
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => window.scene?.characterSelected?.character, { timeout: 180000 })
        await page.click(toggle)
        await page.waitForSelector(panel + '.is-open ' + grid + ' button', { visible: true })
        if (kind === 'character') {
          await page.click('#character-list-add')
          await page.waitForFunction(() => document.querySelectorAll('#character-instance-list .resource-instance-row').length === 2 && !document.getElementById('character-list-add').disabled, { timeout: 180000 })
          await page.click('#character-instance-list .resource-instance-select')
          assert.equal(await page.$eval('#character-instance-list .resource-instance-row', e => e.classList.contains('is-selected')), true)
        }
      }
      // Wait for visible image decoding; no simulated thumbnails or fixture UI.
      await page.waitForFunction(selector => { const images = [...document.querySelectorAll(selector + ' img')].slice(0, 8);
        return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0) }, { timeout: 30000 }, grid)
      const metrics = await page.$eval(grid, grid => {
        const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
        return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, scrollWidth: grid.scrollWidth,
          clientWidth: grid.clientWidth, cards: [...grid.querySelectorAll('button')].slice(0, 12).map(tile => {
            const frame = tile.querySelector('.runtime-selection-tile-image'), label = tile.querySelector('.runtime-selection-tile-label')
            return { id: tile.dataset.value, tile: rect(tile), frame: rect(frame), label: rect(label),
              text: label.textContent, whiteSpace: getComputedStyle(label).whiteSpace,
              labelScrollWidth: label.scrollWidth, labelClientWidth: label.clientWidth }
          }) }
      })
      assert.ok(metrics.cards.length >= 3)
      assert.ok(metrics.columns >= (kind === 'scene' ? 2 : 3), `${kind} ${width}: catalog wastes horizontal space`)
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `${kind}: horizontal overflow`)
      for (const card of metrics.cards) {
        if (kind === 'scene') {
          assert.ok(card.frame.w > card.frame.h * 1.7, 'Scene previews must remain landscape')
          continue
        }
        assert.ok(Math.abs(card.frame.w - card.frame.h) <= 1, `${kind} ${width}: non-square frame ${card.id}`)
        assert.ok(card.tile.w - card.frame.w <= 16, 'Excessive space beside portrait')
        assert.ok(Math.abs(card.label.w - card.frame.w) <= 1, 'Name must wrap to portrait width')
        assert.equal(card.whiteSpace, 'normal')
        assert.ok(card.labelScrollWidth <= card.labelClientWidth + 1, 'Name escapes card width')
      }
      const footer = await page.$eval(panel, panel => {
        const rect = e => { const r = e.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right } }
        return { panel:rect(panel), footer:rect(panel.querySelector('footer')), input:rect(panel.querySelector('input[type=search]')),
          tools:rect(panel.querySelector('.resource-search-tools')), cards:[...panel.querySelectorAll('.resource-instance-row')].map(row => ({
            row:rect(row), image: row.querySelector('img') ? rect(row.querySelector('img')) : null, decoded:row.querySelector('img')?.naturalWidth > 0,
            remove:rect(row.querySelector('button:last-child')) })) }
      })
      assert.ok(footer.footer.bottom <= footer.panel.bottom + 1, `${kind} ${width}: footer clipped`)
      assert.ok(footer.panel.right<=width && footer.panel.bottom<=height+1, `${kind} ${width}: resized panel extends outside screen`)
      if (footer.panel.w > 600) assert.ok(Math.abs(footer.input.y - footer.tools.y) < 6, `${kind}: counts and toggle must share search row`)
      for (const card of footer.cards) {
        assert.ok(card.decoded, 'Added actor portrait is missing')
        assert.ok(Math.abs(card.image.w-card.image.h) <= 1, 'Added actor portrait must be square')
        assert.ok(card.row.w < 90, 'Added actor wastes an entire row')
        assert.ok(card.row.bottom <= footer.panel.bottom && card.remove.bottom <= card.row.bottom, 'Added actor or remove control clipped')
      }
      if (footer.cards.length > 1) assert.equal(footer.cards[0].row.y,footer.cards[1].row.y,'Added actors must sit side by side')
      results.push({ kind, width, footer })
      results.push({ kind, width, height, metrics })
      await page.screenshot({ path: path.join(evidence, `${kind}-${width}x${height}.png`), fullPage: true })
      if (width === 1280) {
        const measure = () => page.$eval(panel, p => {
          const rect = e => { const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom,r:r.right} }
          const g=p.querySelector('.runtime-selection-thumbnail-grid'), gr=rect(g)
          return {panel:rect(p),grid:gr,columns:getComputedStyle(g).gridTemplateColumns.split(' ').length,
            header:rect(p.querySelector('header')),search:rect(p.querySelector('.resource-search')),
            input:rect(p.querySelector('input[type=search]')),tools:rect(p.querySelector('.resource-search-tools')),
            footer:rect(p.querySelector('footer')),visible:[...g.querySelectorAll('button')].map(rect).filter(r=>r.y>=gr.y-1 && r.b<=gr.b+1)}
        })
        const camera = () => page.evaluate(() => ({p:window.scene.camera.position.toArray(),q:window.scene.camera.quaternion.toArray()}))
        const before=await measure(),cameraBefore=await camera()
        await page.mouse.move(before.header.x+80,before.header.y+18);await page.mouse.down();await page.mouse.move(before.header.x+120,before.header.y+38,{steps:8});await page.mouse.up()
        const dragged=await measure()
        assert.ok(Math.abs(dragged.panel.x-before.panel.x-40)<2 && Math.abs(dragged.panel.y-before.panel.y-20)<2, `${kind}: header drag did not move panel`)
        assert.deepEqual(await camera(),cameraBefore,'Dragging a panel moved the camera')
        await page.click(panel+' .resource-size-toggle')
        await page.waitForFunction(selector => document.querySelector(selector).classList.contains('resource-is-compact'),{},panel)
        await new Promise(r=>setTimeout(r,300))
        const compact=await measure()
        assert.equal(compact.columns,kind==='scene'?3:5)
        assert.equal(compact.visible.length,compact.columns*2,`${kind}: compact view must show two complete rows`)
        assert.ok(compact.footer.b<=compact.panel.b+1)
        assert.ok(compact.search.b<=compact.grid.y+1 && compact.input.r<=compact.tools.x+1,'Compact controls overlap the grid or each other')
        await page.screenshot({path:path.join(evidence,`${kind}-compact.png`)})
        const idle=await page.$eval(panel,p=>new Promise(resolve=>{
          let mutations=0,styleMutations=0,frames=0;const t=performance.now(),observer=new MutationObserver(rows=>{
            mutations+=rows.filter(row=>row.type==='childList').length
            styleMutations+=rows.filter(row=>row.type==='attributes').length
          })
          for(const element of p.querySelectorAll('.runtime-selection-thumbnail-grid,.resource-active-list'))observer.observe(element,{childList:true,subtree:true})
          observer.observe(p,{attributes:true,attributeFilter:['style']})
          const frame=()=>{frames++;if(performance.now()-t<1200)requestAnimationFrame(frame);else{observer.disconnect();resolve({mutations,styleMutations,frames,elapsed:performance.now()-t})}};requestAnimationFrame(frame)
        }))
        assert.equal(idle.mutations,0,'Idle panel repeatedly rebuilds its cards')
        assert.equal(idle.styleMutations,0,'Idle compact sizing repeatedly writes panel styles')
        assert.ok(idle.frames>0,'Rendering stopped while panel was open')
        await page.click(panel+' .resource-size-toggle')
        const restored=await measure()
        assert.ok(Math.abs(restored.panel.w-dragged.panel.w)<1 && Math.abs(restored.panel.h-dragged.panel.h)<1, 'Restore lost original size')
        // Real resize-handle pointer events at several widths, not viewport-only tests.
        for(const targetWidth of [560,420,310]) {
          const current=await measure(),handle=await page.$eval(panel+' .resize-se',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
          await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(handle.x+targetWidth-current.panel.w,handle.y,{steps:8});await page.mouse.up()
          const narrow=await measure()
          assert.ok(narrow.columns < before.columns,`${kind}: cards did not reflow after drag resizing`)
          assert.ok(narrow.tools.r<=narrow.panel.r && narrow.search.b<=narrow.grid.y+1 && narrow.footer.b<=narrow.panel.b+1,`${kind}: resized text/footer escapes panel`)
          const sameRow=Math.abs(narrow.input.y-narrow.tools.y)<6
          if(sameRow)assert.ok(narrow.input.r<=narrow.tools.x+1,'Search text overlaps counts')
          results.push({kind,targetWidth,narrow})
        }
        await page.screenshot({path:path.join(evidence,`${kind}-drag-resized.png`)})
        const last=await measure(),resizeBack=await page.$eval(panel+' .resize-se',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
        await page.mouse.move(resizeBack.x,resizeBack.y);await page.mouse.down();await page.mouse.move(resizeBack.x+dragged.panel.w-last.panel.w,resizeBack.y,{steps:8});await page.mouse.up()
        results.push({kind,before,dragged,compact,restored,idle})
      }
      if (kind === 'character' && width === 1280) {
        await page.click('#character-instance-list .resource-instance-row:last-child > button:last-child')
        await page.waitForFunction(() => document.querySelectorAll('#character-instance-list .resource-instance-row').length === 1)
      }
      await page.click(close)
    }
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, site, layouts: results.length }))
} finally {
  fs.writeFileSync(path.join(evidence, 'layout.json'), JSON.stringify({ site, results, errors }, null, 2) + '\n')
  await browser.close()
}
