export type StageBundleRegion = 'jp' | 'tw'
export type StageBundleManifestKind =
    | 'unity-assetbundle-manifest'
    | 'text-manifest'

export interface StageBundleManifestSource {
    region: StageBundleRegion
    kind: StageBundleManifestKind
    repository?: string
    revision?: string
    path?: string
    sha256?: string
}

/**
 * Evidence captured by the private/export pipeline after resolving a scene's
 * Unity AssetBundle dependency graph.
 *
 * `dependencyClosure` contains dependencies only; `rootBundle` is deliberately
 * excluded so consumers cannot accidentally load the root twice.
 */
export interface StageBundleProvenance {
    rootBundle: string
    manifest: StageBundleManifestSource
    directDependencies?: string[]
    dependencyClosure?: string[]
    closureSha256?: string
}

export interface RootAssetBundleManifestEntry {
    name: string
    directDependencies: string[]
}

export interface RootAssetBundleManifestIndex {
    schemaVersion: number
    source: {
        path: string
        sha256: string
        format: string
    }
    bundles: RootAssetBundleManifestEntry[]
}

function normalizeBundleName(value: string): string {
    return value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
}

function uniqueNormalized(values: readonly string[] | undefined): string[] | undefined {
    if (!values) return undefined
    const normalized = values
        .map(normalizeBundleName)
        .filter(Boolean)
    return [...new Set(normalized)]
}

function assertSha256(value: string | undefined, label: string) {
    if (value != undefined && !/^[0-9a-f]{64}$/i.test(value)) {
        throw new Error(`${label} must be a 64-character SHA-256 hex digest`)
    }
}

export function normalizeStageBundleProvenance(
    value: StageBundleProvenance,
): StageBundleProvenance {
    const normalized: StageBundleProvenance = {
        ...value,
        rootBundle: normalizeBundleName(value.rootBundle),
        manifest: {
            ...value.manifest,
            path: value.manifest.path?.replaceAll('\\', '/'),
            sha256: value.manifest.sha256?.toLowerCase(),
        },
        directDependencies: uniqueNormalized(value.directDependencies),
        dependencyClosure: uniqueNormalized(value.dependencyClosure),
        closureSha256: value.closureSha256?.toLowerCase(),
    }
    validateStageBundleProvenance(normalized)
    return normalized
}

export function validateStageBundleProvenance(
    value: StageBundleProvenance,
    expectedRootBundle?: string,
): void {
    const rootBundle = normalizeBundleName(value.rootBundle)
    if (!rootBundle) throw new Error('Stage bundle provenance rootBundle is empty')
    if (expectedRootBundle != undefined) {
        const expected = normalizeBundleName(expectedRootBundle)
        if (rootBundle !== expected) {
            throw new Error(
                `Stage bundle provenance root mismatch: ${rootBundle} != ${expected}`,
            )
        }
    }

    assertSha256(value.manifest.sha256, 'manifest.sha256')
    assertSha256(value.closureSha256, 'closureSha256')

    const direct = uniqueNormalized(value.directDependencies) ?? []
    const closure = uniqueNormalized(value.dependencyClosure) ?? []
    if (direct.includes(rootBundle) || closure.includes(rootBundle)) {
        throw new Error('Stage bundle dependency lists must exclude rootBundle')
    }
    const closureSet = new Set(closure)
    for (const dependency of direct) {
        if (closure.length > 0 && !closureSet.has(dependency)) {
            throw new Error(
                `Direct dependency ${dependency} is missing from dependencyClosure`,
            )
        }
    }
}

/**
 * Resolve a deterministic transitive dependency closure from the private
 * manifest index. The returned array excludes the root bundle and is sorted so
 * an exporter can hash/attest the exact staged input set reproducibly.
 */
export function resolveBundleDependencyClosure(
    index: RootAssetBundleManifestIndex,
    rootBundle: string,
): string[] {
    const graph = new Map<string, string[]>()
    for (const entry of index.bundles) {
        const name = normalizeBundleName(entry.name)
        if (!name || graph.has(name)) {
            throw new Error(`Invalid or duplicate AssetBundle manifest entry: ${entry.name}`)
        }
        graph.set(
            name,
            uniqueNormalized(entry.directDependencies) ?? [],
        )
    }

    const requested = normalizeBundleName(rootBundle)
    if (!graph.has(requested)) {
        throw new Error(`AssetBundle not present in manifest index: ${requested}`)
    }

    const visited = new Set<string>()
    const active = new Set<string>()
    const visit = (name: string) => {
        if (visited.has(name)) return
        if (active.has(name)) {
            throw new Error(`AssetBundle dependency cycle detected at ${name}`)
        }
        const dependencies = graph.get(name)
        if (!dependencies) {
            throw new Error(`Unknown AssetBundle dependency: ${name}`)
        }
        active.add(name)
        for (const dependency of dependencies) visit(dependency)
        active.delete(name)
        visited.add(name)
    }

    visit(requested)
    visited.delete(requested)
    return [...visited].sort((a, b) => a.localeCompare(b))
}
