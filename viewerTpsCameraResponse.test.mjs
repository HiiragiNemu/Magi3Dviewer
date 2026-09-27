import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const root = path.dirname(fileURLToPath(import.meta.url));
const THREE = require(root + '/node_modules/three');
const ts = require(root + '/node_modules/typescript');
const source = fs.readFileSync(path.join(root, 'src/viewer/viewerLocomotion.ts'), 'utf8');
function fixture() {
  const input = source.slice(source.indexOf('let cameraYawUnwrapped ='), source.indexOf('function objectIsWorldVisible('));
  const update = source.slice(source.indexOf('function updateTpsCamera('), source.indexOf('function objectHierarchyPath('));
  const scene = {camera: new THREE.PerspectiveCamera(), controls: {enabled: true, target: new THREE.Vector3()}};
  const binding = {character: {object: new THREE.Group()}};
  scene.camera.position.set(0, 1.05 + Math.sin(Math.PI/10)*7.5, Math.cos(Math.PI/10)*7.5);
  const compiled = ts.transpileModule(input + update, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  const api = Function('THREE', 'scene', 'binding', compiled + `
    return {input: (x,y) => applyTpsCameraPointerDelta(x,y,'drag-fallback'),
      step: dt => updateTpsCamera(binding,dt),
      state: () => ({yaw: cameraYawUnwrapped, target: cameraYawTargetUnwrapped,
        pitch: cameraPitch, pitchTarget: cameraPitchTarget, position: scene.camera.position.toArray()}),
      zoom: value => { cameraDistanceTarget = value; }};
  `)(THREE, scene, binding);
  return {api, scene, binding};
}
for (const fps of [12,30,60,144]) {
  test(`${fps} FPS: small input consumed next frame, no angular or position catch-up`, () => {
    const {api} = fixture(); api.step(1/fps); api.input(10,8); api.step(1/fps);
    const first = api.state();
    assert.ok(Math.abs(first.yaw - first.target) < 1e-12, 'queued yaw remains after render');
    assert.ok(Math.abs(first.pitch - first.pitchTarget) < 1e-12, 'queued pitch remains after render');
    for (let i=0;i<120;i++) api.step(1/fps);
    assert.deepEqual(api.state(), first, 'camera continues to move after input has stopped');
    assert.ok(Math.abs(first.yaw + 0.018) < 1e-12);
  });
}
test('same travel is independent of render/event batching', () => {
  const a=fixture().api, b=fixture().api;
  for(let i=0;i<90;i++){ a.input(10,0); b.input(10,0); b.step(1/60); }
  a.step(1/12);
  assert.ok(Math.abs(a.state().target-b.state().target)<1e-12);
});
test('wheel target has no delayed dolly and preserves exact camera target', () => {
  const {api,scene}=fixture(); api.zoom(1.8); api.step(1/60);
  assert.ok(Math.abs(scene.camera.position.distanceTo(scene.controls.target)-1.8)<1e-12);
  const first=api.state(); api.step(1/12); assert.deepEqual(api.state(),first);
});
test('both camera angles remain unwrapped across multiple full turns', () => {
  const {api}=fixture(); for(let i=0;i<1000;i++){api.input(40,40);api.step(1/60)}
  assert.ok(Math.abs(api.state().yaw+72)<1e-8);
  assert.ok(Math.abs(api.state().pitch-(THREE.MathUtils.degToRad(18)+60))<1e-8);
});
