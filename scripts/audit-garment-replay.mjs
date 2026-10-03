// Offline, implementation-aware audit of held garment fixtures. No browser,
// production toggle, source asset mutation or visual acceptance is performed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { StableGarmentContacts } from '../src/viewer/garmentContacts.ts'

export function loadGarmentFixture(file) {
    const bytes = fs.readFileSync(file), data = JSON.parse(gunzipSync(bytes))
    const nodes = data.shape.nodes.map(n => n.bone ? new THREE.Bone() : new THREE.Group())
    for (const row of data.shape.meshes) {
        const geometry = new THREE.BufferGeometry()
        for (const [key, attr] of Object.entries(row.attrs)) geometry.setAttribute(key, key === 'skinIndex'
            ? new THREE.Uint16BufferAttribute(attr.data, attr.size) : new THREE.Float32BufferAttribute(attr.data, attr.size))
        if (row.index) geometry.setIndex(row.index)
        nodes[row.node] = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
    }
    for (const [i, node] of nodes.entries()) {
        const row = data.shape.nodes[i]
        node.name = row.name; node.position.fromArray(row.position)
        node.quaternion.fromArray(row.quaternion); node.scale.fromArray(row.scale)
        if (row.parent >= 0) { assert.ok(nodes[row.parent]); nodes[row.parent].add(node) }
    }
    const root = nodes[0]; root.updateMatrixWorld(true)
    for (const row of data.shape.meshes) {
        assert.ok(row.bones.every(i => Number.isInteger(i) && nodes[i]?.isBone))
        const mesh = nodes[row.node]; mesh.bindMode = row.bindMode
        mesh.bind(new THREE.Skeleton(row.bones.map(i => nodes[i]), row.inverses.map(a => new THREE.Matrix4().fromArray(a))), new THREE.Matrix4().fromArray(row.bind))
    }
    root.updateMatrixWorld(true)
    return { data, nodes, root, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export function applyGarmentFrame(fixture, frame) {
    assert.equal(frame.transforms.length, fixture.nodes.length * 10)
    assert.ok(frame.transforms.every(Number.isFinite), 'non-finite fixture pose')
    for (const [i, node] of fixture.nodes.entries()) {
        const k = i * 10; node.position.fromArray(frame.transforms, k)
        node.quaternion.fromArray(frame.transforms, k + 3); node.scale.fromArray(frame.transforms, k + 7)
    }
    fixture.root.updateMatrixWorld(true)
}

// Counter increments only after two actual positions have been compared.
export function recordSkinComparison(measurement, cached, actual, tolerance = 1e-5) {
    assert.ok(cached && actual, 'missing skin sample')
    const error = cached.distanceTo(actual)
    assert.ok(Number.isFinite(error), 'non-finite skin sample error')
    measurement.count++; measurement.maxError = Math.max(measurement.maxError, error)
    assert.ok(error < tolerance, `skin cache differs from Three: ${error}`)
}

export function auditGarmentFixture(file) {
    const fixture = loadGarmentFixture(file)
    const meshes = fixture.nodes.filter(node => node.isSkinnedMesh)
    const originals = meshes.map(mesh => ({ mesh, geometry: mesh.geometry, base: mesh.geometry.getAttribute('position').array.slice() }))
    const solver = new StableGarmentContacts(fixture.root)
    const result = { file: path.resolve(file), sha256: fixture.sha256, rows: [] }
    try {
        // Deliberately fail on an unsupported fixture instead of passing zero probes.
        assert.ok(solver.diagnostics.supported && solver.surface?.vertices.length > 0)
        const probes = solver.surface.vertices.flatMap(vertex => vertex.indices.map(index => ({ mesh: vertex.mesh, index })))
        const movable = new Map(meshes.map(mesh => [mesh, new Set()]))
        for (const vertex of solver.surface.vertices) if (vertex.node) for (const index of vertex.indices) movable.get(vertex.mesh).add(index)
        const point = new THREE.Vector3()
        for (const [mode, frames] of Object.entries(fixture.data.modes)) {
            assert.ok(frames.length > 0); solver.restore(true)
            const row = { mode, frames: frames.length, durationSeconds: frames.reduce((sum, frame) => sum + frame.dt, 0), nativeSkin: { count: 0, maxError: 0 }, correctedSkin: { count: 0, maxError: 0 }, protectedPositionComponents: 0, protectedPoseComponents: 0, correctedVertices: 0, worsenedFrames: [], maxBeforeDepth: 0, maxAfterDepth: 0, maxTriangleDepth: 0, times: [] }
            for (const [frameIndex, frame] of frames.entries()) {
                solver.restore(); applyGarmentFrame(fixture, frame)
                const poses = fixture.nodes.map(node => [...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()])
                const native = probes.map(({mesh, index}) => mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld))
                const begin = performance.now(), stats = solver.solve(true, () => false, frame.dt)
                row.times.push(performance.now() - begin)
                assert.ok(stats.surface, 'no surface was evaluated')
                for (const [i, {mesh, index}] of probes.entries()) {
                    recordSkinComparison(row.nativeSkin, solver.surface.sampledPosition(mesh, index, false), native[i])
                    recordSkinComparison(row.correctedSkin, solver.surface.sampledPosition(mesh, index, true), mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld))
                }
                for (const [i, node] of fixture.nodes.entries()) {
                    const actual = [...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()]
                    assert.deepEqual(actual, poses[i], `body/cloth transform changed: ${node.name}`)
                    row.protectedPoseComponents += actual.length
                }
                for (const {mesh, base} of originals) {
                    const actual = mesh.geometry.getAttribute('position').array
                    assert.equal(actual.length, base.length)
                    for (let j = 0; j < base.length; j++) if (!movable.get(mesh).has(Math.floor(j / 3))) {
                        assert.equal(actual[j], base[j], `non-garment vertex changed: ${mesh.name}:${Math.floor(j / 3)}`)
                        row.protectedPositionComponents++
                    }
                }
                row.correctedVertices += stats.surface.correctedVertices
                row.maxBeforeDepth = Math.max(row.maxBeforeDepth, stats.beforeDepth)
                row.maxAfterDepth = Math.max(row.maxAfterDepth, stats.afterDepth)
                row.maxTriangleDepth = Math.max(row.maxTriangleDepth, stats.surface.remainingDepth)
                if (stats.afterDepth > stats.beforeDepth + 1e-5) row.worsenedFrames.push({ frame: frameIndex, before: stats.beforeDepth, after: stats.afterDepth })
            }
            assert.equal(row.nativeSkin.count, probes.length * frames.length)
            assert.equal(row.correctedSkin.count, row.nativeSkin.count)
            assert.ok(row.nativeSkin.count > 0 && row.protectedPoseComponents > 0 && row.protectedPositionComponents > 0)
            row.times.sort((a, b) => a - b)
            row.p95SolverMs = row.times[Math.floor(row.times.length * .95)]
            row.medianSolverMs = row.times[Math.floor(row.times.length / 2)]; delete row.times
            solver.restore(true)
            for (const {mesh, base} of originals) assert.deepEqual(mesh.geometry.getAttribute('position').array, base, 'opt-out must restore exact native vertices')
            row.exactRestore = true; result.rows.push(row)
        }
    } finally { solver.dispose() }
    for (const {mesh, geometry, base} of originals) {
        assert.equal(mesh.geometry, geometry, 'dispose must restore original geometry identity')
        assert.deepEqual(geometry.getAttribute('position').array, base, 'source geometry changed')
    }
    result.geometryRestored = true
    // Only numerical replay evidence; held fixtures contain no materials,
    // outline passes, active morphs or confirmed complete locomotion cycles.
    result.visualAcceptance = 'NOT_TESTED'
    return result
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2), output = args.shift()
    assert.ok(output && args.length, 'Usage: node scripts/audit-garment-replay.mjs REPORT.json FIXTURE.json.gz [...]')
    const report = { scope: 'Held-pose numerical replay, not live visual or full-cycle acceptance', results: [], error: null }
    try {
        for (const file of args) { const result = auditGarmentFixture(file); report.results.push(result); console.log(JSON.stringify(result)) }
    } catch (error) { report.error = error.stack; process.exitCode = 1; console.error(error.stack) }
    finally { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n') }
}
