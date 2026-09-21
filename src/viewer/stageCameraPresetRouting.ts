export interface CameraPresetIdLookup {
    has(cameraPresetId: string): boolean
}

/**
 * Official battle camera bundles encode the stage tuple as
 * `AAA BB CC DD`: battle-AAA-BB-CC-0DD -> camera_preset_AAABBCCDD.
 *
 * This only produces a candidate. Callers must still require that the
 * extracted official camera-preset table contains the exact ID, so unrelated
 * stages never inherit a guessed lens.
 */
export function deriveOfficialBattleCameraPresetId(
    stageId: string,
): string | undefined {
    const match = /^battle-(\d{3})-(\d{2})-(\d{2})-(\d{3})$/.exec(stageId)
    if (!match) return undefined
    return `${match[1]}${match[2]}${match[3]}${match[4].slice(-2)}`
}

export function resolveStageCameraPresetId(
    stageId: string,
    explicitCameraPresetId: string | undefined,
    officialCameraPresetIds: CameraPresetIdLookup,
): string | undefined {
    if (explicitCameraPresetId) return explicitCameraPresetId
    const candidate = deriveOfficialBattleCameraPresetId(stageId)
    return candidate && officialCameraPresetIds.has(candidate)
        ? candidate
        : undefined
}
