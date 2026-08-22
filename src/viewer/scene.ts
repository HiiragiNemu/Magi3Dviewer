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
import { characters } from './character';

export const viewerEl = document.getElementById('viewer')!

export const scene = new MagiaExedraScene3D(characters)

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
                directionalLights,
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
