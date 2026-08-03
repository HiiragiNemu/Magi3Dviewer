import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url)))
const port = Number(process.argv[3] ?? 4174)
const host = process.argv[4] ?? '127.0.0.1'

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.fbxdata', 'application/octet-stream'],
  ['.gz', 'application/gzip'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
])

function safePath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${host}:${port}`).pathname)
  const requested = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
  if (requested !== root && !requested.startsWith(`${root}${sep}`)) return null
  return requested
}

function parseSingleRange(header, size) {
  if (header == undefined) return undefined

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match == undefined) return null

  const [, startText, endText] = match
  if (startText === '' && endText === '') return null

  let start
  let end
  if (startText === '') {
    const suffixLength = Number(endText)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(startText)
    end = endText === '' ? size - 1 : Number(endText)
  }

  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
    || start >= size
  ) {
    return null
  }

  return {
    start,
    end: Math.min(end, size - 1),
  }
}

const server = createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed')
    return
  }

  try {
    let path = safePath(request.url ?? '/')
    if (path === null) {
      response.writeHead(403).end('Forbidden')
      return
    }

    if (statSync(path).isDirectory()) path = resolve(path, 'index.html')
    const stat = statSync(path)
    const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`
    const commonHeaders = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'Content-Type': mimeTypes.get(extname(path).toLowerCase()) ?? 'application/octet-stream',
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
    }

    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, commonHeaders).end()
      return
    }

    const range = parseSingleRange(request.headers.range, stat.size)
    if (range === null) {
      response.writeHead(416, {
        ...commonHeaders,
        'Content-Range': `bytes */${stat.size}`,
      }).end()
      return
    }

    if (range == undefined) {
      response.writeHead(200, {
        ...commonHeaders,
        'Content-Length': stat.size,
      })
      if (request.method === 'HEAD') response.end()
      else createReadStream(path).pipe(response)
      return
    }

    response.writeHead(206, {
      ...commonHeaders,
      'Content-Length': range.end - range.start + 1,
      'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
    })
    if (request.method === 'HEAD') response.end()
    else createReadStream(path, range).pipe(response)
  } catch {
    response.writeHead(404).end('Not found')
  }
})

server.listen(port, host, () => {
  console.log(`LOCAL_PREVIEW_PID=${process.pid}`)
  console.log(`LOCAL_PREVIEW_URL=http://${host}:${port}/`)
  console.log(`LOCAL_PREVIEW_ROOT=${root}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
