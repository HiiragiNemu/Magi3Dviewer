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
    'Take a photo': '拍照',
    'Model': '角色模型',
    'Choose model': '选择角色模型',
    'Remove selected model': '移除当前角色模型',
    '<No target selected>': '<未选择角色>',
    'Add model': '添加角色模型',
    'Animation': '动作',
    'Choose animation': '选择动作',
    'Choose expression': '选择表情',
    'Default face': '默认表情',
    'Manual face controls': '手动面部控制',
    'Auto blink': '自动眨眼',
    'Enable automatic blink for the selected expression': '为当前表情启用自动眨眼',
    'Manual blink': '手动闭眼',
    "Set eyelid closure using this character's official blink bindings": '使用当前角色的官方眨眼绑定调节闭眼幅度',
    'Expression strength': '表情幅度',
    "Blend the selected official expression with this character's default face": '在当前角色的默认脸与所选官方表情之间调节幅度',
    'Transition': '过渡时间',
    'Set the transition duration used by the next expression selection': '设置下一次切换表情时的过渡时长',
    'Mouth corner': '嘴角',
    "Adjust this character's available mouth-corner bindings": '调节当前角色实际拥有的嘴角绑定（左为下垂，右为上扬）',
    'Play animation': '播放动作',
    'Pause animation': '暂停动作',
    'Choose 3D stage': '选择 3D 场景',
    'Collapse controls': '折叠控制栏',
    'Expand controls': '展开控制栏',
    'Rendering controls': '渲染设置',
    'Show rendering controls': '展开渲染设置',
    'Hide rendering controls': '收起渲染设置',
    'Action panel': '动作面板',
    'Show action parameters': '展开动作参数',
    'Hide action parameters': '收起动作参数',
    'Action parameters': '动作参数调节',
    'Expression panel': '表情面板',
    'Show expression parameters': '展开表情参数',
    'Hide expression parameters': '收起表情参数',
    'Expression parameters': '表情参数调节',
    'Timeline': '动作时间轴',
    'Animation speed': '动作速度',
    'Bone search': '骨骼搜索',
    'Search bones': '搜索骨骼',
    'Morph search': '变形通道搜索',
    'Search morphs': '搜索变形通道',
    'Bone': '骨骼',
    'Unnamed bone': '未命名骨骼',
    'No bone channels': '当前角色没有骨骼通道',
    'No morph channels': '当前角色没有变形通道',
    'Select a character to edit action parameters': '选择角色后可调节动作参数',
    'Select a character to edit expression parameters': '选择角色后可调节表情参数',
    'Reset action parameters': '重置动作参数',
    'Reset expression parameters': '重置表情参数',
    'Direct drag pose': '直接拖拽编辑动作',
    'Exit direct drag pose': '退出拖拽编辑',
    'Click a body part, then drag it or use the rotation rings': '点击身体部位后直接拖拽，或使用旋转环精调',
    'Drag vertically for local X, horizontally for local Z; hold Alt for local Y': '纵向拖拽调局部 X，横向拖拽调局部 Z；按住 Alt 调局部 Y',
    'No weighted bone at this point': '此处没有可编辑的蒙皮骨骼',
    'Selected bone': '当前骨骼',
    'Common body controls': '常用肢体设置',
    'All bone controls': '全部骨骼设置',
    'Common expression controls': '常用表情设置',
    'All expression controls': '全部表情设置',
    'Character movement': '旋转移动角色',
    'Show character movement': '展开角色移动',
    'Hide character movement': '收起角色移动',
    'Rotate character left': '向左旋转角色',
    'Rotate character right': '向右旋转角色',
    'Tilt character left': '角色左倾',
    'Tilt character right': '角色右倾',
    'Turn character left': '角色向左转身',
    'Turn character right': '角色向右转身',
    'Move character up': '向上移动角色',
    'Move character down': '向下移动角色',
    'Move character left': '向左移动角色',
    'Move character right': '向右移动角色',
    'Reset character transform': '重置角色位置与方向',
    'Capture character': '截取仅角色画面',
    'Capture with background': '截取带背景画面',
    'Record character': '录制仅角色画面',
    'Record with background': '录制带背景画面',
    'Record MP4 with background': '录制带背景 MP4',
    'Char Only': '仅角色',
    'With BG': '含背景',
    'Rec Char': '录制角色',
    'Rec/BG': '录制/BG',
    'MP4/BG': 'MP4/BG',
    'Stop': '停止',
    'Stop recording': '停止录制',
    'Video recording is not supported by this browser': '当前浏览器不支持视频录制',
    'Video recording could not be started': '视频录制启动失败',
    'Video recording could not be completed': '视频录制封装失败',
    'Recording format': '录制规格',
    'Recording resolution': '录制分辨率',
    'Current view': '当前画面',
    'Recording aspect ratio': '录制画幅比例',
    'Recording orientation': '录制方向',
    'Quality': '清晰度',
    'Aspect ratio': '画幅',
    'Orientation': '方向',
    'Landscape': '横版',
    'Portrait': '竖版',
    'WebM duration metadata could not be written': 'WebM 录制时长元数据写入失败',
    'Enter VR': '进入 VR',
    'Exit VR': '退出 VR',
    'VR is not available in this browser': '当前浏览器不支持 VR',
    'No immersive VR device is available': '未检测到可用的沉浸式 VR 设备',
    'VR session could not be started': 'VR 会话启动失败',
    'Viewer tools': '查看器工具',
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
    '<No expression data>': '<无表情数据>',
    'Please copy the preset link below:': '请复制以下预设链接：',
    'Waiting for clipboard read permission; try again shortly': '正在等待剪贴板读取权限，请稍候',
    'Enter preset link:': '请输入预设链接：',
    'Invalid preset content': '预设内容无效',
    'Photo capture failed': '拍照失败',
    'Show outline even when mesh is hidden': '即使网格部件被隐藏也显示其描边',
    'Show outline even when mesh parts are hidden': '即使网格部件被隐藏也显示其描边',
    'Copied to clipboard!': '已复制到剪贴板！',

    '3D Stage': '3D 场景',
    'Stage Runtime': '场景运行时',
    'Stage fidelity / evidence': '场景还原度／证据',
    'Inspect recovered scene provenance and remaining fidelity gaps': '检查场景来源证据与尚未还原的效果',
    'Stage ID': '场景 ID',
    'Category': '类别',
    'Official asset': '官方资源',
    'Dynamic status': '动态还原状态',
    'Region': '地区版本',
    'AssetBundle': 'AssetBundle',
    'Manifest sources': 'Manifest 来源数',
    'Direct dependencies': '直接依赖',
    'Dependency closure': '完整依赖闭包',
    'Closure SHA-256': '依赖闭包 SHA-256',
    'Render profile': '渲染配置来源',
    'Recovered components': '已恢复组件',
    'Lightmap': '光照贴图',
    'Environment map': '环境反射贴图',
    'Runtime clips': '运行时动画片段',
    'Typetree errors': 'Typetree 解析错误',
    'Manifest provenance': 'Manifest 来源证据',
    'Remaining fidelity gaps': '尚未还原的效果',
    'Recovered evidence': '已恢复证据',
    'No declared dynamic gaps': '没有已声明的动态缺口',
    'No structured gap list': '尚无结构化缺口清单',
    'No evidence attached': '尚未附加证据',
    'Yes': '是',
    'No': '否',
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
    [/^Stage fidelity \/ evidence — (.+)$/, '场景还原度／证据 — $1'],
    [/^\[Research\]\s*/, '[研究] '],
    [/^\[Official geometry\/([^\]]+)\]\s*/, '[官方几何/$1] '],
    [/^\[Official dynamic partial\/([^\]]+)\]\s*/, '[官方动态（部分）/$1] '],
    [/^\[Official dynamic\/([^\]]+)\]\s*/, '[官方动态/$1] '],
    [/^\[Official\/([^\]]+)\]\s*/, '[官方/$1] '],
    [/^Loading FBX\.\.\.$/, '正在加载 FBX 模型……'],
    [/^Loading textures\.\.\.$/, '正在加载贴图……'],
    [/^Loading (\d+) \/ (\d+) models\.\.\.$/, '正在加载模型：$1 / $2……'],
    [/^Import preset with (\d+) characters\?$/, '是否导入包含 $1 个角色的预设？'],
    [/^Auto: Use effect composer only when needed[\s\S]*$/, '自动：仅在绘制选择描边等必要情况使用后期合成器。\n始终：始终通过后期合成器渲染，并停用直接渲染。\n从不：停用后期合成器并始终直接渲染（这会导致选择描边不可见）。\n\n强制启用后期合成器并使用高等级抗锯齿可改善画质，但会降低性能。'],
    [/^Anti-aliasing method used for the effect composer[\s\S]*$/, '后期合成器使用的抗锯齿方式。\n此选项不影响始终采用默认 MSAA 的直接渲染。'],
]

const officialExpressionLabels: Readonly<Record<string, string>> = {
    Smile: '微笑',
    Smiling: '笑容',
    Serious: '严肃',
    Annoyed: '不悦',
    Furious: '愤怒',
    Sorrow: '哀伤',
    Sadness: '悲伤',
    Troubled: '困扰',
    Dumbfounded: '愕然',
    Wry: '苦笑',
    Surprised: '惊讶',
    Astonished: '震惊',
    Damage: '受伤',
    Expressionless: '无表情',
    Despair: '绝望',
}

/**
 * These are presentation labels only.  Select values remain the byte-exact
 * official clip/state names, so presets, AOC mappings and runtime lookup never
 * depend on a translation.
 */
const officialAnimationBaseLabels: Readonly<Record<string, string>> = {
    Abnormality: '异常状态',
    CommonWait: '通用待机',
    Damage: '受伤',
    Down: '倒地',
    HomeUnique01: '看板专属动作 1',
    HomeWait01: '看板待机 1',
    HomeWait02: '看板待机 2',
    HomeWait0102: '看板待机 1→2',
    HomeTransition01: '看板动作过渡 1',
    StandbyTransition: '战斗准备过渡',
    Standby: '战斗准备',
    Victory: '胜利',
    Wait: '待机',
    Attack: '攻击',
    Skill: '技能',
    Magia: '魔法必杀',
    Guard: '防御',
    Dodge: '闪避',
    Run: '奔跑',
    Walk: '行走',
    Entry: '入场',
    Appear: '登场',
    Death: '退场',
}

const officialAnimationSuffixLabels: Readonly<Record<string, string>> = {
    L: '循环',
    S: '起始',
    SE: '单次',
}

const boneSemanticLabels: ReadonlyArray<readonly [RegExp, string]> = [
    [/(?:^|[_ .:/-])(?:root|origin)(?:$|[_ .:/-])/i, '根骨骼'],
    [/(?:hip|hips|pelvis)/i, '骨盆'],
    [/(?:waist|center)/i, '腰部'],
    [/(?:spine)/i, '脊柱'],
    [/(?:chest|bust)/i, '胸部'],
    [/(?:neck)/i, '颈部'],
    [/(?:head)/i, '头部'],
    [/(?:clavicle|shoulder)/i, '肩部'],
    [/(?:forearm|lowerarm)/i, '前臂'],
    [/(?:upperarm)/i, '上臂'],
    [/(?:elbow)/i, '手肘'],
    [/(?:hand|wrist)/i, '手部'],
    [/(?:thigh|upperleg)/i, '大腿'],
    [/(?:calf|shin|lowerleg)/i, '小腿'],
    [/(?:knee)/i, '膝盖'],
    [/(?:foot|ankle)/i, '脚部'],
    [/(?:toe)/i, '脚趾'],
]

const technicalTokenLabels: Readonly<Record<string, string>> = {
    left: '左', l: '左', right: '右', r: '右', center: '中央', c: '中央',
    root: '根骨骼', origin: '原点', hip: '髋部', hips: '髋部', pelvis: '骨盆',
    waist: '腰部', spine: '脊柱', chest: '胸部', bust: '胸部', neck: '颈部', head: '头部',
    clavicle: '锁骨', shoulder: '肩部', upperarm: '上臂', arm: '手臂', forearm: '前臂',
    lowerarm: '前臂', elbow: '手肘', hand: '手部', wrist: '手腕', finger: '手指', thumb: '拇指',
    thigh: '大腿', upperleg: '大腿', leg: '腿部', lowerleg: '小腿', calf: '小腿', shin: '小腿',
    knee: '膝盖', foot: '脚部', ankle: '脚踝', toe: '脚趾', twist: '扭转', roll: '滚转',
    eye: '眼睛', eyes: '眼睛', eyelid: '眼睑', brow: '眉毛', eyebrow: '眉毛', eyebrows: '眉毛',
    blink: '眨眼', open: '张开', opened: '张开', close: '闭合', closed: '闭合',
    smile: '微笑', smiling: '笑容', mouth: '嘴', lip: '嘴唇', corner: '嘴角',
    cheek: '脸颊', tear: '泪水', tongue: '舌头', jaw: '下颌', face: '面部',
    up: '向上', down: '向下', lower: '下部', upper: '上部', inside: '内侧', outside: '外侧', inner: '内侧', outer: '外侧',
    forward: '向前', back: '向后', long: '长', short: '短', form: '形状', shape: '形状',
    anger: '生气', angry: '生气', sad: '悲伤', sorrow: '哀伤', damage: '受伤',
    motion: '动作', mtn: '动作', animation: '动作', anim: '动作', home: '看板', wait: '待机',
    standby: '战斗准备', transition: '过渡', victory: '胜利', attack: '攻击', skill: '技能',
    magia: '魔法必杀', guard: '防御', dodge: '闪避', run: '奔跑', walk: '行走', entry: '入场',
    appear: '登场', death: '退场', loop: '循环', expression: '表情', facial: '表情',
}

function splitTechnicalTokens(value: string): string[] {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
        .split(/[_ .:/\\-]+/)
        .filter(Boolean)
}

function translateTechnicalTokens(value: string): string | undefined {
    const tokens = splitTechnicalTokens(value)
    let translated = false
    const label = tokens.map(token => {
        const mapped = technicalTokenLabels[token.toLocaleLowerCase()]
        if (mapped) translated = true
        return mapped ?? token
    }).join(' ')
    return translated ? label : undefined
}

export function translateBoneChannelLabel(name: string, locale: UiLocale = currentLocale): string {
    if (locale === 'en' || !name) return name
    const side = /(?:^|[_ .:/-])(?:left|l)(?:$|[_ .:/-])/i.test(name) || /^L(?=[A-Z])/.test(name)
        ? '左'
        : /(?:^|[_ .:/-])(?:right|r)(?:$|[_ .:/-])/i.test(name) || /^R(?=[A-Z])/.test(name)
            ? '右'
            : ''
    const semantic = boneSemanticLabels.find(([pattern]) => pattern.test(name))?.[1]
    if (semantic) {
        const detail = /(?:twist|roll)/i.test(name) ? '（扭转）' : ''
        const number = name.match(/\d+$/)?.[0]
        return `${side}${semantic}${detail}${number ? ` ${number}` : ''}`
    }
    return translateTechnicalTokens(name) ?? name
}

export function translateMorphChannelLabel(name: string, locale: UiLocale = currentLocale): string {
    if (locale === 'en' || !name) return name
    return translateTechnicalTokens(name) ?? name
}

function translateOfficialRuntimeOption(text: string): string | undefined {
    const canonical = text.trim()
    const expression = officialExpressionLabels[canonical]
    if (expression) return expression

    const special: Readonly<Record<string, string>> = {
        HomeWait02transition: '看板待机 2 过渡',
        transition_HomeWait01: '看板待机 1 过渡',
        W_HomeWait01_L: '武器看板待机 1（循环）',
    }
    if (special[canonical]) return special[canonical]

    const match = canonical.match(/^(.+?)_(SE|S|L)$/)
    const base = match?.[1] ?? canonical
    const suffix = match?.[2]
    const baseLabel = officialAnimationBaseLabels[base]
    if (baseLabel) return suffix ? `${baseLabel}（${officialAnimationSuffixLabels[suffix]}）` : baseLabel

    const technical = translateTechnicalTokens(base)
    if (!technical) return undefined
    return suffix ? `${technical}（${officialAnimationSuffixLabels[suffix]}）` : technical
}

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
    const runtimeOption = translateOfficialRuntimeOption(text)
    if (runtimeOption) return runtimeOption
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
    const nextValue = canonical.slice(0, start)
        + translated
        + canonical.slice(start + trimmed.length)
    if (node.nodeValue !== nextValue) node.nodeValue = nextValue
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
        const translated = translateUiText(canonical)
        if (element.getAttribute(attribute) !== translated) {
            element.setAttribute(attribute, translated)
        }
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
