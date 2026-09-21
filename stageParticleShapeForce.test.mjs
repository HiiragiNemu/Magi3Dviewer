import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import * as THREE from 'three'
import ts from 'typescript'

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const authorityRoot = join(
    repositoryRoot,
    'artifacts',
    'research',
    '20260827-particle-shape-force-authority',
)
const authority = JSON.parse(readFileSync(join(
    authorityRoot,
    'particle-shape-force-field-contract.v1.json',
), 'utf8'))
const bounded = JSON.parse(readFileSync(join(
    authorityRoot,
    'bounded-authority-records.v1.json',
), 'utf8'))
const fixtures = JSON.parse(readFileSync(join(
    authorityRoot,
    'representative-fixtures.v1.json',
), 'utf8'))

const nonce = `${process.pid}-${Date.now()}`
const hierarchySourcePath = join(repositoryRoot, 'src', 'viewer', 'stageHierarchy.ts')
const hierarchyPath = join(repositoryRoot, `.stage-shape-force-hierarchy-${nonce}.mjs`)
const particleSourcePath = join(repositoryRoot, 'src', 'viewer', 'stageParticles.ts')
const particlePath = join(repositoryRoot, `.stage-shape-force-particles-${nonce}.mjs`)

const compile = (source, fileName) => ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
    },
    fileName,
}).outputText

writeFileSync(
    hierarchyPath,
    compile(readFileSync(hierarchySourcePath, 'utf8'), hierarchySourcePath),
    'utf8',
)
const particleSource = readFileSync(particleSourcePath, 'utf8')
    .replace("'./stageHierarchy'", `'./${basename(hierarchyPath)}'`)
    .replace(
        "'magia-exedra-character-three/coordinateSpace'",
        "'./magia-exedra-character-three/coordinateSpace.ts'",
    )
writeFileSync(particlePath, compile(particleSource, particleSourcePath), 'utf8')
const particles = await import(pathToFileURL(particlePath).href)

after(() => {
    rmSync(hierarchyPath, { force: true })
    rmSync(particlePath, { force: true })
})

const constant = scalar => ({ minMaxState: 0, minScalar: scalar, scalar })
const shape = (type, extra = {}) => ({
    enabled: true,
    type,
    m_Position: [0, 0, 0],
    m_Rotation: [0, 0, 0],
    m_Scale: [1, 1, 1],
    radius: { value: 1 },
    radiusThickness: 1,
    donutRadius: 0.25,
    arc: { mode: 0, spread: 0, value: 360, speed: constant(1) },
    randomDirectionAmount: 0,
    sphericalDirectionAmount: 0,
    randomPositionAmount: 0,
    ...extra,
})

const near = (actual, expected, epsilon = 1e-6) => {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `${actual} != ${expected} within ${epsilon}`,
    )
}

test('bounded authority remains 399 profiles / 7128 systems with exact target counts', () => {
    assert.equal(authority.scope.sceneProfileCount, 399)
    assert.equal(authority.scope.particleSystemCount, 7128)
    assert.deepEqual(authority.boundedCorpus.shapeCounts, {
        2: 16,
        16: 3,
        17: 135,
        18: 119,
    })
    assert.equal(authority.boundedCorpus.shapeTotal, 273)
    assert.equal(authority.boundedCorpus.forceCount, 215)
    assert.deepEqual(authority.boundedCorpus.forceWorldSpaceCounts, {
        false: 201,
        true: 14,
    })
    assert.equal(bounded.records.length, 460)
    assert.equal(authority.currentConsumerGap.resourceDataMissing, false)
})

test('Hemisphere, BoxEdge, Donut and Rectangle sample their serialized geometry', () => {
    for (let birthIndex = 0; birthIndex < 64; birthIndex++) {
        const hemisphere = particles.sampleStageParticleShape(shape(2, {
            radius: { value: 10 },
            radiusThickness: 0.3,
        }), 123, birthIndex)
        const hemispherePosition = new THREE.Vector3(...hemisphere.position)
        assert.ok(hemispherePosition.z >= -1e-8)
        assert.ok(hemispherePosition.length() >= 7 - 1e-8)
        assert.ok(hemispherePosition.length() <= 10 + 1e-8)
        near(new THREE.Vector3(...hemisphere.direction).length(), 1)

        const box = particles.sampleStageParticleShape(shape(16, {
            m_Scale: [10, 4, 2],
        }), 456, birthIndex)
        const absolute = box.position.map(Math.abs)
        const fixedCoordinates = [
            Math.abs(absolute[0] - 5) <= 1e-8,
            Math.abs(absolute[1] - 2) <= 1e-8,
            Math.abs(absolute[2] - 1) <= 1e-8,
        ].filter(Boolean).length
        assert.equal(fixedCoordinates, 2)

        const donut = particles.sampleStageParticleShape(shape(17, {
            radius: { value: 3 },
            donutRadius: 1,
        }), 789, birthIndex)
        const donutPosition = new THREE.Vector3(...donut.position)
        const crossSectionDistance = Math.hypot(
            Math.hypot(donutPosition.x, donutPosition.y) - 3,
            donutPosition.z,
        )
        assert.ok(crossSectionDistance <= 1 + 1e-8)

        const rectangle = particles.sampleStageParticleShape(shape(18, {
            m_Scale: [10, 4, 9],
        }), 987, birthIndex)
        assert.ok(Math.abs(rectangle.position[0]) <= 5 + 1e-8)
        assert.ok(Math.abs(rectangle.position[1]) <= 2 + 1e-8)
        near(rectangle.position[2], 0)
    }
})

test('shape direction and position modifiers are deterministic and serialized-field driven', () => {
    const baselineShape = shape(18, { m_Scale: [3, 2, 1] })
    const modifiedShape = {
        ...baselineShape,
        randomDirectionAmount: 0.75,
        sphericalDirectionAmount: 0.4,
        randomPositionAmount: 0.6,
    }
    const first = particles.sampleStageParticleShape(modifiedShape, 2468, 17)
    const second = particles.sampleStageParticleShape(modifiedShape, 2468, 17)
    const baseline = particles.sampleStageParticleShape(baselineShape, 2468, 17)
    assert.deepEqual(first, second)
    assert.notDeepEqual(first.position, baseline.position)
    assert.notDeepEqual(first.direction, baseline.direction)
    near(new THREE.Vector3(...first.direction).length(), 1)

    const officialRectangle = fixtures.fixtures['shape-18-rectangle']
    const officialSample = particles.sampleStageParticleShape(
        officialRectangle.shape,
        606001,
        9,
    )
    assert.ok(officialSample.position.every(Number.isFinite))
    assert.ok(officialSample.direction.every(Number.isFinite))
})

test('ForceOverLifetime keeps local acceleration and applies inverse anchor linear basis in world mode', () => {
    const localForce = {
        enabled: true,
        inWorldSpace: false,
        randomizePerFrame: false,
        x: constant(2),
        y: constant(3),
        z: constant(4),
    }
    assert.deepEqual(
        particles.evaluateStageParticleForceAcceleration(localForce, 7, 11, 0.5),
        [-2, 3, 4],
    )

    const anchor = new THREE.Object3D()
    anchor.rotation.set(0.25, -0.4, 0.6, 'ZXY')
    anchor.scale.set(2, 3, 4)
    anchor.updateMatrixWorld(true)
    const worldForce = { ...localForce, inWorldSpace: true }
    const expected = new THREE.Vector3(-2, 3, 4).applyMatrix3(
        new THREE.Matrix3().setFromMatrix4(anchor.matrixWorld.clone().invert()),
    )
    const actual = particles.evaluateStageParticleForceAcceleration(
        worldForce,
        7,
        11,
        0.5,
        anchor,
    )
    actual.forEach((value, index) => near(value, expected.getComponent(index)))
    assert.notEqual(new THREE.Vector3(...actual).length(), 1)
})

test('force acceleration expands the particle speed bound by |a|max * lifetime', () => {
    const preset = {
        initial: {
            startSpeed: constant(1),
            gravityModifier: constant(0),
        },
        modules: {
            forceOverLifetime: {
                enabled: true,
                x: constant(3),
                y: constant(4),
                z: constant(0),
            },
        },
    }
    near(particles.maximumParticleSpeedBound(preset, 2), 11)
})

test('runtime diagnostics consume shape 18 and force with literal 0.5*a*t^2 displacement', () => {
    const root = new THREE.Group()
    root.name = 'Root'
    const anchor = new THREE.Group()
    anchor.name = 'Particle'
    root.add(anchor)
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    texture.needsUpdate = true
    texture.userData.stageTextureBinding = { url: '/particle.png' }

    const force = {
        enabled: true,
        inWorldSpace: false,
        randomizePerFrame: false,
        x: constant(0),
        y: constant(2),
        z: constant(0),
    }
    const particleShape = shape(18, { m_Scale: [2, 2, 1] })
    const preset = {
        id: 'preset',
        duration: 2,
        simulationSpeed: 1,
        looping: false,
        prewarm: false,
        playOnAwake: true,
        autoRandomSeed: false,
        randomSeed: 1357,
        moveWithTransform: 0,
        scalingMode: 0,
        initial: {
            maxNumParticles: 1,
            startLifetime: constant(2),
            startSpeed: constant(0),
            gravityModifier: constant(0),
            startSize: constant(1),
            startRotation: constant(0),
            startColor: { maxColor: [1, 1, 1, 1] },
        },
        emission: {
            enabled: true,
            rateOverTime: constant(0),
            m_Bursts: [{
                countCurve: constant(1),
                cycleCount: 1,
                probability: 1,
                repeatInterval: 0,
                time: 0,
            }],
        },
        shape: particleShape,
        modules: { forceOverLifetime: force },
        renderer: { sortingOrder: 0 },
    }
    const controller = new particles.StageParticleRuntimeController(
        root,
        [preset],
        [{
            pathID: '1',
            hierarchyPath: 'Root/Particle',
            active: true,
            presetId: 'preset',
            materials: ['particle-material'],
        }],
        [{
            materialName: 'particle-material',
            transparent: true,
            textures: { base: { url: '/particle.png' } },
        }],
        [texture],
    )
    const debug = controller.getDebugState()
    assert.deepEqual(debug.unsupportedShapeTypes, [])
    assert.deepEqual(debug.unsupportedModules, [])
    assert.equal(debug.forceOverLifetimeSystemCount, 1)
    assert.equal(debug.forceOverLifetimeAppliedCount, 1)

    controller.update(0.5)
    const actual = [...anchor.children[0].geometry.getAttribute('position').array.slice(0, 3)]
    const baseline = particles.sampleStageParticleShape(
        particleShape,
        preset.randomSeed,
        0x40000000,
        0,
        0,
    ).position
    near(actual[0], baseline[0])
    near(actual[1], baseline[1] + 0.5 * 2 * 0.5 * 0.5)
    near(actual[2], baseline[2])

    controller.dispose()
    texture.dispose()
})
