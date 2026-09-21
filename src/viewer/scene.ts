import * as THREE from 'three'
import { MagiaExedraScene3D } from 'magia-exedra-character-three/scene'
import {
    getCharacterReDriveProfile,
} from 'magia-exedra-character-three/renderProfile'
import {
    createFaceDirectionReference,
} from 'magia-exedra-character-three/faceProfile'
import {
    getReDriveCharacterLightingDirectionState,
} from 'magia-exedra-character-three/shaders/stylization'
import {
    angelRingOptions,
    collectOfficialAngelRingRuntime,
} from 'magia-exedra-character-three/shaders/hair'
import { characters } from './character';
import {
    getCombatVfxDebugState,
    installCombatVfxRuntime,
} from './combatVfx'

export const viewerEl = document.getElementById('viewer')!

export const scene = new MagiaExedraScene3D(characters)
installCombatVfxRuntime(scene)

/**
 * ReDrive scenes use directional key light plus SH/sky fill rather than a very
 * strong flat AmbientLight. These two lights provide a visible neutral research
 * baseline until an official stage ReDriveVolume overrides the scene profile.
 */
export const recoveredHemisphereLight = new THREE.HemisphereLight(
    '#b9d2ff',
    '#75677f',
    0.78,
)
recoveredHemisphereLight.name = 'MagiusRecoveredHemisphereFill'
scene.scene.add(recoveredHemisphereLight)

export const recoveredFillLight = new THREE.DirectionalLight('#91b4ff', 0.42)
recoveredFillLight.name = 'MagiusRecoveredBackFill'
recoveredFillLight.position.set(-4.5, 2.8, -4.0)
recoveredFillLight.target.position.set(0, 1.25, 0)
scene.scene.add(recoveredFillLight)
scene.scene.add(recoveredFillLight.target)

viewerEl.appendChild(scene.renderer.domElement)

let viewportWidth = 0
let viewportHeight = 0
const syncSceneViewport = () => {
    const width = Math.max(1, viewerEl.clientWidth)
    const height = Math.max(1, viewerEl.clientHeight)
    if (width == viewportWidth && height == viewportHeight) return
    viewportWidth = width
    viewportHeight = height
    scene.setViewportSize(width, height)
}

const viewerResizeObserver = new ResizeObserver(syncSceneViewport)
viewerResizeObserver.observe(viewerEl)
requestAnimationFrame(syncSceneViewport)

const renderDebugStateId = 'magius-render-debug-state'
const renderDebugState = document.createElement('script')
renderDebugState.id = renderDebugStateId
renderDebugState.type = 'application/json'
renderDebugState.hidden = true
document.body.appendChild(renderDebugState)
const renderDebugRequest = document.createElement('button')
renderDebugRequest.id = 'magius-render-debug-request'
renderDebugRequest.type = 'button'
renderDebugRequest.tabIndex = -1
renderDebugRequest.ariaHidden = 'true'
Object.assign(renderDebugRequest.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '2px',
    height: '2px',
    margin: '0',
    padding: '0',
    border: '0',
    opacity: '0.001',
    zIndex: '2147483647',
})
document.body.appendChild(renderDebugRequest)

type RenderDebugLightmapMaterial = THREE.Material & {
    lightMap?: THREE.Texture | null
    lightMapIntensity?: number
}

const renderDebugLightmapBaselines = new WeakMap<THREE.Material, number>()
const renderDebugPunctualLightBaselines = new WeakMap<THREE.Light, boolean>()
const renderDebugDirectionalLightBaselines = new WeakMap<THREE.Light, boolean>()
const renderDebugProbeLightBaselines = new WeakMap<THREE.Light, boolean>()
const renderDebugMaterialVisibilityBaselines = new WeakMap<THREE.Material, boolean>()
const renderDebugMetallicBaselines = new WeakMap<THREE.MeshStandardMaterial, {
    metalness: number
    metalnessMap: THREE.Texture | null
}>()
const renderDebugReflectionBaselines = new WeakMap<
    THREE.MeshStandardMaterial,
    THREE.Texture | null
>()
let renderDebugBackgroundEnvironmentBaseline: THREE.Texture | null = null
let renderDebugBackgroundEnvironmentDisabled = false
const renderDebugVertexBlendBaselines = new WeakMap<
    THREE.MeshStandardMaterial,
    boolean
>()
const renderDebugBaseMapBaselines = new WeakMap<
    THREE.Mesh,
    THREE.Material | THREE.Material[]
>()

const getActiveDebugStageObject = () => {
    const root = scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot')
    const stageId = root?.userData.stageDefinition?.id
    return typeof stageId === 'string'
        ? root?.getObjectByName(`Stage:${stageId}`)
        : undefined
}

const toggleRenderDebugLightmaps = () => {
    const materials = new Set<RenderDebugLightmapMaterial>()
    getActiveDebugStageObject()?.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        const objectMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material]
        objectMaterials.forEach(material => {
            const candidate = material as RenderDebugLightmapMaterial
            if (candidate.lightMap && candidate.lightMapIntensity != undefined) {
                materials.add(candidate)
            }
        })
    })
    const restoring = [...materials].every(
        material => material.lightMapIntensity === 0,
    )
    materials.forEach(material => {
        if (restoring) {
            material.lightMapIntensity =
                renderDebugLightmapBaselines.get(material) ?? 1
        } else {
            renderDebugLightmapBaselines.set(
                material,
                material.lightMapIntensity ?? 1,
            )
            material.lightMapIntensity = 0
        }
    })
}

const toggleRenderDebugBackgroundLights = (
    predicate: (object: THREE.Object3D) => object is THREE.Light,
    baselines: WeakMap<THREE.Light, boolean>,
) => {
    const lights: THREE.Light[] = []
    scene.backgroundScene.traverse(object => {
        if (predicate(object)) lights.push(object)
    })
    const restoring = lights.length > 0 && lights.every(light => !light.visible)
    lights.forEach(light => {
        if (restoring) {
            light.visible = baselines.get(light) ?? true
        } else {
            baselines.set(light, light.visible)
            light.visible = false
        }
    })
}

const toggleRenderDebugStageMaterialClass = (
    predicate: (material: THREE.Material) => boolean,
) => {
    const materials = new Set<THREE.Material>()
    getActiveDebugStageObject()?.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        const objectMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material]
        objectMaterials.forEach(material => {
            if (predicate(material)) materials.add(material)
        })
    })
    const restoring = materials.size > 0
        && [...materials].every(material => !material.visible)
    materials.forEach(material => {
        if (restoring) {
            material.visible = renderDebugMaterialVisibilityBaselines.get(material)
                ?? true
        } else {
            renderDebugMaterialVisibilityBaselines.set(material, material.visible)
            material.visible = false
        }
    })
}

const toggleRenderDebugMetallicWorkflow = () => {
    const materials = new Set<THREE.MeshStandardMaterial>()
    getActiveDebugStageObject()?.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        const objectMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material]
        objectMaterials.forEach(material => {
            if (
                material instanceof THREE.MeshStandardMaterial
                && (
                    material.metalnessMap
                    || renderDebugMetallicBaselines.has(material)
                )
            ) materials.add(material)
        })
    })
    const restoring = materials.size > 0
        && [...materials].every(material => material.metalness === 0
            && material.metalnessMap == null)
    materials.forEach(material => {
        if (restoring) {
            const baseline = renderDebugMetallicBaselines.get(material)
            material.metalness = baseline?.metalness ?? 0
            material.metalnessMap = baseline?.metalnessMap ?? null
        } else {
            renderDebugMetallicBaselines.set(material, {
                metalness: material.metalness,
                metalnessMap: material.metalnessMap,
            })
            material.metalness = 0
            material.metalnessMap = null
        }
        material.needsUpdate = true
    })
}

const toggleRenderDebugReflectionWorkflow = () => {
    const materials = new Set<THREE.MeshStandardMaterial>()
    getActiveDebugStageObject()?.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        const objectMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material]
        objectMaterials.forEach(material => {
            if (
                material instanceof THREE.MeshStandardMaterial
                && (
                    material.envMap
                    || renderDebugReflectionBaselines.has(material)
                )
            ) materials.add(material)
        })
    })
    const restoring = renderDebugBackgroundEnvironmentDisabled
    materials.forEach(material => {
        if (restoring) {
            material.envMap = renderDebugReflectionBaselines.get(material) ?? null
        } else {
            renderDebugReflectionBaselines.set(material, material.envMap)
            material.envMap = null
        }
        material.needsUpdate = true
    })
    if (restoring) {
        scene.backgroundScene.environment =
            renderDebugBackgroundEnvironmentBaseline
        renderDebugBackgroundEnvironmentDisabled = false
    } else {
        renderDebugBackgroundEnvironmentBaseline =
            scene.backgroundScene.environment
        scene.backgroundScene.environment = null
        renderDebugBackgroundEnvironmentDisabled = true
    }
}

const toggleRenderDebugVertexBlendWorkflow = () => {
    const materials = new Set<THREE.MeshStandardMaterial>()
    getActiveDebugStageObject()?.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        const objectMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material]
        objectMaterials.forEach(material => {
            if (
                material instanceof THREE.MeshStandardMaterial
                && material.userData.stageBlendMap
            ) materials.add(material)
        })
    })
    const restoring = materials.size > 0
        && [...materials].every(material => !material.vertexColors)
    materials.forEach(material => {
        if (restoring) {
            material.vertexColors =
                renderDebugVertexBlendBaselines.get(material) ?? true
        } else {
            renderDebugVertexBlendBaselines.set(
                material,
                material.vertexColors,
            )
            material.vertexColors = false
        }
        material.needsUpdate = true
    })
}

const toggleRenderDebugBaseMapOnlyWorkflow = () => {
    const stageObject = getActiveDebugStageObject()
    if (!stageObject) return
    const installed = new Set<THREE.Material>()
    let restoring = false
    stageObject.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        const original = renderDebugBaseMapBaselines.get(object)
        if (original) {
            restoring = true
            const diagnostic = Array.isArray(object.material)
                ? object.material
                : [object.material]
            diagnostic.forEach(material => {
                if (material.userData.renderDebugBaseMapOnly) {
                    material.dispose()
                }
            })
            object.material = original
            renderDebugBaseMapBaselines.delete(object)
            return
        }

        const source = Array.isArray(object.material)
            ? object.material
            : [object.material]
        if (!source.some(material => material.userData.stageBlendMap)) return
        const replacement = source.map(material => {
            if (!(material instanceof THREE.MeshStandardMaterial)) return material
            const basic = new THREE.MeshBasicMaterial({
                map: material.map,
                color: material.color,
                opacity: material.opacity,
                transparent: material.transparent,
                alphaTest: material.alphaTest,
                alphaToCoverage: material.alphaToCoverage,
                depthTest: material.depthTest,
                depthWrite: material.depthWrite,
                side: material.side,
            })
            basic.name = material.name
            basic.userData.renderDebugBaseMapOnly = true
            installed.add(basic)
            return basic
        })
        renderDebugBaseMapBaselines.set(object, object.material)
        object.material = Array.isArray(object.material)
            ? replacement
            : replacement[0]
    })
    if (restoring) installed.forEach(material => material.dispose())
}

const renderDebugActions = [
    {
        id: 'magius-render-debug-toggle-angel-ring',
        label: 'Toggle AngelRing diagnostic',
        run: () => {
            angelRingOptions.enabled = !angelRingOptions.enabled
        },
    },
    {
        id: 'magius-render-debug-toggle-urp-bloom',
        label: 'Toggle URP Bloom diagnostic',
        run: () => {
            scene.effects.urpBloomPass.enabled =
                !scene.effects.urpBloomPass.enabled
        },
    },
    {
        id: 'magius-render-debug-toggle-volume-post',
        label: 'Toggle Volume post diagnostic',
        run: () => {
            scene.effects.volumePostProcessPass.enabled =
                !scene.effects.volumePostProcessPass.enabled
        },
    },
    {
        id: 'magius-render-debug-toggle-paraffin',
        label: 'Toggle Paraffin diagnostic',
        run: () => {
            scene.effects.paraffinPass.enabled =
                !scene.effects.paraffinPass.enabled
        },
    },
    {
        id: 'magius-render-debug-toggle-main-light',
        label: 'Toggle MainLight diagnostic',
        run: () => {
            scene.directionalLight.visible = !scene.directionalLight.visible
        },
    },
    {
        id: 'magius-render-debug-toggle-lightmaps',
        label: 'Toggle stage lightmaps diagnostic',
        run: toggleRenderDebugLightmaps,
    },
    {
        id: 'magius-render-debug-toggle-punctual-lights',
        label: 'Toggle background point/spot lights diagnostic',
        run: () => toggleRenderDebugBackgroundLights(
            (object): object is THREE.PointLight | THREE.SpotLight =>
                object instanceof THREE.PointLight
                || object instanceof THREE.SpotLight,
            renderDebugPunctualLightBaselines,
        ),
    },
    {
        id: 'magius-render-debug-toggle-directional-lights',
        label: 'Toggle background directional lights diagnostic',
        run: () => toggleRenderDebugBackgroundLights(
            (object): object is THREE.DirectionalLight =>
                object instanceof THREE.DirectionalLight,
            renderDebugDirectionalLightBaselines,
        ),
    },
    {
        id: 'magius-render-debug-toggle-light-probes',
        label: 'Toggle background light probes diagnostic',
        run: () => toggleRenderDebugBackgroundLights(
            (object): object is THREE.LightProbe =>
                object instanceof THREE.LightProbe,
            renderDebugProbeLightBaselines,
        ),
    },
    {
        id: 'magius-render-debug-toggle-lit-materials',
        label: 'Toggle stage lit materials diagnostic',
        run: () => toggleRenderDebugStageMaterialClass(
            material => material instanceof THREE.MeshStandardMaterial,
        ),
    },
    {
        id: 'magius-render-debug-toggle-unlit-materials',
        label: 'Toggle stage unlit materials diagnostic',
        run: () => toggleRenderDebugStageMaterialClass(
            material => material instanceof THREE.MeshBasicMaterial,
        ),
    },
    {
        id: 'magius-render-debug-toggle-metallic-workflow',
        label: 'Toggle stage metallic workflow diagnostic',
        run: toggleRenderDebugMetallicWorkflow,
    },
    {
        id: 'magius-render-debug-toggle-reflection-workflow',
        label: 'Toggle stage reflection workflow diagnostic',
        run: toggleRenderDebugReflectionWorkflow,
    },
    {
        id: 'magius-render-debug-toggle-vertex-blend-workflow',
        label: 'Toggle stage vertex blend workflow diagnostic',
        run: toggleRenderDebugVertexBlendWorkflow,
    },
    {
        id: 'magius-render-debug-toggle-base-map-only-workflow',
        label: 'Toggle stage base-map-only workflow diagnostic',
        run: toggleRenderDebugBaseMapOnlyWorkflow,
    },
    ...[
        'mt_bg3d600A_01_02_ground',
        'mt_bg3d600A_01_02_propA',
        'mt_bg3d600A_01_02_propC',
        'mt_bg3d600A_01_02_rockAlpha',
    ].map(materialName => ({
        id: `magius-render-debug-toggle-material-${materialName}`,
        label: `Toggle stage material ${materialName} diagnostic`,
        run: () => toggleRenderDebugStageMaterialClass(
            material => material.name === materialName,
        ),
    })),
] as const

renderDebugActions.forEach((action, index) => {
    const button = document.createElement('button')
    button.id = action.id
    button.type = 'button'
    button.tabIndex = -1
    button.ariaHidden = 'true'
    button.title = action.label
    Object.assign(button.style, {
        position: 'fixed',
        left: `${3 + index * 3}px`,
        top: '0',
        width: '2px',
        height: '2px',
        margin: '0',
        padding: '0',
        border: '0',
        opacity: '0.001',
        zIndex: '2147483647',
    })
    button.addEventListener('click', () => {
        action.run()
        updateRenderDebugState()
    })
    document.body.appendChild(button)
})

const vectorArray = (value: THREE.Vector2 | THREE.Vector3 | THREE.Vector4) =>
    value.toArray()

/**
 * Read-only main-world bridge for exact runtime render evidence. Browser
 * automation runs in an isolated JavaScript world, so a DOM event is used to
 * request the actual animated Head basis, camera/light matrices and the exact
 * official per-character controller row consumed by the shaders.
 */
const updateRenderDebugState = () => {
    try {
        const selected = scene.characterSelected?.character
        const root = selected?.object
        const characterId = selected?.userData.characterId
        const profile = characterId == undefined
            ? undefined
            : getCharacterReDriveProfile(characterId)
        const faceReference = root && profile
            ? createFaceDirectionReference(root, profile)
            : undefined

        scene.scene.updateMatrixWorld(true)
        scene.backgroundScene.updateMatrixWorld(true)
        scene.camera.updateMatrixWorld(true)
        scene.directionalLight.target.updateMatrixWorld(true)

        const headPosition = new THREE.Vector3()
        const headQuaternion = new THREE.Quaternion()
        const faceForwardWorld = new THREE.Vector3()
        const faceUpWorld = new THREE.Vector3()
        const faceRightWorld = new THREE.Vector3()
        const facePositionWorld = new THREE.Vector3()
        if (faceReference) {
            faceReference.headBone.updateWorldMatrix(true, false)
            faceReference.headBone.getWorldPosition(headPosition)
            faceReference.headBone.getWorldQuaternion(headQuaternion)
            faceForwardWorld
                .copy(faceReference.localForward)
                .applyQuaternion(headQuaternion)
                .normalize()
            faceUpWorld
                .copy(faceReference.localUp)
                .applyQuaternion(headQuaternion)
                .normalize()
            faceRightWorld
                .copy(faceReference.localRight)
                .applyQuaternion(headQuaternion)
                .normalize()
            facePositionWorld
                .copy(headPosition)
                .addScaledVector(faceUpWorld, profile?.headOffset ?? 0)
        }

        const lightPosition = scene.directionalLight.getWorldPosition(
            new THREE.Vector3(),
        )
        const lightTarget = scene.directionalLight.target.getWorldPosition(
            new THREE.Vector3(),
        )
        const surfaceToLightWorld = lightPosition
            .clone()
            .sub(lightTarget)
            .normalize()
        const surfaceToLightView = surfaceToLightWorld
            .clone()
            .transformDirection(scene.camera.matrixWorldInverse)
        const overrideState = getReDriveCharacterLightingDirectionState()
        const effectiveLightWorld = new THREE.Vector3().fromArray(
            overrideState.enabled
                ? overrideState.directionWorld
                : surfaceToLightWorld.toArray(),
        )
        const biasedFaceLightWorld = effectiveLightWorld
            .clone()
            .addScaledVector(faceForwardWorld, 0.111)
            .addScaledVector(faceRightWorld, 0.333)
            .normalize()

        const logicalSize = scene.renderer.getSize(new THREE.Vector2())
        const drawingBufferSize = scene.renderer.getDrawingBufferSize(
            new THREE.Vector2(),
        )
        const cameraQuaternion = scene.camera.getWorldQuaternion(
            new THREE.Quaternion(),
        )

        const directionalLights: Array<Record<string, unknown>> = []
        const collectDirectionalLight = (object: THREE.Object3D) => {
            if (!(object instanceof THREE.DirectionalLight)) return
            object.updateWorldMatrix(true, false)
            object.target.updateWorldMatrix(true, false)
            const position = object.getWorldPosition(new THREE.Vector3())
            const target = object.target.getWorldPosition(new THREE.Vector3())
            directionalLights.push({
                name: object.name,
                color: object.color.toArray(),
                intensity: object.intensity,
                position: vectorArray(position),
                target: vectorArray(target),
                surfaceToLight: vectorArray(position.sub(target).normalize()),
                castShadow: object.castShadow,
                shadowMapSize: vectorArray(object.shadow.mapSize),
            })
        }
        scene.scene.traverse(collectDirectionalLight)
        scene.backgroundScene.traverse(collectDirectionalLight)

        const stageRoot = scene.backgroundScene.getObjectByName(
            'Magius3DviewerStageRoot',
        )
        const stageId = stageRoot?.userData.stageDefinition?.id
        const stageObject = typeof stageId === 'string'
            ? stageRoot?.getObjectByName(`Stage:${stageId}`)
            : undefined
        const stageMaterials: Array<Record<string, unknown>> = []
        const stageLights: Array<Record<string, unknown>> = []
        const attributeSummary = (attribute?: THREE.BufferAttribute) => {
            if (!attribute) return null
            const minimum = Array.from({ length: attribute.itemSize }, () => Infinity)
            const maximum = Array.from({ length: attribute.itemSize }, () => -Infinity)
            const total = Array.from({ length: attribute.itemSize }, () => 0)
            const firstValues: number[][] = []
            for (let index = 0; index < attribute.count; index++) {
                const values: number[] = []
                for (let component = 0; component < attribute.itemSize; component++) {
                    const value = attribute.array[
                        index * attribute.itemSize + component
                    ] as number
                    minimum[component] = Math.min(minimum[component], value)
                    maximum[component] = Math.max(maximum[component], value)
                    total[component] += value
                    values.push(value)
                }
                if (firstValues.length < 16) firstValues.push(values)
            }
            return {
                count: attribute.count,
                itemSize: attribute.itemSize,
                normalized: attribute.normalized,
                arrayType: attribute.array.constructor.name,
                minimum,
                maximum,
                mean: total.map(value => value / Math.max(1, attribute.count)),
                firstValues,
            }
        }
        scene.backgroundScene.traverse(object => {
            if (!(object instanceof THREE.Light)) return
            stageLights.push({
                name: object.name,
                type: object.type,
                visible: object.visible,
                intensity: object.intensity,
                color: object.color.toArray(),
                layers: object.layers.mask,
                distance: object instanceof THREE.PointLight
                    || object instanceof THREE.SpotLight
                    ? object.distance
                    : null,
                decay: object instanceof THREE.PointLight
                    || object instanceof THREE.SpotLight
                    ? object.decay
                    : null,
            })
        })
        stageObject?.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return
            const materials = Array.isArray(object.material)
                ? object.material
                : [object.material]
            materials.forEach(material => {
                const lightMapped = material as RenderDebugLightmapMaterial
                stageMaterials.push({
                    mesh: object.name,
                    visible: object.visible,
                    material: material.name,
                    type: material.type,
                    materialVisible: material.visible,
                    map: 'map' in material
                        ? material.map?.name ?? null
                        : null,
                    color: 'color' in material
                        ? material.color?.toArray() ?? null
                        : null,
                    metalness: material instanceof THREE.MeshStandardMaterial
                        ? material.metalness
                        : null,
                    metalnessMap: material instanceof THREE.MeshStandardMaterial
                        ? material.metalnessMap?.name ?? null
                        : null,
                    roughness: material instanceof THREE.MeshStandardMaterial
                        ? material.roughness
                        : null,
                    envMap: material instanceof THREE.MeshStandardMaterial
                        ? material.envMap?.name ?? null
                        : null,
                    envMapIntensity:
                        material instanceof THREE.MeshStandardMaterial
                            ? material.envMapIntensity
                            : null,
                    opacity: material.opacity,
                    transparent: material.transparent,
                    alphaTest: material.alphaTest,
                    depthWrite: material.depthWrite,
                    lightMap: lightMapped.lightMap?.name ?? null,
                    lightMapIntensity:
                        lightMapped.lightMapIntensity ?? null,
                    unityMaterialState:
                        material.userData.stageUnityMaterialState ?? null,
                    backgroundShaderGlobals:
                        material.userData.stageBackgroundShaderGlobals ?? null,
                    vertexColors:
                        material instanceof THREE.MeshStandardMaterial
                            ? material.vertexColors
                            : null,
                    blendMap:
                        material.userData.stageBlendMap?.name ?? null,
                    baseMapOnly: Boolean(
                        material.userData.renderDebugBaseMapOnly,
                    ),
                    geometryColor: attributeSummary(
                        object.geometry.getAttribute('color') as
                            | THREE.BufferAttribute
                            | undefined,
                    ),
                })
            })
        })

        const uniformValue = (uniform?: { value: unknown }) => {
            const value = uniform?.value as {
                toArray?: () => unknown
            } | undefined
            return value?.toArray ? value.toArray() : uniform?.value ?? null
        }
        const backgroundAdjust = scene.effects.backgroundColorAdjustPass
        const volumePost = scene.effects.volumePostProcessPass
        const paraffin = scene.effects.paraffinPass

        renderDebugState.textContent = JSON.stringify({
            timestamp: new Date().toISOString(),
            characterId: characterId ?? null,
            profile: profile ?? null,
            character: root ? {
                name: root.name,
                position: vectorArray(root.position),
                quaternion: root.quaternion.toArray(),
                scale: vectorArray(root.scale),
                matrixWorld: root.matrixWorld.toArray(),
                meshNames: selected?.userData.meshes.map(mesh => mesh.name) ?? [],
            } : null,
            head: faceReference ? {
                name: faceReference.headBone.name,
                positionWorld: vectorArray(headPosition),
                quaternionWorld: headQuaternion.toArray(),
                localForward: vectorArray(faceReference.localForward),
                localUp: vectorArray(faceReference.localUp),
                localRight: vectorArray(faceReference.localRight),
                forwardWorld: vectorArray(faceForwardWorld),
                upWorld: vectorArray(faceUpWorld),
                rightWorld: vectorArray(faceRightWorld),
                facePositionWorld: vectorArray(facePositionWorld),
            } : null,
            lighting: {
                physicalSurfaceToLightWorld: vectorArray(surfaceToLightWorld),
                physicalSurfaceToLightView: vectorArray(surfaceToLightView),
                override: overrideState,
                effectiveLightWorld: vectorArray(effectiveLightWorld),
                biasedFaceLightWorld: vectorArray(biasedFaceLightWorld),
                faceForwardDotLight: faceReference
                    ? faceForwardWorld.dot(effectiveLightWorld)
                    : null,
                faceRightDotBiasedLight: faceReference
                    ? faceRightWorld.dot(biasedFaceLightWorld)
                    : null,
                faceForwardDotBiasedLight: faceReference
                    ? faceForwardWorld.dot(biasedFaceLightWorld)
                    : null,
                characterAdditionalRim:
                    scene.scene.userData.reDriveCharacterAdditionalRim ?? null,
                directionalLights,
            },
            selfShadow:
                scene.scene.userData.reDriveSelfShadow
                ?? scene.selfShadow.getDebugState(),
            stage: {
                id: typeof stageId === 'string' ? stageId : null,
                definition: stageRoot?.userData.stageDefinition ?? null,
                materialBindings:
                    stageObject?.userData.stageMaterialBindings ?? null,
                lightmaps: stageObject?.userData.stageLightmaps ?? null,
                uv1Companion:
                    stageObject?.userData.stageUv1Companion ?? null,
                reflectionProbes:
                    stageObject?.userData.stageReflectionProbes ?? null,
                mainLightCascades:
                    stageRoot?.userData.stageMainLightCascades ?? null,
                runtime: stageRoot?.userData.stageRuntime ?? null,
                loadFailure: stageRoot?.userData.stageLoadFailure ?? null,
                reDriveVolume:
                    stageRoot?.userData.reDriveVolume ?? null,
                officialLights: stageObject?.userData.stageLights ?? null,
                runtimeLights: stageLights,
                materials: stageMaterials,
            },
            effects: {
                angelRing: {
                    globalEnabled: angelRingOptions.enabled,
                    slots: root
                        ? collectOfficialAngelRingRuntime(root)
                        : [],
                },
                renderer: {
                    toneMapping: scene.renderer.toneMapping,
                    toneMappingExposure:
                        scene.renderer.toneMappingExposure,
                },
                urpBloom: {
                    enabled: scene.effects.urpBloomPass.enabled,
                    intensity: scene.effects.urpBloomPass.intensity,
                    scatter: scene.effects.urpBloomPass.scatter,
                    threshold: scene.effects.urpBloomPass.threshold,
                    clamp: scene.effects.urpBloomPass.clamp,
                    maxIterations:
                        scene.effects.urpBloomPass.maxIterations,
                },
                unrealBloom: {
                    enabled: scene.effects.bloomPass.enabled,
                    strength: scene.effects.bloomPass.strength,
                    radius: scene.effects.bloomPass.radius,
                    threshold: scene.effects.bloomPass.threshold,
                },
                backgroundAdjust: {
                    enabled: backgroundAdjust.enabled,
                    uEnabled: uniformValue(
                        backgroundAdjust.uniforms.uEnabled,
                    ),
                    postExposure: uniformValue(
                        backgroundAdjust.uniforms.uPostExposure,
                    ),
                    contrast: uniformValue(
                        backgroundAdjust.uniforms.uContrast,
                    ),
                    saturation: uniformValue(
                        backgroundAdjust.uniforms.uSaturation,
                    ),
                },
                volumePost: {
                    enabled: volumePost.enabled,
                    toneMappingMode: uniformValue(
                        volumePost.uniforms.uToneMappingMode,
                    ),
                    colorAdjustEnabled: uniformValue(
                        volumePost.uniforms.uColorAdjustEnabled,
                    ),
                    postExposure: uniformValue(
                        volumePost.uniforms.uPostExposure,
                    ),
                    contrast: uniformValue(
                        volumePost.uniforms.uContrast,
                    ),
                    saturation: uniformValue(
                        volumePost.uniforms.uSaturation,
                    ),
                    vignetteEnabled: uniformValue(
                        volumePost.uniforms.uVignetteEnabled,
                    ),
                },
                paraffin: {
                    enabled: paraffin.enabled,
                    opacity: uniformValue(paraffin.uniforms.uOpacity),
                    width: uniformValue(paraffin.uniforms.uWidth),
                },
                mainLightVisible: scene.directionalLight.visible,
            },
            camera: {
                positionWorld: vectorArray(
                    scene.camera.getWorldPosition(new THREE.Vector3()),
                ),
                quaternionWorld: cameraQuaternion.toArray(),
                fov: scene.camera.fov,
                aspect: scene.camera.aspect,
                near: scene.camera.near,
                far: scene.camera.far,
                matrixWorld: scene.camera.matrixWorld.toArray(),
                matrixWorldInverse: scene.camera.matrixWorldInverse.toArray(),
                projectionMatrix: scene.camera.projectionMatrix.toArray(),
            },
            renderer: {
                logicalSize: vectorArray(logicalSize),
                drawingBufferSize: vectorArray(drawingBufferSize),
                pixelRatio: scene.renderer.getPixelRatio(),
                canvasClientSize: [
                    scene.renderer.domElement.clientWidth,
                    scene.renderer.domElement.clientHeight,
                ],
                devicePixelRatio: window.devicePixelRatio,
            },
            combatVfx: getCombatVfxDebugState(),
        }, null, 2)
    } catch (error) {
        renderDebugState.textContent = JSON.stringify({
            timestamp: new Date().toISOString(),
            error: error instanceof Error
                ? `${error.name}: ${error.message}`
                : String(error),
        }, null, 2)
    }
}
document.addEventListener(
    'magius:request-render-debug-state',
    updateRenderDebugState,
)
renderDebugRequest.addEventListener('click', updateRenderDebugState)

Object.assign(window, { scene })
