# 中断接续、单向衣料与场景后段审计（2026-10-02）

## 执行权限及接续事实

工作区 `D:\magia\MyProducts\Magius3Dviewer-Cloudflare`；仅既有 `magius3dviewer` 分支与原 Cloudflare 正式站。AgentDock 0.9.1 的 exec_command 实际返回 sandbox.enabled=false / mode=none；本轮完成文件写入、回读、Git 推送和 Wrangler 发布。不存在“只能本地读取”的权限阻塞。

接续时 HEAD 为 `7c5d5d1e5bb7f2e746fd012c12757a5ac3620a71`，比远端/线上 `008e04d6e28b1fa418aedba18bbf69fbc36d74b7` 提前两个提交：`f8e0a8d` 单向衣料接触、`7c5d5d1` 双指禁滚转及单旋转/回正控件。它们当时并未上线。本轮先复验、推送并发布此热修复，生产部署 `f7354622`，正式域名 site-version.json 已确认对应修订与 one-way-damped-garment-contacts-v2 标记。

未跟踪原始资源、其他会话项目、姿态存档及演出项目没有删除或覆盖。接续时 scripts/test-website.mjs 的既有测试顺序调整保留，没有通过删除/跳过测试取得通过。

## 衣料及双指：已经正式部署与复验

衣料接触层不再写入上臂、手、躯干、腿及根变换。衣料骨骼只作有界、被动阻尼恢复，局部衣料顶点在最终骨骼姿态之后处理当帧接触；新碰撞不等待恢复阻尼。没有新弹簧速度、随机风力或积累能量。见 `2026-10-02-one-way-garment-contacts.md`。

真实连续测试对音梦 102001、灯花 101901 分别运行走、跑、跳、反向走、停步；身体与全部非衣料顶点的额外改变量均为 0。停步后衣料逐帧变化衰减。强制位移上限仍存在；Nemu 的极端接触样本留下约 0.026 模型单位的代理碰撞残余，不能把这叫“任何姿态都完全不穿模”。不得为消除此残余重新推开手臂或放开衣料无限位移。

普通 Orbit 和 TPS 双指只负责缩放、平移。PC/手机共用单一画面旋转控件：拖动旋转，点按回正；键盘方向键/Home 可用。TPS Esc 释放鼠标但保留模式、双击重新锁定、Ctrl 平移保持。

生产浏览器验证：6 组镜头、19 组衣料/重力预览/关闭恢复、11 组演出录制、7 组跟进操作通过。包含 A 的真实键盘跑动录制，B 叠录不破坏 A，独立表情、真实镜头拖动录制、重复 seek、项目导出/导入、新页演员重绑定、动作编辑共存、360/430/932 宽度、移动摇杆录制、场景第二次选择、彩色连线与默认控件避让。模拟触控和桌面浏览器不是用户实体手机的性能认证。

物理即时回退：渲染设置中关闭“稳定防穿模（可单独关闭）”；构建硬关闭为 `$env:MAGIUS_GARMENT_CONTACTS='off'; npm run build:deploy`。不需要回退演出 UI/录制/镜头。构建硬关闭优先于浏览器偏好。

## 场景后半段：可加载不等于视觉还原

实际 UI 清单 599 项，其中 408 可启用（含 5 内置）、191 未启用。本轮在正式网站抽查 16 项，覆盖 enabledIndex 8/36 的前段对照及 204–407 的后段；16 项均加载成功、无 HTTP 错误及页面异常，但画面仍有明显缺陷。因此不能再用“下载成功/几何不为空”证明材质完整。

证据索引：`assets/20261002-scene-surfaces/audit.json`。抽查器：`scripts/audit-late-scene-browser.mjs`；原始图、完整运行时 sceneProfilePackage 与源材质记录保留在 `artifacts/resume-20261002/scenes-baseline/`。本地可直接读取的 67 份已启用场景 profile 中，35 份包含本轮调查的三类 shader；这是材质引用统计，不等同 35 场景均已逐一修好，也不是 408 场景的完整分母。

### 已实现、候选浏览器验证通过的共享修复

**ShadowOnly 被错当作普通不透明白地板。** `dungeon-65000-bg-3d-652-01-11-001-002` 的 groundShadowOnly 原始材质来自精确原始 bundle；Shader PathID 为 -3296666697305076964，原生 GLES Universal Forward 和 blend/depth/cull 状态已提取。原生输出 RGB 为 _ShadowColor.rgb，alpha 为 `(1 - mainLightShadowAttenuation) * pow(1 - saturate(NdotV), _frenelPower)`；颜色值的 alpha=0 并不表示禁用阴影。原生通道是透明叠加、ZWrite Off，而旧绑定用 lit/opaque 白色载体遮住了真正地面。

新增 `stageShadowOnlyMaterial.ts` 按精确 shader 家族分派，复用既有主光级联阴影及距离淡出，不叠乘全部级联或点光阴影，不改全局曝光。保留几何、原始颜色及视角遮罩、克隆材质时保留策略。该 shader 无 ShadowCaster 通道，不再凭空投射不透明平面阴影。修复后该场景原有蓝色地面、纹理和映射内容重新可见，而不是人为换一张地面图。前后图：`assets/20261002-scene-surfaces/367-before-after.webp`。

**静态 EffectCommon 网格没有经过特效算子。** 新增静态网格适配：复用已有粒子 Common 材质的颜色、alpha、mask/wave/dissolve、软深度算子，保留原始网格、UV、顶点颜色及共享场景时间，不生成新粒子或把网格当公告板。Common 原生通道固定 ZWrite Off；不再继承错误的 normalized opaque 默认值。精确 shader 家族之外的 BgUber/普通模型不走此路径。

软深度注册现在可指向具体材质，混合网格的特效槽在独立深度预绘中被排除，但同一网格的不透明槽保留。异常和释放后恢复原可见状态，不隐藏整个场景。

候选真实浏览器复测 7 场景：367、397 Intro、398 Memory、8 前段对照、63 battle-610、270 dungeon-610、297 dungeon-612，均加载成功且无页面/着色器/HTTP 异常。此结论仅表示新分派兼容这些场景，不表示其中尚未实现的 CloudSurface 等也已还原。

### 明确保留的视觉缺口

- `dungeon-61000-bg-3d-610-00-11-001-003` 等 CloudSurface 场景：原生材质引用 64×64×64、7 mip、1,198,372 字节的 Texture3D “3DNoise”（PathID -1645627217008615320）。旧提取链只接 Texture2D，漏掉三维纹理；网页也没有完整云层顶点位移、法线、Fresnel/深度遮罩算子。已取得原始体纹理及编译 shader 研究证据，但本轮不把未验证的体素解码/近似噪声或只调亮度当成修复交付。该项仍未完成。
- `dungeon-61200-bg-3d-612-00-14-001-002` 大面积烟雾遮挡仍需对照原生粒子空间、发射器及深度行为。它属于 ParticleSystem，不是此次静态网格分派已解决的对象，不能混报已修复。
- 其余未抽查场景、SimpleOcean/其他特殊 shader、部分缺少完整 nativeVisibility 的历史 profile 仍需独立还原。没有因此批量禁用这些场景，也没有把“可启用”改写成“已完整还原”。

## 回归与发布

候选网站回归 542/542，通过且无跳过；TypeScript 通过。相较接续基线 507 项增加特殊表面、主光级联、粒子混合与体积光的覆盖。附带修正旧级联测试仅匹配 LF 的文本正则，兼容 Windows CRLF；四个固定半像素采样断言完整保留，没有修改主光阴影实现或弱化测试。

场景候选正式部署及版本将在本报告下一次提交补齐。连续碰撞原始指标、生产录制及镜头日志位于 `artifacts/resume-20261002/`。
