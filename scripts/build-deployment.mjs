import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteEntry = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const heapMiB = Math.max(4096, Math.min(10240, Math.floor(os.totalmem() / 1024 ** 2 * 0.65)))
const environment = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || `--max-old-space-size=${heapMiB}`,
  MAGIUS_DEPLOY_LIGHTWEIGHT: '1', MAGIUS_DEPLOY_OUT_DIR: process.env.MAGIUS_DEPLOY_OUT_DIR || 'dist-deploy',
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
  revision, builtAt:new Date().toISOString(), poseEditor:'bind-limited-ik-v3', viewportEditor:'persistent-v1', groundGuard:'scene-floor-v1', selection:'existing-outline-uniforms',
  deploymentTarget:environment.MAGIUS_DEPLOY_TARGET, stageDelivery:'cloudflare-same-origin',
}) + '\n')
