import fs from 'node:fs'
import path from 'node:path'

export const SOURCE_AUTHORITY_FIXTURE_MANIFEST_ENV = 'MAGIUS_SOURCE_AUTHORITY_FIXTURE_MANIFEST'

function fail(code) {
    throw new Error(`SOURCE_AUTHORITY_FIXTURE_${code}`)
}

function relativeCopyPath(value) {
    if (typeof value !== 'string' || !value || /[\\:\0]/.test(value)
        || value.split('/').some(part => !part || part === '.' || part === '..')) {
        fail('INVALID_COPY_PATH')
    }
    return value
}

function inside(root, candidate) {
    const relative = path.relative(root, candidate)
    return relative !== '' && !path.isAbsolute(relative)
        && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

// Only explicitly bound test reads use this resolver; production/fs behavior is untouched.
export function createSourceAuthorityFixtureResolver(
    manifestPath = process.env[SOURCE_AUTHORITY_FIXTURE_MANIFEST_ENV],
) {
    if (manifestPath === undefined) return request => request
    if (typeof manifestPath !== 'string' || !manifestPath.trim()) fail('INVALID_MANIFEST_PATH')
    const absoluteManifest = path.resolve(manifestPath)
    let manifest
    try {
        manifest = JSON.parse(fs.readFileSync(absoluteManifest, 'utf8'))
    } catch {
        fail('MANIFEST_UNREADABLE')
    }
    if (manifest?.schema !== 'magius.source-authority-fixtures.v1'
        || !Array.isArray(manifest.entries)) fail('INVALID_MANIFEST')
    const copyRoot = path.resolve(path.dirname(absoluteManifest), relativeCopyPath(manifest.copyRoot))
    let realCopyRoot
    try {
        if (!fs.statSync(copyRoot).isDirectory()) fail('COPY_ROOT_UNAVAILABLE')
        realCopyRoot = fs.realpathSync(copyRoot)
    } catch {
        fail('COPY_ROOT_UNAVAILABLE')
    }
    if (!inside(fs.realpathSync(path.dirname(absoluteManifest)), realCopyRoot)) fail('COPY_ROOT_ESCAPE')
    const entries = new Map()
    const destinations = new Set()
    for (const entry of manifest.entries) {
        if (!entry || typeof entry.requestKey !== 'string' || !entry.requestKey
            || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
            || entry.byteExact !== true) fail('INVALID_ENTRY')
        const copyPath = relativeCopyPath(entry.copyPath)
        const destination = path.resolve(copyRoot, copyPath)
        const destinationKey = process.platform === 'win32' ? destination.toLowerCase() : destination
        if (entries.has(entry.requestKey) || destinations.has(destinationKey)) fail('DUPLICATE_MAPPING')
        entries.set(entry.requestKey, { destination, bytes: entry.bytes })
        destinations.add(destinationKey)
    }
    return request => {
        const key = request instanceof URL ? request.href : request
        const entry = entries.get(key)
        if (!entry) fail('MAPPING_MISSING')
        let realPath
        let stat
        try {
            realPath = fs.realpathSync(entry.destination)
            stat = fs.statSync(realPath)
        } catch {
            fail('COPY_UNAVAILABLE')
        }
        if (!inside(realCopyRoot, realPath)) fail('COPY_PATH_ESCAPE')
        if (!stat.isFile()) fail('COPY_NOT_FILE')
        if (stat.size !== entry.bytes) fail('COPY_SIZE_MISMATCH')
        return realPath
    }
}
