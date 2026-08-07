export interface StageFidelityComponentEvidence {
    lightCount?: number
    reDriveVolumeCount?: number
    reflectionProbeCount?: number
    cameraCount?: number
    particleSystemCount?: number
    playableDirectorCount?: number
    animatorCount?: number
    animationClipCount?: number
    cinemachineCount?: number
    typetreeErrorCount?: number
}

export interface StageFidelityDefinition {
    id: string
    name: string
    category?: string
    official?: boolean
    assetBundleName?: string
    bundleProvenance?: {
        rootBundle: string
        manifest: {
            region: 'jp' | 'tw'
            kind: string
            path?: string
            sha256?: string
        }
        manifestSources?: Array<{
            region: 'jp' | 'tw'
            kind: string
            path?: string
            sha256?: string
        }>
        directDependencies?: string[]
        dependencyClosure?: string[]
        closureSha256?: string
    }
    renderProfile?: {
        source?: string
        lights?: unknown[]
        lightmap?: unknown
        reDriveVolume?: unknown
        environmentTextureUrl?: string
    }
    runtime?: {
        clipNames?: string[]
    }
    dynamic?: {
        expected: boolean
        status: 'recovered' | 'partial' | 'pending' | 'static'
        clipNames?: string[]
        missing?: string[]
        evidence?: string[]
    }
    fidelity?: {
        components?: StageFidelityComponentEvidence
        sourceRevision?: string
        generated?: boolean
    }
    evidence?: string[]
}

interface FidelityPanelState {
    row: HTMLDivElement
    details: HTMLDetailsElement
    summary: HTMLElement
    body: HTMLDivElement
}

let state: FidelityPanelState | undefined

function text(value: unknown, fallback = '—') {
    if (value == undefined || value === '') return fallback
    return String(value)
}

function shortDigest(value: string | undefined) {
    if (!value) return '—'
    return value.length > 20
        ? `${value.slice(0, 12)}…${value.slice(-8)}`
        : value
}

function addRow(container: HTMLElement, label: string, value: unknown) {
    const row = document.createElement('div')
    row.className = 'stage-fidelity-field'

    const key = document.createElement('span')
    key.className = 'stage-fidelity-key'
    key.textContent = label

    const content = document.createElement('span')
    content.className = 'stage-fidelity-value'
    content.textContent = text(value)

    row.append(key, content)
    container.append(row)
}

function addList(
    container: HTMLElement,
    title: string,
    values: readonly string[] | undefined,
    emptyText = 'None',
) {
    const section = document.createElement('section')
    section.className = 'stage-fidelity-section'

    const heading = document.createElement('div')
    heading.className = 'stage-fidelity-section-title'
    heading.textContent = title
    section.append(heading)

    if (!values || values.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'stage-fidelity-empty'
        empty.textContent = emptyText
        section.append(empty)
    } else {
        const list = document.createElement('ul')
        for (const value of values) {
            const item = document.createElement('li')
            item.textContent = value
            list.append(item)
        }
        section.append(list)
    }
    container.append(section)
}

function ensurePanel(): FidelityPanelState {
    if (state) return state

    const selector = document.getElementById('stage-selector') as HTMLSelectElement | null
    if (!selector) throw new Error('Stage fidelity panel requires #stage-selector')
    const selectorRow = selector.parentElement
    if (!selectorRow) throw new Error('Stage selector has no parent row')

    const row = document.createElement('div')
    row.id = 'stage-fidelity-row'

    const details = document.createElement('details')
    details.id = 'stage-fidelity-panel'

    const summary = document.createElement('summary')
    summary.textContent = 'Stage fidelity / evidence'
    summary.title = 'Inspect recovered scene provenance and remaining fidelity gaps'

    const body = document.createElement('div')
    body.id = 'stage-fidelity-body'

    details.append(summary, body)
    row.append(details)
    selectorRow.insertAdjacentElement('afterend', row)

    state = { row, details, summary, body }
    return state
}

function componentEvidence(
    definition: StageFidelityDefinition,
): StageFidelityComponentEvidence {
    const explicit = definition.fidelity?.components ?? {}
    return {
        ...explicit,
        lightCount:
            explicit.lightCount
            ?? definition.renderProfile?.lights?.length,
        animationClipCount:
            explicit.animationClipCount
            ?? definition.runtime?.clipNames?.length
            ?? definition.dynamic?.clipNames?.length,
    }
}

function componentSummary(value: StageFidelityComponentEvidence) {
    const parts: string[] = []
    const fields: Array<[keyof StageFidelityComponentEvidence, string]> = [
        ['lightCount', 'Light'],
        ['reDriveVolumeCount', 'ReDriveVolume'],
        ['reflectionProbeCount', 'Probe'],
        ['cameraCount', 'Camera'],
        ['particleSystemCount', 'Particle'],
        ['playableDirectorCount', 'Timeline'],
        ['animatorCount', 'Animator'],
        ['animationClipCount', 'Clip'],
        ['cinemachineCount', 'Cinemachine'],
    ]
    for (const [key, label] of fields) {
        const count = value[key]
        if (count != undefined && count > 0) parts.push(`${label} ${count}`)
    }
    return parts.length > 0 ? parts.join(' · ') : '—'
}

export function setupStageFidelityPanel() {
    ensurePanel()
}

export function updateStageFidelityPanel(
    definition: StageFidelityDefinition | undefined,
) {
    const panel = ensurePanel()
    panel.body.replaceChildren()

    if (!definition) {
        panel.row.style.display = 'none'
        return
    }
    panel.row.style.removeProperty('display')

    const provenance = definition.bundleProvenance
    const manifests = provenance?.manifestSources?.length
        ? provenance.manifestSources
        : provenance?.manifest
            ? [provenance.manifest]
            : []
    const components = componentEvidence(definition)
    const directCount = provenance?.directDependencies?.length ?? 0
    const closureCount = provenance?.dependencyClosure?.length ?? 0
    const status = definition.dynamic?.status ?? (
        definition.official ? 'unspecified' : 'research'
    )

    panel.summary.textContent = `Stage fidelity / evidence — ${status}`
    panel.details.dataset.status = status

    const overview = document.createElement('div')
    overview.className = 'stage-fidelity-grid'
    addRow(overview, 'Stage ID', definition.id)
    addRow(overview, 'Category', definition.category ?? 'research')
    addRow(overview, 'Official asset', definition.official ? 'Yes' : 'No')
    addRow(overview, 'Dynamic status', status)
    addRow(overview, 'Region', provenance?.manifest.region?.toUpperCase())
    addRow(overview, 'AssetBundle', definition.assetBundleName ?? provenance?.rootBundle)
    addRow(overview, 'Manifest sources', manifests.length || undefined)
    addRow(overview, 'Direct dependencies', directCount)
    addRow(overview, 'Dependency closure', provenance ? `${closureCount + 1} bundles incl. root` : undefined)
    addRow(overview, 'Closure SHA-256', shortDigest(provenance?.closureSha256))
    addRow(overview, 'Render profile', definition.renderProfile?.source)
    addRow(overview, 'Recovered components', componentSummary(components))
    addRow(overview, 'Lightmap', definition.renderProfile?.lightmap ? 'Yes' : 'No')
    addRow(overview, 'Environment map', definition.renderProfile?.environmentTextureUrl ? 'Yes' : 'No')
    addRow(overview, 'Runtime clips', definition.runtime?.clipNames?.length ?? definition.dynamic?.clipNames?.length)
    addRow(overview, 'Typetree errors', components.typetreeErrorCount)
    panel.body.append(overview)

    if (manifests.length > 0) {
        addList(
            panel.body,
            'Manifest provenance',
            manifests.map((manifest, index) => {
                const source = manifest.path ?? manifest.kind
                return `${index + 1}. ${manifest.region.toUpperCase()} · ${source} · ${shortDigest(manifest.sha256)}`
            }),
        )
    }

    addList(
        panel.body,
        'Remaining fidelity gaps',
        definition.dynamic?.missing,
        definition.dynamic?.status === 'recovered'
            ? 'No declared dynamic gaps'
            : 'No structured gap list',
    )

    const evidence = [
        ...(definition.dynamic?.evidence ?? []),
        ...(definition.evidence ?? []),
    ]
    addList(panel.body, 'Recovered evidence', evidence, 'No evidence attached')
}
