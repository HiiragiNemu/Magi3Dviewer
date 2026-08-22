/** Shared coordinate conversions for AssetStudio-exported Unity content. */

export type Vector3Tuple = readonly [number, number, number]
export type MutableVector3Tuple = [number, number, number]

/** AssetStudio FBX export reflects Unity world X while preserving Y and Z. */
export function unityWorldToViewerVector(value: Vector3Tuple): MutableVector3Tuple {
    return [-value[0], value[1], value[2]]
}
