import * as THREE from 'three'
import type { HomeAnimationRuntime } from './homeRuntime'
import { bindHomePropMaterialCompanion, type HomePropMaterialCompanion } from './homeIndependentPropMaterials'

export interface HomeIndependentPropDocument {
    schema: 'magius.home-independent-props.v1'
    characterId: number
    parentName: string
    props: Array<{
        id: string
        wrapperName: string
        model: THREE.Object3DJSON
        nativeMaterials?: HomePropMaterialCompanion
        clips: Array<{
            name: string
            sourceClipPathId: string
            role: 'unique01-transition' | 'unique01-start' | 'unique01-loop' | 'hide'
        }>
    }>
}

/** Attach authored Home prefab children, not a guessed hand-bone offset.
 * Their curves join the body's existing family mixer, so pause, seek, repeats
 * and automatic Start -> Loop use one clock rather than a second animator.
 */
export function attachHomeIndependentProps(
    root: THREE.Group,
    runtime: HomeAnimationRuntime,
    document: HomeIndependentPropDocument,
): HomeAnimationRuntime {
    if (document.schema !== 'magius.home-independent-props.v1'
        || document.characterId !== runtime.characterId) {
        throw new Error('Independent Home prop character identity mismatch')
    }
    const parents: THREE.Object3D[] = []
    root.traverse(node => { if (node.name === document.parentName) parents.push(node) })
    if (parents.length !== 1) throw new Error('Independent Home prop parent must resolve exactly once')
    const parent = parents[0]
    const additions: THREE.Group[] = []
    const clips: THREE.AnimationClip[] = []
    const helpers = new Set(runtime.helpers ?? [])
    const resolvedHelpers = new Set<string>()
    const ids = new Set<string>()
    try {
        for (const definition of document.props) {
            if (ids.has(definition.id) || root.getObjectByName(definition.wrapperName)) {
                throw new Error(`Duplicate independent Home prop: ${definition.id}`)
            }
            ids.add(definition.id)
            const object = new THREE.ObjectLoader().parse(definition.model) as THREE.Group
            additions.push(object)
            if (!object.getObjectByName(definition.wrapperName)) throw new Error('Home prop wrapper is absent')
            if (definition.nativeMaterials) bindHomePropMaterialCompanion(object, definition.id, document.characterId, definition.nativeMaterials)
            // ObjectLoader preserves serialized UUIDs; never let two actors
            // share animation target identities in a multi-actor performance.
            const oldIds = new Map<string, THREE.Object3D>()
            const names = new Map<string, THREE.Object3D[]>()
            object.traverse(node => {
                if (oldIds.has(node.uuid)) throw new Error('Duplicate Home prop node identity')
                oldIds.set(node.uuid, node)
                names.set(node.name, [...(names.get(node.name) ?? []), node])
                node.uuid = THREE.MathUtils.generateUUID()
            })
            object.visible = false
            object.userData.homeIndependentProp = { id: definition.id, characterId: document.characterId }
            for (const binding of definition.clips) {
                const matches = object.animations.filter(clip => clip.name === binding.name)
                if (matches.length !== 1) throw new Error(`Missing/ambiguous Home prop clip: ${binding.name}`)
                const sourceIdentity = runtime.clipIdentities?.find(row => row.sourceClipPathId === binding.sourceClipPathId)
                if (!sourceIdentity) throw new Error(`Unknown Home prop source clip: ${binding.sourceClipPathId}`)
                const source = matches[0]
                const clip = source.clone()
                const bodyAction = runtime.actions?.unique01
                const family = binding.role === 'unique01-transition' ? bodyAction?.nativeTransition?.transition.family
                    : binding.role === 'unique01-start' ? bodyAction?.startFamily
                    : binding.role === 'unique01-loop' ? bodyAction?.loopFamily
                        : 'HomeWeapon' + definition.id.replace(/[^a-z0-9]/gi, '') + 'Hide'
                if (!family) throw new Error('Home prop body action mapping is absent')
                // Native hide clip prefixes can equal the visible Loop family (100304).
                // Use the explicit state-mapped role, never that ambiguous prefix.
                // Match the same canonical family rules used by character.ts.
                clip.name = family.replace(/_weapon_[a-z0-9]+(?=_|$)/gi, '').replace(/_\d+$/g, '')
                    + '_weapon_' + definition.id.replace(/[^a-z0-9]/gi, '').toLowerCase()
                clip.tracks = clip.tracks.map(track => {
                    const parsed = THREE.PropertyBinding.parseTrackName(track.name)
                    const exact = oldIds.get(parsed.nodeName)
                    const named = names.get(parsed.nodeName) ?? []
                    const target = exact ?? (named.length === 1 ? named[0] : undefined)
                    if (!target || parsed.objectName || parsed.propertyIndex !== undefined) {
                        throw new Error(`Unresolved Home prop animation target: ${track.name}`)
                    }
                    track.name = `${target.uuid}.${parsed.propertyName}`
                    return track
                })
                // Rest visibility is false. Stopping this action (combat,
                // clear, another transport) restores that state automatically.
                clip.tracks.push(new THREE.BooleanKeyframeTrack(`${object.uuid}.visible`, [0], [binding.role !== 'hide']))
                if (binding.role === 'hide') {
                    helpers.add(clip.name)
                    resolvedHelpers.add(binding.sourceClipPathId)
                }
                clips.push(clip)
            }
        }
        // Validate all resources before publishing any node/clip into the actor.
        for (const object of additions) parent.add(object)
        root.animations.push(...clips)
        return {
            ...runtime,
            helpers: [...helpers],
            externalHelpers: runtime.externalHelpers?.filter(name => !runtime.clipIdentities?.some(
                row => row.importedName === name && resolvedHelpers.has(row.sourceClipPathId),
            )),
        }
    } catch (error) {
        for (const object of additions) object.traverse(node => {
            const mesh = node as THREE.SkinnedMesh
            if (!mesh.isMesh) return
            mesh.geometry.dispose()
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose()
            if (mesh.isSkinnedMesh) mesh.skeleton.dispose()
        })
        throw error
    }
}
