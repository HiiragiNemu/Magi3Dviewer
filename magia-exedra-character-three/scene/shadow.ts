import * as THREE from 'three';
import { MagiaExedraScene3D } from '.'

export class SceneShadowController {
    scene: MagiaExedraScene3D
    camera: OrthographicCameraTransformController
    floor: THREE.Mesh

    static CameraSize = 4
    static CameraOffset = 0.8
    static FloorOpacity = 0

    constructor(scene: MagiaExedraScene3D) {
        this.scene = scene

        this.camera = new OrthographicCameraTransformController(this.shadowLight.shadow.camera)
        this.camera.camera.far = 50
        this.camera.size = SceneShadowController.CameraSize
        this.camera.offsetY = SceneShadowController.CameraOffset
        this.camera.helper.visible = false
        this.scene.scene.add(this.camera.helper)

        this.floor = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100),
            new THREE.ShadowMaterial({ transparent: true })
        )
        this.floor.rotation.x = -Math.PI / 2
        this.floor.receiveShadow = true
        this.scene.scene.add(this.floor)

        this.floorOpacity = SceneShadowController.FloorOpacity
    }

    get shadowLight() {
        return this.scene.directionalLight
    }

    get enabled() {
        return this.shadowLight.castShadow
    }

    set enabled(enabled) {
        this.shadowLight.castShadow = enabled
        if (!enabled) {
            this.removeShadowMap()
        }
    }

    get resolution() {
        return this.shadowLight.shadow.mapSize.x
    }

    set resolution(resolution) {
        if (this.resolution == resolution) return
        this.shadowLight.shadow.mapSize = new THREE.Vector2(resolution, resolution)
        this.removeShadowMap()
    }

    get bias() {
        return this.shadowLight.shadow.bias
    }

    set bias(bias) {
        this.shadowLight.shadow.bias = bias
    }

    removeShadowMap() {
        if (this.shadowLight.shadow.map) {
            this.shadowLight.shadow.map.dispose()
        }
        this.shadowLight.shadow.map = null
    }

    get floorOpacity() {
        if (this.floor.visible) {
            const mat = this.floor.material
            if (mat instanceof THREE.Material) {
                return mat.opacity
            } else if (mat.length > 0) {
                return mat[0].opacity
            } else {
                return 0
            }
        } else {
            return 0
        }
    }

    set floorOpacity(value) {
        if (value == 0) {
            this.floor.visible = false
        } else {
            this.floor.visible = true
            const mat = this.floor.material
            if (mat instanceof THREE.Material) {
                mat.opacity = value
            } else if (mat.length > 0) {
                mat[0].opacity = value
            }
        }
    }
}

export class OrthographicCameraTransformController {
    camera: THREE.OrthographicCamera
    helper: THREE.CameraHelper

    constructor(camera: THREE.OrthographicCamera) {
        this.camera = camera
        this.helper = new THREE.CameraHelper(this.camera);
    }

    get size() {
        return this.camera.top - this.camera.bottom
    }

    set size(value) {
        value /= 2

        const offsetX = this.offsetX
        const offsetY = this.offsetY

        this.camera.top = value
        this.camera.bottom = -value
        this.camera.right = value
        this.camera.left = -value

        this.offsetX = offsetX
        this.offsetY = offsetY

        this.update()
    }

    get offsetX() {
        return (this.camera.right + this.camera.left) / 2
    }

    get offsetY() {
        return (this.camera.top + this.camera.bottom) / 2
    }

    set offsetX(value) {
        const sizeHalf = (this.camera.right - this.camera.left) / 2
        this.camera.right = sizeHalf + value
        this.camera.left = -sizeHalf + value

        this.update()
    }

    set offsetY(value) {
        const sizeHalf = (this.camera.top - this.camera.bottom) / 2
        this.camera.top = sizeHalf + value
        this.camera.bottom = -sizeHalf + value

        this.update()
    }

    update() {
        this.camera.updateProjectionMatrix()
        this.helper.update()
    }
}