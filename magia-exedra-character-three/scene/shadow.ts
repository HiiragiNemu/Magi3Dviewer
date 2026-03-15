import * as THREE from 'three';
import { MagiaExedraScene3D } from '.'

export class SceneShadowController {
    scene: MagiaExedraScene3D
    floor: THREE.Mesh
    static FloorOpacity = 0

    constructor(scene: MagiaExedraScene3D) {
        this.scene = scene

        this.floor = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100),
            new THREE.ShadowMaterial({ transparent: true })
        )
        this.floor.rotation.x = -Math.PI / 2
        this.floor.receiveShadow = true
        this.scene.scene.add(this.floor)

        this.floorOpacity = SceneShadowController.FloorOpacity
    }

    get enabled() {
        return this.scene.directionalLight.castShadow
    }

    set enabled(enabled) {
        this.scene.directionalLight.castShadow = enabled
        if (!enabled) {
            this.removeShadowMap()
        }
    }

    get resolution() {
        return this.scene.directionalLight.shadow.mapSize.x
    }

    set resolution(resolution) {
        if (this.resolution == resolution) return
        this.scene.directionalLight.shadow.mapSize = new THREE.Vector2(resolution, resolution)
        this.removeShadowMap()
    }

    get bias() {
        return this.scene.directionalLight.shadow.bias
    }

    set bias(bias) {
        this.scene.directionalLight.shadow.bias = bias
    }

    removeShadowMap() {
        if (this.scene.directionalLight.shadow.map) {
            this.scene.directionalLight.shadow.map.dispose()
        }
        this.scene.directionalLight.shadow.map = null
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