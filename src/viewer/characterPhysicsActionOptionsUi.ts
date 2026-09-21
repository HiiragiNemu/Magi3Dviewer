import {
    CharacterPhysicsActionOptionsClient,
    type CharacterPhysicsActionOptionsManifest,
    type CharacterPhysicsViewerActionOption,
} from './characterPhysics/actionOptions'
import { translateUiText } from './localization/zhCN'

export interface CharacterPhysicsRelatedActionRuntimeState {
    playable: boolean
    status: string
    reason?: string
}

export interface CharacterPhysicsPhaseRuntimeState {
    status: 'idle' | 'registering' | 'registered' | 'fail-closed'
    stableKey?: string
    actionId?: string
    characterResourceId?: number
    phaseRootName?: string
    phaseRootParentName?: string
    phaseRootSource?: 'action-owned' | 'external-loader'
    reason?: string
}

export interface CharacterPhysicsPhaseRuntimeLease {
    readonly stableKey: string
    dispose(): void
}

export interface CharacterPhysicsActionOptionsUiRuntime {
    currentCharacterResourceId(): number | null
    currentActionStatus(): string
    physicsPhaseState(): CharacterPhysicsPhaseRuntimeState
    activatePhase(stableKey: string): Promise<CharacterPhysicsPhaseRuntimeLease>
    resolveAction(actionId: string): CharacterPhysicsRelatedActionRuntimeState
    playAction(actionId: string): Promise<void>
}

export interface CharacterPhysicsActionOptionsUiController {
    refresh(): void
    dispose(): void
}

interface Elements {
    root: HTMLElement
    status: HTMLOutputElement
    phaseList: HTMLElement
    actionList: HTMLElement
}

function requiredElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id)
    if (!element) throw new Error(`Missing character physics action UI element: ${id}`)
    return element as T
}

function collectElements(): Elements {
    return {
        root: requiredElement('character-physics-action-options'),
        status: requiredElement('character-physics-action-options-status'),
        phaseList: requiredElement('character-physics-phase-list'),
        actionList: requiredElement('character-physics-related-action-list'),
    }
}

function setStatus(element: HTMLOutputElement, text: string, status = '') {
    element.value = text
    element.textContent = text
    element.hidden = !text
    if (status) element.dataset.status = status
    else delete element.dataset.status
}

function emptyMessage(text: string) {
    const message = document.createElement('p')
    message.className = 'character-physics-option-empty'
    message.textContent = translateUiText(text)
    return message
}

function phaseKindLabel(phaseKind: string) {
    if (phaseKind === 'special-skill-reserve') return translateUiText('Special skill reserve')
    if (phaseKind === 'special-skill-reserve-and-pre-special') {
        return translateUiText('Special skill reserve and pre-special')
    }
    return phaseKind
}

export function setupCharacterPhysicsActionOptionsUi(
    runtime: CharacterPhysicsActionOptionsUiRuntime,
    client = new CharacterPhysicsActionOptionsClient(),
): CharacterPhysicsActionOptionsUiController {
    const elements = collectElements()
    let disposed = false
    let manifest: CharacterPhysicsActionOptionsManifest | undefined
    let loadError: string | undefined
    let operationToken = 0
    let activePhaseLease: CharacterPhysicsPhaseRuntimeLease | undefined

    const syncActivePhaseLease = (state: CharacterPhysicsPhaseRuntimeState) => {
        if (
            activePhaseLease
            && (
                state.status !== 'registered'
                || state.stableKey !== activePhaseLease.stableKey
            )
        ) {
            activePhaseLease = undefined
        }
    }

    const renderPhaseRows = (characterResourceId: number) => {
        elements.phaseList.replaceChildren()
        const phaseState = runtime.physicsPhaseState()
        syncActivePhaseLease(phaseState)
        const actionStatus = runtime.currentActionStatus()
        const actionActive = actionStatus === 'playing' || actionStatus === 'paused'
        const phases = manifest?.entries.filter(
            entry => entry.character.characterResourceId === characterResourceId,
        ) ?? []
        if (phases.length === 0) {
            elements.phaseList.append(emptyMessage('No physics action phases for this character'))
            return
        }
        const fragment = document.createDocumentFragment()
        for (const phase of phases) {
            const row = document.createElement('article')
            row.className = 'character-physics-option-row character-physics-phase-row'
            row.dataset.phaseStableKey = phase.stableKey
            row.dataset.characterResourceId = String(phase.character.characterResourceId)
            row.title = phase.stableKey

            const heading = document.createElement('div')
            heading.className = 'character-physics-option-heading'
            const name = document.createElement('strong')
            name.textContent = phase.officialDisplayName
            name.setAttribute('data-i18n-ignore', 'true')
            const kind = document.createElement('span')
            kind.textContent = phaseKindLabel(phase.phaseKind)
            heading.append(name, kind)

            const availability = document.createElement('small')
            availability.className = 'character-physics-option-reason'
            const isCurrentPhase = phaseState.stableKey === phase.stableKey
            const isRegistering = isCurrentPhase && phaseState.status === 'registering'
            const isRegistered = isCurrentPhase && phaseState.status === 'registered'
            const isFailed = isCurrentPhase && phaseState.status === 'fail-closed'
            if (isRegistered) {
                const rootSource = phaseState.phaseRootSource
                    ? translateUiText(
                        phaseState.phaseRootSource === 'action-owned'
                            ? 'Action-owned phase root'
                            : 'External phase root',
                    )
                    : undefined
                const rootDetail = [
                    phaseState.phaseRootName,
                    phaseState.phaseRootParentName,
                    rootSource,
                ].filter(Boolean).join(' · ')
                availability.textContent = rootDetail
                    ? `${translateUiText('Physics phase active')} — ${rootDetail}`
                    : translateUiText('Physics phase active')
            } else if (isRegistering) {
                availability.textContent = translateUiText('Activating physics phase...')
            } else if (isFailed) {
                availability.textContent = phaseState.reason || translateUiText('Physics action options unavailable')
            } else if (actionActive) {
                availability.textContent = translateUiText('Ready for active official action')
            } else {
                availability.textContent = translateUiText('Play an official action before activating this phase')
            }
            availability.dataset.status = phaseState.status
            availability.title = isFailed ? phaseState.reason || '' : ''

            const activate = document.createElement('button')
            activate.type = 'button'
            activate.dataset.phaseStableKey = phase.stableKey
            const canRelease = isRegistered && activePhaseLease?.stableKey === phase.stableKey
            activate.textContent = translateUiText(
                canRelease
                    ? 'Release phase'
                    : isRegistered
                        ? 'Phase active'
                        : isRegistering
                            ? 'Activating...'
                            : 'Activate phase',
            )
            activate.disabled = isRegistering || (!actionActive && !canRelease) || (isRegistered && !canRelease)
            activate.addEventListener('click', async () => {
                if (canRelease) {
                    operationToken++
                    activePhaseLease?.dispose()
                    activePhaseLease = undefined
                    setStatus(elements.status, '')
                    render()
                    return
                }
                const token = ++operationToken
                activate.disabled = true
                setStatus(elements.status, translateUiText('Activating physics phase...'), 'loading')
                try {
                    const lease = await runtime.activatePhase(phase.stableKey)
                    if (disposed || token !== operationToken) {
                        lease.dispose()
                        return
                    }
                    activePhaseLease = lease
                    setStatus(elements.status, '')
                } catch (error) {
                    if (disposed || token !== operationToken) return
                    const reason = error instanceof Error ? error.message : String(error)
                    setStatus(elements.status, reason, 'error')
                }
                if (!disposed && token === operationToken) render()
            })
            row.classList.toggle('is-active', isRegistered)
            row.classList.toggle('is-unavailable', isFailed)
            row.append(heading, availability, activate)
            fragment.append(row)
        }
        elements.phaseList.append(fragment)
    }

    const actionAvailability = (entry: CharacterPhysicsViewerActionOption) => {
        if (entry.availability.status === 'unavailable') {
            return {
                playable: false,
                status: entry.availability.status,
                reason: entry.availability.reason || 'source-unavailable',
            }
        }
        return runtime.resolveAction(entry.actionId)
    }

    const renderActionRows = (characterResourceId: number) => {
        elements.actionList.replaceChildren()
        const actions = manifest?.viewerActionOptions.filter(
            entry => entry.characterResourceId === characterResourceId,
        ) ?? []
        if (actions.length === 0) {
            elements.actionList.append(emptyMessage('No related official actions for this character'))
            return
        }
        const fragment = document.createDocumentFragment()
        for (const entry of actions) {
            const availability = actionAvailability(entry)
            const row = document.createElement('article')
            row.className = 'character-physics-option-row character-physics-related-action-row'
            row.dataset.actionId = entry.actionId
            row.dataset.sourceAvailability = entry.availability.status
            row.dataset.consumerStatus = availability.status
            row.classList.toggle('is-unavailable', !availability.playable)

            const copy = document.createElement('div')
            copy.className = 'character-physics-option-copy'
            const label = document.createElement('strong')
            label.textContent = entry.label
            label.title = entry.actionId
            label.setAttribute('data-i18n-ignore', 'true')
            copy.append(label)
            if (availability.reason) {
                const reason = document.createElement('small')
                reason.className = 'character-physics-option-reason'
                reason.textContent = availability.reason
                reason.title = availability.reason
                reason.setAttribute('data-i18n-ignore', 'true')
                copy.append(reason)
            }

            const play = document.createElement('button')
            play.type = 'button'
            play.textContent = translateUiText('Play')
            play.disabled = !availability.playable
            play.dataset.actionId = entry.actionId
            play.dataset.availabilityStatus = availability.status
            if (availability.reason) play.title = availability.reason
            play.addEventListener('click', async () => {
                const token = ++operationToken
                play.disabled = true
                setStatus(elements.status, translateUiText('Loading official character action...'), 'loading')
                try {
                    await runtime.playAction(entry.actionId)
                    if (disposed || token !== operationToken) return
                    setStatus(elements.status, '', '')
                } catch (error) {
                    if (disposed || token !== operationToken) return
                    const reason = error instanceof Error ? error.message : String(error)
                    setStatus(elements.status, reason, 'error')
                }
                if (!disposed && token === operationToken) render()
            })
            row.append(copy, play)
            fragment.append(row)
        }
        elements.actionList.append(fragment)
    }

    const render = () => {
        if (disposed) return
        if (loadError) {
            setStatus(elements.status, `${translateUiText('Physics action options unavailable')}: ${loadError}`, 'error')
            elements.phaseList.replaceChildren()
            elements.actionList.replaceChildren()
            return
        }
        if (!manifest) {
            setStatus(elements.status, translateUiText('Loading physics action options...'), 'loading')
            elements.phaseList.replaceChildren()
            elements.actionList.replaceChildren()
            return
        }
        const characterResourceId = runtime.currentCharacterResourceId()
        if (characterResourceId == null) {
            setStatus(elements.status, translateUiText('Select a character to view physics action options'))
            elements.phaseList.replaceChildren(emptyMessage('No physics action phases for this character'))
            elements.actionList.replaceChildren(emptyMessage('No related official actions for this character'))
            return
        }
        setStatus(elements.status, '')
        renderPhaseRows(characterResourceId)
        renderActionRows(characterResourceId)
    }

    const onLocaleChange = () => render()
    document.addEventListener('magius:localechange', onLocaleChange)
    render()
    void client.manifest()
        .then(value => {
            if (disposed) return
            manifest = value
            render()
        })
        .catch(error => {
            if (disposed) return
            loadError = error instanceof Error ? error.message : String(error)
            render()
        })

    return {
        refresh: render,
        dispose() {
            disposed = true
            operationToken++
            activePhaseLease?.dispose()
            activePhaseLease = undefined
            document.removeEventListener('magius:localechange', onLocaleChange)
        },
    }
}
