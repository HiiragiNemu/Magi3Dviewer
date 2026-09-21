import * as THREE from 'three'
import { CSM } from 'three/examples/jsm/csm/CSM.js'


/**
 * Current-JP Unity 2022.3.62f2 active URP asset (pathID 14160) plus a fresh
 * TW battle-frame capture. Four cascades occupy a 2x2 2048 atlas, so each
 * cascade has a 1024-square texel budget. The battle distance is recovered
 * from _MainLightShadowParams using URP 14's exact squared-distance fade.
 */
export const OFFICIAL_URP_MAIN_SHADOW_PROFILE = {
    atlasSize: 2048,
    cascadeCount: 4,
    cascadeMapSize: 1024,
    cascadeSplits: [0.05, 0.25, 0.5, 1] as const,
    cascadeBorder: 0.1,
    softShadowQuality: 'low',
    softKernelRadius: 1.5,
    defaultShadowDistance: 20,
    battleShadowDistance: 60,
} as const

export type StageShadowQuality = 'official' | 'balanced' | 'performance'

export interface StageShadowQualityProfile {
    readonly cascadeCount: number
    readonly cascadeMapSize: number
    readonly cascadeSplits: readonly number[]
    readonly cascadeBorder: number
    readonly atlasSize: number
}

/**
 * `official` is the immutable product default. The other profiles are Viewer
 * runtime budgets and are only selected through an explicit API call.
 */
export const STAGE_SHADOW_QUALITY_PROFILES = {
    official: OFFICIAL_URP_MAIN_SHADOW_PROFILE,
    balanced: {
        cascadeCount: 3,
        cascadeMapSize: 768,
        cascadeSplits: [0.1, 0.4, 1],
        cascadeBorder: 0.1,
        atlasSize: 1536,
    },
    performance: {
        cascadeCount: 2,
        cascadeMapSize: 512,
        cascadeSplits: [0.25, 1],
        cascadeBorder: 0.1,
        atlasSize: 1024,
    },
} as const satisfies Record<StageShadowQuality, StageShadowQualityProfile>

export function resolveStageShadowQualityProfile(
    quality: StageShadowQuality,
): StageShadowQualityProfile {
    const profile = STAGE_SHADOW_QUALITY_PROFILES[quality]
    if (!profile) throw new RangeError(`Unknown stage shadow quality: ${quality}`)
    return profile
}

export function resolveOfficialMainShadowDistance(stageCategory?: string) {
    return stageCategory === 'battle'
        ? OFFICIAL_URP_MAIN_SHADOW_PROFILE.battleShadowDistance
        : OFFICIAL_URP_MAIN_SHADOW_PROFILE.defaultShadowDistance
}

export interface StageMainLightCascadeOptions {
    camera: THREE.PerspectiveCamera
    parent: THREE.Object3D
    stageObject: THREE.Object3D
    sourceLight: THREE.DirectionalLight
    stageLayer: number
    maxShadowDistance: number
    shadowCasterGateKey: string
    characterCastersEnabled: boolean
    /** Serialized Unity Light.shadowBias, before URP texel conversion. */
    unityShadowBias: number
    /** Serialized Unity Light.shadowNormalBias, before URP texel conversion. */
    unityShadowNormalBias: number
    quality?: StageShadowQuality
}

export interface OfficialUrpDirectionalShadowCandidate {
    readonly directional: boolean
    readonly role: 'character-key' | 'background' | null
    readonly active: boolean
    readonly affectsStageLayer: boolean
    readonly skippedAsBaked: boolean
    readonly requestsShadow: boolean
}

export type OfficialUrpDirectionalShadowConsumer =
    | 'main-cascade'
    | 'additional-directional-unshadowed'
    | 'legacy-directional-shadow'
    | 'none'

export interface OfficialUrpDirectionalShadowPlanRecord {
    readonly runtimeCastShadow: boolean
    readonly consumer: OfficialUrpDirectionalShadowConsumer
}

/**
 * URP owns one cascaded directional MainLight. Its additional realtime shadow
 * atlas is a punctual-light path (spot/point), so serialized directionals that
 * remain in the additional-light loop keep their direct contribution but do
 * not allocate directional shadow slots beside the cascade slices.
 *
 * Generated profiles explicitly identify the character-key MainLight. Older
 * profiles without that recovered role retain their previous behaviour rather
 * than guessing a MainLight from scene order.
 */
export function resolveOfficialUrpDirectionalShadowPlan(
    candidates: readonly OfficialUrpDirectionalShadowCandidate[],
) {
    const eligible = (candidate: OfficialUrpDirectionalShadowCandidate) =>
        candidate.directional
        && candidate.active
        && candidate.affectsStageLayer
        && !candidate.skippedAsBaked
        && candidate.requestsShadow
    const mainProfileIndex = candidates.findIndex(candidate =>
        eligible(candidate) && candidate.role === 'character-key'
    )
    const records: OfficialUrpDirectionalShadowPlanRecord[] = candidates.map(
        (candidate, index) => {
            if (!eligible(candidate)) {
                return { runtimeCastShadow: false, consumer: 'none' }
            }
            if (mainProfileIndex < 0) {
                return {
                    runtimeCastShadow: true,
                    consumer: 'legacy-directional-shadow',
                }
            }
            if (index === mainProfileIndex) {
                return { runtimeCastShadow: true, consumer: 'main-cascade' }
            }
            return {
                runtimeCastShadow: false,
                consumer: 'additional-directional-unshadowed',
            }
        },
    )
    return { mainProfileIndex, records }
}

export interface OfficialUrpDirectionalCascadeBias {
    readonly worldTexelSize: number
    readonly casterDepthBiasWorld: number
    readonly casterNormalBiasWorld: number
    /** Three receiver-depth equivalent in normalized orthographic depth. */
    readonly receiverDepthBias: number
    /** Three receiver-normal equivalent of Unity's inward caster offset. */
    readonly receiverNormalBias: number
}

function requireFiniteShadowNumber(name: string, value: number) {
    if (!Number.isFinite(value)) {
        throw new RangeError(`${name} must be a finite number`)
    }
    return value
}

/**
 * URP 14 `ShadowUtils.GetShadowBias` converts the serialized Light values to
 * world-space texels per cascade and expands both for the active low-quality
 * soft-shadow kernel (radius 1.5). Three applies bias on the receiver rather
 * than in the shadow-caster vertex pass, so the returned receiver values use
 * the equivalent opposite normal offset and normalized orthographic depth.
 */
export function resolveOfficialUrpDirectionalCascadeBias(options: {
    frustumSize: number
    shadowResolution: number
    shadowNear: number
    shadowFar: number
    unityShadowBias: number
    unityShadowNormalBias: number
}): OfficialUrpDirectionalCascadeBias {
    const frustumSize = requireFiniteShadowNumber(
        'frustumSize',
        options.frustumSize,
    )
    const shadowResolution = requireFiniteShadowNumber(
        'shadowResolution',
        options.shadowResolution,
    )
    const shadowNear = requireFiniteShadowNumber('shadowNear', options.shadowNear)
    const shadowFar = requireFiniteShadowNumber('shadowFar', options.shadowFar)
    const unityShadowBias = requireFiniteShadowNumber(
        'unityShadowBias',
        options.unityShadowBias,
    )
    const unityShadowNormalBias = requireFiniteShadowNumber(
        'unityShadowNormalBias',
        options.unityShadowNormalBias,
    )
    if (frustumSize <= 0) throw new RangeError('frustumSize must be positive')
    if (shadowResolution <= 0) {
        throw new RangeError('shadowResolution must be positive')
    }
    if (shadowFar <= shadowNear) {
        throw new RangeError('shadowFar must be greater than shadowNear')
    }
    if (unityShadowBias < 0 || unityShadowNormalBias < 0) {
        throw new RangeError('Serialized Unity shadow biases must be non-negative')
    }

    const worldTexelSize = frustumSize / shadowResolution
    const kernelRadius = OFFICIAL_URP_MAIN_SHADOW_PROFILE.softKernelRadius
    const casterDepthBiasWorld =
        -unityShadowBias * worldTexelSize * kernelRadius
    const casterNormalBiasWorld =
        -unityShadowNormalBias * worldTexelSize * kernelRadius
    const depthRange = shadowFar - shadowNear
    return {
        worldTexelSize,
        casterDepthBiasWorld,
        casterNormalBiasWorld,
        receiverDepthBias: casterDepthBiasWorld / depthRange,
        receiverNormalBias: -casterNormalBiasWorld,
    }
}

interface CascadedMaterial extends THREE.Material {
    defines?: Record<string, unknown>
}

interface MaterialState {
    material: CascadedMaterial
    hadOwnDefines: boolean
    defines: Record<string, unknown> | undefined
    defineValues: Record<string, unknown> | undefined
    onBeforeCompile: THREE.Material['onBeforeCompile']
    customProgramCacheKey: THREE.Material['customProgramCacheKey']
}

const stockLightsFragmentBegin = THREE.ShaderChunk.lights_fragment_begin
const stockLightsParsBegin = THREE.ShaderChunk.lights_pars_begin
let activeShaderChunkOwner: StageMainLightCascadeController | undefined

const csmShadowSample = `if(linearDepth >= CSM_cascades[UNROLLED_LOOP_INDEX].x && linearDepth < CSM_cascades[UNROLLED_LOOP_INDEX].y) directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;`

const stockDirectionalShadowNormalOffset = `shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );`
const officialUrpDirectionalShadowNormalOffset = `shadowWorldPosition = worldPosition + vec4(
                shadowWorldNormal
                * directionalLightShadows[ i ].shadowNormalBias
                * (1.0 - clamp(dot(CSM_mainLightToSourceDirection, shadowWorldNormal), 0.0, 1.0)),
                0
            );`

const officialUrpLowShadowFunction = `
#if defined( USE_CSM ) && defined( CSM_CASCADES ) && defined( USE_SHADOWMAP )
    #if defined( SHADOWMAP_TYPE_PCF )
        float getOfficialUrpLowMainShadow(
            sampler2DShadow shadowMap,
            vec2 shadowMapSize,
            float shadowIntensity,
            float shadowBias,
            float shadowRadius,
            vec4 shadowCoord
        ) {
            float shadow = 1.0;
            shadowCoord.xyz /= shadowCoord.w;
            shadowCoord.z += shadowBias;

            bool inFrustum =
                shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0
                && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
            bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
            if (frustumTest) {
                // URP 14 SampleShadowmapFilteredLowQuality: four fixed
                // hardware-comparison taps at the half-texel corners.
                vec2 halfTexel = vec2(0.5) / shadowMapSize;
                shadow = 0.25 * (
                    texture(shadowMap, vec3(
                        shadowCoord.xy + vec2(-halfTexel.x, -halfTexel.y),
                        shadowCoord.z
                    ))
                    + texture(shadowMap, vec3(
                        shadowCoord.xy + vec2(halfTexel.x, -halfTexel.y),
                        shadowCoord.z
                    ))
                    + texture(shadowMap, vec3(
                        shadowCoord.xy + vec2(-halfTexel.x, halfTexel.y),
                        shadowCoord.z
                    ))
                    + texture(shadowMap, vec3(
                        shadowCoord.xy + vec2(halfTexel.x, halfTexel.y),
                        shadowCoord.z
                    ))
                );
            }
            return mix(1.0, shadow, shadowIntensity);
        }
    #else
        #define getOfficialUrpLowMainShadow getShadow
    #endif
#endif
`

const officialUrpShadowSample = `#if ( UNROLLED_LOOP_INDEX < CSM_CASCADES )
                if(linearDepth >= CSM_cascades[UNROLLED_LOOP_INDEX].x && linearDepth < CSM_cascades[UNROLLED_LOOP_INDEX].y) {
                    float stageMainShadow = ( directLight.visible && receiveShadow ) ? getOfficialUrpLowMainShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
					float stageMainShadowFarSq = shadowFar * shadowFar;
					float stageMainShadowFadeNear = pow( 1.0 - CSM_cascadeBorder, 2.0 ) * stageMainShadowFarSq;
					float stageMainShadowFade = clamp(
						( dot( vViewPosition, vViewPosition ) - stageMainShadowFadeNear )
						/ max( stageMainShadowFarSq - stageMainShadowFadeNear, 0.000001 ),
						0.0,
						1.0
					);
					directLight.color *= mix( stageMainShadow, 1.0, stageMainShadowFade );
				}
                #endif`

const csmCascadeDirectApply = `if(linearDepth >= CSM_cascades[UNROLLED_LOOP_INDEX].x && (linearDepth < CSM_cascades[UNROLLED_LOOP_INDEX].y || UNROLLED_LOOP_INDEX == CSM_CASCADES - 1)) RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );`

const officialUrpCascadeDirectApply = `#if ( UNROLLED_LOOP_INDEX < CSM_CASCADES )
                if(linearDepth >= CSM_cascades[UNROLLED_LOOP_INDEX].x && (linearDepth < CSM_cascades[UNROLLED_LOOP_INDEX].y || UNROLLED_LOOP_INDEX == CSM_CASCADES - 1)) RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
                #elif ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
                directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
                RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
                #endif`

function installOfficialUrpCsmShaderChunks(owner: StageMainLightCascadeController) {
    if (activeShaderChunkOwner && activeShaderChunkOwner !== owner) {
        throw new Error('Only one official stage main-light CSM may be active')
    }

    const fragment = THREE.ShaderChunk.lights_fragment_begin
    if (!fragment.includes(csmShadowSample)) {
        throw new Error('Three CSM directional-shadow sample no longer matches')
    }
    if (!fragment.includes(csmCascadeDirectApply)) {
        throw new Error('Three CSM directional-light apply no longer matches')
    }
    const pars = THREE.ShaderChunk.lights_pars_begin
    const parsNeedle = `uniform float shadowFar;
#endif`
    if (!pars.includes(parsNeedle)) {
        throw new Error('Three CSM shadow-distance uniforms no longer match')
    }

    THREE.ShaderChunk.lights_fragment_begin = fragment
        .replace(csmShadowSample, officialUrpShadowSample)
        .replace(csmCascadeDirectApply, officialUrpCascadeDirectApply)
    THREE.ShaderChunk.lights_pars_begin = `${pars.replace(
        parsNeedle,
        `uniform float shadowFar;
uniform float CSM_cascadeBorder;
#endif`,
    )}\n${officialUrpLowShadowFunction}`
    activeShaderChunkOwner = owner
}

function restoreStockShaderChunks(owner: StageMainLightCascadeController) {
    if (activeShaderChunkOwner !== owner) return
    THREE.ShaderChunk.lights_fragment_begin = stockLightsFragmentBegin
    THREE.ShaderChunk.lights_pars_begin = stockLightsParsBegin
    activeShaderChunkOwner = undefined
}

/**
 * A stage-scoped CSM bridge. Material discovery happens once at stage load;
 * update() only synchronizes four light/frustum matrices before rendering.
 */
export class StageMainLightCascadeController {
    readonly lightDirection = new THREE.Vector3()
    readonly mainLightToSourceDirection = new THREE.Vector3()
    private readonly camera: THREE.PerspectiveCamera
    private readonly sourceLight: THREE.DirectionalLight
    private readonly sourceVisible: boolean
    private readonly sourceCastShadow: boolean
    private readonly maxShadowDistance: number
    private readonly quality: StageShadowQuality
    private readonly qualityProfile: StageShadowQualityProfile
    private readonly unityShadowBias: number
    private readonly unityShadowNormalBias: number
    private cascadeBiases: OfficialUrpDirectionalCascadeBias[] = []
    private readonly projectionSnapshot = new THREE.Matrix4()
    private readonly sourcePosition = new THREE.Vector3()
    private readonly sourceTarget = new THREE.Vector3()
    private readonly sourceDirection = new THREE.Vector3()
    private readonly materialStates: MaterialState[] = []
    private csm: CSM | undefined
    private disposed = false
    private suspended: {
        chunks: [string, string]
        attachments: { object: THREE.Object3D; parent: THREE.Object3D; index: number }[]
    } | undefined

    constructor(options: StageMainLightCascadeOptions) {
        this.camera = options.camera
        this.sourceLight = options.sourceLight
        this.sourceVisible = options.sourceLight.visible
        this.sourceCastShadow = options.sourceLight.castShadow
        this.maxShadowDistance = requireFiniteShadowNumber(
            'maxShadowDistance',
            options.maxShadowDistance,
        )
        if (this.maxShadowDistance <= 0) {
            throw new RangeError('maxShadowDistance must be positive')
        }
        this.quality = options.quality ?? 'official'
        this.qualityProfile = resolveStageShadowQualityProfile(this.quality)
        this.unityShadowBias = requireFiniteShadowNumber(
            'unityShadowBias',
            options.unityShadowBias,
        )
        this.unityShadowNormalBias = requireFiniteShadowNumber(
            'unityShadowNormalBias',
            options.unityShadowNormalBias,
        )
        if (this.unityShadowBias < 0 || this.unityShadowNormalBias < 0) {
            throw new RangeError('Serialized Unity shadow biases must be non-negative')
        }
        this.syncSourceDirection(true)

        if (activeShaderChunkOwner) {
            throw new Error('Only one official stage main-light CSM may be active')
        }
        // Reserve ownership before Three's CSM constructor replaces the global
        // light chunks. If construction or validation fails, dispose() can now
        // restore the exact stock chunks instead of leaving a partial CSM hook.
        activeShaderChunkOwner = this

        let csm: CSM | undefined
        try {
            csm = new CSM({
                camera: options.camera,
                parent: options.parent,
                cascades: this.qualityProfile.cascadeCount,
                maxFar: options.maxShadowDistance,
                mode: 'custom',
                shadowMapSize: this.qualityProfile.cascadeMapSize,
                shadowBias: 0,
                lightDirection: this.lightDirection,
                lightIntensity: options.sourceLight.intensity,
                lightNear: options.sourceLight.shadow.camera.near,
                lightFar: options.maxShadowDistance * 2,
                lightMargin: options.maxShadowDistance,
                customSplitsCallback: (_cascades, _near, _far, target) => {
                    target.push(
                        ...this.qualityProfile.cascadeSplits,
                    )
                },
            })
            this.csm = csm
            csm.fade = false
            installOfficialUrpCsmShaderChunks(this)

            csm.lights.forEach((light, index) => {
                light.name = `${options.sourceLight.name}:Cascade${index + 1}`
                light.color.copy(options.sourceLight.color)
                light.intensity = options.sourceLight.intensity
                light.layers.set(options.stageLayer)
                light.castShadow = true
                light.shadow.intensity = options.sourceLight.shadow.intensity
                light.shadow.radius = options.sourceLight.shadow.radius
                light.shadow.camera.near = options.sourceLight.shadow.camera.near
                light.shadow.camera.far = options.maxShadowDistance * 2
                light.shadow.camera.userData[options.shadowCasterGateKey] =
                    options.characterCastersEnabled
                light.shadow.camera.updateProjectionMatrix()
            })
            this.applyOfficialCascadeBiases()

            this.installStageMaterials(options.stageObject)
            options.sourceLight.shadow.map?.dispose()
            options.sourceLight.shadow.map = null
            options.sourceLight.castShadow = false
            options.sourceLight.visible = false
            this.projectionSnapshot.copy(options.camera.projectionMatrix)
            this.update()
        } catch (error) {
            this.csm = csm
            this.dispose()
            throw error
        }
    }

    /** Yield the global shader owner without destroying maps/materials. */
    suspend() {
        if (this.disposed || this.suspended) return
        const attachments = (this.csm?.lights ?? []).flatMap(light =>
            [light, light.target].flatMap(object => object.parent
                ? [{ object, parent: object.parent, index: object.parent.children.indexOf(object) }]
                : []))
        this.suspended = {
            chunks: [THREE.ShaderChunk.lights_fragment_begin, THREE.ShaderChunk.lights_pars_begin],
            attachments,
        }
        attachments.forEach(({ object }) => object.removeFromParent())
        restoreStockShaderChunks(this)
    }

    resume() {
        if (this.disposed || !this.suspended) return
        if (activeShaderChunkOwner && activeShaderChunkOwner !== this) {
            throw new Error('Stage CSM rollback still has a candidate shader owner')
        }
        const { chunks, attachments } = this.suspended
        THREE.ShaderChunk.lights_fragment_begin = chunks[0]
        THREE.ShaderChunk.lights_pars_begin = chunks[1]
        activeShaderChunkOwner = this
        attachments.sort((a, b) => a.index - b.index).forEach(({ object, parent, index }) => {
            parent.add(object)
            parent.children.splice(parent.children.indexOf(object), 1)
            parent.children.splice(index, 0, object)
        })
        this.suspended = undefined
    }

    get lights() {
        return this.csm?.lights ?? []
    }

    update() {
        const csm = this.csm
        if (this.disposed || this.suspended || !csm) return
        this.syncSourceDirection(false)
        if (!this.projectionSnapshot.equals(this.camera.projectionMatrix)) {
            csm.updateFrustums()
            this.applyOfficialCascadeBiases()
            this.projectionSnapshot.copy(this.camera.projectionMatrix)
        }
        csm.update()
    }

    getDebugState() {
        return {
            authority:
                'Steam JP URP pathID 14160 + fresh TW MainLightShadowParams',
            quality: this.quality,
            officialDefaultsActive: this.quality === 'official',
            cascadeCount: this.qualityProfile.cascadeCount,
            cascadeSplits: [
                ...this.qualityProfile.cascadeSplits,
            ],
            cascadeBorder: this.qualityProfile.cascadeBorder,
            atlasSize: this.qualityProfile.atlasSize,
            cascadeMapSize: this.qualityProfile.cascadeMapSize,
            shadowDistance: this.maxShadowDistance,
            lightCount: this.csm?.lights.length ?? 0,
            materialCount: this.materialStates.length,
            softShadowQuality:
                OFFICIAL_URP_MAIN_SHADOW_PROFILE.softShadowQuality,
            shadowSampling: {
                quality: OFFICIAL_URP_MAIN_SHADOW_PROFILE.softShadowQuality,
                tapCount: 4,
                offsets: 'half-texel-corners',
            },
            softKernelRadius:
                OFFICIAL_URP_MAIN_SHADOW_PROFILE.softKernelRadius,
            biasMode: 'per-cascade-receiver-equivalent',
            unityShadowBias: this.unityShadowBias,
            unityShadowNormalBias: this.unityShadowNormalBias,
            normalBiasAngleScale: '1-saturate(NdotL)',
            shadowSamplerUpload: 'renderer-preallocated-once',
            mainLightToSourceDirection:
                this.mainLightToSourceDirection.toArray(),
            cascadeBiases: this.cascadeBiases.map(value => ({ ...value })),
            perFrameSceneTraversal: false,
        }
    }

    dispose() {
        if (this.disposed) return
        this.disposed = true
        const csm = this.csm
        this.csm = undefined
        if (csm) {
            csm.lights.forEach(light => {
                light.shadow.map?.dispose()
                light.shadow.map = null
            })
            csm.remove()
            csm.dispose()
            csm.lights.length = 0
        }
        this.materialStates.forEach(state => {
            const { material } = state
            material.onBeforeCompile = state.onBeforeCompile
            material.customProgramCacheKey = state.customProgramCacheKey
            if (state.hadOwnDefines) {
                const defines = state.defines ?? {}
                Object.keys(defines).forEach(key => delete defines[key])
                Object.assign(defines, state.defineValues)
                material.defines = defines
            } else delete material.defines
            material.needsUpdate = true
        })
        this.materialStates.length = 0
        this.cascadeBiases = []
        this.sourceLight.visible = this.sourceVisible
        this.sourceLight.castShadow = this.sourceCastShadow
        restoreStockShaderChunks(this)
    }

    private installStageMaterials(stageObject: THREE.Object3D) {
        const csm = this.csm!
        const materials = new Set<CascadedMaterial>()
        stageObject.traverse(object => {
            const mesh = object as THREE.Mesh
            if (!mesh.isMesh) return
            const meshMaterials = Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material]
            meshMaterials.forEach(value => {
                const material = value as CascadedMaterial & {
                    isMeshStandardMaterial?: boolean
                }
                if (material?.isMeshStandardMaterial) materials.add(material)
            })
        })

        materials.forEach(material => {
            const hadOwnDefines = Object.prototype.hasOwnProperty.call(
                material,
                'defines',
            )
            const state: MaterialState = {
                material,
                hadOwnDefines,
                defines: hadOwnDefines ? material.defines : undefined,
                defineValues: hadOwnDefines
                    ? { ...(material.defines ?? {}) }
                    : undefined,
                onBeforeCompile: material.onBeforeCompile,
                customProgramCacheKey: material.customProgramCacheKey,
            }
            this.materialStates.push(state)

            csm.setupMaterial(material)
            const csmOnBeforeCompile = material.onBeforeCompile
            const controller = this
            material.onBeforeCompile = function (shader, renderer) {
                state.onBeforeCompile.call(this, shader, renderer)
                csmOnBeforeCompile.call(this, shader, renderer)
                shader.uniforms.CSM_cascadeBorder = {
                    value: controller.qualityProfile.cascadeBorder,
                }
                shader.uniforms.CSM_mainLightToSourceDirection = {
                    value: controller.mainLightToSourceDirection,
                }
                // Three r182 pre-allocates every shadow sampler before the
                // material upload. Leaving these uniforms dirty uploads the
                // same arrays a second time, consuming another cascadeCount
                // texture units and overflowing WebGL's per-draw limit.
                for (const key of [
                    'directionalShadowMap',
                    'spotShadowMap',
                    'pointShadowMap',
                ]) {
                    const uniform = shader.uniforms[key] as
                        (THREE.IUniform & { needsUpdate?: boolean }) | undefined
                    if (uniform) uniform.needsUpdate = false
                }
                if (!shader.vertexShader.includes('#include <shadowmap_vertex>')) {
                    throw new Error('Three directional shadow vertex include no longer matches')
                }
                const shadowVertex = THREE.ShaderChunk.shadowmap_vertex
                if (!shadowVertex.includes(stockDirectionalShadowNormalOffset)) {
                    throw new Error('Three directional normal-bias offset no longer matches')
                }
                shader.vertexShader = `uniform vec3 CSM_mainLightToSourceDirection;\n${shader.vertexShader.replace(
                    '#include <shadowmap_vertex>',
                    shadowVertex.replace(
                        stockDirectionalShadowNormalOffset,
                        officialUrpDirectionalShadowNormalOffset,
                    ),
                )}`
            }
            material.customProgramCacheKey = function () {
                return [
                    state.customProgramCacheKey.call(this),
                    'stage-urp-main-csm-v5',
                    controller.quality,
                    controller.qualityProfile.cascadeCount,
                    controller.qualityProfile.cascadeMapSize,
                    controller.qualityProfile.cascadeBorder,
                    controller.maxShadowDistance,
                ].join(':')
            }
            material.needsUpdate = true
        })
    }

    private applyOfficialCascadeBiases() {
        const csm = this.csm
        if (!csm) return
        this.cascadeBiases = csm.lights.map(light => {
            const camera = light.shadow.camera as THREE.OrthographicCamera
            const bias = resolveOfficialUrpDirectionalCascadeBias({
                frustumSize: camera.right - camera.left,
                shadowResolution: this.qualityProfile.cascadeMapSize,
                shadowNear: camera.near,
                shadowFar: camera.far,
                unityShadowBias: this.unityShadowBias,
                unityShadowNormalBias: this.unityShadowNormalBias,
            })
            light.shadow.bias = bias.receiverDepthBias
            light.shadow.normalBias = bias.receiverNormalBias
            return bias
        })
    }

    private syncSourceDirection(initial: boolean) {
        this.sourceLight.updateWorldMatrix(true, false)
        this.sourceLight.target.updateWorldMatrix(true, false)
        this.sourceLight.getWorldPosition(this.sourcePosition)
        this.sourceLight.target.getWorldPosition(this.sourceTarget)
        this.sourceDirection.subVectors(this.sourceTarget, this.sourcePosition)
        if (this.sourceDirection.lengthSq() <= 1e-12) {
            if (initial) {
                throw new Error('Official stage MainLight has a degenerate direction')
            }
            return
        }
        this.lightDirection.copy(this.sourceDirection).normalize()
        this.mainLightToSourceDirection.copy(this.lightDirection).negate()
    }
}
