import { subscribeLoadingProgress, type LoadingSnapshot } from '../../magia-exedra-character-three/loadingProgress.ts'
const phaseLabels = {
    discovering: '发现资源', downloading: '下载资源', unpacking: '解包资源',
    decompressing: '解压资源', decoding: '解码模型与纹理', assembling: '组装场景与材质', complete: '准备完成',
}
function bytesLabel(value: number) {
    const units = ['B', 'KB', 'MB', 'GB']; let unit = 0; let n = Math.max(0, value)
    while (n >= 1024 && unit < 3) { n /= 1024; unit++ }
    return `${unit === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[unit]}`
}
export function createLoadingProgressPanel(doc: Document) {
    const card = doc.getElementById('load-progress-card')!
    const title = doc.getElementById('load-progress')!
    const current = doc.getElementById('load-progress-file')!
    const track = doc.getElementById('load-progress-track')!
    const bar = doc.getElementById('load-progress-bar')!
    const count = doc.getElementById('load-progress-count')!
    const bytes = doc.getElementById('load-progress-bytes')!
    const percent = doc.getElementById('load-progress-percent')!
    const states = new Map<number, LoadingSnapshot>()
    let latestId = 0; let typedSeen = false; let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined
    const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
    const display = (state: LoadingSnapshot) => {
        if (disposed) return
        latestId = state.taskId; clearTimer()
        card.hidden = state.status === 'cancelled'
        card.dataset.state = state.status === 'error' ? 'error' : state.status
        card.dataset.phase = state.phase
        title.textContent = state.status === 'error' ? `${state.label}失败` : `${state.label} · ${phaseLabels[state.phase]}`
        const unpacked = state.phase === 'unpacking' && state.archiveFiles !== undefined ? ` · 解包 ${state.unpackedFiles} / ${state.archiveFiles}` : ''
        current.textContent = state.status === 'error'
            ? `${state.currentName ? state.currentName + ' · ' : ''}${state.message}`
            : `${state.currentName || '正在读取资源定义…'}${unpacked}`
        current.title = current.textContent
        count.textContent = `${state.completedFiles} / ${state.totalFiles} 个已发现文件`
        bytes.textContent = `${bytesLabel(state.downloadedBytes)} / ${state.totalBytes === undefined ? '总量待确认' : bytesLabel(state.totalBytes)}`
        // Resource ratio is measured. Assembly completion is an independent terminal event.
        if (state.ratio === undefined) {
            bar.style.width = '0%'; track.removeAttribute('aria-valuenow')
            percent.textContent = '…'
        } else {
            bar.style.width = `${state.ratio * 100}%`
            track.setAttribute('aria-valuenow', String(state.ratio))
            percent.textContent = `${Math.round(state.ratio * 100)}%`
        }
        track.setAttribute('aria-valuetext', `${phaseLabels[state.phase]}；${count.textContent}；${bytes.textContent}`)
        if (state.status === 'complete') {
            const completedId = state.taskId
            timer = setTimeout(() => {
                if (disposed || completedId !== latestId) return
                const pending = [...states.values()].filter(value => value.status === 'loading').sort((a, b) => b.taskId - a.taskId)[0]
                if (pending) display(pending)
                else card.hidden = true
            }, 180)
        }
    }
    const render = (state: LoadingSnapshot) => {
        if (disposed) return
        typedSeen = true
        const previous = states.get(state.taskId)
        if (previous && previous.status !== 'loading') return
        states.set(state.taskId, state)
        // Older concurrent tasks keep their state, but never paint over the current task.
        if (state.taskId < latestId) return
        if (state.status === 'cancelled') {
            const pending = [...states.values()].filter(value => value.status === 'loading').sort((a, b) => b.taskId - a.taskId)[0]
            if (pending) { display(pending); return }
        }
        display(state)
    }
    const unsubscribe = subscribeLoadingProgress(render)
    return {
        render,
        legacy(text: string, detail?: { fileName?: string; loaded?: number; total?: number }) {
            // Untyped callbacks from old consumers must not clear a typed task or overwrite its failure.
            if (disposed || typedSeen) return
            card.hidden = !text; title.textContent = text
            current.textContent = detail?.fileName ?? ''
            track.removeAttribute('aria-valuenow'); bar.style.width = '0%'
        },
        dispose() { disposed = true; clearTimer(); unsubscribe() },
    }
}
