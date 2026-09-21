import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('SMAA is the sharp shared default and activates the composer in Auto mode', async () => {
    const effects = await read('./magia-exedra-character-three/scene/effects.ts')
    const scene = await read('./magia-exedra-character-three/scene/index.ts')
    const gui = await read('./src/viewer/controllers/GUI.ts')
    const guiMisc = await read('./src/viewer/controllers/GUIMisc.ts')

    assert.match(
        effects,
        /defaultSceneComposerAntiAliasing:\s*SceneComposerAntiAliasing\s*=\s*'SMAA'/,
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
    assert.match(scene, /preserveDrawingBuffer:\s*false/)
    assert.doesNotMatch(scene, /createRenderer\(\{[\s\S]*antialias:\s*true/)
    assert.doesNotMatch(scene, /preserveDrawingBuffer:\s*true/)
    assert.match(
        scene,
        /captureForegroundFrame\([\s\S]*renderer\.render\(this\.scene, this\.camera\)[\s\S]*copy\(renderer\.domElement\)/,
    )
})

test('interactive rendering preserves the native device scale and explicit render scaling', async () => {
    const scene = await read('./magia-exedra-character-three/scene/index.ts')

    assert.match(
        scene,
        /return window\.devicePixelRatio \* this\.pixelRatio/,
    )
    assert.doesNotMatch(
        scene,
        /maxInteractiveDevicePixelRatio|Math\.min\(\s*window\.devicePixelRatio/,
        'native device resolution must not be silently capped',
    )
})

test('hidden or unfocused viewer documents stop every animation, shadow and postprocess pass', async () => {
    const renderer = await read('./magia-exedra-character-three/renderer.ts')

    assert.match(renderer, /document\.addEventListener\('visibilitychange'/)
    assert.match(
        renderer,
        /pageVisibilityPaused = document\.visibilityState === 'hidden'/,
    )
    assert.match(
        renderer,
        /clockDelta = clock\.getDelta\(\)[\s\S]*if \(renderPaused \|\| pageVisibilityPaused \|\| pageFocusPaused\) return[\s\S]*animationLoops\.forEach/,
    )
    assert.match(renderer, /window\.addEventListener\('blur'[\s\S]*pageFocusPaused = true/)
    assert.match(renderer, /window\.addEventListener\('focus'[\s\S]*pageFocusPaused = false/)
    assert.match(renderer, /effectivePaused:[\s\S]*pageFocusPaused/)
    assert.match(renderer, /getRenderPauseState/)
    assert.doesNotMatch(renderer, /document\.hasFocus\(\)/)
})

test('all explicit anti-aliasing modes remain selectable', async () => {
    const effects = await read('./magia-exedra-character-three/scene/effects.ts')
    const guiMisc = await read('./src/viewer/controllers/GUIMisc.ts')

    for (const mode of ['None', 'MSAA', 'TAA', 'SSAA', 'SMAA', 'FXAA']) {
        assert.ok(effects.includes(`'${mode}'`), `missing effects mode ${mode}`)
        assert.ok(guiMisc.includes(`'${mode}'`), `missing GUI mode ${mode}`)
    }
})

test('texture-unit diagnostics snapshot programs without wrapping per-draw GL calls', async () => {
    const scene = await read('./magia-exedra-character-three/scene/index.ts')

    assert.doesNotMatch(scene, /gl\.uniform1i\s*=/)
    assert.doesNotMatch(scene, /gl\.uniform1iv\s*=/)
    assert.doesNotMatch(scene, /gl\.getUniformLocation\s*=/)
    assert.match(scene, /nextVisualDiagnosticAt\s*=\s*timestamp\s*\+\s*5000/)
    assert.match(scene, /reDriveTextureUnitDiagnosticMode\s*=\s*\n?\s*'periodic-program-snapshot'/)
    assert.match(scene, /textureUnitAssignments\.clear\(\)/)
    assert.match(scene, /gl\.getUniform\(program\.program, location\)/)
})
