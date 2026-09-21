import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const combatVfx = readFileSync('src/viewer/combatVfx.ts', 'utf8')
const stages = readFileSync('src/viewer/stages.ts', 'utf8')

const between = (source, start, end) => {
    const from = source.indexOf(start)
    const to = source.indexOf(end, from)
    assert.ok(from >= 0, `missing start marker: ${start}`)
    assert.ok(to > from, `missing end marker after ${start}: ${end}`)
    return source.slice(from, to)
}

test('screen-track snapshot captures both Bloom carriers field-exact', () => {
    const contract = between(
        combatVfx,
        'interface CharacterVisualSnapshot',
        'interface ActiveInstance',
    )
    for (const field of [
        'bloomEnabled: boolean',
        'bloomStrength: number',
        'bloomRadius: number',
        'bloomThreshold: number',
        'urpBloomEnabled: boolean',
        'urpBloomIntensity: number',
        'urpBloomScatter: number',
        'urpBloomThreshold: number',
        'urpBloomClamp: number',
        'urpBloomMaxIterations: number',
        'urpBloomTint: THREE.Color',
    ]) assert.match(contract, new RegExp(field.replace('.', '\\.')))

    const capture = between(
        combatVfx,
        'function captureVisualState',
        'function updateCharacterUniforms',
    )
    assert.match(capture, /const bloom = scene\.effects\.bloomPass/)
    assert.match(capture, /const urpBloom = scene\.effects\.urpBloomPass/)
    assert.match(capture, /bloomEnabled: bloom\.enabled/)
    assert.match(capture, /bloomStrength: bloom\.strength/)
    assert.match(capture, /bloomRadius: bloom\.radius/)
    assert.match(capture, /bloomThreshold: bloom\.threshold/)
    assert.match(capture, /urpBloomEnabled: urpBloom\.enabled/)
    assert.match(capture, /urpBloomIntensity: urpBloom\.intensity/)
    assert.match(capture, /urpBloomScatter: urpBloom\.scatter/)
    assert.match(capture, /urpBloomThreshold: urpBloom\.threshold/)
    assert.match(capture, /urpBloomClamp: urpBloom\.clamp/)
    assert.match(capture, /urpBloomMaxIterations: urpBloom\.maxIterations/)
    assert.match(capture, /urpBloomTint: urpBloom\.tint\.clone\(\)/)
})

test('PostProcessBloomTrack selects exactly one baseline carrier', () => {
    assert.match(
        stages,
        /profile\.source === 'ReDriveVolume'[\s\S]*scene\.effects\.bloomPass\.enabled = false[\s\S]*const pass = scene\.effects\.urpBloomPass[\s\S]*pass\.enabled = profile\.bloom\.enabled/,
    )
    const apply = between(
        combatVfx,
        'function applyScreenTracks',
        'function restoreScreenTracks',
    )
    assert.match(apply, /scene\.effects\.bloomPass\.enabled = baseline\.bloomEnabled/)
    assert.match(apply, /scene\.effects\.urpBloomPass\.enabled = baseline\.urpBloomEnabled/)

    const bloomTrack = between(
        apply,
        "const bloomRows = weightedBehaviours(product, 'PostProcessBloomTrack', time)",
        'const lighting = weightedBehaviours',
    )
    assert.match(
        bloomTrack,
        /if \(baseline\.urpBloomEnabled\) \{[\s\S]*scene\.effects\.bloomPass\.enabled = false[\s\S]*scene\.effects\.urpBloomPass\.enabled = true[\s\S]*urpBloomPass\.threshold = weightedNumber\([\s\S]*'threshold',[\s\S]*0\.8[\s\S]*urpBloomPass\.intensity = weightedNumber\([\s\S]*'intensity',[\s\S]*1[\s\S]*urpBloomPass\.scatter = weightedNumber\([\s\S]*'scatter',[\s\S]*0\.7/,
    )
    assert.match(
        bloomTrack,
        /else \{[\s\S]*scene\.effects\.urpBloomPass\.enabled = false[\s\S]*scene\.effects\.bloomPass\.enabled = true[\s\S]*bloomPass\.threshold = weightedNumber\([\s\S]*'threshold',[\s\S]*0\.8[\s\S]*bloomPass\.strength = weightedNumber\([\s\S]*'intensity',[\s\S]*1[\s\S]*bloomPass\.radius = weightedNumber\([\s\S]*'scatter',[\s\S]*0\.7/,
    )
})

test('dual-carrier baseline fails before scene mutation and restore covers both', () => {
    const create = between(
        combatVfx,
        'function createInstance',
        'const root = createHierarchy(product)',
    )
    assert.match(create, /const snapshot = product\.timeline\.screenTracks\.length > 0/)
    assert.match(create, /snapshot\?\.bloomEnabled && snapshot\.urpBloomEnabled/)
    assert.match(
        create,
        /screen-track baseline has both generic and ReDrive URP Bloom enabled/,
    )

    const restore = between(
        combatVfx,
        'function restoreScreenTracks',
        'function createInstance',
    )
    for (const assignment of [
        /bloomPass\.enabled = state\.bloomEnabled/,
        /bloomPass\.strength = state\.bloomStrength/,
        /bloomPass\.radius = state\.bloomRadius/,
        /bloomPass\.threshold = state\.bloomThreshold/,
        /urpBloomPass\.enabled = state\.urpBloomEnabled/,
        /urpBloomPass\.intensity = state\.urpBloomIntensity/,
        /urpBloomPass\.scatter = state\.urpBloomScatter/,
        /urpBloomPass\.threshold = state\.urpBloomThreshold/,
        /urpBloomPass\.clamp = state\.urpBloomClamp/,
        /urpBloomPass\.maxIterations = state\.urpBloomMaxIterations/,
        /urpBloomPass\.tint\.copy\(state\.urpBloomTint\)/,
    ]) assert.match(restore, assignment)
})
