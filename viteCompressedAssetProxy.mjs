import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'

/** Legacy route accepted so already-open source previews can finish cleanly. */
export const compressedAssetBrowserSuffix = '.magiadata'
export const compressedAssetBrowserRoutePrefix = '/__magius_compressed_asset__/'
export const localVoiceRoutePrefix = '/voice/Cv/'
export const localVoicePayloadPrefix = '/__magius_voice__/'

function localVoiceSourceRoot(viteRoot) {
  const configured = process.env.MAGIUS_LOCAL_VOICE_ROOT?.trim()
  return path.resolve(
    configured || path.resolve(viteRoot, '..', '..', 'ma-ex-data', 'gamedata', 'Resources', 'Sound', 'Cv'),
  )
}

function localVoiceFilePath(sourceRoot, pathname) {
  if (!pathname.startsWith(localVoiceRoutePrefix)) return null
  let relative
  try {
    relative = decodeURIComponent(pathname.slice(localVoiceRoutePrefix.length))
  } catch {
    return null
  }
  if (!relative || !relative.toLowerCase().endsWith('.ogg')) return null
  const absolute = path.resolve(sourceRoot, relative)
  const relativeToRoot = path.relative(sourceRoot, absolute)
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return null
  return absolute
}

function splitUrlSuffix(value) {
  const match = String(value).match(/^([^?#]*)([?#].*)?$/)
  return {
    pathname: match?.[1] ?? String(value),
    suffix: match?.[2] ?? '',
  }
}

function encodeAssetPath(pathname) {
  return Buffer.from(pathname, 'utf8').toString('base64url')
}

function decodeAssetPath(token) {
  try {
    return Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

/**
 * Imported gzip payloads are fetched through a same-origin route whose URL has
 * no downloadable file extension. The token deterministically preserves the
 * original Vite asset path while keeping `.gz`, `.fbx`, and `.bin` out of the
 * browser-facing request URL.
 */
export function toBrowserSafeCompressedAssetUrl(value) {
  const { pathname, suffix } = splitUrlSuffix(value)
  if (!pathname.toLowerCase().endsWith('.gz')) return value
  return `${compressedAssetBrowserRoutePrefix}${encodeAssetPath(pathname)}${suffix}`
}

export function fromBrowserSafeCompressedAssetUrl(value) {
  const { pathname, suffix } = splitUrlSuffix(value)
  if (pathname.startsWith(compressedAssetBrowserRoutePrefix)) {
    const token = pathname.slice(compressedAssetBrowserRoutePrefix.length)
    if (!token || token.includes('/')) return null
    const original = decodeAssetPath(token)
    if (original == null || !original.toLowerCase().endsWith('.gz')) return null
    return `${original}${suffix}`
  }

  // Preserve compatibility with source tabs opened before the extensionless
  // route was introduced. New transforms never emit this form.
  if (!pathname.toLowerCase().endsWith(compressedAssetBrowserSuffix)) return null
  return `${pathname.slice(0, -compressedAssetBrowserSuffix.length)}.gz${suffix}`
}

export function parseSingleByteRange(header, size) {
  if (header == null) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (match == null) return null
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
  ) return null
  return { start, end: Math.min(end, size - 1) }
}

function transformGzipUrlModule(code, id) {
  if (!/\.gz(?:\?|$)/i.test(id)) return null
  const match = code.match(/^export default (["'])([^"']+\.gz(?:[?#][^"']*)?)\1;?/m)
  if (!match) return null
  const safeUrl = toBrowserSafeCompressedAssetUrl(match[2])
  return {
    code: code.replace(match[0], `export default ${JSON.stringify(safeUrl)}`),
    map: null,
  }
}

export function magiusCompressedAssetProxyPlugin() {
  const configure = server => {
      const root = path.resolve(server.config.root)
      const localVoiceRoot = localVoiceSourceRoot(root)
      server.middlewares.use((request, response, next) => {
        const requestUrl = request.url ?? '/'
        const parsed = new URL(requestUrl, 'http://127.0.0.1')
        // The large stages corpus is deliberately excluded from Vite's watcher.
        // Resolve these files at request time: newly integrated profiles/textures
        // must not depend on Vite's startup public-file snapshot or SPA fallback.
        if (parsed.pathname.startsWith('/stages/') && server.config.publicDir !== false) {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed')
            return
          }
          const stageRoot = path.resolve(server.config.publicDir || path.join(root, 'public'), 'stages')
          let relative
          try {
            relative = decodeURIComponent(parsed.pathname.slice('/stages/'.length))
          } catch {
            response.writeHead(400).end('Malformed stage asset URL')
            return
          }
          const file = path.resolve(stageRoot, relative)
          const bounded = path.relative(stageRoot, file)
          if (bounded.startsWith('..') || path.isAbsolute(bounded)) {
            response.writeHead(403).end('Invalid stage asset path')
            return
          }
          if (!existsSync(file) || !statSync(file).isFile()) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Local stage asset not found')
            return
          }
          const stat = statSync(file)
          const mime = {
            '.json': 'application/json; charset=utf-8', '.png': 'image/png',
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
            '.ktx2': 'image/ktx2',
          }[path.extname(file).toLowerCase()] || 'application/octet-stream'
          const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`
          const headers = {
            'Content-Type': mime, 'Content-Disposition': 'inline',
            'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes',
            'X-Content-Type-Options': 'nosniff', 'X-Magius-Local-Stage': '1',
            ETag: etag, 'Last-Modified': stat.mtime.toUTCString(),
          }
          const matches = String(request.headers['if-none-match'] ?? '').split(',').map(value => value.trim())
          if (matches.includes(etag) || matches.includes('*')) {
            response.writeHead(304, headers).end()
            return
          }
          const ifRange = request.headers['if-range']
          const range = parseSingleByteRange(
            ifRange != null && ifRange !== headers['Last-Modified'] ? undefined : request.headers.range,
            stat.size,
          )
          if (range === null) {
            response.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }).end()
            return
          }
          response.writeHead(range ? 206 : 200, {
            ...headers, 'Content-Length': String(range ? range.end - range.start + 1 : stat.size),
            ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}` } : {}),
          })
          if (request.method === 'HEAD') response.end()
          else createReadStream(file, range).on('error', error => response.destroy(error)).pipe(response)
          return
        }
        // Byte delivery for application-owned decoding. Neither a downloadable
        // filename nor a browser media response is exposed on this route.
        const voicePayload = parsed.pathname.startsWith(localVoicePayloadPrefix)
        const payloadIdentity = voicePayload
          ? parsed.pathname.slice(localVoicePayloadPrefix.length) : null
        const voicePathname = voicePayload
          ? (/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(payloadIdentity ?? '')
            ? `${localVoiceRoutePrefix}${payloadIdentity}.ogg` : '')
          : parsed.pathname

        // Project-owned source supplements travel with this checkout. Keep
        // shared legacy resources read-only and resolve the same exact cue.
        const localVoicePath = [
          localVoiceFilePath(path.join(root, 'public', 'voice', 'Cv'), voicePathname),
          localVoiceFilePath(localVoiceRoot, voicePathname),
        ].find(file => file != null && existsSync(file) && statSync(file).isFile())
        if (voicePayload || parsed.pathname.startsWith(localVoiceRoutePrefix)) {
          const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, If-Range, If-None-Match',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified',
          }
          if (request.method === 'OPTIONS') {
            response.writeHead(204, corsHeaders).end()
            return
          }
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { ...corsHeaders, Allow: 'GET, HEAD, OPTIONS' }).end('Method not allowed')
            return
          }
          // Never delegate a missing voice to Vite's index.html fallback.
          if (localVoicePath == null || !existsSync(localVoicePath) || !statSync(localVoicePath).isFile()) {
            response.writeHead(404, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' }).end('Local voice not found')
            return
          }
          const stat = statSync(localVoicePath)
          const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`
          const commonHeaders = {
            ...corsHeaders,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
            'Content-Disposition': 'inline',
            'Content-Type': voicePayload ? 'application/vnd.magius.voice-payload' : 'audio/ogg',
            'X-Content-Type-Options': 'nosniff',
            ETag: etag,
            'Last-Modified': stat.mtime.toUTCString(),
            'X-Magius-Local-Voice': '1',
          }
          const matches = String(request.headers['if-none-match'] ?? '').split(',').map(value => value.trim())
          if (matches.includes(etag) || matches.includes('*')) {
            response.writeHead(304, commonHeaders).end()
            return
          }
          // Our stat validator is weak, so If-Range accepts the last-modified
          // date only. A stale/weak validator gets the entire representation.
          const ifRange = request.headers['if-range']
          const rangeHeader = ifRange != null && ifRange !== commonHeaders['Last-Modified']
            ? undefined : request.headers.range
          const range = parseSingleByteRange(rangeHeader, stat.size)
          if (range === null) {
            response.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${stat.size}` }).end()
            return
          }
          response.writeHead(range ? 206 : 200, {
            ...commonHeaders,
            'Content-Length': String(range ? range.end - range.start + 1 : stat.size),
            ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}` } : {}),
          })
          if (request.method === 'HEAD') response.end()
          else createReadStream(localVoicePath, range).on('error', error => response.destroy(error)).pipe(response)
          return
        }

        const originalPathname = fromBrowserSafeCompressedAssetUrl(parsed.pathname)
        if (originalPathname == null) return next()
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed')
          return
        }

        let decodedPathname
        try {
          decodedPathname = decodeURIComponent(originalPathname)
        } catch {
          response.statusCode = 400
          response.end('Malformed compressed asset URL')
          return
        }

        const absolutePath = path.resolve(root, `.${decodedPathname}`)
        const relativePath = path.relative(root, absolutePath)
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
          response.statusCode = 403
          response.end('Compressed asset path is outside the Vite root')
          return
        }
        if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
          response.statusCode = 404
          response.end('Compressed asset not found')
          return
        }

        const stat = statSync(absolutePath)
        const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`
        const commonHeaders = {
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
          'Content-Disposition': 'inline',
          'Content-Type': 'application/x-magius-compressed-asset',
          ETag: etag,
          'Last-Modified': stat.mtime.toUTCString(),
          'X-Magius-Asset-Identity': encodeURIComponent(originalPathname),
          'X-Magius-Source-Suffix': 'gzip',
        }
        if (request.headers['if-none-match'] === etag && request.headers.range == null) {
          response.writeHead(304, commonHeaders).end()
          return
        }

        const range = parseSingleByteRange(request.headers.range, stat.size)
        if (range === null) {
          response.writeHead(416, {
            ...commonHeaders,
            'Content-Range': `bytes */${stat.size}`,
          }).end()
          return
        }
        if (range == null) {
          response.writeHead(200, {
            ...commonHeaders,
            'Content-Length': String(stat.size),
          })
          if (request.method === 'HEAD') response.end()
          else createReadStream(absolutePath).pipe(response)
          return
        }

        response.writeHead(206, {
          ...commonHeaders,
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        })
        if (request.method === 'HEAD') response.end()
        else createReadStream(absolutePath, range).pipe(response)
      })
  }
  return {
    name: 'magius-compressed-asset-browser-url',
    apply: 'serve',
    enforce: 'post',
    transform: transformGzipUrlModule,
    configureServer: configure,
    configurePreviewServer: configure,
  }
}
