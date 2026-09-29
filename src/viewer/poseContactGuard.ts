import { Bone, Object3D, Vector3 } from 'three'
import type { EditorGroundGuard } from './editorGround'

/** Coarse torso exclusion for direct hand targets; not a cloth/skin collision
 * simulation. It only projects the user-controlled point, not the actor root. */
export function createPoseContactGuard(actor: Object3D, ground: EditorGroundGuard) {
    let hip: Bone | undefined, chest: Bone | undefined
    const shoulders: Bone[] = []
    actor.traverse(node => {
        const b = node as Bone
        if (!b.isBone) return
        if (!hip && /^(?:hip|hips|pelvis)$/i.test(b.name)) hip = b
        if (!chest && /^chest$/i.test(b.name)) chest = b
        if (/^shoulder[_. -][lr]$/i.test(b.name)) shoulders.push(b)
    })
    const a = new Vector3(), b = new Vector3(), axis = new Vector3(), nearest = new Vector3()
    return (point: Vector3, bone: Bone): boolean => {
        const old = point.clone(), root = actor.getWorldPosition(new Vector3())
        const floor = ground.sample(point.x, point.z, root.y).height
        const clearance = /foot|ankle/i.test(bone.name) ? 0.065 * Math.max(0.1, actor.getWorldScale(new Vector3()).y) : 0.015
        point.y = Math.max(floor + clearance, point.y)
        if (/hand|wrist/i.test(bone.name) && hip && chest && shoulders.length >= 2) {
            hip.getWorldPosition(a); chest.getWorldPosition(b); axis.copy(b).sub(a)
            const length = axis.lengthSq()
            if (length > 1e-8) {
                const t = Math.max(0, Math.min(1, point.clone().sub(a).dot(axis) / length))
                nearest.copy(a).addScaledVector(axis, t)
                const radial = point.clone().sub(nearest)
                const radius = Math.max(0.035, shoulders[0].getWorldPosition(new Vector3()).distanceTo(shoulders[1].getWorldPosition(new Vector3())) * 0.42)
                if (radial.lengthSq() < radius * radius) {
                    if (radial.lengthSq() < 1e-10) radial.set(0, 0, 1).transformDirection(actor.matrixWorld)
                    point.copy(nearest).addScaledVector(radial.normalize(), radius)
                }
            }
        }
        return point.distanceToSquared(old) > 1e-12
    }
}
