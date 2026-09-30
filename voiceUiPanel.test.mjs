import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('voice panel pending delivery can stop and ignores disposed or superseded continuations', async () => {
    const source = await read('./src/viewer/voicePanel.ts')
    const operation = source.slice(source.indexOf('    const runOperation = async ('), source.indexOf('    const closePanel = () =>'))
    const stop = source.match(/elements\.stop\.onclick = \(\) => \{([\s\S]*?)\n    \}/)?.[1]
    assert.ok(operation && stop)
    assert.doesNotMatch(source.match(/elements\.stop\.disabled = ([^\n]+)/)?.[1] ?? '', /operationPending/)
    const compiled = ts.transpileModule(`(() => {
        let disposed = false, operationPending = false, operationGeneration = 0;
        let voice = { snapshot: {status: 'loading'}, stop() {this.snapshot.status = 'idle'}, setAutoSequence() {} };
        let snapshot = null, renders = 0, status = null;
        const renderControls = () => {}, renderAll = () => {renders++};
        const setOperationStatus = (...args) => {status = args.join(':')};
        ${operation}
        return {runOperation, stop: () => {${stop}}, dispose: () => {disposed = true; voice = null},
            state: () => ({operationPending, renders, status, snapshot})};
    })()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    for (const action of ['dispose', 'stop']) {
        for (const outcome of ['resolve', 'reject']) {
            const panel = runInNewContext(compiled)
            let resolve, reject
            const pending = new Promise((done, fail) => {resolve = done; reject = fail})
            const operation = panel.runOperation('loading', 'played', () => pending)
            panel[action]()
            const prior = panel.state()
            if (action === 'stop') {
                assert.equal(prior.operationPending, false)
                assert.equal(prior.status, 'Voice playback stopped')
            }
            if (outcome === 'resolve') resolve(false)
            else reject(new Error('STALE_DELIVERY'))
            await operation
            assert.equal(panel.state().status, prior.status)
            assert.equal(panel.state().renders, prior.renders)
        }
    }
    const panel = runInNewContext(compiled)
    await panel.runOperation('loading', 'played', async () => {throw new Error('CURRENT_ERROR')})
    assert.match(panel.state().status, /Voice operation failed:.*CURRENT_ERROR/)
    assert.equal(panel.state().operationPending, false)
})

test('voice panel copies the Demo board-voice structure and exact language choices', async () => {
    const html = await read('./index.html')

    for (const id of [
        'voice-panel-toggle',
        'voice-panel',
        'voice-panel-title',
        'voice-panel-close',
        'voice-subtitle-mode-label',
        'voice-subtitle-mode',
        'voice-subtitle-toggle',
        'voice-subtitle-toggle-label',
        'voice-motion-toggle',
        'voice-motion-toggle-label',
        'voice-expression-toggle',
        'voice-expression-toggle-label',
        'voice-subtitle-status',
        'voice-list',
        'voice-catalog-status',
        'voice-transport',
        'voice-previous',
        'voice-play',
        'voice-play-queue',
        'voice-pause',
        'voice-resume',
        'voice-stop',
        'voice-next',
        'voice-progress',
        'voice-progress-value',
        'voice-runtime-status',
        'voice-operation-status',
        'voice-subtitle-overlay',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `missing voice UI control: ${id}`)
    }

    assert.match(html, /id="voice-panel-title">看板语音</)
    assert.match(html, /class="voice-toolbar"[\s\S]*?字幕语言:[\s\S]*?id="voice-subtitle-mode"[\s\S]*?<option value="zh-Hans" selected>中文<\/option>[\s\S]*?<option value="ja-Jpan">日本語<\/option>[\s\S]*?<option value="en-Latn">English<\/option>[\s\S]*?id="voice-stop"[\s\S]*?id="voice-play-queue"/)
    const languageSelect = html.match(/<select id="voice-subtitle-mode"[\s\S]*?<\/select>/)?.[0] ?? ''
    assert.doesNotMatch(languageSelect, /value="off"|>OFF</)
    assert.match(html, /id="voice-subtitle-toggle" type="checkbox" checked>[\s\S]*?显示字幕/)
    assert.match(html, /id="voice-motion-toggle" type="checkbox" checked>[\s\S]*?跟随原始动作/)
    assert.match(html, /id="voice-expression-toggle" type="checkbox" checked>[\s\S]*?跟随原始表情/)
    assert.match(html, /<div id="voice-list" class="voice-list" role="list"/)
    assert.doesNotMatch(html, /<select id="voice-list"|voice-selection-card|voice-auto-sequence/)
    assert.match(html, /class="voice-panel-resize-handle"/)
    assert.match(html, /class="voice-panel-footer"/)
})

test('voice panel exposes compact typed multitrack UI for every loaded character and multiple backgrounds', async () => {
    const html = await read('./index.html')
    const panel = await read('./src/viewer/voicePanel.ts')
    const viewer = await read('./src/viewer/index.ts')
    const locomotion = await read('./src/viewer/viewerLocomotion.ts')
    const runtime = await read('./src/viewer/voiceWorkspaceRuntime.ts')
    const workspace = await read('./src/viewer/voice/uploadWorkspace.ts')
    const style = await read('./src/viewer/style/viewer.css')
    const chinese = await read('./src/viewer/localization/zhCN.ts')
    const japanese = await read('./src/viewer/localization/jaJP.ts')

    for (const id of [
        'voice-multitrack-section',
        'voice-multitrack-summary',
        'voice-workspace-body',
        'voice-character-tracks-title',
        'voice-character-tracks',
        'voice-background-tracks-title',
        'voice-background-track-add',
        'voice-background-track-file',
        'voice-background-tracks',
        'voice-background-lipsync-note',
        'voice-workspace-status',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `missing multitrack UI control: ${id}`)
    }
    assert.match(html, /id="voice-background-track-file"[^>]*type="file"[^>]*accept="\.ogg,\.flac,\.wav,\.mp3"/)
    assert.match(html, /<details[^>]*id="voice-multitrack-section"/)
    assert.doesNotMatch(html, /id="voice-multitrack-section"[^>]*\bopen\b/, 'Secondary multitrack controls start collapsed in the compact panel')
    assert.match(html, /id="voice-workspace-body"[^>]*role="listbox"[^>]*tabindex="0"/)
    assert.match(html, /id="voice-list" class="voice-list"/, 'official voice catalog must remain in the same panel')

    assert.match(panel, /VOICE_UPLOAD_ACCEPT,[\s\S]*export const VOICE_MULTITRACK_AUDIO_ACCEPT = VOICE_UPLOAD_ACCEPT/)
    assert.match(panel, /export interface VoicePanelWorkspaceCharacter \{[\s\S]*actorKey: string[\s\S]*characterResourceId: string[\s\S]*target: VoiceCharacterTarget/)
    assert.match(panel, /export interface VoicePanelWorkspaceTrackSnapshot \{[\s\S]*kind: VoicePanelWorkspaceTrackKind[\s\S]*positionSeconds: number[\s\S]*durationSeconds: number[\s\S]*volume: number[\s\S]*loop: boolean[\s\S]*lipSync: boolean/)
    assert.match(panel, /export interface VoicePanelWorkspaceRuntime \{[\s\S]*snapshot\(\)[\s\S]*subscribe\(listener:[\s\S]*setCharacters\?\(characters:[\s\S]*uploadCharacterTrack\([\s\S]*uploadBackgroundTrack\([\s\S]*dispatch\(command:/)
    assert.match(panel, /export function setupVoicePanel\(options: VoicePanelOptions = \{\}\)/)
    assert.match(panel, /setWorkspaceCharacters\(characters\)[\s\S]*workspaceCharacters = \[\.\.\.characters\][\s\S]*renderWorkspace\(\)/)
    assert.match(panel, /options\.workspaceRuntime\?\.setCharacters\?\.\(workspaceCharacters\)/)
    assert.match(panel, /for \(const character of workspaceCharacters\)[\s\S]*workspaceTrackForCharacter\(character\.actorKey\)[\s\S]*voice-workspace-character-track/)
    assert.match(panel, /workspaceTracks\.filter\(track => track\.kind === 'background'\)[\s\S]*for \(const \[index, track\] of backgroundTracks\.entries\(\)\)/)
    assert.match(panel, /uploadCharacterTrack\(character, file\)/)
    assert.match(panel, /uploadBackgroundTrack\(file\)/)
    assert.match(panel, /setBeforeCharacterPlay\?\([\s\S]*stopCharacterForTarget\?\([\s\S]*update\?\(deltaSeconds:[\s\S]*dispose\?\(\)/)
    assert.match(panel, /beforePlayback: async \(_entry, target\)[\s\S]*stopCharacterForTarget\?\.\(target\)/)
    assert.match(panel, /setBeforeCharacterPlay\?\.\(\(\) => \{[\s\S]*setOperationStatus\('Voice playback stopped'\)/)
    assert.match(panel, /workspaceRuntime\?\.update\?\.\(deltaSeconds\)/)
    assert.match(panel, /workspaceRuntime\?\.dispose\?\.\(\)/)
    for (const command of ['play', 'pause', 'stop', 'remove', 'seek', 'volume', 'loop', 'lip-sync']) {
        assert.match(panel, new RegExp(`type: '${command}'`), `missing typed multitrack command: ${command}`)
    }
    assert.doesNotMatch(panel, /AudioContext|AudioNode|createGain|decodeAudioData|createMediaElementSource/)

    assert.match(runtime, /export class ViewerVoiceWorkspaceRuntime implements VoicePanelWorkspaceRuntime/)
    assert.match(runtime, /new VoiceUploadWorkspace\(/)
    assert.match(runtime, /uploadCharacterTrack\([\s\S]*loadCharacterFile\(/)
    assert.match(runtime, /uploadBackgroundTrack\([\s\S]*addBackgroundFile\(/)
    assert.match(runtime, /stopCharacterForTarget\(target/)
    assert.match(workspace, /DemoMultiwaveLipSync/)
    assert.match(workspace, /for \(const track of this\.characterTracks\.values\(\)\)/)
    assert.match(workspace, /track\.kind === 'background'[\s\S]*analyser: null/)

    assert.match(viewer, /scene\.characters\.flatMap\(sceneCharacter => \{[\s\S]*actorKey: character\.object\.uuid[\s\S]*characterResourceId: String\(character\.userData\.characterId \?\? ''\)[\s\S]*target: character/)
    assert.match(viewer, /voicePanelController\?\.setWorkspaceCharacters\(workspaceCharacters\)[\s\S]*voicePanelController\?\.setCharacter\(/)
    const camera = await read('./src/viewer/ThirdPersonCamera.ts')
    assert.match(locomotion, /tpsCamera\.install\(\)/, 'the current TPS owner must be installed')
    assert.match(camera, /\[role="listbox"\]/, 'workspace listbox must bypass the TPS camera wheel consumer')
    assert.match(camera, /this\.isControl\(event\.target\)/, 'the control filter must actually guard pointer and wheel listeners')

    assert.match(panel, /workspaceBody: requireElement<HTMLElement>\('voice-workspace-body'\)/)
    assert.match(panel, /elements\.workspaceBody\.setAttribute\('aria-label', translateUiText\('Multitrack audio'\)\)/)
    assert.match(style, /\.voice-workspace-section\s*\{[^}]*max-height:\s*none[^}]*overflow:\s*visible/)
    assert.match(style, /\.voice-workspace-body\s*\{[^}]*max-height:\s*clamp\(180px, 38dvh, 420px\)[^}]*overflow-y:\s*scroll[^}]*overscroll-behavior-y:\s*auto[^}]*touch-action:\s*pan-y/)
    assert.match(style, /\.voice-workspace-actions\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/)
    assert.match(style, /body\.theme-light \.voice-workspace-section/)

    for (const [key, zh, ja] of [
        ['Multitrack audio', '多音轨', 'マルチトラック音声'],
        ['Character tracks', '角色音轨', 'キャラクター音声トラック'],
        ['Background tracks', '背景音轨', '背景音声トラック'],
        ['Upload audio', '上传音频', '音声をアップロード'],
        ['Add background track', '添加背景音轨', '背景音声トラックを追加'],
        ['Lip sync', '口型同步', 'リップシンク'],
    ]) {
        assert.ok(chinese.includes(`'${key}': '${zh}'`), `missing zh-CN multitrack label: ${key}`)
        assert.ok(japanese.includes(`"${key}": "${ja}"`), `missing ja-JP multitrack label: ${key}`)
    }
})

test('open voice panel rerenders every UI label and canonical operation status on live locale changes', async () => {
    const panel = await read('./src/viewer/voicePanel.ts')
    const chinese = await read('./src/viewer/localization/zhCN.ts')
    const japanese = await read('./src/viewer/localization/jaJP.ts')

    const directBindings = [
        ['stop', 'Stop'],
        ['queue', 'Play sequence'],
        ['previous', 'Previous'],
        ['play', 'Play'],
        ['pause', 'Pause'],
        ['resume', 'Resume'],
        ['next', 'Next'],
    ]
    for (const [element, key] of directBindings) {
        assert.match(panel, new RegExp(`elements\\.${element}\\.textContent = .*translateUiText\\('${key}'\\)`), `missing live label binding: ${key}`)
        assert.match(chinese, new RegExp(`'${key.replaceAll("'", "\\'")}':`), `missing zh-CN label: ${key}`)
        assert.match(japanese, new RegExp(`"${key.replaceAll('"', '\\"')}":`), `missing ja-JP label: ${key}`)
    }
    const namedBindings = [
        ['subtitleLanguageLabel', 'subtitleModeLabel', 'Subtitle language'],
        ['showSubtitlesLabel', 'subtitleToggleLabel', 'Show subtitles'],
        ['followMotionLabel', 'motionToggleLabel', 'Follow original motion'],
        ['followExpressionLabel', 'expressionToggleLabel', 'Follow original expression'],
    ]
    for (const [variable, element, key] of namedBindings) {
        assert.match(panel, new RegExp(`const ${variable} = translateUiText\\('${key}'\\)`), `missing translated variable: ${key}`)
        assert.match(panel, new RegExp(`elements\\.${element}\\.textContent = .*${variable}`), `missing live label target: ${key}`)
        assert.match(chinese, new RegExp(`'${key.replaceAll("'", "\\'")}':`), `missing zh-CN label: ${key}`)
        assert.match(japanese, new RegExp(`"${key.replaceAll('"', '\\"')}":`), `missing ja-JP label: ${key}`)
    }

    assert.match(panel, /const renderUiLabels = \(\) => \{/)
    assert.match(panel, /const renderAll = \(\) => \{[\s\S]*renderUiLabels\(\)[\s\S]*renderOperationStatus\(\)/)
    assert.match(panel, /const localeListener = \(\) => renderAll\(\)[\s\S]*document\.addEventListener\('magius:localechange', localeListener\)/)
    assert.match(panel, /let operationStatusKey: string \| null = null/)
    assert.match(panel, /const translated = translateUiText\(operationStatusKey\)/)
    assert.match(panel, /setOperationStatus\('Voice catalog ready'\)/)
    assert.doesNotMatch(panel, /operationStatus\.textContent = translateUiText\('Voice catalog ready'\)/)
    assert.match(panel, /const subtitle = mode === 'off' \? null : state\?\.text \?\? null/)
    assert.match(panel, /elements\.subtitle\.textContent = subtitle \?\? ''/)
    assert.doesNotMatch(panel, /translateUiText\(subtitle\)/)

    assert.match(japanese, /"Voice catalog ready": "ボイス一覧の準備ができました"/)
    assert.match(japanese, /"Play sequence": "順次再生"/)
    assert.match(japanese, /"Follow original motion": "元のモーションに追従"/)
    assert.match(japanese, /"Follow original expression": "元の表情に追従"/)
})

test('voice cards consume exact companion rows and leave missing duration blank', async () => {
    const panel = await read('./src/viewer/voicePanel.ts')
    const manifest = JSON.parse(await read('./artifacts/research/20260827-voice-scenario-source-ready/manifest.v1.json'))

    assert.equal(manifest.schema, 'magius.voice-scenario.v1')
    assert.equal(manifest.entries.length, 1302)
    assert.equal(manifest.counts.sourceEntries['zh-Hans'], 1106)
    assert.equal(manifest.counts.sourceMissing['zh-Hans'], 196)
    assert.equal(manifest.counts.sourceEntries['ja-Jpan'], 1302)
    assert.equal(manifest.counts.sourceEntries['en-Latn'], 1302)

    const unicodeCue = manifest.entries.find(entry => entry.sourceStableKey.endsWith('cueName=cv_100101_other_evo_fee_01'))
    assert.equal(unicodeCue.reactionSources['zh-Hans'].rows[0].Comment, '呐，丘比。')
    assert.equal(unicodeCue.reactionSources['ja-Jpan'].rows[0].Comment, 'ねぇ、キュゥべえ')
    assert.equal(unicodeCue.reactionSources['en-Latn'].rows[0].Comment, 'Hey, Kyubey.')
    assert.doesNotMatch(JSON.stringify(unicodeCue), /友之﹜平亙孕屯尹/)

    const missingSimplifiedCue = manifest.entries.find(entry => !entry.reactionSources['zh-Hans'].runtimeReady)
    assert.ok(missingSimplifiedCue)
    assert.equal(missingSimplifiedCue.reactionSources['ja-Jpan'].runtimeReady, true)

    assert.match(panel, /const VOICE_SUBTITLE_LANGUAGES = \['zh-Hans', 'ja-Jpan', 'en-Latn'\] as const/)
    assert.match(panel, /fetchVoiceScenarioManifest\(undefined, fetchAbort\.signal\)/)
    assert.match(panel, /entry\.reactionSources\[requestedLocale\]/)
    assert.match(panel, /if \(!source\.runtimeReady\)/)
    assert.doesNotMatch(panel, /requestedLocale === 'zh-Hant'/)
    assert.doesNotMatch(panel, /fallbackApplied \? 'ja-Jpan'/)
    assert.match(panel, /row\.ActionType === 'Talk' && typeof row\.Comment === 'string'/)
    assert.match(panel, /normalizePreviewComment\(row\.Comment!\)/)
    assert.match(panel, /resolvedLocale: requestedLocale,[\s\S]*fallbackApplied: false,[\s\S]*reason: null/)
    assert.match(panel, /duration\.textContent = formatVoiceDuration\(entry\)/)
    assert.match(panel, /typeof duration === 'number'[\s\S]*duration > 0[\s\S]*duration\.toFixed\(1\)/)
    assert.match(panel, /voiceCharacterDisplayName\(pendingCharacterId\)/)
    assert.match(panel, /const officialName = uiLocale === 'ja-JP' \? names\.ja : uiLocale === 'en' \? names\.romaji : names\.zh/)
    assert.match(panel, /item\.dataset\.requestedLocale = preview\.requestedLocale/)
    assert.match(panel, /item\.dataset\.resolvedLocale = preview\.resolvedLocale \?\? ''/)
    assert.match(panel, /item\.dataset\.fallbackApplied = String\(preview\.fallbackApplied\)/)
    assert.match(panel, /loadScenarioCatalog: async \(\) => scenarioResult\.value/)
    assert.match(panel, /import \{ resolveRuntimeVoiceUrl \} from '\.\/runtimeProductDelivery'/)
    assert.match(panel, /resolveRuntimeUrl: entry => resolveRuntimeVoiceUrl\(entry, \{[\s\S]*audioBaseUrl: AUDIO_BASE_OVERRIDE,[\s\S]*signal: fetchAbort\.signal/)
    assert.doesNotMatch(panel, /AUDIO_BASE_OVERRIDE\s*\? reference/)
    assert.doesNotMatch(panel, /Madoka Magica Magia Exedra Steam JP|Steam-JP/)
})

test('single play, queue, transport, subtitle visibility, motion and expression are independently wired', async () => {
    const viewer = await read('./src/viewer/index.ts')
    const panel = await read('./src/viewer/voicePanel.ts')

    assert.match(viewer, /import \{ setupVoicePanel, type VoicePanelController, type VoicePanelWorkspaceCharacter \} from '\.\/voicePanel'/)
    assert.match(viewer, /createViewerVoiceWorkspaceRuntime/)
    assert.match(viewer, /voicePanelController = setupVoicePanel\(\{[\s\S]*workspaceRuntime: createViewerVoiceWorkspaceRuntime\(\)[\s\S]*\}\)[\s\S]*syncVoiceCharacter\(\)/)
    assert.match(viewer, /voicePanelController\?\.setCharacter\(null, null\)[\s\S]*disposeCharacterActionPlayback\(\)/)
    assert.match(viewer, /voicePanelController\?\.update\(\)/)
    assert.match(viewer, /onPermanentPageExit\([\s\S]*voicePanelController\?\.dispose\(\)/)

    assert.match(panel, /voice\?\.setScenarioOptions\(options\)/)
    assert.match(panel, /useMotion: elements\.motionToggle\.checked/)
    assert.match(panel, /useExpression: elements\.expressionToggle\.checked/)
    assert.match(panel, /elements\.motionToggle\.onchange = scenarioOptionsChanged/)
    assert.match(panel, /elements\.expressionToggle\.onchange = scenarioOptionsChanged/)
    assert.match(panel, /voice\.setAutoSequence\(false\)[\s\S]*applyScenarioOptions\(\)[\s\S]*voice!\.playStableKey\(entry\.stableKey\)/)
    assert.match(panel, /applyScenarioOptions\(\)[\s\S]*voice!\.playQueue\(index\)/)
    assert.match(panel, /next\.autoSequence[\s\S]*next\.status === 'idle'[\s\S]*next\.currentIndex \+ 1 < next\.trackCount[\s\S]*applyScenarioOptions\(\)/)
    assert.match(panel, /voice!\.previous\(\)/)
    assert.match(panel, /voice!\.next\(\)/)
    assert.match(panel, /voice\?\.pause\(\)/)
    assert.match(panel, /voice!\.resume\(\)/)
    assert.match(panel, /voice\.seek\(Number\(elements\.progress\.value\)\)/)
    assert.match(panel, /voice\?\.setAutoSequence\(false\)[\s\S]*voice\?\.stop\(\)/)
    const closePanelBinding = panel.match(/const closePanel = \(\) => \{[\s\S]*?renderAll\(\)\s*\}/)?.[0] ?? ''
    assert.match(closePanelBinding, /setOpen\(false\)/)
    assert.match(closePanelBinding, /renderAll\(\)/)
    assert.doesNotMatch(closePanelBinding, /setAutoSequence|\.stop\(|snapshot\s*=/)
    assert.match(panel, /saveSubtitleLanguage\(subtitleLanguage\)[\s\S]*voice\?\.setAutoSequence\(false\)[\s\S]*voice\?\.stop\(\)/)
    assert.match(panel, /const mode = activeSubtitleMode\(\)/)
    assert.match(panel, /elements\.subtitleToggle\.checked \? subtitleLanguage : 'off'/)
    assert.match(panel, /elements\.subtitle\.hidden = mode === 'off' \|\| subtitle === null/)
    assert.match(panel, /const selectedSourceMissing = hasCurrentVoice && selectedSource\?\.runtimeReady === false/)
    assert.match(panel, /const showResolution = mode !== 'off' && selectedSourceMissing/)
    assert.match(panel, /elements\.subtitleStatus\.hidden = !showResolution/)
    assert.doesNotMatch(panel, /state\?\.status === 'unavailable'/)
    assert.match(panel, /elements\.panel\.dataset\.analysisMode = state\?\.analysisMode \?\? ''/)
    assert.match(panel, /elements\.panel\.dataset\.scenarioMotion = state\?\.scenario\.motion \?\? ''/)
    assert.match(panel, /elements\.panel\.dataset\.scenarioExpression = state\?\.scenario\.faceType \?\? ''/)
    assert.match(panel, /elements\.panel\.dataset\.scenarioMotionApplied = String\(state\?\.scenario\.motionApplied \?\? false\)/)
    assert.match(panel, /elements\.panel\.dataset\.scenarioExpressionApplied = String\(state\?\.scenario\.faceApplied \?\? false\)/)
})

test('panel can move fully offscreen, retaining footer drag and both resize corners', async () => {
    const panel = await read('./src/viewer/voicePanel.ts')
    const style = await read('./src/viewer/style/viewer.css')

    assert.match(panel, /export function clampVoicePanelRect/)
    assert.match(panel, /export const VOICE_PANEL_VISIBLE_GRIP = 48 as const/)
    assert.match(panel, /export function clampVoicePanelDragRect/)
    assert.match(panel, /left: rect\.left, top: rect\.top/)
    assert.match(panel, /setupFloatingPanelResize\(panel, 'nw'\)/)
    assert.match(panel, /const userPositioned = panel\.dataset\.panelUserPositioned === 'true'/)
    assert.match(panel, /\? clampVoicePanelDragRect\(current, window\.innerWidth, window\.innerHeight\)/)
    assert.match(panel, /const next = clampVoicePanelDragRect\(\{/)
    assert.match(panel, /attachDragHandle\(elements\.header, true\)/)
    assert.match(panel, /attachDragHandle\(elements\.footer, false\)/)
    assert.match(panel, /elements\.resizeHandle\.addEventListener\('pointerdown'/)
    assert.match(panel, /setPointerCapture\(event\.pointerId\)/)
    assert.match(panel, /window\.addEventListener\('resize', \(\) => ensureVoicePanelInViewport\(panel\)/)
    assert.match(panel, /requestAnimationFrame\(\(\) => ensureVoicePanelInViewport\(elements\.panel\)\)/)

    assert.match(style, /#voice-panel\s*\{[^}]*width:\s*min\(520px, 82vw\)[^}]*height:\s*min\(650px, 72dvh\)[^}]*min-height:\s*220px[^}]*resize:\s*none/)
    assert.match(style, /#voice-panel\s*\{[^}]*background:\s*rgba\(22, 22, 35, 0\.88\)[^}]*border-radius:\s*8px[^}]*backdrop-filter:\s*blur\(16px\) saturate\(1\.3\)/)
    assert.match(style, /#voice-panel \.voice-panel-header\s*\{[^}]*padding:\s*6px 10px[^}]*background:\s*rgba\(255, 255, 255, 0\.06\)/)
    assert.match(style, /#voice-panel \.floating-panel-close\s*\{[^}]*width:\s*24px[^}]*height:\s*24px[^}]*border-radius:\s*3px[^}]*font-size:\s*14px/)
    assert.match(style, /\.voice-panel-content\s*\{[^}]*display:\s*flex[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/)
    assert.match(style, /\.voice-list\s*\{[^}]*min-height:\s*clamp\(96px, 18dvh, 180px\)[^}]*flex:\s*1 1 0[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/)
    assert.match(style, /\.voice-panel-resize-handle\s*\{[^}]*cursor:\s*nwse-resize/)
    assert.match(style, /\.voice-panel-footer\s*\{[^}]*cursor:\s*grab/)
})

test('offscreen drag helper preserves all user requested offscreen positions', async () => {
    const panel = await read('./src/viewer/voicePanel.ts')
    const helperMatch = panel.match(/export function clampVoicePanelDragRect\([\s\S]*?function readPanelRect/)
    assert.ok(helperMatch, 'missing executable offscreen drag helper')
    const helperSource = helperMatch[0].replace(/function readPanelRect$/, '').replace(/^export /, '')
    const typescriptModule = await import('typescript')
    const typescript = typescriptModule.default ?? typescriptModule
    const compiled = typescript.transpileModule(
        `const VOICE_PANEL_VISIBLE_GRIP = 48;
${helperSource}
globalThis.__clampVoicePanelDragRect = clampVoicePanelDragRect;`,
        { compilerOptions: { target: typescript.ScriptTarget.ES2020 } },
    ).outputText
    const sandbox = {}
    runInNewContext(compiled, sandbox)
    const clamp = sandbox.__clampVoicePanelDragRect
    assert.equal(typeof clamp, 'function')

    const parkedTopLeft = clamp({ left: -999, top: -999, width: 520, height: 650 }, 1000, 800)
    assert.equal(parkedTopLeft.left, -999)
    assert.equal(parkedTopLeft.top, -999)
    assert.equal(parkedTopLeft.width, 520)
    assert.equal(parkedTopLeft.height, 650)

    const parkedBottomRight = clamp({ left: 9999, top: 9999, width: 520, height: 650 }, 1000, 800)
    assert.equal(parkedBottomRight.left, 9999)
    assert.equal(parkedBottomRight.top, 9999)
})

test('voice panel follows Viewer day/night theme and official presentation fonts', async () => {
    const panel = await read('./src/viewer/voicePanel.ts')
    const style = await read('./src/viewer/style/viewer.css')
    const presentation = await read('./src/viewer/voice/presentation.ts')

    assert.match(style, /body\.theme-light \.voice-toolbar select/)
    assert.match(style, /body\.theme-light \.voice-item/)
    assert.match(style, /body\.theme-light \.voice-item\.playing/)
    assert.match(style, /body\.theme-light #voice-panel\s*\{[^}]*background:\s*rgba\(242, 242, 248, 0\.92\)/)
    assert.match(style, /body\.theme-light #voice-panel \.voice-panel-header\s*\{[^}]*background:\s*rgba\(230, 230, 238, 0\.95\)/)
    assert.match(style, /body\.theme-light #voice-panel \.floating-panel-close/)
    assert.match(style, /\.voice-item-text\[data-resolved-locale='zh-Hans'\],[\s\S]*\.voice-item-text\[data-resolved-locale='zh-Hant'\][\s\S]*MagiReaderExedraTangYuan/)
    assert.match(style, /\.voice-item-text\[data-resolved-locale='ja-Jpan'\][\s\S]*MagiReaderExedraTsukuOldGothic/)
    assert.match(style, /\.voice-item-text\[data-resolved-locale='en-Latn'\][\s\S]*MagiReaderExedraLiberationSans/)
    assert.match(style, /#voice-subtitle-overlay\s*\{[^}]*padding:\s*0[^}]*background:\s*transparent[^}]*border:\s*0[^}]*box-shadow:\s*none[^}]*text-shadow:[^}]*-webkit-text-stroke:/)
    assert.match(panel, /elements\.subtitle\.dataset\.voiceSubtitleSourceRegion = state\?\.sourceRegion \?\? ''/)
    assert.match(panel, /elements\.subtitle\.lang = state\?\.resolvedLocale/)
    assert.match(panel, /elements\.panel\.lang = getUiLocale\(\)/)
    assert.match(presentation, /label: '猫啃网糖圆体'/)
    assert.match(presentation, /label: 'FOT-TsukuOldGothic Std B'/)
    assert.match(presentation, /label: 'FOT-NewCinemaA Std D'/)
    assert.match(presentation, /family: 'MagiReaderExedraLiberationSans'[\s\S]*label: 'Liberation Sans'/)
})

test('new Demo labels are part of the Viewer localization contract', async () => {
    const localization = await read('./src/viewer/localization/zhCN.ts')
    for (const key of [
        "'Home voice': '看板语音'",
        "'Subtitle language': '字幕语言'",
        "'Show subtitles': '显示字幕'",
        "'Follow original motion': '跟随原始动作'",
        "'Follow original expression': '跟随原始表情'",
        "'Play sequence': '顺序播放'",
        "'multiwave': '多波合成'",
        "'official-binary': '官方二态'",
    ]) {
        assert.ok(localization.includes(key), `missing voice localization: ${key}`)
    }
})
