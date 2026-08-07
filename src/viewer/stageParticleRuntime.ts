import * as THREE from 'three'

export interface OfficialStageParticleCurveKey {
    time: number
    value: number
    inSlope: number
    outSlope: number
}

export interface OfficialStageParticleSystemProfile {
    name: string
    /** Signed Unity PathID kept as decimal text so JavaScript never rounds the 64-bit value. */
    pathId: string
    /** Exact current-JP transform composed into stage-root space. */
    position: [number, number, number]
    /** Exact current-JP local quaternion; the serialized parent rotation is identity. */
    rotation: [number, number, number, number]
}

export interface OfficialStageParticleRuntimeProfile {
    stageObjectName: string
    source: 'official-jp-current-assetbundle'
    assetBundleRevision: string
    fidelity: 'serialized-parameter-driven-approximation'
    textureUrl: string
    textureName: string
    textureSize: [number, number]
    texturePixelSha256: string
    material: {
        name: string
        renderQueue: number
        srcBlend: number
        dstBlend: number
        zWrite: number
        baseColor: [number, number, number, number]
    }
    duration: number
    simulationSpeed: number
    maxParticles: number
    prewarm: boolean
    startLifetime: number
    startSpeed: [number, number]
    startSize: [number, number]
    startRotation: [number, number]
    gravityModifier: number
    emissionRate: [number, number]
    shape: {
        type: 'cone'
        serializedType: number
        angleDegrees: number
        radius: number
        radiusThickness: number
        length: number
        arcDegrees: number
    }
    sizeOverLifetime: OfficialStageParticleCurveKey[]
    rotationOverLifetime: number
    textureSheet: {
        columns: number
        rows: number
        fps: number
        timeMode: number
        animationType: number
    }
    systems: OfficialStageParticleSystemProfile[]
    deferred: string[]
}

export interface OfficialStageParticleRuntimeDebugState {
    enabled: boolean
    source: OfficialStageParticleRuntimeProfile['source']
    fidelity: OfficialStageParticleRuntimeProfile['fidelity']
    assetBundleRevision: string
    textureName: string
    texturePixelSha256: string
    loaded: boolean
    loadError?: string
    systemCount: number
    activeParticles: number
    maxParticles: number
    deferred: string[]
}

interface ActiveParticle {
    sprite: THREE.Sprite
    age: number
    lifetime: number
    baseSize: number
    rotation: number
    velocity: THREE.Vector3
}

const BUBBLE_TEXTURE_URL =
    './stages/official/battle-608-00-00-001/bg3d608_00_blue_bubble_col.png'

const BUBBLE_SYSTEMS: OfficialStageParticleSystemProfile[] = [
    {
        name: 'Particle System',
        pathId: '-6858687396393823220',
        position: [-22.100000381469727, 0.6600000262260437, 0],
        rotation: [-0.7071068286895752, 0, 0, 0.7071068286895752],
    },
    {
        name: 'Particle System_001',
        pathId: '-7586315711235274196',
        position: [22.100000381469727, 0.6600000262260437, 0],
        rotation: [-0.7071068286895752, 0, 0, 0.7071068286895752],
    },
    {
        name: 'Particle System_002',
        pathId: '1198205605091357490',
        position: [12.720000386238098, 0.6600000262260437, 19.369998931884766],
        rotation: [-0.7071068286895752, 0, 0, 0.7071068286895752],
    },
    {
        name: 'Particle System_003',
        pathId: '1996371953391616376',
        position: [-14.170000076293945, 0.6600000262260437, 18.56999969482422],
        rotation: [-0.7071068286895752, 0, 0, 0.7071068286895752],
    },
    {
        name: 'Particle System_004',
        pathId: '-1294285691191015837',
        position: [-14.59000015258789, 0.6600000262260437, -18.170000791549683],
        rotation: [-0.7071068286895752, 0, 0, 0.7071068286895752],
    },
    {
        name: 'Particle System_005',
        pathId: '5963673205634448717',
        position: [13.450000375509262, 0.6600000262260437, -19.620000764727592],
        rotation: [-0.7071068286895752, 0, 0, 0.7071068286895752],
    },
]

/**
 * Exact current-JP serialized values are retained below. The Web simulation is
 * intentionally labelled an approximation: Unity's ParticleSystem RNG, cone
 * sampling and integration order have not yet been reconstructed from native
 * behavior. Exact source data and approximate execution are kept separate.
 */
export const OFFICIAL_608_BUBBLE_PROFILE: OfficialStageParticleRuntimeProfile = {
    stageObjectName: 'Stage:battle-608-00-00-001',
    source: 'official-jp-current-assetbundle',
    assetBundleRevision: '61ad830ca038a9efd58e67170a61c85e',
    fidelity: 'serialized-parameter-driven-approximation',
    textureUrl: BUBBLE_TEXTURE_URL,
    textureName: 'bg3d608_00_blue_bubble_col',
    textureSize: [32, 128],
    texturePixelSha256:
        '57fe4cf6e45c3061955dae3bfd8d923837a275085fa1678ada13f6f1d3471f1e',
    material: {
        name: 'bg3d608_00_blue_bubble',
        renderQueue: 3000,
        srcBlend: 5,
        dstBlend: 10,
        zWrite: 0,
        baseColor: [
            0.8773584961891174,
            0.8773584961891174,
            0.8773584961891174,
            1,
        ],
    },
    duration: 5,
    simulationSpeed: 0.30000001192092896,
    maxParticles: 50,
    prewarm: true,
    startLifetime: 5,
    startSpeed: [1, 2],
    startSize: [0.5, 2],
    startRotation: [0, 3.141592502593994],
    gravityModifier: -0.10000000149011612,
    emissionRate: [0.75, 2],
    shape: {
        type: 'cone',
        serializedType: 4,
        angleDegrees: 25,
        radius: 1,
        radiusThickness: 1,
        length: 5,
        arcDegrees: 360,
    },
    sizeOverLifetime: [
        {
            time: 0,
            value: 0,
            inSlope: 4.162921905517578,
            outSlope: 4.162921905517578,
        },
        {
            time: 0.5419226288795471,
            value: 0.8764061331748962,
            inSlope: 0,
            outSlope: 0,
        },
        {
            time: 1,
            value: 0,
            inSlope: -4.16291618347168,
            outSlope: -4.16291618347168,
        },
    ],
    rotationOverLifetime: 0.7853981852531433,
    textureSheet: {
        columns: 1,
        rows: 4,
        fps: 2,
        timeMode: 2,
        animationType: 1,
    },
    systems: BUBBLE_SYSTEMS,
    deferred: [
        'Unity ParticleSystem autoRandomSeed/RNG parity',
        'exact Unity cone emission sampling and placement order',
        'exact Unity ParticleSystem integration/update ordering',
        'texture-sheet row/origin parity against the native particle shader',
    ],
}

export function getOfficialStageParticleRuntimeProfile(rootName: string) {
    return rootName === OFFICIAL_608_BUBBLE_PROFILE.stageObjectName
        ? OFFICIAL_608_BUBBLE_PROFILE
        : undefined
}

export function hasOfficialStageParticleRuntime(rootName: string) {
    return getOfficialStageParticleRuntimeProfile(rootName) != undefined
}

class StableWebApproxRandom {
    private readonly initialState: number
    private state: number

    constructor(pathId: string) {
        const folded = Number(BigInt(pathId) & 0xffffffffn) >>> 0
        this.initialState = folded || 0x9e3779b9
        this.state = this.initialState
    }

    reset() {
        this.state = this.initialState
    }

    next() {
        let state = this.state
        state ^= state << 13
        state ^= state >>> 17
        state ^= state << 5
        this.state = state >>> 0
        return this.state / 0x100000000
    }
}

function sampleRange(
    random: StableWebApproxRandom,
    [min, max]: [number, number],
) {
    return min + ((max - min) * random.next())
}

function evaluateHermiteCurve(
    keys: OfficialStageParticleCurveKey[],
    normalizedTime: number,
) {
    if (keys.length === 0) return 1
    const t = THREE.MathUtils.clamp(normalizedTime, 0, 1)
    if (t <= keys[0].time) return keys[0].value
    if (t >= keys[keys.length - 1].time) return keys[keys.length - 1].value

    for (let index = 0; index < keys.length - 1; index++) {
        const from = keys[index]
        const to = keys[index + 1]
        if (t > to.time) continue
        const duration = to.time - from.time
        const u = duration > 0 ? (t - from.time) / duration : 0
        const u2 = u * u
        const u3 = u2 * u
        const h00 = (2 * u3) - (3 * u2) + 1
        const h10 = u3 - (2 * u2) + u
        const h01 = (-2 * u3) + (3 * u2)
        const h11 = u3 - u2
        return (h00 * from.value)
            + (h10 * duration * from.outSlope)
            + (h01 * to.value)
            + (h11 * duration * to.inSlope)
    }
    return keys[keys.length - 1].value
}

class ApproximateBubbleSystemRuntime {
    private readonly root: THREE.Group
    private readonly profile: OfficialStageParticleRuntimeProfile
    private readonly system: OfficialStageParticleSystemProfile
    private readonly frameTextures: THREE.Texture[]
    private readonly random: StableWebApproxRandom
    private readonly particles: ActiveParticle[] = []
    private emissionCountdown = 0

    constructor(
        root: THREE.Group,
        profile: OfficialStageParticleRuntimeProfile,
        system: OfficialStageParticleSystemProfile,
        frameTextures: THREE.Texture[],
    ) {
        this.root = root
        this.profile = profile
        this.system = system
        this.random = new StableWebApproxRandom(system.pathId)
        this.emissionCountdown = this.sampleEmissionInterval()
    }

    get activeParticleCount() {
        return this.particles.length
    }

    reset() {
        for (const particle of this.particles) {
            this.root.remove(particle.sprite)
            particle.sprite.material.dispose()
        }
        this.particles.length = 0
        this.random.reset()
        this.emissionCountdown = this.sampleEmissionInterval()
    }

    prewarm() {
        if (!this.profile.prewarm) return
        this.simulateFor(this.profile.duration)
    }

    simulateFor(simulatedSeconds: number) {
        let remaining = Math.max(0, simulatedSeconds)
        const fixedStep = 1 / 30
        while (remaining > 1e-7) {
            const step = Math.min(fixedStep, remaining)
            this.updateSimulation(step)
            remaining -= step
        }
    }

    updateTimeline(deltaSeconds: number) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return
        this.simulateFor(deltaSeconds * this.profile.simulationSpeed)
    }

    private sampleEmissionInterval() {
        const rate = Math.max(
            1e-4,
            sampleRange(this.random, this.profile.emissionRate),
        )
        return 1 / rate
    }

    private updateSimulation(deltaSeconds: number) {
        this.emissionCountdown -= deltaSeconds
        while (
            this.emissionCountdown <= 0
            && this.particles.length < this.profile.maxParticles
        ) {
            this.spawnParticle()
            this.emissionCountdown += this.sampleEmissionInterval()
        }

        // Physics.gravity.y (-9.81) multiplied by the exact serialized -0.1
        // gravityModifier produces an upward acceleration. Integration order is
        // still a Web approximation and is deliberately listed as deferred.
        const gravityY = -9.81 * this.profile.gravityModifier
        for (let index = this.particles.length - 1; index >= 0; index--) {
            const particle = this.particles[index]
            particle.age += deltaSeconds
            if (particle.age >= particle.lifetime) {
                this.root.remove(particle.sprite)
                particle.sprite.material.dispose()
                this.particles.splice(index, 1)
                continue
            }

            particle.velocity.y += gravityY * deltaSeconds
            particle.sprite.position.addScaledVector(particle.velocity, deltaSeconds)
            particle.rotation += this.profile.rotationOverLifetime * deltaSeconds
            const normalizedAge = particle.age / particle.lifetime
            const sizeFactor = evaluateHermiteCurve(
                this.profile.sizeOverLifetime,
                normalizedAge,
            )
            particle.sprite.scale.setScalar(
                Math.max(0, particle.baseSize * sizeFactor),
            )
            particle.sprite.material.rotation = particle.rotation
            const frame = Math.floor(
                particle.age * this.profile.textureSheet.fps,
            ) % this.profile.textureSheet.rows
            particle.sprite.material.map = this.frameTextures[frame]
        }
    }

    private spawnParticle() {
        const profile = this.profile
        const system = this.system
        const theta = this.random.next() * Math.PI * 2
        const radial = Math.sqrt(this.random.next()) * profile.shape.radius
        const localOffset = new THREE.Vector3(
            Math.cos(theta) * radial,
            Math.sin(theta) * radial,
            0,
        )
        const angle = THREE.MathUtils.degToRad(profile.shape.angleDegrees)
        const directionRadius = Math.tan(angle) * this.random.next()
        const localDirection = new THREE.Vector3(
            Math.cos(theta) * directionRadius,
            Math.sin(theta) * directionRadius,
            1,
        ).normalize()
        const rotation = new THREE.Quaternion(...system.rotation)
        localOffset.applyQuaternion(rotation)
        localDirection.applyQuaternion(rotation)

        const material = new THREE.SpriteMaterial({
            map: this.frameTextures[0],
            color: new THREE.Color().setRGB(
                profile.material.baseColor[0],
                profile.material.baseColor[1],
                profile.material.baseColor[2],
            ),
            opacity: profile.material.baseColor[3],
            transparent: true,
            depthWrite: profile.material.zWrite !== 0,
            depthTest: true,
            blending: THREE.CustomBlending,
            blendSrc: THREE.SrcAlphaFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            blendEquation: THREE.AddEquation,
        })
        material.name = `${profile.material.name}:${system.name}`

        const sprite = new THREE.Sprite(material)
        sprite.name = `${system.name}:bubble`
        // This preserves the exact serialized queue value as ordering metadata;
        // Three.js renderOrder is not claimed to be Unity renderQueue parity.
        sprite.renderOrder = profile.material.renderQueue
        sprite.position.set(...system.position).add(localOffset)
        const baseSize = sampleRange(this.random, profile.startSize)
        const initialSize = evaluateHermiteCurve(profile.sizeOverLifetime, 0)
        sprite.scale.setScalar(Math.max(0, baseSize * initialSize))
        const initialRotation = sampleRange(this.random, profile.startRotation)
        material.rotation = initialRotation
        this.root.add(sprite)

        this.particles.push({
            sprite,
            age: 0,
            lifetime: profile.startLifetime,
            baseSize,
            rotation: initialRotation,
            velocity: localDirection.multiplyScalar(
                sampleRange(this.random, profile.startSpeed),
            ),
        })
    }
}

export class OfficialStageParticleRuntimeController {
    private readonly root: THREE.Object3D
    private readonly profile: OfficialStageParticleRuntimeProfile
    private readonly effectRoot = new THREE.Group()
    private readonly systems: ApproximateBubbleSystemRuntime[] = []
    private readonly ownedTextures: THREE.Texture[] = []
    private disposed = false
    private loaded = false
    private loadError?: string
    private timelineTime = 0

    constructor(
        root: THREE.Object3D,
        profile: OfficialStageParticleRuntimeProfile,
        startTime = 0,
    ) {
        this.root = root
        this.profile = profile
        this.timelineTime = Math.max(0, startTime)
        this.effectRoot.name = 'Eff_Bubbles:web-serialized-parameter-approximation'
        this.effectRoot.userData.fidelity = profile.fidelity
        root.add(this.effectRoot)
        this.loadTexture()
    }

    update(deltaSeconds: number) {
        if (this.disposed || !this.loaded) return
        this.timelineTime += deltaSeconds
        for (const system of this.systems) system.updateTimeline(deltaSeconds)
    }

    seek(timeSeconds: number) {
        if (this.disposed) return
        this.timelineTime = Math.max(0, timeSeconds)
        if (!this.loaded) return
        this.resetAndSimulate(this.timelineTime)
    }

    getDebugState(): OfficialStageParticleRuntimeDebugState {
        return {
            enabled: !this.disposed,
            source: this.profile.source,
            fidelity: this.profile.fidelity,
            assetBundleRevision: this.profile.assetBundleRevision,
            textureName: this.profile.textureName,
            texturePixelSha256: this.profile.texturePixelSha256,
            loaded: this.loaded,
            loadError: this.loadError,
            systemCount: this.profile.systems.length,
            activeParticles: this.systems.reduce(
                (sum, system) => sum + system.activeParticleCount,
                0,
            ),
            maxParticles: this.profile.maxParticles * this.profile.systems.length,
            deferred: [...this.profile.deferred],
        }
    }

    dispose() {
        if (this.disposed) return
        this.disposed = true
        for (const system of this.systems) system.reset()
        this.systems.length = 0
        this.root.remove(this.effectRoot)
        for (const texture of this.ownedTextures) texture.dispose()
        this.ownedTextures.length = 0
    }

    private loadTexture() {
        if (typeof document === 'undefined') {
            this.loadError = 'document unavailable; browser texture load deferred'
            return
        }
        const url = new URL(this.profile.textureUrl, document.baseURI).href
        new THREE.TextureLoader().load(
            url,
            texture => {
                if (this.disposed) {
                    texture.dispose()
                    return
                }
                texture.colorSpace = THREE.SRGBColorSpace
                texture.wrapS = THREE.ClampToEdgeWrapping
                texture.wrapT = THREE.ClampToEdgeWrapping
                texture.generateMipmaps = false
                texture.minFilter = THREE.LinearFilter
                texture.magFilter = THREE.LinearFilter
                texture.needsUpdate = true
                this.ownedTextures.push(texture)

                const frameTextures = Array.from(
                    { length: this.profile.textureSheet.rows },
                    (_, frame) => {
                        const clone = texture.clone()
                        clone.repeat.set(
                            1 / this.profile.textureSheet.columns,
                            1 / this.profile.textureSheet.rows,
                        )
                        clone.offset.set(
                            0,
                            frame / this.profile.textureSheet.rows,
                        )
                        clone.needsUpdate = true
                        this.ownedTextures.push(clone)
                        return clone
                    },
                )
                for (const systemProfile of this.profile.systems) {
                    this.systems.push(new ApproximateBubbleSystemRuntime(
                        this.effectRoot,
                        this.profile,
                        systemProfile,
                        frameTextures,
                    ))
                }
                this.loaded = true
                this.resetAndSimulate(this.timelineTime)
            },
            undefined,
            error => {
                if (this.disposed) return
                this.loadError = error instanceof Error
                    ? error.message
                    : String(error)
                console.warn('Could not load exact JP 608 bubble texture:', error)
            },
        )
    }

    private resetAndSimulate(timelineTime: number) {
        for (const system of this.systems) {
            system.reset()
            system.prewarm()
            system.updateTimeline(timelineTime)
        }
    }
}

export function createOfficialStageParticleRuntimeController(
    root: THREE.Object3D,
    startTime = 0,
) {
    const profile = getOfficialStageParticleRuntimeProfile(root.name)
    return profile == undefined
        ? undefined
        : new OfficialStageParticleRuntimeController(root, profile, startTime)
}
