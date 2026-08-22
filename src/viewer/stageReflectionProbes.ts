import * as THREE from 'three'
import type { StageEnvironmentEncoding } from './stageEnvironment'

export interface StageReflectionProbeProfile {
    id: string
    name?: string
    textureUrl: string
    encoding: StageEnvironmentEncoding
    /** Unity world coordinates before the AssetStudio FBX X reflection. */
    position: [number, number, number]
    boxMin: [number, number, number]
    boxMax: [number, number, number]
    importance: number
    intensity: number
    blendDistance: number
    boxProjection: boolean
}

export type StageReflectionProbeUsage = 0 | 1 | 2 | 3

export interface StageReflectionProbeRendererBinding {
    rendererHierarchyPath: string
    /** UnityEngine.Rendering.ReflectionProbeUsage serialized integer. */
    reflectionProbeUsage: StageReflectionProbeUsage
    reflectionProbeUsageName?:
        | 'off'
        | 'blend-probes'
        | 'blend-probes-and-skybox'
        | 'simple'
    probeAnchorHierarchyPath?: string | null
    /** Resolved Unity-world Transform position for Renderer.probeAnchor. */
    probeAnchorPosition?: [number, number, number] | null
}

export interface LoadedStageReflectionProbe {
    profile: StageReflectionProbeProfile
    texture: THREE.CubeTexture | THREE.CompressedCubeTexture
}

export interface StageReflectionProbeApplication {
    rendererCount: number
    materialCount: number
    probeCount: number
    getDebugState: () => StageReflectionProbeDebugState
    update: () => void
    dispose: () => void
}

export interface StageReflectionProbeDebugState {
    rendererCount: number
    materialCount: number
    probeCount: number
    globalEnvironment: string
    globalIntensity: number
    coordinateSpace: string
    bindingCount: number
    unmatchedBindingPaths: string[]
    ambiguousBindingPaths: string[]
    selection: Array<{
        renderer: string
        probes: string[]
        reflectionProbeUsage: StageReflectionProbeUsage
        reflectionProbeUsageName: string
        probeAnchorPosition: [number, number, number] | null
        bindingSource: 'serialized-renderer' | 'legacy-default'
    }>
}

interface RuntimeProbe {
    profile: StageReflectionProbeProfile
    texture: THREE.CubeTexture | THREE.CompressedCubeTexture
    position: THREE.Vector3
    box: THREE.Box3
    volumeSquared: number
    maxMip: number
}

interface StageShader {
    uniforms: Record<string, { value: unknown }>
    vertexShader: string
    fragmentShader: string
}

interface ProbeUniformState {
    shader?: StageShader
    worldToStage: THREE.Matrix4
    selected: RuntimeProbe[]
    reflectionProbeUsage: StageReflectionProbeUsage
}

interface MaterialInstallation {
    mesh: THREE.Mesh
    original: THREE.Material | THREE.Material[]
    installed: THREE.Material | THREE.Material[]
    states: ProbeUniformState[]
}

const UNITY_SPEC_CUBE_LOD_STEPS = 6

/** Unity GlobalIllumination.hlsl CalculateProbeWeight, with the zero-width limit explicit. */
export function calculateUnityProbeWeight(
    position: readonly [number, number, number],
    boxMin: readonly [number, number, number],
    boxMax: readonly [number, number, number],
    blendDistance: number,
) {
    if (blendDistance <= 0) {
        return position.every((value, index) =>
            value >= boxMin[index] && value <= boxMax[index]
        ) ? 1 : 0
    }
    return THREE.MathUtils.clamp(Math.min(
        (position[0] - boxMin[0]) / blendDistance,
        (position[1] - boxMin[1]) / blendDistance,
        (position[2] - boxMin[2]) / blendDistance,
        (boxMax[0] - position[0]) / blendDistance,
        (boxMax[1] - position[1]) / blendDistance,
        (boxMax[2] - position[2]) / blendDistance,
    ), 0, 1)
}

/** Unity's non-Forward+ two-probe importance/volume weighting. */
export function calculateUnityProbeBlendWeights(
    position: readonly [number, number, number],
    probes: readonly StageReflectionProbeProfile[],
) {
    const first = probes[0]
    const second = probes[1]
    if (!first) return { weights: [0, 0] as [number, number], totalWeight: 0 }

    const desired0 = calculateUnityProbeWeight(
        position,
        first.boxMin,
        first.boxMax,
        first.blendDistance,
    )
    if (!second) {
        return {
            weights: [desired0, 0] as [number, number],
            totalWeight: desired0,
        }
    }

    const desired1 = calculateUnityProbeWeight(
        position,
        second.boxMin,
        second.boxMax,
        second.blendDistance,
    )
    const volume0 = probeVolumeSquared(first.boxMin, first.boxMax)
    const volume1 = probeVolumeSquared(second.boxMin, second.boxMax)
    const volumeDiff = volume0 - volume1
    const importanceSign = Math.sign(first.importance - second.importance)
    const probe0Dominant = importanceSign > 0
        || (importanceSign === 0 && volumeDiff < -0.0001)
    const probe1Dominant = importanceSign < 0
        || (importanceSign === 0 && volumeDiff > 0.0001)
    let weight0 = probe1Dominant
        ? Math.min(desired0, 1 - desired1)
        : desired0
    let weight1 = probe0Dominant
        ? Math.min(desired1, 1 - desired0)
        : desired1
    const unnormalizedTotal = weight0 + weight1
    const divisor = Math.max(unnormalizedTotal, 1)
    weight0 /= divisor
    weight1 /= divisor
    return {
        weights: [weight0, weight1] as [number, number],
        totalWeight: weight0 + weight1,
    }
}

/** Unity GlobalIllumination.hlsl BoxProjectedCubemapDirection. */
export function boxProjectedCubemapDirection(
    reflection: THREE.Vector3,
    position: THREE.Vector3,
    probePosition: THREE.Vector3,
    boxMin: THREE.Vector3,
    boxMax: THREE.Vector3,
) {
    const selected = new THREE.Vector3(
        reflection.x > 0 ? boxMax.x : boxMin.x,
        reflection.y > 0 ? boxMax.y : boxMin.y,
        reflection.z > 0 ? boxMax.z : boxMin.z,
    )
    const distances = selected.sub(position).divide(reflection)
    const distance = Math.min(distances.x, distances.y, distances.z)
    return position.clone()
        .sub(probePosition)
        .addScaledVector(reflection, distance)
}

export function applyStageReflectionProbes(
    root: THREE.Object3D,
    loadedProbes: readonly LoadedStageReflectionProbe[],
    globalEnvironment: THREE.CubeTexture | THREE.CompressedCubeTexture,
    globalIntensity = 1,
    rendererBindings: readonly StageReflectionProbeRendererBinding[] = [],
): StageReflectionProbeApplication {
    if (!isCubeTexture(globalEnvironment)) {
        throw new Error('The exact Unity reflection path requires a cubemap environment')
    }

    const runtimeProbes = loadedProbes.map(({ profile, texture }) => {
        validateProbeProfile(profile)
        if (profile.encoding !== 'unity-bc6h-uf16' || !isCubeTexture(texture)) {
            throw new Error(`Reflection probe ${profile.id} is not an exact BC6H cubemap`)
        }
        const boxMin = unityPointToViewer(profile.boxMin)
        const boxMax = unityPointToViewer(profile.boxMax)
        const normalizedMin = new THREE.Vector3(
            Math.min(boxMin.x, boxMax.x),
            Math.min(boxMin.y, boxMax.y),
            Math.min(boxMin.z, boxMax.z),
        )
        const normalizedMax = new THREE.Vector3(
            Math.max(boxMin.x, boxMax.x),
            Math.max(boxMin.y, boxMax.y),
            Math.max(boxMin.z, boxMax.z),
        )
        return {
            profile,
            texture,
            position: unityPointToViewer(profile.position),
            box: new THREE.Box3(normalizedMin, normalizedMax),
            volumeSquared: normalizedMax.clone().sub(normalizedMin).lengthSq(),
            maxMip: textureMaxMip(texture),
        }
    })

    const installations: MaterialInstallation[] = []
    const selection: StageReflectionProbeDebugState['selection'] = []
    root.updateWorldMatrix(true, true)
    const bindingMatches = matchStageReflectionProbeBindings(root, rendererBindings)
    const bindingByMesh = new Map(
        bindingMatches.matches.map(match => [match.mesh, match.binding]),
    )

    root.traverse(child => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        const binding = bindingByMesh.get(mesh)
        const reflectionProbeUsage = binding?.reflectionProbeUsage ?? 2
        const sourceMaterials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
        const states: ProbeUniformState[] = []
        const installedMaterials = sourceMaterials.map(source => {
            if (!isMeshStandardMaterial(source)) return source
            const state: ProbeUniformState = {
                worldToStage: new THREE.Matrix4(),
                selected: [],
                reflectionProbeUsage,
            }
            states.push(state)
            return installProbeMaterial(
                source,
                state,
                globalEnvironment,
                globalIntensity,
            )
        })
        if (states.length === 0) return
        const original = mesh.material
        const installed = Array.isArray(original)
            ? installedMaterials
            : installedMaterials[0]
        mesh.material = installed
        installations.push({ mesh, original, installed, states })
        selection.push({
            renderer: hierarchyPath(mesh, root),
            probes: [],
            reflectionProbeUsage,
            reflectionProbeUsageName: reflectionProbeUsageName(
                reflectionProbeUsage,
            ),
            probeAnchorPosition: binding?.probeAnchorPosition ?? null,
            bindingSource: binding ? 'serialized-renderer' : 'legacy-default',
        })
    })

    const worldToStage = new THREE.Matrix4()
    const relative = new THREE.Matrix4()
    const localBounds = new THREE.Box3()
    let disposed = false

    const update = () => {
        if (disposed) return
        root.updateWorldMatrix(true, true)
        worldToStage.copy(root.matrixWorld).invert()
        installations.forEach((installation, index) => {
            const mesh = installation.mesh
            const geometry = mesh.geometry
            if (!geometry.boundingBox) geometry.computeBoundingBox()
            if (geometry.boundingBox) {
                relative.multiplyMatrices(worldToStage, mesh.matrixWorld)
                localBounds.copy(geometry.boundingBox).applyMatrix4(relative)
            } else {
                localBounds.makeEmpty()
            }
            const binding = bindingByMesh.get(mesh)
            const probeAnchor = binding?.probeAnchorPosition
                ? unityPointToViewer(binding.probeAnchorPosition)
                : undefined
            const selected = selectReflectionProbes(
                runtimeProbes,
                localBounds,
                probeAnchor,
                binding?.reflectionProbeUsage ?? 2,
            )
            installation.states.forEach(state => {
                state.worldToStage.copy(worldToStage)
                state.selected = selected
                updateShaderUniforms(
                    state,
                    globalEnvironment,
                    globalIntensity,
                )
            })
            selection[index].probes = selected.map(probe => probe.profile.id)
            mesh.userData.stageReflectionProbes = {
                source: 'unity-2022.3-non-forward-plus',
                selected: [...selection[index].probes],
                reflectionProbeUsage: selection[index].reflectionProbeUsage,
                reflectionProbeUsageName:
                    selection[index].reflectionProbeUsageName,
                probeAnchorPosition: selection[index].probeAnchorPosition,
                bindingSource: selection[index].bindingSource,
            }
        })
    }

    update()
    const debug = (): StageReflectionProbeDebugState => ({
        rendererCount: installations.length,
        materialCount: installations.reduce(
            (sum, installation) => sum + installation.states.length,
            0,
        ),
        probeCount: runtimeProbes.length,
        globalEnvironment: globalEnvironment.name,
        globalIntensity,
        coordinateSpace: 'unity-world -> AssetStudio reflect-X -> stage-local shader',
        bindingCount: rendererBindings.length,
        unmatchedBindingPaths: [...bindingMatches.unmatchedBindingPaths],
        ambiguousBindingPaths: [...bindingMatches.ambiguousBindingPaths],
        selection: selection.map(item => ({
            renderer: item.renderer,
            probes: [...item.probes],
            reflectionProbeUsage: item.reflectionProbeUsage,
            reflectionProbeUsageName: item.reflectionProbeUsageName,
            probeAnchorPosition: item.probeAnchorPosition
                ? [...item.probeAnchorPosition] as [number, number, number]
                : null,
            bindingSource: item.bindingSource,
        })),
    })

    return {
        rendererCount: installations.length,
        materialCount: installations.reduce(
            (sum, installation) => sum + installation.states.length,
            0,
        ),
        probeCount: runtimeProbes.length,
        getDebugState: debug,
        update,
        dispose: () => {
            if (disposed) return
            disposed = true
            installations.forEach(installation => {
                if (installation.mesh.material === installation.installed) {
                    installation.mesh.material = installation.original
                }
                const materials = Array.isArray(installation.installed)
                    ? installation.installed
                    : [installation.installed]
                materials.forEach((material, index) => {
                    const source = Array.isArray(installation.original)
                        ? installation.original[index]
                        : installation.original
                    if (material !== source) material.dispose()
                })
                delete installation.mesh.userData.stageReflectionProbes
            })
        },
    }
}

function selectReflectionProbes(
    probes: readonly RuntimeProbe[],
    bounds: THREE.Box3,
    anchor: THREE.Vector3 | undefined,
    usage: StageReflectionProbeUsage,
) {
    if (usage === 0 || (!anchor && bounds.isEmpty())) return []
    return probes
        .filter(probe => anchor
            ? probe.box.containsPoint(anchor)
            : probe.box.intersectsBox(bounds),
        )
        .sort((left, right) =>
            right.profile.importance - left.profile.importance
            || left.volumeSquared - right.volumeSquared
            || left.profile.id.localeCompare(right.profile.id)
        )
        .slice(0, usage === 3 ? 1 : 2)
}

function installProbeMaterial(
    source: THREE.MeshStandardMaterial,
    state: ProbeUniformState,
    globalEnvironment: THREE.CubeTexture | THREE.CompressedCubeTexture,
    globalIntensity: number,
) {
    const material = source.clone()
    const previousCompile = source.onBeforeCompile
    const previousBeforeRender = source.onBeforeRender
    const previousCacheKey = source.customProgramCacheKey
    // Material.copy() intentionally omits callbacks. Preserve all existing
    // official material, animation and lightmap extensions before adding IBL.
    material.onBeforeCompile = function (shader, renderer) {
        previousCompile.call(this, shader, renderer)
        installUnityProbeShader(shader as StageShader, state)
        updateShaderUniforms(state, globalEnvironment, globalIntensity)
    }
    material.onBeforeRender = function (...args) {
        previousBeforeRender.call(this, ...args)
        updateShaderUniforms(state, globalEnvironment, globalIntensity)
    }
    material.customProgramCacheKey = function () {
        return `${previousCacheKey.call(this)}:unity-2022.3-reflection-probes-v1`
    }
    // Three uses this only to enable the physical IBL branch. The custom chunk
    // samples the untouched Unity BC6H face/mip chains through separate uniforms.
    material.envMap = globalEnvironment
    material.userData.stageReflectionProbeShader = {
        source: 'Unity URP 14 GlobalIllumination.hlsl',
        boxProjection: true,
        probeBlending: true,
        perceptualRoughnessMip: true,
        diffuseEnvironmentIbl: false,
    }
    material.needsUpdate = true
    return material
}

function installUnityProbeShader(shader: StageShader, state: ProbeUniformState) {
    const globalTexture = shader.uniforms.envMap?.value as THREE.Texture | undefined
    shader.uniforms.uStageWorldToLocal = { value: state.worldToStage }
    shader.uniforms.uStageGlobalProbe = { value: globalTexture }
    shader.uniforms.uStageGlobalIntensity = { value: 1 }
    shader.uniforms.uStageGlobalMaxMip = { value: UNITY_SPEC_CUBE_LOD_STEPS }
    shader.uniforms.uStageProbeCount = { value: 0 }
    shader.uniforms.uStageReflectionProbeUsage = {
        value: state.reflectionProbeUsage,
    }
    for (const index of [0, 1] as const) {
        shader.uniforms[`uStageProbe${index}`] = { value: globalTexture }
        shader.uniforms[`uStageProbe${index}Position`] = {
            value: new THREE.Vector3(),
        }
        shader.uniforms[`uStageProbe${index}BoxMin`] = {
            value: new THREE.Vector3(),
        }
        shader.uniforms[`uStageProbe${index}BoxMax`] = {
            value: new THREE.Vector3(),
        }
        shader.uniforms[`uStageProbe${index}BlendDistance`] = { value: 1 }
        shader.uniforms[`uStageProbe${index}Importance`] = { value: 0 }
        shader.uniforms[`uStageProbe${index}Intensity`] = { value: 0 }
        shader.uniforms[`uStageProbe${index}BoxProjection`] = { value: 0 }
        shader.uniforms[`uStageProbe${index}MaxMip`] = {
            value: UNITY_SPEC_CUBE_LOD_STEPS,
        }
    }

    shader.vertexShader = shader.vertexShader
        .replace(
            '#include <common>',
            `#include <common>
varying vec3 vStageProbeWorldPosition;`,
        )
        .replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
#ifdef USE_ENVMAP
    vStageProbeWorldPosition = worldPosition.xyz;
#endif`,
        )

    const include = '#include <envmap_physical_pars_fragment>'
    if (!shader.fragmentShader.includes(include)) {
        throw new Error('Three envmap physical shader hook was not found')
    }
    shader.fragmentShader = shader.fragmentShader.replace(
        include,
        UNITY_REFLECTION_PROBE_SHADER,
    )
    state.shader = shader
}

function updateShaderUniforms(
    state: ProbeUniformState,
    globalEnvironment: THREE.CubeTexture | THREE.CompressedCubeTexture,
    globalIntensity: number,
) {
    const uniforms = state.shader?.uniforms
    if (!uniforms) return
    uniforms.uStageWorldToLocal.value = state.worldToStage
    uniforms.uStageGlobalProbe.value = globalEnvironment
    uniforms.uStageGlobalIntensity.value = globalIntensity
    uniforms.uStageGlobalMaxMip.value = textureMaxMip(globalEnvironment)
    uniforms.uStageProbeCount.value = state.selected.length
    uniforms.uStageReflectionProbeUsage.value = state.reflectionProbeUsage
    for (const index of [0, 1] as const) {
        const probe = state.selected[index]
        uniforms[`uStageProbe${index}`].value = probe?.texture ?? globalEnvironment
        uniforms[`uStageProbe${index}Position`].value = probe?.position
            ?? new THREE.Vector3()
        uniforms[`uStageProbe${index}BoxMin`].value = probe?.box.min
            ?? new THREE.Vector3()
        uniforms[`uStageProbe${index}BoxMax`].value = probe?.box.max
            ?? new THREE.Vector3()
        uniforms[`uStageProbe${index}BlendDistance`].value =
            probe?.profile.blendDistance ?? 1
        uniforms[`uStageProbe${index}Importance`].value =
            probe?.profile.importance ?? 0
        uniforms[`uStageProbe${index}Intensity`].value =
            probe?.profile.intensity ?? 0
        uniforms[`uStageProbe${index}BoxProjection`].value =
            probe?.profile.boxProjection ? 1 : 0
        uniforms[`uStageProbe${index}MaxMip`].value =
            probe?.maxMip ?? UNITY_SPEC_CUBE_LOD_STEPS
    }
}

function unityPointToViewer(value: readonly [number, number, number]) {
    return new THREE.Vector3(-value[0], value[1], value[2])
}

function textureMaxMip(texture: THREE.Texture) {
    const metadata = texture.userData.stageEnvironment as {
        mipmapCount?: number
    } | undefined
    return Math.max(0, (metadata?.mipmapCount ?? 7) - 1)
}

function probeVolumeSquared(
    boxMin: readonly [number, number, number],
    boxMax: readonly [number, number, number],
) {
    return boxMax.reduce((sum, value, index) =>
        sum + (value - boxMin[index]) ** 2
    , 0)
}

function validateProbeProfile(profile: StageReflectionProbeProfile) {
    const values = [
        ...profile.position,
        ...profile.boxMin,
        ...profile.boxMax,
        profile.importance,
        profile.intensity,
        profile.blendDistance,
    ]
    if (
        !profile.id
        || !profile.textureUrl
        || !values.every(Number.isFinite)
        || profile.blendDistance < 0
        || profile.intensity < 0
        || profile.boxMin.some((value, index) => value > profile.boxMax[index])
    ) {
        throw new Error(`Invalid serialized reflection probe ${profile.id || '(unnamed)'}`)
    }
}

function hierarchyPath(object: THREE.Object3D, root: THREE.Object3D) {
    const parts: string[] = []
    let current: THREE.Object3D | null = object
    while (current) {
        if (current.name) parts.unshift(current.name)
        if (current === root) break
        current = current.parent
    }
    return normalizeHierarchyPath(parts.join('/'))
}

export function matchStageReflectionProbeBindings(
    root: THREE.Object3D,
    bindings: readonly StageReflectionProbeRendererBinding[],
) {
    const meshes: Array<{ mesh: THREE.Mesh, path: string }> = []
    root.traverse(object => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh) {
            meshes.push({ mesh, path: hierarchyPath(mesh, root) })
        }
    })
    const matches: Array<{
        binding: StageReflectionProbeRendererBinding
        mesh: THREE.Mesh
        rendererHierarchyPath: string
    }> = []
    const unmatchedBindingPaths: string[] = []
    const ambiguousBindingPaths: string[] = []
    const claimed = new Set<THREE.Mesh>()
    const ordered = [...bindings].sort((left, right) =>
        pathDepth(right.rendererHierarchyPath)
        - pathDepth(left.rendererHierarchyPath),
    )
    for (const binding of ordered) {
        const bindingPath = normalizeHierarchyPath(binding.rendererHierarchyPath)
        let bestScore = -1
        let candidates: Array<{ mesh: THREE.Mesh, path: string }> = []
        for (const candidate of meshes) {
            if (claimed.has(candidate.mesh)) continue
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
            claimed.add(candidate.mesh)
            matches.push({
                binding,
                mesh: candidate.mesh,
                rendererHierarchyPath: candidate.path,
            })
        }
    }
    return { matches, unmatchedBindingPaths, ambiguousBindingPaths }
}

function normalizeHierarchyPath(path: string) {
    return path
        .replaceAll('\\', '/')
        .split('/')
        .map(part => part.trim())
        .filter(Boolean)
        .join('/')
}

function pathDepth(path: string) {
    return normalizeHierarchyPath(path).split('/').filter(Boolean).length
}

function hierarchySuffixScore(left: string, right: string) {
    const leftParts = normalizeHierarchyPath(left).split('/').filter(Boolean)
    const rightParts = normalizeHierarchyPath(right).split('/').filter(Boolean)
    const maximum = Math.min(leftParts.length, rightParts.length)
    let matched = 0
    while (
        matched < maximum
        && leftParts[leftParts.length - matched - 1]
            === rightParts[rightParts.length - matched - 1]
    ) matched++
    return matched > 0 ? matched : -1
}

function reflectionProbeUsageName(usage: StageReflectionProbeUsage) {
    return [
        'off',
        'blend-probes',
        'blend-probes-and-skybox',
        'simple',
    ][usage]
}

function isCubeTexture(
    texture: THREE.Texture,
): texture is THREE.CubeTexture | THREE.CompressedCubeTexture {
    return 'isCubeTexture' in texture && texture.isCubeTexture === true
}

function isMeshStandardMaterial(
    material: THREE.Material,
): material is THREE.MeshStandardMaterial {
    return 'isMeshStandardMaterial' in material
        && material.isMeshStandardMaterial === true
}

export const UNITY_REFLECTION_PROBE_SHADER = /* glsl */`
#ifdef USE_ENVMAP

varying vec3 vStageProbeWorldPosition;
uniform mat4 uStageWorldToLocal;
uniform samplerCube uStageGlobalProbe;
uniform float uStageGlobalIntensity;
uniform float uStageGlobalMaxMip;
uniform float uStageProbeCount;
uniform float uStageReflectionProbeUsage;
uniform samplerCube uStageProbe0;
uniform samplerCube uStageProbe1;
uniform vec3 uStageProbe0Position;
uniform vec3 uStageProbe1Position;
uniform vec3 uStageProbe0BoxMin;
uniform vec3 uStageProbe1BoxMin;
uniform vec3 uStageProbe0BoxMax;
uniform vec3 uStageProbe1BoxMax;
uniform float uStageProbe0BlendDistance;
uniform float uStageProbe1BlendDistance;
uniform float uStageProbe0Importance;
uniform float uStageProbe1Importance;
uniform float uStageProbe0Intensity;
uniform float uStageProbe1Intensity;
uniform float uStageProbe0BoxProjection;
uniform float uStageProbe1BoxProjection;
uniform float uStageProbe0MaxMip;
uniform float uStageProbe1MaxMip;

float stageCalculateProbeWeight(
    vec3 positionWS,
    vec3 probeBoxMin,
    vec3 probeBoxMax,
    float blendDistance
) {
    if (blendDistance <= 0.0) {
        bvec3 aboveMin = greaterThanEqual(positionWS, probeBoxMin);
        bvec3 belowMax = lessThanEqual(positionWS, probeBoxMax);
        return all(aboveMin) && all(belowMax) ? 1.0 : 0.0;
    }
    vec3 weightDir = min(
        positionWS - probeBoxMin,
        probeBoxMax - positionWS
    ) / blendDistance;
    return saturate(min(weightDir.x, min(weightDir.y, weightDir.z)));
}

float stageProbeVolumeSqrMagnitude(vec3 probeBoxMin, vec3 probeBoxMax) {
    vec3 maxToMin = probeBoxMax - probeBoxMin;
    return dot(maxToMin, maxToMin);
}

vec3 stageBoxProjectedCubemapDirection(
    vec3 reflectionWS,
    vec3 positionWS,
    vec3 cubemapPositionWS,
    vec3 boxMin,
    vec3 boxMax,
    float enabled
) {
    if (enabled > 0.5) {
        vec3 boxMinMax = vec3(
            reflectionWS.x > 0.0 ? boxMax.x : boxMin.x,
            reflectionWS.y > 0.0 ? boxMax.y : boxMin.y,
            reflectionWS.z > 0.0 ? boxMax.z : boxMin.z
        );
        vec3 rbMinMax = (boxMinMax - positionWS) / reflectionWS;
        float fa = min(min(rbMinMax.x, rbMinMax.y), rbMinMax.z);
        vec3 worldPos = positionWS - cubemapPositionWS;
        return worldPos + reflectionWS * fa;
    }
    return reflectionWS;
}

float stagePerceptualRoughnessToMipmapLevel(float perceptualRoughness) {
    perceptualRoughness *= 1.7 - 0.7 * perceptualRoughness;
    return perceptualRoughness * 6.0;
}

vec3 stageUnityCubeDirection(vec3 viewerStageDirection) {
    return vec3(
        -viewerStageDirection.x,
        viewerStageDirection.y,
        viewerStageDirection.z
    );
}

vec3 stageSampleProbe0(vec3 direction, float mip) {
    return textureCubeLodEXT(
        uStageProbe0,
        stageUnityCubeDirection(direction),
        min(mip, uStageProbe0MaxMip)
    ).rgb * uStageProbe0Intensity;
}

vec3 stageSampleProbe1(vec3 direction, float mip) {
    return textureCubeLodEXT(
        uStageProbe1,
        stageUnityCubeDirection(direction),
        min(mip, uStageProbe1MaxMip)
    ).rgb * uStageProbe1Intensity;
}

vec3 getIBLIrradiance(const in vec3 normal) {
    // Unity's baked GI/lightmap or SH owns diffuse ambient; reflection probes
    // feed GlossyEnvironmentReflection only.
    return vec3(0.0);
}

vec3 getIBLRadiance(
    const in vec3 viewDir,
    const in vec3 normal,
    const in float roughness
) {
    vec3 reflectionWorld = inverseTransformDirection(
        reflect(-viewDir, normal),
        viewMatrix
    );
    vec3 reflectionStage = normalize(
        mat3(uStageWorldToLocal) * reflectionWorld
    );
    vec3 positionStage = (
        uStageWorldToLocal * vec4(vStageProbeWorldPosition, 1.0)
    ).xyz;
    float mip = stagePerceptualRoughnessToMipmapLevel(roughness);

    if (uStageReflectionProbeUsage > 2.5 && uStageProbeCount > 0.5) {
        vec3 simpleDirection = stageBoxProjectedCubemapDirection(
            reflectionStage,
            positionStage,
            uStageProbe0Position,
            uStageProbe0BoxMin,
            uStageProbe0BoxMax,
            uStageProbe0BoxProjection
        );
        return stageSampleProbe0(simpleDirection, mip);
    }
    float weightProbe0 = 0.0;
    float weightProbe1 = 0.0;
    float totalWeight = 0.0;

    if (uStageProbeCount > 0.5) {
        float desiredWeightProbe0 = stageCalculateProbeWeight(
            positionStage,
            uStageProbe0BoxMin,
            uStageProbe0BoxMax,
            uStageProbe0BlendDistance
        );
        weightProbe0 = desiredWeightProbe0;

        if (uStageProbeCount > 1.5) {
            float desiredWeightProbe1 = stageCalculateProbeWeight(
                positionStage,
                uStageProbe1BoxMin,
                uStageProbe1BoxMax,
                uStageProbe1BlendDistance
            );
            float probe0Volume = stageProbeVolumeSqrMagnitude(
                uStageProbe0BoxMin,
                uStageProbe0BoxMax
            );
            float probe1Volume = stageProbeVolumeSqrMagnitude(
                uStageProbe1BoxMin,
                uStageProbe1BoxMax
            );
            float volumeDiff = probe0Volume - probe1Volume;
            float importanceSign = sign(
                uStageProbe0Importance - uStageProbe1Importance
            );
            bool probe0Dominant = importanceSign > 0.0
                || (importanceSign == 0.0 && volumeDiff < -0.0001);
            bool probe1Dominant = importanceSign < 0.0
                || (importanceSign == 0.0 && volumeDiff > 0.0001);
            weightProbe0 = probe1Dominant
                ? min(desiredWeightProbe0, 1.0 - desiredWeightProbe1)
                : desiredWeightProbe0;
            weightProbe1 = probe0Dominant
                ? min(desiredWeightProbe1, 1.0 - desiredWeightProbe0)
                : desiredWeightProbe1;
            totalWeight = weightProbe0 + weightProbe1;
            weightProbe0 /= max(totalWeight, 1.0);
            weightProbe1 /= max(totalWeight, 1.0);
        }
        totalWeight = weightProbe0 + weightProbe1;
    }

    vec3 irradiance = vec3(0.0);
    if (weightProbe0 > 0.01) {
        vec3 direction0 = stageBoxProjectedCubemapDirection(
            reflectionStage,
            positionStage,
            uStageProbe0Position,
            uStageProbe0BoxMin,
            uStageProbe0BoxMax,
            uStageProbe0BoxProjection
        );
        irradiance += weightProbe0 * stageSampleProbe0(direction0, mip);
    }
    if (weightProbe1 > 0.01) {
        vec3 direction1 = stageBoxProjectedCubemapDirection(
            reflectionStage,
            positionStage,
            uStageProbe1Position,
            uStageProbe1BoxMin,
            uStageProbe1BoxMax,
            uStageProbe1BoxProjection
        );
        irradiance += weightProbe1 * stageSampleProbe1(direction1, mip);
    }
    if (totalWeight < 0.99) {
        irradiance += (1.0 - totalWeight) * textureCubeLodEXT(
            uStageGlobalProbe,
            stageUnityCubeDirection(reflectionStage),
            min(mip, uStageGlobalMaxMip)
        ).rgb * uStageGlobalIntensity;
    }
    return irradiance;
}

#ifdef USE_ANISOTROPY
vec3 getIBLAnisotropyRadiance(
    const in vec3 viewDir,
    const in vec3 normal,
    const in float roughness,
    const in vec3 bitangent,
    const in float anisotropy
) {
    vec3 bentNormal = cross(bitangent, viewDir);
    bentNormal = normalize(cross(bentNormal, bitangent));
    bentNormal = normalize(mix(
        bentNormal,
        normal,
        pow2(pow2(1.0 - anisotropy * (1.0 - roughness)))
    ));
    return getIBLRadiance(viewDir, bentNormal, roughness);
}
#endif

#endif
`
