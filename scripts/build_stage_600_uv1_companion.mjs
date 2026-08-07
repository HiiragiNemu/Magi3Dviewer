import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const sourcePath = process.env.STAGE600_UV1_SOURCE_OUT
  || '/tmp/stage600-uv1-source.json';
const hierarchySourcePath = process.env.STAGE600_MESHFILTER_HIERARCHY_OUT
  || '/tmp/stage600-meshfilter-hierarchy.json';
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

function hierarchyPath(node) {
  const parts = [];
  let current = node;
  while (current) {
    if (current.name) parts.unshift(current.name);
    current = current.parent;
  }
  return parts.join('/');
}

function normalizePath(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/, '/');
}

function suffixPathMatch(left, right) {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function candidateIndices(source, targetCount) {
  if (targetCount === source.sourceVertexCount) {
    return {
      mode: 'direct',
      indices: Array.from({ length: targetCount }, (_, index) => index),
    };
  }
  if (targetCount !== source.triangleIndices.length) return null;
  const indices = new Array(targetCount);
  // Empirically proven on the first 142 unambiguous meshes: Unity's triangle
  // corner order reaches Three r182 FBXLoader as C,B,A with no UV axis flip.
  for (let offset = 0; offset < source.triangleIndices.length; offset += 3) {
    indices[offset] = source.triangleIndices[offset + 2];
    indices[offset + 1] = source.triangleIndices[offset + 1];
    indices[offset + 2] = source.triangleIndices[offset];
  }
  return { mode: 'cba', indices };
}

function verifyUv0(targetUv, source, mapping) {
  let maxError = 0;
  let squaredError = 0;
  for (let i = 0; i < mapping.indices.length; i++) {
    const sourceOffset = mapping.indices[i] * 2;
    const du = targetUv.getX(i) - source.uv0[sourceOffset];
    const dv = targetUv.getY(i) - source.uv0[sourceOffset + 1];
    maxError = Math.max(maxError, Math.abs(du), Math.abs(dv));
    squaredError += du * du + dv * dv;
  }
  return {
    maxError,
    rmsError: Math.sqrt(squaredError / (mapping.indices.length * 2)),
  };
}

function transformedUv1(source, mapping) {
  const values = new Float32Array(mapping.indices.length * 2);
  for (let i = 0; i < mapping.indices.length; i++) {
    const sourceOffset = mapping.indices[i] * 2;
    values[i * 2] = source.uv1[sourceOffset];
    values[i * 2 + 1] = source.uv1[sourceOffset + 1];
  }
  return values;
}

function hashFloat32(values) {
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const hierarchySource = JSON.parse(fs.readFileSync(hierarchySourcePath, 'utf8'));
const bytes = fs.readFileSync(fbxPath);
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const root = new FBXLoader().parse(arrayBuffer, path.dirname(fbxPath) + '/');

const sourceByName = new Map();
const sourceByPathId = new Map();
for (const mesh of source.meshes) {
  sourceByPathId.set(String(mesh.pathId), mesh);
  const list = sourceByName.get(mesh.name) || [];
  list.push(mesh);
  sourceByName.set(mesh.name, list);
}

const mappings = [];
const failures = [];
const geometries = {};
const nodes = [];
let hierarchyResolved = 0;
let uv0Resolved = 0;

root.traverse((node) => {
  if (!node.isMesh || !node.geometry) return;
  const targetPath = hierarchyPath(node);
  const targetUv = node.geometry.getAttribute('uv');
  const targetPosition = node.geometry.getAttribute('position');
  if (!targetUv || !targetPosition) {
    failures.push({
      hierarchyPath: targetPath,
      nodeName: node.name,
      reason: !targetUv ? 'missing-target-uv0' : 'missing-target-position',
    });
    return;
  }

  const hierarchyMatches = hierarchySource.records.filter((record) =>
    record.meshName === node.name && suffixPathMatch(targetPath, record.hierarchyPath),
  );

  let candidates = [];
  let resolution = 'uv0';
  if (hierarchyMatches.length === 1) {
    const exact = sourceByPathId.get(String(hierarchyMatches[0].meshPathId));
    if (exact) {
      candidates = [exact];
      resolution = 'official-hierarchy';
    }
  }
  if (candidates.length === 0) {
    const names = [node.name, node.geometry.name].filter(Boolean);
    candidates = [...new Set(names.flatMap((name) => sourceByName.get(name) || []))];
  }
  if (candidates.length === 0) {
    failures.push({
      hierarchyPath: targetPath,
      nodeName: node.name,
      geometryName: node.geometry.name || '',
      targetVertexCount: targetPosition.count,
      hierarchyMatches,
      reason: 'no-source-mesh-candidate',
    });
    return;
  }

  const scored = candidates.map((candidate) => {
    const cornerMapping = candidateIndices(candidate, targetPosition.count);
    if (!cornerMapping) return null;
    const score = verifyUv0(targetUv, candidate, cornerMapping);
    return { candidate, cornerMapping, score };
  }).filter(Boolean).sort((a, b) =>
    a.score.maxError - b.score.maxError || a.score.rmsError - b.score.rmsError,
  );

  if (scored.length === 0 || scored[0].score.maxError > tolerance) {
    failures.push({
      hierarchyPath: targetPath,
      nodeName: node.name,
      geometryName: node.geometry.name || '',
      targetVertexCount: targetPosition.count,
      hierarchyMatches,
      resolution,
      reason: 'no-exact-uv0-corner-mapping',
      best: scored[0] ? {
        sourcePathId: scored[0].candidate.pathId,
        mode: scored[0].cornerMapping.mode,
        maxError: scored[0].score.maxError,
        rmsError: scored[0].score.rmsError,
      } : null,
    });
    return;
  }

  let selected = scored[0];
  if (resolution !== 'official-hierarchy') {
    const exact = scored.filter((entry) => entry.score.maxError <= tolerance);
    const hashes = new Set(exact.map((entry) =>
      hashFloat32(transformedUv1(entry.candidate, entry.cornerMapping)),
    ));
    if (hashes.size !== 1) {
      failures.push({
        hierarchyPath: targetPath,
        nodeName: node.name,
        geometryName: node.geometry.name || '',
        targetVertexCount: targetPosition.count,
        hierarchyMatches,
        reason: 'ambiguous-source-mesh-produces-different-uv1',
        exactCandidates: exact.map((entry) => ({
          sourcePathId: entry.candidate.pathId,
          mode: entry.cornerMapping.mode,
          maxError: entry.score.maxError,
          uv1Hash: hashFloat32(transformedUv1(entry.candidate, entry.cornerMapping)),
        })),
      });
      return;
    }
    uv0Resolved++;
  } else {
    hierarchyResolved++;
  }

  const uv1 = transformedUv1(selected.candidate, selected.cornerMapping);
  const geometryHash = hashFloat32(uv1);
  const geometryKey = `${targetPosition.count}:${geometryHash}`;
  if (!geometries[geometryKey]) {
    geometries[geometryKey] = {
      vertexCount: targetPosition.count,
      uv1Sha256: geometryHash,
      uv1: Array.from(uv1),
    };
  }
  const record = {
    hierarchyPath: targetPath,
    nodeName: node.name,
    geometryName: node.geometry.name || '',
    targetVertexCount: targetPosition.count,
    sourcePathId: selected.candidate.pathId,
    sourceName: selected.candidate.name,
    sourceVertexCount: selected.candidate.sourceVertexCount,
    sourceTriangleCornerCount: selected.candidate.triangleIndices.length,
    cornerMode: selected.cornerMapping.mode,
    maxError: selected.score.maxError,
    rmsError: selected.score.rmsError,
    resolution,
    geometryKey,
  };
  mappings.push(record);
  nodes.push({ hierarchyPath: targetPath, geometryKey });
});

const report = {
  schemaVersion: 2,
  sourceRevision: source.sourceRevision,
  sourceBundle: source.sourceBundle,
  fbxPath,
  tolerance,
  fbxMeshCount: mappings.length + failures.length,
  mappedMeshCount: mappings.length,
  failureCount: failures.length,
  hierarchyResolved,
  uv0Resolved,
  uniqueUv1GeometryCount: Object.keys(geometries).length,
  cornerModes: mappings.reduce((out, item) => {
    out[item.cornerMode] = (out[item.cornerMode] || 0) + 1;
    return out;
  }, {}),
  failures,
  mappings: mappings.map(({ geometryKey, ...entry }) => entry),
};

const companion = {
  schemaVersion: 2,
  stageId: 'battle-600-00-01-002',
  sourceRevision: source.sourceRevision,
  sourceBundle: source.sourceBundle,
  fbxPath,
  uvConvention: 'Unity triangle corners CBA -> Three r182; U/V unchanged',
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
  hierarchyResolved,
  uv0Resolved,
  uniqueUv1GeometryCount: report.uniqueUv1GeometryCount,
  cornerModes: report.cornerModes,
  sampleFailures: failures.slice(0, 20),
  sampleHierarchyMappings: mappings
    .filter((item) => item.resolution === 'official-hierarchy')
    .slice(0, 20)
    .map((item) => ({
      hierarchyPath: item.hierarchyPath,
      sourcePathId: item.sourcePathId,
      cornerMode: item.cornerMode,
      maxError: item.maxError,
    })),
}, null, 2));

if (failures.length !== 0 || mappings.length !== 158) {
  throw new Error(
    `Stage 600 UV1 mapping is not closed: mapped=${mappings.length} failures=${failures.length}`,
  );
}
