import * as THREE from 'three';
import { MagiaExedraScene3D } from '.'

export class SceneShadowController {
    scene: MagiaExedraScene3D

    constructor(scene: MagiaExedraScene3D) {
        this.scene = scene
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
}