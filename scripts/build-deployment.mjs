import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteEntry = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const heapMiB = Math.max(4096, Math.min(10240, Math.floor(os.totalmem() / 1024 ** 2 * 0.65)))
const garmentContacts = process.env.MAGIUS_GARMENT_CONTACTS || process.env.VITE_MAGIUS_GARMENT_CONTACTS || 'on'
if (!['on','off'].includes(garmentContacts)) throw new Error('Invalid MAGIUS_GARMENT_CONTACTS')
const jumpStyle = process.env.MAGIUS_JUMP_STYLE || 'expressive'
if (!['classic','expressive'].includes(jumpStyle)) throw new Error('Invalid MAGIUS_JUMP_STYLE')
const environment = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || `--max-old-space-size=${heapMiB}`,
  VITE_MAGIUS_GARMENT_CONTACTS: garmentContacts, VITE_MAGIUS_JUMP_STYLE: jumpStyle, MAGIUS_DEPLOY_LIGHTWEIGHT: '1', MAGIUS_DEPLOY_OUT_DIR: process.env.MAGIUS_DEPLOY_OUT_DIR || 'dist-deploy',
  MAGIUS_DEPLOY_TARGET: process.env.MAGIUS_DEPLOY_TARGET || 'cloudflare' }
function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: repoRoot, env: environment, stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${executable} ${args.join(' ')} exited ${code ?? signal}`)))
  })
}
// Git itself is the authority for the checked-out application. CI environment
// variables can describe a workflow commit rather than its checkout revision.
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:repoRoot,encoding:'utf8',timeout:10000}).trim()
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Cannot resolve the checked-out source revision')
await run(process.execPath, ['scripts/site-prepare-carriers.mjs'])
await run(process.execPath, [viteEntry, 'build'])
await run(process.execPath, ['scripts/copy-deployment-public.mjs'])
await fs.writeFile(path.resolve(repoRoot, environment.MAGIUS_DEPLOY_OUT_DIR, 'site-version.json'), JSON.stringify({
  revision, jumpStyle, garmentContacts, garmentContactPolicy:'one-way-damped-garment-contacts-v2', performanceStudio:'live-recorded-lanes-v1', entryPolicy:'single-production-no-store-v1', landing:'continuous-grounded-gait-v1', builtAt:new Date().toISOString(), poseEditor:'bind-limited-ik-v3', viewportEditor:'persistent-v1', groundGuard:'scene-floor-v1', selection:'existing-outline-uniforms',
  deploymentTarget:environment.MAGIUS_DEPLOY_TARGET, stageDelivery:'cloudflare-same-origin',
}) + '\n')

const output = path.resolve(repoRoot, environment.MAGIUS_DEPLOY_OUT_DIR)
const htmlPath = path.join(output, 'index.html')
const html = await fs.readFile(htmlPath, 'utf8')
if (!html.includes('<head>')) throw new Error('Missing document head')
await fs.writeFile(htmlPath, html.replace('<head>', '<head>\n<meta name="magius-build-revision" content="' + revision + '">'))
const headerPath = path.join(output, '_headers')
await fs.writeFile(headerPath, (await fs.readFile(headerPath,'utf8')).replaceAll('__MAGIUS_BUILD_REVISION__',revision))
