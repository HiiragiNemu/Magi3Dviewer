# JP 3.11 official reconstruction checkpoint

Updated: 2026-07-29

## Safety boundary

- Do not use or restore the Codex in-app Browser/WebView.
- Local visual validation must use the user's external Chrome.
- Do not modify Windows Code Integrity policy or replace packaged GPU DLLs.

## Evidence and source state

- Read-only JP asset source: `D:\magia\ma-ex-data`
- Private research workspace: `D:\magia\MyProducts\MagiaExedraJPResearch`
- Viewer integration workspace: `D:\magia\MyProducts\Magius3Dviewer-JP`
- JP compiled ReDriveToon evidence is committed on
  `research/jp-local-assets-20260729` through `5ef6c2b`.
- The 32+ GiB JP corpus is reused in place; it is not copied into a nested
  `sp` directory and is not downloaded again.

## Integrated in the current Viewer worktree

- Material-slot AngelRing profiles from JP 3.11 serialized materials.
- Recovered projected and `_YuugenHighlight` AngelRing branches.
- Character-specific Head axes and `headOffset` profiles.
- Official Face Gradient/Nose Shadow profiles are generated for 92 characters;
  the recovered JP 3.11 face and nose formulas are integrated.
- FBX material groups use distinct material instances only when the exported
  BufferGeometry contains real draw groups. Ungrouped FBX meshes deliberately
  retain one aggregate material because Three.js does not render an ungrouped
  geometry with a material array.
- Official background geometry and background-only lights render in a separate
  scene/pass, matching Unity culling intent without illuminating characters.
- Battle stage `600_00_01_001` includes its exported FBX, adjacent textures,
  nine serialized lights, fog, SH ambient data, post processing, and
  ReDriveVolume values.
- A batch stage-pack exporter is being prepared in the private JP research
  workspace; generated game assets remain outside normal Git history.

## Required before deployment

1. Production TypeScript/Vite build. **Passed 2026-07-29.**
2. External-Chrome GPU shader compilation check.
3. Ashley animation-family regression check.
4. AngelRing checks for projected, UV-authored, and disabled material profiles.
5. Face-gradient and nose-shadow direction check.
6. Real stage texture/light/foothold check.
7. Commit the research branch, then update `magius3dviewer` only after the
   local checks pass.

## Local visual validation

- Static preview: `http://127.0.0.1:4173/`
- Server: Python static server bound to loopback only, listener PID `66388`.
- External Chrome is connected for the remaining GPU/visual checks.
- The Codex in-app Browser/WebView is not used.

## 2026-07-29 download-manager incident

- IDM intercepted the original `.gz` character URL and later also intercepted
  the attempted `.bin` replacement. CDP showed the `.bin` request returning
  `204 No Content` with only 122 encoded bytes even though the loopback server
  returned the full 2,501,725-byte gzip payload to a direct HTTP client.
- Compressed character/animation build assets now use the project-specific
  `.fbxdata` suffix. Official stage archives use the same suffix. Gzip content
  and hashes are unchanged; the loader identifies compression from magic bytes.
- Bounded external-Chrome proof:
  `VisualRoot.fbx-Dsv0y9Ia.fbxdata` returned HTTP `200`,
  `Content-Length: 2501725`, and 2,501,930 encoded transfer bytes. The character
  parsed and loaded, WebGL 2 was available, and there were no page exceptions.
- The remaining IDM download dialog was sent a targeted close message. Only
  the normal IDM main window remains.
- Production build passed and contains 96 `.fbxdata` assets with no emitted
  `.gz` or `.bin` payloads.

## Rendering regression finding

- The purple-black character is not a failed FBX load or GPU shader compile.
- Its direct cause was `bindOfficialMaterialGroups()` assigning 2-3 material
  array entries to Body, Face, Hair, and Weapon BufferGeometries whose
  `geometry.groups` arrays are empty. Three.js submitted no main-material draw
  calls for those meshes. The single-material Acc mesh still rendered its pink
  bows, while the later outline shells supplied the flat `#5a5268` silhouette.
- Runtime evidence showed all affected main materials remained uncompiled;
  hiding outline meshes after load left only the two pink bows visible.
- The loader now uses a single aggregate material for ungrouped geometry and
  enables per-slot materials only when actual draw groups exist. A production
  build and bounded external-Chrome WebGL capture show the complete authored
  face, hair, clothing, legs, and weapons again with no shader errors.
- The texture-preserving fallback remains enabled and the experimental low-fill
  preset is no longer auto-applied. This is containment, not official parity.
- JP 3.11 GLES evidence shows the next implementation must replace the two
  physical-light passes with the recovered half-Lambert/control-R toon ramp and
  final main-light-plus-SH multiplier. Specular, MatCap, anisotropy, Gem, face,
  and AngelRing remain separate recovered branches.

## Heavy-analysis safety inventory

- `jp_asset_version_mapping`: no `.so` work. Inputs are the 465,351-byte
  Android Manifest and streamed JP logs. A previous unconstrained `rg` against
  the 2,556,262,199-byte log exited with Windows error 1455; no process remains.
  Future log reads use `FileStream` chunks no larger than 4 MiB.
- `jp_shader_regression`: no `.so` work. Inputs are a 1,494,994-byte compiled
  shader bundle and already extracted GLES text; short UnityPy processes exited.
- `shader_history_bisect`: no `.so` work. It uses only bounded Git text history.
- All subagents were instructed: one heavy process maximum; first narrow with
  metadata/strings/references; stream and checkpoint any full coverage; never
  materialize all disassembly objects; stop and save at 6 GiB, hard limit
  8 GiB; record PID/input SHA-256/progress; cancellation must terminate the
  child process tree.

## End-of-session integration checkpoint

Branch: `research/jp-official-profiles-20260729`

### AngelRing status

- The Unity-local face-forward axis is converted to Three/FBX handedness before
  applying the animated Head quaternion. This fixes the former front/back
  reversal.
- The JP 3.11 projected-map formula, common 512x512 wedge texture, serialized
  material enable/map mode, per-character `headOffset`, and animated Head axes
  are now wired into the Hair material.
- The contribution now follows the compiled program's scene-light path instead
  of deriving light by dividing the composited output by the pale hair albedo.
  That division was the direct cause of the opaque white stripe.
- Bounded Chrome captures confirm:
  - front and low-front views contain the authored highlight;
  - the back view does not contain the former persistent horizontal band;
  - all six main Madoka materials compile under WebGL 2 with no page error.
- Reference frames and notes are under the ignored local directory
  `artifacts/official-reference/`. The clearest official frame is
  `mv2024_00-00-12_000.png`.
- This is not yet final visual parity. The current highlight edge is harder
  than the official movie because CharacterCancelPerspective and the exact
  official post/tone/bloom chain are not fully ported.

### General animation-binding fix

- The project pins `three` to `0.182.0` and applies
  `patches/three+0.182.0.patch` through `patch-package`.
- FBX animation tracks are now addressed by the imported Object3D UUID derived
  from the FBX Model ID, with the old model name retained only as a fallback.
- Morph tracks receive the same ID/UUID treatment.
- This fixes the general class of same-name/different-FBX-ID binding errors
  rather than adding an Ashley-only pose patch. Same-ID companion tracks still
  share a UUID and remain eligible for the existing ownership de-duplication.
- Production TypeScript/Vite compilation passed after applying the patch.
  Ashley and the full 90-character regression matrix still need the final
  runtime assertions before promotion to the deployment branch.

### Android Manifest and official dynamic scenes

- `D:\magia\ma-ex-data\gamedata\AssetBundles\Android` is a 465,351-byte UnityFS
  AssetBundle Manifest, not a directory. It contains 12,402 bundle names and
  their dependency graph.
- The Manifest is the missing key for resolving external textures and common
  shader dependencies. It avoids another 30+ GiB download and avoids an
  unconstrained full-corpus scan.
- Current static FBX export loses AnimationClip, Animator, ParticleSystem,
  Timeline, Cinemachine, Spline, and controller/event behaviour. Therefore the
  current five official entries are geometry previews, not complete official
  scene reconstruction.
- Bounded implementation order:
  1. `battle/stage/bg_3d_600_00_01_002`: five clips, three Animators, no
     particles; first dependency-closed animated scene.
  2. `battle/stage/bg_3d_603_00_01_003`: compact first ParticleSystem fixture.
  3. `dungeon/level/10000/level_intro_0001_001`: Timeline, Cinemachine, Spline,
     events, and four ReDriveVolumes.
  4. `gallery/bg3d_gallery`: Animator, particles, volumetric light, and dynamic
     post processing.
- Export one bundle at a time with Unity `2022.3.62f2` and
  `--max-export-tasks 1`. If a bundle reports `2022.3.21f1` and serialized
  fields fail, record the detected version and retry only that bundle with its
  detected version.

### Web runtime architecture decision

- Do not replace Magius3Dviewer wholesale with a Unity WebGL build at this
  stage. That would increase download size and startup cost, weaken direct
  shader inspection, and make the current multi-character/viewer workflow much
  harder to debug.
- Use Unity `2022.3.62f2` as the authoritative offline decode/reference layer:
  resolve AssetBundle dependencies, deserialize components, and export an
  explicit Web scene package.
- Extend the current Three.js runtime with the required deterministic subsets:
  Animator clips/controllers, supported ParticleSystem modules, Timeline
  activation/animation/signals, Cinemachine cameras, Splines, ReDriveVolume,
  lights, fog, probes, tone mapping, and bloom.
- A separate minimal Unity WebGL reference build is useful later as an
  image-comparison oracle, but it should not replace the public viewer.

### Safe resume

- The local preview used `http://127.0.0.1:4173/` and loopback Python server PID
  `31928` during this session. The server is stopped before the Codex restart.
- Resume by checking out this research branch, running `npm ci` (which applies
  the locked Three patch), then `npm run build`.
- Do not use the Codex in-app Browser/WebView. Use external Chrome or the
  bounded `scripts/capture-webgl-cdp.mjs` process, one Chrome process at a time.

### Final checkpoint validation

- `npm ci` completed and `patch-package` reported `three@0.182.0` applied.
- `npm run build` completed successfully with TypeScript and Vite production
  output. Remaining output was limited to bundle-size/import warnings.
- `git diff --check` passed; Windows line-ending notices are informational.
- A fresh bounded Ashley `110701` WebGL 2 capture completed in 9.4 seconds:
  the `.fbxdata` model returned HTTP 200, all 7/7 main materials compiled, and
  the report contained no page, browser, or shader errors.
- This checkpoint proves that the general FBX ID-to-UUID binding path compiles
  and runs for Ashley. It does not replace the still-pending full 90-character
  animation matrix or claim final official AngelRing/shader visual parity.
