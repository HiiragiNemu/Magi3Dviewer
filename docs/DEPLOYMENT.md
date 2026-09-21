# Magius3Dviewer deployment

Magius3Dviewer is an independent project. Its production website is
<https://hiiraginemu.github.io/Magi3Dviewer/>.

## Reproducible build

From a clean clone of the website branch:

```sh
npm ci
npm run build:deploy
```

`package-lock.json` closes ordinary third-party package dependencies. Runtime
catalogs and loaders must not refer to sibling projects, junctions, game-install
paths or machine-specific absolute paths.

## Runtime product delivery

GitHub Pages publishes the application and lightweight catalogs only. The
repository-owned runtime corpus is split into deterministic, stored ZIP assets
across `runtime-products-v1-a`, `runtime-products-v1-b`, and the archive-localized
`runtime-products-enemy-models-v2`; each release remains within GitHub's
1,000-asset limit and each asset remains below 2 GiB. The
direction- and stable-key catalogs retain fail-closed behavior.

The release gateway is deployed from
`workers/runtime-product-gateway.mjs` using
`wrangler.runtime-product-gateway.jsonc`. It accepts only the two declared
release tags, streams response bodies without buffering and adds browser CORS
headers. The release URL remains recorded as `originUrl` in every catalog
entry.

The browser activates release delivery only on `hiiraginemu.github.io` (or when
`?runtimeDelivery=release` is supplied for an explicit test). Local development
uses the same relative catalog paths when product files are present. A clean
checkout runs deployment-contained gates and resolves omitted products through
the release gateway at runtime. `npm run build:deploy` excludes only these
release-backed roots:

- `/stages/official/`
- `/enemies/models/`
- `/vfx/enemy/`
- `/vfx/character/`

The resulting Pages payload is checked to remain below 1 GiB.

## Publication contract

The production workflow deploys the verified website artifact. The deployment
mainline becomes the repository default only after all of these gates pass:

1. 581 official scene products are catalog-visible.
2. 493 unique enemy models and thumbnails are catalog-visible.
3. 443 enemy and 211 character target VFX products are catalog-visible; any
   authority-limited product remains explicitly fail-closed.
4. Tests, type checking, clean-clone build and isolated runtime preview pass.
5. The previous default branch and Pages configuration are recorded, and the
   post-cutover repository homepage, default clone branch and Pages URL are
   reopened and verified.

GitHub fork-network detachment is a separate platform operation from deleting a
local Git remote; the two states are verified independently.
