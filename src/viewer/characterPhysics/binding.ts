import * as THREE from 'three'
import type {
    CharacterPhysicsClothProduct,
    CharacterPhysicsProfile,
    UnityTransformBinding,
} from './types'

export interface ExactPhysicsBindingRegistry {
    resolve(stableKey: string): THREE.Object3D | undefined
    subscribe?(listener: () => void): () => void
}

export interface MutableExactPhysicsBindingRegistry extends ExactPhysicsBindingRegistry {
    register(stableKey: string, object: THREE.Object3D): () => void
    unregister(stableKey: string, object?: THREE.Object3D): void
    clear(): void
    subscribe(listener: () => void): () => void
}

export function createExactPhysicsBindingRegistry(): MutableExactPhysicsBindingRegistry {
    const values = new Map<string, THREE.Object3D>()
    const listeners = new Set<() => void>()
    const notify = (): void => {
        for (const listener of [...listeners]) listener()
    }
    return {
        resolve(stableKey) {
            return values.get(stableKey)
        },
        register(stableKey, object) {
            const existing = values.get(stableKey)
            if (existing && existing !== object) {
                throw new Error(`character-physics-external-binding-conflict:${stableKey}`)
            }
            values.set(stableKey, object)
            if (existing !== object) notify()
            return () => {
                if (values.get(stableKey) === object) {
                    values.delete(stableKey)
                    notify()
                }
            }
        },
        unregister(stableKey, object) {
            if ((!object || values.get(stableKey) === object) && values.delete(stableKey)) {
                notify()
            }
        },
        clear() {
            if (!values.size) return
            values.clear()
            notify()
        },
        subscribe(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
}

export interface ResolvedCharacterPhysicsBindings {
    byStableKey: ReadonlyMap<string, THREE.Object3D>
    writableBones: ReadonlySet<THREE.Bone>
    clothRoots: ReadonlyMap<string, readonly THREE.Bone[]>
    missingBindings: readonly string[]
    duplicateBindings: readonly string[]
}

interface ExactPathIndex {
    matches: ReadonlyMap<string, readonly THREE.Object3D[]>
}

const POSITION_EPSILON_SQUARED = 1e-8
const SCALE_EPSILON_SQUARED = 1e-8
const ROTATION_EPSILON_RADIANS = 2e-4

function buildExactPathIndex(root: THREE.Object3D): ExactPathIndex {
    const values = new Map<string, THREE.Object3D[]>()
    const add = (path: string, object: THREE.Object3D): void => {
        const current = values.get(path)
        if (current) current.push(object)
        else values.set(path, [object])
    }
    root.traverse(object => {
        const parts: string[] = []
        let current: THREE.Object3D | null = object
        while (current && current !== root.parent) {
            if (current.name) parts.push(current.name)
            current = current.parent
        }
        const full = parts.reverse()
        for (let index = 0; index < full.length; index += 1) {
            add(full.slice(index).join('/'), object)
        }
    })
    return { matches: values }
}

function bindingPaths(
    binding: UnityTransformBinding,
    additionalExactPaths: readonly string[] = [],
): readonly string[] {
    const authoredPaths = [
        binding.visualRootRelativePath,
        binding.modelRelativePath,
        binding.hierarchyPath,
        ...additionalExactPaths,
    ]
        .filter((value): value is string => Boolean(value))
    const fbxLoaderPaths = authoredPaths.map(path => path
        .split('/')
        .map(part => THREE.PropertyBinding.sanitizeNodeName(part))
        .join('/'))
    return [...authoredPaths, ...fbxLoaderPaths]
        .filter((value, index, values) => values.indexOf(value) === index)
}

function matchesPublishedLocalTrs(
    object: THREE.Object3D,
    binding: UnityTransformBinding,
): boolean {
    const trs = binding.localTRS
    if (!trs) return false
    const expectedPosition = new THREE.Vector3(
        -trs.localPosition.x,
        trs.localPosition.y,
        trs.localPosition.z,
    )
    const expectedScale = new THREE.Vector3(
        trs.localScale.x,
        trs.localScale.y,
        trs.localScale.z,
    )
    // Reflecting Unity X changes q=(x,y,z,w) to (x,-y,-z,w).
    const expectedRotation = new THREE.Quaternion(
        trs.localRotation.x,
        -trs.localRotation.y,
        -trs.localRotation.z,
        trs.localRotation.w,
    ).normalize()
    return object.position.distanceToSquared(expectedPosition) <= POSITION_EPSILON_SQUARED
        && object.scale.distanceToSquared(expectedScale) <= SCALE_EPSILON_SQUARED
        && object.quaternion.angleTo(expectedRotation) <= ROTATION_EPSILON_RADIANS
}

function resolveExact(
    index: ExactPathIndex,
    binding: UnityTransformBinding,
    external?: ExactPhysicsBindingRegistry,
    additionalExactPaths: readonly string[] = [],
): Readonly<{ object?: THREE.Object3D; duplicate?: string }> {
    const registered = external?.resolve(binding.stableKey)
    if (registered) return { object: registered }
    for (const path of bindingPaths(binding, additionalExactPaths)) {
        const matches = index.matches.get(path) ?? []
        if (matches.length === 1) return { object: matches[0] }
        if (matches.length > 1) {
            const exactTrsMatches = matches.filter(object =>
                matchesPublishedLocalTrs(object, binding))
            if (exactTrsMatches.length === 1) return { object: exactTrsMatches[0] }
            return { duplicate: `${binding.stableKey}|${path}|localTRS:${exactTrsMatches.length}/${matches.length}` }
        }
    }
    return {}
}

function isPublishedIdentityTransform(binding: UnityTransformBinding): boolean {
    const trs = binding.localTRS
    if (!trs) return false
    const positionMagnitudeSquared = trs.localPosition.x ** 2
        + trs.localPosition.y ** 2
        + trs.localPosition.z ** 2
    const scaleDeltaSquared = (trs.localScale.x - 1) ** 2
        + (trs.localScale.y - 1) ** 2
        + (trs.localScale.z - 1) ** 2
    const rotationVectorSquared = trs.localRotation.x ** 2
        + trs.localRotation.y ** 2
        + trs.localRotation.z ** 2
    return positionMagnitudeSquared <= POSITION_EPSILON_SQUARED
        && scaleDeltaSquared <= SCALE_EPSILON_SQUARED
        && rotationVectorSquared <= ROTATION_EPSILON_RADIANS ** 2
        && Math.abs(Math.abs(trs.localRotation.w) - 1) <= ROTATION_EPSILON_RADIANS
}

function resolveClothCenter(
    index: ExactPathIndex,
    cloth: CharacterPhysicsClothProduct,
    publishedBindingByStableKey: ReadonlyMap<string, UnityTransformBinding>,
    external?: ExactPhysicsBindingRegistry,
): Readonly<{ object?: THREE.Object3D; duplicate?: string }> {
    const direct = resolveExact(index, cloth.binding, external)
    if (direct.object || direct.duplicate) return direct

    // New products publish every exact Transform connected to the authored
    // center by identity-only local edges. This includes an identity sibling
    // branch retained by older FBX exporters when the empty MagicaCloth/yure
    // branch itself was omitted. The bridge is official data and is rechecked
    // here; a non-identity or missing bridge always remains fail-closed.
    let candidateDuplicate: string | undefined
    for (const candidate of cloth.centerTransformCandidates ?? []) {
        const bridgeBindings: UnityTransformBinding[] = []
        let bridgeReady = true
        for (const stableKey of candidate.identityBridgeStableKeys) {
            const binding = stableKey === cloth.binding.stableKey
                ? cloth.binding
                : publishedBindingByStableKey.get(stableKey)
            if (!binding || !isPublishedIdentityTransform(binding)) {
                bridgeReady = false
                break
            }
            bridgeBindings.push(binding)
        }
        if (!bridgeReady || bridgeBindings.length !== candidate.identityBridgeStableKeys.length) {
            continue
        }
        const binding = candidate.bindingStableKey === cloth.binding.stableKey
            ? cloth.binding
            : publishedBindingByStableKey.get(candidate.bindingStableKey)
        if (!binding) continue
        const resolved = resolveExact(
            index,
            binding,
            external,
            candidate.exactExportRelativePath ? [candidate.exactExportRelativePath] : [],
        )
        if (resolved.object) return resolved
        candidateDuplicate ??= resolved.duplicate
    }
    if (candidateDuplicate) return { duplicate: candidateDuplicate }

    const ancestryKeys = cloth.centerTransformBindingStableKeys?.length
        ? cloth.centerTransformBindingStableKeys
        : [cloth.binding.stableKey]
    const ancestry: UnityTransformBinding[] = []
    for (const stableKey of ancestryKeys) {
        const binding = stableKey === cloth.binding.stableKey
            ? cloth.binding
            : publishedBindingByStableKey.get(stableKey)
        if (!binding) return {}
        ancestry.push(binding)
    }
    let omittedSuffixIsIdentity = true
    for (let indexInChain = 1; indexInChain < ancestry.length; indexInChain += 1) {
        omittedSuffixIsIdentity = omittedSuffixIsIdentity
            && isPublishedIdentityTransform(ancestry[indexInChain - 1]!)
        if (!omittedSuffixIsIdentity) break
        const ancestor = resolveExact(index, ancestry[indexInChain]!, external)
        if (ancestor.object || ancestor.duplicate) return ancestor
    }
    return {}
}

function bindCloth(
    index: ExactPathIndex,
    cloth: CharacterPhysicsClothProduct,
    publishedBindingByStableKey: ReadonlyMap<string, UnityTransformBinding>,
    byStableKey: Map<string, THREE.Object3D>,
    writableBones: Set<THREE.Bone>,
    missing: string[],
    duplicates: string[],
    external?: ExactPhysicsBindingRegistry,
): readonly THREE.Bone[] {
    const roots: THREE.Bone[] = []
    const resolvedRootKeys = new Set<string>()
    const rootKeys = new Set(cloth.rootBoneBindings.map(binding => binding.stableKey))

    // MagicaCloth's moving center is the Transform that owns the component
    // (VirtualMesh.centerTransformIndex), not the parent of an authored chain
    // root. The latter is often an animated Head/Spine/Hip bone and feeding it
    // back as the center injects locomotion keyframes into every secondary
    // chain. Resolve the published component binding with the same exact-path
    // policy used by chain and collider bindings. Older Viewer FBX products can
    // omit empty Unity center objects, so an exact published ancestor may stand
    // in only while every omitted official local TRS is identity.
    const center = resolveClothCenter(
        index,
        cloth,
        publishedBindingByStableKey,
        external,
    )
    if (center.duplicate) duplicates.push(center.duplicate)
    else if (center.object) {
        byStableKey.set(cloth.stableKey, center.object)
        byStableKey.set(cloth.binding.stableKey, center.object)
    } else missing.push(`${cloth.stableKey}|center:${cloth.binding.stableKey}`)

    for (const binding of cloth.chainBindings) {
        const resolved = resolveExact(index, binding, external)
        if (resolved.duplicate) {
            duplicates.push(resolved.duplicate)
            continue
        }
        if (!resolved.object) {
            missing.push(binding.stableKey)
            continue
        }
        byStableKey.set(binding.stableKey, resolved.object)
        if ((resolved.object as THREE.Bone).isBone) {
            const bone = resolved.object as THREE.Bone
            writableBones.add(bone)
            if (rootKeys.has(binding.stableKey) && !resolvedRootKeys.has(binding.stableKey)) {
                roots.push(bone)
                resolvedRootKeys.add(binding.stableKey)
            }
        } else if (rootKeys.has(binding.stableKey)) {
            missing.push(`${binding.stableKey}|root-resolved-object-is-not-bone`)
        }
    }
    return roots
}

export function resolveCharacterPhysicsBindings(
    root: THREE.Object3D,
    profile: CharacterPhysicsProfile,
    external?: ExactPhysicsBindingRegistry,
): ResolvedCharacterPhysicsBindings {
    const index = buildExactPathIndex(root)
    const byStableKey = new Map<string, THREE.Object3D>()
    const writableBones = new Set<THREE.Bone>()
    const clothRoots = new Map<string, readonly THREE.Bone[]>()
    const missingBindings: string[] = []
    const duplicateBindings: string[] = []
    const publishedBindingByStableKey = new Map(
        profile.physicsTransformBindings.map(binding => [binding.stableKey, binding]),
    )

    for (const cloth of profile.components.cloth) {
        if (cloth.runtimeBinding.status !== 'runtime-ready') continue
        const roots = bindCloth(
            index,
            cloth,
            publishedBindingByStableKey,
            byStableKey,
            writableBones,
            missingBindings,
            duplicateBindings,
            external,
        )
        if (roots.length !== cloth.rootBoneBindings.length) {
            missingBindings.push(`${cloth.stableKey}|root-count:${roots.length}/${cloth.rootBoneBindings.length}`)
        }
        clothRoots.set(cloth.stableKey, roots)
    }

    for (const collider of profile.components.colliders) {
        if (!Object.values(collider.activation).every(Boolean)) continue
        const resolved = resolveExact(index, collider.binding, external)
        if (resolved.duplicate) duplicateBindings.push(resolved.duplicate)
        else if (resolved.object) byStableKey.set(collider.stableKey, resolved.object)
        else missingBindings.push(collider.stableKey)
    }

    for (const cloth of profile.components.cloth) {
        if (cloth.runtimeBinding.status !== 'runtime-ready') continue
        for (const binding of cloth.collisionBoneBindings) {
            const resolved = resolveExact(index, binding, external)
            if (resolved.duplicate) duplicateBindings.push(resolved.duplicate)
            else if (resolved.object) byStableKey.set(binding.stableKey, resolved.object)
            else missingBindings.push(`${cloth.stableKey}|collision-bone:${binding.stableKey}`)
        }
    }

    for (const windZone of profile.components.windZones) {
        if (!Object.values(windZone.activation).every(Boolean)) continue
        const resolved = resolveExact(index, windZone.binding, external)
        if (resolved.duplicate) duplicateBindings.push(resolved.duplicate)
        else if (resolved.object) byStableKey.set(windZone.stableKey, resolved.object)
        else if (windZone.scope === 'persistent-model') missingBindings.push(windZone.stableKey)
    }

    for (const native of profile.components.native) {
        if (!Object.values(native.activation).every(Boolean)) continue
        const resolved = resolveExact(index, native.binding, external)
        if (resolved.duplicate) duplicateBindings.push(resolved.duplicate)
        else if (resolved.object) byStableKey.set(native.stableKey, resolved.object)
        else if (
            native.scope === 'persistent-model'
            && native.binding.hierarchyPath === profile.identity.resourceName
        ) {
            // The AssetBundle root GameObject is the loaded FBX root even when
            // FBXLoader does not preserve that wrapper name.  This is an exact
            // profile identity join, not a name or character-ID fallback.
            byStableKey.set(native.stableKey, root)
        }
        else if (native.scope === 'persistent-model') missingBindings.push(native.stableKey)
    }

    return {
        byStableKey,
        writableBones,
        clothRoots,
        missingBindings,
        duplicateBindings,
    }
}
