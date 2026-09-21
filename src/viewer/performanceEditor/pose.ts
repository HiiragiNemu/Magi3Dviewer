import { Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import type { Availability, LocalTransform, PoseSnapshot, Quat, Vec3 } from './types.ts'

const EPSILON = 1e-10

function tuple(value: readonly number[], size: number, label: string): void {
    if (!Array.isArray(value) || value.length !== size || value.some(item => !Number.isFinite(item))) {
        throw new TypeError(`${label} must contain ${size} finite numbers`)
    }
}

function quaternion(value: Quat): Quaternion {
    tuple(value, 4, 'rotation')
    const result = new Quaternion(...value)
    if (result.lengthSq() <= EPSILON * EPSILON) throw new TypeError('rotation must be nonzero')
    return result.normalize()
}

function copyTransform(value: LocalTransform): LocalTransform {
    tuple(value.position, 3, 'position')
    tuple(value.scale, 3, 'scale')
    return {
        position: [...value.position] as Vec3,
        rotation: quaternion(value.rotation).toArray() as unknown as Quat,
        scale: [...value.scale] as Vec3,
    }
}

export function captureTransform(object: Object3D): LocalTransform {
    return copyTransform({
        position: object.position.toArray() as unknown as Vec3,
        rotation: object.quaternion.toArray() as unknown as Quat,
        scale: object.scale.toArray() as unknown as Vec3,
    })
}

export function applyTransform(object: Object3D, value: LocalTransform): void {
    const checked = copyTransform(value)
    object.position.fromArray(checked.position)
    object.quaternion.fromArray(checked.rotation)
    object.scale.fromArray(checked.scale)
}

export function clonePose(pose: PoseSnapshot): PoseSnapshot {
    const bones = Object.fromEntries(Object.entries(pose.bones).map(([key, value]) => [key, copyTransform(value)]))
    const morphs = Object.fromEntries(Object.entries(pose.morphs).map(([key, value]) => {
        if (!Number.isFinite(value)) throw new TypeError(`morph ${key} must be finite`)
        return [key, value]
    }))
    return { ...(pose.root ? { root: copyTransform(pose.root) } : {}), bones, morphs }
}

function blendTransform(from: LocalTransform, to: LocalTransform, alpha: number): LocalTransform {
    const lerp = (a: Vec3, b: Vec3): Vec3 => a.map((value, index) => value * (1 - alpha) + b[index] * alpha) as unknown as Vec3
    return copyTransform({
        position: lerp(from.position, to.position),
        rotation: quaternion(from.rotation).slerp(quaternion(to.rotation), alpha).normalize().toArray() as unknown as Quat,
        scale: lerp(from.scale, to.scale),
    })
}

/** Missing source channels stay unowned; no rest pose or zero morph is invented. */
export function blendPose(from: PoseSnapshot, to: PoseSnapshot, alpha: number): PoseSnapshot {
    if (!Number.isFinite(alpha)) throw new TypeError('blend alpha must be finite')
    const source = clonePose(from)
    const target = clonePose(to)
    const weight = Math.max(0, Math.min(1, alpha))
    const bones = Object.fromEntries(Object.entries(target.bones)
        .filter(([key]) => Object.hasOwn(source.bones, key))
        .map(([key, value]) => [key, blendTransform(source.bones[key], value, weight)]))
    const morphs = Object.fromEntries(Object.entries(target.morphs)
        .filter(([key]) => Object.hasOwn(source.morphs, key))
        .map(([key, value]) => [key, source.morphs[key] * (1 - weight) + value * weight]))
    return clonePose({
        ...(source.root && target.root ? { root: blendTransform(source.root, target.root, weight) } : {}),
        bones,
        morphs,
    })
}

interface WorldTransform { position: Vector3; rotation: Quaternion }

/** A target translates a detached handle, never a joint or mesh. Two local
 * links are the complete lease: do not walk through the chest/hip branches.
 * Unsupported branching/helper chains need an explicit rig declaration.
 */
export function resolveJointIKChain(end: Object3D, bones: ReadonlySet<Object3D>): Availability<readonly [Object3D, Object3D, Object3D]> {
    const joint = end?.parent, root = joint?.parent
    if (!root || !joint || ![root, joint, end].every(node => bones.has(node) && (node as Object3D & { isBone?: boolean }).isBone)) {
        return { status: 'unavailable', reason: 'IK requires two contiguous registered bone links' }
    }
    for (const [parent, child] of [[root, joint], [joint, end]]) {
        const children = parent.children.filter(node => bones.has(node))
        if (children.length !== 1 || children[0] !== child) {
            return { status: 'unavailable', reason: 'IK branch requires explicit rig declaration; torso/head chain is not inferred' }
        }
    }
    return { status: 'ready', value: [root, joint, end] }
}

/** Detached math keeps even cached scene matrices untouched on rejected IK input. */
function worldTransform(object: Object3D, overrides = new Map<Object3D, Quaternion>()): WorldTransform {
    const ancestry: Object3D[] = []
    for (let node: Object3D | null = object; node; node = node.parent) ancestry.unshift(node)
    const matrix = new Matrix4()
    const rotation = new Quaternion()
    for (const node of ancestry) {
        const local = captureTransform(node)
        if (!node.matrixAutoUpdate) throw new TypeError('IK requires TRS-managed objects')
        const [x, y, z] = local.scale
        if (Math.min(x, y, z) <= EPSILON || Math.max(Math.abs(x - y), Math.abs(x - z)) > EPSILON * Math.max(x, y, z)) {
            throw new TypeError('IK requires positive uniform chain and ancestor scales')
        }
        const localRotation = overrides.get(node) ?? quaternion(local.rotation)
        matrix.multiply(new Matrix4().compose(new Vector3(...local.position), localRotation, new Vector3(...local.scale)))
        rotation.multiply(localRotation).normalize()
    }
    const position = new Vector3().setFromMatrixPosition(matrix)
    if (!position.toArray().every(Number.isFinite)) throw new TypeError('IK world transform must be finite')
    return { position, rotation }
}

/**
 * Bounded CCD solve for an explicit contiguous chain.  The chain is detached by
 * callers (the live evaluator is never touched until this returns `ready`), and
 * only local rotations are committed.  Translation, scale and ancestor state
 * therefore remain outside the solver's ownership boundary.
 */
export function solveChainIK(
    chain: readonly Object3D[],
    targetWorld: Vector3,
    poleWorld?: Vector3,
): Availability<{ distance: number; clamped: boolean; iterations: number }> {
    try {
        if (!Array.isArray(chain) || chain.length < 3 || !chain.every(node => node?.isObject3D)) {
            throw new TypeError('IK requires an explicit chain of at least three objects')
        }
        for (let index = 1; index < chain.length; index += 1) {
            if (chain[index].parent !== chain[index - 1]) throw new TypeError('IK chain must be contiguous')
        }
        if (!targetWorld?.isVector3 || !targetWorld.toArray().every(Number.isFinite)
            || (poleWorld !== undefined && (!poleWorld.isVector3 || !poleWorld.toArray().every(Number.isFinite)))) {
            throw new TypeError('IK target and pole must be finite world vectors')
        }
        const initial = chain.map(node => worldTransform(node))
        const lengths = initial.slice(1).map((row, index) => row.position.distanceTo(initial[index].position))
        if (!lengths.every(length => Number.isFinite(length) && length > EPSILON)) throw new TypeError('IK chain lengths must be finite and nonzero')
        const root = initial[0].position.clone()
        const requestedDistance = targetWorld.distanceTo(root)
        const totalLength = lengths.reduce((sum, length) => sum + length, 0)
        const distance = Math.min(totalLength, requestedDistance)
        const goal = targetWorld.clone()
        if (requestedDistance > totalLength) goal.copy(root).add(targetWorld.clone().sub(root).normalize().multiplyScalar(totalLength))
        const overrides = new Map<Object3D, Quaternion>()
        const positions = initial.map(row => row.position.clone())
        const tolerance = 1e-7 * Math.max(1, totalLength)
        const unitBetween = (from: Vector3, to: Vector3, fallback: Vector3): Vector3 => {
            const direction = to.clone().sub(from)
            return direction.lengthSq() > EPSILON * EPSILON ? direction.normalize() : fallback.clone().normalize()
        }
        let iterations = 0
        for (; iterations < 16; iterations += 1) {
            positions[positions.length - 1].copy(goal)
            for (let index = positions.length - 2; index >= 0; index -= 1) {
                const direction = unitBetween(positions[index + 1], positions[index], initial[index].position.clone().sub(initial[index + 1].position))
                positions[index].copy(positions[index + 1]).addScaledVector(direction, lengths[index])
            }
            positions[0].copy(root)
            for (let index = 1; index < positions.length; index += 1) {
                const direction = unitBetween(positions[index - 1], positions[index], initial[index].position.clone().sub(initial[index - 1].position))
                positions[index].copy(positions[index - 1]).addScaledVector(direction, lengths[index - 1])
            }
            if (positions[positions.length - 1].distanceTo(goal) <= tolerance) break
        }
        // A pole is used as a deterministic bend hint for the first link.  The
        // remaining links follow the bounded FABRIK result above.
        if (poleWorld) {
            const axis = goal.clone().sub(root).normalize()
            const pole = poleWorld.clone().sub(root).addScaledVector(axis, -poleWorld.clone().sub(root).dot(axis))
            if (pole.lengthSq() > EPSILON * EPSILON) {
                const current = positions[1].clone().sub(root).addScaledVector(axis, -positions[1].clone().sub(root).dot(axis))
                if (current.lengthSq() > EPSILON * EPSILON) positions[1].copy(root).add(pole.normalize().multiplyScalar(current.length()))
            }
        }
        // Convert solved segment directions to local rotations in the detached
        // hierarchy.  Recompute each world basis through the override map so
        // parent rotations are accounted for exactly.
        for (let index = 0; index < chain.length - 1; index += 1) {
            const current = worldTransform(chain[index], overrides)
            const child = worldTransform(chain[index + 1], overrides)
            const currentDirection = child.position.sub(current.position)
            const desiredDirection = positions[index + 1].clone().sub(positions[index])
            if (currentDirection.lengthSq() <= EPSILON * EPSILON || desiredDirection.lengthSq() <= EPSILON * EPSILON) throw new TypeError('IK segment direction is degenerate')
            const desiredWorld = new Quaternion().setFromUnitVectors(currentDirection.normalize(), desiredDirection.normalize())
                .multiply(current.rotation).normalize()
            const parentRotation = chain[index].parent ? worldTransform(chain[index].parent!, overrides).rotation : new Quaternion()
            overrides.set(chain[index], parentRotation.invert().multiply(desiredWorld).normalize())
        }
        const solved = worldTransform(chain[chain.length - 1], overrides)
        if (solved.position.distanceTo(goal) > tolerance) throw new TypeError('IK solution did not satisfy the validated chain')
        for (let index = 0; index < chain.length - 1; index += 1) {
            const rotation = overrides.get(chain[index])
            if (!rotation || !rotation.toArray().every(Number.isFinite)) throw new TypeError('IK solution rotation is not finite')
        }
        for (let index = 0; index < chain.length - 1; index += 1) chain[index].quaternion.copy(overrides.get(chain[index])!)
        return { status: 'ready', value: { distance, clamped: Math.abs(distance - requestedDistance) > EPSILON, iterations: iterations + 1 } }
    } catch (error) {
        return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
    }
}

/** Solves the exact two-link chain; actor placement, translations and scale never change. */
export function solveTwoLinkIK(
    root: Object3D,
    joint: Object3D,
    end: Object3D,
    targetWorld: Vector3,
    poleWorld?: Vector3,
): Availability<{ distance: number; clamped: boolean }> {
    try {
        if (!root?.isObject3D || !joint?.isObject3D || !end?.isObject3D || joint.parent !== root || end.parent !== joint) {
            throw new TypeError('IK requires an exact root-joint-end parent chain')
        }
        if (!targetWorld?.isVector3 || !targetWorld.toArray().every(Number.isFinite)
            || (poleWorld !== undefined && (!poleWorld.isVector3 || !poleWorld.toArray().every(Number.isFinite)))) {
            throw new TypeError('IK target and pole must be finite world vectors')
        }
        const a = worldTransform(root)
        const b = worldTransform(joint)
        const c = worldTransform(end)
        const upper = b.position.clone().sub(a.position)
        const lower = c.position.clone().sub(b.position)
        const lengthA = upper.length()
        const lengthB = lower.length()
        const requested = targetWorld.clone().sub(a.position)
        const requestedDistance = requested.length()
        if (![lengthA, lengthB, requestedDistance].every(Number.isFinite) || Math.min(lengthA, lengthB) <= EPSILON) {
            throw new TypeError('IK chain lengths must be finite and nonzero')
        }
        const minDistance = Math.abs(lengthA - lengthB)
        const maxDistance = lengthA + lengthB
        const distance = Math.max(minDistance, Math.min(maxDistance, requestedDistance))
        const direction = requestedDistance > EPSILON ? requested.divideScalar(requestedDistance) : upper.clone().normalize()
        const bend = (poleWorld ? poleWorld.clone().sub(a.position) : upper.clone())
        bend.addScaledVector(direction, -bend.dot(direction))
        if (bend.lengthSq() <= EPSILON * EPSILON) {
            bend.set(Math.abs(direction.x) < 0.9 ? 1 : 0, Math.abs(direction.x) < 0.9 ? 0 : 1, 0)
            bend.addScaledVector(direction, -bend.dot(direction))
        }
        bend.normalize()
        const cosine = distance > EPSILON
            ? Math.max(-1, Math.min(1, (lengthA * lengthA + distance * distance - lengthB * lengthB) / (2 * lengthA * distance)))
            : 0
        const desiredUpper = direction.clone().multiplyScalar(lengthA * cosine)
            .addScaledVector(bend, lengthA * Math.sqrt(Math.max(0, 1 - cosine * cosine)))
        const rootWorldRotation = new Quaternion().setFromUnitVectors(upper.normalize(), desiredUpper.normalize())
            .multiply(a.rotation).normalize()
        const parentRotation = root.parent ? worldTransform(root.parent).rotation : new Quaternion()
        const rootLocalRotation = parentRotation.invert().multiply(rootWorldRotation).normalize()
        const overrides = new Map([[root, rootLocalRotation]])
        const nextJoint = worldTransform(joint, overrides)
        const nextEnd = worldTransform(end, overrides)
        const goal = a.position.clone().addScaledVector(direction, distance)
        const jointWorldRotation = new Quaternion().setFromUnitVectors(
            nextEnd.position.clone().sub(nextJoint.position).normalize(),
            goal.clone().sub(nextJoint.position).normalize(),
        ).multiply(nextJoint.rotation).normalize()
        const jointLocalRotation = rootWorldRotation.clone().invert().multiply(jointWorldRotation).normalize()
        overrides.set(joint, jointLocalRotation)
        const solved = worldTransform(end, overrides)
        if (!rootLocalRotation.toArray().every(Number.isFinite) || !jointLocalRotation.toArray().every(Number.isFinite)
            || solved.position.distanceTo(goal) > 1e-7 * Math.max(1, maxDistance)) {
            throw new TypeError('IK solution did not satisfy the validated chain')
        }
        root.quaternion.copy(rootLocalRotation)
        joint.quaternion.copy(jointLocalRotation)
        return { status: 'ready', value: { distance, clamped: Math.abs(distance - requestedDistance) > EPSILON } }
    } catch (error) {
        return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
    }
}
