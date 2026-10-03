# Magius3Dviewer

Browser-based Magia Exedra character, scene, enemy and VFX viewer, built with [three.js](https://threejs.org/).

**[Production website](https://magius3dviewer.pages.dev/)** · **Maintained branch: main**

## 云端接手 / Cloud handoff

Use this repository's **main** as the sole application source. Do not restore an old research branch, copy a local preview overlay, or replace the current tree with an older build. A later timestamp alone is not evidence of a correct implementation.

Start with [the handoff and acceptance ledger](docs/CLOUD_HANDOFF.md). It records the retained behavior, rejected cloth experiments, remaining work and release checks. The next product focus is **scene completeness and native correctness**, not a claim that all scenes are already visually complete.

### Clone, test and build

Node.js **22.18+ (22 LTS)** and npm are supported. No Windows drive, game installation, sibling checkout or symlink is required for the website source build.

```sh
git clone --branch main https://github.com/HiiragiNemu/Magi3Dviewer.git
cd Magi3Dviewer
npm ci
npm run test:website
npx tsc --noEmit --pretty false
node scripts/build-deployment.mjs
```

Or use `npm run build:deploy` for those three validation/build steps together. The deployable output is `dist-deploy/`; a production revision is embedded in `site-version.json` and the HTML. The build restores required gzip runtime aliases from committed `.magius-runtime` carriers; **do not commit those generated aliases**.

For interactive development: `npm run dev:local`. For production-package preview: `npx vite preview --outDir dist-deploy --host 127.0.0.1`. Online runtime products need network access to the existing product gateway. Cloning a private repository requires the caller's GitHub access; credentials are not stored in the source.

`npm run build` / `test:release` are the larger **native research** gates, which additionally require extracted authority fixtures. They are not the default clean-checkout website build and must not be weakened to conceal absent research inputs.

## Features retained

- Character selection, multiple independent actors, animation playback and native action resources.
- Third-person walking/running/jumping, collision controls and independent camera controls.
- Direct pose editing, bounded IK, touch controls, saved workspaces and recorded performance lanes.
- Official scene shards (585 entries), enemy catalog (516 records / 495 render-ready products), and character/enemy combat VFX. The combined scene selector also includes retained research/QA environments.
- Resource panels, localized names, voice presentation and locale-specific fonts.
- Character and witch panels use square image frames with full width-wrapped names; scene previews retain landscape framing. Character portraits use official 3D upper-body previews rather than chibi style icons.
- First visit defaults to Simplified Chinese, including English/Japanese browsers; an explicitly saved language choice still takes priority.
- Lighting, outlines, screenshots/camera mode and preset sharing.

Catalog membership and successful loading are **not** proof of full native visual parity. Resource IDs and coverage come from the versioned catalogs, not arbitrary substitutions.

### Selection images and official names

The 2026-10-04 image refresh first filled gaps from already-held Japanese assets, then checked the newly delivered official JP snapshot (`3d98d4e8583896341a0e661c713bcc5c`): 99 model-keyed 3D portraits, including nine previously missing keys. Two portraits (`111601`, `114801`) were updated from the new verified PNGs. The native master joins `resourceName` to `style3dCharacterMstId`; these numbers are not interchangeable (for example, model `100102` uses school-uniform portrait `100106`). Only transparent image padding is trimmed; characters are not cut off to fill the square frame.

Five landscape images and five usable Japanese scene-name records were added. Four of those preview/name pairs are prepared for newer master resources, not a claim that four new scene models were implemented. The refreshed Taiwanese official tables were also compared: all their usable scene/enemy names and every thumbnail for the 516 existing enemy records were already covered. Valid images were retained instead of being replaced merely because their encoded bytes differ. The committed image-source receipt is `public/ui-thumbnails/runtime-selection/source-projection-20261004.v1.json`; no extraction keys or login credentials are included.

The website builds from the committed images alone. `scripts/update-selection-images.py` is an optional offline projection tool for maintainers with held official bundles; it is not a cloud-build dependency. `scripts/site-smoke-resource-panels.mjs` validates real desktop/mobile panels, search, add/remove avatars, header dragging, resize reflow, compact/restore and idle DOM stability against a running preview or `MAGIUS_SITE_URL`.

Characters and witches accept Chinese/ID, Japanese and romaji searches; scenes accept Chinese/ID, Japanese and English. One name-language button and the catalog counts share the search row. Added actors use small portrait tiles with independent select/remove controls. The compact button fits five portrait columns by two rows, or three landscape scene columns by two rows; narrow screens reflow rather than overlay text. Scene panels default to 840×640 (bounded by the screen), with four landscape columns at desktop width. Drag the header to move a panel or either corner to resize; restoring the preset preserves the prior custom size. Images load lazily and idle lists are not rebuilt every animation frame.

## Cloth release policy

The release integrates the v5 shared cloth/outline behavior and the native-lining rendering fix into ordinary source files. A close opposing inner lining must not receive another outward-facing colour/outline pass; ordinary exterior backs retain their colour coverage. There is no character-ID exception for this fix.

Keep collisions enabled. Do not reduce colliders or collision strength, permit extra penetration, or freeze cloth to hide jitter. Nemu's existing clipping and remaining fast motion are **open acceptance issues**, not completed fixes. The later contact-history experiment is excluded because some motion peaks regressed, despite smoother walking. Rejected v6–v8 experiments must not be restored.

## Deployment

The **Deploy tested website to Cloudflare** workflow (`.github/workflows/site-delivery.yml`) runs on `main` and can be dispatched manually. It runs website tests, typechecking, packaging and browser gates, then deploys to the existing **magius3dviewer** Cloudflare Pages project. It checks the actual public revision after deployment. The same cloud runner retains the exact tested `dist-deploy/` package through publication: there is no full-site Actions upload/download between jobs, no duplicate dependency installation, and no local manual deployment required. Only test logs and browser screenshots are uploaded as Actions evidence, retained for seven days. This reduces artifact storage and transfer overhead without removing validation gates.

Deployment uses the existing `magius3dviewer-live` GitHub environment and its `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets (the workflow also supports the existing CF-prefixed aliases). Website validation runs without deployment credentials. Both Secrets were configured and API access to the existing Pages project was verified on 2026-10-04; successful end-to-end publication is recorded separately in the workflow run. The production Pages project belongs to the Crynet account; a token scoped only to the separate Sena account does not grant access to this project. Use the workflow; it should not create another website or expose credentials in client files.

App and selected scene closures are served by Cloudflare. Larger stage/enemy/VFX products remain in the repository's versioned GitHub Release assets, accessed through the existing restricted gateway:
`magius3dviewer-runtime-products.crynetsystemscell.workers.dev`.

Do **not** delete release tags/assets, alter gateway routing or remove committed carriers during branch cleanup. They are live resource dependencies. Do not publish local test badges in the formal website.

Private-repository planning: this account is on GitHub Free, and its paid Actions budget is currently zero with usage stopped at the limit. Included usage remains available; the actual remaining minutes and account-wide artifact storage must be checked in GitHub Billing before changing visibility. The local site's roughly 2.8 GiB unpacked size is **not** a measured Actions upload size. Existing runtime Release assets remain separate from Actions intermediate artifacts.

## Evidence and remaining work

- [Image/panel release and verified full cloud publication](docs/reports/2026-10-04-resource-panels-release.md)
- [Current handoff](docs/CLOUD_HANDOFF.md)
- [Scene gaps and prior release evidence](docs/reports/2026-10-02-resume-scene-audit.md)
- [Old scene delivery reconciliation](docs/reports/2026-09-30-scene-directory-audit.md)
- [Touka 111501 motion + 114501 arm spread](docs/reports/2026-10-03-touka-hybrid-db8-release.md)
- [Release/consolidation record](docs/reports/2026-10-03-main-consolidation.md)

Important remaining scene cases include the native 3D-noise cloud shader, dungeon-612 particle/depth behavior, other special shaders and the unreviewed catalog remainder. Technical tests, deployment verification and user visual acceptance are recorded separately.

This is an independently maintained viewer, derived from [Magi3Dviewer](https://github.com/haojiezhe12345/Magi3Dviewer). Original game content belongs to its respective rights holders. See the repository's existing license notices.
