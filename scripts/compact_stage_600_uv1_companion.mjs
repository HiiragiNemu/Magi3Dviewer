import fs from 'node:fs';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
  throw new Error('usage: compact_stage_600_uv1_companion.mjs <input> <output>');
}

const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (source.schemaVersion !== 2 || source.stageId !== 'battle-600-00-01-002') {
  throw new Error(`Unexpected UV1 companion source: schema=${source.schemaVersion} stage=${source.stageId}`);
}
if (!source.geometries || !Array.isArray(source.nodes) || source.nodes.length !== 158) {
  throw new Error('Stage 600 UV1 companion source is incomplete');
}

const geometries = {};
for (const [key, record] of Object.entries(source.geometries)) {
  if (!Array.isArray(record.uv1) || record.uv1.length !== record.vertexCount * 2) {
    throw new Error(`Invalid UV1 array for ${key}`);
  }
  const buffer = Buffer.allocUnsafe(record.uv1.length * 4);
  record.uv1.forEach((value, index) => buffer.writeFloatLE(Number(value), index * 4));
  geometries[key] = {
    vertexCount: record.vertexCount,
    uv1Sha256: record.uv1Sha256,
    uv1Base64: buffer.toString('base64'),
  };
}

const compact = {
  schemaVersion: 3,
  stageId: source.stageId,
  sourceRevision: source.sourceRevision,
  sourceBundle: source.sourceBundle,
  fbxPath: source.fbxPath,
  uvConvention: source.uvConvention,
  geometries,
  nodes: source.nodes,
};
fs.writeFileSync(outputPath, JSON.stringify(compact) + '\n');
console.log(JSON.stringify({
  outputPath,
  stageId: compact.stageId,
  sourceRevision: compact.sourceRevision,
  nodeCount: compact.nodes.length,
  geometryCount: Object.keys(compact.geometries).length,
  sourceBytes: fs.statSync(inputPath).size,
  compactBytes: fs.statSync(outputPath).size,
}, null, 2));
