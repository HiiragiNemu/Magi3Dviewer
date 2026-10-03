# Cloud handoff — 2026-10-03

## Authority and boundaries

- Sole maintained branch: **main**. Source is the current Cloudflare application, not the old main tree or a local overlay.
- Production: https://magius3dviewer.pages.dev/ ; Cloudflare project magius3dviewer. Read site-version.json to identify the actual serving commit.
- User priority: retain all current functionality; clean duplicate branches/checkouts, update documentation, deploy correctly, then continue scene completeness/native fidelity from GitHub in the cloud.
- Do not equate unique old content with useful content. Old shader patch workflows and superseded research prototypes are not application requirements. Preserve Git history, not obsolete code in the active tree.

## Stable requirements and acceptance

| ID | Requirement | Current state / evidence |
|---|---|---|
| RELEASE-1 | Ordinary committed source, reproducible website package, no local badge | Integrated source and website gates; terminal release evidence in the consolidation report |
| CLOTH-1 | v5 front/inner black-patch handling retained | Source + synthetic render/culling/normal tests; prior v5 user feedback accepted black-patch improvement |
| CLOTH-2 | Brown lining must not protrude as a synthetic exterior patch; generic fix | Opposing lining classification and outline mask; held 3-character replay unchanged from v5 geometry; offline diagnostic raster is not live GPU acceptance |
| CLOTH-3 | No further collision weakening or forced body/arm changes | Collider/strength policy retained; tests preserve body, bones, other actors and restoration |
| CLOTH-4 | Smooth cloth under walking/jumping, all cloth and characters | **Open**: existing high-speed bursts/clipping remain. Do not mark universal motion acceptance complete |
| POSE-1 | Touka style 111501 with 114501 spread; pose/IK/TPS/workspace features | Existing c5297e5 source preserved outside the selected cloth files; regression suite remains enabled |
| SCENE-1 | Complete correct native scene reconstruction, not one sample | **Open**: 585 official shard entries are a denominator, not 585 accepted reconstructions; the combined selector also retains research/QA environments; start from the scene audit linked in README |
| HANDOFF-1 | Cloud development without former Windows directories | Clean-checkout test/build and main workflow evidence in the consolidation report |

## Cloth implementation and rejected work

Source: src/viewer/garmentContacts.ts, garmentSurfaceContact.ts, characterPhysics/runtime.ts. Keep render and physics causes separate. Exterior backs retain colour; native opposing inner shells do not gain a redundant outward colour pass or outward inverse-hull outline. Classification is construction-time, geometry/skin-weight based, not an ID-specific hide.

The release uses the existing v5 solver and shared BoneCloth continuity. The later relative-contact-history candidate is **not integrated**: Nemu walking RMS correction jumps improved about 88%, but some running/jump peaks increased. That conflicts with the no-regression release requirement. This diagnostic is a next-step clue, not approved implementation. Do not lower collision strength, shrink colliders, add penetration allowance, or freeze cloth to suppress visible motion. Do not restore rejected v6/v7/v8 high-cost/stretch/black-patch experiments.

## First cloud session

1. Read README and this ledger; inspect main and the public site-version revision.
2. npm ci; npm run test:website; npx tsc --noEmit; node scripts/build-deployment.mjs.
3. Keep production gates and existing runtime Release assets/gateway intact. Run site-delivery on main for a real release. Historic site-publish-verified reuse is only for source-equivalent changes; it deliberately rejects new application code.
4. For scene work start with docs/reports/2026-10-02-resume-scene-audit.md: native 3DNoise cloud shader; dungeon-612 particle/depth behavior; remaining special shaders/nativeVisibility and full-catalog visual review.
5. Validate character/TPS/pose/recording/camera/voice/resource preservation as well as the changed scene. No one-scene or static-only PASS closes the original scope.

## Rollback

Use a reviewed Git revert on main and rerun site-delivery; do not reset main to a rejected experimental tree. The consolidation commit preserves the former branch ancestry while keeping the chosen current tree. For immediate deployment rollback, retain the preceding Cloudflare deployment until the new public revision is verified. Do not delete runtime releases as part of a rollback.

Native cloud-shader diagnostic programs and volume metadata are now versioned under docs/research/cloud-native-evidence/. They are evidence only; voxel payload extraction/decoding remains an explicit scene task.

## Cloud deployment credential gate

Rechecked 2026-10-04: magius3dviewer-live has both CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. The API token was active and accessed the existing magius3dviewer Pages project on account 9810127b0434fc919d963595b0418768; its Secret was written at 2026-10-03T17:57:44Z. Old runs 37138792390 and 37140838567 started before configuration and failed that gate. Full cloud run 37148193845 completed successfully at 2026-10-03T20:51:24Z: configuration, build/tests, publication, exact public revision and all production browser gates passed. The run published ebd927a6c87f2aa0be884e262e5538fc9fb5ccc8. Its evidence artifact is 182,610,468 bytes; the complete site is not an Actions intermediate artifact. Website build/validation is independent of this gate, but production publishing still requires it. Do not upload the developer OAuth session as a long-lived repository credential. The manual source-equivalent shortcut no longer runs automatically alongside a full deployment.

## Concurrent AgentDock changes and loading review

See docs/reports/2026-10-04-agentdock-loading-review.md. The user approved integrating the 79 verified native-image backgrounds subject to release validation. A previous timeout used a nonexistent catalog ID and selected none; it is not evidence that an actual catalog entry failed. The release browser gate now checks every one of the 79 exact selector options, identity/dimensions/draw submission, actor preservation, a screenshot per entry, and return to 3D, before and after publication. These are original 2D Sprite backgrounds, not reconstructed 3D geometry. Visual review and human acceptance remain separate. Three unconsumed cloud-research payload files remain excluded; they do not implement a cloud shader. Original resource filenames are retained rather than replaced with category labels.

## Cloud-runner transfer and private quota

The full tested build now stays on one Actions runner through tests, publication and public-site checks. There is no multi-GB `verified-website` intermediate artifact or second dependency install. Only `/tmp/site-evidence/` is uploaded for seven days, including all 79 gallery screenshots and their per-entry review ledger. Tests are not removed to save quota.

The user requested a real cloud publication while the repository remains public. Do not use local Wrangler upload as proof of automated publication. Do not change repository visibility or paid budgets as part of this run. GitHub Free and a zero paid Actions budget are confirmed from the user's billing screenshots; actual remaining included minutes and account-wide artifact storage are not yet shown. Gross metered dollars and a 100% zero-budget badge do not measure remaining minutes.

First visits default to Simplified Chinese; a saved explicit language choice still wins. The cloud viewport test selects Chinese before comparing labels; source files for the advanced node/pose UI have not been downgraded or replaced.

## Selection portraits and names — 2026-10-04

User-selected portrait appearance: official 3D upper-body previews, not the former chibi icons. 99 model-keyed thumbnails now use held JP native bundles, with nine missing keys filled. The native model/resource-to-style join and the legacy default-Madoka outfit alias are explicit in the source-projection receipt; do not match the two numeric ID namespaces by accident. The current character selector exposes 98 entries; image coverage and exposed model count are separate.

Character and enemy image frames are square, compact and use width-wrapped names. Scene previews remain landscape. The browser gate covers twelve viewport layouts, actual header dragging and corner resizing at 560/420/310 px, search/language toggles, added portrait selection/removal, compact/restore and zero idle card rebuilding. Character and witch compact presets show five columns/two complete rows; scenes show three columns/two rows, with a 840×640 bounded desktop default. Narrow windows reflow by panel width, not just viewport width. Avatar physics and the advanced pose/node editor are not modified.

Held JP data supplied four newer diorama preview/name pairs plus the exact `641...originall` preview and the previously missing Japanese name for scene 910301. These are image/name additions, not newly reconstructed scene geometry. TW master revision `a06b42aff83728729bb06ade96d6b0b5` was checked against the existing scene/enemy names and thumbnail inventory: no additional usable names or missing supported-enemy thumbnails were found. The old local `MasterData/active` folder is not the refreshed TW snapshot. Public source receipts contain logical resource paths and hashes only.

The subsequent JP delivery is now verified against master `3d98d4e8583896341a0e661c713bcc5c` and asset catalog `8929198713b2ee622f4131b8a25dc4e5`. All 99 portrait sources were checked: 97 retain identical decoded pixels; 111601/114801 use the new verified PNGs. No additional usable scene/enemy names were found beyond the held-JP additions. Placeholder `-` names are not upgrades. Official image bindings explicitly lack enemy 650061/650062/650063; never invent a substitute image for those IDs. This release does not import the unrelated model/shader/audio changes in the same delivery.

Characters/witches search all Japanese and romaji aliases independently of the displayed label; scenes search English and Japanese names. Chinese/IDs remain searchable. Counts and the single name-language toggle are on the search row, and selected details/add controls share footer space before wrapping. Added actors have bounded square portraits and accessible independent remove buttons.
