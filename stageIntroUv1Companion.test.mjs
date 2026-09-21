import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { applyStageUv1Companion } from './src/viewer/stageUv1Companion.ts';

const stageRoot = 'public/stages/official/dungeon-intro-0001-001';

function parseIntroFbx() {
  const compressed = fs.readFileSync(`${stageRoot}/level_intro_0001_001.fbxdata`);
  const buffer = zlib.gunzipSync(compressed);
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElementNS() {
      return {
        addEventListener() {},
        removeEventListener() {},
        set src(_value) {},
        style: {},
      };
    },
  };
  try {
    return new FBXLoader().parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      '',
    );
  } finally {
    globalThis.document = previousDocument;
  }
}

test('Intro exact FBX accepts only four byte-equivalent duplicate UV1 carriers', () => {
  const companion = JSON.parse(fs.readFileSync(`${stageRoot}/uv1-companion.json`, 'utf8'));
  const root = parseIntroFbx();
  root.name = 'Stage:dungeon-intro-0001-001';
  const result = applyStageUv1Companion(root, companion, { strict: true });

  assert.equal(result.declaredNodeCount, 923);
  assert.equal(result.matchedNodeCount, 923);
  assert.equal(result.installedMeshCount, 927);
  assert.equal(result.equivalentDuplicateMeshCount, 4);
  assert.deepEqual(result.unmatchedCompanionPaths, []);
  assert.deepEqual(result.ambiguousCompanionPaths, []);
  assert.deepEqual(result.missingGeometryKeys, []);
  assert.deepEqual(result.vertexCountMismatchPaths, []);
});

test('same-path meshes with different geometry remain fail-closed', () => {
  const root = new THREE.Group();
  root.name = 'Root';
  const parent = new THREE.Group();
  parent.name = 'Parent';
  root.add(parent);

  const makeGeometry = (lastX) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      lastX, 1, 0,
    ], 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0,
      1, 0,
      0, 1,
    ], 2));
    return geometry;
  };
  for (const lastX of [0, 0.25]) {
    const mesh = new THREE.Mesh(makeGeometry(lastX), new THREE.MeshBasicMaterial());
    mesh.name = 'Carrier';
    parent.add(mesh);
  }

  const uv1 = new Float32Array([0, 0, 1, 0, 0, 1]);
  const companion = {
    schemaVersion: 4,
    stageId: 'negative-neighbor',
    sourceRevision: 'fixture',
    sourceBundle: 'fixture',
    fbxPath: 'fixture',
    uvConvention: 'fixture',
    geometries: {
      source: {
        vertexCount: 3,
        sourceMeshPathID: '1',
        sourceMeshCab: 'CAB-fixture',
        uv1Base64: Buffer.from(uv1.buffer).toString('base64'),
      },
    },
    nodes: [{ hierarchyPath: 'Root/Parent/Carrier', geometryKey: 'source' }],
  };

  assert.throws(
    () => applyStageUv1Companion(root, companion, { strict: true }),
    /matched=0.*ambiguous=1/,
  );
});
