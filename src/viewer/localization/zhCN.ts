/**
 * Simplified-Chinese presentation layer for third-party/dynamic UI labels.
 *
 * lil-gui uses controller/folder names as preset keys. Translating those names
 * at construction time would invalidate existing shared preset URLs, so this
 * module translates only the rendered DOM text and leaves the underlying keys
 * untouched.
 */
export const zhCnUiText: Readonly<Record<string, string>> = {
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
    'Copied to clipbaord!': '已复制到剪贴板！',

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
]

export function translateUiText(text: string): string {
    const exact = zhCnUiText[text]
    if (exact) return exact
    for (const [pattern, replacement] of uiTextPatterns) {
        if (pattern.test(text)) return text.replace(pattern, replacement)
    }
    return text
}

function translateElement(element: Element) {
    if (element instanceof HTMLElement && element.hasAttribute('title')) {
        const title = element.getAttribute('title') ?? ''
        const translatedTitle = translateUiText(title)
        if (translatedTitle !== title) element.setAttribute('title', translatedTitle)
    }

    if (!element.matches('.lil-gui .name, .lil-gui .title, .lil-gui option, #stage-selector option, #camera-mode-list button')) return
    const original = element.textContent?.trim() ?? ''
    const translated = translateUiText(original)
    if (translated !== original) element.textContent = translated
}

function translateTree(root: ParentNode) {
    if (root instanceof Element) translateElement(root)
    root.querySelectorAll('*').forEach(translateElement)
}

let installed = false

/** Install the DOM-only translator once. Safe to call before dynamic GUI creation. */
export function installZhCnUi() {
    if (installed) return
    installed = true

    translateTree(document)

    const observer = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'attributes' && record.target instanceof Element) {
                translateElement(record.target)
            }
            record.addedNodes.forEach(node => {
                if (node instanceof Element) translateTree(node)
            })
        }
    })
    observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['title'],
    })
}
