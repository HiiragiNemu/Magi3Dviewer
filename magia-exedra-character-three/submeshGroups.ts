import * as THREE from 'three'
import { officialCharacterSubmeshIndexCounts } from './submeshGroups.generated'

export interface RestoredSubmeshGroupState {
    source: 'jp-unity-m-submeshes'
    characterId: number
    meshName: string
    counts: readonly number[]
    drawCount: number
}

/**
 * Restore material draw groups lost by the FBX export.
 *
 * AssetStudio emits these character meshes as non-indexed geometry in official
 * Unity submesh order, so each m_SubMeshes.indexCount maps directly to a
 * contiguous Three draw range.  Refuse mismatched data instead of partially
 * assigning the wrong Soul Gem/Aniso material to arbitrary triangles.
 */
export function restoreOfficialSubmeshGroups(
    mesh: THREE.Mesh,
    characterId: number,
    materialSlotCount: number,
): RestoredSubmeshGroupState | undefined {
    const counts = officialCharacterSubmeshIndexCounts[characterId]?.[mesh.name]
    if (!counts || counts.length <= 1 || counts.length !== materialSlotCount) {
        return undefined
    }

    const geometry = mesh.geometry
    const drawCount = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0
    const recoveredCount = counts.reduce((sum, count) => sum + count, 0)
    if (drawCount <= 0 || recoveredCount !== drawCount) {
        console.warn('Official submesh group count mismatch', {
            characterId,
            mesh: mesh.name,
            drawCount,
            recoveredCount,
            counts,
        })
        return undefined
    }

    geometry.clearGroups()
    let start = 0
    counts.forEach((count, materialIndex) => {
        geometry.addGroup(start, count, materialIndex)
        start += count
    })
    const state: RestoredSubmeshGroupState = {
        source: 'jp-unity-m-submeshes',
        characterId,
        meshName: mesh.name,
        counts,
        drawCount,
    }
    mesh.userData.officialSubmeshGroups = state
    return state
}
