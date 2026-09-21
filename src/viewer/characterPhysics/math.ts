import type {
    MagicaCurveParameter,
    PhysicsVector3,
    UnityAnimationCurve,
} from './types'

export function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value))
}

export function evaluateUnityCurve(curve: UnityAnimationCurve, time: number): number {
    const keys = curve.m_Curve
    if (!keys.length) return 1
    if (keys.length === 1 || time <= keys[0]!.time) return keys[0]!.value
    const last = keys[keys.length - 1]!
    if (time >= last.time) return last.value
    for (let index = 0; index < keys.length - 1; index += 1) {
        const left = keys[index]!
        const right = keys[index + 1]!
        if (time > right.time) continue
        const duration = right.time - left.time
        if (duration <= Number.EPSILON) return right.value
        const t = (time - left.time) / duration
        const t2 = t * t
        const t3 = t2 * t
        const h00 = 2 * t3 - 3 * t2 + 1
        const h10 = t3 - 2 * t2 + t
        const h01 = -2 * t3 + 3 * t2
        const h11 = t3 - t2
        return h00 * left.value
            + h10 * duration * left.outSlope
            + h01 * right.value
            + h11 * duration * right.inSlope
    }
    return last.value
}

export function evaluateMagicaCurve(
    parameter: MagicaCurveParameter,
    normalizedDepth: number,
): number {
    const multiplier = parameter.useCurve
        ? evaluateUnityCurve(parameter.curve, clamp(normalizedDepth, 0, 1))
        : 1
    return parameter.value * multiplier
}

export function vectorLength(value: PhysicsVector3): number {
    return Math.hypot(value.x, value.y, value.z)
}

export function clampVectorLength(
    value: PhysicsVector3,
    maximum: number,
): PhysicsVector3 {
    const length = vectorLength(value)
    if (!(maximum >= 0) || length <= maximum || length <= Number.EPSILON) {
        return { ...value }
    }
    const scale = maximum / length
    return { x: value.x * scale, y: value.y * scale, z: value.z * scale }
}

export function projectOutsideSphere(
    point: PhysicsVector3,
    center: PhysicsVector3,
    radius: number,
): Readonly<{ point: PhysicsVector3; contacted: boolean }> {
    const delta = {
        x: point.x - center.x,
        y: point.y - center.y,
        z: point.z - center.z,
    }
    const length = vectorLength(delta)
    if (length >= radius || radius <= 0) return { point: { ...point }, contacted: false }
    const direction = length > 1e-8
        ? { x: delta.x / length, y: delta.y / length, z: delta.z / length }
        : { x: 0, y: 1, z: 0 }
    return {
        point: {
            x: center.x + direction.x * radius,
            y: center.y + direction.y * radius,
            z: center.z + direction.z * radius,
        },
        contacted: true,
    }
}

export function projectOutsideCapsule(
    point: PhysicsVector3,
    start: PhysicsVector3,
    end: PhysicsVector3,
    radius: number,
): Readonly<{ point: PhysicsVector3; contacted: boolean }> {
    const axis = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z }
    const axisLengthSquared = axis.x ** 2 + axis.y ** 2 + axis.z ** 2
    const fromStart = {
        x: point.x - start.x,
        y: point.y - start.y,
        z: point.z - start.z,
    }
    const t = axisLengthSquared > 1e-12
        ? clamp(
            (fromStart.x * axis.x + fromStart.y * axis.y + fromStart.z * axis.z)
                / axisLengthSquared,
            0,
            1,
        )
        : 0
    return projectOutsideSphere(point, {
        x: start.x + axis.x * t,
        y: start.y + axis.y * t,
        z: start.z + axis.z * t,
    }, radius)
}

export function projectOutsideTaperedCapsule(
    point: PhysicsVector3,
    start: PhysicsVector3,
    end: PhysicsVector3,
    startRadius: number,
    endRadius: number,
): Readonly<{ point: PhysicsVector3; contacted: boolean }> {
    const axis = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z }
    const axisLengthSquared = axis.x ** 2 + axis.y ** 2 + axis.z ** 2
    const fromStart = {
        x: point.x - start.x,
        y: point.y - start.y,
        z: point.z - start.z,
    }
    const t = axisLengthSquared > 1e-12
        ? clamp(
            (fromStart.x * axis.x + fromStart.y * axis.y + fromStart.z * axis.z)
                / axisLengthSquared,
            0,
            1,
        )
        : 0
    return projectOutsideSphere(point, {
        x: start.x + axis.x * t,
        y: start.y + axis.y * t,
        z: start.z + axis.z * t,
    }, startRadius + (endRadius - startRadius) * t)
}

export function projectAbovePlane(
    point: PhysicsVector3,
    planePoint: PhysicsVector3,
    planeNormal: PhysicsVector3,
    radius: number,
): Readonly<{ point: PhysicsVector3; contacted: boolean }> {
    const normalLength = vectorLength(planeNormal)
    if (normalLength <= 1e-8) return { point: { ...point }, contacted: false }
    const normal = {
        x: planeNormal.x / normalLength,
        y: planeNormal.y / normalLength,
        z: planeNormal.z / normalLength,
    }
    const distance = (point.x - planePoint.x) * normal.x
        + (point.y - planePoint.y) * normal.y
        + (point.z - planePoint.z) * normal.z
    if (distance >= radius) return { point: { ...point }, contacted: false }
    const correction = radius - distance
    return {
        point: {
            x: point.x + normal.x * correction,
            y: point.y + normal.y * correction,
            z: point.z + normal.z * correction,
        },
        contacted: true,
    }
}
