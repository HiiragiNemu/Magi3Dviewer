import * as THREE from 'three'
import { getLoadingTask, yieldLoadingFrame } from '../../../magia-exedra-character-three/loadingProgress.ts'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import {
    disposeObject,
    fetchAndTryDecompressGzip,
} from '../../../magia-exedra-character-three/utils.ts'
import { EnemyResourceError } from './catalog.ts'
import type {
    EnemyManifestEntry,
    EnemyMaterialProfile,
    EnemyMaterialProfileProduct,
} from './types.ts'
import {
    resolveCachedRuntimeAssetUrl,
    resolveRuntimeAssetUrl,
} from '../runtimeProductDelivery.ts'

export interface EnemyModelLoader {
    load(entry: EnemyManifestEntry, signal?: AbortSignal): Promise<THREE.Group>
}

export const ENEMY_MATERIAL_PROFILE_SCHEMA = 'magius.enemy-material-profile.v1' as const

function absoluteUrl(value: string): string {
    const base = typeof document === 'undefined'
        ? 'http://localhost/'
        : document.baseURI
    return new URL(value.replace(/^\//, ''), base).href
}

function isMaterialProfileProduct(value: unknown): value is EnemyMaterialProfileProduct {
    if (typeof value !== 'object' || value === null) return false
    const record = value as Record<string, unknown>
    return (
        record.schema === ENEMY_MATERIAL_PROFILE_SCHEMA
        && typeof record.modelPrefabName === 'string'
        && typeof record.runtimeReady === 'boolean'
        && Array.isArray(record.failClosedReasons)
        && Array.isArray(record.rendererBindings)
        && Array.isArray(record.profiles)
    )
}

async function fetchMaterialProfileProduct(
    entry: EnemyManifestEntry,
    signal?: AbortSignal,
): Promise<EnemyMaterialProfileProduct> {
    const runtimeUrl = entry.model.materialProfileUrl
    if (!runtimeUrl) {
        throw new EnemyResourceError(
            'MODEL_PARSE_ERROR',
            `Enemy ${entry.enemyMstId} has no material profile product`,
            { enemyMstId: entry.enemyMstId, modelPrefabName: entry.modelPrefabName },
        )
    }
    const canonicalUrl = absoluteUrl(runtimeUrl)
    let response: Response
    try {
        const payloadUrl = await resolveRuntimeAssetUrl(canonicalUrl, signal)
        response = await fetch(payloadUrl, { signal })
    } catch (error) {
        throw new EnemyResourceError(
            'MODEL_HTTP_ERROR',
            `Enemy material profile request failed for ${entry.enemyMstId}`,
            { enemyMstId: entry.enemyMstId, url: canonicalUrl, cause: error },
        )
    }
    if (!response.ok) {
        throw new EnemyResourceError(
            'MODEL_HTTP_ERROR',
            `Enemy material profile request failed for ${entry.enemyMstId}: HTTP ${response.status}`,
            { enemyMstId: entry.enemyMstId, url: canonicalUrl, status: response.status },
        )
    }
    let value: unknown
    try {
        value = await response.json()
    } catch (error) {
        throw new EnemyResourceError(
            'MODEL_PARSE_ERROR',
            `Enemy material profile JSON is invalid for ${entry.enemyMstId}`,
            { enemyMstId: entry.enemyMstId, url: canonicalUrl, cause: error },
        )
    }
    if (!isMaterialProfileProduct(value)) {
        throw new EnemyResourceError(
            'MODEL_PARSE_ERROR',
            `Enemy material profile schema must be ${ENEMY_MATERIAL_PROFILE_SCHEMA}`,
            { enemyMstId: entry.enemyMstId, url: canonicalUrl },
        )
    }
    if (
        value.modelPrefabName !== entry.modelPrefabName
        || value.sourceBundleKey !== entry.model.bundleKey
    ) {
        throw new EnemyResourceError(
            'MODEL_PARSE_ERROR',
            `Enemy material profile identity mismatch for ${entry.enemyMstId}`,
            {
                enemyMstId: entry.enemyMstId,
                expectedModelPrefabName: entry.modelPrefabName,
                actualModelPrefabName: value.modelPrefabName,
                expectedBundleKey: entry.model.bundleKey,
                actualBundleKey: value.sourceBundleKey,
            },
        )
    }
    if (!value.runtimeReady || value.status !== 'runtime-ready') {
        throw new EnemyResourceError(
            'MODEL_PARSE_ERROR',
            `Enemy material profile is fail-closed for ${entry.enemyMstId}`,
            {
                enemyMstId: entry.enemyMstId,
                modelPrefabName: entry.modelPrefabName,
                reasons: value.failClosedReasons,
            },
        )
    }
    if (value.textureRuntimeReady !== true || value.textureStatus !== 'runtime-ready') {
        throw new EnemyResourceError(
            'MODEL_PARSE_ERROR',
            `Enemy material texture product is fail-closed for ${entry.enemyMstId}`,
            {
                enemyMstId: entry.enemyMstId,
                modelPrefabName: entry.modelPrefabName,
                reasons: value.textureFailClosedReasons ?? [],
            },
        )
    }
    return value
}

export type EnemyRuntimeTextureMap = ReadonlyMap<string, THREE.Texture>

function runtimeWrap(value: string | null | undefined): THREE.Wrapping {
    if (value === 'clamp') return THREE.ClampToEdgeWrapping
    if (value === 'mirror' || value === 'mirror-once') return THREE.MirroredRepeatWrapping
    return THREE.RepeatWrapping
}

function configureRuntimeTexture(
    texture: THREE.Texture,
    profile: EnemyMaterialProfile['textures'][string],
): void {
    texture.userData.magiusEnemyTextureStableKey = profile.stableKey
    texture.userData.magiusEnemyRuntimeUrl = profile.runtimeUrl ?? null
    texture.colorSpace = profile.runtimeColorSpace === 'srgb'
        ? THREE.SRGBColorSpace
        : THREE.NoColorSpace
    texture.wrapS = runtimeWrap(profile.runtimeWrap?.u)
    texture.wrapT = runtimeWrap(profile.runtimeWrap?.v)
    texture.magFilter = profile.runtimeFilter === 'nearest'
        ? THREE.NearestFilter
        : THREE.LinearFilter
    texture.minFilter = profile.runtimeFilter === 'nearest'
        ? THREE.NearestFilter
        : profile.runtimeFilter === 'trilinear'
            ? THREE.LinearMipmapLinearFilter
            : THREE.LinearFilter
    if (typeof profile.runtimeAnisotropy === 'number') {
        texture.anisotropy = Math.max(1, profile.runtimeAnisotropy)
    }
    texture.needsUpdate = true
}

export async function loadEnemyMaterialRuntimeTextures(
    product: EnemyMaterialProfileProduct,
    manager: THREE.LoadingManager,
    signal?: AbortSignal,
): Promise<EnemyRuntimeTextureMap> {
    const profiles = new Map<string, EnemyMaterialProfile['textures'][string]>()
    for (const material of product.profiles) {
        for (const texture of Object.values(material.textures)) {
            if (!texture.runtimeReady || !texture.runtimeUrl) continue
            profiles.set(texture.stableKey, texture)
        }
    }
    const loader = new THREE.TextureLoader(manager)
    const loaded = new Map<string, THREE.Texture>()
    try {
        await Promise.all([...profiles].map(async ([stableKey, profile]) => {
            signal?.throwIfAborted()
            const canonicalUrl = absoluteUrl(profile.runtimeUrl as string)
            const payloadUrl = await resolveRuntimeAssetUrl(canonicalUrl, signal)
            const task = getLoadingTask(signal)
            task?.resource(canonicalUrl, false)
            const texture = await loader.loadAsync(payloadUrl)
            task?.resource(canonicalUrl, true)
            if (signal?.aborted) {
                texture.dispose()
                signal.throwIfAborted()
            }
            texture.name = profile.name ?? stableKey
            configureRuntimeTexture(texture, profile)
            loaded.set(stableKey, texture)
        }))
        return loaded
    } catch (error) {
        for (const texture of loaded.values()) texture.dispose()
        throw new EnemyResourceError(
            'MODEL_HTTP_ERROR',
            `Enemy runtime texture request failed for ${product.modelPrefabName}`,
            { modelPrefabName: product.modelPrefabName, cause: error },
        )
    }
}

function runtimeTextureFile(material: THREE.Material): string | null {
    const map = (material as THREE.MeshBasicMaterial).map
    const image = map?.image as { currentSrc?: string, src?: string } | undefined
    const value = image?.currentSrc || image?.src
    if (!value) return null
    try {
        return decodeURIComponent(new URL(value, absoluteUrl('/')).pathname.split('/').pop() ?? '')
    } catch {
        return value.split(/[\\/]/).pop() ?? null
    }
}

function resolveMaterialProfile(
    material: THREE.Material,
    candidates: readonly EnemyMaterialProfile[],
): EnemyMaterialProfile | undefined {
    const exact = candidates.filter(profile => profile.materialName === material.name)
    if (exact.length === 1) return exact[0]
    const suffixNormalizedName = material.name.replace(/\.\d{3}$/, '')
    const normalized = exact.length > 0
        ? exact
        : candidates.filter(profile => profile.materialName === suffixNormalizedName)
    if (normalized.length === 1) return normalized[0]
    const textureFile = runtimeTextureFile(material)
    if (textureFile) {
        const textureMatched = normalized.filter(
            profile => profile.runtime.mainTextureRuntimeFile === textureFile,
        )
        if (textureMatched.length === 1) return textureMatched[0]
    }
    if (normalized.length > 1) {
        const signature = (profile: EnemyMaterialProfile): string => JSON.stringify({
            runtime: profile.runtime,
            mainTexture: profile.runtime.mainTextureProperty
                ? profile.textures[profile.runtime.mainTextureProperty]?.name ?? null
                : null,
        })
        const firstSignature = signature(normalized[0])
        if (normalized.every(profile => signature(profile) === firstSignature)) {
            return [...normalized].sort((left, right) =>
                left.stableKey.localeCompare(right.stableKey))[0]
        }
    }
    return undefined
}

function rendererBindingKeys(
    mesh: THREE.Mesh,
    materialSlot: number,
    product: EnemyMaterialProfileProduct,
): Array<string | null> {
    const names: string[] = []
    for (let current: THREE.Object3D | null = mesh; current; current = current.parent) {
        if (current.name) names.unshift(current.name)
    }
    const hierarchyPath = names.join('/')
    const hierarchyMatching = product.rendererBindings.filter(binding =>
        binding.hierarchyPath.length > 0
        && (
            hierarchyPath === binding.hierarchyPath
            || hierarchyPath.endsWith(`/${binding.hierarchyPath}`)
        ))
    let matching = hierarchyMatching.length > 0
        ? hierarchyMatching
        : product.rendererBindings.filter(binding =>
        binding.meshName === mesh.name
        || binding.gameObjectName === mesh.name)
    if (matching.length === 0) return []
    const expandedVertexCount = mesh.geometry.getAttribute('position')?.count
    if (matching.length > 1 && expandedVertexCount !== undefined) {
        const geometryMatching = matching.filter(binding =>
            binding.meshIndexCount === expandedVertexCount
            || binding.meshVertexCount === expandedVertexCount)
        if (geometryMatching.length > 0) matching = geometryMatching
    }
    const priority = Math.min(...matching.map(binding => binding.priority))
    return [...new Set(
        matching
            .filter(binding => binding.priority === priority)
            .map(binding =>
                binding.materialProfileKeys[materialSlot]
                ?? (binding.materialProfileKeys.length === 1
                    ? binding.materialProfileKeys[0]
                    : null)),
    )]
}

function resolveRendererBoundProfile(
    mesh: THREE.Mesh,
    materialSlot: number,
    product: EnemyMaterialProfileProduct,
): EnemyMaterialProfile | null | undefined {
    const keys = rendererBindingKeys(mesh, materialSlot, product)
    if (keys.length === 0) return undefined
    if (keys.length === 1 && keys[0] === null) return null
    const profiles = keys
        .filter((key): key is string => key !== null)
        .map(key => product.profiles.find(profile => profile.stableKey === key))
        .filter((profile): profile is EnemyMaterialProfile => profile !== undefined)
    if (profiles.length === 1) return profiles[0]
    if (profiles.length > 1) {
        const signature = (profile: EnemyMaterialProfile): string => JSON.stringify({
            runtime: profile.runtime,
            mainTexture: profile.runtime.mainTextureProperty
                ? profile.textures[profile.runtime.mainTextureProperty]?.name ?? null
                : null,
        })
        const firstSignature = signature(profiles[0])
        if (profiles.every(profile => signature(profile) === firstSignature)) {
            return [...profiles].sort((left, right) =>
                left.stableKey.localeCompare(right.stableKey))[0]
        }
    }
    return undefined
}

/**
 * Native EnemyUber COLOR is effect/control data, not a diffuse RGB multiplier.
 * All 20 JP forward fragment variants read only COLOR.b for optional rim data.
 * Keep the geometry attribute intact for future native vertex/effect consumers.
 */
function applyNativeEnemyVertexColorSemantics(
    material: THREE.Material,
    profile: EnemyMaterialProfile,
): void {
    const shader = profile.shader
    const nativeEnemyUber = shader?.name === 'Creative/ReDriveEnemyUberShader'
        || shader?.stableKey === 'unity-object:cab=CAB-174818d8255e64980e98e92fb951e5c4|pathID=-224638753075480067'
    const fallback = material as THREE.Material & {
        isMeshPhongMaterial?: boolean
        isMeshLambertMaterial?: boolean
        vertexColors?: boolean
    }
    if (nativeEnemyUber && (fallback.isMeshPhongMaterial || fallback.isMeshLambertMaterial)) {
        fallback.vertexColors = false
    }
}

function applyMaterialProfile(
    material: THREE.Material,
    profile: EnemyMaterialProfile,
    runtimeTextures?: EnemyRuntimeTextureMap,
): void {
    const runtime = profile.runtime
    applyNativeEnemyVertexColorSemantics(material, profile)
    material.transparent = runtime.transparent
    material.depthWrite = runtime.depthWrite
    material.alphaToCoverage = runtime.alphaToCoverage
    material.alphaTest = runtime.alphaTest.enabled ? runtime.alphaTest.threshold : 0
    material.side = runtime.side === 'double'
        ? THREE.DoubleSide
        : runtime.side === 'back'
            ? THREE.BackSide
            : THREE.FrontSide
    material.blending = runtime.blending === 'additive'
        ? THREE.AdditiveBlending
        : runtime.blending === 'multiply'
            ? THREE.MultiplyBlending
            : THREE.NormalBlending
    const colorMaterial = material as THREE.Material & {
        color?: THREE.Color
        opacity?: number
        emissive?: THREE.Color
        map?: THREE.Texture | null
    } & Record<string, unknown>
    if (runtime.color && colorMaterial.color) {
        colorMaterial.color.fromArray(runtime.color)
        if (typeof colorMaterial.opacity === 'number') {
            colorMaterial.opacity = runtime.color[3]
        }
    }
    if (runtime.emissionColor && colorMaterial.emissive) {
        colorMaterial.emissive.fromArray(runtime.emissionColor)
    }
    const runtimeBindings: Record<string, string> = {}
    const runtimeStableKeys: Record<string, string> = {}
    if (runtimeTextures) {
        for (const [propertyName, textureProfile] of Object.entries(profile.textures)) {
            const baseTexture = runtimeTextures.get(textureProfile.stableKey)
            if (!baseTexture) {
                if (runtime.requiredTextureProperties?.includes(propertyName)) {
                    throw new EnemyResourceError(
                        'MODEL_PARSE_ERROR',
                        `Required enemy runtime texture was not loaded for ${profile.stableKey}`,
                        {
                            materialStableKey: profile.stableKey,
                            propertyName,
                            textureStableKey: textureProfile.stableKey,
                        },
                    )
                }
                continue
            }
            const texture = baseTexture.clone()
            texture.repeat.fromArray(textureProfile.scale)
            texture.offset.fromArray(textureProfile.offset)
            configureRuntimeTexture(texture, textureProfile)
            const materialProperty = propertyName === runtime.mainTextureProperty
                ? 'map'
                : `magiusEnemyTexture_${propertyName.replace(/[^A-Za-z0-9]/g, '_')}`
            if (materialProperty === 'map' && colorMaterial.map && colorMaterial.map !== texture) {
                colorMaterial.magiusEnemyReplacedMap = colorMaterial.map
            }
            colorMaterial[materialProperty] = texture
            runtimeBindings[propertyName] = materialProperty
            runtimeStableKeys[propertyName] = textureProfile.stableKey
        }
    } else if (colorMaterial.map) {
        colorMaterial.map.colorSpace = THREE.SRGBColorSpace
        const textureProfile = runtime.mainTextureProperty
            ? profile.textures[runtime.mainTextureProperty]
            : undefined
        if (textureProfile) {
            colorMaterial.map.repeat.fromArray(textureProfile.scale)
            colorMaterial.map.offset.fromArray(textureProfile.offset)
        }
        colorMaterial.map.needsUpdate = true
    }
    material.userData.magiusEnemyMaterialProfile = profile.stableKey
    material.userData.magiusEnemyShaderStableKey = profile.shader?.stableKey ?? null
    material.userData.magiusEnemyShaderBundleKey = profile.shader?.bundleKey ?? null
    material.userData.magiusEnemyRenderQueue = profile.renderQueue
    material.userData.magiusEnemyRuntimeTextureProperties = runtimeBindings
    material.userData.magiusEnemyRuntimeTextureStableKeys = runtimeStableKeys
    material.needsUpdate = true
}

export function applyEnemyMaterialProfileProduct(
    object: THREE.Object3D,
    product: EnemyMaterialProfileProduct,
    runtimeTextures?: EnemyRuntimeTextureMap,
): void {
    const failures: Array<Record<string, unknown>> = []
    object.traverse(child => {
        if (!(child as THREE.Mesh).isMesh) return
        const mesh = child as THREE.Mesh
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const profiles: EnemyMaterialProfile[] = []
        for (const [materialSlot, material] of materials.entries()) {
            const rendererProfile = resolveRendererBoundProfile(
                mesh,
                materialSlot,
                product,
            )
            const profile = rendererProfile !== undefined
                ? rendererProfile
                : resolveMaterialProfile(material, product.profiles)
            if (profile === null) {
                material.userData.magiusEnemyMaterialProfile = 'unity-null-material'
                material.userData.magiusEnemyMaterialBinding = rendererBindingKeys(
                    mesh,
                    materialSlot,
                    product,
                )
                continue
            }
            if (!profile) {
                failures.push({
                    meshName: mesh.name,
                    materialName: material.name,
                    materialSlot,
                    textureFile: runtimeTextureFile(material),
                    rendererBindingKeys: rendererBindingKeys(
                        mesh,
                        materialSlot,
                        product,
                    ),
                })
                continue
            }
            applyMaterialProfile(material, profile, runtimeTextures)
            profiles.push(profile)
        }
        if (profiles.length > 0) {
            mesh.castShadow = profiles.some(profile => profile.runtime.castShadow)
            mesh.receiveShadow = profiles.some(profile => profile.runtime.receiveShadow)
        }
    })
    if (failures.length > 0) {
        throw new EnemyResourceError(
            'MODEL_PARSE_ERROR',
            `Enemy material profile did not bind every FBX material for ${product.modelPrefabName}`,
            { modelPrefabName: product.modelPrefabName, failures },
        )
    }
    object.userData.enemyMaterialProfileSchema = product.schema
    object.userData.enemyMaterialProfileStatus = product.status
    object.userData.enemyTextureRuntimeStatus = product.textureStatus ?? 'unknown'
    object.userData.enemyRuntimeTextureCount = runtimeTextures?.size ?? 0
}

export class FbxEnemyModelLoader implements EnemyModelLoader {
    async load(entry: EnemyManifestEntry, signal?: AbortSignal): Promise<THREE.Group> {
        const runtimeUrl = entry.model.runtimeUrl
        if (!entry.model.renderReady || runtimeUrl === null) {
            throw new EnemyResourceError(
                'MODEL_NOT_READY',
                `Enemy ${entry.enemyMstId} has no exported model runtime`,
                { enemyMstId: entry.enemyMstId },
            )
        }

        const canonicalUrl = absoluteUrl(runtimeUrl)
        let payload: Blob
        let materialProfile: EnemyMaterialProfileProduct
        try {
            // Observe both tasks immediately. A failed model request must not
            // leave the independently started material request unhandled.
            // The same applies when materials reject before a slow model.
            ;[payload, materialProfile] = await Promise.all([
                (async () => {
                    const payloadUrl = await resolveRuntimeAssetUrl(canonicalUrl, signal)
                    return fetchAndTryDecompressGzip(payloadUrl, undefined, undefined, signal)
                })(),
                fetchMaterialProfileProduct(entry, signal),
            ])
        } catch (error) {
            if (error instanceof EnemyResourceError) throw error
            throw new EnemyResourceError(
                'MODEL_HTTP_ERROR',
                `Enemy model request failed for ${entry.enemyMstId}`,
                { enemyMstId: entry.enemyMstId, url: canonicalUrl, cause: error },
            )
        }

        let parsedObject: THREE.Group | undefined
        try {
            const manager = new THREE.LoadingManager()
            manager.setURLModifier(resolveCachedRuntimeAssetUrl)
            const loader = new FBXLoader(manager)
            const bytes = await payload.arrayBuffer()
            signal?.throwIfAborted()
            getLoadingTask(signal)?.phase('decoding', canonicalUrl)
            await yieldLoadingFrame(signal)
            const object = loader.parse(bytes, new URL('.', canonicalUrl).href)
            parsedObject = object
            const runtimeTextures = await loadEnemyMaterialRuntimeTextures(
                materialProfile,
                manager,
                signal,
            )
            try {
                getLoadingTask(signal)?.phase('assembling', canonicalUrl)
                applyEnemyMaterialProfileProduct(object, materialProfile, runtimeTextures)
            } finally {
                for (const texture of runtimeTextures.values()) texture.dispose()
            }
            object.userData.enemyMstId = entry.enemyMstId
            object.userData.enemyUniqueId = entry.enemyUniqueId
            object.userData.modelPrefabName = entry.modelPrefabName
            signal?.throwIfAborted()
            return object
        } catch (error) {
            if (parsedObject) disposeObject(parsedObject)
            if (error instanceof EnemyResourceError) throw error
            throw new EnemyResourceError(
                'MODEL_PARSE_ERROR',
                `Enemy FBX parse failed for ${entry.enemyMstId}`,
                { enemyMstId: entry.enemyMstId, url: canonicalUrl, cause: error },
            )
        }
    }
}

export class EnemyInstance {
    readonly instanceId: string
    readonly entry: EnemyManifestEntry
    readonly object: THREE.Group
    readonly mixer: THREE.AnimationMixer
    private activeAction: THREE.AnimationAction | undefined
    private activeAnimation: string | undefined
    private animationPausedValue = false
    private repetitions?: number
    private completedRepetitions = 0
    private replayingFinalCycle = false

    constructor(instanceId: string, entry: EnemyManifestEntry, object: THREE.Group) {
        this.instanceId = instanceId
        this.entry = entry
        this.object = object
        this.object.name = instanceId
        this.mixer = new THREE.AnimationMixer(object)
        this.mixer.addEventListener('loop', event => {
            if (event.action === this.activeAction && this.repetitions !== undefined && !this.replayingFinalCycle) {
                this.completedRepetitions += Math.max(0, event.loopDelta)
            }
        })
        this.mixer.addEventListener('finished', event => {
            if (event.action === this.activeAction && this.repetitions !== undefined && this.repetitions > 0) {
                this.completedRepetitions = this.repetitions
            }
        })
        this.playDefaultAnimation()
    }

    get animationNames(): readonly string[] {
        // Match playAnimation eligibility; retain every clip in object.animations
        // so unavailable exported placeholders remain inspectable, not playable UI options.
        return [...new Set(this.object.animations
            .filter(clip => Number.isFinite(clip.duration) && clip.duration > 0 && clip.tracks.length > 0)
            .map(clip => clip.name))].sort()
    }

    get currentAnimationName(): string | undefined {
        return this.activeAnimation
    }

    get animationPaused(): boolean {
        return this.animationPausedValue || Boolean(this.activeAction?.paused)
    }

    setAnimationPaused(paused: boolean): void {
        if (!paused && this.activeAction?.paused) {
            // Resume never rewinds. A completed one-shot stays at its final pose;
            // the separate Play/apply button is the explicit restart operation.
            if (this.activeAction.clampWhenFinished && this.activeAction.time >= this.animationDuration) return
            this.activeAction.paused = false
        }
        this.animationPausedValue = paused
    }

    get animationCompletedRepetitions(): number { return this.completedRepetitions }

    get animationTime(): number { return this.activeAction?.time ?? 0 }
    get animationDuration(): number { return this.activeAction?.getClip().duration ?? 0 }

    seekAnimation(timeSeconds: number): void {
        const action = this.activeAction
        if (!action || !Number.isFinite(timeSeconds)) return
        // Match character scrubbing: pause and evaluate the requested pose immediately.
        // Retire outgoing fades, otherwise they would contaminate a paused sampled pose.
        this.mixer.stopAllAction()
        if (this.repetitions !== undefined) {
            this.replayingFinalCycle = this.repetitions > 0 && this.completedRepetitions >= this.repetitions
            const remaining = this.repetitions === 0 ? Infinity : Math.max(1, this.repetitions - this.completedRepetitions)
            action.setLoop(remaining > 1 ? THREE.LoopRepeat : THREE.LoopOnce, remaining)
            action.clampWhenFinished = Number.isFinite(remaining)
        }
        action.reset().setEffectiveWeight(1).play()
        action.time = THREE.MathUtils.clamp(timeSeconds, 0, this.animationDuration)
        this.animationPausedValue = true
        action.paused = true
        this.mixer.update(0)
    }

    get animationOptions(): Readonly<{ idle?: string; walk?: string; run?: string; jump?: string }> {
        const names = this.animationNames
        const clipHasMotion = (name: string): boolean => {
            const clip = THREE.AnimationClip.findByName(this.object.animations, name)
            return Boolean(clip && clip.duration > 0 && clip.tracks.length > 0)
        }
        const choose = (tokens: readonly string[]): string | undefined => {
            // Token order is intentional (wait_l before wait).  Prefer a real
            // clip over an empty placeholder exported by Unity.
            for (const token of tokens) {
                const matches = names.filter(name => name.toLowerCase().includes(token))
                const animated = matches.find(clipHasMotion)
                if (animated) return animated
            }
            return names.find(name => tokens.some(token => name.toLowerCase().includes(token)))
        }
        return {
            // Unity battle enemies commonly author their neutral loop as Wait or
            // Wait_L rather than an "idle" clip. Prefer those clips so a newly
            // added enemy visibly animates immediately instead of falling back to
            // the alphabetically first hit/effect clip.
            idle: choose(['idle', 'stand', 'breath', 'wait_l', 'wait', '待機']),
            walk: choose(['walk', '歩']),
            run: choose(['run', 'sprint', '走']),
            jump: choose(['jump', 'leap', '跳']),
        }
    }

    get defaultAnimationName(): string | undefined {
        const options = this.animationOptions
        return options.idle ?? options.walk ?? options.run ?? options.jump ?? this.animationNames[0]
    }

    playAnimation(name: string, loop = false, transitionSeconds = 0.18, speed = 1, repetitions?: number): THREE.AnimationAction | undefined {
        if (repetitions !== undefined && (!Number.isSafeInteger(repetitions) || repetitions < 0)) throw new RangeError('Invalid animation repetitions')
        const clip = THREE.AnimationClip.findByName(this.object.animations, name)
        // Empty exported placeholders are not playable motions. Reject before
        // fading/resetting the current action; zero-duration loops also yield NaN.
        if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.tracks.length === 0) return undefined
        const action = this.mixer.clipAction(clip)
        const total = repetitions === undefined ? (loop ? Infinity : 1) : repetitions === 0 ? Infinity : repetitions
        this.repetitions = repetitions
        this.completedRepetitions = 0
        this.replayingFinalCycle = false
        action.setLoop(total > 1 ? THREE.LoopRepeat : THREE.LoopOnce, total)
        action.clampWhenFinished = Number.isFinite(total)
        action.timeScale = Number.isFinite(speed) ? Math.max(0.05, Math.min(4, speed)) : 1
        if (this.activeAction && this.activeAction !== action) {
            this.activeAction.fadeOut(Math.max(0, transitionSeconds))
            action.reset().fadeIn(Math.max(0, transitionSeconds))
        } else {
            action.reset()
        }
        this.activeAction = action
        this.activeAnimation = clip.name
        action.enabled = true
        this.animationPausedValue = false
        action.play()
        return action
    }

    playDefaultAnimation(loop = true, transitionSeconds = 0.18, speed = 1): THREE.AnimationAction | undefined {
        const name = this.defaultAnimationName
        return name ? this.playAnimation(name, loop, transitionSeconds, speed) : undefined
    }

    stopAnimation(): void {
        this.activeAction?.fadeOut(0.08)
        this.activeAction = undefined
        this.activeAnimation = undefined
        this.repetitions = undefined
        this.completedRepetitions = 0
    }

    update(deltaSeconds: number): void {
        // Freeze the whole mixer, including outgoing crossfade actions, without resetting pose/time.
        if (!this.animationPausedValue) this.mixer.update(deltaSeconds)
    }

    dispose(): void {
        this.object.parent?.remove(this.object)
        this.stopAnimation()
        this.mixer.stopAllAction()
        this.mixer.uncacheRoot(this.object)
        disposeObject(this.object)
    }
}
