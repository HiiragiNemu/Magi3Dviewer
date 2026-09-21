import type { mountPerformancePanel } from './panel.ts'
type WorkspaceOptions = {
    workspace: HTMLElement; panel: ReturnType<typeof mountPerformancePanel>; toggle: HTMLButtonElement
    onExit: () => void; onOpenChange?: (open: boolean) => void; onFrameActor?: () => void
}
/** Presentation only. Original controls, canvas, listeners, document and leases remain owned by the host. */
export function mountPerformanceWorkspace({ workspace, panel, toggle, onExit, onOpenChange, onFrameActor }: WorkspaceOptions) {
    const document = workspace.ownerDocument, app = workspace.parentElement
    const viewer = document.getElementById('viewer')
    const resources = ['characters', 'scenes', 'actions'].map(name => document.querySelector<HTMLElement>(`[data-performance-resource="${name}"]`))
    if (!app || viewer?.parentElement !== workspace || resources.some(node => !node)) throw new Error('Performance workspace requires the existing viewport and resource controls')
    const previousWorkspaceMode = workspace.getAttribute('data-performance-mode'), previousAppMode = app.getAttribute('data-performance-mode')
    const previousControls = toggle.getAttribute('aria-controls'), previousExpanded = toggle.getAttribute('aria-expanded')
    const previousDock = workspace.getAttribute('data-performance-dock')
    const nodes: HTMLElement[] = [], cleanups: (() => void)[] = []
    const listen = (node: HTMLElement, event: string, listener: (event: Event) => void) => { node.addEventListener(event, listener); cleanups.push(() => node.removeEventListener(event, listener)) }
    const addSelector = document.getElementById('character-add-selector') as HTMLSelectElement | null
    const addPicker = addSelector?.parentElement?.previousElementSibling as HTMLButtonElement | null
    if (addSelector && addPicker?.tagName === 'BUTTON') listen(addPicker, 'click', () => { addSelector.focus(); addSelector.showPicker?.() })
    const element = (tag: string, className: string, label?: string) => { const el = document.createElement(tag); el.className = className; if (label) el.setAttribute('aria-label', label); return el }
    const region = (tag: string, area: string, label: string) => {
        const el = element(tag, `performance-workspace-region performance-workspace-${area}`, label)
        el.id = `performance-workspace-${area}`; el.hidden = true; nodes.push(el); workspace.append(el); return el
    }
    const header = region('header', 'header', 'Performance workspace')
    const heading = document.createElement('strong'); heading.textContent = '演出 / Performance'
    const button = (text: string, action: () => void) => { const el = document.createElement('button'); el.type = 'button'; el.textContent = text; listen(el, 'click', action); return el }
    const close = button('Return to Viewer', () => setOpen(false))
    const frameActor = button('框选当前角色', () => onFrameActor?.()); frameActor.disabled = !onFrameActor; frameActor.setAttribute('aria-label', 'Frame selected actor')
    const dockToggle = button('收起工具', () => {
        const collapsed = workspace.getAttribute('data-performance-dock') !== 'collapsed'
        workspace.setAttribute('data-performance-dock', collapsed ? 'collapsed' : 'open')
        dockToggle.textContent = collapsed ? '展开工具' : '收起工具'; dockToggle.setAttribute('aria-expanded', String(!collapsed))
    }); dockToggle.setAttribute('aria-controls', 'performance-workspace-resources'); dockToggle.setAttribute('aria-expanded', 'true')
    const help = document.createElement('details'), summary = document.createElement('summary'), hint = document.createElement('small')
    summary.textContent = '操作提示'; hint.textContent = '空心圈是关节；重叠处选择精确节点。关节模式旋转，IK 模式移动目标；取景后可自由缩放/旋转。'
    help.append(summary, hint); header.append(heading, dockToggle, frameActor, close, help)
    const library = region('aside', 'resources', 'Performance task tools')
    const timeline = region('section', 'timeline', 'Audio and action timeline')
    const transport = element('div', 'performance-transport', 'Transport'); timeline.append(transport)
    const chartHost = element('div', 'performance-chart-host', 'Keyframe tracks'); timeline.append(chartHost)
    const tabsets: { select: (index: number, focus?: boolean) => void; selected: number }[] = []
    const tabs = (parent: HTMLElement, id: string, labels: string[]) => {
        const nav = element('div', 'performance-task-tabs'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', id)
        const pages = labels.map((label, index) => {
            const page = element('section', 'performance-task-page', label); page.id = `${id}-page-${index}`; page.setAttribute('role', 'tabpanel'); return page
        })
        const buttons = labels.map((label, index) => {
            const tab = button(label, () => state.select(index)); tab.id = `${id}-tab-${index}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', pages[index].id)
            pages[index].setAttribute('aria-labelledby', tab.id); nav.append(tab); return tab
        })
        const state = { selected: 0, select(index: number, focus = false) {
            state.selected = index
            pages.forEach((page, i) => { page.hidden = i !== index; buttons[i].setAttribute('aria-selected', String(i === index)); buttons[i].setAttribute('tabindex', i === index ? '0' : '-1') })
            if (focus) buttons[index].focus()
        } }
        buttons.forEach((tab, index) => listen(tab, 'keydown', event => {
            const key = (event as KeyboardEvent).key
            const next = key === 'ArrowRight' ? (index + 1) % buttons.length : key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : key === 'Home' ? 0 : key === 'End' ? buttons.length - 1 : undefined
            if (next !== undefined) { event.preventDefault(); state.select(next, true) }
        }))
        parent.append(nav, ...pages); state.select(0); tabsets.push(state); return pages
    }
    const pages = tabs(library, 'performance-task', ['演员', '资源', '姿态 / IK', '关键帧', '音频', '项目'])
    pages[2].id = 'performance-workspace-properties'
    // Keep aria-controls joined after the semantic properties ID is installed.
    document.getElementById('performance-task-tab-2')?.setAttribute('aria-controls', pages[2].id)
    pages[1].className += ' performance-task-subpages'
    const assetPages = tabs(pages[1], 'performance-assets', ['角色', '场景', '动作'])
    pages[4].className += ' performance-task-subpages performance-audio-workspace'
    const audioPages = tabs(pages[4], 'performance-audio-task', ['声源', '片段设置', '已有音轨'])
    const audioCommon = element('div', 'performance-audio-common'); pages[4].append(audioCommon)
    const moves: { node: HTMLElement; marker: Comment }[] = []
    const move = (node: HTMLElement, target: HTMLElement) => {
        const marker = document.createComment('performance-workspace-return'); node.parentNode!.insertBefore(marker, node); moves.push({ node, marker }); target.append(node)
    }
    const restoreAttribute = (el: HTMLElement, name: string, value: string | null) => { if (value === null) el.removeAttribute(name); else el.setAttribute(name, value) }
    const restore = () => {
        for (const { node, marker } of moves.splice(0).reverse()) { marker.parentNode?.insertBefore(node, marker); marker.remove() }
        for (const node of nodes) node.hidden = true
        restoreAttribute(workspace, 'data-performance-mode', previousWorkspaceMode); restoreAttribute(app, 'data-performance-mode', previousAppMode)
        restoreAttribute(workspace, 'data-performance-dock', previousDock); toggle.setAttribute('aria-expanded', 'false')
    }
    let open = false, disposed = false
    const setOpen = (value: boolean) => {
        if (disposed || value === open) return
        if (value) {
            try {
                resources.forEach((node, i) => move(node!, assetPages[i]))
                move(panel.regions.resources, pages[0]); move(panel.regions.properties, pages[2]); move(panel.regions.project, pages[5])
                const { transport: controls, chart, audio } = panel.workspaceControls
                for (const node of controls) move(node, transport)
                move(chart, chartHost)
                // The remaining real timeline controls are editing tools, not oversized transport rows.
                move(panel.regions.timeline, pages[3])
                for (const [index, name] of ['library', 'clip', 'tracks'].entries()) for (const node of audio[name as 'library' | 'clip' | 'tracks']) move(node, audioPages[index])
                for (const node of audio.common) move(node, audioCommon)
                move(panel.status, header)
                workspace.setAttribute('data-performance-mode', 'editing'); workspace.setAttribute('data-performance-dock', 'open'); app.setAttribute('data-performance-mode', 'editing')
                dockToggle.textContent = '收起工具'; dockToggle.setAttribute('aria-expanded', 'true')
                for (const node of nodes) node.hidden = false
                for (const state of tabsets) state.select(state.selected)
                toggle.setAttribute('aria-expanded', 'true'); open = true; onOpenChange?.(true); close.focus()
            } catch (error) { try { onOpenChange?.(false) } finally { open = false; restore() }; throw error }
        } else {
            try { onExit() } finally { try { onOpenChange?.(false) } finally { restore(); open = false; toggle.focus() } }
        }
    }
    const onToggle = () => setOpen(!open)
    toggle.setAttribute('aria-controls', nodes.map(node => node.id).join(' ')); listen(toggle, 'click', onToggle)
    return { setOpen, get isOpen() { return open }, dispose() {
        if (disposed) return
        try { setOpen(false) } finally { disposed = true; cleanups.splice(0).forEach(release => release()); nodes.forEach(node => node.remove()); restoreAttribute(toggle, 'aria-controls', previousControls); restoreAttribute(toggle, 'aria-expanded', previousExpanded) }
    } }
}
