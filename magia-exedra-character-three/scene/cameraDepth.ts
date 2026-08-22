import * as THREE from 'three'
import type { MagiaExedraScene3D } from '.'
import type { OfficialMaterialProfile } from '../materialProfile'
import { MaterialUserData } from '../shaders/userdata'
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

const drawingBufferSize = new THREE.Vector2()

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

/**
 * Unity's CameraDepthTexture pass filters out the transparent render queue.
 * `_Transparency` is retained as a fallback for older generated profiles, but
 * the serialized `m_CustomRenderQueue` is the authoritative queue decision.
 */
function isOfficialTransparentQueue(profile?: OfficialMaterialProfile) {
    if (!profile) return false
    if (profile.customRenderQueue >= 0) {
        return profile.customRenderQueue >= 3000
    }
    return Boolean(profile.gem.transparency)
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

/**
 * Character-only CameraDepthTexture prepass for the recovered depth-rim path.
 * It reuses loader-created customDepthMaterial objects for authored alpha
 * cutouts and excludes only the proven transparent-queue draw groups. The target is lazy and
 * consumes no full-size GPU allocation while the path is disabled or no
 * visible official material requests `_UseDepthTex`.
 */
export class ReDriveCameraDepthController {
    private readonly scene: MagiaExedraScene3D
    private readonly opaqueDepthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.BasicDepthPacking,
    })
    private readonly skipDepthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.BasicDepthPacking,
    })
    private renderTarget?: THREE.WebGLRenderTarget

    constructor(scene: MagiaExedraScene3D) {
        this.scene = scene
        this.opaqueDepthMaterial.name = 'ReDrive:CameraDepthOpaque'
        this.skipDepthMaterial.name = 'ReDrive:CameraDepthTransparentQueueSkip'
        this.skipDepthMaterial.visible = false
    }

    /**
     * Preserve restored Unity submesh/material-slot boundaries in the depth
     * pass. A transparent Soul Gem or alpha-blended decoration must only omit
     * its own draw group; hiding the parent mesh also removes the neighbouring
     * opaque Body/Hair groups from CameraDepthTexture.
     */
    private createDepthMaterialAssignment(mesh: THREE.Mesh) {
        const forwardMaterials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
        const depthMaterial =
            mesh.customDepthMaterial ?? this.opaqueDepthMaterial

        if (forwardMaterials.length === 1) {
            const profile = getOfficialMaterialProfileForSlot(
                mesh,
                forwardMaterials[0],
                0,
            )
            return isOfficialTransparentQueue(profile)
                ? undefined
                : depthMaterial
        }

        // Three only selects array entries per BufferGeometry group. The
        // loader restores those ranges from official Unity m_SubMeshes before
        // binding one forward material per slot.
        if (mesh.geometry.groups.length === 0) {
            return forwardMaterials.some((material, index) =>
                isOfficialTransparentQueue(
                    getOfficialMaterialProfileForSlot(mesh, material, index),
                )
            )
                ? undefined
                : depthMaterial
        }

        return forwardMaterials.map((material, index) =>
            isOfficialTransparentQueue(
                getOfficialMaterialProfileForSlot(mesh, material, index),
            )
                ? this.skipDepthMaterial
                : depthMaterial
        )
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

        const characterMeshes = new Set<THREE.Mesh>()
        for (const entry of this.scene.characters) {
            for (const mesh of entry.character?.userData.meshes ?? []) {
                characterMeshes.add(mesh)
            }
        }
        if (
            characterMeshes.size === 0 ||
            ![...characterMeshes].some(meshUsesOfficialCameraDepth)
        ) {
            state.enabled.value = 0
            return
        }

        const renderer = this.scene.renderer
        renderer.getDrawingBufferSize(drawingBufferSize)
        const width = Math.max(1, Math.floor(drawingBufferSize.x))
        const height = Math.max(1, Math.floor(drawingBufferSize.y))
        const target = this.ensureRenderTarget(width, height)
        const camera = this.scene.camera

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

        const snapshots: MeshSnapshot[] = []
        this.scene.scene.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return
            snapshots.push({
                mesh: object,
                material: object.material,
                visible: object.visible,
            })
            if (!characterMeshes.has(object)) {
                object.visible = false
                return
            }
            const depthMaterial = this.createDepthMaterialAssignment(object)
            if (!depthMaterial) {
                object.visible = false
                return
            }
            object.material = depthMaterial
        })

        const previousTarget = renderer.getRenderTarget()
        const previousAutoClear = renderer.autoClear
        const previousXrEnabled = renderer.xr.enabled
        const previousClearColor = renderer.getClearColor(new THREE.Color())
        const previousClearAlpha = renderer.getClearAlpha()
        try {
            state.enabled.value = 0
            renderer.xr.enabled = false
            renderer.autoClear = true
            renderer.setClearColor(0x000000, 0)
            renderer.setRenderTarget(target)
            renderer.clear(true, true, false)
            renderer.render(this.scene.scene, camera)
            state.map.value = target.depthTexture!
            state.enabled.value = 1
        } finally {
            for (const snapshot of snapshots) {
                snapshot.mesh.material = snapshot.material
                snapshot.mesh.visible = snapshot.visible
            }
            renderer.setRenderTarget(previousTarget)
            renderer.setClearColor(previousClearColor, previousClearAlpha)
            renderer.autoClear = previousAutoClear
            renderer.xr.enabled = previousXrEnabled
        }
    }

    dispose() {
        this.renderTarget?.dispose()
        this.opaqueDepthMaterial.dispose()
        this.skipDepthMaterial.dispose()
        this.renderTarget = undefined
        reDriveCameraDepthUniformState.enabled.value = 0
    }
}

Object.assign(window, { DepthRimExperiment })
