import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('static viewer shell keeps canonical English keys and exposes a language toggle', async () => {
    const html = await read('./index.html')
    assert.match(html, /<html lang="en">/)
    assert.match(html, /id="language-toggle"/)
    assert.match(html, /data-i18n-ignore="true"/)
    assert.match(html, /Choose model/)
    assert.match(html, /Choose 3D stage/)
    assert.match(html, /Magius3Dviewer is loading the official-style shader/)
    assert.match(html, /<button id="camera-save-download">Download<\/button>/)
})

test('runtime localization supports persistent English and Simplified Chinese switching', async () => {
    const localization = await read('./src/viewer/localization/zhCN.ts')
    const main = await read('./src/main.ts')

    for (const expected of [
        "export type UiLocale = 'en' | 'zh-CN'",
        "'3D Stage': '3D 场景'",
        "'Stage Runtime': '场景运行时'",
        "'Shader': '着色器（Shader）'",
        "'AngelRing (official GLES projection)': '天使环（AngelRing，官方 GLES 投影）'",
        "'AntiAliasing(Composer)': '抗锯齿（后期合成器）'",
        "'Characters (Global)': '角色（全局）'",
        "'Photo capture failed': '拍照失败'",
    ]) {
        assert.ok(localization.includes(expected), `missing localization: ${expected}`)
    }

    assert.match(localization, /English remains the canonical UI key/)
    assert.match(localization, /localStorage\.setItem\(LOCALE_STORAGE_KEY, locale\)/)
    assert.match(localization, /navigator\.languages/)
    assert.match(localization, /MutationObserver/)
    assert.match(localization, /element\.getAttribute\(attribute\) !== translated/)
    assert.match(localization, /document\.dispatchEvent\(new CustomEvent\('magius:localechange'/)
    assert.match(main, /installLocalization\(\)[\s\S]*setupViewer\(\)/)
})

test('dialogs, selectors, tooltips and alerts use canonical English plus runtime translation', async () => {
    const presets = await read('./src/viewer/controllers/presets.ts')
    const viewer = await read('./src/viewer/index.ts')
    const shots = await read('./src/viewer/camera/shots.ts')
    const gui = await read('./src/viewer/controllers/GUI.ts')
    const guiCharacter = await read('./src/viewer/controllers/GUICharacter.ts')
    const guiMisc = await read('./src/viewer/controllers/GUIMisc.ts')

    assert.match(presets, /translateUiText\(`Import preset with \$\{total\} characters\?`\)/)
    assert.match(presets, /translateUiText\('Invalid preset content'\)/)
    assert.match(viewer, /< Select a character to add >/)
    assert.match(viewer, /<No animation>/)
    assert.match(viewer, /magius:localechange/)
    assert.match(shots, /translateUiText\('Photo capture failed'\)/)
    assert.match(gui, /translateUiText\('Copied to clipboard!'\)/)
    assert.match(guiCharacter, /Show outline even when mesh is hidden/)
    assert.match(guiMisc, /Auto: Use effect composer only when needed/)
    assert.doesNotMatch(guiMisc, /自动：/)
})
