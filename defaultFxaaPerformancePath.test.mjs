import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('FXAA is the shared default and activates the composer in Auto mode', async () => {
    const effects = await read('./magia-exedra-character-three/scene/effects.ts')
    const scene = await read('./magia-exedra-character-three/scene/index.ts')
    const gui = await read('./src/viewer/controllers/GUI.ts')
    const guiMisc = await read('./src/viewer/controllers/GUIMisc.ts')

    assert.match(
        effects,
        /defaultSceneComposerAntiAliasing:\s*SceneComposerAntiAliasing\s*=\s*'FXAA'/,
    )
    assert.match(effects, /requestedAntiAliasing:[^=]+=\s*defaultSceneComposerAntiAliasing/)
    assert.match(effects, /effectiveAntiAliasing:[^=]+=\s*defaultSceneComposerAntiAliasing/)
    assert.match(effects, /this\._createComposer\(\)[\s\S]*this\.applyEffectiveAntiAliasing\(\)/)
    assert.match(scene, /this\.effects\.effectiveAntiAliasing\s*!==\s*'None'/)
    assert.match(gui, /AntiAliasing:\s*defaultSceneComposerAntiAliasing/)
    assert.match(guiMisc, /function updateAntiAliasing\(\)[\s\S]*updateAntiAliasing\(\)\s*\n/)
})

test('renderer avoids stacked implicit MSAA and requests the high-performance GPU', async () => {
    const scene = await read('./magia-exedra-character-three/scene/index.ts')

    assert.match(scene, /createRenderer\(\{[\s\S]*antialias:\s*false/)
    assert.match(scene, /powerPreference:\s*'high-performance'/)
    assert.doesNotMatch(scene, /createRenderer\(\{[\s\S]*antialias:\s*true/)
})

test('all explicit anti-aliasing modes remain selectable', async () => {
    const effects = await read('./magia-exedra-character-three/scene/effects.ts')
    const guiMisc = await read('./src/viewer/controllers/GUIMisc.ts')

    for (const mode of ['None', 'MSAA', 'TAA', 'SSAA', 'SMAA', 'FXAA']) {
        assert.ok(effects.includes(`'${mode}'`), `missing effects mode ${mode}`)
        assert.ok(guiMisc.includes(`'${mode}'`), `missing GUI mode ${mode}`)
    }
})
