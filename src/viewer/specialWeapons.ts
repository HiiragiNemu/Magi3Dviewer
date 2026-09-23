import * as THREE from 'three'
import { fetchAndTryDecompressGzip } from '../../magia-exedra-character-three/utils'
import { bindOfficialMaterialGroups } from '../../magia-exedra-character-three/loader'
import { createGeneralMaterial, addOfficialOutlineGroupsToMesh } from '../../magia-exedra-character-three/shaders'
import { injectOfficialGemShader } from '../../magia-exedra-character-three/shaders/gem'
import { isOfficialOutlineExtrusionEnabled } from '../../magia-exedra-character-three/officialStencilRuntime'
import { ApplyOfficialCharacterSurfaceSampling } from '../../magia-exedra-character-three/texture'
import { applyNativeSlotShaderBindings, type NativeSlotResources, type NativeTextureEntry } from '../../magia-exedra-character-three/nativeMaterialScope'
import type { OfficialMaterialProfile } from '../../magia-exedra-character-three/materialProfile'
import type { WeaponDonor } from './independentWeapons'

export interface SpecialWeaponDefinition {
    characterId: string; actionId: string; name: string; modelName: string; url: string
}
// Entries require a real exported model, exact native material/rig and action
// binding. This is not a name-based substitute for unexported SP attachments.
export const specialWeaponDefinitions: readonly SpecialWeaponDefinition[] = [{
    characterId: '100301',
    actionId: 'official-combat:100301:10030101:1008:100801:special_skill_direction_10030101',
    name: 'Tiro Finale · SP', modelName: 'chara_100301_weapon_a_sp_model',
    url: 'special-weapons/100301/tiro-finale.magius-runtime',
}, {
    characterId: '100601',
    actionId: 'official-combat:100601:10060101:1245:124501:special_skill_direction_10060101',
    name: 'Magic Cake Dish · SP', modelName: 'chara_100601_weapon_a_sp_model',
    url: 'special-weapons/100601/magic-cake-dish.magius-runtime',
}]

interface SpecialWeaponDocument {
    schema: string; characterId: string; actionId: string
    mesh: { name: string; groups: { start: number; count: number; materialIndex: number }[] }
    timeline: { wrapperName: string; clipName: string; durationSeconds: number; startSeconds: number }
    textures: (NativeTextureEntry['identity'] & { textureUuid: string; sampler: NativeTextureEntry['sampler'] })[]
    materials: {
        slot: number; key: string; name: string; profile: OfficialMaterialProfile
        baseColor: NativeSlotResources['baseColor']; shadowColor: NativeSlotResources['shadowColor']; unknowns: NativeSlotResources['unknowns']
        textures: { property: string; texture: string; scale: { x: number; y: number }; offset: { x: number; y: number } }[]
    }[]
}
export interface LoadedSpecialWeapon extends WeaponDonor {
    definition: SpecialWeaponDefinition
    wrapper: THREE.Object3D
    sample(timeSeconds: number): void
    reset(): void
}

export async function parseSpecialWeapon(data: unknown, definition: SpecialWeaponDefinition): Promise<LoadedSpecialWeapon> {
    const json = data as THREE.Object3DJSON & { nativeSpecialWeapon: SpecialWeaponDocument }
    const doc = json.nativeSpecialWeapon
    if (doc?.schema !== 'magius.native-sp-resource.v1' || doc.characterId !== definition.characterId
        || doc.actionId !== definition.actionId || doc.timeline.wrapperName !== definition.modelName) {
        throw new Error('Special weapon identity mismatch')
    }
    const textures = new Set<THREE.Texture>(), materials = new Set<THREE.Material>()
    const geometries = new Set<THREE.BufferGeometry>(), skeletons = new Set<THREE.Skeleton>()
    let object: THREE.Group | undefined
    let disposed = false
    let mixer: THREE.AnimationMixer | undefined
    const dispose = () => {
        if (disposed) return
        disposed = true
        object?.removeFromParent()
        if (mixer && object) { mixer.stopAllAction(); mixer.uncacheRoot(object) }
        object?.traverse(child => {
            const mesh = child as THREE.SkinnedMesh
            if (!mesh.isMesh) return
            geometries.add(mesh.geometry)
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material)
            if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton)
        })
        for (const geometry of geometries) geometry.dispose()
        for (const material of materials) material.dispose()
        for (const texture of textures) texture.dispose()
        for (const skeleton of skeletons) skeleton.dispose()
    }
    try {
        const loader = new THREE.ObjectLoader()
        // ObjectLoader can fail midway through parsing a malformed node before
        // returning its root. Retain ownership as resources are constructed.
        const parseGeometries = loader.parseGeometries.bind(loader)
        loader.parseGeometries = (...args: Parameters<THREE.ObjectLoader['parseGeometries']>) => {
            const values = parseGeometries(...args)
            Object.values(values).forEach(value => geometries.add(value))
            return values
        }
        const parseMaterials = loader.parseMaterials.bind(loader)
        loader.parseMaterials = (...args: Parameters<THREE.ObjectLoader['parseMaterials']>) => {
            const values = parseMaterials(...args)
            Object.values(values).forEach(value => materials.add(value))
            return values
        }
        const parseTextures = loader.parseTextures.bind(loader)
        let textureById: ReturnType<THREE.ObjectLoader['parseTextures']> = {}
        loader.parseTextures = (...args: Parameters<THREE.ObjectLoader['parseTextures']>) => {
            textureById = parseTextures(...args)
            Object.values(textureById).forEach(texture => textures.add(texture))
            return textureById
        }
        object = loader.parse(json) as THREE.Group
        const wrapper = object.getObjectByName(definition.modelName)
        const mesh = object.getObjectByName(doc.mesh.name) as THREE.SkinnedMesh
        const clip = object.animations.find(value => value.name === doc.timeline.clipName)
        if (!wrapper || !mesh?.isSkinnedMesh || !clip || Math.abs(clip.duration - doc.timeline.durationSeconds) > 0.001
            || JSON.stringify(mesh.geometry.groups) !== JSON.stringify(doc.mesh.groups)) throw new Error('Special weapon rig/group/clip contract mismatch')
        // Each loaded actor/prop owns independent UUIDs, bones, material objects
        // and texture state; preserve track identity while assigning fresh UUIDs.
        const ids = new Map<string, string>()
        object.traverse(child => { const old = child.uuid; child.uuid = THREE.MathUtils.generateUUID(); ids.set(old, child.uuid) })
        for (const track of clip.tracks) {
            const split = track.name.lastIndexOf('.'), id = ids.get(track.name.slice(0, split))
            if (!id) throw new Error(`Special weapon track has no exact node: ${track.name}`)
            track.name = id + track.name.slice(split)
        }
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material)
        const nativeTextures = new Map(doc.textures.map(row => [row.cab + '#' + row.pathId, row]))
        const slotMaterials = new Map<number, THREE.Material>()
        const slotResources: NativeSlotResources[] = []
        const textureInstances = new Map<string, THREE.Texture>()
        for (const slot of doc.materials) {
            const resources: NativeSlotResources = { key: slot.key, textures: {}, sampling: {}, bindings: {},
                baseColor: slot.baseColor, shadowColor: slot.shadowColor, unknowns: slot.unknowns,
                faceDirections: { forward: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0) } }
            for (const binding of slot.textures) {
                const source = nativeTextures.get(binding.texture)
                const original = source && textureById[source.textureUuid]
                if (!source || !original) throw new Error(`Special weapon texture missing: ${binding.texture}`)
                const key = JSON.stringify([binding.texture, binding.scale, binding.offset])
                let texture = textureInstances.get(key)
                if (!texture) {
                    texture = original.clone(); textures.add(texture); textureInstances.set(key, texture)
                    texture.repeat.set(binding.scale.x, binding.scale.y); texture.offset.set(binding.offset.x, binding.offset.y)
                    texture.needsUpdate = true
                }
                const identity = { cab: source.cab, pathId: source.pathId, name: source.name }
                const entry: NativeTextureEntry = { identity, native: identity, sampler: source.sampler, png: source.name,
                    payloadMipEvidence: { baseMip: 'native PNG decoded RGBA', remainingMips: 'browser-generated where source has multiple mips' } }
                ;(resources.textures as Record<string, THREE.Texture>)[binding.property] = texture
                ;(resources.sampling as Record<string, unknown>)[binding.property] = ApplyOfficialCharacterSurfaceSampling(texture, source.name, source.sampler)
                ;(resources.bindings as Record<string, unknown>)[binding.property] = { status: 'RESOLVED', property: binding.property, key: binding.texture, texture: entry, scale: binding.scale, offset: binding.offset }
            }
            const profile = slot.profile
            const result = await createGeneralMaterial({ colorMap: resources.bindings._BaseMap.key!, materialNames: [slot.name], materialProfiles: [profile], nativeResources: resources })
            const material = result.material; materials.add(material); material.name = slot.name
            const compile = material.onBeforeCompile
            const matCap = resources.textures._MatCapTex
            material.onBeforeCompile = function(shader, renderer) {
                compile.call(this, shader, renderer)
                if (profile.gem.enabled || profile.matCap.enabled) injectOfficialGemShader(shader, {
                    matCaps: new Map(matCap && profile.matCap.texture ? [[profile.matCap.texture.toLowerCase(), matCap]] : []), textures: matCap ? [matCap] : [],
                }, profile)
                applyNativeSlotShaderBindings(shader, resources)
            }
            const cacheKey = material.customProgramCacheKey.bind(material)
            material.customProgramCacheKey = () => cacheKey() + '|special-native:' + slot.key
            Object.assign(material.userData, { officialMaterialProfile: profile, nativeMaterialKey: slot.key, nativeBindings: resources.bindings, nativeTextureSampling: resources.sampling, nativeUnknowns: resources.unknowns })
            slotMaterials.set(slot.slot, material); slotResources[slot.slot] = resources
        }
        const profiles = doc.materials.map(slot => slot.profile)
        bindOfficialMaterialGroups(mesh, slotMaterials.get(0)!, profiles, undefined, slotMaterials)
        addOfficialOutlineGroupsToMesh(mesh, profiles.map((profile, index) => ({
            enabled: isOfficialOutlineExtrusionEnabled(profile), thickness: profile.outlineWidth,
            color: new THREE.Color().setRGB(...profile.outline.color), shadowTex: slotResources[index].textures._ShadowTex ?? undefined,
            texBlend: profile.outline.texBlend, emissionColor: new THREE.Color().setRGB(...profile.outline.emissionColor),
            outlineZOffset: profile.outline.zOffset, faceOutlineAdjust: profile.outline.faceOutlineAdjust,
        })))
        mesh.castShadow = mesh.receiveShadow = true
        object.traverse(child => { if ((child as THREE.Mesh).isMesh) child.frustumCulled = false })
        mixer = new THREE.AnimationMixer(object)
        const ownMixer = mixer
        const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
        return { object, wrapper, definition, animation: { paused: true, mixer }, dispose,
            sample(timeSeconds) {
                if (disposed) return
                if (!Number.isFinite(timeSeconds)) throw new Error('Special weapon time must be finite')
                action.enabled = true; action.paused = true; action.play()
                action.time = THREE.MathUtils.clamp(timeSeconds - doc.timeline.startSeconds, 0, clip.duration)
                ownMixer.update(0); object!.updateMatrixWorld(true)
            },
            reset() { if (!disposed) { ownMixer.stopAllAction(); wrapper.visible = false } },
        }
    } catch (error) { dispose(); throw error }
}

export async function loadSpecialWeapon(definition: SpecialWeaponDefinition, signal?: AbortSignal): Promise<LoadedSpecialWeapon> {
    const url = new URL(definition.url, document.baseURI).href
    const blob = await fetchAndTryDecompressGzip(url, undefined, undefined, signal)
    signal?.throwIfAborted()
    const result = await parseSpecialWeapon(JSON.parse(await blob.text()), definition)
    if (signal?.aborted) { result.dispose(); signal.throwIfAborted() }
    return result
}
