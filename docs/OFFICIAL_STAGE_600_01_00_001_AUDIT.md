# Official Stage 600-01-00-001 audit

> This is a deployment gate, not a visual-parity claim. Raw truth is closed; runtime deployment is deliberately blocked until official UV1 provenance is recovered.

## Identity

| Field | Value |
| --- | --- |
| Stage | `battle-600-01-00-001` |
| Release profile | `jp-android-3.13.0` |
| Unity | `2022.3.62f2` |
| Readiness | `evidence-complete-runtime-blocked` |
| Deployment safe | `false` |
| Visible review ready | `false` |

## Source closure

| Field | Value |
| --- | --- |
| Manifest target | `battle/stage/bg_3d_600_01_00_001` |
| Manifest key | `11310` |
| Manifest hash128 | `e6339b15722a9c63ba00a8bad43270f0` |
| Root bundle SHA-256 | `7b5ec33cf1a3ed9b5f1cf422b1965c23dfc4f9b992034bbda122c402e019ee25` |
| Closure | `13 files / 16309195 bytes` |
| Network used | `false` |
| Source bundles copied | `false` |

## UV1 and baked-lightmap gate

| Field | Value |
| --- | --- |
| Valid source meshes | `258` |
| Unique lightmapped meshes | `225` |
| Source meshes with UV1 | `0` |
| Renderer lightmap bindings | `319` |
| Mesh decode failures | `[]` |
| Official formula | `UV1 * unity_LightmapST.xy + unity_LightmapST.zw` |

The official LIGHTMAP_ON path requires TEXCOORD1/UV1. The serialized source meshes have no UV1, so deployment remains fail-closed until the official provider/carrier is found.

## Material and environment truth

- Materials: **14**, renderers: **353**, unresolved PPtrs: **0**.
- Ground: `Creative/Bg/BgUberShader` with `_SMOOTHNESS_TEXTURE_ALBEDO_CHANNEL_A, _VERTEX_COLOR_BLEND`.
- Lights: **6**; reflection cubemaps: **2**; supporting textures: **11**.
- Post-processing truth includes Tonemapping, Bloom, Vignette, ColorAdjustments, GlobalVolumeController, and ReDriveVolume typetrees.

## Dynamic truth

- Animators: **3**; controllers: **2**; clips: **2**.
- Particle systems: **1**; volumetric dust: **2**; volumetric beams: **2**.

## Confirmed facts

- The 13-file local JP closure is complete, hash-bound, and required no network or payload copy.
- All 14 material PPtrs resolve and the stage contains 353 renderers.
- The stage contains one baked lightmap and 319 renderer lightmap bindings.
- All 258 valid serialized meshes contain UV0 but no UV1; 225 unique lightmapped meshes are affected.
- The official compiled LIGHTMAP_ON vertex path reads TEXCOORD1 and applies unity_LightmapST.
- The raw stage contains six Lights, two Cubemaps, two AnimationClips, two AnimatorControllers, one ParticleSystem, two volumetric dust components, and two volumetric light beams.

## Inferences

- An official runtime or build/export step supplies the missing UV1/TEXCOORD1 data; its implementation has not yet been identified.
- A visually faithful browser result will require both the UV1 carrier and compiled BgUber operator parity, not a global brightness adjustment.

## Blocking gates

- **official-uv1-runtime-provider** (blocking): 225 unique lightmapped source meshes and 319 renderer bindings exist, but all 258 valid serialized meshes contain zero UV1 values. Required: Identify the official runtime or export carrier that supplies TEXCOORD1; do not substitute UV0.
- **deployable-geometry-carrier** (blocking): No browser-ready hierarchy carrier with proven official UV1 is registered for this stage. Required: A strict hierarchy/vertex mapping with official UV1 and zero ambiguous or mismatched nodes.
- **bg-uber-operator-parity** (blocking): PPtrs and material parameters are resolved, while the full compiled BgUber operator chain has not yet been translated into the Viewer. Required: Compiled-shader-backed bindings and an external-Chrome A/B capture.
- **dynamic-component-parity** (partial): Two clips, two controllers, one particle system, two dust components, and two volumetric beams are inventoried but not yet reproduced in the browser runtime. Required: Bound runtime playback with component/property parity and visual evidence.

## Next reproducible action

Locate the official UV1/TEXCOORD1 provider in `PrefabLightmapData` or the official runtime/export path. A product carrier may be generated only after strict hierarchy, vertex-count, and UV1 provenance checks pass with zero ambiguity.
