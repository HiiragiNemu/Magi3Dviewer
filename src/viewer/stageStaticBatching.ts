import * as THREE from 'three'
import type { StageRuntimeProfile } from './stageRuntime'
import { hasStageTransformBatchUpdater, prepareStageTransformAnimations, registerStageTransformBatchUpdater, type StageTransformAnimationProfile } from './stageTransformAnimations'

/**
 * Current StageRuntime-owned writers, not mere profile presence. Particle
 * drawables/anchors are separately allocated; clock/voice/component-clip
 * declarations do not mutate existing renderers. Component clips are retained
 * evidence, not consumed by StageRuntime; loaded FBX clips remain excluded below.
 * Unknown fields and any declared transform/visibility/animation owner keep the
 * original path, including paused directors and currently unresolved targets.
 */
export function hasStageRuntimeMeshWriters(
    profile?: StageRuntimeProfile, certifiedTransformTargetsHandled = false,
): boolean {
    if (profile == undefined) return false
    const declarations = new Set([
        'autoplay', 'loop', 'startTime', 'timeScale', 'voiceTracks',
        'particlePresets', 'particleSystems', 'particleMeshes',
        'serializedComponentClips',
    ])
    const optionalWriterArrays = new Set([
        'clipNames', 'rotators', 'gameObjectStates', 'activationDirectors',
        'animatorRandomizers', 'volumetricLightBeams', 'volumetricDustParticles',
    ])
    return Object.entries(profile).some(([field, value]) => {
        if (field === 'transformAnimations' && certifiedTransformTargetsHandled) return false
        if (declarations.has(field)) return false
        if (optionalWriterArrays.has(field)
            && (value == undefined || Array.isArray(value) && value.length === 0)) return false
        return true
    })
}

type StaticMesh = THREE.Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean; isBatchedMesh?: boolean }
type Batch = { mesh: THREE.InstancedMesh; sources: Array<{mesh: THREE.Mesh; layers: number}> }

function serialized(value: unknown, depth = 0): unknown {
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value
    if (typeof value === 'function' || depth > 12) throw new Error('Unserializable batch state')
    const object = value as Record<string, any>
    if (object.isTexture) return { texture: object.uuid, channel: object.channel,
        matrix: object.matrix.elements, wrapS: object.wrapS, wrapT: object.wrapT,
        minFilter: object.minFilter, magFilter: object.magFilter, colorSpace: object.colorSpace }
    if (object.isColor || object.isVector2 || object.isVector3 || object.isVector4
        || object.isMatrix3 || object.isMatrix4 || object.isQuaternion) return object.toArray()
    if (Array.isArray(value)) return value.map(v => serialized(v, depth + 1))
    if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>)
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, serialized(object[key], depth + 1)]))
}

function materialKey(mesh: THREE.Mesh): string | undefined {
    const material = Array.isArray(mesh.material)
        ? (mesh.material.length === 1 ? mesh.material[0] : undefined) : mesh.material
    if (!material || (!('isMeshBasicMaterial' in material) && !('isMeshStandardMaterial' in material))
        || !material.userData.stageRigidBatchBinding || material.transparent || !material.depthWrite
        || !material.depthTest || !material.colorWrite || material.stencilWrite || material.alphaHash
        || material.blending !== THREE.NormalBlending && material.blending !== THREE.NoBlending
        || mesh.customDepthMaterial || mesh.customDistanceMaterial
        || material.userData.stageAtlas || material.userData.stageBaseUvScroll
        || material.userData.stageMultiUvScroll || material.userData.stageFlowMap) return undefined
    const fields: Record<string, unknown> = {}
    // The certificate is issued only by the stage binder; exact renderer-specific
    // lightmap values and selected probes are added by their respective owners.
    try {
        for (const key of Object.keys(material).sort()) {
            if (['id', 'uuid', 'name', 'version', '_listeners'].includes(key)) continue
            const value = (material as unknown as Record<string, unknown>)[key]
            if (typeof value === 'function') continue
            fields[key] = serialized(value)
        }
        fields.program = material.customProgramCacheKey()
        fields.probeSelection = serialized(mesh.userData.stageReflectionProbes ?? null)
        return JSON.stringify(fields)
    } catch { return undefined }
}

function geometryKey(geometry: THREE.BufferGeometry): string | undefined {
    if (Object.values(geometry.morphAttributes).some(list => list.length)) return undefined
    let hash = 2166136261
    const descriptors: unknown[] = [geometry.groups, geometry.drawRange]
    for (const [name, a] of [...Object.entries(geometry.attributes), ['index', geometry.index] as const].sort(([a], [b]) => a.localeCompare(b))) {
        if (!a) { descriptors.push([name, null]); continue }
        if (!('array' in a) || !('usage' in a) || a.usage !== THREE.StaticDrawUsage
            || (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) return undefined
        const bytes = new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength)
        for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 16777619) }
        descriptors.push([name, a.array.constructor.name, a.itemSize, a.normalized, bytes.length])
    }
    return JSON.stringify([hash >>> 0, descriptors])
}

function equalGeometry(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
    if (JSON.stringify(a.groups) !== JSON.stringify(b.groups)
        || JSON.stringify(a.drawRange) !== JSON.stringify(b.drawRange)) return false
    const names = [...Object.keys(a.attributes).sort(), 'index']
    if (JSON.stringify(Object.keys(a.attributes).sort()) !== JSON.stringify(Object.keys(b.attributes).sort())) return false
    return names.every(name => {
        const x = name === 'index' ? a.index : a.getAttribute(name)
        const y = name === 'index' ? b.index : b.getAttribute(name)
        if (!x || !y) return x === y
        if (!('array' in x) || !('array' in y) || x.itemSize !== y.itemSize || x.normalized !== y.normalized
            || x.array.constructor !== y.array.constructor || x.array.byteLength !== y.array.byteLength) return false
        const xx = new Uint8Array(x.array.buffer, x.array.byteOffset, x.array.byteLength)
        const yy = new Uint8Array(y.array.buffer, y.array.byteOffset, y.array.byteLength)
        return xx.every((byte, index) => byte === yy[index])
    })
}

function positiveOrthogonal(matrix: THREE.Matrix4): boolean {
    if (!(matrix.determinant() > 0) || !matrix.elements.every(Number.isFinite)) return false
    const e = matrix.elements
    const columns = [new THREE.Vector3(e[0], e[1], e[2]), new THREE.Vector3(e[4], e[5], e[6]), new THREE.Vector3(e[8], e[9], e[10])]
    if (columns.some(v => v.lengthSq() === 0)) return false
    return [[0, 1], [0, 2], [1, 2]].every(([a, b]) =>
        Math.abs(columns[a].dot(columns[b])) <= 1e-6 * columns[a].length() * columns[b].length())
}

/** Only a stage owner may call this after all geometry/UV/lightmap/probe bindings. */
export function batchStaticStageMeshes(root: THREE.Object3D, options: {
    hasRuntimeOrTransformWriter: boolean
    minimumGroup?: number
    transformAnimations?: StageTransformAnimationProfile
}) {
    if (hasStageTransformBatchUpdater(root)) throw new Error('duplicate instance-matrix owner')
    const batches: Batch[] = []
    const stats: {
        sourceMeshes: number; batchedSourceMeshes: number; batches: number; excludedDynamicStage: boolean
        excludedAnimatedMeshes?: number; animatedBatchedMeshes?: number; dynamicBatches?: number
        dynamicMatrixBytes?: number; matrixUpdateCalls?: number; changedInstances?: number
    } = { sourceMeshes: 0, batchedSourceMeshes: 0, batches: 0, excludedDynamicStage: false }
    let unregisterTransformBatch: (() => void) | undefined
    const restore = () => {
        unregisterTransformBatch?.()
        unregisterTransformBatch = undefined
        for (const batch of batches) {
            batch.sources.forEach(source => {
                source.mesh.layers.mask = source.layers
                delete source.mesh.userData.stageStaticBatchSource
            })
            batch.mesh.removeFromParent()
            batch.mesh.dispose() // shared geometry/material remain owned by source meshes
        }
        batches.length = 0
    }
    let dynamic = options.hasRuntimeOrTransformWriter || root.animations.length > 0
    root.traverse(node => { if ((node as THREE.LOD).isLOD || node.animations.length > 0) dynamic = true })
    if (dynamic) { stats.excludedDynamicStage = true; return { stats, meshes: [] as THREE.InstancedMesh[], restore } }
    const animationPlan = prepareStageTransformAnimations(root, options.transformAnimations)
    const animatedTargets = new Set(animationPlan?.targetObjects ?? [])
    animationPlan?.dispose()
    root.updateWorldMatrix(true, true)
    const inverse = root.matrixWorld.clone().invert()
    const groups = new Map<string, THREE.Mesh[][]>()
    root.traverse(node => {
        const mesh = node as StaticMesh
        if (!mesh.isMesh) return
        stats.sourceMeshes++
        let animated = false
        for (let current: THREE.Object3D | null = mesh; current; current = current.parent) {
            if (animatedTargets.has(current)) animated = true
            if (current === root) break
        }
        if (animated) {
            // Rotating below a non-uniform ancestor can introduce shear. Keep
            // such sources as ordinary meshes; never change geometry/normals.
            for (let parent = mesh.parent; parent && parent !== root; parent = parent.parent) {
                const scale = parent.scale, maximum = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z))
                if (maximum === 0 || Math.max(Math.abs(scale.x - scale.y), Math.abs(scale.x - scale.z)) > maximum * 1e-6) {
                    stats.excludedAnimatedMeshes = (stats.excludedAnimatedMeshes ?? 0) + 1
                    return
                }
            }
        }
        if (mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.isBatchedMesh || mesh.children.length
            || mesh.customDepthMaterial || mesh.customDistanceMaterial || !mesh.visible
            || mesh.userData.stageDynamicVertexPosition || !mesh.frustumCulled
            || mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return
        for (let parent = mesh.parent; parent; parent = parent.parent) {
            if (!parent.visible) return
            if (parent === root) break
        }
        const matrix = inverse.clone().multiply(mesh.matrixWorld)
        if (!positiveOrthogonal(matrix)) return
        const geometry = geometryKey(mesh.geometry), material = materialKey(mesh)
        if (!geometry || !material) return
        const key = JSON.stringify([geometry, material, Array.isArray(mesh.material), mesh.castShadow, mesh.receiveShadow, mesh.layers.mask, mesh.renderOrder])
        const possible = groups.get(key) ?? []
        let group = possible.find(list => equalGeometry(list[0].geometry, mesh.geometry))
        if (!group) { group = []; possible.push(group); groups.set(key, possible) }
        group.push(mesh)
    })
    for (const lists of groups.values()) for (const group of lists) {
        if (group.length < (options.minimumGroup ?? 3)) continue
        // Bounded groups retain coarse frustum granularity instead of merging an
        // entire map into one object. No vertices/instances are discarded.
        for (let start = 0; start < group.length; start += 64) {
            const members = group.slice(start, start + 64), first = members[0]
            if (members.length < (options.minimumGroup ?? 3)) continue
            // Single-slot material arrays still obey geometry.groups; scalar
            // materials render the whole drawRange. Preserve that distinction.
            const mesh = new THREE.InstancedMesh(first.geometry, first.material, members.length)
            mesh.name = `StageStaticBatch:${first.name}:${start}`
            mesh.layers.mask = first.layers.mask
            mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow
            mesh.renderOrder = first.renderOrder
            mesh.userData.stageStaticBatchOwned = true
            mesh.userData.stageStaticBatchInstanceCount = members.length
            members.forEach((source, index) => mesh.setMatrixAt(index, inverse.clone().multiply(source.matrixWorld)))
            mesh.instanceMatrix.needsUpdate = true
            mesh.computeBoundingSphere()
            // Sphere.applyMatrix4 uses the largest column norm, which can
            // underestimate a sheared stage-root transform by up to sqrt(3).
            if (mesh.boundingSphere) mesh.boundingSphere.radius *= Math.sqrt(3)
            root.add(mesh)
            const sources = members.map(source => ({ mesh: source, layers: source.layers.mask }))
            sources.forEach(source => {
                // Keep original paths, visibility and triangles for collisions /
                // source introspection. Only their redundant render submission stops.
                source.mesh.layers.mask = 0
                source.mesh.userData.stageStaticBatchSource = true
            })
            batches.push({ mesh, sources })
            stats.batchedSourceMeshes += members.length
        }
    }
    if (options.transformAnimations) {
        const targets = [...animatedTargets]
        const targetIndices = new Map(targets.map((target, index) => [target, index]))
        const previousRotations = new Float64Array(targets.length * 4)
        const changedTargets = new Uint8Array(targets.length)
        const ownedSources = new Set<THREE.Object3D>()
        const dynamicBatches = batches.map(batch => ({
            batch, entries: batch.sources.flatMap((source, instanceIndex) => {
                const ancestors: number[] = []
                for (let node: THREE.Object3D | null = source.mesh; node && node !== root; node = node.parent) {
                    const index = targetIndices.get(node)
                    if (index != undefined) ancestors.push(index)
                }
                if (!ancestors.length) return []
                ownedSources.add(source.mesh)
                return [{ mesh: source.mesh, instanceIndex, ancestors }]
            }),
        })).filter(batch => batch.entries.length)
        for (let i = 0; i < targets.length; i++) targets[i].quaternion.toArray(previousRotations, i * 4)
        const matrix = new THREE.Matrix4(), inverseRoot = new THREE.Matrix4()
        for (const { batch } of dynamicBatches) {
            batch.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
            batch.mesh.computeBoundingBox()
            // The sphere exists from initial construction; updates reuse it.
        }
        stats.excludedAnimatedMeshes ??= 0
        stats.animatedBatchedMeshes = ownedSources.size
        stats.dynamicBatches = dynamicBatches.length
        stats.dynamicMatrixBytes = dynamicBatches.reduce((sum, entry) => sum + entry.batch.mesh.instanceMatrix.array.byteLength, 0)
        stats.matrixUpdateCalls = 0
        stats.changedInstances = 0
        const update = (force = false) => {
            let changed = force
            for (let i = 0; i < targets.length; i++) {
                const q = targets[i].quaternion, offset = i * 4
                const dirty = force || q.x !== previousRotations[offset] || q.y !== previousRotations[offset + 1]
                    || q.z !== previousRotations[offset + 2] || q.w !== previousRotations[offset + 3]
                changedTargets[i] = dirty ? 1 : 0
                changed ||= dirty
                q.toArray(previousRotations, offset)
            }
            if (!changed) return
            root.updateWorldMatrix(true, true)
            inverseRoot.copy(root.matrixWorld).invert()
            let changedInstances = 0
            for (const { batch, entries } of dynamicBatches) {
                let dirtyBatch = false
                for (const entry of entries) {
                    let dirty = force
                    for (let i = 0; !dirty && i < entry.ancestors.length; i++) {
                        dirty = changedTargets[entry.ancestors[i]] !== 0
                    }
                    if (!dirty) continue
                    matrix.multiplyMatrices(inverseRoot, entry.mesh.matrixWorld)
                    batch.mesh.setMatrixAt(entry.instanceIndex, matrix)
                    changedInstances++
                    dirtyBatch = true
                }
                if (!dirtyBatch) continue
                batch.mesh.instanceMatrix.needsUpdate = true
                batch.mesh.computeBoundingBox()
                batch.mesh.computeBoundingSphere()
                if (batch.mesh.boundingSphere) batch.mesh.boundingSphere.radius *= Math.sqrt(3)
            }
            stats.matrixUpdateCalls!++
            stats.changedInstances = changedInstances
        }
        unregisterTransformBatch = registerStageTransformBatchUpdater(
            root, options.transformAnimations, ownedSources, update,
        )
    }
    stats.batches = batches.length
    return { stats, meshes: batches.map(batch => batch.mesh), restore }
}
