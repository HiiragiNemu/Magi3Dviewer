import {
    translateJaJpBoneChannelLabel,
    translateJaJpMorphChannelLabel,
    translateJaJpUiText,
} from './jaJP'

export type UiLocale = 'en' | 'zh-CN' | 'ja-JP'

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
    'ja-JP': {
        title: 'Magius3Dviewer｜Magia Exedra 公式風3Dシェーダービューアー',
        description: 'Magius3Dviewer は、ReDriveToon、AngelRing、複数キャラクター配置、切り替え可能な3Dシーンを再現する独立した Magia Exedra WebGL 3Dビューアーです。',
        ogDescription: 'ReDriveToon、AngelRing、シーン配置機能を備えた Magia Exedra 3Dビューアー。',
    },
}

/**
 * English remains the canonical UI key so lil-gui preset names and shared URLs
 * stay stable. Simplified Chinese and Japanese are presentation layers applied
 * to the DOM.
 */
export const zhCnUiText: Readonly<Record<string, string>> = {
    "Replace": "替换",
    "Load": "加载",
    "Added": "已添加",
    "Add character": "添加角色",
    "Active characters": "已添加角色",
    "No characters added": "尚未添加角色",
    "Select an added character to replace": "选择一个已添加角色进行替换",
    "Select an added enemy to replace": "选择一个已添加敌人进行替换",
    "Enemy replaced": "敌人已替换",
    "0 repeats forever": "0 为循环；留空自动",
    "Drag to look, right-drag to pan; double-click the view to lock the mouse. Escape releases the cursor and keeps TPS on.": "拖动转视角，右键拖动平移；双击画面锁定鼠标。Esc 释放鼠标但保持 TPS。",
    "Neck": "颈部",
    "Waist": "腰部",
    "Spine": "脊柱",
    "Pelvis": "骨盆",
    "Left shoulder": "左肩",
    "Right shoulder": "右肩",
    "Left upper arm": "左上臂",
    "Right upper arm": "右上臂",
    "Left thigh": "左大腿",
    "Right thigh": "右大腿",

    "Redo pose": "重做姿态",
    "Reset selected part": "重置当前部位",
    "Move whole character": "移动整个角色",
    "Keep hand / foot orientation": "保持手掌／脚掌朝向",
    "Elbow / knee bend direction": "肘部／膝盖弯曲方向",
    "Choose a hand or foot, then drag the arrows or the body part. Shift: fine adjustment. Alt: depth. W / E: move / rotate. Ctrl+Z: undo.": "先选择手或脚，再拖动坐标箭头或对应部位。Shift 精细调整；Alt 前后移动；W／E 切换移动／旋转；Ctrl+Z 撤销。超出肢体长度时自动限位，不会拉长骨骼。",
    "Left hand": "左手",
    "Right hand": "右手",
    "Left foot": "左脚",
    "Right foot": "右脚",
    "Left elbow": "左肘",
    "Right elbow": "右肘",
    "Left knee": "左膝",
    "Right knee": "右膝",
    "Head": "头部",
    "Chest": "胸部",
    "Joint translation is unavailable; use Root placement or IK target": "此部位不能直接平移；请旋转该关节，或选择手脚使用 IK",
    "Move and rotate": "移动旋转",
    "Hide movement and rotation": "收起移动旋转",
    "Selected object": "当前对象",
    "Click an object to move it": "点击对象即可调整",
    "Choose a character to add weapons": "选择角色即可添加武器",
    "Use Move and rotate or drag the axes to place the selected object.": "使用「移动旋转」面板或拖动坐标轴摆放当前对象。",
    "Forward": "向前",
    "Backward": "向后",
    "Move selected object up": "上移",
    "Move selected object down": "下移",
    "Move selected object left": "向左",
    "Move selected object right": "向右",
    "Tilt selected object left": "向左倾斜",
    "Tilt selected object right": "向右倾斜",
    "Turn selected object left": "向左转动",
    "Turn selected object right": "向右转动",
    "Reset selected object transform": "重置位置、旋转和缩放",
    "Move selected object forward": "前移",
    "Move selected object backward": "后移",
    "Show TPS actions": "展开 TPS 动作",
    "Hide TPS actions": "收起 TPS 动作",
    "Action key bindings": "动作快捷键",
    "Q action": "Q 键动作",
    "R action": "R 键动作",
    "E action": "E 键动作",
    "F action": "F 键动作",
    "T action": "T 键动作",
    "X action": "X 键动作",
    "Position X": "位置 X",
    "Rotation (degrees) X": "旋转（度）X",
    "Scale X": "缩放 X",
    "Position Y": "位置 Y",
    "Rotation (degrees) Y": "旋转（度）Y",
    "Scale Y": "缩放 Y",
    "Position Z": "位置 Z",
    "Rotation (degrees) Z": "旋转（度）Z",
    "Scale Z": "缩放 Z",
    "Frame selected actor": "框选当前角色",
    "Collapse tools": "收起工具",
    "Expand tools": "展开工具",
    "Usage tips": "操作提示",
    "Hollow circles mark joints. Choose an exact joint where circles overlap. Joint mode rotates; IK mode moves the target. After framing, zoom and orbit freely.": "空心圈是关节；重叠处选择精确节点。关节模式旋转，IK 模式移动目标；取景后可自由缩放/旋转。",
    "Actors": "演员",
    "Pose / IK": "姿态 / IK",
    "Keyframes": "关键帧",
    "Audio": "音频",
    "Project": "项目",
    "Actions": "动作",
    "Audio sources": "声源",
    "Clip settings": "片段设置",
    "Existing tracks": "已有音轨",
    "Overlapping joints": "重叠关节",
    "Undo pose": "撤销姿态",
    "Restore official pose": "恢复官方姿态",
    "Tracks / seconds": "轨道 / 秒",
    "Drag joints in the viewport: joint mode rotates, IK mode moves the target. Select an exact joint where nodes overlap. Meshes are not joint drag targets.": "直接拖动画布关节：关节模式旋转，IK 模式移动目标；重叠节点先选具体关节。Mesh 不参与关节拖拽。",
    "Search audio": "搜索声源",
    "Character ID, original text, translation or stable key": "角色 ID、原文、译文或资源键",
    "Audio source": "声源",
    "Audio track": "音轨",
    "Audio target": "音轨目标",
    "Background (no character lip sync)": "背景（不驱动角色口型）",
    "Start (seconds)": "开始时间（秒）",
    "Media offset (seconds)": "媒体偏移（秒）",
    "Duration (seconds)": "播放时长（秒）",
    "Leave blank to play the remaining source duration": "留空：播放声源剩余时长",
    "Enable lip sync": "启用口型",
    "Choose audio source": "选择声源",
    "Background (not bound to a character)": "背景（不绑定角色）",
    "New track": "新建音轨",
    "Source and timing": "声源与编排",
    "Add track": "添加音轨",
    "Save track": "保存音轨",
    "Return to Viewer": "返回查看器",
    "Performance workspace": "演出工作区",
    "Performance task tools": "演出工具",
    "Audio and action timeline": "音频和动作时间轴",
    "Transport": "播放控制",
    "Keyframe tracks": "关键帧轨道",
    "Performance editor": "演出编辑器",
    "Performance status": "演出状态",
    "Actors / Scene outliner": "演员与场景列表",
    "Manipulation / Inspector": "姿态与属性",
    "Project / Presets": "项目与预设",
    "Audio / Lip-sync tracks": "音频与口型轨道",
    "Performance actor": "演出演员",
    "Performance action": "演出动作",
    "Drag mode": "拖拽模式",
    "Pose joint": "姿态关节",
    "Keyframe channel": "关键帧通道",
    "Expression channel": "表情通道",
    "Timeline keyframe": "时间轴关键帧",
    "Root placement": "整体摆放",
    "Joint rotation": "关节旋转",
    "IK target": "IK 目标",
    "Timeline seconds": "时间轴位置（秒）",
    "Timeline scrubber": "时间轴进度",
    "Duration seconds": "总时长（秒）",
    "Expression weight": "表情权重",
    "Loop performance": "循环演出",
    "Loop action": "循环动作",
    "Playing": "播放中",
    "Paused / ready": "已暂停／就绪",
    "Ready": "就绪",
    "Drag selected": "拖动所选项",
    "End drag": "结束拖动",
    "Capture key": "记录关键帧",
    "Capture full pose": "记录完整姿态",
    "Move key to cursor": "将关键帧移到当前时间",
    "Delete key": "删除关键帧",
    "Stop / hand back": "停止并退出接管",
    "Timeline ruler": "时间轴刻度",
    "Timeline cursor": "时间轴游标",
    "Timeline lanes": "时间轴轨道",
    "Performance document JSON": "演出项目 JSON",
    "Import project file": "导入项目文件",
    "Save to JSON": "保存到 JSON",
    "Load from JSON": "从 JSON 载入",
    "Save project": "保存项目",
    "Load project": "载入项目",
    "Export project file": "导出项目文件",
    "Animation timeline": "动作进度",
    "root-position": "整体位置",
    "root-rotation": "整体旋转",
    "root-scale": "整体缩放",
    "bone-rotation": "骨骼旋转",
    "morph": "表情变形",
    "action": "动作",
    "Performance": "演出系统",
    "Default": "默认",
    "TPS Move: On": "TPS 移动：开",
    "TPS Move: Off": "TPS 移动：关",
    "Enable TPS character control": "开启 TPS 角色控制",
    "Disable TPS character control": "关闭 TPS 角色控制",
    "About me": "关于我",
    "When creating fan works with this tool, credit the tool author and provide a link to the tool.": "使用本工具二创，请注明工具作者以及提供工具链接。",
    "magia exedra / Magia Record Live2D Viewer": "magia exedra 魔法纪录l2d查看器",
    "MADE IN MAGIUS Downloads & Tutorials": "MADE IN MAGIUS下载中心和教程网站",
    "Support MADE IN MAGIUS": "赞助支持 MADE IN MAGIUS",
    "Join QQ Group": "加入交流群",
    "Bilibili MadeInMagius": "B站 MadeInMagius",
    "Follow on Bilibili": "关注我的B站动态",
    "Magical Girl Name Search & Height Compare": "魔法少女称呼搜索和身高对比",
    "Magia Record / Magia Exedra": "魔法纪录·Magia Exedra",
    "Magia Record / MAGIA EXEDRA Story Reader": "魔法纪录MAGIA EXEDRA 剧情阅读器",
    "CN/JP Bilingual Story Archive & Translation Platform": "中日双语剧情存档与翻译平台",
    "MAGIA EXEDRA Chinese WIKI": "MAGIA EXEDRA 中文WIKI",
    "Character & Event Stories & Voices": "角色剧情与活动剧情和语音",
    'Magius3Dviewer is loading the official-style shader and character model...': 'Magius3Dviewer 正在加载官方风格着色器与角色模型……',
    'Take a photo': '拍照',
    'Model': '角色模型',
    'Choose model': '选择角色模型',
    'Remove selected model': '移除当前角色模型',
    '<No target selected>': '<未选择角色>',
    'Add model': '添加角色模型',
    'Search:': '搜索：',
    'ID / Name': '编号/名称',
    'Search characters by name or ID': '按角色名称或编号搜索',
    'Characters': '角色',
    'Show character list': '展开角色清单',
    'Hide character list': '收起角色清单',
    'Search characters': '搜索角色',
    'Character list': '角色清单',
    'Selected character': '所选角色',
    'No character selected': '未选择角色',
    'Available characters': '可用角色',
    'Matching characters': '匹配角色',
    'No matching characters': '没有匹配的角色',
    'Switch character': '切换角色',
    'Character selected in viewer': '已在查看器中选择角色',
    'Magical girls': '魔法少女',
    'Show magical girl list': '展开魔法少女清单',
    'Hide magical girl list': '收起魔法少女清单',
    'Search magical girls': '搜索魔法少女',
    'Magical girl list': '魔法少女清单',
    'Selected magical girl': '所选魔法少女',
    'No magical girl selected': '未选择魔法少女',
    'Available magical girls': '可用魔法少女',
    'Matching magical girls': '匹配魔法少女',
    'No matching magical girls': '没有匹配的魔法少女',
    'Switch magical girl': '切换魔法少女',
    'Magical girl selected in viewer': '已在查看器中选择魔法少女',
    'Show scene list': '展开场景清单',
    'Hide scene list': '收起场景清单',
    'Search scenes': '搜索场景',
    'Scene list': '场景清单',
    'Selected scene': '所选场景',
    'No scene selected': '未选择场景',
    'Scene catalog': '场景目录',
    'Official entries': '官方',
    'Built-in references': '内置参考',
    'Selectable entries': '可选条目',
    'Awaiting restoration': '待恢复',
    'Unclassified entries': '未分类',
    'Catalog and selectable counts do not mean load-tested or user-accepted.': '目录和可选数量不代表加载测试或用户验收完成。',
    'Available scenes': '可用场景',
    'Matching scenes': '匹配场景',
    'No matching scenes': '没有匹配的场景',
    'Load selected scene': '加载所选场景',
    'Scene selected in viewer': '已在查看器中选择场景',
    "Move": "移动",
    "Rotate": "旋转",
    "Position": "位置",
    "Weapons": "武器",
    "Character weapon source": "角色武器来源",
    "Load weapons": "读取武器",
    "Weapon model": "武器模型",
    "Add weapon": "添加武器",
    "Placed weapons": "已放置武器",
    "Remove weapon": "移除武器",
    "Clear weapons": "清空武器",
    "Weapon placement": "武器摆放",
    "Hide axes": "隐藏坐标轴",
    "Rotation (degrees)": "旋转（度）",
    "Choose a character, then load weapons": "选择角色后读取武器",
    "Loading weapons": "正在读取武器",
    "Weapons ready": "武器已就绪",
    "No weapon in this model": "此模型未收录武器",
    "Weapon load failed": "武器读取失败",
    "Weapon added": "已添加武器",
    'Enemies': '敌人',
    'Choose enemy': '选择敌人',
    'Add selected enemy': '添加所选敌人',
    'Show enemies': '展开敌人清单',
    'Hide enemies': '收起敌人清单',
    'Search enemies': '搜索敌人',
    'Type a name or ID': '输入名称或 ID',
    'Enemy list': '敌人清单',
    "Enemy animation loop": "循环敌人动作",
    "Enemy animation speed": "敌人动作速度",
    "Play enemy animation": "播放敌人动作",
    "Enemy animation": "敌人动作",
    "Total plays": "播放次数",
    "Total plays: blank uses default, 0 repeats forever": "播放次数：留空按动作默认，0 为无限循环",
    "Play selected animation": "播放所选动作",
    "Enemy animation progress": "敌人动作进度",
    "Hide transform controls": "关闭坐标轴",
    "Pause enemy animation": "暂停敌人动作",
    "Resume enemy animation": "继续敌人动作",
    "Enemy animation paused": "敌人动作已暂停",
    "Enemy animation playing": "敌人动作播放中",
    'Selected enemy': '所选敌人',
    'No enemy selected': '未选择敌人',
    'Quantity': '数量',
    'Add enemy': '添加敌人',
    'Active enemies': '已添加的敌人',
    'No enemies added': '尚未添加敌人',
    'Remove': '移除',
    'Clear all': '全部移除',
    'Loading enemy list...': '正在加载敌人清单……',
    'Available enemies': '可用敌人',
    'Matching enemies': '匹配敌人',
    'No matching enemies': '没有匹配的敌人',
    'Adding enemy...': '正在添加敌人……',
    'Adding enemies...': '正在批量添加敌人……',
    'Enemy added': '已添加敌人',
    'Enemies added': '已添加敌人',
    'Enemy removed': '已移除敌人',
    'All enemies removed': '已全部移除',
    'Enemy list could not be loaded': '敌人清单加载失败',
    'Enemy data is invalid': '敌人数据无效',
    'Enemy was not found': '未找到该敌人',
    'Enemy model is not ready': '该敌人模型尚未就绪',
    'Enemy model could not be loaded': '敌人模型加载失败',
    'Enemy model could not be read': '敌人模型解析失败',
    'Unexpected enemy error': '敌人加载发生未知错误',
    'Combat effects': '战斗特效',
    'Show combat effects': '展开战斗特效',
    'Hide combat effects': '收起战斗特效',
    'Enable combat effects': '启用战斗特效',
    'Effect source': '特效来源',
    'All combat effects': '全部战斗特效',
    'Enemy combat effects': '敌人战斗特效',
    'Magical girl combat effects': '魔法少女战斗特效',
    'Search combat effects': '搜索战斗特效',
    'Type a stable key or direction key': '输入稳定键或方向键',
    'Combat effect list': '战斗特效清单',
    'Loading combat effects...': '正在加载战斗特效……',
    'Combat effects could not be loaded': '战斗特效加载失败',
    'Available combat effects': '可用战斗特效',
    'Matching combat effects': '匹配战斗特效',
    'No matching combat effects': '没有匹配的战斗特效',
    'Selected combat effect': '所选战斗特效',
    'No combat effect selected': '未选择战斗特效',
    'Playable': '可播放',
    'Direction key': '方向键',
    'Unavailable reason': '不可用原因',
    'Play selected effect': '播放所选特效',
    'Stop all effects': '停止全部特效',
    'Installed': '已接入',
    'Active effects': '活动特效',
    'Suppressed cues': '已抑制触发',
    'Combat effects enabled': '战斗特效已开启',
    'Combat effects disabled; active effects cleared': '战斗特效已关闭；活动特效已清空',
    'All combat effects stopped': '已停止全部战斗特效',
    'Loading selected combat effect...': '正在载入所选战斗特效……',
    'Combat effect started': '战斗特效已播放',
    'Combat effect cue suppressed': '战斗特效触发已抑制',
    'Combat effect could not be played': '战斗特效播放失败',
    'Voice / Subtitles': '语音/字幕',
    'UI language': '界面语言',
    'Home voice': '看板语音',
    'Show voice and subtitles': '展开语音与字幕',
    'Hide voice and subtitles': '收起语音与字幕',
    'Auto sequence': '自动顺序播放',
    'Subtitles': '字幕',
    'Subtitle language': '字幕语言',
    'Show subtitles': '显示字幕',
    'Follow original motion': '跟随原始动作',
    'Follow original expression': '跟随原始表情',
    'Subtitle source': '字幕来源',
    'Official subtitle language': '官方字幕语言',
    'Fallback': '回退',
    'Voice list': '语音清单',
    'Loading voice catalog...': '正在加载语音目录……',
    'Voice catalog ready': '语音目录已就绪',
    'Voice catalog could not be loaded': '语音目录加载失败',
    'Select a magical girl to view voices': '请选择魔法少女以查看语音',
    'Voices': '条语音',
    'Selected voice': '所选语音',
    'No voice selected': '未选择语音',
    'Voice playback controls': '语音播放控制',
    'Play sequence': '顺序播放',
    'Multitrack audio': '多音轨',
    'Character tracks': '角色音轨',
    'Background tracks': '背景音轨',
    'Background track': '背景音轨',
    'Upload audio': '上传音频',
    'Add background track': '添加背景音轨',
    'No loaded characters': '当前没有已加载角色',
    'No background tracks': '尚未添加背景音轨',
    'No audio loaded': '未选择音频',
    'Multitrack runtime is not connected': '多音轨运行时尚未接入',
    'Audio workspace operation failed': '音轨操作失败',
    'Clear track': '清空音轨',
    'Delete track': '删除音轨',
    'Volume': '音量',
    'Loop': '循环',
    'Background tracks do not drive lip sync': '背景音轨不驱动口型',
    'Previous': '上一条',
    'Next': '下一条',
    'Resume': '继续',
    'Voice timeline': '语音进度',
    'Order': '顺序',
    'Cue name': 'Cue 名称',
    'Playback': '播放状态',
    'Lip sync': '口型同步',
    'Mouth carrier': '口型载体',
    'idle': '待机',
    'empty': '空',
    'loading': '加载中',
    'ready': '已就绪',
    'playing': '播放中',
    'paused': '已暂停',
    'ended': '已结束',
    'error': '错误',
    'disposed': '已释放',
    'multiwave': '多波合成',
    'official-binary': '官方二态',
    'Loading selected voice...': '正在加载所选语音……',
    'Voice playback started': '语音已开始播放',
    'Voice operation was not started': '语音操作未启动',
    'Voice operation failed': '语音操作失败',
    'Loading voice sequence...': '正在加载语音队列……',
    'Voice sequence started': '语音队列已开始播放',
    'Loading previous voice...': '正在加载上一条语音……',
    'Previous voice started': '上一条语音已开始播放',
    'Loading next voice...': '正在加载下一条语音……',
    'Next voice started': '下一条语音已开始播放',
    'Voice playback paused': '语音已暂停',
    'Resuming voice...': '正在继续语音……',
    'Voice playback resumed': '语音已继续播放',
    'Voice playback stopped': '语音已停止',
    'Resources': '资源',
    'Show official resources': '展开官方资源目录',
    'Hide official resources': '收起官方资源目录',
    'Official resources': '官方资源目录',
    'Resource type': '资源类型',
    'Scenes': '场景',
    'Enemy models': '敌人模型',
    'VFX': '视觉特效',
    'VFX domain': '特效归属',
    'All VFX': '全部特效',
    'Enemy VFX': '敌人特效',
    'Character VFX': '角色特效',
    'Search official resources': '搜索官方资源',
    'Name, ID, or stable key': '名称、ID 或稳定键',
    'Official resource list': '官方资源清单',
    'Loading official resources...': '正在加载官方资源目录……',
    'Official resources could not be loaded': '官方资源目录加载失败',
    'Available official resources': '可用官方资源',
    'Matching official resources': '匹配的官方资源',
    'No matching official resources': '没有匹配的官方资源',
    'Selected resource': '所选资源',
    'No official resource selected': '未选择官方资源',
    'Use selected stage': '在查看器中使用场景',
    'Open in enemy panel': '在敌人面板中选择',
    'No direct viewer action': '无直接查看器操作',
    'Open release preview': '打开 Release 独立预览',
    'Resource selected in viewer': '已在查看器中选择资源',
    'Runtime ready': '运行时可用',
    'Unavailable': '不可用',
    'Stable key': '稳定键',
    'Display name': '显示名称',
    'English': '英文',
    'Japanese': '日文',
    'Traditional Chinese': '繁体中文',
    'Family': '资源族',
    'Model key': '模型键',
    'Record IDs': '记录 ID',
    'Domain': '归属',
    'Owner': '所有者',
    'Direction': '动作方向',
    'Status': '状态',
    'Reason': '原因',
    'Scene is not present in the viewer selector': '查看器场景选择框中没有该场景',
    'Enemy is not present in the enemy selector': '敌人选择框中没有该敌人',
    'This resource is not runtime-ready': '该资源的运行时尚未就绪',
    'Animation': '动作',
    'Choose animation': '选择动作',
    'Choose expression': '选择表情',
    'Default face': '默认',
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
    'Loading official character actions...': '正在载入官方角色动作……',
    'Loading official character action...': '正在载入官方角色动作……',
    'Official character actions could not be loaded': '官方角色动作载入失败',
    'No official character actions for this character': '当前角色没有官方探索动作',
    'No playable official character actions': '当前角色没有可播放的官方探索动作',
    'Playing official character action': '正在播放官方角色动作',
    'Paused official character action': '官方角色动作已暂停',
    'Official character action interrupted': '官方角色动作已中断',
    'Official character action unavailable': '官方角色动作当前不可用',
    'Choose 3D stage': '选择 3D 场景',
    'Collapse controls': '折叠控制栏',
    'Expand controls': '展开控制栏',
    'Rendering controls': '渲染设置',
    'Show rendering controls': '展开渲染设置',
    'Hide rendering controls': '收起渲染设置',
    'Shadow quality': '阴影画质',
    'Official quality': '官方画质',
    'Balanced': '均衡',
    'Performance first': '性能优先',
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
    'Transform mode': '变换模式',
    'Move XYZ': '移动 XYZ',
    'Rotate XYZ': '旋转 XYZ',
    'Click a body part, then drag the XYZ arrows': '点击身体部位后拖拽 XYZ 箭头',
    'Drag the XYZ arrows, or drag the body part in the camera plane; hold Alt for depth': '拖拽 XYZ 箭头，或直接拖动身体部位；按住 Alt 调整前后深度',
    'Click a body part, then drag it or use the rotation rings': '点击身体部位后直接拖拽，或使用旋转环精调',
    'Drag vertically for local X, horizontally for local Z; hold Alt for local Y': '纵向拖拽调局部 X，横向拖拽调局部 Z；按住 Alt 调局部 Y',
    'No weighted bone at this point': '此处没有可编辑的蒙皮骨骼',
    'Selected bone': '当前骨骼',
    'Model part': '模型部件',
    'Model part visibility': '模型部件显示',
    'Model part search': '模型部件搜索',
    'Search model parts': '搜索模型部件',
    'No model parts': '当前角色没有可切换的模型部件',
    'Selected model part': '当前模型部件',
    'No model part selected': '未选择模型部件',
    'Hide selected part': '隐藏选中部件',
    'Show selected part': '显示选中部件',
    'Show all parts': '显示全部部件',
    'Hidden': '隐藏',
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
    'Physics action options': '物理动作选项',
    'Loading physics action options...': '正在加载物理动作选项……',
    'Physics phases': '物理动作阶段',
    'Related official actions': '相关官方动作',
    'Special skill reserve': '必杀技预备阶段',
    'Special skill reserve and pre-special': '必杀技预备及前置阶段',
    'Awaiting official action phase consumer': '等待官方动作阶段接入',
    'Activate phase': '启用阶段',
    'Phase active': '阶段已启用',
    'Release phase': '释放阶段',
    'Activating...': '正在启用……',
    'Activating physics phase...': '正在启用物理阶段……',
    'Physics phase active': '物理阶段已启用',
    'Action-owned phase root': '官方动作阶段节点',
    'External phase root': '外部阶段节点',
    'Ready for active official action': '可接入当前官方动作',
    'Play an official action before activating this phase': '请先播放该角色的官方动作，再启用此阶段',
    'No physics action phases for this character': '该角色没有物理动作阶段',
    'No related official actions for this character': '该角色没有相关官方动作',
    'Physics action options unavailable': '物理动作选项不可用',
    'Select a character to view physics action options': '选择角色后查看物理动作选项',
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
    Idle: "待机",
    Stun: "眩晕",
    Break: "破防",

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
    E: "结束",
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
    [/(?:upperarm|(?:^|[_ .:/-])arm(?:$|[_ .:/-]))/i, '上臂'],
    [/(?:elbow)/i, '手肘'],
    [/(?:hand|wrist)/i, '手部'],
    [/(?:thigh|upperleg|upleg)/i, '大腿'],
    [/(?:calf|shin|lowerleg|(?:^|[_ .:/-])leg(?:$|[_ .:/-]))/i, '小腿'],
    [/(?:thumb)/i, '拇指'],
    [/(?:indexfinger)/i, '食指'],
    [/(?:middlefinger)/i, '中指'],
    [/(?:ringfinger)/i, '无名指'],
    [/(?:pinkyfinger|littlefinger)/i, '小指'],
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
    indexfinger: '食指', middlefinger: '中指', ringfinger: '无名指', pinkyfinger: '小指', littlefinger: '小指',
    thigh: '大腿', upperleg: '大腿', upleg: '大腿', leg: '腿部', lowerleg: '小腿', calf: '小腿', shin: '小腿',
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
    if (locale === 'ja-JP') return translateJaJpBoneChannelLabel(name)
    const side = /(?:^|[_ .:/-])(?:left|l)(?:$|[_ .:/-])/i.test(name) || /^L(?=[A-Z])/.test(name)
        ? '右'
        : /(?:^|[_ .:/-])(?:right|r)(?:$|[_ .:/-])/i.test(name) || /^R(?=[A-Z])/.test(name)
            ? '左'
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
    if (locale === 'ja-JP') return translateJaJpMorphChannelLabel(name)
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

    const match = canonical.match(/^(.+?)_(SE|S|L|E)(?:_(\d+))?$/)
    const base = match?.[1] ?? canonical
    const suffix = match?.[2]
    const variant=match?.[3] ? ' '+match[3] : ''
    const baseLabel = officialAnimationBaseLabels[base]
    if (baseLabel) return suffix ? `${baseLabel}${variant}（${officialAnimationSuffixLabels[suffix]}）` : baseLabel

    const technical = translateTechnicalTokens(base)
    if (!technical) return undefined
    return suffix ? `${technical}${variant}（${officialAnimationSuffixLabels[suffix]}）` : technical
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
    if (locale === 'ja-JP') return translateJaJpUiText(text)
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

    const selector = document.getElementById('language-toggle') as HTMLSelectElement | null
    selector?.addEventListener('change', () => {
        if (isUiLocale(selector.value)) setUiLocale(selector.value)
        else selector.value = currentLocale
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
    document.documentElement.dataset.uiLocale = locale
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
    const selector = document.getElementById('language-toggle') as HTMLSelectElement | null
    if (!selector) return
    selector.value = locale
    selector.title = translateUiText('UI language', locale)
    selector.setAttribute('aria-label', selector.title)
    selector.dataset.currentLocale = locale
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
        if (isUiLocale(saved)) return saved
    } catch {
        // Fall through to browser-language detection.
    }

    const languages = navigator.languages?.length
        ? navigator.languages
        : [navigator.language]
    if (languages.some(language => language.toLowerCase().startsWith('zh'))) return 'zh-CN'
    if (languages.some(language => language.toLowerCase().startsWith('ja'))) return 'ja-JP'
    return 'en'
}

function isUiLocale(value: string | null): value is UiLocale {
    return value === 'en' || value === 'zh-CN' || value === 'ja-JP'
}
