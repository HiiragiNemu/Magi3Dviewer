export interface OfficialCameraRotationProfile {
    transposer?: {
        followOffset?: readonly number[]
    } | null
    transform?: {
        world?: {
            position?: readonly number[]
            rotation?: readonly number[]
        }
    }
}

export interface OfficialCameraOrbitEnvelope {
    sourceProfileCount: number
    acceptedProfileCount: number
    acceptedDistanceProfileCount: number
    minForwardElevationRadians: number
    maxForwardElevationRadians: number
    minForwardElevationDegrees: number
    maxForwardElevationDegrees: number
    minPolarAngleRadians: number
    maxPolarAngleRadians: number
    minOrbitDistance: number
    maxOrbitDistance: number
}

const clampUnit = (value: number) => Math.min(Math.max(value, -1), 1)

/**
 * Derive the interactive orbit domain from serialized Unity camera rotations.
 * Unity camera forward is +Z. OrbitControls stores the opposite vector
 * (target -> camera), so its polar angle is PI/2 plus camera-forward elevation.
 */
export function deriveOfficialCameraOrbitEnvelope(
    profiles: readonly OfficialCameraRotationProfile[],
): OfficialCameraOrbitEnvelope {
    const elevations: number[] = []
    const distances: number[] = []

    for (const profile of profiles) {
        const offset = profile.transposer?.followOffset
            ?? profile.transform?.world?.position
        if (
            offset?.length === 3
            && offset.every(Number.isFinite)
        ) {
            const distance = Math.hypot(offset[0], offset[1], offset[2])
            if (distance > 0) distances.push(distance)
        }

        const rotation = profile.transform?.world?.rotation
        if (!rotation || rotation.length !== 4) continue
        const [rawX, rawY, rawZ, rawW] = rotation
        if (![rawX, rawY, rawZ, rawW].every(Number.isFinite)) continue
        const length = Math.hypot(rawX, rawY, rawZ, rawW)
        if (!(length > 0)) continue
        const x = rawX / length
        const y = rawY / length
        const z = rawZ / length
        const w = rawW / length

        // Y component of q * (0, 0, 1) * inverse(q).
        const forwardY = 2 * (y * z - w * x)
        elevations.push(Math.asin(clampUnit(forwardY)))
    }

    if (elevations.length === 0) {
        throw new Error('Official camera profiles contain no valid world rotation')
    }
    if (distances.length === 0) {
        throw new Error('Official camera profiles contain no valid orbit distance')
    }

    const minForwardElevationRadians = Math.min(...elevations)
    const maxForwardElevationRadians = Math.max(...elevations)
    const radiansToDegrees = 180 / Math.PI
    return {
        sourceProfileCount: profiles.length,
        acceptedProfileCount: elevations.length,
        acceptedDistanceProfileCount: distances.length,
        minForwardElevationRadians,
        maxForwardElevationRadians,
        minForwardElevationDegrees:
            minForwardElevationRadians * radiansToDegrees,
        maxForwardElevationDegrees:
            maxForwardElevationRadians * radiansToDegrees,
        minPolarAngleRadians:
            Math.PI / 2 + minForwardElevationRadians,
        maxPolarAngleRadians:
            Math.PI / 2 + maxForwardElevationRadians,
        minOrbitDistance: Math.min(...distances),
        maxOrbitDistance: Math.max(...distances),
    }
}
