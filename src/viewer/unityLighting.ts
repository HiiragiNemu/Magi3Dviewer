/** Unity/URP lighting values converted into the Three.js working conventions. */

import type { MutableVector3Tuple } from '../../magia-exedra-character-three/coordinateSpace.ts'
export { unityWorldToViewerVector } from '../../magia-exedra-character-three/coordinateSpace.ts'

export type UnityRgb = readonly [number, number, number, ...number[]]
export type ViewerVector3 = MutableVector3Tuple

/**
 * Unity URP's Lambert path multiplies albedo by irradiance directly. Three's
 * MeshStandardMaterial applies RECIPROCAL_PI inside BRDF_Lambert, so recovered
 * Unity light/lightmap radiance must carry this factor exactly once.
 */
export const UNITY_TO_THREE_DIFFUSE_IRRADIANCE = Math.PI

export function unityDiffuseRadianceToThree(value: number) {
    return (Number.isFinite(value) ? Math.max(0, value) : 0)
        * UNITY_TO_THREE_DIFFUSE_IRRADIANCE
}

const THREE_IRRADIANCE_SH_BASIS = {
    l00: 0.886227,
    l1: 2 * 0.511664,
    l20: 0.247708,
    l2: 2 * 0.429043,
    l22: 0.429043,
} as const

/** IEC 61966-2-1 EOTF used by Unity before multiplying Light.color by intensity. */
export function unitySrgbChannelToLinear(value: number) {
    const safe = Number.isFinite(value) ? Math.max(0, value) : 0
    return safe <= 0.04045
        ? safe / 12.92
        : ((safe + 0.055) / 1.055) ** 2.4
}

export function unityLightColorToLinear(value: UnityRgb): ViewerVector3 {
    return [
        unitySrgbChannelToLinear(value[0]),
        unitySrgbChannelToLinear(value[1]),
        unitySrgbChannelToLinear(value[2]),
    ]
}

/**
 * Convert Unity's serialized SphericalHarmonicsL2 coefficients to the basis
 * expected by THREE.SphericalHarmonics3.
 *
 * Unity stores nine coefficients per colour channel. Unity's shader evaluator
 * folds the real-SH basis constants into its dot products, while Three keeps
 * normalized real-SH coefficients and MeshStandardMaterial divides irradiance
 * by PI. The X signs below also account for the AssetStudio FBX reflection.
 */
export function unityShL2ToThree(values: readonly number[]): ViewerVector3[] {
    if (values.length !== 27) {
        throw new Error(`Unity SH requires 27 values, received ${values.length}`)
    }

    const channel = (index: number): ViewerVector3 => [
        values[index],
        values[index + 9],
        values[index + 18],
    ]
    const scaled = (index: number, scale: number): ViewerVector3 =>
        channel(index).map(value => value * scale) as ViewerVector3

    // Unity's polynomial basis is:
    // c0 + c1*y + c2*z + c3*x + c4*x*y + c5*y*z
    // + c6*(3*z*z-1) + c7*x*z + c8*(x*x-y*y).
    return [
        scaled(0, Math.PI / THREE_IRRADIANCE_SH_BASIS.l00),
        scaled(1, Math.PI / THREE_IRRADIANCE_SH_BASIS.l1),
        scaled(2, Math.PI / THREE_IRRADIANCE_SH_BASIS.l1),
        scaled(3, -Math.PI / THREE_IRRADIANCE_SH_BASIS.l1),
        scaled(4, -Math.PI / THREE_IRRADIANCE_SH_BASIS.l2),
        scaled(5, Math.PI / THREE_IRRADIANCE_SH_BASIS.l2),
        scaled(6, Math.PI / THREE_IRRADIANCE_SH_BASIS.l20),
        scaled(7, -Math.PI / THREE_IRRADIANCE_SH_BASIS.l2),
        scaled(8, Math.PI / THREE_IRRADIANCE_SH_BASIS.l22),
    ]
}
