import { PerformanceEditorRuntime } from './runtime.ts'
import { mountPerformancePanel } from './panel.ts'
import { AudioTimelineBridge } from './audioTimelineBridge.ts'
import type { EditorOptions } from './types.ts'

export * from './types.ts'
export { PerformanceEditorRuntime, mountPerformancePanel }
export { AudioTimelineBridge }
export { PerformanceTimeline, emptyPerformanceDocument } from './timeline.ts'
export function mountPerformanceEditor(container: HTMLElement, options: EditorOptions) {
    const runtime = new PerformanceEditorRuntime(options)
    const audio = new AudioTimelineBridge(runtime, { ...options.audioEnvironment, catalog: options.voiceCatalog })
    // The existing final-render port deduplicates frames; document timeline time
    // also remains stable if a consumer repeats a callback in the same frame.
    const releaseAudioClock = options.framePort.subscribeFinalPoseBeforeCamera(() => {
        const stamp = container.ownerDocument.timeline?.currentTime
        runtime.advanceAudioOnlyFrame(typeof stamp === 'number' ? stamp : performance.now())
        audio.flushMouthOutput()
    })
    try {
        const panel = mountPerformancePanel(container, runtime, audio)
        return { runtime, panel, audio, dispose() { releaseAudioClock(); panel.dispose(); audio.dispose(); runtime.dispose() } }
    } catch (error) { releaseAudioClock(); audio.dispose(); runtime.dispose(); throw error }
}
