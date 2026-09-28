import { Bone, Matrix4, Object3D, Quaternion, Vector3 } from 'three'

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

    constructor(readonly actor: Object3D, readonly bone: Bone, private readonly blocked: (bone: Bone) => boolean = () => false) {
        this.rotationBones = [bone]
        this.joints = directPoseTranslationJoints(actor, bone, blocked)
        this.handle.name = 'MagiusDirectPoseInput'
        this.sync()
    }

    get canTranslate() { return this.joints.length > 0 }
    get pending() { return this.dirty }
    get dragging() { return this.active }
    get editedBones(): readonly Bone[] { return this.mode === 'translate' ? this.joints : this.rotationBones }

    sync() {
        if (this.active) return
        this.bone.getWorldPosition(this.handle.position)
        this.bone.getWorldQuaternion(this.handle.quaternion).normalize()
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
        this.bone.updateWorldMatrix(true, false)
        return this.editedBones
    }

    end(): void {
        this.active = false
        this.dirty = false
        this.starts.clear()
        this.sync()
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
        this.pole.copy(this.middle).sub(this.origin)
        this.pole.addScaledVector(this.axis, -this.pole.dot(this.axis))
        if (this.pole.lengthSq() < 1e-12) {
            this.pole.set(0, Math.abs(this.axis.y) < 0.8 ? -1 : 0, Math.abs(this.axis.y) < 0.8 ? 0 : 1)
            this.pole.addScaledVector(this.axis, -this.pole.dot(this.axis))
        }
        this.pole.normalize()
        const epsilon = (a + b) * 1e-8
        const distance = Math.max(Math.abs(a - b) + epsilon, Math.min(a + b - epsilon, requestedDistance))
        const along = (a * a - b * b + distance * distance) / (2 * distance)
        const height = Math.sqrt(Math.max(0, a * a - along * along))
        this.elbow.copy(this.origin).addScaledVector(this.axis, along).addScaledVector(this.pole, height)
        this.target.copy(this.origin).addScaledVector(this.axis, distance).applyMatrix4(this.frame)
        this.from.copy(this.middle).sub(this.origin).normalize()
        this.to.copy(this.elbow).sub(this.origin).normalize()
        this.rotation.setFromUnitVectors(this.from, this.to)
        upper.quaternion.premultiply(this.rotation).normalize()
        upper.updateWorldMatrix(false, false)
        this.aim(lower, this.target)
    }
}
