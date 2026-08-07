# Stage 608 current-JP Texture2D parity gate

Status: P0.3 phase 2, stacked on `fix/stage-608-chair-alpha-cutout-20260807`.

Authoritative source: current JP, AssetBundle revision `61ad830ca038a9efd58e67170a61c85e`.

Bounded research evidence established before this branch:

- stage Material comparisons: 15;
- BaseMap pixel mismatches against release `magius3dviewer`: 13;
- exact orientation-only matches among those mismatches: 0;
- content mismatches: 13;
- unresolved current-JP texture pointers: 0.

This branch may replace only Viewer PNGs whose decoded pixel content fails current-JP parity. CI must fail closed if multiple Materials sharing one Viewer URL resolve to different official Texture2D pixels.

Privacy boundary: raw JP AssetBundle bytes stay transient in CI and are never committed. Public commits may contain only the individual decoded Texture2D files already needed by the Viewer plus compact hash/provenance evidence.

Acceptance gates: exact pixel parity rerun, release tests, TypeScript/Vite production build, strict WebGL smoke, then fixed manual regression at 1600x900 with character `100107` + `battle-608-00-00-001`; `600-00-00-001` must not regress.

This phase does not claim full `shader/bg_uber`, Unity render-queue, ReflectionProbe, lightmap or dynamic-component parity.
