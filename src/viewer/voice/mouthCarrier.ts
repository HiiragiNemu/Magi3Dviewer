import type * as THREE from 'three'
import { createVoicePoseWriteGuard } from './poseChannels.ts'

export type MouthCarrierKind =
    | 'morph-open'
    | 'paired-expression'
    | 'bone-field'
    | 'none'

export interface MouthCarrierDiagnostics {
    kind: MouthCarrierKind
    bindings: readonly string[]
    reason: string | null
}

export interface VoiceMouthBoneDescriptor {
    kind: 'bone'
    objectPath: string
    channel: 'position' | 'rotation' | 'scale'
    axis: 'x' | 'y' | 'z'
    closedValue: number
    openValue: number
}

export interface ResolvedMouthCarrier {
    readonly kind: MouthCarrierKind
    readonly diagnostics: MouthCarrierDiagnostics
    getBaseMouthForm(): number
    setOfficialPlaying(playing: boolean): void
    setDrive(mouthOpen: number, mouthForm: number): void
    close(): void
}

interface MorphMesh extends THREE.Mesh {
    morphTargetDictionary: Record<string, number>
    morphTargetInfluences: number[]
}

interface ScalarVector {
    x: number
    y: number
    z: number
}

const DEMO_OPEN_CONTRIBUTION_WEIGHT = 0.8
const OFFICIAL_BINARY_OPEN_VALUE = 0.5
const EXTERNAL_WRITE_EPSILON = 1e-7

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function isMorphMesh(object: THREE.Object3D): object is MorphMesh {
    const mesh = object as Partial<MorphMesh>
    return !!mesh.morphTargetDictionary && Array.isArray(mesh.morphTargetInfluences)
}

class MorphBinding {
    readonly mesh: MorphMesh
    readonly name: string
    readonly index: number
    private baseline: number
    private lastApplied: number | null = null
    private readonly poseGuard: ReturnType<typeof createVoicePoseWriteGuard>
    private poseRevision = 0

    constructor(root: THREE.Object3D, mesh: MorphMesh, name: string, index: number) {
        this.poseGuard = createVoicePoseWriteGuard(root, mesh, index)
        this.poseRevision = this.poseGuard.revision()
        this.mesh = mesh
        this.name = name
        this.index = index
        this.baseline = clamp01(mesh.morphTargetInfluences[index] ?? 0)
    }

    get key(): string {
        return `${this.mesh.name || this.mesh.type}:${this.name}`
    }

    readBaseline(): number {
        const revision = this.poseGuard.revision()
        if (revision !== this.poseRevision) { this.lastApplied = null; this.poseRevision = revision }
        const current = clamp01(this.mesh.morphTargetInfluences[this.index] ?? 0)
        if (
            this.lastApplied === null
            || Math.abs(current - this.lastApplied) > EXTERNAL_WRITE_EPSILON
        ) {
            this.baseline = current
        }
        return this.baseline
    }

    apply(value: number): void {
        if (!this.poseGuard.allowed()) { this.lastApplied = null; return }
        this.readBaseline()
        const next = clamp01(value)
        this.mesh.morphTargetInfluences[this.index] = next
        this.lastApplied = next
    }

    restore(): void {
        if (!this.poseGuard.allowed()) { this.lastApplied = null; return }
        this.readBaseline()
        this.mesh.morphTargetInfluences[this.index] = this.baseline
        this.lastApplied = null
    }
}

class MorphOpenCarrier implements ResolvedMouthCarrier {
    readonly kind = 'morph-open' as const
    readonly diagnostics: MouthCarrierDiagnostics
    private readonly openBindings: readonly MorphBinding[]
    private readonly wideBindings: readonly MorphBinding[]
    private readonly narrowBindings: readonly MorphBinding[]

    constructor(
        openBindings: readonly MorphBinding[],
        wideBindings: readonly MorphBinding[],
        narrowBindings: readonly MorphBinding[],
    ) {
        this.openBindings = openBindings
        this.wideBindings = wideBindings
        this.narrowBindings = narrowBindings
        this.diagnostics = {
            kind: this.kind,
            bindings: [
                ...openBindings.map(binding => `open:${binding.key}`),
                ...wideBindings.map(binding => `wide:${binding.key}`),
                ...narrowBindings.map(binding => `narrow:${binding.key}`),
            ],
            reason: null,
        }
    }

    getBaseMouthForm(): number {
        const wide = this.wideBindings.map(binding => binding.readBaseline())
        const narrow = this.narrowBindings.map(binding => binding.readBaseline())
        const wideMean = wide.length === 0
            ? 0
            : wide.reduce((sum, value) => sum + value, 0) / wide.length
        const narrowMean = narrow.length === 0
            ? 0
            : narrow.reduce((sum, value) => sum + value, 0) / narrow.length
        return wideMean - narrowMean
    }

    setOfficialPlaying(playing: boolean): void {
        if (!playing) {
            this.close()
            return
        }
        this.setDrive(OFFICIAL_BINARY_OPEN_VALUE, this.getBaseMouthForm())
    }

    setDrive(mouthOpen: number, mouthForm: number): void {
        const open = clamp01(mouthOpen)
        for (const binding of this.openBindings) {
            const baseline = binding.readBaseline()
            binding.apply(
                baseline + open * DEMO_OPEN_CONTRIBUTION_WEIGHT * (1 - baseline),
            )
        }

        const baseForm = this.getBaseMouthForm()
        const formDelta = Number.isFinite(mouthForm) ? mouthForm - baseForm : 0
        for (const binding of this.wideBindings) {
            const baseline = binding.readBaseline()
            binding.apply(baseline + Math.max(0, formDelta))
        }
        for (const binding of this.narrowBindings) {
            const baseline = binding.readBaseline()
            binding.apply(baseline + Math.max(0, -formDelta))
        }
    }

    close(): void {
        for (const binding of [
            ...this.openBindings,
            ...this.wideBindings,
            ...this.narrowBindings,
        ]) {
            binding.restore()
        }
    }
}

interface MorphPair {
    open: MorphBinding
    closed: MorphBinding
}

class PairedExpressionCarrier implements ResolvedMouthCarrier {
    readonly kind = 'paired-expression' as const
    readonly diagnostics: MouthCarrierDiagnostics
    private readonly pairs: readonly MorphPair[]
    private readonly zeroBaseFallbackPairs: ReadonlySet<MorphPair>

    constructor(pairs: readonly MorphPair[]) {
        this.pairs = pairs
        const byMesh = new Map<MorphMesh, MorphPair[]>()
        for (const pair of pairs) {
            const meshPairs = byMesh.get(pair.open.mesh) ?? []
            meshPairs.push(pair)
            byMesh.set(pair.open.mesh, meshPairs)
        }
        this.zeroBaseFallbackPairs = new Set(
            [...byMesh.values()].map(meshPairs => [...meshPairs].sort((left, right) => (
                pairedExpressionRank(left.open.name) - pairedExpressionRank(right.open.name)
                || left.open.name.localeCompare(right.open.name)
            ))[0]).filter((pair): pair is MorphPair => !!pair),
        )
        this.diagnostics = {
            kind: this.kind,
            bindings: pairs.flatMap(pair => [
                `open:${pair.open.key}`,
                `closed:${pair.closed.key}`,
            ]),
            reason: null,
        }
    }

    getBaseMouthForm(): number {
        return 0
    }

    setOfficialPlaying(playing: boolean): void {
        if (!playing) {
            this.close()
            return
        }
        this.setDrive(1, 0)
    }

    setDrive(mouthOpen: number, _mouthForm: number): void {
        const openAmount = clamp01(mouthOpen)
        for (const pair of this.pairs) {
            const openBaseline = pair.open.readBaseline()
            const closedBaseline = pair.closed.readBaseline()
            let activity = clamp01(openBaseline + closedBaseline)
            if (
                activity <= EXTERNAL_WRITE_EPSILON
                && this.zeroBaseFallbackPairs.has(pair)
            ) {
                activity = 1
            }
            if (activity <= EXTERNAL_WRITE_EPSILON) continue
            pair.open.apply(activity * openAmount)
            pair.closed.apply(activity * (1 - openAmount))
        }
    }

    close(): void {
        for (const pair of this.pairs) {
            pair.open.restore()
            pair.closed.restore()
        }
    }
}

function pairedExpressionRank(name: string): number {
    const expression = name.replace(/^Mouth_(?:L|R|Side)_/i, '').toLowerCase()
    if (expression === 'normal' || expression === 'wait') return 0
    if (expression === 'smilethinly') return 1
    if (expression === 'smile') return 2
    if (expression === 'serious') return 3
    return 10
}

class ScalarBinding {
    private baseline: number
    private lastApplied: number | null = null
    private readonly poseGuard: ReturnType<typeof createVoicePoseWriteGuard>
    private poseRevision = 0
    private readonly vector: ScalarVector
    private readonly axis: 'x' | 'y' | 'z'

    constructor(
        root: THREE.Object3D,
        object: THREE.Object3D,
        channel: VoiceMouthBoneDescriptor['channel'],
        vector: ScalarVector,
        axis: 'x' | 'y' | 'z',
    ) {
        const guard = createVoicePoseWriteGuard(root, object)
        this.poseGuard = { ...guard, allowed: () => object[channel] === vector && guard.allowed() }
        this.poseRevision = this.poseGuard.revision()
        this.vector = vector
        this.axis = axis
        this.baseline = vector[axis]
    }

    readBaseline(): number {
        const revision = this.poseGuard.revision()
        if (revision !== this.poseRevision) { this.lastApplied = null; this.poseRevision = revision }
        const current = this.vector[this.axis]
        if (
            this.lastApplied === null
            || Math.abs(current - this.lastApplied) > EXTERNAL_WRITE_EPSILON
        ) {
            this.baseline = current
        }
        return this.baseline
    }

    apply(value: number): void {
        if (!this.poseGuard.allowed()) { this.lastApplied = null; return }
        this.readBaseline()
        this.vector[this.axis] = value
        this.lastApplied = value
    }

    restore(): void {
        if (!this.poseGuard.allowed()) { this.lastApplied = null; return }
        this.readBaseline()
        this.vector[this.axis] = this.baseline
        this.lastApplied = null
    }
}

class BoneFieldCarrier implements ResolvedMouthCarrier {
    readonly kind = 'bone-field' as const
    readonly diagnostics: MouthCarrierDiagnostics
    private readonly delta: number
    private readonly binding: ScalarBinding

    constructor(
        binding: ScalarBinding,
        descriptor: VoiceMouthBoneDescriptor,
    ) {
        this.binding = binding
        this.delta = descriptor.openValue - descriptor.closedValue
        this.diagnostics = {
            kind: this.kind,
            bindings: [
                `${descriptor.objectPath}.${descriptor.channel}.${descriptor.axis}`,
            ],
            reason: null,
        }
    }

    getBaseMouthForm(): number {
        return 0
    }

    setOfficialPlaying(playing: boolean): void {
        if (!playing) {
            this.close()
            return
        }
        this.setDrive(1, 0)
    }

    setDrive(mouthOpen: number, _mouthForm: number): void {
        const baseline = this.binding.readBaseline()
        this.binding.apply(baseline + this.delta * clamp01(mouthOpen))
    }

    close(): void {
        this.binding.restore()
    }
}

class NoMouthCarrier implements ResolvedMouthCarrier {
    readonly kind = 'none' as const
    readonly diagnostics: MouthCarrierDiagnostics

    constructor(reason: string) {
        this.diagnostics = { kind: this.kind, bindings: [], reason }
    }

    getBaseMouthForm(): number {
        return 0
    }

    setOfficialPlaying(_playing: boolean): void {}

    setDrive(_mouthOpen: number, _mouthForm: number): void {}

    close(): void {}
}

function objectPath(root: THREE.Object3D, object: THREE.Object3D): string {
    const names: string[] = []
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
        names.unshift(current.name || current.type)
        if (current === root) break
    }
    return names.join('/')
}

function parseBoneDescriptor(value: unknown): VoiceMouthBoneDescriptor | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const descriptor = value as Partial<VoiceMouthBoneDescriptor>
    if (
        descriptor.kind !== 'bone'
        || typeof descriptor.objectPath !== 'string'
        || !['position', 'rotation', 'scale'].includes(descriptor.channel ?? '')
        || !['x', 'y', 'z'].includes(descriptor.axis ?? '')
        || typeof descriptor.closedValue !== 'number'
        || !Number.isFinite(descriptor.closedValue)
        || typeof descriptor.openValue !== 'number'
        || !Number.isFinite(descriptor.openValue)
    ) return null
    return descriptor as VoiceMouthBoneDescriptor
}

function resolveBoneCarrier(root: THREE.Object3D): ResolvedMouthCarrier | null {
    const descriptor = parseBoneDescriptor(root.userData.voiceMouthCarrier)
    if (!descriptor) return null
    const matches: THREE.Object3D[] = []
    root.traverse(object => {
        const path = objectPath(root, object)
        const pathWithoutRoot = path.split('/').slice(1).join('/')
        if (path === descriptor.objectPath || pathWithoutRoot === descriptor.objectPath) {
            matches.push(object)
        }
    })
    if (matches.length !== 1) {
        return new NoMouthCarrier(
            `bone descriptor path resolved ${matches.length} objects: ${descriptor.objectPath}`,
        )
    }
    const object = matches[0]
    if (!object) return new NoMouthCarrier('bone descriptor object is missing')
    const vector = object[descriptor.channel] as ScalarVector
    return new BoneFieldCarrier(new ScalarBinding(root, object, descriptor.channel, vector, descriptor.axis), descriptor)
}

function openRank(name: string): number | null {
    if (/(?:^|\.)Mouth_OpenVertically$/i.test(name)) return 0
    if (/^Mouth_Open$/i.test(name)) return 1
    if (/^Mouth_Open_Big$/i.test(name)) return 2
    return null
}

function resolveMorphOpenCarrier(root: THREE.Object3D): ResolvedMouthCarrier | null {
    const openBindings: MorphBinding[] = []
    const wideBindings: MorphBinding[] = []
    const narrowBindings: MorphBinding[] = []
    root.traverse(object => {
        if (!isMorphMesh(object)) return
        const openCandidates = Object.entries(object.morphTargetDictionary)
            .map(([name, index]) => ({ name, index, rank: openRank(name) }))
            .filter((value): value is { name: string; index: number; rank: number } => (
                value.rank !== null
            ))
            .sort((left, right) => left.rank - right.rank)
        const selectedOpen = openCandidates[0]
        if (selectedOpen) {
            openBindings.push(new MorphBinding(root, object, selectedOpen.name, selectedOpen.index))
        }
        for (const [name, index] of Object.entries(object.morphTargetDictionary)) {
            if (/^Mouth_Wide$/i.test(name)) {
                wideBindings.push(new MorphBinding(root, object, name, index))
            } else if (/^Mouth_Narrow$/i.test(name)) {
                narrowBindings.push(new MorphBinding(root, object, name, index))
            }
        }
    })
    if (openBindings.length === 0) return null
    return new MorphOpenCarrier(openBindings, wideBindings, narrowBindings)
}

function resolvePairedExpressionCarrier(root: THREE.Object3D): ResolvedMouthCarrier | null {
    const pairs: MorphPair[] = []
    root.traverse(object => {
        if (!isMorphMesh(object)) return
        const byPair = new Map<string, { open?: MorphBinding; closed?: MorphBinding }>()
        for (const [name, index] of Object.entries(object.morphTargetDictionary)) {
            const match = /^(Mouth_(?:L|R|Side)_)(Close_)?(.+)$/i.exec(name)
            if (!match) continue
            const prefix = match[1]
            const closedPrefix = match[2]
            const expression = match[3]
            if (!prefix || !expression || /^(?:Mesh|MeshBlendShape)$/i.test(expression)) continue
            const key = `${prefix}${expression}`.toLowerCase()
            const pair = byPair.get(key) ?? {}
            const binding = new MorphBinding(root, object, name, index)
            if (closedPrefix) pair.closed = binding
            else pair.open = binding
            byPair.set(key, pair)
        }
        for (const pair of byPair.values()) {
            if (pair.open && pair.closed) pairs.push({ open: pair.open, closed: pair.closed })
        }
    })
    return pairs.length === 0 ? null : new PairedExpressionCarrier(pairs)
}

export function resolveMouthCarrier(root: THREE.Object3D): ResolvedMouthCarrier {
    const boneCarrier = resolveBoneCarrier(root)
    if (boneCarrier) return boneCarrier
    const morphCarrier = resolveMorphOpenCarrier(root)
    if (morphCarrier) return morphCarrier
    const pairedCarrier = resolvePairedExpressionCarrier(root)
    if (pairedCarrier) return pairedCarrier
    return new NoMouthCarrier(
        'no exact open morph, paired mouth expression, or field-defined bone carrier',
    )
}
