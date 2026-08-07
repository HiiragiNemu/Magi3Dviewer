import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import ts from 'typescript'

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const nonce = `${process.pid}-${Date.now()}`
const sourcePath = join(
    repositoryRoot,
    'src',
    'viewer',
    'stageParticleRuntime.ts',
)
const runtimePath = join(
    repositoryRoot,
    `.stage-particle-runtime-profile-${nonce}.mjs`,
)
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
})
writeFileSync(runtimePath, compiled.outputText, 'utf8')
const particleRuntime = await import(pathToFileURL(runtimePath).href)

after(() => rmSync(runtimePath, { force: true }))

test('608 bubble profile pins exact current-JP bounded evidence', () => {
    const profile = particleRuntime.OFFICIAL_608_BUBBLE_PROFILE
    assert.equal(profile.source, 'official-jp-current-assetbundle')
    assert.equal(profile.assetBundleRevision, '61ad830ca038a9efd58e67170a61c85e')
    assert.equal(profile.fidelity, 'serialized-parameter-driven-approximation')
    assert.equal(profile.textureName, 'bg3d608_00_blue_bubble_col')
    assert.deepEqual(profile.textureSize, [32, 128])
    assert.equal(
        profile.texturePixelSha256,
        '57fe4cf6e45c3061955dae3bfd8d923837a275085fa1678ada13f6f1d3471f1e',
    )
    assert.deepEqual(profile.material, {
        name: 'bg3d608_00_blue_bubble',
        renderQueue: 3000,
        srcBlend: 5,
        dstBlend: 10,
        zWrite: 0,
        baseColor: [
            0.8773584961891174,
            0.8773584961891174,
            0.8773584961891174,
            1,
        ],
    })
    assert.equal(profile.duration, 5)
    assert.equal(profile.simulationSpeed, 0.30000001192092896)
    assert.equal(profile.maxParticles, 50)
    assert.deepEqual(profile.startSpeed, [1, 2])
    assert.deepEqual(profile.startSize, [0.5, 2])
    assert.equal(profile.gravityModifier, -0.10000000149011612)
    assert.deepEqual(profile.emissionRate, [0.75, 2])
    assert.deepEqual(profile.textureSheet, {
        columns: 1,
        rows: 4,
        fps: 2,
        timeMode: 2,
        animationType: 1,
    })
    assert.equal(profile.systems.length, 6)
    assert.deepEqual(
        profile.systems.map(system => system.pathId),
        [
            '-6858687396393823220',
            '-7586315711235274196',
            '1198205605091357490',
            '1996371953391616376',
            '-1294285691191015837',
            '5963673205634448717',
        ],
    )
    profile.systems.forEach(system => {
        assert.equal(typeof system.pathId, 'string')
        assert.deepEqual(
            system.rotation,
            [-0.7071068286895752, 0, 0, 0.7071068286895752],
        )
    })
    assert.ok(profile.deferred.some(item => item.includes('autoRandomSeed/RNG parity')))
    assert.ok(profile.deferred.some(item => item.includes('cone emission sampling')))
})

test('608 decoded bubble PNG is byte-pinned and remains 32x128', () => {
    const pngPath = join(
        repositoryRoot,
        'public',
        'stages',
        'official',
        'battle-608-00-00-001',
        'bg3d608_00_blue_bubble_col.png',
    )
    const png = readFileSync(pngPath)
    assert.equal(
        createHash('sha256').update(png).digest('hex'),
        '6ca50ebbd85f6325ce1447b75bcd5f48761583c7432bb5c3ef9d01724ce8c5b4',
    )
    assert.deepEqual(
        [...png.subarray(0, 8)],
        [137, 80, 78, 71, 13, 10, 26, 10],
    )
    assert.equal(png.readUInt32BE(16), 32)
    assert.equal(png.readUInt32BE(20), 128)
})
