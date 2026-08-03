# Portrait AngelRing orientation repair

Release source: `43aa93c2b2036b6d4943d2ce9659468d1dbf4a55`

This release normalizes the Head Up vector after projection into two-dimensional screen space. The previous implementation used the unnormalized XY components of a normalized three-dimensional vector, which could scale and clip the AngelRing texture into a diagonal stripe when the character head was pitched, especially in portrait mobile viewports.

The release gate now records the changed-pixel covariance and rejects AngelRing output whose principal axis is excessively tilted or whose diagonal correlation is too high. Desktop and 698 x 1536 portrait WebGL checks must both pass before GitHub Pages deployment.

The release also retains the zero-vulnerability dependency audit and production chunk budgets introduced in the preceding maintenance release.
