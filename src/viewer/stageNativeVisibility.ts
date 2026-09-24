import * as THREE from 'three'
import { resolveStageHierarchyPath } from './stageHierarchy'

export interface StageNativeGameObjectState {
    gameObjectPathID: string
    hierarchyPath: string
    carrierHierarchyPath?: string
    activeSelf: boolean
    activeInHierarchy?: boolean
}

export interface StageNativeRendererState {
    rendererPathID: string
    gameObjectPathID?: string
    hierarchyPath: string
    carrierHierarchyPath?: string
    enabled: boolean
}

export interface StageNativeVisibilityProfile {
    gameObjects?: StageNativeGameObjectState[]
    renderers?: StageNativeRendererState[]
}

/** Initial serialized state, not a per-frame override of Animator or Timeline. */
export function applyStageNativeVisibility(
    root: THREE.Object3D,
    profile: StageNativeVisibilityProfile | undefined,
) {
    if (!profile) return undefined
    const debug = {
        requestedGameObjects: profile.gameObjects?.length ?? 0,
        requestedRenderers: profile.renderers?.length ?? 0,
        appliedGameObjects: 0,
        appliedRenderers: 0,
        inactiveGameObjects: 0,
        disabledRenderers: 0,
        ambiguousGameObjectPaths: [] as string[],
        ambiguousRendererPaths: [] as string[],
        unresolvedGameObjectPaths: [] as string[],
        unresolvedRendererPaths: [] as string[],
    }
    const originalVisibility = new Map<THREE.Object3D, boolean>()
    const originalLayers = new Map<THREE.Object3D, number>()
    const pathFor = (state: { hierarchyPath: string; carrierHierarchyPath?: string }) =>
        state.carrierHierarchyPath ?? state.hierarchyPath
    function byPath<T extends { hierarchyPath: string; carrierHierarchyPath?: string }>(states: T[]) {
        const groups = new Map<string, T[]>()
        for (const state of states) {
            const path = pathFor(state)
            const entries = groups.get(path) ?? []
            entries.push(state)
            groups.set(path, entries)
        }
        return groups
    }
    function resolveUnique<T extends { hierarchyPath: string; carrierHierarchyPath?: string }>(states: T[]) {
        const groups = byPath(states)
        const resolved = new Map<string, THREE.Object3D>()
        const owners = new Map<THREE.Object3D, number>()
        for (const [path, entries] of groups) {
            if (entries.length !== 1) continue
            const object = resolveStageHierarchyPath(root, path)
            if (object) {
                resolved.set(path, object)
                owners.set(object, (owners.get(object) ?? 0) + 1)
            }
        }
        return { groups, resolved, owners }
    }
    const gameObjects = resolveUnique(profile.gameObjects ?? [])
    for (const [path, states] of gameObjects.groups) {
        const object = gameObjects.resolved.get(path)
        if (states.length !== 1 || (object && gameObjects.owners.get(object) !== 1)) {
            debug.ambiguousGameObjectPaths.push(path)
            continue
        }
        if (!object) {
            debug.unresolvedGameObjectPaths.push(path)
            continue
        }
        originalVisibility.set(object, object.visible)
        // Do not flatten activeInHierarchy into the child's independent state.
        object.visible = states[0].activeSelf
        debug.appliedGameObjects++
        if (!object.visible) debug.inactiveGameObjects++
    }
    const renderers = resolveUnique(profile.renderers ?? [])
    for (const [path, states] of renderers.groups) {
        const object = renderers.resolved.get(path) as THREE.Mesh | undefined
        if (states.length !== 1 || (object && renderers.owners.get(object) !== 1)) {
            debug.ambiguousRendererPaths.push(path)
            continue
        }
        if (!object?.isMesh) {
            debug.unresolvedRendererPaths.push(path)
            continue
        }
        debug.appliedRenderers++
        if (states[0].enabled) continue
        originalLayers.set(object, object.layers.mask)
        // Renderer.enabled affects this draw only. Object.visible would also
        // hide children; material.visible could hide unrelated shared users.
        object.layers.mask = 0
        debug.disabledRenderers++
    }
    return {
        debug,
        restore() {
            for (const [object, visible] of originalVisibility) object.visible = visible
            for (const [object, mask] of originalLayers) object.layers.mask = mask
            originalVisibility.clear()
            originalLayers.clear()
        },
    }
}
