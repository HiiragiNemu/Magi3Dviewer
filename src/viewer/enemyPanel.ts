import { onPermanentPageExit } from './pageLifecycle'
import {
    addAnimationLoop,
    getClockDelta,
    removeAnimationLoop,
} from 'magia-exedra-character-three/renderer'
import * as THREE from 'three'
import {
    EnemyResourceError,
    EnemyResourceManager,
    resolveEnemyDisplayName,
    type EnemyInstance,
    type EnemyManifestEntry,
} from './enemies'
import { translateUiText } from './localization/zhCN'
import { scene } from './scene'

interface EnemyPanelElements {
    toggle: HTMLButtonElement
    toolbarCatalog: HTMLSelectElement
    toolbarAdd: HTMLButtonElement
    toolbarRemove: HTMLButtonElement
    panel: HTMLElement
    close: HTMLButtonElement
    search: HTMLInputElement
    catalog: HTMLSelectElement
    status: HTMLOutputElement
    preview: HTMLImageElement
    selectedDetail: HTMLOutputElement
    quantity: HTMLInputElement
    add: HTMLButtonElement
    clear: HTMLButtonElement
    instances: HTMLElement
}

interface StatusState {
    key: string
    detail?: string
    error?: boolean
}

export interface EnemyPanelController {
    readonly enemyResources: EnemyResourceManager
    getIntersectedEnemy(clientX: number, clientY: number): EnemyInstance | undefined
    getSelectedInstance(): EnemyInstance | undefined
    selectInstance(instanceId: string): EnemyInstance | undefined
    refreshInstances(): void
    dispose(): void
}

export interface EnemyPanelOptions {
    onInstanceSelected?(instance: EnemyInstance): void
    onInstanceWillRemove?(instance: EnemyInstance): void
}

const errorTextByCode = {
    MANIFEST_HTTP_ERROR: 'Enemy list could not be loaded',
    MANIFEST_SCHEMA_ERROR: 'Enemy data is invalid',
    ENEMY_NOT_FOUND: 'Enemy was not found',
    MODEL_NOT_READY: 'Enemy model is not ready',
    MODEL_HTTP_ERROR: 'Enemy model could not be loaded',
    MODEL_PARSE_ERROR: 'Enemy model could not be read',
} as const

let activeController: EnemyPanelController | undefined

function requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id)
    if (!element) throw new Error(`Enemy panel markup is missing #${id}`)
    return element as T
}

function getElements(): EnemyPanelElements {
    return {
        toggle: requireElement<HTMLButtonElement>('enemy-panel-toggle'),
        toolbarCatalog: requireElement<HTMLSelectElement>('enemy-toolbar-select'),
        toolbarAdd: requireElement<HTMLButtonElement>('enemy-toolbar-add'),
        toolbarRemove: requireElement<HTMLButtonElement>('enemy-toolbar-remove'),
        panel: requireElement<HTMLElement>('enemy-panel'),
        close: requireElement<HTMLButtonElement>('enemy-panel-close'),
        search: requireElement<HTMLInputElement>('enemy-catalog-search'),
        catalog: requireElement<HTMLSelectElement>('enemy-catalog-select'),
        status: requireElement<HTMLOutputElement>('enemy-catalog-status'),
        preview: requireElement<HTMLImageElement>('enemy-preview-image'),
        selectedDetail: requireElement<HTMLOutputElement>('enemy-selected-detail'),
        quantity: requireElement<HTMLInputElement>('enemy-add-quantity'),
        add: requireElement<HTMLButtonElement>('enemy-add-button'),
        clear: requireElement<HTMLButtonElement>('enemy-clear-button'),
        instances: requireElement<HTMLElement>('enemy-instance-list'),
    }
}

function currentEnemyLocale(): string {
    return document.documentElement.lang || navigator.language || 'en'
}

function enemyLabel(entry: EnemyManifestEntry): string {
    return resolveEnemyDisplayName(entry, currentEnemyLocale())
}

function normalizedQuantity(input: HTMLInputElement): number {
    const value = Number.parseInt(input.value, 10)
    const normalized = Number.isFinite(value) ? Math.min(8, Math.max(1, value)) : 1
    input.value = String(normalized)
    return normalized
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError'
}

function describeError(error: unknown): StatusState {
    if (error instanceof EnemyResourceError) {
        return {
            key: errorTextByCode[error.code],
            detail: error.code,
            error: true,
        }
    }
    return {
        key: 'Unexpected enemy error',
        detail: error instanceof Error ? error.message : String(error),
        error: true,
    }
}

export function setupEnemyPanel(options: EnemyPanelOptions = {}): EnemyPanelController {
    if (activeController) return activeController

    const elements = getElements()
    const enemyResources = new EnemyResourceManager()
    const abortController = new AbortController()
    let entries: readonly EnemyManifestEntry[] = []
    let selectedEnemyMstId: number | undefined
    let selectedInstanceId: string | undefined
    let statusState: StatusState = { key: 'Loading enemy list...' }
    let busy = false
    let disposed = false

    const renderStatus = () => {
        const text = translateUiText(statusState.key)
        elements.status.textContent = statusState.detail
            ? `${text}: ${statusState.detail}`
            : text
        elements.status.classList.toggle('is-error', Boolean(statusState.error))
    }

    const setStatus = (state: StatusState) => {
        statusState = state
        renderStatus()
    }

    const selectedEntry = () => entries.find(entry => entry.enemyMstId === selectedEnemyMstId)
    const selectedInstance = () => enemyResources.getInstances()
        .find(instance => instance.instanceId === selectedInstanceId)

    const animationSection = document.createElement('section')
    animationSection.className = 'enemy-animation-controls'
    animationSection.hidden = true
    animationSection.setAttribute('data-i18n-ignore', 'true')
    const animationSelect = document.createElement('select')
    animationSelect.id = 'enemy-animation-select'
    const animationRepetitions = document.createElement('input')
    animationRepetitions.id = 'enemy-animation-repetitions'
    animationRepetitions.type = 'number'
    animationRepetitions.min = '0'
    animationRepetitions.max = String(Number.MAX_SAFE_INTEGER)
    animationRepetitions.step = '1'
    const animationApply = document.createElement('button')
    animationApply.id = 'enemy-animation-apply'
    animationApply.type = 'button'
    const animationToggle = document.createElement('button')
    animationToggle.id = 'enemy-animation-toggle'
    animationToggle.type = 'button'
    const animationIcon = document.createElement('img')
    animationIcon.alt = ''
    animationToggle.append(animationIcon)
    const animationSlider = document.createElement('input')
    animationSlider.id = 'enemy-animation-slider'
    animationSlider.type = 'range'
    animationSlider.min = '0'
    animationSlider.max = '0'
    animationSlider.step = '0.01'
    const animationProgress = document.createElement('output')
    animationProgress.id = 'enemy-animation-progress'
    const progressGroup=document.createElement('span');progressGroup.className='animation-progress-group'
    progressGroup.append(animationSlider,animationProgress)
    animationSection.append(animationSelect, animationRepetitions, animationApply, animationToggle, progressGroup)
    requireElement<HTMLElement>('enemy-toolbar-control').append(animationSection)

    const pendingAnimations = new WeakMap<EnemyInstance, string>()
    const pendingRepetitions = new WeakMap<EnemyInstance, string>()
    const renderAnimationProgress = () => {
        const instance = selectedInstance()
        const duration = instance?.animationDuration ?? 0
        const time = THREE.MathUtils.clamp(instance?.animationTime ?? 0, 0, duration)
        animationSlider.disabled = busy || !instance || duration <= 0
        animationSlider.max = String(duration)
        animationSlider.value = String(time)
        const progress = duration > 0 ? time / duration : 0
        animationProgress.value = `${Math.round(progress * 100)}%`
        animationSlider.setAttribute('aria-valuetext', `${time.toFixed(2)} / ${duration.toFixed(2)} s`)
        animationSlider.dataset.animationTime = String(time)
        animationSlider.dataset.animationDuration = String(duration)
        animationSlider.dataset.activeAnimation = instance?.currentAnimationName ?? ''
        animationToggle.disabled = busy || !instance?.currentAnimationName
        const paused = !instance || instance.animationPaused
        const key = paused ? 'Resume enemy animation' : 'Pause enemy animation'
        animationToggle.title = translateUiText(key)
        animationToggle.setAttribute('aria-label', translateUiText(key))
        animationToggle.setAttribute('aria-pressed', String(paused))
        // Reuse the same assets as character playback rather than two text buttons.
        const iconSource = document.getElementById(paused ? 'animation-play' : 'animation-pause')
            ?.querySelector('img')?.getAttribute('src') ?? ''
        if (animationIcon.getAttribute('src') !== iconSource) animationIcon.setAttribute('src', iconSource)
    }

    const renderAnimationControls = () => {
        const instance = selectedInstance()
        animationSection.hidden = !instance
        animationSelect.replaceChildren(...instance
            ? instance.animationNames.map(name => {
                const option = document.createElement('option')
                option.value = name
                option.textContent = translateUiText(name)
                option.title = name
                return option
            }) : [])
        animationSelect.value = instance ? pendingAnimations.get(instance) ?? instance.currentAnimationName ?? '' : ''
        animationSelect.disabled = busy || !instance || animationSelect.options.length === 0
        animationApply.disabled = animationSelect.disabled
        animationRepetitions.disabled = animationSelect.disabled
        animationRepetitions.value = instance ? pendingRepetitions.get(instance) ?? '' : ''
        animationRepetitions.placeholder = translateUiText('Default')
        animationRepetitions.setAttribute('aria-label', translateUiText('Total plays'))
        animationRepetitions.title = translateUiText('Total plays: blank uses default, 0 repeats forever')
        animationApply.textContent = translateUiText('Play')
        animationApply.setAttribute('aria-label', translateUiText('Play enemy animation'))
        for (const [element, key] of [
            [animationSection, 'Enemy animation'], [animationSelect, 'Enemy animation'],
            [animationSlider, 'Enemy animation progress'],
        ] as const) {
            element.setAttribute('aria-label', translateUiText(key))
            element.title = translateUiText(key)
        }
        renderAnimationProgress()
    }

    const getIntersectedEnemy = (clientX: number, clientY: number): EnemyInstance | undefined => {
        const instances = enemyResources.getInstances()
        if (instances.length === 0) return undefined
        const canvas = scene.renderer.domElement
        const rect = canvas.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return undefined
        const pointer = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
        )
        const raycaster = new THREE.Raycaster()
        raycaster.setFromCamera(pointer, scene.camera)
        const instanceByRoot = new Map<THREE.Object3D, EnemyInstance>(
            instances.map(instance => [instance.object, instance]),
        )
        for (const intersection of raycaster.intersectObjects(
            instances.map(instance => instance.object),
            true,
        )) {
            let object: THREE.Object3D | null = intersection.object
            while (object) {
                const instance = instanceByRoot.get(object)
                if (instance) return instance
                object = object.parent
            }
        }
        return undefined
    }

    const nextEnemySpawnPosition = (): THREE.Vector3Tuple => {
        const occupied = [
            ...enemyResources.getInstances().map(instance => instance.object.position),
            ...scene.characters.flatMap(character => character.character?.object
                ? [character.character.object.position]
                : []),
        ]
        const spacing = 2.5
        const minimumDistanceSq = 1.75 ** 2
        for (let slot = 0; slot < 64; slot += 1) {
            const lane = Math.ceil(slot / 2)
            const x = slot === 0 ? 0 : lane * spacing * (slot % 2 === 1 ? 1 : -1)
            const candidate: THREE.Vector3Tuple = [x, 0, 0]
            if (occupied.every(position => {
                const dx = position.x - candidate[0]
                const dz = position.z - candidate[2]
                return dx * dx + dz * dz >= minimumDistanceSq
            })) return candidate
        }
        return [occupied.length * spacing, 0, 0]
    }

    const renderToolbarCatalog = () => {
        const previous = elements.toolbarCatalog.value
        const fragment = document.createDocumentFragment()
        for (const entry of entries) {
            const option = document.createElement('option')
            option.value = String(entry.enemyMstId)
            option.textContent = `${entry.enemyMstId} — ${enemyLabel(entry)}`
            option.title = `${option.textContent}\n${entry.model.bundleKey}`
            fragment.append(option)
        }
        elements.toolbarCatalog.replaceChildren(fragment)
        elements.toolbarCatalog.disabled = busy || entries.length === 0
        elements.toolbarCatalog.value = entries.some(entry => String(entry.enemyMstId) === previous)
            ? previous
            : selectedEnemyMstId == null ? String(entries[0]?.enemyMstId ?? '') : String(selectedEnemyMstId)
    }

    const renderSelected = () => {
        const entry = selectedEntry()
        elements.add.disabled = busy || !entry
        elements.toolbarAdd.disabled = busy || !entry
        if (!entry) {
            elements.toolbarAdd.disabled = true
            elements.selectedDetail.textContent = translateUiText('No enemy selected')
            elements.preview.hidden = true
            elements.preview.removeAttribute('src')
            elements.preview.alt = ''
            return
        }

        const label = enemyLabel(entry)
        elements.toolbarCatalog.value = String(entry.enemyMstId)
        elements.toolbarAdd.disabled = busy
        elements.selectedDetail.textContent = `${label} · ID ${entry.enemyMstId}`
        if (entry.thumbnail.url) {
            elements.preview.src = entry.thumbnail.url
            elements.preview.alt = label
            elements.preview.hidden = false
        } else {
            elements.preview.hidden = true
            elements.preview.removeAttribute('src')
            elements.preview.alt = ''
        }
    }

    const matchesSearch = (entry: EnemyManifestEntry, query: string) => {
        if (!query) return true
        const searchable = [
            entry.enemyMstId,
            entry.enemyUniqueId,
            entry.modelPrefabName,
            entry.names.en,
            entry.names.ja,
            entry.names.zhHant,
            entry.names.runes,
        ].filter(value => value != null).join(' ').toLocaleLowerCase()
        return searchable.includes(query)
    }

    const renderCatalog = () => {
        const chooseEnemy = translateUiText('Choose enemy')
        elements.toolbarCatalog.title = chooseEnemy
        elements.toolbarCatalog.setAttribute('aria-label', chooseEnemy)
        elements.catalog.setAttribute('aria-label', translateUiText('Enemy list'))
        const previous = selectedEnemyMstId
        const query = elements.search.value.trim().toLocaleLowerCase()
        const visibleEntries = entries.filter(entry => matchesSearch(entry, query))
        const fragment = document.createDocumentFragment()
        for (const entry of visibleEntries) {
            const option = document.createElement('option')
            option.value = String(entry.enemyMstId)
            option.textContent = `${enemyLabel(entry)} · ${entry.enemyMstId}`
            fragment.append(option)
        }
        elements.catalog.replaceChildren(fragment)
        elements.catalog.disabled = busy || visibleEntries.length === 0

        const preserved = previous != null
            && visibleEntries.some(entry => entry.enemyMstId === previous)
        selectedEnemyMstId = preserved ? previous : visibleEntries[0]?.enemyMstId
        elements.catalog.value = selectedEnemyMstId == null ? '' : String(selectedEnemyMstId)
        renderSelected()

        if (query) {
            setStatus(visibleEntries.length
                ? { key: 'Matching enemies', detail: String(visibleEntries.length) }
                : { key: 'No matching enemies' })
        } else if (!busy) {
            setStatus({ key: 'Available enemies', detail: String(entries.length) })
        }
    }

    const renderInstances = () => {
        const addSelectedLabel = translateUiText('Add selected enemy')
        elements.toolbarAdd.title = addSelectedLabel
        elements.toolbarAdd.setAttribute('aria-label', addSelectedLabel)
        const instances = enemyResources.getInstances()
        const removeSelectedLabel = `${translateUiText('Remove')}: ${translateUiText('Selected enemy')}`
        elements.toolbarRemove.title = removeSelectedLabel
        elements.toolbarRemove.setAttribute('aria-label', removeSelectedLabel)
        if (selectedInstanceId && !instances.some(instance => instance.instanceId === selectedInstanceId)) {
            selectedInstanceId = undefined
        }
        const fragment = document.createDocumentFragment()
        if (instances.length === 0) {
            const empty = document.createElement('p')
            empty.className = 'enemy-instance-empty'
            empty.textContent = translateUiText('No enemies added')
            fragment.append(empty)
        } else {
            for (const instance of instances) {
                const row = document.createElement('div')
                row.className = 'enemy-instance-row'
                row.dataset.instanceId = instance.instanceId
                row.dataset.position = instance.object.position.toArray()
                    .map(value => value.toFixed(4))
                    .join(',')
                row.tabIndex = 0
                row.setAttribute('role', 'option')
                row.setAttribute('aria-selected', String(instance.instanceId === selectedInstanceId))
                row.classList.toggle('is-selected', instance.instanceId === selectedInstanceId)
                row.onclick = () => selectInstance(instance.instanceId)
                row.onkeydown = event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    selectInstance(instance.instanceId)
                }

                const label = document.createElement('span')
                const animation = instance.currentAnimationName ? ` · ${instance.currentAnimationName}` : ''
                label.textContent = `${enemyLabel(instance.entry)} · ${instance.instanceId}${animation}`
                label.title = instance.instanceId

                const remove = document.createElement('button')
                remove.type = 'button'
                remove.textContent = translateUiText('Remove')
                remove.setAttribute('aria-label', `${translateUiText('Remove')} ${enemyLabel(instance.entry)}`)
                remove.disabled = busy
                remove.onclick = event => {
                    event.stopPropagation()
                    removeInstance(instance)
                }

                row.append(label, remove)
                fragment.append(row)
            }
        }
        elements.instances.replaceChildren(fragment)
        elements.clear.disabled = busy || instances.length === 0
        elements.toolbarRemove.disabled = busy || !selectedInstance()
        renderAnimationControls()
    }

    function selectInstance(instanceId: string): EnemyInstance | undefined {
        const instance = enemyResources.getInstances()
            .find(value => value.instanceId === instanceId)
        if (!instance) return undefined
        selectedInstanceId = instance.instanceId
        renderInstances()
        setStatus({ key: 'Selected enemy', detail: instance.instanceId })
        options.onInstanceSelected?.(instance)
        return instance
    }

    function removeInstance(instance: EnemyInstance): boolean {
        if (instance.instanceId === selectedInstanceId) {
            options.onInstanceWillRemove?.(instance)
            selectedInstanceId = undefined
        }
        const removed = enemyResources.removeEnemy(instance.instanceId)
        renderInstances()
        if (removed) setStatus({ key: 'Enemy removed', detail: instance.instanceId })
        return removed
    }

    const setBusy = (value: boolean) => {
        busy = value
        elements.search.disabled = value
        elements.catalog.disabled = value || elements.catalog.options.length === 0
        elements.toolbarCatalog.disabled = value || entries.length === 0
        elements.quantity.disabled = value
        renderSelected()
        renderInstances()
    }

    const setOpen = (open: boolean) => {
        elements.panel.classList.toggle('is-open', open)
        elements.panel.setAttribute('aria-hidden', String(!open))
        elements.toggle.setAttribute('aria-expanded', String(open))
        const label = translateUiText(open ? 'Hide enemies' : 'Enemies')
        elements.toggle.textContent = label
        elements.toggle.title = label
        elements.toggle.setAttribute('aria-label', label)
    }

    const handleLocaleChange = () => {
        renderToolbarCatalog()
        renderCatalog()
        renderInstances()
        renderStatus()
        setOpen(elements.panel.classList.contains('is-open'))
    }

    const handleEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setOpen(false)
    }

    const tick = () => {
        enemyResources.update(getClockDelta())
        if (!animationSection.hidden) renderAnimationProgress()
    }

    const dispose = () => {
        if (disposed) return
        disposed = true
        abortController.abort()
        removeAnimationLoop(tick)
        const selected = selectedInstance()
        if (selected) options.onInstanceWillRemove?.(selected)
        selectedInstanceId = undefined
        enemyResources.clearEnemies()
        document.removeEventListener('keydown', handleEscape)
        document.removeEventListener('magius:localechange', handleLocaleChange)
        window.removeEventListener('pagehide', dispose)
        animationSection.remove()
        activeController = undefined
    }

    activeController = {
        enemyResources,
        getIntersectedEnemy,
        getSelectedInstance: selectedInstance,
        selectInstance,
        refreshInstances: renderInstances,
        dispose,
    }
    addAnimationLoop(tick)
        elements.toggle.onclick = () => setOpen(!elements.panel.classList.contains('is-open'))
    elements.close.onclick = () => setOpen(false)
    elements.search.oninput = renderCatalog
    elements.catalog.onchange = () => {
        selectedEnemyMstId = Number.parseInt(elements.catalog.value, 10)
        renderSelected()
    }
    elements.toolbarCatalog.onchange = () => {
        selectedEnemyMstId = Number.parseInt(elements.toolbarCatalog.value, 10)
        elements.search.value = ''
        renderCatalog()
    }
    elements.toolbarAdd.onclick = () => {
        if (busy || !selectedEntry()) return
        elements.quantity.value = '1'
        elements.add.click()
    }
    elements.toolbarRemove.onclick = () => {
        const instance = selectedInstance()
        if (!busy && instance) removeInstance(instance)
    }
    elements.quantity.onchange = () => normalizedQuantity(elements.quantity)
    elements.add.onclick = async () => {
        const entry = selectedEntry()
        if (!entry || busy) return
        const quantity = normalizedQuantity(elements.quantity)
        setBusy(true)
        setStatus({ key: quantity === 1 ? 'Adding enemy...' : 'Adding enemies...' })
        const added: EnemyInstance[] = []
        try {
            for (let index = 0; index < quantity; index += 1) {
                added.push(await enemyResources.addEnemy(
                    entry.enemyMstId,
                    scene.scene,
                    { position: nextEnemySpawnPosition() },
                    abortController.signal,
                ))
            }
            const latest = added.at(-1)
            if (latest) selectInstance(latest.instanceId)
            setStatus({
                key: added.length === 1 ? 'Enemy added' : 'Enemies added',
                detail: String(added.length),
            })
        } catch (error) {
            for (const instance of added) enemyResources.removeEnemy(instance.instanceId)
            if (!isAbortError(error)) setStatus(describeError(error))
        } finally {
            if (!disposed) {
                setBusy(false)
                renderInstances()
            }
        }
    }
    elements.clear.onclick = () => {
        const selected = selectedInstance()
        if (selected) options.onInstanceWillRemove?.(selected)
        selectedInstanceId = undefined
        const removed = enemyResources.clearEnemies()
        renderInstances()
        setStatus({ key: 'All enemies removed', detail: String(removed) })
    }
    animationSelect.onchange = () => {
        const instance = selectedInstance()
        if (busy || !instance) return
        // A draft selection leaves the active transport and pose untouched.
        pendingAnimations.set(instance, animationSelect.value)
        renderAnimationControls()
    }
    animationRepetitions.oninput = () => {
        const instance = selectedInstance()
        if (instance) pendingRepetitions.set(instance, animationRepetitions.value)
    }
    animationApply.onclick = () => {
        const instance = selectedInstance()
        if (busy || !instance || !animationRepetitions.reportValidity()) return
        const repetitions = animationRepetitions.value === '' ? undefined : animationRepetitions.valueAsNumber
        const name = animationSelect.value
        const loop = name.endsWith('_L') || /^(?:idle|wait|stand|breath)$/i.test(name)
        if (!name || !instance.playAnimation(name, loop, 0.18, 1, repetitions)) {
            setStatus({ key: 'Animation is unavailable' })
            return
        }
        pendingAnimations.delete(instance)
        renderAnimationControls()
        setStatus({ key: 'Enemy animation playing', detail: name })
    }
    animationToggle.onclick = () => {
        const instance = selectedInstance()
        if (busy || !instance?.currentAnimationName) return
        instance.setAnimationPaused(!instance.animationPaused)
        renderAnimationProgress()
        setStatus({ key: instance.animationPaused ? 'Enemy animation paused' : 'Enemy animation playing', detail: instance.currentAnimationName })
    }
    animationSlider.oninput = () => {
        const instance = selectedInstance()
        if (busy || !instance) return
        instance.seekAnimation(Number(animationSlider.value))
        renderAnimationProgress()
    }
    document.addEventListener('keydown', handleEscape)
    document.addEventListener('magius:localechange', handleLocaleChange)
    onPermanentPageExit(dispose)

    setOpen(false)
    renderInstances()
    renderStatus()
    void enemyResources.listEnemies(abortController.signal).then(value => {
        if (disposed) return
        entries = value
        setBusy(false)
        renderToolbarCatalog()
        renderCatalog()
    }).catch(error => {
        if (disposed || isAbortError(error)) return
        entries = []
        setBusy(false)
        renderSelected()
        setStatus(describeError(error))
    })

    return activeController
}

export function disposeEnemyPanel(): void {
    activeController?.dispose()
}
