import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('static viewer shell is Simplified Chinese', async () => {
    const html = await read('./index.html')
    assert.match(html, /<html lang="zh-CN">/)
    assert.match(html, /选择角色模型/)
    assert.match(html, /选择 3D 场景/)
    assert.match(html, /Magius3Dviewer 正在加载官方风格着色器与角色模型/)
    assert.match(html, /从本地相册选择/)
    assert.match(html, /<button id="camera-save-download">下载<\/button>/)
})

test('dynamic lil-gui and stage labels use DOM-only localization', async () => {
    const localization = await read('./src/viewer/localization/zhCN.ts')
    const main = await read('./src/main.ts')

    for (const expected of [
        "'3D Stage': '3D 场景'",
        "'Stage Runtime': '场景运行时'",
        "'Shader': '着色器（Shader）'",
        "'AngelRing (official GLES projection)': '天使环（AngelRing，官方 GLES 投影）'",
        "'AntiAliasing(Composer)': '抗锯齿（后期合成器）'",
        "'Characters (Global)': '角色（全局）'",
    ]) {
        assert.ok(localization.includes(expected), `missing localization: ${expected}`)
    }

    assert.match(localization, /lil-gui uses controller\/folder names as preset keys/)
    assert.match(localization, /MutationObserver/)
    assert.match(main, /installZhCnUi\(\)[\s\S]*setupViewer\(\)/)
})

test('preset and runtime messages exposed to users are translated', async () => {
    const presets = await read('./src/viewer/controllers/presets.ts')
    const viewer = await read('./src/viewer/index.ts')
    const shots = await read('./src/viewer/camera/shots.ts')

    assert.match(presets, /是否导入包含 \$\{total\} 个角色的预设/)
    assert.match(presets, /预设内容无效/)
    assert.match(viewer, /translateUiText\(text\)/)
    assert.match(viewer, /< 请选择要添加的角色 >/)
    assert.match(shots, /拍照失败/)
})
