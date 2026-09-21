import { assertReleaseEnemyCatalog } from './releaseCorpusTestSupport.mjs'
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

function readStaticStringMap(source, variableName) {
    const sourceFile = ts.createSourceFile(`${variableName}.ts`, source, ts.ScriptTarget.Latest, true)
    let result
    const visit = node => {
        if (
            ts.isVariableDeclaration(node)
            && ts.isIdentifier(node.name)
            && node.name.text === variableName
            && node.initializer
            && ts.isObjectLiteralExpression(node.initializer)
        ) {
            result = new Map()
            for (const property of node.initializer.properties) {
                if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) continue
                const key = ts.isStringLiteralLike(property.name) || ts.isIdentifier(property.name)
                    ? property.name.text
                    : undefined
                if (key !== undefined) result.set(key, property.initializer.text)
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    assert.ok(result, `missing static dictionary: ${variableName}`)
    return result
}

test('static viewer shell keeps canonical English keys and exposes a language toggle', async () => {
    const html = await read('./index.html')
    assert.match(html, /<html lang="en">/)
    assert.match(html, /<head>[\s\S]*<link rel="stylesheet" href="\.\/src\/style\.css" \/>[\s\S]*<\/head>/)
    assert.match(html, /id="language-toggle"/)
    assert.match(html, /data-i18n-ignore="true"/)
    const languageSelect = html.match(/<select id="language-toggle"[\s\S]*?<\/select>/)?.[0] ?? ''
    assert.match(languageSelect, /<option value="zh-CN">简中<\/option>[\s\S]*<option value="ja-JP">日本語<\/option>[\s\S]*<option value="en">EN<\/option>/)
    assert.match(html, /Choose model/)
    assert.match(html, /Choose 3D stage/)
    assert.match(html, /Magius3Dviewer is loading the official-style shader/)
    assert.match(html, /id="menu-collapse-toggle"/)
    assert.match(html, /id="menu-collapse-toggle"[^>]*data-i18n-ignore="true"/)
    assert.match(html, /id="render-settings-toggle"[^>]*data-i18n-ignore="true"/)
    assert.match(html, /id="position-controls-toggle"[^>]*data-i18n-ignore="true"/)
    assert.match(html, /id="enemy-panel-toggle"[^>]*data-i18n-ignore="true"/)
    assert.match(html, /id="voice-panel-toggle"[^>]*data-i18n-ignore="true"/)
    assert.ok(html.indexOf('id="voice-panel-toggle"') < html.indexOf('id="menu-collapse-toggle"'))
    assert.match(html, /aria-controls="menu-controls"/)
    assert.doesNotMatch(html, /demo-screenshot|demo\.jpg/)
    assert.doesNotMatch(html, /stage-fidelity|Stage fidelity \/ evidence|场景还原度/)
    assert.match(html, /<button id="camera-save-download">Download<\/button>/)
    await assert.rejects(read('./public/demo.jpg'))
})

test('runtime localization supports complete persistent English, Simplified Chinese and Japanese switching', async () => {
    const localization = await read('./src/viewer/localization/zhCN.ts')
    const japanese = await read('./src/viewer/localization/jaJP.ts')
    const stageLocalization = await read('./src/viewer/stageSceneLocalization.ts')
    const viewerStyle = await read('./src/viewer/style/viewer.css')
    const main = await read('./src/main.ts')

    for (const expected of [
        "export type UiLocale = 'en' | 'zh-CN' | 'ja-JP'",
        "'3D Stage': '3D 场景'",
        "'Stage Runtime': '场景运行时'",
        "'Shader': '着色器（Shader）'",
        "'AngelRing (official GLES projection)': '天使环（AngelRing，官方 GLES 投影）'",
        "'AntiAliasing(Composer)': '抗锯齿（后期合成器）'",
        "'Characters (Global)': '角色（全局）'",
        "'Photo capture failed': '拍照失败'",
        "'Char Only': '仅角色'",
        "'Rec/BG': '录制/BG'",
        "'Tilt character left': '角色左倾'",
        "'Enter VR': '进入 VR'",
        "Smile: '微笑'",
        "'Default face': '默认表情'",
        "HomeWait01: '看板待机 1'",
        "StandbyTransition: '战斗准备过渡'",
        "'Direct drag pose': '直接拖拽编辑动作'",
        "'Move XYZ': '移动 XYZ'",
        "'Rotate XYZ': '旋转 XYZ'",
        "'Model part visibility': '模型部件显示'",
        "'Hide selected part': '隐藏选中部件'",
        "'Show all parts': '显示全部部件'",
        "'Common body controls': '常用肢体设置'",
        "'Common expression controls': '常用表情设置'",
        "'Shadow quality': '阴影画质'",
        "'Official quality': '官方画质'",
        "'Balanced': '均衡'",
        "'Performance first': '性能优先'",
        "'Enemies': '敌人'",
        "'Search enemies': '搜索敌人'",
        "'Add enemy': '添加敌人'",
        "'Active enemies': '已添加的敌人'",
        "'Clear all': '全部移除'",
    ]) {
        assert.ok(localization.includes(expected), `missing localization: ${expected}`)
    }

    assert.match(localization, /English remains the canonical UI key/)
    assert.match(localization, /Simplified Chinese and Japanese are presentation layers/)
    assert.match(localization, /from '\.\/jaJP'/)
    assert.match(localization, /if \(locale === 'ja-JP'\) return translateJaJpUiText\(text\)/)
    assert.match(localization, /localStorage\.setItem\(LOCALE_STORAGE_KEY, locale\)/)
    assert.match(localization, /navigator\.languages/)
    assert.match(localization, /startsWith\('ja'\)\)\) return 'ja-JP'/)
    assert.match(localization, /MutationObserver/)
    assert.match(localization, /element\.getAttribute\(attribute\) !== translated/)
    assert.match(localization, /document\.dispatchEvent\(new CustomEvent\('magius:localechange'/)
    assert.match(localization, /Select values remain the byte-exact/)
    assert.match(localization, /translateOfficialRuntimeOption\(text\)/)
    assert.match(localization, /export function translateBoneChannelLabel\(name: string, locale: UiLocale = currentLocale\)/)
    assert.match(localization, /export function translateMorphChannelLabel\(name: string, locale: UiLocale = currentLocale\)/)
    assert.match(localization, /if \(locale === 'en' \|\| !name\) return name/)
    assert.match(localization, /selector\?\.addEventListener\('change'/)
    assert.match(localization, /document\.documentElement\.dataset\.uiLocale = locale/)
    assert.match(localization, /title: 'Magius3Dviewer｜Magia Exedra 公式風3Dシェーダービューアー'/)
    assert.match(stageLocalization, /export type StageSceneLocale = 'en' \| 'zh-CN' \| 'ja-JP'/)
    assert.match(stageLocalization, /if \(locale === 'ja-JP'\)[\s\S]*officialValue\(record\.names\.ja\)/)

    const chineseMap = readStaticStringMap(localization, 'zhCnUiText')
    const japaneseMap = readStaticStringMap(japanese, 'jaJpUiText')
    assert.equal(japaneseMap.size, chineseMap.size)
    for (const key of chineseMap.keys()) {
        assert.ok(japaneseMap.has(key), `Japanese dictionary missing canonical key: ${key}`)
        assert.ok(japaneseMap.get(key)?.trim(), `Japanese dictionary has empty value: ${key}`)
    }
    assert.equal(japaneseMap.get('Home voice'), 'ホームボイス')
    assert.equal(japaneseMap.get('Move XYZ'), 'XYZ移動')
    assert.equal(japaneseMap.get('Model part visibility'), 'モデルパーツの表示')

    assert.match(viewerStyle, /font-family:\s*'MagiReaderExedraTangYuan'/)
    assert.match(viewerStyle, /font-family:\s*'MagiReaderExedraTsukuOldGothic'/)
    assert.match(viewerStyle, /font-family:\s*'MagiReaderExedraLiberationSans'/)
    assert.match(viewerStyle, /--viewer-ui-font-zh:\s*'MagiReaderExedraTangYuan'/)
    assert.match(viewerStyle, /--viewer-ui-font-ja:\s*'MagiReaderExedraTsukuOldGothic'/)
    assert.match(viewerStyle, /--viewer-ui-font-en:\s*'MagiReaderExedraLiberationSans'/)
    assert.match(viewerStyle, /:root\[lang='zh-CN'\][\s\S]*var\(--viewer-ui-font-zh\)/)
    assert.match(viewerStyle, /:root\[lang='ja-JP'\][\s\S]*var\(--viewer-ui-font-ja\)/)
    assert.match(viewerStyle, /:root\[lang='en'\][\s\S]*var\(--viewer-ui-font-en\)/)
    assert.doesNotMatch(viewerStyle, /--viewer-ui-font-en:\s*(?:Arial|Helvetica)/)
    const englishFont = await stat(new URL('./public/voice/fonts/exedra-en-ui-liberation.878023cf83e0.full.woff2', import.meta.url))
    assert.equal(englishFont.size, 134952)
    assert.match(main, /installLocalization\(\)[\s\S]*setupViewer\(\)/)
    assert.doesNotMatch(main, /import ['"]\.\/style\.css['"]/)
})

test('controls keep a compact wrapping toolbar and an independent viewer movement panel', async () => {
    const html = await read('./index.html')
    const viewerRuntime = await read('./src/viewer/index.ts')
    const globalStyle = await read('./src/style.css')
    const viewerStyle = await read('./src/viewer/style/viewer.css')
    const menu = await read('./src/viewer/style/menu/menu.css')
    const controls = await read('./src/viewer/style/menu/controls.css')
    const panels = await read('./src/viewer/style/panels.css')
    const gui = await read('./src/viewer/style/menu/gui.css')
    const sceneHost = await read('./src/viewer/scene.ts')
    const sceneRuntime = await read('./magia-exedra-character-three/scene/index.ts')
    const shots = await read('./src/viewer/camera/shots.ts')
    const mp4 = await read('./src/viewer/camera/mp4.ts')
    const webm = await read('./src/viewer/camera/webm.ts')
    const theme = await read('./src/viewer/controllers/theme.ts')
    const styleIndex = await read('./src/viewer/style/index.css')
    const vite = await read('./vite.config.ts')

    for (const id of [
        'workspace',
        'advanced-controls-dock',
        'viewer',
        'toolbar-tools',
        'stage-shadow-quality-control',
        'stage-shadow-quality',
        'render-settings-toggle',
        'render-settings-close',
        'action-panel-toggle',
        'action-parameter-panel',
        'action-channel-list',
        'action-direct-edit-toggle',
        'action-direct-translate',
        'action-direct-rotate',
        'action-direct-edit-target',
        'model-part-controls-title',
        'action-show-all-parts',
        'action-selected-part',
        'action-selected-part-visibility',
        'action-model-part-search',
        'action-model-part-list',
        'expression-panel-toggle',
        'expression-parameter-panel',
        'expression-channel-list',
        'position-controls-toggle',
        'position-controls-wrapper',
        'capture-character',
        'capture-with-background',
        'record-character',
        'record-with-background',
        'record-mp4-with-background',
        'recording-resolution',
        'recording-aspect',
        'recording-orientation',
        'recording-size-output',
        'character-tilt-left',
        'character-tilt-right',
        'viewer-vr-toggle',
        'enemy-panel-toggle',
        'enemy-panel',
        'enemy-panel-close',
        'enemy-catalog-search',
        'enemy-catalog-select',
        'enemy-preview-image',
        'enemy-add-quantity',
        'enemy-add-button',
        'enemy-instance-list',
        'enemy-clear-button',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `missing UI region: ${id}`)
    }
    assert.ok(html.indexOf('id="menu"') < html.indexOf('id="workspace"'))
    assert.ok(html.indexOf('id="toolbar-tools"') < html.indexOf('id="workspace"'))
    assert.ok(html.indexOf('id="expression-panel-toggle"') < html.indexOf('id="toolbar-tools"'))
    assert.ok(html.indexOf('id="toolbar-tools"') < html.indexOf('id="stage-selector"'))
    assert.ok(html.indexOf('id="stage-selector"') < html.indexOf('id="render-settings-toggle"'))
    assert.ok(html.indexOf('id="render-settings-toggle"') < html.indexOf('id="menu-collapse-toggle"'))
    assert.ok(html.indexOf('id="viewer"') < html.indexOf('id="position-controls-wrapper"'))
    assert.ok(html.indexOf('id="advanced-controls-dock"') < html.indexOf('id="viewer"'))
    assert.doesNotMatch(html, /id="side-dock"/)
    assert.doesNotMatch(html, /stage-fidelity|Stage fidelity \/ evidence|场景还原度/)
    assert.doesNotMatch(styleIndex, /stageFidelity\.css/)

    assert.match(globalStyle, /html,[\s\S]*body,[\s\S]*#app[\s\S]*overflow: hidden/)
    assert.match(viewerStyle, /#app\s*\{[^}]*position:\s*relative[^}]*grid-template-rows:\s*minmax\(0, 1fr\)/)
    assert.match(viewerStyle, /#workspace\s*\{[^}]*grid-row:\s*1[^}]*grid-column:\s*1[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/)
    assert.doesNotMatch(viewerStyle, /body\.advanced-controls-open #workspace/)
    assert.doesNotMatch(viewerStyle, /body\.position-controls-open #workspace/)
    assert.doesNotMatch(viewerStyle, /--side-dock-width/)
    assert.match(viewerStyle, /#app #menu\s*\{[^}]*position:\s*absolute[^}]*width:\s*fit-content[^}]*max-width:\s*100%[^}]*height:\s*auto/)
    assert.match(viewerStyle, /#app #menu #menu-controls\s*\{[^}]*width:\s*fit-content[^}]*max-width:\s*calc\(100vw - 4px\)[^}]*gap:\s*2px[^}]*font-size:\s*11px/)
    assert.match(viewerStyle, /#app #menu #menu-controls > div:first-child,[\s\S]*#app #menu #toolbar-tools > #menu-icons\s*\{[^}]*display:\s*contents/)
    assert.match(viewerStyle, /#app #menu #menu-controls > div:first-child > \*,[\s\S]*#app #menu #toolbar-tools > #perf-stat\s*\{[^}]*flex:\s*0 1 auto[^}]*margin:\s*0/)
    assert.match(viewerStyle, /#app #menu #menu-controls > div:not\(#toolbar-tools\):not\(:first-child\):not\(\.animation-controls\)\s*\{[^}]*gap:\s*2px/)
    assert.match(viewerStyle, /#app #menu #menu-controls button,[\s\S]*#character-search-input\s*\{[^}]*min-height:\s*26px/)
    assert.match(html, /id="toolbar-tools"[\s\S]*id="menu-collapse-toggle"[\s\S]*<\/div>\s*<\/div>\s*<div id="workspace">/)
    assert.match(html, /id="menu-collapse-toggle"[\s\S]*<svg viewBox="0 0 24 24"[^>]*>[\s\S]*<path d="M4\.5 18 12 5\.5 19\.5 18Z"/)
    assert.match(viewerStyle, /#menu-controls > \.main-toolbar-toggle\s*\{[^}]*position:\s*static[^}]*flex:\s*0 0 28px[^}]*order:\s*999[^}]*margin:\s*0 !important/)
    assert.match(viewerStyle, /#menu-controls > \.main-toolbar-toggle\s*\{[^}]*border:\s*1px solid rgba\(16, 185, 129, 0\.4\)[^}]*background:\s*rgba\(16, 185, 129, 0\.15\)[^}]*color:\s*#10b981/)
    assert.match(viewerStyle, /body\.menu-ui-collapsed #app #menu\s*\{[^}]*inset:\s*0 0 auto auto[^}]*width:\s*32px[^}]*height:\s*32px[^}]*background:\s*transparent[^}]*border:\s*0[^}]*backdrop-filter:\s*none/)
    assert.match(viewerStyle, /body\.menu-ui-collapsed #app #menu #menu-controls\s*\{[^}]*position:\s*absolute[^}]*top:\s*2px[^}]*right:\s*2px[^}]*display:\s*flex !important[^}]*width:\s*28px[^}]*max-width:\s*28px[^}]*height:\s*28px/)
    assert.match(viewerStyle, /body\.menu-ui-collapsed #app #menu #menu-controls > :not\(\.main-toolbar-toggle\)\s*\{[^}]*display:\s*none !important/)
    assert.match(viewerStyle, /\.main-toolbar-toggle\.controls-collapsed > span\s*\{[^}]*transform:\s*rotate\(180deg\)/)
    assert.match(viewerStyle, /@keyframes magius-toolbar-retract\s*\{[\s\S]*translateY\(-8px\) scaleY\(0\.86\)/)
    assert.match(viewerStyle, /@keyframes magius-toolbar-expand\s*\{[\s\S]*translateY\(0\) scaleY\(1\)/)
    assert.doesNotMatch(viewerStyle, /magius-toolbar-(?:retract|expand)[\s\S]{0,240}animation-duration:\s*1ms/)
    assert.match(viewerRuntime, /const transitionDuration = 220[\s\S]*menu-ui-collapsing[\s\S]*menu-ui-expanding[\s\S]*window\.setTimeout/)
    assert.doesNotMatch(viewerRuntime, /menuCollapseGlyph\.textContent/)
    assert.doesNotMatch(viewerStyle, /padding-right:\s*34px/)
    assert.match(viewerStyle, /#app #menu #character-selector\s*\{[^}]*width:\s*clamp\(168px, 19vw, 210px\)[^}]*max-width:\s*min\(210px, 26vw\)/)
    assert.match(viewerStyle, /#app #menu #animation-selector\s*\{[^}]*width:\s*clamp\(156px, 18vw, 196px\)[^}]*max-width:\s*min\(196px, 24vw\)/)
    assert.match(viewerStyle, /#app #menu #expression-selector\s*\{[^}]*width:\s*clamp\(88px, 8vw, 108px\)[^}]*max-width:\s*min\(108px, 16vw\)/)
    assert.match(viewerStyle, /#app #menu #stage-selector\s*\{[^}]*width:\s*clamp\(148px, 18vw, 216px\)[^}]*max-width:\s*min\(216px, 26vw\)/)
    assert.doesNotMatch(viewerStyle, /#app #menu #(character|animation|expression|stage)-selector\s*\{[^}]*field-sizing:\s*content/)
    assert.doesNotMatch(viewerStyle, /#app #menu #(character|animation|expression|stage)-selector\s*\{[^}]*width:\s*(?:fit-content|auto)/)
    assert.doesNotMatch(viewerStyle, /@media \(max-width: 520px\)[\s\S]*#app #menu #character-selector,[\s\S]*width:\s*auto/)
    assert.match(viewerStyle, /#animation-slider\s*\{[^}]*flex:\s*0 1 84px[^}]*width:\s*clamp\(72px, 8vw, 104px\)[^}]*max-width:\s*104px/)
    assert.match(viewerStyle, /#app #menu #toolbar-tools > #menu-icons > button,[\s\S]*min-height:\s*26px/)
    assert.match(viewerStyle, /#menu-controls #animation-action-status\s*\{[^}]*flex:\s*0 1 min\(18ch, 22vw\)/)
    assert.match(viewerStyle, /#stage-shadow-quality-control\s*\{[^}]*flex-wrap:\s*wrap/)
    assert.match(viewerStyle, /#viewer[\s\S]*overflow: hidden/)
    assert.doesNotMatch(viewerStyle, /#side-dock/)
    assert.match(panels, /\.floating-panel \{[\s\S]*position: fixed/)
    assert.match(panels, /\.floating-panel\.is-open \{[\s\S]*display: flex/)
    assert.match(panels, /#advanced-controls-dock \{[\s\S]*width:/)
    assert.match(panels, /\.parameter-panel \{[\s\S]*max-height|\.parameter-panel \{[\s\S]*height:/)
    assert.match(panels, /\.direct-pose-toolbar \{[\s\S]*grid-template-columns:/)
    assert.match(panels, /\.direct-pose-mode \{[\s\S]*display: flex/)
    assert.match(panels, /\.model-part-list \{[\s\S]*max-height: 142px[\s\S]*overflow: auto/)
    assert.match(panels, /\.model-part-row \{[\s\S]*grid-template-columns:/)
    assert.match(panels, /body\.direct-pose-editing #viewer canvas/)
    assert.match(panels, /\.parameter-channel-row\.direct-selected/)
    assert.match(panels, /\.parameter-section-label/)
    assert.match(controls, /#expression-auto-blink-control \{[\s\S]*display: inline-flex/)
    assert.doesNotMatch(controls, /#face-manual-controls \{[\s\S]*?display: contents/)
    assert.match(controls, /#position-controls-wrapper \{[\s\S]*?position: absolute[\s\S]*?right: 8px[\s\S]*?bottom: 8px/)
    assert.match(controls, /body\.position-controls-open #position-controls-wrapper[\s\S]*?display: block/)
    assert.match(controls, /#position-controls \{[\s\S]*?display: grid[\s\S]*?grid-template-columns: repeat\(3,/)
    assert.match(controls, /#recording-spec-controls \{[\s\S]*?grid-template-columns: repeat\(3,/)
    assert.match(html, /id="recording-resolution"[\s\S]*value="current" selected[\s\S]*value="1k"[\s\S]*value="2k"[\s\S]*value="4k"/)
    assert.match(html, /id="recording-aspect"[\s\S]*value="16:9"[\s\S]*value="21:9"[\s\S]*value="4:3"[\s\S]*value="1:1"/)
    assert.match(html, /id="recording-orientation"[\s\S]*value="landscape"[\s\S]*value="portrait"/)
    assert.match(html, /id="stage-shadow-quality"[\s\S]*value="official" selected>Official quality[\s\S]*value="balanced">Balanced[\s\S]*value="performance">Performance first/)

    assert.match(viewerRuntime, /menu-ui-collapsed/)
    assert.match(viewerRuntime, /advanced-controls-open/)
    assert.match(viewerRuntime, /position-controls-open/)
    assert.match(viewerRuntime, /stageShadowQualitySelect\.value = getStageShadowQuality\(\)/)
    assert.match(viewerRuntime, /stageShadowQualitySelect\.onchange[\s\S]*setStageShadowQuality\(stageShadowQualitySelect\.value as StageShadowQuality\)/)
    assert.match(viewerRuntime, /document\.addEventListener\(STAGE_SHADOW_QUALITY_CHANGE_EVENT[\s\S]*syncFromState\(state\.quality\)/)
    assert.doesNotMatch(viewerRuntime, /localStorage\.(?:getItem|setItem)\([^)]*shadow/i)
    assert.match(viewerRuntime, /actionPanel\.classList\.toggle\('is-open'/)
    assert.match(viewerRuntime, /expressionPanel\.classList\.toggle\('is-open'/)
    assert.match(viewerRuntime, /rebuildActionParameterChannels/)
    assert.match(viewerRuntime, /rebuildExpressionParameterChannels/)
    assert.match(viewerRuntime, /child instanceof THREE\.Bone/)
    assert.match(viewerRuntime, /morphTargetDictionary/)
    assert.match(viewerRuntime, /applyManualPoseOverrides/)
    assert.match(viewerRuntime, /applyManualExpressionOverrides/)
    assert.match(viewerRuntime, /getCommonBonePriority/)
    assert.match(viewerRuntime, /getCommonMorphPriority/)
    assert.match(viewerRuntime, /appendParameterSectionLabel\(actionChannelList, sectionLabel, section\)/)
    assert.match(viewerRuntime, /appendParameterSectionLabel\(expressionChannelList, sectionLabel, section\)/)
    assert.match(viewerRuntime, /new TransformControls\(scene\.camera, scene\.renderer\.domElement\)/)
    assert.match(viewerRuntime, /raycaster\.intersectObject\(object, true\)/)
    assert.match(viewerRuntime, /getAttribute\('skinIndex'\)/)
    assert.match(viewerRuntime, /getAttribute\('skinWeight'\)/)
    assert.match(viewerRuntime, /selectDirectPoseBone\(weighted\.object, weighted\.bone, weighted\.part\)/)
    assert.match(viewerRuntime, /directPoseControls\.mode = directPoseTransformMode/)
    assert.match(viewerRuntime, /setDirectPoseTransformMode\('translate'\)/)
    assert.match(viewerRuntime, /setDirectPoseTransformMode\('rotate'\)/)
    assert.match(viewerRuntime, /addEventListener\('dblclick', mouseDoubleClickHandler\)/)
    assert.match(viewerRuntime, /function mouseDoubleClickHandler\(e: MouseEvent\) \{\s*if \(directPoseEditingEnabled \|\| performanceGizmoActive\) return\s*if \(scene\.characters\.length === 1\)/)
    assert.match(viewerRuntime, /scene\.getIntersectedCharacter\(e\.offsetX, e\.offsetY\)/)
    assert.match(viewerRuntime, /activateSingleCharacterTransform\(character\)/)
    assert.match(viewerRuntime, /enemyPanelController\?\.getIntersectedEnemy\(e\.clientX, e\.clientY\)/)
    assert.match(viewerRuntime, /activateObjectTransform\(enemy\.object, \(\) => enemyPanelController\?\.refreshInstances\(\)\)/)
    assert.match(viewerRuntime, /singleCharacterTransformControls = new TransformControls\(scene\.camera, scene\.renderer\.domElement\)/)
    assert.match(viewerRuntime, /singleCharacterTransformControls\.attach\(object\)/)
    assert.match(viewerRuntime, /singleCharacterTransformControlsHelper\.visible = true/)
    assert.match(viewerRuntime, /singleCharacterTransformControls\.enabled = true/)
    assert.match(viewerRuntime, /singleCharacterTransformActive && singleCharacterTransformControls/)
    assert.match(viewerRuntime, /controls\.showX = true[\s\S]*controls\.showZ = true[\s\S]*controls\.showY = true/)
    assert.match(viewerRuntime, /positionOffsets: new THREE\.Vector3\(\)/)
    assert.match(viewerRuntime, /positionOffsets\.lengthSq\(\)/)
    assert.match(viewerRuntime, /rebuildModelPartVisibilityControls\(\)/)
    assert.match(viewerRuntime, /entry\.object\.visible = visible/)
    assert.match(viewerRuntime, /function showAllModelParts\(\)/)
    assert.match(viewerRuntime, /event\.altKey[\s\S]*entry\.offsets\.y/)
    assert.match(viewerRuntime, /translateBoneChannelLabel/)
    assert.match(viewerRuntime, /translateMorphChannelLabel/)
    assert.match(viewerRuntime, /setupCharacterMovementControls/)
    assert.match(viewerRuntime, /import \{ setupEnemyPanel, type EnemyPanelController \} from '\.\/enemyPanel'/)
    assert.match(viewerRuntime, /setupDockControls\(\)[\s\S]*enemyPanelController = setupEnemyPanel\(\{[\s\S]*setupStageShadowQualityControl\(\)/)
    assert.doesNotMatch(viewerRuntime, /expressionAutoBlinkPrefix|\(auto blink\)/)
    assert.match(viewerRuntime, /character\.expression\?\.set\(value, expressionAutoBlink\.checked\)/)
    assert.match(viewerRuntime, /renderSettingsToggle\.setAttribute\('aria-label', label\)/)
    assert.match(viewerRuntime, /positionControlsToggle\.setAttribute\('aria-label', label\)/)
    assert.match(viewerRuntime, /setPointerCapture/)
    assert.match(viewerRuntime, /cameraForward[\s\S]*?setFromAxisAngle\(cameraForward, delta\)/)
    assert.match(menu, /\.main-toolbar-toggle/)
    assert.match(menu, /\.menu-ui-collapsed #menu-controls/)
    assert.match(menu, /\.main-toolbar-toggle\.controls-collapsed/)
    assert.match(controls, /flex-wrap: wrap/)
    assert.doesNotMatch(controls, /max-height:/)
    assert.doesNotMatch(controls, /overflow(?:-y)?: auto/)
    assert.match(gui, /scrollbar-width: none/)
    assert.match(gui, /::-webkit-scrollbar/)

    assert.match(sceneHost, /new ResizeObserver\(syncSceneViewport\)/)
    assert.match(sceneHost, /viewerEl\.clientWidth/)
    assert.match(sceneHost, /viewerEl\.clientHeight/)
    assert.match(sceneHost, /scene\.setViewportSize\(width, height\)/)
    assert.match(sceneRuntime, /setViewportSize\(width: number, height: number\)/)
    assert.match(sceneRuntime, /captureForegroundFrame\(copy:/)
    assert.match(sceneRuntime, /beginForegroundCapture\(\)/)
    assert.match(sceneRuntime, /beginCaptureResolution\(targetLongEdge: number, allowDownscale = false\)/)
    assert.match(shots, /beginCaptureResolution\(stillCaptureLongEdge\)/)
    assert.match(sceneRuntime, /setSize\(logicalSize\.x, logicalSize\.y, false\)/)
    assert.match(sceneRuntime, /renderCurrentFrame\(\)/)
    assert.match(shots, /stillCaptureLongEdge = 3840/)
    assert.match(shots, /'1k': \{ width: 1280, height: 720 \},[\s\S]*'2k': \{ width: 1920, height: 1080 \},[\s\S]*'4k': \{ width: 3840, height: 2160 \}/)
    assert.match(shots, /'16:9': 16 \/ 9,[\s\S]*'21:9': 21 \/ 9,[\s\S]*'4:3': 4 \/ 3,[\s\S]*'1:1': 1/)
    assert.match(shots, /value === 'current'/)
    assert.match(shots, /resolution === 'current'[\s\S]*getCaptureSize\(\)/)
    assert.match(shots, /recordingPresetStorageKey = 'magius-recording-spec-v3'/)
    assert.match(shots, /recordingFrameIntervalMs = 1000 \/ 30/)
    assert.match(shots, /setRecordingCanvasSize\(canvas, \{[\s\S]*width: resolution\.width,[\s\S]*height: resolution\.height/)
    assert.match(shots, /beginCaptureFrameSize\(recordingSize\.width, recordingSize\.height, 30, includeBackground\)/)
    assert.match(shots, /orientation === 'portrait'/)
    assert.match(shots, /drawCover\(context, source, source\.width, source\.height, canvas\.width, canvas\.height\)/)
    assert.match(shots, /fixWebmDuration\(blob: Blob, durationMs: number\)/)
    assert.match(shots, /Math\.max\(1, durationMs\) \* 1_000_000 \/ timecodeScale/)
    assert.match(shots, /anchor\.id = 'magius-last-download'/)
    assert.match(shots, /dataset\.magiusLastDownload/)
    assert.match(shots, /URL\.revokeObjectURL\(url\)[\s\S]*60_000/)
    assert.match(shots, /WebCodecsMp4Recorder\.create/)
    assert.match(shots, /WebCodecsWebmRecorder\.create/)
    assert.match(shots, /nativeContainerAvailable[\s\S]*if \(!nativeContainerAvailable\)/)
    assert.match(shots, /canvas\.captureStream\(30\)/)
    assert.match(shots, /videoTrack\.contentHint = 'detail'/)
    assert.match(mp4, /selectAvcCodec\(options\.width, options\.height\)/)
    assert.match(mp4, /return 'avc1\.42003c'/)
    assert.match(mp4, /this\.encoder\.encodeQueueSize > 2/)
    assert.match(mp4, /bitrateMode: 'constant'/)
    assert.match(mp4, /needsFrame\(elapsedMs: number\)/)
    assert.match(mp4, /createMovieBox/)
    assert.match(mp4, /box\('mdat'/)
    assert.match(webm, /codec: 'vp09\.00\.10\.08'/)
    assert.match(webm, /this\.encoder\.encodeQueueSize > 2/)
    assert.match(webm, /bitrateMode: 'constant'/)
    assert.match(webm, /needsFrame\(elapsedMs: number\)/)
    assert.match(webm, /ascii\('V_VP9'\)/)
    assert.match(webm, /createSimpleBlock/)
    assert.match(shots, /MediaRecorder\.isTypeSupported/)
    assert.match(shots, /video\/mp4[\s\S]*video\/webm/)
    assert.match(shots, /requestSession\('immersive-vr'/)
    assert.match(shots, /createCaptureCanvas\(includeBackground/)
    assert.match(theme, /localStorage\.setItem\(themeStorageKey, theme\)/)
    assert.match(vite, /normalized\.includes\('\/src\/viewer\/'\)[\s\S]*return 'viewer-runtime'/)
    assert.doesNotMatch(vite, /return 'viewer-stage'/)
})

test('all shipped character models use searchable Chinese Japanese and Reader romanized names', async () => {
    const names = await read('./src/viewer/localization/characterNames.ts')
    const viewerRuntime = await read('./src/viewer/index.ts')
    const uiCharacterCatalog = await read('./src/viewer/uiCharacterCatalog.ts')
    const modelDirectories = [
        ...await readdir(new URL('./magia-exedra-character-three/models/', import.meta.url), { withFileTypes: true }),
        ...await readdir(new URL('./magia-exedra-character-three/nonbattle-models/', import.meta.url), { withFileTypes: true }),
    ]
    const modelIds = new Set(modelDirectories
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name.match(/^chara_(\d{6})/)?.[1])
        .filter(Boolean))
    const mappedIds = new Set([...names.matchAll(/^\s*"(\d{6})":\s*\{\s*zh:\s*"([^"]*)",\s*ja:\s*"([^"]+)",\s*romaji:\s*"([^"]*)"\s*\},?$/gm)]
        .map(match => match[1]))

    assert.equal(modelIds.size, new Set(modelDirectories.filter(entry => entry.isDirectory()).map(entry => entry.name.match(/^chara_(\d{6})/)?.[1]).filter(Boolean)).size)
    assert.deepEqual(mappedIds, modelIds)
    assert.match(names, /"101002": \{ zh: "谣鹤乃（魔法少女）", ja: "ウワサの鶴乃（魔法少女）", romaji: "Uwasa Tsuruno \(Magical Girl\)" \}/)
    assert.match(names, /"108301": \{ zh: "三栗菖蒲（魔法少女）", ja: "三栗あやめ（魔法少女）", romaji: "Ayame Mikuri \(Magical Girl\)" \}/)
    assert.match(names, /"114501": \{ zh: "夜明堇（魔法少女）", ja: "夜明すみれ（魔法少女）", romaji: "Sumire Yoake \(Magical Girl\)" \}/)
    assert.match(names, /"115201": \{ zh: "小圆前辈（魔法少女）（制作中）", ja: "まどか先輩（魔法少女）（WIP）", romaji: "Madoka-senpai \(Magical Girl\) \(WIP\)" \}/)
    assert.match(names, /new Set\(\[name\.zh, name\.ja, name\.romaji\]/)
    assert.match(viewerRuntime, /formatCharacterTrilingualName\(id, characters\.getCharacterNameById\(id\)\)/)
    assert.match(uiCharacterCatalog, /normalizedName:\s*normalizeCharacterSearchText\(name\)/)
    assert.match(viewerRuntime, /obj\[`\$\{entry\.id\} - \$\{entry\.name\}`\] = entry\.id/)
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

test('character search follows the compact adaptive name-or-ID toolbar contract', async () => {
    const html = await read('./index.html')
    const viewer = await read('./src/viewer/index.ts')
    const uiCharacterCatalog = await read('./src/viewer/uiCharacterCatalog.ts')
    const style = await read('./src/viewer/style/viewer.css')
    const localization = await read('./src/viewer/localization/zhCN.ts')

    assert.match(html, /id="character-search-input"[^>]*type="search"/)
    assert.match(html, /placeholder="ID \/ Name"/)
    assert.match(html, /aria-label="Search characters by name or ID"/)
    assert.match(html, /id="character-search-results"[^>]*role="listbox"[^>]*hidden/)
    assert.match(uiCharacterCatalog, /normalize\('NFKC'\)/)
    assert.match(uiCharacterCatalog, /entry\.normalizedId === query[\s\S]*entry\.normalizedId\.startsWith\(query\)[\s\S]*entry\.normalizedName\.includes\(query\)[\s\S]*entry\.normalizedAliases\.includes\(query\)/)
    assert.match(viewer, /const baseChars = textLength > 0 \? textLength \+ 2 : 8/)
    assert.match(viewer, /const maxChars = viewportWidth < 760 \? 20 : 26/)
    assert.match(viewer, /const minPx = viewportWidth < 520 \? 82 : 88/)
    assert.match(viewer, /const maxPx = Math\.min\(viewportWidth - 16, viewportWidth < 760 \? 220 : 260\)/)
    assert.match(viewer, /--character-search-width/)
    assert.match(viewer, /event\.key === 'ArrowDown'/)
    assert.match(viewer, /event\.key === 'ArrowUp'/)
    assert.match(viewer, /event\.key === 'Enter'/)
    assert.match(viewer, /characterSelector\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/)
    assert.match(style, /width: var\(--character-search-width, 88px\)/)
    assert.match(style, /min-width: 82px/)
    assert.match(style, /max-width: min\(260px, calc\(100vw - 16px\)\)/)
    assert.match(localization, /'Search characters by name or ID': '按角色名称或编号搜索'/)
    assert.match(localization, /'No matching characters': '没有匹配的角色'/)
})

test('animation selector consumes native character-action catalog fields without clip-name guessing', async () => {
    const html = await read('./index.html')
    const viewer = await read('./src/viewer/index.ts')
    const style = await read('./src/viewer/style/viewer.css')

    assert.match(html, /id="animation-action-status"[^>]*aria-live="polite"/)
    assert.match(viewer, /window\.magiusViewerLocomotion\.characterActions/)
    assert.match(viewer, /api\.subscribeCatalog\(applyCharacterActionCatalog\)/)
    assert.match(viewer, /api\.subscribeState\(setCharacterActionPlaybackState\)/)
    assert.match(viewer, /await api\.ready\(\)/)
    assert.match(viewer, /applyCharacterActionCatalog\(api\.catalog\(\)\)/)
    assert.doesNotMatch(viewer, /catalogAll\(/)
    assert.match(viewer, /groups\.get\(entry\.groupId\)/)
    assert.match(viewer, /label: entry\.group/)
    assert.match(viewer, /option\.value = entry\.id/)
    assert.match(viewer, /entry\.label[\s\S]*entry\.playback/)
    assert.match(viewer, /availability\.currentCharacter && availability\.playable/)
    assert.match(viewer, /availability\.reason \|\| availability\.status/)
    assert.match(viewer, /option\.disabled = !playable/)
    assert.match(viewer, /characterActionsApi\(\)\.play\(actionId\)/)
    assert.match(viewer, /characterActionPendingId = undefined\s+setCharacterActionPlaybackState\(state\)\s+setSelectedAnimationPlaybackRate\(selectedAnimationPlaybackRate\(\), true\)\s+\/\/ subscribeState may publish[\s\S]{0,220}renderCharacterActionStatus\(\)/)
    assert.match(viewer, /characterActionsApi\(\)\.pause\(\)/)
    assert.match(viewer, /characterActionsApi\(\)\.seek\(requestedTime\)/)
    assert.match(viewer, /setPlaybackRate\?: \(playbackRate: number\)/)
    assert.match(viewer, /setSelectedAnimationPlaybackRate\(parseFloat\(animationSpeed\.value\), true\)/)
    assert.match(viewer, /setSelectedAnimationPlaybackRate\(selectedAnimationPlaybackRate\(\), true\)/)
    assert.match(viewer, /applySelectedAnimationPlaybackRate\(\)[\s\S]*applyManualPoseOverrides\(\)/)
    assert.match(viewer, /animation\.mixer\.timeScale = playbackRate/)
    assert.match(viewer, /setCharacterActionPlaybackState\(characterActionsApi\(\)\.dispose\(\)\)/)
    assert.match(viewer, /characterActionCatalogUnsubscribe\?\.\(\)/)
    assert.match(viewer, /characterActionStateUnsubscribe\?\.\(\)/)
    assert.match(viewer, /baseAnimationNamesByCharacter\.set\(character\.object, \[\.\.\.character\.animations\]\)[\s\S]*attachViewerLocomotion\(sceneCharacter\)/)

    const renderer = viewer.match(/function renderAnimationSelector\(\)[\s\S]*?\n}\n\nfunction applyCharacterActionCatalog/)?.[0] ?? ''
    assert.ok(renderer, 'missing catalog-backed animation selector renderer')
    assert.doesNotMatch(renderer, /\.clip\b|\.runtime\b|endsWith\('_L'\)/)
    const speedHandler = viewer.match(/animationSpeed\.oninput = \(\) => \{[\s\S]*?\n}/)?.[0] ?? ''
    assert.ok(speedHandler, 'missing animation speed input handler')
    assert.doesNotMatch(speedHandler, /dispose\(|pause\(|play\(/)
    assert.match(style, /#animation-action-status/)
    assert.match(style, /text-overflow: ellipsis/)
})

test('magical girl and scene lists invoke the retained runtime selectors while the passive resource directory is absent', async () => {
    const html = await read('./index.html')
    const viewerRuntime = await read('./src/viewer/index.ts')
    const selectorPanels = await read('./src/viewer/runtimeSelectionPanels.ts')
    const viewerStyle = await read('./src/viewer/style/viewer.css')
    const localization = await read('./src/viewer/localization/zhCN.ts')
    const catalogDocument = JSON.parse(await read('./public/catalogs/official-resources.v1.json'))

    for (const id of [
        'character-selector',
        'character-list-panel-toggle',
        'character-list-panel',
        'character-list-search',
        'character-list-select',
        'character-list-grid',
        'character-list-preview',
        'character-list-detail',
        'character-list-use',
        'stage-selector',
        'stage-list-panel-toggle',
        'stage-list-panel',
        'stage-list-search',
        'stage-list-select',
        'stage-list-grid',
        'stage-list-preview',
        'stage-list-detail',
        'stage-list-use',
        'enemy-toolbar-select',
        'enemy-toolbar-add',
        'enemy-toolbar-remove',
        'enemy-panel-toggle',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `missing runtime selector UI: ${id}`)
    }
    assert.doesNotMatch(html, /id="official-resource-panel-toggle"|id="official-resource-panel"/)
    assert.doesNotMatch(viewerRuntime, /OfficialResourceCatalogClient|setupOfficialResourceCatalogUi|officialResourcePanel/)
    assert.doesNotMatch(viewerStyle, /#official-resource-panel|\.official-resource-/)

    assert.equal(catalogDocument.schema, 'magius.official-resource-catalog.v1')
    assert.equal(catalogDocument.scenes.length, 581)
    assertReleaseEnemyCatalog(catalogDocument)
    assert.equal(catalogDocument.enemyModels.length, 495)
    assert.equal(catalogDocument.vfx.filter(entry => entry.domain === 'enemy').length, 443)
    assert.equal(catalogDocument.vfx.filter(entry => entry.domain === 'character').length, 211)

    assert.match(viewerRuntime, /import \{ setupRuntimeSelectionPanels \} from '\.\/runtimeSelectionPanels'/)
    assert.match(viewerRuntime, /enemyPanelController = setupEnemyPanel\(\{[\s\S]*setupRuntimeSelectionPanels\(\)/)
    assert.match(selectorPanels, /sourceId: 'character-selector'/)
    assert.match(selectorPanels, /sourceId: 'stage-selector'/)
    assert.match(selectorPanels, /elements\.source\.value = sourceOption\.value[\s\S]*dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/)
    assert.match(selectorPanels, /const sourceValue = elements\.source\.value[\s\S]*elements\.search\.value = ''[\s\S]*refreshList\(\)[\s\S]*elements\.list\.value = sourceValue/)
    assert.match(selectorPanels, /elements\.source\.addEventListener\('change', syncFromSource\)/)
    assert.match(selectorPanels, /new MutationObserver\(refreshList\)/)
    assert.match(selectorPanels, /sourceObserver\.observe\(elements\.source, \{[\s\S]*childList: true[\s\S]*subtree: true/)

    assert.match(viewerStyle, /#app #menu #enemy-toolbar-select\s*\{[^}]*width:\s*clamp\(168px, 19vw, 220px\)/)
    assert.match(viewerStyle, /\.floating-panel\.runtime-selection-panel\s*\{[^}]*width:\s*min\(940px, calc\(100vw - 24px\)\)/)
    assert.match(viewerStyle, /\.runtime-selection-panel > \.runtime-selection-panel-content\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/)
    assert.match(viewerStyle, /\.runtime-selection-panel \.runtime-selection-field\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/)
    assert.match(viewerStyle, /\.runtime-selection-panel \.runtime-selection-list-field\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/)
    assert.match(viewerStyle, /\.runtime-selection-list-field select\s*\{[^}]*min-height:\s*210px/)
    assert.match(viewerStyle, /\.runtime-selection-browser\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1\.65fr\) minmax\(230px, 0\.75fr\)/)
    assert.match(viewerStyle, /\.runtime-selection-thumbnail-grid\s*\{[^}]*display:\s*grid[^}]*overflow:\s*auto/)
    assert.match(viewerStyle, /\.runtime-selection-tile\.is-selected\s*\{[^}]*border-color:\s*#22c9a2/)

    for (const expected of [
        "'Magical girls': '魔法少女'",
        "'Show magical girl list': '展开魔法少女清单'",
        "'Switch magical girl': '切换魔法少女'",
        "'Show scene list': '展开场景清单'",
        "'Load selected scene': '加载所选场景'",
        "'Choose enemy': '选择敌人'",
        "'Add selected enemy': '添加所选敌人'",
    ]) {
        assert.ok(localization.includes(expected), `missing runtime selector localization: ${expected}`)
    }
})

test('TPS blank Viewer clicks preserve the selected character without changing ordinary multi-character editing', async () => {
    const viewerRuntime = await read('./src/viewer/index.ts')

    assert.match(
        viewerRuntime,
        /function tpsMoveKeepsCharacterSelectedOnEmptyViewerClick\(\): boolean \{[\s\S]*document\.body\.classList\.contains\('locomotion-mode-enabled'\)[\s\S]*\}/,
    )
    assert.match(
        viewerRuntime,
        /if \(character\) \{[\s\S]*selectCharacter\(character\)[\s\S]*\} else if \([\s\S]*scene\.characters\.length > 1[\s\S]*&& scene\.characterSelected[\s\S]*&& !tpsMoveKeepsCharacterSelectedOnEmptyViewerClick\(\)[\s\S]*\) \{[\s\S]*deselectCharacter\(\)/,
    )
})

test('actual Viewer click and double-click handlers yield before hit-testing to either pose or performance gizmo', async () => {
    const runtime = await read('./src/viewer/index.ts')
    const parsed = ts.createSourceFile('viewer.ts', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const wanted = new Set(['mouseClickHandler', 'mouseDoubleClickHandler', 'activateSingleCharacterTransform', 'activateObjectTransform'])
    const declarations = new Map()
    const visit = node => {
        if (ts.isFunctionDeclaration(node) && wanted.has(node.name?.text)) declarations.set(node.name.text, node.getText(parsed))
        ts.forEachChild(node, visit)
    }
    visit(parsed); assert.equal(declarations.size, wanted.size)
    const executable = ts.transpileModule([...declarations.values()].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
    const create = ({ direct = false, performance = false, characterCount = 1, hitCharacter = true, hitEnemy = false, leasedRoot = false } = {}) => {
        const calls = [], object = {}, character = { character: { object } }, enemy = { object: {}, instanceId: 'exact-enemy' }
        const scene = { characters: Array.from({ length: characterCount }, () => character), characterSelected: undefined, controls: { enabled: true },
            getIntersectedCharacter: () => { calls.push('character-hit-test'); return hitCharacter ? character : undefined } }
        const controls = { attach: value => calls.push(value === object ? 'character-attach' : 'enemy-attach'), enabled: false }
        const panel = { getIntersectedEnemy: () => { calls.push('enemy-hit-test'); return hitEnemy ? enemy : undefined },
            selectInstance: id => calls.push(id), refreshInstances() {} }
        const handlers = new Function('scene', 'directPoseEditingEnabled', 'performanceGizmoActive', 'mouseMoveX', 'mouseMoveY',
            'selectCharacterByMouse', 'selectCharacter', 'enemyPanelController', 'performanceExternalLeases',
            'singleCharacterTransformControls', 'singleCharacterTransformControlsHelper', 'setTransformMode', 'updateCharacterController',
            'let singleCharacterTransformActive=false,singleCharacterTransformOrbitWasEnabled,singleObjectTransformOnChange;\n'
                + executable + '\nreturn {click:mouseClickHandler,double:mouseDoubleClickHandler}')(
            scene, direct, performance, 0, 0, () => calls.push('ordinary-select'), () => calls.push('character-select'), panel,
            new Map(leasedRoot ? [[object, { channels: { root: true } }]] : []), controls, { visible: false }, mode => calls.push(mode), () => calls.push('controller-update'))
        const event = { offsetX: 5, offsetY: 6, clientX: 7, clientY: 8, preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') }
        return { handlers, event, calls, controls }
    }
    for (const [direct, performance] of [[true, false], [false, true], [true, true]]) {
        const f = create({ direct, performance, hitEnemy: true }); f.handlers.click(f.event); f.handlers.double(f.event)
        assert.deepEqual(f.calls, [], 'an active editor owns input before selection, hit-test, enemy or transform side effects')
        assert.equal(f.controls.enabled, false)
    }
    const ordinary = create(); ordinary.handlers.click(ordinary.event); assert.deepEqual(ordinary.calls, ['ordinary-select'])
    ordinary.calls.length = 0; ordinary.handlers.double(ordinary.event)
    assert.deepEqual(ordinary.calls, ['character-hit-test', 'character-select', 'character-attach', 'translate', 'prevent', 'stop'])
    const multiple = create({ characterCount: 2 }); multiple.handlers.double(multiple.event)
    assert.deepEqual(multiple.calls, ['enemy-hit-test'], 'multiple characters must not acquire the sole-character gizmo')
    const enemy = create({ characterCount: 2, hitEnemy: true }); enemy.handlers.double(enemy.event)
    assert.deepEqual(enemy.calls, ['enemy-hit-test', 'exact-enemy', 'enemy-attach', 'translate', 'prevent', 'stop'])
    const leased = create({ leasedRoot: true }); leased.handlers.double(leased.event)
    assert.deepEqual(leased.calls, ['character-hit-test', 'character-select', 'prevent', 'stop'])
    assert.equal(leased.controls.enabled, false, 'root placement lease prevents an ordinary transform writer')
})
