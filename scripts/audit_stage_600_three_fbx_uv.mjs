import fs from 'node:fs';
import path from 'node:path';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const source = 'public/stages/official/battle-600-00-01-002/bg_3d_600_00_01_002-animated.fbxdata';
const output = 'research/stage-600-01-02-three-fbx-uv-audit.json';

// FBXLoader is synchronous after bytes are available, but TextureLoader asks for
// an HTMLImageElement while parsing embedded/file texture declarations. We only
// audit geometry attributes, so a minimal inert image node is sufficient.
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

const bytes = fs.readFileSync(source);
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const loader = new FBXLoader();
const root = loader.parse(arrayBuffer, path.dirname(source) + '/');

const meshes = [];
root.traverse((node) => {
  if (!node.isMesh || !node.geometry) return;
  const names = Object.keys(node.geometry.attributes || {}).sort();
  const materialNames = (Array.isArray(node.material) ? node.material : [node.material])
    .filter(Boolean)
    .map((material) => material.name || '');
  meshes.push({
    nodeName: node.name,
    materialNames,
    attributeNames: names,
    vertexCount: node.geometry.getAttribute('position')?.count ?? null,
    uvCount: node.geometry.getAttribute('uv')?.count ?? 0,
    uv1Count: node.geometry.getAttribute('uv1')?.count ?? 0,
    uv2Count: node.geometry.getAttribute('uv2')?.count ?? 0,
    hasUv: Boolean(node.geometry.getAttribute('uv')),
    hasUv1: Boolean(node.geometry.getAttribute('uv1')),
    hasUv2: Boolean(node.geometry.getAttribute('uv2')),
  });
});

const result = {
  schemaVersion: 1,
  source,
  meshCount: meshes.length,
  meshesWithUv: meshes.filter((x) => x.hasUv).length,
  meshesWithUv1: meshes.filter((x) => x.hasUv1).length,
  meshesWithUv2: meshes.filter((x) => x.hasUv2).length,
  uniqueAttributeSets: [...new Set(meshes.map((x) => x.attributeNames.join(',')))].sort(),
  materialNames: [...new Set(meshes.flatMap((x) => x.materialNames))].filter(Boolean).sort(),
  meshes,
};

fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({
  meshCount: result.meshCount,
  meshesWithUv: result.meshesWithUv,
  meshesWithUv1: result.meshesWithUv1,
  meshesWithUv2: result.meshesWithUv2,
  uniqueAttributeSets: result.uniqueAttributeSets,
  materialNames: result.materialNames,
}, null, 2));

if (result.meshCount === 0) throw new Error('FBXLoader produced no meshes');
