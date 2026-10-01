# Final model-editor usability and 101401 repair — 2026-10-01

## Scope and safety

Source repository `HiiragiNemu/Magi3Dviewer`, existing `magius3dviewer` branch; production remains the existing Cloudflare project `magius3dviewer`. Cloudflare's actual production channel is `main` (a deployment channel, not a change of Git branch). No new branch/PR, no force push, no Reader/L2D changes. Incoming candidate edits and all pre-existing untracked resources were preserved in a recovery snapshot outside the repository.

This document records implemented behavior and reproducible verification, not a claim that every browser, every costume, or every animation was visually inspected. Deployment completion is recorded separately after the production revision is observed.

## Implemented behavior

| Requirement | Implemented behavior and evidence |
| --- | --- |
| Desktop TPS without phone buttons | Actual input modality controls the touch overlay. A touchscreen-capable desktop does not show it merely because `maxTouchPoints` is nonzero; mouse/keyboard returns to desktop controls. Actual hybrid-desktop and mobile-touch transitions passed. |
| Responsive TPS look/zoom | Screen drags use Orbit's radians per CSS pixel; raw pointer-lock input keeps its separate device gain. Relative displacement is consumed directly, never multiplied by frame time. Constant-distance dolly can pass its pivot by advancing the target, with no 10/20/40-unit hard cap or near-distance asymptote. |
| Two-finger optical roll | Ordinary Orbit and TPS use an absolute two-finger baseline (centroid, separation, optical angle). Pure 60-degree ordinary twist changed position/target by less than 8e-9; pure 45-degree TPS twist by less than 2e-7. TPS exit preserves the resulting camera orientation. Ordinary roll is included in saved workspace state. |
| Stable double-tap body selection | Animated bounds are refreshed when hit-testing visible meshes. Outline/mask helper geometry is excluded. Opening taps own their compatibility click, and activating the same target twice is idempotent. Real touch double-taps at Head/Chest/Waist/thigh/knee positions remain open instead of ghost-closing. |
| Enemy/non-magical pose editing | Pose authority follows the actual selected instance, not the last selected magical girl. Each enemy owns its pause, manual channels, undo/redo, reset and saved-pose identity. Real enemy 600001 edit/reset/save/load passed while the magical girl remained unchanged. Native zero-scale alternate-head branches are saved unchanged, omitted from visible handles, and cannot be force-enabled by a pose import. |
| Primary anatomy | Arm/UpLeg/Waist, plus shoulder, neck, chest, spine, pelvis, elbow/knee and wrist/ankle are recognized on the real rig. Renderer-specific nested identity copies are not separate controls. Four real-model regression fixtures cover the canonical rig and primary/finger partition. |
| Useful finger UI | Explicit left/right hand, then one named finger. Thumb has three real joints; other fingers have their metacarpal/start plus three joints. Only the selected chain appears in an ordered touch-sized tray. No arbitrary four-node slicing. A separate focus-part action approaches the hand from outside the torso; global focus returns to the whole model. |
| Useful remaining nodes | Real component categories and authored strands replace 24-item pages. Only the current chain gets low-opacity leader lines; actual names remain in tooltips/search. Whole-object roots, primary duplicates and inactive zero-scale branches are not redundant controls. |
| Remove redundant free group | The fourth free-edit category is removed. Rotation, real accessory bones, saved poses and explicit advanced structure/stretch operations remain; default editing preserves length. |
| Compact animation UI | Both character and enemy selectors share fixed widths (112 px at the tested phone breakpoint). Slider and percentage are one nonwrapping unit (62 px + 2 px gap + 28 px); they cannot wrap apart. Top-level controls flow individually instead of keeping wide empty group islands. |
| Chinese enemy clips | Runtime values and clip names are unchanged; display labels translate official action families, loop/start/end/single suffixes and variant numbers. Canonical identities remain in titles. English and Japanese remain separate presentation layers. |
| Combat-effects entry | The unused toolbar entry is hidden; VFX playback/runtime and existing action effects are not deleted. |
| 101401 shoulder atlas | See `2026-10-01-momoko-texture-identity.json`: all 37,296 Body FBX UV vertices match the native index stream after winding reflection. The old body PNG atlas was from a different layout, mapping shoulder UVs into black pixels. Only the three matched native body color/shadow/control textures were restored. Actual before/after rendering confirms the black shoulder regions disappear. No brightness, guessed material-slot or global shader workaround. |
| Standing jump | Brief backswing, modest upper-arm lift with bent elbows, then a relaxed downward recovery. The airborne curve no longer returns to the forward takeoff pose just before landing. Eighteen phase samples across 100101/100201/101401 were captured from front and side and reviewed. |
| Preserve native locomotion | `viewerLocomotion.ts`, `characterLocomotion.ts`, native transition data and native action manifest remain unchanged. Existing native idle/walk/run identity and landing tests pass. All 90 locally shipped battle rigs had finite positive arm/leg segment measurements; current generation measures the target hierarchy and scales paths to its own limb lengths instead of copying donor bone translations. This numerical audit is not a blanket visual acceptance of all 90 animations. |

## Verification entry points

- `npm run test:website`: **395 passed, 0 failed, 0 skipped** after the final native-zero-scale regression was added.
- `npx tsc --noEmit`: passed.
- `finalViewerUsability.test.mjs`: real FBX partitions, native texture identity, animated picking, generic ownership, optical roll and constant-distance dolly.
- `scripts/site-smoke-final-usability.mjs`: actual browser touch interactions, 101401 loaded-texture pixel digest, enemy edit/save/reset isolation, 360/430/932/1366 responsive layouts, and optional exact production-revision assertion.
- Local rendered evidence: `artifacts/final-ui/review.json`, `artifacts/final-jump/review.json`, and their screenshots. Desktop Chrome with GPU rendering and mobile touch emulation; not physical-device FPS certification.
- Limb measurements and unchanged-source hashes: `2026-10-01-final-gait-dimensions.json`.

## Publish and production verification

Use the existing bounded production build, not the archived all-research-corpus build:

```powershell
npm run build:deploy
npx --yes wrangler pages deploy dist-deploy --project-name=magius3dviewer --branch=main --commit-hash=<git-rev-parse-HEAD>
$env:MAGIUS_SITE_URL='https://magius3dviewer.pages.dev/'
$env:MAGIUS_EXPECTED_REVISION='<application-commit>'
node scripts/site-smoke-final-usability.mjs
```

The final check must match `site-version.json`, the HTML build revision and the loaded 101401 image pixels on the formal production origin. A successful upload alone is not production acceptance. Preserve the preceding production deployment as a rollback point.
