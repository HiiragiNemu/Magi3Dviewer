import * as THREE from 'three'

export interface MovementTarget {
    object: THREE.Object3D
    label: string
    changed?(): void
}

/** One user selection shared by the arrow pad and all scene object kinds. */
export class ObjectMovementSelection {
    current?: MovementTarget
    private readonly defaults = new WeakMap<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>()
    private readonly blocked: (object: THREE.Object3D) => boolean
    private readonly constrain: (object: THREE.Object3D) => void
    constructor(blocked: (object: THREE.Object3D) => boolean = () => false, constrain: (object: THREE.Object3D) => void = () => {}) { this.blocked = blocked; this.constrain = constrain }
    remember(object: THREE.Object3D, replace = false) {
        if (!replace && this.defaults.has(object)) return
        this.defaults.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() })
    }
    select(target: MovementTarget) { this.remember(target.object); this.current = target }
    forget(object?: THREE.Object3D) { if (!object || this.current?.object === object) this.current = undefined }
    private edit(apply: (object: THREE.Object3D) => void) {
        const target = this.current
        if (!target || !target.object.parent || this.blocked(target.object)) return
        apply(target.object); this.constrain(target.object); target.object.updateMatrixWorld(true); target.changed?.()
    }
    move(camera: THREE.Camera, horizontal: number, vertical: number, depth = 0) {
        this.edit(object => {
            camera.updateMatrixWorld()
            const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
            right.y = 0
            if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
            right.normalize()
            const forward = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), right)
            const offset = right.multiplyScalar(horizontal).addScaledVector(forward, depth)
            offset.y += vertical
            // Convert a world-space delta to the selected object's parent, including parent scale.
            if (object.parent) {
                object.parent.updateWorldMatrix(true, false)
                const origin = object.getWorldPosition(new THREE.Vector3())
                offset.copy(object.parent.worldToLocal(origin.clone().add(offset))).sub(object.parent.worldToLocal(origin))
            }
            object.position.add(offset)
        })
    }
    rotate(delta: number) { this.edit(object => object.rotateY(delta)) }
    tilt(camera: THREE.Camera, delta: number) {
        this.edit(object => {
            const axis = camera.getWorldDirection(new THREE.Vector3()).normalize()
            if (object.parent) axis.applyQuaternion(object.parent.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize()
            object.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, delta))
        })
    }
    reset(teleport?: (object: THREE.Object3D, position: THREE.Vector3, quaternion: THREE.Quaternion) => boolean) {
        this.edit(object => {
            const initial = this.defaults.get(object)
            if (!initial) return
            if (!teleport?.(object, initial.position, initial.quaternion)) {
                object.position.copy(initial.position); object.quaternion.copy(initial.quaternion)
            }
            object.scale.copy(initial.scale)
        })
    }
}

/** Raycast all kinds together, so a weapon in front of a character wins the same click. */
export function pickMovementTarget<T extends { object: THREE.Object3D }>(raycaster: THREE.Raycaster, targets: readonly T[]): T | undefined {
    const roots = new Map(targets.map(target => [target.object, target]))
    for (const hit of raycaster.intersectObjects([...roots.keys()], true)) {
        let object: THREE.Object3D | null = hit.object
        let target: T | undefined
        let visible = true
        while (object) {
            visible &&= object.visible
            target ??= roots.get(object)
            object = object.parent
        }
        if (target && visible) return target
    }
    return undefined
}
