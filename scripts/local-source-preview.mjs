import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

// Same source and asset routes, served directly on loopback. No self-signed
// browser certificate and no reverse proxy that drops Range, MIME, or HMR.
const root = fileURLToPath(new URL('../', import.meta.url))
const port = Number(process.argv[2] ?? 6595)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local preview port')
const server = await createServer({
  root,
  server: { host: '127.0.0.1', port, strictPort: true, https: false },
})
await server.listen()
console.log(JSON.stringify({
  event: 'local-source-ready', pid: process.pid, root,
  url: `http://127.0.0.1:${port}/?runtimeDelivery=local`,
}))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await server.close(); process.exit(0) })
}
