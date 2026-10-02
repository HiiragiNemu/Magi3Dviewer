import { translateUiText, getUiLocale } from './localization/zhCN'
import { createResourceTile, installResourceGridKeys, compactResourceLabel, normalizedResourceQuantity } from './resourcePanelUi'
import './style/resource-browser.css'

export interface CharacterPanelInstance { key:string; id:string; selected:boolean }
export interface CharacterPanelHooks {
    instances(): CharacterPanelInstance[]
    add(id:string,quantity:number):Promise<void>
    replace(id:string,key:string):Promise<void>
    select(key:string):void
    remove(key:string):void
}

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
    const selectable = visible.filter(option => !option.disabled).length
    return `${translateUiText('Selectable entries')} ${selectable} / ${total}${visible.length !== total ? ` · ${translateUiText('Matching scenes')} ${visible.length}` : ''}`
}

function setupRuntimeSelectionPanel(config: RuntimeSelectionPanelConfig, actors?:CharacterPanelHooks): (()=>void) {
    const elements = getElements(config)
    if (elements.panel.dataset.runtimeSelectionSetup === 'true') return ()=>{}
    elements.panel.dataset.runtimeSelectionSetup = 'true'
    let thumbnailManifest: RuntimeSelectionThumbnailManifest | undefined
    let busy=false,gridKey='',catalogChosen=false
    const isCharacter=config.thumbnailKind==='character'
    const add=isCharacter?document.getElementById('character-list-add') as HTMLButtonElement:null
    const quantity=isCharacter?document.getElementById('character-add-quantity') as HTMLInputElement:null
    const instances=isCharacter?document.getElementById('character-instance-list'):null
    const feedback=isCharacter?document.getElementById('character-list-feedback'):null
    installResourceGridKeys(elements.grid)
    const labelFor=(option:HTMLOptionElement)=>compactResourceLabel(option.textContent?.trim()||option.value,config.thumbnailKind,getUiLocale())
    const report=(text:string,error=false)=>{if(feedback){feedback.textContent=text;feedback.title=text;feedback.classList.toggle('is-error',error)}}
    const counts=()=>{
        const options=sourceOptions(),visible=options.filter(option=>normalizeSearchText(`${option.value} ${option.textContent??''} ${option.title}`).includes(normalizeSearchText(elements.search.value)))
        elements.status.textContent=isCharacter
            ? `${translateUiText('Available characters')} ${visible.length} / ${options.length} · ${translateUiText('Added')} ${actors?.instances().length??0}`
            : formatSceneCatalogStatus(visible,options.length)
        elements.status.title=elements.status.textContent
    }
    const renderInstances=()=>{
        if(!instances||!actors)return
        const scroll=instances.scrollTop,rows=actors.instances()
        instances.replaceChildren(...rows.map((item,i)=>{
            const row=document.createElement('div');row.className='resource-instance-row';row.dataset.instanceId=item.key;row.classList.toggle('is-selected',item.selected)
            const option=sourceOptionFor(item.id),label=option?labelFor(option):item.id
            const select=document.createElement('button');select.type='button';select.className='resource-instance-select';select.textContent=`${i+1}. ${label}`;select.title=`${item.id} · ${label}`;select.setAttribute('aria-selected',String(item.selected));select.disabled=busy
            select.onclick=()=>{actors.select(item.key);renderInstances();renderSelected()}
            const remove=document.createElement('button');remove.type='button';remove.textContent=translateUiText('Remove');remove.setAttribute('aria-label',`${translateUiText('Remove')} ${i+1}. ${label}`);remove.disabled=busy
            remove.onclick=()=>{actors.remove(item.key);renderInstances();renderSelected()}
            row.append(select,remove);return row
        }))
        if(!rows.length){const empty=document.createElement('span');empty.className='resource-empty';empty.textContent=translateUiText('No characters added');instances.append(empty)}
        instances.scrollTop=scroll;counts()
    }
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
        elements.use.disabled = busy || !sourceOption || sourceOption.disabled || elements.source.disabled || !!(isCharacter && actors && !actors.instances().some(item=>item.selected))
        if(add)add.disabled=busy||!sourceOption||sourceOption.disabled||elements.source.disabled
        if(quantity)quantity.disabled=busy
        elements.detail.textContent = sourceOption
            ? `${labelFor(sourceOption)} · ${sourceOption.value}${sourceOption.disabled ? ' · ' + translateUiText('Awaiting restoration') : ''}`
            : translateUiText(config.noSelectionLabel)
        elements.use.title = sourceOption?.disabled ? translateUiText('Awaiting restoration') : translateUiText(config.useLabel)
        if(isCharacter&&actors){const target=actors.instances().find(item=>item.selected);elements.use.title=target?`${translateUiText('Replace')}: ${target.id}`:translateUiText('Select an added character to replace')}
        elements.detail.title=elements.detail.textContent||''
        if(add)add.textContent=translateUiText('Add character')
        updatePreview(sourceOption)
        renderTileSelection()
        counts()
    }

    const runActorOperation=async(operation:()=>Promise<void>)=>{
        if(busy)return
        busy=true;report(translateUiText('Loading...'));renderSelected();renderInstances()
        try{await operation();report('')}
        catch(error){report((error as Error).message||String(error),true)}
        finally{busy=false;renderInstances();renderSelected()}
    }
    const applySelection = () => {
        const sourceOption = sourceOptionFor(elements.list.value)
        if (!sourceOption || sourceOption.disabled || elements.source.disabled || busy) return
        if(isCharacter&&actors){
            const target=actors.instances().find(item=>item.selected);if(!target)return
            void runActorOperation(()=>actors.replace(sourceOption.value,target.key));return
        }
        elements.source.value = sourceOption.value
        elements.source.dispatchEvent(new Event('change', { bubbles: true }))
        renderSelected()
    }
    const createThumbnailTile = (sourceOption: HTMLOptionElement) => createResourceTile({
        value:sourceOption.value,label:labelFor(sourceOption),title:sourceOption.textContent?.trim(),
        image:thumbnailUrlFor(sourceOption),loadable:!sourceOption.disabled,
    },()=>{catalogChosen=true;elements.list.value=sourceOption.value;renderSelected()},applySelection)

    const refreshList = () => {
        const options = sourceOptions()
        const query = normalizeSearchText(elements.search.value)
        const visible = options.filter(option => normalizeSearchText(
            `${option.value} ${option.textContent ?? ''} ${option.title}`,
        ).includes(query))
        const previousValue = elements.list.value || elements.source.value
        const nextKey=[query,getUiLocale(),Boolean(thumbnailManifest),...visible.map(o=>o.value+'|'+o.textContent+'|'+o.disabled)].join('\n')
        if(nextKey===gridKey){renderSelected();renderInstances();return}
        gridKey=nextKey
        const scrollTop=elements.grid.scrollTop
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
        elements.grid.scrollTop=scrollTop
        elements.grid.dataset.empty = String(visible.length === 0)
        elements.list.disabled = visible.length === 0
        elements.list.value = visible.some(option => option.value === previousValue)
            ? previousValue
            : visible[0]?.value ?? ''
        counts()
        renderInstances()
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
    if(add&&quantity&&actors){
        quantity.onchange=()=>normalizedResourceQuantity(quantity)
        add.onclick=()=>{const option=sourceOptionFor(elements.list.value);if(!option||option.disabled||busy)return;const n=normalizedResourceQuantity(quantity);void runActorOperation(()=>actors.add(option.value,n))}
    }
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
    return ()=>{if(isCharacter&&!catalogChosen&&sourceOptionFor(elements.source.value))elements.list.value=elements.source.value;renderInstances();renderSelected()}
}

export function setupRuntimeSelectionPanels(actors?:CharacterPanelHooks) {
    const refreshActors=setupRuntimeSelectionPanel({
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
        useLabel: 'Replace',
        selectedLabel: 'Character selected in viewer',
    },actors)
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
        useLabel: 'Load',
        selectedLabel: 'Scene selected in viewer',
    })
    return {refreshActors}
}
