import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createSourceAuthorityFixtureResolver } from './tests/helpers/sourceAuthorityFixturePaths.mjs'
import test from 'node:test'
import zlib from 'node:zlib'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import {
    VoiceCatalog,
    parseVoiceCatalogManifest,
    resolveVoiceSubtitle,
} from './src/viewer/voice/catalog.ts'
import { resolveMouthCarrier } from './src/viewer/voice/mouthCarrier.ts'
import {
    DEMO_LIPSYNC_CONSTANTS,
    DemoMultiwaveLipSync,
    calculateTimeDomainRms,
} from './src/viewer/voice/multiwave.ts'
import {
    VoicePlayer,
    createCriVoiceUrlResolver,
} from './src/viewer/voice/player.ts'
import {
    VoiceScenarioCatalog,
    VoiceScenarioRunner,
    VOICE_SUBTITLE_DEFAULT_MODE,
    VOICE_SUBTITLE_UI_MODES,
    parseVoiceScenarioManifest,
    resolveVoiceScenarioExpressionChannel,
} from './src/viewer/voice/scenario.ts'
import {
    VOICE_FONT_ASSETS,
    VOICE_PRESENTATION_STYLE_ID,
    installVoicePresentation,
    voicePresentationCss,
} from './src/viewer/voice/presentation.ts'

const resolveSourceAuthorityFixture = createSourceAuthorityFixtureResolver()

globalThis.document = {
    createElementNS() {
        return {
            addEventListener() {},
            removeEventListener() {},
            set src(_value) {},
        }
    },
}

const manifestPath = './artifacts/research/20260827-voice-catalog-source-ready/manifest.v1.json'
const officialManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const scenarioManifestPath = './artifacts/research/20260827-voice-scenario-source-ready/manifest.v1.json'
const officialScenarioManifest = JSON.parse(fs.readFileSync(scenarioManifestPath, 'utf8'))

function parseGzipFbx(path) {
    const payload = zlib.gunzipSync(fs.readFileSync(path))
    const bytes = payload.buffer.slice(
        payload.byteOffset,
        payload.byteOffset + payload.byteLength,
    )
    const originalTextureLoad = THREE.TextureLoader.prototype.load
    THREE.TextureLoader.prototype.load = function (_url, onLoad) {
        const texture = new THREE.Texture()
        onLoad?.(texture)
        return texture
    }
    try {
        return new FBXLoader(new THREE.LoadingManager()).parse(bytes, '')
    } finally {
        THREE.TextureLoader.prototype.load = originalTextureLoad
    }
}

function makeMorphRoot({ open = 0, wide = 0, narrow = 0 } = {}) {
    const root = new THREE.Group()
    root.name = 'Root'
    root.userData.animationLoops = []
    root.userData.disposeCallbacks = []
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    mesh.name = 'Face_Mesh'
    mesh.morphTargetDictionary = {
        Eye_Blink: 0,
        Eyebrow_Up: 1,
        Mouth_OpenVertically: 2,
        Mouth_Wide: 3,
        Mouth_Narrow: 4,
    }
    mesh.morphTargetInfluences = [0.25, 0.4, open, wide, narrow]
    root.add(mesh)
    return { root, mesh }
}

test('source-ready official catalog preserves composite keys, order and empty subtitles', () => {
    const manifest = parseVoiceCatalogManifest(officialManifest)
    const catalog = new VoiceCatalog(manifest)
    assert.equal(manifest.entries.length, 1302)
    assert.equal(catalog.characterResourceIds.length, 93)
    assert.equal(catalog.listForCharacter('100101').length, 14)
    assert.equal(catalog.listForCharacter('100305').length, 14)
    assert.equal(catalog.listForCharacter('100805').length, 14)
    assert.deepEqual(
        catalog.listForCharacter('100101').map(entry => entry.order),
        Array.from({ length: 14 }, (_, index) => index + 1),
    )
    assert.equal(
        manifest.entries.filter(entry => entry.audio.runtimeReady).length,
        1302,
    )
    assert.equal(
        manifest.entries.filter(entry => !entry.audio.runtimeReady).length,
        0,
    )
    const first = catalog.listForCharacter('100101')[0]
    assert.match(
        first.stableKey,
        /^soundMstId=\d+\|cueSheetName=cv_100101_outgame\|cueName=cv_100101_/,
    )
    assert.match(
        first.audio.sourceStableKey,
        /^cri-cue:cueSheetName=cv_100101_outgame\|cueName=cv_100101_/,
    )
    assert.equal(resolveVoiceSubtitle(first, 'ja'), null)
    assert.equal(resolveVoiceSubtitle(first, 'zh-Hant'), null)
    assert.equal(first.durationSeconds, undefined)
    const newlyReady = catalog.listForCharacter('100407')
    assert.equal(newlyReady.length, 14)
    assert.ok(newlyReady.every(entry => entry.audio.runtimeReady && entry.audio.runtimeUrl?.endsWith('.ogg')))
})

test('subtitle lookup is exact-locale and never cross-fills another locale', () => {
    const value = structuredClone(officialManifest)
    value.entries = [structuredClone(officialManifest.entries[0])]
    value.entries[0].subtitles = { ja: '公式字幕', 'zh-Hant': '官方字幕' }
    const entry = new VoiceCatalog(value).manifest.entries[0]
    assert.equal(resolveVoiceSubtitle(entry, 'ja'), '公式字幕')
    assert.equal(resolveVoiceSubtitle(entry, 'zh-Hant'), '官方字幕')
    assert.equal(resolveVoiceSubtitle(entry, 'zh'), null)
    assert.equal(resolveVoiceSubtitle(entry, 'en'), null)
})

test('latest wiki adds only exact official gallery cues and preserves retained audio/scenario rows', () => {
    const baselineRoot = './artifacts/verification/20260905-s6-voice-wiki-93-cuesheet-refresh/originals/'
    const baselineVoice = JSON.parse(fs.readFileSync(baselineRoot + manifestPath.slice(2), 'utf8'))
    const baselineScenario = JSON.parse(fs.readFileSync(baselineRoot + scenarioManifestPath.slice(2), 'utf8'))
    const oldVoiceKeys = new Set(baselineVoice.entries.map(entry => entry.stableKey))
    const oldScenarioKeys = new Set(baselineScenario.entries.map(entry => entry.voiceStableKey))
    assert.deepEqual(officialManifest.entries.filter(entry => oldVoiceKeys.has(entry.stableKey)), baselineVoice.entries)
    assert.deepEqual(officialScenarioManifest.entries.filter(entry => oldScenarioKeys.has(entry.voiceStableKey)), baselineScenario.entries)
    const additions = officialManifest.entries.filter(entry => !oldVoiceKeys.has(entry.stableKey))
    assert.equal(additions.length, 14)
    assert.equal(officialManifest.source.wikiRefresh.commit, '6283e0e7822654184be45fd2dbf3e852759501ab')
    assert.equal(officialManifest.counts.voiceEntries, 1302)
    assert.equal(officialManifest.counts.characters, 93)
    const scenarios = new VoiceScenarioCatalog(officialScenarioManifest)
    const rawScenarios = new Map(officialScenarioManifest.entries.map(entry => [entry.voiceStableKey, entry]))
    for (const voice of additions) {
        const match = /^soundMstId=(\d+)\|cueSheetName=([^|]+)\|cueName=(.+)$/.exec(voice.stableKey)
        assert.ok(match)
        assert.equal(voice.audio.sourceStableKey, `cri-cue:cueSheetName=${match[2]}|cueName=${match[3]}`)
        assert.equal(fs.readFileSync(resolveSourceAuthorityFixture(new URL(voice.audio.runtimeUrl))).subarray(0, 4).toString('ascii'), 'OggS')
        assert.deepEqual(voice.subtitles, {})
        const scenario = scenarios.getForVoice(voice)
        const raw = rawScenarios.get(voice.stableKey)
        assert.equal(scenario.sourceStableKey, voice.audio.sourceStableKey)
        assert.equal(scenario.characterResourceId, voice.characterResourceId)
        assert.equal(scenario.order, voice.order)
        for (const locale of ['ja-Jpan', 'en-Latn']) {
            const source = raw.reactionSources[locale]
            assert.equal(source.runtimeReady, true)
            const document = JSON.parse(fs.readFileSync(resolveSourceAuthorityFixture(new URL(source.sourceFile)), 'utf8'))
            const originalRows = document.sheetList.flatMap(sheet => sheet.contentRowList
                .filter(row => !row.isHeader && !row.isBlank && !row.isComment)
                .map(row => ({rowNumber: row.rowNumber, ...Object.fromEntries(sheet.headerRow.cellList.map((name, index) => [name, row.cellList[index]]))})))
            for (const row of source.rows) {
                const original = originalRows.find(value => value.rowNumber === row.rowNumber)
                assert.ok(original)
                for (const [field, value] of Object.entries(row)) assert.equal(value, original[field], `${voice.stableKey}:${locale}:${field}`)
            }
        }
        for (const locale of ['zh-Hans', 'zh-Hant']) {
            assert.equal(raw.reactionSources[locale].runtimeReady, false)
            assert.equal(raw.reactionSources[locale].sourceFile, undefined)
            assert.deepEqual(raw.reactionSources[locale].rows, [])
            assert.ok(raw.reactionSources[locale].failClosedReasons.length)
        }
    }
})

test('official Reaction companion joins all 1302 keys and preserves raw multilingual row fields', () => {
    const manifest = parseVoiceScenarioManifest(officialScenarioManifest)
    const catalog = new VoiceScenarioCatalog(manifest)
    const voiceCatalog = new VoiceCatalog(officialManifest)
    assert.equal(manifest.entries.length, 1302)
    assert.equal(manifest.entries.filter(entry => entry.runtimeReady).length, 1302)
    assert.equal(manifest.entries.filter(entry => !entry.runtimeReady).length, 0)
    assert.equal(
        manifest.entries.reduce((sum, entry) => sum + entry.rows.length, 0),
        3884,
    )
    assert.equal(manifest.counts.readyCharacters, 93)
    assert.deepEqual(manifest.counts.sourceEntries, {
        'ja-Jpan': 1302,
        'en-Latn': 1302,
        'zh-Hant': 1008,
        'zh-Hans': 1106,
    })
    assert.deepEqual(manifest.counts.sourceMissing, {
        'ja-Jpan': 0,
        'en-Latn': 0,
        'zh-Hant': 294,
        'zh-Hans': 196,
    })
    assert.deepEqual(manifest.counts.sourceRows, {
        'ja-Jpan': 3884,
        'en-Latn': 3884,
        'zh-Hant': 2934,
        'zh-Hans': 3237,
    })
    assert.deepEqual(manifest.counts.talkRows, {
        'ja-Jpan': 3818,
        'en-Latn': 3818,
        'zh-Hant': 2874,
        'zh-Hans': 3177,
    })
    assert.equal(manifest.counts.zhHantFallbackCues, 294)
    assert.equal(manifest.counts.zhHansExactCues, 1106)
    assert.equal(manifest.counts.zhHansMissingCues, 196)
    const firstVoice = voiceCatalog.listForCharacter('100101')[0]
    const firstScenario = catalog.getForVoice(firstVoice)
    assert.equal(firstScenario.runtimeReady, true)
    assert.equal(firstScenario.characterResourceId, firstVoice.characterResourceId)
    assert.equal(firstScenario.order, firstVoice.order)
    assert.equal(firstScenario.sourceStableKey, firstVoice.audio.sourceStableKey)
    assert.equal(firstScenario.reactionSources['ja-Jpan'].runtimeReady, true)
    assert.equal(firstScenario.reactionSources['en-Latn'].runtimeReady, true)
    assert.equal(firstScenario.reactionSources['zh-Hant'].runtimeReady, true)
    assert.equal(firstScenario.reactionSources['zh-Hans'].runtimeReady, true)
    assert.equal(firstScenario.reactionSources['ja-Jpan'].sourceRegion, 'JP')
    assert.equal(firstScenario.reactionSources['en-Latn'].sourceRegion, 'JP')
    assert.equal(firstScenario.reactionSources['zh-Hant'].sourceRegion, 'TW')
    assert.equal(firstScenario.reactionSources['zh-Hans'].sourceRegion, 'CN')
    assert.deepEqual(
        firstScenario.rows.map(row => [
            row.Variable,
            row.MouthAnime ?? null,
            row.Motion ?? null,
            row.FaceType ?? null,
        ]),
        [
            ['0', '0.8', 'HomeUnique01', 'Surprised'],
            ['1.3', '5.6', null, null],
            ['6.25', '9.4', 'HomeWait01', 'Troubled'],
            ['9.7', '11.47', null, 'Wry'],
            ['12.3', '17.45', 'HomeWait02', 'Surprised'],
        ],
    )
    assert.equal(firstScenario.rows[0].Comment, 'ねぇ、キュゥべえ')
    assert.equal(firstScenario.reactionSources['ja-Jpan'].rows[0].Comment, 'ねぇ、キュゥべえ')
    assert.equal(firstScenario.reactionSources['en-Latn'].rows[0].Comment, 'Hey, Kyubey.')
    assert.equal(firstScenario.reactionSources['zh-Hant'].rows[0].Comment, '吶，丘比。')
    assert.equal(firstScenario.reactionSources['zh-Hans'].rows[0].Comment, '呐，丘比。')
    assert.equal(firstScenario.rows[0].Motion2d, 'motion_100')
    assert.equal(firstScenario.rows[0].FaceType2d, 'mtn_ex_051.exp3')
    assert.equal(firstScenario.rows[0].SoundFile, 'cv_100101_outgame')
    assert.equal(firstScenario.rows[0].SoundName, 'cv_100101_other_evo_fee_01')
    const typedTwMissing = manifest.entries.find(entry => (
        !entry.reactionSources['zh-Hant'].runtimeReady
    ))
    assert.equal(typedTwMissing.characterResourceId, '115001')
    assert.match(
        typedTwMissing.reactionSources['zh-Hant'].failClosedReasons[0],
        /exact official TW Reaction cue is absent/,
    )
    assert.deepEqual(typedTwMissing.reactionSources['zh-Hant'].rows, [])
    const typedHansMissing = manifest.entries.find(entry => (
        !entry.reactionSources['zh-Hans'].runtimeReady
    ))
    assert.equal(typedHansMissing.characterResourceId, '111601')
    assert.match(
        typedHansMissing.reactionSources['zh-Hans'].failClosedReasons[0],
        /exact zh-Hans Reaction authority is absent/,
    )
    assert.deepEqual(typedHansMissing.reactionSources['zh-Hans'].rows, [])
    assert.ok(typedTwMissing.reactionSources['ja-Jpan'].rows.every(row => (
        row.ActionType !== 'Talk' || typeof row.Comment === 'string'
    )))
    const mismatched = structuredClone(firstVoice)
    mismatched.audio.sourceStableKey = mismatched.audio.sourceStableKey.replace(
        'cueName=',
        'cueName=wrong-',
    )
    assert.equal(catalog.getForVoice(mismatched), undefined)
    const serialized = JSON.stringify(manifest)
    assert.match(serialized, /\"Comment\":\"ねぇ、キュゥべえ\"/)
    assert.match(serialized, /\"Comment\":\"吶，丘比。\"/)
    assert.match(serialized, /\"Comment\":\"呐，丘比。\"/)
    assert.match(serialized, /\"Comment\":\"Hey, Kyubey\.\"/)
    assert.match(serialized, /_en-Latn\.json/)
    assert.doesNotMatch(serialized, /startSeconds|mouthEndSeconds|Madoka Magica Magia Exedra Steam JP/)
})

test('subtitle modes resolve OFF, Simplified CN, JP and EN while retaining typed TW fallback metadata', () => {
    assert.equal(VOICE_SUBTITLE_DEFAULT_MODE, 'zh-Hans')
    assert.deepEqual(VOICE_SUBTITLE_UI_MODES, ['off', 'zh-Hans', 'ja-Jpan', 'en-Latn'])
    const voiceCatalog = new VoiceCatalog(officialManifest)
    const scenarios = new VoiceScenarioCatalog(officialScenarioManifest)
    const ready = scenarios.getForVoice(voiceCatalog.listForCharacter('100101')[0])
    const runner = new VoiceScenarioRunner()
    runner.setTarget(makeScenarioCharacter().target)
    runner.begin(ready, 0)
    assert.deepEqual(runner.diagnostics.subtitleModes, VOICE_SUBTITLE_UI_MODES)
    assert.deepEqual(runner.subtitleState('off', 0), {
        mode: 'off',
        status: 'off',
        text: null,
        sourceRegion: null,
        requestedLocale: null,
        resolvedLocale: null,
        fallbackApplied: false,
        rowNumber: null,
        reason: null,
    })
    assert.deepEqual(runner.subtitleState('zh-Hans', 0), {
        mode: 'zh-Hans',
        status: 'ready',
        text: '呐，丘比。',
        sourceRegion: 'CN',
        requestedLocale: 'zh-Hans',
        resolvedLocale: 'zh-Hans',
        fallbackApplied: false,
        rowNumber: 2,
        reason: null,
    })
    assert.equal(
        runner.subtitle('zh-Hans', 1.3),
        '遇到不认识的魔法少女时，\n有没有什么需要\n注意的地方呢？',
    )
    const jp = runner.subtitleState('ja-Jpan', 0)
    assert.equal(jp.status, 'ready')
    assert.equal(jp.text, 'ねぇ、キュゥべえ')
    assert.equal(jp.sourceRegion, 'JP')
    assert.equal(jp.requestedLocale, 'ja-Jpan')
    assert.equal(jp.resolvedLocale, 'ja-Jpan')
    assert.equal(jp.fallbackApplied, false)
    const en = runner.subtitleState('en-Latn', 0)
    assert.equal(en.status, 'ready')
    assert.equal(en.text, 'Hey, Kyubey.')
    assert.equal(en.resolvedLocale, 'en-Latn')
    assert.equal(runner.subtitle('zh-CN', 0), null)

    const missingHans = scenarios.manifest.entries.find(entry => (
        entry.characterResourceId === '111601' && entry.order === 1
    ))
    runner.begin(missingHans, 0)
    const closedHans = runner.subtitleState('zh-Hans', 0)
    assert.equal(closedHans.status, 'unavailable')
    assert.equal(closedHans.text, null)
    assert.equal(closedHans.sourceRegion, 'CN')
    assert.equal(closedHans.requestedLocale, 'zh-Hans')
    assert.equal(closedHans.resolvedLocale, 'zh-Hans')
    assert.equal(closedHans.fallbackApplied, false)
    assert.match(closedHans.reason, /exact zh-Hans Reaction authority is absent/)

    const missingTw = scenarios.manifest.entries.find(entry => (
        entry.characterResourceId === '115001' && entry.order === 1
    ))
    runner.begin(missingTw, 0)
    assert.deepEqual(runner.diagnostics.subtitleModes, VOICE_SUBTITLE_UI_MODES)
    const fallback = runner.subtitleState('zh-Hant', 0)
    assert.equal(fallback.status, 'ready')
    assert.equal(fallback.text, missingTw.reactionSources['ja-Jpan'].rows[0].Comment)
    assert.equal(fallback.sourceRegion, 'JP')
    assert.equal(fallback.requestedLocale, 'zh-Hant')
    assert.equal(fallback.resolvedLocale, 'ja-Jpan')
    assert.equal(fallback.fallbackApplied, true)
    assert.equal(missingTw.reactionSources['zh-Hant'].rows.length, 0)
})

test('subtitle state distinguishes normal idle from a genuinely unavailable scenario source', () => {
    const runner = new VoiceScenarioRunner()
    assert.deepEqual(runner.subtitleState('ja-Jpan', 0), {
        mode: 'ja-Jpan',
        status: 'idle',
        text: null,
        sourceRegion: 'JP',
        requestedLocale: 'ja-Jpan',
        resolvedLocale: null,
        fallbackApplied: false,
        rowNumber: null,
        reason: null,
    })
    runner.setUnavailable(
        'soundMstId=1|cueSheetName=fixture|cueName=fixture',
        'exact official scenario identity is absent',
    )
    const unavailable = runner.subtitleState('ja-Jpan', 0)
    assert.equal(unavailable.status, 'unavailable')
    assert.equal(unavailable.reason, 'exact official scenario identity is absent')
    runner.stop()
    assert.equal(runner.subtitleState('ja-Jpan', 0).status, 'idle')
})

test('voice presentation installs byte-exact Exedra fonts and routes Simplified/Traditional Chinese to 猫啃网糖圆体', () => {
    const fontPairs = [
        [
            './public/voice/fonts/exedra-zh-tangyuan.0901bb62ccd1.full.woff2',
            '../magi-reader/website/public/fonts/exedra-zh-tangyuan.0901bb62ccd1.full.woff2',
            1386160,
        ],
        [
            './public/voice/fonts/exedra-jp-ui-tsuku.431afe7080dc.full.woff2',
            '../magi-reader/website/public/fonts/exedra-jp-ui-tsuku.431afe7080dc.full.woff2',
            2750668,
        ],
        [
            './public/voice/fonts/exedra-jp-story-newcinema.687768deeccd.full.woff2',
            '../magi-reader/website/public/fonts/exedra-jp-story-newcinema.687768deeccd.full.woff2',
            3370224,
        ],
    ]
    for (const [viewerPath, authorityPath, expectedBytes] of fontPairs) {
        const viewer = fs.readFileSync(viewerPath)
        const authority = fs.readFileSync(resolveSourceAuthorityFixture(authorityPath))
        assert.equal(viewer.byteLength, expectedBytes, viewerPath)
        assert.equal(Buffer.compare(viewer, authority), 0, viewerPath)
    }
    const englishAuthority = fs.readFileSync(resolveSourceAuthorityFixture('D:/magia/FOT/Font/LiberationSans.ttf'))
    const englishDuplicate = fs.readFileSync(resolveSourceAuthorityFixture('D:/magia/FOT/Font/LiberationSans #920127.ttf'))
    const englishViewer = fs.readFileSync(
        './public/voice/fonts/exedra-en-ui-liberation.878023cf83e0.full.woff2',
    )
    assert.equal(englishAuthority.byteLength, 350200)
    assert.equal(Buffer.compare(englishAuthority, englishDuplicate), 0)
    assert.equal(englishViewer.byteLength, 134952)
    assert.equal(englishViewer.subarray(0, 4).toString('ascii'), 'wOF2')
    const css = voicePresentationCss()
    assert.match(css, /MagiReaderExedraTangYuan/)
    assert.match(css, /MagiReaderExedraTsukuOldGothic/)
    assert.match(css, /MagiReaderExedraNewCinemaA/)
    assert.match(css, /MagiReaderExedraLiberationSans/)
    assert.match(css, /exedra-en-ui-liberation\.878023cf83e0\.full\.woff2/)
    assert.match(css, /#voice-panel\[lang\|='en'\]/)
    assert.match(css, /data-voice-subtitle-source-region='CN'/)
    assert.match(css, /data-voice-subtitle-source-region='TW'/)
    assert.match(css, /data-voice-subtitle-source-region='JP'/)
    assert.match(css, /data-resolved-locale='zh-Hans'/)
    assert.match(css, /data-resolved-locale='zh-Hant'/)
    assert.match(css, /data-resolved-locale='ja-Jpan'/)
    assert.match(css, /data-resolved-locale='en-Latn'/)
    assert.equal(VOICE_FONT_ASSETS.chinese.label, '猫啃网糖圆体')
    assert.equal(VOICE_FONT_ASSETS.englishUi.label, 'Liberation Sans')

    const nodes = []
    const fakeDocument = {
        head: { append(node) { nodes.push(node) } },
        getElementById(id) { return nodes.find(node => node.id === id) ?? null },
        createElement(tagName) { return { tagName: tagName.toUpperCase(), id: '', textContent: '' } },
    }
    const first = installVoicePresentation(fakeDocument)
    const second = installVoicePresentation(fakeDocument)
    assert.equal(first, second)
    assert.equal(nodes.length, 1)
    assert.equal(first.id, VOICE_PRESENTATION_STYLE_ID)
    assert.equal(first.textContent, css)
})

test('all Viewer-backed scenario characters resolve official Home action fields and exact expression aliases', () => {
    const manifest = parseVoiceScenarioManifest(officialScenarioManifest)
    const modelsRoot = './magia-exedra-character-three/models'
    const directories = fs.readdirSync(modelsRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    const rowsByCharacter = new Map()
    for (const entry of manifest.entries.filter(value => value.runtimeReady)) {
        const rows = rowsByCharacter.get(entry.characterResourceId) ?? []
        rows.push(...entry.rows)
        rowsByCharacter.set(entry.characterResourceId, rows)
    }
    const missingModelRuntime = []
    const aliasCharacters = new Set()
    let verifiedCharacters = 0
    for (const [characterId, rows] of [...rowsByCharacter].sort()) {
        const runtimeDirectories = directories.filter(name => (
            name.startsWith(`chara_${characterId}`)
            && fs.existsSync(`${modelsRoot}/${name}/home-animations.json.gz`)
        ))
        if (runtimeDirectories.length === 0) {
            missingModelRuntime.push(characterId)
            continue
        }
        assert.equal(runtimeDirectories.length, 1, characterId)
        const directory = `${modelsRoot}/${runtimeDirectories[0]}`
        const animationRuntime = JSON.parse(zlib.gunzipSync(
            fs.readFileSync(`${directory}/home-animations.json.gz`),
        ).toString('utf8'))
        const expressionRuntime = JSON.parse(
            fs.readFileSync(`${directory}/home-expressions.json`, 'utf8'),
        )
        const animationFamilies = new Set(animationRuntime.clips.map(clip => clip.name))
        const hasAnimationFamily = family => [...animationFamilies].some(name => (
            name === family || name.startsWith(`${family}_`)
        ))
        const motions = new Set(rows.flatMap(row => row.Motion ? [row.Motion] : []))
        const actions = animationRuntime.actions
        for (const motion of motions) {
            const families = motion === 'HomeWait01'
                ? [actions?.wait01?.loopFamily]
                : motion === 'HomeWait02'
                    ? [actions?.wait02?.loopFamily]
                    : motion === 'HomeUnique01'
                        ? [actions?.unique01?.startFamily, actions?.unique01?.loopFamily]
                        : []
            assert.ok(families.length > 0, `${characterId}:${motion}:unsupported`)
            for (const family of families) {
                assert.equal(typeof family, 'string', `${characterId}:${motion}:field`)
                assert.ok(hasAnimationFamily(family), `${characterId}:${motion}:${family}`)
            }
        }
        const expression = {
            expressions: expressionRuntime.expressionOrder,
            current: expressionRuntime.defaultExpression,
            runtime: expressionRuntime,
            set() {},
            resetToDefault() {},
        }
        const faces = new Set(rows.flatMap(row => row.FaceType ? [row.FaceType] : []))
        for (const face of faces) {
            const channel = resolveVoiceScenarioExpressionChannel(expression, face)
            assert.notEqual(channel, null, `${characterId}:${face}`)
            if (channel !== face) aliasCharacters.add(characterId)
        }
        verifiedCharacters++
    }
    assert.equal(rowsByCharacter.size, 93)
    assert.equal(verifiedCharacters, rowsByCharacter.size - missingModelRuntime.length)
    const expectedMissingModelRuntime = [...rowsByCharacter.keys()].filter(characterId => !directories.some(name => (name.startsWith(`chara_${characterId}`) && fs.existsSync(`${modelsRoot}/${name}/home-animations.json.gz`)))).sort()
    assert.deepEqual(missingModelRuntime, expectedMissingModelRuntime)
    assert.deepEqual([...aliasCharacters].sort(), ['100504', '102601', '111601', '113301'])
})

test('Demo multiwave parity uses time-domain RMS, exact smoothing, gate and two waves', () => {
    const source = fs.readFileSync('./src/viewer/voice/multiwave.ts', 'utf8')
    const playerSource = fs.readFileSync('./src/viewer/voice/player.ts', 'utf8')
    assert.doesNotMatch(source, /getFloatFrequencyData|noiseFloor|lowFrequency|midFrequency|highFrequency/)
    assert.doesNotMatch(playerSource, /userData\.animationLoops|requestAnimationFrame/)
    assert.equal(DEMO_LIPSYNC_CONSTANTS.analyserFftSize, 256)
    const pcm = new Float32Array(128).fill(0.02)
    assert.ok(Math.abs(calculateTimeDomainRms(pcm) - 0.02) < 1e-7)
    const runtime = new DemoMultiwaveLipSync()
    const delta = 0.1
    const frame = runtime.updateFromPcm(pcm, delta, 0)
    const targetOpen = Math.pow(0.02 * 12, 5.5)
    const expectedOpen = targetOpen * (1 - 0.97)
    const combined = Math.sin(delta * 4.5) * 0.8 + Math.sin(delta * 12) * 0.5
    const expectedForm = combined * 0.4 * expectedOpen * (1 - 0.9)
    assert.ok(Math.abs(frame.rawRms - 0.02) < 1e-7)
    assert.ok(Math.abs(frame.rms - 0.02) < 1e-7)
    assert.equal(frame.hasSound, true)
    assert.ok(Math.abs(frame.mouthOpen - expectedOpen) < 1e-10)
    assert.ok(Math.abs(frame.mouthForm - expectedForm) < 1e-10)

    const firstSilent = runtime.updateFromRms(0, delta, 0)
    assert.ok(Math.abs(firstSilent.rms - frame.rms * 0.6) < 1e-10)
    assert.equal(firstSilent.hasSound, true)
    const secondSilent = runtime.updateFromRms(0, delta, 0)
    assert.ok(Math.abs(secondSilent.rms - firstSilent.rms * 0.6) < 1e-10)
    assert.equal(secondSilent.hasSound, false)
    assert.ok(Math.abs(secondSilent.mouthOpen - firstSilent.mouthOpen * 0.9) < 1e-10)
})

test('generic morph carrier changes only exact mouth channels and restores live expression base', () => {
    const { root, mesh } = makeMorphRoot({ open: 0.1, wide: 0.2, narrow: 0.05 })
    const carrier = resolveMouthCarrier(root)
    assert.equal(carrier.kind, 'morph-open')
    const untouched = mesh.morphTargetInfluences.slice(0, 2)
    carrier.setDrive(0.5, 0.5)
    assert.ok(mesh.morphTargetInfluences[2] > 0.1)
    assert.ok(mesh.morphTargetInfluences[3] > 0.2)
    assert.equal(mesh.morphTargetInfluences[4], 0.05)
    assert.deepEqual(mesh.morphTargetInfluences.slice(0, 2), untouched)
    carrier.close()
    assert.deepEqual(mesh.morphTargetInfluences, [0.25, 0.4, 0.1, 0.2, 0.05])

    carrier.setDrive(0.5, carrier.getBaseMouthForm())
    mesh.morphTargetInfluences[2] = 0.3
    carrier.setDrive(0.25, carrier.getBaseMouthForm())
    carrier.close()
    assert.equal(mesh.morphTargetInfluences[2], 0.3)
    assert.deepEqual(mesh.morphTargetInfluences.slice(0, 2), untouched)
})

test('paired expression and field-defined bone carriers are generic and reversible', () => {
    const pairedRoot = new THREE.Group()
    const pairedMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    pairedMesh.name = 'FaceAngle'
    pairedMesh.morphTargetDictionary = {
        Eye_Close: 0,
        Mouth_L_Smile: 1,
        Mouth_L_Close_Smile: 2,
    }
    pairedMesh.morphTargetInfluences = [0.3, 0, 1]
    pairedRoot.add(pairedMesh)
    const paired = resolveMouthCarrier(pairedRoot)
    assert.equal(paired.kind, 'paired-expression')
    paired.setDrive(1, 0)
    assert.deepEqual(pairedMesh.morphTargetInfluences, [0.3, 1, 0])
    paired.close()
    assert.deepEqual(pairedMesh.morphTargetInfluences, [0.3, 0, 1])

    const boneRoot = new THREE.Group()
    boneRoot.name = 'Root'
    const head = new THREE.Bone()
    head.name = 'Head'
    const jaw = new THREE.Bone()
    jaw.name = 'LowerJaw'
    jaw.rotation.x = 0.2
    boneRoot.add(head)
    head.add(jaw)
    boneRoot.userData.voiceMouthCarrier = {
        kind: 'bone',
        objectPath: 'Head/LowerJaw',
        channel: 'rotation',
        axis: 'x',
        closedValue: 0,
        openValue: 0.4,
    }
    const boneCarrier = resolveMouthCarrier(boneRoot)
    assert.equal(boneCarrier.kind, 'bone-field')
    boneCarrier.setDrive(0.5, 0)
    assert.ok(Math.abs(jaw.rotation.x - 0.4) < 1e-10)
    boneCarrier.close()
    assert.ok(Math.abs(jaw.rotation.x - 0.2) < 1e-10)

    const unknown = new THREE.Group()
    const unknownJaw = new THREE.Bone()
    unknownJaw.name = 'Jaw1'
    unknown.add(unknownJaw)
    assert.equal(resolveMouthCarrier(unknown).kind, 'none')
})

test('real ordinary, Doppel, view-angle and enemy fixtures resolve by channel, never ID', () => {
    for (const characterId of ['100101', '100305', '100805']) {
        const root = parseGzipFbx(
            `./magia-exedra-character-three/models/chara_${characterId}_battle_unit/VisualRoot.fbx.gz`,
        )
        const carrier = resolveMouthCarrier(root)
        assert.equal(carrier.kind, 'morph-open', characterId)
        assert.ok(carrier.diagnostics.bindings.some(value => value.includes('Mouth_OpenVertically')))
        carrier.setDrive(0.5, 0.25)
        carrier.close()
    }

    const viewAngle = parseGzipFbx(
        './magia-exedra-character-three/models/chara_115201_battle_unit/VisualRoot.fbx.gz',
    )
    const viewAngleCarrier = resolveMouthCarrier(viewAngle)
    assert.equal(viewAngleCarrier.kind, 'paired-expression')
    assert.ok(viewAngleCarrier.diagnostics.bindings.some(value => /Mouth_[LR]_/i.test(value)))
    const viewAngleInfluences = []
    viewAngle.traverse(object => {
        if (!object.morphTargetDictionary) return
        for (const [name, index] of Object.entries(object.morphTargetDictionary)) {
            viewAngleInfluences.push({
                object,
                name,
                index,
                before: object.morphTargetInfluences[index],
            })
        }
    })
    viewAngleCarrier.setOfficialPlaying(true)
    assert.ok(viewAngleInfluences.some(value => (
        /^Mouth_/.test(value.name)
        && value.object.morphTargetInfluences[value.index] > value.before
    )))
    assert.ok(viewAngleInfluences.filter(value => !/^Mouth_/.test(value.name)).every(value => (
        value.object.morphTargetInfluences[value.index] === value.before
    )))
    viewAngleCarrier.close()
    assert.ok(viewAngleInfluences.every(value => (
        value.object.morphTargetInfluences[value.index] === value.before
    )))

    const enemyWithMouth = parseGzipFbx(
        './public/enemies/models/enemy_602002_battle_unit/VisualRoot.fbxdata',
    )
    assert.equal(resolveMouthCarrier(enemyWithMouth).kind, 'morph-open')
    const noCarrierNeighbor = parseGzipFbx(
        './public/enemies/models/enemy_600002_battle_unit/VisualRoot.fbxdata',
    )
    assert.equal(resolveMouthCarrier(noCarrierNeighbor).kind, 'none')
})

class FakeNode {
    connections = []
    disconnectCount = 0

    connect(destination) {
        this.connections.push(destination)
        return destination
    }

    disconnect() {
        this.disconnectCount++
    }
}

class FakeAnalyser extends FakeNode {
    fftSize = 0
    frequencyBinCount = 128
    samples = new Float32Array(128).fill(0.2)

    getFloatTimeDomainData(array) {
        array.set(this.samples)
    }
}

class FakeAudioContext {
    destination = { kind: 'destination' }
    state = 'running'
    graphs = []
    closeCount = 0

    createMediaElementSource() {
        const source = new FakeNode()
        this.graphs.push({ source })
        return source
    }

    createGain() {
        const gain = new FakeNode()
        this.graphs.at(-1).gain = gain
        return gain
    }

    createAnalyser() {
        const analyser = new FakeAnalyser()
        this.graphs.at(-1).analyser = analyser
        return analyser
    }

    async resume() {
        this.state = 'running'
    }

    async close() {
        this.closeCount++
    }
}

class FakeAudio {
    src = ''
    crossOrigin = null
    preload = ''
    currentTime = 0
    duration = 4
    paused = true
    ended = false
    loadCount = 0
    listeners = new Map()

    async play() {
        this.paused = false
    }

    pause() {
        this.paused = true
    }

    load() {
        this.loadCount++
    }

    removeAttribute(name) {
        if (name === 'src') this.src = ''
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? new Set()
        listeners.add(listener)
        this.listeners.set(type, listeners)
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener)
    }

    emit(type) {
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
    }
}

class FakeScenarioAnimation {
    current = 'HomeWait01_L'
    paused = false
    time = 1.25
    clamped = false
    loop = true
    playCalls = []
    clearCount = 0
    durations = new Map([
        ['HomeWait01_L', 4],
        ['HomeWait02_L', 5],
        ['HomeUnique01_S', 2],
        ['HomeUnique01_L', 3],
    ])

    get duration() {
        return this.durations.get(this.current) ?? 0
    }

    play(name, loop = false, options = undefined) {
        if (!this.durations.has(name)) return
        this.current = name
        this.loop = loop
        const duration = this.durations.get(name) ?? 0
        const localTimeSeconds = Math.max(0, Number(options?.localTimeSeconds) || 0)
        this.time = duration > 0
            ? (loop ? localTimeSeconds % duration : Math.min(localTimeSeconds, duration))
            : localTimeSeconds
        this.paused = false
        this.clamped = false
        this.playCalls.push({
            name,
            loop,
            options: options ? { ...options } : undefined,
        })
    }

    clear() {
        this.current = undefined
        this.time = 0
        this.clearCount++
    }

    getAnimationClipsByName(name) {
        const duration = this.durations.get(name)
        return duration === undefined ? [] : [{ name, duration }]
    }
}

class FakeScenarioExpression {
    expressions = [
        'Smile',
        'Smiling',
        'Serious',
        'Annoyed',
        'Furious',
        'Sorrow',
        'Sadness',
        'Troubled',
        'Dumbfounded',
        'Wry',
        'Surprised',
        'Astonished',
        'Damage',
        'Expressionless',
        'Despair',
    ]
    current = 'Smile'
    automaticBlinkActive = true
    expressionAutoBlinkActive = false
    setCalls = []
    resetCount = 0

    set(name, automaticBlink = false) {
        if (!this.expressions.includes(name)) throw new Error(`missing expression: ${name}`)
        this.current = name
        this.automaticBlinkActive = false
        this.expressionAutoBlinkActive = automaticBlink
        this.setCalls.push({ name, automaticBlink })
    }

    resetToDefault() {
        this.current = 'Smile'
        this.automaticBlinkActive = true
        this.expressionAutoBlinkActive = false
        this.resetCount++
    }
}

function makeScenarioCharacter() {
    const { root, mesh } = makeMorphRoot()
    root.userData.homeAnimationRuntime = {
        actions: {
            wait01: { loopFamily: 'HomeWait01_L' },
            wait02: { loopFamily: 'HomeWait02_L' },
            unique01: {
                startFamily: 'HomeUnique01_S',
                loopFamily: 'HomeUnique01_L',
                startExitNormalizedTime: 1,
                enterTransitionSeconds: 0.2,
            },
        },
    }
    const animation = new FakeScenarioAnimation()
    const expression = new FakeScenarioExpression()
    return {
        target: {
            object: root,
            userData: root.userData,
            animations: [...animation.durations.keys()],
            animation,
            expression,
        },
        root,
        mesh,
        animation,
        expression,
    }
}

function makeFakeEnvironment({ analysis = true, audioDuration = 4, scenarios = true } = {}) {
    const audios = []
    const context = analysis ? new FakeAudioContext() : null
    const timers = new Map()
    let timerId = 0
    return {
        audios,
        context,
        timers,
        environment: {
            createAudioElement() {
                const audio = new FakeAudio()
                audio.duration = audioDuration
                audios.push(audio)
                return audio
            },
            createAudioContext() {
                return context
            },
            resolveRuntimeUrl(entry) {
                return `https://voice.invalid/${entry.order}.ogg`
            },
            setTimeout(callback) {
                const id = ++timerId
                timers.set(id, callback)
                return id
            },
            clearTimeout(id) {
                timers.delete(id)
            },
            autoSequenceGapMilliseconds: 1000,
            async loadScenarioCatalog() {
                return scenarios ? officialScenarioManifest : null
            },
        },
        runNextTimer() {
            const next = timers.entries().next().value
            if (!next) return false
            const [id, callback] = next
            timers.delete(id)
            callback()
            return true
        },
    }
}

test('scenario runner plays official Home fields and FaceType on the audio timeline, including seek phases', () => {
    const voiceCatalog = new VoiceCatalog(officialManifest)
    const scenarios = new VoiceScenarioCatalog(officialScenarioManifest)
    const entry = scenarios.getForVoice(voiceCatalog.listForCharacter('100101')[0])
    const fixture = makeScenarioCharacter()
    const runner = new VoiceScenarioRunner()
    runner.setTarget(fixture.target)
    runner.begin(entry, 0)
    assert.equal(fixture.animation.current, 'HomeUnique01_S')
    assert.equal(fixture.animation.loop, false)
    assert.equal(fixture.expression.current, 'Surprised')
    assert.equal(runner.diagnostics.status, 'playing')
    assert.equal(runner.diagnostics.motionApplied, true)
    assert.equal(runner.diagnostics.faceApplied, true)

    runner.seek(2.6, true)
    assert.equal(fixture.animation.current, 'HomeUnique01_L')
    assert.equal(fixture.animation.loop, true)
    assert.ok(Math.abs(fixture.animation.time - 0.6) < 1e-10)

    runner.seek(7, true)
    assert.equal(fixture.animation.current, 'HomeWait01_L')
    assert.equal(fixture.animation.loop, true)
    assert.ok(Math.abs(fixture.animation.time - 0.75) < 1e-10)
    assert.equal(fixture.expression.current, 'Troubled')

    runner.seek(10, false)
    assert.equal(fixture.animation.current, 'HomeWait01_L')
    assert.ok(Math.abs(fixture.animation.time - 3.75) < 1e-10)
    assert.equal(fixture.animation.paused, true)
    assert.equal(fixture.expression.current, 'Wry')
    assert.equal(runner.diagnostics.status, 'paused')
    runner.resume(10)
    assert.equal(fixture.animation.paused, false)

    runner.seek(13, true)
    assert.equal(fixture.animation.current, 'HomeWait02_L')
    assert.ok(Math.abs(fixture.animation.time - 0.7) < 1e-10)
    assert.equal(fixture.expression.current, 'Surprised')

    runner.stop()
    assert.equal(fixture.animation.current, 'HomeWait01_L')
    assert.ok(Math.abs(fixture.animation.time - 1.25) < 1e-10)
    assert.equal(fixture.animation.paused, false)
    assert.equal(fixture.expression.current, 'Smile')
    assert.equal(fixture.expression.automaticBlinkActive, true)
    assert.equal(fixture.expression.resetCount, 1)
    assert.equal(runner.diagnostics.status, 'idle')
})

test('scenario motion changes use official Animator trigger transitions while seek and restore keep exact local time', () => {
    const voiceCatalog = new VoiceCatalog(officialManifest)
    const scenarios = new VoiceScenarioCatalog(officialScenarioManifest)
    const entry = scenarios.getForVoice(voiceCatalog.listForCharacter('100101')[0])
    const fixture = makeScenarioCharacter()
    const runner = new VoiceScenarioRunner()
    runner.setTarget(fixture.target)

    runner.begin(entry, 0)
    assert.deepEqual(fixture.animation.playCalls.at(-1), {
        name: 'HomeUnique01_S',
        loop: false,
        options: { transitionSeconds: 0.2, localTimeSeconds: 0 },
    })

    runner.update(7)
    assert.deepEqual(fixture.animation.playCalls.at(-1), {
        name: 'HomeWait01_L',
        loop: true,
        options: { transitionSeconds: 0.4, localTimeSeconds: 0.75 },
    })
    const liveCallCount = fixture.animation.playCalls.length
    runner.update(7.2)
    runner.pause()
    runner.resume(7.2)
    assert.equal(fixture.animation.playCalls.length, liveCallCount)

    runner.seek(13, true)
    assert.deepEqual(fixture.animation.playCalls.at(-1), {
        name: 'HomeWait02_L',
        loop: true,
        options: { transitionSeconds: 0, localTimeSeconds: 0.6999999999999993 },
    })
    assert.ok(Math.abs(fixture.animation.time - 0.7) < 1e-10)

    runner.stop()
    assert.deepEqual(fixture.animation.playCalls.at(-1), {
        name: 'HomeWait01_L',
        loop: true,
        options: { transitionSeconds: 0, localTimeSeconds: 1.25 },
    })

    const metadataFixture = makeScenarioCharacter()
    metadataFixture.root.userData.homeAnimationRuntime.actions.unique01.enterTransitionSeconds = 9
    const metadataRunner = new VoiceScenarioRunner()
    metadataRunner.setTarget(metadataFixture.target)
    metadataRunner.begin(entry, 0)
    assert.equal(metadataFixture.animation.playCalls.at(-1).options.transitionSeconds, 0.2)
    metadataRunner.update(7)
    assert.equal(metadataFixture.animation.playCalls.at(-1).options.transitionSeconds, 0.4)
})

test('scenario handoff keeps the active state and applies the next official trigger transition without an idle snap', () => {
    const voiceCatalog = new VoiceCatalog(officialManifest)
    const scenarios = new VoiceScenarioCatalog(officialScenarioManifest)
    const entries = voiceCatalog.listForCharacter('100101')
    const firstEntry = scenarios.getForVoice(entries[0])
    const nextEntry = scenarios.getForVoice(entries[1])
    const fixture = makeScenarioCharacter()
    const runner = new VoiceScenarioRunner()
    runner.setTarget(fixture.target)

    runner.begin(firstEntry, 0)
    assert.equal(fixture.animation.current, 'HomeUnique01_S')
    const callsBeforeHandoff = fixture.animation.playCalls.length
    assert.equal(runner.prepareHandoff(), true)
    assert.equal(runner.diagnostics.status, 'idle')
    assert.equal(fixture.animation.current, 'HomeUnique01_S')

    runner.begin(nextEntry, 0)
    assert.deepEqual(fixture.animation.playCalls.slice(callsBeforeHandoff), [{
        name: 'HomeWait02_L',
        loop: true,
        options: { transitionSeconds: 0.4, localTimeSeconds: 0 },
    }])
    assert.equal(fixture.expression.current, 'Astonished')

    runner.stop()
    assert.equal(fixture.animation.current, 'HomeWait01_L')
    assert.ok(Math.abs(fixture.animation.time - 1.25) < 1e-10)
    assert.equal(fixture.expression.current, 'Smile')
})

test('scenario runner routes only exact available fields and preserves unrelated animation/expression neighbors', () => {
    const voiceCatalog = new VoiceCatalog(officialManifest)
    const scenarios = new VoiceScenarioCatalog(officialScenarioManifest)
    const entry = scenarios.getForVoice(voiceCatalog.listForCharacter('100101')[0])
    const fixture = makeScenarioCharacter()
    fixture.target.userData.homeAnimationRuntime.actions.unique01.loopFamily = 'MissingUniqueLoop'
    fixture.expression.expressions = ['Smile']
    const runner = new VoiceScenarioRunner()
    runner.setTarget(fixture.target)
    runner.begin(entry, 0)
    assert.equal(fixture.animation.current, 'HomeWait01_L')
    assert.equal(fixture.animation.playCalls.length, 0)
    assert.equal(fixture.expression.current, 'Smile')
    assert.equal(fixture.expression.setCalls.length, 0)
    assert.equal(runner.diagnostics.motionApplied, false)
    assert.equal(runner.diagnostics.faceApplied, false)

    fixture.animation.current = 'ExternalAction'
    fixture.animation.durations.set('ExternalAction', 8)
    runner.stop()
    assert.equal(fixture.animation.current, 'ExternalAction')
    assert.equal(fixture.expression.current, 'Smile')
})

test('Demo-style scenario toggles independently preserve or follow original motion and expression', () => {
    const voiceCatalog = new VoiceCatalog(officialManifest)
    const scenarios = new VoiceScenarioCatalog(officialScenarioManifest)
    const entry = scenarios.getForVoice(voiceCatalog.listForCharacter('100101')[0])

    const disabled = makeScenarioCharacter()
    const disabledRunner = new VoiceScenarioRunner()
    disabledRunner.setTarget(disabled.target)
    disabledRunner.begin(entry, 0, { useMotion: false, useExpression: false })
    assert.equal(disabled.animation.current, 'HomeWait01_L')
    assert.equal(disabled.animation.playCalls.length, 0)
    assert.equal(disabled.expression.current, 'Smile')
    assert.equal(disabled.expression.setCalls.length, 0)
    disabledRunner.seek(13, true)
    assert.equal(disabled.animation.current, 'HomeWait01_L')
    assert.equal(disabled.expression.current, 'Smile')

    const motionOnly = makeScenarioCharacter()
    const motionRunner = new VoiceScenarioRunner()
    motionRunner.setTarget(motionOnly.target)
    motionRunner.begin(entry, 0, { useMotion: true, useExpression: false })
    assert.equal(motionOnly.animation.current, 'HomeUnique01_S')
    assert.equal(motionOnly.expression.current, 'Smile')
    assert.equal(motionOnly.expression.setCalls.length, 0)
    motionRunner.stop()
    assert.equal(motionOnly.animation.current, 'HomeWait01_L')

    const expressionOnly = makeScenarioCharacter()
    const expressionRunner = new VoiceScenarioRunner()
    expressionRunner.setTarget(expressionOnly.target)
    expressionRunner.begin(entry, 0, { useMotion: false, useExpression: true })
    assert.equal(expressionOnly.animation.current, 'HomeWait01_L')
    assert.equal(expressionOnly.animation.playCalls.length, 0)
    assert.equal(expressionOnly.expression.current, 'Surprised')
    expressionRunner.stop()
    assert.equal(expressionOnly.expression.current, 'Smile')
})

test('player supports play/pause/resume/seek/switch and exact old graph cleanup', async () => {
    const catalog = new VoiceCatalog(officialManifest)
    const fake = makeFakeEnvironment()
    const { root, mesh } = makeMorphRoot()
    const player = new VoicePlayer(catalog, fake.environment)
    player.setCharacter('100101', root)
    assert.equal(player.entries.length, 14)
    assert.equal(await player.playAt(0), true)
    assert.equal(player.snapshot.status, 'playing')
    assert.equal(player.snapshot.analysisMode, 'multiwave')
    assert.ok(mesh.morphTargetInfluences[2] > 0)
    assert.equal(fake.context.graphs[0].source.connections[0], fake.context.graphs[0].gain)
    assert.equal(fake.context.graphs[0].gain.connections[0], fake.context.graphs[0].analyser)
    assert.equal(fake.context.graphs[0].analyser.connections[0], fake.context.destination)
    assert.equal(fake.context.graphs[0].analyser.fftSize, 256)

    assert.equal(root.userData.animationLoops.length, 0)
    player.update(0.1)
    assert.ok(mesh.morphTargetInfluences[2] > 0)
    assert.equal(player.pause(), true)
    assert.equal(player.snapshot.status, 'paused')
    assert.equal(mesh.morphTargetInfluences[2], 0)
    assert.equal(await player.resume(), true)
    assert.ok(mesh.morphTargetInfluences[2] > 0)
    assert.equal(player.seek(2.5), true)
    assert.equal(player.positionSeconds, 2.5)
    assert.equal(player.seek(8), true)
    assert.equal(player.positionSeconds, 4)

    const firstAudio = fake.audios[0]
    const firstGraph = fake.context.graphs[0]
    assert.equal(await player.playAt(1), true)
    assert.equal(firstAudio.paused, true)
    assert.equal(firstAudio.src, '')
    assert.equal(firstGraph.source.disconnectCount, 1)
    assert.equal(firstGraph.gain.disconnectCount, 1)
    assert.equal(firstGraph.analyser.disconnectCount, 1)
    firstAudio.emit('ended')
    assert.equal(player.snapshot.currentIndex, 1)
    assert.equal(player.snapshot.status, 'playing')
    assert.equal(await player.previous(), true)
    assert.equal(player.snapshot.currentIndex, 0)
    assert.equal(await player.next(), true)
    assert.equal(player.snapshot.currentIndex, 1)
    await player.dispose()
    assert.equal(mesh.morphTargetInfluences[2], 0)
    assert.equal(fake.context.closeCount, 1)
})

test('player keeps official scenario action/expression synchronized with voice play, pause, seek, end and switch cleanup', async () => {
    const fake = makeFakeEnvironment({ audioDuration: 20 })
    const first = makeScenarioCharacter()
    const second = makeScenarioCharacter()
    second.animation.time = 2
    second.expression.automaticBlinkActive = false
    second.expression.expressionAutoBlinkActive = true
    const player = new VoicePlayer(officialManifest, fake.environment)
    player.setCharacter('100101', first.target)
    assert.equal(await player.playAt(0), true)
    assert.equal(player.snapshot.scenario.status, 'playing')
    assert.equal(first.animation.current, 'HomeUnique01_S')
    assert.equal(first.expression.current, 'Surprised')
    assert.ok(first.mesh.morphTargetInfluences[2] > 0)

    fake.audios[0].currentTime = 7
    player.update(0.1)
    assert.equal(first.animation.current, 'HomeWait01_L')
    assert.equal(first.expression.current, 'Troubled')
    assert.ok(Math.abs(first.animation.time - 0.75) < 1e-10)

    assert.equal(player.pause(), true)
    assert.equal(first.animation.paused, true)
    assert.equal(player.snapshot.scenario.status, 'paused')
    assert.equal(first.mesh.morphTargetInfluences[2], 0)
    assert.equal(player.seek(10), true)
    assert.equal(first.animation.current, 'HomeWait01_L')
    assert.equal(first.expression.current, 'Wry')
    assert.equal(first.animation.paused, true)
    assert.equal(await player.resume(), true)
    assert.equal(first.animation.paused, false)

    fake.audios[0].emit('ended')
    assert.equal(player.snapshot.status, 'idle')
    assert.equal(player.snapshot.scenario.status, 'idle')
    assert.equal(player.subtitleState('ja-Jpan').status, 'idle')
    assert.equal(player.subtitleState('ja-Jpan').reason, null)
    assert.equal(first.animation.current, 'HomeWait01_L')
    assert.ok(Math.abs(first.animation.time - 1.25) < 1e-10)
    assert.equal(first.expression.current, 'Smile')
    assert.equal(first.expression.automaticBlinkActive, true)
    assert.equal(first.mesh.morphTargetInfluences[2], 0)

    await player.playAt(0)
    player.setCharacter('100305', second.target)
    assert.equal(first.animation.current, 'HomeWait01_L')
    assert.equal(first.expression.current, 'Smile')
    assert.equal(player.snapshot.status, 'idle')
    assert.equal(await player.playAt(0), true)
    assert.equal(second.animation.current, 'HomeWait02_L')
    assert.equal(second.expression.current, 'Smile')
    assert.deepEqual(second.expression.setCalls.at(-1), {
        name: 'Smile',
        automaticBlink: true,
    })
    player.stop()
    assert.equal(second.animation.current, 'HomeWait01_L')
    assert.ok(Math.abs(second.animation.time - 2) < 1e-10)
    assert.equal(second.expression.current, 'Smile')
    assert.equal(second.expression.expressionAutoBlinkActive, true)
})

test('player manual next hands the current action directly to the next official Animator trigger', async () => {
    const fake = makeFakeEnvironment({ audioDuration: 20 })
    const fixture = makeScenarioCharacter()
    const player = new VoicePlayer(officialManifest, fake.environment)
    player.setCharacter('100101', fixture.target)
    assert.equal(await player.playAt(0), true)
    assert.equal(fixture.animation.current, 'HomeUnique01_S')
    const callsBeforeNext = fixture.animation.playCalls.length

    assert.equal(await player.next(), true)
    assert.deepEqual(fixture.animation.playCalls.slice(callsBeforeNext), [{
        name: 'HomeWait02_L',
        loop: true,
        options: { transitionSeconds: 0.4, localTimeSeconds: 0 },
    }])
    assert.equal(fixture.expression.current, 'Astonished')

    player.stop()
    assert.equal(fixture.animation.current, 'HomeWait01_L')
    assert.equal(fixture.expression.current, 'Smile')
})

test('player exposes Demo-style original motion and expression choices for each playback', async () => {
    const fake = makeFakeEnvironment({ audioDuration: 20 })
    const fixture = makeScenarioCharacter()
    const player = new VoicePlayer(officialManifest, fake.environment)
    player.setCharacter('100101', fixture.target)

    player.setScenarioOptions({ useMotion: false, useExpression: false })
    assert.equal(await player.playAt(0), true)
    assert.equal(fixture.animation.current, 'HomeWait01_L')
    assert.equal(fixture.animation.playCalls.length, 0)
    assert.equal(fixture.expression.current, 'Smile')
    assert.equal(fixture.expression.setCalls.length, 0)
    player.stop()

    player.setScenarioOptions({ useMotion: true, useExpression: false })
    assert.equal(await player.playAt(0), true)
    assert.equal(fixture.animation.current, 'HomeUnique01_S')
    assert.equal(fixture.expression.current, 'Smile')
    player.stop()

    player.setScenarioOptions({ useMotion: false, useExpression: true })
    assert.equal(await player.playAt(0), true)
    assert.equal(fixture.animation.current, 'HomeWait01_L')
    assert.equal(fixture.expression.current, 'Surprised')
    player.stop()
})

test('updated authority closes former audio/scenario gaps for 100306, 100407 and 111402', async () => {
    const scenarios = new VoiceScenarioCatalog(officialScenarioManifest)
    const voices = new VoiceCatalog(officialManifest)
    for (const characterId of ['100306', '100407', '111402']) {
        const entry = voices.listForCharacter(characterId)[0]
        assert.equal(entry.audio.runtimeReady, true, characterId)
        assert.equal(scenarios.getForVoice(entry)?.runtimeReady, true, characterId)
        const fake = makeFakeEnvironment({ audioDuration: 20 })
        const fixture = makeScenarioCharacter()
        const player = new VoicePlayer(officialManifest, fake.environment)
        player.setCharacter(characterId, fixture.target)
        assert.equal(await player.playAt(0), true, characterId)
        assert.equal(player.snapshot.status, 'playing', characterId)
        assert.equal(player.snapshot.scenario.status, 'playing', characterId)
        assert.ok(fixture.mesh.morphTargetInfluences[2] > 0, characterId)
        player.stop()
        assert.equal(fixture.mesh.morphTargetInfluences[2], 0, characterId)
    }
})

test('ended closes mouth, auto-sequence waits its gap, then advances actual queue', async () => {
    const fake = makeFakeEnvironment()
    const fixture = makeScenarioCharacter()
    const player = new VoicePlayer(officialManifest, fake.environment)
    player.setCharacter('100101', fixture.target)
    player.setAutoSequence(true)
    await player.playAt(0)
    const firstAudio = fake.audios[0]
    assert.ok(fixture.mesh.morphTargetInfluences[2] > 0)
    assert.equal(fixture.animation.current, 'HomeUnique01_S')
    assert.equal(fixture.expression.current, 'Surprised')
    const callsBeforeEnd = fixture.animation.playCalls.length
    firstAudio.emit('ended')
    assert.equal(player.snapshot.status, 'idle')
    assert.equal(player.snapshot.currentIndex, 0)
    assert.equal(fixture.mesh.morphTargetInfluences[2], 0)
    assert.equal(fixture.animation.current, 'HomeUnique01_S')
    assert.equal(fixture.expression.current, 'Surprised')
    assert.equal(fixture.animation.playCalls.length, callsBeforeEnd)
    assert.equal(fake.timers.size, 1)
    assert.equal(fake.runNextTimer(), true)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(player.snapshot.currentIndex, 1)
    assert.equal(player.snapshot.status, 'playing')
    assert.equal(player.snapshot.scenario.status, 'playing')
    assert.ok(fixture.mesh.morphTargetInfluences[2] > 0)
    assert.deepEqual(fixture.animation.playCalls.slice(callsBeforeEnd), [{
        name: 'HomeWait02_L',
        loop: true,
        options: { transitionSeconds: 0.4, localTimeSeconds: 0 },
    }])
    assert.equal(fixture.expression.current, 'Astonished')
    player.stop()
})

test('cancelling auto-sequence during the handoff gap restores the original action and expression', async () => {
    const fake = makeFakeEnvironment()
    const fixture = makeScenarioCharacter()
    const player = new VoicePlayer(officialManifest, fake.environment)
    player.setCharacter('100101', fixture.target)
    player.setAutoSequence(true)
    await player.playAt(0)
    fake.audios[0].emit('ended')
    assert.equal(fake.timers.size, 1)
    assert.equal(fixture.animation.current, 'HomeUnique01_S')

    player.setAutoSequence(false)
    assert.equal(fake.timers.size, 0)
    assert.equal(fixture.animation.current, 'HomeWait01_L')
    assert.ok(Math.abs(fixture.animation.time - 1.25) < 1e-10)
    assert.equal(fixture.expression.current, 'Smile')
    assert.equal(fixture.expression.automaticBlinkActive, true)
})

test('binary fallback, target switch, missing audio and subtitle state all fail closed', async () => {
    const noAnalysis = makeFakeEnvironment({ analysis: false })
    const first = makeMorphRoot()
    const second = makeMorphRoot()
    const player = new VoicePlayer(officialManifest, noAnalysis.environment)
    player.setCharacter('100101', first.root)
    await player.playAt(0)
    assert.equal(player.snapshot.analysisMode, 'official-binary')
    assert.ok(first.mesh.morphTargetInfluences[2] > 0)
    assert.equal(player.subtitle('off'), null)
    assert.equal(player.subtitle('ja-Jpan'), 'ねぇ、キュゥべえ')
    assert.equal(player.subtitle('en-Latn'), 'Hey, Kyubey.')
    assert.equal(player.subtitle('zh-Hans'), '呐，丘比。')
    assert.equal(player.subtitle('zh-Hant'), '吶，丘比。')
    assert.equal(player.subtitleState('zh-Hant').fallbackApplied, false)
    player.setCharacter('100305', second.root)
    assert.equal(first.mesh.morphTargetInfluences[2], 0)
    assert.equal(player.snapshot.status, 'idle')
    assert.equal(player.entries.length, 14)
    await player.playAt(0)
    second.root.dispatchEvent({ type: 'removed' })
    assert.equal(second.mesh.morphTargetInfluences[2], 0)
    assert.equal(player.snapshot.status, 'idle')

    const newlyReady = makeMorphRoot()
    player.setCharacter('100407', newlyReady.root)
    assert.equal(await player.playAt(0), true)
    assert.equal(player.snapshot.status, 'playing')
    player.stop()
    assert.equal(newlyReady.mesh.morphTargetInfluences[2], 0)

    const missingManifest = structuredClone(officialManifest)
    const missingEntry = missingManifest.entries.find(entry => (
        entry.characterResourceId === '100407' && entry.order === 1
    ))
    missingEntry.audio.runtimeReady = false
    missingEntry.audio.runtimeUrl = null
    missingEntry.audio.failClosedReasons = ['synthetic exact audio fixture is absent']
    const missingFake = makeFakeEnvironment({ analysis: false })
    const missingTarget = makeMorphRoot()
    const missingPlayer = new VoicePlayer(missingManifest, missingFake.environment)
    missingPlayer.setCharacter('100407', missingTarget.root)
    assert.equal(await missingPlayer.playAt(0), false)
    assert.equal(missingPlayer.snapshot.status, 'error')
    assert.equal(missingTarget.mesh.morphTargetInfluences[2], 0)
    assert.equal(missingFake.audios.length, 0)
})

test('CRI resolver maps only the official sourceStableKey fields', () => {
    const entry = new VoiceCatalog(officialManifest).listForCharacter('100101')[0]
    const resolver = createCriVoiceUrlResolver('http://127.0.0.1:43123/')
    assert.equal(
        resolver(entry),
        `http://127.0.0.1:43123/cv_100101_outgame/${entry.audio.sourceStableKey.split('cueName=')[1]}.ogg`,
    )
    const newlyReady = new VoiceCatalog(officialManifest).listForCharacter('100407')[0]
    assert.match(resolver(newlyReady), /cv_100407_outgame\/.*\.ogg$/)
    const missing = structuredClone(newlyReady)
    missing.audio.runtimeReady = false
    missing.audio.runtimeUrl = null
    missing.audio.failClosedReasons = ['synthetic exact audio fixture is absent']
    assert.equal(resolver(missing), null)
})

test('async CRI delivery preserves exact identity through play, pause, seek, resume and stop', async () => {
    const fake = makeFakeEnvironment({ analysis: false })
    const target = makeScenarioCharacter()
    const requests = []
    fake.environment.resolveRuntimeUrl = createCriVoiceUrlResolver('https://viewer.invalid/voice/Cv/', async reference => {
        requests.push(reference)
        return 'blob:voice-exact-cue'
    })
    const player = new VoicePlayer(officialManifest, fake.environment)
    player.setCharacter('100101', target.target)
    const entry = player.entries[0]
    assert.equal(await player.playStableKey(entry.stableKey), true)
    assert.deepEqual(requests, [`https://viewer.invalid/voice/Cv/cv_100101_outgame/${entry.audio.sourceStableKey.split('cueName=')[1]}.ogg`])
    assert.equal(fake.audios.length, 1)
    const audio = fake.audios[0]
    assert.equal(audio.src, 'blob:voice-exact-cue')
    assert.equal(audio.loadCount, 1)
    assert.equal(player.snapshot.currentStableKey, entry.stableKey)
    assert.equal(player.subtitle('ja-Jpan'), 'ねぇ、キュゥべえ')
    assert.equal(player.snapshot.scenario.motionApplied, true)
    assert.equal(player.snapshot.scenario.faceApplied, true)
    assert.equal(player.pause(), true)
    assert.equal(audio.paused, true)
    assert.equal(player.seek(2.6), true)
    assert.equal(audio.currentTime, 2.6)
    assert.equal(player.snapshot.status, 'paused')
    assert.equal(target.animation.current, 'HomeUnique01_L')
    assert.equal(await player.resume(), true)
    assert.equal(player.snapshot.status, 'playing')
    player.stop()
    assert.equal(player.snapshot.status, 'idle')
    assert.equal(audio.paused, true)
    assert.equal(audio.src, '')
    assert.equal(target.mesh.morphTargetInfluences[2], 0)
    assert.equal(requests.length, 1)
})

function deferredVoiceResolution(fake) {
    let resolve, reject, started
    const ready = new Promise(done => { started = done })
    const pending = new Promise((done, fail) => { resolve = done; reject = fail })
    fake.environment.resolveRuntimeUrl = () => { started(); return pending }
    return { ready, resolve, reject }
}

test('async voice delivery errors stay surfaced without starting audio or scenario', async () => {
    const fake = makeFakeEnvironment()
    fake.environment.resolveRuntimeUrl = async () => { throw new Error('VOICE_PACK_MISSING') }
    const player = new VoicePlayer(officialManifest, fake.environment)
    player.setCharacter('100101', makeScenarioCharacter().target)
    assert.equal(await player.playAt(0), false)
    assert.equal(player.snapshot.status, 'error')
    assert.match(player.snapshot.error, /Voice runtime asset resolution failed:.*VOICE_PACK_MISSING/)
    assert.equal(fake.audios.length, 0)
    assert.equal(player.snapshot.scenario.motionApplied, false)
})

test('async voice delivery stop and target change consume stale resolution and rejection', async () => {
    for (const operation of ['stop', 'target-change']) {
        for (const outcome of ['resolve', 'reject']) {
            const fake = makeFakeEnvironment()
            const deferred = deferredVoiceResolution(fake)
            const player = new VoicePlayer(officialManifest, fake.environment)
            player.setCharacter('100101', makeScenarioCharacter().target)
            const pending = player.playAt(0)
            await deferred.ready
            assert.equal(player.snapshot.status, 'loading')
            if (operation === 'stop') player.stop()
            else player.setCharacter('100305', makeScenarioCharacter().target)
            if (outcome === 'resolve') deferred.resolve('blob:stale')
            else deferred.reject(new Error('STALE_PACK_ERROR'))
            assert.equal(await pending, false, `${operation}/${outcome}`)
            assert.equal(fake.audios.length, 0)
            assert.equal(player.snapshot.status, 'idle')
            assert.equal(player.snapshot.error, null)
        }
    }
})

test('async voice delivery supersession starts only the newest stable cue', async () => {
    for (const outcome of ['resolve', 'reject']) {
        const fake = makeFakeEnvironment()
        const deferred = deferredVoiceResolution(fake)
        const firstResolver = fake.environment.resolveRuntimeUrl
        let calls = 0
        fake.environment.resolveRuntimeUrl = entry => ++calls === 1
            ? firstResolver(entry)
            : Promise.resolve('blob:newest-cue')
        const player = new VoicePlayer(officialManifest, fake.environment)
        player.setCharacter('100101', makeScenarioCharacter().target)
        const stale = player.playAt(0)
        await deferred.ready
        assert.equal(await player.playAt(1), true)
        if (outcome === 'resolve') deferred.resolve('blob:stale')
        else deferred.reject(new Error('STALE_PACK_ERROR'))
        assert.equal(await stale, false)
        assert.equal(fake.audios.length, 1)
        assert.equal(fake.audios[0].src, 'blob:newest-cue')
        assert.equal(player.snapshot.currentStableKey, player.entries[1].stableKey)
        assert.equal(player.snapshot.status, 'playing')
        assert.equal(player.snapshot.error, null)
        player.stop()
    }
})
