import * as THREE from 'three'

import { unityWorldToViewerVector } from 'magia-exedra-character-three/coordinateSpace'
import type { BackgroundDepthConsumer } from 'magia-exedra-character-three/scene/backgroundDepth'
import type { StageMaterialBinding } from './stageMaterialBindings'
import { resolveStageHierarchyPath } from './stageHierarchy'
import type {
    StageParticleMeshProfile,
    StageParticlePresetProfile,
    StageParticleSystemProfile,
} from './stageRuntime'

export interface StageParticleRuntimeDebugState {
    declaredSystemCount: number
    inactiveSystemCount: number
    nonDrawableSystemCount: number
    drawableSystemCount: number
    requestedSystemCount: number
    activeSystemCount: number
    activeParticleCount: number
    missingAnchorPaths: string[]
    missingMaterialNames: string[]
    rendererModeCounts: Record<string, number>
    meshRendererSystemCount: number
    meshRendererAppliedCount: number
    noiseModuleSystemCount: number
    noiseModuleAppliedCount: number
    noiseQualityCounts: Record<string, number>
    forceOverLifetimeSystemCount: number
    forceOverLifetimeAppliedCount: number
    trailModuleSystemCount: number
    trailModuleAppliedCount: number
    activeTrailSegmentCount: number
    trailTextureModeCounts: Record<string, number>
    softParticleDeclaredSystemCount: number
    softParticleAppliedSystemCount: number
    softParticleDepthConsumerCount: number
    softParticleFields: Array<{
        hierarchyPath: string
        materialName: string
        materialSlot: number
        surfaceFadeNear: number
        surfaceFadeFar: number
        zTest: number
        depthRegistered: boolean
    }>
    depthFunctionCounts: Record<string, number>
    missingTrailMaterialNames: string[]
    unsupportedTrailModes: Array<{ hierarchyPath: string; mode: number }>
    missingRendererMeshPathIDs: string[]
    unsupportedShapeTypes: Array<{ hierarchyPath: string; type: number }>
    unsupportedModules: Array<{ hierarchyPath: string; modules: string[] }>
    carrierHierarchyFallbackCount: number
    serializedTransformFallbackCount: number
    randomSeedAuthority: 'serialized' | 'deterministic-auto-seed-substitute'
}

export interface OfficialParticleMaterialProfile {
    name: string
    validKeywords?: string[]
    invalidKeywords?: string[]
    textures?: Record<string, {
        url?: string
        scale?: number[]
        offset?: number[]
        pointer?: { pathID?: string; resolved?: boolean }
    }>
    floats?: Record<string, number>
    colors?: Record<string, unknown>
}

export interface StageParticleRuntimeOptions {
    /** ControlPlayableAsset activates disabled prefab systems at clip start. */
    forceActive?: boolean
    /** ControlPlayableAsset.UpdateParticle drives systems even when not awake. */
    forcePlayOnAwake?: boolean
    officialMaterials?: readonly OfficialParticleMaterialProfile[]
    particleMeshes?: readonly StageParticleMeshProfile[]
    depthRegistrar?: StageParticleDepthRegistrar
}

export interface StageParticleDepthRegistrar {
    registerBackgroundDepthConsumer(
        consumer: BackgroundDepthConsumer,
    ): () => void
}

interface ActiveParticleSystem {
    profile: StageParticleSystemProfile
    preset: StageParticlePresetProfile
    anchor: THREE.Object3D
    drawable: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
        | THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
    renderMode: 'billboard' | 'mesh'
    positions: THREE.BufferAttribute
    colors: THREE.BufferAttribute
    sizes: THREE.BufferAttribute
    rotations: THREE.BufferAttribute
    frames: THREE.BufferAttribute
    trail?: ActiveParticleTrail
    shapeVertices: THREE.Vector3[]
    seed: number
    continuousBirthTimes: number[]
    unsupportedModules: string[]
    unsupportedShapeType?: number
    usedCarrierHierarchyFallback: boolean
    usedSerializedTransformFallback: boolean
}

interface ActiveParticleTrail {
    drawable: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    coordinateParent: THREE.Object3D
    positions: THREE.BufferAttribute
    previous: THREE.BufferAttribute
    next: THREE.BufferAttribute
    sides: THREE.BufferAttribute
    widths: THREE.BufferAttribute
    colors: THREE.BufferAttribute
    uvs: THREE.BufferAttribute
    frames: THREE.BufferAttribute
    capacity: number
    materialName: string
}

interface ActiveTrailParticle {
    birthIndex: number
    birthTime: number
    shapePhase?: number
    age: number
    lifetime: number
    normalizedAge: number
    color: number[]
    size: number
}

type UnknownRecord = Record<string, unknown>

const supportedModules = new Set([
    'colorOverLifetime',
    'sizeOverLifetime',
    'rotationOverLifetime',
    'textureSheetAnimation',
    'velocityOverLifetime',
    'forceOverLifetime',
    'noise',
    'trails',
])

const supportedShapeTypes = new Set([0, 2, 4, 5, 6, 8, 10, 12, 16, 17, 18])

function record(value: unknown): UnknownRecord {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : {}
}

function finite(value: unknown, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function finiteInt(value: unknown, fallback = 0) {
    return Math.trunc(finite(value, fallback))
}

function tuple(value: unknown, fallback: readonly number[], length: number) {
    if (!Array.isArray(value)) return [...fallback]
    return Array.from(
        { length },
        (_, index) => finite(value[index], fallback[index] ?? 0),
    )
}

function hashString(value: string) {
    let hash = 2166136261
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
}

function random01(seed: number, index: number, salt: number) {
    let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ salt) >>> 0
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad)
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97)
    value ^= value >>> 15
    return (value >>> 0) / 0x1_0000_0000
}

function deterministicUnitVector(seed: number, index: number, salt: number) {
    const z = random01(seed, index, salt) * 2 - 1
    const azimuth = random01(seed, index, salt + 1) * Math.PI * 2
    const radial = Math.sqrt(Math.max(0, 1 - z * z))
    return new THREE.Vector3(
        Math.cos(azimuth) * radial,
        Math.sin(azimuth) * radial,
        z,
    )
}

function deterministicUnitBall(seed: number, index: number, salt: number) {
    return deterministicUnitVector(seed, index, salt).multiplyScalar(
        Math.cbrt(random01(seed, index, salt + 2)),
    )
}

function evaluateCurve(curveValue: unknown, time: number) {
    const keys = record(curveValue).m_Curve
    if (!Array.isArray(keys) || keys.length === 0) return 1
    const normalized = Math.min(1, Math.max(0, time))
    const first = record(keys[0])
    const last = record(keys[keys.length - 1])
    if (normalized <= finite(first.time)) return finite(first.value)
    if (normalized >= finite(last.time, 1)) return finite(last.value)
    for (let index = 0; index < keys.length - 1; index++) {
        const left = record(keys[index])
        const right = record(keys[index + 1])
        const leftTime = finite(left.time)
        const rightTime = finite(right.time, 1)
        if (normalized > rightTime) continue
        const duration = Math.max(1e-8, rightTime - leftTime)
        const t = (normalized - leftTime) / duration
        const t2 = t * t
        const t3 = t2 * t
        return (2 * t3 - 3 * t2 + 1) * finite(left.value)
            + (t3 - 2 * t2 + t) * duration * finite(left.outSlope)
            + (-2 * t3 + 3 * t2) * finite(right.value)
            + (t3 - t2) * duration * finite(right.inSlope)
    }
    return finite(last.value)
}

/** Evaluate Unity ParticleSystem.MinMaxCurve modes 0..3. */
export function evaluateStageMinMaxCurve(
    value: unknown,
    random: number,
    normalizedTime = 0,
) {
    const profile = record(value)
    const mode = finiteInt(profile.minMaxState)
    const maximum = finite(profile.scalar)
    const minimum = finite(profile.minScalar, maximum)
    if (mode === 1) {
        return evaluateCurve(profile.maxCurve, normalizedTime) * maximum
    }
    if (mode === 2) {
        const low = evaluateCurve(profile.minCurve, normalizedTime) * minimum
        const high = evaluateCurve(profile.maxCurve, normalizedTime) * maximum
        return THREE.MathUtils.lerp(low, high, random)
    }
    if (mode === 3) return THREE.MathUtils.lerp(minimum, maximum, random)
    return maximum
}

function particleNoiseFade(value: number) {
    return value * value * value * (value * (value * 6 - 15) + 10)
}

function particleNoiseHash(x: number, y: number, z: number, seed: number) {
    let value = (
        seed
        ^ Math.imul(x, 0x8da6b343)
        ^ Math.imul(y, 0xd8163841)
        ^ Math.imul(z, 0xcb1ab31f)
    ) >>> 0
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad)
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97)
    return (value ^ (value >>> 15)) >>> 0
}

function particleGradientNoise1D(value: number, seed: number) {
    const cell = Math.floor(value)
    const offset = value - cell
    const leftGradient = particleNoiseHash(cell, 0, 0, seed) & 1 ? 1 : -1
    const rightGradient = particleNoiseHash(cell + 1, 0, 0, seed) & 1 ? 1 : -1
    return THREE.MathUtils.lerp(
        leftGradient * offset,
        rightGradient * (offset - 1),
        particleNoiseFade(offset),
    ) * 2
}

const particleGradient2D = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [Math.SQRT1_2, Math.SQRT1_2],
    [-Math.SQRT1_2, Math.SQRT1_2],
    [Math.SQRT1_2, -Math.SQRT1_2],
    [-Math.SQRT1_2, -Math.SQRT1_2],
] as const

function particleGradientNoise2D(x: number, y: number, seed: number) {
    const cellX = Math.floor(x)
    const cellY = Math.floor(y)
    const offsetX = x - cellX
    const offsetY = y - cellY
    const dot = (dx: number, dy: number) => {
        const gradient = particleGradient2D[
            particleNoiseHash(cellX + dx, cellY + dy, 0, seed)
            % particleGradient2D.length
        ]!
        return gradient[0] * (offsetX - dx) + gradient[1] * (offsetY - dy)
    }
    const fadeX = particleNoiseFade(offsetX)
    const fadeY = particleNoiseFade(offsetY)
    return THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(dot(0, 0), dot(1, 0), fadeX),
        THREE.MathUtils.lerp(dot(0, 1), dot(1, 1), fadeX),
        fadeY,
    ) * Math.SQRT2
}

const particleGradient3D = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
] as const

function particleGradientNoise3D(x: number, y: number, z: number, seed: number) {
    const cellX = Math.floor(x)
    const cellY = Math.floor(y)
    const cellZ = Math.floor(z)
    const offsetX = x - cellX
    const offsetY = y - cellY
    const offsetZ = z - cellZ
    const dot = (dx: number, dy: number, dz: number) => {
        const gradient = particleGradient3D[
            particleNoiseHash(cellX + dx, cellY + dy, cellZ + dz, seed)
            % particleGradient3D.length
        ]!
        return (
            gradient[0] * (offsetX - dx)
            + gradient[1] * (offsetY - dy)
            + gradient[2] * (offsetZ - dz)
        )
    }
    const fadeX = particleNoiseFade(offsetX)
    const fadeY = particleNoiseFade(offsetY)
    const fadeZ = particleNoiseFade(offsetZ)
    const lower = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(dot(0, 0, 0), dot(1, 0, 0), fadeX),
        THREE.MathUtils.lerp(dot(0, 1, 0), dot(1, 1, 0), fadeX),
        fadeY,
    )
    const upper = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(dot(0, 0, 1), dot(1, 0, 1), fadeX),
        THREE.MathUtils.lerp(dot(0, 1, 1), dot(1, 1, 1), fadeX),
        fadeY,
    )
    return THREE.MathUtils.lerp(lower, upper, fadeZ) * Math.SQRT1_2
}

function particleQualityNoise(
    position: THREE.Vector3,
    quality: number,
    seed: number,
    channel: number,
) {
    const channelSeed = (seed ^ Math.imul(channel + 1, 0x9e3779b1)) >>> 0
    if (quality <= 0) {
        const directions = [
            [0.577350269, 0.577350269, 0.577350269],
            [-0.707106781, 0.707106781, 0],
            [0.40824829, 0.40824829, -0.816496581],
        ] as const
        const direction = directions[channel % directions.length]!
        return particleGradientNoise1D(
            position.x * direction[0]
            + position.y * direction[1]
            + position.z * direction[2],
            channelSeed,
        )
    }
    if (quality === 1) {
        if (channel % 3 === 0) {
            return particleGradientNoise2D(
                position.x + position.z * 0.5,
                position.y + position.z * 0.866025404,
                channelSeed,
            )
        }
        if (channel % 3 === 1) {
            return particleGradientNoise2D(
                position.y + position.x * 0.5,
                position.z + position.x * 0.866025404,
                channelSeed,
            )
        }
        return particleGradientNoise2D(
            position.z + position.y * 0.5,
            position.x + position.y * 0.866025404,
            channelSeed,
        )
    }
    return particleGradientNoise3D(
        position.x,
        position.y,
        position.z,
        channelSeed,
    )
}

function particleCurlNoise(position: THREE.Vector3, quality: number, seed: number) {
    // Unity documents this module as Curl Noise built from Perlin samples.
    // Central differences preserve the divergence-free curl field while the
    // serialized quality selects the official 1D/2D/3D sampling class.
    const epsilon = 0.01
    const offset = new THREE.Vector3()
    const sample = (x: number, y: number, z: number, channel: number) => {
        offset.set(position.x + x, position.y + y, position.z + z)
        return particleQualityNoise(offset, quality, seed, channel)
    }
    const dFzDy = (sample(0, epsilon, 0, 2) - sample(0, -epsilon, 0, 2))
        / (2 * epsilon)
    const dFyDz = (sample(0, 0, epsilon, 1) - sample(0, 0, -epsilon, 1))
        / (2 * epsilon)
    const dFxDz = (sample(0, 0, epsilon, 0) - sample(0, 0, -epsilon, 0))
        / (2 * epsilon)
    const dFzDx = (sample(epsilon, 0, 0, 2) - sample(-epsilon, 0, 0, 2))
        / (2 * epsilon)
    const dFyDx = (sample(epsilon, 0, 0, 1) - sample(-epsilon, 0, 0, 1))
        / (2 * epsilon)
    const dFxDy = (sample(0, epsilon, 0, 0) - sample(0, -epsilon, 0, 0))
        / (2 * epsilon)
    return new THREE.Vector3(
        dFzDy - dFyDz,
        dFxDz - dFzDx,
        dFyDx - dFxDy,
    )
}

/**
 * Sample the serialized Unity ParticleSystem NoiseModule vector field.
 * Frequency scales the Perlin domain; damping cancels the proportional
 * strength increase caused by higher-frequency curl derivatives.
 */
export function sampleStageParticleCurlNoise(
    positionValue: readonly number[],
    fieldTime: number,
    noiseValue: unknown,
    seed: number,
    normalizedAge = 0,
    curveRandom = 0.5,
) {
    const noise = record(noiseValue)
    if (noise.enabled !== true) return [0, 0, 0] as [number, number, number]
    const baseFrequency = Math.max(1e-4, Math.abs(finite(noise.frequency, 1)))
    const scrollSpeed = evaluateStageMinMaxCurve(
        noise.scrollSpeed,
        curveRandom,
        normalizedAge,
    )
    const quality = THREE.MathUtils.clamp(finiteInt(noise.quality, 2), 0, 2)
    const octaves = THREE.MathUtils.clamp(finiteInt(noise.octaves, 1), 1, 4)
    const octaveMultiplier = finite(noise.octaveMultiplier, 0.5)
    const octaveScale = Math.max(1e-4, Math.abs(finite(noise.octaveScale, 2)))
    const position = new THREE.Vector3(
        finite(positionValue[0]),
        finite(positionValue[1]),
        finite(positionValue[2]),
    )
    const field = new THREE.Vector3()
    let layerFrequency = baseFrequency
    let layerAmplitude = 1
    for (let octave = 0; octave < octaves; octave++) {
        const scroll = scrollSpeed * fieldTime
        const domain = position.clone()
            .addScalar(scroll)
            .multiplyScalar(layerFrequency)
        const layer = particleCurlNoise(
            domain,
            quality,
            (seed ^ Math.imul(octave + 1, 0x85ebca6b)) >>> 0,
        )
        const derivativeScale = layerFrequency
        const dampingScale = noise.damping === true ? 1 / layerFrequency : 1
        field.addScaledVector(
            layer,
            layerAmplitude * derivativeScale * dampingScale,
        )
        layerAmplitude *= octaveMultiplier
        layerFrequency *= octaveScale
    }
    // Unity's remap curves consume the final signed noise value. Keep the
    // finite-difference curl in that canonical signed domain before applying
    // serialized Strength and Position/Rotation/Size Amount multipliers.
    field.set(
        THREE.MathUtils.clamp(field.x, -1, 1),
        THREE.MathUtils.clamp(field.y, -1, 1),
        THREE.MathUtils.clamp(field.z, -1, 1),
    )
    return field.toArray() as [number, number, number]
}

function evaluateParticleNoiseVector(
    noiseValue: unknown,
    position: THREE.Vector3,
    sampleTime: number,
    normalizedAge: number,
    seed: number,
    birthIndex: number,
) {
    const noise = record(noiseValue)
    const field = new THREE.Vector3(...sampleStageParticleCurlNoise(
        position.toArray(),
        sampleTime,
        noise,
        seed,
        normalizedAge,
        random01(seed, birthIndex, 60),
    ))
    if (noise.remapEnabled === true) {
        const remap = (value: number, curve: unknown) => evaluateStageMinMaxCurve(
            curve,
            0.5,
            THREE.MathUtils.clamp(value * 0.5 + 0.5, 0, 1),
        )
        field.set(
            remap(field.x, noise.remap),
            remap(field.y, noise.separateAxes === true ? noise.remapY : noise.remap),
            remap(field.z, noise.separateAxes === true ? noise.remapZ : noise.remap),
        )
    }
    const strengthX = evaluateStageMinMaxCurve(
        noise.strength,
        random01(seed, birthIndex, 61),
        normalizedAge,
    )
    const strengthY = noise.separateAxes === true
        ? evaluateStageMinMaxCurve(
            noise.strengthY,
            random01(seed, birthIndex, 62),
            normalizedAge,
        )
        : strengthX
    const strengthZ = noise.separateAxes === true
        ? evaluateStageMinMaxCurve(
            noise.strengthZ,
            random01(seed, birthIndex, 63),
            normalizedAge,
        )
        : strengthX
    return field.multiply(new THREE.Vector3(strengthX, strengthY, strengthZ))
}

function evaluateGradient(value: unknown, time: number) {
    const gradient = record(value)
    const normalized = Math.min(1, Math.max(0, time))
    const fixed = finiteInt(gradient.m_Mode) === 1
    const key = (index: number) => tuple(gradient[`key${index}`], [1, 1, 1, 1], 4)
    const sample = (
        prefix: 'ctime' | 'atime',
        countName: 'm_NumColorKeys' | 'm_NumAlphaKeys',
        component: number,
    ) => {
        const count = Math.min(8, Math.max(1, finiteInt(gradient[countName], 1)))
        let left = 0
        for (let index = 1; index < count; index++) {
            const rightTime = finite(gradient[`${prefix}${index}`]) / 65535
            if (normalized > rightTime) {
                left = index
                continue
            }
            const leftTime = finite(gradient[`${prefix}${left}`]) / 65535
            const leftValue = key(left)[component]
            if (fixed || rightTime <= leftTime) return leftValue
            return THREE.MathUtils.lerp(
                leftValue,
                key(index)[component],
                (normalized - leftTime) / (rightTime - leftTime),
            )
        }
        return key(left)[component]
    }
    return [
        sample('ctime', 'm_NumColorKeys', 0),
        sample('ctime', 'm_NumColorKeys', 1),
        sample('ctime', 'm_NumColorKeys', 2),
        sample('atime', 'm_NumAlphaKeys', 3),
    ]
}

/** Evaluate Unity ParticleSystem.MinMaxGradient modes 0..4. */
export function evaluateStageMinMaxGradient(
    value: unknown,
    random: number,
    normalizedTime = 0,
) {
    const profile = record(value)
    const mode = finiteInt(profile.minMaxState)
    const minimum = tuple(profile.minColor, [1, 1, 1, 1], 4)
    const maximum = tuple(profile.maxColor, [1, 1, 1, 1], 4)
    if (mode === 1) return evaluateGradient(profile.maxGradient, normalizedTime)
    if (mode === 2) {
        return maximum.map((component, index) =>
            THREE.MathUtils.lerp(minimum[index], component, random))
    }
    if (mode === 3) {
        const low = evaluateGradient(profile.minGradient, normalizedTime)
        const high = evaluateGradient(profile.maxGradient, normalizedTime)
        return high.map((component, index) =>
            THREE.MathUtils.lerp(low[index], component, random))
    }
    if (mode === 4) return evaluateGradient(profile.maxGradient, random)
    return maximum
}

function particleTexture(
    binding: StageMaterialBinding,
    textures: readonly THREE.Texture[],
) {
    const url = binding.textures?.base?.url
        ?? binding.baseMapUrl
        ?? binding.serializedTextures?._MainTex?.url
        ?? binding.serializedTextures?._BaseMap?.url
        ?? binding.serializedTextures?._Tex?.url
    if (!url) return undefined
    return textures.find(texture => {
        const source = texture.userData.stageTextureBinding as { url?: string } | undefined
        return source?.url === url || texture.name === `StageTexture:${url}`
    })
}

function createParticleFallbackTexture() {
    const texture = new THREE.DataTexture(
        new Uint8Array([255, 255, 255, 255]),
        1,
        1,
        THREE.RGBAFormat,
    )
    texture.name = 'StageParticle:SerializedWhiteFallback'
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    return texture
}

function decodeBase64Bytes(value: string) {
    const binary = globalThis.atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index)
    }
    return bytes
}

function decodeFloat32(value: string | undefined, expectedValues: number) {
    if (!value) return undefined
    const bytes = decodeBase64Bytes(value)
    if (bytes.byteLength !== expectedValues * 4) return undefined
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return Float32Array.from(
        { length: expectedValues },
        (_, index) => view.getFloat32(index * 4, true),
    )
}

function decodeParticleMeshGeometry(
    profile: StageParticleMeshProfile,
    maxParticles: number,
) {
    const positions = decodeFloat32(profile.positionsBase64, profile.vertexCount * 3)
    if (!positions) return undefined
    const uv0 = decodeFloat32(profile.uv0Base64, profile.vertexCount * 2)
        ?? new Float32Array(profile.vertexCount * 2)
    const colors = decodeFloat32(profile.colorsBase64, profile.vertexCount * 4)
        ?? Float32Array.from(
            { length: profile.vertexCount * 4 },
            () => 1,
        )
    const indexBytes = decodeBase64Bytes(profile.indicesBase64)
    const indexStride = profile.indexType === 'uint32' ? 4 : 2
    if (indexBytes.byteLength !== profile.indexCount * indexStride) return undefined
    const indexView = new DataView(
        indexBytes.buffer,
        indexBytes.byteOffset,
        indexBytes.byteLength,
    )
    const indices = profile.indexType === 'uint32'
        ? Uint32Array.from(
            { length: profile.indexCount },
            (_, index) => indexView.getUint32(index * 4, true),
        )
        : Uint16Array.from(
            { length: profile.indexCount },
            (_, index) => indexView.getUint16(index * 2, true),
        )
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv0, 2))
    geometry.setAttribute('stageMeshColor', new THREE.BufferAttribute(colors, 4))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    const particlePositions = new THREE.InstancedBufferAttribute(
        new Float32Array(maxParticles * 3),
        3,
    )
    const particleColors = new THREE.InstancedBufferAttribute(
        new Float32Array(maxParticles * 4),
        4,
    )
    const particleScales = new THREE.InstancedBufferAttribute(
        new Float32Array(maxParticles * 3),
        3,
    )
    const particleRotations = new THREE.InstancedBufferAttribute(
        new Float32Array(maxParticles * 4),
        4,
    )
    const particleFrames = new THREE.InstancedBufferAttribute(
        new Float32Array(maxParticles),
        1,
    )
    geometry.setAttribute('stagePosition', particlePositions)
    geometry.setAttribute('stageColor', particleColors)
    geometry.setAttribute('stageScale', particleScales)
    geometry.setAttribute('stageQuaternion', particleRotations)
    geometry.setAttribute('stageFrame', particleFrames)
    geometry.instanceCount = 0
    return {
        geometry,
        positions: particlePositions,
        colors: particleColors,
        sizes: particleScales,
        rotations: particleRotations,
        frames: particleFrames,
    }
}

function textureByUrl(url: string | undefined, textures: readonly THREE.Texture[]) {
    if (!url) return undefined
    return textures.find(texture => {
        const source = texture.userData.stageTextureBinding as { url?: string } | undefined
        return source?.url === url || texture.name === `StageTexture:${url}`
    })
}

function rgba(value: unknown, fallback: readonly number[]) {
    if (Array.isArray(value)) return tuple(value, fallback, 4)
    const source = record(value)
    return [
        finite(source.r, fallback[0]),
        finite(source.g, fallback[1]),
        finite(source.b, fallback[2]),
        finite(source.a, fallback[3]),
    ]
}

function officialTexture(
    material: OfficialParticleMaterialProfile | undefined,
    property: string,
    textures: readonly THREE.Texture[],
    fallback: THREE.Texture,
) {
    const profile = material?.textures?.[property]
    return {
        texture: textureByUrl(profile?.url, textures) ?? fallback,
        transform: new THREE.Vector4(
            finite(profile?.scale?.[0], 1),
            finite(profile?.scale?.[1], 1),
            finite(profile?.offset?.[0]),
            finite(profile?.offset?.[1]),
        ),
        present: Boolean(profile?.url),
    }
}

function unityBlendFactor(value: number): THREE.BlendingDstFactor | THREE.BlendingSrcFactor {
    const factors: Record<number, THREE.BlendingDstFactor | THREE.BlendingSrcFactor> = {
        0: THREE.ZeroFactor,
        1: THREE.OneFactor,
        2: THREE.DstColorFactor,
        3: THREE.SrcColorFactor,
        4: THREE.OneMinusDstColorFactor,
        5: THREE.SrcAlphaFactor,
        6: THREE.OneMinusSrcColorFactor,
        7: THREE.DstAlphaFactor,
        8: THREE.OneMinusDstAlphaFactor,
        9: THREE.SrcAlphaSaturateFactor,
        10: THREE.OneMinusSrcAlphaFactor,
    }
    return factors[value] ?? THREE.OneFactor
}

function unityDepthFunction(value: number): THREE.DepthModes {
    const functions: Record<number, THREE.DepthModes> = {
        1: THREE.NeverDepth,
        2: THREE.LessDepth,
        3: THREE.EqualDepth,
        4: THREE.LessEqualDepth,
        5: THREE.GreaterDepth,
        6: THREE.NotEqualDepth,
        7: THREE.GreaterEqualDepth,
        8: THREE.AlwaysDepth,
    }
    return functions[value] ?? THREE.LessEqualDepth
}

function unityDepthFunctionName(value: number) {
    return ({
        0: 'disabled',
        1: 'never',
        2: 'less',
        3: 'equal',
        4: 'less-equal',
        5: 'greater',
        6: 'not-equal',
        7: 'greater-equal',
        8: 'always',
    } as Record<number, string>)[value] ?? 'less-equal'
}

function officialSoftParticleState(
    official: OfficialParticleMaterialProfile | undefined,
) {
    const floats = official?.floats ?? {}
    const valid = official?.validKeywords?.includes('IS_SOFT_PARTICLE') === true
    const invalid = official?.invalidKeywords?.includes('IS_SOFT_PARTICLE') === true
    return {
        enabled: valid && !invalid && finite(floats._IsSoftParticle) > 0.5,
        surfaceFadeNear: finite(floats._SurfaceFadeNear),
        surfaceFadeFar: finite(floats._SurfaceFadeFar, 1),
        zTest: finiteInt(floats._ZTest, 4),
    }
}

function officialDissolveState(
    official: OfficialParticleMaterialProfile | undefined,
    texturePresent: boolean,
) {
    if (!official) return { enabled: texturePresent, progress: 1 }
    const floats = official.floats ?? {}
    const valid = official.validKeywords?.includes('IS_DISSOLVE') === true
    const invalid = official.invalidKeywords?.includes('IS_DISSOLVE') === true
    return {
        enabled: texturePresent && valid && !invalid
            && finite(floats._IsDissolve) > 0.5,
        progress: finite(floats._DissolveProgress, 1),
    }
}

function officialAlphaMaskState(
    official: OfficialParticleMaterialProfile | undefined,
    mainTexturePresent: boolean,
    secondTexturePresent: boolean,
) {
    const floats = official?.floats ?? {}
    const maskKeywordValid = official?.validKeywords?.includes('IS_MASK_TEX') === true
    const maskKeywordInvalid = official?.invalidKeywords?.includes('IS_MASK_TEX') === true
    return {
        mainGrayScale: finite(floats._AlphaIsGrayScale) > 0.5,
        secondGrayScale: finite(floats._AlphaIsGrayScale2) > 0.5,
        mainMaskTexture: mainTexturePresent && maskKeywordValid
            && !maskKeywordInvalid
            && finite(floats._IsMask) > 0.5
            && finite(floats._IsMaskTex) > 0.5,
        secondAlphaMask: secondTexturePresent
            && finite(floats._IsTex2AlphaMask) > 0.5,
    }
}

function syncParticleDepthCameraUniforms(
    material: THREE.ShaderMaterial,
    camera: THREE.Camera,
) {
    const depthCamera = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera
    material.uniforms.uCameraNear!.value = finite(depthCamera.near, 0.1)
    material.uniforms.uCameraFar!.value = finite(depthCamera.far, 1000)
    material.uniforms.uOrthographic!.value =
        (depthCamera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0
}

function particleMaterial(
    binding: StageMaterialBinding,
    texture: THREE.Texture,
    preset: StageParticlePresetProfile,
    official: OfficialParticleMaterialProfile | undefined,
    textures: readonly THREE.Texture[],
    renderMode: 'billboard' | 'mesh' | 'trail',
) {
    const base = Array.isArray(binding.color)
        ? binding.color
        : [
            ...new THREE.Color(binding.color ?? '#ffffff').toArray(),
            1,
        ]
    const emission = binding.emissionColor ?? [0, 0, 0, 1]
    const uvModule = record(preset.modules.textureSheetAnimation)
    const tilesX = Math.max(1, finiteInt(uvModule.tilesX, 1))
    const tilesY = Math.max(1, finiteInt(uvModule.tilesY, 1))
    const floats = official?.floats ?? {}
    const colors = official?.colors ?? {}
    const main = officialTexture(official, '_MainTex', textures, texture)
    const second = officialTexture(official, '_SecondTex', textures, texture)
    const wave = officialTexture(official, '_WaveTex', textures, texture)
    const secondWave = officialTexture(official, '_SecondWaveTex', textures, texture)
    const dissolve = officialTexture(official, '_DissolveTex', textures, texture)
    const officialColor = rgba(colors._Color, base)
    const dissolveLeft = rgba(colors._DissolveColorL, [0, 0, 0, 1])
    const dissolveCenter = rgba(colors._DissolveColorC, [0, 0, 0, 1])
    const dissolveRight = rgba(colors._DissolveColorR, [0, 0, 0, 1])
    const float = (name: string, fallback: number) => finite(floats[name], fallback)
    const softParticle = officialSoftParticleState(official)
    const dissolveState = officialDissolveState(official, dissolve.present)
    const alphaMaskState = officialAlphaMaskState(
        official,
        main.present,
        second.present,
    )
    // Steam EffectCommon PS263/272: the effective compiled class owns the
    // alpha source. A null MainTex or an invalid legacy keyword is not a gate.
    const particleCommon = official?.validKeywords?.includes('PARTICLE_COMMON') === true
        && official?.invalidKeywords?.includes('PARTICLE_COMMON') !== true
    const particleRamp = particleCommon
        && official?.validKeywords?.includes('IS_RAMP') === true
        && official?.invalidKeywords?.includes('IS_RAMP') !== true
    const zTest = softParticle.zTest
    const usesParticleUv = renderMode !== 'billboard'
    const vertexShader = renderMode === 'mesh'
        ? /* glsl */ `
            attribute vec4 stageColor;
            attribute vec4 stageMeshColor;
            attribute vec3 stagePosition;
            attribute vec3 stageScale;
            attribute vec4 stageQuaternion;
            attribute float stageFrame;
            uniform float uRenderAlignment;
            uniform vec3 uPivot;
            varying vec2 vParticleUv;
            varying vec4 vStageColor;
            varying float vStageRotation;
            varying float vStageFrame;
            varying float vParticleEyeDepth;
            vec3 rotateQuaternion(vec3 value, vec4 rotation) {
                return value + 2.0 * cross(
                    rotation.xyz,
                    cross(rotation.xyz, value) + rotation.w * value
                );
            }
            mat3 cameraWorldBasis() {
                return mat3(
                    vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]),
                    vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]),
                    vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])
                );
            }
            void main() {
                vec3 particleVertex = (position - uPivot) * stageScale;
                particleVertex = rotateQuaternion(particleVertex, stageQuaternion);
                vec3 centerWorld = (modelMatrix * vec4(stagePosition, 1.0)).xyz;
                mat3 basis = mat3(modelMatrix);
                if (uRenderAlignment < 0.5) {
                    basis = cameraWorldBasis();
                } else if (uRenderAlignment < 1.5) {
                    basis = mat3(1.0);
                } else if (uRenderAlignment > 2.5 && uRenderAlignment < 3.5) {
                    vec3 forward = normalize(cameraPosition - centerWorld);
                    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
                    if (dot(right, right) < 1e-6) right = vec3(1.0, 0.0, 0.0);
                    vec3 up = normalize(cross(forward, right));
                    basis = mat3(right, up, forward);
                }
                vec3 worldPosition = centerWorld + basis * particleVertex;
                vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
                gl_Position = projectionMatrix * viewPosition;
                vParticleUv = uv;
                vStageColor = stageColor * stageMeshColor;
                vStageRotation = 0.0;
                vStageFrame = stageFrame;
                vParticleEyeDepth = -viewPosition.z;
            }
        `
        : renderMode === 'trail'
            ? /* glsl */ `
                attribute vec3 stagePrevious;
                attribute vec3 stageNext;
                attribute float stageSide;
                attribute float stageWidth;
                attribute vec4 stageColor;
                attribute vec2 stageTrailUv;
                attribute float stageFrame;
                varying vec2 vParticleUv;
                varying vec4 vStageColor;
                varying float vStageRotation;
                varying float vStageFrame;
                varying float vParticleEyeDepth;
                void main() {
                    vec3 centerWorld = (modelMatrix * vec4(position, 1.0)).xyz;
                    vec3 previousWorld = (modelMatrix * vec4(stagePrevious, 1.0)).xyz;
                    vec3 nextWorld = (modelMatrix * vec4(stageNext, 1.0)).xyz;
                    vec3 tangent = normalize(nextWorld - previousWorld);
                    vec3 viewDirection = normalize(cameraPosition - centerWorld);
                    vec3 across = cross(tangent, viewDirection);
                    if (dot(across, across) < 1e-8) {
                        across = cross(tangent, vec3(0.0, 1.0, 0.0));
                    }
                    if (dot(across, across) < 1e-8) {
                        across = vec3(1.0, 0.0, 0.0);
                    }
                    vec3 worldPosition = centerWorld
                        + normalize(across) * stageSide * stageWidth * 0.5;
                    vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
                    gl_Position = projectionMatrix * viewPosition;
                    vParticleUv = stageTrailUv;
                    vStageColor = stageColor;
                    vStageRotation = 0.0;
                    vStageFrame = stageFrame;
                    vParticleEyeDepth = -viewPosition.z;
                }
            `
            : /* glsl */ `
            uniform float uPointScale;
            uniform float uPerspective;
            uniform vec2 uPointSizeRange;
            attribute vec4 stageColor;
            attribute float stageSize;
            attribute float stageRotation;
            attribute float stageFrame;
            varying vec4 vStageColor;
            varying float vStageRotation;
            varying float vStageFrame;
            varying float vParticleEyeDepth;
            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                float projectionScale = projectionMatrix[1][1] * uPointScale;
                float worldToPixel = uPerspective > 0.5
                    ? projectionScale / max(1e-4, -mvPosition.z)
                    : projectionScale;
                gl_PointSize = clamp(
                    max(0.0, stageSize * worldToPixel),
                    uPointSizeRange.x,
                    uPointSizeRange.y
                );
                vStageColor = stageColor;
                vStageRotation = stageRotation;
                vStageFrame = stageFrame;
                vParticleEyeDepth = -mvPosition.z;
            }
        `
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: main.texture },
            uMapTransform: { value: main.transform },
            uSecondMap: { value: second.texture },
            uSecondTransform: { value: second.transform },
            uWaveMap: { value: wave.texture },
            uWaveTransform: { value: wave.transform },
            uSecondWaveMap: { value: secondWave.texture },
            uSecondWaveTransform: { value: secondWave.transform },
            uDissolveMap: { value: dissolve.texture },
            uDissolveTransform: { value: dissolve.transform },
            uHasSecond: { value: second.present ? 1 : 0 },
            uHasWave: { value: wave.present ? 1 : 0 },
            uHasSecondWave: { value: secondWave.present ? 1 : 0 },
            uHasDissolve: { value: dissolveState.enabled ? 1 : 0 },
            uBaseColor: {
                value: new THREE.Color(
                    officialColor[0], officialColor[1], officialColor[2],
                ),
            },
            uEmissionColor: {
                value: new THREE.Color(emission[0], emission[1], emission[2]),
            },
            uOpacity: { value: finite(officialColor[3], finite(base[3], 1)) },
            uTime: { value: 0 },
            uMainScroll: {
                value: new THREE.Vector2(
                    float('_MainTexScrollX', 0),
                    float('_MainTexScrollY', 0),
                ),
            },
            uSecondScroll: {
                value: new THREE.Vector2(
                    float('_SecondTexScrollX', 0),
                    float('_SecondTexScrollY', 0),
                ),
            },
            uWaveScroll: {
                value: new THREE.Vector2(
                    float('_WaveTexScrollSpeedX', 0),
                    float('_WaveTexScrollSpeedY', 0),
                ),
            },
            uDissolveScroll: {
                value: new THREE.Vector2(
                    float('_DissolveScrollX', 0),
                    float('_DissolveScrollY', 0),
                ),
            },
            uBrightness: { value: float('_Blightness', 1) },
            uParticleCommon: { value: particleCommon ? 1 : 0 },
            uParticleRamp: { value: particleRamp ? 1 : 0 },
            uParticleColor: { value: new THREE.Vector4(...rgba(colors._ParticleColor, [1, 1, 1, 0])) },
            uParticleInAlpha: { value: float('_ParticleInAlpha', 1) },
            uParticleOutAlpha: { value: float('_ParticleOutAlpha', 0.30000001192092896) },
            uParticleInRadius: { value: float('_ParticleInRadius', 0.10000000149011612) },
            uMultipliedAlpha: { value: float('_MultipliedAlpha', 0) },
            uRampAlpha: { value: float('_RampAlpha', 0) },
            uRampCentor: { value: float('_RampCentor', 0) },
            uRampCenterPos: { value: float('_RampCenterPos', 0.5) },
            uRampSmoothMin: { value: float('_RampSmoothMin', 0) },
            uRampSmoothMax: { value: float('_RampSmoothMax', 1) },
            uRampColorL: { value: new THREE.Vector4(...rgba(colors._RampColorL, [1, 0, 0, 1])) },
            uRampColorC: { value: new THREE.Vector4(...rgba(colors._RampColorC, [1, 0.5, 0, 1])) },
            uRampColorR: { value: new THREE.Vector4(...rgba(colors._RampColorR, [1, 1, 0.800000011920929, 1])) },
            uAlphaSmoothMin: { value: float('_AlphaSmoothMin', 0) },
            uAlphaSmoothMax: { value: float('_AlphaSmoothMax', 1) },
            uGlobalBackgroundTintColor: { value: new THREE.Vector4(...rgba(colors._GlobalBackgroundTintColor, [1, 1, 1, 1])) },
            uIsGlobalBackgroundTintColor: { value: float('_IsGlobalBackgroundTintColor', 0) },
            uAlphaIsGray: { value: alphaMaskState.mainGrayScale ? 1 : 0 },
            uAlphaIsGray2: { value: alphaMaskState.secondGrayScale ? 1 : 0 },
            uMainMaskTex: { value: alphaMaskState.mainMaskTexture ? 1 : 0 },
            uTex2Multiply: { value: float('_IsTex2BlendMultiply', 0) },
            uTex2AlphaMask: { value: alphaMaskState.secondAlphaMask ? 1 : 0 },
            uDissolveProgress: { value: dissolveState.progress },
            uDissolveSmoothRange: {
                value: Math.max(1e-5, float('_DissolveTexSmoothRange', 0.05)),
            },
            uDissolveBrightness: { value: float('_DissolveBrightness', 1) },
            uDissolveCenterPos: { value: float('_DissolveCenterPos', 0.5) },
            uDissolveColorL: {
                value: new THREE.Color(
                    dissolveLeft[0], dissolveLeft[1], dissolveLeft[2],
                ),
            },
            uDissolveColorC: {
                value: new THREE.Color(
                    dissolveCenter[0], dissolveCenter[1], dissolveCenter[2],
                ),
            },
            uDissolveColorR: {
                value: new THREE.Color(
                    dissolveRight[0], dissolveRight[1], dissolveRight[2],
                ),
            },
            uPointScale: { value: 1 },
            uPerspective: { value: 1 },
            uPointSizeRange: { value: new THREE.Vector2(0, 1e20) },
            uTiles: { value: new THREE.Vector2(tilesX, tilesY) },
            uRenderAlignment: {
                value: finiteInt(preset.renderer.renderAlignment),
            },
            uSceneDepth: { value: null as THREE.Texture | null },
            uDepthResolution: { value: new THREE.Vector2(1, 1) },
            uCameraNear: { value: 0.1 },
            uCameraFar: { value: 1000 },
            uOrthographic: { value: 0 },
            // The compiled IS_SOFT_PARTICLE program is activated only after
            // BackgroundDepthPass supplies an independent depth attachment.
            uUseSoftParticle: { value: 0 },
            uSurfaceFadeNear: { value: softParticle.surfaceFadeNear },
            uSurfaceFadeFar: { value: softParticle.surfaceFadeFar },
            uPivot: {
                value: (() => {
                    const pivot = tuple(preset.renderer.pivot, [0, 0, 0], 3)
                    return new THREE.Vector3(-pivot[0], pivot[1], pivot[2])
                })(),
            },
        },
        vertexShader,
        fragmentShader: /* glsl */ `
            uniform sampler2D uMap;
            uniform sampler2D uSecondMap;
            uniform sampler2D uWaveMap;
            uniform sampler2D uSecondWaveMap;
            uniform sampler2D uDissolveMap;
            uniform vec4 uMapTransform;
            uniform vec4 uSecondTransform;
            uniform vec4 uWaveTransform;
            uniform vec4 uSecondWaveTransform;
            uniform vec4 uDissolveTransform;
            uniform float uHasSecond;
            uniform float uHasWave;
            uniform float uHasSecondWave;
            uniform float uHasDissolve;
            uniform vec3 uBaseColor;
            uniform vec3 uEmissionColor;
            uniform float uOpacity;
            uniform float uTime;
            uniform vec2 uMainScroll;
            uniform vec2 uSecondScroll;
            uniform vec2 uWaveScroll;
            uniform vec2 uDissolveScroll;
            uniform float uBrightness;
            uniform float uParticleCommon;
            uniform float uParticleRamp;
            uniform vec4 uParticleColor;
            uniform float uParticleInAlpha;
            uniform float uParticleOutAlpha;
            uniform float uParticleInRadius;
            uniform float uMultipliedAlpha;
            uniform float uRampAlpha;
            uniform float uRampCentor;
            uniform float uRampCenterPos;
            uniform float uRampSmoothMin;
            uniform float uRampSmoothMax;
            uniform vec4 uRampColorL;
            uniform vec4 uRampColorC;
            uniform vec4 uRampColorR;
            uniform float uAlphaSmoothMin;
            uniform float uAlphaSmoothMax;
            uniform vec4 uGlobalBackgroundTintColor;
            uniform float uIsGlobalBackgroundTintColor;
            uniform float uAlphaIsGray;
            uniform float uAlphaIsGray2;
            uniform float uMainMaskTex;
            uniform float uTex2Multiply;
            uniform float uTex2AlphaMask;
            uniform float uDissolveProgress;
            uniform float uDissolveSmoothRange;
            uniform float uDissolveBrightness;
            uniform float uDissolveCenterPos;
            uniform vec3 uDissolveColorL;
            uniform vec3 uDissolveColorC;
            uniform vec3 uDissolveColorR;
            uniform vec2 uTiles;
            uniform sampler2D uSceneDepth;
            uniform vec2 uDepthResolution;
            uniform float uCameraNear;
            uniform float uCameraFar;
            uniform float uOrthographic;
            uniform float uUseSoftParticle;
            uniform float uSurfaceFadeNear;
            uniform float uSurfaceFadeFar;
            varying vec4 vStageColor;
            varying float vStageRotation;
            varying float vStageFrame;
            varying float vParticleEyeDepth;
            ${usesParticleUv ? 'varying vec2 vParticleUv;' : ''}
            float rdParticleSmooth(float value) {
                return value * value * (3.0 - 2.0 * value);
            }
            vec4 rdParticleCommon(vec2 particleUv, vec4 vertexColor) {
                // Exact Steam EffectCommon PS263/272. Weighted outer alpha is
                // squared again by mad_sat; _ParticleColor.a is not an input.
                float distanceFromCenter = length(particleUv - vec2(0.5));
                float outer = max((distanceFromCenter - 0.5) * -2.0, 0.0);
                float inner = clamp(
                    (distanceFromCenter - uParticleInRadius) / -uParticleInRadius,
                    0.0, 1.0
                );
                float weightedOuter = rdParticleSmooth(outer) * uParticleOutAlpha;
                float weightedInner = rdParticleSmooth(inner) * uParticleInAlpha;
                float sourceAlpha = clamp(weightedOuter * weightedOuter + weightedInner, 0.0, 1.0);
                vec3 sourceColor = uParticleColor.rgb;
                if (uAlphaIsGray >= 0.5) {
                    sourceAlpha = dot(sourceColor, vec3(0.3, 0.59, 0.11));
                    sourceColor = vec3(1.0);
                }
                float multipliedAlpha = 1.0 + uMultipliedAlpha * (sourceAlpha - 1.0);
                vec3 preRampColor = sourceColor * multipliedAlpha * vertexColor.rgb * uBaseColor;
                float alpha = sourceAlpha * vertexColor.a * uOpacity;
                vec3 color = preRampColor * uBrightness;
                if (uParticleRamp > 0.5) {
                    float rampInput = mix(dot(preRampColor, vec3(0.3, 0.59, 0.11)), alpha, uRampAlpha);
                    float rampT = rdParticleSmooth(clamp(
                        (rampInput - uRampSmoothMin) / uRampSmoothMax, 0.0, 1.0
                    ));
                    float leftT = rdParticleSmooth(clamp(rampT / uRampCenterPos, 0.0, 1.0));
                    float rightT = rdParticleSmooth(clamp(
                        (rampT - uRampCenterPos) / (1.0 - uRampCenterPos), 0.0, 1.0
                    ));
                    vec4 ramp = mix(uRampColorL, uRampColorR, rampT);
                    // Runtime scalar, not RAMP_CENTOR keyword presence.
                    if (uRampCentor >= 0.5) {
                        ramp = mix(mix(uRampColorL, uRampColorC, leftT), uRampColorR, rightT);
                    }
                    alpha *= ramp.a;
                    color = ramp.rgb * vertexColor.rgb * uBrightness;
                }
                float alphaRange = min(uAlphaSmoothMin + uAlphaSmoothMax, 1.0) - uAlphaSmoothMin;
                alpha = rdParticleSmooth(clamp((alpha - uAlphaSmoothMin) / alphaRange, 0.0, 1.0));
                vec4 result = vec4(color, alpha);
                return mix(result, result * uGlobalBackgroundTintColor, uIsGlobalBackgroundTintColor);
            }
            void main() {
                vec2 centered = ${usesParticleUv ? 'vParticleUv' : 'gl_PointCoord'} - 0.5;
                float c = cos(vStageRotation);
                float s = sin(vStageRotation);
                vec2 pointUv = mat2(c, -s, s, c) * centered + 0.5;
                ${usesParticleUv ? '' : 'pointUv.y = 1.0 - pointUv.y;'}
                float frame = mod(floor(vStageFrame), uTiles.x * uTiles.y);
                vec2 tile = vec2(mod(frame, uTiles.x), floor(frame / uTiles.x));
                pointUv = (pointUv + tile) / uTiles;
                vec2 waveUv = pointUv * uWaveTransform.xy
                    + uWaveTransform.zw + uTime * uWaveScroll;
                float waveValue = texture2D(uWaveMap, waveUv).r;
                vec2 secondWaveUv = pointUv * uSecondWaveTransform.xy
                    + uSecondWaveTransform.zw + uTime * uWaveScroll;
                float secondWaveValue = texture2D(uSecondWaveMap, secondWaveUv).r;
                vec2 distortion = vec2(
                    (waveValue - 0.5) * uHasWave,
                    (secondWaveValue - 0.5) * uHasSecondWave
                ) * 0.02;
                vec2 uv = pointUv * uMapTransform.xy + uMapTransform.zw
                    + uTime * uMainScroll + distortion;
                vec4 texel = texture2D(uMap, uv);
                vec2 secondUv = pointUv * uSecondTransform.xy
                    + uSecondTransform.zw + uTime * uSecondScroll;
                vec4 secondTexel = texture2D(uSecondMap, secondUv);
                vec3 alphaLuminance = vec3(0.299, 0.587, 0.114);
                float mainGrayAlpha = dot(texel.rgb, alphaLuminance);
                float sourceAlpha = mix(
                    texel.a,
                    mainGrayAlpha,
                    max(uAlphaIsGray, uMainMaskTex)
                );
                float secondGrayAlpha = dot(secondTexel.rgb, alphaLuminance);
                float secondAlphaSource = mix(
                    secondTexel.a,
                    secondGrayAlpha,
                    uAlphaIsGray2
                );
                float secondAlpha = mix(
                    1.0,
                    secondAlphaSource,
                    uTex2AlphaMask
                );
                vec3 secondBlend = mix(
                    texel.rgb + secondTexel.rgb,
                    texel.rgb * secondTexel.rgb,
                    clamp(uTex2Multiply, 0.0, 1.0)
                );
                texel.rgb = mix(texel.rgb, secondBlend, uHasSecond);
                float alpha = sourceAlpha * secondAlpha * vStageColor.a * uOpacity;
                vec3 color = texel.rgb * vStageColor.rgb
                    * (uBaseColor + uEmissionColor) * uBrightness;
                if (uParticleCommon > 0.5) {
                    vec4 procedural = rdParticleCommon(pointUv, vStageColor);
                    color = procedural.rgb;
                    alpha = procedural.a;
                }
                if (uUseSoftParticle > 0.5) {
                    vec2 rdDepthUv = gl_FragCoord.xy
                        / max(uDepthResolution, vec2(1.0));
                    float rdRawSceneDepth = texture2D(uSceneDepth, rdDepthUv).r;
                    float rdPerspectiveViewZ = (uCameraNear * uCameraFar) / (
                        (uCameraFar - uCameraNear) * rdRawSceneDepth - uCameraFar
                    );
                    float rdOrthographicViewZ = rdRawSceneDepth
                        * (uCameraNear - uCameraFar) - uCameraNear;
                    float rdSceneEyeDepth = -mix(
                        rdPerspectiveViewZ,
                        rdOrthographicViewZ,
                        uOrthographic
                    );
                    float rdSoftDepthDelta = rdSceneEyeDepth
                        - abs(vParticleEyeDepth);
                    float rdSoftRange = max(
                        1e-5,
                        uSurfaceFadeFar - uSurfaceFadeNear
                    );
                    float rdSoftT = clamp(
                        (rdSoftDepthDelta - uSurfaceFadeNear) / rdSoftRange,
                        0.0,
                        1.0
                    );
                    float rdSoftFade = rdSoftT * rdSoftT * (3.0 - 2.0 * rdSoftT);
                    alpha *= rdSoftFade;
                }
                vec2 dissolveUv = pointUv * uDissolveTransform.xy
                    + uDissolveTransform.zw + uTime * uDissolveScroll;
                float dissolveValue = texture2D(uDissolveMap, dissolveUv).r;
                float dissolveMask = 1.0 - smoothstep(
                    uDissolveProgress - uDissolveSmoothRange,
                    uDissolveProgress + uDissolveSmoothRange,
                    dissolveValue
                );
                float rampLeft = smoothstep(
                    0.0, max(1e-4, uDissolveCenterPos), dissolveValue
                );
                float rampRight = smoothstep(
                    uDissolveCenterPos, 1.0, dissolveValue
                );
                vec3 dissolveColor = mix(
                    mix(uDissolveColorL, uDissolveColorC, rampLeft),
                    uDissolveColorR,
                    rampRight
                ) * uDissolveBrightness;
                color = mix(
                    color,
                    color + dissolveColor,
                    uHasDissolve * (1.0 - dissolveMask)
                );
                alpha *= mix(1.0, dissolveMask, uHasDissolve);
                if (alpha <= 1e-4) discard;
                gl_FragColor = vec4(color, alpha);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        depthWrite: float('_ZWrite', binding.depthWrite ? 1 : 0) > 0.5,
        depthTest: zTest !== 0,
        depthFunc: unityDepthFunction(zTest),
        blending: THREE.CustomBlending,
        blendSrc: unityBlendFactor(float('_SrcBlend', 5)) as THREE.BlendingSrcFactor,
        blendDst: unityBlendFactor(float('_DstBlend', 10)) as THREE.BlendingDstFactor,
        blendEquation: THREE.AddEquation,
    })
    material.name = `${renderMode === 'trail' ? 'StageParticleTrail' : 'StageParticle'}:${
        binding.materialName ?? 'unnamed'
    }`
    material.userData.stageParticleOfficialPass = {
        softParticleDeclared: softParticle.enabled,
        surfaceFadeNear: softParticle.surfaceFadeNear,
        surfaceFadeFar: softParticle.surfaceFadeFar,
        zTest,
        depthFunction: unityDepthFunctionName(zTest),
    }
    material.toneMapped = true
    return material
}

function findShapeVertices(
    root: THREE.Object3D,
    anchor: THREE.Object3D,
    meshName: unknown,
) {
    if (typeof meshName !== 'string' || !meshName) return []
    let mesh: THREE.Mesh | undefined
    for (let current: THREE.Object3D | null = anchor.parent; current; current = current.parent) {
        const matches: THREE.Mesh[] = []
        current.traverse(candidate => {
            if ((candidate as THREE.Mesh).isMesh && candidate.name === meshName) {
                matches.push(candidate as THREE.Mesh)
            }
        })
        if (matches.length === 1) {
            mesh = matches[0]
            break
        }
        if (current === root) break
    }
    if (!mesh) {
        root.traverse(candidate => {
            if (!mesh && (candidate as THREE.Mesh).isMesh && candidate.name === meshName) {
                mesh = candidate as THREE.Mesh
            }
        })
    }
    const position = mesh?.geometry.getAttribute('position')
    if (!mesh || !position) return []
    root.updateMatrixWorld(true)
    const result: THREE.Vector3[] = []
    const point = new THREE.Vector3()
    for (let index = 0; index < position.count; index++) {
        point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld)
        result.push(anchor.worldToLocal(point.clone()))
    }
    return result
}

function stageShapeArcPhase(
    shape: UnknownRecord,
    seed: number,
    birthIndex: number,
    birthTime: number,
    burstSpreadPhase?: number,
) {
    const arc = record(shape.arc)
    const mode = finiteInt(arc.mode)
    let phase = random01(seed, birthIndex, 16)
    if (mode === 1 || mode === 2) {
        const speed = evaluateStageMinMaxCurve(
            arc.speed,
            random01(seed, birthIndex, 75),
        )
        const loop = ((birthTime * speed % 1) + 1) % 1
        phase = mode === 2 ? 1 - Math.abs(1 - loop * 2) : loop
    } else if (mode === 3 && burstSpreadPhase != undefined) {
        phase = burstSpreadPhase
    }
    const spread = THREE.MathUtils.clamp(finite(arc.spread), 0, 1)
    if (spread > 0) phase = Math.floor(phase / spread) * spread
    return phase * THREE.MathUtils.degToRad(Math.max(0, finite(arc.value, 360)))
}

function sampleParticleShapeState(
    shapeValue: unknown,
    seed: number,
    birthIndex: number,
    birthTime: number,
    shapeVertices: readonly THREE.Vector3[],
    burstSpreadPhase?: number,
) {
    const shape = record(shapeValue)
    if (shape.enabled === false) {
        return {
            position: new THREE.Vector3(),
            direction: new THREE.Vector3(0, 0, 1),
        }
    }
    const type = finiteInt(shape.type, -1)
    const shapePosition = tuple(shape.m_Position, [0, 0, 0], 3)
    const position = new THREE.Vector3(...unityWorldToViewerVector([
        shapePosition[0],
        shapePosition[1],
        shapePosition[2],
    ]))
    const direction = new THREE.Vector3(0, 0, 1)
    const shapeScale = tuple(shape.m_Scale, [1, 1, 1], 3)
    const unityOffset = new THREE.Vector3()
    let offsetAlreadyInViewerSpace = false
    const radius = Math.max(0, finite(record(shape.radius).value, 1))
    const thickness = THREE.MathUtils.clamp(finite(shape.radiusThickness, 1), 0, 1)
    const radialSample = (salt: number, outerRadius = radius) => Math.sqrt(
        THREE.MathUtils.lerp(
            (outerRadius * (1 - thickness)) ** 2,
            outerRadius ** 2,
            random01(seed, birthIndex, salt),
        ),
    )
    const azimuth = stageShapeArcPhase(
        shape,
        seed,
        birthIndex,
        birthTime,
        burstSpreadPhase,
    )
    if (type === 6 && shapeVertices.length > 0) {
        const index = Math.min(
            shapeVertices.length - 1,
            Math.floor(random01(seed, birthIndex, 11) * shapeVertices.length),
        )
        unityOffset.copy(shapeVertices[index])
        offsetAlreadyInViewerSpace = true
    } else if (type === 5) {
        unityOffset.set(
            random01(seed, birthIndex, 12) - 0.5,
            random01(seed, birthIndex, 13) - 0.5,
            random01(seed, birthIndex, 14) - 0.5,
        )
    } else if (type === 4) {
        const radial = radialSample(15)
        unityOffset.set(
            Math.cos(azimuth) * radial,
            Math.sin(azimuth) * radial,
            0,
        )
        const angle = THREE.MathUtils.degToRad(finite(shape.angle, 25))
            * Math.sqrt(random01(seed, birthIndex, 17))
        direction.set(
            Math.cos(azimuth) * Math.sin(angle),
            Math.sin(azimuth) * Math.sin(angle),
            Math.cos(angle),
        )
    } else if (type === 8) {
        const z = random01(seed, birthIndex, 18) * Math.max(0, finite(shape.length))
        const angle = THREE.MathUtils.degToRad(finite(shape.angle, 25))
        const outerRadius = radius + Math.tan(angle) * z
        const radial = radialSample(15, outerRadius)
        unityOffset.set(
            Math.cos(azimuth) * radial,
            Math.sin(azimuth) * radial,
            z,
        )
        direction.set(
            Math.cos(azimuth) * Math.sin(angle),
            Math.sin(azimuth) * Math.sin(angle),
            Math.cos(angle),
        )
    } else if (type === 10) {
        const radial = radialSample(15)
        unityOffset.set(
            Math.cos(azimuth) * radial,
            Math.sin(azimuth) * radial,
            0,
        )
    } else if (type === 12) {
        unityOffset.set(
            THREE.MathUtils.lerp(-radius, radius, random01(seed, birthIndex, 19)),
            0,
            0,
        )
    } else if (type === 2) {
        const z = random01(seed, birthIndex, 18)
        const hemisphereAzimuth = random01(seed, birthIndex, 16) * Math.PI * 2
        const radialPlane = Math.sqrt(Math.max(0, 1 - z * z))
        const shellRadius = Math.cbrt(THREE.MathUtils.lerp(
            (radius * (1 - thickness)) ** 3,
            radius ** 3,
            random01(seed, birthIndex, 15),
        ))
        unityOffset.set(
            Math.cos(hemisphereAzimuth) * radialPlane * shellRadius,
            Math.sin(hemisphereAzimuth) * radialPlane * shellRadius,
            z * shellRadius,
        )
        direction.copy(unityOffset).normalize()
    } else if (type === 16) {
        const dimensions = shapeScale.map(value => Math.abs(value))
        const edgeAxisWeight = dimensions.reduce((sum, value) => sum + value, 0)
        let edgeAxis = Math.min(
            2,
            Math.floor(random01(seed, birthIndex, 76) * 3),
        )
        if (edgeAxisWeight > 1e-8) {
            let weighted = random01(seed, birthIndex, 76) * edgeAxisWeight
            edgeAxis = 0
            while (edgeAxis < 2 && weighted >= dimensions[edgeAxis]!) {
                weighted -= dimensions[edgeAxis]!
                edgeAxis++
            }
        }
        const edgeSigns = Math.floor(random01(seed, birthIndex, 77) * 4)
        const along = random01(seed, birthIndex, 78) - 0.5
        const coordinates = [0, 0, 0]
        coordinates[edgeAxis] = along
        const fixedAxes = [0, 1, 2].filter(axis => axis !== edgeAxis)
        coordinates[fixedAxes[0]!] = (edgeSigns & 1) === 0 ? -0.5 : 0.5
        coordinates[fixedAxes[1]!] = (edgeSigns & 2) === 0 ? -0.5 : 0.5
        unityOffset.set(coordinates[0]!, coordinates[1]!, coordinates[2]!)
    } else if (type === 17) {
        const crossSectionRadius = Math.max(0, finite(shape.donutRadius))
        const crossSectionSample = Math.sqrt(THREE.MathUtils.lerp(
            (crossSectionRadius * (1 - thickness)) ** 2,
            crossSectionRadius ** 2,
            random01(seed, birthIndex, 79),
        ))
        const crossSectionAngle = random01(seed, birthIndex, 80) * Math.PI * 2
        const radial = radius + Math.cos(crossSectionAngle) * crossSectionSample
        unityOffset.set(
            Math.cos(azimuth) * radial,
            Math.sin(azimuth) * radial,
            Math.sin(crossSectionAngle) * crossSectionSample,
        )
        direction.set(
            Math.cos(azimuth) * Math.cos(crossSectionAngle),
            Math.sin(azimuth) * Math.cos(crossSectionAngle),
            Math.sin(crossSectionAngle),
        )
    } else if (type === 18) {
        unityOffset.set(
            random01(seed, birthIndex, 81) - 0.5,
            random01(seed, birthIndex, 82) - 0.5,
            0,
        )
    } else if (type === 0) {
        const z = random01(seed, birthIndex, 18) * 2 - 1
        const azimuthSphere = random01(seed, birthIndex, 16) * Math.PI * 2
        const radialPlane = Math.sqrt(Math.max(0, 1 - z * z))
        const shellRadius = Math.cbrt(THREE.MathUtils.lerp(
            (radius * (1 - thickness)) ** 3,
            radius ** 3,
            random01(seed, birthIndex, 15),
        ))
        unityOffset.set(
            Math.cos(azimuthSphere) * radialPlane * shellRadius,
            Math.sin(azimuthSphere) * radialPlane * shellRadius,
            z * shellRadius,
        )
        direction.copy(unityOffset).normalize()
    }
    unityOffset.multiply(new THREE.Vector3(...shapeScale))
    const randomPositionAmount = Math.max(0, finite(shape.randomPositionAmount))
    if (randomPositionAmount > 0) {
        unityOffset.add(
            deterministicUnitBall(seed, birthIndex, 83).multiplyScalar(randomPositionAmount),
        )
    }
    const sphericalDirectionAmount = THREE.MathUtils.clamp(
        finite(shape.sphericalDirectionAmount),
        0,
        1,
    )
    if (sphericalDirectionAmount > 0 && unityOffset.lengthSq() > 1e-12) {
        direction.lerp(
            unityOffset.clone().normalize(),
            sphericalDirectionAmount,
        ).normalize()
    }
    const randomDirectionAmount = THREE.MathUtils.clamp(
        finite(shape.randomDirectionAmount),
        0,
        1,
    )
    if (randomDirectionAmount > 0) {
        direction.lerp(
            deterministicUnitVector(seed, birthIndex, 86),
            randomDirectionAmount,
        ).normalize()
    }
    position.add(offsetAlreadyInViewerSpace
        ? unityOffset
        : new THREE.Vector3(...unityWorldToViewerVector([
            unityOffset.x,
            unityOffset.y,
            unityOffset.z,
        ])))
    const rotation = tuple(shape.m_Rotation, [0, 0, 0], 3)
    const unityShapeRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(rotation[0]),
        THREE.MathUtils.degToRad(rotation[1]),
        THREE.MathUtils.degToRad(rotation[2]),
        'ZXY',
    ))
    const viewerShapeRotation = new THREE.Quaternion(
        unityShapeRotation.x,
        -unityShapeRotation.y,
        -unityShapeRotation.z,
        unityShapeRotation.w,
    )
    position.applyQuaternion(viewerShapeRotation)
    const viewerDirection = offsetAlreadyInViewerSpace
        ? direction
        : new THREE.Vector3(...unityWorldToViewerVector([
            direction.x,
            direction.y,
            direction.z,
        ]))
    viewerDirection.applyQuaternion(viewerShapeRotation).normalize()
    return { position, direction: viewerDirection }
}

/** Deterministic official ShapeModule sample used by scene and VFX consumers. */
export function sampleStageParticleShape(
    shape: unknown,
    seed: number,
    birthIndex: number,
    birthTime = 0,
    burstSpreadPhase?: number,
) {
    const sample = sampleParticleShapeState(
        shape,
        seed,
        birthIndex,
        birthTime,
        [],
        burstSpreadPhase,
    )
    return {
        position: sample.position.toArray(),
        direction: sample.direction.toArray(),
    }
}

function spawnState(
    system: ActiveParticleSystem,
    birthIndex: number,
    birthTime: number,
    burstSpreadPhase?: number,
) {
    return sampleParticleShapeState(
        system.preset.shape,
        system.seed,
        birthIndex,
        birthTime,
        system.shapeVertices,
        burstSpreadPhase,
    )
}

function buildContinuousBirthTimes(
    preset: StageParticlePresetProfile,
    seed: number,
) {
    const emission = record(preset.emission)
    if (emission.enabled === false || preset.duration <= 0) return []
    const step = 1 / 120
    const result: number[] = []
    let carry = 0
    const initialRate = Math.max(0, evaluateStageMinMaxCurve(
        emission.rateOverTime,
        random01(seed, 0, 22),
        0,
    ))
    if (initialRate > 0) result.push(0)
    for (let time = 0; time <= preset.duration + 1e-8; time += step) {
        const rate = Math.max(0, evaluateStageMinMaxCurve(
            emission.rateOverTime,
            random01(seed, 0, 22),
            time / preset.duration,
        ))
        carry += rate * step
        while (carry >= 1) {
            result.push(time)
            carry -= 1
        }
    }
    return result
}

function setAttributeValue(
    attribute: THREE.BufferAttribute,
    index: number,
    values: readonly number[],
) {
    for (let component = 0; component < values.length; component++) {
        attribute.setComponent(index, component, values[component])
    }
}

function maximumAbsoluteStageMinMaxCurve(value: unknown) {
    const profile = record(value)
    const mode = finiteInt(profile.minMaxState)
    const candidates = [
        Math.abs(finite(profile.scalar)),
        Math.abs(finite(profile.minScalar, finite(profile.scalar))),
    ]
    for (const curveName of ['minCurve', 'maxCurve']) {
        const keys = record(profile[curveName]).m_Curve
        if (!Array.isArray(keys)) continue
        const scalar = curveName === 'minCurve'
            ? finite(profile.minScalar, finite(profile.scalar))
            : finite(profile.scalar)
        for (const key of keys) {
            candidates.push(Math.abs(finite(record(key).value) * scalar))
        }
    }
    if (mode === 0 || mode === 3) return Math.max(...candidates.slice(0, 2))
    return Math.max(...candidates)
}

/** Evaluate serialized ForceOverLifetime acceleration in drawable-local space. */
export function evaluateStageParticleForceAcceleration(
    value: unknown,
    seed: number,
    birthIndex: number,
    normalizedAge: number,
    anchor?: THREE.Object3D,
) {
    const force = record(value)
    if (force.enabled !== true) return [0, 0, 0] as [number, number, number]
    const frameSalt = force.randomizePerFrame === true
        ? Math.floor(Math.max(0, normalizedAge) * 4096)
        : 0
    const acceleration = new THREE.Vector3(...unityWorldToViewerVector([
        evaluateStageMinMaxCurve(
            force.x,
            random01(seed, birthIndex, 90 ^ frameSalt),
            normalizedAge,
        ),
        evaluateStageMinMaxCurve(
            force.y,
            random01(seed, birthIndex, 91 ^ frameSalt),
            normalizedAge,
        ),
        evaluateStageMinMaxCurve(
            force.z,
            random01(seed, birthIndex, 92 ^ frameSalt),
            normalizedAge,
        ),
    ]))
    if (force.inWorldSpace === true && anchor) {
        anchor.updateWorldMatrix(true, false)
        const worldToAnchor = anchor.matrixWorld.clone().invert()
        acceleration.applyMatrix3(new THREE.Matrix3().setFromMatrix4(worldToAnchor))
    }
    return acceleration.toArray()
}

export function maximumParticleSpeedBound(
    preset: StageParticlePresetProfile,
    lifetime: number,
) {
    const initial = record(preset.initial)
    let bound = maximumAbsoluteStageMinMaxCurve(initial.startSpeed)
    const velocity = record(preset.modules.velocityOverLifetime)
    if (Object.keys(velocity).length > 0) {
        bound += Math.hypot(
            maximumAbsoluteStageMinMaxCurve(velocity.x),
            maximumAbsoluteStageMinMaxCurve(velocity.y),
            maximumAbsoluteStageMinMaxCurve(velocity.z),
        )
    }
    bound += 9.81
        * maximumAbsoluteStageMinMaxCurve(initial.gravityModifier)
        * Math.max(0, lifetime)
    const force = record(preset.modules.forceOverLifetime)
    if (force.enabled === true) {
        bound += Math.hypot(
            maximumAbsoluteStageMinMaxCurve(force.x),
            maximumAbsoluteStageMinMaxCurve(force.y),
            maximumAbsoluteStageMinMaxCurve(force.z),
        ) * Math.max(0, lifetime)
    }
    const noise = record(preset.modules.noise)
    if (noise.enabled === true) {
        const separateAxes = noise.separateAxes === true
        const strengthX = maximumAbsoluteStageMinMaxCurve(noise.strength)
        const strengthY = separateAxes
            ? maximumAbsoluteStageMinMaxCurve(noise.strengthY)
            : strengthX
        const strengthZ = separateAxes
            ? maximumAbsoluteStageMinMaxCurve(noise.strengthZ)
            : strengthX
        bound += Math.hypot(strengthX, strengthY, strengthZ)
            * maximumAbsoluteStageMinMaxCurve(noise.positionAmount)
    }
    return Math.max(1e-4, bound)
}

function evaluateParticlePositionState(
    system: ActiveParticleSystem,
    birthIndex: number,
    birthTime: number,
    age: number,
    lifetime: number,
    burstSpreadPhase?: number,
) {
    const { preset, seed } = system
    const initial = record(preset.initial)
    const normalizedAge = THREE.MathUtils.clamp(age / Math.max(1e-4, lifetime), 0, 1)
    const spawn = spawnState(system, birthIndex, birthTime, burstSpreadPhase)
    const speed = evaluateStageMinMaxCurve(
        initial.startSpeed,
        random01(seed, birthIndex, 23),
    )
    const gravity = evaluateStageMinMaxCurve(
        initial.gravityModifier,
        random01(seed, birthIndex, 24),
        normalizedAge,
    )
    const birthPosition = spawn.position.clone()
    const baseLinearVelocity = spawn.direction.clone().multiplyScalar(speed)
    spawn.position.addScaledVector(spawn.direction, speed * age)
    const velocityModule = record(preset.modules.velocityOverLifetime)
    if (Object.keys(velocityModule).length > 0) {
        const velocity = unityWorldToViewerVector([
            evaluateStageMinMaxCurve(
                velocityModule.x,
                random01(seed, birthIndex, 32),
                normalizedAge,
            ),
            evaluateStageMinMaxCurve(
                velocityModule.y,
                random01(seed, birthIndex, 33),
                normalizedAge,
            ),
            evaluateStageMinMaxCurve(
                velocityModule.z,
                random01(seed, birthIndex, 34),
                normalizedAge,
            ),
        ])
        const viewerVelocity = new THREE.Vector3(...velocity)
        baseLinearVelocity.add(viewerVelocity)
        spawn.position.addScaledVector(viewerVelocity, age)
    }
    const forceModule = record(preset.modules.forceOverLifetime)
    const forceAcceleration = new THREE.Vector3(...evaluateStageParticleForceAcceleration(
        forceModule,
        seed,
        birthIndex,
        normalizedAge,
        system.anchor,
    ))
    if (forceModule.enabled === true) {
        spawn.position.addScaledVector(forceAcceleration, 0.5 * age * age)
    }
    spawn.position.y -= 0.5 * 9.81 * gravity * age * age
    const noiseModule = record(preset.modules.noise)
    let integratedParticleNoise: THREE.Vector3 | undefined
    let finalParticleNoise: THREE.Vector3 | undefined
    if (noiseModule.enabled === true) {
        const fieldIntegral = new THREE.Vector3()
        const positionIntegral = new THREE.Vector3()
        const samplePosition = new THREE.Vector3()
        // The same deterministic Simpson 3/8 integral is used for both the
        // particle head and historical trail vertices.
        const sampleFractions = [0, 1 / 3, 2 / 3, 1] as const
        const sampleWeights = [1, 3, 3, 1] as const
        for (let sampleIndex = 0; sampleIndex < sampleFractions.length; sampleIndex++) {
            const sampleAge = age * sampleFractions[sampleIndex]!
            const sampleNormalizedAge = sampleAge / Math.max(1e-4, lifetime)
            samplePosition.copy(birthPosition)
                .addScaledVector(baseLinearVelocity, sampleAge)
                .addScaledVector(forceAcceleration, 0.5 * sampleAge * sampleAge)
            samplePosition.y -= 0.5 * 9.81 * gravity * sampleAge * sampleAge
            const field = evaluateParticleNoiseVector(
                noiseModule,
                samplePosition,
                birthTime + sampleAge,
                sampleNormalizedAge,
                seed,
                birthIndex,
            )
            const weight = sampleWeights[sampleIndex]!
            fieldIntegral.addScaledVector(field, weight)
            const positionAmount = evaluateStageMinMaxCurve(
                noiseModule.positionAmount,
                random01(seed, birthIndex, 64),
                sampleNormalizedAge,
            )
            positionIntegral.addScaledVector(field, weight * positionAmount)
            if (sampleIndex === sampleFractions.length - 1) {
                finalParticleNoise = field.clone()
            }
        }
        integratedParticleNoise = fieldIntegral.multiplyScalar(age / 8)
        spawn.position.add(positionIntegral.multiplyScalar(age / 8))
    }
    return {
        position: spawn.position,
        integratedParticleNoise,
        finalParticleNoise,
    }
}

function dynamicAttribute(capacity: number, itemSize: number) {
    return new THREE.BufferAttribute(
        new Float32Array(Math.max(1, capacity) * itemSize),
        itemSize,
    ).setUsage(THREE.DynamicDrawUsage)
}

function installTrailAttributes(trail: ActiveParticleTrail, capacity: number) {
    trail.capacity = Math.max(1, capacity)
    trail.positions = dynamicAttribute(trail.capacity, 3)
    trail.previous = dynamicAttribute(trail.capacity, 3)
    trail.next = dynamicAttribute(trail.capacity, 3)
    trail.sides = dynamicAttribute(trail.capacity, 1)
    trail.widths = dynamicAttribute(trail.capacity, 1)
    trail.colors = dynamicAttribute(trail.capacity, 4)
    trail.uvs = dynamicAttribute(trail.capacity, 2)
    trail.frames = dynamicAttribute(trail.capacity, 1)
    trail.drawable.geometry.setAttribute('position', trail.positions)
    trail.drawable.geometry.setAttribute('stagePrevious', trail.previous)
    trail.drawable.geometry.setAttribute('stageNext', trail.next)
    trail.drawable.geometry.setAttribute('stageSide', trail.sides)
    trail.drawable.geometry.setAttribute('stageWidth', trail.widths)
    trail.drawable.geometry.setAttribute('stageColor', trail.colors)
    trail.drawable.geometry.setAttribute('stageTrailUv', trail.uvs)
    trail.drawable.geometry.setAttribute('stageFrame', trail.frames)
}

function ensureTrailCapacity(trail: ActiveParticleTrail, required: number) {
    if (required <= trail.capacity) return
    let capacity = trail.capacity
    while (capacity < required) capacity *= 2
    installTrailAttributes(trail, capacity)
}

function createActiveParticleTrail(
    profile: StageParticleSystemProfile,
    preset: StageParticlePresetProfile,
    binding: StageMaterialBinding,
    texture: THREE.Texture,
    official: OfficialParticleMaterialProfile | undefined,
    textures: readonly THREE.Texture[],
    coordinateParent: THREE.Object3D,
    materialName: string,
) {
    const geometry = new THREE.BufferGeometry()
    const material = particleMaterial(
        binding,
        texture,
        preset,
        official,
        textures,
        'trail',
    )
    const drawable = new THREE.Mesh(geometry, material)
    drawable.name = `UnityParticleTrail:${profile.pathID}`
    drawable.frustumCulled = false
    drawable.renderOrder = finiteInt(preset.renderer.sortingOrder)
    const placeholder = dynamicAttribute(1, 1)
    const trail: ActiveParticleTrail = {
        drawable,
        coordinateParent,
        positions: placeholder,
        previous: placeholder,
        next: placeholder,
        sides: placeholder,
        widths: placeholder,
        colors: placeholder,
        uvs: placeholder,
        frames: placeholder,
        capacity: 1,
        materialName,
    }
    installTrailAttributes(trail, 6)
    geometry.setDrawRange(0, 0)
    coordinateParent.add(drawable)
    return trail
}

function updateParticleTrail(
    system: ActiveParticleSystem,
    particles: readonly ActiveTrailParticle[],
    localTime: number,
) {
    const trail = system.trail
    if (!trail) return 0
    const module = record(system.preset.modules.trails)
    const positions: number[] = []
    const previous: number[] = []
    const next: number[] = []
    const sides: number[] = []
    const widths: number[] = []
    const colors: number[] = []
    const uvs: number[] = []
    const frames: number[] = []
    const minVertexDistance = Math.max(1e-6, finite(module.minVertexDistance, 0.1))
    const ratio = THREE.MathUtils.clamp(finite(module.ratio, 1), 0, 1)
    const textureMode = THREE.MathUtils.clamp(finiteInt(module.textureMode), 0, 3)
    const textureScale = tuple(module.textureScale, [1, 1], 2)
    const worldSpace = module.worldSpace === true
    const localToTrail = new THREE.Matrix4()
    if (worldSpace) {
        system.anchor.updateWorldMatrix(true, false)
        trail.coordinateParent.updateWorldMatrix(true, false)
        localToTrail.copy(trail.coordinateParent.matrixWorld)
            .invert()
            .multiply(system.anchor.matrixWorld)
    }
    let segmentCount = 0

    const appendVertex = (
        point: THREE.Vector3,
        before: THREE.Vector3,
        after: THREE.Vector3,
        side: number,
        width: number,
        color: readonly number[],
        uv: readonly number[],
    ) => {
        positions.push(point.x, point.y, point.z)
        previous.push(before.x, before.y, before.z)
        next.push(after.x, after.y, after.z)
        sides.push(side)
        widths.push(width)
        colors.push(color[0]!, color[1]!, color[2]!, color[3]!)
        uvs.push(uv[0]!, uv[1]!)
        frames.push(0)
    }

    for (const particle of particles) {
        if (random01(system.seed, particle.birthIndex, 71) >= ratio) continue
        let vertexLifetime = particle.lifetime * Math.max(
            0,
            evaluateStageMinMaxCurve(
                module.lifetime,
                random01(system.seed, particle.birthIndex, 72),
                particle.normalizedAge,
            ),
        )
        if (module.sizeAffectsLifetime === true) {
            vertexLifetime *= Math.max(0, particle.size)
        }
        const historyDuration = Math.min(particle.age, vertexLifetime)
        if (historyDuration <= 0) continue
        const speedBound = maximumParticleSpeedBound(system.preset, particle.lifetime)
        const sampleCount = Math.max(
            1,
            Math.ceil(historyDuration * speedBound / minVertexDistance),
        )
        const points: THREE.Vector3[] = []
        for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
            const sampleAge = particle.age
                - historyDuration * sampleIndex / sampleCount
            const point = evaluateParticlePositionState(
                system,
                particle.birthIndex,
                particle.birthTime,
                sampleAge,
                particle.lifetime,
                particle.shapePhase,
            ).position
            if (worldSpace) point.applyMatrix4(localToTrail)
            const last = points.at(-1)
            if (
                !last
                || last.distanceTo(point) >= minVertexDistance
                || sampleIndex === sampleCount
            ) {
                points.push(point)
            }
        }
        if (points.length < 2) continue
        const distances = [0]
        for (let index = 1; index < points.length; index++) {
            distances.push(
                distances[index - 1]! + points[index - 1]!.distanceTo(points[index]!),
            )
        }
        const totalDistance = distances.at(-1) ?? 0
        if (totalDistance <= 1e-8) continue
        const lifetimeColor = evaluateStageMinMaxGradient(
            module.colorOverLifetime,
            random01(system.seed, particle.birthIndex, 73),
            particle.normalizedAge,
        )
        const pointState = (pointIndex: number, segmentEndpoint: 0 | 1) => {
            const distance = distances[pointIndex]!
            const trailFraction = distance / totalDistance
            const width = Math.max(0, evaluateStageMinMaxCurve(
                module.widthOverTrail,
                random01(system.seed, particle.birthIndex, 74),
                trailFraction,
            )) * (module.sizeAffectsWidth === true ? Math.max(0, particle.size) : 1)
            const trailColor = evaluateStageMinMaxGradient(
                module.colorOverTrail,
                random01(system.seed, particle.birthIndex, 75),
                trailFraction,
            )
            const inherited = module.inheritParticleColor === true
                ? particle.color
                : [1, 1, 1, 1]
            const color = inherited.map((component, index) =>
                component * lifetimeColor[index]! * trailColor[index]!)
            const u = textureMode === 0
                ? trailFraction * textureScale[0]!
                : textureMode === 1
                    ? distance * textureScale[0]!
                    : textureMode === 2
                        ? pointIndex / Math.max(1, points.length - 1) * textureScale[0]!
                        : segmentEndpoint * textureScale[0]!
            return { width, color, u }
        }
        const appendPoint = (
            pointIndex: number,
            side: -1 | 1,
            segmentEndpoint: 0 | 1,
        ) => {
            const point = points[pointIndex]!
            const before = points[Math.max(0, pointIndex - 1)]!
            const after = points[Math.min(points.length - 1, pointIndex + 1)]!
            const state = pointState(pointIndex, segmentEndpoint)
            appendVertex(
                point,
                before,
                after,
                side,
                state.width,
                state.color,
                [state.u, side < 0 ? 0 : textureScale[1]!],
            )
        }
        for (let index = 0; index < points.length - 1; index++) {
            appendPoint(index, -1, 0)
            appendPoint(index, 1, 0)
            appendPoint(index + 1, -1, 1)
            appendPoint(index + 1, -1, 1)
            appendPoint(index, 1, 0)
            appendPoint(index + 1, 1, 1)
            segmentCount++
        }
    }

    ensureTrailCapacity(trail, Math.max(1, sides.length))
    ;(trail.positions.array as Float32Array).set(positions)
    ;(trail.previous.array as Float32Array).set(previous)
    ;(trail.next.array as Float32Array).set(next)
    ;(trail.sides.array as Float32Array).set(sides)
    ;(trail.widths.array as Float32Array).set(widths)
    ;(trail.colors.array as Float32Array).set(colors)
    ;(trail.uvs.array as Float32Array).set(uvs)
    ;(trail.frames.array as Float32Array).set(frames)
    trail.drawable.geometry.setDrawRange(0, sides.length)
    trail.positions.needsUpdate = true
    trail.previous.needsUpdate = true
    trail.next.needsUpdate = true
    trail.sides.needsUpdate = true
    trail.widths.needsUpdate = true
    trail.colors.needsUpdate = true
    trail.uvs.needsUpdate = true
    trail.frames.needsUpdate = true
    trail.drawable.material.uniforms.uTime!.value = localTime
    return segmentCount
}

function setSystemParticleCount(system: ActiveParticleSystem, count: number) {
    if (system.renderMode === 'mesh') {
        ;(system.drawable.geometry as THREE.InstancedBufferGeometry).instanceCount = count
    } else {
        system.drawable.geometry.setDrawRange(0, count)
    }
}

const particleCoordinateReflection = new THREE.Matrix4().makeScale(-1, 1, 1)

/**
 * Recreate an empty Unity ParticleSystem GameObject omitted by the FBX export.
 * The extractor writes the exact serialized Unity world matrix. Conjugating by
 * reflect-X converts it into the same basis used by AssetStudio's FBX carrier.
 */
function createSerializedParticleAnchor(
    root: THREE.Object3D,
    profile: StageParticleSystemProfile,
) {
    const values = profile.serializedWorldMatrix
    if (
        values?.length !== 16
        || values.some(value => !Number.isFinite(value))
    ) return undefined

    const unityWorld = new THREE.Matrix4().set(
        values[0], values[1], values[2], values[3],
        values[4], values[5], values[6], values[7],
        values[8], values[9], values[10], values[11],
        values[12], values[13], values[14], values[15],
    )
    const viewerWorld = particleCoordinateReflection
        .clone()
        .multiply(unityWorld)
        .multiply(particleCoordinateReflection)
    const anchor = new THREE.Object3D()
    anchor.name = `SerializedParticleAnchor:${profile.pathID}`
    viewerWorld.decompose(anchor.position, anchor.quaternion, anchor.scale)
    anchor.updateMatrix()
    anchor.userData.serializedParticleHierarchyPath = profile.hierarchyPath
    anchor.userData.serializedWorldMatrix = [...values]
    root.add(anchor)
    return anchor
}

export class StageParticleRuntimeController {
    private readonly systems: ActiveParticleSystem[] = []
    private readonly missingAnchorPaths: string[] = []
    private readonly missingMaterialNames: string[] = []
    private readonly missingTrailMaterialNames: string[] = []
    private readonly missingRendererMeshPathIDs: string[] = []
    private readonly unsupportedTrailModes: Array<{ hierarchyPath: string; mode: number }> = []
    private readonly fallbackTexture = createParticleFallbackTexture()
    private readonly declaredSystemCount: number
    private readonly inactiveSystemCount: number
    private readonly nonDrawableSystemCount: number
    private readonly rendererModeCounts: Record<string, number>
    private readonly meshRendererSystemCount: number
    private readonly noiseModuleSystemCount: number
    private readonly noiseQualityCounts: Record<string, number>
    private readonly forceOverLifetimeSystemCount: number
    private readonly trailModuleSystemCount: number
    private readonly trailTextureModeCounts: Record<string, number>
    private readonly softParticleFields: StageParticleRuntimeDebugState['softParticleFields'] = []
    private readonly depthFunctionCounts: Record<string, number> = {}
    private readonly unregisterDepthConsumers: Array<() => void> = []
    private readonly serializedAnchors: THREE.Object3D[] = []
    private meshRendererAppliedCount = 0
    private noiseModuleAppliedCount = 0
    private forceOverLifetimeAppliedCount = 0
    private trailModuleAppliedCount = 0
    private activeParticleCount = 0
    private activeTrailSegmentCount = 0

    constructor(
        root: THREE.Object3D,
        presets: readonly StageParticlePresetProfile[],
        profiles: readonly StageParticleSystemProfile[],
        materialBindings: readonly StageMaterialBinding[],
        textures: readonly THREE.Texture[],
        options: StageParticleRuntimeOptions = {},
    ) {
        this.declaredSystemCount = profiles.length
        this.inactiveSystemCount = profiles.filter(profile => !profile.active).length
        const presetsById = new Map(presets.map(preset => [preset.id, preset]))
        const rendererModeName = (mode: number) => ({
            0: 'billboard',
            1: 'stretch',
            2: 'horizontal-billboard',
            3: 'vertical-billboard',
            4: 'mesh',
            5: 'none',
        }[mode] ?? 'unknown')
        this.rendererModeCounts = {}
        for (const profile of profiles) {
            const preset = presetsById.get(profile.presetId)
            const mode = finiteInt(preset?.renderer.renderMode)
            const key = `${mode}:${rendererModeName(mode)}`
            this.rendererModeCounts[key] = (this.rendererModeCounts[key] ?? 0) + 1
        }
        this.meshRendererSystemCount = profiles.filter(profile => {
            const preset = presetsById.get(profile.presetId)
            return profile.active && finiteInt(preset?.renderer.renderMode) === 4
        }).length
        const noiseQualityName = (quality: number) => ({
            0: '1D',
            1: '2D',
            2: '3D',
        }[quality] ?? 'unknown')
        this.noiseQualityCounts = {}
        this.noiseModuleSystemCount = profiles.filter(profile => {
            const preset = presetsById.get(profile.presetId)
            const noise = record(preset?.modules.noise)
            if (!profile.active || noise.enabled !== true) return false
            const quality = THREE.MathUtils.clamp(finiteInt(noise.quality, 2), 0, 2)
            const key = `${quality}:${noiseQualityName(quality)}`
            this.noiseQualityCounts[key] = (this.noiseQualityCounts[key] ?? 0) + 1
            return true
        }).length
        this.forceOverLifetimeSystemCount = profiles.filter(profile => {
            const preset = presetsById.get(profile.presetId)
            return profile.active
                && record(preset?.modules.forceOverLifetime).enabled === true
        }).length
        const trailTextureModeName = (mode: number) => ({
            0: 'stretch',
            1: 'tile',
            2: 'distribute-per-segment',
            3: 'repeat-per-segment',
        }[mode] ?? 'unknown')
        this.trailTextureModeCounts = {}
        this.trailModuleSystemCount = profiles.filter(profile => {
            const preset = presetsById.get(profile.presetId)
            const trails = record(preset?.modules.trails)
            if (!profile.active || trails.enabled !== true) return false
            const textureMode = finiteInt(trails.textureMode)
            const key = `${textureMode}:${trailTextureModeName(textureMode)}`
            this.trailTextureModeCounts[key] = (
                this.trailTextureModeCounts[key] ?? 0
            ) + 1
            return true
        }).length
        this.nonDrawableSystemCount = profiles.filter(profile => {
            const preset = presetsById.get(profile.presetId)
            const renderer = record(preset?.renderer)
            return profile.active && (
                profile.materials.length === 0
                || renderer.enabled === false
                || finiteInt(renderer.renderMode) === 5
            )
        }).length
        const bindingsByName = new Map(
            materialBindings
                .filter(binding => binding.materialName)
                .map(binding => [binding.materialName!, binding]),
        )
        const officialMaterialsByName = new Map(
            (options.officialMaterials ?? []).map(material => [material.name, material]),
        )
        const particleMeshesByPathID = new Map(
            (options.particleMeshes ?? []).map(mesh => [mesh.pathID, mesh]),
        )
        for (const profile of profiles) {
            if (!profile.active && !options.forceActive) continue
            const preset = presetsById.get(profile.presetId)
            if (!preset || (!preset.playOnAwake && !options.forcePlayOnAwake)) continue
            const serializedRenderer = record(preset.renderer)
            const rendererMode = finiteInt(serializedRenderer.renderMode)
            // Unity permits logical ParticleSystems without a drawable
            // ParticleSystemRenderer/material. Preserve them in declared
            // counts without reporting a false missing-material failure.
            if (
                profile.materials.length === 0
                || serializedRenderer.enabled === false
                || rendererMode === 5
            ) continue
            const exactAnchor = resolveStageHierarchyPath(root, profile.hierarchyPath)
            const carrierAnchor = exactAnchor ? undefined : resolveStageHierarchyPath(
                root,
                profile.carrierHierarchyPath,
            )
            const serializedAnchor = exactAnchor || carrierAnchor
                ? undefined
                : createSerializedParticleAnchor(root, profile)
            if (serializedAnchor) this.serializedAnchors.push(serializedAnchor)
            const anchor = exactAnchor ?? carrierAnchor ?? serializedAnchor
            if (!anchor) {
                this.missingAnchorPaths.push(profile.hierarchyPath)
                continue
            }
            const materialName = profile.materials[0]
            const binding = materialName ? bindingsByName.get(materialName) : undefined
            if (!binding) {
                this.missingMaterialNames.push(materialName ?? '(missing material slot)')
                continue
            }
            const texture = particleTexture(binding, textures)
                ?? this.fallbackTexture
            const maxParticles = Math.max(
                1,
                finiteInt(record(preset.initial).maxNumParticles, 1),
            )
            let drawable: ActiveParticleSystem['drawable']
            let renderMode: ActiveParticleSystem['renderMode']
            let positions: THREE.BufferAttribute
            let colors: THREE.BufferAttribute
            let sizes: THREE.BufferAttribute
            let rotations: THREE.BufferAttribute
            let frames: THREE.BufferAttribute
            if (rendererMode === 4) {
                const rendererMeshes = Array.isArray(serializedRenderer.meshes)
                    ? serializedRenderer.meshes.map(record)
                    : []
                const meshPathID = String(rendererMeshes[0]?.pathID ?? '')
                const meshProfile = particleMeshesByPathID.get(meshPathID)
                const decoded = meshProfile
                    ? decodeParticleMeshGeometry(meshProfile, maxParticles)
                    : undefined
                if (!meshPathID || !decoded) {
                    this.missingRendererMeshPathIDs.push(
                        meshPathID || `${profile.pathID}:(missing serialized renderer mesh)`,
                    )
                    continue
                }
                const material = particleMaterial(
                    binding,
                    texture,
                    preset,
                    materialName
                        ? officialMaterialsByName.get(materialName)
                        : undefined,
                    textures,
                    'mesh',
                )
                const mesh = new THREE.Mesh(decoded.geometry, material)
                mesh.name = `UnityMeshParticleSystem:${profile.pathID}:${meshPathID}`
                mesh.frustumCulled = false
                mesh.renderOrder = finiteInt(preset.renderer.sortingOrder)
                mesh.onBeforeRender = (_renderer, _scene, camera) => {
                    syncParticleDepthCameraUniforms(material, camera)
                }
                drawable = mesh
                renderMode = 'mesh'
                positions = decoded.positions
                colors = decoded.colors
                sizes = decoded.sizes
                rotations = decoded.rotations
                frames = decoded.frames
                this.meshRendererAppliedCount++
            } else {
                const geometry = new THREE.BufferGeometry()
                positions = new THREE.BufferAttribute(new Float32Array(maxParticles * 3), 3)
                colors = new THREE.BufferAttribute(new Float32Array(maxParticles * 4), 4)
                sizes = new THREE.BufferAttribute(new Float32Array(maxParticles), 1)
                rotations = new THREE.BufferAttribute(new Float32Array(maxParticles), 1)
                frames = new THREE.BufferAttribute(new Float32Array(maxParticles), 1)
                geometry.setAttribute('position', positions)
                geometry.setAttribute('stageColor', colors)
                geometry.setAttribute('stageSize', sizes)
                geometry.setAttribute('stageRotation', rotations)
                geometry.setAttribute('stageFrame', frames)
                geometry.setDrawRange(0, 0)
                const material = particleMaterial(
                    binding,
                    texture,
                    preset,
                    materialName
                        ? officialMaterialsByName.get(materialName)
                        : undefined,
                    textures,
                    'billboard',
                )
                const points = new THREE.Points(geometry, material)
                points.name = `UnityParticleSystem:${profile.pathID}`
                points.frustumCulled = false
                points.renderOrder = finiteInt(preset.renderer.sortingOrder)
                points.onBeforeRender = (renderer, _scene, camera) => {
                    syncParticleDepthCameraUniforms(material, camera)
                    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
                    material.uniforms.uPointScale!.value = size.y * 0.5
                    material.uniforms.uPerspective!.value =
                        (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? 1 : 0
                    material.uniforms.uPointSizeRange!.value.set(
                        finite(preset.renderer.minParticleSize) * size.y,
                        Math.max(
                            finite(preset.renderer.minParticleSize) * size.y,
                            finite(preset.renderer.maxParticleSize, 1) * size.y,
                        ),
                    )
                }
                drawable = points
                renderMode = 'billboard'
            }
            anchor.add(drawable)
            this.registerOfficialParticlePass(
                profile,
                materialName,
                0,
                drawable,
                drawable.material,
                officialMaterialsByName.get(materialName),
                options.depthRegistrar,
            )
            let trail: ActiveParticleTrail | undefined
            const trailModule = record(preset.modules.trails)
            if (trailModule.enabled === true) {
                const trailMode = finiteInt(trailModule.mode)
                if (trailMode !== 0) {
                    this.unsupportedTrailModes.push({
                        hierarchyPath: profile.hierarchyPath,
                        mode: trailMode,
                    })
                } else {
                    const trailMaterialName = profile.materials[1]
                    const trailBinding = trailMaterialName
                        ? bindingsByName.get(trailMaterialName)
                        : undefined
                    if (!trailMaterialName || !trailBinding) {
                        this.missingTrailMaterialNames.push(
                            trailMaterialName ?? '(missing trail material slot 1)',
                        )
                    } else {
                        const trailTexture = particleTexture(trailBinding, textures)
                            ?? this.fallbackTexture
                        trail = createActiveParticleTrail(
                            profile,
                            preset,
                            trailBinding,
                            trailTexture,
                            officialMaterialsByName.get(trailMaterialName),
                            textures,
                            trailModule.worldSpace === true ? root : anchor,
                            trailMaterialName,
                        )
                        trail.drawable.onBeforeRender = (
                            _renderer,
                            _scene,
                            camera,
                        ) => {
                            syncParticleDepthCameraUniforms(
                                trail!.drawable.material,
                                camera,
                            )
                        }
                        this.registerOfficialParticlePass(
                            profile,
                            trailMaterialName,
                            1,
                            trail.drawable,
                            trail.drawable.material,
                            officialMaterialsByName.get(trailMaterialName),
                            options.depthRegistrar,
                        )
                        this.trailModuleAppliedCount++
                    }
                }
            }
            if (record(preset.modules.noise).enabled === true) {
                this.noiseModuleAppliedCount++
            }
            if (record(preset.modules.forceOverLifetime).enabled === true) {
                this.forceOverLifetimeAppliedCount++
            }
            const unsupportedModules = Object.keys(preset.modules)
                .filter(name => !supportedModules.has(name))
            const shapeType = finiteInt(record(preset.shape).type, -1)
            const seed = preset.autoRandomSeed
                ? hashString(profile.hierarchyPath)
                : preset.randomSeed >>> 0
            this.systems.push({
                profile,
                preset,
                anchor,
                drawable,
                renderMode,
                positions,
                colors,
                sizes,
                rotations,
                frames,
                trail,
                shapeVertices: findShapeVertices(
                    root,
                    anchor,
                    record(preset.shape).meshName,
                ),
                seed,
                continuousBirthTimes: buildContinuousBirthTimes(preset, seed),
                unsupportedModules,
                unsupportedShapeType: record(preset.shape).enabled !== false
                    && !supportedShapeTypes.has(shapeType)
                    ? shapeType
                    : undefined,
                usedCarrierHierarchyFallback:
                    exactAnchor == undefined && carrierAnchor != undefined,
                usedSerializedTransformFallback: serializedAnchor != undefined,
            })
        }
        this.update(0)
    }

    update(stageTime: number) {
        this.activeParticleCount = 0
        this.activeTrailSegmentCount = 0
        for (const system of this.systems) {
            this.updateSystem(system, stageTime)
        }
    }

    getDebugState(): StageParticleRuntimeDebugState {
        return {
            declaredSystemCount: this.declaredSystemCount,
            inactiveSystemCount: this.inactiveSystemCount,
            nonDrawableSystemCount: this.nonDrawableSystemCount,
            drawableSystemCount: this.systems.length,
            requestedSystemCount:
                this.systems.length + this.missingAnchorPaths.length + this.missingMaterialNames.length,
            activeSystemCount: this.systems.length,
            activeParticleCount: this.activeParticleCount,
            missingAnchorPaths: [...this.missingAnchorPaths],
            missingMaterialNames: [...this.missingMaterialNames],
            rendererModeCounts: { ...this.rendererModeCounts },
            meshRendererSystemCount: this.meshRendererSystemCount,
            meshRendererAppliedCount: this.meshRendererAppliedCount,
            noiseModuleSystemCount: this.noiseModuleSystemCount,
            noiseModuleAppliedCount: this.noiseModuleAppliedCount,
            noiseQualityCounts: { ...this.noiseQualityCounts },
            forceOverLifetimeSystemCount: this.forceOverLifetimeSystemCount,
            forceOverLifetimeAppliedCount: this.forceOverLifetimeAppliedCount,
            trailModuleSystemCount: this.trailModuleSystemCount,
            trailModuleAppliedCount: this.trailModuleAppliedCount,
            activeTrailSegmentCount: this.activeTrailSegmentCount,
            trailTextureModeCounts: { ...this.trailTextureModeCounts },
            softParticleDeclaredSystemCount: this.softParticleFields.length,
            softParticleAppliedSystemCount: this.softParticleFields.filter(
                field => field.depthRegistered,
            ).length,
            softParticleDepthConsumerCount: this.unregisterDepthConsumers.length,
            softParticleFields: this.softParticleFields.map(field => ({ ...field })),
            depthFunctionCounts: { ...this.depthFunctionCounts },
            missingTrailMaterialNames: [...this.missingTrailMaterialNames],
            unsupportedTrailModes: this.unsupportedTrailModes.map(value => ({ ...value })),
            missingRendererMeshPathIDs: [...this.missingRendererMeshPathIDs],
            unsupportedShapeTypes: this.systems
                .filter(system => system.unsupportedShapeType != undefined)
                .map(system => ({
                    hierarchyPath: system.profile.hierarchyPath,
                    type: system.unsupportedShapeType!,
                })),
            unsupportedModules: this.systems
                .filter(system => system.unsupportedModules.length > 0)
                .map(system => ({
                    hierarchyPath: system.profile.hierarchyPath,
                    modules: [...system.unsupportedModules],
                })),
            carrierHierarchyFallbackCount: this.systems.filter(
                system => system.usedCarrierHierarchyFallback,
            ).length,
            serializedTransformFallbackCount: this.systems.filter(
                system => system.usedSerializedTransformFallback,
            ).length,
            randomSeedAuthority: this.systems.some(system => system.preset.autoRandomSeed)
                ? 'deterministic-auto-seed-substitute'
                : 'serialized',
        }
    }

    dispose() {
        for (const unregister of this.unregisterDepthConsumers.splice(0)) {
            unregister()
        }
        for (const system of this.systems) {
            system.drawable.removeFromParent()
            system.drawable.geometry.dispose()
            system.drawable.material.dispose()
            if (system.trail) {
                system.trail.drawable.removeFromParent()
                system.trail.drawable.geometry.dispose()
                system.trail.drawable.material.dispose()
            }
        }
        this.systems.length = 0
        for (const anchor of this.serializedAnchors.splice(0)) {
            anchor.removeFromParent()
        }
        this.activeParticleCount = 0
        this.fallbackTexture.dispose()
    }

    private registerOfficialParticlePass(
        profile: StageParticleSystemProfile,
        materialName: string,
        materialSlot: number,
        object: THREE.Object3D,
        material: THREE.ShaderMaterial,
        official: OfficialParticleMaterialProfile | undefined,
        depthRegistrar: StageParticleDepthRegistrar | undefined,
    ) {
        const softParticle = officialSoftParticleState(official)
        const depthKey = `${softParticle.zTest}:${
            unityDepthFunctionName(softParticle.zTest)
        }`
        this.depthFunctionCounts[depthKey] = (
            this.depthFunctionCounts[depthKey] ?? 0
        ) + 1
        if (!softParticle.enabled) return

        let depthRegistered = false
        if (depthRegistrar) {
            material.uniforms.uUseSoftParticle!.value = 1
            const unregister = depthRegistrar.registerBackgroundDepthConsumer({
                object,
                depthTextureUniform: material.uniforms.uSceneDepth!,
                resolutionUniform: material.uniforms.uDepthResolution!,
            })
            this.unregisterDepthConsumers.push(unregister)
            depthRegistered = true
        }
        this.softParticleFields.push({
            hierarchyPath: profile.hierarchyPath,
            materialName,
            materialSlot,
            surfaceFadeNear: softParticle.surfaceFadeNear,
            surfaceFadeFar: softParticle.surfaceFadeFar,
            zTest: softParticle.zTest,
            depthRegistered,
        })
    }

    private updateSystem(system: ActiveParticleSystem, stageTime: number) {
        const { preset, seed } = system
        const initial = record(preset.initial)
        const emission = record(preset.emission)
        if (emission.enabled === false) {
            setSystemParticleCount(system, 0)
            system.trail?.drawable.geometry.setDrawRange(0, 0)
            return
        }
        const localTime = Math.max(0, stageTime) * preset.simulationSpeed
            + (preset.prewarm ? preset.duration : 0)
        const maxParticles = system.positions.count
        const nominalLifetime = Math.max(
            1e-4,
            evaluateStageMinMaxCurve(initial.startLifetime, random01(seed, 0, 21)),
        )
        const births: Array<{
            birthIndex: number
            birthTime: number
            shapePhase?: number
        }> = []
        const bursts = Array.isArray(emission.m_Bursts) ? emission.m_Bursts : []
        const loopCount = preset.looping && preset.duration > 0
            ? Math.floor(localTime / preset.duration)
            : 0
        const firstLoop = preset.looping && preset.duration > 0
            ? Math.max(
                0,
                Math.floor((localTime - nominalLifetime) / preset.duration) - 1,
            )
            : 0
        for (let loop = firstLoop; loop <= loopCount; loop++) {
            const loopOffset = loop * Math.max(0, preset.duration)
            for (let index = 0; index < system.continuousBirthTimes.length; index++) {
                const birthTime = loopOffset + system.continuousBirthTimes[index]
                if (birthTime <= localTime) {
                    births.push({
                        birthIndex: loop * 1_000_000 + index,
                        birthTime,
                    })
                }
            }
            for (let burstIndex = 0; burstIndex < bursts.length; burstIndex++) {
                const rawBurst = bursts[burstIndex]
                const burst = record(rawBurst)
                const cycles = Math.max(1, finiteInt(burst.cycleCount, 1))
                const repeat = Math.max(0, finite(burst.repeatInterval))
                for (let cycle = 0; cycle < cycles; cycle++) {
                    let burstBirthIndex = 0x40000000
                        + loop * 100_000
                        + burstIndex * 1_000
                        + cycle * 100
                    const birthTime = loopOffset + finite(burst.time) + cycle * repeat
                    if (birthTime > localTime) continue
                    if (
                        random01(seed, burstBirthIndex, 42)
                        > finite(burst.probability, 1)
                    ) {
                        burstBirthIndex += 1024
                        continue
                    }
                    const count = Math.max(0, Math.round(evaluateStageMinMaxCurve(
                        burst.countCurve,
                        random01(seed, burstBirthIndex, 43),
                    )))
                    for (let index = 0; index < count; index++) {
                        births.push({
                            birthIndex: burstBirthIndex++,
                            birthTime,
                            shapePhase: count > 0 ? index / count : 0,
                        })
                    }
                }
            }
        }
        births.sort((left, right) => right.birthTime - left.birthTime)
        if (births.length === 0) {
            setSystemParticleCount(system, 0)
            if (system.trail) {
                system.trail.drawable.geometry.setDrawRange(0, 0)
                system.trail.drawable.material.uniforms.uTime!.value = localTime
            }
            return
        }
        let active = 0
        const trailParticles: ActiveTrailParticle[] = []
        const particleEuler = new THREE.Euler(0, 0, 0, 'ZXY')
        const particleQuaternion = new THREE.Quaternion()
        for (const birth of births) {
            if (active >= maxParticles) break
            const { birthIndex, birthTime, shapePhase } = birth
            const age = localTime - birthTime
            const lifetime = Math.max(
                1e-4,
                evaluateStageMinMaxCurve(
                    initial.startLifetime,
                    random01(seed, birthIndex, 21),
                ),
            )
            if (birthIndex < 0 || age < 0 || age >= lifetime) continue
            if (!preset.looping && birthTime > preset.duration) continue
            const normalizedAge = age / lifetime
            const positionState = evaluateParticlePositionState(
                system,
                birthIndex,
                birthTime,
                age,
                lifetime,
                shapePhase,
            )
            const { integratedParticleNoise, finalParticleNoise } = positionState
            const noiseModule = record(preset.modules.noise)
            setAttributeValue(system.positions, active, positionState.position.toArray())

            const startColorValues = evaluateStageMinMaxGradient(
                initial.startColor,
                random01(seed, birthIndex, 30),
            )
            const colorModule = record(preset.modules.colorOverLifetime)
            const lifetimeColor = Object.keys(colorModule).length > 0
                ? evaluateStageMinMaxGradient(
                    colorModule.gradient,
                    random01(seed, birthIndex, 31),
                    normalizedAge,
                )
                : [1, 1, 1, 1]
            const particleColor = startColorValues.map((component, index) =>
                component * lifetimeColor[index]!)
            setAttributeValue(system.colors, active, particleColor)
            const baseSize = evaluateStageMinMaxCurve(
                initial.startSize,
                random01(seed, birthIndex, 25),
            )
            const sizeModule = record(preset.modules.sizeOverLifetime)
            const hasSizeModule = Object.keys(sizeModule).length > 0
            const sizeMultiplier = hasSizeModule
                ? evaluateStageMinMaxCurve(
                    sizeModule.curve,
                    random01(seed, birthIndex, 26),
                    normalizedAge,
                )
                : 1
            const noiseSizeMultiplier = finalParticleNoise
                ? Math.max(0, 1 + finalParticleNoise.x * evaluateStageMinMaxCurve(
                    noiseModule.sizeAmount,
                    random01(seed, birthIndex, 66),
                    normalizedAge,
                ))
                : 1
            const particleSize = baseSize * sizeMultiplier * noiseSizeMultiplier
            if (system.renderMode === 'mesh') {
                const size3D = initial.size3D === true
                const baseSizeY = size3D
                    ? evaluateStageMinMaxCurve(
                        initial.startSizeY,
                        random01(seed, birthIndex, 35),
                    )
                    : baseSize
                const baseSizeZ = size3D
                    ? evaluateStageMinMaxCurve(
                        initial.startSizeZ,
                        random01(seed, birthIndex, 36),
                    )
                    : baseSize
                const separateAxes = hasSizeModule && sizeModule.separateAxes === true
                const multiplierY = separateAxes
                    ? evaluateStageMinMaxCurve(
                        sizeModule.y,
                        random01(seed, birthIndex, 37),
                        normalizedAge,
                    )
                    : sizeMultiplier
                const multiplierZ = separateAxes
                    ? evaluateStageMinMaxCurve(
                        sizeModule.z,
                        random01(seed, birthIndex, 38),
                        normalizedAge,
                    )
                    : sizeMultiplier
                const flip = tuple(preset.renderer.flip, [0, 0, 0], 3)
                setAttributeValue(system.sizes, active, [
                    particleSize
                        * (random01(seed, birthIndex, 51) < flip[0] ? -1 : 1),
                    baseSizeY * multiplierY * noiseSizeMultiplier
                        * (random01(seed, birthIndex, 52) < flip[1] ? -1 : 1),
                    baseSizeZ * multiplierZ * noiseSizeMultiplier
                        * (random01(seed, birthIndex, 53) < flip[2] ? -1 : 1),
                ])
            } else {
                system.sizes.setX(active, particleSize)
            }
            const startRotation = evaluateStageMinMaxCurve(
                initial.startRotation,
                random01(seed, birthIndex, 27),
            )
            const rotationModule = record(preset.modules.rotationOverLifetime)
            const hasRotationModule = Object.keys(rotationModule).length > 0
            const rotation = hasRotationModule
                ? evaluateStageMinMaxCurve(
                    rotationModule.curve,
                    random01(seed, birthIndex, 28),
                    normalizedAge,
                ) * age
                : 0
            const noiseRotation = integratedParticleNoise
                ? evaluateStageMinMaxCurve(
                    noiseModule.rotationAmount,
                    random01(seed, birthIndex, 65),
                    normalizedAge,
                ) * THREE.MathUtils.DEG2RAD
                : 0
            if (system.renderMode === 'mesh') {
                const rotation3D = initial.rotation3D === true
                let rotationX = rotation3D
                    ? evaluateStageMinMaxCurve(
                        initial.startRotationX,
                        random01(seed, birthIndex, 39),
                    )
                    : 0
                let rotationY = rotation3D
                    ? evaluateStageMinMaxCurve(
                        initial.startRotationY,
                        random01(seed, birthIndex, 40),
                    )
                    : 0
                let rotationZ = startRotation + rotation
                if (hasRotationModule && rotationModule.separateAxes === true) {
                    rotationX += evaluateStageMinMaxCurve(
                        rotationModule.x,
                        random01(seed, birthIndex, 41),
                        normalizedAge,
                    ) * age
                    rotationY += evaluateStageMinMaxCurve(
                        rotationModule.y,
                        random01(seed, birthIndex, 42),
                        normalizedAge,
                    ) * age
                    rotationZ = startRotation + evaluateStageMinMaxCurve(
                        rotationModule.curve,
                        random01(seed, birthIndex, 43),
                        normalizedAge,
                    ) * age
                }
                if (integratedParticleNoise && noiseRotation !== 0) {
                    rotationX += integratedParticleNoise.x * noiseRotation
                    rotationY += integratedParticleNoise.y * noiseRotation
                    rotationZ += integratedParticleNoise.z * noiseRotation
                }
                particleEuler.set(rotationX, rotationY, rotationZ, 'ZXY')
                particleQuaternion.setFromEuler(particleEuler)
                setAttributeValue(system.rotations, active, [
                    particleQuaternion.x,
                    -particleQuaternion.y,
                    -particleQuaternion.z,
                    particleQuaternion.w,
                ])
            } else {
                system.rotations.setX(
                    active,
                    startRotation + rotation
                        + (integratedParticleNoise?.z ?? 0) * noiseRotation,
                )
            }
            const uvModule = record(preset.modules.textureSheetAnimation)
            const frame = Object.keys(uvModule).length > 0
                ? finite(uvModule.timeMode) === 2
                    ? Math.floor(age * finite(uvModule.fps))
                    : Math.floor(
                        evaluateStageMinMaxCurve(
                            uvModule.frameOverTime,
                            random01(seed, birthIndex, 29),
                            normalizedAge,
                        ) * Math.max(
                            1,
                            finiteInt(uvModule.tilesX, 1) * finiteInt(uvModule.tilesY, 1),
                        ),
                    )
                : 0
            system.frames.setX(active, frame)
            if (system.trail) {
                trailParticles.push({
                    birthIndex,
                    birthTime,
                    shapePhase,
                    age,
                    lifetime,
                    normalizedAge,
                    color: particleColor,
                    size: Math.abs(particleSize),
                })
            }
            active++
        }
        system.drawable.material.uniforms.uTime!.value = localTime
        setSystemParticleCount(system, active)
        system.positions.needsUpdate = true
        system.colors.needsUpdate = true
        system.sizes.needsUpdate = true
        system.rotations.needsUpdate = true
        system.frames.needsUpdate = true
        this.activeTrailSegmentCount += updateParticleTrail(
            system,
            trailParticles,
            localTime,
        )
        this.activeParticleCount += active
    }
}
