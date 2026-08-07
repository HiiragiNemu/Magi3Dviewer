import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const stageId = 'battle-600-00-01-002';
const revision = '61ad830ca038a9efd58e67170a61c85e';
const companionPath = 'public/stages/official/battle-600-00-01-002/uv1-companion.json';

test('stage 600 profile opts into the exact current-JP UV1 companion', () => {
  const catalog = JSON.parse(read('public/stages/catalog.json'));
  const stages = catalog.stages.filter((stage) => stage.id === stageId);
  assert.equal(stages.length, 1);
  assert.equal(
    stages[0].renderProfile?.lightmap?.uv1CompanionUrl,
    './stages/official/battle-600-00-01-002/uv1-companion.json',
  );
});

test('stage 600 companion closes all 158 Three r182 mesh nodes', () => {
  const companion = JSON.parse(read(companionPath));
  assert.equal(companion.schemaVersion, 3);
  assert.equal(companion.stageId, stageId);
  assert.equal(companion.sourceRevision, revision);
  assert.equal(companion.nodes.length, 158);
  assert.equal(Object.keys(companion.geometries).length, 132);
  assert.match(companion.uvConvention, /CBA/);

  for (const node of companion.nodes) {
    assert.equal(typeof node.hierarchyPath, 'string');
    const geometry = companion.geometries[node.geometryKey];
    assert.ok(geometry, `missing geometry ${node.geometryKey}`);
  }
  for (const [key, geometry] of Object.entries(companion.geometries)) {
    const bytes = Buffer.from(geometry.uv1Base64, 'base64');
    assert.equal(
      bytes.length,
      geometry.vertexCount * 2 * 4,
      `wrong Float32 byte length for ${key}`,
    );
    assert.match(geometry.uv1Sha256, /^[0-9a-f]{64}$/);
  }
});

test('runtime restores uv1 before applyStageLightmaps and fails closed', () => {
  const stages = read('src/viewer/stages.ts');
  const helper = read('src/viewer/stageUv1Companion.ts');
  const uv1Apply = stages.indexOf('if (profileTextures.uv1Companion)');
  const lightmapApply = stages.indexOf(
    'if (profileTextures.lightmap && profileTextures.lightmapBindings)',
    uv1Apply,
  );
  assert.ok(uv1Apply >= 0);
  assert.ok(lightmapApply > uv1Apply);
  assert.match(stages, /applyStageUv1Companion\([\s\S]*?strict:\s*true/);
  assert.match(stages, /loadStageUv1Companion/);
  assert.match(helper, /geometry\.setAttribute\(\s*'uv1'/);
  assert.match(helper, /schemaVersion !== 3/);
  assert.match(helper, /assignments\.length !== companion\.nodes\.length/);
  assert.match(helper, /originalGeometry\.clone\(\)/);
});
