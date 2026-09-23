export interface PanelRect { left: number; top: number; width: number; height: number }
export type ResizeCorner = 'nw' | 'se'

export function resizePanelRect(rect: PanelRect, dx: number, dy: number, corner: ResizeCorner, minWidth = 180, minHeight = 140): PanelRect {
    const sign = corner === 'nw' ? -1 : 1
    const width = Math.max(minWidth, rect.width + sign * dx)
    const height = Math.max(minHeight, rect.height + sign * dy)
    return { left: corner === 'nw' ? rect.left + rect.width - width : rect.left,
        top: corner === 'nw' ? rect.top + rect.height - height : rect.top, width, height }
}

function readRect(panel: HTMLElement): PanelRect {
    const { left, top, width, height } = panel.getBoundingClientRect()
    return { left, top, width, height }
}

function writeRect(panel: HTMLElement, rect: PanelRect) {
    panel.dataset.panelUserPositioned = 'true'
    Object.assign(panel.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
        height: `${rect.height}px`, right: 'auto', bottom: 'auto', transform: 'none', margin: '0' })
}

export function setupFloatingPanelResize(panel: HTMLElement, corner: ResizeCorner): () => void {
    const handle = panel.ownerDocument.createElement('div')
    handle.className = `floating-panel-resize-handle resize-${corner}`
    handle.setAttribute('role', 'separator')
    handle.setAttribute('aria-label', corner === 'nw' ? '左上角调整面板大小' : '右下角调整面板大小')
    panel.append(handle)
    const abort = new AbortController()
    const { signal } = abort
    let start: { pointerId: number; x: number; y: number; rect: PanelRect; minWidth: number; minHeight: number } | undefined
    handle.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return
        const rect = readRect(panel)
        const style = getComputedStyle(panel)
        start = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect,
            minWidth: Math.max(180, parseFloat(style.minWidth) || 0), minHeight: Math.max(140, parseFloat(style.minHeight) || 0) }
        writeRect(panel, rect)
        handle.setPointerCapture(event.pointerId)
        event.stopPropagation()
        event.preventDefault()
    }, { signal })
    handle.addEventListener('pointermove', event => {
        if (!start || start.pointerId !== event.pointerId) return
        writeRect(panel, resizePanelRect(start.rect, event.clientX - start.x, event.clientY - start.y, corner, start.minWidth, start.minHeight))
        event.preventDefault()
    }, { signal })
    const end = (event: PointerEvent) => {
        if (start?.pointerId !== event.pointerId) return
        start = undefined
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    }
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) handle.addEventListener(type, end, { signal })
    return () => { abort.abort(); handle.remove() }
}

export function setupFloatingPanelDrag(panel: HTMLElement, handle: HTMLElement): () => void {
    const abort = new AbortController()
    const { signal } = abort
    let start: { pointerId: number; x: number; y: number; rect: PanelRect } | undefined
    handle.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return
        if ((event.target as Element).closest('button, input, select, textarea, a, label')) return
        start = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect: readRect(panel) }
        writeRect(panel, start.rect)
        handle.setPointerCapture(event.pointerId)
        event.preventDefault()
    }, { signal })
    handle.addEventListener('pointermove', event => {
        if (!start || start.pointerId !== event.pointerId) return
        writeRect(panel, { ...start.rect, left: start.rect.left + event.clientX - start.x, top: start.rect.top + event.clientY - start.y })
        event.preventDefault()
    }, { signal })
    const end = (event: PointerEvent) => {
        if (start?.pointerId !== event.pointerId) return
        start = undefined
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    }
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) handle.addEventListener(type, end, { signal })
    const cleanups = [setupFloatingPanelResize(panel, 'nw'), setupFloatingPanelResize(panel, 'se')]
    return () => { abort.abort(); for (const cleanup of cleanups) cleanup() }
}
