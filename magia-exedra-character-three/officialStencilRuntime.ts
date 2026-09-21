import * as THREE from 'three'
import type { ObjectUserData } from './character'
import type { OfficialMaterialProfile } from './materialProfile'
import { MaterialUserData } from './shaders/userdata'

const CHARACTER_OPAQUE_RENDER_ORDER = 2
const CHARACTER_STENCIL_MASK_PASS_RENDER_ORDER = 4

interface OfficialGeometryGroup {
    start: number
    count: number
    materialIndex?: number
}

export interface OfficialStencilWriterRecord {
    materialIndex: number
    materialName: string
    queue: number
    comparison: number
    serializedReference: number
    characterReference: number
    reference: number
    passOperation: number
    groups: Array<{ start: number; count: number }>
    forwardMeshes: string[]
}

export interface OfficialStencilWriterState {
    outlineReference: number
    writers: OfficialStencilWriterRecord[]
    remainingGroups: Array<{
        start: number
        count: number
        materialIndex: number
    }>
}

export interface OfficialStencilSelectorRecord {
    materialIndex: number
    materialName: string
    queue: number
    comparison: number
    serializedReference: number
    characterReference: number
    reference: number
    passOperation: number
    transparency: number
    groups: Array<{ start: number; count: number }>
    forwardMeshes: string[]
    maskMeshes: string[]
}

export interface OfficialStencilSelectorState {
    selectors: OfficialStencilSelectorRecord[]
    remainingGroups: Array<{
        start: number
        count: number
        materialIndex: number
    }>
}

export interface OfficialSingleMaterialGroupState {
    source: 'official-single-material-stencil'
    materialIndex: 0
    start: 0
    count: number
    stencilMode: 1 | 2
}

/**
 * The compiled outline pass rejects transparent material slots before shell
 * extrusion. Keep geometry creation and the later stencil pass configuration
 * on one predicate so a serialized outline switch cannot require a shell that
 * was intentionally omitted.
 */
export function isOfficialOutlineExtrusionEnabled(
    profile: OfficialMaterialProfile,
): boolean {
    return profile.outline.enabled && !Boolean(profile.gem.transparency)
}

/**
 * ReDrive reserves stencil bit 7 for the serialized face/hair writer-selector
 * contract and carries the current character stencil id in bits 0..6. Fresh
 * TW draws therefore expose values such as 137 (128 | 9), rather than the raw
 * serialized material value 128.
 */
export function composeOfficialStencilReference(
    serializedReference: number,
    characterReference: number,
): number {
    const serializedWriterBit = Math.round(serializedReference) & 0x80
    const characterBits = Math.round(characterReference) & 0x7f
    return serializedWriterBit | characterBits
}

/**
 * FBXLoader leaves single-material geometry ungrouped.  ReDrive still requires
 * an explicit draw group when that one slot owns a stencil writer/selector
 * pass, otherwise Three renders it as an ordinary opaque material and skips
 * the serialized face/hair queue contract.
 */
export function ensureOfficialSingleMaterialGroup(
    mesh: THREE.Mesh,
    profiles: readonly OfficialMaterialProfile[],
): OfficialSingleMaterialGroupState | undefined {
    if (mesh.geometry.groups.length > 0 || profiles.length !== 1) return undefined
    const stencilMode = Math.round(profiles[0].stencil.mode)
    if (stencilMode !== 1 && stencilMode !== 2) return undefined
    const count = mesh.geometry.index?.count
        ?? mesh.geometry.getAttribute('position')?.count
        ?? 0
    if (count <= 0) return undefined
    mesh.geometry.addGroup(0, count, 0)
    const state: OfficialSingleMaterialGroupState = {
        source: 'official-single-material-stencil',
        materialIndex: 0,
        start: 0,
        count,
        stencilMode,
    }
    mesh.userData.officialSingleMaterialGroup = state
    return state
}

function mapOfficialOpaqueQueueToRenderOrder(queue: number): number {
    return CHARACTER_OPAQUE_RENDER_ORDER + (queue - 2000) / 1000
}

function mapOfficialStencilMaskPassToRenderOrder(queue: number): number {
    // Fresh TW executes RdToonStencilMaskPass only after the complete outline
    // phase (selector forward 694, selector outline 1107, mask 1117). Keeping
    // this pass beside queue-2002 forward rendering lets Three draw the
    // semi-transparent hair mask before the eye/eyebrow outlines, reversing
    // the official pass dependency even though every individual GL state is
    // otherwise correct.
    return CHARACTER_STENCIL_MASK_PASS_RENDER_ORDER + (queue - 2000) / 1000
}

function createSharedMaterialGroupGeometry(
    source: THREE.BufferGeometry,
    group: OfficialGeometryGroup,
): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.name = `${source.name}:official-material-group`
    if (source.index) geometry.setIndex(source.index)
    for (const [name, attribute] of Object.entries(source.attributes)) {
        geometry.setAttribute(name, attribute)
    }
    geometry.morphAttributes = source.morphAttributes
    geometry.morphTargetsRelative = source.morphTargetsRelative
    geometry.boundingBox = source.boundingBox
    geometry.boundingSphere = source.boundingSphere
    geometry.setDrawRange(group.start, group.count)
    return geometry
}

function configureStencilTest(
    material: THREE.Material,
    func: THREE.StencilFunc,
    writeMask: number,
    reference: number,
    funcMask = reference,
) {
    material.stencilWrite = true
    material.stencilRef = reference
    material.stencilFunc = func
    // The official hair/face contract uses bit 7 independently from the
    // Viewer's low-seven-bit outline id.
    material.stencilFuncMask = funcMask
    material.stencilWriteMask = writeMask
    material.stencilFail = THREE.KeepStencilOp
    material.stencilZFail = THREE.KeepStencilOp
    material.stencilZPass = THREE.KeepStencilOp
}

/**
 * Fresh TW GLES forward state keeps queue 2001/2002 in the opaque render phase
 * while enabling the pass' explicit blend factors.  Three still applies
 * CustomBlending when `transparent` is false; keeping this false is required so
 * hair -> writer -> selector remains one queue-ordered forward sequence.
 */
function configureOfficialStencilForwardBlend(material: THREE.Material) {
    material.transparent = false
    material.blending = THREE.CustomBlending
    material.blendSrc = THREE.OneFactor
    material.blendDst = THREE.ZeroFactor
    material.blendEquation = THREE.AddEquation
    material.blendSrcAlpha = THREE.OneFactor
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
    material.blendEquationAlpha = THREE.AddEquation
}

/**
 * ReDriveToon's dedicated stencil-mask pass does not reuse the forward pass
 * alpha.  Its compiled fragment program writes
 * `clamp(1 - _StencilTransparency, 0, 1)` after evaluating the same RGB path.
 * MeshStandardMaterial's opaque chunk otherwise forces alpha back to one, so
 * the serialized mask transparency must be injected after that chunk.
 */
function installOfficialStencilMaskAlpha(
    material: THREE.Material,
    transparency: number,
) {
    const sourceOnBeforeCompile = material.onBeforeCompile
    const officialTransparency = Math.max(0, Math.min(1, transparency))
    material.onBeforeCompile = function (shader, renderer) {
        sourceOnBeforeCompile.call(this, shader, renderer)
        shader.uniforms.uOfficialStencilTransparency = {
            value: officialTransparency,
        }
        const opaqueFragment = '#include <opaque_fragment>'
        if (!shader.fragmentShader.includes(opaqueFragment)) {
            throw new Error(
                'Official stencil mask requires the Three opaque fragment marker',
            )
        }
        shader.fragmentShader = /* glsl */ `
            uniform float uOfficialStencilTransparency;
            ${shader.fragmentShader}
        `.replace(
            opaqueFragment,
            /* glsl */ `
            ${opaqueFragment}
            gl_FragColor.a = clamp(
                1.0 - uOfficialStencilTransparency,
                0.0,
                1.0
            );
            `,
        )
    }
}

export function mapUnityStencilComparison(value: number): THREE.StencilFunc {
    switch (Math.round(value)) {
        case 1: return THREE.NeverStencilFunc
        case 2: return THREE.LessStencilFunc
        case 3: return THREE.EqualStencilFunc
        case 4: return THREE.LessEqualStencilFunc
        case 5: return THREE.GreaterStencilFunc
        case 6: return THREE.NotEqualStencilFunc
        case 7: return THREE.GreaterEqualStencilFunc
        case 8: return THREE.AlwaysStencilFunc
        default: throw new Error(`Unsupported official stencil comparison ${value}`)
    }
}

export function mapUnityStencilOperation(value: number): THREE.StencilOp {
    switch (Math.round(value)) {
        case 0: return THREE.KeepStencilOp
        case 1: return THREE.ZeroStencilOp
        case 2: return THREE.ReplaceStencilOp
        case 3: return THREE.IncrementStencilOp
        case 4: return THREE.DecrementStencilOp
        case 5: return THREE.InvertStencilOp
        case 6: return THREE.IncrementWrapStencilOp
        case 7: return THREE.DecrementWrapStencilOp
        default: throw new Error(`Unsupported official stencil operation ${value}`)
    }
}

/**
 * Mode-1 materials own independent forward draws in their serialized opaque
 * queue. Preserve the Viewer's outline id in the low seven bits while the
 * official writer owns bit 7; slots and draw ranges come only from the restored
 * Unity renderer profile/groups.
 */
export function installOfficialStencilWriters(
    mesh: THREE.Mesh,
    profiles: readonly OfficialMaterialProfile[],
    outlineMeshes: readonly THREE.SkinnedMesh[],
    userData: Pick<ObjectUserData, 'meshes'>,
    outlineRef: number,
): OfficialStencilWriterState | undefined {
    if (!(mesh instanceof THREE.SkinnedMesh) || !mesh.skeleton) return undefined
    if (!Array.isArray(mesh.material)) return undefined
    const materials = mesh.material
    const writerIndices = profiles
        .map((profile, materialIndex) => ({ profile, materialIndex }))
        .filter(({ profile }) => Math.round(profile.stencil.mode) === 1)
    if (writerIndices.length === 0) return undefined

    const sourceOnBeforeRender = mesh.onBeforeRender
    const writerIndexSet = new Set(
        writerIndices.map(({ materialIndex }) => materialIndex),
    )
    const lowerRef = outlineRef & 0x7f
    materials.forEach(material => {
        material.stencilFuncMask = 0x7f
        material.stencilWriteMask = 0x7f
    })

    for (const outlineMesh of outlineMeshes) {
        const outlineMaterials = Array.isArray(outlineMesh.material)
            ? outlineMesh.material
            : [outlineMesh.material]
        for (const material of outlineMaterials) {
            material.stencilRef = lowerRef
            material.stencilFuncMask = 0x7f
            material.stencilWriteMask = 0
        }
    }

    const writers = writerIndices.map(({ profile, materialIndex }) => {
        const groups = mesh.geometry.groups.filter(
            (group: OfficialGeometryGroup) =>
                (group.materialIndex ?? 0) === materialIndex,
        )
        if (groups.length === 0) {
            throw new Error(`${profile.name} official stencil writer group is missing`)
        }
        const queue = profile.customRenderQueue >= 0
            ? profile.customRenderQueue
            : 2000
        const material = materials[materialIndex]
        if (!material) {
            throw new Error(
                `${profile.name} official stencil writer material is missing`,
            )
        }
        const stencil = profile.stencil
        const serializedReference = Math.round(stencil.reference) & 0xff
        const reference = composeOfficialStencilReference(
            serializedReference,
            lowerRef,
        )
        material.stencilRef = reference
        material.stencilFunc = mapUnityStencilComparison(stencil.comparison)
        material.stencilFuncMask = 0xff
        material.stencilWriteMask = 0xff
        material.stencilFail = THREE.KeepStencilOp
        material.stencilZFail = THREE.KeepStencilOp
        material.stencilZPass = mapUnityStencilOperation(stencil.passOperation)
        material.depthWrite = true
        configureOfficialStencilForwardBlend(material)

        if (isOfficialOutlineExtrusionEnabled(profile)) {
            const outlineMesh = outlineMeshes.find(value =>
                value.name.endsWith(`official-outline:${materialIndex}`)
            )
            if (!outlineMesh) {
                throw new Error(`${profile.name} official outline group is missing`)
            }
            outlineMesh.renderOrder = 3 + (queue - 2000) / 1000
            const outlineMaterials = Array.isArray(outlineMesh.material)
                ? outlineMesh.material
                : [outlineMesh.material]
            for (const outlineMaterial of outlineMaterials) {
                // The outline program is a second draw of the same writer
                // submesh. Fresh TW keeps the serialized ref/masks but changes
                // the depth-pass op from Replace to Keep for this pass.
                configureStencilTest(
                    outlineMaterial,
                    mapUnityStencilComparison(stencil.comparison),
                    0xff,
                    reference,
                    0xff,
                )
                outlineMaterial.depthWrite = true
            }
        }

        const record: OfficialStencilWriterRecord = {
            materialIndex,
            materialName: profile.name,
            queue,
            comparison: Math.round(stencil.comparison),
            serializedReference,
            characterReference: lowerRef,
            reference,
            passOperation: Math.round(stencil.passOperation),
            groups: groups.map((group: OfficialGeometryGroup) => ({
                start: group.start,
                count: group.count,
            })),
            forwardMeshes: [],
        }

        for (const group of groups) {
            const forwardMesh = new THREE.SkinnedMesh(
                createSharedMaterialGroupGeometry(mesh.geometry, group),
                material,
            )
            forwardMesh.name = `${mesh.name}:${profile.name}:writer-forward`
            forwardMesh.bind(mesh.skeleton, mesh.bindMatrix)
            forwardMesh.bindMode = mesh.bindMode
            forwardMesh.morphTargetInfluences = mesh.morphTargetInfluences
            forwardMesh.morphTargetDictionary = mesh.morphTargetDictionary
            forwardMesh.castShadow = mesh.castShadow
            forwardMesh.receiveShadow = mesh.receiveShadow
            forwardMesh.customDepthMaterial = mesh.customDepthMaterial
            forwardMesh.customDistanceMaterial = mesh.customDistanceMaterial
            forwardMesh.frustumCulled = mesh.frustumCulled
            forwardMesh.layers.mask = mesh.layers.mask
            forwardMesh.renderOrder = mapOfficialOpaqueQueueToRenderOrder(queue)
            forwardMesh.userData.characterPerspectiveReference =
                mesh.userData.characterPerspectiveReference
            forwardMesh.userData.officialMaterialProfiles = [profile]
            forwardMesh.userData.officialStencilRole = 'writer-forward'
            forwardMesh.userData.officialSourceMaterialIndex = materialIndex
            forwardMesh.onBeforeRender = function (
                renderer,
                scene,
                camera,
                geometry,
                renderMaterial,
                _group,
            ) {
                sourceOnBeforeRender.call(
                    this,
                    renderer,
                    scene,
                    camera,
                    geometry,
                    renderMaterial,
                    {
                        start: group.start,
                        count: group.count,
                        materialIndex,
                    } as unknown as THREE.Group,
                )
            }

            mesh.add(forwardMesh)
            userData.meshes.push(forwardMesh)
            record.forwardMeshes.push(forwardMesh.name)
        }
        return record
    })

    const mainGroups = mesh.geometry.groups.filter(
        (group: OfficialGeometryGroup) =>
            !writerIndexSet.has(group.materialIndex ?? 0),
    )
    mesh.geometry.clearGroups()
    mainGroups.forEach((group: OfficialGeometryGroup) => {
        mesh.geometry.addGroup(group.start, group.count, group.materialIndex ?? 0)
    })
    return {
        outlineReference: lowerRef,
        writers,
        remainingGroups: mainGroups.map((group: OfficialGeometryGroup) => ({
            start: group.start,
            count: group.count,
            materialIndex: group.materialIndex ?? 0,
        })),
    }
}

function configureOfficialSelectorOutline(
    outlineMeshes: readonly THREE.SkinnedMesh[],
    materialIndex: number,
    profile: OfficialMaterialProfile,
    queue: number,
    reference: number,
) {
    if (!isOfficialOutlineExtrusionEnabled(profile)) return
    const outlineMesh = outlineMeshes.find(mesh =>
        mesh.name.endsWith(`official-outline:${materialIndex}`)
    )
    if (!outlineMesh) {
        throw new Error(`${profile.name} official outline group is missing`)
    }
    outlineMesh.renderOrder = 3 + (queue - 2000) / 1000
    const outlineMaterials = Array.isArray(outlineMesh.material)
        ? outlineMesh.material
        : [outlineMesh.material]
    for (const outlineMaterial of outlineMaterials) {
        // ReDrive's outline pass does not reuse the selector's NotEqual test.
        // It draws with Always/ref128 and Keep, then the later stencil-mask
        // pass alone consumes Equal/ref128.
        configureStencilTest(
            outlineMaterial,
            THREE.AlwaysStencilFunc,
            0xff,
            reference,
            0xff,
        )
        outlineMaterial.depthWrite = true
    }
}

/**
 * Mode-2 materials render an independent forward draw plus the official
 * RdToonStencilMaskPass. The child draws share source buffers, Skeleton and
 * morph arrays; slot order and draw ranges come only from profile/groups.
 */
export function installOfficialStencilSelectorRuntime(
    mesh: THREE.Mesh,
    profiles: readonly OfficialMaterialProfile[],
    outlineMeshes: readonly THREE.SkinnedMesh[],
    userData: Pick<ObjectUserData, 'meshes'>,
    outlineRef: number,
): OfficialStencilSelectorState | undefined {
    if (!(mesh instanceof THREE.SkinnedMesh) || !mesh.skeleton) return undefined
    if (!Array.isArray(mesh.material)) return undefined
    const materials = mesh.material
    const selectorIndices = profiles
        .map((profile, materialIndex) => ({ profile, materialIndex }))
        .filter(({ profile }) => Math.round(profile.stencil.mode) === 2)
    if (selectorIndices.length === 0) return undefined

    const sourceOnBeforeRender = mesh.onBeforeRender
    const selectorIndexSet = new Set(
        selectorIndices.map(({ materialIndex }) => materialIndex),
    )
    const lowerRef = outlineRef & 0x7f
    const selectors: OfficialStencilSelectorRecord[] = []

    for (const { profile, materialIndex } of selectorIndices) {
        const groups = mesh.geometry.groups.filter(
            (group: OfficialGeometryGroup) =>
                (group.materialIndex ?? 0) === materialIndex,
        )
        if (groups.length === 0) {
            throw new Error(`${profile.name} official selector group is missing`)
        }
        const queue = profile.customRenderQueue >= 0
            ? profile.customRenderQueue
            : 2000
        const material = materials[materialIndex]
        if (!material) {
            throw new Error(
                `${profile.name} official selector material is missing`,
            )
        }
        const serializedReference =
            Math.round(profile.stencil.reference) & 0xff
        const reference = composeOfficialStencilReference(
            serializedReference,
            lowerRef,
        )
        configureOfficialSelectorOutline(
            outlineMeshes,
            materialIndex,
            profile,
            queue,
            reference,
        )
        configureStencilTest(
            material,
            mapUnityStencilComparison(profile.stencil.comparison),
            0xff,
            reference,
            0xff,
        )
        material.depthWrite = true
        configureOfficialStencilForwardBlend(material)

        const record: OfficialStencilSelectorRecord = {
            materialIndex,
            materialName: profile.name,
            queue,
            comparison: Math.round(profile.stencil.comparison),
            serializedReference,
            characterReference: lowerRef,
            reference,
            passOperation: Math.round(profile.stencil.passOperation),
            transparency: profile.stencil.transparency,
            groups: groups.map((group: OfficialGeometryGroup) => ({
                start: group.start,
                count: group.count,
            })),
            forwardMeshes: [],
            maskMeshes: [],
        }

        for (const group of groups) {
            const forwardMesh = new THREE.SkinnedMesh(
                createSharedMaterialGroupGeometry(mesh.geometry, group),
                material,
            )
            forwardMesh.name = `${mesh.name}:${profile.name}:forward`
            forwardMesh.bind(mesh.skeleton, mesh.bindMatrix)
            forwardMesh.bindMode = mesh.bindMode
            forwardMesh.morphTargetInfluences = mesh.morphTargetInfluences
            forwardMesh.morphTargetDictionary = mesh.morphTargetDictionary
            forwardMesh.castShadow = mesh.castShadow
            forwardMesh.receiveShadow = mesh.receiveShadow
            forwardMesh.frustumCulled = mesh.frustumCulled
            forwardMesh.renderOrder = mapOfficialOpaqueQueueToRenderOrder(queue)
            forwardMesh.userData.characterPerspectiveReference =
                mesh.userData.characterPerspectiveReference
            forwardMesh.userData.officialMaterialProfiles = [profile]
            forwardMesh.userData.officialStencilRole = 'selector-forward'
            forwardMesh.onBeforeRender = function (
                renderer,
                scene,
                camera,
                geometry,
                renderMaterial,
                _group,
            ) {
                sourceOnBeforeRender.call(
                    this,
                    renderer,
                    scene,
                    camera,
                    geometry,
                    renderMaterial,
                    {
                        start: group.start,
                        count: group.count,
                        materialIndex,
                    } as unknown as THREE.Group,
                )
            }

            const maskMaterial = material.clone()
            maskMaterial.name = `${material.name}:RdToonStencilMaskPass`
            maskMaterial.onBeforeCompile = material.onBeforeCompile
            maskMaterial.customProgramCacheKey = () =>
                `${material.customProgramCacheKey()}:stencil-mask`
            maskMaterial.userData = new MaterialUserData()
            maskMaterial.userData.officialMaterialProfile = profile
            maskMaterial.opacity = Math.max(
                0,
                Math.min(1, 1 - profile.stencil.transparency),
            )
            // Three only applies CustomBlending to transparent materials. The
            // compiled pass still belongs to queue 2002 via renderOrder below.
            maskMaterial.transparent = true
            maskMaterial.blending = THREE.CustomBlending
            maskMaterial.blendSrc = THREE.SrcAlphaFactor
            maskMaterial.blendDst = THREE.OneMinusSrcAlphaFactor
            maskMaterial.blendEquation = THREE.AddEquation
            maskMaterial.blendSrcAlpha = THREE.OneFactor
            maskMaterial.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
            maskMaterial.blendEquationAlpha = THREE.AddEquation
            maskMaterial.depthTest = true
            maskMaterial.depthWrite = true
            installOfficialStencilMaskAlpha(
                maskMaterial,
                profile.stencil.transparency,
            )
            configureStencilTest(
                maskMaterial,
                THREE.EqualStencilFunc,
                0xff,
                reference,
                0xff,
            )

            const maskMesh = new THREE.SkinnedMesh(
                createSharedMaterialGroupGeometry(mesh.geometry, group),
                maskMaterial,
            )
            maskMesh.name = `${mesh.name}:${profile.name}:stencil-mask`
            maskMesh.bind(mesh.skeleton, mesh.bindMatrix)
            maskMesh.bindMode = mesh.bindMode
            maskMesh.morphTargetInfluences = mesh.morphTargetInfluences
            maskMesh.morphTargetDictionary = mesh.morphTargetDictionary
            maskMesh.castShadow = false
            maskMesh.receiveShadow = mesh.receiveShadow
            maskMesh.frustumCulled = mesh.frustumCulled
            maskMesh.renderOrder = mapOfficialStencilMaskPassToRenderOrder(queue)
            maskMesh.userData.officialMaterialProfiles = [profile]
            maskMesh.userData.officialStencilRole = 'selector-mask'
            maskMesh.onBeforeRender = forwardMesh.onBeforeRender

            mesh.add(forwardMesh)
            mesh.add(maskMesh)
            userData.meshes.push(forwardMesh, maskMesh)
            record.forwardMeshes.push(forwardMesh.name)
            record.maskMeshes.push(maskMesh.name)
        }
        selectors.push(record)
    }

    const mainGroups = mesh.geometry.groups.filter(
        (group: OfficialGeometryGroup) =>
            !selectorIndexSet.has(group.materialIndex ?? 0),
    )
    mesh.geometry.clearGroups()
    mainGroups.forEach((group: OfficialGeometryGroup) => {
        mesh.geometry.addGroup(group.start, group.count, group.materialIndex ?? 0)
    })
    return {
        selectors,
        remainingGroups: mainGroups.map((group: OfficialGeometryGroup) => ({
            start: group.start,
            count: group.count,
            materialIndex: group.materialIndex ?? 0,
        })),
    }
}
