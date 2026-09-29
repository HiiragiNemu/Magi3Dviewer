import { Bone, Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three'

interface JointRule { rest: Quaternion; direction: Vector3; hinge?: Vector3; swing: number; twist: number; flexion: number }
const rules = new WeakMap<Bone, JointRule>()
const registered = new WeakSet<Object3D>()
const rad = (degrees: number) => degrees * Math.PI / 180
const excluded = /twist|roll|assist|hair|cloth|skirt|ribbon|finger|thumb|index|pinky|weapon|dummy|nub|end/i
const isBone = (node: Object3D): node is Bone => (node as Bone).isBone === true
const angle = (a: Quaternion, b: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)) / Math.sqrt(a.lengthSq() * b.lengthSq())))
const signedAngle = (q: Quaternion, axis: Vector3) => {
    let value = 2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w)
    if (value > Math.PI) value -= 2 * Math.PI
    if (value < -Math.PI) value += 2 * Math.PI
    return value
}

/** Persistent bind-space limits, not per-drag limits that permit cumulative twist.
 * Only semantic human joints are constrained; native animation is not rewritten. */
export function registerPoseJointLimits(actor: Object3D): void {
    if (registered.has(actor)) return
    registered.add(actor)
    actor.updateWorldMatrix(true, true)
    const bindWorld = new Map<Bone, Matrix4>()
    actor.traverse(node => {
        const mesh = node as SkinnedMesh
        if (!mesh.isSkinnedMesh) return
        mesh.skeleton.bones.forEach((bone, i) => {
            const inverse = mesh.skeleton.boneInverses[i]
            if (inverse && !bindWorld.has(bone)) bindWorld.set(bone, inverse.clone().invert())
        })
    })
    const forward = new Vector3(0, 0, 1).transformDirection(actor.matrixWorld)
    actor.traverse(node => {
        if (!isBone(node) || excluded.test(node.name)) return
        const name = node.name
        const hand = /hand|wrist/i.test(name), foot = /foot|ankle/i.test(name)
        const elbow = /forearm|lowerarm|elbow/i.test(name)
        const knee = /calf|shin|lowerleg|knee|(?:^|[_. :/\-])leg(?:$|[_. :/\-])/i.test(name)
        const arm = /upperarm|(?:^|[_. :/\-])arm(?:$|[_. :/\-])/i.test(name)
        const thigh = /thigh|upperleg|upleg/i.test(name)
        const head = /head|neck/i.test(name), torso = /spine|chest|waist|pelvis|hips?/i.test(name)
        if (!(hand || foot || elbow || knee || arm || thigh || head || torso)) return
        const world = bindWorld.get(node) ?? node.matrixWorld.clone()
        const parentWorld = isBone(node.parent ?? actor) ? bindWorld.get(node.parent as Bone) : undefined
        const rest = parentWorld
            ? new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(new Matrix4().copy(parentWorld).invert().multiply(world))).normalize()
            : node.quaternion.clone().normalize()
        const child = node.children.find(c => isBone(c) && c.position.lengthSq() > 1e-10 && !/twist|roll|assist|dummy|nub/i.test(c.name))
        const direction = child ? child.position.clone().normalize() : new Vector3(0, 1, 0)
        const rule: JointRule = { rest, direction, swing: rad(75), twist: rad(65), flexion: rad(145) }
        if (arm) { rule.swing = rad(140); rule.twist = rad(90) }
        if (thigh) { rule.swing = rad(105); rule.twist = rad(45) }
        if (head) { rule.swing = rad(55); rule.twist = rad(75) }
        if (torso) { rule.swing = rad(35); rule.twist = rad(40) }
        if (foot) { rule.swing = rad(45); rule.twist = rad(30) }
        if (elbow || knee) {
            const bend = forward.clone().multiplyScalar(knee ? -1 : 1).transformDirection(world.clone().invert())
            const hinge = new Vector3().crossVectors(direction, bend)
            if (hinge.lengthSq() > 1e-8) rule.hinge = hinge.normalize()
            rule.flexion = rad(knee ? 145 : 150)
        }
        rules.set(node, rule)
    })
}

export function clampPoseJoint(bone: Bone): boolean {
    const rule = rules.get(bone)
    if (!rule) return false
    const previous = bone.quaternion.clone().normalize()
    if (![previous.x, previous.y, previous.z, previous.w].every(Number.isFinite)) { bone.quaternion.copy(rule.rest); return true }
    const delta = rule.rest.clone().invert().multiply(previous).normalize()
    if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
    if (rule.hinge) {
        const flex = Math.max(0, Math.min(rule.flexion, signedAngle(delta, rule.hinge)))
        bone.quaternion.copy(rule.rest).multiply(new Quaternion().setFromAxisAngle(rule.hinge, flex)).normalize()
    } else {
        const projection = delta.x * rule.direction.x + delta.y * rule.direction.y + delta.z * rule.direction.z
        const twist = new Quaternion(rule.direction.x * projection, rule.direction.y * projection, rule.direction.z * projection, delta.w)
        if (twist.lengthSq() < 1e-12) twist.identity(); else twist.normalize()
        const swing = delta.clone().multiply(twist.clone().invert()).normalize()
        const swingAngle = 2 * Math.acos(Math.min(1, Math.abs(swing.w)))
        if (swingAngle > rule.swing) swing.slerp(new Quaternion(), 1 - rule.swing / swingAngle)
        const twistAngle = Math.max(-rule.twist, Math.min(rule.twist, signedAngle(twist, rule.direction)))
        bone.quaternion.copy(rule.rest).multiply(swing).multiply(new Quaternion().setFromAxisAngle(rule.direction, twistAngle)).normalize()
    }
    bone.updateWorldMatrix(false, false)
    return angle(previous, bone.quaternion) > 1e-6
}

/** Orient the hinge plane by rolling the upper limb, not by bending the elbow sideways. */
export function alignPoseHinge(upper: Bone, lower: Bone, worldTarget: Vector3): void {
    const rule = rules.get(lower)
    if (!rule?.hinge || !lower.parent || !upper.parent) return
    const origin = upper.getWorldPosition(new Vector3()), elbow = lower.getWorldPosition(new Vector3())
    const axis = elbow.clone().sub(origin).normalize()
    const desired = new Vector3().crossVectors(axis, worldTarget.clone().sub(elbow))
    if (desired.lengthSq() < 1e-12) return
    desired.normalize()
    const current = rule.hinge.clone().applyQuaternion(rule.rest).applyQuaternion(lower.parent.getWorldQuaternion(new Quaternion()))
    current.addScaledVector(axis, -current.dot(axis))
    if (current.lengthSq() < 1e-12) return
    current.normalize()
    const theta = Math.atan2(axis.dot(new Vector3().crossVectors(current, desired)), current.dot(desired))
    const parent = upper.parent.getWorldQuaternion(new Quaternion())
    const rotation = parent.clone().invert().multiply(new Quaternion().setFromAxisAngle(axis, theta)).multiply(parent)
    upper.quaternion.premultiply(rotation).normalize()
    upper.updateWorldMatrix(false, true)
    lower.quaternion.copy(rule.rest)
    lower.updateWorldMatrix(false, true)
}

export function constrainBendPole(pole: Vector3, axis: Vector3, preferred: Vector3): void {
    const natural = preferred.clone().addScaledVector(axis, -preferred.dot(axis))
    if (natural.lengthSq() < 1e-10) return
    natural.normalize()
    const theta = Math.acos(Math.max(-1, Math.min(1, natural.dot(pole)))), limit = rad(80)
    if (theta <= limit) return
    const turn = new Vector3().crossVectors(natural, pole)
    if (turn.lengthSq() < 1e-10) turn.copy(axis)
    pole.copy(natural).applyAxisAngle(turn.normalize(), limit).normalize()
}

export function poseJointLimitSnapshot(bone: Bone) {
    const rule = rules.get(bone)
    if (!rule) return undefined
    const delta = rule.rest.clone().invert().multiply(bone.quaternion).normalize()
    return { name: bone.name, hinge: !!rule.hinge, flexion: rule.hinge ? signedAngle(delta, rule.hinge) : undefined,
        maximumFlexion: rule.flexion, rest: rule.rest.toArray(), quaternion: bone.quaternion.toArray() }
}
