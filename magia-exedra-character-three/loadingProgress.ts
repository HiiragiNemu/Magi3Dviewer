/** Loading telemetry only: no routing, retries, fake timers or global fetch hooks. */
export type LoadingPhase = 'discovering' | 'downloading' | 'unpacking' | 'decompressing' | 'decoding' | 'assembling' | 'complete'
export type LoadingStatus = 'loading' | 'complete' | 'error' | 'cancelled'
export interface LoadingSnapshot {
    taskId: number; label: string; phase: LoadingPhase; status: LoadingStatus
    currentName: string; currentUrl: string; message: string
    completedFiles: number; totalFiles: number
    downloadedBytes: number; totalBytes?: number; ratio?: number
    unpackedFiles: number; archiveFiles?: number
}
interface FileState { loaded: number; total?: number; done: boolean; network: boolean }
const tasks = new WeakMap<AbortSignal, LoadingTask>()
let nextTaskId = 0
const latestByChannel = new Map<string, LoadingTask>()
const listeners = new Set<(state: LoadingSnapshot) => void>()
export function subscribeLoadingProgress(listener: (state: LoadingSnapshot) => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}
const resourceNames = new Map<string, string>()
export function registerLoadingResourceName(url: string, original: string) { resourceNames.set(url, original) }
export function loadingFileName(url: string): string {
    url = resourceNames.get(url) ?? url
    try {
        const path = new URL(url, 'http://localhost/').pathname
        const name = path.split('/').pop() || path
        try { return decodeURIComponent(name) } catch { return name }
    } catch { return url.split(/[\\/]/).pop() || url }
}
export async function yieldLoadingFrame(signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && !document.hidden) {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    }
    signal?.throwIfAborted()
}
export class LoadingTask {
    readonly id = ++nextTaskId
    readonly signal: AbortSignal
    private files = new Map<string, FileState>()
    private state: LoadingSnapshot
    private abortListener: () => void
    constructor(label: string, signal?: AbortSignal) {
        this.signal = signal ?? new AbortController().signal
        this.state = { taskId: this.id, label, phase: 'discovering', status: 'loading', currentName: '', currentUrl: '', message: '', completedFiles: 0, totalFiles: 0, downloadedBytes: 0, unpackedFiles: 0 }
        this.abortListener = () => this.cancel()
        tasks.set(this.signal, this)
        this.signal.addEventListener('abort', this.abortListener, { once: true })
        if (this.signal.aborted) this.cancel()
    }
    snapshot(): LoadingSnapshot {
        const all = [...this.files.values()]
        const network = all.filter(file => file.network)
        const downloadedBytes = network.reduce((n, file) => n + file.loaded, 0)
        const totalBytes = network.length && network.every(file => file.total !== undefined)
            ? network.reduce((n, file) => n + file.total!, 0) : undefined
        // This is measured progress for discovered resources, not a predicted end-to-end percent.
        const ratio = all.length && all.every(file => file.done || file.total !== undefined) ? all.reduce((n, file) => n + (file.done ? 1 : file.total ? Math.min(1, file.loaded / file.total) : 0), 0) / all.length : undefined
        return { ...this.state, completedFiles: all.filter(file => file.done).length, totalFiles: all.length, downloadedBytes, totalBytes, ratio }
    }
    private publish() {
        const state = this.snapshot()
        for (const listener of listeners) listener(state)
    }
    phase(phase: LoadingPhase, url?: string, message = '') {
        if (this.state.status !== 'loading') return
        this.state.phase = phase
        this.state.message = message
        if (url) { this.state.currentUrl = url; this.state.currentName = loadingFileName(url) }
        this.publish()
    }
    file(url: string, loaded = 0, total?: number, done = false) {
        if (this.state.status !== 'loading') return
        const previous = this.files.get(url)
        const value = Math.max(0, loaded)
        const known = Number.isFinite(total) && total! > 0 && total! >= value ? total : undefined
        this.files.set(url, { loaded: value, total: done ? value : known, done, network: !/^(blob:|data:)/i.test(url) })
        if (!previous) { this.state.currentUrl = url; this.state.currentName = loadingFileName(url) }
        this.publish()
    }
    resource(url: string, done: boolean) {
        if (this.state.status !== 'loading') return
        const previous = this.files.get(url)
        this.files.set(url, previous ? { ...previous, done } : { loaded: 0, done, network: !/^(blob:|data:)/i.test(url) })
        this.state.currentUrl = url; this.state.currentName = loadingFileName(url)
        this.publish()
    }
    unpack(url: string, complete: number, total: number) {
        if (this.state.status !== 'loading') return
        this.state.unpackedFiles = complete; this.state.archiveFiles = total
        this.phase('unpacking', url)
    }
    complete() { this.finish('complete') }
    fail(error: unknown) {
        if (this.signal.aborted || (error instanceof Error && error.name === 'AbortError')) this.cancel()
        else this.finish('error', error instanceof Error ? error.message : String(error))
    }
    cancel() { this.finish('cancelled') }
    private finish(status: LoadingStatus, message = '') {
        if (this.state.status !== 'loading') return
        this.state.status = status; this.state.message = message
        if (status === 'complete') this.state.phase = 'complete'
        this.signal.removeEventListener('abort', this.abortListener)
        // Keep the closed binding until signal collection; late children must not create a new task.
        this.publish()
    }
}
export function getLoadingTask(signal?: AbortSignal) { return signal ? tasks.get(signal) : undefined }
export function startLoadingTask(label: string, signal?: AbortSignal, channel?: string): LoadingTask {
    if (channel) latestByChannel.get(channel)?.cancel()
    const task = new LoadingTask(label, signal)
    if (channel) latestByChannel.set(channel, task)
    task.phase('discovering')
    return task
}
export async function withLoadingTask<T>(label: string, signal: AbortSignal | undefined, work: (signal: AbortSignal, task: LoadingTask) => Promise<T>): Promise<T> {
    const previous = getLoadingTask(signal)
    const inherited = previous?.snapshot().status === 'loading' ? previous : undefined
    const task = inherited ?? startLoadingTask(label, signal)
    try {
        const result = await work(task.signal, task)
        task.signal.throwIfAborted()
        if (!inherited) task.complete()
        return result
    } catch (error) { if (!inherited) task.fail(error); throw error }
}
export interface ReadLoadingResponseOptions {
    url: string; signal?: AbortSignal; expectedBytes?: number
    onProgress?: (loaded: number, total?: number) => void
}
export async function readLoadingResponse(response: Response, options: ReadLoadingResponseOptions): Promise<ArrayBuffer> {
    const { url, signal, onProgress } = options
    signal?.throwIfAborted()
    const task = getLoadingTask(signal)
    const header = response.headers.get('content-length')
    const encoding = response.headers.get('content-encoding')
    const declared = options.expectedBytes ?? ((!encoding || encoding === 'identity') && header ? Number(header) : undefined)
    let total = Number.isSafeInteger(declared) && declared! > 0 ? declared : undefined
    let loaded = 0
    task?.phase('downloading', url)
    const update = (done = false) => {
        if (total !== undefined && loaded > total) total = undefined
        task?.file(url, loaded, total, done)
        onProgress?.(loaded, total)
    }
    update()
    if (!response.body) {
        const bytes = await response.arrayBuffer()
        signal?.throwIfAborted(); loaded = bytes.byteLength; update(true)
        return bytes
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined) }
    signal?.addEventListener('abort', abort, { once: true })
    try {
        while (true) {
            signal?.throwIfAborted()
            const next = await reader.read()
            signal?.throwIfAborted()
            if (next.done) break
            chunks.push(next.value); loaded += next.value.byteLength; update()
        }
        const bytes = new Uint8Array(loaded)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
        update(true)
        return bytes.buffer
    } catch (error) {
        await reader.cancel().catch(() => undefined)
        throw error
    } finally {
        signal?.removeEventListener('abort', abort)
        reader.releaseLock()
    }
}
