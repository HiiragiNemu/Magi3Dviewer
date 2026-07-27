# ReDriveToon Web 还原研究

更新日期：2026-07-27

## 本次集成结论

本次工作把旧基线上的 Rim/Fresnel 研究完整前向移植到上游最新提交 `01ab4cf` 的材质架构中，而不是用旧文件覆盖新 shader。

保留并兼容的新架构包括：

- `MaterialUserData` 与 `ShaderUniformsController`；
- 根据实际光照强度选择 Base/Shadow 贴图的双阶段光照计算；
- 新版 `ShadowTexOptions` 与运行时 uniform 刷新；
- 新版场景、阴影和 GUI 拆分；
- 一般材质与脸部材质的独立处理。

新增或修正的能力：

1. 一般材质和脸部材质共享可实时更新的 Rim/Fresnel uniform；
2. Rim 支持颜色、强度、阈值、羽化、屏幕方向和方向性；
3. Fresnel 支持启用、颜色、强度、阈值和羽化；
4. Rim/Fresnel 在最终物理光照之后以 emission-like 方式叠加，不干扰 toon shadow 的第一次测光；
5. ControlMap 按原 ReDriveToon 标注解释为 `R = ShadowOffset`、`G = Metallic`、`B = Specular`，其中 B 在 Three.js 中近似映射为 inverse roughness；
6. GUI 控件直接绑定全局 shader options，并通过新版 uniform controller 刷新所有已加载材质；
7. 新加载角色会自动使用当前 GUI/预设参数。

## 默认参数

| 参数 | 默认值 |
| --- | ---: |
| Rim enabled | `true` |
| Rim color | `#fff4dc` |
| Rim strength | `0.16` |
| Rim threshold | `0.58` |
| Rim feather | `0.18` |
| Rim direction | `(-0.45, 0.8)` |
| Rim directionality | `0.42` |
| Fresnel enabled | `false` |
| Fresnel color | `#ffffff` |
| Fresnel strength | `0.35` |
| Fresnel threshold | `0.5` |
| Fresnel feather | `0.25` |

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `magia-exedra-character-three/shaders/stylization.ts` | 公共参数、uniform controller、GLSL 注入和材质查询 |
| `magia-exedra-character-three/shaders/general.ts` | 在最新双阶段光照 shader 上接入风格层，并修正 ControlMap G/B |
| `magia-exedra-character-three/shaders/face.ts` | 让脸部材质共享 Rim/Fresnel 和运行时刷新 |
| `magia-exedra-character-three/shaders/index.ts` | 导出风格化模块 |
| `src/viewer/controllers/GUIShader.ts` | 新版 Shadow、Rim、Fresnel 调节面板 |

## 证据与边界

原 ReDriveToon 属性标注明确给出：

```text
R.ShadowOffset G.Metallic B.Specular
```

当前实现中：

- R 仍参与 Base/Shadow 预混，属于视觉近似，尚未实现逐像素 shadow threshold offset；
- G 直接驱动 `metalnessFactor`；
- B 近似驱动 `1 - roughnessFactor`；
- Rim/Fresnel 使用视空间法线与 `N·V`；
- 方向性 Rim 使用视空间 `normal.xy` 与二维方向向量；
- 运行时只更新 uniform，不重新加载模型或重新编译 shader。

仍未精确还原的模块包括 AngelRing、MatCap、Gem、各向异性、Cosmic、专用角色 self-shadow、depth rim/shadow、脸部世界方向和 stencil hair transparency。

## 校准建议

1. 固定背景、相机、环境光、主光方向和曝光；
2. 分别验证 ControlMap R/G/B 单通道；
3. 对同一角色截取正面、45°、侧面和背光基准图；
4. 先校准 shadow threshold/transition，再启用 outline、Rim 和 Fresnel；
5. 使用脸部、布料、金属、宝石、头发和 Cosmic 六类材质回归；
6. 最后接入 Timeline 数据验证 Additional Rim direction 与 Fresnel 动画。
