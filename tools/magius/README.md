# Magius scene asset tools

These viewer-owned tools consume an existing Exedra resource checkout. They do
not belong to the resource producer repository and do not upload game assets.

## Export local stages

`export_magius_stages.py` reads an external `gamedata/AssetBundles` tree,
exports known 3D-stage roots with AssetStudioModCLI, optionally converts FBX to
GLB, and writes a viewer stage catalog.

```powershell
python .\tools\magius\export_magius_stages.py `
  --gamedata 'D:\magia\MyProducts\ma-ex-dataSP\gamedata' `
  --assetstudio 'D:\Tools\AssetStudioModCLI\AssetStudioModCLI.exe' `
  --out '.local\magius-stage-export' `
  --clean
```

The JP default is Unity `2022.3.62f2`. For the current TW client, add
`--unity-version 2022.3.62f3`. `FBX2glTF` is optional; pass `--fbx2gltf` when a
self-contained GLB is preferred. Without it, the tool emits `stage.fbx.gz`
with adjacent textures.

## Generate the automatic scene/light profile

The general entry point is `sync_magius_scene_profiles.py`. Each catalog entry
already records its exact `assetBundleName`; the tool resolves that name through
the game's `AssetBundleManifest`, follows only its dependency closure, and then
generates the profile beside the existing model. No per-scene light count or
runtime uniform transcription is needed.

```powershell
python .\tools\magius\sync_magius_scene_profiles.py `
  --catalog '.\public\stages\catalog.json' `
  --manifest-dump 'D:\path\AssetBundleManifest_#1.txt' `
  --asset-root 'D:\path\gamedata\AssetBundles' `
  --manifest-root '.\artifacts\scene-profile-closures' `
  --include '^battle-600-' `
  --write `
  --report '.\artifacts\scene-profile-sync-report.json'
```

Omit `--include` to process every catalog stage with an `assetBundleName`.
Omit `--write` for an extraction/coverage check. The payload store is referenced
in place and remains unchanged. `resolve_magius_scene_closure.py` exposes the
same manifest-resolution step independently.

`extract_magius_scene_profile.py` reads one exact closure manifest rather than
scanning an installation. It follows Unity's serialized ownership graph and
emits one runtime package containing:

- `Light` + `Transform` + `UniversalAdditionalLightData`;
- `Volume` -> `VolumeProfile` -> Bloom/Tonemapping/ColorAdjustments/Vignette/
  ReDriveVolume override values;
- `Material` texture PPtrs, sampler state, render state and shader identity;
- `PrefabLightmapData` renderer bindings, every ordered color lightmap and the
  AssetStudio-FBX `CBA` triangle-corner UV1 companion;
- `ReflectionProbe` source records.

```powershell
python .\tools\magius\extract_magius_scene_profile.py `
  '.\artifacts\jp-scene-export\SCENE-closure-manifest-v1.json' `
  --stage-id 'battle-SCENE' `
  --asset-prefix './stages/official/battle-SCENE' `
  --product-dir '.\public\stages\official\battle-SCENE' `
  --model-url './stages/official/battle-SCENE/stage.fbxdata' `
  --export-assets `
  --output '.\public\stages\official\battle-SCENE\scene-profile.json'
```

The Viewer loads the generated `renderProfile` atomically through a catalog
entry's `sceneProfileUrl`. Existing hand-authored carrier bindings remain in
place; a newly exported stage automatically uses generated material bindings
when it has no enriched catalog bindings. `--write` in the catalog synchronizer
enables the same asset export, while check mode only reports coverage. Multiple
lightmaps remain ordered by Unity's serialized local indices, including the
base-index adjustment when a scene contains more than one `PrefabLightmapData`.

For fresh exports the same step can be attached to the stage exporter:

```powershell
python .\tools\magius\export_magius_stages.py ... `
  --scene-profile-manifest 'battle-SCENE=D:\path\SCENE-closure-manifest-v1.json'
```

## Extract ReflectionProbe Cubemaps

`extract_magius_reflection_probe_cubemaps.py` resolves cross-file
`ReflectionProbe` PPtrs inside an exact staged AssetBundle closure. It exports
decoded faces when UnityPy supports them and retains raw serialized Cubemap
bytes plus metadata when decoding is unavailable.

```powershell
python .\tools\magius\extract_magius_reflection_probe_cubemaps.py `
  'D:\path\to\exact-scene-closure' `
  --output '.local\reflection-probes\scene'
```

Install `UnityPy` in the Viewer tool environment before running the Cubemap
extractor. Both output roots should remain local unless an explicit Viewer
artifact workflow publishes derived evidence.

## Extract compiled shader variants

`extract_magius_shader_variants.py` indexes the exact Unity 2022 shader objects
referenced by a bounded closure manifest and can extract selected compiled GLSL
subprograms. The reader supports both AssetBundle chunk-table segments and the
single-segment table-plus-payload layout used by player `resources.assets`.
This covers hidden runtime shaders (for example plugin-generated scene effects)
without manually transcribing their uniforms per scene: add the player's exact
`resources.assets` as a manifest source, then select the parsed shader name.
Text GLES variants are emitted as `.glsl`; wrapped D3D variants are preserved as
native `.dxbc` containers rather than lossy text.

```powershell
python .\tools\magius\extract_magius_shader_variants.py `
  --closure-manifest '.\artifacts\global-player-resources.manifest.json' `
  --shader-name 'Hidden/SHADER_NAME' `
  --output '.\artifacts\shader-variant-index.json' `
  --extract-dir '.\artifacts\compiled-shader-variants'
```

## Extract per-character ReDrive render profiles

`extract_magius_character_render_profiles.py` reads only top-level
`chara_*_battle_unit` bundles from the supplied official character directory.
For each bundle it selects the `ReDriveToonMaterialController` with
`IsCharacter=1` and exports the character-specific `headOffset`, face axes,
`CharacterCancelPerspective`, `AdditionalLightInfluenceByLuminance`, Head/Pelvis
PPtrs, renderer PPtrs and AngelRing material/PPtr state. Weapon and
attachment controllers (`IsCharacter=0`) are recorded neither as the character
offset nor as a fallback.

```powershell
python .\tools\magius\extract_magius_character_render_profiles.py `
  'D:\path\to\AssetBundles\battle\character' `
  --output '.\artifacts\character-render-profiles.json' `
  --runtime-output '.\magia-exedra-character-three\official-character-controller-profiles.generated.json' `
  --strict
```

Use `--include '^chara_101901_'` for a single bounded bundle check. The JP
default is Unity `2022.3.62f2`; pass `--unity-version` for another client build.
Unknown or unreadable bundles remain explicit entries in `errors` and do not
receive estimated offsets.

## Bounded regression

```powershell
python .\tools\magius\test_scene_asset_tools.py
```
