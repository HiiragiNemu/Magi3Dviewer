import fs from 'node:fs';
import assert from 'node:assert/strict';

const catalog = JSON.parse(fs.readFileSync(
  'public/stages/catalog/battle-608-00-00-001.json',
  'utf8',
));
const byName = new Map(catalog.materialBindings.map(x => [x.materialName, x]));

const expected = {
  bg3d608_00_blue_ChairCD: {
    transparent: true, depthWrite: false, side: 'front', alphaToCoverage: false,
  },
  mt_bg3d608_00_red_MusicNoteA: {
    transparent: false, depthWrite: true, side: 'front', alphaToCoverage: true,
  },
  mt_bg3d608_00_red_MusicNoteB: {
    transparent: false, depthWrite: true, side: 'front', alphaToCoverage: false,
  },
  mt_bg3d608_00_red_MusicNoteC: {
    transparent: false, depthWrite: true, side: 'front', alphaToCoverage: false,
  },
  mt_bg3d608_00_red_violinCol: {
    transparent: false, depthWrite: true, side: 'front', alphaToCoverage: true,
  },
  mt_bg3d608_00_red_violinShdLine: {
    transparent: true, depthWrite: false, side: 'front', alphaToCoverage: false,
  },
};

for (const [name, states] of Object.entries(expected)) {
  const binding = byName.get(name);
  assert.ok(binding, `missing ${name}`);
  for (const [key, value] of Object.entries(states)) {
    assert.equal(binding[key], value, `${name}.${key}`);
  }
}

for (const name of [
  'mt_bg3d608_00_red_violinCol',
  'mt_bg3d608_00_red_violinShdLine',
]) {
  assert.deepEqual(byName.get(name).atlas, {
    columns: 4, rows: 4, offset: 0, framesPerSecond: 8,
  });
}

const runtime = fs.readFileSync('src/viewer/stageMaterialBindings.ts', 'utf8');
assert.ok(runtime.includes('depthWrite?: boolean'));
assert.ok(runtime.includes('depthWrite: binding.depthWrite ?? true'));

console.log('608 current-JP render-state gate passed');
