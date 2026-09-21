import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
const read=rel=>fs.readFileSync(new URL(rel,import.meta.url),'utf8')
test('Demo card has unique accessible progress and actual filename/count/byte slots',()=>{
 const html=read('index.html');for(const id of ['load-progress-card','load-progress-track','load-progress-bar','load-progress-percent','load-progress-file','load-progress-count','load-progress-bytes'])assert.equal(html.split(`id="${id}"`).length-1,1)
 assert.match(html,/class="viewer-model-preload-icon"/);assert.match(read('src/viewer/style/stat.css'),/640ms steps\(1, end\) infinite/);assert.match(read('src/viewer/style/stat.css'),/width: 56px/)
})
test('callback compatibility preserved; stages now use task-owned bus and commit-scoped terminal',()=>{
 assert.match(read('magia-exedra-character-three/loader.ts'),/loadProgressCallback: \(progress: string, detail\?: LoadProgressDetail\)/)
 const stages=read('src/viewer/stages.ts');assert.match(stages,/startLoadingTask\('场景加载', loadController.signal, 'stage'\)/);assert.match(stages,/stageCommit.commit\(\)[\s\S]*?loadingTask.complete\(\)/);assert.match(stages,/loadingTask.fail\(error\)/)
 assert.doesNotMatch(stages,/reportStageLoadProgress\(''\)/)
})
