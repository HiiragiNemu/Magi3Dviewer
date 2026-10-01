# Exact node controls, PC TPS and native atlas follow-up — 2026-10-01

## Release status

Candidate application is locally validated. Production revision/deployment verification will be appended after publishing the existing Cloudflare project. Baseline repository: `0ea625a`; previous production application: `c174388`. Continue only `magius3dviewer`; do not alter default `main`, Reader, L2D or unrelated repositories.

## Verified root causes and behavior

### Node location and presentation

The previous primary-marker layout applied collision repulsion to the joint marker itself without a leader line, so the dot was no longer the projected joint origin. The baseline reproduction retained in `evidence/2026-10-01-node-tps/node-baseline-reproduction.json` demonstrates this displacement at several camera angles.

All primary, hand and more-node controls now use a named fit-content chip, a true joint-origin dot and a leader. World/view matrices are refreshed before projection and the current camera is resolved through a getter, so camera replacement and optical roll do not leave stale projection state. The dot is never collision-repelled. Actual bone points remain directly draggable; the named chip is the larger accessible target. Buttons stay in their arranged positions when the camera moves, while the dot and leader update. Final real browser five-angle/roll maximum endpoint disagreement: **9.779711566628324e-13 CSS pixels**.

Every tool button, category/chain selector and joint chip has its own layout grip. Dragging the grip changes only UI placement; it does not rotate a bone or move the actor. Placement is normalized and retained in browser storage. Double-click a grip to restore that control's default placement; keyboard arrows move the focused grip and Shift uses one-pixel steps. Per-chain listeners are aborted when the chain changes. Idle projections are cached at subpixel precision without altering model render quality.

There is no large hand-panel backdrop, forced full-width cell or explanatory footer. Hands are still left/right, then individual fingers, with joints in actual chain order. Primary controls use the same persistent names and leaders. Short landscape viewports use extra compact columns rather than stacking controls off-screen. Real layout checks at 360×780, 430×932, 932×430 and 1366×900 found no default chip overlap, horizontal page overflow or controls outside the viewport; the four selected index-finger joints fit one row.

### Focus

The old sticky `detailFocused` state re-framed on every category/chain change. It has been removed. Focus is an explicit one-shot action; switching finger, hand, main node or enemy chain changes selection only. For an enemy or a tiny one-node branch, framing uses a visible-actor-bound exit distance, so the lens is not placed inside the selected model. Whole-object recovery also works after zooming through the old pivot, preserving optical orientation rather than pointing away from the actor.

### Desktop TPS

TPS enablement and mouse capture are separate states. Escape or native pointer-unlock releases the cursor and clears held inputs but leaves TPS on. With the cursor visible, left drag looks around, right/middle drag (or Shift-left drag) pans, and a single click on an eligible visible actor changes the controlled instance. A deliberate **double-click in the view** captures the mouse again; no extra capture button is added. Lock capture is not triggered by an ordinary click or drag. Desktop corner controls provide ±15° optical roll and one-shot whole-actor framing.

With one actor the existing TPS button toggles on/off. With several loaded actors it keeps the same 112-pixel width and opens an instance-based menu with an Off choice. Duplicate copies of one model have separate instance keys. Ineligible story actors are shown as disabled choices; selecting one does not make the menu inaccessible when another actor can be controlled. Menu navigation does not also steer the actor. Mobile tapping another character changes control without stealing joystick/camera finger ownership.

## Native atlas census and repairs

The audit covers **98 shipped FBX resource directories**, including alternate FBX filenames and all three typed story actors, and **1,619 native/local texture comparison items**. These are per-model comparisons, not a claim of 1,619 unique texture assets or 98 unique people.

Confirmed additional affected ordinary model: **101501** — body, accessory and weapon_a color/shadow/control atlases. Confirmed additional affected part of previously repaired **101401**: weapon_a. Twelve PNGs were restored as four complete native texture triples. Target FBX UVs match the exact native mesh, and native Material PPtr bindings prove which texture belongs to each affected material slot. Source bundle hashes, mesh/texture/material IDs, pixel hashes and before/after PNG hashes are retained in `2026-10-01-atlas-repair.json`.

Two threshold candidates are not atlas relocation: 109801's prism compression/color differences and 114601's uniform control-map resolution difference. They were not replaced. Five strict vertex-array mismatches in the original corpus are exporter triangle order/triangulation or combined-sword differences with matching UV island boundaries. The 100102 school export retains a small pre-existing UV adjustment, while all thirteen compared texture layouts agree; it is not classified as a 101401-type mismatch. Namae 113401 has a procedural noise-only shader and no ordinary body/face atlas in its model bundle. The 101002 contract's `sourceCommit` is a Git revision, not a bundle digest; direct native UV/texture comparisons agree.

No meshes, shader profiles, baked normals, source animations or native locomotion assets were substituted. The existing 101401 body-atlas repair remains unchanged. All 1,619 audited local texture items retain their original bytes except the twelve explicit repairs.

## Validation

- `npm run test:website`: **418 passed, 0 failed, 0 skipped**. This is the website regression gate, not a claim that every old research/corpus test in the repository is green.
- `npx tsc --noEmit`: passed.
- `git diff --check`: passed; only normal checkout line-ending notices.
- New browser acceptance: **15 sections passed**, zero page exceptions, using native mouse/pointer-lock and CDP touch events, not a fake capture toggle.
- Retained prior browser acceptance: **14 sections passed**, zero page exceptions. Includes the original 101401 body pixel identity, actual finger editing/undo, real body double-taps, enemy pause/edit/undo/reset/save/load without modifying the girl, slider/percentage adjacency, touch UI gating and ordinary/TPS optical roll.
- Protected motion evidence verifies that `characterLocomotion.ts`, jump kinematics/style, landing gait phase, native fixed transitions and the native action manifest are unchanged. The generated jump pose region in `viewerLocomotion.ts` is byte-identical; its small changes are confined to input/camera UI wiring.

Evidence directory: `docs/reports/evidence/2026-10-01-node-tps/`. Raw local logs and larger audit intermediates remain under `artifacts/node-tps/` and `artifacts/atlas-audit/`.

## Reproduction / next release gate

```powershell
node scripts/export-native-atlas-uv.mjs
python scripts/audit-native-character-atlases.py --index artifacts/atlas-audit/fbx/index.json --output artifacts/atlas-audit/current-census.json
npm run test:website
npx tsc --noEmit
npm run build:deploy
```

The before-audit census is deliberately retained; a later after-repair rerun is a different snapshot. Native bundle paths are explicit in `2026-10-01-atlas-inputs.json`. Use only the source corresponding to each model; do not substitute neighboring models.

Publish `dist-deploy` to the existing Cloudflare Pages project `magius3dviewer`, production channel `main`, while retaining Git branch `magius3dviewer`. Do not weaken the release gate or deploy an ordinary full research build. Run both browser scripts against the formal URL and verify the exact `site-version.json` revision before claiming completion.
