import fs from 'node:fs';
import assert from 'node:assert/strict';

const catalog = JSON.parse(fs.readFileSync(
  'public/stages/catalog/battle-608-00-00-001.json',
  'utf8',
));

const byName = new Map(catalog.materialBindings.map(binding => [binding.materialName, binding]));
for (const name of [
  'mt_bg3d608_00_red_violinCol',
  'mt_bg3d608_00_red_violinShdLine',
]) {
  const binding = byName.get(name);
  assert.ok(binding, `missing 608 violin binding ${name}`);
  assert.deepEqual(binding.atlas, {
    columns: 4,
    rows: 4,
    offset: 0,
    framesPerSecond: 8,
  }, `${name} must match current-JP _FLIPBOOK material properties`);
  assert.equal(binding.alphaTest, 0.5);
}

// AlphaToMask, ZWrite, Surface and Cull intentionally belong to the separate
// current-JP render-state gate because the two violin materials differ there.
const source = fs.readFileSync('src/viewer/stageMaterialBindings.ts', 'utf8');
for (const token of [
  'texture.repeat.set(1 / atlas.columns, 1 / atlas.rows)',
  'Math.floor(',
  '* framesPerSecond',
  '(frameOffset + elapsedFrame) % frameCount',
]) assert.ok(source.includes(token), `stage atlas runtime missing ${token}`);

console.log('608 current-JP violin flipbook profile gate passed');
