# Current-JP character material evidence

This checkpoint separates official current-JP facts from compatibility
fallbacks before the next Viewer shader integration.  It does not claim that
the current Web renderer already reproduces every listed effect.

## Source identity

The evidence manifest is
`research/official-character-material-evidence.json`.  It pins the two sampled
character bundles, `shader/redrive_toon`, and `matcap_soft_metallic` by byte
size and SHA-256.  The sampled Materials use the recorded ReDriveToon Shader
PPtr (`FileID 1`, `PathID 7704691985981102055`) through each bundle's own
dependency table.  Equal numeric FileID/PathID pairs are not treated as a
global asset identity.

Extraction used the explicit `jp-android-3.13.0` profile and Unity
`2022.3.62f2`.  JP and TW extraction defaults are intentionally separated by
`research/unity-release-profiles.json`.

## Hair and AngelRing

The sampled hair Materials save `_IsHair=1`, `_UseDepthTex=1`, outline
parameters, and the official AngelRing texture PPtr.  Character 100107 also
binds the 256 by 2 `RDToon_metallic_gradient_map`.  The compiled hair program
uses CameraDepthTexture, FOV/aspect, vertex-color G, face axes, and the official
AngelRing map.  A flat screen-space stripe is therefore not an official
substitute.

The official texture identity is pinned separately in the evidence manifest:
`RDToon_AngelRingMap.png`, SHA-256
`e33863f3d085b75a7b54218872bdb01b4492e84c0a4f492e4325632f44237776`.
The compiled hair program is likewise named and hashed, so later integration
can be checked against the exact variant rather than a screenshot-derived
approximation.

## Soul Gem and metallic response

The sampled `_SJ` Materials save `_IsGem=1`, `_UseMatCap=1`,
`_MatCapIntensity=2`, and character-specific Gem/Fresnel values.  Their MatCap
PPtr resolves to `matcap_SoftMetallic`.  The compiled program derives MatCap UV
from view-space normal XY and applies per-channel overlay under ControlMap G.
This is stronger evidence than a material-name-only highlight.

## Footwear-related Aniso/Fresnel

Character 101901's `mt_chara_101901_body_Socks` saves `_IsAniso=1`,
`_UseFresnel=1`, threshold `1`, feather `0.292`, and matching Aniso/Fresnel
colors.  It is the clearest raw evidence that a socks/footwear-related body
slot requires directional and grazing-angle response.  Renderer slots alone
do not identify every triangle, so the evidence does not overclaim that the
entire shoe mesh uses this Material.

Character 100107's `mt_chara_100101_body_Aniso` also proves an important
runtime rule: `_IsAniso=1` is saved while the `_IS_ANISO` keyword is absent.
Feature activation must read saved properties and cannot depend only on the
keyword or the `Aniso` name suffix.

## Outline

The serialized `ReDriveToonOutlinePass` state records `Cull Front`.  Its
compiled vertex program scales `_OutlineWidth * 0.01` by camera projection,
uses vertex color R for extrusion and B for
`_FaceOutlineAdjust`, and applies `_CharacterCancelPerspective`.  Its fragment
color combines outline color, BaseMap, ShadowColor, lighting, and emission.
This rules out a camera-independent constant-width outline as exact parity.

## Next official stage candidates

`research/next-official-stage-candidates.json` records the next bounded raw
Bundle closures without copying their large payloads into this repository.
The first recommendation is `600_00_01_003`: it shares the proven Stage 600
UV1/lightmap family, has eight Lights, five AnimationClips, one Cubemap, and no
ParticleSystem or ReflectionProbe.  The remaining entries preserve the source
audit order rather than being silently sorted by complexity.
`605_00_00_001` is priority 4 and its raw root contains 444 Lights and 545
MonoBehaviours, so its inventory is not a claim of deployment readiness.

These counts are class inventories, not a claim that their values or behavior
are already reproduced.  Per-stage PPtrs, UV1, lightmaps, ReDriveVolume,
materials, cubemaps and animation still require exact extraction.

## Evidence boundary

`official-export` profiles are supported by saved Material properties.  The
existing `name-convention` path remains a labelled compatibility fallback for
unextracted characters.  It must not be presented as official parameter
recovery.  The exported AngelRing and metallic-gradient PNG payload bytes,
dimensions, modes, sizes, and SHA-256 values are pinned in the evidence
manifest.  That does not by itself prove the game's runtime sampler state or
per-renderer MaterialPropertyBlock values.
