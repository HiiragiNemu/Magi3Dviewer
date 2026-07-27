# Magius3Dviewer official shader and 3D-stage research

Updated: 2026-07-27
Iteration: official shader pass 2 / stage framework pass 1

## Visual diagnosis

The previous web implementation remained visually close to the upstream viewer because it only added a restrained Rim/Fresnel term after the existing PBR result. The official presentation differs at a deeper level:

- authored color and shadow textures remain dominant instead of being multiplied by a full PBR pass;
- ControlMap `R` shifts the toon shadow threshold per pixel;
- ControlMap `G` drives a dedicated metallic-gradient response;
- ControlMap `B` drives specular response rather than metallicity;
- shadows are broad and soft, with a cool tint;
- key light and highlight tint are warm;
- outlines are softer and less black;
- hair uses an AngelRing band/map, which was previously unreachable because `createHairMaterial()` returned before its AngelRing code.

## Implemented iteration

- texture-preserving official-look layer with physical-light influence control;
- per-pixel Control-R shadow offset and softened color/shadow selection;
- dedicated Control-G metallic gradient and Control-B specular response;
- cool shadow/warm highlight grading;
- softer official-reference outline defaults;
- AngelRing enabled for all current hair materials with runtime controls;
- official-reference lighting/presentation action in the Shader GUI;
- per-character scale and animation-speed controls;
- line/arc/center multi-character arrangement actions;
- selectable procedural 3D stages and an external stage catalog/loader;
- GLTF/GLB and FBX/FBX.GZ stage loading support;
- stage, character transform, animation and shader state included in shareable presets;
- source-branch pushes request deployment through the protected `main` workflow, so verified builds update the online viewer automatically.

## Asset evidence and next extraction stage

The private `ma-ex-dataSP` data repository documents the original asset locations:

- `AssetBundles/shader` and `AssetBundles/shaders` for game shaders;
- `AssetBundles/battle/stage` for battle stages;
- `AssetBundles/dungeon/bg` for explorable dungeon stages;
- `AssetBundles/field/bg` and `gallery/bg3d_gallery` for additional 3D backgrounds.

The public Magius3Dviewer build intentionally does not publish raw private game bundles. Extracted, web-ready stage packages can be added to `public/stages/` and registered in `public/stages/catalog.json` after conversion and review.

## Calibration procedure

1. Select `Official-style blue sky pavilion`.
2. In `Shader`, click `Apply official reference look`.
3. Compare one character in front, 45-degree, profile and backlit views.
4. Tune shadow threshold/softness first, then Control-R offset strength.
5. Tune Control-G metallic and Control-B specular using metal/gem meshes.
6. Tune AngelRing center and width against the hair silhouette.
7. Save reference presets only after face, cloth, hair, metal and gem regressions pass.
