import assert from 'node:assert/strict'
import test from 'node:test'
import { Object3D, Vector3 } from 'three'
import { solveChainIK } from './src/viewer/performanceEditor/pose.ts'
import fs from 'node:fs'

function chain(count = 5) {
  const root = new Object3D(); let parent = root; const nodes = [root]
  for (let index = 1; index < count; index += 1) {
    const node = new Object3D(); node.position.set(1, 0, 0); parent.add(node); parent = node; nodes.push(node)
  }
  root.updateWorldMatrix(true, true); return nodes
}

test('four-plus-link chain reaches bounded target and preserves segment lengths', () => {
  const nodes = chain(5); const before = nodes.slice(1).map((node, index) => node.getWorldPosition(new Vector3()).distanceTo(nodes[index].getWorldPosition(new Vector3())))
  const result = solveChainIK(nodes, new Vector3(2.8, 1.2, 0)); assert.equal(result.status, 'ready')
  nodes[0].updateWorldMatrix(true, true)
  const end = nodes.at(-1).getWorldPosition(new Vector3()); assert.ok(end.distanceTo(new Vector3(2.8, 1.2, 0)) < 1e-6)
  const after = nodes.slice(1).map((node, index) => node.getWorldPosition(new Vector3()).distanceTo(nodes[index].getWorldPosition(new Vector3())))
  after.forEach((value, index) => assert.ok(Math.abs(value - before[index]) < 1e-9))
})

test('invalid/stale-style input is isolated and rolls back exactly', () => {
  const nodes = chain(5); const before = nodes.map(node => node.quaternion.toArray())
  const result = solveChainIK(nodes, new Vector3(Number.NaN, 0, 0)); assert.equal(result.status, 'unavailable')
  assert.deepEqual(nodes.map(node => node.quaternion.toArray()), before)
  assert.equal(solveChainIK([nodes[0], nodes[2], nodes[3]], new Vector3(1, 0, 0)).status, 'unavailable')
  assert.deepEqual(nodes.map(node => node.quaternion.toArray()), before)
})

test('runtime keeps detached evaluator and generation guards', () => {
  const source = fs.readFileSync(new URL('./src/viewer/performanceEditor/runtime.ts', import.meta.url), 'utf8')
  assert.match(source, /if \(!actor\.current \|\| !active\.lease\.active \|\| this\.active\.get\(actorKey\) !== active\)/)
  assert.match(source, /resolveJointIKChain\(bone, new Set\(actor.bones.values\(\)\)\)/)
  assert.match(source, /solveTwoLinkIK\(stagedChain\[0\], stagedChain\[1\], stagedChain\[2\], target/)
  assert.match(source, /const staged = clonePose\(active\.manual!\)/)
})
