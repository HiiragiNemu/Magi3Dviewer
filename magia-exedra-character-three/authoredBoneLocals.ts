import * as THREE from 'three'

export interface ParsedBoneLocal {
    position: [number, number, number]
    rotation: [number, number, number, number]
    scale: [number, number, number]
}
interface BoneWitness {
    parent: THREE.Object3D | null
    vectors: readonly unknown[]
    local: ParsedBoneLocal
}
const parsedRoots = new WeakMap<THREE.Object3D, {uuid: string; bones: Map<THREE.Object3D, BoneWitness>}>()

/** Loader-only seam: call immediately after parsing, before any controller/mixer/user callback. */
export function registerParsedBoneLocals(root: THREE.Object3D): void {
    if (parsedRoots.has(root)) return // Never recapture a displayed/manual pose.
    const bones = new Map<THREE.Object3D, BoneWitness>()
    root.traverse(object => {
        if (!(object as THREE.Bone).isBone) return
        const local: ParsedBoneLocal = {position: object.position.toArray(), rotation: object.quaternion.toArray(), scale: object.scale.toArray()}
        if (![...local.position, ...local.rotation, ...local.scale].every(Number.isFinite)
            || local.scale.some(value => value === 0) || object.quaternion.lengthSq() < 1e-12) return
        const matrix = new THREE.Matrix4().compose(object.position, object.quaternion, object.scale)
        if (!object.matrix.elements.every((value, i) => Number.isFinite(value) && Math.abs(value - matrix.elements[i]) < 1e-7)) return
        bones.set(object, {parent: object.parent, vectors: [object.position, object.quaternion, object.scale], local})
    })
    parsedRoots.set(root, {uuid: root.uuid, bones})
}

/** Exact source-local input, not current display, inferred identity, or a mesh transform. */
export function readParsedBoneLocal(root: THREE.Object3D, bone: THREE.Object3D): ParsedBoneLocal | undefined {
    const source = parsedRoots.get(root), witness = source?.bones.get(bone)
    if (!source || source.uuid !== root.uuid || !witness || !(bone as THREE.Bone).isBone || bone.parent !== witness.parent
        || [bone.position, bone.quaternion, bone.scale].some((value, i) => value !== witness.vectors[i])) return undefined
    for (let parent: THREE.Object3D | null = bone; parent; parent = parent.parent) {
        if (parent === root) return {position: [...witness.local.position], rotation: [...witness.local.rotation], scale: [...witness.local.scale]}
    }
    return undefined
}
