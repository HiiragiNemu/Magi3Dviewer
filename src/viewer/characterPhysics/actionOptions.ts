import * as THREE from 'three'
import type { MutableExactPhysicsBindingRegistry } from './binding'
import type {
    CharacterPhysicsComponentActivation,
    UnityTransformBinding,
} from './types'

export type CharacterPhysicsActionPhaseKind =
    | 'special-skill-reserve'
    | 'special-skill-reserve-and-pre-special'
    | 'official-timeline'

export interface CharacterPhysicsExternalBindingRequirement {
    stableKey: string
    componentKind: string
    componentStableKey: string
    bindingStableKey: string
    exactRelativePath: string
    binding: UnityTransformBinding
    activation: CharacterPhysicsComponentActivation
}

export interface CharacterPhysicsActionPhaseOption {
    stableKey: string
    optionValue: string
    character: Readonly<{
        style3dCharacterMstId: number
        characterResourceId: number
        resourceName: string
        displayName: string | null
    }>
    phaseKind: CharacterPhysicsActionPhaseKind
    officialDisplayName: string
    phaseRoot: Readonly<{
        officialGameObjectName: string
        binding: UnityTransformBinding
    }>
    timeline: Readonly<{
        playableDirectorPathID: string
        timelineAssetPathID: string
        timelineAssetName: string
        durationMode: number
        fixedDurationSeconds: number
        frameRate: number
        initialState: number
        wrapMode: number
    }>
    registrationBindings: readonly CharacterPhysicsExternalBindingRequirement[]
    availability: Readonly<{
        sourceStatus: 'source-ready'
        bindingStatus: 'runtime-ready'
        playbackStatus: 'consumer-pending'
        failClosedReasons: readonly string[]
    }>
}

export interface CharacterPhysicsViewerActionOption {
    actionId: string
    label: string
    characterResourceId: number
    style3dCharacterMstId: number
    availability: Readonly<{
        status: 'source-available' | 'unavailable'
        reason?: string
    }>
    semantic: string | null
    directionName: string | null
    runtimeUrl: string | null
    phaseBindingRelation: 'character-identity-only-no-phase-inference'
}

export interface CharacterPhysicsAuxiliaryRegistration {
    stableKey: string
    character: CharacterPhysicsActionPhaseOption['character']
    componentKind: string
    componentStableKey: string
    prefabRootName: string
    bindingStableKey: string
    exactRelativePath: string
    binding: UnityTransformBinding
    activation: CharacterPhysicsComponentActivation
    scope: 'auxiliary-prefab-registration'
    selectableAction: false
    availability: Readonly<{
        sourceStatus: 'source-ready'
        bindingStatus: 'runtime-ready'
        failClosedReasons: readonly string[]
    }>
}

export interface CharacterPhysicsActionOptionsManifest {
    schema: 'magius.character-physics-action-options.v1'
    lookupKey: 'characterResourceId+phaseStableKey'
    bindingIdentity: string
    counts: Readonly<{
        characters: number
        actionPhases: number
        actionRegistrationBindings: number
        auxiliaryRegistrationBindings: number
        relatedViewerActionOptions: number
        relatedViewerActionsSourceAvailable: number
        relatedViewerActionsUnavailable: number
        failClosed: number
    }>
    policy: Readonly<{
        phaseToViewerActionMapping: 'not-inferred'
        externalBinding: 'exact-registration-only'
        missingBinding: 'fail-closed'
        uiAvailability: 'show-source-options;disable-unregistered-playback'
    }>
    entries: readonly CharacterPhysicsActionPhaseOption[]
    viewerActionOptions: readonly CharacterPhysicsViewerActionOption[]
    auxiliaryRegistrations: readonly CharacterPhysicsAuxiliaryRegistration[]
    failClosedRecords: readonly Readonly<Record<string, unknown>>[]
}

export class CharacterPhysicsActionOptionsError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'CharacterPhysicsActionOptionsError'
    }
}

type FetchLike = typeof fetch

function absoluteUrl(value: string): URL {
    const base = typeof location === 'undefined'
        ? 'http://127.0.0.1/'
        : location.href
    return new URL(value, base)
}

function validateManifest(
    value: CharacterPhysicsActionOptionsManifest,
): CharacterPhysicsActionOptionsManifest {
    if (value.schema !== 'magius.character-physics-action-options.v1') {
        throw new CharacterPhysicsActionOptionsError(`action-options-schema:${value.schema}`)
    }
    if (value.lookupKey !== 'characterResourceId+phaseStableKey') {
        throw new CharacterPhysicsActionOptionsError(
            `action-options-lookup-key:${value.lookupKey}`,
        )
    }
    if (
        !Array.isArray(value.entries)
        || !Array.isArray(value.viewerActionOptions)
        || !Array.isArray(value.auxiliaryRegistrations)
        || !Array.isArray(value.failClosedRecords)
    ) {
        throw new CharacterPhysicsActionOptionsError('action-options-arrays')
    }
    const phaseKeys = new Set<string>()
    const phaseCharacters = new Set<number>()
    let registrationBindings = 0
    for (const entry of value.entries) {
        if (
            entry.optionValue !== entry.stableKey
            || phaseKeys.has(entry.stableKey)
            || entry.timeline.timelineAssetName !== entry.officialDisplayName
            || entry.availability.sourceStatus !== 'source-ready'
            || entry.availability.bindingStatus !== 'runtime-ready'
            || entry.availability.playbackStatus !== 'consumer-pending'
        ) {
            throw new CharacterPhysicsActionOptionsError(
                `action-option-invalid:${entry.stableKey}`,
            )
        }
        phaseKeys.add(entry.stableKey)
        phaseCharacters.add(entry.character.characterResourceId)
        registrationBindings += entry.registrationBindings.length
        const bindingKeys = new Set<string>()
        for (const requirement of entry.registrationBindings) {
            if (
                !requirement.exactRelativePath
                || bindingKeys.has(requirement.bindingStableKey)
                || requirement.binding.stableKey !== requirement.bindingStableKey
            ) {
                throw new CharacterPhysicsActionOptionsError(
                    `action-option-binding-invalid:${requirement.stableKey}`,
                )
            }
            bindingKeys.add(requirement.bindingStableKey)
        }
    }
    if (
        value.counts.actionPhases !== value.entries.length
        || value.counts.characters !== phaseCharacters.size
        || value.counts.actionRegistrationBindings !== registrationBindings
        || value.counts.auxiliaryRegistrationBindings
            !== value.auxiliaryRegistrations.length
        || value.counts.relatedViewerActionOptions !== value.viewerActionOptions.length
        || value.counts.failClosed !== value.failClosedRecords.length
    ) {
        throw new CharacterPhysicsActionOptionsError('action-options-counts')
    }
    const sourceAvailable = value.viewerActionOptions.filter(
        entry => entry.availability.status === 'source-available',
    ).length
    const unavailable = value.viewerActionOptions.filter(
        entry => entry.availability.status === 'unavailable',
    ).length
    if (
        sourceAvailable !== value.counts.relatedViewerActionsSourceAvailable
        || unavailable !== value.counts.relatedViewerActionsUnavailable
    ) {
        throw new CharacterPhysicsActionOptionsError('viewer-action-option-counts')
    }
    if (value.auxiliaryRegistrations.some(value => value.selectableAction !== false)) {
        throw new CharacterPhysicsActionOptionsError('auxiliary-action-selection-enabled')
    }
    return value
}

export class CharacterPhysicsActionOptionsClient {
    private readonly manifestUrl: URL
    private readonly fetcher: FetchLike
    private manifestPromise?: Promise<CharacterPhysicsActionOptionsManifest>

    constructor(
        manifestUrl = '/character-physics/action-options.v1.json',
        fetcher: FetchLike = globalThis.fetch.bind(globalThis),
    ) {
        this.manifestUrl = absoluteUrl(manifestUrl)
        this.fetcher = fetcher
    }

    async manifest(): Promise<CharacterPhysicsActionOptionsManifest> {
        this.manifestPromise ??= this.fetchManifest()
        return this.manifestPromise
    }

    async listPhasesForCharacter(
        characterResourceId: number,
    ): Promise<readonly CharacterPhysicsActionPhaseOption[]> {
        return (await this.manifest()).entries.filter(
            entry => entry.character.characterResourceId === characterResourceId,
        )
    }

    async listViewerActionsForCharacter(
        characterResourceId: number,
    ): Promise<readonly CharacterPhysicsViewerActionOption[]> {
        return (await this.manifest()).viewerActionOptions.filter(
            entry => entry.characterResourceId === characterResourceId,
        )
    }

    async requirePhase(stableKey: string): Promise<CharacterPhysicsActionPhaseOption> {
        const matches = (await this.manifest()).entries.filter(
            entry => entry.stableKey === stableKey,
        )
        if (matches.length !== 1) {
            throw new CharacterPhysicsActionOptionsError(
                `action-option-count:${stableKey}:${matches.length}`,
            )
        }
        return matches[0]!
    }

    private async fetchManifest(): Promise<CharacterPhysicsActionOptionsManifest> {
        const response = await this.fetcher(this.manifestUrl)
        if (!response.ok) {
            throw new CharacterPhysicsActionOptionsError(
                `action-options-http-${response.status}:${this.manifestUrl.href}`,
            )
        }
        return validateManifest(await response.json() as CharacterPhysicsActionOptionsManifest)
    }
}

function resolveExactRelativePath(
    root: THREE.Object3D,
    exactRelativePath: string,
): THREE.Object3D {
    let current = root
    for (const segment of exactRelativePath.split('/')) {
        const matches = current.children.filter(child => child.name === segment)
        if (matches.length !== 1) {
            throw new CharacterPhysicsActionOptionsError(
                `external-binding-path-count:${root.name}:${exactRelativePath}:`
                + `${segment}:${matches.length}`,
            )
        }
        current = matches[0]!
    }
    return current
}

function registerRequirements(
    expectedRootName: string,
    requirements: readonly CharacterPhysicsExternalBindingRequirement[],
    root: THREE.Object3D,
    registry: MutableExactPhysicsBindingRegistry,
): () => void {
    if (root.name !== expectedRootName) {
        throw new CharacterPhysicsActionOptionsError(
            `external-binding-root:${root.name}:${expectedRootName}`,
        )
    }
    const disposers: Array<() => void> = []
    try {
        for (const requirement of requirements) {
            const object = resolveExactRelativePath(root, requirement.exactRelativePath)
            disposers.push(registry.register(requirement.bindingStableKey, object))
        }
    } catch (error) {
        for (const dispose of disposers.reverse()) dispose()
        throw error
    }
    return () => {
        for (const dispose of disposers.reverse()) dispose()
    }
}

export function registerCharacterPhysicsActionPhaseBindings(
    phase: CharacterPhysicsActionPhaseOption,
    phaseRoot: THREE.Object3D,
    registry: MutableExactPhysicsBindingRegistry,
): () => void {
    return registerRequirements(
        phase.phaseRoot.officialGameObjectName,
        phase.registrationBindings,
        phaseRoot,
        registry,
    )
}

export function registerCharacterPhysicsAuxiliaryBinding(
    entry: CharacterPhysicsAuxiliaryRegistration,
    prefabRoot: THREE.Object3D,
    registry: MutableExactPhysicsBindingRegistry,
): () => void {
    return registerRequirements(
        entry.prefabRootName,
        [{
            stableKey: entry.stableKey,
            componentKind: entry.componentKind,
            componentStableKey: entry.componentStableKey,
            bindingStableKey: entry.bindingStableKey,
            exactRelativePath: entry.exactRelativePath,
            binding: entry.binding,
            activation: entry.activation,
        }],
        prefabRoot,
        registry,
    )
}
