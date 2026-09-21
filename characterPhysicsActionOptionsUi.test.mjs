import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('physics action options manifest keeps four exact phases and six data-driven Viewer actions', async () => {
    const manifest = JSON.parse(await read('./public/character-physics/action-options.v1.json'))
    assert.equal(manifest.schema, 'magius.character-physics-action-options.v1')
    assert.equal(manifest.lookupKey, 'characterResourceId+phaseStableKey')
    assert.equal(manifest.entries.length, 4)
    assert.equal(new Set(manifest.entries.map(entry => entry.stableKey)).size, 4)
    assert.ok(manifest.entries.every(entry => entry.optionValue === entry.stableKey))
    assert.ok(manifest.entries.every(entry => entry.availability.sourceStatus === 'source-ready'))
    assert.ok(manifest.entries.every(entry => entry.availability.bindingStatus === 'runtime-ready'))
    assert.ok(manifest.entries.every(entry => entry.availability.playbackStatus === 'consumer-pending'))

    assert.equal(manifest.viewerActionOptions.length, 6)
    assert.equal(manifest.viewerActionOptions.filter(entry => entry.availability.status === 'source-available').length, 5)
    const unavailable = manifest.viewerActionOptions.filter(entry => entry.availability.status === 'unavailable')
    assert.equal(unavailable.length, 1)
    assert.ok(unavailable[0].availability.reason)
    assert.ok(manifest.viewerActionOptions.every(entry => entry.phaseBindingRelation === 'character-identity-only-no-phase-inference'))
})

test('action parameter panel activates exact phase stable keys through the action-owned root provider', async () => {
    const html = await read('./index.html')
    const ui = await read('./src/viewer/characterPhysicsActionOptionsUi.ts')
    const viewer = await read('./src/viewer/index.ts')

    for (const id of [
        'character-physics-action-options',
        'character-physics-action-options-status',
        'character-physics-phase-list',
        'character-physics-related-action-list',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `missing physics action UI: ${id}`)
    }
    assert.match(html, /Physics action options/)
    assert.match(html, /Physics phases/)
    assert.match(html, /Related official actions/)

    assert.match(ui, /new CharacterPhysicsActionOptionsClient\(\)/)
    assert.match(ui, /from '\.\/characterPhysics\/actionOptions'/)
    assert.match(ui, /entry\.character\.characterResourceId === characterResourceId/)
    assert.match(ui, /entry\.characterResourceId === characterResourceId/)
    assert.match(ui, /row\.dataset\.phaseStableKey = phase\.stableKey/)
    assert.match(ui, /await runtime\.activatePhase\(phase\.stableKey\)/)
    assert.match(ui, /runtime\.physicsPhaseState\(\)/)
    assert.match(ui, /activePhaseLease\?\.dispose\(\)/)
    assert.match(ui, /phaseState\.phaseRootSource/)
    assert.doesNotMatch(ui, /phase\.availability\.failClosedReasons/)
    assert.match(ui, /entry\.availability\.status === 'unavailable'/)
    assert.match(ui, /reason\.textContent = availability\.reason/)
    assert.match(ui, /play\.disabled = !availability\.playable/)
    assert.match(ui, /await runtime\.playAction\(entry\.actionId\)/)
    assert.doesNotMatch(ui, /\b(?:113701|113801)\b/)
    assert.doesNotMatch(ui, /new THREE\.|registerPhysicsPhaseRoot|createNativeCharacterPhysics|registerCharacterPhysicsActionPhaseBindings/)

    assert.match(viewer, /activatePhase: stableKey => characterActionsApi\(\)\.activatePhysicsPhase\(stableKey\)/)
    assert.match(viewer, /physicsPhaseState: \(\) => characterActionsApi\(\)\.physicsPhaseState\(\)/)
    assert.match(viewer, /playAction: playCharacterPhysicsRelatedAction/)
    assert.match(viewer, /candidate\.dataset\.characterAction === 'true' && candidate\.value === actionId/)
    assert.match(viewer, /animationSelector\.value = actionId\s+await onAnimationSelectionChanged\(\)/)
    assert.match(viewer, /characterPhysicsActionOptionsUi\?\.refresh\(\)/)
})

test('physics action option rows are compact, scroll with the existing panel and localize in all UI languages', async () => {
    const css = await read('./src/viewer/style/panels.css')
    const zh = await read('./src/viewer/localization/zhCN.ts')
    const ja = await read('./src/viewer/localization/jaJP.ts')

    assert.match(css, /\.character-physics-action-options-body\s*\{[^}]*display:\s*grid/)
    assert.match(css, /\.character-physics-option-row\s*\{[^}]*display:\s*flex/)
    assert.match(css, /\.character-physics-phase-row button:disabled,[\s\S]*\.character-physics-related-action-row button:disabled\s*\{[^}]*opacity:/)
    assert.match(css, /\.character-physics-option-row\.is-active\s*\{[^}]*border-color:/)
    assert.match(css, /body\.theme-light \.character-physics-option-row/)
    assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.character-physics-action-options-body\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/)

    for (const key of [
        'Physics action options',
        'Loading physics action options...',
        'Physics phases',
        'Related official actions',
        'Awaiting official action phase consumer',
        'Activate phase',
        'Phase active',
        'Release phase',
        'Activating physics phase...',
        'Physics phase active',
        'Action-owned phase root',
        'External phase root',
        'Ready for active official action',
        'Play an official action before activating this phase',
        'Physics action options unavailable',
    ]) {
        assert.match(zh, new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*:`))
        assert.match(ja, new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*:`))
    }
})
