import * as THREE from 'three'
import {
    addAnimationLoop,
    getClockDelta,
    removeAnimationLoop,
} from 'magia-exedra-character-three/renderer'
import { resolveStageHierarchyPath } from './stageHierarchy'
import { prepareStageTransformAnimations, type StageTransformAnimationProfile } from './stageTransformAnimations'
import type { StageMaterialBinding } from './stageMaterialBindings'
import {
    StageParticleRuntimeController,
    type OfficialParticleMaterialProfile,
    type StageParticleDepthRegistrar,
    type StageParticleRuntimeDebugState,
} from './stageParticles'

/**
 * Declarative voice metadata for the shared stage clock.
 *
 * This module deliberately does not fetch or decode audio. The fields below
 * are the stable hand-off contract for the later WebAudio/HCA integration, so
 * voice, character action, expression and lip-sync can all seek against the
 * same stage time instead of maintaining independent clocks.
 */
export interface StageVoiceTrackProfile {
    id: string
    characterId?: string
    url?: string
    startTime?: number
    offset?: number
    duration?: number
    volume?: number
    loop?: boolean
    actionName?: string
    expressionName?: string
    lipSyncUrl?: string
}

export interface StageRotatorProfile {
    /** Exact serialized hierarchy path; generated profiles use this first. */
    hierarchyPath?: string
    /** Legacy exact object name; ambiguous duplicate names are not guessed. */
    objectName?: string
    /** Native LinearRotater.rotation value, measured in degrees per second. */
    degreesPerSecond: [number, number, number]
    space?: 'self'
}

export interface StageParticlePresetProfile {
    id: string
    duration: number
    simulationSpeed: number
    looping: boolean
    prewarm: boolean
    playOnAwake: boolean
    useUnscaledTime?: boolean
    autoRandomSeed: boolean
    randomSeed: number
    moveWithTransform: number
    scalingMode: number
    initial: Record<string, unknown>
    emission: Record<string, unknown>
    shape: Record<string, unknown>
    modules: Record<string, Record<string, unknown>>
    renderer: Record<string, unknown>
}

export interface StageParticleSystemProfile {
    pathID: string
    hierarchyPath: string
    /** Collision-safe FBX carrier path derived from the nearest Renderer PathID. */
    carrierHierarchyPath?: string
    /**
     * Serialized Unity world transform, row-major. Empty ParticleSystem
     * GameObjects are omitted by the FBX carrier; this preserves their exact
     * authored placement without relying on a scene-specific name fallback.
     */
    serializedWorldMatrix?: number[]
    active: boolean
    presetId: string
    materials: string[]
}

/** Exact serialized Mesh used by ParticleSystemRenderer.renderMode=Mesh. */
export interface StageParticleMeshProfile {
    pathID: string
    name: string
    vertexCount: number
    indexCount: number
    indexType: 'uint16' | 'uint32'
    positionsBase64: string
    normalsBase64?: string
    uv0Base64?: string
    colorsBase64?: string
    indicesBase64: string
    coordinateConvention: 'Unity mesh reflect X; triangle CBA'
}

export interface StageSerializedComponentClipProfile {
    pathID: string
    name: string
    sampleRate: number
    duration: number
    loop: boolean
    bindings: Array<Record<string, unknown>>
}

export interface StageAnimatorRandomizerProfile {
    componentPathID: string
    hierarchyPath?: string
    enabled: boolean
    animatorPathID: string
    animator?: Record<string, unknown>
    selectionAuthority: string
}

export interface StageVolumetricLightBeamConfigProfile {
    name: 'VLBConfigOverride'
    geometryOverrideLayer: boolean
    geometryLayerID: number
    geometryTag: string
    geometryRenderQueue: number
    /** VLB RenderPipeline.URP = 1. */
    renderPipeline: number
    /** VLB RenderingMode.SinglePass = 1. */
    renderingMode: number
    ditheringFactor: number
    sharedMeshSides: number
    sharedMeshSegments: number
    globalNoiseScale: number
    globalNoiseVelocity: [number, number, number]
    fadeOutCameraTag: string
    noiseTexture3D: { fileID: number; pathID: number }
    dustParticlesPrefab: { fileID: number; pathID: number }
    ditheringNoiseTexture: { fileID: number; pathID: number }
    featureEnabledColorGradient: number
    featureEnabledDepthBlend: boolean
    featureEnabledNoise3D: boolean
    featureEnabledDynamicOcclusion: boolean
    featureEnabledMeshSkewing: boolean
    featureEnabledShaderAccuracyHigh: boolean
    pluginVersion: number
    dummyMaterial: { fileID: number; pathID: number }
    beamShader: { fileID: number; pathID: number }
    source?: string
    sourceBytes?: number
    objectPathID?: string
    objectBytes?: number
}

export interface StageVolumetricLightBeamProfile {
    componentPathID: string
    gameObjectPathID: string
    hierarchyPath?: string
    active: boolean
    lightAnchorPath?: string
    linkedLight?: {
        pathID: string
        name: string
        hierarchyPath: string
        active: boolean
        enabled: boolean
        type: 'spot'
        color: [number, number, number, number]
        intensity: number
        range: number
        outerAngleDegrees: number
        innerAngleDegrees: number
        worldPosition: [number, number, number]
        worldForward: [number, number, number]
    }
    colorFromLight: boolean
    colorMode: number
    color: [number, number, number, number]
    colorGradient?: Record<string, unknown>
    intensityFromLight: boolean
    intensityModeAdvanced: number
    intensityInside: number
    intensityOutside: number
    blendingMode: number
    spotAngleFromLight: boolean
    spotAngle: number
    coneRadiusStart: number
    shaderAccuracy: number
    geomMeshType: number
    geomCustomSides: number
    geomCustomSegments: number
    skewingLocalForwardDirection: [number, number, number]
    geomCap: boolean
    fallOffEndFromLight: boolean
    attenuationEquation: number
    attenuationCustomBlending: number
    fallOffStart: number
    fallOffEnd: number
    depthBlendDistance: number
    cameraClippingDistance: number
    glareFrontal: number
    glareBehind: number
    fresnelPow: number
    noiseMode: number
    noiseIntensity: number
    noiseScaleUseGlobal: boolean
    noiseScaleLocal: number
    noiseVelocityUseGlobal: boolean
    noiseVelocityLocal: [number, number, number]
    dimensions: number
    tiltFactor: [number, number]
    pluginVersion: number
    sortingLayerID: number
    sortingOrder: number
    fadeOutBegin: number
    fadeOutEnd: number
}

export interface StageVolumetricDustParticlesProfile {
    componentPathID: string
    gameObjectPathID: string
    beamComponentPathID?: string
    hierarchyPath?: string
    active: boolean
    alpha: number
    size: number
    direction: number
    velocity: [number, number, number]
    speed: number
    density: number
    spawnDistanceRange?: { m_MinValue?: number; m_MaxValue?: number }
    spawnMinDistance: number
    spawnMaxDistance: number
    cullingEnabled: boolean
    cullingMaxDistance: number
    alphaAdditionalRuntime: number
}

export interface StageGameObjectStateProfile {
    gameObjectPathID: string
    hierarchyPath: string
    /** Exact serialized GameObject.m_IsActive value. */
    activeSelf: boolean
    activeInHierarchy: boolean
}

export interface StageActivationClipProfile {
    start: number
    duration: number
    clipIn: number
    timeScale: number
    assetPathID: string
    displayName: string
}

export interface StageActivationTrackProfile {
    trackPathID: string
    name: string
    enabled: boolean
    muted: boolean
    locked: boolean
    /** Unity Timeline ActivationTrack.PostPlaybackState. */
    postPlaybackState: 0 | 1 | 2 | 3
    targetGameObjectPathID: string
    targetHierarchyPath: string
    targetInitialSelfActive: boolean
    targetInitialActiveInHierarchy: boolean
    clips: StageActivationClipProfile[]
}

export interface StageActivationDirectorProfile {
    directorPathID: string
    gameObjectPathID: string
    hierarchyPath?: string
    enabled: boolean
    playableAssetPathID: string
    /** UnityEngine.Playables.PlayState: Paused=0, Playing=1. */
    initialState: number
    initialStateName?: 'paused' | 'playing' | 'unknown'
    /** UnityEngine.Playables.DirectorWrapMode: Hold=0, Loop=1, None=2. */
    wrapMode: number
    wrapModeName?: 'hold' | 'loop' | 'none' | 'unknown'
    duration: number
    tracks: StageActivationTrackProfile[]
}

export interface StageRuntimeProfile {
    /** Exact AnimationClip names. Prefix/family matching is intentionally not used. */
    clipNames?: string[]
    autoplay?: boolean
    loop?: boolean
    startTime?: number
    timeScale?: number
    voiceTracks?: StageVoiceTrackProfile[]
    rotators?: StageRotatorProfile[]
    particlePresets?: StageParticlePresetProfile[]
    particleSystems?: StageParticleSystemProfile[]
    particleMeshes?: StageParticleMeshProfile[]
    serializedComponentClips?: StageSerializedComponentClipProfile[]
    transformAnimations?: StageTransformAnimationProfile
    animatorRandomizers?: StageAnimatorRandomizerProfile[]
    gameObjectStates?: StageGameObjectStateProfile[]
    activationDirectors?: StageActivationDirectorProfile[]
    /** Optional authored story-phase selection; generated profiles do not guess it. */
    activationDirectorPathID?: string
    volumetricLightBeamConfig?: StageVolumetricLightBeamConfigProfile
    volumetricLightBeams?: StageVolumetricLightBeamProfile[]
    volumetricDustParticles?: StageVolumetricDustParticlesProfile[]
}

export type StageVoiceTrackPlaybackState =
    | 'pending'
    | 'playing'
    | 'paused'
    | 'ended'

export interface StageVoiceTrackState {
    id: string
    characterId?: string
    actionName?: string
    expressionName?: string
    playback: StageVoiceTrackPlaybackState
    localTime: number
    startTime: number
    duration?: number
    loop: boolean
}

export interface StageRuntimeDebugState {
    disposed: boolean
    playing: boolean
    paused: boolean
    time: number
    timeScale: number
    loop: boolean
    rootName: string
    transformAnimations?: NonNullable<ReturnType<typeof prepareStageTransformAnimations>>['debug']
    requestedClipNames: string[]
    playingClipNames: string[]
    missingClipNames: string[]
    animationDuration: number
    timelineDuration?: number
    animationEnded: boolean
    voiceTracks: StageVoiceTrackState[]
    requestedRotatorNames: string[]
    activeRotatorNames: string[]
    missingRotatorNames: string[]
    ambiguousRotatorNames: string[]
    activation: {
        requestedDirectorPathIDs: string[]
        selectedDirectorPathID: string | null
        selectedDirectorTime: number | null
        requestedGameObjectStateCount: number
        resolvedGameObjectStateCount: number
        missingGameObjectStatePaths: string[]
        missingTargetPaths: string[]
        targetStates: Array<{
            trackPathID: string
            targetHierarchyPath: string
            visible: boolean | null
        }>
    }
    particles?: StageParticleRuntimeDebugState
}

interface ActiveStageRotator {
    profile: StageRotatorProfile
    object: THREE.Object3D
}

function finiteNonNegative(value: number | undefined, fallback: number) {
    return Number.isFinite(value) ? Math.max(0, value!) : fallback
}

function unique(values: string[] | undefined) {
    return [...new Set(values ?? [])]
}

interface BoundStageGameObjectState {
    profile: StageGameObjectStateProfile
    object: THREE.Object3D
}

interface BoundStageActivationTrack {
    profile: StageActivationTrackProfile
    object?: THREE.Object3D
}

interface BoundStageActivationDirector {
    profile: StageActivationDirectorProfile
    tracks: BoundStageActivationTrack[]
}

function serializedParticleMaterials(
    bindings: readonly StageMaterialBinding[],
): OfficialParticleMaterialProfile[] {
    return bindings.flatMap(binding => {
        if (!binding.materialName) return []
        return [{
            name: binding.materialName,
            validKeywords: binding.validKeywords,
            invalidKeywords: binding.invalidKeywords,
            textures: Object.fromEntries(
                Object.entries(binding.serializedTextures ?? {}).map(
                    ([property, texture]) => [property, {
                        url: texture.url,
                        scale: [...texture.transform.scale],
                        offset: [...texture.transform.offset],
                        pointer: {
                            pathID: texture.sourceTexturePathId,
                            resolved: true,
                        },
                    }],
                ),
            ),
            floats: binding.serializedFloats,
            colors: binding.serializedColors,
        }]
    })
}

function activationClipContains(
    clip: StageActivationClipProfile,
    time: number,
) {
    const start = finiteNonNegative(clip.start, 0)
    const duration = finiteNonNegative(clip.duration, 0)
    const end = start + duration
    const epsilon = Math.max(1e-9, Math.abs(end) * 1e-12)
    return duration > 0
        && time + epsilon >= start
        && time < end - epsilon
}

function activationTrackHasInput(
    track: StageActivationTrackProfile,
    time: number,
) {
    return track.clips.some(clip => activationClipContains(clip, time))
}

function lastDirectorEvaluationTime(duration: number) {
    if (!(duration > 0)) return 0
    return Math.max(0, duration - Math.max(1e-7, duration * 1e-9))
}

function activationTrackVisibleAtTime(
    director: StageActivationDirectorProfile,
    track: StageActivationTrackProfile,
    time: number,
): boolean | undefined {
    if (!director.enabled || !track.enabled || track.muted) return undefined
    const duration = finiteNonNegative(director.duration, 0)
    let evaluationTime = finiteNonNegative(time, 0)
    if (duration > 0 && director.wrapMode === 1) {
        evaluationTime %= duration
        return activationTrackHasInput(track, evaluationTime)
    }
    if (duration <= 0 || evaluationTime < duration) {
        return activationTrackHasInput(track, evaluationTime)
    }

    const finalVisible = activationTrackHasInput(
        track,
        lastDirectorEvaluationTime(duration),
    )
    if (director.wrapMode === 0) return finalVisible

    // ActivationTrack.cs serializes Active=0, Inactive=1, Revert=2,
    // LeaveAsIs=3. For LeaveAsIs, retain the final ProcessFrame result.
    switch (track.postPlaybackState) {
        case 0: return true
        case 1: return false
        case 2: return track.targetInitialSelfActive
        case 3:
        default:
            return finalVisible
    }
}

/**
 * Owns the animation and future voice timeline for one loaded stage root.
 *
 * A controller is registered with the renderer only when explicitly created
 * from a runtime profile. Static stages therefore retain their existing
 * behaviour and incur no animation-loop work.
 */
export class StageRuntimeController {
    private readonly root: THREE.Object3D
    private readonly transformAnimations?: ReturnType<typeof prepareStageTransformAnimations>
    private readonly profile: StageRuntimeProfile
    private readonly mixer?: THREE.AnimationMixer
    private readonly requestedClipNames: string[]
    private readonly playingClips: THREE.AnimationClip[]
    private readonly missingClipNames: string[]
    private readonly activeRotators: ActiveStageRotator[]
    private readonly missingRotatorNames: string[]
    private readonly ambiguousRotatorNames: string[]
    private readonly gameObjectStateBindings: BoundStageGameObjectState[]
    private readonly missingGameObjectStatePaths: string[]
    private readonly activationDirectors = new Map<
        string,
        BoundStageActivationDirector
    >()
    private readonly missingActivationTargetPaths: string[]
    private readonly originalVisibilities = new Map<THREE.Object3D, boolean>()
    private readonly particleRuntime?: StageParticleRuntimeController
    private readonly animationLoop: () => void
    private readonly afterUpdate?: () => void
    private _time: number
    private _timeScale: number
    private _paused: boolean
    private _activationDirectorPathID?: string
    private _disposed = false

    constructor(
        root: THREE.Object3D,
        profile: StageRuntimeProfile,
        afterUpdate?: () => void,
        materialBindings: readonly StageMaterialBinding[] = [],
        textures: readonly THREE.Texture[] = [],
        depthRegistrar?: StageParticleDepthRegistrar,
    ) {
        this.root = root
        this.profile = profile
        this.afterUpdate = afterUpdate
        this.transformAnimations = prepareStageTransformAnimations(
            root, profile.transformAnimations, (profile.rotators?.length ?? 0) > 0,
        )
        this.requestedClipNames = unique([
            ...(profile.clipNames ?? []),
            ...(this.transformAnimations?.clips.map(entry => entry.clip.name) ?? []),
        ])

        this.gameObjectStateBindings = []
        this.missingGameObjectStatePaths = []
        for (const state of profile.gameObjectStates ?? []) {
            const object = resolveStageHierarchyPath(root, state.hierarchyPath)
            if (!object) {
                this.missingGameObjectStatePaths.push(state.hierarchyPath)
                continue
            }
            if (!this.originalVisibilities.has(object)) {
                this.originalVisibilities.set(object, object.visible)
            }
            this.gameObjectStateBindings.push({ profile: state, object })
        }
        this.missingActivationTargetPaths = []
        for (const director of profile.activationDirectors ?? []) {
            const tracks = director.tracks.map(track => {
                const object = resolveStageHierarchyPath(
                    root,
                    track.targetHierarchyPath,
                )
                if (!object) {
                    this.missingActivationTargetPaths.push(
                        `${director.directorPathID}:${track.trackPathID}:`
                        + track.targetHierarchyPath,
                    )
                } else if (!this.originalVisibilities.has(object)) {
                    this.originalVisibilities.set(object, object.visible)
                }
                return { profile: track, object }
            })
            this.activationDirectors.set(director.directorPathID, {
                profile: director,
                tracks,
            })
        }
        this.restoreSerializedGameObjectStates()

        const clipsByName = new Map(
            [...root.animations, ...(this.transformAnimations?.clips.map(entry => entry.clip) ?? [])]
                .map(clip => [clip.name, clip] as const),
        )
        this.playingClips = this.requestedClipNames
            .map(name => clipsByName.get(name))
            .filter((clip): clip is THREE.AnimationClip => clip != undefined)
        this.missingClipNames = this.requestedClipNames
            .filter(name => !clipsByName.has(name))
        const requestedRotators = profile.rotators ?? []
        const objectsByName = new Map<string, THREE.Object3D[]>()
        root.traverse(object => {
            if (!object.name) return
            const objects = objectsByName.get(object.name) ?? []
            objects.push(object)
            objectsByName.set(object.name, objects)
        })
        this.activeRotators = []
        this.missingRotatorNames = []
        this.ambiguousRotatorNames = []
        for (const rotator of requestedRotators) {
            const label = rotator.hierarchyPath ?? rotator.objectName ?? '(unnamed)'
            const hierarchyCandidate = rotator.hierarchyPath
                ? resolveStageHierarchyPath(root, rotator.hierarchyPath)
                : undefined
            const candidates = hierarchyCandidate
                ? [hierarchyCandidate]
                : rotator.objectName
                    ? objectsByName.get(rotator.objectName) ?? []
                    : []
            if (candidates.length === 0) {
                this.missingRotatorNames.push(label)
            } else if (candidates.length > 1) {
                this.ambiguousRotatorNames.push(label)
            } else {
                this.activeRotators.push({
                    profile: rotator,
                    object: candidates[0],
                })
            }
        }

        if (this.playingClips.length > 0) {
            this.mixer = new THREE.AnimationMixer(root)
            for (const clip of this.playingClips) {
                const action = this.mixer.clipAction(clip)
                const nativeLoop = this.transformAnimations?.clips.find(entry => entry.clip === clip)?.loop
                if (nativeLoop ?? profile.loop ?? true) {
                    action.setLoop(THREE.LoopRepeat, Infinity)
                    action.clampWhenFinished = false
                } else {
                    action.setLoop(THREE.LoopOnce, 1)
                    action.clampWhenFinished = true
                }
                action.reset().play()
            }
        }

        this._time = finiteNonNegative(profile.startTime, 0)
        this._timeScale = finiteNonNegative(profile.timeScale, 1)
        this._paused = profile.autoplay === false
        const serializedPlayingDirector = (profile.activationDirectors ?? [])
            .find(director => director.enabled && director.initialState === 1)
        const requestedActivationDirector = profile.activationDirectorPathID
            ?? serializedPlayingDirector?.directorPathID
        if (
            requestedActivationDirector
            && this.activationDirectors.has(requestedActivationDirector)
        ) {
            this._activationDirectorPathID = requestedActivationDirector
        }
        if ((profile.particleSystems?.length ?? 0) > 0) {
            this.particleRuntime = new StageParticleRuntimeController(
                root,
                profile.particlePresets ?? [],
                profile.particleSystems ?? [],
                materialBindings,
                textures,
                {
                    particleMeshes: profile.particleMeshes ?? [],
                    officialMaterials:
                        serializedParticleMaterials(materialBindings),
                    depthRegistrar,
                },
            )
        }
        this.transformAnimations?.claim()
        this.mixer?.setTime(this._time)
        this.applyRotatorDelta(this._time)
        this.particleRuntime?.update(this._time)
        this.applyActivationDirectorAtTime(this._time)
        this.runAfterUpdate()
        this.publishTime()

        this.animationLoop = () => this.update(getClockDelta())
        addAnimationLoop(this.animationLoop)
    }

    get time() {
        return this._time
    }

    get timeScale() {
        return this._timeScale
    }

    get paused() {
        return this._paused
    }

    get disposed() {
        return this._disposed
    }

    play() {
        if (this._disposed) return
        this._paused = false
    }

    pause() {
        if (this._disposed) return
        this._paused = true
    }

    setTimeScale(value: number) {
        if (this._disposed) return
        this._timeScale = finiteNonNegative(value, this._timeScale)
    }

    /** Select one exact serialized PlayableDirector for a story phase. */
    setActivationDirector(pathID?: string) {
        if (this._disposed) return false
        if (pathID != undefined && !this.activationDirectors.has(pathID)) {
            return false
        }
        this._activationDirectorPathID = pathID
        this.applyActivationDirectorAtTime(this._time)
        this.runAfterUpdate()
        this.publishTime()
        return true
    }

    seek(time: number) {
        if (this._disposed) return
        const previousTime = this._time
        this._time = finiteNonNegative(time, this._time)
        for (const entry of this.transformAnimations?.clips ?? []) {
            this.mixer?.clipAction(entry.clip).reset().play()
        }
        this.mixer?.setTime(this._time)
        this.applyRotatorDelta(this._time - previousTime)
        this.particleRuntime?.update(this._time)
        this.applyActivationDirectorAtTime(this._time)
        this.runAfterUpdate()
        this.publishTime()
    }

    update(deltaSeconds: number) {
        if (
            this._disposed
            || this._paused
            || !Number.isFinite(deltaSeconds)
            || deltaSeconds <= 0
        ) {
            return
        }

        const scaledDelta = deltaSeconds * this._timeScale
        const previousTime = this._time
        const timelineDuration = this.getTimelineDuration()
        if (
            !(this.profile.loop ?? true)
            && timelineDuration != undefined
            && this._time + scaledDelta >= timelineDuration
        ) {
            this._time = timelineDuration
            this.mixer?.setTime(this._time)
            this._paused = true
        } else {
            this._time += scaledDelta
            this.mixer?.update(scaledDelta)
        }
        this.applyRotatorDelta(this._time - previousTime)
        this.particleRuntime?.update(this._time)
        this.applyActivationDirectorAtTime(this._time)
        this.runAfterUpdate()
        this.publishTime()
    }

    getVoiceTrackStates(): StageVoiceTrackState[] {
        return (this.profile.voiceTracks ?? []).map(track => {
            const startTime = finiteNonNegative(track.startTime, 0)
            const duration = track.duration == undefined
                ? undefined
                : finiteNonNegative(track.duration, 0)
            const offset = finiteNonNegative(track.offset, 0)
            const elapsed = this._time - startTime
            const loop = track.loop ?? false

            let localTime = Math.max(0, elapsed) + offset
            let playback: StageVoiceTrackPlaybackState

            if (elapsed < 0) {
                playback = 'pending'
                localTime = offset
            } else if (duration != undefined && duration <= 0) {
                playback = 'ended'
                localTime = offset
            } else if (duration != undefined && loop) {
                playback = this._paused ? 'paused' : 'playing'
                localTime %= duration
            } else if (duration != undefined && localTime >= duration) {
                playback = 'ended'
                localTime = duration
            } else {
                playback = this._paused ? 'paused' : 'playing'
            }

            return {
                id: track.id,
                characterId: track.characterId,
                actionName: track.actionName,
                expressionName: track.expressionName,
                playback,
                localTime,
                startTime,
                duration,
                loop,
            }
        })
    }

    getDebugState(): StageRuntimeDebugState {
        const animationDuration = this.playingClips.reduce(
            (duration, clip) => Math.max(duration, clip.duration),
            0,
        )
        const timelineDuration = this.getTimelineDuration()
        return {
            disposed: this._disposed,
            playing: !this._disposed && !this._paused,
            paused: this._paused,
            time: this._time,
            timeScale: this._timeScale,
            loop: this.profile.loop ?? true,
            rootName: this.root.name,
            transformAnimations: this.transformAnimations?.debug,
            requestedClipNames: [...this.requestedClipNames],
            playingClipNames: this.playingClips.map(clip => clip.name),
            missingClipNames: [...this.missingClipNames],
            animationDuration,
            timelineDuration,
            animationEnded:
                !(this.profile.loop ?? true)
                && animationDuration > 0
                && this._time >= animationDuration,
            voiceTracks: this.getVoiceTrackStates(),
            requestedRotatorNames:
                (this.profile.rotators ?? []).map(
                    rotator => rotator.hierarchyPath ?? rotator.objectName ?? '(unnamed)',
                ),
            activeRotatorNames:
                this.activeRotators.map(
                    rotator => rotator.profile.hierarchyPath
                        ?? rotator.profile.objectName
                        ?? '(unnamed)',
                ),
            missingRotatorNames: [...this.missingRotatorNames],
            ambiguousRotatorNames: [...this.ambiguousRotatorNames],
            activation: {
                requestedDirectorPathIDs: (this.profile.activationDirectors ?? [])
                    .map(director => director.directorPathID),
                selectedDirectorPathID: this._activationDirectorPathID ?? null,
                selectedDirectorTime:
                    this._activationDirectorPathID == undefined
                        ? null
                        : this._time,
                requestedGameObjectStateCount:
                    this.profile.gameObjectStates?.length ?? 0,
                resolvedGameObjectStateCount:
                    this.gameObjectStateBindings.length,
                missingGameObjectStatePaths: [
                    ...this.missingGameObjectStatePaths,
                ],
                missingTargetPaths: [...this.missingActivationTargetPaths],
                targetStates: this.getActivationTargetStates(),
            },
            particles: this.particleRuntime?.getDebugState(),
        }
    }

    dispose() {
        if (this._disposed) return

        removeAnimationLoop(this.animationLoop)
        this.mixer?.stopAllAction()
        this.mixer?.uncacheRoot(this.root)
        this.transformAnimations?.dispose()
        this.particleRuntime?.dispose()
        for (const [object, visible] of this.originalVisibilities) {
            object.visible = visible
        }
        delete this.root.userData.stageRuntimeTime
        delete this.root.userData.stageRuntime
        this._disposed = true
    }

    private publishTime() {
        this.root.userData.stageRuntimeTime = this._time
        this.root.userData.stageRuntime = this.getDebugState()
    }

    private getTimelineDuration() {
        const animationDuration = this.playingClips.reduce(
            (duration, clip) => Math.max(duration, clip.duration),
            0,
        )
        const voiceDurations = (this.profile.voiceTracks ?? [])
            .map(track => {
                if (track.duration == undefined) return undefined
                const duration = finiteNonNegative(track.duration, 0)
                const offset = finiteNonNegative(track.offset, 0)
                return finiteNonNegative(track.startTime, 0)
                    + Math.max(0, duration - offset)
            })
            .filter((value): value is number => value != undefined)
        const activationDuration = this._activationDirectorPathID == undefined
            ? 0
            : finiteNonNegative(
                this.activationDirectors.get(this._activationDirectorPathID)
                    ?.profile.duration,
                0,
            )
        const duration = Math.max(
            animationDuration,
            activationDuration,
            ...voiceDurations,
            0,
        )
        return duration > 0 ? duration : undefined
    }

    private restoreSerializedGameObjectStates() {
        for (const { profile, object } of this.gameObjectStateBindings) {
            object.visible = profile.activeSelf
        }
        for (const director of this.activationDirectors.values()) {
            for (const { profile, object } of director.tracks) {
                if (!object) continue
                if (
                    !this.gameObjectStateBindings.some(
                        binding => binding.object === object,
                    )
                ) object.visible = profile.targetInitialSelfActive
            }
        }
    }

    private applyActivationDirectorAtTime(time: number) {
        this.restoreSerializedGameObjectStates()
        if (this._activationDirectorPathID == undefined) return
        const director = this.activationDirectors.get(
            this._activationDirectorPathID,
        )
        if (!director) return

        const targetStates = new Map<THREE.Object3D, boolean>()
        for (const { profile, object } of director.tracks) {
            if (!object) continue
            const visible = activationTrackVisibleAtTime(
                director.profile,
                profile,
                time,
            )
            if (visible == undefined) continue
            targetStates.set(
                object,
                (targetStates.get(object) ?? false) || visible,
            )
        }
        for (const [object, visible] of targetStates) object.visible = visible
    }

    private getActivationTargetStates() {
        if (this._activationDirectorPathID == undefined) return []
        const director = this.activationDirectors.get(
            this._activationDirectorPathID,
        )
        if (!director) return []
        return director.tracks.map(({ profile, object }) => ({
            trackPathID: profile.trackPathID,
            targetHierarchyPath: profile.targetHierarchyPath,
            visible: object?.visible ?? null,
        }))
    }

    private runAfterUpdate() {
        this.transformAnimations?.updateBatches()
        try {
            this.afterUpdate?.()
        } catch (error) {
            console.warn('Stage runtime post-update hook failed:', error)
        }
    }

    private applyRotatorDelta(deltaSeconds: number) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0) return
        for (const { profile, object } of this.activeRotators) {
            const [x, y, z] = profile.degreesPerSecond
            if (![x, y, z].every(Number.isFinite)) continue
            const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                THREE.MathUtils.degToRad(x * deltaSeconds),
                THREE.MathUtils.degToRad(y * deltaSeconds),
                THREE.MathUtils.degToRad(z * deltaSeconds),
                'XYZ',
            ))
            // Native LinearRotater.Update performs localRotation *= delta.
            object.quaternion.multiply(delta).normalize()
        }
    }
}

/**
 * Keeps the absence of a runtime profile a true no-op for existing static
 * stages while giving the stage loader a concise integration point.
 */
export function createStageRuntimeController(
    root: THREE.Object3D,
    profile?: StageRuntimeProfile,
    afterUpdate?: () => void,
    materialBindings: readonly StageMaterialBinding[] = [],
    textures: readonly THREE.Texture[] = [],
    depthRegistrar?: StageParticleDepthRegistrar,
) {
    return profile == undefined
        ? undefined
        : new StageRuntimeController(
            root,
            profile,
            afterUpdate,
            materialBindings,
            textures,
            depthRegistrar,
        )
}
