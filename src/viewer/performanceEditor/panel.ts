import { mountAudioTrackPanel } from './audioTrackPanel.ts'
import type { PerformanceEditorRuntime } from './runtime.ts'
import type { AudioTimelineBridge } from './audioTimelineBridge.ts'
import type { DragMode, PerformanceDocument, TrackChannel } from './types.ts'
import type { JointNodeIdentity, PoseSelection } from './jointNodes.ts'

/** Mounts only inside the supplied container. The host retains canvas/Orbit ownership. */
export function mountPerformancePanel(container: HTMLElement, runtime: PerformanceEditorRuntime, audio?: AudioTimelineBridge) {
    const document = container.ownerDocument
    const root = document.createElement('section')
    root.className = 'performance-editor performance-editor-dock'
    root.setAttribute('aria-label', 'Performance editor')
    root.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;padding:8px;border:1px solid currentColor;max-width:960px;max-height:42vh;overflow:auto;contain:layout paint'
    const heading = document.createElement('h3'); heading.textContent = 'Performance'; root.append(heading)
    const status = document.createElement('output'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-label', 'Performance status'); root.append(status)
    const addSelect = (label: string) => {
        const element = document.createElement('select'); element.setAttribute('aria-label', label); return element
    }
    const section = (label: string, testid: string) => {
        const element = document.createElement('section'); element.setAttribute('aria-label', label); element.setAttribute('data-testid', testid)
        element.style.cssText = 'display:grid;gap:4px;align-content:start;min-width:0'
        const title = document.createElement('h4'); title.textContent = label; title.style.cssText = 'margin:0;font-size:0.85rem'; element.append(title); root.append(element); return element
    }
    const actorsSection = section('Actors / Scene outliner', 'performance-actors-section')
    const manipulationSection = section('Manipulation / Inspector', 'performance-manipulation-section')
    const timelineSection = section('Timeline', 'performance-timeline-section')
    const projectSection = section('Project / Presets', 'performance-project-section')
    const audioSection = section('Audio / Lip-sync tracks', 'performance-audio-section')
    const audioPanel = mountAudioTrackPanel(audioSection, runtime, audio)
    const actors = addSelect('Performance actor'); actorsSection.append(actors)
    const mode = addSelect('Drag mode'); manipulationSection.append(mode)
    const bones = addSelect('Pose joint'); manipulationSection.append(bones)
    const channel = addSelect('Keyframe channel'); timelineSection.append(channel)
    const morphs = addSelect('Expression channel'); manipulationSection.append(morphs)
    const actions = addSelect('Performance action'); actorsSection.append(actions)
    const selectionListeners = new Set<() => void>()
    const notifySelection = () => { for (const listener of selectionListeners) listener() }
    const getPoseSelection = (): PoseSelection | undefined => {
        const actor = runtime.actors.get(actors.value)
        return actor?.current ? { actorKey: actor.key, generation: actor.descriptor.generation, boneKey: bones.value } : undefined
    }
    const keys = addSelect('Timeline keyframe'); timelineSection.append(keys)
    const setOptions = (select: HTMLSelectElement, rows: { value: string; label: string }[]) => {
        const previous = select.value
        select.replaceChildren()
        for (const row of rows) { const option = document.createElement('option'); option.value = row.value; option.textContent = row.label; select.append(option) }
        if (rows.some(row => row.value === previous)) select.value = previous
        select.disabled = rows.length === 0
    }
    setOptions(mode, [{ value: 'root', label: 'Root placement' }, { value: 'joint', label: 'Joint rotation' }, { value: 'ik', label: 'IK target' }])
    // Joint editing is rotation/IK-only; whole-actor TRS and official action
    // sampling retain their authored channels. Imported data is not rewritten.
    const channels: TrackChannel[] = ['root-position', 'root-rotation', 'root-scale', 'bone-rotation', 'morph', 'action']
    setOptions(channel, channels.map(value => ({ value, label: value })))
    const addNumber = (label: string, initial: string) => {
        const element = document.createElement('input'); element.type = 'number'; element.step = '0.01'; element.value = initial
        element.setAttribute('aria-label', label); timelineSection.append(element); return element
    }
    const time = addNumber('Timeline seconds', '0'); time.min = '0'
    const scrubber = document.createElement('input'); scrubber.type = 'range'; scrubber.step = '0.01'; scrubber.min = '0'; scrubber.max = String(runtime.timeline.value.duration); scrubber.value = '0'
    scrubber.setAttribute('aria-label', 'Timeline scrubber'); scrubber.setAttribute('data-testid', 'performance-timeline-scrubber'); timelineSection.append(scrubber)
    const duration = addNumber('Duration seconds', String(runtime.timeline.value.duration)); duration.min = '0.01'
    const weight = addNumber('Expression weight', '1')
    const loopLabel = document.createElement('label'); loopLabel.textContent = 'Loop '
    const loop = document.createElement('input'); loop.type = 'checkbox'; loop.setAttribute('aria-label', 'Loop performance'); loopLabel.append(loop); timelineSection.append(loopLabel)
    const actionLoopLabel = document.createElement('label'); actionLoopLabel.textContent = 'Loop action '
    const actionLoop = document.createElement('input'); actionLoop.type = 'checkbox'; actionLoop.setAttribute('aria-label', 'Loop action'); actionLoopLabel.append(actionLoop); actorsSection.append(actionLoopLabel)
    let poseControlError: string | undefined
    const refreshStatus = () => { status.textContent = poseControlError || runtime.lastError || (runtime.playing ? 'Playing' : 'Paused / ready') }
    const report = (operation: () => void) => {
        poseControlError = undefined
        try { operation(); status.textContent = runtime.lastError || 'Ready' }
        catch (error) { status.textContent = error instanceof Error ? error.message : String(error) }
    }
    const button = (label: string, onClick: () => void, target: HTMLElement = projectSection) => {
        const element = document.createElement('button'); element.type = 'button'; element.textContent = label
        element.addEventListener('click', () => report(onClick)); target.append(element); return element
    }
    const poseControls: HTMLButtonElement[] = []
    const refreshPoseControls = () => {
        const actor = runtime.actors.get(actors.value)
        for (const control of poseControls) control.disabled = !actor?.current
    }
    const refreshCapabilities = () => {
        const actor = runtime.actors.get(actors.value)
        setOptions(bones, actor ? [...actor.bones.keys()].map(key => ({ value: key, label: actor.labels.get(key) || key })) : [])
        setOptions(morphs, actor ? [...actor.morphs.keys()].map(key => ({ value: key, label: actor.labels.get(key) || key })) : [])
        setOptions(actions, actor ? actor.descriptor.actions.map(name => ({ value: name, label: name })) : [])
        refreshPoseControls()
        notifySelection()
    }
    const refreshActors = () => {
        setOptions(actors, [...runtime.actors.values()].map(actor => ({ value: actor.key, label: `${actor.descriptor.label} [${actor.key.slice(0, 8)}]` })))
        refreshCapabilities()
    }
    const refreshKeys = () => {
        const doc = runtime.timeline.value
        duration.value = String(doc.duration); loop.checked = doc.loop
        setOptions(keys, doc.tracks.flatMap(track => track.keys.map(key => ({ value: JSON.stringify([track.id, key.id]),
            label: `${key.time.toFixed(2)}s · ${track.actorKey.slice(0, 8)} · ${track.channel} · ${key.id}` }))))
    }
    const jointCandidates = document.createElement('div'); jointCandidates.setAttribute('aria-label', "Overlapping joints"); jointCandidates.hidden = true; manipulationSection.append(jointCandidates)
    const clearJointCandidates = () => { jointCandidates.replaceChildren(); jointCandidates.hidden = true }
    actors.addEventListener('change', () => { poseControlError = undefined; runtime.endDrag(); clearJointCandidates(); refreshCapabilities(); refreshStatus() })
    bones.addEventListener('change', () => { runtime.endDrag(); clearJointCandidates(); notifySelection() })
    mode.addEventListener('change', () => { runtime.endDrag(); clearJointCandidates(); notifySelection() })
    const viewportHint = document.createElement('p'); viewportHint.textContent = "Drag joints in the viewport: joint mode rotates, IK mode moves the target. Select an exact joint where nodes overlap. Meshes are not joint drag targets."; viewportHint.setAttribute('data-testid', 'performance-viewport-gizmo-hint'); manipulationSection.append(viewportHint)
    button('Drag selected', () => {
        const result = runtime.beginDrag(actors.value, mode.value as DragMode, bones.value)
        if (result.status === 'unavailable') throw new Error(result.reason)
    }, manipulationSection)
    button('End drag', () => runtime.endDrag(), manipulationSection)
    const applyPoseOperation = (operation: 'undoPose' | 'resetPose') => {
        try {
            // Resolve the current UUID/generation at click time, not at mount or drag start.
            const actor = runtime.actors.get(actors.value)
            if (!actor?.current) { refreshPoseControls(); throw new Error('当前没有可编辑的角色') }
            const result = runtime[operation](actor.key)
            if (result.status !== 'ready') throw new Error(result.reason)
        } catch (error) {
            // A frame update must not replace an unavailable reason with a ready label.
            poseControlError = error instanceof Error ? error.message : String(error)
            throw error
        }
    }
    poseControls.push(button("Undo pose", () => applyPoseOperation('undoPose'), manipulationSection),
        button("Restore official pose", () => applyPoseOperation('resetPose'), manipulationSection))
    const reportJointError = (reason: string) => { poseControlError = reason; refreshStatus() }
    const selectJointFromCanvas = (identity: JointNodeIdentity) => {
        const actor = runtime.actors.get(actors.value)
        if (!actor?.current || actor.key !== identity.actorKey || actor.descriptor.generation !== identity.generation
            || actor.bones.get(identity.boneKey)?.uuid !== identity.boneUuid) {
            const reason = '关节所属角色或骨架已变化，请重新选择'; reportJointError(reason)
            return { status: 'unavailable' as const, reason }
        }
        bones.value = identity.boneKey
        if (mode.value !== 'ik') mode.value = 'joint'
        poseControlError = undefined; clearJointCandidates(); notifySelection()
        const result = runtime.beginDrag(actor.key, mode.value as 'joint' | 'ik', identity.boneKey)
        if (result.status !== 'ready') { reportJointError(result.reason); return result }
        refreshStatus(); return { status: 'ready' as const, value: undefined }
    }
    const showJointCandidates = (identities: readonly JointNodeIdentity[], choose: (identity: JointNodeIdentity) => void) => {
        clearJointCandidates(); jointCandidates.hidden = false
        reportJointError('多个关节重叠，请选择精确关节')
        for (const identity of identities) {
            const control = button(identity.label, () => choose(identity), jointCandidates)
            control.setAttribute('data-joint-uuid', identity.boneUuid)
        }
    }
    button('Capture key', () => {
        const kind = channel.value as TrackChannel
        runtime.captureKey(actors.value, kind, kind === 'morph' ? morphs.value : kind.startsWith('bone-') ? bones.value : undefined,
            kind === 'morph' ? Number(weight.value) : kind === 'action' ? { name: actions.value || null, loop: actionLoop.checked } : undefined)
    }, timelineSection)
    button('Capture full pose', () => runtime.capturePoseKeys(actors.value), timelineSection)
    button('Move key to cursor', () => {
        if (!keys.value) return
        const [trackId, keyId] = JSON.parse(keys.value) as [string, string]
        const key = runtime.timeline.value.tracks.find(track => track.id === trackId)?.keys.find(row => row.id === keyId)
        if (key) { runtime.timeline.upsertKey(trackId, { ...key, time: runtime.time }); refreshKeys(); refreshLanes() }
    }, timelineSection)
    button('Delete key', () => { if (keys.value) { const [track, key] = JSON.parse(keys.value) as [string, string]; runtime.deleteKey(track, key) } }, timelineSection)
    const play = button('Play', () => runtime.play(), timelineSection), pause = button('Pause', () => runtime.pause(), timelineSection), stop = button('Stop / hand back', () => runtime.stop(), timelineSection)
    time.addEventListener('change', () => report(() => runtime.seek(Number(time.value))))
    const updateDocument = () => report(() => runtime.setDocument({ ...runtime.timeline.value, duration: Number(duration.value), loop: loop.checked }))
    duration.addEventListener('change', updateDocument); loop.addEventListener('change', updateDocument)
    scrubber.addEventListener('input', () => report(() => runtime.seek(Number(scrubber.value))))
    const chart = document.createElement('div'); chart.className = 'performance-timeline-chart'; chart.setAttribute('data-testid', 'performance-timeline-chart')
    const ruler = document.createElement('div'); ruler.className = 'performance-timeline-row performance-timeline-ruler'; ruler.setAttribute('role', 'group'); ruler.setAttribute('aria-label', 'Timeline ruler'); ruler.setAttribute('data-testid', 'performance-timeline-ruler')
    const rulerLabel = document.createElement('span'); rulerLabel.className = 'performance-timeline-track-label'; rulerLabel.textContent = "Tracks / seconds"
    const rulerScale = document.createElement('div'); rulerScale.className = 'performance-timeline-rail performance-timeline-scale'
    const cursor = document.createElement('div'); cursor.className = 'performance-timeline-cursor'; cursor.setAttribute('aria-label', 'Timeline cursor'); cursor.setAttribute('data-testid', 'performance-timeline-cursor')
    ruler.append(rulerLabel, rulerScale)
    const lanes = document.createElement('div'); lanes.setAttribute('role', 'group'); lanes.setAttribute('aria-label', 'Timeline lanes'); lanes.setAttribute('data-testid', 'performance-timeline-lanes')
    chart.append(ruler, lanes); timelineSection.append(chart)
    const markerButtons = new Map<string, HTMLButtonElement>()
    let chartDuration = runtime.timeline.value.duration
    const positionPercent = (seconds: number) => Math.min(100, Math.max(0, seconds / Math.max(chartDuration, 0.01) * 100))
    const refreshSelectedKey = () => { for (const [identity, marker] of markerButtons) marker.setAttribute('aria-pressed', String(identity === keys.value)) }
    keys.addEventListener('change', refreshSelectedKey)
    const refreshRuler = () => {
        chartDuration = runtime.timeline.value.duration
        rulerScale.replaceChildren(...Array.from({ length: 11 }, (_, index) => {
            const tick = document.createElement('span'); tick.className = 'performance-timeline-tick'
            tick.textContent = `${(chartDuration * index / 10).toFixed(1)}s`
            tick.style.left = `${index * 10}%`
            return tick
        }), cursor)
    }
    const refreshLanes = () => {
        lanes.replaceChildren(); markerButtons.clear()
        for (const track of runtime.timeline.value.tracks) {
            const row = document.createElement('div'); row.className = 'performance-timeline-row'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', `Timeline track ${track.id}`); row.setAttribute('data-track-id', track.id)
            const label = document.createElement('span'); label.className = 'performance-timeline-track-label'
            label.textContent = `${track.channel}${track.property ? ` · ${track.property}` : ''} · ${track.actorKey.slice(0, 8)}`
            label.title = `${runtime.actors.get(track.actorKey)?.descriptor.label || track.actorKey} · ${label.textContent}`
            const lane = document.createElement('div'); lane.className = 'performance-timeline-rail performance-timeline-key-lane'; row.append(label, lane)
            for (const key of track.keys) {
                const identity = JSON.stringify([track.id, key.id])
                const marker = document.createElement('button'); marker.className = 'performance-timeline-key'; marker.type = 'button'; marker.textContent = '◆'
                marker.setAttribute('aria-label', `Keyframe ${key.id}`); marker.setAttribute('data-key-id', key.id)
                marker.title = `${label.textContent} · ${key.time.toFixed(2)}s`; marker.style.left = `${positionPercent(key.time)}%`
                marker.addEventListener('click', () => report(() => { keys.value = identity; refreshSelectedKey(); runtime.seek(key.time) }))
                markerButtons.set(identity, marker); lane.append(marker)
            }
            lanes.append(row)
        }
        refreshSelectedKey()
    }
    const json = document.createElement('textarea'); json.setAttribute('aria-label', 'Performance document JSON'); json.rows = 4; projectSection.append(json)
    const importInput = document.createElement('input'); importInput.type = 'file'; importInput.accept = 'application/json,.json'; importInput.setAttribute('aria-label', 'Import project file'); importInput.setAttribute('data-testid', 'performance-project-import'); projectSection.append(importInput)
    importInput.addEventListener('change', () => { const file = (importInput as HTMLInputElement).files?.[0]; if (file) void file.text().then(text => report(() => runtime.importProject(text))).catch(error => { status.textContent = error instanceof Error ? error.message : String(error) }) })
    button('Save to JSON', () => { json.value = runtime.timeline.serialize() })
    button('Load from JSON', () => runtime.setDocument(JSON.parse(json.value) as PerformanceDocument))
    button('Save project', () => {
        const storage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage
        if (!storage) throw new Error('Project storage unavailable')
        const serialized = runtime.timeline.serialize(); storage.setItem('magius.performance.editor.v1', serialized); json.value = serialized
    })
    button('Load project', () => {
        const storage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage
        if (!storage) throw new Error('Project storage unavailable')
        const serialized = storage.getItem('magius.performance.editor.v1'); if (!serialized) throw new Error('Saved project absent')
        json.value = serialized; runtime.setDocument(JSON.parse(serialized) as PerformanceDocument)
    })
    const exportProject = button('Export project file', () => {
        const serialized = runtime.timeline.serialize(); json.value = serialized
        if (typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') throw new Error('Project export unavailable')
        const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([serialized], { type: 'application/json' })); link.download = 'magius-performance-project.json'; link.setAttribute('data-testid', 'performance-project-export'); link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0)
    })
    exportProject.setAttribute('data-testid', 'performance-project-export-button')
    container.append(root)
    refreshActors(); refreshKeys()
    const unsubscribe = runtime.subscribe(kind => {
        if (kind === 'actors') { poseControlError = undefined; clearJointCandidates(); refreshActors() }
        if (kind === 'document') { refreshKeys(); refreshRuler(); refreshLanes(); scrubber.max = String(runtime.timeline.value.duration) }
        // Do not overwrite an in-progress cursor edit while the user is typing.
        if (document.activeElement !== time) { time.value = runtime.time.toFixed(3); scrubber.value = String(runtime.time) }
        chart.style.cssText = `--performance-time:${positionPercent(runtime.time)}%`
        refreshPoseControls(); refreshStatus()
    })
    refreshRuler()
    refreshLanes()
    let disposed = false
    return { element: root, status, getPoseSelection, selectJointFromCanvas, showJointCandidates, clearJointCandidates, reportJointError,
        subscribePoseSelection(listener: () => void) { selectionListeners.add(listener); return () => { selectionListeners.delete(listener) } },
        workspaceControls: { transport: [play, pause, stop, time, scrubber], chart, audio: audioPanel.workspaceGroups },
        regions: { resources: actorsSection, properties: manipulationSection, timeline: timelineSection, project: projectSection, audio: audioSection }, dispose() { if (disposed) return; disposed = true; runtime.endDrag(); clearJointCandidates(); selectionListeners.clear(); unsubscribe(); audioPanel.dispose(); root.remove() } }
}
