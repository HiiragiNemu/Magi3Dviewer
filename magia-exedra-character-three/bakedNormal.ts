import * as THREE from 'three'

export const ReDriveBakedNormalAttribute = 'reDriveBakedNormal'

const BinaryMagic = 'RDBN0001'
const textDecoder = new TextDecoder('utf-8')

export interface ReDriveBakedNormalData {
    characterId: number
    meshes: Map<string, Float32Array>
}

export interface ReDriveBakedNormalSelection {
    source: 'official-path' | 'official-name' | 'fbx-normal'
    key?: string
    values?: Float32Array
    rejected: Array<{
        key: string
        officialVertexCount: number
        fbxVertexCount: number
    }>
}

/** Parse the bounded binary companion emitted by extract-official-baked-normals.py. */
export function parseReDriveBakedNormals(
    buffer: ArrayBuffer,
): ReDriveBakedNormalData {
    const bytes = new Uint8Array(buffer)
    if (bytes.byteLength < 16) {
        throw new Error('ReDrive baked-normal payload is truncated')
    }
    const magic = textDecoder.decode(bytes.subarray(0, 8))
    if (magic !== BinaryMagic) {
        throw new Error(`Unexpected ReDrive baked-normal magic ${magic}`)
    }

    const view = new DataView(buffer)
    const characterId = view.getUint32(8, true)
    const meshCount = view.getUint32(12, true)
    const meshes = new Map<string, Float32Array>()
    let offset = 16
    for (let meshIndex = 0; meshIndex < meshCount; meshIndex++) {
        if (offset + 2 > bytes.byteLength) {
            throw new Error(`Baked-normal mesh ${meshIndex} header is truncated`)
        }
        const nameLength = view.getUint16(offset, true)
        offset += 2
        const nameEnd = offset + nameLength
        if (nameEnd > bytes.byteLength) {
            throw new Error(`Baked-normal mesh ${meshIndex} name is truncated`)
        }
        const name = textDecoder.decode(bytes.subarray(offset, nameEnd))
        offset = (nameEnd + 3) & ~3
        if (offset + 4 > bytes.byteLength) {
            throw new Error(`Baked-normal mesh ${name} count is truncated`)
        }
        const vertexCount = view.getUint32(offset, true)
        offset += 4
        const valueByteLength = vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT
        const valuesEnd = offset + valueByteLength
        if (valuesEnd > bytes.byteLength) {
            throw new Error(`Baked-normal mesh ${name} values are truncated`)
        }
        const values = new Float32Array(buffer.slice(offset, valuesEnd))
        if (values.some(value => !Number.isFinite(value))) {
            throw new Error(`Baked-normal mesh ${name} contains a non-finite value`)
        }
        if (meshes.has(name)) {
            throw new Error(`Duplicate baked-normal mesh ${name}`)
        }
        meshes.set(name, values)
        offset = valuesEnd
    }
    if (offset !== bytes.byteLength) {
        throw new Error(
            `ReDrive baked-normal payload has ${bytes.byteLength - offset} trailing bytes`,
        )
    }
    return { characterId, meshes }
}

/**
 * Resolve a baked-normal record without letting an ambiguous plain mesh name
 * bind to a different same-named FBX geometry.  Path-qualified records win;
 * legacy plain-name records remain valid only when their vertex count is exact.
 */
export function selectReDriveBakedNormalValues(
    data: ReDriveBakedNormalData | undefined,
    meshName: string,
    objectPath: string,
    fbxVertexCount: number,
): ReDriveBakedNormalSelection {
    if (!data) return { source: 'fbx-normal', rejected: [] }

    const pathKey = `${meshName}\x00${objectPath}`
    const candidates = pathKey === meshName
        ? [meshName]
        : [pathKey, meshName]
    const rejected: ReDriveBakedNormalSelection['rejected'] = []
    for (const key of candidates) {
        const values = data.meshes.get(key)
        if (!values) continue
        const officialVertexCount = values.length / 3
        if (officialVertexCount === fbxVertexCount) {
            return {
                source: key === pathKey ? 'official-path' : 'official-name',
                key,
                values,
                rejected,
            }
        }
        rejected.push({ key, officialVertexCount, fbxVertexCount })
    }
    return { source: 'fbx-normal', rejected }
}

/**
 * Install the official object-space outline vector reconstructed from Unity's
 * tangent-space TEXCOORD3 channel. Models without a companion retain their FBX
 * normal so the outline pass always receives a valid attribute binding.
 *
 * This attribute is intentionally outline-only. ReDriveToon's production
 * forward passes light and shade with the mesh NORMAL0 channel; TEXCOORD3 is
 * only exposed by those passes for the explicit `_Debug` output branch.
 */
export function restoreReDriveBakedNormalAttribute(
    geometry: THREE.BufferGeometry,
    officialValues?: Float32Array,
): 'official' | 'fbx-normal' | 'unchanged' {
    if (geometry.getAttribute(ReDriveBakedNormalAttribute)) return 'unchanged'
    const normal = geometry.getAttribute('normal')
    if (!normal || normal.itemSize < 3) {
        throw new Error(`Geometry ${geometry.name} has no three-component normal`)
    }

    let values: Float32Array
    let source: 'official' | 'fbx-normal'
    if (officialValues) {
        if (officialValues.length !== normal.count * 3) {
            throw new Error(
                `Geometry ${geometry.name} baked-normal count ${officialValues.length / 3} `
                + `does not match FBX vertex count ${normal.count}`,
            )
        }
        values = officialValues
        source = 'official'
    } else {
        values = new Float32Array(normal.count * 3)
        for (let index = 0; index < normal.count; index++) {
            values[index * 3] = normal.getX(index)
            values[index * 3 + 1] = normal.getY(index)
            values[index * 3 + 2] = normal.getZ(index)
        }
        source = 'fbx-normal'
    }
    geometry.setAttribute(
        ReDriveBakedNormalAttribute,
        new THREE.BufferAttribute(values, 3),
    )
    geometry.userData.reDriveBakedNormalSource = source
    return source
}
