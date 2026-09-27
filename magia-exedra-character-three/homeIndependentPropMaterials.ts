import * as THREE from 'three'
import type {
    NativeMaterialEntry, NativeTextureEntry, NativeMeshBinding,
    NativeTextureBinding, NativeMaterialConsumerInput,
} from './nativeMaterialScope'

/** A material-only scope. Geometry/channels are the sealed exported Object3D,
 * not an invented native character-channel packet or a global name registry. */
export interface HomePropMaterialCompanion {
    schema: 'magius.home-prop-materials.v1'
    id: string
    characterId: number
    meshes: NativeMeshBinding[]
    materials: Record<string, NativeMaterialEntry>
    textures: Record<string, NativeTextureEntry>
    provenance: Record<string, unknown>
}

const inputs = new WeakMap<THREE.Mesh, NativeMaterialConsumerInput>()
const documents = new WeakMap<NativeMaterialConsumerInput, HomePropMaterialCompanion>()
const fail = (message: string): never => { throw new Error(`Home prop native material: ${message}`) }

export function bindHomePropMaterialCompanion(
    root: THREE.Object3D, id: string, characterId: number, source: HomePropMaterialCompanion,
): void {
    if (source.schema !== 'magius.home-prop-materials.v1' || source.id !== id || source.characterId !== characterId) {
        fail('companion identity mismatch')
    }
    const data = structuredClone(source)
    const byPath = new Map<string, THREE.Object3D[]>()
    const visit = (node: THREE.Object3D, parent: string) => {
        const path = parent ? `${parent}/${node.name}` : node.name
        byPath.set(path, [...(byPath.get(path) ?? []), node])
        node.children.forEach(child => visit(child, path))
    }
    visit(root, '')
    const meshByKey = new Map<string, NativeMeshBinding>()
    const bindings: Array<[THREE.Mesh, NativeMeshBinding]> = []
    for (const row of data.meshes) {
        if (row.key !== `${row.sourceCab}:${row.meshPathId}:renderer:${row.rendererPathId}` || meshByKey.has(row.key)) fail('ambiguous mesh identity')
        const matches = byPath.get(row.path) ?? [], mesh = matches[0] as THREE.Mesh
        if (matches.length !== 1 || !mesh.isMesh || mesh.geometry.userData.sourceMeshPathId !== row.meshPathId) fail('exact exported mesh is missing')
        const geometry = mesh.geometry, position = geometry.getAttribute('position'), baked = geometry.getAttribute('reDriveBakedNormal')
        if (position.count !== row.expandedVertexCount || !baked || baked.itemSize !== 3 || baked.count !== position.count
            || geometry.userData.reDriveBakedNormalSource !== 'official') fail('native baked-normal/vertex contract drift')
        if (JSON.stringify(geometry.groups) !== JSON.stringify(row.slots.map(s => ({ start: s.start, count: s.count, materialIndex: s.index })))) fail('native slot ranges drift')
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const slot of row.slots) {
            const material = data.materials[slot.materialKey]
            if (!material || slot.index !== row.slots.indexOf(slot) || materials[slot.index]?.name !== material.identity.name
                || material.identity.name !== slot.materialName || slot.materialKey !== `${material.identity.cab}:${material.identity.pathId}`
                || material.shader.status !== 'RESOLVED' || material.shader.name !== 'Creative/Character/ReDriveToon'
                || slot.shaderKey !== `${material.shader.targetCab}:${material.shader.pathId}`) fail('slot/material/shader identity mismatch')
            const seen = new Set<string>()
            for (const env of material.native.textureEnvs) {
                if (seen.has(env.property) || ![env.scale.x, env.scale.y, env.offset.x, env.offset.y].every(Number.isFinite)) fail('invalid TexEnv')
                seen.add(env.property)
                if (env.texture.status === 'NULL' && env.texture.pathId === '0') continue
                const key = `${env.texture.targetCab}:${env.texture.pathId}`, texture = data.textures[key]
                if (env.texture.status !== 'RESOLVED' || !texture || key !== `${texture.identity.cab}:${texture.identity.pathId}`
                    || texture.sampler.name !== texture.identity.name.trim().toLowerCase()) fail('unresolved texture identity')
            }
        }
        meshByKey.set(row.key, row); bindings.push([mesh, row])
    }
    const exportedMeshes: THREE.Mesh[] = []
    root.traverse(node => { if ((node as THREE.Mesh).isMesh) exportedMeshes.push(node as THREE.Mesh) })
    if (!bindings.length || bindings.length !== exportedMeshes.length
        || new Set(bindings.map(([mesh]) => mesh)).size !== exportedMeshes.length) fail('companion must cover every exported mesh exactly once')
    const materialForSlot = (meshKey: string, index: number): NativeMaterialEntry => {
        const slot = meshByKey.get(meshKey)?.slots[index]
        if (!slot || slot.index !== index) return fail('exact material slot missing')
        return data.materials[slot.materialKey]
    }
    const scope: NativeMaterialConsumerInput['scope'] = {
        materialForSlot,
        floatValue(meshKey, index, property) {
            const rows = materialForSlot(meshKey, index).native.savedFloats.filter(row => row[0] === property)
            if (rows.length !== 1 || !Number.isFinite(rows[0][1])) return fail(`BLANK float ${property}`)
            return rows[0][1]
        },
        colorValue(meshKey, index, property) {
            const rows = materialForSlot(meshKey, index).native.savedColors.filter(row => row[0] === property)
            if (rows.length !== 1 || !Object.values(rows[0][1]).every(Number.isFinite)) return fail(`BLANK color ${property}`)
            return rows[0][1]
        },
        textureForProperty(meshKey, index, property): NativeTextureBinding {
            const rows = materialForSlot(meshKey, index).native.textureEnvs.filter(row => row.property === property)
            if (rows.length !== 1) return fail(`BLANK texture ${property}`)
            const env = rows[0], key = env.texture.status === 'NULL' ? null : `${env.texture.targetCab}:${env.texture.pathId}`
            return { status: env.texture.status, property, key, texture: key ? data.textures[key] : null, scale: env.scale, offset: env.offset }
        },
    }
    const input: NativeMaterialConsumerInput = { scope, packet: { characterId, meshes: data.meshes }, textureUrls: {} }
    documents.set(input, data)
    // Publish only after every scoped mesh, slot, channel and PPtr was validated.
    for (const [mesh, row] of bindings) {
        mesh.geometry.userData.nativeMaterialChannelKey = row.key
        mesh.userData.homePropNativeMaterial = { id, characterId, provenance: data.provenance }
        inputs.set(mesh, input)
    }
}

/** Filenames locate transport only; each slot still binds CAB + PPtr identity. */
export function getHomePropMaterialInput(
    mesh: THREE.Mesh, files: Record<string, string>,
): NativeMaterialConsumerInput | undefined {
    const input = inputs.get(mesh)
    if (!input) return undefined
    const data = documents.get(input)!
    const urls: Record<string, string> = {}
    for (const [key, texture] of Object.entries(data.textures)) {
        if (!texture.png || /[\\/]/.test(texture.png)) fail('texture transport must be a sibling filename')
        const matches = Object.entries(files).filter(([path]) => path.replace(/\\/g, '/').split('/').at(-1) === texture.png)
        if (matches.length !== 1) fail(`exact texture transport missing: ${texture.png}`)
        urls[key] = matches[0][1]
    }
    input.textureUrls = urls
    return input
}
