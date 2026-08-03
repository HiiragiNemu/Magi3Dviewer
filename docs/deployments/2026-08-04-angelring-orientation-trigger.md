# Magius3Dviewer protected deployment trigger

Validate release source `be9ffe40e6fd7fa65b8f57fe288b39f233a75b59`, which contains the projected AngelRing axis normalization from `43aa93c2b2036b6d4943d2ce9659468d1dbf4a55`.

The protected deployment must pass:

- zero findings from `npm audit --audit-level=low`;
- all-character animation-family audit;
- release tests and chunked Vite production build without oversized-chunk warning;
- desktop WebGL runtime tests;
- 698 x 1536 portrait WebGL AngelRing tests, including principal-axis angle and diagonal-correlation limits;
- GitHub Pages publication.
