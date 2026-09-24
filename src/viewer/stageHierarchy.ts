import * as THREE from 'three'

function pathSegments(value: string) {
    return value
        .replaceAll('\\', '/')
        .split('/')
        .filter(Boolean)
}

function descendByNames(
    root: THREE.Object3D,
    segments: readonly string[],
): THREE.Object3D | undefined {
    let candidates: THREE.Object3D[] = [root]
    for (const segment of segments) {
        const sanitizedSegment = THREE.PropertyBinding.sanitizeNodeName(segment)
        candidates = candidates.flatMap(current => {
            const exact = current.children.filter(child => child.name === segment)
            return exact.length > 0 || sanitizedSegment === segment
                ? exact
                : current.children.filter(child => child.name === sanitizedSegment)
        })
        if (candidates.length === 0) return undefined
    }
    return candidates.length === 1 ? candidates[0] : undefined
}

function uniqueResolved(
    starts: readonly THREE.Object3D[],
    segments: readonly string[],
): THREE.Object3D | undefined {
    const resolved = new Set<THREE.Object3D>()
    for (const start of starts) {
        const candidate = descendByNames(start, segments)
        if (candidate) resolved.add(candidate)
    }
    return resolved.size === 1 ? resolved.values().next().value : undefined
}

/**
 * Resolve an exact serialized Unity GameObject hierarchy path against the FBX/
 * GLTF scene tree.
 *
 * AssetStudio may wrap the exported prefab in one or more loader-created root
 * groups, so the first hierarchy segment is searched among every descendant.
 * Once a start node is chosen, every remaining segment must be a direct child;
 * this prevents the loose `getObjectByName` collisions that occur in large
 * stages with repeated names such as MainLight/Volume/Camera.
 */
export function resolveStageHierarchyPath(
    root: THREE.Object3D,
    value: string | undefined,
): THREE.Object3D | undefined {
    if (!value) return undefined
    const segments = pathSegments(value)
    if (segments.length === 0) return undefined

    if (root.name === segments[0]) {
        const direct = descendByNames(root, segments.slice(1))
        if (direct) return direct
    }

    const starts: THREE.Object3D[] = []
    const sanitizedRootName = THREE.PropertyBinding.sanitizeNodeName(segments[0])
    root.traverse(candidate => {
        if (
            candidate.name === segments[0]
            || (
                sanitizedRootName !== segments[0]
                && candidate.name === sanitizedRootName
            )
        ) starts.push(candidate)
    })
    const exact = uniqueResolved(starts, segments.slice(1))
    if (exact) return exact

    // A one-segment Unity path names the prefab root itself. When the loader
    // renamed that root, the supplied carrier is the corresponding runtime
    // object. Preserve ambiguity if exact original-name roots still exist.
    if (segments.length === 1) {
        return starts.length === 0 ? root : undefined
    }

    // The Viewer deliberately gives the loaded carrier root a stable stage
    // identity (for example `Stage:dungeon-intro-0001-001`). AssetStudio's
    // serialized paths still begin with the original prefab root
    // (`level_intro_0001_001`). Drop only that first root segment and resolve
    // the complete remaining direct-child chain. This is not a loose
    // getObjectByName fallback: every intermediate segment remains mandatory,
    // and two carriers exposing the same suffix stay unresolved.
    const suffixStarts: THREE.Object3D[] = []
    root.traverse(candidate => suffixStarts.push(candidate))
    return uniqueResolved(suffixStarts, segments.slice(1))
}

export function resolveStageAnchor(
    root: THREE.Object3D,
    options: {
        anchorPath?: string
        anchorNode?: string
    },
): THREE.Object3D | undefined {
    return resolveStageHierarchyPath(root, options.anchorPath)
        ?? (options.anchorNode ? root.getObjectByName(options.anchorNode) : undefined)
}
