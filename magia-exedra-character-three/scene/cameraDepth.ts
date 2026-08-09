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

function hasTransparentGem(material: THREE.Material | THREE.Material[]) {
    const materials = Array.isArray(material) ? material : [material]
    return materials.some(item => {
        const profile = item.userData instanceof MaterialUserData
            ? item.userData.officialMaterialProfile
            : item.userData?.officialMaterialProfile as
                | OfficialMaterialProfile
                | undefined
        return Boolean(profile?.gem.enabled && profile.gem.transparency)
    })
}

/**
 * Character-only CameraDepthTexture prepass for the bounded depth-rim study.
 * It reuses loader-created customDepthMaterial objects for authored alpha
 * cutouts and excludes proven transparent Gem draws. The target is lazy and
 * consumes no full-size GPU allocation while the experiment is disabled.
 */
export class ReDriveCameraDepthController {
    private readonly scene: MagiaExedraScene3D
    private readonly opaqueDepthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.BasicDepthPacking,
    })
    private renderTarget?: THREE.WebGLRenderTarget

    constructor(scene: MagiaExedraScene3D) {
        this.scene = scene
        this.opaqueDepthMaterial.name = 'ReDrive:CameraDepthOpaque'
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

        const characterMeshes = new Set<THREE.Mesh>()
        for (const entry of this.scene.characters) {
            for (const mesh of entry.character?.userData.meshes ?? []) {
                characterMeshes.add(mesh)
            }
        }
        if (characterMeshes.size === 0) {
            state.enabled.value = 0
            return
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
            // Native CameraDepthTexture excludes transparent queue draws. A
            // mixed mesh containing a transparent Gem is conservatively
            // excluded as one bounded unit until per-group queue evidence exists.
            if (hasTransparentGem(object.material)) {
                object.visible = false
                return
            }
            object.material =
                object.customDepthMaterial ?? this.opaqueDepthMaterial
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
        this.renderTarget = undefined
        reDriveCameraDepthUniformState.enabled.value = 0
    }
}

Object.assign(window, { DepthRimExperiment })

