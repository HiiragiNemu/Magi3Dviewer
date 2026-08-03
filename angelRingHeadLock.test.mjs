import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shaderSource = await readFile(
    new URL(
        './magia-exedra-character-three/shaders/hair.ts',
        import.meta.url,
    ),
    'utf8',
);

assert.match(
    shaderSource,
    /vAngelRingFaceClip/,
    'AngelRing must be anchored to projected FacePositionWS',
);
assert.match(
    shaderSource,
    /gl_FragCoord\.xy\s*\/\s*max\(uAngelRingViewportSize/,
    'official projection must use fragment screen position',
);
assert.match(
    shaderSource,
    /uAngelRingAspectFix\.value\.set\(height \/ width, 1\)/,
    'portrait-safe AngelRing projection must use inverse display aspect',
);
assert.doesNotMatch(
    shaderSource,
    /uAngelRingAspectFix\.value\.set\(width \/ height, 1\)/,
    'width / height collapses AngelRing horizontally on portrait screens',
);
assert.match(
    shaderSource,
    /mat3\(viewMatrix\) \* uAngelRingFaceUp/,
    'Head Up must be transformed into view space',
);
assert.match(
    shaderSource,
    /rdAngelBackFactor \*\s*rdAngelBackFactor \*\s*15\.0/,
    'missing official continuous front/back projection shift',
);
assert.match(
    shaderSource,
    /sin\(\s*rdAngelRotated\.x \*\s*3\.14159265358979323846/,
    'AngelRing must use the official sin(pi * U) tapered arch',
);
assert.match(
    shaderSource,
    /rdAngelArch \* 0\.414999992/,
    'missing official lower AngelRing curve coefficient',
);
assert.doesNotMatch(
    shaderSource,
    /rdAngelViewGate|rdAngelFrontHemisphereGate/,
    'official 360-degree AngelRing must not kill front or rear views',
);
assert.match(
    shaderSource,
    /uHairDepthRimEnabled/,
    'official hair materials need an independent soft depth-rim path',
);
assert.match(
    shaderSource,
    /mix\(0\.15, 1\.0, rdHairLightSide\)/,
    'hair edge reflection must remain asymmetric and light-directed',
);
assert.match(
    shaderSource,
    /if \(uAngelRingUvMode > 0\.5\)/,
    'character-authored UV AngelRing mode must remain intact',
);

// Recovered map-shape coefficients: the center arch has a wider upper than
// lower reach, and both converge to zero at U=0/1.
const ringShape = u => {
    const arch = Math.sin(u * Math.PI);
    return { lower: -arch * 0.414999992, upper: arch * 0.5 };
};
assert.deepEqual(ringShape(0), { lower: -0, upper: 0 });
assert.ok(ringShape(0.5).lower < 0);
assert.ok(ringShape(0.5).upper > 0);
assert.ok(Math.abs(ringShape(1).lower) < 1e-7);
assert.ok(Math.abs(ringShape(1).upper) < 1e-7);

assert.match(
    shaderSource,
    /rdAngelProjectedUpLength\s*=\s*length\(rdAngelProjectedUp\)/,
    'projected Head Up must be measured in two-dimensional screen space',
);
assert.match(
    shaderSource,
    /rdAngelProjectedUp\s*\/\s*rdAngelProjectedUpLength/,
    'projected Head Up must be normalized before rotating AngelRing coordinates',
);
assert.match(
    shaderSource,
    /rdAngelProjectedRight\s*=\s*vec2\(/,
    'AngelRing must derive an orthonormal projected right axis',
);

console.log('Official AngelRing projection invariants passed.');
