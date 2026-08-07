import * as THREE from 'three'

export interface StageUv1GeometryRecord {
    vertexCount: number
    uv1Sha256: string
    /** Little-endian Float32 UV pairs, base64 encoded. */
    uv1Base64: string
}

export interface StageUv1NodeRecord {
    hierarchyPath: string
    geometryKey: string
}

export interface StageUv1Companion {
    schemaVersion: number
    stageId: string
    sourceRevision: string
    sourceBundle: string
    fbxPath: string
    uvConvention: string
    geometries: Record<string, StageUv1GeometryRecord>
    nodes: StageUv1NodeRecord[]
}

export interface StageUv1CompanionApplication {
    stageId: string
    sourceRevision: string
    declaredNodeCount: number
    matchedNodeCount: number
    installedMeshCount: number
    installedGeometryCount: number
    clonedSharedGeometryCount: number
    unmatchedCompanionPaths: string[]
    ambiguousCompanionPaths: string[]
    missingGeometryKeys: string[]
    vertexCountMismatchPaths: string[]
}

interface CandidateMesh {
    mesh: THREE.Mesh
    path: string
}

interface Assignment {
    mesh: THREE.Mesh
    path: string
    node: StageUv1NodeRecord
    geometry: StageUv1GeometryRecord
}

export async function loadStageUv1Companion(
    url: string,
    signal: AbortSignal,
): Promise<StageUv1Companion> {
    signal.throwIfAborted()
    const response = await fetch(
        new URL(url, document.baseURI).href,
        { cache: 'no-cache', signal },
    )
    if (!response.ok) {
        throw new Error(`Could not load stage UV1 companion: ${response.status}`)
    }
    const documentValue = await response.json() as Partial<StageUv1Companion>
    signal.throwIfAborted()
    if (
        documentValue.schemaVersion !== 3
        || typeof documentValue.stageId !== 'string'
        || typeof documentValue.sourceRevision !== 'string'
        || !documentValue.geometries
        || !Array.isArray(documentValue.nodes)
    ) {
        throw new Error('Invalid stage UV1 companion document')
    }
    return documentValue as StageUv1Companion
}

/**
 * Restores the second UV channel dropped by the AssetStudio/FBX export.
 *
 * Matching is hierarchy based and fail-closed. The companion is generated from
 * the same current-JP Unity Mesh objects and verified against the exported FBX
 * UV0 with zero error before it is admitted to the review branch.
 */
export function applyStageUv1Companion(
    root: THREE.Object3D,
    companion: StageUv1Companion,
    options: { strict?: boolean } = {},
): StageUv1CompanionApplication {
    const meshes: CandidateMesh[] = []
    root.traverse(object => {
        if (isMesh(object)) {
            meshes.push({ mesh: object, path: getHierarchyPath(object, root) })
        }
    })

    const unmatchedCompanionPaths: string[] = []
    const ambiguousCompanionPaths: string[] = []
    const missingGeometryKeys: string[] = []
    const vertexCountMismatchPaths: string[] = []
    const assignments: Assignment[] = []
    const claimedMeshes = new Set<THREE.Mesh>()

    const orderedNodes = [...companion.nodes].sort((left, right) =>
        pathDepth(right.hierarchyPath) - pathDepth(left.hierarchyPath),
    )

    for (const node of orderedNodes) {
        const nodePath = normalizeHierarchyPath(node.hierarchyPath)
        let bestScore = -1
        let candidates: CandidateMesh[] = []
        for (const candidate of meshes) {
            if (claimedMeshes.has(candidate.mesh)) continue
            const score = hierarchySuffixScore(candidate.path, nodePath)
            if (score > bestScore) {
                bestScore = score
                candidates = score >= 0 ? [candidate] : []
            } else if (score >= 0 && score === bestScore) {
                candidates.push(candidate)
            }
        }

        if (candidates.length === 0) {
            unmatchedCompanionPaths.push(node.hierarchyPath)
            continue
        }
        if (candidates.length > 1) {
            ambiguousCompanionPaths.push(node.hierarchyPath)
            continue
        }

        const geometry = companion.geometries[node.geometryKey]
        if (!geometry) {
            missingGeometryKeys.push(node.geometryKey)
            continue
        }
        const candidate = candidates[0]
        const targetVertexCount = candidate.mesh.geometry.getAttribute('position')?.count
        if (targetVertexCount !== geometry.vertexCount) {
            vertexCountMismatchPaths.push(node.hierarchyPath)
            continue
        }
        claimedMeshes.add(candidate.mesh)
        assignments.push({
            mesh: candidate.mesh,
            path: candidate.path,
            node,
            geometry,
        })
    }

    const strictFailure =
        unmatchedCompanionPaths.length > 0
        || ambiguousCompanionPaths.length > 0
        || missingGeometryKeys.length > 0
        || vertexCountMismatchPaths.length > 0
        || assignments.length !== companion.nodes.length

    if (options.strict && strictFailure) {
        throw new Error([
            'Stage UV1 companion did not resolve exactly.',
            `declared=${companion.nodes.length}`,
            `matched=${assignments.length}`,
            `unmatched=${unmatchedCompanionPaths.length}`,
            `ambiguous=${ambiguousCompanionPaths.length}`,
            `missingGeometry=${missingGeometryKeys.length}`,
            `vertexMismatch=${vertexCountMismatchPaths.length}`,
        ].join(' '))
    }

    // A single FBX BufferGeometry can theoretically be referenced by multiple
    // scene nodes. If current-JP assigns different baked UVs to those nodes,
    // clone before installing the attribute so one instance cannot overwrite
    // another. Groups with one geometryKey safely share one installed array.
    const byOriginalGeometry = new Map<THREE.BufferGeometry, Assignment[]>()
    for (const assignment of assignments) {
        const group = byOriginalGeometry.get(assignment.mesh.geometry) ?? []
        group.push(assignment)
        byOriginalGeometry.set(assignment.mesh.geometry, group)
    }

    let clonedSharedGeometryCount = 0
    let installedGeometryCount = 0
    for (const [originalGeometry, group] of byOriginalGeometry) {
        const keys = new Set(group.map(item => item.node.geometryKey))
        if (keys.size === 1) {
            const values = decodeUv1(group[0].geometry)
            originalGeometry.setAttribute(
                'uv1',
                new THREE.Float32BufferAttribute(values, 2),
            )
            installedGeometryCount++
            continue
        }

        // All references to this original geometry are in `group` because all
        // companion nodes were resolved before mutation. Replace every one and
        // release the now-unreferenced source geometry.
        for (const assignment of group) {
            const clone = originalGeometry.clone()
            clone.setAttribute(
                'uv1',
                new THREE.Float32BufferAttribute(
                    decodeUv1(assignment.geometry),
                    2,
                ),
            )
            assignment.mesh.geometry = clone
            clonedSharedGeometryCount++
            installedGeometryCount++
        }
        originalGeometry.dispose()
    }

    return {
        stageId: companion.stageId,
        sourceRevision: companion.sourceRevision,
        declaredNodeCount: companion.nodes.length,
        matchedNodeCount: assignments.length,
        installedMeshCount: assignments.length,
        installedGeometryCount,
        clonedSharedGeometryCount,
        unmatchedCompanionPaths,
        ambiguousCompanionPaths,
        missingGeometryKeys,
        vertexCountMismatchPaths,
    }
}

function decodeUv1(record: StageUv1GeometryRecord) {
    const binary = atob(record.uv1Base64)
    const expectedBytes = record.vertexCount * 2 * Float32Array.BYTES_PER_ELEMENT
    if (binary.length !== expectedBytes) {
        throw new Error(
            `UV1 byte count mismatch for ${record.uv1Sha256}: `
            + `expected ${expectedBytes}, got ${binary.length}`,
        )
    }
    const values = new Float32Array(record.vertexCount * 2)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index)
    }
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < values.length; index++) {
        values[index] = view.getFloat32(index * 4, true)
    }
    return values
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
    return 'isMesh' in object && object.isMesh === true
}

function getHierarchyPath(object: THREE.Object3D, root: THREE.Object3D) {
    const parts: string[] = []
    let current: THREE.Object3D | null = object
    while (current) {
        if (current.name) parts.unshift(current.name)
        if (current === root) break
        current = current.parent
    }
    return normalizeHierarchyPath(parts.join('/'))
}

function normalizeHierarchyPath(path: string) {
    return path
        .replaceAll('\\', '/')
        .split('/')
        .filter(Boolean)
        .join('/')
}

function pathDepth(path: string) {
    return normalizeHierarchyPath(path).split('/').filter(Boolean).length
}

function hierarchySuffixScore(left: string, right: string) {
    const leftParts = normalizeHierarchyPath(left).split('/').filter(Boolean)
    const rightParts = normalizeHierarchyPath(right).split('/').filter(Boolean)
    if (leftParts.length === 0 || rightParts.length === 0) return -1
    let score = 0
    while (
        score < leftParts.length
        && score < rightParts.length
        && leftParts[leftParts.length - 1 - score]
            === rightParts[rightParts.length - 1 - score]
    ) {
        score++
    }
    return score > 0 ? score : -1
}
