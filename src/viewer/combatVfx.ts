import * as THREE from 'three'
import type { MagiaExedraScene3D } from 'magia-exedra-character-three/scene'
import { fetchAndTryDecompressGzip } from 'magia-exedra-character-three/utils'
import {
    DepthRimExperiment,
    getMeshToonStylizationUniforms,
    getReDriveCharacterLightingDirectionState,
    setReDriveCharacterLightingOverrideDirection,
    toonStylizationOptions,
} from 'magia-exedra-character-three/shaders'
import { unityWorldToViewerVector } from 'magia-exedra-character-three/coordinateSpace'

import type { StageMaterialBinding } from './stageMaterialBindings'
import { resolveStageHierarchyPath } from './stageHierarchy'
import {
    StageParticleRuntimeController,
    type OfficialParticleMaterialProfile,
} from './stageParticles'
import type {
    StageParticlePresetProfile,
    StageParticleSystemProfile,
} from './stageRuntime'
import {
    EMPTY_COMBAT_VFX_SCREEN_STATE,
    type CombatVfxScreenState,
} from './combatVfxScreenEffects'
import {
    CombatVfxCatalogClient,
    normalizeCombatVfxBundleKey,
    type CombatVfxCatalogEntry,
    type CombatVfxDomain,
} from './combatVfxCatalog'
import {
    resolveCachedRuntimeAssetUrl,
    resolvePageAssetUrl,
    resolveRuntimeAssetUrl,
} from './runtimeProductDelivery'

export const COMBAT_VFX_CUE_EVENT = 'magius:combat-effect-cue'
export const COMBAT_VFX_STATE_CHANGE_EVENT = 'magius:combat-vfx-state-change'

const productCatalog = new CombatVfxCatalogClient()
let catalogEntries: readonly CombatVfxCatalogEntry[] = []

type UnknownRecord = Record<string, unknown>

interface CombatVfxCuePayload extends UnknownRecord {
    schema: 'magius-viewer-combat-vfx-slot-v1'
    bundleKey: string
    directionName: string
    skillUniqueId: number | string | null
    skillMstId: number | string | null
    sequenceId?: string
    sourceActionId?: string
    characterIdentity?: UnknownRecord
}

interface CombatVfxCueDetail extends UnknownRecord {
    characterId: string
    actionId: string
    actionSequence: number
    cueId: string
    effectId: string
    actionTimeSeconds: number
    payload: CombatVfxCuePayload
}

interface ProductTextureAsset {
    pathID: string
    name: string
    url: string
    serializedColorSpace: number
    mipCount: number
    textureSettings: UnknownRecord
}

interface ProductHierarchyRow {
    hierarchyPath: string
    name: string
    active?: boolean
    localPosition?: number[]
    localRotation?: number[]
    localScale?: number[]
}

interface ProductSpriteAsset {
    stableKey: string
    runtimeUrl: string
    imageWidth: number
    imageHeight: number
    rect: number[]
    pivot: number[]
    pixelsPerUnit: number
    renderData: {
        textureRectOffset?: number[]
    }
}

interface ProductSpriteKey {
    time: number
    mappingIndex: number
    interpolation: 'step'
}

interface ProductSpriteMapping {
    mappingIndex: number
    spriteStableKey: string
    runtimeUrl: string
}

interface ProductSpriteBinding {
    bindingIndex: number
    typeID: number
    customType: number
    propertyName: 'm_Sprite'
    targets: Array<{ hierarchyPath: string }>
    componentCandidates: Array<{
        componentType: string
        componentClass?: string
        serializedState?: UnknownRecord
    }>
    keys: ProductSpriteKey[]
}

interface ProductSpriteClip {
    pathID: string
    name: string
    sampleRate: number
    duration: number
    loop: boolean
    bindingRoots: Array<{
        start: number
        duration: number | null
        clipIn: number
        timeScale: number
    }>
    bindingHierarchy: ProductHierarchyRow[]
    mappings: ProductSpriteMapping[]
    bindings: ProductSpriteBinding[]
}

interface ProductSpriteRuntime {
    schema: 'magius.combat-vfx-pptr-sprite-runtime.v1'
    interpolation: 'step'
    assets: ProductSpriteAsset[]
    clips: ProductSpriteClip[]
}

interface ProductTimelineClip extends UnknownRecord {
    start: number
    duration: number
    end: number
    blendInDuration: number
    blendOutDuration: number
    mixInCurve?: unknown
    mixOutCurve?: unknown
    behaviour?: UnknownRecord
}

interface ProductTimelineTrack {
    class: string
    clips: ProductTimelineClip[]
}

interface ProductAnchor extends UnknownRecord {
    role: 'self' | 'main-target' | 'prefab' | 'indexed-target' | 'unresolved'
    exactHierarchyPath?: string
    hierarchyPathTemplate?: string
    prefabLocator?: ProductHierarchyRow
}

interface ProductControlClip extends ProductTimelineClip {
    source: ProductHierarchyRow
    particleRandomSeed: number
    positionOffset?: number[]
    rotationOffset?: number[]
    scaleOffset?: number[]
    rootPositionOffset?: number[]
    controlPosition: boolean
    controlRotation: boolean
    controlScale: boolean
    isFollow: boolean
    anchor: ProductAnchor
    particleSystemPathIDs: string[]
}

interface ProductEffectTrackClip extends ProductTimelineClip {
    assetClass?: string
    trackPathID: string
    trackClass: string
    trackName: string
    trackBinding?: ProductHierarchyRow
    startAnchor?: ProductAnchor
    endAnchor?: ProductAnchor
}

interface ProductTweenClip extends ProductEffectTrackClip {
    assetClass: 'TweenClip'
    trackBinding: ProductHierarchyRow
    startAnchor: ProductAnchor
    endAnchor: ProductAnchor
    behaviour: UnknownRecord
}

export interface CombatVfxProduct {
    schemaVersion: 2
    productType: 'magius-official-combat-vfx-v2'
    action: string
    effectId: string
    skillUniqueId: number | string | null
    skillMstId: number | string | null
    vfxKey: string
    bundleLogicalPath: string
    actionIds?: string[]
    characterIdentities?: UnknownRecord[]
    skills?: UnknownRecord[]
    timeline: {
        cueTimeSeconds: number
        lifetimeSeconds: number
        controlClips: ProductControlClip[]
        effectTrackClips: ProductEffectTrackClip[]
        screenTracks: ProductTimelineTrack[]
    }
    hierarchy: ProductHierarchyRow[]
    particleRuntime: {
        particlePresets: StageParticlePresetProfile[]
        particleSystems: StageParticleSystemProfile[]
        materialBindings: StageMaterialBinding[]
        officialMaterials: OfficialParticleMaterialProfile[]
        textureAssets: ProductTextureAsset[]
        textureUrls: string[]
    }
    spriteRuntime?: ProductSpriteRuntime
}

export interface LoadedCombatVfxProduct {
    product: CombatVfxProduct
    catalogEntry: CombatVfxCatalogEntry
    productUrl: string
    textures: THREE.Texture[]
    spriteTextures: ReadonlyMap<string, THREE.Texture>
    materialBindings: readonly StageMaterialBinding[]
    fallbackMaterialBindingNames: readonly string[]
}

interface ActiveControl {
    clip: ProductControlClip
    source: THREE.Object3D
    particles: StageParticleRuntimeController
    particleTime: number
    active: boolean
    missingAnchor: boolean
    drawnParticlePathIDs: Set<string>
    restoreDrawProbes: Array<() => void>
}

interface ActiveTween {
    clip: ProductTweenClip
    binding: THREE.Object3D
    missingAnchor: boolean
}

interface ActiveSpriteBinding {
    clip: ProductSpriteClip
    binding: ProductSpriteBinding
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
    mappings: ReadonlyMap<number, ProductSpriteMapping>
    currentMappingIndex: number | null
    active: boolean
    appliedFrameCount: number
    frameChangeCount: number
}

interface ActiveSpriteRuntime {
    bindings: ActiveSpriteBinding[]
    missingPaths: string[]
    update(timeSeconds: number): void
    dispose(): void
}

interface CharacterVisualSnapshot {
    characterTint: string
    characterShadowTint: string
    characterLightingOverrideColor: string
    characterLightingOverrideRatio: number
    lightingDirection: ReturnType<typeof getReDriveCharacterLightingDirectionState>
    additionalRimDirection: THREE.Vector2
    additionalRimColor: THREE.Color
    bloomEnabled: boolean
    bloomStrength: number
    bloomRadius: number
    bloomThreshold: number
    urpBloomEnabled: boolean
    urpBloomIntensity: number
    urpBloomScatter: number
    urpBloomThreshold: number
    urpBloomClamp: number
    urpBloomMaxIterations: number
    urpBloomTint: THREE.Color
    backgroundEnabled: boolean
    backgroundPassEnabled: number
    backgroundTint: THREE.Color
}

interface ActiveInstance {
    id: string
    cue: CombatVfxCueDetail
    loaded: LoadedCombatVfxProduct
    root: THREE.Group
    actor: THREE.Object3D
    target?: THREE.Object3D
    targetBinding: 'explicit' | 'scene-character' | 'scene-enemy' | 'actor-facing' | 'missing'
    facingTarget?: THREE.Object3D
    controls: ActiveControl[]
    tweens: ActiveTween[]
    sprites: ActiveSpriteRuntime
    timelineTime: number
    wallTime: number
    snapshot?: CharacterVisualSnapshot
    missingAnchors: string[]
    anchorFallbacks: string[]
    anchorCache: Map<string, THREE.Object3D | undefined>
}

export interface CombatVfxDebugState {
    eventName: typeof COMBAT_VFX_CUE_EVENT
    changeEventName: typeof COMBAT_VFX_STATE_CHANGE_EVENT
    installed: boolean
    enabled: boolean
    productState: Record<string, 'unloaded' | 'loading' | 'ready' | 'error'>
    active: Array<{
        id: string
        action: string
        vfxKey: string
        actorCharacterId: number | null
        targetBound: boolean
        targetBinding: ActiveInstance['targetBinding']
        targetEnemyMstId: number | string | null
        targetWorldPosition: [number, number, number] | null
        timelineTime: number
        lifetimeSeconds: number
        controlCount: number
        tweenCount: number
        activeTweenCount: number
        fallbackMaterialBindingNames: string[]
        requestedParticleSystems: number
        activeParticleSystems: number
        activeParticles: number
        spriteBindingCount: number
        activeSpriteBindings: number
        spriteAppliedFrames: number
        spriteFrameChanges: number
        missingSpritePaths: string[]
        missingAnchors: string[]
        anchorFallbacks: string[]
        activePhases: Array<'self' | 'projectile' | 'travel' | 'impact'>
        controlPhases: Array<{
            role: ProductAnchor['role']
            sourcePath: string
            start: number
            end: number
            active: boolean
            missingAnchor: boolean
            sourceWorldPosition: [number, number, number]
            requestedParticleSystems: number
            drawableParticleSystems: number
            activeParticles: number
            missingParticleAnchorPaths: string[]
            missingMaterialNames: string[]
            particleDrawables: Array<{
                pathID: string
                rendererObjectName: string | null
                drawn: boolean
                visible: boolean
                activeVertexCount: number
                worldBounds: {
                    min: [number, number, number]
                    max: [number, number, number]
                } | null
                centerNdc: [number, number, number] | null
                hasDissolve: number | null
                dissolveProgress: number | null
                opacity: number | null
                brightness: number | null
            }>
        }>
        screenTrackClasses: string[]
    }>
    mainTargetBound: boolean
    lastCue: null | {
        characterId: string
        actionId: string
        actionSequence: number
        effectId: string
        bundleKey: string
    }
    lastError: string | null
    completedCount: number
    rejectedCount: number
    suppressedCount: number
}

export interface CombatVfxSelection {
    /** Catalog stableKey/productStableKey, or use domain + directionKey. */
    stableKey?: string
    domain?: CombatVfxDomain
    directionKey?: string
    /** Registered actor key; omitted uses the selected or sole loaded actor. */
    actorKey?: string
}

export interface CombatVfxSelectionResult {
    status: 'played' | 'suppressed'
    stableKey: string
    instanceId: string | null
}

const productPromises = new Map<string, Promise<LoadedCombatVfxProduct>>()
const productStates = new Map<string, 'unloaded' | 'loading' | 'ready' | 'error'>()
const activeInstances = new Map<string, ActiveInstance>()
const registeredActors = new Map<string, THREE.Object3D>()
let explicitMainTarget: THREE.Object3D | null = null
let installedScene: MagiaExedraScene3D | undefined
let uninstallRuntime: (() => void) | undefined
let lastFrameTime = performance.now()
let completedCount = 0
let rejectedCount = 0
let suppressedCount = 0
let runtimeEnabled = true
let manualCueSequence = 0
let lastCue: CombatVfxDebugState['lastCue'] = null
let lastError: string | null = null

function record(value: unknown): UnknownRecord {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : {}
}

function finite(value: unknown, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function tuple(value: unknown, fallback: readonly number[], length: number) {
    if (!Array.isArray(value)) return [...fallback]
    return Array.from(
        { length },
        (_, index) => finite(value[index], fallback[index] ?? 0),
    )
}

function vector3Tuple(value: unknown, fallback: readonly [number, number, number]) {
    if (Array.isArray(value)) {
        return tuple(value, fallback, 3) as [number, number, number]
    }
    const source = record(value)
    return [
        finite(source.x, fallback[0]),
        finite(source.y, fallback[1]),
        finite(source.z, fallback[2]),
    ] as [number, number, number]
}

function colorTuple(value: unknown, fallback: readonly number[]) {
    const source = record(value)
    return [
        finite(source.r, fallback[0]),
        finite(source.g, fallback[1]),
        finite(source.b, fallback[2]),
        finite(source.a, fallback[3]),
    ]
}

function unityQuaternion(value: unknown) {
    const source = tuple(value, [0, 0, 0, 1], 4)
    return new THREE.Quaternion(source[0], -source[1], -source[2], source[3])
        .normalize()
}

function unityEulerDegrees(value: unknown) {
    const source = tuple(value, [0, 0, 0], 3)
    const unity = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(source[0]),
        THREE.MathUtils.degToRad(source[1]),
        THREE.MathUtils.degToRad(source[2]),
        'ZXY',
    ))
    return new THREE.Quaternion(unity.x, -unity.y, -unity.z, unity.w).normalize()
}

function textureWrap(value: unknown) {
    if (value === 1) return THREE.ClampToEdgeWrapping
    if (value === 2 || value === 3) return THREE.MirroredRepeatWrapping
    return THREE.RepeatWrapping
}

function escapeRegularExpression(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isExplicitUntexturedRampMaterial(
    official: OfficialParticleMaterialProfile,
) {
    const mainTexture = record(official.textures?._MainTex)
    const mainPointer = record(mainTexture.pointer)
    return String(mainPointer.pathID ?? '0') === '0'
        && !mainTexture.url
        && (official.validKeywords ?? []).includes('IS_RAMP')
        && finite(official.floats?._IsMask) > 0.5
        && finite(official.floats?._IsDissolve) <= 0.5
        && finite(official.floats?._IsDissolveTex) <= 0.5
        && finite(official.floats?._IsSecondMap) <= 0.5
        && finite(official.floats?._IsWave) <= 0.5
}

/**
 * Some exact Unity particle materials intentionally have no _MainTex PPtr.
 * An authored ramp-only mask still remains a valid procedural material (for
 * example a bright untextured core), so retain that exact product with the
 * white fallback texture. Other unresolved texture-driven materials continue
 * to fail closed rather than becoming visible rectangular fallback sprites.
 */
function closeOfficialParticleMaterialBindings(product: CombatVfxProduct) {
    const materialBindings = [...product.particleRuntime.materialBindings]
    const existing = new Set(materialBindings
        .map(binding => binding.materialName)
        .filter((name): name is string => Boolean(name)))
    const officialByName = new Map(
        product.particleRuntime.officialMaterials.map(material => [material.name, material]),
    )
    const required = new Set(product.particleRuntime.particleSystems
        .flatMap(system => system.materials)
        .filter(Boolean))
    const fallbackMaterialBindingNames: string[] = []
    for (const name of required) {
        if (existing.has(name)) continue
        const official = officialByName.get(name)
        if (!official || !isExplicitUntexturedRampMaterial(official)) continue
        const serializedOfficial = official as OfficialParticleMaterialProfile & {
            shader?: { name?: string }
            customRenderQueue?: number
            disabledShaderPasses?: string[]
        }
        const officialColor = Array.isArray(official.colors?._Color)
            ? official.colors._Color
            : [1, 1, 1, 1]
        const emissionColor = Array.isArray(official.colors?._EmissionColor)
            ? official.colors._EmissionColor
            : [0, 0, 0, 1]
        materialBindings.push({
            materialName: name,
            materialPattern: `^${escapeRegularExpression(name)}(?:\\.\\d+)?$`,
            sourceShader: serializedOfficial.shader?.name ?? '',
            renderQueue: serializedOfficial.customRenderQueue,
            validKeywords: [...(official.validKeywords ?? [])],
            invalidKeywords: [...(official.invalidKeywords ?? [])],
            disabledShaderPasses: [...(serializedOfficial.disabledShaderPasses ?? [])],
            shading: 'unlit',
            color: tuple(officialColor, [1, 1, 1, 1], 4) as [number, number, number, number],
            emissionColor: tuple(emissionColor, [0, 0, 0, 1], 4) as [number, number, number, number],
            transparent: true,
            depthWrite: finite(official.floats?._ZWrite) > 0.5,
        })
        fallbackMaterialBindingNames.push(name)
        existing.add(name)
    }
    return { materialBindings, fallbackMaterialBindingNames }
}

/**
 * Resource acceptance may render a decoded candidate before its catalog
 * status is promoted. This helper is intentionally not exported and candidate
 * loads are uncached, so normal consumers cannot bypass the runtime-ready gate.
 */
async function loadCombatVfxProductInternal(
    bundleKey: string,
    allowFailClosedPreview: boolean,
) {
    const normalizedBundleKey = normalizeCombatVfxBundleKey(bundleKey)
    const catalog = await productCatalog.ready()
    catalogEntries = catalog.list()
    const catalogCandidate = catalog.getByBundleKey(normalizedBundleKey)
    const previewCandidate = allowFailClosedPreview
        && catalogCandidate?.status === 'fail-closed'
        && catalogCandidate.runtimeReady === false
    const catalogEntry = previewCandidate
        ? catalogCandidate!
        : catalog.requireByBundleKey(normalizedBundleKey)
    const cached = previewCandidate
        ? undefined
        : productPromises.get(normalizedBundleKey)
    if (cached) return cached
    if (!previewCandidate) productStates.set(normalizedBundleKey, 'loading')
    const promise = (async () => {
        const productUrl = resolvePageAssetUrl(catalogEntry.productUrl)
        const payloadUrl = await resolveRuntimeAssetUrl(catalogEntry.productUrl)
        const productBlob = await fetchAndTryDecompressGzip(payloadUrl)
        const product = JSON.parse(await productBlob.text()) as CombatVfxProduct
        if (
            product.schemaVersion !== 2
            || product.productType !== 'magius-official-combat-vfx-v2'
            || normalizeCombatVfxBundleKey(product.bundleLogicalPath)
                !== normalizedBundleKey
            || product.vfxKey !== catalogEntry.productStableKey
        ) {
            throw new Error(`combat VFX product contract mismatch: ${normalizedBundleKey}`)
        }
        if (
            previewCandidate
            && (
                product.spriteRuntime?.schema
                    !== 'magius.combat-vfx-pptr-sprite-runtime.v1'
                || product.spriteRuntime.interpolation !== 'step'
                || product.spriteRuntime.assets.length === 0
                || product.spriteRuntime.clips.length === 0
            )
        ) {
            throw new Error(
                `combat VFX fail-closed preview has no decoded Sprite runtime: ${normalizedBundleKey}`,
            )
        }
        const assetsByUrl = new Map(
            product.particleRuntime.textureAssets.map(asset => [asset.url, asset]),
        )
        const loader = new THREE.TextureLoader()
        const textures = await Promise.all(
            product.particleRuntime.textureUrls.map(async url => {
                const texture = await loader.loadAsync(
                    resolveCachedRuntimeAssetUrl(new URL(url, productUrl).href),
                )
                const asset = assetsByUrl.get(url)
                const settings = record(asset?.textureSettings)
                texture.name = `StageTexture:${url}`
                texture.colorSpace = asset?.serializedColorSpace === 1
                    ? THREE.SRGBColorSpace
                    : THREE.NoColorSpace
                texture.wrapS = textureWrap(settings.m_WrapU)
                texture.wrapT = textureWrap(settings.m_WrapV)
                texture.magFilter = settings.m_FilterMode === 0
                    ? THREE.NearestFilter
                    : THREE.LinearFilter
                texture.minFilter = asset?.mipCount === 1
                    ? texture.magFilter
                    : settings.m_FilterMode === 2
                        ? THREE.LinearMipmapLinearFilter
                        : THREE.LinearMipmapNearestFilter
                texture.generateMipmaps = asset?.mipCount !== 1
                texture.userData.stageTextureBinding = { url }
                texture.needsUpdate = true
                return texture
            }),
        )
        const spriteTextures = new Map<string, THREE.Texture>()
        await Promise.all((product.spriteRuntime?.assets ?? []).map(async asset => {
            const texture = await loader.loadAsync(
                resolveCachedRuntimeAssetUrl(new URL(asset.runtimeUrl, productUrl).href),
            )
            texture.name = `CombatVfxSprite:${asset.stableKey}`
            texture.colorSpace = THREE.SRGBColorSpace
            texture.wrapS = THREE.ClampToEdgeWrapping
            texture.wrapT = THREE.ClampToEdgeWrapping
            texture.magFilter = THREE.LinearFilter
            texture.minFilter = THREE.LinearFilter
            texture.generateMipmaps = false
            texture.userData.combatVfxSpriteStableKey = asset.stableKey
            texture.needsUpdate = true
            spriteTextures.set(asset.stableKey, texture)
        }))
        const materialClosure = closeOfficialParticleMaterialBindings(product)
        if (!previewCandidate) productStates.set(normalizedBundleKey, 'ready')
        return {
            product,
            catalogEntry,
            productUrl,
            textures,
            spriteTextures,
            ...materialClosure,
        }
    })().catch(error => {
        if (!previewCandidate) productStates.set(normalizedBundleKey, 'error')
        throw error
    })
    if (!previewCandidate) productPromises.set(normalizedBundleKey, promise)
    return promise
}

export async function loadCombatVfxProduct(bundleKey: string) {
    return loadCombatVfxProductInternal(bundleKey, false)
}

function validateCue(value: unknown): CombatVfxCueDetail | undefined {
    const cue = record(value)
    const payload = record(cue.payload)
    const bundleKey = payload.bundleKey
    if (
        payload.schema !== 'magius-viewer-combat-vfx-slot-v1'
        || typeof bundleKey !== 'string'
        || bundleKey.length === 0
        || typeof cue.characterId !== 'string'
        || typeof cue.effectId !== 'string'
        || typeof cue.actionId !== 'string'
        || !Number.isFinite(cue.actionSequence)
    ) return undefined
    return cue as unknown as CombatVfxCueDetail
}

async function resolveCombatVfxSelectionEntry(
    selection: CombatVfxSelection,
): Promise<CombatVfxCatalogEntry> {
    const catalog = await productCatalog.ready()
    catalogEntries = catalog.list()
    const stableKey = selection.stableKey?.trim()
    const directionKey = selection.directionKey?.trim()
    const hasStableKey = Boolean(stableKey)
    const hasDirection = Boolean(selection.domain && directionKey)
    if (hasStableKey === hasDirection) {
        throw new Error(
            'combat VFX selection requires stableKey or domain + directionKey',
        )
    }
    const entry = stableKey
        ? catalog.getByStableKey(stableKey)
        : catalog.getByDirection(selection.domain!, directionKey!)
    if (!entry || entry.publicationScope !== 'target') {
        throw new Error('combat VFX target product is absent from the catalog')
    }
    if (!entry.runtimeReady) {
        const reasons = entry.failClosedReasons.join('; ')
        throw new Error(
            `combat VFX product is fail-closed: ${entry.stableKey}`
            + (reasons ? ` (${reasons})` : ''),
        )
    }
    return entry
}

export async function listCombatVfxSelections(domain?: CombatVfxDomain) {
    const catalog = await productCatalog.ready()
    catalogEntries = catalog.list()
    return catalog.list(domain).filter(entry => entry.publicationScope === 'target')
}

function createHierarchy(product: CombatVfxProduct) {
    const nodes = new Map<string, THREE.Object3D>()
    const rowsByPath = new Map(
        product.hierarchy.map(row => [row.hierarchyPath, row] as const),
    )
    for (const clip of product.spriteRuntime?.clips ?? []) {
        for (const row of clip.bindingHierarchy) {
            if (!rowsByPath.has(row.hierarchyPath)) rowsByPath.set(row.hierarchyPath, row)
        }
    }
    const rows = [...rowsByPath.values()].sort((left, right) =>
        left.hierarchyPath.split('/').length - right.hierarchyPath.split('/').length)
    let root: THREE.Group | undefined
    for (const row of rows) {
        const path = row.hierarchyPath
        const segments = path.split('/').filter(Boolean)
        let parent: THREE.Object3D | undefined
        for (let index = 0; index < segments.length; index++) {
            const partial = segments.slice(0, index + 1).join('/')
            let node = nodes.get(partial)
            if (!node) {
                node = new THREE.Group()
                node.name = segments[index]
                node.userData.officialHierarchyPath = partial
                nodes.set(partial, node)
                parent?.add(node)
                if (!root) root = node as THREE.Group
            }
            parent = node
        }
        const node = nodes.get(path)!
        const position = unityWorldToViewerVector(tuple(
            row.localPosition,
            [0, 0, 0],
            3,
        ) as [number, number, number])
        node.position.set(...position)
        node.quaternion.copy(unityQuaternion(row.localRotation))
        const scale = tuple(row.localScale, [1, 1, 1], 3)
        node.scale.set(scale[0], scale[1], scale[2])
        // ControlPlayableAsset owns activation for this prefab subtree.
        node.visible = true
    }
    if (!root) {
        root = new THREE.Group()
        root.name = product.effectId
    }
    root.name = product.effectId
    return root
}

function spriteClipTime(clip: ProductSpriteClip, timelineTime: number) {
    const roots = clip.bindingRoots.length > 0
        ? clip.bindingRoots
        : [{ start: 0, duration: clip.duration, clipIn: 0, timeScale: 1 }]
    for (const root of roots) {
        const start = finite(root.start)
        const duration = root.duration == null ? null : Math.max(0, finite(root.duration))
        if (timelineTime < start || (duration != null && timelineTime > start + duration)) {
            continue
        }
        let localTime = finite(root.clipIn) + (timelineTime - start) * finite(root.timeScale, 1)
        if (clip.loop && clip.duration > 0) {
            localTime = ((localTime % clip.duration) + clip.duration) % clip.duration
        }
        return THREE.MathUtils.clamp(localTime, 0, Math.max(0, clip.duration))
    }
    return null
}

function spriteKeyAt(keys: readonly ProductSpriteKey[], time: number) {
    let selected: ProductSpriteKey | undefined
    for (const key of keys) {
        if (key.time > time + 1e-7) break
        selected = key
    }
    return selected ?? keys[0]
}

function createSpriteRuntime(
    root: THREE.Group,
    product: CombatVfxProduct,
    textures: ReadonlyMap<string, THREE.Texture>,
): ActiveSpriteRuntime {
    const runtime = product.spriteRuntime
    const bindings: ActiveSpriteBinding[] = []
    const missingPaths: string[] = []
    if (!runtime) return {
        bindings,
        missingPaths,
        update: () => undefined,
        dispose: () => undefined,
    }
    if (
        runtime.schema !== 'magius.combat-vfx-pptr-sprite-runtime.v1'
        || runtime.interpolation !== 'step'
    ) throw new Error(`combat VFX Sprite runtime contract mismatch: ${product.vfxKey}`)

    const assets = new Map(runtime.assets.map(asset => [asset.stableKey, asset]))
    for (const clip of runtime.clips) {
        const mappings = new Map(clip.mappings.map(row => [row.mappingIndex, row]))
        for (const binding of clip.bindings) {
            const targetPath = binding.targets[0]?.hierarchyPath
            const target = targetPath ? resolveStageHierarchyPath(root, targetPath) : undefined
            if (!target) {
                missingPaths.push(targetPath ?? `binding:${clip.pathID}:${binding.bindingIndex}`)
                continue
            }
            const candidate = binding.componentCandidates[0]
            const state = record(candidate?.serializedState)
            const serializedColor = Array.isArray(state.m_Color)
                ? tuple(state.m_Color, [1, 1, 1, 1], 4)
                : colorTuple(state.m_Color, [1, 1, 1, 1])
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color(
                    serializedColor[0],
                    serializedColor[1],
                    serializedColor[2],
                ),
                opacity: serializedColor[3],
                transparent: true,
                depthWrite: false,
                alphaTest: 1 / 255,
                side: THREE.DoubleSide,
                toneMapped: false,
            })
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
            mesh.name = `CombatVfxSprite:${clip.pathID}:${binding.bindingIndex}`
            mesh.visible = false
            mesh.renderOrder = Math.trunc(finite(state.m_SortingOrder))
            mesh.userData.combatVfxSpriteBinding = {
                clipPathID: clip.pathID,
                bindingIndex: binding.bindingIndex,
                componentType: candidate?.componentType,
                componentClass: candidate?.componentClass,
                flipX: Boolean(state.m_FlipX),
                flipY: Boolean(state.m_FlipY),
            }
            target.add(mesh)
            bindings.push({
                clip,
                binding,
                mesh,
                mappings,
                currentMappingIndex: null,
                active: false,
                appliedFrameCount: 0,
                frameChangeCount: 0,
            })
        }
    }

    const applyMapping = (active: ActiveSpriteBinding, mappingIndex: number) => {
        const mapping = active.mappings.get(mappingIndex)
        const asset = mapping ? assets.get(mapping.spriteStableKey) : undefined
        const texture = mapping ? textures.get(mapping.spriteStableKey) : undefined
        if (!mapping || !asset || !texture) {
            active.mesh.visible = false
            const key = mapping?.spriteStableKey ?? `mapping:${mappingIndex}`
            if (!missingPaths.includes(key)) missingPaths.push(key)
            return false
        }
        const rect = tuple(asset.rect, [0, 0, asset.imageWidth, asset.imageHeight], 4)
        const pivot = tuple(asset.pivot, [0.5, 0.5], 2)
        const textureOffset = tuple(asset.renderData?.textureRectOffset, [0, 0], 2)
        const units = Math.max(1e-6, finite(asset.pixelsPerUnit, 100))
        const width = Math.max(1, finite(asset.imageWidth, rect[2]))
        const height = Math.max(1, finite(asset.imageHeight, rect[3]))
        const centerX = textureOffset[0] + width / 2 - pivot[0] * rect[2]
        const centerY = textureOffset[1] + height / 2 - pivot[1] * rect[3]
        const flipX = Boolean(active.mesh.userData.combatVfxSpriteBinding.flipX)
        const flipY = Boolean(active.mesh.userData.combatVfxSpriteBinding.flipY)
        active.mesh.position.set(-centerX / units, centerY / units, 0)
        active.mesh.scale.set(
            (flipX ? -1 : 1) * width / units,
            (flipY ? -1 : 1) * height / units,
            1,
        )
        active.mesh.material.map = texture
        active.mesh.material.needsUpdate = true
        if (active.currentMappingIndex != null && active.currentMappingIndex !== mappingIndex) {
            active.frameChangeCount++
        }
        active.currentMappingIndex = mappingIndex
        active.appliedFrameCount++
        return true
    }

    return {
        bindings,
        missingPaths,
        update: timeSeconds => {
            for (const active of bindings) {
                const localTime = spriteClipTime(active.clip, timeSeconds)
                if (localTime == null) {
                    active.active = false
                    active.mesh.visible = false
                    continue
                }
                const key = spriteKeyAt(active.binding.keys, localTime)
                if (!key) {
                    active.active = false
                    active.mesh.visible = false
                    continue
                }
                const ready = active.currentMappingIndex === key.mappingIndex
                    || applyMapping(active, key.mappingIndex)
                active.active = ready
                active.mesh.visible = ready && active.mesh.material.opacity > 0
            }
        },
        dispose: () => {
            for (const active of bindings) {
                active.mesh.removeFromParent()
                active.mesh.geometry.dispose()
                active.mesh.material.dispose()
            }
        },
    }
}

export interface CombatVfxPreviewHandle {
    readonly root: THREE.Group
    readonly product: CombatVfxProduct
    readonly catalogEntry: CombatVfxCatalogEntry
    update(deltaSeconds: number): void
    getDebugState(): {
        timeSeconds: number
        controlCount: number
        activeControlCount: number
        activeParticleCount: number
        missingSourcePaths: string[]
        spriteBindingCount: number
        activeSpriteBindings: number
        spriteAppliedFrames: number
        spriteFrameChanges: number
        missingSpritePaths: string[]
    }
    dispose(): void
}

/**
 * Standalone product preview used by the isolated resource acceptance page.
 * It consumes the same catalog, textures, hierarchy and particle runtime as the
 * Viewer, while intentionally omitting character-screen post effects.
 */
export async function createCombatVfxPreview(
    bundleKey: string,
    parent: THREE.Object3D,
): Promise<CombatVfxPreviewHandle> {
    const loaded = await loadCombatVfxProductInternal(bundleKey, true)
    const { product } = loaded
    const root = createHierarchy(product)
    root.name = `CombatVfxPreview:${product.action}`
    parent.add(root)
    root.updateMatrixWorld(true)
    const sprites = createSpriteRuntime(root, product, loaded.spriteTextures)
    const profilesById = new Map(
        product.particleRuntime.particleSystems.map(profile => [profile.pathID, profile]),
    )
    const missingSourcePaths: string[] = []
    const controls = product.timeline.controlClips.flatMap(clip => {
        const source = resolveStageHierarchyPath(root, clip.source.hierarchyPath)
        if (!source) {
            missingSourcePaths.push(clip.source.hierarchyPath)
            return []
        }
        const profiles = clip.particleSystemPathIDs
            .map(pathID => profilesById.get(pathID))
            .filter((value): value is StageParticleSystemProfile => Boolean(value))
            .map(profile => ({ ...profile, active: true }))
        const particles = new StageParticleRuntimeController(
            root,
            product.particleRuntime.particlePresets,
            profiles,
            loaded.materialBindings,
            loaded.textures,
            {
                forceActive: true,
                forcePlayOnAwake: true,
                officialMaterials: product.particleRuntime.officialMaterials,
            },
        )
        source.visible = false
        return [{ clip, source, particles, active: false }]
    })
    if (controls.length === 0 && sprites.bindings.length === 0) {
        root.removeFromParent()
        throw new Error(`Combat VFX preview has no resolvable controls: ${bundleKey}`)
    }
    let timeSeconds = 0
    const lifetime = Math.max(1 / 60, product.timeline.lifetimeSeconds)
    const update = (deltaSeconds: number) => {
        timeSeconds = (timeSeconds + Math.max(0, deltaSeconds)) % lifetime
        for (const control of controls) {
            const active = timeSeconds >= control.clip.start
                && timeSeconds <= control.clip.end
            control.source.visible = active
            control.active = active
            if (active) control.particles.update(timeSeconds - control.clip.start)
        }
        sprites.update(timeSeconds)
    }
    update(0)
    return {
        root,
        product,
        catalogEntry: loaded.catalogEntry,
        update,
        getDebugState: () => {
            const particleStates = controls.map(control =>
                control.particles.getDebugState())
            return {
                timeSeconds,
                controlCount: controls.length,
                activeControlCount: controls.filter(control => control.active).length,
                activeParticleCount: particleStates.reduce(
                    (sum, state) => sum + state.activeParticleCount,
                    0,
                ),
                missingSourcePaths: [...missingSourcePaths],
                spriteBindingCount: sprites.bindings.length,
                activeSpriteBindings: sprites.bindings.filter(binding => binding.active).length,
                spriteAppliedFrames: sprites.bindings.reduce(
                    (sum, binding) => sum + binding.appliedFrameCount, 0,
                ),
                spriteFrameChanges: sprites.bindings.reduce(
                    (sum, binding) => sum + binding.frameChangeCount, 0,
                ),
                missingSpritePaths: [...sprites.missingPaths],
            }
        },
        dispose: () => {
            for (const control of controls) control.particles.dispose()
            sprites.dispose()
            root.removeFromParent()
        },
    }
}

function loadedCharacterObjects(scene: MagiaExedraScene3D) {
    return scene.characters
        .map(entry => entry.character?.object)
        .filter((value): value is THREE.Group => Boolean(value))
}

function resolveActor(scene: MagiaExedraScene3D, characterId: string) {
    const registered = registeredActors.get(characterId)
    if (registered) return registered
    const numericId = Number(characterId)
    const selected = scene.characterSelected?.character?.object
    if (selected?.userData.characterId === numericId) return selected
    const matches = loadedCharacterObjects(scene).filter(
        object => object.userData.characterId === numericId,
    )
    return matches.length === 1 ? matches[0] : undefined
}

function resolveSelectionActorKey(
    scene: MagiaExedraScene3D,
    requestedActorKey?: string,
) {
    const requested = requestedActorKey?.trim()
    if (requested) return requested
    const selectedId = scene.characterSelected?.character?.object?.userData.characterId
    if (typeof selectedId === 'number' || typeof selectedId === 'string') {
        return String(selectedId)
    }
    if (registeredActors.size === 1) return registeredActors.keys().next().value!
    const loadedIds = loadedCharacterObjects(scene)
        .map(object => object.userData.characterId)
        .filter((value): value is number | string =>
            typeof value === 'number' || typeof value === 'string')
    if (loadedIds.length === 1) return String(loadedIds[0])
    throw new Error('combat VFX selection requires an unambiguous actor')
}

function isEffectivelyVisible(object: THREE.Object3D) {
    let cursor: THREE.Object3D | null = object
    while (cursor) {
        if (!cursor.visible) return false
        cursor = cursor.parent
    }
    return true
}

function loadedEnemyObjects(scene: MagiaExedraScene3D) {
    const candidates: THREE.Object3D[] = []
    scene.scene.traverse(object => {
        const enemyMstId = object.userData.enemyMstId
        if (
            (typeof enemyMstId === 'number' || typeof enemyMstId === 'string')
            && isEffectivelyVisible(object)
        ) candidates.push(object)
    })
    return candidates.filter(candidate => {
        let parent = candidate.parent
        while (parent) {
            if (candidates.includes(parent)) return false
            parent = parent.parent
        }
        return true
    })
}

// User-selected Viewer presentation policy, not a recovered native hit distance.
const COMBAT_FACING_TARGET_DISTANCE = 4

function isActorObject(actor: THREE.Object3D, object: THREE.Object3D) {
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
        if (current === actor) return true
    }
    return false
}

/** Snapshot once at cue receipt, before asynchronous product/texture loading.
 * Inverse binds provide the authored foot/toe forward axis; the current Hip
 * transform maps it to the actor's actual world facing, including root turns.
 * Neither model-root +Z nor camera orientation is assumed to be body-forward.
 */
function captureFacingTarget(actor: THREE.Object3D): THREE.Object3D | undefined {
    // Story/cutscene products retain their typed nonbattle behavior.
    if (actor.userData.nonBattleCharacter) return undefined
    actor.updateWorldMatrix(true, true)
    const bind = new Map<string, { bone: THREE.Bone; inverse: THREE.Matrix4 }>()
    actor.traverse(object => {
        const mesh = object as THREE.SkinnedMesh
        if (!mesh.isSkinnedMesh || !mesh.skeleton) return
        mesh.skeleton.bones.forEach((bone, index) => {
            if (!['Hip', 'Foot_L', 'Foot_R', 'Toe_L', 'Toe_R'].includes(bone.name)) return
            const inverse = mesh.skeleton.boneInverses[index]
            if (inverse && inverse.elements.every(Number.isFinite)
                && Math.abs(inverse.determinant()) > 1e-12 && !bind.has(bone.name)) {
                bind.set(bone.name, { bone, inverse })
            }
        })
    })
    const hip = bind.get('Hip')
    const rest = (name: string) => {
        const row = bind.get(name)
        return row ? new THREE.Vector3().setFromMatrixPosition(row.inverse.clone().invert()) : undefined
    }
    const footL = rest('Foot_L'), footR = rest('Foot_R')
    const toeL = rest('Toe_L'), toeR = rest('Toe_R')
    if (!hip || !footL || !footR || !toeL || !toeR) return undefined
    const lateral = footL.clone().sub(footR).setY(0).normalize()
    const forward = toeL.sub(footL).add(toeR.sub(footR)).setY(0)
    forward.addScaledVector(lateral, -forward.dot(lateral))
    if (forward.lengthSq() < 1e-12) return undefined
    forward.transformDirection(hip.bone.matrixWorld.clone().multiply(hip.inverse)).setY(0)
    const position = actor.getWorldPosition(new THREE.Vector3())
    if (forward.lengthSq() < 1e-12 || ![...forward.toArray(), ...position.toArray()].every(Number.isFinite)) return undefined
    forward.normalize()
    const target = new THREE.Object3D()
    target.name = 'CombatVfxActorFacingTarget'
    target.position.copy(position).addScaledVector(forward, COMBAT_FACING_TARGET_DISTANCE)
    target.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(forward.x, forward.z))
    target.userData.combatVfxFacingTarget = {
        policy: 'cue-world-facing-fixed-v1', distanceViewerUnits: COMBAT_FACING_TARGET_DISTANCE,
        actorWorldPosition: position.toArray(), forwardWorld: forward.toArray(),
    }
    target.updateMatrixWorld(true)
    return target
}

function resolveMainTargetBinding(
    scene: MagiaExedraScene3D,
    actor: THREE.Object3D,
    facingTarget?: THREE.Object3D,
) {
    if (explicitMainTarget && !isActorObject(actor, explicitMainTarget)) {
        return { target: explicitMainTarget, binding: 'explicit' as const }
    }
    const characters = loadedCharacterObjects(scene).filter(object => !isActorObject(actor, object))
    if (characters.length === 1) return { target: characters[0], binding: 'scene-character' as const }
    const enemies = loadedEnemyObjects(scene).filter(object => !isActorObject(actor, object))
    if (enemies.length === 1) return { target: enemies[0], binding: 'scene-enemy' as const }
    if (facingTarget) return { target: facingTarget, binding: 'actor-facing' as const }
    return { target: undefined, binding: 'missing' as const }
}

function productAnchorKey(anchor: ProductAnchor) {
    return `${anchor.role}:${anchor.exactHierarchyPath
        ?? anchor.hierarchyPathTemplate
        ?? anchor.prefabLocator?.hierarchyPath
        ?? '(unresolved)'}`
}

function recordAnchorFallback(
    instance: ActiveInstance,
    anchor: ProductAnchor,
    replacement: THREE.Object3D,
) {
    const value = `${productAnchorKey(anchor)}->${replacement.name || '(target-root)'}`
    if (!instance.anchorFallbacks.includes(value)) instance.anchorFallbacks.push(value)
}

function isUsableSelfAnchor(actor: THREE.Object3D, anchor: THREE.Object3D) {
    if (!isEffectivelyVisible(anchor)) return false
    actor.updateMatrixWorld(true)
    anchor.updateMatrixWorld(true)
    return actor.getWorldPosition(new THREE.Vector3()).distanceTo(
        anchor.getWorldPosition(new THREE.Vector3()),
    ) <= 5
}

function findUsableSelfAnchor(actor: THREE.Object3D, names: string[]) {
    for (const name of names) {
        let resolved: THREE.Object3D | undefined
        actor.traverse(object => {
            if (!resolved && object.name === name && isUsableSelfAnchor(actor, object)) {
                resolved = object
            }
        })
        if (resolved) return resolved
    }
    return undefined
}

function resolveProductAnchor(
    instance: ActiveInstance,
    anchor: ProductAnchor,
) {
    const cacheKey = productAnchorKey(anchor)
    if (instance.anchorCache.has(cacheKey)) return instance.anchorCache.get(cacheKey)
    let resolved: THREE.Object3D | undefined
    if (anchor.role === 'self') {
        const exact = resolveStageHierarchyPath(instance.actor, anchor.exactHierarchyPath)
        if (exact && isUsableSelfAnchor(instance.actor, exact)) resolved = exact
        else {
            const tail = anchor.exactHierarchyPath?.split('/').filter(Boolean).at(-1) ?? ''
            const preferred = /rib|weapon/i.test(tail)
                ? ['Weapon_R', 'Weapon_L', 'Hand_R', 'Hand_L', 'Chest', 'Hip']
                : [tail, 'Chest', 'Hip']
            resolved = findUsableSelfAnchor(instance.actor, preferred.filter(Boolean))
            if (resolved) recordAnchorFallback(instance, anchor, resolved)
        }
    } else if (anchor.role === 'main-target') {
        const path = anchor.hierarchyPathTemplate?.replace(/^TARGET\/?/, '')
        if (instance.target) {
            resolved = resolveStageHierarchyPath(instance.target, path)
            if (!resolved) {
                const tail = path?.split('/').filter(Boolean).at(-1)
                resolved = tail ? instance.target.getObjectByName(tail) : undefined
            }
            if (!resolved) resolved = instance.target
            if (resolved === instance.target) recordAnchorFallback(instance, anchor, resolved)
        }
    } else if (anchor.role === 'prefab') {
        resolved = resolveStageHierarchyPath(
            instance.root,
            anchor.prefabLocator?.hierarchyPath,
        )
    }
    instance.anchorCache.set(cacheKey, resolved)
    return resolved
}

function resolveControlAnchor(
    instance: ActiveInstance,
    control: ProductControlClip,
) {
    return resolveProductAnchor(instance, control.anchor)
}

function setWorldTransform(
    object: THREE.Object3D,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    scale?: THREE.Vector3,
) {
    const worldScale = scale ?? object.getWorldScale(new THREE.Vector3())
    const world = new THREE.Matrix4().compose(position, quaternion, worldScale)
    if (object.parent) {
        object.parent.updateMatrixWorld(true)
        world.premultiply(object.parent.matrixWorld.clone().invert())
    }
    world.decompose(object.position, object.quaternion, object.scale)
    object.updateMatrix()
    object.updateMatrixWorld(true)
}

function productMainTargetAnchors(product: CombatVfxProduct) {
    return [
        ...product.timeline.controlClips.map(clip => clip.anchor),
        ...product.timeline.effectTrackClips.flatMap(clip => [
            clip.startAnchor,
            clip.endAnchor,
        ]),
    ].filter((anchor): anchor is ProductAnchor => anchor?.role === 'main-target')
}

function rebindInstanceMainTarget(
    scene: MagiaExedraScene3D,
    instance: ActiveInstance,
) {
    const resolved = resolveMainTargetBinding(scene, instance.actor, instance.facingTarget)
    instance.target = resolved.target
    instance.targetBinding = resolved.binding
    instance.anchorCache.clear()
}

function updateControlAnchor(instance: ActiveInstance, control: ActiveControl) {
    const anchor = resolveControlAnchor(instance, control.clip)
    if (!anchor) {
        control.missingAnchor = true
        control.source.visible = false
        const role = control.clip.anchor.role
        const path = control.clip.anchor.exactHierarchyPath
            ?? control.clip.anchor.hierarchyPathTemplate
            ?? control.clip.anchor.prefabLocator?.hierarchyPath
            ?? '(unresolved)'
        const key = `${role}:${path}`
        if (!instance.missingAnchors.includes(key)) instance.missingAnchors.push(key)
        return
    }
    control.missingAnchor = false
    anchor.updateMatrixWorld(true)
    const position = anchor.getWorldPosition(new THREE.Vector3())
    const anchorQuaternion = anchor.getWorldQuaternion(new THREE.Quaternion())
    const roleRoot = control.clip.anchor.role === 'main-target'
        ? instance.target
        : instance.actor
    const roleQuaternion = roleRoot?.getWorldQuaternion(new THREE.Quaternion())
        ?? new THREE.Quaternion()
    const positionOffset = new THREE.Vector3(...unityWorldToViewerVector(tuple(
        control.clip.positionOffset,
        [0, 0, 0],
        3,
    ) as [number, number, number])).applyQuaternion(anchorQuaternion)
    const rootOffset = new THREE.Vector3(...unityWorldToViewerVector(tuple(
        control.clip.rootPositionOffset,
        [0, 0, 0],
        3,
    ) as [number, number, number])).applyQuaternion(roleQuaternion)
    position.add(positionOffset).add(rootOffset)
    const rotation = anchorQuaternion.clone().multiply(
        unityEulerDegrees(control.clip.rotationOffset),
    )
    const scale = control.clip.controlScale
        ? new THREE.Vector3(...tuple(control.clip.scaleOffset, [1, 1, 1], 3))
            .multiply(anchor.getWorldScale(new THREE.Vector3()))
        : undefined
    setWorldTransform(control.source, position, rotation, scale)
}

function particleDrawable(
    root: THREE.Object3D,
    pathID: string,
): THREE.Points | THREE.Mesh | undefined {
    let result: THREE.Points | THREE.Mesh | undefined
    root.traverse(object => {
        if (result) return
        if (
            object.name === `UnityParticleSystem:${pathID}`
            || object.name.startsWith(`UnityMeshParticleSystem:${pathID}:`)
        ) result = object as THREE.Points | THREE.Mesh
    })
    return result
}

function armControlDrawProbes(root: THREE.Object3D, control: ActiveControl) {
    for (const pathID of control.clip.particleSystemPathIDs) {
        const drawable = particleDrawable(root, pathID)
        if (!drawable) continue
        const prior = drawable.onBeforeRender
        const wrapped: typeof drawable.onBeforeRender = (...args) => {
            control.drawnParticlePathIDs.add(pathID)
            prior.apply(drawable, args)
        }
        drawable.onBeforeRender = wrapped
        control.restoreDrawProbes.push(() => {
            if (drawable.onBeforeRender === wrapped) drawable.onBeforeRender = prior
        })
    }
}

function isVisibleThroughAncestors(object: THREE.Object3D) {
    let current: THREE.Object3D | null = object
    while (current) {
        if (!current.visible) return false
        current = current.parent
    }
    return true
}

function controlParticleDrawables(
    instance: ActiveInstance,
    control: ActiveControl,
): CombatVfxDebugState['active'][number]['controlPhases'][number]['particleDrawables'] {
    const camera = installedScene?.camera
    camera?.updateMatrixWorld(true)
    instance.root.updateMatrixWorld(true)
    return control.clip.particleSystemPathIDs.map(pathID => {
        const drawable = particleDrawable(instance.root, pathID)
        if (!drawable) {
            return {
                pathID,
                rendererObjectName: null,
                drawn: false,
                visible: false,
                activeVertexCount: 0,
                worldBounds: null,
                centerNdc: null,
                hasDissolve: null,
                dissolveProgress: null,
                opacity: null,
                brightness: null,
            }
        }
        drawable.updateMatrixWorld(true)
        const geometry = drawable.geometry as THREE.BufferGeometry
            & { instanceCount?: number }
        const positions = geometry.getAttribute('stagePosition')
            ?? geometry.getAttribute('position')
        const requestedCount = drawable instanceof THREE.Points
            ? geometry.drawRange.count
            : geometry.instanceCount ?? 0
        const activeVertexCount = positions
            ? Math.min(positions.count, Math.max(0, requestedCount))
            : 0
        const bounds = new THREE.Box3()
        const point = new THREE.Vector3()
        for (let index = 0; index < activeVertexCount; index++) {
            point.fromBufferAttribute(positions, index).applyMatrix4(drawable.matrixWorld)
            bounds.expandByPoint(point)
        }
        const hasBounds = !bounds.isEmpty()
        const center = hasBounds ? bounds.getCenter(new THREE.Vector3()) : undefined
        const centerNdc = center && camera
            ? center.clone().project(camera).toArray() as [number, number, number]
            : null
        const material = Array.isArray(drawable.material)
            ? drawable.material[0]
            : drawable.material
        const uniforms = material instanceof THREE.ShaderMaterial
            ? material.uniforms
            : undefined
        const uniformNumber = (name: string) => {
            const value = uniforms?.[name]?.value
            return typeof value === 'number' && Number.isFinite(value) ? value : null
        }
        return {
            pathID,
            rendererObjectName: drawable.name,
            drawn: control.drawnParticlePathIDs.has(pathID),
            visible: isVisibleThroughAncestors(drawable),
            activeVertexCount,
            worldBounds: hasBounds ? {
                min: bounds.min.toArray() as [number, number, number],
                max: bounds.max.toArray() as [number, number, number],
            } : null,
            centerNdc,
            hasDissolve: uniformNumber('uHasDissolve'),
            dissolveProgress: uniformNumber('uDissolveProgress'),
            opacity: uniformNumber('uOpacity'),
            brightness: uniformNumber('uBrightness'),
        }
    })
}

function curveValue(curve: unknown, time: number) {
    const keys = record(curve).m_Curve
    if (!Array.isArray(keys) || keys.length === 0) {
        return time * time * (3 - 2 * time)
    }
    const normalized = THREE.MathUtils.clamp(time, 0, 1)
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
    return finite(record(keys[keys.length - 1]).value, 1)
}

function clipWeight(clip: ProductTimelineClip, time: number) {
    if (time < clip.start || time > clip.end) return 0
    let weight = 1
    if (clip.blendInDuration > 0 && time < clip.start + clip.blendInDuration) {
        weight *= curveValue(
            clip.mixInCurve,
            (time - clip.start) / clip.blendInDuration,
        )
    }
    if (clip.blendOutDuration > 0 && time > clip.end - clip.blendOutDuration) {
        weight *= curveValue(
            clip.mixOutCurve,
            (time - (clip.end - clip.blendOutDuration)) / clip.blendOutDuration,
        )
    }
    return THREE.MathUtils.clamp(weight, 0, 1)
}

function isProductTweenClip(clip: ProductEffectTrackClip): clip is ProductTweenClip {
    return clip.assetClass === 'TweenClip'
        && Boolean(clip.trackBinding?.hierarchyPath)
        && Boolean(clip.startAnchor)
        && Boolean(clip.endAnchor)
}

function tweenAnchorTransform(
    instance: ActiveInstance,
    anchorProfile: ProductAnchor,
    offsetValue: unknown,
) {
    const anchor = resolveProductAnchor(instance, anchorProfile)
    if (!anchor) return undefined
    anchor.updateMatrixWorld(true)
    const quaternion = anchor.getWorldQuaternion(new THREE.Quaternion())
    const offset = new THREE.Vector3(...unityWorldToViewerVector(
        vector3Tuple(offsetValue, [0, 0, 0]),
    )).applyQuaternion(quaternion)
    return {
        position: anchor.getWorldPosition(new THREE.Vector3()).add(offset),
        quaternion,
    }
}

function updateTween(instance: ActiveInstance, tween: ActiveTween) {
    const { clip } = tween
    const active = instance.timelineTime >= clip.start && instance.timelineTime <= clip.end
    if (!active) return false
    const behaviour = record(clip.behaviour)
    const start = tweenAnchorTransform(
        instance,
        clip.startAnchor,
        behaviour.startLocationOffset,
    )
    const end = tweenAnchorTransform(
        instance,
        clip.endAnchor,
        behaviour.endLocationOffset,
    )
    if (!start || !end) {
        tween.missingAnchor = true
        const key = `tween:${clip.trackPathID}:${!start ? 'start' : 'end'}`
        if (!instance.missingAnchors.includes(key)) instance.missingAnchors.push(key)
        return false
    }
    tween.missingAnchor = false
    const normalized = THREE.MathUtils.clamp(
        (instance.timelineTime - clip.start) / Math.max(1e-8, clip.duration),
        0,
        1,
    )
    const progress = THREE.MathUtils.clamp(
        curveValue(behaviour.curve, normalized),
        0,
        1,
    )
    const position = finite(behaviour.shouldTweenPosition, 1) > 0.5
        ? start.position.clone().lerp(end.position, progress)
        : tween.binding.getWorldPosition(new THREE.Vector3())
    const quaternion = finite(behaviour.shouldTweenRotation, 1) > 0.5
        ? new THREE.Quaternion().slerpQuaternions(
            start.quaternion,
            end.quaternion,
            progress,
        )
        : tween.binding.getWorldQuaternion(new THREE.Quaternion())
    setWorldTransform(tween.binding, position, quaternion)
    return true
}

function track(product: CombatVfxProduct, className: string) {
    return product.timeline.screenTracks.find(item => item.class === className)
}

function weightedBehaviours(
    product: CombatVfxProduct,
    className: string,
    time: number,
) {
    return (track(product, className)?.clips ?? [])
        .map(clip => ({
            clip,
            weight: clipWeight(clip, time),
            value: record(record(clip.behaviour).behaviour),
        }))
        .filter(row => row.weight > 0)
}

function weightedNumber(
    rows: ReturnType<typeof weightedBehaviours>,
    name: string,
    fallback = 0,
) {
    const weight = rows.reduce((sum, row) => sum + row.weight, 0)
    return weight > 0
        ? rows.reduce((sum, row) => sum + finite(row.value[name], fallback) * row.weight, 0)
            / weight
        : fallback
}

function weightedColor(
    rows: ReturnType<typeof weightedBehaviours>,
    name: string,
    fallback: readonly number[],
) {
    const weight = rows.reduce((sum, row) => sum + row.weight, 0)
    if (weight <= 0) return [...fallback]
    const result = [0, 0, 0, 0]
    for (const row of rows) {
        const value = colorTuple(row.value[name], fallback)
        for (let index = 0; index < 4; index++) {
            result[index] += value[index] * row.weight / weight
        }
    }
    return result
}

function timelineSpeed(product: CombatVfxProduct, time: number) {
    const rows = weightedBehaviours(product, 'TimelineSpeedTrack', time)
    return rows.length ? weightedNumber(rows, 'speed', 1) : 1
}

function captureVisualState(scene: MagiaExedraScene3D): CharacterVisualSnapshot {
    const bloom = scene.effects.bloomPass
    const urpBloom = scene.effects.urpBloomPass
    const background = scene.effects.backgroundColorAdjustPass
    return {
        characterTint: toonStylizationOptions.characterTint,
        characterShadowTint: toonStylizationOptions.characterShadowTint,
        characterLightingOverrideColor:
            toonStylizationOptions.characterLightingOverrideColor,
        characterLightingOverrideRatio:
            toonStylizationOptions.characterLightingOverrideRatio,
        lightingDirection: getReDriveCharacterLightingDirectionState(),
        additionalRimDirection: DepthRimExperiment.additionalDirectionVS.clone(),
        additionalRimColor: DepthRimExperiment.additionalColor.clone(),
        bloomEnabled: bloom.enabled,
        bloomStrength: bloom.strength,
        bloomRadius: bloom.radius,
        bloomThreshold: bloom.threshold,
        urpBloomEnabled: urpBloom.enabled,
        urpBloomIntensity: urpBloom.intensity,
        urpBloomScatter: urpBloom.scatter,
        urpBloomThreshold: urpBloom.threshold,
        urpBloomClamp: urpBloom.clamp,
        urpBloomMaxIterations: urpBloom.maxIterations,
        urpBloomTint: urpBloom.tint.clone(),
        backgroundEnabled: background.enabled,
        backgroundPassEnabled: finite(background.uniforms.uEnabled.value),
        backgroundTint: background.uniforms.uBackgroundTint.value.clone(),
    }
}

function updateCharacterUniforms(scene: MagiaExedraScene3D) {
    scene.characters
        .map(entry => entry.character)
        .filter(character => Boolean(character))
        .flatMap(character => character!.userData.meshes)
        .flatMap(mesh => getMeshToonStylizationUniforms(mesh))
        .forEach(uniforms => uniforms.loadGlobalOptions())
}

function applyScreenTracks(instance: ActiveInstance) {
    const scene = installedScene!
    const { product } = instance.loaded
    const time = instance.timelineTime
    const baseline = instance.snapshot!
    // Playable mixers return each track to its captured value whenever no clip
    // contributes. Reset first, then layer this frame's official clip weights;
    // otherwise the last HDR rim/tint/bloom value leaks through timeline gaps.
    toonStylizationOptions.characterTint = baseline.characterTint
    toonStylizationOptions.characterShadowTint = baseline.characterShadowTint
    toonStylizationOptions.characterLightingOverrideColor =
        baseline.characterLightingOverrideColor
    toonStylizationOptions.characterLightingOverrideRatio =
        baseline.characterLightingOverrideRatio
    setReDriveCharacterLightingOverrideDirection(
        baseline.lightingDirection.enabled,
        baseline.lightingDirection.eulerDegrees,
    )
    DepthRimExperiment.additionalDirectionVS.copy(baseline.additionalRimDirection)
    DepthRimExperiment.additionalColor.copy(baseline.additionalRimColor)
    scene.effects.bloomPass.enabled = baseline.bloomEnabled
    scene.effects.bloomPass.strength = baseline.bloomStrength
    scene.effects.bloomPass.radius = baseline.bloomRadius
    scene.effects.bloomPass.threshold = baseline.bloomThreshold
    scene.effects.urpBloomPass.enabled = baseline.urpBloomEnabled
    scene.effects.urpBloomPass.intensity = baseline.urpBloomIntensity
    scene.effects.urpBloomPass.scatter = baseline.urpBloomScatter
    scene.effects.urpBloomPass.threshold = baseline.urpBloomThreshold
    scene.effects.urpBloomPass.clamp = baseline.urpBloomClamp
    scene.effects.urpBloomPass.maxIterations = baseline.urpBloomMaxIterations
    scene.effects.urpBloomPass.tint.copy(baseline.urpBloomTint)
    const baselineBackground = scene.effects.backgroundColorAdjustPass
    baselineBackground.enabled = baseline.backgroundEnabled
    baselineBackground.uniforms.uEnabled.value = baseline.backgroundPassEnabled
    baselineBackground.uniforms.uBackgroundTint.value.copy(baseline.backgroundTint)
    let characterGlobalsChanged = true
    const screenState: CombatVfxScreenState = {
        ...EMPTY_COMBAT_VFX_SCREEN_STATE,
        radialCenter: [...EMPTY_COMBAT_VFX_SCREEN_STATE.radialCenter],
    }

    const kawase = weightedBehaviours(product, 'PostProcessKawaseBlurTrack', time)
    if (kawase.length) {
        screenState.kawaseBlend = THREE.MathUtils.clamp(
            kawase.reduce((sum, row) => sum + row.weight, 0),
            0,
            1,
        )
        screenState.kawasePasses = weightedNumber(kawase, 'blurPasses', 1)
        screenState.kawaseDownsample = weightedNumber(kawase, 'downsample', 1)
        screenState.kawaseOffset = weightedNumber(kawase, 'offset', 0)
    }
    const radial = weightedBehaviours(product, 'PostProcessRadialBlurTrack', time)
    if (radial.length) {
        screenState.radialBlend = THREE.MathUtils.clamp(
            radial.reduce((sum, row) => sum + row.weight, 0), 0, 1,
        )
        screenState.radialPower = weightedNumber(radial, 'focusPow', 0)
            + weightedNumber(radial, 'contrast', 0) * 100
        const weight = radial.reduce((sum, row) => sum + row.weight, 0)
        screenState.radialCenter = radial.reduce<[number, number]>(
            (sum, row) => {
                const center = record(row.value.centorPos)
                sum[0] += finite(center.x, 0.5) * row.weight / weight
                sum[1] += finite(center.y, 0.5) * row.weight / weight
                return sum
            },
            [0, 0],
        )
    }
    const aberration = weightedBehaviours(
        product,
        'PostProcessChromaticAberrationTrack',
        time,
    )
    if (aberration.length) {
        screenState.chromaticBlend = THREE.MathUtils.clamp(
            aberration.reduce((sum, row) => sum + row.weight, 0), 0, 1,
        )
        screenState.chromaticOffsetX = weightedNumber(
            aberration,
            'aberrationX',
            0,
        )
    }
    scene.effects.combatVfxScreenPass.setState(screenState)

    const bloomRows = weightedBehaviours(product, 'PostProcessBloomTrack', time)
    if (bloomRows.length) {
        if (baseline.urpBloomEnabled) {
            scene.effects.bloomPass.enabled = false
            scene.effects.urpBloomPass.enabled = true
            scene.effects.urpBloomPass.threshold = weightedNumber(
                bloomRows,
                'threshold',
                0.8,
            )
            scene.effects.urpBloomPass.intensity = weightedNumber(
                bloomRows,
                'intensity',
                1,
            )
            scene.effects.urpBloomPass.scatter = weightedNumber(
                bloomRows,
                'scatter',
                0.7,
            )
        } else {
            scene.effects.urpBloomPass.enabled = false
            scene.effects.bloomPass.enabled = true
            scene.effects.bloomPass.threshold = weightedNumber(
                bloomRows,
                'threshold',
                0.8,
            )
            scene.effects.bloomPass.strength = weightedNumber(
                bloomRows,
                'intensity',
                1,
            )
            scene.effects.bloomPass.radius = weightedNumber(
                bloomRows,
                'scatter',
                0.7,
            )
        }
    }

    const lighting = weightedBehaviours(
        product,
        'CharacterLightingOverrideTrack',
        time,
    )
    if (lighting.length) {
        const value = lighting[lighting.length - 1].value
        const direction = record(value._globalCharacterLightingOverrideDirection)
        if (finite(value.isDirection) > 0.5) {
            setReDriveCharacterLightingOverrideDirection(true, [
                finite(direction.x), finite(direction.y), finite(direction.z),
            ])
            characterGlobalsChanged = true
        }
        if (finite(value.isColor) > 0.5) {
            const color = colorTuple(
                value._globalCharacterLightingOverrideColor,
                [1, 1, 1, 1],
            )
            toonStylizationOptions.characterLightingOverrideColor =
                `#${new THREE.Color(color[0], color[1], color[2]).getHexString()}`
            characterGlobalsChanged = true
        }
        if (finite(value.isRatio) > 0.5) {
            toonStylizationOptions.characterLightingOverrideRatio = finite(
                value._globalCharacterLightingOverrideRatio,
            )
            characterGlobalsChanged = true
        }
    }

    const rim = weightedBehaviours(product, 'CharacterAdditionalRimLightTrack', time)
    if (rim.length) {
        const color = weightedColor(
            rim,
            '_globalCharacterAdditionalRimLightColor',
            [0, 0, 0, 1],
        )
        const directionWeight = rim.reduce((sum, row) => sum + row.weight, 0)
        const direction = rim.reduce<[number, number]>((sum, row) => {
            const value = record(row.value._globalCharacterAdditionalRimLightDirection)
            sum[0] += finite(value.x) * row.weight / directionWeight
            sum[1] += finite(value.y) * row.weight / directionWeight
            return sum
        }, [0, 0])
        // Official compiled main_depth_rim/main_hair consume the global HDR
        // additional-rim color once through the depth-rim branch. The generic
        // uRimColor/uRimStrength carrier is the independent material rim and
        // must not mirror this track; doing so adds the same 20+ HDR value a
        // second time across the character before bloom.
        // Timeline values are Volume-domain, not pre-signed GPU uniforms.
        // Apply the native SetGlobalShaderParams XY negation once here.
        DepthRimExperiment.additionalDirectionVS.set(-direction[0], -direction[1])
        DepthRimExperiment.additionalColor.set(color[0], color[1], color[2])
    }

    const tint = weightedBehaviours(product, 'CharacterTintColorTrack', time)
    if (tint.length) {
        const character = weightedColor(tint, 'characterTintColor', [1, 1, 1, 1])
        const shadow = weightedColor(
            tint,
            'characterShadowTintColor',
            [1, 1, 1, 1],
        )
        const background = weightedColor(tint, 'backgroundTintColor', [1, 1, 1, 1])
        toonStylizationOptions.characterTint = `#${new THREE.Color(
            character[0], character[1], character[2],
        ).getHexString()}`
        toonStylizationOptions.characterShadowTint = `#${new THREE.Color(
            shadow[0], shadow[1], shadow[2],
        ).getHexString()}`
        const backgroundPass = scene.effects.backgroundColorAdjustPass
        backgroundPass.enabled = true
        backgroundPass.uniforms.uEnabled.value = 1
        backgroundPass.uniforms.uBackgroundTint.value.set(
            background[0], background[1], background[2],
        )
        characterGlobalsChanged = true
    }
    if (characterGlobalsChanged) updateCharacterUniforms(scene)
}

function restoreScreenTracks(instance: ActiveInstance) {
    const scene = installedScene
    const state = instance.snapshot
    if (!scene || !state) return
    toonStylizationOptions.characterTint = state.characterTint
    toonStylizationOptions.characterShadowTint = state.characterShadowTint
    toonStylizationOptions.characterLightingOverrideColor =
        state.characterLightingOverrideColor
    toonStylizationOptions.characterLightingOverrideRatio =
        state.characterLightingOverrideRatio
    setReDriveCharacterLightingOverrideDirection(
        state.lightingDirection.enabled,
        state.lightingDirection.eulerDegrees,
    )
    DepthRimExperiment.additionalDirectionVS.copy(state.additionalRimDirection)
    DepthRimExperiment.additionalColor.copy(state.additionalRimColor)
    scene.effects.bloomPass.enabled = state.bloomEnabled
    scene.effects.bloomPass.strength = state.bloomStrength
    scene.effects.bloomPass.radius = state.bloomRadius
    scene.effects.bloomPass.threshold = state.bloomThreshold
    scene.effects.urpBloomPass.enabled = state.urpBloomEnabled
    scene.effects.urpBloomPass.intensity = state.urpBloomIntensity
    scene.effects.urpBloomPass.scatter = state.urpBloomScatter
    scene.effects.urpBloomPass.threshold = state.urpBloomThreshold
    scene.effects.urpBloomPass.clamp = state.urpBloomClamp
    scene.effects.urpBloomPass.maxIterations = state.urpBloomMaxIterations
    scene.effects.urpBloomPass.tint.copy(state.urpBloomTint)
    const background = scene.effects.backgroundColorAdjustPass
    background.enabled = state.backgroundEnabled
    background.uniforms.uEnabled.value = state.backgroundPassEnabled
    background.uniforms.uBackgroundTint.value.copy(state.backgroundTint)
    scene.effects.combatVfxScreenPass.setState({
        ...EMPTY_COMBAT_VFX_SCREEN_STATE,
        radialCenter: [...EMPTY_COMBAT_VFX_SCREEN_STATE.radialCenter],
    })
    updateCharacterUniforms(scene)
}

/** Canonical decimal comparison only: no rounding, whitespace, exponent or
 * leading-zero coercion. Raw product and cue records remain unchanged. */
function normalizedCombatSkillId(value: unknown): string | null | undefined {
    if (value === null) return null
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined
    }
    return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? value : undefined
}

function sameCombatSkillId(left: unknown, right: unknown) {
    // Replaces the former strict guards (product.skillUniqueId !== cue.payload.skillUniqueId
    // and product.skillMstId !== cue.payload.skillMstId) without coercing unsafe values.
    const normalized = normalizedCombatSkillId(left)
    return normalized !== undefined && normalized === normalizedCombatSkillId(right)
}

function nativeActionIdentityKey(identity: UnknownRecord, cue: CombatVfxCueDetail) {
    const unique = normalizedCombatSkillId(cue.payload.skillUniqueId)
    const mst = normalizedCombatSkillId(cue.payload.skillMstId)
    if (unique == null || mst == null || typeof identity.characterId !== 'string'
        || typeof identity.styleMstId !== 'string') return undefined
    return `official-combat:${identity.characterId}:${identity.styleMstId}:${unique}:${mst}:${cue.effectId}`
}

function combatVfxCueProductIdentityMatches(
    product: CombatVfxProduct,
    cue: CombatVfxCueDetail,
    actor: THREE.Object3D,
    domain: CombatVfxDomain,
) {
    if (product.effectId !== cue.effectId || product.bundleLogicalPath !== cue.payload.bundleKey) return false
    const primary = sameCombatSkillId(product.skillUniqueId, cue.payload.skillUniqueId)
        && sameCombatSkillId(product.skillMstId, cue.payload.skillMstId)
    // Explicit library previews retain their primary product semantics. Enemy
    // products remain on their existing path, not character metadata projection.
    if (cue.actionId.startsWith('catalog:') || domain !== 'character') return primary
    if (cue.payload.directionName !== product.effectId
        || String(actor.userData.characterId) !== cue.characterId) return false
    const identity = record(cue.payload.characterIdentity)
    const declared = product.characterIdentities ?? []
    if (declared.length > 0) {
        if (identity.characterId !== cue.characterId) return false
        const matched = declared.filter(row => Object.keys(row).every(key => row[key] === identity[key]))
        if (matched.length !== 1) return false
        const actionId = nativeActionIdentityKey(identity, cue)
        if (!actionId || cue.payload.sourceActionId !== actionId || !product.actionIds?.includes(actionId)) return false
        // Membership of separate arrays is insufficient: the action ID binds
        // character/style and both skill IDs into one declared native tuple.
        return (product.skills ?? []).filter(skill =>
            skill.bundleLogicalKey === cue.payload.bundleKey
            && skill.directionName === cue.effectId
            && sameCombatSkillId(skill.skillUniqueId, cue.payload.skillUniqueId)
            && sameCombatSkillId(skill.skillMstId, cue.payload.skillMstId)).length === 1
    }
    // Older schema-2 products omit the subject/alias arrays. Admit only their
    // primary IDs and an actually resolved native self hierarchy on this actor.
    // Their absent alias metadata is never invented from a UI/name heuristic.
    if (!primary) return false
    const selfPaths = [
        ...product.timeline.controlClips.map(clip => clip.anchor),
        ...product.timeline.effectTrackClips.flatMap(clip => [clip.startAnchor, clip.endAnchor]),
    ].filter((anchor): anchor is ProductAnchor => anchor?.role === 'self')
        .map(anchor => anchor.exactHierarchyPath).filter((path): path is string => Boolean(path))
    if (!selfPaths.some(path => resolveStageHierarchyPath(actor, path))) return false
    if (cue.payload.characterIdentity !== undefined) {
        if (identity.characterId !== cue.characterId
            || !selfPaths.some(path => path.split('/')[0] === identity.resourceName)) return false
        if (cue.payload.sourceActionId !== nativeActionIdentityKey(identity, cue)) return false
    } else if (cue.payload.sourceActionId !== undefined) return false
    return true
}

function createInstance(
    scene: MagiaExedraScene3D,
    cue: CombatVfxCueDetail,
    loaded: LoadedCombatVfxProduct,
    elapsedDuringLoad: number,
    cueActor: THREE.Object3D,
    facingTarget?: THREE.Object3D,
) {
    const actor = resolveActor(scene, cue.characterId)
    if (!actor) throw new Error(`combat VFX actor is ambiguous or absent: ${cue.characterId}`)
    if (actor !== cueActor) throw new Error(`combat VFX actor changed during product load: ${cue.characterId}`)
    const { product } = loaded
    if (!combatVfxCueProductIdentityMatches(product, cue, actor, loaded.catalogEntry.domain)) {
        throw new Error(`combat VFX cue/product identity mismatch: ${cue.effectId}`)
    }
    const resolvedTarget = resolveMainTargetBinding(scene, actor, facingTarget)
    if (productMainTargetAnchors(product).length > 0 && !resolvedTarget.target) {
        throw new Error(
            `combat VFX target-required product has no unambiguous scene target or valid actor-facing snapshot: ${product.vfxKey}`,
        )
    }
    const snapshot = product.timeline.screenTracks.length > 0
        ? captureVisualState(scene)
        : undefined
    if (snapshot?.bloomEnabled && snapshot.urpBloomEnabled) {
        throw new Error(
            'combat VFX screen-track baseline has both generic and ReDrive URP Bloom enabled',
        )
    }
    const root = createHierarchy(product)
    root.name = `CombatVfx:${product.action}:${cue.actionSequence}`
    scene.scene.add(root)
    root.updateMatrixWorld(true)
    const sprites = createSpriteRuntime(root, product, loaded.spriteTextures)
    const instance: ActiveInstance = {
        id: `${cue.characterId}:${cue.actionSequence}:${cue.cueId}`,
        cue,
        loaded,
        root,
        actor,
        target: resolvedTarget.target,
        targetBinding: resolvedTarget.binding,
        facingTarget,
        controls: [],
        tweens: [],
        sprites,
        timelineTime: Math.max(0, cue.actionTimeSeconds),
        wallTime: 0,
        snapshot,
        missingAnchors: [],
        anchorFallbacks: [],
        anchorCache: new Map(),
    }
    for (const clip of product.timeline.effectTrackClips) {
        if (clip.assetClass !== 'TweenClip') continue
        if (!isProductTweenClip(clip)) {
            instance.missingAnchors.push(`tween-contract:${clip.trackPathID}`)
            continue
        }
        const binding = resolveStageHierarchyPath(root, clip.trackBinding.hierarchyPath)
        if (!binding) {
            instance.missingAnchors.push(`tween-binding:${clip.trackBinding.hierarchyPath}`)
            continue
        }
        instance.tweens.push({ clip, binding, missingAnchor: false })
    }
    const profilesById = new Map(
        product.particleRuntime.particleSystems.map(profile => [profile.pathID, profile]),
    )
    for (const clip of product.timeline.controlClips) {
        const source = resolveStageHierarchyPath(root, clip.source.hierarchyPath)
        if (!source) {
            instance.missingAnchors.push(`source:${clip.source.hierarchyPath}`)
            continue
        }
        source.visible = false
        const profiles = clip.particleSystemPathIDs
            .map(pathID => profilesById.get(pathID))
            .filter((value): value is StageParticleSystemProfile => Boolean(value))
            .map(profile => ({ ...profile, active: true }))
        const particles = new StageParticleRuntimeController(
            root,
            product.particleRuntime.particlePresets,
            profiles,
            loaded.materialBindings,
            loaded.textures,
            {
                forceActive: true,
                forcePlayOnAwake: true,
                officialMaterials: product.particleRuntime.officialMaterials,
            },
        )
        const control: ActiveControl = {
            clip,
            source,
            particles,
            particleTime: 0,
            active: false,
            missingAnchor: false,
            drawnParticlePathIDs: new Set(),
            restoreDrawProbes: [],
        }
        armControlDrawProbes(root, control)
        instance.controls.push(control)
    }
    const step = 1 / 120
    let remaining = Math.max(0, elapsedDuringLoad)
    while (remaining > 0) {
        const delta = Math.min(step, remaining)
        instance.timelineTime += delta * timelineSpeed(product, instance.timelineTime)
        instance.wallTime += delta
        remaining -= delta
    }
    for (const tween of instance.tweens) updateTween(instance, tween)
    instance.sprites.update(instance.timelineTime)
    for (const control of instance.controls) {
        if (
            instance.timelineTime >= control.clip.start
            && instance.timelineTime <= control.clip.end
        ) {
            control.particleTime = Math.max(0, instance.timelineTime - control.clip.start)
        }
    }
    activeInstances.set(instance.id, instance)
    return instance
}

function disposeInstance(instance: ActiveInstance, completed: boolean) {
    restoreScreenTracks(instance)
    for (const control of instance.controls) {
        for (const restore of control.restoreDrawProbes.splice(0)) restore()
        control.drawnParticlePathIDs.clear()
        control.particles.dispose()
    }
    instance.sprites.dispose()
    instance.anchorCache.clear()
    instance.facingTarget?.removeFromParent()
    instance.facingTarget = undefined
    instance.target = undefined
    instance.root.removeFromParent()
    activeInstances.delete(instance.id)
    if (completed) completedCount++
}

function updateInstance(instance: ActiveInstance, deltaSeconds: number) {
    const product = instance.loaded.product
    instance.wallTime += deltaSeconds
    instance.timelineTime += deltaSeconds * timelineSpeed(product, instance.timelineTime)
    // TweenTrack drives prefab bindings before ControlPlayable anchors are
    // evaluated, matching the official graph order for a moving projectile.
    for (const tween of instance.tweens) updateTween(instance, tween)
    for (const control of instance.controls) {
        const active = instance.timelineTime >= control.clip.start
            && instance.timelineTime <= control.clip.end
        if (active && !control.active) {
            control.active = true
            control.particleTime = Math.max(
                control.particleTime,
                instance.timelineTime - control.clip.start,
            )
        }
        control.source.visible = active
        if (!active) {
            control.active = false
            continue
        }
        updateControlAnchor(instance, control)
        if (control.missingAnchor) continue
        control.particleTime += deltaSeconds
        control.particles.update(control.particleTime)
    }
    instance.sprites.update(instance.timelineTime)
    if (instance.snapshot) applyScreenTracks(instance)
    return instance.timelineTime >= product.timeline.lifetimeSeconds
}

function emitStateChange() {
    if (!installedScene) return
    const state = getCombatVfxDebugState()
    installedScene.scene.userData.combatVfxRuntime = state
    document.dispatchEvent(new CustomEvent(COMBAT_VFX_STATE_CHANGE_EVENT, {
        detail: state,
    }))
}

function updateRuntime() {
    const now = performance.now()
    const deltaSeconds = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000))
    lastFrameTime = now
    let changed = false
    for (const instance of [...activeInstances.values()]) {
        if (updateInstance(instance, deltaSeconds)) {
            disposeInstance(instance, true)
            changed = true
        }
    }
    if (changed || activeInstances.size > 0) emitStateChange()
}

type ConsumeCueResult =
    | { status: 'played'; instance: ActiveInstance }
    | { status: 'suppressed' }
    | { status: 'rejected'; error: string }

async function consumeCueDetail(cue: CombatVfxCueDetail): Promise<ConsumeCueResult> {
    lastCue = {
        characterId: cue.characterId,
        actionId: cue.actionId,
        actionSequence: cue.actionSequence,
        effectId: cue.effectId,
        bundleKey: cue.payload.bundleKey,
    }
    if (!runtimeEnabled) {
        suppressedCount++
        lastError = null
        emitStateChange()
        return { status: 'suppressed' }
    }
    const scene = installedScene
    if (!scene) {
        const error = 'combat VFX runtime is not installed'
        rejectedCount++
        lastError = error
        return { status: 'rejected', error }
    }
    const received = performance.now()
    try {
        const cueActor = resolveActor(scene, cue.characterId)
        if (!cueActor) throw new Error(`combat VFX actor is ambiguous or absent: ${cue.characterId}`)
        if (cueActor.userData.nonBattleCharacter && !cue.actionId.startsWith('catalog:')) {
            throw new Error(`combat VFX automatic cue is unavailable for typed nonbattle actor: ${cue.characterId}`)
        }
        const facingTarget = captureFacingTarget(cueActor)
        const loaded = await loadCombatVfxProduct(cue.payload.bundleKey)
        if (!runtimeEnabled || installedScene !== scene) {
            suppressedCount++
            lastError = null
            emitStateChange()
            return { status: 'suppressed' }
        }
        const elapsed = Math.max(0, (performance.now() - received) / 1000)
        const duplicate = [...activeInstances.values()].find(instance =>
            instance.cue.characterId === cue.characterId
            && instance.cue.actionSequence === cue.actionSequence)
        if (duplicate) disposeInstance(duplicate, false)
        if (loaded.product.timeline.screenTracks.length > 0) {
            for (const instance of [...activeInstances.values()]) {
                if (instance.snapshot) disposeInstance(instance, false)
            }
        }
        const instance = createInstance(scene, cue, loaded, elapsed, cueActor, facingTarget)
        lastError = null
        emitStateChange()
        return { status: 'played', instance }
    } catch (error) {
        rejectedCount++
        lastError = error instanceof Error ? error.message : String(error)
        emitStateChange()
        return { status: 'rejected', error: lastError }
    }
}

async function consumeCue(event: Event) {
    const cue = validateCue((event as CustomEvent).detail)
    if (!cue) {
        rejectedCount++
        lastError = 'combat VFX cue contract rejected'
        emitStateChange()
        return
    }
    await consumeCueDetail(cue)
}

export async function playCombatVfxSelection(
    selection: CombatVfxSelection,
): Promise<CombatVfxSelectionResult> {
    const scene = installedScene
    if (!scene) throw new Error('combat VFX runtime is not installed')
    const entry = await resolveCombatVfxSelectionEntry(selection)
    const actorKey = resolveSelectionActorKey(scene, selection.actorKey)
    const actionSequence = ++manualCueSequence
    const cue: CombatVfxCueDetail = {
        characterId: actorKey,
        actionId: `catalog:${entry.stableKey}`,
        actionSequence,
        cueId: `catalog:${entry.stableKey}:${actionSequence}`,
        effectId: entry.effectId,
        actionTimeSeconds: 0,
        payload: {
            schema: 'magius-viewer-combat-vfx-slot-v1',
            bundleKey: entry.bundleKey,
            directionName: entry.directionName,
            skillUniqueId: entry.skillUniqueId,
            skillMstId: entry.skillMstId,
            sequenceId: entry.stableKey,
        },
    }
    const result = await consumeCueDetail(cue)
    if (result.status === 'rejected') throw new Error(result.error)
    return {
        status: result.status,
        stableKey: entry.stableKey,
        instanceId: result.status === 'played' ? result.instance.id : null,
    }
}

export function stopCombatVfx() {
    for (const instance of [...activeInstances.values()]) {
        disposeInstance(instance, false)
    }
    if (installedScene) emitStateChange()
    return getCombatVfxDebugState()
}

export function setCombatVfxEnabled(enabled: boolean) {
    runtimeEnabled = Boolean(enabled)
    if (!runtimeEnabled) stopCombatVfx()
    else if (installedScene) emitStateChange()
    return getCombatVfxDebugState()
}

export function setCombatVfxMainTarget(target: THREE.Object3D | null | undefined) {
    explicitMainTarget = target ?? null
    if (installedScene) for (const instance of activeInstances.values()) {
        rebindInstanceMainTarget(installedScene, instance)
    }
    if (installedScene) emitStateChange()
}

export function registerCombatVfxActor(
    actorKey: string,
    actor: THREE.Object3D,
): () => void {
    registeredActors.set(actorKey, actor)
    return () => {
        if (registeredActors.get(actorKey) === actor) registeredActors.delete(actorKey)
    }
}

export function getCombatVfxDebugState(): CombatVfxDebugState {
    const productState: CombatVfxDebugState['productState'] = {}
    const bundleKeys = new Set([
        ...catalogEntries.map(entry => entry.bundleKey),
        ...productStates.keys(),
    ])
    for (const bundleKey of bundleKeys) {
        productState[bundleKey] = productStates.get(bundleKey) ?? 'unloaded'
    }
    return {
        eventName: COMBAT_VFX_CUE_EVENT,
        changeEventName: COMBAT_VFX_STATE_CHANGE_EVENT,
        installed: Boolean(uninstallRuntime),
        enabled: runtimeEnabled,
        productState,
        active: [...activeInstances.values()].map(instance => {
            const particleStates = instance.controls.map(control =>
                control.particles.getDebugState())
            const targetWorldPosition = instance.target
                ? instance.target.getWorldPosition(new THREE.Vector3()).toArray()
                : null
            const activePhases = new Set<'self' | 'projectile' | 'travel' | 'impact'>()
            for (const control of instance.controls) {
                if (!control.active || control.missingAnchor) continue
                if (control.clip.anchor.role === 'self') activePhases.add('self')
                if (control.clip.anchor.role === 'prefab') activePhases.add('projectile')
                if (control.clip.anchor.role === 'main-target') activePhases.add('impact')
            }
            if (instance.tweens.some(tween =>
                !tween.missingAnchor
                && instance.timelineTime >= tween.clip.start
                && instance.timelineTime <= tween.clip.end)) activePhases.add('travel')
            const controlPhases = instance.controls.map((control, index) => ({
                role: control.clip.anchor.role,
                sourcePath: control.clip.source.hierarchyPath,
                start: control.clip.start,
                end: control.clip.end,
                active: control.active,
                missingAnchor: control.missingAnchor,
                sourceWorldPosition: control.source
                    .getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number],
                requestedParticleSystems: particleStates[index]!.requestedSystemCount,
                drawableParticleSystems: particleStates[index]!.drawableSystemCount,
                activeParticles: particleStates[index]!.activeParticleCount,
                missingParticleAnchorPaths: [
                    ...particleStates[index]!.missingAnchorPaths,
                ],
                missingMaterialNames: [...particleStates[index]!.missingMaterialNames],
                particleDrawables: controlParticleDrawables(instance, control),
            }))
            return {
                id: instance.id,
                action: instance.loaded.product.action,
                vfxKey: instance.loaded.product.vfxKey,
                actorCharacterId:
                    typeof instance.actor.userData.characterId === 'number'
                        ? instance.actor.userData.characterId
                        : null,
                targetBound: Boolean(instance.target),
                targetBinding: instance.targetBinding,
                targetEnemyMstId:
                    typeof instance.target?.userData.enemyMstId === 'number'
                    || typeof instance.target?.userData.enemyMstId === 'string'
                        ? instance.target.userData.enemyMstId
                        : null,
                targetWorldPosition,
                timelineTime: instance.timelineTime,
                lifetimeSeconds: instance.loaded.product.timeline.lifetimeSeconds,
                controlCount: instance.controls.length,
                tweenCount: instance.tweens.length,
                activeTweenCount: instance.tweens.filter(tween =>
                    !tween.missingAnchor
                    && instance.timelineTime >= tween.clip.start
                    && instance.timelineTime <= tween.clip.end).length,
                fallbackMaterialBindingNames: [
                    ...instance.loaded.fallbackMaterialBindingNames,
                ],
                requestedParticleSystems: particleStates.reduce(
                    (sum, state) => sum + state.requestedSystemCount, 0,
                ),
                activeParticleSystems: particleStates.reduce(
                    (sum, state) => sum + state.activeSystemCount, 0,
                ),
                activeParticles: particleStates.reduce(
                    (sum, state) => sum + state.activeParticleCount, 0,
                ),
                spriteBindingCount: instance.sprites.bindings.length,
                activeSpriteBindings: instance.sprites.bindings.filter(
                    binding => binding.active,
                ).length,
                spriteAppliedFrames: instance.sprites.bindings.reduce(
                    (sum, binding) => sum + binding.appliedFrameCount,
                    0,
                ),
                spriteFrameChanges: instance.sprites.bindings.reduce(
                    (sum, binding) => sum + binding.frameChangeCount,
                    0,
                ),
                missingSpritePaths: [...instance.sprites.missingPaths],
                missingAnchors: [...instance.missingAnchors],
                anchorFallbacks: [...instance.anchorFallbacks],
                activePhases: [...activePhases],
                controlPhases,
                screenTrackClasses: instance.loaded.product.timeline.screenTracks
                    .map(row => row.class),
            }
        }),
        mainTargetBound: Boolean(explicitMainTarget)
            || [...activeInstances.values()].some(instance => Boolean(instance.target)),
        lastCue,
        lastError,
        completedCount,
        rejectedCount,
        suppressedCount,
    }
}

/** Install once from scene.ts; no UI or locomotion ownership is touched. */
export function installCombatVfxRuntime(scene: MagiaExedraScene3D) {
    if (uninstallRuntime) return uninstallRuntime
    installedScene = scene
    lastFrameTime = performance.now()
    const removeFrame = scene.addBeforeRenderCallback(updateRuntime)
    document.addEventListener(COMBAT_VFX_CUE_EVENT, consumeCue)
    void productCatalog.ready().then(catalog => {
        catalogEntries = catalog.list()
    }).catch(error => {
        lastError = error instanceof Error ? error.message : String(error)
        emitStateChange()
    })
    uninstallRuntime = () => {
        document.removeEventListener(COMBAT_VFX_CUE_EVENT, consumeCue)
        removeFrame()
        for (const instance of [...activeInstances.values()]) {
            disposeInstance(instance, false)
        }
        for (const promise of productPromises.values()) {
            void promise.then(loaded => {
                loaded.textures.forEach(texture => texture.dispose())
                loaded.spriteTextures.forEach(texture => texture.dispose())
            })
        }
        productPromises.clear()
        productStates.clear()
        registeredActors.clear()
        installedScene = undefined
        uninstallRuntime = undefined
    }
    emitStateChange()
    return uninstallRuntime
}

Object.assign(window, {
    getCombatVfxDebugState,
    listCombatVfxSelections,
    playCombatVfxSelection,
    registerCombatVfxActor,
    setCombatVfxEnabled,
    setCombatVfxMainTarget,
    stopCombatVfx,
})
