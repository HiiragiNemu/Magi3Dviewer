import { isVoiceRuntimeReady } from '../voice/catalog.ts'
import type { VoiceCatalogEntry } from '../voice/catalog.ts'
import type { AudioTimelineBridge, AudioTimelineTrackState } from './audioTimelineBridge.ts'
import type { PerformanceEditorRuntime } from './runtime.ts'
import type { PerformanceAudioTrack } from './types.ts'

/** Authoring only. Media, clock, gestures and mouth ownership stay in the bridge. */
export function mountAudioTrackPanel(container: HTMLElement, runtime: PerformanceEditorRuntime, audio?: AudioTimelineBridge) {
    const document = container.ownerDocument, root = document.createElement('div')
    root.className = 'performance-audio-editor'; root.setAttribute('data-testid', 'performance-audio-authoring')
    const cleanups: (() => void)[] = [], rowCleanups: (() => void)[] = []
    let disposed = false, entries: readonly VoiceCatalogEntry[] | undefined, sourceKey = '', selectedId = '', revision = '', dirty = false, committing = false, serial = 1
    const currentTracks = () => runtime.timeline.value.audioTracks ?? []
    const on = (element: HTMLElement, event: string, callback: () => void, releases = cleanups) => {
        const listener = () => { if (!disposed) callback() }
        element.addEventListener(event, listener); releases.push(() => element.removeEventListener?.(event, listener))
    }
    const output = (testid: string, live = false) => { const el = document.createElement('output'); el.setAttribute('data-testid', testid); if (live) el.setAttribute('aria-live', 'polite'); root.append(el); return el }
    const catalogStatus = output('performance-audio-catalog-status', true)
    const field = <T extends HTMLElement>(label: string, element: T, parent: HTMLElement = root): T => {
        const wrap = document.createElement('label'); wrap.className = 'performance-audio-field'; wrap.textContent = label
        element.setAttribute('aria-label', label); wrap.append(element); parent.append(wrap); return element
    }
    const search = field("Search audio", document.createElement('input')); search.type = 'search'; search.placeholder = "Character ID, original text, translation or stable key"
    const sources = field("Audio source", document.createElement('select')); sources.size = 5
    const sourceInfo = output('performance-audio-source-info')
    const trackSelect = field("Audio track", document.createElement('select'))
    const targets = field("Audio target", document.createElement('select'))
    const targetBindings = new Map<string, { actorKey: string; generation: number }>()
    const targetToken = (track: { actorKey?: string; generation?: number }) => track.actorKey === undefined ? 'background' : JSON.stringify([track.actorKey, track.generation])
    const bindingLabel = (track: { actorKey?: string; generation?: number }) => track.actorKey === undefined ? "Background (no character lip sync)" : `${track.actorKey} · generation ${track.generation}`
    const numbers = document.createElement('div'); numbers.className = 'performance-audio-numbers'; root.append(numbers)
    const number = (label: string, initial: string, min: string, max?: string) => {
        const input = field(label, document.createElement('input'), numbers); input.type = 'number'; input.step = '0.01'; input.min = min; input.value = initial; if (max !== undefined) input.max = max; return input
    }
    const start = number("Start (seconds)", '0', '0'), offset = number("Media offset (seconds)", '0', '0')
    const duration = number("Duration (seconds)", '', '0.01'); duration.placeholder = "Leave blank to play the remaining source duration"
    const volume = number("Volume", '1', '0', '1')
    const lipSync = field("Enable lip sync", document.createElement('input')); lipSync.type = 'checkbox'
    const actions = document.createElement('div'); actions.className = 'performance-audio-actions'; root.append(actions)
    const button = (label: string, callback: () => void) => { const el = document.createElement('button'); el.type = 'button'; el.textContent = label; on(el, 'click', callback); actions.append(el); return el }
    const notice = output('performance-audio-authoring-status', true)
    const audioStatus = output('performance-audio-status')
    const rows = document.createElement('div'); rows.className = 'performance-audio-tracks'; rows.setAttribute('data-testid', 'performance-audio-tracks'); root.append(rows)
    const rowViews = new Map<string, { state: HTMLOutputElement; error: HTMLOutputElement; level: HTMLMeterElement; meterText: HTMLElement; select: HTMLButtonElement }>()
    const localImport = document.createElement('p'); localImport.className = 'performance-audio-note'; localImport.textContent = '当前声源来自已有语音目录。本地音乐导入：待实现，未混入目录。口型为实际 PCM 电平响应，不是音素标注。'; root.append(localImport)
    const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase()
    const entryLabel = (entry: VoiceCatalogEntry) => `${entry.characterResourceId} #${entry.order} · ${Object.entries(entry.subtitles).map(([locale, text]) => `${locale}: ${text}`).join(' · ') || '原文/译文未提供'} · ${entry.stableKey}`
    const entry = () => entries?.find(row => row.stableKey === sourceKey)
    const unavailable = (row: VoiceCatalogEntry) => [...row.audio.failClosedReasons, ...(!row.audio.runtimeReady ? ['runtimeReady=false'] : []), ...(!row.audio.runtimeUrl ? ['媒体 URL 缺失'] : [])].join(' · ')
    const option = (select: HTMLSelectElement, value: string, label: string) => { const el = document.createElement('option'); el.value = value; el.textContent = label; select.append(el); return el }
    const targetCurrent = () => {
        if (targets.value === 'background') return true
        const binding = targetBindings.get(targets.value), actor = binding && runtime.actors.get(binding.actorKey)
        return !!actor?.current && actor.descriptor.generation === binding!.generation
    }
    const conflict = () => !!selectedId && (!currentTracks().some(row => row.id === selectedId) || JSON.stringify(currentTracks().find(row => row.id === selectedId)) !== revision)
    const refreshActions = () => {
        const source = entry(), valid = !!audio && !!source && isVoiceRuntimeReady(source) && targetCurrent()
        add.disabled = !valid; save.disabled = !valid || !selectedId || conflict(); remove.disabled = !selectedId || conflict()
    }
    const refreshSourceInfo = () => {
        const source = entry()
        sourceInfo.textContent = source ? `${entryLabel(source)}\n${isVoiceRuntimeReady(source) ? '媒体已列为可用（播放结果见每轨状态）' : `缺媒体 / 不可用：${unavailable(source)}`}${source.durationSeconds === undefined ? '' : ` · 媒体时长 ${source.durationSeconds}s`}`
            : sourceKey ? `目录中缺少此精确声源：${sourceKey}` : '请选择实际声源；搜索不会自动更换已选声源。'
        refreshActions()
    }
    const refreshSources = () => {
        const query = normalize(search.value).trim()
        const matches = (entries ?? []).filter(row => !query || normalize(`${entryLabel(row)} ${row.audio.sourceStableKey}`).includes(query))
        sources.replaceChildren(); option(sources, '', "Choose audio source")
        for (const row of matches) option(sources, row.stableKey, `${isVoiceRuntimeReady(row) ? '' : '[缺媒体] '}${entryLabel(row)}`)
        sources.value = matches.some(row => row.stableKey === sourceKey) ? sourceKey : ''
        sources.disabled = !audio || entries === undefined
        search.disabled = !audio || entries === undefined
        catalogStatus.textContent = !audio ? '音频消费者尚未挂载' : entries === undefined ? '语音目录加载中 / 等待目录…' : `声源 ${matches.length} / ${entries.length} · 全目录（含缺媒体条目）`
        refreshSourceInfo()
    }
    const refreshTargets = (value = targets.value || 'background') => {
        targets.replaceChildren(); targetBindings.clear(); option(targets, 'background', "Background (not bound to a character)")
        for (const actor of runtime.actors.values()) {
            if (!actor.current) continue
            const binding = { actorKey: actor.key, generation: actor.descriptor.generation }, token = targetToken(binding)
            targetBindings.set(token, binding); option(targets, token, `${actor.descriptor.label} · ${bindingLabel(binding)}`)
        }
        if (value !== 'background' && !targetBindings.has(value)) option(targets, value, `失效绑定 / Stale：${value}（请明确重选）`).disabled = true
        targets.value = value; refreshActions()
    }
    const showSelection = () => { for (const [id, view] of rowViews) view.select.setAttribute('aria-pressed', String(id === selectedId)) }
    const loadTrack = (track?: PerformanceAudioTrack) => {
        selectedId = track?.id ?? ''; revision = track ? JSON.stringify(track) : ''; dirty = false
        sourceKey = track?.sourceStableKey ?? sourceKey
        start.value = String(track?.startTime ?? runtime.time); offset.value = String(track?.offsetSeconds ?? 0)
        duration.value = track?.durationSeconds === undefined ? '' : String(track.durationSeconds); volume.value = String(track?.volume ?? 1); lipSync.checked = track?.lipSync === true
        trackSelect.value = selectedId; refreshTargets(track ? targetToken(track) : 'background'); refreshSources(); showSelection()
        notice.textContent = track ? `编辑 ${track.id}；保存仅修改此轨。${targetCurrent() ? '' : ' 原绑定已失效，请明确重选目标。'}` : '新音轨；添加始终创建独立 ID，不覆盖同声源的其他轨。'
    }
    const renderStates = (states: readonly AudioTimelineTrackState[]) => {
        const byId = new Map(states.map(state => [state.id, state]))
        for (const [id, view] of rowViews) {
            const state = byId.get(id)
            view.state.textContent = state ? `${state.status} · 媒体 ${state.currentTime.toFixed(3)}s · 口型 ${state.lipSyncStatus}` : '等待音频消费者状态'
            view.error.textContent = state ? [state.error, state.lipSyncError].filter(Boolean).join(' · ') : ''
            view.level.value = state && Number.isFinite(state.rawRms) ? Math.max(0, Math.min(1, state.rawRms)) : 0
            view.meterText.textContent = state ? `RMS ${state.rawRms.toFixed(4)} · mouth ${state.mouthOpen.toFixed(4)}` : '电平待测'
        }
        audioStatus.textContent = states.length ? `${states.filter(state => state.status === 'playing').length}/${states.length} tracks active` : 'No audio tracks in this project'
    }
    const renderRows = () => {
        for (const cleanup of rowCleanups.splice(0)) cleanup()
        rows.replaceChildren(); rowViews.clear(); trackSelect.replaceChildren(); option(trackSelect, '', "New track")
        for (const track of currentTracks()) {
            option(trackSelect, track.id, `${track.id} · ${bindingLabel(track)}`)
            const row = document.createElement('section'); row.className = 'performance-audio-track'; row.setAttribute('data-track-id', track.id)
            const select = document.createElement('button'); select.type = 'button'; select.textContent = `编辑 ${track.id}`; select.setAttribute('aria-label', `Edit audio track ${track.id}`)
            on(select, 'click', () => { const current = currentTracks().find(value => value.id === track.id); if (current) loadTrack(current) }, rowCleanups)
            const binding = document.createElement('div'); binding.textContent = bindingLabel(track); binding.setAttribute('data-testid', 'audio-track-binding')
            const state = document.createElement('output'), error = document.createElement('output'); error.className = 'performance-audio-error'; error.setAttribute('data-testid', 'audio-track-error')
            const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = "Source and timing"
            const identity = document.createElement('div'); identity.textContent = `${track.sourceStableKey}\nstart ${track.startTime}s · offset ${track.offsetSeconds ?? 0}s · duration ${track.durationSeconds ?? 'auto'} · volume ${track.volume ?? 1}`; details.append(summary, identity)
            const level = document.createElement('meter'); level.min = 0; level.max = 1; level.value = 0; level.setAttribute('aria-label', `Audio RMS ${track.id}`)
            const meterText = document.createElement('span'); meterText.className = 'performance-audio-level-text'
            row.append(select, binding, state, error, level, meterText, details); rows.append(row); rowViews.set(track.id, { state, error, level, meterText, select })
        }
        if (selectedId && !currentTracks().some(row => row.id === selectedId)) option(trackSelect, selectedId, `已移除 / Stale：${selectedId}`).disabled = true
        trackSelect.value = selectedId; showSelection(); renderStates(audio?.snapshot ?? []); refreshActions()
    }
    const readNumber = (input: HTMLInputElement, optional = false) => {
        if (optional && input.value.trim() === '') return undefined
        if (!input.value.trim() || !Number.isFinite(Number(input.value))) throw new Error('请输入有限数值；仅时长/偏移允许留空。')
        return Number(input.value)
    }
    const readDraft = (id: string, previous?: PerformanceAudioTrack): PerformanceAudioTrack => {
        const source = entry(); if (!source || !isVoiceRuntimeReady(source)) throw new Error(source ? unavailable(source) : '请选择目录中的实际可用声源')
        if (!targetCurrent()) throw new Error('音轨目标 UUID/generation 已失效，请明确重选；不会改绑当前角色。')
        const target = targets.value === 'background' ? {} : targetBindings.get(targets.value)!
        const track: PerformanceAudioTrack = { ...previous, id, sourceStableKey: source.stableKey, startTime: readNumber(start)!, volume: readNumber(volume), lipSync: lipSync.checked }
        delete track.actorKey; delete track.generation; Object.assign(track, target)
        const offsetValue = readNumber(offset, true), durationValue = readNumber(duration, true)
        if (offsetValue === undefined) delete track.offsetSeconds; else track.offsetSeconds = offsetValue
        if (durationValue === undefined) delete track.durationSeconds; else track.durationSeconds = durationValue
        return track
    }
    const commit = (kind: 'add' | 'save' | 'remove') => {
        try {
            const doc = runtime.timeline.value, tracks = doc.audioTracks ?? []
            if (kind !== 'add' && (!selectedId || conflict())) throw new Error('音轨已被删除或外部更新；请重新选择后编辑。')
            let id = selectedId
            if (kind === 'add') { do { id = `audio-${serial++}` } while (tracks.some(track => track.id === id)) }
            const replacement = kind === 'remove' ? undefined : readDraft(id, kind === 'save' ? tracks.find(track => track.id === id) : undefined)
            const next = kind === 'add' ? [...tracks, replacement!] : kind === 'remove' ? tracks.filter(track => track.id !== id) : tracks.map(track => track.id === id ? replacement! : track)
            committing = true
            try { runtime.setDocument({ ...doc, audioTracks: next }) } finally { committing = false }
            loadTrack(replacement); renderRows(); notice.textContent = kind === 'remove' ? `已删除 ${id}` : `已${kind === 'add' ? '添加' : '保存'} ${id}；请在时间轴按 Play 播放。`
        } catch (error) { notice.textContent = error instanceof Error ? error.message : String(error); refreshActions() }
    }
    const newTrack = button("New track", () => loadTrack())
    const add = button("Add track", () => commit('add'))
    const save = button("Save track", () => commit('save'))
    const remove = button("Delete track", () => commit('remove'))
    newTrack.setAttribute('data-testid', 'performance-audio-new')
    on(search, 'input', refreshSources)
    on(sources, 'change', () => { if (sources.value) { sourceKey = sources.value; dirty = true }; refreshSourceInfo() })
    on(trackSelect, 'change', () => loadTrack(currentTracks().find(track => track.id === trackSelect.value)))
    on(targets, 'change', () => { dirty = true; refreshActions() })
    for (const input of [start, offset, duration, volume, lipSync]) on(input, 'input', () => { dirty = true })
    container.append(root); loadTrack(); renderRows()
    cleanups.push(runtime.subscribe(kind => {
        if (kind === 'actors') { refreshTargets(); renderStates(audio?.snapshot ?? []) }
        if (kind === 'document') {
            if (!committing && selectedId) {
                const next = currentTracks().find(track => track.id === selectedId)
                if (!dirty && next) loadTrack(next)
                else if (conflict()) notice.textContent = '音轨已从外部更新/移除，保留当前草稿；请重新选择后编辑。'
            }
            renderRows()
        }
    }))
    if (audio) {
        cleanups.push(audio.subscribe(renderStates))
        cleanups.push(audio.subscribeCatalog(value => { entries = value; refreshSources() }))
    }
    return { element: root,
        workspaceGroups: {
            library: [catalogStatus, search.parentElement!, sources.parentElement!, sourceInfo, localImport],
            clip: [trackSelect.parentElement!, targets.parentElement!, numbers, lipSync.parentElement!],
            tracks: [audioStatus, rows], common: [actions, notice],
        },
        dispose() { if (disposed) return; disposed = true; for (const release of [...rowCleanups.splice(0), ...cleanups.splice(0)]) release(); root.remove() } }
}
