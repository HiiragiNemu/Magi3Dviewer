import fs from 'node:fs';
import assert from 'node:assert/strict';

const stylization = fs.readFileSync(
  'magia-exedra-character-three/shaders/stylization.ts',
  'utf8',
);
const gem = fs.readFileSync(
  'magia-exedra-character-three/shaders/gem.ts',
  'utf8',
);

// Current-JP generic Fresnel arithmetic recovered from the compiled
// Creative/Character/ReDriveToon executable. The remaining Fresnel coordinate
// provenance is intentionally not called exact here; this gate covers the
// proven threshold/mask/interpolation structure only.
for (const token of [
  'rdToonEdge * rdToonFresnelMetallicScale',
  'float rdToonFresnelCenter = 1.0 - uFresnelThreshold;',
  'rdToonFresnelCenter - uFresnelFeather * 0.5',
  'rdToonFresnelCenter + uFresnelFeather * 0.5',
  'rdToonFresnelT * rdToonFresnelT',
  '(3.0 - 2.0 * rdToonFresnelT)',
]) assert.ok(stylization.includes(token), `missing Fresnel parity token: ${token}`);
assert.ok(!stylization.includes('uFresnelThreshold - uFresnelFeather,'));
assert.ok(!stylization.includes('uFresnelThreshold + uFresnelFeather,'));

// Current-JP MatCap combination is fully recovered: low branch base*matcap,
// high branch 1-2*(1-base)*(1-matcap), then serialized intensity and masks
// interpolate/extrapolate from the original base.
for (const token of [
  'vec3 rdGemMatCapLow = rdGemMatCap * rdGemBase;',
  '(vec3(1.0) - rdGemBase) *',
  '(vec3(1.0) - rdGemMatCap) * 2.0;',
  'step(vec3(0.5), rdGemBase)',
  'uGemMatCapIntensity * rdGemMatCapMask',
  '(rdGemMatCapBlend - rdGemBase)',
]) assert.ok(gem.includes(token), `missing MatCap parity token: ${token}`);
assert.ok(!gem.includes('rdGemMatCapLuma'));
assert.ok(!gem.includes('rdGemMatCapMask * 0.34'));

console.log('proven ReDrive executable formula source gate passed');
