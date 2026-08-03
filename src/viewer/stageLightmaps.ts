import * as THREE from 'three'

export const UNITY_LIGHTMAP_RGBM_EXPONENT = 2.2
export const UNITY_LIGHTMAP_RGBM_MULTIPLIER = 34.493242

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
}

export interface StageLightmapApplication extends StageLightmapMatchResult {
    matchedRendererCount: number
    missingSecondUvPaths: string[]
    unsupportedMaterialPaths: string[]
    dispose: () => void
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
    + ' * lightMapIntensity;'
const RGBM_LIGHTMAP_CHUNK = THREE.ShaderChunk.lights_fragment_maps.replace(
    LIGHTMAP_IRRADIANCE_SOURCE,
    LIGHTMAP_IRRADIANCE_RGBM,
)

/**
 * Configures one shared Unity baked-lighting texture for Three r182.
 * Channel 1 is Three's `uv1` attribute (the second UV set).
 */
export function configureUnityRgbmLightmap(texture: THREE.Texture) {
    texture.channel = 1
    texture.colorSpace = THREE.NoColorSpace
    texture.flipY = false
    texture.needsUpdate = true
    return texture
}

export function getStageHierarchyPath(
    object: THREE.Object3D,
    root?: THREE.Object3D,
) {
    const parts: string[] = []
    let current: THREE.Object3D | null = object
    while (current) {
        if (current.name) parts.unshift(current.name)
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
 * Clones each matched renderer's material, installs per-renderer lightmap ST
 * uniforms and Unity linear RGBM decoding, and returns an idempotent rollback.
 * The supplied texture remains shared and is never disposed by the rollback.
 */
export function applyStageLightmaps(
    root: THREE.Object3D,
    lightmap: THREE.Texture,
    bindings: readonly StageLightmapBinding[],
    options: ApplyStageLightmapsOptions = {},
): StageLightmapApplication {
    const result = matchStageLightmapBindings(root, bindings)
    const missingSecondUvPaths: string[] = []
    const unsupportedMaterialPaths: string[] = []
    const applicableMatches: StageLightmapMatch[] = []

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
        applicableMatches.push(match)
    }

    if (options.strict && (
        result.unmatchedBindingPaths.length > 0
        || result.ambiguousBindingPaths.length > 0
        || missingSecondUvPaths.length > 0
        || unsupportedMaterialPaths.length > 0
    )) {
        throw new Error(formatStrictFailure(
            result,
            missingSecondUvPaths,
            unsupportedMaterialPaths,
        ))
    }

    configureUnityRgbmLightmap(lightmap)
    const intensity = options.intensity ?? 1
    const installations: InstalledMaterial[] = []
    const clones = new Set<THREE.Material>()

    for (const match of applicableMatches) {
        const original = match.mesh.material
        const installed = Array.isArray(original)
            ? original.map(material => installUnityLightmapMaterial(
                material as LightMappedMaterial,
                lightmap,
                match.binding.lightmapScaleOffset,
                intensity,
            ))
            : installUnityLightmapMaterial(
                original as LightMappedMaterial,
                lightmap,
                match.binding.lightmapScaleOffset,
                intensity,
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
) {
    const material = source.clone() as LightMappedMaterial
    const previousCompile = source.onBeforeCompile
    const previousCacheKey = source.customProgramCacheKey
    const stageScaleOffset = new THREE.Vector4(...scaleOffset)

    material.lightMap = lightmap
    material.lightMapIntensity = intensity
    material.onBeforeCompile = function (shader, renderer) {
        previousCompile.call(this, shader, renderer)
        installUnityLightmapShader(
            shader as StageShader,
            stageScaleOffset,
        )
    }
    material.customProgramCacheKey = function () {
        return [
            previousCacheKey.call(this),
            'unity-2022.3-rgbm-lightmap-v1',
        ].join(':')
    }
    material.needsUpdate = true
    return material
}

function installUnityLightmapShader(
    shader: StageShader,
    scaleOffset: THREE.Vector4,
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

    if (shader.fragmentShader.includes('#include <lights_fragment_maps>')) {
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <lights_fragment_maps>',
            RGBM_LIGHTMAP_CHUNK,
        )
    } else {
        shader.fragmentShader = shader.fragmentShader.replace(
            LIGHTMAP_IRRADIANCE_SOURCE,
            LIGHTMAP_IRRADIANCE_RGBM,
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
) {
    return [
        'Stage lightmap binding validation failed',
        `unmatched=${result.unmatchedBindingPaths.length}`,
        `ambiguous=${result.ambiguousBindingPaths.length}`,
        `missingUv1=${missingSecondUvPaths.length}`,
        `unsupportedMaterial=${unsupportedMaterialPaths.length}`,
    ].join(', ')
}
