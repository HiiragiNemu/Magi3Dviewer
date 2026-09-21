import * as THREE from 'three'
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js'
import { UNITY_TO_THREE_DIFFUSE_IRRADIANCE } from './unityLighting'
import { resolveRuntimeAssetUrl } from './runtimeProductDelivery'
import { loadNativeLightmapMips } from './stageNativeLightmapMips'

export const UNITY_LIGHTMAP_RGBM_EXPONENT = 2.2
export const UNITY_LIGHTMAP_RGBM_MULTIPLIER = 34.4932404

export type StageLightmapEncoding =
    | 'unity-rgbm-linear'
    | 'unity-bc6h-linear'

export type StageLightmapScaleOffset = readonly [
    scaleX: number,
    scaleY: number,
    offsetX: number,
    offsetY: number,
]

export interface StageLightmapBinding {
    rendererHierarchyPath: string
    lightmapScaleOffset: StageLightmapScaleOffset
    lightmapIndex?: number
}

export interface StageLightmapMatch {
    binding: StageLightmapBinding
    mesh: THREE.Mesh
    rendererHierarchyPath: string
}

export interface StageLightmapMatchResult {
    matches: StageLightmapMatch[]
    unmatchedBindingPaths: string[]
    ambiguousBindingPaths: string[]
}

export interface ApplyStageLightmapsOptions {
    intensity?: number
    strict?: boolean
    directionalLightmaps?: readonly THREE.Texture[]
    encoding?: StageLightmapEncoding
}

export interface StageLightmapApplication extends StageLightmapMatchResult {
    matchedRendererCount: number
    missingSecondUvPaths: string[]
    unsupportedMaterialPaths: string[]
    missingLightmapPaths: string[]
    missingDirectionalLightmapPaths: string[]
    dispose: () => void
}

/**
 * True when every lightmap binding that resolved to the currently loaded FBX
 * can execute. Unmatched serialized bindings can belong to prefab/dependency
 * renderers that are not instantiated by that FBX and remain diagnostic.
 */
export function hasCompleteActiveStageLightmapCoverage(
    application: StageLightmapApplication | undefined,
) {
    return application != undefined
        && application.matchedRendererCount > 0
        && application.ambiguousBindingPaths.length === 0
        && application.missingSecondUvPaths.length === 0
        && application.unsupportedMaterialPaths.length === 0
        && application.missingLightmapPaths.length === 0
        && application.missingDirectionalLightmapPaths.length === 0
}

interface StageShader {
    uniforms: Record<string, { value: unknown }>
    vertexShader: string
    fragmentShader: string
}

type LightMappedMaterial = THREE.Material & {
    lightMap: THREE.Texture | null
    lightMapIntensity: number
}

interface InstalledMaterial {
    mesh: THREE.Mesh
    original: THREE.Material | THREE.Material[]
    installed: THREE.Material | THREE.Material[]
}

const LIGHTMAP_IRRADIANCE_SOURCE =
    'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;'
const LIGHTMAP_IRRADIANCE_RGBM =
    `vec3 lightMapIrradiance = lightMapTexel.rgb`
    + ` * pow( lightMapTexel.a, ${UNITY_LIGHTMAP_RGBM_EXPONENT.toFixed(1)} )`
    + ` * ${UNITY_LIGHTMAP_RGBM_MULTIPLIER}`
    + ` * ${UNITY_TO_THREE_DIFFUSE_IRRADIANCE}`
    + ' * lightMapIntensity;'
const LIGHTMAP_IRRADIANCE_BC6H =
    `vec3 lightMapIrradiance = lightMapTexel.rgb`
    + ` * ${UNITY_TO_THREE_DIFFUSE_IRRADIANCE}`
    + ' * lightMapIntensity;'
const LIGHTMAP_DIRECTIONAL_SUFFIX = `
vec4 stageDirection = texture2D( uStageLightmapDirection, vLightMapUv );
vec3 stageDirectionVector = stageDirection.xyz - vec3( 0.5 );
stageDirectionVector.x = -stageDirectionVector.x;
float stageHalfLambert = dot(
    inverseTransformDirection( normal, viewMatrix ),
    stageDirectionVector
) + 0.5;
lightMapIrradiance *= stageHalfLambert / max( 1e-4, stageDirection.w );`
/**
 * Configures a Unity baked-lighting or directionality texture for Three r182.
 * Channel 1 is Three's `uv1` attribute (the second UV set).
 */
export function configureUnityRgbmLightmap(texture: THREE.Texture) {
    texture.channel = 1
    texture.colorSpace = THREE.NoColorSpace
    texture.flipY = false
    texture.needsUpdate = true
    return texture
}

interface ParsedDdsMipmap {
    data: Uint8Array
    width: number
    height: number
}

interface ParsedDdsTexture2D {
    width: number
    height: number
    isCubemap: boolean
    mipmapCount: number
    mipmaps: ParsedDdsMipmap[]
    format: number
}

export function configureUnityBc6hLightmap(texture: THREE.Texture) {
    return configureUnityRgbmLightmap(texture)
}

export function parseUnityBc6hLightmap(buffer: ArrayBuffer) {
    const parsed = new DDSLoader().parse(buffer, true) as ParsedDdsTexture2D
    if (
        parsed.isCubemap
        || parsed.format !== THREE.RGB_BPTC_UNSIGNED_Format
        || parsed.mipmapCount < 1
        || parsed.mipmaps.length !== parsed.mipmapCount
    ) {
        throw new Error('Stage lightmap is not a complete BC6H_UF16 Texture2D')
    }
    const texture = new THREE.CompressedTexture(
        parsed.mipmaps,
        parsed.width,
        parsed.height,
        THREE.RGB_BPTC_UNSIGNED_Format,
        THREE.UnsignedByteType,
    )
    texture.name = 'UnityBC6HLightmap'
    texture.generateMipmaps = false
    texture.minFilter = parsed.mipmapCount > 1
        ? THREE.LinearMipmapLinearFilter
        : THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.userData.stageLightmap = {
        encoding: 'unity-bc6h-linear',
        width: parsed.width,
        height: parsed.height,
        mipmapCount: parsed.mipmapCount,
    }
    return configureUnityBc6hLightmap(texture)
}

export async function loadStageLightmap(
    url: string,
    encoding: StageLightmapEncoding,
    renderer: THREE.WebGLRenderer,
    signal: AbortSignal,
) {
    if (/\.native-mips\.json(?:[?#]|$)/i.test(url)) {
        if (encoding !== 'unity-rgbm-linear') {
            throw new Error('Native RGBA8 mip manifest requires unity-rgbm-linear')
        }
        return loadNativeLightmapMips(url, renderer, signal)
    }
    if (encoding === 'unity-bc6h-linear') {
        if (!renderer.extensions.has('EXT_texture_compression_bptc')) {
            throw new Error('This GPU does not expose EXT_texture_compression_bptc')
        }
        const response = await fetch(await resolveRuntimeAssetUrl(url, signal), {
            cache: 'no-cache',
            signal,
        })
        if (!response.ok) {
            throw new Error(`Could not load BC6H stage lightmap: ${response.status}`)
        }
        const texture = parseUnityBc6hLightmap(await response.arrayBuffer())
        signal.throwIfAborted()
        return texture
    }

    const texture = await new THREE.TextureLoader().loadAsync(
        await resolveRuntimeAssetUrl(url, signal),
    )
    if (signal.aborted) {
        texture.dispose()
        signal.throwIfAborted()
    }
    return configureUnityRgbmLightmap(texture)
}

export function getStageHierarchyPath(
    object: THREE.Object3D,
    root?: THREE.Object3D,
) {
    const parts: string[] = []
    let current: THREE.Object3D | null = object
    while (current) {
        // FBXLoader keeps the unsanitized Unity/FBX name in userData.
        const originalName = current.userData.originalName
        // Keep the caller-selected runtime carrier prefix for UV1 required paths.
        const name = current !== root
            && typeof originalName === 'string' && originalName.length > 0
            ? originalName
            : current.name
        if (name) parts.unshift(name)
        if (current === root) break
        current = current.parent
    }
    return normalizeHierarchyPath(parts.join('/'))
}

/**
 * Matches unique renderer hierarchy paths. Either the scene path or the
 * serialized Unity path may contain an extra wrapper prefix.
 */
export function matchStageLightmapBindings(
    root: THREE.Object3D,
    bindings: readonly StageLightmapBinding[],
): StageLightmapMatchResult {
    const meshes: Array<{ mesh: THREE.Mesh, path: string }> = []
    root.traverse(object => {
        if (isMesh(object)) {
            meshes.push({
                mesh: object,
                path: getStageHierarchyPath(object, root),
            })
        }
    })

    const matches: StageLightmapMatch[] = []
    const unmatchedBindingPaths: string[] = []
    const ambiguousBindingPaths: string[] = []
    const claimedMeshes = new Set<THREE.Mesh>()

    const orderedBindings = [...bindings].sort((left, right) =>
        pathDepth(right.rendererHierarchyPath)
        - pathDepth(left.rendererHierarchyPath),
    )

    for (const binding of orderedBindings) {
        const bindingPath = normalizeHierarchyPath(binding.rendererHierarchyPath)
        let bestScore = -1
        let candidates: Array<{ mesh: THREE.Mesh, path: string }> = []

        for (const candidate of meshes) {
            if (claimedMeshes.has(candidate.mesh)) continue
            const score = hierarchySuffixScore(candidate.path, bindingPath)
            if (score > bestScore) {
                bestScore = score
                candidates = score >= 0 ? [candidate] : []
            } else if (score >= 0 && score === bestScore) {
                candidates.push(candidate)
            }
        }

        if (candidates.length === 0) {
            unmatchedBindingPaths.push(binding.rendererHierarchyPath)
        } else if (candidates.length > 1) {
            ambiguousBindingPaths.push(binding.rendererHierarchyPath)
        } else {
            const candidate = candidates[0]
            claimedMeshes.add(candidate.mesh)
            matches.push({
                binding,
                mesh: candidate.mesh,
                rendererHierarchyPath: candidate.path,
            })
        }
    }

    return {
        matches,
        unmatchedBindingPaths,
        ambiguousBindingPaths,
    }
}

/**
 * Clones each matched renderer's material, installs per-renderer lightmap ST,
 * Unity linear RGBM decoding and optional directional-lightmap evaluation, then
 * returns an idempotent rollback. Shared textures are not disposed by rollback.
 */
export function applyStageLightmaps(
    root: THREE.Object3D,
    lightmap: THREE.Texture | readonly THREE.Texture[],
    bindings: readonly StageLightmapBinding[],
    options: ApplyStageLightmapsOptions = {},
): StageLightmapApplication {
    const result = matchStageLightmapBindings(root, bindings)
    const missingSecondUvPaths: string[] = []
    const unsupportedMaterialPaths: string[] = []
    const missingLightmapPaths: string[] = []
    const missingDirectionalLightmapPaths: string[] = []
    const applicableMatches: StageLightmapMatch[] = []
    const lightmaps = Array.isArray(lightmap) ? lightmap : [lightmap]
    const directionalLightmaps = options.directionalLightmaps ?? []
    const encoding = options.encoding ?? 'unity-rgbm-linear'

    for (const match of result.matches) {
        if (!match.mesh.geometry.getAttribute('uv1')) {
            missingSecondUvPaths.push(match.rendererHierarchyPath)
            continue
        }
        const materials = Array.isArray(match.mesh.material)
            ? match.mesh.material
            : [match.mesh.material]
        if (materials.some(material => !isLightMappedMaterial(material))) {
            unsupportedMaterialPaths.push(match.rendererHierarchyPath)
            continue
        }
        const lightmapIndex = match.binding.lightmapIndex ?? 0
        if (!lightmaps[lightmapIndex]) {
            missingLightmapPaths.push(match.rendererHierarchyPath)
            continue
        }
        if (
            directionalLightmaps.length > 0
            && !directionalLightmaps[lightmapIndex]
        ) {
            missingDirectionalLightmapPaths.push(match.rendererHierarchyPath)
            continue
        }
        applicableMatches.push(match)
    }

    if (options.strict && (
        result.unmatchedBindingPaths.length > 0
        || result.ambiguousBindingPaths.length > 0
        || missingSecondUvPaths.length > 0
        || unsupportedMaterialPaths.length > 0
        || missingLightmapPaths.length > 0
        || missingDirectionalLightmapPaths.length > 0
    )) {
        throw new Error(formatStrictFailure(
            result,
            missingSecondUvPaths,
            unsupportedMaterialPaths,
            missingLightmapPaths,
            missingDirectionalLightmapPaths,
        ))
    }

    lightmaps.forEach(
        encoding === 'unity-bc6h-linear'
            ? configureUnityBc6hLightmap
            : configureUnityRgbmLightmap,
    )
    directionalLightmaps.forEach(configureUnityRgbmLightmap)
    const intensity = options.intensity ?? 1
    const installations: InstalledMaterial[] = []
    const clones = new Set<THREE.Material>()

    for (const match of applicableMatches) {
        const original = match.mesh.material
        const rendererLightmap = lightmaps[match.binding.lightmapIndex ?? 0]
        const rendererDirectionalLightmap = directionalLightmaps[
            match.binding.lightmapIndex ?? 0
        ]
        const installed = Array.isArray(original)
            ? original.map(material => installUnityLightmapMaterial(
                material as LightMappedMaterial,
                rendererLightmap,
                match.binding.lightmapScaleOffset,
                intensity,
                rendererDirectionalLightmap,
                encoding,
            ))
            : installUnityLightmapMaterial(
                original as LightMappedMaterial,
                rendererLightmap,
                match.binding.lightmapScaleOffset,
                intensity,
                rendererDirectionalLightmap,
                encoding,
            )
        const installedMaterials = Array.isArray(installed) ? installed : [installed]
        installedMaterials.forEach(material => clones.add(material))
        match.mesh.material = installed
        installations.push({ mesh: match.mesh, original, installed })
    }

    let disposed = false
    return {
        ...result,
        matchedRendererCount: installations.length,
        missingSecondUvPaths,
        unsupportedMaterialPaths,
        missingLightmapPaths,
        missingDirectionalLightmapPaths,
        dispose: () => {
            if (disposed) return
            disposed = true
            for (const installation of installations) {
                if (installation.mesh.material === installation.installed) {
                    installation.mesh.material = installation.original
                }
            }
            clones.forEach(material => material.dispose())
        },
    }
}

function installUnityLightmapMaterial(
    source: LightMappedMaterial,
    lightmap: THREE.Texture,
    scaleOffset: StageLightmapScaleOffset,
    intensity: number,
    directionalLightmap?: THREE.Texture,
    encoding: StageLightmapEncoding = 'unity-rgbm-linear',
) {
    const material = source.clone() as LightMappedMaterial
    material.onBeforeRender = source.onBeforeRender
    const previousCompile = source.onBeforeCompile
    const previousCacheKey = source.customProgramCacheKey
    const stageScaleOffset = new THREE.Vector4(...scaleOffset)
    material.userData.stageBatchLightmap = {
        texture: lightmap.uuid, scaleOffset: [...scaleOffset], intensity,
        directional: directionalLightmap?.uuid ?? null, encoding,
    }

    material.lightMap = lightmap
    material.lightMapIntensity = intensity
    material.onBeforeCompile = function (shader, renderer) {
        previousCompile.call(this, shader, renderer)
        installUnityLightmapShader(
            shader as StageShader,
            stageScaleOffset,
            isDirectionalLightMappedMaterial(source)
                ? directionalLightmap
                : undefined,
            encoding,
        )
    }
    material.customProgramCacheKey = function () {
        return [
            previousCacheKey.call(this),
            encoding === 'unity-bc6h-linear'
                ? (
                    directionalLightmap && isDirectionalLightMappedMaterial(source)
                        ? 'unity-2022.3-bc6h-directional-lightmap-v1-pi'
                        : 'unity-2022.3-bc6h-lightmap-v1-pi'
                )
                : (
                    directionalLightmap && isDirectionalLightMappedMaterial(source)
                        ? 'unity-2022.3-rgbm-directional-lightmap-v2-pi'
                        : 'unity-2022.3-rgbm-lightmap-v2-pi'
                ),
        ].join(':')
    }
    material.needsUpdate = true
    return material
}

function installUnityLightmapShader(
    shader: StageShader,
    scaleOffset: THREE.Vector4,
    directionalLightmap?: THREE.Texture,
    encoding: StageLightmapEncoding = 'unity-rgbm-linear',
) {
    shader.uniforms.uStageLightmapST = { value: scaleOffset }
    shader.vertexShader = shader.vertexShader
        .replace(
            '#include <uv_pars_vertex>',
            `#include <uv_pars_vertex>
uniform vec4 uStageLightmapST;`,
        )
        .replace(
            '#include <uv_vertex>',
            `#include <uv_vertex>
#ifdef USE_LIGHTMAP
    vLightMapUv = LIGHTMAP_UV * uStageLightmapST.xy
        + uStageLightmapST.zw;
#endif`,
        )

    if (directionalLightmap) {
        shader.uniforms.uStageLightmapDirection = { value: directionalLightmap }
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
uniform sampler2D uStageLightmapDirection;`,
        )
    }
    const baseIrradiance = encoding === 'unity-bc6h-linear'
        ? LIGHTMAP_IRRADIANCE_BC6H
        : LIGHTMAP_IRRADIANCE_RGBM
    const irradiance = directionalLightmap
        ? baseIrradiance + LIGHTMAP_DIRECTIONAL_SUFFIX
        : baseIrradiance
    const chunk = THREE.ShaderChunk.lights_fragment_maps.replace(
        LIGHTMAP_IRRADIANCE_SOURCE,
        irradiance,
    )
    if (shader.fragmentShader.includes('#include <lights_fragment_maps>')) {
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <lights_fragment_maps>',
            chunk,
        )
    } else {
        shader.fragmentShader = shader.fragmentShader.replace(
            LIGHTMAP_IRRADIANCE_SOURCE,
            irradiance,
        )
    }
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
    return 'isMesh' in object && object.isMesh === true
}

function isLightMappedMaterial(
    material: THREE.Material,
): material is LightMappedMaterial {
    return 'lightMap' in material && 'lightMapIntensity' in material
}

function isDirectionalLightMappedMaterial(
    material: THREE.Material,
): material is THREE.MeshStandardMaterial {
    return 'isMeshStandardMaterial' in material
        && material.isMeshStandardMaterial === true
}

function normalizeHierarchyPath(path: string) {
    return path
        .replaceAll('\\', '/')
        .split('/')
        .filter(Boolean)
        .join('/')
}

function pathDepth(path: string) {
    return normalizeHierarchyPath(path).split('/').filter(Boolean).length
}

function hierarchySuffixScore(left: string, right: string) {
    if (!left || !right) return -1
    if (left === right) return Number.MAX_SAFE_INTEGER
    const leftParts = left.split('/')
    const rightParts = right.split('/')
    let score = 0
    while (
        score < leftParts.length
        && score < rightParts.length
        && leftParts[leftParts.length - 1 - score]
            === rightParts[rightParts.length - 1 - score]
    ) {
        score++
    }
    return score > 0 ? score : -1
}

function formatStrictFailure(
    result: StageLightmapMatchResult,
    missingSecondUvPaths: readonly string[],
    unsupportedMaterialPaths: readonly string[],
    missingLightmapPaths: readonly string[],
    missingDirectionalLightmapPaths: readonly string[],
) {
    return [
        'Stage lightmap binding validation failed',
        `unmatched=${result.unmatchedBindingPaths.length}`,
        `ambiguous=${result.ambiguousBindingPaths.length}`,
        `missingUv1=${missingSecondUvPaths.length}`,
        `unsupportedMaterial=${unsupportedMaterialPaths.length}`,
        `missingLightmap=${missingLightmapPaths.length}`,
        `missingDirectionalLightmap=${missingDirectionalLightmapPaths.length}`,
    ].join(', ')
}
