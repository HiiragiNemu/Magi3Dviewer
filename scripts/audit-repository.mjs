import fs from 'node:fs'
import path from 'node:path'
import {execFileSync, spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(process.env.MAGIUS_AUDIT_DIR || path.join(root, 'artifacts/repository-audit'))
const concurrency = Math.max(1, Math.min(4, Number(process.env.MAGIUS_AUDIT_CONCURRENCY) || 2))
const timeoutMs = Math.max(10000, Math.min(600000, Number(process.env.MAGIUS_AUDIT_TIMEOUT_MS) || 120000))
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root,encoding:'utf8'}).trim()
const trackedChanges = execFileSync('git', ['status', '--short', '--untracked-files=no'], {cwd:root,encoding:'utf8'}).trim()
const tracked = execFileSync('git', ['ls-files', '-z'], {cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}).split('\0').filter(Boolean)
const discovered = tracked.filter(file => /(?:^|\/)[^/]+\.test\.(?:mjs|cjs|js)$/.test(file)).sort()
const filter = process.argv.slice(2)
const files = filter.length ? discovered.filter(file => filter.includes(file)) : discovered
if (!files.length || filter.some(file => !discovered.includes(file))) throw new Error('Test filter is empty or names an untracked/non-test file')
fs.mkdirSync(path.join(output,'logs'), {recursive:true})
const otherTestFiles = tracked.filter(file => /(?:^|\/)(?:test_[^/]+\.py|[^/]+(?:\.test|_test)\.(?:py|ts))$/.test(file))
const report = {revision,trackedChanges,startedAt:new Date().toISOString(),concurrency,timeoutMs,inventory:discovered,selected:files,notExecutedByNodeRunner:otherTestFiles,results:[]}
let next = 0
function checkpoint() {
  const summary = {selected:files.length,completed:report.results.length,passed:report.results.filter(r=>r.status==='passed').length,
    failed:report.results.filter(r=>r.status==='failed').length,timedOut:report.results.filter(r=>r.status==='timeout').length,
    totalAssertions:report.results.reduce((n,r)=>n+(r.counts.tests||0),0),failedAssertions:report.results.reduce((n,r)=>n+(r.counts.fail||0),0),
    skippedAssertions:report.results.reduce((n,r)=>n+(r.counts.skipped||0),0)}
  report.summary=summary
  fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify(report,null,2)+'\n')
}
function run(file) {
  return new Promise(resolve => {
    const start=Date.now(), log=path.join('logs',file.replace(/[\\/:]/g,'__')+'.log')
    const fd=fs.openSync(path.join(output,log),'w')
    let tail='', bytes=0, timedOut=false, outputLimited=false
    const child=spawn(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',file],{
      cwd:root,env:{...process.env,NODE_OPTIONS:process.env.NODE_OPTIONS||'--max-old-space-size=3072'},windowsHide:true,stdio:['ignore','pipe','pipe']})
    const write=chunk=>{
      bytes+=chunk.length
      if(bytes<=32*1024*1024)fs.writeSync(fd,chunk)
      else if(!outputLimited){outputLimited=true;fs.writeSync(fd,'\nAUDIT: output exceeded 32 MiB; stopped, not passed.\n');child.kill()}
      tail=(tail+chunk.toString()).slice(-96000)
    }
    child.stdout.on('data',write);child.stderr.on('data',write)
    const timer=setTimeout(()=>{timedOut=true;child.kill()},timeoutMs)
    child.on('error',error=>write(Buffer.from('AUDIT PROCESS ERROR: '+error.message+'\n')))
    child.on('close',(code,signal)=>{
      clearTimeout(timer);fs.closeSync(fd)
      const counts={}
      for(const [,key,value] of tail.matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)\r?$/gm))counts[key]=Number(value)
      const status=timedOut?'timeout':code===0&&!outputLimited?'passed':'failed'
      const errors=tail.split(/\r?\n/).filter(line=>/not ok|error:|message:|ERR_|Error:|ENOENT|Cannot find|expected:|actual:|code:/.test(line)).slice(-70)
      report.results.push({file,status,code,signal,durationMs:Date.now()-start,bytes,log,counts,errors})
      checkpoint();console.log(JSON.stringify({completed:report.results.length,total:files.length,file,status,counts,durationMs:Date.now()-start}))
      resolve()
    })
  })
}
checkpoint()
await Promise.all(Array.from({length:concurrency},async()=>{while(next<files.length)await run(files[next++])}))
report.finishedAt=new Date().toISOString()
report.results.sort((a,b)=>a.file.localeCompare(b.file))
checkpoint()
fs.writeFileSync(path.join(output,'repository-audit.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report.summary,null,2))
process.exitCode=report.results.every(row=>row.status==='passed')?0:1
