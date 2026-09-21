import { installNonBattleExpressions } from './nonBattleExpressionRuntime.ts'
import * as THREE from 'three'
import type MagiaExedraCharacter3D from './character.ts'
import type { LoadCharacterCallbacks } from './loader.ts'
import {
    characterAssetLoadError,
    throwIfCharacterLoadAborted,
} from './utils.ts'
import type { NonBattleCharacterCatalogEntry } from './nonBattleCharacterCatalog.ts'

interface SerializedTransform {
    position: readonly [number, number, number]
    quaternion: readonly [number, number, number, number]
    scale: readonly [number, number, number]
}

interface NonBattleRendererContract {
    hierarchyPath: string
    meshName: string
    rendererPathId: string
    meshPathId: string
    expandedIndexCount: number
    boneCount: number
    bindPoseCount: number
}

interface NonBattleRendererTextureBinding {
    meshName: string
    sourceMaterialPathId: string
    sourceMaterialName: string
    sourceTextureStem: string
    projectedTextureStem: string
    requiredTextureKinds: readonly ['color', 'shadow', 'ctrl']
    policy: 'project-authority-material-texture-set'
}

interface NonBattleControllerClip {
    pathId: string
    name: string
    durationSeconds: number
    sampleRate: number
}

interface NonBattleNativeTransformClosure {
    stableKey: string
    path: string
    aliases: readonly string[]
    sourceExpected: SerializedTransform
    target: SerializedTransform
    renameTo?: string
    policy: string
}

interface NonBattleSkinBindPoseClosure {
    stableKey: string
    policy: 'postmultiply-exported-inverses-by-authored-outer-viewer-matrix'
    anchorRendererPath: string
    anchorBoneName: string
    sourceAnchorInverse: readonly number[]
    targetAnchorInverse: readonly number[]
}

interface NonBattleEffectReference {
    stableKey: string
    productFileName: string
    rootPath: string
    helperPath: string
    playOnAwake: boolean
    expectedParticleSystems: number
}

export interface NonBattleCharacterPhysicsContract {
    attachment: 'required'
    writerPolicy: 'existing-character-physics-single-writer'
    profileStableKey: string
    productUrl: string
    expectedClothComponentStableKeys: readonly string[]
    expectedPlaneColliderStableKey?: string
    expectedClothTeams: number
    expectedMagicaColliders: number
    expectedNativeColliderStableKeys?: readonly string[]
    expectedNativeColliders?: number
}

export interface NonBattleCharacterProfile {
    schema: 'magius.nonbattle-character-profile.v1'
    stableKey: string
    identity: {
        identityKey: string
        style3dCharacterMstId: number
        resourceName: string
        canonicalName: string
        alias: string
    }
    classification: {
        sourceFamily: 'story-cutscene'
        ordinaryCharacterSelector: false
        battle: false
        tps: false
        dungeon: false
        magicalGirl: false
    }
    publication: {
        status: 'new-candidate' | 'runtime-ready'
        technicalStatus: 'runtime-ready'
        userAcceptance: 'pending' | 'accepted'
        failClosedReasons: readonly string[]
    }
    model: {
        outerRootPath: string
        neutralRenderRootPath: string
        authoredOuterPlacement: {
            unity: SerializedTransform
            viewer: SerializedTransform
        }
        viewerPlacement: SerializedTransform
        renderers: readonly NonBattleRendererContract[]
        rendererTextureBindings?: readonly NonBattleRendererTextureBinding[]
        nativeTransformClosures?: readonly NonBattleNativeTransformClosure[]
        skinBindPoseClosure?: NonBattleSkinBindPoseClosure
    }
    storyController: {
        activeControllerPathId: string
        name: string
        defaultAction: string
        clipCount: number
        clips: readonly NonBattleControllerClip[]
    }
    effects?: readonly NonBattleEffectReference[]
    physics?: NonBattleCharacterPhysicsContract
}

export interface NonBattleCharacterEffectRuntime {
    stableKey: string
    object: THREE.InstancedMesh
    activeParticles: number
    emittedParticles: number
    step(deltaSeconds: number): void
    dispose(): void
}

export interface NonBattleCharacterRuntimeMetadata {
    stableKey: string
    identityKey: string
    sourceFamily: 'story-cutscene'
    profileUrl: string
    publicationStatus: NonBattleCharacterProfile['publication']['status']
    presentationRoot: THREE.Object3D
    presentationRootPath: string
    storyController: NonBattleCharacterProfile['storyController']
    rendererTextureBindings: readonly NonBattleRendererTextureBinding[]
    effects: NonBattleCharacterEffectRuntime[]
    physics?: NonBattleCharacterPhysicsContract
    scenarioInstance: {
        authoredOuterPlacement: NonBattleCharacterProfile['model']['authoredOuterPlacement']
        appliedToViewerRoot: false
    }
}

interface RuntimeCharacterUserData {
    characterId: number
    meshes: THREE.Mesh[]
    animationLoops: Function[]
    disposeCallbacks: Array<() => void>
    nonBattleCharacter?: NonBattleCharacterRuntimeMetadata
}

type BaseCharacterLoader = (
    files: Record<string, string>,
    callbacks?: Partial<LoadCharacterCallbacks>,
) => Promise<MagiaExedraCharacter3D>
type CharacterProfileFetcher = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Response>

export interface NonBattleCharacterLoadDependencies {
    baseLoader?: BaseCharacterLoader
    fetcher?: CharacterProfileFetcher
}

function resolveProfileUrl(profileUrl: string): string {
    if (/^[a-z][a-z0-9+.-]*:/i.test(profileUrl)) return profileUrl
    if (typeof document !== 'undefined' && document.baseURI) {
        return new URL(profileUrl, document.baseURI).href
    }
    if (typeof location !== 'undefined') return new URL(profileUrl, location.href).href
    return profileUrl
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object`)
    }
    return value as Record<string, unknown>
}

function parseProfile(
    value: unknown,
    entry: NonBattleCharacterCatalogEntry,
): NonBattleCharacterProfile {
    const profile = requireObject(value, 'nonbattle profile')
    const identity = requireObject(profile.identity, 'nonbattle profile identity')
    const classification = requireObject(
        profile.classification,
        'nonbattle profile classification',
    )
    const publication = requireObject(profile.publication, 'nonbattle profile publication')
    const model = requireObject(profile.model, 'nonbattle profile model')
    const controller = requireObject(
        profile.storyController,
        'nonbattle profile story controller',
    )
    const physics = profile.physics === undefined
        ? undefined
        : requireObject(profile.physics, 'nonbattle profile physics')
    if (profile.schema !== 'magius.nonbattle-character-profile.v1') {
        throw new Error(`Unexpected nonbattle profile schema: ${String(profile.schema)}`)
    }
    if (
        profile.stableKey !== entry.stableKey
        || identity.identityKey !== entry.identityKey
        || identity.style3dCharacterMstId !== entry.style3dCharacterMstId
        || identity.resourceName !== entry.resourceName
    ) {
        throw new Error(`Nonbattle profile identity mismatch: ${entry.stableKey}`)
    }
    if (
        classification.sourceFamily !== 'story-cutscene'
        || classification.ordinaryCharacterSelector !== false
        || classification.battle !== false
        || classification.tps !== false
        || classification.dungeon !== false
        || classification.magicalGirl !== false
    ) {
        throw new Error(`Nonbattle eligibility mismatch: ${entry.stableKey}`)
    }
    if (
        publication.technicalStatus !== 'runtime-ready'
        || !Array.isArray(publication.failClosedReasons)
        || publication.failClosedReasons.length !== 0
    ) {
        throw new Error(`Nonbattle profile is not technically runtime-ready: ${entry.stableKey}`)
    }
    if (
        typeof model.outerRootPath !== 'string'
        || typeof model.neutralRenderRootPath !== 'string'
        || !Array.isArray(model.renderers)
        || typeof controller.name !== 'string'
        || typeof controller.activeControllerPathId !== 'string'
        || !Array.isArray(controller.clips)
        || controller.clipCount !== controller.clips.length
    ) {
        throw new Error(`Incomplete nonbattle runtime contract: ${entry.stableKey}`)
    }
    if (
        physics
        && (
            physics.attachment !== 'required'
            || physics.writerPolicy !== 'existing-character-physics-single-writer'
            || typeof physics.profileStableKey !== 'string'
            || typeof physics.productUrl !== 'string'
            || !Array.isArray(physics.expectedClothComponentStableKeys)
            || !Number.isInteger(physics.expectedClothTeams)
            || !Number.isInteger(physics.expectedMagicaColliders)
            || (
                Number(physics.expectedMagicaColliders) > 0
                && typeof physics.expectedPlaneColliderStableKey !== 'string'
            )
            || (
                physics.expectedNativeColliderStableKeys !== undefined
                && !Array.isArray(physics.expectedNativeColliderStableKeys)
            )
            || (
                physics.expectedNativeColliders !== undefined
                && !Number.isInteger(physics.expectedNativeColliders)
            )
        )
    ) {
        throw new Error(`Invalid nonbattle physics contract: ${entry.stableKey}`)
    }
    if (
        model.nativeTransformClosures !== undefined
        && !Array.isArray(model.nativeTransformClosures)
    ) {
        throw new Error(`Invalid nonbattle transform closure contract: ${entry.stableKey}`)
    }
    if (model.rendererTextureBindings !== undefined) {
        if (!Array.isArray(model.rendererTextureBindings)) {
            throw new Error(`Invalid nonbattle renderer texture contract: ${entry.stableKey}`)
        }
        const rendererNames = new Set(
            (model.renderers as Array<Record<string, unknown>>).map(renderer => renderer.meshName),
        )
        const projectedStems = new Set<string>()
        for (const rawBinding of model.rendererTextureBindings) {
            const binding = requireObject(rawBinding, 'nonbattle renderer texture binding')
            const requiredTextureKinds = binding.requiredTextureKinds
            if (
                typeof binding.meshName !== 'string'
                || !rendererNames.has(binding.meshName)
                || typeof binding.sourceMaterialPathId !== 'string'
                || typeof binding.sourceMaterialName !== 'string'
                || typeof binding.sourceTextureStem !== 'string'
                || typeof binding.projectedTextureStem !== 'string'
                || binding.policy !== 'project-authority-material-texture-set'
                || !Array.isArray(requiredTextureKinds)
                || requiredTextureKinds.length !== 3
                || requiredTextureKinds[0] !== 'color'
                || requiredTextureKinds[1] !== 'shadow'
                || requiredTextureKinds[2] !== 'ctrl'
                || projectedStems.has(binding.projectedTextureStem.toLowerCase())
            ) {
                throw new Error(`Invalid nonbattle renderer texture binding: ${entry.stableKey}`)
            }
            projectedStems.add(binding.projectedTextureStem.toLowerCase())
        }
    }
    if (profile.effects !== undefined && !Array.isArray(profile.effects)) {
        throw new Error(`Invalid nonbattle effect contract: ${entry.stableKey}`)
    }
    return value as NonBattleCharacterProfile
}

async function fetchProfile(
    entry: NonBattleCharacterCatalogEntry,
    signal: AbortSignal | undefined,
    fetcher: CharacterProfileFetcher,
): Promise<{ profile: NonBattleCharacterProfile; profileUrl: string }> {
    const profileUrl = resolveProfileUrl(entry.profileUrl)
    throwIfCharacterLoadAborted(signal, 'home-runtime', profileUrl)
    let response: Response
    try {
        response = await fetcher(profileUrl, { signal })
    } catch (error) {
        throw characterAssetLoadError('home-runtime', profileUrl, error)
    }
    if (!response.ok) {
        throw characterAssetLoadError(
            'home-runtime',
            profileUrl,
            new Error(`HTTP ${response.status}`),
        )
    }
    let payload: unknown
    try {
        payload = await response.json()
    } catch (error) {
        throw characterAssetLoadError('home-runtime', profileUrl, error)
    }
    throwIfCharacterLoadAborted(signal, 'home-runtime', profileUrl)
    try {
        return { profile: parseProfile(payload, entry), profileUrl }
    } catch (error) {
        throw characterAssetLoadError('home-runtime', profileUrl, error)
    }
}

function findExactPath(root: THREE.Object3D, hierarchyPath: string): THREE.Object3D | undefined {
    const parts = hierarchyPath.split('/').filter(Boolean)
    if (parts[0] === root.name) parts.shift()
    let current: THREE.Object3D | undefined = root
    for (const name of parts) {
        current = current.children.find(child => child.name === name)
        if (!current) return undefined
    }
    return current
}

function assertFiniteTransform(
    object: THREE.Object3D,
    expected: SerializedTransform,
    label: string,
    tolerance = 1e-6,
): void {
    const actual = [
        ...object.position.toArray(),
        ...object.quaternion.toArray(),
        ...object.scale.toArray(),
    ]
    const target = [...expected.position, ...expected.quaternion, ...expected.scale]
    if (
        actual.some(value => !Number.isFinite(value))
        || actual.some((value, index) => Math.abs(value - target[index]!) > tolerance)
    ) {
        throw new Error(`${label} transform does not match the official product`)
    }
}

function applyNativeTransformClosures(
    root: THREE.Object3D,
    closures: readonly NonBattleNativeTransformClosure[] = [],
): void {
    for (const closure of closures) {
        const candidatePaths = [closure.path, ...closure.aliases]
        const object = candidatePaths
            .map(path => findExactPath(root, path))
            .find((value): value is THREE.Object3D => value !== undefined)
        if (!object) {
            throw new Error(`Missing nonbattle native transform: ${closure.stableKey}`)
        }
        assertFiniteTransform(
            object,
            closure.sourceExpected,
            `${closure.stableKey} exported source`,
            1e-5,
        )
        if (closure.renameTo) object.name = closure.renameTo
        object.position.fromArray(closure.target.position)
        object.quaternion.fromArray(closure.target.quaternion)
        object.scale.fromArray(closure.target.scale)
        object.updateMatrix()
        root.updateMatrixWorld(true)
        const exact = findExactPath(root, closure.path)
        if (exact !== object) {
            throw new Error(`Nonbattle native transform path was not restored: ${closure.stableKey}`)
        }
        assertFiniteTransform(object, closure.target, `${closure.stableKey} restored target`)
    }
}

function assertMatrixElements(
    matrix: THREE.Matrix4,
    expected: readonly number[],
    label: string,
    tolerance = 1e-5,
): void {
    if (
        expected.length !== 16
        || matrix.elements.some(value => !Number.isFinite(value))
        || matrix.elements.some((value, index) => (
            Math.abs(value - (expected[index] ?? Number.NaN)) > tolerance
        ))
    ) {
        throw new Error(`${label} matrix does not match the official product`)
    }
}

function applySkinBindPoseClosure(
    root: THREE.Object3D,
    profile: NonBattleCharacterProfile,
): void {
    const closure = profile.model.skinBindPoseClosure
    let anchorMesh: THREE.SkinnedMesh | undefined
    if (closure) {
        if (
            closure.policy !== 'postmultiply-exported-inverses-by-authored-outer-viewer-matrix'
            || closure.sourceAnchorInverse.length !== 16
            || closure.targetAnchorInverse.length !== 16
        ) {
            throw new Error(`Invalid nonbattle bindpose closure: ${closure.stableKey}`)
        }

        const anchor = findExactPath(root, closure.anchorRendererPath)
        if (!anchor || !(anchor as THREE.SkinnedMesh).isSkinnedMesh) {
            throw new Error(`Missing nonbattle bindpose anchor: ${closure.stableKey}`)
        }
        anchorMesh = anchor as THREE.SkinnedMesh
        if (anchorMesh.skeleton.bones[0]?.name !== closure.anchorBoneName) {
            throw new Error(`Nonbattle bindpose anchor bone mismatch: ${closure.stableKey}`)
        }
        assertMatrixElements(
            anchorMesh.skeleton.boneInverses[0]!,
            closure.sourceAnchorInverse,
            `${closure.stableKey} exported anchor inverse`,
        )
    }

    // Neutralizing the authored scene placement changes every bone's world
    // basis. Close the exported inverse bind poses in that same basis for all
    // story rigs, not only profiles with an additional native anchor proof.
    // Keep each authored local transform, clip curve and mesh bindMatrix intact.
    const authored = profile.model.authoredOuterPlacement.viewer
    const authoredOuterMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(authored.position),
        new THREE.Quaternion().fromArray(authored.quaternion),
        new THREE.Vector3().fromArray(authored.scale),
    )
    for (const renderer of profile.model.renderers) {
        const object = findExactPath(root, renderer.hierarchyPath)
        if (!object || !(object as THREE.SkinnedMesh).isSkinnedMesh) {
            throw new Error(`Missing nonbattle bindpose renderer: ${renderer.hierarchyPath}`)
        }
        const skinned = object as THREE.SkinnedMesh
        if (
            skinned.skeleton.bones.length !== renderer.boneCount
            || skinned.skeleton.boneInverses.length !== renderer.bindPoseCount
        ) {
            throw new Error(`Nonbattle bindpose renderer mismatch: ${renderer.hierarchyPath}`)
        }
        for (const inverse of skinned.skeleton.boneInverses) {
            inverse.multiply(authoredOuterMatrix)
        }
        skinned.skeleton.update()
    }

    if (closure && anchorMesh) {
        assertMatrixElements(
            anchorMesh.skeleton.boneInverses[0]!,
            closure.targetAnchorInverse,
            `${closure.stableKey} neutral anchor inverse`,
        )
    }
    root.traverse(object => {
        if (!(object as THREE.SkinnedMesh).isSkinnedMesh) return
        const skinned = object as THREE.SkinnedMesh
        skinned.computeBoundingBox()
        skinned.computeBoundingSphere()
    })
}

function validateRendererContracts(
    character: MagiaExedraCharacter3D,
    profile: NonBattleCharacterProfile,
): void {
    const userData = character.userData as RuntimeCharacterUserData
    for (const contract of profile.model.renderers) {
        const mesh = userData.meshes.find(value => value.name === contract.meshName)
        if (!mesh || !(mesh as THREE.SkinnedMesh).isSkinnedMesh) {
            throw new Error(`Missing nonbattle skinned renderer: ${contract.hierarchyPath}`)
        }
        const skinned = mesh as THREE.SkinnedMesh
        const positionCount = mesh.geometry.getAttribute('position')?.count ?? 0
        const indexCount = mesh.geometry.index?.count ?? positionCount
        if (positionCount !== contract.expandedIndexCount || indexCount !== contract.expandedIndexCount) {
            throw new Error(`Nonbattle topology mismatch: ${contract.hierarchyPath}`)
        }
        if (
            skinned.skeleton.bones.length !== contract.boneCount
            || skinned.skeleton.boneInverses.length !== contract.bindPoseCount
            || skinned.skeleton.boneInverses.some(matrix => (
                matrix.elements.some(value => !Number.isFinite(value))
            ))
        ) {
            throw new Error(`Nonbattle skin binding mismatch: ${contract.hierarchyPath}`)
        }
    }
}

function validateController(
    character: MagiaExedraCharacter3D,
    profile: NonBattleCharacterProfile,
): void {
    const runtimeNames = character.object.animations.map(clip => clip.name).sort()
    const productNames = profile.storyController.clips.map(clip => clip.name).sort()
    if (
        runtimeNames.length !== profile.storyController.clipCount
        || runtimeNames.some((name, index) => name !== productNames[index])
        || !runtimeNames.includes(profile.storyController.defaultAction)
    ) {
        throw new Error(`Nonbattle story controller mismatch: ${profile.stableKey}`)
    }
}

export function applyNonBattleCharacterProfile(
    character: MagiaExedraCharacter3D,
    entry: NonBattleCharacterCatalogEntry,
    profile: NonBattleCharacterProfile,
    profileUrl = entry.profileUrl,
): NonBattleCharacterRuntimeMetadata {
    if (character.userData.characterId !== entry.style3dCharacterMstId) {
        throw new Error(`Loaded character does not match ${entry.stableKey}`)
    }
    const outerRoot = character.object
    if (outerRoot.name !== profile.model.outerRootPath) {
        throw new Error(`Missing authored nonbattle outer root: ${profile.model.outerRootPath}`)
    }
    const presentationRoot = findExactPath(outerRoot, profile.model.neutralRenderRootPath)
    if (!presentationRoot) {
        throw new Error(`Missing neutral nonbattle render root: ${profile.model.neutralRenderRootPath}`)
    }
    assertFiniteTransform(
        outerRoot,
        profile.model.authoredOuterPlacement.viewer,
        profile.model.outerRootPath,
    )
    assertFiniteTransform(
        presentationRoot,
        profile.model.viewerPlacement,
        profile.model.neutralRenderRootPath,
    )
    applyNativeTransformClosures(outerRoot, profile.model.nativeTransformClosures)
    validateRendererContracts(character, profile)
    validateController(character, profile)

    outerRoot.position.set(0, 0, 0)
    outerRoot.quaternion.identity()
    outerRoot.scale.set(1, 1, 1)
    outerRoot.updateMatrix()
    outerRoot.updateMatrixWorld(true)
    applySkinBindPoseClosure(outerRoot, profile)
    outerRoot.updateMatrixWorld(true)

    const metadata: NonBattleCharacterRuntimeMetadata = {
        stableKey: entry.stableKey,
        identityKey: entry.identityKey,
        sourceFamily: entry.sourceFamily,
        profileUrl,
        publicationStatus: profile.publication.status,
        presentationRoot,
        presentationRootPath: profile.model.neutralRenderRootPath,
        storyController: profile.storyController,
        rendererTextureBindings: profile.model.rendererTextureBindings ?? [],
        effects: [],
        physics: profile.physics,
        scenarioInstance: {
            authoredOuterPlacement: profile.model.authoredOuterPlacement,
            appliedToViewerRoot: false,
        },
    }
    const userData = character.userData as RuntimeCharacterUserData
    userData.nonBattleCharacter = metadata
    return metadata
}

function projectRendererTextureBindings(
    files: Record<string, string>,
    bindings: readonly NonBattleRendererTextureBinding[] | undefined,
): Record<string, string> {
    if (!bindings?.length) return files
    const projected = { ...files }
    const sourceEntries = Object.entries(files)
    for (const binding of bindings) {
        for (const kind of binding.requiredTextureKinds) {
            const sourceToken = `_${binding.sourceTextureStem.toLowerCase()}_${kind}`
            const source = sourceEntries.find(([path]) => (
                path.toLowerCase().includes(sourceToken)
            ))
            if (!source) {
                throw new Error(
                    `Missing authoritative renderer texture ${kind} for ${binding.meshName}`,
                )
            }
            const [sourcePath, sourceUrl] = source
            const lowerSourcePath = sourcePath.toLowerCase()
            const tokenIndex = lowerSourcePath.indexOf(sourceToken)
            const projectedToken = `_${binding.projectedTextureStem.toLowerCase()}_${kind}`
            const projectedPath = (
                sourcePath.slice(0, tokenIndex)
                + projectedToken
                + sourcePath.slice(tokenIndex + sourceToken.length)
            )
            const existingUrl = projected[projectedPath]
            if (existingUrl !== undefined && existingUrl !== sourceUrl) {
                throw new Error(
                    `Conflicting authoritative renderer texture projection: ${projectedPath}`,
                )
            }
            projected[projectedPath] = sourceUrl
        }
    }
    return projected
}

export function getNonBattleCharacterRuntimeMetadata(
    character: MagiaExedraCharacter3D,
): NonBattleCharacterRuntimeMetadata | undefined {
    return (character.userData as RuntimeCharacterUserData).nonBattleCharacter
}

interface EffectCurveKey {
    time: number
    value: number
    inSlope: number
    outSlope: number
}

interface EffectCurve {
    scalar: number
    keys: readonly EffectCurveKey[]
}

interface NonBattleEffectProduct {
    schema: 'magius.nonbattle-character-effect.v1'
    stableKey: string
    identityKey: string
    rootPath: string
    helperPath: string
    sourceSkinnedRendererPath: string
    particleSystem: {
        looping: boolean
        playOnAwake: boolean
        lifetime: { scalar: number }
        startSize: { scalar: number; minScalar: number }
        startSizeY: { scalar: number; minScalar: number }
        startSizeZ: { scalar: number; minScalar: number }
        gravityModifier: { scalar: number }
        maxParticles: number
        shape: {
            type: number
            placementMode: number
        }
        emission: {
            rateOverTime: { scalar: number; minScalar: number }
        }
        sizeOverLifetime: {
            enabled: boolean
            x: EffectCurve
            y: EffectCurve
            z: EffectCurve
        }
    }
    renderer: {
        enabled: boolean
        baseColor: readonly [number, number, number, number]
        mesh: {
            pathId: string
            name: string
            expandedVertexCount: number
            positions: readonly number[]
            normals: readonly number[]
            uv0: readonly number[]
        }
    }
    runtime: {
        status: 'runtime-ready'
        failClosedReasons: readonly string[]
    }
}

function findRequiredEffectUrl(
    files: Record<string, string>,
    entry: NonBattleCharacterCatalogEntry,
    reference: NonBattleEffectReference,
): string {
    const suffix = `/${entry.resourceName}/${reference.productFileName}`
    const found = Object.entries(files).find(([path]) => (
        path.replaceAll('\\', '/').endsWith(suffix)
    ))
    if (!found) {
        throw new Error(`Missing nonbattle effect product: ${reference.stableKey}`)
    }
    return found[1]
}

function parseEffectProduct(
    value: unknown,
    entry: NonBattleCharacterCatalogEntry,
    reference: NonBattleEffectReference,
): NonBattleEffectProduct {
    const product = requireObject(value, 'nonbattle effect product')
    const particleSystem = requireObject(
        product.particleSystem,
        'nonbattle effect particle system',
    )
    const renderer = requireObject(product.renderer, 'nonbattle effect renderer')
    const mesh = requireObject(renderer.mesh, 'nonbattle effect mesh')
    const runtime = requireObject(product.runtime, 'nonbattle effect runtime')
    if (
        product.schema !== 'magius.nonbattle-character-effect.v1'
        || product.stableKey !== reference.stableKey
        || product.identityKey !== entry.identityKey
        || product.rootPath !== reference.rootPath
        || product.helperPath !== reference.helperPath
        || runtime.status !== 'runtime-ready'
        || !Array.isArray(runtime.failClosedReasons)
        || runtime.failClosedReasons.length !== 0
        || reference.expectedParticleSystems !== 1
        || !Array.isArray(mesh.positions)
        || !Array.isArray(mesh.normals)
        || !Array.isArray(mesh.uv0)
        || mesh.positions.length !== Number(mesh.expandedVertexCount) * 3
        || mesh.normals.length !== mesh.positions.length
        || mesh.uv0.length !== Number(mesh.expandedVertexCount) * 2
        || !Number.isInteger(particleSystem.maxParticles)
    ) {
        throw new Error(`Invalid nonbattle effect product: ${reference.stableKey}`)
    }
    return value as NonBattleEffectProduct
}

async function fetchEffectProducts(
    files: Record<string, string>,
    entry: NonBattleCharacterCatalogEntry,
    profile: NonBattleCharacterProfile,
    signal: AbortSignal | undefined,
    fetcher: CharacterProfileFetcher,
): Promise<Array<{
    reference: NonBattleEffectReference
    product: NonBattleEffectProduct
    productUrl: string
}>> {
    return await Promise.all((profile.effects ?? []).map(async reference => {
        const productUrl = findRequiredEffectUrl(files, entry, reference)
        throwIfCharacterLoadAborted(signal, 'home-runtime', productUrl)
        let response: Response
        try {
            response = await fetcher(productUrl, { signal })
        } catch (error) {
            throw characterAssetLoadError('home-runtime', productUrl, error)
        }
        if (!response.ok) {
            throw characterAssetLoadError(
                'home-runtime',
                productUrl,
                new Error(`HTTP ${response.status}`),
            )
        }
        let payload: unknown
        try {
            payload = await response.json()
        } catch (error) {
            throw characterAssetLoadError('home-runtime', productUrl, error)
        }
        throwIfCharacterLoadAborted(signal, 'home-runtime', productUrl)
        return {
            reference,
            product: parseEffectProduct(payload, entry, reference),
            productUrl,
        }
    }))
}

function evaluateHermiteCurve(curve: EffectCurve, normalizedTime: number): number {
    const keys = curve.keys
    if (keys.length === 0) return curve.scalar
    if (normalizedTime <= keys[0]!.time) return keys[0]!.value * curve.scalar
    if (normalizedTime >= keys[keys.length - 1]!.time) {
        return keys[keys.length - 1]!.value * curve.scalar
    }
    for (let index = 0; index < keys.length - 1; index += 1) {
        const left = keys[index]!
        const right = keys[index + 1]!
        if (normalizedTime > right.time) continue
        const span = right.time - left.time
        const t = span > 0 ? (normalizedTime - left.time) / span : 0
        const t2 = t * t
        const t3 = t2 * t
        const h00 = 2 * t3 - 3 * t2 + 1
        const h10 = t3 - 2 * t2 + t
        const h01 = -2 * t3 + 3 * t2
        const h11 = t3 - t2
        return (
            h00 * left.value
            + h10 * span * left.outSlope
            + h01 * right.value
            + h11 * span * right.inSlope
        ) * curve.scalar
    }
    return 0
}

interface EffectParticle {
    age: number
    lifetime: number
    position: THREE.Vector3
    velocity: THREE.Vector3
    startScale: THREE.Vector3
    rotation: THREE.Quaternion
}

function createEffectRuntime(
    character: MagiaExedraCharacter3D,
    product: NonBattleEffectProduct,
): NonBattleCharacterEffectRuntime {
    const helper = findExactPath(character.object, product.helperPath)
    const sourceObject = findExactPath(character.object, product.sourceSkinnedRendererPath)
    if (!helper || !sourceObject || !(sourceObject as THREE.SkinnedMesh).isSkinnedMesh) {
        throw new Error(`Missing nonbattle effect binding: ${product.stableKey}`)
    }
    const source = sourceObject as THREE.SkinnedMesh
    const meshProduct = product.renderer.mesh
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(meshProduct.positions, 3),
    )
    geometry.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(meshProduct.normals, 3),
    )
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(meshProduct.uv0, 2))
    geometry.computeBoundingSphere()
    const [red, green, blue, alpha] = product.renderer.baseColor
    const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(red, green, blue),
        opacity: alpha,
        transparent: alpha < 1,
        depthWrite: alpha >= 1,
        side: THREE.DoubleSide,
    })
    const object = new THREE.InstancedMesh(
        geometry,
        material,
        product.particleSystem.maxParticles,
    )
    object.name = `${meshProduct.name}__runtime`
    object.count = 0
    object.frustumCulled = false
    object.userData = {
        stableKey: product.stableKey,
        sourceMeshPathId: meshProduct.pathId,
        sourceSkinnedRendererPath: product.sourceSkinnedRendererPath,
    }
    helper.add(object)

    let randomState = 0x71f3a5c9
    const random = () => {
        randomState ^= randomState << 13
        randomState ^= randomState >>> 17
        randomState ^= randomState << 5
        return (randomState >>> 0) / 0x1_0000_0000
    }
    const particles: EffectParticle[] = []
    const matrix = new THREE.Matrix4()
    const pointA = new THREE.Vector3()
    const pointB = new THREE.Vector3()
    const pointC = new THREE.Vector3()
    const sampled = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const sourcePosition = source.geometry.getAttribute('position')
    const sourceIndex = source.geometry.index
    const triangleCount = Math.floor((sourceIndex?.count ?? sourcePosition.count) / 3)
    if (triangleCount <= 0) {
        throw new Error(`Empty nonbattle effect source mesh: ${product.stableKey}`)
    }
    const readSourceVertex = (index: number, target: THREE.Vector3) => {
        const vertexIndex = sourceIndex ? sourceIndex.getX(index) : index
        source.getVertexPosition(vertexIndex, target)
    }
    const sampleSource = (target: THREE.Vector3) => {
        const triangle = Math.min(triangleCount - 1, Math.floor(random() * triangleCount))
        const offset = triangle * 3
        readSourceVertex(offset, pointA)
        readSourceVertex(offset + 1, pointB)
        readSourceVertex(offset + 2, pointC)
        let u = random()
        let v = random()
        if (u + v > 1) {
            u = 1 - u
            v = 1 - v
        }
        target.copy(pointA)
            .addScaledVector(pointB.clone().sub(pointA), u)
            .addScaledVector(pointC.clone().sub(pointA), v)
        source.localToWorld(target)
        helper.worldToLocal(target)
    }
    const randomRange = (minimum: number, maximum: number) => (
        minimum + (maximum - minimum) * random()
    )
    const particleSystem = product.particleSystem
    const lifetime = particleSystem.lifetime.scalar
    const gravity = 9.81 * particleSystem.gravityModifier.scalar
    const emissionRate = (
        particleSystem.emission.rateOverTime.minScalar
        + particleSystem.emission.rateOverTime.scalar
    ) / 2
    let emissionCarry = 0
    let emittedParticles = 0
    let disposed = false
    const spawn = () => {
        if (particles.length >= particleSystem.maxParticles) return
        source.updateMatrixWorld(true)
        helper.updateMatrixWorld(true)
        sampleSource(sampled)
        const position = sampled.clone()
        particles.push({
            age: 0,
            lifetime,
            position,
            velocity: new THREE.Vector3(),
            startScale: new THREE.Vector3(
                randomRange(
                    particleSystem.startSize.minScalar,
                    particleSystem.startSize.scalar,
                ),
                randomRange(
                    particleSystem.startSizeY.minScalar,
                    particleSystem.startSizeY.scalar,
                ),
                randomRange(
                    particleSystem.startSizeZ.minScalar,
                    particleSystem.startSizeZ.scalar,
                ),
            ),
            rotation: new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                random() * Math.PI * 2,
            ),
        })
        emittedParticles += 1
    }
    const step = (requestedDelta: number) => {
        if (disposed || !Number.isFinite(requestedDelta) || requestedDelta <= 0) return
        const delta = Math.min(requestedDelta, 0.25)
        if (particleSystem.playOnAwake && product.renderer.enabled) {
            emissionCarry += delta * emissionRate
            while (emissionCarry >= 1) {
                spawn()
                emissionCarry -= 1
            }
        }
        for (let index = particles.length - 1; index >= 0; index -= 1) {
            const particle = particles[index]!
            particle.age += delta
            if (particle.age >= particle.lifetime) {
                particles.splice(index, 1)
                continue
            }
            particle.velocity.y -= gravity * delta
            particle.position.addScaledVector(particle.velocity, delta)
        }
        for (const [index, particle] of particles.entries()) {
            const normalized = particle.age / particle.lifetime
            if (particleSystem.sizeOverLifetime.enabled) {
                scale.set(
                    particle.startScale.x * evaluateHermiteCurve(
                        particleSystem.sizeOverLifetime.x,
                        normalized,
                    ),
                    particle.startScale.y * evaluateHermiteCurve(
                        particleSystem.sizeOverLifetime.y,
                        normalized,
                    ),
                    particle.startScale.z * evaluateHermiteCurve(
                        particleSystem.sizeOverLifetime.z,
                        normalized,
                    ),
                )
            } else {
                scale.copy(particle.startScale)
            }
            matrix.compose(particle.position, particle.rotation, scale)
            object.setMatrixAt(index, matrix)
        }
        object.count = particles.length
        object.instanceMatrix.needsUpdate = true
    }
    let lastTick = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const animationLoop = () => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
        const delta = Math.min(0.1, Math.max(0, (now - lastTick) / 1000))
        lastTick = now
        step(delta)
    }
    const runtime: NonBattleCharacterEffectRuntime = {
        stableKey: product.stableKey,
        object,
        get activeParticles() { return particles.length },
        get emittedParticles() { return emittedParticles },
        step,
        dispose() {
            if (disposed) return
            disposed = true
            const loops = character.userData.animationLoops
            const loopIndex = loops.indexOf(animationLoop)
            if (loopIndex >= 0) loops.splice(loopIndex, 1)
            object.removeFromParent()
            geometry.dispose()
            material.dispose()
            particles.length = 0
        },
    }
    character.userData.animationLoops.push(animationLoop)
    character.userData.disposeCallbacks.push(runtime.dispose)
    return runtime
}

function installEffectProducts(
    character: MagiaExedraCharacter3D,
    metadata: NonBattleCharacterRuntimeMetadata,
    products: readonly { product: NonBattleEffectProduct }[],
): void {
    for (const { product } of products) {
        metadata.effects.push(createEffectRuntime(character, product))
    }
}

export async function loadNonBattleCharacter(
    files: Record<string, string>,
    entry: NonBattleCharacterCatalogEntry,
    callbacks?: Partial<LoadCharacterCallbacks>,
    dependencies: NonBattleCharacterLoadDependencies = {},
): Promise<MagiaExedraCharacter3D> {
    const signal = callbacks?.signal
    const fetcher = dependencies.fetcher ?? fetch
    const baseLoader = dependencies.baseLoader
        ?? (await import('./loader.ts')).loadCharacter
    callbacks?.loadProgressCallback?.('Loading story character profile...')
    let baseStarted = false
    let character: MagiaExedraCharacter3D | undefined
    try {
        const { profile, profileUrl } = await fetchProfile(entry, signal, fetcher)
        const effectProducts = await fetchEffectProducts(
            files,
            entry,
            profile,
            signal,
            fetcher,
        )
        throwIfCharacterLoadAborted(signal, 'home-runtime', profileUrl)
        let baseModelLoaded = false
        let baseFinished = false
        baseStarted = true
        const projectedFiles = projectRendererTextureBindings(
            files,
            profile.model.rendererTextureBindings,
        )
        character = await baseLoader(projectedFiles, {
            ...callbacks,
            modelLoadedCallback: () => {
                baseModelLoaded = true
            },
            loadFinishCallback: () => {
                baseFinished = true
            },
        })
        if (!baseModelLoaded || !baseFinished) {
            throw new Error(`Base loader did not complete its lifecycle: ${entry.stableKey}`)
        }
        throwIfCharacterLoadAborted(signal, 'home-runtime', profileUrl)
        const metadata = applyNonBattleCharacterProfile(
            character,
            entry,
            profile,
            profileUrl,
        )
        installNonBattleExpressions(character, profile)
        installEffectProducts(character, metadata, effectProducts)
        throwIfCharacterLoadAborted(signal, 'home-runtime', profileUrl)
        callbacks?.modelLoadedCallback?.(character)
        callbacks?.loadFinishCallback?.(character)
        return character
    } catch (error) {
        if (character && !character.disposed) character.dispose()
        throw characterAssetLoadError('home-runtime', entry.profileUrl, error)
    } finally {
        if (!baseStarted) callbacks?.loadProgressCallback?.('')
    }
}
