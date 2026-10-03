# Main consolidation — 2026-10-03 / final checkpoint 2026-10-04

## Completed

- GitHub: **1 branch (main)**, **0 open PRs**. Seven obsolete branch refs removed after history-only consolidation. Existing merged/closed PR records and all runtime Release tags/assets retained.
- Local: **34 obsolete Viewer project/build/replay directories removed**, zero removal failures. Only D:/magia/MyProducts/Magius3Dviewer-Cloudflare remains among Viewer roots in MyProducts and .codex-work. Do not treat these historical Windows paths as cloud dependencies. The temporary clean-checkout test directory is removed after verification.
- Production: **a4dafeccbd8e2ee2f07a3952ab2c204c6fc0eb70**, Cloudflare deployment **227e14d7**, https://magius3dviewer.pages.dev/. **36 HTTP files match the release package exactly**; runtime gateway healthy. Later main commits adjust CI/testing only, not the published application source.
- Ordinary source now contains the current v5 cloth/normal/outline policy and the generic opposing-native-lining render fix. No preview overlay is needed. The public/model/texture and non-cloth application source is unchanged from c5297e5.
- Fresh source clone: npm ci, 637 website tests, full typecheck, complete production packaging passed. Rollback rehearsal: 629 baseline tests passed, patch reapply, 637 modified tests passed. No skipped tests. [Machine record](main-consolidation-20261003/verification.json).
- README and CLOUD_HANDOFF.md cover source authority, build commands, live product dependencies, rejected experiments and remaining acceptance. The native cloud-shader diagnostic evidence is checked in for continuation.

## Decisions, not blind merges

Old shader patch workflows, stale research runtimes, extracted cache files and rejected contact experiments were not restored to active source merely because they were unique. Former branch history is reachable from main without replacing the chosen latest tree. The old e9223312 stage release is an ancestor of current main (GitHub comparison behind=0). Existing resource closures were validated from a fresh clone before removing local copies. Two downloaded third-party physics reference clones were inside the obsolete Viewer verification tree and had no tracked edits; no external repository was changed.

The relative-contact-history experiment remains excluded: smoother Nemu walking did not justify increased peak motion in other replay cases. Existing fast cloth bursts and clipping are **open**, not a completed universal motion fix. No collider shrink, lower collision strength or additional penetration allowance was introduced. HTTP tests and offline raster/geometry evidence are not human visual acceptance.

## Cloud handoff checks and exact remaining gates

GitHub run [37121755145](https://github.com/HiiragiNemu/Magi3Dviewer/actions/runs/37121755145) passed Linux dependency installation, all 637 tests, full typecheck, packaging, real pointer/skinning/multi-character checks and the stage delivery browser check. The existing viewport smoke assertion **Collapsed tools must leave the viewport free** failed; it remains enabled and must be investigated rather than silently skipped. Overall workflow is not reported green.

The deployment environment initially had no Cloudflare Secrets. By direct user authorization, **CLOUDFLARE_ACCOUNT_ID is now configured**. API_TOKEN creation was blocked by the application's browser permission verification service; it has not been created or stored. After browser access recovers, create the narrowly scoped Pages token and store it in magius3dviewer-live, then rerun the workflow. The local authenticated release above is already live; it is not a successful cloud automatic deployment.

At final cleanup, unrelated concurrent native-gallery scene changes appeared in the main working directory (stages.ts, stageNativeImage.ts, catalog/data/tests/research). They were preserved, not committed or reverted by this release. They are **not yet part of this GitHub handoff revision**; their writer must finish their own reviewed transfer. Current local working tree is therefore not claimed clean.

The next feature focus remains scene completeness and correct native rendering. See CLOUD_HANDOFF.md and the 2026-10-02 scene audit for the full retained scene gaps; do not confuse the catalog denominator with full visual closure.
