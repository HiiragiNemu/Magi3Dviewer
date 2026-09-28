import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteEntry = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const heapMiB = Math.max(4096, Math.min(10240, Math.floor(os.totalmem() / 1024 ** 2 * 0.65)))
const environment = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || `--max-old-space-size=${heapMiB}`,
  MAGIUS_DEPLOY_LIGHTWEIGHT: '1', MAGIUS_DEPLOY_OUT_DIR: process.env.MAGIUS_DEPLOY_OUT_DIR || 'dist-deploy' }
function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: repoRoot, env: environment, stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${executable} ${args.join(' ')} exited ${code ?? signal}`)))
  })
}
await run(process.execPath, ['scripts/site-prepare-carriers.mjs'])
await run(process.execPath, [viteEntry, 'build'])
await run(process.execPath, ['scripts/copy-deployment-public.mjs'])
