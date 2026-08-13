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

assert.match(
    source,
    /textureWrap\?: 'repeat' \| 'clamp' \| 'mirror'/,
    'serialized Unity texture wrapping must be represented explicitly',
)
assert.match(
    source,
    /texture\.wrapS = wrappingByName\[wrap\][\s\S]*?texture\.wrapT = wrappingByName\[wrap\]/,
    'material binding must apply the authored wrap mode on both UV axes',
)
assert.match(
    source,
    /const cacheKey = `\$\{kind\}:\$\{wrap\}:/,
    'texture cache identity must include wrap mode',
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

console.log('Official stage material ownership invariants passed.')
