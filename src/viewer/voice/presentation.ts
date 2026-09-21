export const VOICE_PRESENTATION_STYLE_ID = 'magius-voice-presentation-fonts' as const

export const VOICE_FONT_ASSETS = {
    chinese: {
        family: 'MagiReaderExedraTangYuan',
        label: '猫啃网糖圆体',
        runtimeUrl: '/voice/fonts/exedra-zh-tangyuan.0901bb62ccd1.full.woff2',
    },
    japaneseUi: {
        family: 'MagiReaderExedraTsukuOldGothic',
        label: 'FOT-TsukuOldGothic Std B',
        runtimeUrl: '/voice/fonts/exedra-jp-ui-tsuku.431afe7080dc.full.woff2',
    },
    japaneseStory: {
        family: 'MagiReaderExedraNewCinemaA',
        label: 'FOT-NewCinemaA Std D',
        runtimeUrl: '/voice/fonts/exedra-jp-story-newcinema.687768deeccd.full.woff2',
    },
    englishUi: {
        family: 'MagiReaderExedraLiberationSans',
        label: 'Liberation Sans',
        runtimeUrl: '/voice/fonts/exedra-en-ui-liberation.878023cf83e0.full.woff2',
    },
} as const

export function voicePresentationCss(): string {
    const chinese = VOICE_FONT_ASSETS.chinese
    const japaneseUi = VOICE_FONT_ASSETS.japaneseUi
    const japaneseStory = VOICE_FONT_ASSETS.japaneseStory
    const englishUi = VOICE_FONT_ASSETS.englishUi
    return `
@font-face {
    font-family: '${chinese.family}';
    src: url('${chinese.runtimeUrl}') format('woff2');
    font-display: swap;
}
@font-face {
    font-family: '${japaneseUi.family}';
    src: url('${japaneseUi.runtimeUrl}') format('woff2');
    font-display: swap;
}
@font-face {
    font-family: '${japaneseStory.family}';
    src: url('${japaneseStory.runtimeUrl}') format('woff2');
    font-display: swap;
}
@font-face {
    font-family: '${englishUi.family}';
    src: url('${englishUi.runtimeUrl}') format('woff2');
    font-display: swap;
}
#voice-panel,
#voice-panel-toggle,
#voice-panel select,
#voice-panel button,
#voice-panel input,
#voice-panel output {
    font-family: '${chinese.family}', sans-serif;
}
#voice-panel[lang|='ja'],
#voice-panel[lang|='ja'] select,
#voice-panel[lang|='ja'] button,
#voice-panel[lang|='ja'] input,
#voice-panel[lang|='ja'] output {
    font-family: '${japaneseUi.family}', sans-serif;
}
#voice-panel[lang|='en'],
#voice-panel[lang|='en'] select,
#voice-panel[lang|='en'] button,
#voice-panel[lang|='en'] input,
#voice-panel[lang|='en'] output {
    font-family: '${englishUi.family}', sans-serif;
}
#voice-subtitle-overlay,
#voice-subtitle-overlay[lang|='zh'],
#voice-subtitle-overlay[data-voice-subtitle-source-region='CN'],
#voice-subtitle-overlay[data-voice-subtitle-source-region='TW'],
#voice-panel[data-resolved-locale='zh-Hans'] #voice-subtitle-overlay,
#voice-panel[data-resolved-locale='zh-Hant'] #voice-subtitle-overlay {
    font-family: '${chinese.family}', sans-serif;
}
#voice-subtitle-overlay[lang|='ja'],
#voice-subtitle-overlay[data-voice-subtitle-source-region='JP'],
#voice-panel[data-resolved-locale='ja-Jpan'] #voice-subtitle-overlay {
    font-family: '${japaneseStory.family}', sans-serif;
}
#voice-subtitle-overlay[lang|='en'],
#voice-panel[data-resolved-locale='en-Latn'] #voice-subtitle-overlay {
    font-family: '${englishUi.family}', sans-serif;
}
`.trim()
}

export function installVoicePresentation(
    documentValue: Document | undefined = typeof document === 'undefined' ? undefined : document,
): HTMLStyleElement | null {
    if (!documentValue?.head) return null
    const existing = documentValue.getElementById(VOICE_PRESENTATION_STYLE_ID)
    if (existing?.tagName === 'STYLE') return existing as HTMLStyleElement
    const style = documentValue.createElement('style')
    style.id = VOICE_PRESENTATION_STYLE_ID
    style.textContent = voicePresentationCss()
    documentValue.head.append(style)
    return style
}
