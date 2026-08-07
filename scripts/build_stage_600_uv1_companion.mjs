import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const sourcePath = process.env.STAGE600_UV1_SOURCE_OUT
  || '/tmp/stage600-uv1-source.json';
const fbxPath = 'public/stages/official/battle-600-00-01-002/bg_3d_600_00_01_002-animated.fbxdata';
const reportPath = 'research/stage-600-01-02-uv1-fbx-mapping.json';
const companionPath = process.env.STAGE600_UV1_COMPANION_OUT
  || '/tmp/stage600-uv1-companion.json';
const tolerance = 5e-5;

if (!globalThis.document) {
  globalThis.document = {
    createElementNS() {
      return {
        addEventListener() {},
        removeEventListener() {},
        set src(_) {},
        get src() { return ''; },
      };
    },
  };
}

const permutations = [
  ['abc', [0, 1, 2]],
  ['acb', [0, 2, 1]],
  ['bac', [1, 0, 2]],
  ['bca', [1, 2, 0]],
  ['cab', [2, 0, 1]],
  ['cba', [2, 1, 0]],
];

function hierarchyPath(node) {
  const parts = [];
  let current = node;
  while (current) {
    if (current.name) parts.unshift(current.name);
    current = current.parent;
  }
  return parts.join('/');
}

function candidateIndices(source, targetCount, permutation) {
  if (targetCount === source.sourceVertexCount && permutation[0] === 0
      && permutation[1] === 1 && permutation[2] === 2) {
    return Array.from({ length: targetCount }, (_, index) => index);
  }
  if (targetCount !== source.triangleIndices.length) return null;
  const output = new Array(targetCount);
  for (let offset = 0; offset < source.triangleIndices.length; offset += 3) {
    output[offset] = source.triangleIndices[offset + permutation[0]];
    output[offset + 1] = source.triangleIndices[offset + permutation[1]];
    output[offset + 2] = source.triangleIndices[offset + permutation[2]];
  }
  return output;
}

function scoreMapping(targetUv, sourceUv, indices, signU, signV) {
  let offsetU = 0;
  let offsetV = 0;
  for (let i = 0; i < indices.length; i++) {
    const sourceIndex = indices[i] * 2;
    offsetU += targetUv.getX(i) - signU * sourceUv[sourceIndex];
    offsetV += targetUv.getY(i) - signV * sourceUv[sourceIndex + 1];
  }
  offsetU /= indices.length;
  offsetV /= indices.length;

  let maxError = 0;
  let squaredError = 0;
  for (let i = 0; i < indices.length; i++) {
    const sourceIndex = indices[i] * 2;
    const du = targetUv.getX(i)
      - (signU * sourceUv[sourceIndex] + offsetU);
    const dv = targetUv.getY(i)
      - (signV * sourceUv[sourceIndex + 1] + offsetV);
    maxError = Math.max(maxError, Math.abs(du), Math.abs(dv));
    squaredError += du * du + dv * dv;
  }
  return {
    signU,
    signV,
    offsetU,
    offsetV,
    maxError,
    rmsError: Math.sqrt(squaredError / (indices.length * 2)),
  };
}

function bestSourceMapping(targetUv, source) {
  let best = null;
  const targetCount = targetUv.count;
  const isDirect = targetCount === source.sourceVertexCount;
  const permutationsToTry = isDirect
    ? [['direct', [0, 1, 2]]]
    : permutations;

  for (const [permutationName, permutation] of permutationsToTry) {
    const indices = candidateIndices(source, targetCount, permutation);
    if (!indices) continue;
    for (const signU of [1, -1]) {
      for (const signV of [1, -1]) {
        const score = scoreMapping(
          targetUv,
          source.uv0,
          indices,
          signU,
          signV,
        );
        const current = {
          ...score,
          permutation: permutationName,
          indices,
        };
        if (!best
            || current.maxError < best.maxError
            || (current.maxError === best.maxError
              && current.rmsError < best.rmsError)) {
          best = current;
        }
      }
    }
  }
  return best;
}

function transformedUv1(source, mapping) {
  const values = new Float32Array(mapping.indices.length * 2);
  for (let i = 0; i < mapping.indices.length; i++) {
    const sourceOffset = mapping.indices[i] * 2;
    values[i * 2] = mapping.signU * source.uv1[sourceOffset]
      + mapping.offsetU;
    values[i * 2 + 1] = mapping.signV * source.uv1[sourceOffset + 1]
      + mapping.offsetV;
  }
  return values;
}

function hashFloat32(values) {
  const bytes = Buffer.from(
    values.buffer,
    values.byteOffset,
    values.byteLength,
  );
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const bytes = fs.readFileSync(fbxPath);
const arrayBuffer = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const root = new FBXLoader().parse(arrayBuffer, path.dirname(fbxPath) + '/');

const sourceByName = new Map();
for (const mesh of source.meshes) {
  const list = sourceByName.get(mesh.name) || [];
  list.push(mesh);
  sourceByName.set(mesh.name, list);
}

const mappings = [];
const failures = [];
const geometries = {};
const nodes = [];

root.traverse((node) => {
  if (!node.isMesh || !node.geometry) return;
  const targetUv = node.geometry.getAttribute('uv');
  const targetPosition = node.geometry.getAttribute('position');
  const names = [node.name, node.geometry.name].filter(Boolean);
  const candidates = [...new Set(
    names.flatMap((name) => sourceByName.get(name) || []),
  )];

  if (!targetUv || !targetPosition || candidates.length === 0) {
    failures.push({
      hierarchyPath: hierarchyPath(node),
      nodeName: node.name,
      geometryName: node.geometry.name || '',
      targetVertexCount: targetPosition?.count ?? null,
      reason: !targetUv
        ? 'missing-target-uv0'
        : candidates.length === 0
          ? 'no-source-mesh-name-candidate'
          : 'missing-target-position',
    });
    return;
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      mapping: bestSourceMapping(targetUv, candidate),
    }))
    .filter((entry) => entry.mapping)
    .sort((left, right) =>
      left.mapping.maxError - right.mapping.maxError
      || left.mapping.rmsError - right.mapping.rmsError,
    );

  if (scored.length === 0 || scored[0].mapping.maxError > tolerance) {
    failures.push({
      hierarchyPath: hierarchyPath(node),
      nodeName: node.name,
      geometryName: node.geometry.name || '',
      targetVertexCount: targetPosition.count,
      reason: 'no-exact-uv0-corner-mapping',
      best: scored[0] ? {
        sourcePathId: scored[0].candidate.pathId,
        sourceVertexCount: scored[0].candidate.sourceVertexCount,
        sourceTriangleCornerCount: scored[0].candidate.triangleIndices.length,
        permutation: scored[0].mapping.permutation,
        signU: scored[0].mapping.signU,
        signV: scored[0].mapping.signV,
        offsetU: scored[0].mapping.offsetU,
        offsetV: scored[0].mapping.offsetV,
        maxError: scored[0].mapping.maxError,
        rmsError: scored[0].mapping.rmsError,
      } : null,
    });
    return;
  }

  const bestError = scored[0].mapping.maxError;
  const exactCandidates = scored.filter((entry) =>
    entry.mapping.maxError <= Math.max(tolerance, bestError + 1e-7),
  );
  const uv1Options = exactCandidates.map((entry) => ({
    entry,
    uv1: transformedUv1(entry.candidate, entry.mapping),
  }));
  const uv1Hashes = [...new Set(uv1Options.map((entry) => hashFloat32(entry.uv1)))];
  if (uv1Hashes.length !== 1) {
    failures.push({
      hierarchyPath: hierarchyPath(node),
      nodeName: node.name,
      geometryName: node.geometry.name || '',
      targetVertexCount: targetPosition.count,
      reason: 'ambiguous-source-mesh-produces-different-uv1',
      exactCandidates: uv1Options.map(({ entry, uv1 }) => ({
        sourcePathId: entry.candidate.pathId,
        permutation: entry.mapping.permutation,
        maxError: entry.mapping.maxError,
        uv1Hash: hashFloat32(uv1),
      })),
    });
    return;
  }

  const selected = uv1Options[0];
  const uv1 = selected.uv1;
  const geometryHash = hashFloat32(uv1);
  const geometryKey = `${targetPosition.count}:${geometryHash}`;
  if (!geometries[geometryKey]) {
    geometries[geometryKey] = {
      vertexCount: targetPosition.count,
      uv1Sha256: geometryHash,
      uv1: Array.from(uv1),
    };
  }
  const mappingRecord = {
    hierarchyPath: hierarchyPath(node),
    nodeName: node.name,
    geometryName: node.geometry.name || '',
    targetVertexCount: targetPosition.count,
    sourcePathId: selected.entry.candidate.pathId,
    sourceName: selected.entry.candidate.name,
    sourceVertexCount: selected.entry.candidate.sourceVertexCount,
    sourceTriangleCornerCount:
      selected.entry.candidate.triangleIndices.length,
    permutation: selected.entry.mapping.permutation,
    signU: selected.entry.mapping.signU,
    signV: selected.entry.mapping.signV,
    offsetU: selected.entry.mapping.offsetU,
    offsetV: selected.entry.mapping.offsetV,
    maxError: selected.entry.mapping.maxError,
    rmsError: selected.entry.mapping.rmsError,
    geometryKey,
  };
  mappings.push(mappingRecord);
  nodes.push({
    hierarchyPath: mappingRecord.hierarchyPath,
    geometryKey,
  });
});

const transformModes = {};
for (const mapping of mappings) {
  const key = [
    mapping.permutation,
    mapping.signU,
    mapping.signV,
    Number(mapping.offsetU.toFixed(6)),
    Number(mapping.offsetV.toFixed(6)),
  ].join(':');
  transformModes[key] = (transformModes[key] || 0) + 1;
}

const report = {
  schemaVersion: 1,
  sourceRevision: source.sourceRevision,
  sourceBundle: source.sourceBundle,
  fbxPath,
  tolerance,
  fbxMeshCount: mappings.length + failures.length,
  mappedMeshCount: mappings.length,
  failureCount: failures.length,
  uniqueUv1GeometryCount: Object.keys(geometries).length,
  transformModes,
  failures,
  mappings: mappings.map(({ geometryKey, ...entry }) => entry),
};

const companion = {
  schemaVersion: 1,
  stageId: 'battle-600-00-01-002',
  sourceRevision: source.sourceRevision,
  sourceBundle: source.sourceBundle,
  fbxPath,
  uvConventionRecoveredFromUv0: true,
  geometries,
  nodes,
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(companionPath, JSON.stringify(companion) + '\n');
console.log(JSON.stringify({
  reportPath,
  companionPath,
  fbxMeshCount: report.fbxMeshCount,
  mappedMeshCount: report.mappedMeshCount,
  failureCount: report.failureCount,
  uniqueUv1GeometryCount: report.uniqueUv1GeometryCount,
  transformModes,
  sampleFailures: failures.slice(0, 10),
  sampleMappings: mappings.slice(0, 10).map((entry) => ({
    hierarchyPath: entry.hierarchyPath,
    sourcePathId: entry.sourcePathId,
    permutation: entry.permutation,
    signU: entry.signU,
    signV: entry.signV,
    offsetU: entry.offsetU,
    offsetV: entry.offsetV,
    maxError: entry.maxError,
  })),
}, null, 2));

if (mappings.length === 0) {
  throw new Error('No stage 600 FBX meshes could be mapped to current-JP UV1');
}
