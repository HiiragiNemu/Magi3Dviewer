# Magius3Dviewer deployment

Magius3Dviewer is the independent ReDriveToon research build stored on the `magius3dviewer` branch. The fork's `main` branch remains aligned with the original upstream project.

The production build is generated with `npm ci` and `npm run build`, then deployed from `dist/` by the dedicated **Deploy Magius3Dviewer** workflow.

Planned website: https://hiiraginemu.github.io/Magi3Dviewer/

The website title and product identity are **Magius3Dviewer**. The GitHub Pages URL retains the repository path because the source repository remains `Magi3Dviewer`.

Current shader integration: ReDriveToon-compatible directional Rim light and optional Fresnel controls, forward-ported to the latest upstream material architecture.

Upstream attribution: https://github.com/haojiezhe12345/Magi3Dviewer
