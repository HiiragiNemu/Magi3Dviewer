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
    assert.match(html, /id="menu-collapse-toggle"/)
    assert.match(html, /id="menu-collapse-toggle"[^>]*data-i18n-ignore="true"/)
    assert.match(html, /id="render-settings-toggle"[^>]*data-i18n-ignore="true"/)
    assert.match(html, /id="position-controls-toggle"[^>]*data-i18n-ignore="true"/)
    assert.match(html, /aria-controls="menu-controls"/)
    assert.doesNotMatch(html, /demo-screenshot|demo\.jpg/)
    assert.doesNotMatch(html, /stage-fidelity|Stage fidelity \/ evidence|场景还原度/)
    assert.match(html, /<button id="camera-save-download">Download<\/button>/)
    await assert.rejects(read('./public/demo.jpg'))
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
        "'Char Only': '仅角色'",
        "'Rec/BG': '录制/BG'",
        "'Tilt character left': '角色左倾'",
        "'Enter VR': '进入 VR'",
        "Smile: '微笑'",
        "'Default face': '默认表情'",
        "HomeWait01: '看板待机 1'",
        "StandbyTransition: '战斗准备过渡'",
        "'Direct drag pose': '直接拖拽编辑动作'",
        "'Common body controls': '常用肢体设置'",
        "'Common expression controls': '常用表情设置'",
    ]) {
        assert.ok(localization.includes(expected), `missing localization: ${expected}`)
    }

    assert.match(localization, /English remains the canonical UI key/)
    assert.match(localization, /localStorage\.setItem\(LOCALE_STORAGE_KEY, locale\)/)
    assert.match(localization, /navigator\.languages/)
    assert.match(localization, /MutationObserver/)
    assert.match(localization, /element\.getAttribute\(attribute\) !== translated/)
    assert.match(localization, /document\.dispatchEvent\(new CustomEvent\('magius:localechange'/)
    assert.match(localization, /Select values remain the byte-exact/)
    assert.match(localization, /translateOfficialRuntimeOption\(text\)/)
    assert.match(localization, /export function translateBoneChannelLabel\(name: string, locale: UiLocale = currentLocale\)/)
    assert.match(localization, /export function translateMorphChannelLabel\(name: string, locale: UiLocale = currentLocale\)/)
    assert.match(localization, /if \(locale === 'en' \|\| !name\) return name/)
    assert.match(main, /installLocalization\(\)[\s\S]*setupViewer\(\)/)
})

test('controls keep a compact toolbar and an independent viewer movement panel', async () => {
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
        'side-dock',
        'render-settings-toggle',
        'render-settings-close',
        'action-panel-toggle',
        'action-parameter-panel',
        'action-channel-list',
        'action-direct-edit-toggle',
        'action-direct-edit-target',
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
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `missing UI region: ${id}`)
    }
    assert.ok(html.indexOf('id="menu"') < html.indexOf('id="workspace"'))
    assert.ok(html.indexOf('id="viewer"') < html.indexOf('id="position-controls-wrapper"'))
    assert.ok(html.indexOf('id="position-controls-wrapper"') < html.indexOf('id="side-dock"'))
    assert.ok(html.indexOf('id="advanced-controls-dock"') < html.indexOf('id="viewer"'))
    assert.ok(html.indexOf('id="viewer"') < html.indexOf('id="side-dock"'))
    assert.doesNotMatch(html, /stage-fidelity|Stage fidelity \/ evidence|场景还原度/)
    assert.doesNotMatch(styleIndex, /stageFidelity\.css/)

    assert.match(globalStyle, /html,[\s\S]*body,[\s\S]*#app[\s\S]*overflow: hidden/)
    assert.match(viewerStyle, /#app[\s\S]*grid-template-rows: auto minmax\(0, 1fr\)/)
    assert.match(viewerStyle, /#workspace[\s\S]*grid-template-columns:/)
    assert.doesNotMatch(viewerStyle, /body\.advanced-controls-open #workspace/)
    assert.doesNotMatch(viewerStyle, /body\.position-controls-open #workspace/)
    assert.match(viewerStyle, /--side-dock-width: 52px/)
    assert.match(viewerStyle, /grid-template-columns: minmax\(0, 1fr\) var\(--side-dock-width\)/)
    assert.match(viewerStyle, /#viewer[\s\S]*overflow: hidden/)
    assert.match(viewerStyle, /#side-dock/)
    assert.match(panels, /\.floating-panel \{[\s\S]*position: fixed/)
    assert.match(panels, /\.floating-panel\.is-open \{[\s\S]*display: flex/)
    assert.match(panels, /#advanced-controls-dock \{[\s\S]*width:/)
    assert.match(panels, /\.parameter-panel \{[\s\S]*max-height|\.parameter-panel \{[\s\S]*height:/)
    assert.match(panels, /\.direct-pose-toolbar \{[\s\S]*grid-template-columns:/)
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

    assert.match(viewerRuntime, /menu-ui-collapsed/)
    assert.match(viewerRuntime, /advanced-controls-open/)
    assert.match(viewerRuntime, /position-controls-open/)
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
    assert.match(viewerRuntime, /selectDirectPoseBone\(weighted\.object, weighted\.bone\)/)
    assert.match(viewerRuntime, /event\.altKey[\s\S]*entry\.offsets\.y/)
    assert.match(viewerRuntime, /translateBoneChannelLabel/)
    assert.match(viewerRuntime, /translateMorphChannelLabel/)
    assert.match(viewerRuntime, /setupCharacterMovementControls/)
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
