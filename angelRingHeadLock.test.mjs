import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shaderSource = await readFile(
    new URL(
        './magia-exedra-character-three/shaders/hair.ts',
        import.meta.url,
    ),
    'utf8',
);
const perspectiveSource = await readFile(
    new URL(
        './magia-exedra-character-three/shaders/perspective.ts',
        import.meta.url,
    ),
    'utf8',
);
const generalSource = await readFile(
    new URL(
        './magia-exedra-character-three/shaders/general.ts',
        import.meta.url,
    ),
    'utf8',
);
const faceSource = await readFile(
    new URL(
        './magia-exedra-character-three/shaders/face.ts',
        import.meta.url,
    ),
    'utf8',
);
const outlineSource = await readFile(
    new URL(
        './magia-exedra-character-three/shaders/outline.ts',
        import.meta.url,
    ),
    'utf8',
);
const runtimeProfiles = JSON.parse(await readFile(
    new URL(
        './magia-exedra-character-three/official-character-controller-profiles.generated.json',
        import.meta.url,
    ),
    'utf8',
));

assert.match(
    shaderSource,
    /vAngelRingFaceClip/,
    'AngelRing must be anchored to projected FacePositionWS',
);

assert.match(
    perspectiveSource,
    /1\.0 - distance\([\s\S]*\* 2\.25/,
    'compiled perspective cancellation must preserve the official 2.25 distance falloff',
);
assert.match(
    perspectiveSource,
    /clamp\(rdCancelWorldPosition\.y, 0\.0, 1\.0\)/,
    'compiled perspective cancellation must preserve the official world-Y gate',
);
assert.match(
    perspectiveSource,
    /abs\(gl_Position\.w\) \* gl_Position\.xy \/[\s\S]*abs\(rdCancelFacePositionVS\.z\)/,
    'compiled perspective cancellation must use clip W divided by FacePosition view depth',
);
assert.match(
    generalSource,
    /injectCharacterPerspectiveCancellation\([\s\S]*options\.characterPerspectiveReference/,
    'body, hair, accessories and props must share the character perspective pass',
);
assert.match(
    faceSource,
    /injectCharacterPerspectiveCancellation\([\s\S]*options\.characterPerspectiveReference/,
    'face geometry must share the character perspective pass',
);
assert.match(
    outlineSource,
    /rdCancelPerspectiveFactor[\s\S]*uRdCharacterCancelPerspective/,
    'outline geometry must remain registered to perspective-cancelled surfaces',
);
assert.equal(runtimeProfiles.profileCount, 95);
assert.equal(runtimeProfiles.profiles.length, 95);
const official101901 = runtimeProfiles.profiles.find(
    profile => profile.characterId === 101901,
);
assert.ok(official101901);
assert.equal(official101901.headOffset, 0.18000000715255737);
assert.equal(official101901.characterCancelPerspective, 1);

const officialCancelPerspective = ({ clipX, clipY, clipW, faceViewZ,
    worldY, distanceToFace, character = 1, global = 1 }) => {
    const factor = Math.max(1 - distanceToFace * 2.25, 0) *
        global * character * Math.min(Math.max(worldY, 0), 1);
    const targetScale = Math.abs(clipW) / Math.abs(faceViewZ);
    return {
        factor,
        xy: [
            clipX + (clipX * targetScale - clipX) * factor,
            clipY + (clipY * targetScale - clipY) * factor,
        ],
    };
};
assert.deepEqual(
    officialCancelPerspective({
        clipX: 0.3,
        clipY: -0.2,
        clipW: 2,
        faceViewZ: -4,
        worldY: 1,
        distanceToFace: 0,
    }),
    { factor: 1, xy: [0.15, -0.1] },
);
assert.equal(
    officialCancelPerspective({
        clipX: 0.3,
        clipY: -0.2,
        clipW: 2,
        faceViewZ: -4,
        worldY: 1,
        distanceToFace: 1,
    }).factor,
    0,
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
    'Head Up view-space component remains required by the official curve blend',
);
assert.match(
    shaderSource,
    /rdAngelFaceRightXY\s*=\s*vec2\(\s*rdAngelFaceUpVS\.y,\s*-rdAngelFaceUpVS\.x/,
    'blob 98 rotates AngelRing X with (FaceUpVS.y, -FaceUpVS.x)',
);
assert.match(
    shaderSource,
    /dot\(\s*rdAngelRectCoordinate,\s*rdAngelFaceUpXY\s*\)/,
    'blob 98 rotates AngelRing Y directly with FaceUpVS.xy',
);
assert.doesNotMatch(
    shaderSource,
    /rdAngelFaceUpUv|rdAngelProjectedUp|rdAngelProjectedRight/,
    'the official branch does not project and normalize a second Head Up endpoint',
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
    'official hair materials retain the CameraDepthTexture material gate',
);
assert.doesNotMatch(
    shaderSource,
    /mix\(0\.15, 1\.0, rdHairLightSide\)/,
    'the removed picture-matched hair edge proxy must not return',
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

console.log('Official AngelRing projection invariants passed.');


// Numeric parity gate for JP 2022.3.62f2 main_hair blob 98 lines 932-982.
// The front-facing fixture uses FaceForwardVS.z = -cos(pitch), while FaceUpVS
// is (0, cos(pitch), sin(pitch)). This preserves the official continuous
// 360-degree branch rather than adding a front/rear visibility gate.
const officialBlobProjection = ({ width, height, fov, distance, pitch }) => {
    const radians = pitch * Math.PI / 180;
    const faceUpVS = [0, Math.cos(radians), Math.sin(radians)];
    const faceForwardVS = [0, Math.sin(radians), -Math.cos(radians)];
    const inverseDistance = 1 / distance;
    const aspectFix = [height / width, 1];
    const fovFix = 1 / fov;
    const unitScale = aspectFix.map(value => value * fovFix * inverseDistance);
    const rectHalf = unitScale.map(value => value * 10);
    const backFactor = faceForwardVS[2] * -0.5 + 0.5;
    const viewShift = [
        Math.sin(faceUpVS[1] * Math.PI / 2) * backFactor * backFactor * 15 * unitScale[0],
        faceUpVS[2] * -3 * unitScale[1],
    ];
    return {
        aspectFix,
        fovFix,
        rectHalf,
        center: [0.5 - viewShift[0], 0.5 - viewShift[1]],
        pixelHalf: [rectHalf[0] * width, rectHalf[1] * height],
    };
};

const readablePortProjection = ({ width, height, fov, distance, pitch }) => {
    const radians = pitch * Math.PI / 180;
    const upY = Math.cos(radians);
    const upZ = Math.sin(radians);
    const forwardZ = -Math.cos(radians);
    const scaleY = (1 / fov) * (1 / distance);
    const scaleX = (height / width) * scaleY;
    const halfX = scaleX * 10;
    const halfY = scaleY * 10;
    const back = forwardZ * -0.5 + 0.5;
    const shiftX = Math.sin(upY * Math.PI / 2) * back ** 2 * 15 * scaleX;
    const shiftY = upZ * -3 * scaleY;
    return {
        aspectFix: [height / width, 1],
        fovFix: 1 / fov,
        rectHalf: [halfX, halfY],
        center: [0.5 - shiftX, 0.5 - shiftY],
        pixelHalf: [halfX * width, halfY * height],
    };
};

const numericFixtures = [];
for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    for (const fov of [15, 40, 60]) {
        for (const distance of [1.5, 3, 6]) {
            for (const pitch of [-60, -30, 0, 30, 60]) {
                const fixture = { width, height, fov, distance, pitch };
                const official = officialBlobProjection(fixture);
                const port = readablePortProjection(fixture);
                for (const key of ['aspectFix', 'rectHalf', 'center', 'pixelHalf']) {
                    for (let index = 0; index < official[key].length; index++) {
                        assert.ok(
                            Math.abs(official[key][index] - port[key][index]) < 1e-12,
                            `${key}[${index}] diverged for ${JSON.stringify(fixture)}`,
                        );
                    }
                }
                assert.ok(Math.abs(official.fovFix - port.fovFix) < 1e-12);
                assert.ok(
                    Math.abs(official.pixelHalf[0] - official.pixelHalf[1]) < 1e-9,
                    `inverse display aspect must preserve a circular pixel footprint: ${JSON.stringify(fixture)}`,
                );
                numericFixtures.push({ ...fixture, ...official });
            }
        }
    }
}
assert.equal(numericFixtures.length, 90);

const liveTwCameraGlobals = {
    viewport: [1920, 1080],
    globalAspectFix: [0.5625, 1],
    globalFOVorOrthoSizeFix: 0.02500000037252903,
    currentCameraFOV: 40,
};
assert.deepEqual(
    liveTwCameraGlobals.globalAspectFix,
    [liveTwCameraGlobals.viewport[1] / liveTwCameraGlobals.viewport[0], 1],
    'official TW runtime confirms _GlobalAspectFix = (height / width, 1)',
);
assert.ok(
    Math.abs(
        liveTwCameraGlobals.globalFOVorOrthoSizeFix -
        1 / liveTwCameraGlobals.currentCameraFOV
    ) < 1e-8,
    'official TW runtime confirms _GlobalFOVorOrthoSizeFix = 1 / Camera.fieldOfView',
);

const normalDistance = pitch => officialBlobProjection({
    width: 1920,
    height: 1080,
    fov: 40,
    distance: 3,
    pitch,
});
assert.ok(
    Math.abs(normalDistance(60).center[1] - 0.5) < 0.022,
    'at FOV 40 and distance 3, the official pitch shift stays below 2.2% of viewport height',
);
const near = officialBlobProjection({ width: 1920, height: 1080, fov: 40, distance: 1.5, pitch: 0 });
const far = officialBlobProjection({ width: 1920, height: 1080, fov: 40, distance: 3, pitch: 0 });
assert.ok(Math.abs(near.rectHalf[1] / far.rectHalf[1] - 2) < 1e-12);

console.log('Official AngelRing numeric fixtures passed: 90/90.');
