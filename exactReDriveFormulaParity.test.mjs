import fs from 'node:fs';
import assert from 'node:assert/strict';

const general = fs.readFileSync('magia-exedra-character-three/shaders/general.ts', 'utf8');
const stylization = fs.readFileSync('magia-exedra-character-three/shaders/stylization.ts', 'utf8');
const gem = fs.readFileSync('magia-exedra-character-three/shaders/gem.ts', 'utf8');

// Current-JP compiled Aniso: view-space XZ normalized-dot, metallic-shifted
// threshold, +/- feather and explicit cubic smoothstep.
for (const token of [
  'vec2 rdAnisoHalfXZ = rdHalfDirection.xz;',
  'vec2 rdAnisoNormalXZ = normal.xz;',
  '(1.00100005 - uMaterialAnisoThreshold)',
  'rdAnisoCenter - uMaterialAnisoFeather',
  'rdAnisoCenter + uMaterialAnisoFeather',
  'rdAnisoT * rdAnisoT * (3.0 - 2.0 * rdAnisoT)',
  '1.0 + uMaterialAnisoMaskByMetallic',
]) assert.ok(general.includes(token), `missing exact Aniso token: ${token}`);
assert.ok(!general.includes('dot(rdHalfDirection, rdAnisoTangent) * 0.52'));
assert.ok(!general.includes('rdSpecular *= mix(1.0, 1.22, rdAnisoInfluence)'));

// Current-JP generic Fresnel: metallic factor is applied to the edge input,
// center is 1-threshold, feather is +/- half, then cubic smoothstep.
for (const token of [
  'rdToonEdge * rdToonFresnelMetallicScale',
  'float rdToonFresnelCenter = 1.0 - uFresnelThreshold;',
  'rdToonFresnelCenter - uFresnelFeather * 0.5',
  'rdToonFresnelCenter + uFresnelFeather * 0.5',
  'rdToonFresnelT * rdToonFresnelT',
  '(3.0 - 2.0 * rdToonFresnelT)',
]) assert.ok(stylization.includes(token), `missing exact Fresnel token: ${token}`);

// Current-JP MatCap blend: low branch base*matcap, high branch
// 1-2*(1-base)*(1-matcap), then un-clamped intensity/mask interpolation.
for (const token of [
  'vec3 rdGemMatCapLow = rdGemMatCap * rdGemBase;',
  '(vec3(1.0) - rdGemBase) *',
  '(vec3(1.0) - rdGemMatCap) * 2.0;',
  'step(vec3(0.5), rdGemBase)',
  'uGemMatCapIntensity * rdGemMatCapMask',
  '(rdGemMatCapBlend - rdGemBase)',
]) assert.ok(gem.includes(token), `missing exact MatCap token: ${token}`);
assert.ok(!gem.includes('rdGemMatCapMask * 0.34'));

console.log('exact ReDrive formula parity source gate passed');
