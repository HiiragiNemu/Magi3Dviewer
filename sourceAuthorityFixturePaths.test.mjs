import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import {
    createSourceAuthorityFixtureResolver,
    SOURCE_AUTHORITY_FIXTURE_MANIFEST_ENV,
} from './tests/helpers/sourceAuthorityFixturePaths.mjs'

function fixture(t) {
    const base = path.resolve('artifacts/verification/20260905-s6-isolated-test-authority-bindings/focused-fixtures')
    fs.mkdirSync(base, { recursive: true })
    const root = fs.mkdtempSync(path.join(base, 'case-'))
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(base))
        assert.match(path.basename(root), /^case-/)
        fs.rmSync(root, { recursive: true, force: true })
    })
    fs.mkdirSync(path.join(root, 'fixtures'))
    const original = path.join(root, 'original.ogg')
    const copy = path.join(root, 'fixtures', 'sealed.ogg')
    fs.writeFileSync(original, 'OggSfixture')
    fs.copyFileSync(original, copy)
    const entry = {
        requestKey: pathToFileURL(original).href,
        copyPath: 'sealed.ogg', bytes: 11, byteExact: true,
    }
    const manifest = { schema: 'magius.source-authority-fixtures.v1', copyRoot: 'fixtures', entries: [entry] }
    const manifestPath = path.join(root, 'manifest.json')
    const write = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    write()
    return { root, original, copy, entry, manifest, manifestPath, write }
}

test('default mode returns the exact original string and URL object unchanged', () => {
    const helperUrl = new URL('./tests/helpers/sourceAuthorityFixturePaths.mjs', import.meta.url).href
    const env = { ...process.env }
    delete env[SOURCE_AUTHORITY_FIXTURE_MANIFEST_ENV]
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { createSourceAuthorityFixtureResolver } from ${JSON.stringify(helperUrl)};
        const resolve = createSourceAuthorityFixtureResolver();
        const url = new URL('file:///missing/original.ogg');
        assert.equal(resolve(url), url);
        assert.equal(resolve('../magi-reader/authority.woff2'), '../magi-reader/authority.woff2');
        assert.equal(resolve('D:/magia/FOT/Font/test.ttf'), 'D:/magia/FOT/Font/test.ttf');
    `], { env, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
})

test('explicit mapping uses the sealed copy even after original removal', t => {
    const f = fixture(t)
    fs.unlinkSync(f.original)
    const resolve = createSourceAuthorityFixtureResolver(f.manifestPath)
    assert.equal(resolve(new URL(f.entry.requestKey)), fs.realpathSync(f.copy))
    assert.equal(resolve(f.entry.requestKey), fs.realpathSync(f.copy))
    assert.equal(fs.readFileSync(resolve(f.entry.requestKey), 'utf8'), 'OggSfixture')
})

test('missing exact mapping fails rather than reading an existing original', t => {
    const f = fixture(t)
    f.manifest.entries = []; f.write()
    assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath)(f.entry.requestKey), /MAPPING_MISSING/)
})

test('missing sealed file fails with original still available', t => {
    const f = fixture(t)
    fs.unlinkSync(f.copy)
    assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath)(f.entry.requestKey), /COPY_UNAVAILABLE/)
})

test('copy size drift and non-file destinations fail closed', t => {
    const f = fixture(t)
    fs.writeFileSync(f.copy, 'short')
    assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath)(f.entry.requestKey), /COPY_SIZE_MISMATCH/)
    fs.unlinkSync(f.copy); fs.mkdirSync(f.copy)
    assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath)(f.entry.requestKey), /COPY_NOT_FILE/)
})

test('absolute, traversing, empty and platform-ambiguous copy paths are rejected', t => {
    const f = fixture(t)
    for (const copyPath of ['../original.ogg', '/original.ogg', 'D:/original.ogg', 'sub\\original.ogg', 'sub/../original.ogg', '', './sealed.ogg']) {
        f.entry.copyPath = copyPath; f.write()
        assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath), /INVALID_COPY_PATH/)
    }
})

test('invalid root and missing root fail before resolving any input', t => {
    const f = fixture(t)
    f.manifest.copyRoot = '../fixtures'; f.write()
    assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath), /INVALID_COPY_PATH/)
    f.manifest.copyRoot = 'missing'; f.write()
    assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath), /COPY_ROOT_UNAVAILABLE/)
})

test('symlinked directory escape is rejected within the declared fixture root', t => {
    const f = fixture(t)
    const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'sealed.ogg'), 'OggSfixture')
    fs.symlinkSync(outside, path.join(f.root, 'fixtures', 'redirect'), 'junction')
    f.entry.copyPath = 'redirect/sealed.ogg'; f.write()
    assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath)(f.entry.requestKey), /COPY_PATH_ESCAPE/)
})

test('malformed manifest, unsealed entries and duplicate keys/destinations are rejected', t => {
    const f = fixture(t)
    fs.writeFileSync(f.manifestPath, '{')
    assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath), /MANIFEST_UNREADABLE/)
    f.manifest.schema = 'wrong'; f.write()
    assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath), /INVALID_MANIFEST/)
    f.manifest.schema = 'magius.source-authority-fixtures.v1'
    f.entry.byteExact = false; f.write()
    assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath), /INVALID_ENTRY/)
    f.entry.byteExact = true
    f.manifest.entries.push({ ...f.entry }); f.write()
    assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath), /DUPLICATE_MAPPING/)
    f.manifest.entries[1].requestKey = 'different-key'; f.write()
    assert.throws(() => createSourceAuthorityFixtureResolver(f.manifestPath), /DUPLICATE_MAPPING/)
})

test('an explicitly empty or unavailable manifest never falls back to originals', t => {
    const f = fixture(t)
    assert.throws(() => createSourceAuthorityFixtureResolver(''), /INVALID_MANIFEST_PATH/)
    assert.throws(() => createSourceAuthorityFixtureResolver(path.join(f.root, 'absent.json')), /MANIFEST_UNREADABLE/)
})

test('environment enables only this resolver and an explicit manifest overrides the environment', t => {
    const f = fixture(t)
    const helperUrl = new URL('./tests/helpers/sourceAuthorityFixturePaths.mjs', import.meta.url).href
    const code = `
        import assert from 'node:assert/strict'; import fs from 'node:fs';
        import { createSourceAuthorityFixtureResolver } from ${JSON.stringify(helperUrl)};
        const key = ${JSON.stringify(f.entry.requestKey)};
        const originalRead = fs.readFileSync;
        assert.equal(createSourceAuthorityFixtureResolver()(key), fs.realpathSync(${JSON.stringify(f.copy)}));
        assert.equal(fs.readFileSync, originalRead);
        process.env.${SOURCE_AUTHORITY_FIXTURE_MANIFEST_ENV} = 'missing-env-manifest.json';
        assert.throws(() => createSourceAuthorityFixtureResolver(), /MANIFEST_UNREADABLE/);
        assert.equal(createSourceAuthorityFixtureResolver(${JSON.stringify(f.manifestPath)})(key), fs.realpathSync(${JSON.stringify(f.copy)}));
    `
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        env: { ...process.env, [SOURCE_AUTHORITY_FIXTURE_MANIFEST_ENV]: f.manifestPath }, encoding: 'utf8',
    })
    assert.equal(run.status, 0, run.stderr)
})
