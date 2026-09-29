# 2026-09-30：旧场景发布目录与 GitHub／Cloudflare 核对

## 结论

用户提到的 9 月 27 日前后更新的那套场景内容已经进入 GitHub，并保留在当前 Cloudflare 正式发布包中。不能把旧构建目录或解压资源在本机显示为“未跟踪”，解释成整套场景源码尚未推送。

本轮没有倒灌旧研究修改，没有覆盖或删除旧工作区，也没有重复部署同一个已经通过验收的应用版本。正式站本轮实时回读仍为 `a0257233a83dc66657f7d70c3a0b747149fd0a16`，与本机 dist-deploy/site-version.json 完全对应。

## 1. 旧场景发布源码确实已经进入当前远端

核对目录：

`D:\magia\.codex-work\magius3dviewer-s6-stage-release-20260921`

本机 HEAD 为 `e9223312a931dc6cdd260c2f215d39e5945b80da`，提交时间为 2026-09-28 05:56:31 +08:00。对用户所称“9 月 27 日”采用实际路径和提交核验，而不是仅凭文件夹日期推断；该时间对应 UTC 的 9 月 27 日。

GitHub 本轮比对时 magius3dviewer 分支 HEAD 为 `54c30a5b9c9ff7f8a54f84ecc7da25bea15dd0f1`。GitHub compare API 的结果为：当前分支相对旧 HEAD ahead 53、behind 0，merge-base 就是旧 HEAD。这证明旧提交及其历史已经在当前分支内，不是仅存在本机的未推送提交。

旧工作区没有已跟踪文件的未提交修改。旧 HEAD 和当前远端 HEAD 的 `public/stages` 目录树对象均为：

`bc414c28c386fc52ec530150a83e88cdc2731c71`

目录树一致意味着其已跟踪路径、文件内容对象及子目录结构一致。远端比较的改动文件清单也没有 public/stages 变更。最后一条已提交的场景资源基线更新是 `f1724d9`，时间为 2026-09-25 03:05:52 +08:00，标题为 `fix(viewer): unify verified R24 scene baseline for online acceptance`。后续 9 月 27／28 日的发布并不意味着所有场景源文件当日重新发生了修改。

## 2. 旧发布产物与当前正式包没有场景内容丢失

另一个实际找到的目录是无 .git 元数据的本机整合／构建副本：

`D:\magia\.codex-work\magius3dviewer-s6-unified-build-20260906-v11`

其中最后一份相关旧产物为：

`dist-deploy-s6-20260928-posexyz\stages\official`

它的本机修改时间为 2026-09-28 05:55:03 +08:00，对应 UTC 2026-09-27 21:55:03。它是构建产物目录，不是另一条尚待推送的 Git 分支。

将这份旧产物与当前正式工作区 `D:\magia\MyProducts\Magius3Dviewer-Cloudflare\dist-deploy\stages\official` 做全量路径与 SHA-256 比较：

| 项目 | 结果 |
| --- | ---: |
| 旧包场景文件数 | 1,549 |
| 当前包场景文件数 | 1,549 |
| 字节与 SHA-256 完全一致 | 1,533 |
| 原始字节不同的 JSON | 16 |
| 仅将 CRLF 统一为 LF 后完全一致的 JSON | 16 |
| 缺失、额外或存在其他内容差异的场景文件 | 0 |

这里没有采用 JSON.parse/stringify 重新序列化来掩盖数值、转义或键顺序差异；16 个 JSON 是直接读取原始文本，仅替换 CRLF 为 LF 后比较。因此这些差异不构成遗漏的场景数据更新。

## 3. 旧源码目录里实际剩下的未跟踪项

旧场景发布源码的 Git 状态只包含以下三项，而不是未提交的场景源代码修改：

### dist-source-validation-20260922/

旧构建验证产物，目录修改时间为 9 月 22 日。它不是新的正式源码，不需要为完成此次发布而重新合入。

### public/stages/official/battle-612-00-00-002/bg_3d_612_00_00_002.fbxdata

这份本机文件确实没有作为当前 Git 源码树中的同路径文件提交。但资源已经发布到 GitHub Release：

- 标签：`runtime-products-v1-a`。
- 资产：`0581-stage-battle-612-00-00-002.zip`。
- GitHub 实时资产元数据大小：36,863,617 字节。
- 该资产创建于 2026-08-25T23:01:44Z，更新于 2026-08-25T23:02:56Z。
- 当前运行时资源目录仍将该场景映射至上述 Release 产品，经既有服务端网关提供。

本轮通过网关完整下载该 ZIP，核对其中的模型条目与本机未跟踪文件：两边均为 3,463,081 字节，SHA-256 均为：

`8d9bc1a6f288d1680bbc036583dc28221d06f8e62dc896da10580b03ee7dfeca`

ZIP 内共 26 个条目。该模型是已经发布资源的本机副本，不能把“本机未跟踪”当成“资源从未推送”。下载的核对副本仅保存在 .codex-delivery 下，没有覆盖项目资源。

### public/stages/official/stage-environment-payloads.generated.json

这是本机生成的环境纹理校验报告，756,217 字节，修改时间为 2026-09-22。文件声明生成器为 `scripts/repair-official-stage-environment-payloads.py`，内容为检查记录，而非场景模型或纹理载荷。

该报告本身没有提交到当前远端源码树。当前已跟踪的 src/public/tests 中没有对这个文件名的消费引用；只在生成脚本中找到输出路径。它不是此次正式运行所缺少的资源。按照用户要求，不再为这种旧报告投入恢复、合并或发布成本。

## 4. 当前正式发布状态

正式工作目录：

`D:\magia\MyProducts\Magius3Dviewer-Cloudflare`

正式网站：https://magius3dviewer.pages.dev/

- 已上线应用源码：`a0257233a83dc66657f7d70c3a0b747149fd0a16`。
- Cloudflare 正式部署：`f6ce0802-db8a-44b2-a6a3-684a42209252`。
- 发布使用本机已有 Wrangler 登录，目标是原有 Cloudflare 项目；没有启用 GitHub Pages。
- 187 项构建回归及完整 TypeScript／打包检查通过。
- 33 个线上 HTML、目录、JavaScript／CSS 文件与本机产物摘要一致。
- 正式网站实际三轴 IK／旋转、松手 40 帧稳定、多角色高亮等指针检查最终 passed=true、errors=[]、missing=[]。
- 当前场景同源提供；正式包没有依赖公开 GitHub raw 场景地址。四组 Release 网关探针已通过。

本轮读取了已落盘的完整线上指针验收结果，并再次实际回读正式站版本，没有把此前网络中断当成任务从未执行。详细生产验收见 `2026-09-29-cloudflare-delivery.md`。

本报告只是文档更新，不应为了文档提交而重建或虚改线上应用版本。当前验证覆盖已知故障与指定测试路径，不宣称所有角色、全部场景、所有硬件永远无缺陷。计划私有化时仍需核验服务端 Release Token 的私有仓库读取权限；本轮没有改变仓库可见性。
