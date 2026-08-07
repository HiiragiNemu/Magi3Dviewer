import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'magia-exedra-character-three/scene/selfShadow.ts',
  'utf8',
);
const general = fs.readFileSync(
  'magia-exedra-character-three/shaders/general.ts',
  'utf8',
);
const face = fs.readFileSync(
  'magia-exedra-character-three/shaders/face.ts',
  'utf8',
);

test('current-JP receiver uses one hardware depth compare with native bias/range/NdotL structure', () => {
  for (const token of [
    'uniform sampler2DShadow tRdToonSelfShadowMap;',
    'shadowCoord = shadowCoord * 0.5 + 0.5;',
    'shadowCoord.z - uRdToonGlobalSelfShadowDepthBias',
    'float visibility = texture(',
    'vec3(shadowCoord.xy, compareDepth)',
    '(uRdToonSelfShadowRange - 2.0)',
    'visibility = mix(visibility, 1.0, rangeFade);',
    '(ndotl - 0.1) * 10.0',
    'ndotlT * ndotlT * (3.0 - 2.0 * ndotlT)',
    'return min(visibility, 1.0);',
  ]) assert.ok(source.includes(token), `missing native receiver token: ${token}`);

  assert.ok(!source.includes('visibility += step(compareDepth, texture2D('));
  assert.ok(!source.includes('return visibility * 0.25;'));
});

test('self-shadow depth texture uses native comparison sampling state', () => {
  assert.ok(source.includes('THREE.UnsignedShortType'));
  assert.ok(source.includes('depthTexture.minFilter = THREE.LinearFilter'));
  assert.ok(source.includes('depthTexture.magFilter = THREE.LinearFilter'));
  assert.ok(source.includes('depthTexture.compareFunction = THREE.LessEqualCompare'));
});

test('receiver NdotL fix gets view-space normal and light direction', () => {
  assert.match(
    source,
    /transformDirection\(this\.shadowCamera\.matrixWorld\)\s+\.transformDirection\(this\.scene\.camera\.matrixWorldInverse\)/,
  );
  for (const shader of [general, face]) {
    assert.match(
      shader,
      /rdToonSelfShadowVisibility\(\s*vRdToonWorldPosition,\s*normal\s*\)/,
    );
  }
});
