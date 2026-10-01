import { translateUiText } from './localization/zhCN'

interface RuntimeSelectionPanelConfig {
    toggleId: string
    panelId: string
    closeId: string
    searchId: string
    listId: string
    gridId: string
    statusId: string
    detailId: string
    previewId: string
    useId: string
    sourceId: string
    thumbnailKind: 'character' | 'scene'
    toggleLabel: string
    showLabel: string
    hideLabel: string
    availableLabel: string
    matchingLabel: string
    emptyLabel: string
    noSelectionLabel: string
    useLabel: string
    selectedLabel: string
}

interface RuntimeSelectionPanelElements {
    toggle: HTMLButtonElement
    panel: HTMLElement
    close: HTMLButtonElement
    search: HTMLInputElement
    list: HTMLSelectElement
    grid: HTMLElement
    status: HTMLOutputElement
    detail: HTMLOutputElement
    preview: HTMLImageElement
    use: HTMLButtonElement
    source: HTMLSelectElement
}

interface RuntimeSelectionThumbnailManifest {
    schema: 'magius.runtime-selection-thumbnails.v1'
    characters: Record<string, string>
    scenes: Record<string, string>
    sceneResources: Record<string, string>
}

let thumbnailManifestPromise: Promise<RuntimeSelectionThumbnailManifest> | undefined

function loadThumbnailManifest(): Promise<RuntimeSelectionThumbnailManifest> {
    thumbnailManifestPromise ??= fetch('/ui-thumbnails/runtime-selection/manifest.v1.json')
        .then(async response => {
            if (!response.ok) throw new Error(`Thumbnail manifest request failed: HTTP ${response.status}`)
            const manifest = await response.json() as RuntimeSelectionThumbnailManifest
            if (manifest.schema !== 'magius.runtime-selection-thumbnails.v1') {
                throw new Error(`Unsupported thumbnail manifest schema: ${String(manifest.schema)}`)
            }
            return manifest
        })
    return thumbnailManifestPromise
}

function requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id)
    if (!element) throw new Error(`Runtime selection panel markup is missing #${id}`)
    return element as T
}

function getElements(config: RuntimeSelectionPanelConfig): RuntimeSelectionPanelElements {
    return {
        toggle: requireElement<HTMLButtonElement>(config.toggleId),
        panel: requireElement<HTMLElement>(config.panelId),
        close: requireElement<HTMLButtonElement>(config.closeId),
        search: requireElement<HTMLInputElement>(config.searchId),
        list: requireElement<HTMLSelectElement>(config.listId),
        grid: requireElement<HTMLElement>(config.gridId),
        status: requireElement<HTMLOutputElement>(config.statusId),
        detail: requireElement<HTMLOutputElement>(config.detailId),
        preview: requireElement<HTMLImageElement>(config.previewId),
        use: requireElement<HTMLButtonElement>(config.useId),
        source: requireElement<HTMLSelectElement>(config.sourceId),
    }
}

function normalizeSearchText(value: unknown): string {
    return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase()
}

// Counts describe the catalog and selector state, never successful loads or acceptance.
export function formatSceneCatalogStatus(
    visible: ReadonlyArray<Pick<HTMLOptionElement, 'disabled' | 'dataset'>>,
    total: number,
): string {
    const official = visible.filter(option => option.dataset.official === 'true').length
    const builtin = visible.filter(option => option.dataset.official === 'false').length
    const pending = visible.filter(option => option.disabled).length
    const unknown = visible.length - official - builtin
    return [
        `${translateUiText('Scene catalog')}: ${visible.length} / ${total}`,
        `${translateUiText('Official entries')}: ${official}`,
        `${translateUiText('Built-in references')}: ${builtin}`,
        `${translateUiText('Selectable entries')}: ${visible.length - pending}`,
        `${translateUiText('Awaiting restoration')}: ${pending}`,
        ...(unknown ? [`${translateUiText('Unclassified entries')}: ${unknown}`] : []),
    ].join(' · ')
}

function setupRuntimeSelectionPanel(config: RuntimeSelectionPanelConfig): void {
    const elements = getElements(config)
    if (elements.panel.dataset.runtimeSelectionSetup === 'true') return
    elements.panel.dataset.runtimeSelectionSetup = 'true'
    let thumbnailManifest: RuntimeSelectionThumbnailManifest | undefined
    elements.preview.addEventListener('error', () => {
        elements.preview.hidden = true
        elements.preview.removeAttribute('src')
        elements.preview.alt = ''
    })

    const sourceOptions = () => [...elements.source.options]
        .filter(option => option.value)

    const sourceOptionFor = (value: string) => sourceOptions()
        .find(option => option.value === value)

    const thumbnailUrlFor = (sourceOption: HTMLOptionElement | undefined) => {
        if (!sourceOption || !thumbnailManifest) return undefined
        if (config.thumbnailKind === 'character') {
            return thumbnailManifest.characters[sourceOption.value]
        }
        const resourceName = sourceOption.dataset.backgroundResourceName
        return thumbnailManifest.scenes[sourceOption.value]
            ?? (resourceName ? thumbnailManifest.sceneResources[resourceName] : undefined)
    }

    const updatePreview = (sourceOption: HTMLOptionElement | undefined) => {
        const thumbnailUrl = thumbnailUrlFor(sourceOption)
        if (!sourceOption || !thumbnailUrl) {
            elements.preview.hidden = true
            elements.preview.removeAttribute('src')
            elements.preview.alt = ''
            return
        }
        elements.preview.hidden = false
        elements.preview.alt = sourceOption.textContent?.trim() || sourceOption.value
        elements.preview.src = thumbnailUrl
    }

    const renderTileSelection = () => {
        for (const tile of elements.grid.querySelectorAll<HTMLButtonElement>('.runtime-selection-tile')) {
            const selected = tile.dataset.value === elements.list.value
            tile.classList.toggle('is-selected', selected)
            tile.setAttribute('aria-selected', String(selected))
        }
    }

    const setOpen = (open: boolean) => {
        elements.panel.classList.toggle('is-open', open)
        elements.panel.setAttribute('aria-hidden', String(!open))
        elements.toggle.setAttribute('aria-expanded', String(open))
        elements.toggle.textContent = translateUiText(config.toggleLabel)
        const title = translateUiText(open ? config.hideLabel : config.showLabel)
        elements.toggle.title = title
        elements.toggle.setAttribute('aria-label', title)
        if (open) refreshList()
    }

    const renderSelected = () => {
        const sourceOption = sourceOptionFor(elements.list.value)
        elements.use.textContent = translateUiText(config.useLabel)
        elements.use.disabled = !sourceOption || sourceOption.disabled || elements.source.disabled
        elements.detail.textContent = sourceOption
            ? `${sourceOption.textContent?.trim() || sourceOption.value} · ${sourceOption.value}${sourceOption.disabled ? ' · ' + translateUiText('Awaiting restoration') : ''}`
            : translateUiText(config.noSelectionLabel)
        elements.use.title = sourceOption?.disabled ? translateUiText('Awaiting restoration') : translateUiText(config.useLabel)
        updatePreview(sourceOption)
        renderTileSelection()
    }

    const applySelection = () => {
        const sourceOption = sourceOptionFor(elements.list.value)
        if (!sourceOption || sourceOption.disabled || elements.source.disabled) return
        elements.source.value = sourceOption.value
        elements.source.dispatchEvent(new Event('change', { bubbles: true }))
        elements.status.textContent = `${translateUiText(config.selectedLabel)}: ${sourceOption.textContent?.trim() || sourceOption.value}`
        renderSelected()
    }

    const createThumbnailTile = (sourceOption: HTMLOptionElement) => {
        const tile = document.createElement('button')
        tile.type = 'button'
        // Unrestored catalog entries remain inspectable. Eligibility controls
        // Load, not thumbnail selection; otherwise the old preview looks stuck.
        tile.disabled = false
        tile.dataset.loadable = String(!sourceOption.disabled)
        tile.className = 'runtime-selection-tile'
        tile.dataset.value = sourceOption.value
        tile.setAttribute('role', 'option')
        tile.setAttribute('aria-selected', 'false')
        tile.title = sourceOption.textContent?.trim() || sourceOption.value

        const frame = document.createElement('span')
        frame.className = 'runtime-selection-tile-image'
        const thumbnailUrl = thumbnailUrlFor(sourceOption)
        if (thumbnailUrl) {
            const image = document.createElement('img')
            image.src = thumbnailUrl
            image.alt = ''
            image.loading = 'lazy'
            image.decoding = 'async'
            image.draggable = false
            image.addEventListener('error', () => {
                image.remove()
                frame.classList.add('is-missing')
            }, { once: true })
            frame.append(image)
        } else {
            frame.classList.add('is-missing')
        }

        const label = document.createElement('span')
        label.className = 'runtime-selection-tile-label'
        label.textContent = sourceOption.textContent?.trim() || sourceOption.value
        const identity = document.createElement('span')
        identity.className = 'runtime-selection-tile-identity'
        identity.textContent = sourceOption.value
        tile.append(frame, label, identity)
        tile.addEventListener('click', () => {
            elements.list.value = sourceOption.value
            renderSelected()
        })
        tile.addEventListener('dblclick', applySelection)
        return tile
    }

    const refreshList = () => {
        const options = sourceOptions()
        const query = normalizeSearchText(elements.search.value)
        const visible = options.filter(option => normalizeSearchText(
            `${option.value} ${option.textContent ?? ''} ${option.title}`,
        ).includes(query))
        const previousValue = elements.list.value || elements.source.value
        const fragment = document.createDocumentFragment()
        const tileFragment = document.createDocumentFragment()
        for (const sourceOption of visible) {
            const option = document.createElement('option')
            option.value = sourceOption.value
            option.textContent = sourceOption.textContent
            option.title = sourceOption.title
            option.dataset.loadable = String(!sourceOption.disabled)
            for (const [key, value] of Object.entries(sourceOption.dataset)) {
                option.dataset[key] = value
            }
            fragment.append(option)
            tileFragment.append(createThumbnailTile(sourceOption))
        }
        elements.list.replaceChildren(fragment)
        elements.grid.replaceChildren(tileFragment)
        elements.grid.dataset.empty = String(visible.length === 0)
        elements.list.disabled = visible.length === 0
        elements.list.value = visible.some(option => option.value === previousValue)
            ? previousValue
            : visible[0]?.value ?? ''
        const statusLabel = visible.length === 0
            ? config.emptyLabel
            : query ? config.matchingLabel : config.availableLabel
        elements.status.textContent = config.thumbnailKind === 'scene'
            ? formatSceneCatalogStatus(visible, options.length)
            : visible.length === 0
                ? translateUiText(statusLabel)
                : `${translateUiText(statusLabel)}: ${visible.length} / ${options.length}`
        if (config.thumbnailKind === 'scene') {
            elements.status.title = translateUiText('Catalog and selectable counts do not mean load-tested or user-accepted.')
        }
        renderSelected()
    }

    const syncFromSource = () => {
        const sourceValue = elements.source.value
        if (!sourceOptionFor(sourceValue)) {
            elements.list.value = ''
            renderSelected()
            return
        }
        if (![...elements.list.options].some(option => option.value === sourceValue)) {
            elements.search.value = ''
            refreshList()
        }
        if ([...elements.list.options].some(option => option.value === sourceValue)) {
            elements.list.value = sourceValue
        }
        renderSelected()
    }

    elements.toggle.onclick = () => setOpen(!elements.panel.classList.contains('is-open'))
    elements.close.onclick = () => setOpen(false)
    elements.search.oninput = refreshList
    elements.list.onchange = renderSelected
    elements.use.onclick = applySelection
    elements.source.addEventListener('change', syncFromSource)

    const sourceObserver = new MutationObserver(refreshList)
    sourceObserver.observe(elements.source, {
        attributes: true,
        attributeFilter: ['disabled', 'data-official'],
        characterData: true,
        childList: true,
        subtree: true,
    })

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') setOpen(false)
    })
    document.addEventListener('magius:localechange', () => {
        setOpen(elements.panel.classList.contains('is-open'))
        refreshList()
    })

    setOpen(false)
    refreshList()
    void loadThumbnailManifest()
        .then(manifest => {
            thumbnailManifest = manifest
            refreshList()
        })
        .catch(error => console.warn('Could not load runtime selection thumbnails:', error))
}

export function setupRuntimeSelectionPanels(): void {
    setupRuntimeSelectionPanel({
        toggleId: 'character-list-panel-toggle',
        panelId: 'character-list-panel',
        closeId: 'character-list-panel-close',
        searchId: 'character-list-search',
        listId: 'character-list-select',
        gridId: 'character-list-grid',
        statusId: 'character-list-status',
        detailId: 'character-list-detail',
        previewId: 'character-list-preview',
        useId: 'character-list-use',
        sourceId: 'character-selector',
        thumbnailKind: 'character',
        toggleLabel: 'Characters',
        showLabel: 'Show character list',
        hideLabel: 'Hide character list',
        availableLabel: 'Available characters',
        matchingLabel: 'Matching characters',
        emptyLabel: 'No matching characters',
        noSelectionLabel: 'No character selected',
        useLabel: 'Switch character',
        selectedLabel: 'Character selected in viewer',
    })
    setupRuntimeSelectionPanel({
        toggleId: 'stage-list-panel-toggle',
        panelId: 'stage-list-panel',
        closeId: 'stage-list-panel-close',
        searchId: 'stage-list-search',
        listId: 'stage-list-select',
        gridId: 'stage-list-grid',
        statusId: 'stage-list-status',
        detailId: 'stage-list-detail',
        previewId: 'stage-list-preview',
        useId: 'stage-list-use',
        sourceId: 'stage-selector',
        thumbnailKind: 'scene',
        toggleLabel: 'Scenes',
        showLabel: 'Show scene list',
        hideLabel: 'Hide scene list',
        availableLabel: 'Scene catalog',
        matchingLabel: 'Matching scenes',
        emptyLabel: 'No matching scenes',
        noSelectionLabel: 'No scene selected',
        useLabel: 'Load selected scene',
        selectedLabel: 'Scene selected in viewer',
    })
}
