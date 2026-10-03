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
| SCENE-1 | Complete correct native scene reconstruction, not one sample | **Open**: 581 catalog entries are a denominator, not 581 accepted reconstructions; start from the scene audit linked in README |
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
