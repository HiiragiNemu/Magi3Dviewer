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
    animationSection.setAttribute('data-i18n-ignore', 'true')
    animationSection.setAttribute('aria-label', 'Enemy animation')
    const animationSelect = document.createElement('select')
    animationSelect.setAttribute('aria-label', 'Enemy animation')
    const animationLoop = document.createElement('input')
    animationLoop.type = 'checkbox'
    animationLoop.checked = true
    animationLoop.setAttribute('aria-label', 'Enemy animation loop')
    const animationSpeed = document.createElement('input')
    animationSpeed.type = 'number'
    animationSpeed.min = '0.05'
    animationSpeed.max = '4'
    animationSpeed.step = '0.05'
    animationSpeed.value = '1'
    animationSpeed.setAttribute('aria-label', 'Enemy animation speed')
    const animationPlay = document.createElement('button')
    animationPlay.type = 'button'
    animationPlay.textContent = 'Play'
    animationPlay.setAttribute('aria-label', 'Play enemy animation')
    const animationPause = document.createElement('button')
    animationPause.type = 'button'
    animationPause.setAttribute('aria-label', 'Pause enemy animation')
    const animationTitle = document.createElement('span')
    const animationLoopLabel = document.createElement('label')
    const animationLoopText = document.createElement('span')
    animationLoopLabel.append(animationLoop, animationLoopText)
    animationSection.append(animationTitle, animationSelect, animationLoopLabel, animationSpeed, animationPlay, animationPause)
    // Keep playback beside the enemy picker, not at the bottom of a closed panel.
    requireElement<HTMLElement>('enemy-toolbar-control').append(animationSection)

    type AnimationDraft = { name: string; loop: boolean; speed: number }
    // Animation controls are editor state for the selected instance, not global
    // panel state.  Keying by object identity also prevents a replacement enemy
    // with the same instance id from inheriting stale controls.
    const animationDrafts = new WeakMap<EnemyInstance, AnimationDraft>()
    const selectedAnimationDraft = (instance: EnemyInstance): AnimationDraft => {
        const existing = animationDrafts.get(instance)
        const names = instance.animationNames
        const name = existing && names.includes(existing.name)
            ? existing.name
            : instance.currentAnimationName ?? instance.defaultAnimationName ?? names[0] ?? ''
        const draft = existing
            ? { ...existing, name }
            : { name, loop: true, speed: 1 }
        animationDrafts.set(instance, draft)
        return draft
    }

    const renderAnimationControls = () => {
        const instance = selectedInstance()
        const draft = instance ? selectedAnimationDraft(instance) : undefined
        animationSelect.replaceChildren(...instance
            ? instance.animationNames.map(name => {
                const option = document.createElement('option')
                option.value = name
                option.textContent = name
                return option
            })
            : [])
        if (instance) {
            animationSelect.value = draft?.name ?? ''
            animationLoop.checked = draft?.loop ?? true
            animationSpeed.value = String(draft?.speed ?? 1)
        }
        const disabled = busy || !instance || animationSelect.options.length === 0
        animationSelect.disabled = disabled
        animationLoop.disabled = disabled
        animationSpeed.disabled = disabled
        animationPlay.disabled = disabled
        animationPause.disabled = busy || !instance?.currentAnimationName
        animationSection.hidden = !instance
        animationTitle.textContent = translateUiText('Enemy animation')
        for (const [element, key] of [
            [animationSection, 'Enemy animation'], [animationSelect, 'Enemy animation'],
            [animationLoop, 'Enemy animation loop'], [animationSpeed, 'Enemy animation speed'],
            [animationPlay, 'Play enemy animation'],
        ] as const) {
            element.setAttribute('aria-label', translateUiText(key))
            element.title = translateUiText(key)
        }
        animationLoopText.textContent = translateUiText('Loop')
        animationPlay.textContent = translateUiText('Play')
        const pauseKey = instance?.animationPaused ? 'Resume enemy animation' : 'Pause enemy animation'
        animationPause.textContent = translateUiText(pauseKey)
        animationPause.title = translateUiText(pauseKey)
        animationPause.setAttribute('aria-label', translateUiText(pauseKey))
        animationPause.setAttribute('aria-pressed', String(Boolean(instance?.animationPaused)))
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

    const tick = () => enemyResources.update(getClockDelta())

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
            selectedInstanceId = added.at(-1)?.instanceId
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
    animationPlay.onclick = () => {
        const instance = selectedInstance()
        if (!instance) {
            setStatus({ key: 'Select an enemy before playing animation' })
            return
        }
        const draft = selectedAnimationDraft(instance)
        const name = animationSelect.value || draft.name || instance.defaultAnimationName
        const speed = Number(animationSpeed.value)
        const normalizedSpeed = Number.isFinite(speed) ? Math.max(0.05, Math.min(4, speed)) : 1
        const loop = animationLoop.checked
        if (!name || !instance.playAnimation(name, loop, 0.18, normalizedSpeed)) {
            setStatus({ key: 'Animation is unavailable' })
            return
        }
        animationDrafts.set(instance, { name, loop, speed: normalizedSpeed })
        renderInstances()
        setStatus({ key: 'Enemy animation playing', detail: name })
    }
    animationPause.onclick = () => {
        const instance = selectedInstance()
        if (busy || !instance?.currentAnimationName) return
        instance.setAnimationPaused(!instance.animationPaused)
        renderAnimationControls()
        setStatus({ key: instance.animationPaused ? 'Enemy animation paused' : 'Enemy animation playing', detail: instance.currentAnimationName })
    }
    animationSelect.onchange = () => {
        const instance = selectedInstance()
        if (!instance) return
        const draft = selectedAnimationDraft(instance)
        draft.name = animationSelect.value
        animationDrafts.set(instance, draft)
        renderAnimationControls()
    }
    animationLoop.onchange = () => {
        const instance = selectedInstance()
        if (!instance) return
        const draft = selectedAnimationDraft(instance)
        draft.loop = animationLoop.checked
        animationDrafts.set(instance, draft)
        renderAnimationControls()
    }
    animationSpeed.onchange = () => {
        const instance = selectedInstance()
        const value = Number(animationSpeed.value)
        const speed = Number.isFinite(value) ? Math.max(0.05, Math.min(4, value)) : 1
        animationSpeed.value = String(speed)
        if (instance) {
            const draft = selectedAnimationDraft(instance)
            draft.speed = speed
            animationDrafts.set(instance, draft)
        }
    }
    document.addEventListener('keydown', handleEscape)
    document.addEventListener('magius:localechange', handleLocaleChange)
    window.addEventListener('pagehide', dispose, { once: true })

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
