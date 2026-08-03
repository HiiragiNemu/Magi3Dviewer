export type UiLocale = 'en' | 'zh-CN'

const LOCALE_STORAGE_KEY = 'magius3dviewer.locale'

const pageMetadata: Record<UiLocale, {
    title: string
    description: string
    ogDescription: string
}> = {
    en: {
        title: 'Magius3Dviewer | Magia Exedra Official-Style 3D Shader Viewer',
        description: 'Magius3Dviewer is an independent Magia Exedra WebGL 3D viewer with official-style ReDriveToon shading, AngelRing hair highlights, multi-character staging and selectable 3D scenes, based on the original Magi3Dviewer project.',
        ogDescription: 'Magia Exedra 3D viewer with official-style ReDriveToon, AngelRing and scene staging controls.',
    },
    'zh-CN': {
        title: 'Magius3Dviewer｜Magia Exedra 官方风格 3D 着色器查看器',
        description: 'Magius3Dviewer 是独立的 Magia Exedra WebGL 3D 查看器，研究并复现 ReDriveToon、AngelRing、多角色编排与可切换 3D 场景；项目基于原始 Magi3Dviewer。',
        ogDescription: '研究并复现 ReDriveToon、AngelRing 与场景编排控制的 Magia Exedra 3D 查看器。',
    },
}

/**
 * English remains the canonical UI key so lil-gui preset names and shared URLs
 * stay stable. Simplified Chinese is a presentation layer applied to the DOM.
 */
export const zhCnUiText: Readonly<Record<string, string>> = {
    'Magius3Dviewer is loading the official-style shader and character model...': 'Magius3Dviewer 正在加载官方风格着色器与角色模型……',
    'Magius3Dviewer demo screenshot': 'Magius3Dviewer 演示截图',
    'Take a photo': '拍照',
    'Model': '角色模型',
    'Choose model': '选择角色模型',
    'Remove selected model': '移除当前角色模型',
    '<No target selected>': '<未选择角色>',
    'Add model': '添加角色模型',
    'Animation': '动作',
    'Choose animation': '选择动作',
    'Play animation': '播放动作',
    'Pause animation': '暂停动作',
    'Choose 3D stage': '选择 3D 场景',
    'Visit the Magius3Dviewer source branch': '查看 Magius3Dviewer 源代码分支',
    'Use light theme': '使用浅色主题',
    'Use dark theme': '使用深色主题',
    'Change background': '更换背景',
    'Choose from album': '从本地相册选择',
    'Select camera mode': '选择相机模式',
    'Camera background': '摄像头背景',
    'Turn off camera background': '关闭摄像头背景',
    'Fullscreen': '全屏',
    'Adjust character position': '调整角色位置',
    'Adjust character rotation': '调整角色旋转',
    'Preset': '预设',
    'OK': '确定',
    'Close': '关闭',
    'Download': '下载',
    '< Select a character to add >': '< 请选择要添加的角色 >',
    '<No animation>': '<无动作>',
    'Please copy the preset link below:': '请复制以下预设链接：',
    'Waiting for clipboard read permission; try again shortly': '正在等待剪贴板读取权限，请稍候',
    'Enter preset link:': '请输入预设链接：',
    'Invalid preset content': '预设内容无效',
    'Photo capture failed': '拍照失败',
    'Show outline even when mesh parts are hidden': '即使网格部件被隐藏也显示其描边',
    'Copied to clipboard!': '已复制到剪贴板！',

    '3D Stage': '3D 场景',
    'Stage Runtime': '场景运行时',
    'Reset stage transform': '重置场景变换',
    'Place characters at stage spawns': '将角色放置到场景出生点',
    'Seek (seconds)': '定位时间（秒）',
    'Time scale': '时间倍率',
    'Play': '播放',
    'Pause': '暂停',
    'Restart': '重新开始',
    'Visible': '可见',
    'RotateY': 'Y 轴旋转',
    'Scale': '缩放',
    'Reset': '重置',

    'Character (Selected)': '角色（当前选中）',
    'Characters (Global)': '角色（全局）',
    'Outline': '描边',
    'Meshes': '网格部件',
    'OutlineVisible': '显示描边',
    'OutlineThickness': '描边粗细',
    'OutlineColor': '描边颜色',
    'OutlineAlwaysVisible': '隐藏网格时仍显示描边',
    'Arrange in line': '直线排列',
    'Arrange in arc': '弧形排列',
    'Center all': '全部居中',
    'RotateX': 'X 轴旋转',
    'RotateZ': 'Z 轴旋转',
    'AnimationSpeed': '动作速度',
    'Reset character': '重置角色',

    'Color': '色彩',
    'Brightness': '亮度',
    'Contrast': '对比度',
    'Saturation': '饱和度',

    'Camera': '相机',
    'FOV': '视野角（FOV）',
    'CameraRotation': '相机旋转',
    'CameraResolution': '相机分辨率',
    'CurrentResolution': '当前分辨率',
    'CameraFullscreen': '相机画面全屏',
    'Reset camera': '重置相机',

    'Lighting': '光照',
    'BgColor': '背景颜色',
    'AmbientLightColor': '环境光颜色',
    'DirectionalLightColor': '方向光颜色',
    'AmbientLight': '环境光强度',
    'DirectionalLight': '方向光强度',
    'LightAngle': '光源角度',
    'LightHeight': '光源高度',
    'LightDistance': '光源距离',
    'Bloom': '泛光（Bloom）',
    'BloomStrength': '泛光强度',
    'BloomRadius': '泛光半径',
    'BloomThreshold': '泛光阈值',
    'CameraEnvironment': '摄像头环境光',
    'DynamicAmbient': '动态环境反射（PMREM）',
    'DynamicLight': '动态主光估算',
    'Reset lighting': '重置光照',

    'Shader': '着色器（Shader）',
    'Apply recovered ReDrive baseline': '应用已恢复的 ReDrive 基线',
    'Legacy colour blend (debug only)': '旧版色彩混合（仅调试）',
    'Override exact scene lighting': '覆盖场景精确光照',
    'Physical light influence': '物理光照影响',
    'Albedo lift': '反照率提升',
    'Shadow tint': '阴影染色',
    'Shadow tint strength': '阴影染色强度',
    'Highlight tint': '高光染色',
    'Highlight tint strength': '高光染色强度',
    'Control B / gradient specular': '控制贴图 B／渐变镜面高光',
    'Control G response tint': '控制贴图 G 响应染色',
    'Toon shadow selection': '卡通阴影选择',
    'Control R pre-mix': '控制贴图 R 预混合',
    'Light probe value': '光照探针值',
    'Shadow threshold': '阴影阈值',
    'Shadow softness': '阴影柔化',
    'Ambient shadow amount': '环境阴影量',
    'Control R threshold offset': '控制贴图 R 阈值偏移',
    'AngelRing (official GLES projection)': '天使环（AngelRing，官方 GLES 投影）',
    'Diagnostic A/B toggle': '诊断 A/B 开关',
    'Timeline / scene additional Rim': '时间轴／场景附加轮廓光（Rim）',
    'Enabled': '启用',
    'HDR color approximation': 'HDR 颜色近似',
    'Strength': '强度',
    'Threshold': '阈值',
    'Feather': '羽化',
    'Direction X': '方向 X',
    'Direction Y': '方向 Y',
    'Directionality': '方向性',
    'Per-renderer animation Fresnel': '逐渲染器动画菲涅耳（Fresnel）',
    'Global debug override': '全局调试覆盖',

    'Shadow': '阴影',
    'ShadowEnabled': '启用阴影',
    'ShadowType': '阴影类型',
    'ShadowResolution': '阴影分辨率',
    'ShadowBias': '阴影偏移',
    'FloorShadowOpacity': '地面阴影不透明度',
    'ShadowAlphaTest': '阴影透明度测试',
    'ShadowCameraHelper': '显示阴影相机辅助线',
    'ShadowCameraSize': '阴影相机范围',
    'ShadowCameraOffsetX': '阴影相机 X 偏移',
    'ShadowCameraOffsetY': '阴影相机 Y 偏移',

    'Misc': '其他',
    'Axes': '显示坐标轴',
    'PixelRatio': '像素倍率',
    'UseEffectComposer': '使用后期合成器',
    'AntiAliasing(Composer)': '抗锯齿（后期合成器）',
    'AntiAliasingLevel': '抗锯齿等级',
    'PerformanceMetrics': '性能指标',
    'Auto': '自动',
    'Always': '始终',
    'Never': '从不',
    'None': '无',

    'Export presets': '导出预设',
    'Import presets': '导入预设',
    'Reset everything': '全部重置',

    'START AR': '启动 AR',
    'STOP AR': '退出 AR',
    'AR NOT SUPPORTED': '当前设备不支持 AR',
    'AR NOT ALLOWED': '未获得 AR 权限',
}

const uiTextPatterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/^\[Research\]\s*/, '[研究] '],
    [/^\[Official geometry\/([^\]]+)\]\s*/, '[官方几何/$1] '],
    [/^\[Official dynamic partial\/([^\]]+)\]\s*/, '[官方动态（部分）/$1] '],
    [/^\[Official dynamic\/([^\]]+)\]\s*/, '[官方动态/$1] '],
    [/^\[Official\/([^\]]+)\]\s*/, '[官方/$1] '],
    [/^Loading FBX\.\.\.$/, '正在加载 FBX 模型……'],
    [/^Loading textures\.\.\.$/, '正在加载贴图……'],
    [/^Loading (\d+) \/ (\d+) models\.\.\.$/, '正在加载模型：$1 / $2……'],
    [/^Import preset with (\d+) characters\?$/, '是否导入包含 $1 个角色的预设？'],
    [/^Auto: use the effect composer only when required[\s\S]*$/, '自动：仅在绘制选择描边等必要情况使用后期合成器。\n始终：始终通过后期合成器渲染，并停用直接渲染。\n从不：停用后期合成器并始终直接渲染（这会导致选择描边不可见）。\n\n强制启用后期合成器并使用高等级抗锯齿可改善画质，但会降低性能。'],
    [/^Anti-aliasing method used by the effect composer[\s\S]*$/, '后期合成器使用的抗锯齿方式。\n此选项不影响始终采用默认 MSAA 的直接渲染。'],
]

let currentLocale: UiLocale = detectInitialLocale()
let installed = false
const originalText = new WeakMap<Text, string>()
const originalAttributes = new WeakMap<Element, Map<string, string>>()
const translatableAttributes = ['title', 'alt', 'aria-label', 'placeholder'] as const

export function getUiLocale(): UiLocale {
    return currentLocale
}

export function translateUiText(text: string, locale: UiLocale = currentLocale): string {
    if (locale === 'en' || !text) return text
    const exact = zhCnUiText[text]
    if (exact) return exact
    for (const [pattern, replacement] of uiTextPatterns) {
        if (pattern.test(text)) return text.replace(pattern, replacement)
    }
    return text
}

export function setUiLocale(locale: UiLocale) {
    applyLocale(locale, true)
}

export function installLocalization() {
    if (installed) return
    installed = true

    const toggle = document.getElementById('language-toggle') as HTMLButtonElement | null
    toggle?.addEventListener('click', () => {
        setUiLocale(currentLocale === 'en' ? 'zh-CN' : 'en')
    })

    applyLocale(currentLocale, false)

    const observer = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'attributes' && record.target instanceof Element) {
                translateElementAttributes(record.target)
            }
            record.addedNodes.forEach(node => {
                if (node instanceof Element || node instanceof Text) translateTree(node)
            })
        }
    })
    observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [...translatableAttributes],
    })
}

/** Backward-compatible alias retained for older imports. */
export const installZhCnUi = installLocalization

function applyLocale(locale: UiLocale, persist: boolean) {
    currentLocale = locale
    if (persist) {
        try {
            localStorage.setItem(LOCALE_STORAGE_KEY, locale)
        } catch {
            // Storage can be unavailable in private or restricted contexts.
        }
    }

    document.documentElement.lang = locale
    translateTree(document)
    applyDocumentMetadata(locale)
    updateLanguageToggle(locale)
    document.dispatchEvent(new CustomEvent('magius:localechange', {
        detail: { locale },
    }))
}

function translateTree(root: Document | Element | Text) {
    if (root instanceof Text) {
        translateTextNode(root)
        return
    }

    if (root instanceof Element) translateElementAttributes(root)
    root.querySelectorAll('*').forEach(translateElementAttributes)

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
        translateTextNode(node as Text)
        node = walker.nextNode()
    }
}

function translateTextNode(node: Text) {
    const parent = node.parentElement
    if (!parent || shouldIgnore(parent)) return

    const canonical = originalText.get(node) ?? node.nodeValue ?? ''
    if (!originalText.has(node)) originalText.set(node, canonical)
    const trimmed = canonical.trim()
    if (!trimmed) return

    const start = canonical.indexOf(trimmed)
    const translated = translateUiText(trimmed)
    node.nodeValue = canonical.slice(0, start)
        + translated
        + canonical.slice(start + trimmed.length)
}

function translateElementAttributes(element: Element) {
    if (shouldIgnore(element)) return

    let originals = originalAttributes.get(element)
    if (!originals) {
        originals = new Map<string, string>()
        originalAttributes.set(element, originals)
    }

    for (const attribute of translatableAttributes) {
        if (!element.hasAttribute(attribute)) continue
        if (!originals.has(attribute)) {
            originals.set(attribute, element.getAttribute(attribute) ?? '')
        }
        const canonical = originals.get(attribute) ?? ''
        element.setAttribute(attribute, translateUiText(canonical))
    }
}

function shouldIgnore(element: Element) {
    return element.matches('script, style, [data-i18n-ignore], [data-i18n-ignore] *')
}

function updateLanguageToggle(locale: UiLocale) {
    const toggle = document.getElementById('language-toggle') as HTMLButtonElement | null
    if (!toggle) return

    const targetIsChinese = locale === 'en'
    toggle.textContent = targetIsChinese ? '中' : 'EN'
    toggle.title = targetIsChinese ? 'Switch to Simplified Chinese' : '切换为英文'
    toggle.setAttribute('aria-label', toggle.title)
    toggle.setAttribute('aria-pressed', String(locale === 'zh-CN'))
    toggle.dataset.currentLocale = locale
}

function applyDocumentMetadata(locale: UiLocale) {
    const metadata = pageMetadata[locale]
    document.title = metadata.title

    const description = document.querySelector('meta[name="description"]')
    description?.setAttribute('content', metadata.description)

    const ogDescription = document.querySelector('meta[property="og:description"]')
    ogDescription?.setAttribute('content', metadata.ogDescription)

    const structuredData = document.querySelector('script[type="application/ld+json"]')
    if (structuredData?.textContent) {
        try {
            const data = JSON.parse(structuredData.textContent)
            data.description = metadata.ogDescription
            structuredData.textContent = JSON.stringify(data, null, 4)
        } catch {
            // Preserve the original JSON-LD if it was modified externally.
        }
    }
}

function detectInitialLocale(): UiLocale {
    try {
        const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
        if (saved === 'en' || saved === 'zh-CN') return saved
    } catch {
        // Fall through to browser-language detection.
    }

    const languages = navigator.languages?.length
        ? navigator.languages
        : [navigator.language]
    return languages.some(language => language.toLowerCase().startsWith('zh'))
        ? 'zh-CN'
        : 'en'
}
