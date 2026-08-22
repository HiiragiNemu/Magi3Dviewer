import * as THREE from 'three'

export const STAGE_CHARACTER_SHADOW_CASTERS_ENABLED =
    'magiusStageCharacterShadowCastersEnabled'

interface ShadowProxyBinding {
    source: THREE.Mesh
    proxy: THREE.Mesh
    material: THREE.MeshBasicMaterial
    characterRoot: THREE.Object3D
}

/**
 * Mirrors only character shadow casters into the independently lit background
 * scene. The proxies write no colour or camera depth; they exist solely so an
 * official stage light can render the animated character into its shadow map.
 */
export class StageCharacterShadowBridge {
    readonly root = new THREE.Group()
    private bindingsByCharacter = new Map<THREE.Object3D, ShadowProxyBinding[]>()
    private _stageLayer = 0

    constructor(backgroundScene: THREE.Scene) {
        this.root.name = 'StageCharacterShadowCasters'
        backgroundScene.add(this.root)
    }

    get stageLayer() {
        return this._stageLayer
    }

    set stageLayer(value: number) {
        this._stageLayer = value
        for (const bindings of this.bindingsByCharacter.values()) {
            for (const binding of bindings) binding.proxy.layers.set(value)
        }
    }

    add(characterRoot: THREE.Object3D) {
        this.remove(characterRoot)
        characterRoot.updateMatrixWorld(true)
        const bindings: ShadowProxyBinding[] = []
        characterRoot.traverse(object => {
            if (!isMesh(object) || !object.castShadow) return
            const material = new THREE.MeshBasicMaterial()
            material.name = `${object.name}:stage-shadow-proxy`
            material.colorWrite = false
            material.depthWrite = false
            material.depthTest = false

            const proxy = createShadowProxy(object, material)
            proxy.name = `${object.name}:stage-shadow-caster`
            proxy.castShadow = true
            proxy.receiveShadow = false
            proxy.frustumCulled = false
            proxy.renderOrder = object.renderOrder
            proxy.customDepthMaterial = object.customDepthMaterial
            proxy.customDistanceMaterial = object.customDistanceMaterial
            installOfficialLightLayerShadowGate(proxy)
            proxy.matrixAutoUpdate = false
            proxy.matrixWorldAutoUpdate = false
            proxy.layers.set(this._stageLayer)
            this.root.add(proxy)
            bindings.push({
                source: object,
                proxy,
                material,
                characterRoot,
            })
        })
        this.bindingsByCharacter.set(characterRoot, bindings)
        this.updateBindings(bindings)
    }

    remove(characterRoot: THREE.Object3D) {
        const bindings = this.bindingsByCharacter.get(characterRoot)
        if (!bindings) return
        for (const binding of bindings) {
            this.root.remove(binding.proxy)
            binding.material.dispose()
        }
        this.bindingsByCharacter.delete(characterRoot)
    }

    update() {
        for (const [characterRoot, bindings] of this.bindingsByCharacter) {
            characterRoot.updateMatrixWorld(true)
            this.updateBindings(bindings)
        }
    }

    dispose() {
        for (const characterRoot of [...this.bindingsByCharacter.keys()]) {
            this.remove(characterRoot)
        }
        this.root.removeFromParent()
    }

    private updateBindings(bindings: readonly ShadowProxyBinding[]) {
        for (const binding of bindings) {
            const { source, proxy, characterRoot } = binding
            proxy.visible = isVisibleWithinCharacter(source, characterRoot)
            proxy.matrix.copy(source.matrixWorld)
            proxy.matrixWorld.copy(source.matrixWorld)
            proxy.matrixWorldNeedsUpdate = false
        }
    }
}

/**
 * Three renders every shadow caster visible to the render camera into every
 * light shadow map; Light.layers does not filter that shadow pass. Official
 * Unity lights do have per-light culling masks, so suppress this proxy's depth
 * write only while a background-only light renders its shadow camera.
 */
function installOfficialLightLayerShadowGate(proxy: THREE.Mesh) {
    let restoreDepthWrite: boolean | undefined
    let restoreColorWrite: boolean | undefined

    proxy.onBeforeShadow = (
        _renderer,
        _object,
        _camera,
        shadowCamera,
        _geometry,
        depthMaterial,
    ) => {
        if (
            shadowCamera.userData[STAGE_CHARACTER_SHADOW_CASTERS_ENABLED]
            !== false
        ) return
        restoreDepthWrite = depthMaterial.depthWrite
        restoreColorWrite = depthMaterial.colorWrite
        depthMaterial.depthWrite = false
        depthMaterial.colorWrite = false
    }
    proxy.onAfterShadow = (
        _renderer,
        _object,
        _camera,
        _shadowCamera,
        _geometry,
        depthMaterial,
    ) => {
        if (restoreDepthWrite == undefined || restoreColorWrite == undefined) {
            return
        }
        depthMaterial.depthWrite = restoreDepthWrite
        depthMaterial.colorWrite = restoreColorWrite
        restoreDepthWrite = undefined
        restoreColorWrite = undefined
    }
}

function createShadowProxy(
    source: THREE.Mesh,
    material: THREE.MeshBasicMaterial,
) {
    if (isSkinnedMesh(source)) {
        const proxy = new THREE.SkinnedMesh(source.geometry, material)
        proxy.bind(source.skeleton, source.bindMatrix)
        proxy.bindMode = source.bindMode
        proxy.morphTargetInfluences = source.morphTargetInfluences
        proxy.morphTargetDictionary = source.morphTargetDictionary
        return proxy
    }
    const proxy = new THREE.Mesh(source.geometry, material)
    proxy.morphTargetInfluences = source.morphTargetInfluences
    proxy.morphTargetDictionary = source.morphTargetDictionary
    return proxy
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
    return 'isMesh' in object && object.isMesh === true
}

function isSkinnedMesh(mesh: THREE.Mesh): mesh is THREE.SkinnedMesh {
    return 'isSkinnedMesh' in mesh && mesh.isSkinnedMesh === true
}

function isVisibleWithinCharacter(
    source: THREE.Object3D,
    characterRoot: THREE.Object3D,
) {
    let current: THREE.Object3D | null = source
    while (current) {
        if (!current.visible) return false
        if (current === characterRoot) return true
        current = current.parent
    }
    return false
}
