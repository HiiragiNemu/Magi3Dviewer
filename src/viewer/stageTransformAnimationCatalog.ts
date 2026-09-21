import bundledCatalog from './stage-transform-animations.generated.json'
import type { StageTransformAnimationProfile } from './stageTransformAnimations'
import type { StageRuntimeProfile } from './stageRuntime'

interface BundledEntry {
    bundle: string
    sourceStageCab: string
    animation: StageTransformAnimationProfile
}
const stages = bundledCatalog.stages as unknown as Record<string, BundledEntry>

/**
 * Build-owned companion, statically imported into the application JS. Historical
 * runtime ZIP profiles cannot shadow it; no 16 GB public-directory copy or new
 * release ZIP is needed. Only the animation field is joined to the loaded profile.
 */
export function withBundledStageTransformAnimations<T extends {
    runtime?: StageRuntimeProfile
    sourceRecords?: Record<string, unknown>
}>(profile: T, stageId: string): T {
    const entry = stages[stageId]
    if (!entry) return profile
    if (profile.sourceRecords?.stageCab !== entry.sourceStageCab) {
        throw new Error(`Stage transform companion CAB mismatch for ${stageId}`)
    }
    return {
        ...profile,
        runtime: {
            ...profile.runtime,
            autoplay: profile.runtime?.autoplay ?? true,
            transformAnimations: entry.animation,
        },
    }
}
