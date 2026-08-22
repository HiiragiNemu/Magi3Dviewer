#!/usr/bin/env node
/**
 * Global Home animation / skinning integrity audit.
 *
 * This reproduces generated Home clips in a headless Three.js FBXLoader, using
 * the same UUID-to-exact-node-path rebinding contract as the Viewer.  It does
 * not repair or guess offsets.  Its release blocker is topological: a missing
 * source path, an ancestor collision, or a posed skinned edge that stretches
 * beyond the bounded ratio is evidence that the generated runtime is unsafe.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
  AnimationClip,
  AnimationMixer,
  Box3,
  LoopRepeat,
  Vector3,
} from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const DEFAULT_MODEL_ROOT =
  'D:/magia/MyProducts/Magius3Dviewer-JP/magia-exedra-character-three/models';
const EDGE_RATIO_WARNING = 2;
const EDGE_COUNT_WARNING = 3;
const EDGE_RATIO_HARD_BLOCKER = 5;
const EDGE_FRACTION_HARD_BLOCKER = 0.01;

// FBXLoader creates texture Image elements even though image pixels are not
// needed by this geometry/animation audit.
globalThis.document ??= {
  createElementNS() {
    return {
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      getContext() { return null; },
      set src(value) { this._src = value; },
      get src() { return this._src; },
      width: 1,
      height: 1,
    };
  },
};

function parseArgs(argv) {
  const result = {
    modelRoot: DEFAULT_MODEL_ROOT,
    output: null,
    sourceAudit: null,
    characters: [],
    allowBlockers: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--model-root') result.modelRoot = argv[++index];
    else if (value === '--output') result.output = argv[++index];
    else if (value === '--source-audit') result.sourceAudit = argv[++index];
    else if (value === '--character') result.characters.push(argv[++index]);
    else if (value === '--allow-blockers') result.allowBlockers = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!result.output) throw new Error('--output is required');
  return result;
}

function readGzipJson(path) {
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'));
}

function fbxArrayBuffer(path) {
  const decompressed = gunzipSync(readFileSync(path));
  return decompressed.buffer.slice(
    decompressed.byteOffset,
    decompressed.byteOffset + decompressed.byteLength,
  );
}

function finiteArray(values) {
  return values.every(Number.isFinite);
}

function fullPathIndex(root) {
  const exact = new Map();
  const ambiguous = new Map();
  const objectPath = new Map();
  function visit(object, path) {
    objectPath.set(object, path);
    if (exact.has(path)) {
      const entries = ambiguous.get(path) ?? [exact.get(path)];
      entries.push(object);
      ambiguous.set(path, entries);
    } else {
      exact.set(path, object);
    }
    for (const child of object.children) visit(child, `${path}/${child.name}`);
  }
  visit(root, `<root>/${root.name}`);
  for (const path of ambiguous.keys()) exact.delete(path);
  return { exact, ambiguous, objectPath };
}

function characterLocalPath(path, characterId) {
  const anchor = `chara_${characterId}`;
  const parts = path.split('/');
  const index = parts.indexOf(anchor);
  return index < 0 ? null : parts.slice(index).join('/');
}

function captureLocalPose(root) {
  const pose = [];
  root.traverse((object) => {
    pose.push({
      object,
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray(),
      morph: object.morphTargetInfluences ? [...object.morphTargetInfluences] : null,
    });
  });
  return pose;
}

function restoreLocalPose(pose, root) {
  for (const entry of pose) {
    entry.object.position.fromArray(entry.position);
    entry.object.quaternion.fromArray(entry.quaternion);
    entry.object.scale.fromArray(entry.scale);
    if (entry.morph && entry.object.morphTargetInfluences) {
      entry.object.morphTargetInfluences.splice(0, entry.morph.length, ...entry.morph);
    }
    entry.object.updateMatrix();
  }
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (object.isSkinnedMesh) object.skeleton.update();
  });
}

function bindRuntimeClip(runtime, clipJson, paths) {
  const remapped = structuredClone(clipJson);
  const missingTargets = [];
  const ambiguousTargets = [];
  const duplicateTargetProperties = [];
  const seen = new Set();
  const ownership = [];
  const validTracks = [];
  const localExact = new Map();
  const localAmbiguous = new Set();
  for (const [object, path] of paths.objectPath) {
    const local = characterLocalPath(path, runtime.characterId);
    if (!local) continue;
    if (localExact.has(local)) {
      localExact.delete(local);
      localAmbiguous.add(local);
    } else if (!localAmbiguous.has(local)) {
      localExact.set(local, object);
    }
  }
  for (const track of remapped.tracks ?? []) {
    const separator = track.name.lastIndexOf('.');
    if (separator < 1) {
      missingTargets.push({ track: track.name, reason: 'malformed-track-name' });
      continue;
    }
    const sourceUuid = track.name.slice(0, separator);
    const property = track.name.slice(separator + 1);
    const sourcePath = runtime.nodePaths?.[sourceUuid];
    if (!sourcePath) {
      missingTargets.push({ track: track.name, reason: 'source-uuid-not-in-nodePaths' });
      continue;
    }
    if (paths.ambiguous.has(sourcePath)) {
      ambiguousTargets.push({ track: track.name, sourcePath });
      continue;
    }
    const sourceLocalPath = characterLocalPath(sourcePath, runtime.characterId);
    if (sourceLocalPath && localAmbiguous.has(sourceLocalPath)) {
      ambiguousTargets.push({ track: track.name, sourcePath, sourceLocalPath });
      continue;
    }
    const target = paths.exact.get(sourcePath)
      ?? (sourceLocalPath ? localExact.get(sourceLocalPath) : undefined);
    if (!target) {
      missingTargets.push({ track: track.name, sourcePath, reason: 'exact-target-absent' });
      continue;
    }
    const targetPath = paths.objectPath.get(target);
    const targetProperty = `${targetPath}.${property}`;
    if (seen.has(targetProperty)) duplicateTargetProperties.push(targetProperty);
    seen.add(targetProperty);
    ownership.push({
      sourceUuid,
      sourcePath,
      sourceLocalPath,
      targetUuid: target.uuid,
      targetPath,
      property,
      targetProperty,
    });
    track.name = `${target.uuid}.${property}`;
    validTracks.push(track);
  }
  remapped.tracks = validTracks;
  return {
    clip: AnimationClip.parse(remapped),
    missingTargets,
    ambiguousTargets,
    duplicateTargetProperties,
    ownership,
  };
}

function validateSkeletons(root, objectPath) {
  const meshes = [];
  const failures = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!object.isSkinnedMesh) return;
    const skeleton = object.skeleton;
    const meshPath = objectPath.get(object);
    const bonePaths = skeleton.bones.map((bone) => objectPath.get(bone) ?? null);
    const localScaleFailures = skeleton.bones
      .map((bone, index) => ({ index, path: bonePaths[index], scale: bone.scale.toArray() }))
      .filter(({ scale }) => !finiteArray(scale) || scale.some((value) => Math.abs(value) <= 1e-7 || Math.abs(value) > 100));
    const matrixFailures = [];
    for (const [index, matrix] of skeleton.boneInverses.entries()) {
      if (!finiteArray(matrix.elements)) matrixFailures.push({ kind: 'boneInverse', index });
    }
    if (!finiteArray(object.bindMatrix.elements)) matrixFailures.push({ kind: 'bindMatrix' });
    if (!finiteArray(object.bindMatrixInverse.elements)) matrixFailures.push({ kind: 'bindMatrixInverse' });
    const vertexCount = object.geometry.getAttribute('position')?.count ?? 0;
    const record = {
      mesh: object.name,
      meshPath,
      vertexCount,
      boneCount: skeleton.bones.length,
      inverseCount: skeleton.boneInverses.length,
      firstBonePath: bonePaths[0] ?? null,
      missingBonePathCount: bonePaths.filter((item) => !item).length,
      localScaleFailures,
      matrixFailures,
      hasSkinIndex: Boolean(object.geometry.getAttribute('skinIndex')),
      hasSkinWeight: Boolean(object.geometry.getAttribute('skinWeight')),
    };
    meshes.push(record);
    if (
      record.boneCount !== record.inverseCount ||
      record.missingBonePathCount ||
      localScaleFailures.length ||
      matrixFailures.length ||
      !record.hasSkinIndex ||
      !record.hasSkinWeight
    ) failures.push(record);
  });
  return { meshes, failures };
}

function skinnedPositions(mesh) {
  mesh.updateWorldMatrix(true, false);
  mesh.skeleton.update();
  const attribute = mesh.geometry.getAttribute('position');
  const result = new Float64Array(attribute.count * 3);
  const value = new Vector3();
  for (let index = 0; index < attribute.count; index += 1) {
    value.fromBufferAttribute(attribute, index);
    mesh.applyBoneTransform(index, value);
    value.applyMatrix4(mesh.matrixWorld);
    result[index * 3] = value.x;
    result[index * 3 + 1] = value.y;
    result[index * 3 + 2] = value.z;
  }
  return result;
}

function boxFromPositions(positions) {
  const box = new Box3();
  box.makeEmpty();
  const value = new Vector3();
  for (let index = 0; index < positions.length; index += 3) {
    value.set(positions[index], positions[index + 1], positions[index + 2]);
    box.expandByPoint(value);
  }
  return box;
}

function boxVolume(box) {
  if (box.isEmpty()) return 0;
  const size = new Vector3();
  box.getSize(size);
  return Math.max(0, size.x) * Math.max(0, size.y) * Math.max(0, size.z);
}

function overlapRatio(hairBox, faceBox) {
  const intersection = hairBox.clone().intersect(faceBox);
  const faceVolume = boxVolume(faceBox);
  return faceVolume > 0 ? boxVolume(intersection) / faceVolume : 0;
}

function edgeMetrics(mesh, rest, posed) {
  const indexAttribute = mesh.geometry.index;
  const triangleIndices = indexAttribute
    ? Array.from(indexAttribute.array)
    : Array.from({ length: mesh.geometry.getAttribute('position').count }, (_, index) => index);
  const ratios = [];
  let maxEdgeRatio = 0;
  let edgesOver2 = 0;
  let edgesOver5 = 0;
  let finiteEdgeCount = 0;
  function distance(array, left, right) {
    const lx = array[left * 3];
    const ly = array[left * 3 + 1];
    const lz = array[left * 3 + 2];
    const rx = array[right * 3];
    const ry = array[right * 3 + 1];
    const rz = array[right * 3 + 2];
    return Math.hypot(lx - rx, ly - ry, lz - rz);
  }
  for (let offset = 0; offset + 2 < triangleIndices.length; offset += 3) {
    const triangle = [triangleIndices[offset], triangleIndices[offset + 1], triangleIndices[offset + 2]];
    for (const [left, right] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
      const restLength = distance(rest, left, right);
      if (!(restLength > 1e-8)) continue;
      const ratio = distance(posed, left, right) / restLength;
      if (!Number.isFinite(ratio)) continue;
      finiteEdgeCount += 1;
      ratios.push(ratio);
      maxEdgeRatio = Math.max(maxEdgeRatio, ratio);
      if (ratio > 2) edgesOver2 += 1;
      if (ratio > 5) edgesOver5 += 1;
    }
  }
  ratios.sort((left, right) => left - right);
  const percentile = (fraction) => ratios.length
    ? ratios[Math.min(ratios.length - 1, Math.floor((ratios.length - 1) * fraction))]
    : null;
  return {
    finiteEdgeCount,
    maxEdgeRatio,
    edgesOver2,
    edgesOver5,
    p95: percentile(0.95),
    p99: percentile(0.99),
    p999: percentile(0.999),
  };
}

function summarizeMeshMetrics(meshes, restByMesh) {
  const records = [];
  for (const mesh of meshes) {
    const posed = skinnedPositions(mesh);
    const metrics = edgeMetrics(mesh, restByMesh.get(mesh), posed);
    const box = boxFromPositions(posed);
    records.push({
      mesh: mesh.name,
      kind: /face/i.test(mesh.name) ? 'face' : 'hair',
      ...metrics,
      box: { min: box.min.toArray(), max: box.max.toArray() },
    });
  }
  return records;
}

function nonModelOwnedClipNames(sourceRecord) {
  return new Set([
    ...(sourceRecord?.nonModelOwnedClips ?? []).map((clip) => clip.runtimeClip),
    ...(sourceRecord?.externalOfficialClips ?? []).map((clip) => clip.runtimeClip),
  ].filter(Boolean));
}

function bodyClipNames(runtime, sourceRecord) {
  const helpers = new Set([...(runtime.helpers ?? []), ...(runtime.externalHelpers ?? [])]);
  const nonModelOwned = nonModelOwnedClipNames(sourceRecord);
  return (runtime.clips ?? [])
    .filter((clip) => !helpers.has(clip.name) && !nonModelOwned.has(clip.name) && (clip.tracks?.length ?? 0) > 2)
    .map((clip) => clip.name);
}

function helperOwnershipAudit(runtime, bindingsByClip, sourceRecord) {
  const helpers = [...(runtime.helpers ?? []), ...(runtime.externalHelpers ?? [])];
  const bodyClips = new Set(bodyClipNames(runtime, sourceRecord));
  const helperRecords = [];
  const collisions = [];
  for (const helper of helpers) {
    const binding = bindingsByClip.get(helper);
    if (!binding) {
      helperRecords.push({ helper, externalOrAbsent: true, paths: [] });
      continue;
    }
    const properties = binding.ownership.map((item) => item.targetProperty);
    const paths = [...new Set(binding.ownership.map((item) => item.sourcePath))].sort();
    helperRecords.push({
      helper,
      externalOrAbsent: false,
      paths,
      properties,
      weaponOwned: paths.every((path) => /weapon/i.test(path)),
    });
    for (const [clipName, body] of bindingsByClip) {
      if (!bodyClips.has(clipName)) continue;
      const bodyProperties = new Set(body.ownership.map((item) => item.targetProperty));
      for (const property of properties) {
        if (bodyProperties.has(property)) collisions.push({ bodyClip: clipName, helper, property });
      }
    }
  }
  return { helpers: helperRecords, collisions };
}

function expressionAudit(modelDir) {
  const path = join(modelDir, 'home-expressions.json');
  if (!existsSync(path)) return { path, present: false };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const text = JSON.stringify(data);
    return {
      path,
      present: true,
      schema: data.schema ?? null,
      characterId: data.characterId ?? null,
      serializedBytes: Buffer.byteLength(text),
      containsFaceMeshTarget: text.includes('Face_Mesh'),
      containsBlink: /Blink/i.test(text),
      containsMouth: /Mouth/i.test(text),
    };
  } catch (error) {
    return { path, present: true, error: `${error.name}: ${error.message}` };
  }
}

function disposeRoot(root) {
  root.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material?.dispose?.();
  });
}

function auditCharacter(modelDir, sourceRecord) {
  const runtimePath = join(modelDir, 'home-animations.json.gz');
  const fallbackId = basename(modelDir).replace(/^chara_/, '').replace(/_battle_unit$/, '');
  const fbxPath = [
    join(modelDir, 'VisualRoot.fbx.gz'),
    join(modelDir, `chara_${fallbackId}.fbx.gz`),
  ].find(existsSync);
  if (!existsSync(runtimePath) || !fbxPath) {
    return {
      characterId: fallbackId,
      modelDirectory: modelDir,
      classification: 'indeterminate',
      deploymentSafe: false,
      error: `runtime inputs absent: home=${existsSync(runtimePath)} fbx=${Boolean(fbxPath)}`,
      sourceBinding: sourceRecord ?? null,
    };
  }
  let root;
  try {
    const runtime = readGzipJson(runtimePath);
    const characterId = String(runtime.characterId ?? fallbackId);
    root = new FBXLoader().parse(fbxArrayBuffer(fbxPath), '');
    root.updateMatrixWorld(true);
    const paths = fullPathIndex(root);
    const localPose = captureLocalPose(root);
    const skeletons = validateSkeletons(root, paths.objectPath);
    const boundClips = new Map();
    for (const clipJson of runtime.clips ?? []) {
      boundClips.set(clipJson.name, bindRuntimeClip(runtime, clipJson, paths));
    }
    const helperAudit = helperOwnershipAudit(runtime, boundClips, sourceRecord);
    const selectedMeshes = [];
    root.traverse((object) => {
      if (object.isSkinnedMesh && /(Hair|Face)_Mesh/i.test(object.name)) selectedMeshes.push(object);
    });
    const restByMesh = new Map();
    for (const mesh of selectedMeshes) restByMesh.set(mesh, skinnedPositions(mesh));
    const restHair = [...restByMesh.entries()].find(([mesh]) => /Hair_Mesh/i.test(mesh.name));
    const restFace = [...restByMesh.entries()].find(([mesh]) => /Face_Mesh/i.test(mesh.name));
    const baselineOverlap = restHair && restFace
      ? overlapRatio(boxFromPositions(restHair[1]), boxFromPositions(restFace[1]))
      : null;
    const clipMetrics = [];
    for (const clipName of bodyClipNames(runtime, sourceRecord)) {
      restoreLocalPose(localPose, root);
      const binding = boundClips.get(clipName);
      if (!binding) continue;
      const mixer = new AnimationMixer(root);
      const action = mixer.clipAction(binding.clip);
      action.setLoop(LoopRepeat, Infinity);
      action.play();
      const duration = Math.max(binding.clip.duration, 0);
      const sampleTimes = [...new Set([0, duration / 2].map((value) => Number(value.toFixed(9))))];
      const samples = [];
      for (const sampleTime of sampleTimes) {
        restoreLocalPose(localPose, root);
        mixer.setTime(sampleTime);
        root.updateMatrixWorld(true);
        const meshMetrics = summarizeMeshMetrics(selectedMeshes, restByMesh);
        const hairMetric = meshMetrics.find((item) => item.kind === 'hair');
        const faceMetric = meshMetrics.find((item) => item.kind === 'face');
        let overlap = null;
        if (hairMetric && faceMetric) {
          overlap = overlapRatio(
            new Box3(
              new Vector3().fromArray(hairMetric.box.min),
              new Vector3().fromArray(hairMetric.box.max),
            ),
            new Box3(
              new Vector3().fromArray(faceMetric.box.min),
              new Vector3().fromArray(faceMetric.box.max),
            ),
          );
        }
        samples.push({ sampleTime, meshMetrics, hairFaceOverlapRatio: overlap });
      }
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      const meshRecords = samples.flatMap((sample) => sample.meshMetrics);
      clipMetrics.push({
        clip: clipName,
        duration,
        samples,
        maximumEdgeRatio: Math.max(0, ...meshRecords.map((item) => item.maxEdgeRatio)),
        maximumHairEdgeRatio: Math.max(0, ...meshRecords.filter((item) => item.kind === 'hair').map((item) => item.maxEdgeRatio)),
        maximumFaceEdgeRatio: Math.max(0, ...meshRecords.filter((item) => item.kind === 'face').map((item) => item.maxEdgeRatio)),
        hairEdgesOver2: Math.max(0, ...meshRecords.filter((item) => item.kind === 'hair').map((item) => item.edgesOver2)),
        faceEdgesOver2: Math.max(0, ...meshRecords.filter((item) => item.kind === 'face').map((item) => item.edgesOver2)),
        maximumHairEdgeFractionOver2: Math.max(0, ...meshRecords
          .filter((item) => item.kind === 'hair')
          .map((item) => item.edgesOver2 / Math.max(item.finiteEdgeCount, 1))),
        maximumFaceEdgeFractionOver2: Math.max(0, ...meshRecords
          .filter((item) => item.kind === 'face')
          .map((item) => item.edgesOver2 / Math.max(item.finiteEdgeCount, 1))),
        maximumHairFaceOverlapRatio: Math.max(0, ...samples.map((item) => item.hairFaceOverlapRatio ?? 0)),
      });
    }
    restoreLocalPose(localPose, root);
    const bindingFailures = [...boundClips.entries()].flatMap(([clip, binding]) => [
      ...binding.missingTargets.map((item) => ({ clip, kind: 'missing-exact-target', ...item })),
      ...binding.ambiguousTargets.map((item) => ({ clip, kind: 'ambiguous-exact-target', ...item })),
      ...binding.duplicateTargetProperties.map((property) => ({ clip, kind: 'duplicate-target-property', property })),
    ]);
    const geometryWarnings = clipMetrics.filter(
      (item) =>
        (item.maximumHairEdgeRatio > EDGE_RATIO_WARNING && item.hairEdgesOver2 >= EDGE_COUNT_WARNING) ||
        (item.maximumFaceEdgeRatio > EDGE_RATIO_WARNING && item.faceEdgesOver2 >= EDGE_COUNT_WARNING),
    );
    const geometryHardBlockers = geometryWarnings.filter(
      (item) =>
        item.maximumEdgeRatio > EDGE_RATIO_HARD_BLOCKER ||
        item.maximumHairEdgeFractionOver2 > EDGE_FRACTION_HARD_BLOCKER ||
        item.maximumFaceEdgeFractionOver2 > EDGE_FRACTION_HARD_BLOCKER,
    );
    const sourceHighRisk = Boolean(sourceRecord && !sourceRecord.strictExactPathSafe);
    const structuralHighRisk = Boolean(
      sourceHighRisk || bindingFailures.length || skeletons.failures.length || helperAudit.collisions.length,
    );
    const classification = geometryHardBlockers.length
      ? 'reproduced'
      : structuralHighRisk
        ? 'high-risk-same-source'
        : geometryWarnings.length
          ? 'native-visual-review'
        : sourceRecord
          ? 'no-same-source-evidence'
          : 'indeterminate';
    return {
      characterId,
      modelDirectory: modelDir,
      runtimePath,
      fbxPath,
      classification,
      deploymentSafe: classification === 'no-same-source-evidence',
      hardReleaseBlocker: Boolean(geometryHardBlockers.length || structuralHighRisk),
      sourceBinding: sourceRecord ?? null,
      exactPathIndex: {
        objectCount: paths.objectPath.size,
        exactPathCount: paths.exact.size,
        ambiguousPaths: [...paths.ambiguous.entries()].map(([path, items]) => ({ path, count: items.length })),
      },
      bindingFailures,
      helperAudit,
      skeletons,
      expressions: expressionAudit(modelDir),
      baselineHairFaceOverlapRatio: baselineOverlap,
      clipMetrics,
      geometryWarningClips: geometryWarnings.map((item) => item.clip),
      geometryHardBlockerClips: geometryHardBlockers.map((item) => item.clip),
      maximumHairEdgeRatio: Math.max(0, ...clipMetrics.map((item) => item.maximumHairEdgeRatio)),
      maximumFaceEdgeRatio: Math.max(0, ...clipMetrics.map((item) => item.maximumFaceEdgeRatio)),
    };
  } catch (error) {
    return {
      characterId: sourceRecord?.characterId ?? fallbackId,
      modelDirectory: modelDir,
      classification: 'indeterminate',
      deploymentSafe: false,
      sourceBinding: sourceRecord ?? null,
      error: `${error.name}: ${error.message}`,
      stack: error.stack,
    };
  } finally {
    if (root) disposeRoot(root);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const modelRoot = resolve(args.modelRoot);
  const selected = new Set(args.characters);
  const sourceAudit = args.sourceAudit ? JSON.parse(readFileSync(args.sourceAudit, 'utf8')) : null;
  const sourceByCharacter = new Map(
    (sourceAudit?.characters ?? []).map((item) => [String(item.characterId), item]),
  );
  const directories = readdirSync(modelRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('chara_'))
    .map((entry) => join(modelRoot, entry.name))
    .sort();
  const records = [];
  for (const [index, modelDir] of directories.entries()) {
    const fallbackId = basename(modelDir).replace(/^chara_/, '').replace(/_battle_unit$/, '');
    if (selected.size && !selected.has(fallbackId)) continue;
    const record = auditCharacter(modelDir, sourceByCharacter.get(fallbackId));
    records.push(record);
    process.stdout.write(
      `[${index + 1}/${directories.length}] ${record.characterId} ${record.classification} ` +
      `hairMax=${record.maximumHairEdgeRatio ?? 'n/a'}\n`,
    );
  }
  const counts = {};
  for (const record of records) counts[record.classification] = (counts[record.classification] ?? 0) + 1;
  const blockers = records.filter((item) => !item.deploymentSafe);
  const hardBlockers = records.filter((item) => item.hardReleaseBlocker || item.classification === 'indeterminate');
  const visualReviews = records.filter((item) => item.classification === 'native-visual-review');
  const output = {
    schema: 'magia-home-animation-skinning-integrity-audit-v1',
    releaseProfile: 'jp-android-3.13.0',
    unityVersion: '2022.3.62f2',
    modelRoot,
    sourceAudit: args.sourceAudit ? resolve(args.sourceAudit) : null,
    thresholds: {
      visualReviewEdgeRatio: EDGE_RATIO_WARNING,
      visualReviewMinimumEdgesBeyondRatio: EDGE_COUNT_WARNING,
      hardBlockerEdgeRatio: EDGE_RATIO_HARD_BLOCKER,
      hardBlockerFractionBeyondVisualReviewRatio: EDGE_FRACTION_HARD_BLOCKER,
      exactPathOnly: true,
      nearestParentFallbackAllowed: false,
    },
    summary: {
      characterCount: records.length,
      classificationCounts: counts,
      deploymentSafeCount: records.length - blockers.length,
      blockerCount: blockers.length,
      hardBlockerCount: hardBlockers.length,
      nativeVisualReviewCount: visualReviews.length,
      maximumHairEdgeRatio: Math.max(0, ...records.map((item) => item.maximumHairEdgeRatio ?? 0)),
      maximumFaceEdgeRatio: Math.max(0, ...records.map((item) => item.maximumFaceEdgeRatio ?? 0)),
    },
    characters: records,
  };
  writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(output.summary)}\n`);
  if (blockers.length && !args.allowBlockers) process.exitCode = 2;
}

main();
