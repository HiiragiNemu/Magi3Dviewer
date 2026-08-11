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

console.log('Official stage material ownership invariants passed.')
