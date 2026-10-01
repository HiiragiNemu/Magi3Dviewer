import * as THREE from 'three'
import type { ReDriveBackgroundShaderGlobals } from './reDriveVolumeRuntime'
import { resolveRuntimeAssetUrl } from './runtimeProductDelivery'
import { loadNativeMatcapMips } from './stageNativeMatcapMips'
import { createStageShadowOnlyMaterial, SHADOW_ONLY_SOURCE } from './stageShadowOnlyMaterial'
import { createStageParticleSurfaceMaterial, type StageParticleDepthRegistrar } from './stageParticles'

export interface StageAtlasProfile {
    columns: number
    rows: number
    /** Frame offset recovered from the serialized material. */
    offset?: number
    /** Zero disables animation and displays only the selected frame. */
    framesPerSecond?: number
}

export interface StageMultiUvScrollLayer {
    tiling: [number, number]
    offset: [number, number]
    speed: [number, number]
    color?: [number, number, number, number]
    opacity?: number
}

export interface StageMultiUvScrollProfile {
    /** Separately serialized Unity `_ScrollTexture` / `_ScrollTexutre`. */
    textureUrl: string
    first: StageMultiUvScrollLayer
    second: StageMultiUvScrollLayer
    /** Serialized `_Additive_to_Multiply`: 0 additive, 1 multiply. */
    additiveToMultiply: number
    /** `_DropFrame_MultiScroll`; exact dropped-frame quantization is deferred. */
    dropFrame?: boolean
}

export interface StageFlowMapProfile {
    /** Serialized Unity `_FlowMap`; sampled as signed RG direction data. */
    textureUrl: string
    /** Serialized `_FlowSpeed`. */
    speed: number
    /** Serialized `_FlowMapPow`. */
    power?: number
    /** `_DropFrame_FlowMap`; exact time quantization remains source evidence. */
    dropFrame?: boolean
}

export type StageTextureWrap = 'repeat' | 'clamp' | 'mirror'
export type StageTextureFilter = 'point' | 'bilinear' | 'trilinear'
export type StageTextureSlot =
    | 'base'
    | 'normal'
    | 'smoothness'
    | 'blend'
    | 'matCap'
    | 'emission'

export interface StageTextureBinding {
    /** Runtime URL of the exported carrier texture. */
    url: string
    /** Exact original sRGB MatCap levels; optional, never a lightmap/normal route. */
    nativeMipManifestUrl?: string
    /** Unity material property that owns this TexEnv, e.g. `_BaseMap`. */
    sourceProperty: string
    /** Exact source Texture2D PPtr when raw bundle evidence is available. */
    sourceTexturePathId?: string
    /** Manifest-relative bundle and serialized CAB that make the PPtr unique. */
    sourceTextureBundle?: string
    sourceTextureCab?: string
    /** Serialized Texture2D colour-space flag before slot-specific runtime use. */
    serializedColorSpace?: 'srgb' | 'linear'
    colorSpace: 'srgb' | 'linear'
    coordinates:
        | { kind: 'mesh-uv', channel: 0 | 1 | 2 | 3 }
        | { kind: 'view-normal' }
    /** Serialized Unity Material TexEnv scale/offset. */
    transform: {
        scale: [number, number]
        offset: [number, number]
    }
    /** Serialized Texture2D per-axis sampler state. */
    wrap: {
        u: StageTextureWrap
        v: StageTextureWrap
    }
    filter: StageTextureFilter
    anisotropy: number
    mipBias: number
    mipCount: number
    evidence: 'exact-unity-texture2d' | 'legacy-default'
}

export interface StageTextureSet {
    base?: StageTextureBinding
    normal?: StageTextureBinding
    smoothness?: StageTextureBinding
    blend?: StageTextureBinding
    matCap?: StageTextureBinding
    emission?: StageTextureBinding
}

export interface StageMaterialBinding {
    /** Exact FBX material name. */
    materialName?: string
    /** Optional regular expression for exporter-added name suffixes. */
    materialPattern?: string
    /** Exact serialized Unity shader name used to select the material family. */
    sourceShader?: string
    /** Exact Material queue; -1 selects the shader's default queue. */
    renderQueue?: number
    /** Unity 2022 local/global keyword state used to select compiled variants. */
    validKeywords?: string[]
    invalidKeywords?: string[]
    disabledShaderPasses?: string[]
    shading?: 'lit' | 'unlit'
    /** Source blend state mapped to the closest Three.js blend equation. */
    blending?: 'normal' | 'additive' | 'multiply'
    /** Serialized Unity _BaseColor/_Color multiplier. */
    color?: string | [number, number, number, number]
    /** Serialized linear HDR `_EmissionColor`; alpha is not shader input. */
    emissionColor?: [number, number, number, number]
    baseMapUrl?: string
    normalMapUrl?: string
    smoothnessMapUrl?: string
    blendMapUrl?: string
    matCapMapUrl?: string
    emissionMapUrl?: string
    /**
     * Exact per-slot Texture2D sampler and Material TexEnv data. New official
     * products use this path; URL fields above remain a legacy compatibility
     * surface and are normalized once at load time.
     */
    textures?: StageTextureSet
    /**
     * Complete serialized Material TexEnv table. The named slots above remain
     * the mesh-material consumer, while particles/custom shader operators use
     * the original Unity property names without dropping secondary masks,
     * waves, dissolve maps, or shader-graph textures.
     */
    serializedTextures?: Record<string, StageTextureBinding>
    /** Complete serialized Material float table for generic shader consumers. */
    serializedFloats?: Record<string, number>
    /** Complete serialized Material color/vector table. */
    serializedColors?: Record<string, [number, number, number, number]>
    /** Legacy shorthand used only when every authored map shares one wrap mode. */
    textureWrap?: StageTextureWrap
    vertexColorBlend?: boolean
    smoothness?: number
    smoothnessChannel?: 'r' | 'g' | 'b' | 'a'
    metallic?: number
    metallicFromSmoothnessMap?: boolean
    normalScale?: number
    /** Official BgUber stores tangent-space X/Y in texture A/G and rebuilds Z. */
    normalPacking?: 'unity-dxt5nm-ag'
    /** URP `_SMOOTHNESS_TEXTURE_ALBEDO_CHANNEL_A` variant state. */
    smoothnessFromBaseAlpha?: boolean
    alphaTest?: number
    alphaToCoverage?: boolean
    transparent?: boolean
    /** Exact Unity ZWrite state when serialized evidence is available. */
    depthWrite?: boolean
    unlitness?: number
    matCapIntensity?: number
    useMatCap?: boolean
    useSmoothnessMaskMatCap?: boolean
    /** Serialized `_FogInfluence`; 0 bypasses scene fog and 1 uses it fully. */
    fogInfluence?: number
    castShadow?: boolean
    receiveShadow?: boolean
    side?: 'front' | 'back' | 'double'
    atlas?: StageAtlasProfile
    multiUvScroll?: StageMultiUvScrollProfile
    flowMap?: StageFlowMapProfile
}

export interface StageMaterialBindingResult {
    textures: THREE.Texture[]
    matchedMaterials: string[]
    unmatchedBindings: string[]
    unmatchedSourceMaterials: string[]
    backgroundShaderGlobalsApplied: boolean
    backgroundShaderMaterials: string[]
    renderQueueMeshes: string[]
    mixedRenderQueueMeshes: string[]
}

const BACKGROUND_GLOBAL_SHADER_FAMILIES = new Set([
    'Creative/Bg/BgUberShader',
    'Creative/Bg/BgUnlit',
])
const BACKGROUND_GLOBAL_PROVEN_BYPASS_FAMILIES = new Set([
    // Official compiled variants contain no `_BgColorAdjustments` uniform.
    'Creative/Effect/Particle/Common',
])

const sideByName = {
    front: THREE.FrontSide,
    back: THREE.BackSide,
    double: THREE.DoubleSide,
} as const

const magFilterByName = {
    point: THREE.NearestFilter,
    bilinear: THREE.LinearFilter,
    trilinear: THREE.LinearFilter,
} as const

function minFilterFor(profile: StageTextureBinding) {
    if (profile.mipCount === 1) {
        return profile.filter === 'point'
            ? THREE.NearestFilter
            : THREE.LinearFilter
    }
    if (profile.filter === 'point') return THREE.NearestMipmapNearestFilter
    if (profile.filter === 'bilinear') return THREE.LinearMipmapNearestFilter
    return THREE.LinearMipmapLinearFilter
}

function legacyTextureBinding(
    url: string,
    colorSpace: 'color' | 'data',
    wrap: StageTextureWrap,
    anisotropy: number,
    sourceProperty: string,
    coordinates: StageTextureBinding['coordinates'] = { kind: 'mesh-uv', channel: 0 },
): StageTextureBinding {
    return {
        url,
        sourceProperty,
        colorSpace: colorSpace === 'color' ? 'srgb' : 'linear',
        coordinates,
        transform: { scale: [1, 1], offset: [0, 0] },
        wrap: { u: wrap, v: wrap },
        filter: 'trilinear',
        anisotropy,
        mipBias: 0,
        mipCount: 0,
        evidence: 'legacy-default',
    }
}

function resolveStageTextureBinding(
    binding: StageMaterialBinding,
    slot: StageTextureSlot,
    legacyAnisotropy: number,
): StageTextureBinding | undefined {
    const exact = binding.textures?.[slot]
    if (exact) {
        validateStageTextureBinding(exact, binding, slot)
        return exact
    }

    const legacy = {
        base: [binding.baseMapUrl, 'color', '_BaseMap', { kind: 'mesh-uv', channel: 0 }],
        normal: [binding.normalMapUrl, 'data', '_BumpMap', { kind: 'mesh-uv', channel: 0 }],
        smoothness: [binding.smoothnessMapUrl, 'data', '_MetallicGlossMap', { kind: 'mesh-uv', channel: 0 }],
        blend: [binding.blendMapUrl, 'color', '_BlendTex', { kind: 'mesh-uv', channel: 0 }],
        matCap: [binding.matCapMapUrl, 'color', '_MatCapTex', { kind: 'view-normal' }],
        emission: [binding.emissionMapUrl, 'color', '_EmissionMap', { kind: 'mesh-uv', channel: 0 }],
    } as const
    const [url, colorSpace, sourceProperty, coordinates] = legacy[slot]
    if (!url) return undefined
    return legacyTextureBinding(
        url,
        colorSpace,
        binding.textureWrap ?? 'clamp',
        legacyAnisotropy,
        sourceProperty,
        coordinates,
    )
}

function validateStageTextureBinding(
    profile: StageTextureBinding,
    material: StageMaterialBinding,
    slot: StageTextureSlot,
) {
    const label = material.materialName ?? material.materialPattern ?? '(unnamed)'
    if (profile.nativeMipManifestUrl !== undefined
        && (slot !== 'matCap' || typeof profile.nativeMipManifestUrl !== 'string'
            || !profile.nativeMipManifestUrl)) {
        throw new Error(`Native MatCap mips are invalid for ${label}/${slot}`)
    }
    const transformValues = [
        ...profile.transform.scale,
        ...profile.transform.offset,
    ]
    if (profile.evidence !== 'exact-unity-texture2d') {
        throw new Error(`Official stage texture ${label}/${slot} is not exact Unity evidence`)
    }
    if (
        !profile.url
        || !profile.sourceProperty
        || profile.transform.scale.length !== 2
        || profile.transform.offset.length !== 2
        || !(profile.wrap.u in wrappingByName)
        || !(profile.wrap.v in wrappingByName)
        || !(profile.filter in magFilterByName)
        || !transformValues.every(Number.isFinite)
        || !Number.isFinite(profile.anisotropy)
        || profile.anisotropy < 0
        || !Number.isFinite(profile.mipBias)
        // WebGL/Three has no fixed-function per-sampler LOD bias.  Refuse to
        // present a non-zero Unity value as exact until a shader path owns it.
        || profile.mipBias !== 0
        || !Number.isInteger(profile.mipCount)
        || profile.mipCount < 1
    ) {
        throw new Error(`Invalid exact stage texture descriptor: ${label}/${slot}`)
    }
}

function stageBlendingParameters(blending: StageMaterialBinding['blending']): THREE.MeshBasicMaterialParameters {
    if (blending === 'multiply') {
        // Unity's recovered _SrcBlend=2 / _DstBlend=0 is straight-color
        // DstColor / Zero. Three MultiplyBlending now requires premultiplication
        // and adds OneMinusSrcAlpha, which is a different operation.
        return {
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.DstColorFactor,
            blendDst: THREE.ZeroFactor,
            blendEquationAlpha: THREE.AddEquation,
            blendSrcAlpha: THREE.DstAlphaFactor,
            blendDstAlpha: THREE.ZeroFactor,
            premultipliedAlpha: false,
        }
    }
    return { blending: blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending }
}

const wrappingByName = {
    repeat: THREE.RepeatWrapping,
    clamp: THREE.ClampToEdgeWrapping,
    mirror: THREE.MirroredRepeatWrapping,
} as const

const THREE_SPOT_ATTENUATION_PATTERN =
    /float getSpotAttenuation\(\s*const in float coneCosine,\s*const in float penumbraCosine,\s*const in float angleCosine\s*\)\s*\{\s*return smoothstep\(\s*coneCosine,\s*penumbraCosine,\s*angleCosine\s*\);\s*\}/

const URP_SPOT_ATTENUATION = `float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {

    float rdUrpSpot = saturate(
        ( angleCosine - coneCosine )
        / max( penumbraCosine - coneCosine, 1e-5 )
    );
    return rdUrpSpot * rdUrpSpot;

}`

export function installUrpSpotAttenuation(fragmentShader: string) {
    const sourceChunk = THREE.ShaderChunk.lights_pars_begin
    const urpChunk = sourceChunk.replace(
        THREE_SPOT_ATTENUATION_PATTERN,
        URP_SPOT_ATTENUATION,
    )
    if (urpChunk === sourceChunk) {
        throw new Error('Three spot attenuation source changed')
    }
    if (fragmentShader.includes('#include <lights_pars_begin>')) {
        return fragmentShader.replace('#include <lights_pars_begin>', urpChunk)
    }
    const expanded = fragmentShader.replace(
        THREE_SPOT_ATTENUATION_PATTERN,
        URP_SPOT_ATTENUATION,
    )
    if (expanded === fragmentShader) {
        throw new Error('Three spot attenuation shader hook was not found')
    }
    return expanded
}

const THREE_LIGHT_PROBE_IRRADIANCE_PATTERN =
    /\n\s*#if defined\( USE_LIGHT_PROBES \)\s*\n\s*irradiance \+= getLightProbeIrradiance\( lightProbe, geometryNormal \);\s*\n\s*#endif\s*\n/

export function suppressUnusedUnitySphericalHarmonics(fragmentShader: string) {
    const sourceChunk = THREE.ShaderChunk.lights_fragment_begin
    const officialChunk = sourceChunk.replace(
        THREE_LIGHT_PROBE_IRRADIANCE_PATTERN,
        '\n\t// Official compiled BgUber declares Unity SH as unused.\n',
    )
    if (officialChunk === sourceChunk) {
        throw new Error('Three light-probe irradiance source changed')
    }
    if (fragmentShader.includes('#include <lights_fragment_begin>')) {
        return fragmentShader.replace(
            '#include <lights_fragment_begin>',
            officialChunk,
        )
    }
    const expanded = fragmentShader.replace(
        THREE_LIGHT_PROBE_IRRADIANCE_PATTERN,
        '\n\t// Official compiled BgUber declares Unity SH as unused.\n',
    )
    if (expanded === fragmentShader) {
        throw new Error('Three light-probe shader hook was not found')
    }
    return expanded
}

/**
 * AssetStudio's FBX contains geometry and material names, but this stage's FBX
 * contains no Texture/RelativeFilename records. This binder reconnects the
 * adjacent, separately exported textures using catalog evidence.
 */
export async function applyStageMaterialBindings(
    object: THREE.Object3D,
    bindings: StageMaterialBinding[] | undefined,
    renderer: THREE.WebGLRenderer,
    signal?: AbortSignal,
    backgroundShaderGlobals?: ReDriveBackgroundShaderGlobals,
    depthRegistrar?: StageParticleDepthRegistrar,
): Promise<StageMaterialBindingResult> {
    if (!bindings?.length) {
        return {
            textures: [],
            matchedMaterials: [],
            unmatchedBindings: [],
            unmatchedSourceMaterials: [],
            backgroundShaderGlobalsApplied: false,
            backgroundShaderMaterials: [],
            renderQueueMeshes: [],
            mixedRenderQueueMeshes: [],
        }
    }

    const textureLoader = new THREE.TextureLoader()
    const textureCache = new Map<string, Promise<THREE.Texture>>()
    const ownedTextures = new Set<THREE.Texture>()
    const matchedBindings = new Set<StageMaterialBinding>()
    const matchedMaterials = new Set<string>()
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
    const createdMaterials = new Set<THREE.Material>()
    const sourceMaterialsToDispose = new Set<THREE.Material>()
    const backgroundShaderMaterials = new Set<string>()
    const renderQueueMeshes = new Set<string>()
    const mixedRenderQueueMeshes = new Set<string>()
    const sourceMaterialNames = collectObjectMaterialNames(object)
    const sourceMaterialBindings = new Map(
        sourceMaterialNames.map(name => [
            name,
            bindings.find(binding => matchesMaterial(binding, name)),
        ]),
    )
    const unknownBackgroundGlobalSources = [...sourceMaterialBindings]
        .filter(([, binding]) => (
            !binding?.sourceShader
            || (
                !BACKGROUND_GLOBAL_SHADER_FAMILIES.has(binding.sourceShader)
                && !BACKGROUND_GLOBAL_PROVEN_BYPASS_FAMILIES.has(
                    binding.sourceShader,
                )
            )
        ))
        .map(([name]) => name)
    const backgroundShaderGlobalsApplied = Boolean(
        backgroundShaderGlobals
        && sourceMaterialNames.length > 0
        && unknownBackgroundGlobalSources.length === 0,
    )

    const textureBinding = (
        binding: StageMaterialBinding,
        slot: StageTextureSlot,
    ) => resolveStageTextureBinding(binding, slot, maxAnisotropy)

    const loadTexture = async (profile: StageTextureBinding) => {
        const absoluteUrl = await resolveRuntimeAssetUrl(profile.url, signal)
        // Sampler, TexEnv and UV channel are texture-instance state in Three.
        // Include the complete descriptor so one source image can safely serve
        // different Unity materials without cross-material mutation.
        const cacheKey = JSON.stringify({ absoluteUrl, ...profile })
        let promise = textureCache.get(cacheKey)
        if (!promise) {
            promise = (profile.nativeMipManifestUrl
                ? loadNativeMatcapMips(profile.nativeMipManifestUrl, profile, signal)
                : textureLoader.loadAsync(absoluteUrl)).then(texture => {
                if (signal?.aborted) {
                    texture.dispose()
                    signal.throwIfAborted()
                }
                texture.name = `StageTexture:${profile.url}`
                texture.colorSpace = profile.colorSpace === 'srgb'
                    ? THREE.SRGBColorSpace
                    : THREE.NoColorSpace
                texture.wrapS = wrappingByName[profile.wrap.u]
                texture.wrapT = wrappingByName[profile.wrap.v]
                texture.repeat.set(...profile.transform.scale)
                texture.offset.set(...profile.transform.offset)
                if (profile.coordinates.kind === 'mesh-uv') {
                    texture.channel = profile.coordinates.channel
                }
                texture.magFilter = magFilterByName[profile.filter]
                texture.minFilter = minFilterFor(profile)
                texture.generateMipmaps = !profile.nativeMipManifestUrl && profile.mipCount !== 1
                texture.anisotropy = Math.min(
                    Math.max(1, profile.anisotropy),
                    maxAnisotropy,
                )
                texture.userData.stageTextureBinding = structuredClone(profile)
                texture.updateMatrix()
                texture.needsUpdate = true
                ownedTextures.add(texture)
                return texture
            })
            textureCache.set(cacheKey, promise)
        }
        return promise
    }

    const texturePromises = bindings.flatMap(binding => [
        textureBinding(binding, 'base'),
        textureBinding(binding, 'normal'),
        textureBinding(binding, 'smoothness'),
        textureBinding(binding, 'blend'),
        textureBinding(binding, 'matCap'),
        textureBinding(binding, 'emission'),
    ]
        .filter((profile): profile is StageTextureBinding => Boolean(profile))
        .map(loadTexture)
        .concat(
            Object.values(binding.serializedTextures ?? {}).map(loadTexture),
        )
        .concat([
            binding.multiUvScroll?.textureUrl
                ? loadTexture(legacyTextureBinding(
                    binding.multiUvScroll.textureUrl,
                    'color',
                    'repeat',
                    maxAnisotropy,
                    '_ScrollTexture',
                ))
                : undefined,
            binding.flowMap?.textureUrl
                ? loadTexture(legacyTextureBinding(
                    binding.flowMap.textureUrl,
                    'data',
                    'repeat',
                    maxAnisotropy,
                    '_FlowMap',
                ))
                : undefined,
        ].filter((promise): promise is Promise<THREE.Texture> => Boolean(promise))))

    const resolveTexture = async (
        profile: StageTextureBinding | undefined,
    ) => {
        if (!profile) return undefined
        return loadTexture(profile)
    }

    interface MeshMaterialPlan {
        mesh: THREE.Mesh
        outputMaterials: THREE.Material[]
        bindings: StageMaterialBinding[]
        operations: Promise<void>[]
        usesMaterialArray: boolean
    }

    const plans: MeshMaterialPlan[] = []
    const skippedEmptyMeshPaths: string[] = []
    const retainedEmptyMaterials = new Set<THREE.Material>()
    try {
        const textureResults = await Promise.allSettled(texturePromises)
        const textureFailure = textureResults.find(
            result => result.status === 'rejected',
        )
        if (textureFailure?.status === 'rejected') throw textureFailure.reason
        signal?.throwIfAborted()

        object.traverse(child => {
            const mesh = child as THREE.Mesh
            if (!mesh.isMesh) return
            // Empty exported carriers are not draws; missing data on real meshes
            // must still reach the exact-coordinate validation below.
            if (mesh.geometry.getAttribute('position')?.count === 0) {
                const names: string[] = []
                for (let node: THREE.Object3D | null = mesh; node; node = node.parent) {
                    if (node.name || node.parent) names.unshift(node.name || '<unnamed>')
                }
                skippedEmptyMeshPaths.push('/' + names.join('/'))
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
                materials.forEach(material => retainedEmptyMaterials.add(material))
                return
            }

            const usesMaterialArray = Array.isArray(mesh.material)
            const sourceMaterials: THREE.Material[] =
                Array.isArray(mesh.material)
                    ? [...mesh.material]
                    : [mesh.material]
            const outputMaterials = [...sourceMaterials]
            const plan: MeshMaterialPlan = {
                mesh,
                outputMaterials,
                bindings: [],
                operations: [],
                usesMaterialArray,
            }

            sourceMaterials.forEach((sourceMaterial, index) => {
                const binding = bindings.find(
                    entry => matchesMaterial(entry, sourceMaterial.name),
                )
                if (!binding) return
                plan.bindings.push(binding)
                sourceMaterialsToDispose.add(sourceMaterial)

                plan.operations.push((async () => {
                    const materialBackgroundGlobals =
                        backgroundShaderGlobalsApplied
                        && binding.sourceShader
                        && BACKGROUND_GLOBAL_SHADER_FAMILIES.has(binding.sourceShader)
                            ? backgroundShaderGlobals
                            : undefined
                    const material = await createBoundMaterial(binding, mesh, {
                        baseMap: await resolveTexture(textureBinding(binding, 'base')),
                        normalMap: await resolveTexture(textureBinding(binding, 'normal')),
                        smoothnessMap: await resolveTexture(textureBinding(binding, 'smoothness')),
                        blendMap: await resolveTexture(textureBinding(binding, 'blend')),
                        matCapMap: await resolveTexture(textureBinding(binding, 'matCap')),
                        emissionMap: await resolveTexture(textureBinding(binding, 'emission')),
                        multiUvScrollMap: await resolveTexture(
                            binding.multiUvScroll?.textureUrl
                                ? legacyTextureBinding(
                                    binding.multiUvScroll.textureUrl,
                                    'color',
                                    'repeat',
                                    maxAnisotropy,
                                    '_ScrollTexture',
                                )
                                : undefined,
                        ),
                        flowMap: await resolveTexture(
                            binding.flowMap?.textureUrl
                                ? legacyTextureBinding(
                                    binding.flowMap.textureUrl,
                                    'data',
                                    'repeat',
                                    maxAnisotropy,
                                    '_FlowMap',
                                )
                                : undefined,
                        ),
                        ownedTextures,
                    }, materialBackgroundGlobals, depthRegistrar)
                    createdMaterials.add(material)
                    signal?.throwIfAborted()
                    material.name = sourceMaterial.name
                    outputMaterials[index] = material
                    matchedBindings.add(binding)
                    matchedMaterials.add(sourceMaterial.name)
                    if (materialBackgroundGlobals) {
                        backgroundShaderMaterials.add(sourceMaterial.name)
                    }
                })())
            })
            if (plan.operations.length > 0) plans.push(plan)
        })

        const materialResults = await Promise.allSettled(
            plans.flatMap(plan => plan.operations),
        )
        const materialFailure = materialResults.find(
            result => result.status === 'rejected',
        )
        if (materialFailure?.status === 'rejected') throw materialFailure.reason
        signal?.throwIfAborted()

        plans.forEach(plan => {
            plan.mesh.material = plan.usesMaterialArray
                ? plan.outputMaterials
                : plan.outputMaterials[0]
            applyDeterministicMeshShadowPolicy(plan.mesh, plan.bindings)
            const queueResult = applyDeterministicMeshRenderQueue(
                plan.mesh,
                plan.bindings,
            )
            if (queueResult === 'applied') {
                renderQueueMeshes.add(plan.mesh.name || '<unnamed mesh>')
            } else if (queueResult === 'mixed') {
                mixedRenderQueueMeshes.add(plan.mesh.name || '<unnamed mesh>')
            }
        })
        // FBXLoader may share one Texture instance across multiple materials.
        // Replacing one material must not dispose a texture that is still used
        // by an unmatched material elsewhere in the stage hierarchy.
        const retainedTextures = collectObjectMaterialTextures(object)
        sourceMaterialsToDispose.forEach(material => {
            if (retainedEmptyMaterials.has(material)) return
            disposeMaterialAndUnreferencedTextures(material, retainedTextures)
        })
    } catch (error) {
        createdMaterials.forEach(disposeMaterialAndTextures)
        ownedTextures.forEach(texture => texture.dispose())
        throw error
    }

    const unmatchedBindings = bindings
        .filter(binding => !matchedBindings.has(binding))
        .map(binding => binding.materialName ?? binding.materialPattern ?? '(unnamed)')
    const unmatchedSourceMaterials = sourceMaterialNames
        .filter(name => !matchedMaterials.has(name))

    object.userData.stageMaterialBindings = {
        skippedEmptyMeshPaths,
        matchedMaterials: [...matchedMaterials],
        unmatchedBindings,
        unmatchedSourceMaterials,
        backgroundShaderGlobalsApplied,
        backgroundShaderMaterials: [...backgroundShaderMaterials],
        unknownBackgroundGlobalSources,
        renderQueueMeshes: [...renderQueueMeshes],
        mixedRenderQueueMeshes: [...mixedRenderQueueMeshes],
    }
    if (unmatchedBindings.length > 0) {
        console.warn('Official stage material bindings did not match FBX materials:', unmatchedBindings)
    }
    console.log('Applied official stage material bindings:', object.userData.stageMaterialBindings)

    return {
        textures: [...ownedTextures],
        matchedMaterials: [...matchedMaterials],
        unmatchedBindings,
        unmatchedSourceMaterials,
        backgroundShaderGlobalsApplied,
        backgroundShaderMaterials: [...backgroundShaderMaterials],
        renderQueueMeshes: [...renderQueueMeshes],
        mixedRenderQueueMeshes: [...mixedRenderQueueMeshes],
    }
}

function effectiveUnityRenderQueue(binding: StageMaterialBinding) {
    if (binding.renderQueue != undefined && binding.renderQueue >= 0) {
        return binding.renderQueue
    }
    if (
        binding.transparent
        || binding.sourceShader === 'Creative/Effect/Particle/Common'
        || binding.sourceShader === SHADOW_ONLY_SOURCE
    ) {
        return 3000
    }
    return 2000
}

function applyDeterministicMeshRenderQueue(
    mesh: THREE.Mesh,
    bindings: StageMaterialBinding[],
): 'applied' | 'mixed' | 'absent' {
    if (bindings.length === 0) return 'absent'
    const queues = [...new Set(bindings.map(effectiveUnityRenderQueue))]
    mesh.userData.stageUnityRenderQueues = queues
    if (queues.length !== 1) {
        mesh.userData.stageUnityRenderQueueStatus = 'mixed-groups-require-split'
        console.warn(
            `Stage mesh "${mesh.name}" has mixed Unity render queues; `
            + 'preserving its groups for a later lightmap-aware split.',
        )
        return 'mixed'
    }
    const queue = queues[0]
    mesh.userData.stageUnityRenderQueueStatus = 'applied'
    mesh.userData.stageOriginalRenderOrder = mesh.renderOrder
    // Preserve room for the character foreground ordering while retaining all
    // Unity background queue deltas (2000, 2450, 2997...3000) exactly.
    mesh.renderOrder = (queue - 2000) / 1000
    return 'applied'
}

function collectObjectMaterialNames(object: THREE.Object3D) {
    const names = new Set<string>()
    object.traverse(child => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
        materials.forEach(material => names.add(material.name))
    })
    return [...names]
}

function applyDeterministicMeshShadowPolicy(
    mesh: THREE.Mesh,
    bindings: StageMaterialBinding[],
) {
    const castValues = bindings
        .map(binding => binding.castShadow)
        .filter((value): value is boolean => value != undefined)
    const receiveValues = bindings
        .map(binding => binding.receiveShadow)
        .filter((value): value is boolean => value != undefined)

    if (castValues.length > 0) {
        mesh.userData.stageCastShadow = castValues.some(Boolean)
    }
    if (receiveValues.length > 0) {
        mesh.userData.stageReceiveShadow = receiveValues.some(Boolean)
    }
    // Both compiled shader families have no ShadowCaster pass. Do not invent
    // an opaque depth caster for an otherwise transparent effect/receiver.
    // Mixed meshes retain the conservative union until their slots are split.
    if (bindings.length > 0 && bindings.every(binding =>
        binding.sourceShader === SHADOW_ONLY_SOURCE
        || binding.sourceShader === 'Creative/Effect/Particle/Common')) {
        mesh.userData.stageCastShadow = false
    }
    if (
        new Set(castValues).size > 1
        || new Set(receiveValues).size > 1
    ) {
        console.warn(
            `Stage mesh "${mesh.name}" has mixed per-material shadow flags; `
            + 'using the conservative mesh-wide union.',
        )
    }
}

function disposeMaterialAndTextures(material: THREE.Material) {
    Object.values(material).forEach(value => {
        if (value instanceof THREE.Texture) value.dispose()
    })
    material.dispose()
}

function disposeMaterialAndUnreferencedTextures(
    material: THREE.Material,
    retainedTextures: ReadonlySet<THREE.Texture>,
) {
    Object.values(material).forEach(value => {
        if (value instanceof THREE.Texture && !retainedTextures.has(value)) {
            value.dispose()
        }
    })
    material.dispose()
}

function collectObjectMaterialTextures(object: THREE.Object3D) {
    const textures = new Set<THREE.Texture>()
    object.traverse(child => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
        materials.forEach(material => {
            Object.values(material).forEach(value => {
                if (value instanceof THREE.Texture) textures.add(value)
            })
        })
    })
    return textures
}

function matchesMaterial(binding: StageMaterialBinding, materialName: string) {
    if (binding.materialName === materialName) return true
    if (!binding.materialPattern) return false
    return new RegExp(binding.materialPattern).test(materialName)
}

interface BoundTextureSet {
    baseMap?: THREE.Texture
    normalMap?: THREE.Texture
    smoothnessMap?: THREE.Texture
    blendMap?: THREE.Texture
    matCapMap?: THREE.Texture
    emissionMap?: THREE.Texture
    multiUvScrollMap?: THREE.Texture
    flowMap?: THREE.Texture
    ownedTextures: Set<THREE.Texture>
}

function requireExactTextureCoordinates(
    mesh: THREE.Mesh,
    texture: THREE.Texture | undefined,
    slot: StageTextureSlot,
) {
    const profile = texture?.userData.stageTextureBinding as StageTextureBinding | undefined
    if (!profile || profile.evidence !== 'exact-unity-texture2d') return
    if (profile.coordinates.kind !== 'mesh-uv') return
    const attribute = profile.coordinates.channel === 0
        ? 'uv'
        : `uv${profile.coordinates.channel}`
    if (!mesh.geometry.hasAttribute(attribute)) {
        throw new Error(
            `Official stage texture ${profile.sourceProperty}/${slot} requires `
            + `${attribute} on ${mesh.name || '<unnamed mesh>'}`,
        )
    }
}

/**
 * ReDriveEnemy forward pass clips the raw MainTex alpha when transparency and
 * dither clipping are both off; this branch does not need _ALPHATEST_ON.
 * JP pass3 blob86: cb4[0].w=threshold, cb4[6].w=transparency,
 * cb4[7].x=dither. The serialized shader default for missing dither is zero.
 */
export function resolveOfficialStageAlphaTest(binding: StageMaterialBinding): number {
    if (binding.alphaTest != undefined) return binding.alphaTest
    if (binding.sourceShader !== 'Creative/ReDriveEnemyUberShader') return 0
    const floats = binding.serializedFloats
    if (floats?._Transparency !== 0) return 0
    if ((floats._IsDitherClipping ?? 0) !== 0) return 0
    const threshold = floats._AlphaClippingThreshold
    return Number.isFinite(threshold) ? threshold : 0
}

async function createBoundMaterial(
    binding: StageMaterialBinding,
    mesh: THREE.Mesh,
    textures: BoundTextureSet,
    backgroundShaderGlobals?: ReDriveBackgroundShaderGlobals,
    depthRegistrar?: StageParticleDepthRegistrar,
): Promise<THREE.Material> {
    if (binding.sourceShader === SHADOW_ONLY_SOURCE) return createStageShadowOnlyMaterial(binding)
    if (binding.sourceShader === 'Creative/Effect/Particle/Common') {
        return createStageParticleSurfaceMaterial(binding, mesh, textures.ownedTextures, depthRegistrar)
    }
    requireExactTextureCoordinates(mesh, textures.baseMap, 'base')
    requireExactTextureCoordinates(mesh, textures.normalMap, 'normal')
    requireExactTextureCoordinates(mesh, textures.smoothnessMap, 'smoothness')
    requireExactTextureCoordinates(mesh, textures.blendMap, 'blend')
    requireExactTextureCoordinates(mesh, textures.matCapMap, 'matCap')
    requireExactTextureCoordinates(mesh, textures.emissionMap, 'emission')
    const side = binding.side ? sideByName[binding.side] : THREE.FrontSide
    const map = createAtlasTexture(textures.baseMap, binding.atlas, textures.ownedTextures)
    const color = Array.isArray(binding.color)
        ? new THREE.Color(binding.color[0], binding.color[1], binding.color[2])
        : new THREE.Color(binding.color ?? '#ffffff')
    const opacity = Array.isArray(binding.color) ? binding.color[3] : 1
    const emissionColor = binding.emissionColor
        ? new THREE.Color(
            binding.emissionColor[0],
            binding.emissionColor[1],
            binding.emissionColor[2],
        )
        : new THREE.Color(0, 0, 0)
    const common: THREE.MeshBasicMaterialParameters = {
        color,
        opacity,
        ...stageBlendingParameters(binding.blending),
        alphaTest: resolveOfficialStageAlphaTest(binding),
        transparent: binding.transparent ?? false,
        depthWrite: binding.depthWrite ?? true,
        side,
    }
    if (map) common.map = map

    if (binding.shading === 'unlit') {
        const material = new THREE.MeshBasicMaterial(common)
        material.alphaToCoverage = binding.alphaToCoverage ?? false
        material.userData.stageUnityMaterialState = {
            sourceShader: binding.sourceShader ?? null,
            renderQueue: binding.renderQueue ?? null,
            effectiveRenderQueue: effectiveUnityRenderQueue(binding),
            validKeywords: binding.validKeywords ?? null,
            invalidKeywords: binding.invalidKeywords ?? null,
            disabledShaderPasses: binding.disabledShaderPasses ?? null,
        }
        installAtlasAnimation(material, map, binding.atlas, mesh)
        installMultiUvScroll(
            material,
            binding.multiUvScroll,
            textures.multiUvScrollMap,
            binding.flowMap,
            textures.flowMap,
            mesh,
        )
        installOfficialUnlitMatCap(material, binding, textures.matCapMap)
        installOfficialBackgroundShaderGlobals(
            material,
            backgroundShaderGlobals,
            false,
        )
        installOfficialUnlitEmission(
            material,
            emissionColor,
            textures.emissionMap,
        )
        installOfficialFogInfluence(material, binding.fogInfluence ?? 1)
        installBaseUvScroll(material, binding, map, mesh)
        // These stage extensions alter UVs, normals and fragment lighting only.
        material.userData.stageRigidVertexPosition = true
        material.userData.stageRigidBatchBinding = JSON.stringify(binding)
        return material
    }

    const standardParameters: THREE.MeshStandardMaterialParameters = {
        ...common,
        normalScale: new THREE.Vector2(
            binding.normalScale ?? 1,
            binding.normalScale ?? 1,
        ),
        metalness: binding.metallicFromSmoothnessMap
            ? 1
            : binding.metallic ?? 0,
        roughness: textures.smoothnessMap || binding.smoothnessFromBaseAlpha
            ? 1
            : 1 - (binding.smoothness ?? 0),
        emissive: emissionColor,
        vertexColors: Boolean(binding.vertexColorBlend && mesh.geometry.hasAttribute('color')),
    }
    if (textures.normalMap) standardParameters.normalMap = textures.normalMap
    if (textures.emissionMap) standardParameters.emissiveMap = textures.emissionMap
    const material = new THREE.MeshStandardMaterial(standardParameters)
    material.alphaToCoverage = binding.alphaToCoverage ?? false
    material.userData.stageUnityMaterialState = {
        sourceShader: binding.sourceShader ?? null,
        renderQueue: binding.renderQueue ?? null,
        effectiveRenderQueue: effectiveUnityRenderQueue(binding),
        validKeywords: binding.validKeywords ?? null,
        invalidKeywords: binding.invalidKeywords ?? null,
        disabledShaderPasses: binding.disabledShaderPasses ?? null,
    }

    if (binding.vertexColorBlend && !mesh.geometry.hasAttribute('color')) {
        console.warn(`Stage material ${binding.materialName ?? binding.materialPattern} requested vertex-color blending, but its mesh has no color attribute`)
    }
    installOfficialLitExtensions(material, binding, textures)
    installAtlasAnimation(material, map, binding.atlas, mesh)
    installMultiUvScroll(
        material,
        binding.multiUvScroll,
        textures.multiUvScrollMap,
        binding.flowMap,
        textures.flowMap,
        mesh,
    )
    installOfficialBackgroundShaderGlobals(
        material,
        backgroundShaderGlobals,
        true,
    )
    installOfficialFogInfluence(material, binding.fogInfluence ?? 1)
    installBaseUvScroll(material, binding, map, mesh)
    material.userData.stageRigidVertexPosition = true
    material.userData.stageRigidBatchBinding = JSON.stringify(binding)
    return material
}

function backgroundShaderColor(value: string | readonly number[]) {
    return Array.isArray(value)
        ? new THREE.Color().setRGB(value[0], value[1], value[2])
        : new THREE.Color(value as string)
}

function installOfficialBackgroundShaderGlobals(
    material: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial,
    globals: ReDriveBackgroundShaderGlobals | undefined,
    lit: boolean,
) {
    if (!globals) return
    const previousOnBeforeCompile = material.onBeforeCompile
    const previousCacheKey = material.customProgramCacheKey.bind(material)
    const adjustments = new THREE.Vector3(...globals.colorAdjustments)
    const globalTint = backgroundShaderColor(globals.globalTint)
    const backgroundTint = backgroundShaderColor(globals.backgroundTint)
    const shadowStrength = globals.shadowStrengthAdditive
    material.userData.stageBackgroundShaderGlobals = {
        colorAdjustments: [...globals.colorAdjustments],
        globalTint: globalTint.toArray(),
        backgroundTint: backgroundTint.toArray(),
        shadowStrengthAdditive: shadowStrength,
        authority: globals.authority,
        operator:
            'official-compiled-bg-color-adjustments-and-global-tint',
    }

    material.onBeforeCompile = function (shader, renderer) {
        previousOnBeforeCompile.call(this, shader, renderer)
        shader.uniforms.uStageBgColorAdjustments = { value: adjustments }
        shader.uniforms.uStageGlobalBackgroundTint = { value: globalTint }
        shader.uniforms.uStageBackgroundTint = { value: backgroundTint }
        shader.uniforms.uStageBgShadowStrengthAdditive = {
            value: shadowStrength,
        }
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
uniform vec3 uStageBgColorAdjustments;
uniform vec3 uStageGlobalBackgroundTint;
uniform vec3 uStageBackgroundTint;
uniform float uStageBgShadowStrengthAdditive;`,
        )

        const adjustment = `float stageBgLuma = dot(
    diffuseColor.rgb,
    vec3( 0.298911989, 0.586610973, 0.114478 )
);
diffuseColor.rgb = (
    diffuseColor.rgb - vec3( 0.217600003 )
) * uStageBgColorAdjustments.x + vec3( 0.217600003 );
diffuseColor.rgb = (
    diffuseColor.rgb - vec3( stageBgLuma )
) * uStageBgColorAdjustments.y + vec3( stageBgLuma );
diffuseColor.rgb *= uStageBgColorAdjustments.z * uStageBackgroundTint;
diffuseColor.rgb = max( diffuseColor.rgb, vec3( 0.0 ) );`
        shader.fragmentShader = lit
            ? shader.fragmentShader.replace(
                '#include <lights_physical_fragment>',
                `${adjustment}
#include <lights_physical_fragment>`,
            )
            : shader.fragmentShader.replace(
                '#include <alphatest_fragment>',
                `${adjustment}
#include <alphatest_fragment>`,
            )

        if (lit) {
            // BgUber applies the recovered main-shadow attenuation once more to
            // the post-emission/unlitness colour, with the serialized additive
            // value selecting between no shadow and the native attenuation.
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <opaque_fragment>',
                `float stageBgMainShadow = 1.0;
#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
    #if defined( USE_CSM ) && defined( CSM_CASCADES )
        float stageBgLinearDepth = vViewPosition.z / ( shadowFar - cameraNear );
        #pragma unroll_loop_start
        for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
            #if ( UNROLLED_LOOP_INDEX < CSM_CASCADES )
                if (
                    stageBgLinearDepth >= CSM_cascades[ UNROLLED_LOOP_INDEX ].x
                    && stageBgLinearDepth < CSM_cascades[ UNROLLED_LOOP_INDEX ].y
                ) {
                    DirectionalLightShadow stageBgDirectionalShadow =
                        directionalLightShadows[ i ];
                    stageBgMainShadow = receiveShadow
                        ? getOfficialUrpLowMainShadow(
                        directionalShadowMap[ i ],
                        stageBgDirectionalShadow.shadowMapSize,
                        stageBgDirectionalShadow.shadowIntensity,
                        stageBgDirectionalShadow.shadowBias,
                        stageBgDirectionalShadow.shadowRadius,
                        vDirectionalShadowCoord[ i ]
                    ) : 1.0;
                }
            #endif
        }
        #pragma unroll_loop_end
        float stageBgMainShadowFarSq = shadowFar * shadowFar;
        float stageBgMainShadowFadeNear =
            pow( 1.0 - CSM_cascadeBorder, 2.0 ) * stageBgMainShadowFarSq;
        float stageBgMainShadowFade = clamp(
            ( dot( vViewPosition, vViewPosition ) - stageBgMainShadowFadeNear )
            / max(
                stageBgMainShadowFarSq - stageBgMainShadowFadeNear,
                0.000001
            ),
            0.0,
            1.0
        );
        stageBgMainShadow = mix(
            stageBgMainShadow,
            1.0,
            stageBgMainShadowFade
        );
    #else
        DirectionalLightShadow stageBgDirectionalShadow =
            directionalLightShadows[ 0 ];
        stageBgMainShadow = receiveShadow ? getShadow(
            directionalShadowMap[ 0 ],
            stageBgDirectionalShadow.shadowMapSize,
            stageBgDirectionalShadow.shadowIntensity,
            stageBgDirectionalShadow.shadowBias,
            stageBgDirectionalShadow.shadowRadius,
            vDirectionalShadowCoord[ 0 ]
        ) : 1.0;
    #endif
#endif
outgoingLight *= mix(
    1.0,
    stageBgMainShadow,
    uStageBgShadowStrengthAdditive
);
#include <opaque_fragment>`,
            )
        }
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <fog_fragment>',
            `#include <fog_fragment>
gl_FragColor.rgb *= uStageGlobalBackgroundTint;`,
        )
    }
    material.customProgramCacheKey = () => [
        previousCacheKey(),
        'official-bg-globals-v1',
        lit ? 'bg-uber' : 'bg-unlit',
        ...globals.colorAdjustments,
        globalTint.r,
        globalTint.g,
        globalTint.b,
        backgroundTint.r,
        backgroundTint.g,
        backgroundTint.b,
        shadowStrength,
    ].join(':')
    material.needsUpdate = true
}

const OFFICIAL_MATCAP_OVERLAY = `vec3 stageMatCapBase = diffuseColor.rgb;
vec3 stageMatCapSample = texture2D(
    uStageMatCapMap,
    stageMatCapViewNormal.xy * 0.5 + 0.5
).rgb;
vec3 stageMatCapLow = stageMatCapBase * stageMatCapSample;
vec3 stageMatCapHigh = vec3( 1.0 )
    - 2.0 * ( vec3( 1.0 ) - stageMatCapBase )
    * ( vec3( 1.0 ) - stageMatCapSample );
vec3 stageMatCapOverlay = mix(
    stageMatCapLow,
    stageMatCapHigh,
    step( vec3( 0.5 ), stageMatCapBase )
);
float stageMatCapMask = uStageUseSmoothnessMaskMatCap > 0.5
    ? stageMatCapSmoothnessMask
    : 1.0;
diffuseColor.rgb = mix(
    stageMatCapBase,
    stageMatCapOverlay,
    stageMatCapMask * uStageMatCapIntensity
);`

function installOfficialUnlitMatCap(
    material: THREE.MeshBasicMaterial,
    binding: StageMaterialBinding,
    matCapMap: THREE.Texture | undefined,
) {
    if (!binding.useMatCap || !matCapMap) return
    const previousOnBeforeCompile = material.onBeforeCompile
    const previousCacheKey = material.customProgramCacheKey.bind(material)
    const intensity = binding.matCapIntensity ?? 1
    const useSmoothnessMask = binding.useSmoothnessMaskMatCap ? 1 : 0
    material.userData.stageMatCap = {
        formula: 'official-overlay',
        coordinates: 'view-normal-xy',
        intensity,
        useSmoothnessMask: Boolean(useSmoothnessMask),
    }
    material.defines = {
        ...material.defines,
        STAGE_MATCAP: '',
    }
    material.onBeforeCompile = function (shader, renderer) {
        previousOnBeforeCompile.call(this, shader, renderer)
        shader.uniforms.uStageMatCapMap = { value: matCapMap }
        shader.uniforms.uStageMatCapIntensity = { value: intensity }
        shader.uniforms.uStageUseSmoothnessMaskMatCap = {
            value: useSmoothnessMask,
        }
        shader.vertexShader = shader.vertexShader
            .replace(
                '#include <common>',
                `#include <common>
varying vec3 vStageMatCapNormal;`,
            )
            .replace(
                '#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )',
                '#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING ) || defined ( STAGE_MATCAP )',
            )
            .replace(
                '#include <defaultnormal_vertex>',
                `#include <defaultnormal_vertex>
vStageMatCapNormal = normalize( transformedNormal );`,
            )
        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                `#include <common>
uniform sampler2D uStageMatCapMap;
uniform float uStageMatCapIntensity;
uniform float uStageUseSmoothnessMaskMatCap;
varying vec3 vStageMatCapNormal;`,
            )
            .replace(
                '#include <alphatest_fragment>',
                `vec3 stageMatCapViewNormal = normalize( vStageMatCapNormal );
float stageMatCapSmoothnessMask = diffuseColor.a;
${OFFICIAL_MATCAP_OVERLAY}
#include <alphatest_fragment>`,
            )
    }
    material.customProgramCacheKey = () => [
        previousCacheKey(),
        'official-bg-matcap-overlay-v1',
        intensity,
        useSmoothnessMask,
    ].join(':')
    material.needsUpdate = true
}

function installOfficialFogInfluence(
    material: THREE.Material,
    influence: number,
) {
    if (!Number.isFinite(influence)) {
        throw new Error(`Invalid stage fog influence: ${influence}`)
    }
    const previousOnBeforeCompile = material.onBeforeCompile
    const previousCacheKey = material.customProgramCacheKey.bind(material)
    material.userData.stageFogInfluence = {
        value: influence,
        formula: 'fogAmount * _FogInfluence',
        authority: 'official-compiled-bg-shader',
    }
    material.onBeforeCompile = function (shader, renderer) {
        previousOnBeforeCompile.call(this, shader, renderer)
        shader.uniforms.uStageFogInfluence = { value: influence }
        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                `#include <common>
uniform float uStageFogInfluence;`,
            )
            .replace(
                '#include <fog_fragment>',
                `#ifdef USE_FOG
    #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp(
            - fogDensity * fogDensity * vFogDepth * vFogDepth
        );
    #else
        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    fogFactor *= uStageFogInfluence;
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,
            )
    }
    material.customProgramCacheKey = () => [
        previousCacheKey(),
        'official-bg-fog-influence-v1',
        influence,
    ].join(':')
    material.needsUpdate = true
}

function installOfficialUnlitEmission(
    material: THREE.MeshBasicMaterial,
    emissionColor: THREE.Color,
    emissionMap: THREE.Texture | undefined,
) {
    material.userData.stageEmission = {
        color: emissionColor.toArray(),
        map: emissionMap?.name ?? null,
        formula: 'base + emissionMap.rgb * emissionColor.rgb',
    }
    if (
        emissionColor.r === 0
        && emissionColor.g === 0
        && emissionColor.b === 0
    ) return

    const previousOnBeforeCompile = material.onBeforeCompile
    const previousCacheKey = material.customProgramCacheKey()
    const emissionUvAttribute = emissionMap
        ? emissionMap.channel === 0
            ? 'uv'
            : `uv${emissionMap.channel}`
        : null
    if (emissionMap) emissionMap.updateMatrix()

    material.onBeforeCompile = function (shader, renderer) {
        previousOnBeforeCompile.call(this, shader, renderer)
        shader.uniforms.uStageEmissionColor = { value: emissionColor }
        if (emissionMap && emissionUvAttribute) {
            shader.uniforms.uStageEmissionMap = { value: emissionMap }
            shader.uniforms.uStageEmissionMapTransform = {
                value: emissionMap.matrix,
            }
            shader.vertexShader = shader.vertexShader
                .replace(
                    '#include <uv_pars_vertex>',
                    `#include <uv_pars_vertex>
uniform mat3 uStageEmissionMapTransform;
varying vec2 vStageEmissionMapUv;`,
                )
                .replace(
                    '#include <uv_vertex>',
                    `#include <uv_vertex>
vStageEmissionMapUv = (
    uStageEmissionMapTransform * vec3( ${emissionUvAttribute}, 1.0 )
).xy;`,
                )
        }

        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                `#include <common>
uniform vec3 uStageEmissionColor;
${emissionMap
        ? `uniform sampler2D uStageEmissionMap;
varying vec2 vStageEmissionMapUv;`
        : ''}`,
            )
            .replace(
                '#include <alphatest_fragment>',
                `${emissionMap
        ? 'diffuseColor.rgb += texture2D( uStageEmissionMap, vStageEmissionMapUv ).rgb * uStageEmissionColor;'
        : 'diffuseColor.rgb += uStageEmissionColor;'}
#include <alphatest_fragment>`,
            )
    }
    material.customProgramCacheKey = () => [
        previousCacheKey,
        'official-bg-unlit-emission',
        emissionMap ? `uv${emissionMap.channel}` : 'default-white',
        emissionColor.r,
        emissionColor.g,
        emissionColor.b,
    ].join(':')
    material.needsUpdate = true
}

function installMultiUvScroll(
    material: THREE.Material,
    profile: StageMultiUvScrollProfile | undefined,
    scrollTexture: THREE.Texture | undefined,
    flowProfile: StageFlowMapProfile | undefined,
    flowTexture: THREE.Texture | undefined,
    mesh: THREE.Object3D,
) {
    if (!profile || !scrollTexture) return

    scrollTexture.wrapS = THREE.RepeatWrapping
    scrollTexture.wrapT = THREE.RepeatWrapping
    scrollTexture.needsUpdate = true
    if (flowTexture) {
        flowTexture.wrapS = THREE.RepeatWrapping
        flowTexture.wrapT = THREE.RepeatWrapping
        flowTexture.needsUpdate = true
    }

    const firstColor = profile.first.color ?? [1, 1, 1, 1]
    const secondColor = profile.second.color ?? [1, 1, 1, 1]
    const baseCacheKey = material.customProgramCacheKey()
    const previousOnBeforeCompile = material.onBeforeCompile
    const previousOnBeforeRender = material.onBeforeRender
    let timeUniform: THREE.IUniform<number> | undefined

    material.userData.stageMultiUvScroll = {
        ...profile,
        timingMode: profile.dropFrame
            ? 'continuous-until-dropped-frame-time-is-recovered'
            : 'continuous',
    }
    material.userData.stageFlowMap = flowProfile && flowTexture
        ? {
            ...flowProfile,
            approximation: 'two-phase-directional-advection',
        }
        : null
    material.customProgramCacheKey = () =>
        `${baseCacheKey}:stage-multi-uv:${JSON.stringify(profile)}`
        + `:stage-flow:${JSON.stringify(flowProfile ?? null)}`

    material.onBeforeCompile = function (shader, renderer) {
        shader.uniforms.uStageMultiUvTexture = { value: scrollTexture }
        shader.uniforms.uStageMultiUvTime = { value: 0 }
        shader.uniforms.uStageMultiUvFirstTiling = {
            value: new THREE.Vector2(...profile.first.tiling),
        }
        shader.uniforms.uStageMultiUvFirstOffset = {
            value: new THREE.Vector2(...profile.first.offset),
        }
        shader.uniforms.uStageMultiUvFirstSpeed = {
            value: new THREE.Vector2(...profile.first.speed),
        }
        shader.uniforms.uStageMultiUvFirstColor = {
            value: new THREE.Vector4(...firstColor),
        }
        shader.uniforms.uStageMultiUvFirstOpacity = {
            value: profile.first.opacity ?? 1,
        }
        shader.uniforms.uStageMultiUvSecondTiling = {
            value: new THREE.Vector2(...profile.second.tiling),
        }
        shader.uniforms.uStageMultiUvSecondOffset = {
            value: new THREE.Vector2(...profile.second.offset),
        }
        shader.uniforms.uStageMultiUvSecondSpeed = {
            value: new THREE.Vector2(...profile.second.speed),
        }
        shader.uniforms.uStageMultiUvSecondColor = {
            value: new THREE.Vector4(...secondColor),
        }
        shader.uniforms.uStageMultiUvSecondOpacity = {
            value: profile.second.opacity ?? 1,
        }
        shader.uniforms.uStageMultiUvAdditiveToMultiply = {
            value: profile.additiveToMultiply,
        }
        shader.uniforms.uStageFlowMap = { value: flowTexture ?? scrollTexture }
        shader.uniforms.uStageFlowEnabled = {
            value: flowProfile && flowTexture ? 1 : 0,
        }
        shader.uniforms.uStageFlowSpeed = { value: flowProfile?.speed ?? 0 }
        shader.uniforms.uStageFlowPower = { value: flowProfile?.power ?? 1 }
        timeUniform = shader.uniforms.uStageMultiUvTime as THREE.IUniform<number>

        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <map_pars_fragment>',
                `#include <map_pars_fragment>
uniform sampler2D uStageMultiUvTexture;
uniform float uStageMultiUvTime;
uniform vec2 uStageMultiUvFirstTiling;
uniform vec2 uStageMultiUvFirstOffset;
uniform vec2 uStageMultiUvFirstSpeed;
uniform vec4 uStageMultiUvFirstColor;
uniform float uStageMultiUvFirstOpacity;
uniform vec2 uStageMultiUvSecondTiling;
uniform vec2 uStageMultiUvSecondOffset;
uniform vec2 uStageMultiUvSecondSpeed;
uniform vec4 uStageMultiUvSecondColor;
uniform float uStageMultiUvSecondOpacity;
uniform float uStageMultiUvAdditiveToMultiply;
uniform sampler2D uStageFlowMap;
uniform float uStageFlowEnabled;
uniform float uStageFlowSpeed;
uniform float uStageFlowPower;`,
            )
            .replace(
                '#include <map_fragment>',
                `#include <map_fragment>
#ifdef USE_MAP
    vec2 rdStageFlowDirection =
        (texture2D(uStageFlowMap, vMapUv).rg * 2.0 - 1.0) *
        uStageFlowPower * uStageFlowEnabled;
    float rdStageFlowPhase0 = fract(uStageMultiUvTime * uStageFlowSpeed);
    float rdStageFlowPhase1 = fract(
        uStageMultiUvTime * uStageFlowSpeed + 0.5
    );
    float rdStageFlowBlend = abs(rdStageFlowPhase0 * 2.0 - 1.0);
    vec2 rdStageUv1Base =
        vMapUv * uStageMultiUvFirstTiling +
        uStageMultiUvFirstOffset +
        uStageMultiUvFirstSpeed * uStageMultiUvTime;
    vec2 rdStageUv2Base =
        vMapUv * uStageMultiUvSecondTiling +
        uStageMultiUvSecondOffset +
        uStageMultiUvSecondSpeed * uStageMultiUvTime;
    vec4 rdStageScroll1 = mix(
        texture2D(
            uStageMultiUvTexture,
            rdStageUv1Base - rdStageFlowDirection * rdStageFlowPhase0
        ),
        texture2D(
            uStageMultiUvTexture,
            rdStageUv1Base - rdStageFlowDirection * rdStageFlowPhase1
        ),
        rdStageFlowBlend * uStageFlowEnabled
    ) * uStageMultiUvFirstColor;
    vec4 rdStageScroll2 = mix(
        texture2D(
            uStageMultiUvTexture,
            rdStageUv2Base - rdStageFlowDirection * rdStageFlowPhase0
        ),
        texture2D(
            uStageMultiUvTexture,
            rdStageUv2Base - rdStageFlowDirection * rdStageFlowPhase1
        ),
        rdStageFlowBlend * uStageFlowEnabled
    ) * uStageMultiUvSecondColor;
    float rdStageAlpha1 = saturate(
        rdStageScroll1.a * uStageMultiUvFirstOpacity
    );
    float rdStageAlpha2 = saturate(
        rdStageScroll2.a * uStageMultiUvSecondOpacity
    );

    // Texture inputs, ST, colors, opacities, speeds and flow parameters are
    // exact serialized JP Material values. The two-phase flow advection and
    // final additive/multiply interpolation remain explicit Web
    // approximations until the compiled background subprogram is decoded.
    vec3 rdStageAdditive = diffuseColor.rgb +
        rdStageScroll1.rgb * rdStageAlpha1 +
        rdStageScroll2.rgb * rdStageAlpha2;
    vec3 rdStageMultiply = diffuseColor.rgb *
        mix(vec3(1.0), rdStageScroll1.rgb, rdStageAlpha1) *
        mix(vec3(1.0), rdStageScroll2.rgb, rdStageAlpha2);
    diffuseColor.rgb = mix(
        rdStageAdditive,
        rdStageMultiply,
        saturate(uStageMultiUvAdditiveToMultiply)
    );
#endif`,
            )

        previousOnBeforeCompile.call(this, shader, renderer)
    }

    material.onBeforeRender = function (
        renderer,
        scene,
        camera,
        geometry,
        object,
        group,
    ) {
        previousOnBeforeRender.call(
            this,
            renderer,
            scene,
            camera,
            geometry,
            object,
            group,
        )
        if (timeUniform) {
            timeUniform.value =
                findStageRuntimeTime(mesh) ?? performance.now() * 0.001
        }
    }
}

function resolveStageBaseUvScroll(
    binding: StageMaterialBinding,
): [number, number] | undefined {
    if (binding.multiUvScroll || binding.flowMap) return undefined
    const serialized = binding.serializedColors?._UV_Scroll
    if (!serialized) return undefined
    const speed: [number, number] = [serialized[0], serialized[1]]
    if (!speed.every(Number.isFinite)) return undefined
    if (speed[0] === 0 && speed[1] === 0) return undefined
    return speed
}

function installBaseUvScroll(
    material: THREE.Material,
    binding: StageMaterialBinding,
    baseMap: THREE.Texture | undefined,
    mesh: THREE.Object3D,
) {
    const scroll = resolveStageBaseUvScroll(binding)
    if (!baseMap || !scroll) return

    const baseCacheKey = material.customProgramCacheKey()
    const previousOnBeforeCompile = material.onBeforeCompile
    const previousMeshOnBeforeRender = mesh.onBeforeRender
    let timeUniform: THREE.IUniform<number> | undefined

    material.userData.stageBaseUvScroll = {
        sourceProperty: '_UV_Scroll',
        speed: [...scroll],
        formula: 'transformedUv + timeY * scroll.xy',
        synchronizedSlots: ['BaseMap', 'NormalMap'],
    }
    material.customProgramCacheKey = () =>
        `${baseCacheKey}:stage-base-uv-scroll:${scroll.join(',')}`

    material.onBeforeCompile = function (shader, renderer) {
        shader.uniforms.uStageBaseUvScroll = {
            value: new THREE.Vector2(...scroll),
        }
        shader.uniforms.uStageBaseUvTime = { value: 0 }
        timeUniform = shader.uniforms.uStageBaseUvTime as THREE.IUniform<number>
        shader.vertexShader = shader.vertexShader
            .replace(
                '#include <uv_pars_vertex>',
                `#include <uv_pars_vertex>
uniform vec2 uStageBaseUvScroll;
uniform float uStageBaseUvTime;`,
            )
            .replace(
                '#include <uv_vertex>',
                `#include <uv_vertex>
#ifdef USE_MAP
    vMapUv += uStageBaseUvScroll * uStageBaseUvTime;
#endif
#ifdef USE_NORMALMAP
    vNormalMapUv += uStageBaseUvScroll * uStageBaseUvTime;
#endif`,
            )
        previousOnBeforeCompile.call(this, shader, renderer)
    }

    mesh.onBeforeRender = function (
        renderer,
        scene,
        camera,
        geometry,
        renderMaterial,
        group,
    ) {
        previousMeshOnBeforeRender.call(
            this,
            renderer,
            scene,
            camera,
            geometry,
            renderMaterial,
            group,
        )
        if (timeUniform) {
            timeUniform.value =
                findStageRuntimeTime(mesh) ?? performance.now() * 0.001
        }
    }
    material.needsUpdate = true
}

function createAtlasTexture(
    source: THREE.Texture | undefined,
    atlas: StageAtlasProfile | undefined,
    ownedTextures: Set<THREE.Texture>,
) {
    if (!source || !atlas) return source
    const texture = source.clone()
    texture.name = `${source.name}:atlas`
    texture.userData.stageAtlasSourceTransform = {
        scale: [source.repeat.x, source.repeat.y],
        offset: [source.offset.x, source.offset.y],
    }
    setAtlasFrame(texture, atlas, atlas.offset ?? 0)
    texture.needsUpdate = true
    ownedTextures.add(texture)
    return texture
}

function installAtlasAnimation(
    material: THREE.Material,
    map: THREE.Texture | undefined,
    atlas: StageAtlasProfile | undefined,
    mesh: THREE.Object3D,
) {
    if (!map || !atlas) return
    const frameCount = Math.max(1, atlas.columns * atlas.rows)
    const frameOffset = atlas.offset ?? 0
    const framesPerSecond = atlas.framesPerSecond ?? 0
    material.userData.stageAtlas = { ...atlas }
    material.onBeforeRender = () => {
        const runtimeTime = findStageRuntimeTime(mesh)
        const elapsedFrame = framesPerSecond > 0
            ? Math.floor(
                (runtimeTime ?? performance.now() * 0.001)
                * framesPerSecond,
            )
            : 0
        setAtlasFrame(map, atlas, (frameOffset + elapsedFrame) % frameCount)
    }
}

function findStageRuntimeTime(object: THREE.Object3D) {
    let current: THREE.Object3D | null = object
    while (current) {
        const value = current.userData.stageRuntimeTime
        if (typeof value === 'number' && Number.isFinite(value)) return value
        current = current.parent
    }
    return undefined
}

export function composeStageAtlasTransform(
    source: { scale: [number, number]; offset: [number, number] },
    atlas: StageAtlasProfile,
    frame: number,
) {
    if (
        !Number.isInteger(atlas.columns)
        || !Number.isInteger(atlas.rows)
        || atlas.columns < 1
        || atlas.rows < 1
    ) {
        throw new Error(`Invalid stage atlas grid: ${atlas.columns}x${atlas.rows}`)
    }
    const normalizedFrame = ((frame % (atlas.columns * atlas.rows)) + atlas.columns * atlas.rows)
        % (atlas.columns * atlas.rows)
    const column = normalizedFrame % atlas.columns
    const row = Math.floor(normalizedFrame / atlas.columns)
    return {
        scale: [
            source.scale[0] / atlas.columns,
            source.scale[1] / atlas.rows,
        ] as [number, number],
        offset: [
            (source.offset[0] + column) / atlas.columns,
            (source.offset[1] + atlas.rows - row - 1) / atlas.rows,
        ] as [number, number],
    }
}

function setAtlasFrame(texture: THREE.Texture, atlas: StageAtlasProfile, frame: number) {
    const source = texture.userData.stageAtlasSourceTransform as {
        scale: [number, number]
        offset: [number, number]
    } | undefined
    const transform = composeStageAtlasTransform(
        source ?? { scale: [1, 1], offset: [0, 0] },
        atlas,
        frame,
    )
    texture.repeat.set(...transform.scale)
    texture.offset.set(...transform.offset)
    texture.updateMatrix()
}

function installOfficialLitExtensions(
    material: THREE.MeshStandardMaterial,
    binding: StageMaterialBinding,
    textures: BoundTextureSet,
) {
    const blendMap = binding.vertexColorBlend ? textures.blendMap : undefined
    const smoothnessMap = textures.smoothnessMap
    const smoothnessFromBaseAlpha = Boolean(binding.smoothnessFromBaseAlpha)
    const matCapMap = (binding.useMatCap ?? Boolean(textures.matCapMap))
        ? textures.matCapMap
        : undefined
    const smoothness = binding.smoothness ?? 1
    const smoothnessChannel = binding.smoothnessChannel ?? 'r'
    const unlitness = binding.unlitness ?? 0
    material.userData.stageBlendMap = blendMap
    material.userData.stageSmoothnessMap = smoothnessMap
    material.userData.stageSmoothness = smoothness
    material.userData.stageSmoothnessFromBaseAlpha = smoothnessFromBaseAlpha
    material.userData.stageNormalPacking = binding.normalPacking ?? null
    material.userData.stageMatCapMap = matCapMap
    material.userData.stageEmission = {
        color: material.emissive.toArray(),
        map: material.emissiveMap?.name ?? null,
        formula: 'lit + emissionMap.rgb * emissionColor.rgb',
    }
    // This must be present before program parameter collection so Three emits
    // USE_ROUGHNESSMAP and vRoughnessMapUv for our smoothness interpretation.
    if (smoothnessMap) material.roughnessMap = smoothnessMap
    if (smoothnessMap && binding.metallicFromSmoothnessMap) {
        material.metalnessMap = smoothnessMap
    }

    material.onBeforeCompile = shader => {
        // Three's inverse-square/range falloff already matches URP 14's
        // DistanceAttenuation. Its spot edge uses smoothstep, however, while
        // URP squares a saturated linear cone interpolation. Replace only that
        // operator for official lit stage materials.
        shader.fragmentShader = installUrpSpotAttenuation(shader.fragmentShader)
        if (
            binding.sourceShader
            && BACKGROUND_GLOBAL_SHADER_FAMILIES.has(binding.sourceShader)
        ) {
            shader.fragmentShader = suppressUnusedUnitySphericalHarmonics(
                shader.fragmentShader,
            )
            material.userData.stageUsesSphericalHarmonics = false
        }
        if (textures.normalMap && binding.normalPacking === 'unity-dxt5nm-ag') {
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <normal_fragment_maps>',
                `#ifdef USE_NORMALMAP_TANGENTSPACE
    vec4 stagePackedNormal = texture2D( normalMap, vNormalMapUv );
    vec2 stageNormalXY = stagePackedNormal.ag * 2.0 - 1.0;
    float stageNormalZ = sqrt( max(
        1.0 - dot( stageNormalXY, stageNormalXY ),
        1.0e-16
    ) );
    vec3 mapN = vec3( stageNormalXY * normalScale, stageNormalZ );
    normal = normalize( tbn * mapN );
#else
    #include <normal_fragment_maps>
#endif`,
            )
        }
        if (blendMap) {
            blendMap.updateMatrix()
            shader.uniforms.uStageBlendMap = { value: blendMap }
            shader.uniforms.uStageBlendMapTransform = { value: blendMap.matrix }
            const blendUvAttribute = blendMap.channel === 0
                ? 'uv'
                : `uv${blendMap.channel}`
            shader.vertexShader = shader.vertexShader
                .replace(
                    '#include <uv_pars_vertex>',
                    `#include <uv_pars_vertex>
uniform mat3 uStageBlendMapTransform;
varying vec2 vStageBlendMapUv;
varying float vStageRawBlendWeight;`,
                )
                .replace(
                    '#include <uv_vertex>',
                    `#include <uv_vertex>
vStageBlendMapUv = (
    uStageBlendMapTransform * vec3( ${blendUvAttribute}, 1.0 )
).xy;
// FBXLoader converts each vertex colour from sRGB to linear. Native BgUber
// interpolates the raw numeric red weight, so undo that conversion BEFORE
// interpolation, not on the fragment's already interpolated vColor.
#ifdef USE_COLOR
    float stageBlendWeightLinear = clamp( color.r, 0.0, 1.0 );
    vStageRawBlendWeight = stageBlendWeightLinear <= 0.0031308
        ? stageBlendWeightLinear * 12.92
        : 1.055 * pow( stageBlendWeightLinear, 1.0 / 2.4 ) - 0.055;
#else
    vStageRawBlendWeight = 0.0;
#endif`,
                )
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <map_pars_fragment>',
                    `#include <map_pars_fragment>
uniform sampler2D uStageBlendMap;
varying vec2 vStageBlendMapUv;
varying float vStageRawBlendWeight;`,
                )
                .replace(
                    '#include <color_fragment>',
                    '// Stage vertex color is reserved for official texture blending.',
                )
                .replace(
                    '#include <map_fragment>',
                    `#ifdef USE_MAP
    vec4 sampledDiffuseColor = texture2D( map, vMapUv );
    #ifdef DECODE_VIDEO_TEXTURE
        sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
    #endif
    diffuseColor *= sampledDiffuseColor;
#endif
#ifdef USE_COLOR
    vec4 stageBlendColor = texture2D( uStageBlendMap, vStageBlendMapUv );
    float stageBlendWeight = vStageRawBlendWeight;
    vec4 stageBlendDiffuse = stageBlendColor * vec4( diffuse, opacity );
    diffuseColor = mix(
        diffuseColor,
        stageBlendDiffuse,
        clamp( stageBlendWeight, 0.0, 1.0 )
    );
#endif`,
                )
        }

        if (smoothnessMap) {
            shader.uniforms.uStageSmoothnessMap = { value: smoothnessMap }
            shader.uniforms.uStageSmoothness = { value: smoothness }
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <roughnessmap_pars_fragment>',
                    `#include <roughnessmap_pars_fragment>
uniform sampler2D uStageSmoothnessMap;
uniform float uStageSmoothness;`,
                )
                .replace(
                    '#include <roughnessmap_fragment>',
                    `float stageSmoothness = texture2D( uStageSmoothnessMap, vRoughnessMapUv ).${smoothnessChannel} * uStageSmoothness;
float roughnessFactor = clamp( 1.0 - stageSmoothness, 0.04, 1.0 );`,
                )
            if (binding.metallicFromSmoothnessMap) {
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <metalnessmap_fragment>',
                    `float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
    metalnessFactor *= texture2D( metalnessMap, vMetalnessMapUv ).r;
#endif`,
                )
            }
        } else if (smoothnessFromBaseAlpha) {
            shader.uniforms.uStageSmoothness = { value: smoothness }
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <roughnessmap_pars_fragment>',
                    `#include <roughnessmap_pars_fragment>
uniform float uStageSmoothness;`,
                )
                .replace(
                    '#include <roughnessmap_fragment>',
                    `float stageSmoothness = diffuseColor.a * uStageSmoothness;
float roughnessFactor = clamp( 1.0 - stageSmoothness, 0.04, 1.0 );`,
                )
        }

        if (matCapMap) {
            shader.uniforms.uStageMatCapMap = { value: matCapMap }
            shader.uniforms.uStageMatCapIntensity = {
                value: binding.matCapIntensity ?? 1,
            }
            shader.uniforms.uStageUseSmoothnessMaskMatCap = {
                value: binding.useSmoothnessMaskMatCap ? 1 : 0,
            }
            const smoothnessMask = smoothnessMap
                ? `texture2D(
    uStageSmoothnessMap,
    vRoughnessMapUv
).${smoothnessChannel}`
                : smoothnessFromBaseAlpha
                    ? 'diffuseColor.a'
                    : '1.0'
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <common>',
                    `#include <common>
uniform sampler2D uStageMatCapMap;
uniform float uStageMatCapIntensity;
uniform float uStageUseSmoothnessMaskMatCap;`,
                )
                .replace(
                    '#include <lights_physical_fragment>',
                    `vec3 stageMatCapViewNormal = normal;
float stageMatCapSmoothnessMask = ${smoothnessMask};
${OFFICIAL_MATCAP_OVERLAY}
#include <lights_physical_fragment>`,
                )
        }

        if (unlitness > 0) {
            shader.uniforms.uStageUnlitness = { value: unlitness }
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <opaque_fragment>',
                    `outgoingLight = mix(
    outgoingLight - totalEmissiveRadiance,
    diffuseColor.rgb,
    uStageUnlitness
) + totalEmissiveRadiance;
#include <opaque_fragment>`,
                )
                .replace(
                    '#include <common>',
                    `#include <common>
uniform float uStageUnlitness;`,
                )
        }
    }
    material.customProgramCacheKey = () => [
        'official-stage-material-v2',
        'urp14-distance-and-spot-attenuation',
        blendMap ? `vertex-blend-raw-before-interpolation-v3-uv${blendMap.channel}` : 'single-map',
        smoothnessMap
            ? `smoothness-inversion-uv${smoothnessMap.channel}-${smoothnessChannel}`
            : smoothnessFromBaseAlpha
                ? 'smoothness-base-alpha'
                : 'constant-roughness',
        binding.metallicFromSmoothnessMap ? 'metallic-red' : 'metallic-constant',
        binding.normalPacking ?? 'normal-rgb',
        matCapMap
            ? `matcap-overlay-${binding.matCapIntensity ?? 1}-${binding.useSmoothnessMaskMatCap ? 1 : 0}`
            : 'no-matcap',
        unlitness > 0 ? `unlit-mix-${unlitness}` : 'fully-lit',
    ].join(':')
    material.needsUpdate = true
}
