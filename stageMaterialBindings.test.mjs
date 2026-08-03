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

console.log('Official stage material ownership invariants passed.')
