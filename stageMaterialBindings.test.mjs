import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(
    new URL('./src/viewer/stageMaterialBindings.ts', import.meta.url),
    'utf8',
)

assert.match(
    source,
    /const retainedTextures = collectObjectMaterialTextures\(object\)/,
    'material replacement must inventory textures still owned by the stage',
)
assert.match(
    source,
    /value instanceof THREE\.Texture && !retainedTextures\.has\(value\)/,
    'a replaced material must preserve shared textures that remain referenced',
)
assert.doesNotMatch(
    source,
    /sourceMaterialsToDispose\.forEach\(disposeMaterialAndTextures\)/,
    'source material cleanup must not blindly dispose shared textures',
)

assert.match(
    source,
    /additive:\s*THREE\.AdditiveBlending/,
    'serialized additive background materials must retain additive blending',
)
assert.match(
    source,
    /interface StageFlowMapProfile[\s\S]*?textureUrl:[\s\S]*?speed:[\s\S]*?power\?:/,
    'the recovered bg_uber flow-map fields must be represented explicitly',
)
assert.match(
    source,
    /approximation:\s*'two-phase-directional-advection'/,
    'the Web flow approximation must remain inspectable instead of being presented as exact',
)
assert.match(source, /uniform sampler2D uStageFlowMap;/)
assert.match(source, /rdStageFlowPhase0/)
assert.match(source, /rdStageFlowPhase1/)
assert.match(source, /rdStageFlowBlend/)

const textureBindingStart = source.indexOf('export interface StageTextureBinding')
const textureBindingEnd = source.indexOf('export interface StageTextureSet')
assert.ok(textureBindingStart >= 0 && textureBindingEnd > textureBindingStart)
const textureBindingContract = source.slice(textureBindingStart, textureBindingEnd)

assert.match(
    textureBindingContract,
    /coordinates:[\s\S]*?kind: 'mesh-uv', channel: 0 \| 1 \| 2 \| 3[\s\S]*?kind: 'view-normal'/,
    'each texture slot must declare its recovered coordinate source and UV channel',
)
assert.match(
    textureBindingContract,
    /transform:\s*\{[\s\S]*?scale: \[number, number\][\s\S]*?offset: \[number, number\][\s\S]*?\}/,
    'each texture slot must retain the serialized Unity Material TexEnv scale and offset',
)
assert.match(
    textureBindingContract,
    /wrap:\s*\{[\s\S]*?u: StageTextureWrap[\s\S]*?v: StageTextureWrap[\s\S]*?\}/,
    'each texture slot must retain independent Texture2D U and V wrap modes',
)
assert.match(
    textureBindingContract,
    /evidence: 'exact-unity-texture2d' \| 'legacy-default'/,
    'texture descriptors must expose whether their values are exact or compatibility defaults',
)
assert.match(
    source,
    /export interface StageTextureSet[\s\S]*?base\?: StageTextureBinding[\s\S]*?normal\?: StageTextureBinding[\s\S]*?smoothness\?: StageTextureBinding[\s\S]*?blend\?: StageTextureBinding[\s\S]*?matCap\?: StageTextureBinding/,
    'material bindings must carry independent descriptors for every authored texture slot',
)
assert.match(
    source,
    /texture\.wrapS = wrappingByName\[profile\.wrap\.u\][\s\S]*?texture\.wrapT = wrappingByName\[profile\.wrap\.v\]/,
    'runtime texture setup must apply authored U and V wrap modes independently',
)
assert.match(
    source,
    /texture\.repeat\.set\(\.\.\.profile\.transform\.scale\)[\s\S]*?texture\.offset\.set\(\.\.\.profile\.transform\.offset\)/,
    'runtime texture setup must apply the exact Material TexEnv transform',
)
assert.match(
    source,
    /profile\.coordinates\.kind === 'mesh-uv'[\s\S]*?texture\.channel = profile\.coordinates\.channel/,
    'runtime texture setup must select the recovered mesh UV channel',
)
assert.match(
    source,
    /const cacheKey = JSON\.stringify\(\{\s*absoluteUrl,\s*\.\.\.profile\s*\}\)/,
    'texture cache identity must include the complete per-slot descriptor',
)
assert.doesNotMatch(
    source,
    /const cacheKey = `\$\{kind\}:\$\{wrap\}:/,
    'the legacy kind/wrap/url cache key must not merge distinct exact descriptors',
)
assert.match(
    source,
    /if \(exact\) \{[\s\S]*?validateStageTextureBinding\(exact, binding, slot\)[\s\S]*?return exact/,
    'every exact per-slot descriptor must pass the strict evidence validator',
)
assert.match(
    source,
    /profile\.evidence !== 'exact-unity-texture2d'[\s\S]*?throw new Error\(`Official stage texture \$\{label\}\/\$\{slot\} is not exact Unity evidence`\)/,
    'a claimed exact texture path must fail closed when its evidence marker is not exact',
)

assert.match(source, /uniform mat3 uStageBlendMapTransform;/)
assert.match(source, /varying vec2 vStageBlendMapUv;/)
assert.match(
    source,
    /uStageBlendMapTransform \* vec3\( \$\{blendUvAttribute\}, 1\.0 \)/,
    'the blend map must use its own UV channel and transform in the vertex shader',
)
assert.match(
    source,
    /texture2D\( uStageBlendMap, vStageBlendMapUv \)/,
    'the blend map must sample its independently transformed varying',
)
assert.doesNotMatch(
    source,
    /texture2D\( uStageBlendMap, vMapUv \)/,
    'the blend map must not silently inherit the base-map UV transform',
)

assert.match(
    source,
    /stageAtlasSourceTransform\s*=\s*\{[\s\S]*?scale: \[source\.repeat\.x, source\.repeat\.y\][\s\S]*?offset: \[source\.offset\.x, source\.offset\.y\]/,
    'atlas setup must preserve the source Material TexEnv transform',
)
assert.match(
    source,
    /function composeStageAtlasTransform\([\s\S]*?source\.scale\[0\] \/ atlas\.columns[\s\S]*?source\.scale\[1\] \/ atlas\.rows[\s\S]*?source\.offset\[0\] \+ column[\s\S]*?source\.offset\[1\] \+ atlas\.rows - row - 1/,
    'atlas frame selection must compose with source scale and offset rather than overwrite them',
)
assert.match(
    source,
    /const transform = composeStageAtlasTransform\([\s\S]*?texture\.repeat\.set\(\.\.\.transform\.scale\)[\s\S]*?texture\.offset\.set\(\.\.\.transform\.offset\)/,
    'atlas runtime updates must install the composed source-plus-frame transform',
)
assert.doesNotMatch(
    source,
    /texture\.repeat\.set\(1 \/ atlas\.columns, 1 \/ atlas\.rows\)/,
    'atlas setup must not replace the official source scale with a frame-only transform',
)
assert.match(
    source,
    /stageBlendWeightLinear <= 0\.0031308[\s\S]*?1\.055 \* pow\( stageBlendWeightLinear, 1\.0 \/ 2\.4 \) - 0\.055/,
    'FBX sRGB vertex-colour conversion must be inverted for raw blend weights',
)
assert.match(
    source,
    /if \(map\) common\.map = map/,
    'untextured official materials must omit an undefined map constructor parameter',
)
assert.match(
    source,
    /if \(textures\.normalMap\) standardParameters\.normalMap = textures\.normalMap/,
    'materials without an official normal map must omit the undefined parameter',
)

const rawWeight = 77 / 255
const loaderLinearWeight = rawWeight <= 0.04045
    ? rawWeight / 12.92
    : ((rawWeight + 0.055) / 1.055) ** 2.4
const recoveredWeight = loaderLinearWeight <= 0.0031308
    ? loaderLinearWeight * 12.92
    : 1.055 * loaderLinearWeight ** (1 / 2.4) - 0.055
assert.ok(
    Math.abs(recoveredWeight - rawWeight) < 1e-7,
    `raw vertex blend weight must round-trip (expected ${rawWeight}, got ${recoveredWeight})`,
)

console.log('Official stage material descriptor and ownership invariants passed.')
