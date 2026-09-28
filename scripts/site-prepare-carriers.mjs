import { readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The packager still reads the old gzip filename. Restore that build-only
// alias from its committed, byte-identical browser carrier. Existing files,
// deployment checks, manifests and runtime resources are never overwritten.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const native = JSON.parse(await readFile(path.join(root, 'character-actions/manifest.v1.json'), 'utf8'))
const combat = JSON.parse(await readFile(path.join(root, 'character-actions/combat-jump/manifest.v1.json'), 'utf8'))
const runtimes = new Map()
for (const item of [...native.entries, ...combat.characters]) if (item.runtime) runtimes.set(item.runtime.url, item.runtime.schema)
let restored = 0
for (const [url, schema] of runtimes) {
  if (!/^\/character-actions\/(?:native-dungeon\/\d+|combat-jump\/runtime\/\d+)\/runtime\.v1\.json\.gz$/.test(url)) throw new Error('Invalid action runtime path')
  const alias = path.join(root, url.slice(1))
  const carrier = alias.replace(/\.json\.gz$/, '.magius-runtime')
  const bytes = await readFile(carrier)
  const decoded = JSON.parse(gunzipSync(bytes, { maxOutputLength: 256 * 1024 ** 2 }).toString('utf8'))
  if (decoded.schema !== schema) throw new Error('Runtime schema mismatch: ' + url)
  try {
    const existing = await readFile(alias)
    if (!existing.equals(bytes)) throw new Error('Runtime alias disagrees with the committed carrier: ' + url)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await writeFile(alias, bytes, { flag: 'wx' })
    restored++
  }
}
console.log(JSON.stringify({ runtimeCarriers: runtimes.size, buildOnlyAliasesCreated: restored, existingResourcesChanged: false }))
