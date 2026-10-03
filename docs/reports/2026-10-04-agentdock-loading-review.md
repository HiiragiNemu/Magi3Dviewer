# AgentDock 写入审查与加载回归分离 — 2026-10-04

审查对象：D:/magia/MyProducts/Magius3Dviewer-Cloudflare；审查时 main = 9f25a156c936da00ab4979806fbee3fc430062d5。用户要求其他窗口的改动经核查后再合并，不以“更晚”或“独有”作为正确依据。

## 结论与合并决定

- 确认有 AgentDock 写入、提交及正式发布记录，不是只读建议。历史记录和 Git 提交相符；同一 Git 作者名不区分操作窗口，所以没有仅凭作者名字归因。
- 未提交场景工作共 10 个文件，保留原位、不提交、不部署。8 项单元测试本次通过，79 个缓存发布包的 PNG 文件摘要、大小、尺寸、Sprite 身份与审计清单一致。但是既有浏览器记录的 3 个样本有 1 个等待 120 秒超时，完整 79 项运行验收缺失。因此 HOLD，不判定可合并。
- 这些未提交内容未进入 9f25a15 的干净构建；该版本发布之前的线上角色卡顿不应归因于这些未上线文件。云层数据没有源代码消费者，不能把其存在称为云层已修复。
- 9f25a15 把实际文件名替换成通用中文类别，是当前 Codex 修复引入的额外改动，现撤回；不归因给 AgentDock。
- 加载卡片与双 requestAnimationFrame 等待在本仓库首次可追溯到 26d0bfa 的批量导入，且 db8e279 与 376af17 的加载实现相同。现有证据不足以证明该导入前的原始作者或把全部变慢归因给某个聊天窗口。

## 能够对上的历史记录

AgentDock 原始任务记录位置：C:/Users/proje/.agentdock/tasks/。

| 记录 | 核对结果 |
| --- | --- |
| tsk_68f8fcbb92c0e81b | 9月30日本地时区完成早期 Cloudflare 发布；记录新建当前工作副本及既有 OAuth 发布，版本 a0257233。是人工工具部署，不是 GitHub 自动发布成功。 |
| tsk_9b21252f8bf672a4 | 10月2日紧凑工具栏/资源面板发布；对应 5bb3935、db8e279、5d80ff6。记录包含可视加载卡；不能说 AgentDock 从未涉及加载界面。 |
| tsk_0aec062522c5a6da | 衣料实验与 f947d32 调查记录；明确失败候选未发布，不能把这些试验当作已验证修复合并。 |
| tsk_986080a0480542a9 | 10月3日场景任务；记录 latest main、79 Sprite 背景候选、未提交/未完成验证。与当前 dirty 文件吻合。 |

## 当前尚未合并内容

- public/stages/catalogs/official-gallery-diorama-original.v1.json：79 项从 product-presentation 改为原生二维图片，新增 nativeImage 元数据并可被选择。
- src/viewer/stages.ts + src/viewer/stageNativeImage.ts：新增 image 路径、屏幕空间绘制、载荷身份验证、资源释放和分类。
- scripts/test-website.mjs + stageNativeImage.test.mjs：加入 8 项场景测试。
- scripts/audit-native-gallery-backgrounds.py + docs/research/native-gallery-backgrounds.v1.json：原始 Sprite 与发布 PNG 对照脚本/结果。
- src/viewer/data/native-cloud/ 的 3 个文件：体纹理、蓝噪声和元数据；未找到运行时消费者。

运行证据：artifacts/scene-completeness-20261003/gallery-live/review.json 指向本地 6633，不是生产回执。gallery-diorama-diorama-background-bg-3d-610-00-00-001-original 样本超时，actual=none；另两个样本成功。该历史结果本次仅复核记录，没有冒充本次重新运行浏览器。79 个包的 SHA/PNG/Sprite 核对本次重新执行，未再次解码原始 Unity bundle 的像素。

## 本次加载修复范围

- 保留 9f25a15 的事件循环让步与哈希资源 immutable 缓存修复；冻结 rAF 的回归已重现并有测试，但不宣称这是所有网络慢的唯一原因。
- 恢复实际文件名，不用泛化标签。loadCharacter 在第一次请求前登记 file-map 原始名字；请求 URL、二进制内容、贴图采样、物理及镜头不变。
- 文件名元素不经过 UI 翻译器，避免把 VisualRoot 与哈希拆成翻译文本；显示 VisualRoot.fbx.gz、home-expressions.json 等原始名称。

## 发布门槛

GitHub 仅 main、0 个 open PR（本次实时读取）。环境 magius3dviewer-live 已有 CLOUDFLARE_ACCOUNT_ID，仍无 CLOUDFLARE_API_TOKEN。9f25a15 的自动运行 37138792390 配置关卡失败，构建验证仍在执行；不得写成自动发布成功。浏览器许可服务故障与该凭据缺失保持明确记录，不改认证服务或使用短期 OAuth 冒充持久 API token。

本次机器可复核证据：artifacts/cloud-publish-loading-20261004/agentdock-review.json、agentdock-scene-tests.log、filename-tests.log、filename-typecheck.log。所有未合并文件的摘要记录在 agentdock-review.json；发布前重新检查未被本次改动。
