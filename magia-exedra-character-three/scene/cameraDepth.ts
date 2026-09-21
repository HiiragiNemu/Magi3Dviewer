import * as THREE from 'three'
import type { MagiaExedraScene3D } from '.'
import type { OfficialMaterialProfile } from '../materialProfile'
import type { CharacterPerspectiveReference } from '../renderProfile'
import { MaterialUserData } from '../shaders/userdata'
import { injectCharacterPerspectiveCancellation } from '../shaders/perspective'
import {
    DepthRimExperiment,
    reDriveCameraDepthUniformState,
    updateDepthRimExperimentUniforms,
} from '../shaders/depthRim'

interface MeshSnapshot {
    mesh: THREE.Mesh
    material: THREE.Material | THREE.Material[]
    visible: boolean
}

interface RenderableVisibilitySnapshot {
    object: THREE.Object3D
    visible: boolean
}

interface DetachedDepthHelperSnapshot {
    object: THREE.Object3D
    parent: THREE.Object3D
    index: number
}

type DepthSourceMaterial = THREE.Material & {
    map?: THREE.Texture | null
    alphaMap?: THREE.Texture | null
    displacementMap?: THREE.Texture | null
    displacementScale?: number
    displacementBias?: number
}

const drawingBufferSize = new THREE.Vector2()
const officialOpaqueLayerMask = 0x7fffffff
const officialOpaqueRenderQueueMax = 2500

function getOfficialMaterialProfile(material: THREE.Material) {
    return material.userData instanceof MaterialUserData
        ? material.userData.officialMaterialProfile
        : material.userData?.officialMaterialProfile as
            | OfficialMaterialProfile
            | undefined
}

function getOfficialMaterialProfileForSlot(
    mesh: THREE.Mesh,
    material: THREE.Material,
    materialIndex: number,
) {
    const direct = getOfficialMaterialProfile(material)
    if (direct) return direct
    const profiles = mesh.userData?.officialMaterialProfiles as
        | OfficialMaterialProfile[]
        | undefined
    return profiles?.[materialIndex] ?? profiles?.[0]
}

function getOfficialRenderQueue(
    material: THREE.Material,
    profile?: OfficialMaterialProfile,
) {
    if (profile && profile.customRenderQueue >= 0) {
        return profile.customRenderQueue
    }
    const stageQueue = material.userData?.stageUnityMaterialState
        ?.effectiveRenderQueue
    if (Number.isFinite(stageQueue)) return Number(stageQueue)
    const enemyQueue = material.userData?.magiusEnemyRenderQueue
    if (Number.isFinite(enemyQueue)) return Number(enemyQueue)
    return undefined
}

/** Unity's `RenderQueueRange.opaque` ends at queue 2500. */
function isOfficialTransparentQueue(
    material: THREE.Material,
    profile?: OfficialMaterialProfile,
) {
    const queue = getOfficialRenderQueue(material, profile)
    if (queue != undefined) return queue > officialOpaqueRenderQueueMax
    return Boolean(
        material.transparent ||
        profile?.surface.transparency ||
        profile?.gem.transparency
    )
}

function meshUsesOfficialCameraDepth(mesh: THREE.Mesh) {
    const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]
    if (materials.some(material =>
        Boolean(getOfficialMaterialProfile(material)?.depthRim?.useDepthTex)
    )) return true
    const profiles = mesh.userData?.officialMaterialProfiles as
        | OfficialMaterialProfile[]
        | undefined
    return Boolean(profiles?.some(profile => profile.depthRim?.useDepthTex))
}

function isVisibleInHierarchy(object: THREE.Object3D) {
    let current: THREE.Object3D | null = object
    while (current) {
        if (!current.visible) return false
        current = current.parent
    }
    return true
}

function isOfficialCameraDepthLayer(
    object: THREE.Object3D,
    camera: THREE.Camera,
) {
    return Boolean(
        object.layers.mask &
        camera.layers.mask &
        officialOpaqueLayerMask
    )
}

function isNonMeshRenderable(object: THREE.Object3D) {
    const renderable = object as THREE.Object3D & {
        isLine?: boolean
        isPoints?: boolean
        isSprite?: boolean
    }
    return Boolean(
        renderable.isLine || renderable.isPoints || renderable.isSprite
    )
}

/**
 * CameraDepthTexture prepass for the recovered depth-rim path. TW's current
 * UniversalRenderer supplies camera-visible opaque geometry on layers 0-30;
 * the Viewer keeps stage and character lighting in separate scenes, so this
 * pass joins both scene roots into one uninterrupted depth target. The target
 * remains lazy and is only populated while a visible character draw requests
 * `_UseDepthTex`.
 */
export class ReDriveCameraDepthController {
    private readonly scene: MagiaExedraScene3D
    private readonly skipDepthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.BasicDepthPacking,
    })
    private readonly faceDepthMaterials = new Map<
        THREE.Mesh,
        Map<string, THREE.MeshDepthMaterial>
    >()
    private readonly sourceDepthMaterials = new Map<
        THREE.Material,
        THREE.MeshDepthMaterial
    >()
    private readonly faceCameraNear = { value: 0.1 }
    private renderTarget?: THREE.WebGLRenderTarget

    constructor(scene: MagiaExedraScene3D) {
        this.scene = scene
        this.skipDepthMaterial.name = 'ReDrive:CameraDepthTransparentQueueSkip'
        this.skipDepthMaterial.visible = false
    }

    /**
     * ReDriveToon DepthOnly blob432 (no face keyword), vertex lines 164-199,
     * applies the same perspective cancellation as the forward pass. Using
     * plain MeshDepthMaterial here makes Hair/Body sample a different surface.
     * Keep this camera-only wrapper separate from light shadow materials.
     */
    private getPerspectiveDepthMaterial(
        mesh: THREE.Mesh,
        baseDepthMaterial: THREE.MeshDepthMaterial,
        forwardMaterial: THREE.Material,
    ) {
        const reference = mesh.userData?.characterPerspectiveReference as
            | CharacterPerspectiveReference
            | undefined
        // WebGLShadowMap mutates customDepthMaterial.side for light shadows.
        // Even without perspective cancellation the camera must own its copy.
        if (!reference && baseDepthMaterial !== mesh.customDepthMaterial) {
            return baseDepthMaterial
        }
        const cacheKey = [
            baseDepthMaterial.uuid,
            forwardMaterial.uuid,
            reference ? 'character-perspective' : 'camera-only',
        ].join(':')
        let meshMaterials = this.faceDepthMaterials.get(mesh)
        if (!meshMaterials) {
            meshMaterials = new Map()
            this.faceDepthMaterials.set(mesh, meshMaterials)
        }
        const cached = meshMaterials.get(cacheKey)
        if (cached) {
            const programChanged =
                cached.map !== baseDepthMaterial.map ||
                cached.alphaMap !== baseDepthMaterial.alphaMap ||
                cached.alphaTest !== baseDepthMaterial.alphaTest ||
                cached.side !== forwardMaterial.side ||
                cached.displacementMap !== baseDepthMaterial.displacementMap ||
                cached.alphaToCoverage !== baseDepthMaterial.alphaToCoverage
            cached.map = baseDepthMaterial.map
            cached.alphaMap = baseDepthMaterial.alphaMap
            cached.alphaTest = baseDepthMaterial.alphaTest
            cached.alphaToCoverage = baseDepthMaterial.alphaToCoverage
            cached.side = forwardMaterial.side
            cached.displacementMap = baseDepthMaterial.displacementMap
            cached.displacementScale = baseDepthMaterial.displacementScale
            cached.displacementBias = baseDepthMaterial.displacementBias
            cached.clippingPlanes = baseDepthMaterial.clippingPlanes
            cached.clipIntersection = baseDepthMaterial.clipIntersection
            cached.clipShadows = baseDepthMaterial.clipShadows
            if (programChanged) cached.needsUpdate = true
            // The camera-only program owns its own cutout controller. The
            // GUI updates the original light-shadow material separately.
            cached.userData.shaderUniforms?.loadGlobalOptions()
            return cached
        }

        const depthMaterial = baseDepthMaterial.clone()
        depthMaterial.side = forwardMaterial.side
        depthMaterial.onBeforeRender = baseDepthMaterial.onBeforeRender
        depthMaterial.name = 'ReDrive:CharacterDepthOnly:' + baseDepthMaterial.name
        const depthUserData = new MaterialUserData()
        depthMaterial.userData = depthUserData
        const baseOnBeforeCompile = baseDepthMaterial.onBeforeCompile
        const baseProgramCacheKey =
            baseDepthMaterial.customProgramCacheKey.bind(baseDepthMaterial)
        depthMaterial.customProgramCacheKey = () =>
            baseProgramCacheKey() + (reference
                ? ':redrive-character-depth-perspective'
                : ':redrive-camera-depth-only')
        depthMaterial.onBeforeCompile = (shader, renderer) => {
            // Authored alpha hooks may close over the original userData
            // instead of using `this`. Do not replace its shadow controller
            // when compiling this camera-only wrapper.
            const baseUserData = baseDepthMaterial.userData
            const previousShader = baseUserData.shader
            const previousUniforms = baseUserData.shaderUniforms
            try {
                baseOnBeforeCompile.call(depthMaterial, shader, renderer)
                if (baseUserData.shader === shader) {
                    depthUserData.shaderUniforms = baseUserData.shaderUniforms
                }
            } finally {
                baseUserData.shader = previousShader
                baseUserData.shaderUniforms = previousUniforms
            }
            injectCharacterPerspectiveCancellation(shader, reference)
            depthUserData.shader = shader
        }
        meshMaterials.set(cacheKey, depthMaterial)
        return depthMaterial
    }

    private getFaceDepthMaterial(
        mesh: THREE.Mesh,
        baseDepthMaterial: THREE.MeshDepthMaterial,
        forwardMaterial: THREE.Material,
        profile: OfficialMaterialProfile | undefined,
    ) {
        if (!profile?.face.isFace) {
            return this.getPerspectiveDepthMaterial(
                mesh, baseDepthMaterial, forwardMaterial,
            )
        }
        const reference = mesh.userData?.characterPerspectiveReference as
            | CharacterPerspectiveReference
            | undefined
        const offset = profile.face.cameraDepthTextureZWriteOffset
        const cacheKey = [
            baseDepthMaterial.uuid,
            forwardMaterial.uuid,
            String(offset),
            String(profile.depthRim.ditherFade),
            reference ? 'perspective' : 'plain',
        ].join(':')
        let meshMaterials = this.faceDepthMaterials.get(mesh)
        if (!meshMaterials) {
            meshMaterials = new Map()
            this.faceDepthMaterials.set(mesh, meshMaterials)
        }
        const cached = meshMaterials.get(cacheKey)
        if (cached) {
            if (cached.side !== forwardMaterial.side) {
                cached.side = forwardMaterial.side
                cached.needsUpdate = true
            }
            cached.userData.shaderUniforms?.loadGlobalOptions()
            return cached
        }

        const depthMaterial = baseDepthMaterial.clone()
        depthMaterial.side = forwardMaterial.side
        depthMaterial.onBeforeRender = baseDepthMaterial.onBeforeRender
        depthMaterial.name =
            `ReDrive:FaceDepthOnly:${profile.name}:${offset}`
        const depthUserData = new MaterialUserData()
        depthMaterial.userData = depthUserData
        const baseOnBeforeCompile = baseDepthMaterial.onBeforeCompile
        const baseProgramCacheKey =
            baseDepthMaterial.customProgramCacheKey.bind(depthMaterial)
        depthMaterial.customProgramCacheKey = () => [
            baseProgramCacheKey(),
            'redrive-face-depth-only',
            String(offset),
            reference ? 'perspective' : 'plain',
        ].join(':')
        depthMaterial.onBeforeCompile = (shader, renderer) => {
            // A custom alpha hook may capture the light-shadow userData.
            // Keep the camera controller independent, including on exceptions.
            const baseUserData = baseDepthMaterial.userData
            const previousShader = baseUserData.shader
            const previousUniforms = baseUserData.shaderUniforms
            try {
                baseOnBeforeCompile.call(depthMaterial, shader, renderer)
                if (baseUserData.shader === shader) {
                    depthUserData.shaderUniforms = baseUserData.shaderUniforms
                }
            } finally {
                baseUserData.shader = previousShader
                baseUserData.shaderUniforms = previousUniforms
            }
            shader.uniforms.uRdFaceAreaCameraDepthTextureZWriteOffset = {
                value: offset,
            }
            shader.uniforms.uRdCameraNear = this.faceCameraNear
            shader.uniforms.uRdFaceDepthDitherFade = {
                value: profile.depthRim.ditherFade,
            }

            injectCharacterPerspectiveCancellation(shader, reference)
            shader.vertexShader = /* glsl */ `
                uniform float uRdFaceAreaCameraDepthTextureZWriteOffset;
                uniform float uRdCameraNear;
                ${shader.vertexShader}
            `.replace(
                '#include <project_vertex>',
                /* glsl */ `
                #include <project_vertex>
                if (
                    abs(uRdFaceAreaCameraDepthTextureZWriteOffset) >
                    0.0000001
                ) {
                    if (isPerspectiveMatrix(projectionMatrix)) {
                        float rdFaceOffsetEye = max(
                            abs(gl_Position.w) +
                            uRdFaceAreaCameraDepthTextureZWriteOffset,
                            uRdCameraNear + 5.96046448e-08
                        );
                        gl_Position.z = gl_Position.w * (
                            (-rdFaceOffsetEye) *
                            projectionMatrix[2][2] +
                            projectionMatrix[3][2]
                        ) / rdFaceOffsetEye;
                    } else {
                        gl_Position.z +=
                            -uRdFaceAreaCameraDepthTextureZWriteOffset *
                            projectionMatrix[2][2];
                    }
                }
                `,
            )
            shader.fragmentShader = /* glsl */ `
                uniform float uRdFaceDepthDitherFade;

                float rdFaceDepthDitherBayer(ivec2 pixel) {
                    int x = int(mod(float(pixel.x), 4.0));
                    int y = int(mod(float(pixel.y), 4.0));
                    int index = x * 4 + y;
                    if (index == 0) return 0.0588235296;
                    if (index == 1) return 0.529411793;
                    if (index == 2) return 0.176470593;
                    if (index == 3) return 0.647058845;
                    if (index == 4) return 0.764705896;
                    if (index == 5) return 0.294117659;
                    if (index == 6) return 0.882352948;
                    if (index == 7) return 0.411764711;
                    if (index == 8) return 0.235294119;
                    if (index == 9) return 0.70588237;
                    if (index == 10) return 0.117647059;
                    if (index == 11) return 0.588235319;
                    if (index == 12) return 0.941176474;
                    if (index == 13) return 0.470588237;
                    if (index == 14) return 0.823529422;
                    return 0.352941185;
                }
                ${shader.fragmentShader}
            `.replace(
                '#include <alphatest_fragment>',
                /* glsl */ `
                #include <alphatest_fragment>
                float rdFaceDepthDitherValue = rdFaceDepthDitherBayer(
                    ivec2(gl_FragCoord.xy)
                );
                float rdFaceDepthDitherTest =
                    (1.0 - uRdFaceDepthDitherFade) -
                    (
                        uRdFaceDepthDitherFade *
                        (0.5 - rdFaceDepthDitherValue) +
                        0.5
                    );
                if (rdFaceDepthDitherTest < 0.0) discard;
                `,
            )
            depthUserData.shader = shader
        }
        meshMaterials.set(cacheKey, depthMaterial)
        return depthMaterial
    }

    private pruneFaceDepthMaterials(activeMeshes: Set<THREE.Mesh>) {
        for (const [mesh, materials] of this.faceDepthMaterials) {
            if (activeMeshes.has(mesh)) continue
            // Plain custom-depth wrappers can also belong to the stage. Keep
            // attached camera-scene owners; a stage unload detaches its tree.
            let current: THREE.Object3D | null = mesh
            while (current) {
                if (
                    current === this.scene.scene ||
                    (this.scene.backgroundSceneEnabled &&
                        current === this.scene.backgroundScene)
                ) break
                current = current.parent
            }
            if (current) continue
            for (const material of materials.values()) material.dispose()
            this.faceDepthMaterials.delete(mesh)
        }
    }

    private getSourceDepthMaterial(
        mesh: THREE.Mesh,
        sourceMaterial: THREE.Material,
        activeSourceMaterials: Set<THREE.Material>,
    ) {
        if (mesh.customDepthMaterial) {
            return mesh.customDepthMaterial as THREE.MeshDepthMaterial
        }

        activeSourceMaterials.add(sourceMaterial)
        let depthMaterial = this.sourceDepthMaterials.get(sourceMaterial)
        if (!depthMaterial) {
            depthMaterial = new THREE.MeshDepthMaterial({
                depthPacking: THREE.BasicDepthPacking,
            })
            depthMaterial.name =
                `ReDrive:CameraDepthSource:${sourceMaterial.name}`
            this.sourceDepthMaterials.set(sourceMaterial, depthMaterial)
        }

        const source = sourceMaterial as DepthSourceMaterial
        const alphaCutout = sourceMaterial.alphaTest > 0
        const map = alphaCutout ? source.map ?? null : null
        const alphaMap = alphaCutout ? source.alphaMap ?? null : null
        const displacementMap = source.displacementMap ?? null
        const requiresProgramUpdate =
            depthMaterial.map !== map ||
            depthMaterial.alphaMap !== alphaMap ||
            depthMaterial.displacementMap !== displacementMap ||
            depthMaterial.alphaTest !== sourceMaterial.alphaTest ||
            depthMaterial.side !== sourceMaterial.side

        depthMaterial.map = map
        depthMaterial.alphaMap = alphaMap
        depthMaterial.alphaTest = sourceMaterial.alphaTest
        depthMaterial.alphaToCoverage = sourceMaterial.alphaToCoverage
        depthMaterial.side = sourceMaterial.side
        depthMaterial.displacementMap = displacementMap
        depthMaterial.displacementScale = source.displacementScale ?? 1
        depthMaterial.displacementBias = source.displacementBias ?? 0
        depthMaterial.clippingPlanes = sourceMaterial.clippingPlanes
        depthMaterial.clipIntersection = sourceMaterial.clipIntersection
        depthMaterial.clipShadows = sourceMaterial.clipShadows
        if (requiresProgramUpdate) depthMaterial.needsUpdate = true
        return depthMaterial
    }

    private pruneSourceDepthMaterials(
        activeSourceMaterials: Set<THREE.Material>,
    ) {
        for (const [source, depthMaterial] of this.sourceDepthMaterials) {
            if (activeSourceMaterials.has(source)) continue
            depthMaterial.dispose()
            this.sourceDepthMaterials.delete(source)
        }
    }

    private isViewerAuxiliaryDepthMesh(mesh: THREE.Mesh) {
        const stencilRole = mesh.userData?.officialStencilRole
        if (stencilRole === 'selector-mask') return true
        if (mesh.name.includes(':official-outline:')) return true

        let current: THREE.Object3D | null = mesh
        while (current) {
            if (current === this.scene.stageCharacterShadows.root) return true
            current = current.parent
        }
        return false
    }

    private isViewerDepthHelperRoot(object: THREE.Object3D) {
        const helper = object as THREE.Object3D & {
            isTransformControlsRoot?: boolean
        }
        return Boolean(
            helper.isTransformControlsRoot ||
            object.type === 'AxesHelper' ||
            object.type === 'CameraHelper' ||
            object === this.scene.stageCharacterShadows.root
        )
    }

    private collectViewerDepthHelperRoots(
        parent: THREE.Object3D,
        snapshots: DetachedDepthHelperSnapshot[],
    ) {
        const children = [...parent.children]
        for (let index = 0; index < children.length; index += 1) {
            const object = children[index]
            if (this.isViewerDepthHelperRoot(object)) {
                snapshots.push({ object, parent, index })
                continue
            }
            this.collectViewerDepthHelperRoots(object, snapshots)
        }
    }

    private detachViewerDepthHelperRoots(
        root: THREE.Scene,
        snapshots: DetachedDepthHelperSnapshot[],
    ) {
        const start = snapshots.length
        this.collectViewerDepthHelperRoots(root, snapshots)
        for (
            let index = snapshots.length - 1;
            start <= index;
            index -= 1
        ) {
            const snapshot = snapshots[index]
            const currentIndex = snapshot.parent.children.indexOf(
                snapshot.object,
            )
            if (0 <= currentIndex) {
                snapshot.parent.children.splice(currentIndex, 1)
            }
            snapshot.object.parent = null
        }
    }

    private restoreViewerDepthHelperRoots(
        snapshots: DetachedDepthHelperSnapshot[],
    ) {
        for (let index = 0; index < snapshots.length; index += 1) {
            const snapshot = snapshots[index]
            const currentIndex = snapshot.parent.children.indexOf(
                snapshot.object,
            )
            if (0 <= currentIndex) {
                snapshot.parent.children.splice(currentIndex, 1)
            }
            snapshot.parent.children.splice(
                Math.min(snapshot.index, snapshot.parent.children.length),
                0,
                snapshot.object,
            )
            snapshot.object.parent = snapshot.parent
        }
    }
    /**
     * Preserve restored Unity submesh/material-slot boundaries in the depth
     * pass. A transparent Soul Gem or alpha-blended decoration must only omit
     * its own draw group; hiding the parent mesh also removes the neighbouring
     * opaque Body/Hair groups from CameraDepthTexture.
     */
    private createDepthMaterialAssignment(
        mesh: THREE.Mesh,
        activeSourceMaterials: Set<THREE.Material>,
    ) {
        const forwardMaterials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
        const slots = forwardMaterials.map((material, index) => {
            const profile = getOfficialMaterialProfileForSlot(
                mesh,
                material,
                index,
            )
            const transparent = isOfficialTransparentQueue(material, profile)
            const baseDepthMaterial = transparent
                ? this.skipDepthMaterial
                : this.getSourceDepthMaterial(
                    mesh,
                    material,
                    activeSourceMaterials,
                )
            return {
                material,
                profile,
                transparent,
                depthMaterial: transparent
                    ? this.skipDepthMaterial
                    : this.getFaceDepthMaterial(
                        mesh,
                        baseDepthMaterial,
                        material,
                        profile,
                    ),
            }
        })
        const faceSlots = slots
            .map((slot, materialIndex) => ({
                materialIndex,
                materialName: slot.profile?.name ?? slot.material.name,
                isFace: Boolean(slot.profile?.face.isFace),
                transparentQueue: slot.transparent,
                cameraDepthTextureZWriteOffset:
                    slot.profile?.face.cameraDepthTextureZWriteOffset ?? 0,
                ditherFade: slot.profile?.depthRim.ditherFade ?? 0,
            }))
            .filter(slot => slot.isFace)
        if (faceSlots.length > 0) {
            mesh.userData.officialFaceCameraDepthRuntime = {
                pass: 'DepthOnly',
                keyword: '_ISFACE',
                profileDriven: true,
                perspectiveCancellation: Boolean(
                    mesh.userData?.characterPerspectiveReference,
                ),
                slots: faceSlots,
            }
        } else {
            delete mesh.userData.officialFaceCameraDepthRuntime
        }

        if (forwardMaterials.length === 1) {
            return slots[0].depthMaterial
        }

        // Three only selects array entries per BufferGeometry group. The
        // loader restores those ranges from official Unity m_SubMeshes before
        // binding one forward material per slot.
        if (mesh.geometry.groups.length === 0) {
            return slots.some(slot => slot.transparent)
                ? this.skipDepthMaterial
                : slots[0].depthMaterial
        }

        return slots.map(slot =>
            slot.transparent
                ? this.skipDepthMaterial
                : slot.depthMaterial
        )
    }

    private prepareSceneDepth(
        root: THREE.Scene,
        camera: THREE.Camera,
        meshSnapshots: MeshSnapshot[],
        renderableSnapshots: RenderableVisibilitySnapshot[],
        activeSourceMaterials: Set<THREE.Material>,
    ) {
        root.traverse(object => {
            if (!(object instanceof THREE.Mesh)) {
                if (isNonMeshRenderable(object) && object.visible) {
                    renderableSnapshots.push({
                        object,
                        visible: object.visible,
                    })
                    object.visible = false
                }
                return
            }

            meshSnapshots.push({
                mesh: object,
                material: object.material,
                visible: object.visible,
            })
            if (!isVisibleInHierarchy(object)) return

            if (
                !isOfficialCameraDepthLayer(object, camera) ||
                this.isViewerAuxiliaryDepthMesh(object)
            ) {
                object.material = this.skipDepthMaterial
                return
            }

            object.material = this.createDepthMaterialAssignment(
                object,
                activeSourceMaterials,
            )
        })
    }

    private ensureRenderTarget(width: number, height: number) {
        if (!this.renderTarget) {
            const depthTexture = new THREE.DepthTexture(
                width,
                height,
                THREE.UnsignedIntType,
            )
            depthTexture.format = THREE.DepthFormat
            depthTexture.minFilter = THREE.NearestFilter
            depthTexture.magFilter = THREE.NearestFilter
            depthTexture.generateMipmaps = false
            depthTexture.name = 'ReDrive:_CameraDepthTexture'

            this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
                depthBuffer: true,
                stencilBuffer: false,
                minFilter: THREE.NearestFilter,
                magFilter: THREE.NearestFilter,
            })
            this.renderTarget.texture.name = 'ReDrive:CameraDepthColorUnused'
            this.renderTarget.texture.generateMipmaps = false
            this.renderTarget.depthTexture = depthTexture
        } else if (
            this.renderTarget.width !== width ||
            this.renderTarget.height !== height
        ) {
            this.renderTarget.setSize(width, height)
        }
        return this.renderTarget
    }

    render() {
        const state = reDriveCameraDepthUniformState
        updateDepthRimExperimentUniforms()
        if (!DepthRimExperiment.enabled) {
            state.enabled.value = 0
            return
        }

        const camera = this.scene.camera
        const characterMeshes = new Set<THREE.Mesh>()
        for (const entry of this.scene.characters) {
            for (const mesh of entry.character?.userData.meshes ?? []) {
                characterMeshes.add(mesh)
            }
        }
        this.pruneFaceDepthMaterials(characterMeshes)
        if (
            characterMeshes.size === 0 ||
            ![...characterMeshes].some(mesh =>
                isVisibleInHierarchy(mesh) &&
                isOfficialCameraDepthLayer(mesh, camera) &&
                !this.isViewerAuxiliaryDepthMesh(mesh) &&
                meshUsesOfficialCameraDepth(mesh)
            )
        ) {
            state.enabled.value = 0
            return
        }

        const renderer = this.scene.renderer
        renderer.getDrawingBufferSize(drawingBufferSize)
        const width = Math.max(1, Math.floor(drawingBufferSize.x))
        const height = Math.max(1, Math.floor(drawingBufferSize.y))
        const target = this.ensureRenderTarget(width, height)
        this.faceCameraNear.value = camera.near

        state.viewportSize.value.set(width, height)
        state.nearFar.value.set(camera.near, camera.far)
        state.aspectFix.value.set(height / width, 1)
        if (camera instanceof THREE.OrthographicCamera) {
            const halfHeight =
                Math.abs(camera.top - camera.bottom) /
                (2 * Math.max(camera.zoom, 0.0001))
            state.orthographic.value = 1
            state.fovOrOrthoFix.value =
                1 / Math.max(halfHeight * 100, 0.0001)
        } else {
            state.orthographic.value = 0
            state.fovOrOrthoFix.value =
                1 / Math.max(camera.fov, 0.0001)
        }

        const meshSnapshots: MeshSnapshot[] = []
        const renderableSnapshots: RenderableVisibilitySnapshot[] = []
        const detachedHelperSnapshots: DetachedDepthHelperSnapshot[] = []
        const activeSourceMaterials = new Set<THREE.Material>()
        const previousTarget = renderer.getRenderTarget()
        const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate
        const previousShadowNeedsUpdate = renderer.shadowMap.needsUpdate
        const previousAutoClear = renderer.autoClear
        const previousXrEnabled = renderer.xr.enabled
        const previousClearColor = renderer.getClearColor(new THREE.Color())
        const previousClearAlpha = renderer.getClearAlpha()
        let depthReady = false
        try {
            state.enabled.value = 0
            if (this.scene.backgroundSceneEnabled) {
                this.detachViewerDepthHelperRoots(
                    this.scene.backgroundScene,
                    detachedHelperSnapshots,
                )
            }
            this.detachViewerDepthHelperRoots(
                this.scene.scene,
                detachedHelperSnapshots,
            )
            if (this.scene.backgroundSceneEnabled) {
                this.prepareSceneDepth(
                    this.scene.backgroundScene,
                    camera,
                    meshSnapshots,
                    renderableSnapshots,
                    activeSourceMaterials,
                )
            }
            this.prepareSceneDepth(
                this.scene.scene,
                camera,
                meshSnapshots,
                renderableSnapshots,
                activeSourceMaterials,
            )
            this.pruneSourceDepthMaterials(activeSourceMaterials)

            // Only this depth target is consumed; normal colour rendering owns
            // light-shadow updates with the original caster materials restored.
            renderer.shadowMap.autoUpdate = false
            renderer.shadowMap.needsUpdate = false
            renderer.xr.enabled = false
            renderer.autoClear = false
            renderer.setClearColor(0x000000, 0)
            renderer.setRenderTarget(target)
            renderer.clear(true, true, false)
            if (this.scene.backgroundSceneEnabled) {
                renderer.render(this.scene.backgroundScene, camera)
            }
            renderer.render(this.scene.scene, camera)
            state.map.value = target.depthTexture!
            state.enabled.value = 1
            depthReady = true
        } finally {
            if (!depthReady) state.enabled.value = 0
            for (const snapshot of meshSnapshots) {
                snapshot.mesh.material = snapshot.material
                snapshot.mesh.visible = snapshot.visible
            }
            for (const snapshot of renderableSnapshots) {
                snapshot.object.visible = snapshot.visible
            }
            this.restoreViewerDepthHelperRoots(detachedHelperSnapshots)
            renderer.setRenderTarget(previousTarget)
            renderer.setClearColor(previousClearColor, previousClearAlpha)
            renderer.shadowMap.autoUpdate = previousShadowAutoUpdate
            renderer.shadowMap.needsUpdate = previousShadowNeedsUpdate
            renderer.autoClear = previousAutoClear
            renderer.xr.enabled = previousXrEnabled
        }
    }

    dispose() {
        this.renderTarget?.dispose()
        this.skipDepthMaterial.dispose()
        for (const material of this.sourceDepthMaterials.values()) {
            material.dispose()
        }
        this.sourceDepthMaterials.clear()
        for (const materials of this.faceDepthMaterials.values()) {
            for (const material of materials.values()) material.dispose()
        }
        this.faceDepthMaterials.clear()
        this.renderTarget = undefined
        reDriveCameraDepthUniformState.enabled.value = 0
    }
}

Object.assign(window, { DepthRimExperiment })
