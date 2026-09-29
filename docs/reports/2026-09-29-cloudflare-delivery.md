# Magi3Dviewer：Cloudflare 专用部署续接报告

## 目标与当前状态

目标是覆盖既有 https://magius3dviewer.pages.dev/，不是创建 GitHub Pages 网站。后续源码仓库计划重新私有化，因此正式包不能依赖公开的 GitHub raw 源码资源地址。本次续接未调用 AgentDock，也未修改仓库可见性、Cloudflare 生产站点或 DNS。

**最新 Cloudflare 候选包已通过功能回归、完整构建、资源限制和真实浏览器验证。生产覆盖尚未执行：工作流未取得 Cloudflare 发布凭证。不能将候选包通过验收写成已上线。**

本报告替代旧报告中要求启用 GitHub Pages 的操作方向。最终作业状态为：`build=success`、`configuration=failure`、`publish=skipped`。

## 本轮提交与验收身份

- 工作分支：`HiiragiNemu/Magi3Dviewer:magius3dviewer`。
- 浏览器诊断修订：`ae2bf8bbcf8ca537ea5e1383cd0b94590de5cf6c`。
- 新增诊断回归测试：`3eed85f56bbe49955b5f57aacb040464ede2b83b`。
- 本次实际构建源码：`08497f422683903818829aca49efd54ee8966a8b`。
- 验收/发布工作流：`.github/workflows/site-publish-verified.yml`。
- 本次 run：`36565613731`。
- build job：`109396660358`；发布授权 job：`109396660472`。

运行记录：
https://github.com/HiiragiNemu/Magi3Dviewer/actions/runs/36565613731

## 实际通过的检查

`npm run build:deploy` 在 GitHub 云端执行，179 项测试全部通过，失败、取消、跳过均为 0；TypeScript 检查与完整 Cloudflare 构建通过。此次新增 15 项诊断回归，专门验证测试程序不会把真正的资源缺失、内容改变、错误场景、未绘制场景或跨域失败误判为成功。

新的浏览器测试主动阻断对该源码仓库的直接 GitHub/raw/API 网络访问。测试目标为 `battle-616-00-01-001`，没有触发任何被阻断的源码仓库请求。

| 实际浏览器指标 | 结果 |
| --- | --- |
| 正确场景标识 | battle-616-00-01-001 |
| 背景网格 | 12 → 294 |
| 观察到实际提交绘制的网格 | 102 |
| 已就绪材质贴图 | 25 / 25 |
| 场景加载错误 | null |
| 浏览器执行错误 | 空数组 |
| 像素比 | 保持 1 |
| 抗锯齿 | 保持 SMAA |
| 直接源码仓库请求 | 0 |

应用已消费的场景 JSON 与打包目录里的当前作者数据进行了完整对象比较，只剔除加载器明确添加、且原始文件没有声明的动画默认字段，不丢弃作者字段。两侧规范化内容 SHA-256 一致：

`3eaf421f0dcee9d13131f02d469e5b962d22ad8b0c9f9adc537e658768b9ae21`

旧测试曾将 `net::ERR_ABORTED` 遥测直接等同于场景资源失败。现在保留原始记录，要求完整消费内容、正确场景及实际绘制证据，或同 URL 已完成传输，才能区分误报；其他错误仍然失败。本次记录中的场景取消项是反射探针的 HEAD 请求，实际贴图已经就绪。不能据此声称所有网络请求从未取消。

## 姿态编辑验证的边界

手部移动 IK 的 X/Y/Z、旋转 X/Y/Z、松手后连续 40 帧稳定、骨骼局部位置和缩放不变、多角色高亮隔离等实测，来自先前成功 run `36542133898`，应用源码基线为 `31a4b3ed0949f31e265919ba125d553d6225506b`。

本次工作流实际比较了该基线与新提交，确认应用、渲染器、资源和依赖没有改变，才复用这部分昂贵的真实指针验证。Cloudflare 候选包本身则是从新提交重新编译并重新进行场景浏览器验收的，不是旧包改版本号。

这些结果覆盖本次已知故障与相应回归，不能推导为所有角色、全部场景、所有设备永远没有缺陷。测试使用 Chrome 软件渲染环境，不是用户实际 GPU 的性能测量；生产网站尚未替换，所以线上验收仍待执行。

## 完整 Cloudflare 发布包

- 总文件数：4,704。
- 总大小：2,957,845,480 字节。
- 当前完整场景目录：67。
- 同站点提供的场景文件：1,549。
- 所有文件通过 Cloudflare 单文件大小检查。
- 正式目录没有设置 `bundledStageBaseUrl`，不使用 GitHub raw 场景回退地址。
- 其余 Release 产品仍使用已有服务端资源网关，未把凭证放入浏览器。

完整已验证网站 artifact：`verified-cloudflare-website`，ID `11031822207`，已成功上传；ZIP 大小 2,481,039,473 字节，摘要为 `sha256:a6141d6dcdf8ba118ffc98632d9184a09e4e91f220eb40b534436111a77223c4`。到期时间为 **2026-10-02 12:08:10 UTC**。

验证证据 artifact：`cloudflare-build-evidence`，ID `11031474249`。
ZIP SHA-256：`17b67b44cc5a57c448ec62c932cc40e809d04dbf4a3f451727ebf29ad1be4869`。

## 尚未完成的生产覆盖

本次发布授权作业实际返回：

```json
{"tokenPresent":false,"accountPresent":false,"configured":false}
```

错误为 `CLOUDFLARE_AUTHORIZATION_MISSING`。它发生在发出 Cloudflare 项目管理请求之前，不能描述成 Cloudflare 拒绝了一个有效 Token。源码写入权限正常；缺少的是另一服务的发布授权。

在仓库 **Settings → Secrets and variables → Actions → New repository secret** 中配置以下两项即可让既有工作流取得授权：

| Secret 名称 | 内容 |
| --- | --- |
| CLOUDFLARE_API_TOKEN | 对该项目所属 Cloudflare 账户具备 Account → Cloudflare Pages → Edit 权限的 API Token；账户范围限制为项目所属账户 |
| CLOUDFLARE_ACCOUNT_ID | 该项目所属 Cloudflare 账户 ID，不是 Zone ID |

配置页面：
https://github.com/HiiragiNemu/Magi3Dviewer/settings/secrets/actions

Token 只存入 GitHub Secrets，不要发送到聊天或提交到源码。

然后重跑 run `36565613731` 的失败作业。工作流会读取既有 `magius3dviewer` 项目的真实生产分支，以 Wrangler 覆盖原站，而不是新建网站。已成功的构建可在产物未过期时复用；产物过期则需要重新构建，不得移除身份校验冒充新包。

正式完成仍要求：Cloudflare 发布成功、线上 `site-version.json` 与测试提交一致、线上 HTML/catalog/JavaScript 字节校验通过，以及实际生产域名浏览器测试通过。

## 仓库私有化

当前候选包已证明测试路径无需公开源码仓库直连。此前 `2026-09-29T11:26:31Z` 的现网资源网关探针返回 `ready`，实际 Range 请求为 206 且 CORS 正常。

但是仓库仍公开时的成功读取不能单独证明 Token 私有化后的授权范围。重新私有化前仍须确认 Worker 内已有 `GITHUB_RELEASE_TOKEN` 能读取该私有仓库；私有化之后应再次验证网关与实际 Release 产品。此次没有擅自修改仓库可见性，也不把模拟阻断公开源码称为已经完成真正私有化的生产验收。

参考官方说明：
https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
https://developers.cloudflare.com/pages/get-started/git-integration/
https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/
