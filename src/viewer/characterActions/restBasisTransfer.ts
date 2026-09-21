/**
 * Declarative G22 rest-basis transfer.
 *
 * This module is intentionally data-only: it composes the sealed 24-track
 * source basis with six authored helper channels. Mixer ownership, native
 * physics scheduling, and render writes stay with their existing consumers.
 */

export type RestBasisSemantic = 'idle' | 'walk' | 'run'
export type RestBasisTarget = '101901' | '100304'

export interface RestBasisTrack {
    name: string
    times: readonly number[]
    values: readonly number[]
    type: string
    [key: string]: unknown
}

export interface RestBasisClip {
    name?: string
    duration: number
    tracks: readonly RestBasisTrack[]
    [key: string]: unknown
}

export interface RestBasisDeclaration {
    role: string
    property: 'quaternion'
    relativePath?: string
    sourcePath: string
    sourceBindingId: string
    targetPath: string
    targetModelId: string
}

export interface RestBasisHelperClip {
    clip: RestBasisClip
    declarations: readonly RestBasisDeclaration[]
    sourceClipPathId: string
    semantic: RestBasisSemantic
    sourceResourceId: '100201'
    targetResourceId: RestBasisTarget
}

export interface RestBasisWritableSnapshot {
    status: 'ready' | string
    rootIdentity: string
}

export interface RestBasisTransferInput {
    sourceResourceId: '100201'
    targetResourceId: RestBasisTarget
    semantic: RestBasisSemantic
    sourceClipPathId: string
    modelKey: string
    modelRootName: string
    writableSnapshot: RestBasisWritableSnapshot
    coreClip: RestBasisClip
    helper: RestBasisHelperClip
}

export interface RestBasisBinding {
    declaration: RestBasisDeclaration
    track: RestBasisTrack
}

export interface RestBasisTransfer {
    schema: 'magius.g22.rest-basis-transfer.v1'
    sourceResourceId: '100201'
    targetResourceId: RestBasisTarget
    semantic: RestBasisSemantic
    sourceClipPathId: string
    modelKey: string
    modelRootName: string
    clip: RestBasisClip
    helperBindings: readonly RestBasisBinding[]
    trackCount: 30
    coreTrackCount: 24
    helperTrackCount: 6
    nativePhysicsPolicy: 'retain-target-native-post-mixer'
    integrationMode: 'declarative-transfer-only'
}

const HELPER_ROLES = [
    {
        role: 'explicit-helper:Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/ArmBend_L',
        relativePath: 'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/ArmBend_L',
        sourceBindingId: '975d658a-2941-4b39-aa0c-dac629161bea',
    },
    {
        role: 'explicit-helper:Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/ArmTwist_L',
        relativePath: 'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/ArmTwist_L',
        sourceBindingId: 'f5644770-914b-472e-a4e5-11ec77b9947e',
    },
    {
        role: 'explicit-helper:Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L/Wrist_L',
        relativePath: 'Root/Hip/Spine/Waist/Chest/Shoulder_L/Arm_L/Forearm_L/Wrist_L',
        sourceBindingId: '80bc9f34-2b4a-4881-ab18-a483646b12b0',
    },
    {
        role: 'explicit-helper:Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/ArmBend_R',
        relativePath: 'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/ArmBend_R',
        sourceBindingId: '604e72dc-ab6f-43d7-aab5-d5fe321d14b0',
    },
    {
        role: 'explicit-helper:Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/ArmTwist_R',
        relativePath: 'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/ArmTwist_R',
        sourceBindingId: '175f0496-48bd-453e-8741-1d6cea9589a7',
    },
    {
        role: 'explicit-helper:Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R/Wrist_R',
        relativePath: 'Root/Hip/Spine/Waist/Chest/Shoulder_R/Arm_R/Forearm_R/Wrist_R',
        sourceBindingId: '77eda2fc-b51e-4f31-9109-b444a447dea7',
    },
] as const

const TARGET_MODEL_IDS: Record<RestBasisTarget, readonly string[]> = {
    '101901': [
        '2192624816272', '2192624818272', '2192625007472',
        '2192625015472', '2192625009472', '2192625341312',
    ],
    '100304': [
        '2512601346704', '2512601358704', '2512566135200',
        '2512566163200', '2512566169200', '2512601656080',
    ],
}

export const REST_BASIS_HELPER_ROLES = Object.freeze(HELPER_ROLES.map(role => ({ ...role })))

function fail(message: string): never {
    throw new Error(`G22_REST_BASIS_INVALID:${message}`)
}

function cloneTrack(track: RestBasisTrack): RestBasisTrack {
    return {
        ...track,
        times: [...track.times],
        values: [...track.values],
    }
}

function cloneClip(clip: RestBasisClip): RestBasisClip {
    return {
        ...clip,
        tracks: clip.tracks.map(cloneTrack),
    }
}

function assertFiniteTrack(track: RestBasisTrack, label: string): void {
    if (!track || typeof track.name !== 'string' || !track.name) fail(`${label}:track-name`)
    if (!Array.isArray(track.times) || !Array.isArray(track.values) || typeof track.type !== 'string') {
        fail(`${label}:${track.name}:shape`)
    }
    if (track.values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
        fail(`${label}:${track.name}:non-finite`)
    }
    if (track.times.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
        fail(`${label}:${track.name}:non-finite-time`)
    }
}

function assertUniqueTrackNames(tracks: readonly RestBasisTrack[], label: string): void {
    const names = new Set<string>()
    for (const track of tracks) {
        assertFiniteTrack(track, label)
        if (names.has(track.name)) fail(`${label}:duplicate:${track.name}`)
        names.add(track.name)
    }
}

/** Build one composed basis without writing a mixer or native channel. */
export function buildRestBasisTransfer(input: RestBasisTransferInput): RestBasisTransfer {
    if (input.sourceResourceId !== '100201') fail('source-resource')
    if (input.targetResourceId !== '101901' && input.targetResourceId !== '100304') fail('target-resource')
    if (!['idle', 'walk', 'run'].includes(input.semantic)) fail('semantic')
    if (input.writableSnapshot.status !== 'ready') fail('writable-channel-not-ready')
    if (input.writableSnapshot.rootIdentity !== input.modelKey) fail('root-identity')
    if (!input.modelKey || !input.modelRootName) fail('model-identity')
    if (!input.coreClip || input.coreClip.duration <= 0 || input.coreClip.tracks.length !== 24) {
        fail('core-track-count')
    }
    assertUniqueTrackNames(input.coreClip.tracks, 'core')
    if (input.helper.sourceResourceId !== input.sourceResourceId
        || input.helper.targetResourceId !== input.targetResourceId
        || input.helper.semantic !== input.semantic
        || input.helper.sourceClipPathId !== input.sourceClipPathId) {
        fail('helper-lineage')
    }
    if (input.helper.clip.duration !== input.coreClip.duration) {
        fail('idle-duration-mismatch')
    }
    const helperTracks = input.helper.clip.tracks
    if (helperTracks.length !== 6 || input.helper.declarations.length !== 6) fail('helper-track-count')
    assertUniqueTrackNames(helperTracks, 'helper')
    const coreNames = new Set(input.coreClip.tracks.map(track => track.name))
    const helperNames = new Set<string>()
    const expectedIds = TARGET_MODEL_IDS[input.targetResourceId]
    const helperBindings: RestBasisBinding[] = []
    for (let i = 0; i < 6; i += 1) {
        const declaration = input.helper.declarations[i]
        const role = HELPER_ROLES[i]
        if (!declaration || declaration.property !== 'quaternion'
            || declaration.role !== role.role
            || (declaration.relativePath ?? declaration.targetPath.split('/').slice(-role.relativePath.split('/').length).join('/')) !== role.relativePath
            || declaration.sourceBindingId !== role.sourceBindingId) {
            fail(`helper-declaration:${i}`)
        }
        if (declaration.targetModelId !== expectedIds[i]) fail(`target-model-id:${i}`)
        const expectedPrefix = `${input.modelKey}/VisualRoot/${input.modelRootName}/`
        if (!declaration.targetPath.startsWith(expectedPrefix)
            || !declaration.targetPath.endsWith(`/${role.relativePath}`)) {
            fail(`target-path:${i}`)
        }
        const track = helperTracks[i]
        if (coreNames.has(track.name) || helperNames.has(track.name)) fail(`binding-collision:${track.name}`)
        helperNames.add(track.name)
        helperBindings.push({ declaration: { ...declaration }, track: cloneTrack(track) })
    }
    const clip = cloneClip(input.coreClip)
    clip.tracks = [...clip.tracks.map(cloneTrack), ...helperBindings.map(binding => cloneTrack(binding.track))]
    return {
        schema: 'magius.g22.rest-basis-transfer.v1',
        sourceResourceId: input.sourceResourceId,
        targetResourceId: input.targetResourceId,
        semantic: input.semantic,
        sourceClipPathId: input.sourceClipPathId,
        modelKey: input.modelKey,
        modelRootName: input.modelRootName,
        clip,
        helperBindings,
        trackCount: 30,
        coreTrackCount: 24,
        helperTrackCount: 6,
        nativePhysicsPolicy: 'retain-target-native-post-mixer',
        integrationMode: 'declarative-transfer-only',
    }
}

export function helperDeclarationFor(
    targetResourceId: RestBasisTarget,
    modelKey: string,
    modelRootName: string,
    index: number,
): Pick<RestBasisDeclaration, 'role' | 'relativePath' | 'sourceBindingId' | 'targetPath' | 'targetModelId' | 'property'> {
    if (index < 0 || index >= HELPER_ROLES.length) fail('helper-index')
    const role = HELPER_ROLES[index]
    return {
        ...role,
        property: 'quaternion',
        targetPath: `${modelKey}/VisualRoot/${modelRootName}/${role.relativePath}`,
        targetModelId: TARGET_MODEL_IDS[targetResourceId][index],
    }
}
