import {
    COMBAT_VFX_STATE_CHANGE_EVENT,
    getCombatVfxDebugState,
    listCombatVfxSelections,
    playCombatVfxSelection,
    setCombatVfxEnabled,
    stopCombatVfx,
    type CombatVfxDebugState,
    type CombatVfxSelectionResult,
} from './combatVfx'
import type { CombatVfxCatalogEntry, CombatVfxDomain } from './combatVfxCatalog'
import { translateUiText } from './localization/zhCN'

interface CombatVfxPanelApi {
    listSelections(domain?: CombatVfxDomain): Promise<readonly CombatVfxCatalogEntry[]>
    playSelection(selection: { stableKey: string }): Promise<CombatVfxSelectionResult>
    setEnabled(enabled: boolean): CombatVfxDebugState
    stop(): CombatVfxDebugState
    getState(): CombatVfxDebugState
}

export interface CombatVfxPanelController {
    dispose(): void
}

interface CombatVfxPanelElements {
    toggle: HTMLButtonElement
    panel: HTMLElement
    close: HTMLButtonElement
    enabled: HTMLInputElement
    domain: HTMLSelectElement
    search: HTMLInputElement
    list: HTMLSelectElement
    catalogStatus: HTMLOutputElement
    detail: HTMLOutputElement
    reason: HTMLOutputElement
    play: HTMLButtonElement
    stop: HTMLButtonElement
    runtimeStatus: HTMLOutputElement
    operationStatus: HTMLOutputElement
}

const defaultApi: CombatVfxPanelApi = {
    listSelections: listCombatVfxSelections,
    playSelection: playCombatVfxSelection,
    setEnabled: setCombatVfxEnabled,
    stop: stopCombatVfx,
    getState: getCombatVfxDebugState,
}

let activeController: CombatVfxPanelController | undefined

function requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id)
    if (!element) throw new Error(`Combat VFX panel markup is missing #${id}`)
    return element as T
}

function getElements(): CombatVfxPanelElements {
    return {
        toggle: requireElement<HTMLButtonElement>('combat-vfx-panel-toggle'),
        panel: requireElement<HTMLElement>('combat-vfx-panel'),
        close: requireElement<HTMLButtonElement>('combat-vfx-panel-close'),
        enabled: requireElement<HTMLInputElement>('combat-vfx-enabled'),
        domain: requireElement<HTMLSelectElement>('combat-vfx-domain'),
        search: requireElement<HTMLInputElement>('combat-vfx-search'),
        list: requireElement<HTMLSelectElement>('combat-vfx-list'),
        catalogStatus: requireElement<HTMLOutputElement>('combat-vfx-catalog-status'),
        detail: requireElement<HTMLOutputElement>('combat-vfx-selection-detail'),
        reason: requireElement<HTMLOutputElement>('combat-vfx-selection-reason'),
        play: requireElement<HTMLButtonElement>('combat-vfx-play'),
        stop: requireElement<HTMLButtonElement>('combat-vfx-stop'),
        runtimeStatus: requireElement<HTMLOutputElement>('combat-vfx-runtime-status'),
        operationStatus: requireElement<HTMLOutputElement>('combat-vfx-operation-status'),
    }
}

function normalizeSearchText(value: unknown): string {
    return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase()
}

function domainLabel(domain: CombatVfxDomain): string {
    return translateUiText(domain === 'enemy'
        ? 'Enemy combat effects'
        : 'Magical girl combat effects')
}

function availabilityLabel(entry: CombatVfxCatalogEntry): string {
    return translateUiText(entry.runtimeReady ? 'Playable' : 'Unavailable')
}

export function setupCombatVfxPanel(
    api: CombatVfxPanelApi = defaultApi,
): CombatVfxPanelController {
    if (activeController) return activeController

    const elements = getElements()
    let entries: readonly CombatVfxCatalogEntry[] = []
    let state = api.getState()
    let loading = true
    let operationPending = false
    let disposed = false

    const selectedEntry = () => entries.find(entry => entry.stableKey === elements.list.value)

    const setOpen = (open: boolean) => {
        elements.panel.classList.toggle('is-open', open)
        elements.panel.setAttribute('aria-hidden', String(!open))
        elements.toggle.setAttribute('aria-expanded', String(open))
        elements.toggle.textContent = translateUiText('Combat effects')
        const title = translateUiText(open ? 'Hide combat effects' : 'Show combat effects')
        elements.toggle.title = title
        elements.toggle.setAttribute('aria-label', title)
    }

    const renderRuntimeState = () => {
        elements.enabled.checked = state.enabled
        elements.panel.dataset.installed = String(state.installed)
        elements.panel.dataset.enabled = String(state.enabled)
        elements.panel.dataset.activeCount = String(state.active.length)
        elements.panel.dataset.suppressedCount = String(state.suppressedCount)
        elements.runtimeStatus.textContent = [
            `${translateUiText('Installed')}: ${translateUiText(state.installed ? 'Yes' : 'No')}`,
            `${translateUiText('Enabled')}: ${translateUiText(state.enabled ? 'Yes' : 'No')}`,
            `${translateUiText('Active effects')}: ${state.active.length}`,
            `${translateUiText('Suppressed cues')}: ${state.suppressedCount}`,
        ].join(' · ')
        elements.stop.disabled = operationPending || state.active.length === 0
    }

    const renderSelected = () => {
        const entry = selectedEntry()
        elements.play.textContent = translateUiText('Play selected effect')
        elements.stop.textContent = translateUiText('Stop all effects')
        elements.play.disabled = operationPending
            || !entry
            || !entry.runtimeReady
            || !state.installed
        if (!entry) {
            elements.detail.textContent = translateUiText('No combat effect selected')
            elements.reason.textContent = ''
            elements.reason.hidden = true
            return
        }
        elements.detail.textContent = [
            entry.stableKey,
            `${translateUiText('Domain')}: ${domainLabel(entry.domain)}`,
            `${translateUiText('Direction key')}: ${entry.directionKey}`,
            `${translateUiText('Status')}: ${availabilityLabel(entry)}`,
        ].join('\n')
        elements.reason.textContent = entry.runtimeReady
            ? ''
            : `${translateUiText('Unavailable reason')}: ${entry.failClosedReasons.join('; ')}`
        elements.reason.hidden = entry.runtimeReady
    }

    const filteredEntries = () => {
        const domain = elements.domain.value as CombatVfxDomain | ''
        const query = normalizeSearchText(elements.search.value)
        return entries.filter(entry => {
            if (domain && entry.domain !== domain) return false
            if (!query) return true
            return normalizeSearchText([
                entry.stableKey,
                entry.productStableKey,
                entry.directionKey,
                entry.directionName,
                entry.ownerKey,
                entry.effectId,
                ...entry.failClosedReasons,
            ].join(' ')).includes(query)
        })
    }

    const refreshList = () => {
        const visible = filteredEntries()
        const previous = elements.list.value
        const fragment = document.createDocumentFragment()
        for (const entry of visible) {
            const option = document.createElement('option')
            option.value = entry.stableKey
            option.textContent = `${entry.stableKey} · ${availabilityLabel(entry)}`
            option.title = entry.runtimeReady
                ? `${entry.directionName} · ${entry.ownerKey}`
                : entry.failClosedReasons.join('; ')
            option.dataset.domain = entry.domain
            option.dataset.availability = entry.status
            fragment.append(option)
        }
        elements.list.replaceChildren(fragment)
        elements.list.disabled = loading || visible.length === 0
        elements.list.value = visible.some(entry => entry.stableKey === previous)
            ? previous
            : visible[0]?.stableKey ?? ''

        const playable = visible.filter(entry => entry.runtimeReady).length
        const unavailable = visible.length - playable
        const queryActive = Boolean(normalizeSearchText(elements.search.value))
        const filtered = queryActive || Boolean(elements.domain.value)
        const label = visible.length === 0
            ? 'No matching combat effects'
            : filtered ? 'Matching combat effects' : 'Available combat effects'
        elements.catalogStatus.textContent = visible.length === 0
            ? translateUiText(label)
            : `${translateUiText(label)}: ${visible.length} · ${playable} ${translateUiText('Playable')} · ${unavailable} ${translateUiText('Unavailable')}`
        renderSelected()
    }

    const renderAll = () => {
        setOpen(elements.panel.classList.contains('is-open'))
        renderRuntimeState()
        refreshList()
    }

    const onRuntimeStateChange = (event: Event) => {
        const detail = (event as CustomEvent<CombatVfxDebugState>).detail
        if (!detail) return
        state = detail
        renderRuntimeState()
        renderSelected()
    }

    const dispose = () => {
        if (disposed) return
        disposed = true
        document.removeEventListener(COMBAT_VFX_STATE_CHANGE_EVENT, onRuntimeStateChange)
        document.removeEventListener('magius:localechange', renderAll)
        if (activeController?.dispose === dispose) activeController = undefined
    }

    elements.toggle.onclick = () => setOpen(!elements.panel.classList.contains('is-open'))
    elements.close.onclick = () => setOpen(false)
    elements.domain.onchange = refreshList
    elements.search.oninput = refreshList
    elements.list.onchange = renderSelected
    elements.enabled.onchange = () => {
        state = api.setEnabled(elements.enabled.checked)
        renderRuntimeState()
        renderSelected()
        elements.operationStatus.textContent = state.enabled
            ? translateUiText('Combat effects enabled')
            : `${translateUiText('Combat effects disabled; active effects cleared')}: ${state.active.length}`
    }
    elements.stop.onclick = () => {
        state = api.stop()
        renderRuntimeState()
        renderSelected()
        elements.operationStatus.textContent = translateUiText('All combat effects stopped')
    }
    elements.play.onclick = async () => {
        const entry = selectedEntry()
        if (!entry?.runtimeReady || operationPending || !state.installed) return
        operationPending = true
        renderSelected()
        elements.operationStatus.textContent = translateUiText('Loading selected combat effect...')
        try {
            const result = await api.playSelection({ stableKey: entry.stableKey })
            state = api.getState()
            elements.operationStatus.textContent = result.status === 'played'
                ? `${translateUiText('Combat effect started')}: ${result.stableKey}`
                : `${translateUiText('Combat effect cue suppressed')}: ${result.stableKey}`
        } catch (error) {
            state = api.getState()
            elements.operationStatus.textContent = `${translateUiText('Combat effect could not be played')}: ${error instanceof Error ? error.message : String(error)}`
        } finally {
            operationPending = false
            renderRuntimeState()
            renderSelected()
        }
    }

    document.addEventListener(COMBAT_VFX_STATE_CHANGE_EVENT, onRuntimeStateChange)
    document.addEventListener('magius:localechange', renderAll)
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') setOpen(false)
    })
    window.addEventListener('pagehide', dispose, { once: true })

    setOpen(false)
    renderRuntimeState()
    renderSelected()
    elements.catalogStatus.textContent = translateUiText('Loading combat effects...')
    void api.listSelections().then(value => {
        if (disposed) return
        entries = [...value].sort((left, right) =>
            left.domain.localeCompare(right.domain)
            || left.stableKey.localeCompare(right.stableKey))
        loading = false
        elements.panel.dataset.catalogCount = String(entries.length)
        elements.panel.dataset.playableCount = String(entries.filter(entry => entry.runtimeReady).length)
        elements.panel.dataset.failClosedCount = String(entries.filter(entry => !entry.runtimeReady).length)
        refreshList()
    }).catch(error => {
        if (disposed) return
        loading = false
        elements.list.disabled = true
        elements.catalogStatus.textContent = `${translateUiText('Combat effects could not be loaded')}: ${error instanceof Error ? error.message : String(error)}`
    })

    activeController = { dispose }
    return activeController
}
