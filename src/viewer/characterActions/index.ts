import { withLoadingTask, yieldLoadingFrame } from '../../../magia-exedra-character-three/loadingProgress.ts'
import type * as THREE from 'three'
import {
    CharacterActionCatalog,
    CharacterActionResourceError,
    fetchCharacterActionManifest,
} from './catalog.ts'
import {
    attachNativeDungeonRuntime,
    fetchNativeDungeonRuntime,
    LoadedNativeDungeonActionSet,
} from './loader.ts'
import type { CharacterActionResourceEntry } from './types.ts'
import {
    CombatJumpActionCatalog,
    fetchCombatJumpManifest,
} from './combatCatalog.ts'
import {
    attachCombatJumpRuntime,
    fetchCombatJumpRuntime,
    LoadedCombatJumpActionSet,
} from './combatLoader.ts'
import type { CombatJumpActionResourceEntry } from './combatTypes.ts'

export * from './catalog.ts'
export * from './loader.ts'
export * from './combatCatalog.ts'
export * from './combatLoader.ts'
export type * from './types.ts'
export type * from './combatTypes.ts'

export interface CharacterActionResourceManagerOptions {
    manifestUrl?: string
    combatJumpManifestUrl?: string
}

export class CharacterActionResourceManager {
    readonly manifestUrl: string
    readonly combatJumpManifestUrl: string
    private catalogValue?: CharacterActionCatalog
    private catalogPromise?: Promise<CharacterActionCatalog>
    private combatJumpCatalogValue?: CombatJumpActionCatalog
    private combatJumpCatalogPromise?: Promise<CombatJumpActionCatalog>

    constructor(options: CharacterActionResourceManagerOptions = {}) {
        this.manifestUrl = options.manifestUrl ?? '/character-actions/manifest.v1.json'
        this.combatJumpManifestUrl = options.combatJumpManifestUrl
            ?? '/character-actions/combat-jump/manifest.v1.json'
    }

    async ready(signal?: AbortSignal): Promise<CharacterActionCatalog> {
        if (this.catalogValue) return this.catalogValue
        this.catalogPromise ??= withLoadingTask('动作目录加载', signal, async (signal, task) => {
            const manifest = await fetchCharacterActionManifest(this.manifestUrl, signal)
            task.phase('assembling')
            await yieldLoadingFrame(signal)
            return new CharacterActionCatalog(manifest)
        })
        this.catalogValue = await this.catalogPromise
        return this.catalogValue
    }

    async listActions(signal?: AbortSignal): Promise<readonly CharacterActionResourceEntry[]> {
        return (await this.ready(signal)).list()
    }

    async readyCombatJump(signal?: AbortSignal): Promise<CombatJumpActionCatalog> {
        if (this.combatJumpCatalogValue) return this.combatJumpCatalogValue
        this.combatJumpCatalogPromise ??= withLoadingTask('动作目录加载', signal, async (signal, task) => {
            const manifest = await fetchCombatJumpManifest(this.combatJumpManifestUrl, signal)
            task.phase('assembling')
            await yieldLoadingFrame(signal)
            return new CombatJumpActionCatalog(manifest)
        })
        this.combatJumpCatalogValue = await this.combatJumpCatalogPromise
        return this.combatJumpCatalogValue
    }

    async listCombatJumpActions(
        characterId?: string,
        signal?: AbortSignal,
    ): Promise<readonly CombatJumpActionResourceEntry[]> {
        const catalog = await this.readyCombatJump(signal)
        return characterId === undefined ? catalog.list() : catalog.listForCharacter(characterId)
    }

    async listCharacterActions(
        dungeonCharacterId: number,
        signal?: AbortSignal,
    ): Promise<readonly CharacterActionResourceEntry[]> {
        return (await this.ready(signal)).listForCharacter(dungeonCharacterId)
    }

    async attachCharacterActions(
        dungeonCharacterId: number,
        modelKey: string,
        object: THREE.Object3D & { animations: THREE.AnimationClip[] },
        signal?: AbortSignal,
    ): Promise<LoadedNativeDungeonActionSet> {
        return withLoadingTask('动作加载', signal, async (signal, task) => {
        const entries = (await this.ready(signal)).requireCharacter(dungeonCharacterId)
        const runtime = await fetchNativeDungeonRuntime(entries[0], signal)
        task.phase('assembling')
        await yieldLoadingFrame(signal)
        return attachNativeDungeonRuntime(object, modelKey, entries, runtime)
        })
    }

    async attachCombatJumpActions(
        characterId: string,
        modelKey: string,
        object: THREE.Object3D & { animations: THREE.AnimationClip[] },
        signal?: AbortSignal,
    ): Promise<LoadedCombatJumpActionSet> {
        return withLoadingTask('动作加载', signal, async (signal, task) => {
        const entries = (await this.readyCombatJump(signal)).requireCharacter(characterId)
        const runtimeEntry = entries.find(entry => (
            entry.availability.status === 'source-available'
            && typeof entry.resource.runtimeUrl === 'string'
        ))
        if (!runtimeEntry) {
            throw new CharacterActionResourceError(
                'ACTION_UNAVAILABLE',
                `Character ${characterId} has no source-available combat/jump runtime`,
                { characterId },
            )
        }
        const runtime = await fetchCombatJumpRuntime(runtimeEntry, signal)
        task.phase('assembling')
        await yieldLoadingFrame(signal)
        return attachCombatJumpRuntime(object, modelKey, entries, runtime)
        })
    }
}
