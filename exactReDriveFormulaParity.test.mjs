import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  calculateReDriveParaffinFactor,
  reDriveBlendChannel,
} from './magia-exedra-character-three/scene/reDriveParaffin.ts';

const stylization = fs.readFileSync(
  'magia-exedra-character-three/shaders/stylization.ts',
  'utf8',
);
const gem = fs.readFileSync(
  'magia-exedra-character-three/shaders/gem.ts',
  'utf8',
);
const general = fs.readFileSync(
  'magia-exedra-character-three/shaders/general.ts',
  'utf8',
);

// Shader Graphs/ReDrivePostProcess D3D11 fragment variants 69/89/93.
assert.ok(Math.abs(reDriveBlendChannel(0.25, 0.8, 0) - 0.85) < 1e-12)
assert.ok(Math.abs(reDriveBlendChannel(0.25, 0.8, 1) - 0.2) < 1e-12)
assert.ok(Math.abs(reDriveBlendChannel(0.25, 0.8, 2) - 0.4) < 1e-12)
assert.ok(Math.abs(reDriveBlendChannel(0.25, 0.8, 3) - 0.7) < 1e-12)
assert.equal(calculateReDriveParaffinFactor({
  uv: [0.5, 0.5],
  globalMainLightDirectionVS: [0, 0, -1],
  useFixedLightDirection: true,
  width: 1.4,
}), 1)
assert.equal(calculateReDriveParaffinFactor({
  uv: [0.5, 0.5],
  globalMainLightDirectionVS: [0, 0, -1],
  useFixedLightDirection: false,
  width: 2,
}), 0.5)
assert.ok(Math.abs(calculateReDriveParaffinFactor({
  uv: [1, 1],
  globalMainLightDirectionVS: [0, 1, 0],
  useFixedLightDirection: false,
  width: 2,
}) - Math.SQRT1_2 / 2) < 1e-12)

// Current-JP generic Fresnel arithmetic and light carrier recovered from the
// compiled Creative/Character/ReDriveToon executable.
for (const token of [
  '(1.0 - rdToonFresnelNdotV) *',
  'float rdToonFresnelCenter = 1.0 - uFresnelThreshold;',
  'rdToonFresnelCenter - uFresnelFeather * 0.5',
  'rdToonFresnelCenter + uFresnelFeather * 0.5',
  'rdToonFresnelT * rdToonFresnelT',
  '(3.0 - 2.0 * rdToonFresnelT)',
  'rdToonSceneLightColor *',
  '(rdToonBaseWeight * 0.800000012 + 0.200000003)',
  'rdToonFresnelSceneCarrier *',
  'uFresnelColor *',
]) assert.ok(general.includes(token), `missing Fresnel parity token: ${token}`);
assert.ok(!general.includes('uFresnelThreshold - uFresnelFeather,'));
assert.ok(!general.includes('uFresnelThreshold + uFresnelFeather,'));
assert.ok(!stylization.includes('outgoingLight +=\n            uFresnelColor *'));

// Current-JP MatCap combination is fully recovered: low branch 2*base*matcap,
// high branch 1-2*(1-base)*(1-matcap), then serialized intensity and masks
// interpolate/extrapolate from the original base.
for (const token of [
  'rdGemMatCap * rdMatCapBase * 2.0;',
  '(vec3(1.0) - rdMatCapBase) *',
  '(vec3(1.0) - rdGemMatCap) * 2.0;',
  'vec3(1.0) - step(rdMatCapBase, vec3(0.5))',
  'uMaterialMatCapIntensity *',
  '(rdMatCapBlend - rdMatCapBase)',
]) assert.ok(gem.includes(token), `missing MatCap parity token: ${token}`);
assert.ok(!gem.includes('rdGemMatCapLuma'));
assert.ok(!gem.includes('rdGemMatCapMask * 0.34'));
assert.ok(!gem.includes('step(vec3(0.5), rdGemBase)'));
assert.ok(!gem.includes('step(vec3(0.5), rdMatCapBase)'));

// JP 2022.3.62f2 main_gem blob 95: view-space folded normal, two
// half-vector coordinates, hard step bands and ShadowTex selection.
for (const token of [
  'rdGemHalfOneVs = normalize(rdGemViewVs + rdGemLightVs)',
  'rdGemHalfOneVs + vec3(0.0, 0.0, 2.0)',
  '-rdGemNormalVs.x,',
  '-rdGemNormalVs.y + uGemHeightCorrection,',
  '0.660000026 -',
  '0.340000004 * uGemFirstShadowSize',
  '0.933000028 -',
  '0.0670000017 * uGemSecondShadowSize',
  '1.0 - rdGemMiddleBand +',
  'rdGemRimShadow +',
  'rdGemDepthSelector',
  'rdToonShadowColor * uGlobalCharacterShadowTint,',
  '0.966000021 -',
  '0.0350000001 * uGemFirstHighlightSize',
  '0.997500002 -',
  '0.00300000003 * uGemSecondHighlightSize',
  'rdGemShadowSelector * 0.800000012 +',
  'rdGemHardHighlightMask *',
  'diffuseColor.a + rdGemDepthSelector',
]) assert.ok(gem.includes(token), `missing blob-95 Gem token: ${token}`)

const selectorIndex = gem.indexOf('rdGemShadowSelector = saturate(')
const matCapIndex = gem.indexOf('vec2 rdGemMatCapUv')
const generalHardNeedle = `                float rdHardSpecular =
                    step(0.966000021, rdNdotH) *
                    rdToonSpecularMask *
                    (1.0 - step(0.5, uMaterialAnisotropy));`
const generalGradientNeedle = '                #ifdef HAS_SPECULAR_GRADIENT'
assert.ok(general.includes(generalHardNeedle), 'missing unique hard-spec replacement target')
assert.ok(gem.includes(generalHardNeedle), 'Gem injector must target the general hard-spec block')
assert.ok(general.includes(generalGradientNeedle), 'missing unique gradient insertion target')
const preLightMarkerIndex = general.indexOf('// END diffuseColor manipulation')
const lightCarrierIndex = general.indexOf(
  'outgoingLight = diffuseColor.rgb * rdToonSceneLightColor',
)
const hardHighlightIndex = gem.indexOf('vec3 rdGemLightCarrier')
const gradientMarkerIndex = gem.indexOf("'                #ifdef HAS_SPECULAR_GRADIENT'")
assert.ok(
  selectorIndex >= 0 && selectorIndex < matCapIndex,
  'Gem ShadowTex selector must execute before MatCap',
)
assert.ok(
  preLightMarkerIndex >= 0 && preLightMarkerIndex < lightCarrierIndex,
  'Gem MatCap must execute before SH/main-light multiplication',
)
assert.ok(
  gradientMarkerIndex >= 0 && gradientMarkerIndex < hardHighlightIndex,
  'Gem hard highlight must replace the pre-SpecularGradient marker',
)
assert.doesNotMatch(
  gem.slice(hardHighlightIndex),
  /rdToonSpecularMask/,
  'blob-95 Gem hard bands do not use Control B',
)

for (const obsolete of [
  'rdGemHeight',
  'rdGemFirstCenter',
  'rdGemSecondCenter',
  'rdGemFirstWidth',
  'rdGemSecondWidth',
  'rdGemHighlightOne',
  'rdGemHighlightTwo',
  'rdGemShadowOne',
  'rdGemShadowTwo',
  'rdGemInternal',
  'rdGemDepthSelectedBase * 0.68',
  'rdGemBase *= 0.84',
  'rdGemFresnelBand',
  '0.72',
]) assert.ok(!gem.includes(obsolete), `obsolete approximate Gem token: ${obsolete}`)

const step = (edge, value) => value >= edge ? 1 : 0
const blob95GemBands = ({
  g1,
  g2,
  ndotv,
  depth = 0,
  rimFresnel = 0.5,
  firstShadow = 0,
  secondShadow = 0,
  firstHighlight = 0,
  secondHighlight = 0,
}) => {
  const shadowOne = 0.660000026 - 0.340000004 * firstShadow
  const shadowTwo = 0.933000028 - 0.0670000017 * secondShadow
  const middle = Math.max(step(shadowOne, g1) - step(shadowTwo, g2), 0)
  const shadowSelector = Math.min(Math.max(
    1 - middle + step(rimFresnel, 1 - ndotv) + depth,
    0,
  ), 1)
  const highlightOne = 0.966000021 - 0.0350000001 * firstHighlight
  const highlightTwo = 0.997500002 - 0.00300000003 * secondHighlight
  const hardHighlight = Math.min(
    step(highlightOne, g1) + step(highlightTwo, g2),
    1,
  )
  return { shadowSelector, hardHighlight }
}
assert.deepEqual(
  blob95GemBands({ g1: 0.7, g2: 0.9, ndotv: 1 }),
  { shadowSelector: 0, hardHighlight: 0 },
)
assert.deepEqual(
  blob95GemBands({ g1: 0.7, g2: 0.95, ndotv: 1 }),
  { shadowSelector: 1, hardHighlight: 0 },
)
assert.deepEqual(
  blob95GemBands({ g1: 0.97, g2: 0.99, ndotv: 1 }),
  { shadowSelector: 1, hardHighlight: 1 },
)
assert.equal(
  blob95GemBands({ g1: 0.7, g2: 0.9, ndotv: 0 }).shadowSelector,
  1,
)

// main_hair blob 98 hard highlight and RGB SpecularGradient Overlay.
for (const token of [
  'step(0.966000021, rdNdotH)',
  'rdToonSpecularMask *',
  '(1.0 - step(0.5, uMaterialAnisotropy))',
  'vec2(rdNdotH, rdNdotH)',
  ').rgb;',
  'outgoingLight * rdSpecularGradient * 2.0;',
  '(vec3(1.0) - rdSpecularGradient) * 2.0;',
  'rdToonMetallicMask * rdSpecularFresnelGate',
]) assert.ok(
  general.includes(token),
  `missing SpecularGradient parity token: ${token}`,
);
assert.ok(!general.includes('rdSpecularGradient = pow('));
assert.ok(!general.includes('vec2(rdNdotH, 0.5)\n                    ).r'));
assert.ok(!general.includes('step(vec3(0.5), outgoingLight)'));

// Official character lighting is Unity SH (27 coefficients) plus the main
// directional colour. Three's aggregate `irradiance` also includes every
// HemisphereLight, which would reintroduce a smooth normal gradient after the
// zero-feather hard Base/Shadow selection. Ambient is the direction-independent
// fallback; a Three LightProbe is the direct SH carrier when present.
for (const token of [
  'getAmbientLightIrradiance(ambientLightColor)',
  '#if defined(USE_LIGHT_PROBES)',
  'getLightProbeIrradiance(',
  'lightProbe,',
  'normal',
]) assert.ok(
  general.includes(token),
  `missing official character-light carrier token: ${token}`,
);
assert.ok(!general.includes('rdToonAmbientColor = irradiance'));

const anisoIndex = general.indexOf('outgoingLight += rdAnisoColor')
const hardIndex = general.indexOf('float rdHardSpecular')
const gradientIndex = general.indexOf('vec3 rdSpecularGradient')
const overlayIndex = general.indexOf('(rdSpecularOverlay - outgoingLight)')
const emissionIndex = general.indexOf(
  'outgoingLight +=\n                totalEmissiveRadiance',
)
assert.ok(
  anisoIndex >= 0 && anisoIndex < hardIndex &&
  hardIndex < gradientIndex && gradientIndex < overlayIndex &&
  overlayIndex < emissionIndex,
  'compiled material order must be Aniso -> hard spec -> RGB Overlay -> emission',
)

const overlay = (base, gradient) => base.map((value, index) => (
  value <= 0.5
    ? 2 * value * gradient[index]
    : 1 - 2 * (1 - value) * (1 - gradient[index])
))
assert.deepEqual(overlay([0.25, 0.5, 0.75], [0.2, 0.4, 0.8]), [0.1, 0.4, 0.9])
const hardSpec = (ndoth, controlB, isAniso) => (
  (ndoth >= 0.966000021 ? 1 : 0) * controlB * (isAniso ? 0 : 1)
)
assert.equal(hardSpec(0.965999, 0.7, false), 0)
assert.equal(hardSpec(0.966000021, 0.7, false), 0.7)
assert.equal(hardSpec(1, 0.7, true), 0)

console.log('proven ReDrive executable formula source gate passed');
