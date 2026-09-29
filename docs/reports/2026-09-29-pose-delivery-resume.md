# 2026-09-29 姿态编辑与网站发布续接报告

## 交付状态

**源码修订已进入 magius3dviewer 分支，构建、真实指针操作、背景场景及资源完整性验证通过；截至本报告，网站尚未发布成功。**

当前已确认的阻塞是 GitHub Pages 尚未启用。自动启用接口返回 `Resource not accessible by integration`。这不是源码提交失败：本轮直接提交、读取提交及运行 Actions 均成功。GitHub 账户的仓库管理员权限与 Actions 的 GITHUB_TOKEN 可调用的管理接口权限不是同一个概念。没有将测试通过或 artifact 上传成功写成网站已经上线。

Cloudflare 在本轮未发布：仓库工作流没有取得完整的 Cloudflare 部署配置。现有 Cloudflare 网站未被替换。

## 源码与构建身份

| 项目 | 值 |
| --- | --- |
| 仓库 | HiiragiNemu/Magi3Dviewer |
| 工作分支 | magius3dviewer |
| 已验证应用构建源码 | `31a4b3ed0949f31e265919ba125d553d6225506b` |
| 成功构建 run / build job | `36542133898` / `109319822522` |
| 背景场景与最终包验证 run | `36546212966` |
| 可重试的发布恢复 run | `36547984789` |
| 发布恢复工作流提交 | `7eb0e07489003bd34338a36fcb9a1ec6e3e3ca11` |

应用源码提交之后仅调整了发布工作流、背景场景测试和本报告。恢复工作流会比较构建源码、自己的提交及实时分支 HEAD；一旦应用或资源有变化，不允许把旧包冒充新包发布。本报告路径明确列入非应用文件列表，不会因新增报告而误拦恢复。

## 本轮解决的具体问题

### JSON 校验器误判

旧逻辑先 JSON.parse 再 JSON.stringify，然后与发布包文本比较。这会改写浮点数字面量、负零、大整数、转义形式和部分对象键的顺序，与打包器仅删除字符串外空白的行为不同。它会把未改变的场景数据误报成资源修改。

已改为对原始字节去除字符串外的空格、Tab、CR、LF，并比较其余全部 token。JSON.parse 仅用于检查语法，不再生成比较字节。真实数值、字符串内容、转义、键顺序或重复键变化仍被拒绝；图片等二进制文件继续精确比较长度和 SHA-256。并发校验失败时先排空正在执行的读取再保存证据，避免清理与读取竞态。

实现：`scripts/prepare-github-pages.mjs`；测试：`prepareGitHubPages.test.mjs`。修复提交：`31a4b3ed0949f31e265919ba125d553d6225506b`。

### 浏览器测试检查了错误场景

角色位于 `scene.scene`，背景场景位于 `scene.backgroundScene`。旧测试只统计前景网格，背景正确加载后这个数值不会增加，最终造成超时。

已改为检查真实 backgroundScene 的网格、已就绪材质贴图，以及完整完成的模型和贴图网络传输。同时修正已记录响应对象的 URL 字符串被当作函数调用的问题。只有同一 URL 已有完整成功替代传输时，才容许重复请求的 ERR_ABORTED；真实缺失、跨域失败和执行错误仍使测试失败。

实现：`scripts/site-smoke-stage-delivery.mjs`；新增 6 项测试：`siteStageDelivery.test.mjs`。对应提交为 `09753c1a1094488655d7854e31c3138b4e6a32ed`、`62b96871a773ee13985c76d252f52219f7037141`。

## 已实际通过的验证

构建 run 36542133898：102 项功能测试全部通过，无失败、跳过或取消；完整 TypeScript 检查与生产构建通过。

真实 Chrome 指针测试：移动 IK 的 X/Y/Z 轴、旋转的 X/Y/Z 轴均产生骨骼姿态变化；松手后连续 40 帧保持稳定，局部骨骼位置和缩放未改变。撤销/重做、多角色选择、关闭高亮、手机视口常用控制按钮和 /Magi3Dviewer/ 子目录加载检查通过。pose-browser.json 的 errors 和 missing 均为空。

多角色检查中，两名未选中角色的高亮材质数为 0，选中角色为 15。未启用额外全屏 OutlinePass，未降低抗锯齿或像素比。此证据来自软件渲染环境，不是用户 GPU 的帧率测量；不据此宣称所有设备性能问题已消失。

恢复 run 36546212966：21 项发布/场景诊断工具测试全部通过。这 21 项包含与前述测试重叠的项目，不应与 102 项相加声称 123 项独立测试。

真实背景场景选项为 `#stage-selector` 的 `battle-616-00-01-001`。实际证据如下：

| 指标 | 加载前 | 加载后 |
| --- | ---: | ---: |
| 背景网格 | 12 | 294 |
| 前景网格 | 201 | 201 |
| 已就绪贴图 / 材质贴图 | 0 / 0 | 25 / 25 |
| 渲染像素比 | 1 | 1 |
| 抗锯齿 | SMAA | SMAA |

`github-pages-stage-browser.json` 的 passed 为 true，errors 为空。日志保留了重复请求取消记录；场景中被取消的重复纹理请求均有同 URL 完整成功传输，不是未加载的贴图。对应截图：`github-pages-delegated-stage.png`。

## 资源与发布包

67 个当前场景目录的 1,549 个文件全部经实际网络读取验证：1,547 个文件大小及 SHA-256 完全相同，另 2 个 JSON 文件仅有既有的空白压缩差异。

完整构建包为 4,704 个文件、2,957,845,452 字节。只从一次性 dist 发布包移出已经验证的当前场景副本；仓库原始模型、贴图、场景目录没有被删除，未用低分辨率资源替代，也未退回历史 Release 场景包。

最终 GitHub Pages 发布包为 **3,155 个文件、892,122,538 字节**，包含统计文件自身。场景固定读取以下完整提交，不使用随时变化的分支地址：

`https://raw.githubusercontent.com/HiiragiNemu/Magi3Dviewer/31a4b3ed0949f31e265919ba125d553d6225506b/public/`

已验证的 GitHub Pages artifact 位于 run `36546212966`：名称 `github-pages`，ID `11022817122`，ZIP 摘要 `sha256:3487d57a074998cfe6dd759ba510cccf5f0f5b69d7cba0ef753625429a0bbcaa`。

该短期 artifact 当前到期时间为 **2026-09-30 09:03:10 UTC**。到期后必须使用正常完整构建链生成新包，不可删除身份检查来强行复用。源码与本报告不受 artifact 到期影响。

详细验证证据位于同一 run 的 `verified-publication-evidence` artifact，ID `11022677256`，保留至 2026-10-13。

## 剩余发布操作

自动启用实测 run `36547473709`（job `109337221414`）已经向 GitHub 创建 Pages 接口发出请求，返回：

```text
Get Pages site failed: Not Found
Create Pages site failed: Resource not accessible by integration
```

工作流已经持有 pages:write，但默认 GITHUB_TOKEN 不能为尚未启用的仓库创建 Pages 站点。已核对当前 GitHub 连接的全部操作，支持真实代码写入与 Actions 控制，但没有 Pages 设置写入入口；现有主分支 deploy.yml 也只使用默认工作流令牌，没有可复用的 Pages 管理令牌配置。

最少的账户侧操作是打开：

`https://github.com/HiiragiNemu/Magi3Dviewer/settings/pages`

在 **Build and deployment → Source** 选择 **GitHub Actions**。然后对 run `36547984789` 使用 **Re-run failed jobs**，或由后续会话调用 `rerun_failed_workflow_run_jobs`。不需要重新提交应用修复，也不需要重新跑已经通过的长时间姿态测试。

恢复工作流先确认站点可用，再恢复已验证的精简包，校验来源和内容身份，上传 Pages 并实际部署。最后还必须通过线上 site-version、场景目录地址、HTML 和入口 JavaScript 的字节校验，才能把状态改为已发布。

如后续出现新的平台错误，应继续处理真实返回信息。尚未执行的部署步骤不应被描述为已经验证成功。不要覆盖 main、不要新增 PR，也不要为重新满足历史门禁回退已验证的应用或资源。

参考官方权限说明：
- https://github.com/actions/configure-pages/blob/main/action.yml
- https://docs.github.com/en/rest/pages/pages#create-a-github-pages-site
