import * as THREE from 'three'

import { unityWorldToViewerVector } from 'magia-exedra-character-three/coordinateSpace'
import type { StageMaterialBinding } from './stageMaterialBindings'
import { resolveStageHierarchyPath } from './stageHierarchy'
import type {
    StageParticlePresetProfile,
    StageParticleSystemProfile,
} from './stageRuntime'

export interface StageParticleRuntimeDebugState {
    requestedSystemCount: number
    activeSystemCount: number
    activeParticleCount: number
    missingAnchorPaths: string[]
    missingMaterialNames: string[]
    unsupportedModules: Array<{ hierarchyPath: string; modules: string[] }>
    carrierHierarchyFallbackCount: number
    randomSeedAuthority: 'serialized' | 'deterministic-auto-seed-substitute'
}

interface ActiveParticleSystem {
    profile: StageParticleSystemProfile
    preset: StageParticlePresetProfile
    anchor: THREE.Object3D
    points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
    positions: THREE.BufferAttribute
    colors: THREE.BufferAttribute
    sizes: THREE.BufferAttribute
    rotations: THREE.BufferAttribute
    frames: THREE.BufferAttribute
    shapeVertices: THREE.Vector3[]
    seed: number
    unsupportedModules: string[]
    usedCarrierHierarchyFallback: boolean
}

type UnknownRecord = Record<string, unknown>

const supportedModules = new Set([
    'colorOverLifetime',
    'sizeOverLifetime',
    'rotationOverLifetime',
    'textureSheetAnimation',
])

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
    const url = binding.textures?.base?.url ?? binding.baseMapUrl
    if (!url) return undefined
    return textures.find(texture => {
        const source = texture.userData.stageTextureBinding as { url?: string } | undefined
        return source?.url === url || texture.name === `StageTexture:${url}`
    })
}

function particleMaterial(
    binding: StageMaterialBinding,
    texture: THREE.Texture,
    preset: StageParticlePresetProfile,
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
    texture.updateMatrix()
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: texture },
            uMapTransform: { value: texture.matrix },
            uBaseColor: { value: new THREE.Color(base[0], base[1], base[2]) },
            uEmissionColor: {
                value: new THREE.Color(emission[0], emission[1], emission[2]),
            },
            uOpacity: { value: finite(base[3], 1) },
            uPointScale: { value: 1 },
            uPerspective: { value: 1 },
            uPointSizeRange: { value: new THREE.Vector2(0, 1e20) },
            uTiles: { value: new THREE.Vector2(tilesX, tilesY) },
        },
        vertexShader: /* glsl */ `
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
            }
        `,
        fragmentShader: /* glsl */ `
            uniform sampler2D uMap;
            uniform mat3 uMapTransform;
            uniform vec3 uBaseColor;
            uniform vec3 uEmissionColor;
            uniform float uOpacity;
            uniform vec2 uTiles;
            varying vec4 vStageColor;
            varying float vStageRotation;
            varying float vStageFrame;
            void main() {
                vec2 centered = gl_PointCoord - 0.5;
                float c = cos(vStageRotation);
                float s = sin(vStageRotation);
                vec2 pointUv = mat2(c, -s, s, c) * centered + 0.5;
                pointUv.y = 1.0 - pointUv.y;
                float frame = mod(floor(vStageFrame), uTiles.x * uTiles.y);
                vec2 tile = vec2(mod(frame, uTiles.x), floor(frame / uTiles.x));
                pointUv = (pointUv + tile) / uTiles;
                vec2 uv = (uMapTransform * vec3(pointUv, 1.0)).xy;
                vec4 texel = texture2D(uMap, uv);
                vec3 color = texel.rgb * vStageColor.rgb * (uBaseColor + uEmissionColor);
                float alpha = texel.a * vStageColor.a * uOpacity;
                if (alpha <= 1e-4) discard;
                gl_FragColor = vec4(color, alpha);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
        transparent: binding.transparent ?? true,
        depthWrite: binding.depthWrite ?? false,
        depthTest: true,
        blending: binding.blending === 'additive'
            ? THREE.AdditiveBlending
            : binding.blending === 'multiply'
                ? THREE.MultiplyBlending
                : THREE.NormalBlending,
    })
    material.name = `StageParticle:${binding.materialName ?? 'unnamed'}`
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

function spawnState(system: ActiveParticleSystem, birthIndex: number) {
    const { preset, seed } = system
    const shape = record(preset.shape)
    const type = finiteInt(shape.type, -1)
    const shapePosition = tuple(shape.m_Position, [0, 0, 0], 3)
    const position = new THREE.Vector3(...unityWorldToViewerVector([
        shapePosition[0],
        shapePosition[1],
        shapePosition[2],
    ]))
    const direction = new THREE.Vector3(0, 0, 1)
    if (type === 6 && system.shapeVertices.length > 0) {
        const index = Math.min(
            system.shapeVertices.length - 1,
            Math.floor(random01(seed, birthIndex, 11) * system.shapeVertices.length),
        )
        position.add(system.shapeVertices[index])
    } else if (type === 5) {
        const scale = tuple(shape.m_Scale, [1, 1, 1], 3)
        position.add(new THREE.Vector3(
            (random01(seed, birthIndex, 12) - 0.5) * scale[0],
            (random01(seed, birthIndex, 13) - 0.5) * scale[1],
            (random01(seed, birthIndex, 14) - 0.5) * scale[2],
        ))
    } else if (type === 4) {
        const radius = finite(record(shape.radius).value, 1)
        const radial = Math.sqrt(random01(seed, birthIndex, 15)) * radius
        const azimuth = random01(seed, birthIndex, 16) * Math.PI * 2
        position.add(new THREE.Vector3(
            Math.cos(azimuth) * radial,
            Math.sin(azimuth) * radial,
            0,
        ))
        const angle = THREE.MathUtils.degToRad(finite(shape.angle, 25))
            * Math.sqrt(random01(seed, birthIndex, 17))
        direction.set(
            Math.cos(azimuth) * Math.sin(angle),
            Math.sin(azimuth) * Math.sin(angle),
            Math.cos(angle),
        )
    }
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
    direction.applyQuaternion(viewerShapeRotation).normalize()
    return { position, direction }
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

export class StageParticleRuntimeController {
    private readonly systems: ActiveParticleSystem[] = []
    private readonly missingAnchorPaths: string[] = []
    private readonly missingMaterialNames: string[] = []
    private activeParticleCount = 0

    constructor(
        root: THREE.Object3D,
        presets: readonly StageParticlePresetProfile[],
        profiles: readonly StageParticleSystemProfile[],
        materialBindings: readonly StageMaterialBinding[],
        textures: readonly THREE.Texture[],
    ) {
        const presetsById = new Map(presets.map(preset => [preset.id, preset]))
        const bindingsByName = new Map(
            materialBindings
                .filter(binding => binding.materialName)
                .map(binding => [binding.materialName!, binding]),
        )
        for (const profile of profiles) {
            if (!profile.active) continue
            const preset = presetsById.get(profile.presetId)
            if (!preset || !preset.playOnAwake) continue
            const exactAnchor = resolveStageHierarchyPath(root, profile.hierarchyPath)
            const anchor = exactAnchor ?? resolveStageHierarchyPath(
                root,
                profile.carrierHierarchyPath,
            )
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
            if (!texture) {
                this.missingMaterialNames.push(materialName ?? '(missing texture)')
                continue
            }
            const maxParticles = Math.max(
                1,
                finiteInt(record(preset.initial).maxNumParticles, 1),
            )
            const geometry = new THREE.BufferGeometry()
            const positions = new THREE.BufferAttribute(new Float32Array(maxParticles * 3), 3)
            const colors = new THREE.BufferAttribute(new Float32Array(maxParticles * 4), 4)
            const sizes = new THREE.BufferAttribute(new Float32Array(maxParticles), 1)
            const rotations = new THREE.BufferAttribute(new Float32Array(maxParticles), 1)
            const frames = new THREE.BufferAttribute(new Float32Array(maxParticles), 1)
            geometry.setAttribute('position', positions)
            geometry.setAttribute('stageColor', colors)
            geometry.setAttribute('stageSize', sizes)
            geometry.setAttribute('stageRotation', rotations)
            geometry.setAttribute('stageFrame', frames)
            geometry.setDrawRange(0, 0)
            const material = particleMaterial(binding, texture, preset)
            const points = new THREE.Points(geometry, material)
            points.name = `UnityParticleSystem:${profile.pathID}`
            points.frustumCulled = false
            points.renderOrder = finiteInt(preset.renderer.sortingOrder)
            points.onBeforeRender = (renderer, _scene, camera) => {
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
            anchor.add(points)
            const unsupportedModules = Object.keys(preset.modules)
                .filter(name => !supportedModules.has(name))
            this.systems.push({
                profile,
                preset,
                anchor,
                points,
                positions,
                colors,
                sizes,
                rotations,
                frames,
                shapeVertices: findShapeVertices(
                    root,
                    anchor,
                    record(preset.shape).meshName,
                ),
                seed: preset.autoRandomSeed
                    ? hashString(profile.hierarchyPath)
                    : preset.randomSeed >>> 0,
                unsupportedModules,
                usedCarrierHierarchyFallback: exactAnchor == undefined,
            })
        }
        this.update(0)
    }

    update(stageTime: number) {
        this.activeParticleCount = 0
        for (const system of this.systems) {
            this.updateSystem(system, stageTime)
        }
    }

    getDebugState(): StageParticleRuntimeDebugState {
        return {
            requestedSystemCount:
                this.systems.length + this.missingAnchorPaths.length + this.missingMaterialNames.length,
            activeSystemCount: this.systems.length,
            activeParticleCount: this.activeParticleCount,
            missingAnchorPaths: [...this.missingAnchorPaths],
            missingMaterialNames: [...this.missingMaterialNames],
            unsupportedModules: this.systems
                .filter(system => system.unsupportedModules.length > 0)
                .map(system => ({
                    hierarchyPath: system.profile.hierarchyPath,
                    modules: [...system.unsupportedModules],
                })),
            carrierHierarchyFallbackCount: this.systems.filter(
                system => system.usedCarrierHierarchyFallback,
            ).length,
            randomSeedAuthority: this.systems.some(system => system.preset.autoRandomSeed)
                ? 'deterministic-auto-seed-substitute'
                : 'serialized',
        }
    }

    dispose() {
        for (const system of this.systems) {
            system.points.removeFromParent()
            system.points.geometry.dispose()
            system.points.material.dispose()
        }
        this.systems.length = 0
        this.activeParticleCount = 0
    }

    private updateSystem(system: ActiveParticleSystem, stageTime: number) {
        const { preset, seed } = system
        const initial = record(preset.initial)
        const emission = record(preset.emission)
        const localTime = Math.max(0, stageTime) * preset.simulationSpeed
            + (preset.prewarm ? preset.duration : 0)
        const lifetime = Math.max(
            1e-4,
            evaluateStageMinMaxCurve(initial.startLifetime, random01(seed, 0, 21)),
        )
        const maxParticles = system.positions.count
        const serializedRate = Math.max(
            0,
            evaluateStageMinMaxCurve(
                emission.rateOverTime,
                random01(seed, 0, 22),
                preset.duration > 0
                    ? (localTime % preset.duration) / preset.duration
                    : 0,
            ),
        )
        const rate = Math.min(serializedRate, maxParticles / lifetime)
        if (rate <= 0 || (!preset.looping && localTime > preset.duration + lifetime)) {
            system.points.geometry.setDrawRange(0, 0)
            return
        }
        const lastBirthIndex = Math.floor(localTime * rate)
        let active = 0
        for (let slot = 0; slot < maxParticles; slot++) {
            const birthIndex = lastBirthIndex - slot
            const birthTime = birthIndex / rate
            const age = localTime - birthTime
            if (birthIndex < 0 || age < 0 || age >= lifetime) continue
            if (!preset.looping && birthTime > preset.duration) continue
            const normalizedAge = age / lifetime
            const spawn = spawnState(system, birthIndex)
            const speed = evaluateStageMinMaxCurve(
                initial.startSpeed,
                random01(seed, birthIndex, 23),
            )
            const gravity = evaluateStageMinMaxCurve(
                initial.gravityModifier,
                random01(seed, birthIndex, 24),
                normalizedAge,
            )
            spawn.position.addScaledVector(spawn.direction, speed * age)
            spawn.position.y -= 0.5 * 9.81 * gravity * age * age
            setAttributeValue(system.positions, active, spawn.position.toArray())

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
            setAttributeValue(
                system.colors,
                active,
                startColorValues.map((component, index) =>
                    component * lifetimeColor[index]),
            )
            const baseSize = evaluateStageMinMaxCurve(
                initial.startSize,
                random01(seed, birthIndex, 25),
            )
            const sizeModule = record(preset.modules.sizeOverLifetime)
            const sizeMultiplier = Object.keys(sizeModule).length > 0
                ? evaluateStageMinMaxCurve(
                    sizeModule.curve,
                    random01(seed, birthIndex, 26),
                    normalizedAge,
                )
                : 1
            system.sizes.setX(active, baseSize * sizeMultiplier)
            const startRotation = evaluateStageMinMaxCurve(
                initial.startRotation,
                random01(seed, birthIndex, 27),
            )
            const rotationModule = record(preset.modules.rotationOverLifetime)
            const rotation = Object.keys(rotationModule).length > 0
                ? evaluateStageMinMaxCurve(
                    rotationModule.curve,
                    random01(seed, birthIndex, 28),
                    normalizedAge,
                ) * age
                : 0
            system.rotations.setX(active, startRotation + rotation)
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
            active++
        }
        system.points.geometry.setDrawRange(0, active)
        system.positions.needsUpdate = true
        system.colors.needsUpdate = true
        system.sizes.needsUpdate = true
        system.rotations.needsUpdate = true
        system.frames.needsUpdate = true
        this.activeParticleCount += active
    }
}
