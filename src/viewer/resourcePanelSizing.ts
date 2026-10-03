import { translateUiText } from './localization/zhCN'

/** One shared preset for character/witch portraits; scenes retain landscape cards. */
export function installResourcePanelSizeToggle(panel: HTMLElement) {
    const header = panel.querySelector<HTMLElement>('.floating-panel-header')
    const grid = panel.querySelector<HTMLElement>('.runtime-selection-thumbnail-grid')
    if (!header || !grid || header.querySelector('.resource-size-toggle')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'resource-size-toggle'
    button.dataset.i18nIgnore = 'true'
    header.insertBefore(button, header.querySelector('.floating-panel-close'))
    let savedStyle: string | undefined
    let savedPosition: string | undefined
    let queued = false
    const label = () => {
        button.textContent = translateUiText(savedStyle === undefined ? 'Compact view' : 'Restore size')
        button.title = translateUiText(grid.classList.contains('scene-thumbnail-grid') ? 'Show 3 columns and 2 rows' : 'Show 5 columns and 2 rows')
        button.setAttribute('aria-pressed', String(savedStyle !== undefined))
    }
    const fitTwoRows = () => {
        queued = false
        if (savedStyle === undefined || !panel.classList.contains('is-open')) return
        const current = panel.getBoundingClientRect(), width = Math.min(536, window.innerWidth - 16)
        panel.style.width = `${width}px`
        panel.style.left = `${Math.max(8, Math.min(current.left, window.innerWidth - width - 8))}px`
        const rows = new Map<number, number>()
        for (const tile of grid.querySelectorAll<HTMLElement>('.runtime-selection-tile')) {
            const r = tile.getBoundingClientRect()
            rows.set(r.top, Math.max(rows.get(r.top) || 0, r.height))
            if (rows.size > 2) break
        }
        const heights = [...rows.values()].slice(0, 2)
        if (!heights.length) return
        if (heights.length === 1) heights.push(heights[0])
        const style = getComputedStyle(grid)
        const content = heights[0] + heights[1] + parseFloat(style.rowGap) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        const rect = panel.getBoundingClientRect()
        const height = Math.min(window.innerHeight - 16, Math.ceil(rect.height - grid.getBoundingClientRect().height + content))
        panel.style.height = `${height}px`
        panel.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))}px`
    }
    const schedule = () => {
        if (savedStyle === undefined || queued) return
        queued = true
        window.requestAnimationFrame(fitTwoRows)
    }
    const keepControlsOnScreen = () => {
        if (!panel.classList.contains('is-open') || panel.dataset.panelUserPositioned !== 'true') return
        const rect = panel.getBoundingClientRect()
        panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`
        panel.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - rect.height - 8))}px`
        schedule()
    }
    button.onclick = () => {
        if (savedStyle !== undefined) {
            panel.style.cssText = savedStyle
            if (savedPosition === undefined) delete panel.dataset.panelUserPositioned
            else panel.dataset.panelUserPositioned = savedPosition
            savedStyle = undefined
            panel.classList.remove('resource-is-compact')
        } else {
            savedStyle = panel.style.cssText
            savedPosition = panel.dataset.panelUserPositioned
            const rect = panel.getBoundingClientRect(), width = Math.min(536, window.innerWidth - 16)
            Object.assign(panel.style, { width: `${width}px`, height: `${Math.min(680, window.innerHeight - 16)}px`,
                left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`, top: `${Math.max(8, rect.top)}px`,
                right: 'auto', bottom: 'auto', transform: 'none', margin: '0' })
            panel.dataset.panelUserPositioned = 'true'
            panel.classList.add('resource-is-compact')
            grid.scrollTop = 0
            schedule()
        }
        label()
    }
    // A deliberate drag resize leaves the preset, without snapping back mid-drag.
    panel.addEventListener('pointerdown', event => {
        if (!(event.target as Element).closest('.floating-panel-resize-handle')) return
        savedStyle = undefined
        panel.classList.remove('resource-is-compact')
        label()
    })
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(schedule)
        for (const element of panel.querySelectorAll('.resource-search, .resource-panel-footer')) observer.observe(element)
    }
    new MutationObserver(schedule).observe(grid, { childList: true })
    new MutationObserver(keepControlsOnScreen).observe(panel, { attributes: true, attributeFilter: ['class'] })
    document.addEventListener('magius:localechange', () => { label(); schedule() })
    window.addEventListener('resize', keepControlsOnScreen)
    label()
}
