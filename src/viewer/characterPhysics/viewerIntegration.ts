import type * as THREE from 'three'
import {
    addAnimationLoop,
    getClockDelta,
    removeAnimationLoop,
} from 'magia-exedra-character-three/renderer'
import {
    createExactPhysicsBindingRegistry,
    type MutableExactPhysicsBindingRegistry,
} from './binding'
import { CharacterPhysicsCatalogClient } from './catalog'
import {
    createNativeCharacterPhysics,
    type NativeCharacterPhysicsRuntime,
} from './runtime'
import type { CharacterPhysicsDiagnostics } from './types'

export interface ViewerPhysicsAttachableCharacter {
    readonly object: THREE.Group
    readonly userData: {
        readonly characterId: number
        readonly animationLoops: Function[]
        readonly disposeCallbacks: Array<() => void>
    }
}

export type ViewerCharacterPhysicsStatus =
    | 'attaching'
    | 'ready'
    | 'fail-closed'
    | 'disposed'

export interface ViewerCharacterPhysicsAttachment {
    readonly characterResourceId: number
    readonly root: THREE.Group
    readonly bindingRegistry: MutableExactPhysicsBindingRegistry
    readonly runtime?: NativeCharacterPhysicsRuntime
    readonly status: ViewerCharacterPhysicsStatus
    readonly failClosedReasons: readonly string[]
    readonly diagnostics?: CharacterPhysicsDiagnostics
    dispose(): void
}

export interface ViewerCharacterPhysicsDebugRecord {
    characterResourceId: number
    rootName: string
    status: ViewerCharacterPhysicsStatus
    failClosedReasons: readonly string[]
    diagnostics?: CharacterPhysicsDiagnostics
}

export interface AttachViewerCharacterPhysicsOptions {
    catalog?: CharacterPhysicsCatalogClient
    deltaSeconds?: () => number
}

interface MutableViewerCharacterPhysicsAttachment {
    characterResourceId: number
    root: THREE.Group
    bindingRegistry: MutableExactPhysicsBindingRegistry
    runtime?: NativeCharacterPhysicsRuntime
    status: ViewerCharacterPhysicsStatus
    failClosedReasons: string[]
    update?: () => void
    dispose: () => void
}

const catalog = new CharacterPhysicsCatalogClient()
const attachments = new WeakMap<THREE.Object3D, MutableViewerCharacterPhysicsAttachment>()
const activeAttachments = new Set<MutableViewerCharacterPhysicsAttachment>()

function reasonFrom(error: unknown): string {
    if (error instanceof Error && error.message) return error.message
    return `character-physics-attach-error:${String(error)}`
}

function publicAttachment(
    value: MutableViewerCharacterPhysicsAttachment,
): ViewerCharacterPhysicsAttachment {
    return {
        characterResourceId: value.characterResourceId,
        root: value.root,
        bindingRegistry: value.bindingRegistry,
        runtime: value.runtime,
        status: value.status,
        failClosedReasons: [...value.failClosedReasons],
        diagnostics: value.runtime?.diagnostics,
        dispose: value.dispose,
    }
}

/**
 * Installs the sole post-AnimationMixer physics writer for one Viewer character.
 * A missing/invalid product is isolated to this attachment so the character
 * itself remains visible and selectable.
 */
export async function attachViewerCharacterPhysics(
    character: ViewerPhysicsAttachableCharacter,
    options: AttachViewerCharacterPhysicsOptions = {},
): Promise<ViewerCharacterPhysicsAttachment> {
    const existing = attachments.get(character.object)
    if (existing) return publicAttachment(existing)

    const bindingRegistry = createExactPhysicsBindingRegistry()
    const value: MutableViewerCharacterPhysicsAttachment = {
        characterResourceId: character.userData.characterId,
        root: character.object,
        bindingRegistry,
        status: 'attaching',
        failClosedReasons: [],
        dispose: () => undefined,
    }
    attachments.set(character.object, value)
    activeAttachments.add(value)

    let disposed = false
    value.dispose = () => {
        if (disposed) return
        disposed = true
        if (value.update) removeAnimationLoop(value.update)
        value.runtime?.dispose()
        value.bindingRegistry.clear()
        value.status = 'disposed'
        attachments.delete(character.object)
        activeAttachments.delete(value)
    }
    character.userData.disposeCallbacks.push(value.dispose)

    try {
        const profile = await (options.catalog ?? catalog)
            .requireProfileForViewerCharacter(character.userData.characterId)
        if (disposed) return publicAttachment(value)
        const runtime = createNativeCharacterPhysics(character.object, profile, {
            bindingRegistry,
        })
        value.runtime = runtime
        value.update = () => {
            const deltaSeconds = (options.deltaSeconds ?? getClockDelta)()
            try {
                runtime.updateAfterAnimation(deltaSeconds, {
                    unscaledDeltaSeconds: deltaSeconds,
                    animatorDeltaSeconds: deltaSeconds,
                })
            } catch (error) {
                runtime.setActive(false)
                value.status = 'fail-closed'
                value.failClosedReasons = [reasonFrom(error)]
            }
        }
        // The character's renderer-level animation loop owns AnimationMixer,
        // locomotion, camera tracking, and any legacy fallback callbacks.  A
        // second renderer-level callback registered after that character loop
        // is the only stable way to keep native physics post-animation even
        // when locomotion callbacks are attached later.
        addAnimationLoop(value.update)
        value.status = runtime.diagnostics.status === 'fail-closed'
            ? 'fail-closed'
            : 'ready'
        value.failClosedReasons = runtime.diagnostics.status === 'fail-closed'
            ? [...runtime.diagnostics.missingBindings]
            : []
    } catch (error) {
        value.status = 'fail-closed'
        value.failClosedReasons = [reasonFrom(error)]
    }
    return publicAttachment(value)
}

export function getViewerCharacterPhysicsAttachment(
    root: THREE.Object3D,
): ViewerCharacterPhysicsAttachment | undefined {
    const value = attachments.get(root)
    return value ? publicAttachment(value) : undefined
}

export function findViewerCharacterPhysicsAttachment(
    characterResourceId: number,
): ViewerCharacterPhysicsAttachment | undefined {
    const matches = [...activeAttachments].filter(
        value => value.characterResourceId === characterResourceId,
    )
    return matches.length === 1 ? publicAttachment(matches[0]!) : undefined
}

export function listViewerCharacterPhysicsDebugState(): readonly ViewerCharacterPhysicsDebugRecord[] {
    return [...activeAttachments]
        .map(value => ({
            characterResourceId: value.characterResourceId,
            rootName: value.root.name,
            status: value.status,
            failClosedReasons: [...value.failClosedReasons],
            diagnostics: value.runtime?.diagnostics,
        }))
        .sort((a, b) => a.characterResourceId - b.characterResourceId)
}
