import type * as THREE from 'three'

export type EnemyLocale = 'en' | 'ja' | 'zh' | 'zh-Hant' | string

export interface EnemyNames {
    en: string | null
    ja: string | null
    zhHant: string | null
    runes: string | null
}

export interface EnemyClipDescriptor {
    pathId: string
    sourceName: string
    runtimeName: string
    durationSeconds: number | null
    sampleRate: number | null
    transformTrackCount: number
}

export interface EnemyControllerDescriptor {
    type: string
    pathId: string
    name: string
}

export interface EnemyMaterialDescriptor {
    pathId: string
    name: string
}

export interface EnemyMaterialTextureProfile {
    stableKey: string
    pathId: string
    cab: string | null
    bundleKey: string | null
    resolved: boolean
    type: string | null
    name: string | null
    scale: [number, number]
    offset: [number, number]
    sourceResolved?: boolean
    runtimeReady?: boolean
    runtimeFile?: string
    runtimeUrl?: string | null
    runtimeAlpha?: {
        present: boolean
        minimum: number
        maximum: number
    }
    runtimeColorSpace?: 'srgb' | 'linear' | null
    runtimeWrap?: {
        u: 'repeat' | 'clamp' | 'mirror' | 'mirror-once' | null
        v: 'repeat' | 'clamp' | 'mirror' | 'mirror-once' | null
    }
    runtimeFilter?: 'nearest' | 'bilinear' | 'trilinear' | null
    runtimeAnisotropy?: number | null
    runtimeAuthority?: {
        kind: string
        source: string
        sourceBundleKey: string | null
    }
    runtimeFailClosedReasons?: string[]
}

export interface EnemyMaterialRuntimeProfile {
    mainTextureProperty: string | null
    mainTextureRuntimeFile: string | null
    mainTextureAlpha: {
        present: boolean
        minimum: number
        maximum: number
    }
    transparent: boolean
    depthWrite: boolean
    alphaToCoverage: boolean
    alphaTest: {
        enabled: boolean
        threshold: number
        authority: string
    }
    blending: 'normal' | 'additive' | 'multiply'
    sourceBlend: number
    destinationBlend: number
    side: 'front' | 'back' | 'double'
    color: [number, number, number, number] | null
    emissionColor: [number, number, number, number] | null
    castShadow: boolean
    receiveShadow: boolean
    requiredTextureProperties?: string[]
    missingRequiredTextureProperties?: string[]
}

export interface EnemyMaterialProfile {
    stableKey: string
    pathId: string
    materialName: string
    sourceCab: string
    sourceBundleKey: string | null
    shader: {
        stableKey: string
        pathId: string
        cab: string | null
        bundleKey: string | null
        resolved: boolean
        type: string | null
        name: string | null
    } | null
    renderQueue: number
    validKeywords: string[]
    invalidKeywords: string[]
    legacyShaderKeywords: string | null
    disabledShaderPasses: string[]
    serializedFloats: Record<string, number>
    serializedNonFiniteFloats: Record<string, 'positive-infinity' | 'negative-infinity' | 'nan'>
    serializedInts: Record<string, number>
    serializedNonFiniteInts: Record<string, 'positive-infinity' | 'negative-infinity' | 'nan'>
    serializedColors: Record<string, [number, number, number, number]>
    serializedNonFiniteColors: Record<
        string,
        Array<number | 'positive-infinity' | 'negative-infinity' | 'nan'>
    >
    textures: Record<string, EnemyMaterialTextureProfile>
    runtime: EnemyMaterialRuntimeProfile
}

export interface EnemyMaterialProfileProduct {
    schema: 'magius.enemy-material-profile.v1'
    modelPrefabName: string
    sourceBundleKey: string
    lookup: {
        primary: 'materialName'
        disambiguation: 'mainTextureRuntimeFile'
        idSpecialCases: false
    }
    status: 'runtime-ready' | 'fail-closed'
    runtimeReady: boolean
    failClosedReasons: string[]
    textureStatus?: 'runtime-ready' | 'fail-closed'
    textureRuntimeReady?: boolean
    textureFailClosedReasons?: string[]
    counts: {
        declaredMaterialObjects: number
        resolvedMaterialObjects: number
        materialProfiles: number
        runtimeTextureFiles: number
        rendererBindings: number
        rendererBoundMaterialProfiles: number
        alphaTestProfiles: number
        transparentProfiles: number
        runtimeTextureReferences?: number
        missingRuntimeTextureReferences?: number
        requiredRuntimeTextureReferences?: number
        missingRequiredRuntimeTextureReferences?: number
    }
    rendererBindings: Array<{
        stableKey: string
        rendererType: 'SkinnedMeshRenderer' | 'MeshRenderer'
        rendererPathId: string
        sourceCab: string
        sourceBundleKey: string
        priority: number
        enabled: boolean
        active: boolean
        gameObjectName: string
        hierarchyPath: string
        meshName: string
        meshStableKey: string | null
        meshVertexCount: number | null
        meshIndexCount: number | null
        meshSubmeshCount: number | null
        materialProfileKeys: Array<string | null>
    }>
    unresolvedRendererMaterials: Array<Record<string, unknown>>
    profiles: EnemyMaterialProfile[]
}

export interface EnemyActionDirection {
    directionName: string
    bundleKey: string | null
    localBundleAvailable: boolean
    stableDirectionKey: string
    catalogProduct: {
        stableKey: string
        productStableKey: string
        productUrl: string
        schemaVersion: 2
        status: 'runtime-ready' | 'fail-closed'
        runtimeReady: boolean
        failClosedReasons: string[]
    } | null
    runtimeProduct: {
        stableKey: string
        productUrl: string
        schemaVersion: 2
    } | null
    skillMstIds: number[]
    skillTypes: number[]
    hitEffectResourceNames: string[]
}

export interface EnemyManifestEntry {
    enemyMstId: number
    enemyUniqueId: number
    enemyType: number
    size: number
    modelPrefabName: string
    names: EnemyNames
    model: {
        bundleKey: string
        runtimeUrl: string | null
        materialProfileUrl: string | null
        rootName: string
        renderReady: boolean
        modelBundleKeys: string[]
        animatorBundleKeys: string[]
        textureBundleKeys: string[]
        shaderBundleKeys: string[]
        controllers: EnemyControllerDescriptor[]
        baseClips: EnemyClipDescriptor[]
        materialObjects: EnemyMaterialDescriptor[]
    }
    actions: {
        enemySkillSetIds: number[]
        directions: EnemyActionDirection[]
    }
    effects: {
        appearEffectPrefabName: string | null
        skillDirectionBundleKeys: string[]
    }
    thumbnail: {
        resourceName: string
        bundleKey: string
        url: string | null
        originalBundleKey: string
        previewUrl: string | null
    }
}

export interface EnemyResourceManifest {
    schema: 'magius.enemy-resource-manifest.v1'
    sourceAuthority: Record<string, string>
    displayNameFallback: {
        zh: string[]
        ja: string[]
        default: string[]
    }
    vfxCatalogUrl: string
    counts: {
        enemyRecords: number
        modelResources: number
        enemyFamilies: number
        renderReadyModels: number
        localizedNames: Record<string, number>
        thumbnailResources: number
        directionRecords: number
        directionRecordsWithCatalogProduct: number
        uniqueCatalogVfxProducts: number
        directionRecordsWithRuntimeProduct: number
        uniqueRuntimeVfxProducts: number
    }
    entries: EnemyManifestEntry[]
}

export interface EnemyAddOptions {
    position?: THREE.Vector3Tuple
    rotation?: THREE.Vector3Tuple
    scale?: number | THREE.Vector3Tuple
    name?: string
}

export type EnemyResourceErrorCode =
    | 'MANIFEST_HTTP_ERROR'
    | 'MANIFEST_SCHEMA_ERROR'
    | 'ENEMY_NOT_FOUND'
    | 'MODEL_NOT_READY'
    | 'MODEL_HTTP_ERROR'
    | 'MODEL_PARSE_ERROR'
