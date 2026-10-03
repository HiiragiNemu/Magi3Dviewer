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
- Scene catalog (581 entries), enemy catalog (514 records / 493 render-ready products), and character/enemy combat VFX.
- Resource panels, localized names, voice presentation and locale-specific fonts.
- First visit defaults to Simplified Chinese, including English/Japanese browsers; an explicitly saved language choice still takes priority.
- Lighting, outlines, screenshots/camera mode and preset sharing.

Catalog membership and successful loading are **not** proof of full native visual parity. Resource IDs and coverage come from the versioned catalogs, not arbitrary substitutions.

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

- [Current handoff](docs/CLOUD_HANDOFF.md)
- [Scene gaps and prior release evidence](docs/reports/2026-10-02-resume-scene-audit.md)
- [Old scene delivery reconciliation](docs/reports/2026-09-30-scene-directory-audit.md)
- [Touka 111501 motion + 114501 arm spread](docs/reports/2026-10-03-touka-hybrid-db8-release.md)
- [Release/consolidation record](docs/reports/2026-10-03-main-consolidation.md)

Important remaining scene cases include the native 3D-noise cloud shader, dungeon-612 particle/depth behavior, other special shaders and the unreviewed catalog remainder. Technical tests, deployment verification and user visual acceptance are recorded separately.

This is an independently maintained viewer, derived from [Magi3Dviewer](https://github.com/haojiezhe12345/Magi3Dviewer). Original game content belongs to its respective rights holders. See the repository's existing license notices.
