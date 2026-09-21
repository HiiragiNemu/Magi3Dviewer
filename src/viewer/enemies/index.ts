import * as THREE from 'three'
import { withLoadingTask, yieldLoadingFrame } from '../../../magia-exedra-character-three/loadingProgress.ts'
import {
    CombatVfxCatalogClient,
    type CombatVfxCatalogEntry,
} from '../combatVfxCatalog.ts'
import {
    EnemyCatalog,
    fetchEnemyManifest,
    resolveEnemyDisplayName,
} from './catalog.ts'
import {
    EnemyInstance,
    FbxEnemyModelLoader,
    type EnemyModelLoader,
} from './loader.ts'
import type {
    EnemyAddOptions,
    EnemyLocale,
    EnemyManifestEntry,
} from './types.ts'

export * from './catalog.ts'
export * from './loader.ts'
export type * from './types.ts'

export interface EnemyResourceManagerOptions {
    manifestUrl?: string
    modelLoader?: EnemyModelLoader
    vfxCatalogUrl?: string
    vfxCatalog?: CombatVfxCatalogClient
}

function applyTransform(object: THREE.Object3D, options: EnemyAddOptions): void {
    if (options.position) object.position.fromArray(options.position)
    if (options.rotation) object.rotation.fromArray([...options.rotation, 'XYZ'])
    if (typeof options.scale === 'number') {
        object.scale.setScalar(options.scale)
    } else if (options.scale) {
        object.scale.fromArray(options.scale)
    }
}

export class EnemyResourceManager {
    readonly manifestUrl: string
    readonly modelLoader: EnemyModelLoader
    readonly vfxCatalog: CombatVfxCatalogClient
    private catalogValue?: EnemyCatalog
    private catalogPromise?: Promise<EnemyCatalog>
    private readonly active = new Map<string, EnemyInstance>()
    private nextInstance = 1

    constructor(options: EnemyResourceManagerOptions = {}) {
        this.manifestUrl = options.manifestUrl ?? '/enemies/manifest.v1.json'
        this.modelLoader = options.modelLoader ?? new FbxEnemyModelLoader()
        this.vfxCatalog = options.vfxCatalog ?? new CombatVfxCatalogClient(
            options.vfxCatalogUrl ?? '/vfx/catalog.v1.json',
        )
    }

    async ready(signal?: AbortSignal): Promise<EnemyCatalog> {
        if (this.catalogValue) return this.catalogValue
        this.catalogPromise ??= fetchEnemyManifest(this.manifestUrl, signal)
            .then(manifest => new EnemyCatalog(manifest))
        this.catalogValue = await this.catalogPromise
        return this.catalogValue
    }

    async listEnemies(signal?: AbortSignal): Promise<readonly EnemyManifestEntry[]> {
        return (await this.ready(signal)).list()
    }

    async getEnemy(
        enemyMstId: number,
        signal?: AbortSignal,
    ): Promise<EnemyManifestEntry | undefined> {
        return (await this.ready(signal)).get(enemyMstId)
    }

    async getDisplayName(
        enemyMstId: number,
        locale: EnemyLocale,
        signal?: AbortSignal,
    ): Promise<string> {
        const entry = (await this.ready(signal)).require(enemyMstId)
        return resolveEnemyDisplayName(entry, locale)
    }

    async getDirectionVfx(
        enemyMstId: number,
        directionKey: string,
        signal?: AbortSignal,
    ): Promise<CombatVfxCatalogEntry> {
        const enemy = (await this.ready(signal)).require(enemyMstId)
        const direction = enemy.actions.directions.find(value =>
            value.stableDirectionKey === directionKey
            || value.directionName === directionKey
            || value.bundleKey === directionKey)
        if (!direction?.runtimeProduct || !direction.bundleKey) {
            const reasons = direction?.catalogProduct?.failClosedReasons.join(', ')
            throw new Error(
                reasons
                    ? `Enemy direction VFX is fail-closed: ${enemyMstId}:${directionKey}: ${reasons}`
                    : `Enemy direction has no runtime VFX product: ${enemyMstId}:${directionKey}`,
            )
        }
        const product = await this.vfxCatalog.requireByBundleKey(
            direction.bundleKey,
            signal,
        )
        if (product.stableKey !== direction.runtimeProduct.stableKey) {
            throw new Error(
                `Enemy direction VFX identity mismatch: ${enemyMstId}:${directionKey}`,
            )
        }
        return product
    }

    async loadEnemy(
        enemyMstId: number,
        signal?: AbortSignal,
    ): Promise<THREE.Group> {
        const entry = (await this.ready(signal)).require(enemyMstId)
        return this.modelLoader.load(entry, signal)
    }

    async addEnemy(
        enemyMstId: number,
        parent?: THREE.Object3D,
        options: EnemyAddOptions = {},
        signal?: AbortSignal,
    ): Promise<EnemyInstance> {
        return withLoadingTask(`敌人加载 ${enemyMstId}`, signal, async (signal, task) => {
            await yieldLoadingFrame(signal)
            const entry = (await this.ready(signal)).require(enemyMstId)
            const object = await this.modelLoader.load(entry, signal)
            signal.throwIfAborted()
            task.phase('assembling')
            const instanceId = `enemy-${enemyMstId}-${this.nextInstance++}`
            const instance = new EnemyInstance(instanceId, entry, object)
            if (options.name) instance.object.name = options.name
            applyTransform(instance.object, options)
            parent?.add(instance.object)
            this.active.set(instanceId, instance)
            return instance
        })
    }

    async addEnemies(
        enemyMstIds: readonly number[],
        parent?: THREE.Object3D,
        options: EnemyAddOptions = {},
        signal?: AbortSignal,
    ): Promise<EnemyInstance[]> {
        const added: EnemyInstance[] = []
        try {
            for (const enemyMstId of enemyMstIds) {
                added.push(await this.addEnemy(enemyMstId, parent, options, signal))
            }
            return added
        } catch (error) {
            for (const instance of added) this.removeEnemy(instance.instanceId)
            throw error
        }
    }

    getInstances(): readonly EnemyInstance[] {
        return [...this.active.values()]
    }

    removeEnemy(instanceId: string): boolean {
        const instance = this.active.get(instanceId)
        if (!instance) return false
        this.active.delete(instanceId)
        instance.dispose()
        return true
    }

    removeEnemies(instanceIds: readonly string[]): number {
        return instanceIds.reduce(
            (count, instanceId) => count + Number(this.removeEnemy(instanceId)),
            0,
        )
    }

    clearEnemies(): number {
        const ids = [...this.active.keys()]
        return this.removeEnemies(ids)
    }

    update(deltaSeconds: number): void {
        for (const instance of this.active.values()) instance.update(deltaSeconds)
    }
}
