# Selection panels and official image refresh — 2026-10-04

## Released scope

- Character/witch portraits retain square image frames and names wrap to their width. Scenes keep landscape previews.
- Shared compact/restore button: five portrait columns and two complete rows; three scene columns and two complete rows. Scene desktop default is 840×640, bounded by the viewport. Restore preserves the previous custom dimensions.
- Search input shrinks first. At narrow panel widths, complete control groups and card columns reflow instead of overlapping. Counts and the single name-language toggle occupy the search row.
- Chinese/ID searches remain available. Character/witch search includes Japanese and romaji; scene search includes Japanese and English. Readings are search aliases, not replacements for official source names.
- Selected name, quantity and add/replace controls share footer space. Added actors have individual portrait tiles and independent select/remove buttons.
- 99 official 3D portrait keys replace chibi imagery, including nine previously missing keys. Latest verified JP delivery updated two of those portraits. Five landscape previews and five usable Japanese name records were added; this does not add new reconstructed 3D scenes.

## Verification

| Gate | Result |
|---|---|
| Website suite | 657 tests passed, zero skipped/failed |
| Complete TypeScript check | Exit 0 |
| Resource-panel browser | 43 recorded checks; 12 desktop/mobile layouts; no page errors |
| Compact dimensions | Character 5×2, witch 5×2, scene 3×2 complete cards |
| Header dragging | All three panels moved 40×20 pixels; camera position/orientation unchanged |
| Actual corner dragging | Widths 560/420/310; cards reflow, no text/footer overlap |
| Restore | Previous custom width/height restored |
| UI work while idle | Zero card/list rebuilds and zero repeated inline-style writes in each sampled compact panel |
| Initial portrait requests | One current-character portrait; no eager fetch of the 99-image library |
| Existing viewport interactions | Independent browser regression passed: pose editing, bounded joints, ground contact, second actor, undo/redo |
| Native image provenance | 99 source images verified; 97 same decoded pixels, two refreshed from current JP |

The browser gate uses software WebGL for repeatable CI interaction checks. Its FPS counter is not a hardware-GPU performance benchmark. Performance evidence here concerns added image requests, stable DOM/layout work and continued rendering. No cloth solver, character material or advanced node/pose implementation was replaced by this UI change.

## Two publication routes

1. Full GitHub Actions run: [37148193845](https://github.com/HiiragiNemu/Magi3Dviewer/actions/runs/37148193845), revision `ebd927a6c87f2aa0be884e262e5538fc9fb5ccc8`. **Completed successfully at 2026-10-03T20:51:24Z**. Configuration, clean cloud build/tests, all pre-publication browser gates, actual publication, exact public revision and all production scene/viewport/entry-landing browser gates passed. Evidence artifact: 182,610,468 bytes (about 174 MiB).
2. Following that successful first route, publish this image/panel revision directly to the same Cloudflare Pages project and `main` production branch. Verify the actual served revision, HTML/assets and the resource-panel browser gate.

The earlier run 37143404204 published successfully but hit the former 75-minute job timeout during its last public-site browser gate. It is not counted as a complete cloud success. The 120-minute replacement retains all tests. Its predecessor's evidence artifact was 182,518,340 bytes; the roughly 2.8 GiB website is no longer uploaded as an intermediate Actions artifact.

## Reproduction and handoff

```sh
npm ci
npm run test:website
npx tsc --noEmit --pretty false
node scripts/build-deployment.mjs
MAGIUS_SITE_URL=https://magius3dviewer.pages.dev/ MAGIUS_EVIDENCE_DIR=artifacts/resource-panels node scripts/site-smoke-resource-panels.mjs
```

Image provenance is committed in `public/ui-thumbnails/runtime-selection/source-projection-20261004.v1.json`. Raw local logs, screenshots and exact release/rollback records stay in `artifacts/cloud-publish-loading-20261004/private-publish/`; the Actions run publishes its independent evidence artifact for seven days. Workflow tests and public-site checks remain the release gate for subsequent commits.

This closes the requested image/search/panel changes when both publications are verified. Native scene completeness, remaining cloth motion acceptance and the unreviewed scene-catalog remainder retain their separate open status in the handoff ledger. Technical browser checks are distinct from the user's visual acceptance.
