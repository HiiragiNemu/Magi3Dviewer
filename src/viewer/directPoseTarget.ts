import { Bone, Matrix4, Object3D, Quaternion, Vector3 } from 'three'

import { registerPoseJointLimits, clampPoseJoint, alignPoseHinge, constrainBendPole } from './poseJointLimits'

export type DirectPoseMode = 'translate' | 'rotate'
const isBone = (object: Object3D | null): object is Bone => !!object && (object as Bone).isBone === true
const isAnchor = (bone: Bone) => /root|pelvis|spine|chest|waist|center|(?:^|[_:.\-])(hips?)(?:$|[_:.\-])/i.test(bone.name)
const uniformScale = (bone: Bone) => Math.abs(bone.scale.x - bone.scale.y) < 1e-8 && Math.abs(bone.scale.x - bone.scale.z) < 1e-8 && bone.scale.x > 0
const finiteVector = (value: Vector3) => Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
const finiteQuaternion = (value: Quaternion) => Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z) && Number.isFinite(value.w) && value.lengthSq() > 1e-16

/** Rotate only adjacent joints; never translate a skeletal joint, cross the
 * pelvis/spine, or move the character root as an IK fallback. */
export function directPoseTranslationJoints(actor: Object3D, bone: Bone, blocked: (bone: Bone) => boolean = () => false): Bone[] {
    if (isAnchor(bone) || blocked(bone)) return []
    let owner: Object3D | null = bone
    while (owner && owner !== actor) owner = owner.parent
    if (!owner) return []
    const joints: Bone[] = []
    const semantic = /hand|wrist/i.test(bone.name)
        ? [/forearm|lowerarm|elbow/i, /upperarm|(?:^|[_. :/-])arm(?:$|[_. :/-])/i]
        : /foot|ankle/i.test(bone.name) ? [/calf|shin|lowerleg|knee|(?:^|[_. :/\-])leg(?:$|[_. :/\-])/i, /thigh|upperleg|upleg/i] : undefined
    if (semantic) {
        let node = bone.parent
        for (const pattern of semantic) {
            while (isBone(node) && node !== actor && !isAnchor(node)) {
                if (blocked(node)) return []
                const candidate = node
                node = node.parent
                if (pattern.test(candidate.name) && !/twist|roll|assist/i.test(candidate.name)) {
                    joints.unshift(candidate)
                    break
                }
            }
        }
        if (joints.length === 2) return joints
        joints.length = 0
    }
    if (/forearm|lowerarm|elbow|calf|shin|lowerleg|knee|(?:^|[_. :/\-])leg(?:$|[_. :/\-])/i.test(bone.name)) return []
    let parent = bone.parent
    while (isBone(parent) && parent !== actor && isBone(parent.parent) && joints.length < 2) {
        if (isAnchor(parent)) break
        if (blocked(parent)) return []
        joints.unshift(parent)
        parent = parent.parent
    }
    return joints
}

/** A bounded manipulation transaction. TransformControls owns `handle`, NOT
 * a bone. Pointer events queue input; the viewer flushes at most once/frame.
 * Each solution starts from the drag-start pose, never last frame's output. */
export class DirectPoseTarget {
    readonly handle = new Object3D()
    readonly joints: Bone[]
    private readonly rotationBones: readonly Bone[]
    limited = false
    projectPosition?: (point: Vector3, bone: Bone) => boolean
    preserveEndOrientation = false
    bendAngle = 0
    private readonly bendReference = new Vector3()
    private readonly preferredBend = new Vector3()
    private readonly orientationBones: readonly Bone[]
    private mode: DirectPoseMode = 'rotate'
    private active = false
    private dirty = false
    private readonly starts = new Map<Bone, Quaternion>()
    private readonly startLocal = new Quaternion()
    private readonly startWorld = new Quaternion()
    private readonly desiredPosition = new Vector3()
    private readonly desiredQuaternion = new Quaternion()
    private readonly inverse = new Matrix4()
    private readonly frame = new Matrix4()
    private readonly origin = new Vector3()
    private readonly middle = new Vector3()
    private readonly tip = new Vector3()
    private readonly goal = new Vector3()
    private readonly axis = new Vector3()
    private readonly pole = new Vector3()
    private readonly elbow = new Vector3()
    private readonly target = new Vector3()
    private readonly from = new Vector3()
    private readonly to = new Vector3()
    private readonly rotation = new Quaternion()
    /** Counts actual solves, not input events, for regression evidence. */
    solves = 0

    readonly actor: Object3D
    readonly bone: Bone
    private readonly blocked: (bone: Bone) => boolean

    constructor(actor: Object3D, bone: Bone, blocked: (bone: Bone) => boolean = () => false) {
        registerPoseJointLimits(actor)
        this.actor = actor
        this.bone = bone
        this.blocked = blocked
        this.rotationBones = [bone]
        this.joints = directPoseTranslationJoints(actor, bone, blocked)
        this.orientationBones = [...this.joints, bone]
        this.handle.name = 'MagiusDirectPoseInput'
        this.sync()
    }

    get canTranslate() { return this.joints.length > 0 }
    get pending() { return this.dirty }
    get dragging() { return this.active }
    get editedBones(): readonly Bone[] { return this.mode === 'translate' ? (this.preserveEndOrientation ? this.orientationBones : this.joints) : this.rotationBones }

    sync() {
        // Publish the FINAL rendered pivot, including upstream manual edits.
        // During a gesture keep the input orientation and queued target intact;
        // refreshing a display position must never enqueue another solve.
        this.bone.getWorldPosition(this.handle.position)
        if (!this.active) this.bone.getWorldQuaternion(this.handle.quaternion).normalize()
        this.handle.scale.set(1, 1, 1)
        this.handle.updateMatrixWorld()
    }

    begin(mode: DirectPoseMode): boolean {
        if (this.blocked(this.bone) || (mode === 'translate' && (!this.canTranslate || this.joints.some(this.blocked)))) return false
        this.active = false
        this.sync()
        this.mode = mode
        this.starts.clear()
        for (const joint of this.editedBones) this.starts.set(joint, joint.quaternion.clone())
        this.startLocal.copy(this.bone.quaternion).normalize()
        this.startWorld.copy(this.handle.quaternion).normalize()
        this.desiredPosition.copy(this.handle.position)
        this.desiredQuaternion.copy(this.handle.quaternion)
        if (this.joints.length === 2) this.rememberBend()
        this.active = true
        this.dirty = false
        return true
    }

    queue(): void {
        if (!this.active || !finiteVector(this.handle.position) || !finiteQuaternion(this.handle.quaternion)) return
        this.desiredPosition.copy(this.handle.position)
        this.desiredQuaternion.copy(this.handle.quaternion).normalize()
        this.dirty = true
    }

    flush(): readonly Bone[] {
        if (!this.active || !this.dirty) return []
        this.dirty = false
        if (this.blocked(this.bone) || this.editedBones.some(this.blocked)) return []
        let owner: Object3D | null = this.bone
        while (owner && owner !== this.actor) owner = owner.parent
        if (!owner) return []
        ++this.solves
        this.limited = this.mode === 'translate' && (this.projectPosition?.(this.desiredPosition, this.bone) ?? false)
        for (const [joint, start] of this.starts) joint.quaternion.copy(start)
        if (this.mode === 'rotate') {
            this.rotation.copy(this.startWorld).invert().multiply(this.desiredQuaternion)
            this.bone.quaternion.copy(this.startLocal).multiply(this.rotation).normalize()
        } else if (this.joints.length === 2 && this.joints.every(uniformScale)) {
            this.solveTwoBone()
        } else {
            // One-joint/non-uniform-scale fallback remains strictly bounded.
            // All local joint positions and all scales are untouched.
            for (let i = 0; i < 12; ++i) {
                for (let j = this.joints.length - 1; j >= 0; --j) this.aim(this.joints[j], this.desiredPosition)
                this.bone.getWorldPosition(this.tip)
                if (this.tip.distanceToSquared(this.desiredPosition) < 1e-10) break
            }
        }
        if (this.mode === 'translate' && this.preserveEndOrientation && this.bone.parent) {
            this.bone.parent.getWorldQuaternion(this.rotation)
            this.bone.quaternion.copy(this.rotation.invert()).multiply(this.startWorld).normalize()
        }
        // XYZ rotation is an explicit pose edit, not an anatomical IK solve.
        // Projecting it onto a one-axis hinge discards two visible ring axes
        // and can even change a native elbow pose on a zero-distance press.
        // Translation keeps the existing IK limits; neither mode changes length.
        if (this.mode === 'translate') for (const joint of this.editedBones) this.limited = clampPoseJoint(joint) || this.limited
        this.bone.updateWorldMatrix(true, false)
        // This guard constrains endpoint translation. Rotation leaves the pivot
        // fixed; an existing pivot overlap must not cancel every rotation.
        if (this.mode === 'translate' && this.projectPosition && !this.contactSafe()) {
            this.limited = true
            const candidates = new Map(this.editedBones.map(joint => [joint, joint.quaternion.clone()]))
            const applyFraction = (fraction: number) => {
                for (const [joint, candidate] of candidates) {
                    joint.quaternion.copy(this.starts.get(joint)!).slerp(candidate, fraction).normalize()
                    clampPoseJoint(joint)
                }
                this.bone.updateWorldMatrix(true, false)
            }
            applyFraction(0)
            if (this.contactSafe()) {
                let low = 0, high = 1
                for (let i = 0; i < 8; i++) {
                    const middle = (low + high) / 2
                    applyFraction(middle)
                    if (this.contactSafe()) low = middle; else high = middle
                }
                applyFraction(low)
            }
        }
        // Render the constrained endpoint, not an unreachable input proxy.
        this.bone.getWorldPosition(this.handle.position)
        if (this.mode === 'translate') this.bone.getWorldQuaternion(this.handle.quaternion)
        this.handle.updateMatrixWorld()
        return this.editedBones
    }

    end(): void {
        this.active = false
        this.dirty = false
        this.starts.clear()
        this.sync()
    }

    private contactSafe(): boolean {
        if (!this.projectPosition) return true
        this.bone.getWorldPosition(this.tip)
        this.goal.copy(this.tip)
        this.projectPosition(this.goal, this.bone)
        return this.goal.distanceToSquared(this.tip) < 1e-8
    }

    private aim(joint: Bone, worldTarget: Vector3): void {
        const parent = joint.parent
        if (!parent) return
        parent.updateWorldMatrix(true, false)
        if (Math.abs(parent.matrixWorld.determinant()) < 1e-20) return
        this.inverse.copy(parent.matrixWorld).invert()
        this.bone.getWorldPosition(this.from).applyMatrix4(this.inverse).sub(joint.position)
        this.to.copy(worldTarget).applyMatrix4(this.inverse).sub(joint.position)
        if (this.from.lengthSq() < 1e-16 || this.to.lengthSq() < 1e-16) return
        this.rotation.setFromUnitVectors(this.from.normalize(), this.to.normalize())
        joint.quaternion.premultiply(this.rotation).normalize()
        joint.updateWorldMatrix(false, false)
    }

    private rememberBend(): void {
        const [upper, lower] = this.joints
        upper.parent!.updateWorldMatrix(true, false)
        this.inverse.copy(upper.parent!.matrixWorld).invert()
        upper.getWorldPosition(this.origin).applyMatrix4(this.inverse)
        lower.getWorldPosition(this.middle).applyMatrix4(this.inverse)
        this.bone.getWorldPosition(this.tip).applyMatrix4(this.inverse)
        this.axis.copy(this.tip).sub(this.origin).normalize()
        this.bendReference.copy(this.middle).sub(this.origin)
        this.bendReference.addScaledVector(this.axis, -this.bendReference.dot(this.axis))
        this.actor.updateWorldMatrix(true, false)
        this.preferredBend.set(0, 0, /foot|ankle|leg|calf|knee/i.test(this.bone.name) ? 1 : -1)
            .transformDirection(this.actor.matrixWorld).transformDirection(this.inverse)
        if (this.bendReference.lengthSq() < 1e-10) this.bendReference.copy(this.preferredBend)
        this.bendReference.normalize()
    }

    private solveTwoBone(): void {
        const [upper, lower] = this.joints
        const parent = upper.parent!
        parent.updateWorldMatrix(true, false)
        this.frame.copy(parent.matrixWorld)
        if (Math.abs(this.frame.determinant()) < 1e-20) return
        this.inverse.copy(this.frame).invert()
        upper.getWorldPosition(this.origin).applyMatrix4(this.inverse)
        lower.getWorldPosition(this.middle).applyMatrix4(this.inverse)
        this.bone.getWorldPosition(this.tip).applyMatrix4(this.inverse)
        this.goal.copy(this.desiredPosition).applyMatrix4(this.inverse)
        const a = this.origin.distanceTo(this.middle), b = this.middle.distanceTo(this.tip)
        if (a < 1e-8 || b < 1e-8) {
            for (let i = this.joints.length - 1; i >= 0; --i) this.aim(this.joints[i], this.desiredPosition)
            return
        }
        this.axis.copy(this.goal).sub(this.origin)
        const requestedDistance = this.axis.length()
        if (requestedDistance < 1e-10) this.axis.copy(this.tip).sub(this.origin)
        if (this.axis.lengthSq() < 1e-16) this.axis.set(0, 1, 0)
        this.axis.normalize()
        this.pole.copy(this.bendReference)
        this.pole.addScaledVector(this.axis, -this.pole.dot(this.axis))
        if (this.pole.lengthSq() < 1e-12) {
            this.pole.copy(this.preferredBend).addScaledVector(this.axis, -this.preferredBend.dot(this.axis))
            if (this.pole.lengthSq() < 1e-12) {
                this.pole.set(Math.abs(this.axis.x) < 0.8 ? 1 : 0, Math.abs(this.axis.x) < 0.8 ? 0 : 1, 0)
                this.pole.addScaledVector(this.axis, -this.pole.dot(this.axis))
            }
        }
        this.pole.normalize().applyAxisAngle(this.axis, Math.max(-65 * Math.PI / 180, Math.min(65 * Math.PI / 180, this.bendAngle)))
        constrainBendPole(this.pole, this.axis, this.preferredBend)
        const epsilon = (a + b) * 1e-8
        const anatomical = /hand|wrist|foot|ankle/i.test(this.bone.name)
        const maximumBend = /foot|ankle/i.test(this.bone.name) ? 145 : 150
        const minimumReach = anatomical
            ? Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(maximumBend * Math.PI / 180))
            : Math.abs(a - b)
        const distance = Math.max(minimumReach + epsilon, Math.min(a + b - epsilon, requestedDistance))
        this.limited = this.limited || Math.abs(distance - requestedDistance) > 1e-5
        const along = (a * a - b * b + distance * distance) / (2 * distance)
        const height = Math.sqrt(Math.max(0, a * a - along * along))
        this.elbow.copy(this.origin).addScaledVector(this.axis, along).addScaledVector(this.pole, height)
        this.target.copy(this.origin).addScaledVector(this.axis, distance).applyMatrix4(this.frame)
        this.from.copy(this.middle).sub(this.origin).normalize()
        this.to.copy(this.elbow).sub(this.origin).normalize()
        this.rotation.setFromUnitVectors(this.from, this.to)
        upper.quaternion.premultiply(this.rotation).normalize()
        upper.updateWorldMatrix(false, false)
        alignPoseHinge(upper, lower, this.target)
        this.limited = clampPoseJoint(upper) || this.limited
        this.aim(lower, this.target)
        this.limited = clampPoseJoint(lower) || this.limited
    }
}
