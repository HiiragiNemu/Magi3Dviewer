# Magi3Dviewer：Cloudflare 正式发布完成报告

更新于 2026-09-29T17:46:06.822Z（UTC）；本机日期为 2026-09-30。

## 交付结论

**已通过用户 Windows 本机现有 Wrangler 登录，覆盖原 Cloudflare 生产网站，并完成正式域名的版本、文件字节和实际浏览器验证。** 不再停留在候选包、测试通过或 artifact 上传阶段。此前本报告中“未部署、需要 GitHub Secrets”的状态已经被本节取代；此次没有启用或使用 GitHub Pages。

- 正式网站：https://magius3dviewer.pages.dev/
- Cloudflare 项目：magius3dviewer；生产分支：main（这是 Cloudflare 的分支设置，不是改写 GitHub main）。
- 新生产部署：f6ce0802-db8a-44b2-a6a3-684a42209252
- 固定部署地址：https://f6ce0802.magius3dviewer.pages.dev
- 实际已构建、已上线源码：`a0257233a83dc66657f7d70c3a0b747149fd0a16`。
- 上一部署：92ad3eca-4fbe-46ca-a1e4-b53add45d33c；上一源码：`e9223312a931dc6cdd260c2f215d39e5945b80da`。
- 构建时间：2026-09-29T17:33:36.805Z；线上字节验证时间：2026-09-29T17:42:33.402Z。

## 本地副本与同步结果

新的正式发布工作区：

`D:\magia\MyProducts\Magius3Dviewer-Cloudflare`

它从 GitHub 的 magius3dviewer 分支完整克隆，再在此基础上提交本轮诊断修正。没有把旧研究副本强行 reset 成远端，也没有覆盖未提交研究工作。

调查发现：原 Magi3Dviewer 停在 01ab4cfe，存在 5 项已跟踪变更，其中 3 个文件尚有合并冲突；Magius3Dviewer-JP 停在 78295f52，有 211 项已跟踪变更及其他未跟踪研究文件；关联的 scene-consumer-transfer 工作树为 4826e8aa，虽干净但仍旧于当前远端版本。其余 baseline/incomplete/StageP0 副本也未被选为正式发布源码。

原文件夹均保留。JP 的已跟踪工作区差异导出为 83,185,639 字节补丁；旧 main 的暂存差异及三个冲突文件另行保留。未跟踪研究文件仍留在原工作区，不宣称已把这些文件全部重新打包备份或合入正式版。

工作记录、差异备份及验收证据目录：

`D:\magia\MyProducts\.codex-delivery\Magius3Dviewer-Cloudflare-20260930`

## 本轮新增修正

提交 `a0257233a83dc66657f7d70c3a0b747149fd0a16` 只修改 scripts/site-smoke-cloudflare.mjs 与 siteStageDelivery.test.mjs，没有修改应用渲染/姿态算法或降低资源质量。

Windows Chrome 在模型已经完整被应用消费并正常绘制时，会出现 CDP requestfailed/ERR_ABORTED 记录。原测试仅依赖 requestfinished，因而把已加载的 FBX 误报为“不是本站提供”。修正后观察应用原有 fetch 的响应克隆，不另发请求，读取实际字节并计算 SHA-256；仅当 HTTP 200、长度与摘要一致、场景身份正确且已实际绘制时，才能解释这类取消记录。非取消网络错误、错误场景、不同字节、未绘制、纹理缺失仍判失败。

新增 8 项针对该逻辑的反例/正例测试；诊断文件共 29 项测试。最终完整构建入口共 **187 项测试通过，失败 0**，包含这些诊断测试，不能把 29 与 187 相加当作独立总数。TypeScript 检查及完整 Cloudflare 打包同样通过。

本次没有复用下载未完成的旧 artifact；发布产物是从本机最新已提交源码重新构建。构建器生成的未跟踪 gzip 中间产物没有提交到仓库。

## 正式域名：文件和资源验证

实际页面、资源目录及全部构建 JavaScript/CSS 共 **33 个文件**逐一与本机发布文件比较 SHA-256，全部一致。线上 site-version.json 精确返回上述源码提交，不是工作流提交或手工改写的版本标记。

完整网站共 4704 个文件、2,961,805,713 字节，保留 67 个当前场景目录及 1549 个场景文件。每个文件均通过 Cloudflare 单文件限制检查；发布目录没有 bundledStageBaseUrl，当前场景由 Cloudflare 同源提供，不依赖公开 GitHub raw 源码地址。

四组 Release 网关标签均实际执行 Range bytes=0-0 探针，均为 HTTP 206、正确总长度及 CORS *：

- runtime-products-v1-a：bytes 0-0/7927
- runtime-products-v1-b：bytes 0-0/2164
- runtime-products-enemy-models-v2：bytes 0-0/1309889
- runtime-products-voice-v1：bytes 0-0/1415795

最初 Node 校验直接联网时发现本机 workers.dev DNS 返回异常地址。两个独立 HTTPS DNS 查询一致给出另一组地址；沿用用户已经启用的 Windows 网络代理后，网关与四组探针正常。只为该验证进程启用已有代理，没有改系统 DNS、代理配置或远端域名。

## 正式域名：场景实测

测试运行在 https://magius3dviewer.pages.dev/，不是仅测本地或固定预览 URL。场景为 battle-616-00-01-001：

| 指标 | 实际结果 |
| --- | --- |
| 背景网格 | 12 → 294 |
| 当前视角实际绘制网格 | 105 |
| 已就绪材质贴图 | 25/25 |
| 场景加载错误 | null |
| 浏览器执行错误 | 0 |
| 直接 GitHub 源码仓库请求 | 0（测试主动阻断此类请求） |
| 像素比与抗锯齿 | 保持 1 / SMAA |

实际收到的 FBX 长度 1419834 字节，SHA-256：

`c90c3c7c9b506fcf2a5ecf319da304a6c9c2e77a4818c37c69ce44dd8dd43b5e`

应用实际消费的作者场景 JSON 也与本机资源一致（只排除加载器明确补入、原文件未声明的动画默认值），规范化摘要：

`3eaf421f0dcee9d13131f02d469e5b962d22ad8b0c9f9adc537e658768b9ae21`

## 正式域名：真实指针操作

本轮在正式网站重新执行整个姿态浏览器测试，不仅引用旧 CI 的通过记录。真实鼠标操作验证三轴手部 IK、三轴旋转、松手后连续 40 帧稳定、骨骼局部偏移和缩放不被改变；并执行撤销/重做按钮操作、关闭高亮、多角色选择、切换角色后再次 IK、430×932 手机视口控件尺寸及正式域名重新加载检查。

最终 pose-browser.json：passed=true，errors=[]，missing=[]。

三角色检查：未选中两名角色的高亮材质数均为 0，选中角色为 15；普通/选中状态渲染调用中位数为 14/14。没有额外全屏 OutlinePass，没有降低像素比或抗锯齿。

浏览器验收使用 Chrome ANGLE SwiftShader 软件渲染；其中时间数据不是用户显卡基准。上述结果证明本轮已知故障在这些回归路径内通过，不能扩大成所有角色、全部场景、所有硬件永远无缺陷。

## 私有化与后续发布边界

没有修改 GitHub 仓库可见性、默认分支、用户本机网络设置或 Cloudflare DNS。现有本机 OAuth 仅由发布客户端在本机使用，未输出凭证值或写入仓库。GitHub Actions 的 Cloudflare Secrets 未因本次本机发布而自动配置；以后从本机继续发布不依赖它们。

当前公开仓库下四组资源网关探针及源仓库直连阻断测试均通过。计划私有化时仍须确认服务端 GITHUB_RELEASE_TOKEN 对私有仓库有读取授权，并在真正私有化后再次执行网关/实际产品验证；本轮没有把模拟阻断当作已经完成真实私有化验收。

本报告提交属于文档更新，晚于实际应用构建；正式网站应继续标识真正构建的 `a0257233a83dc66657f7d70c3a0b747149fd0a16`，不应仅为报告提交而虚改线上版本。
