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

    private get _shadowLight() {
        return this.scene.directionalLight
    }

    get enabled() {
        return this._shadowLight.castShadow
    }

    set enabled(enabled) {
        this._shadowLight.castShadow = enabled
        if (!enabled) {
            this.removeShadowMap()
        }
    }

    get resolution() {
        return this._shadowLight.shadow.mapSize.x
    }

    set resolution(resolution) {
        if (this.resolution == resolution) return
        this._shadowLight.shadow.mapSize = new THREE.Vector2(resolution, resolution)
        this.removeShadowMap()
    }

    get bias() {
        return this._shadowLight.shadow.bias
    }

    set bias(bias) {
        this._shadowLight.shadow.bias = bias
    }

    removeShadowMap() {
        if (this._shadowLight.shadow.map) {
            this._shadowLight.shadow.map.dispose()
        }
        this._shadowLight.shadow.map = null
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