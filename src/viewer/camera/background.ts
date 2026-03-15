import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/Addons.js';
import { Controller } from 'three/addons/libs/lil-gui.module.min.js';
import { scene } from '../scene';
import { prettyPrintJSON } from '../controllers/presets';
import { addAnimationLoop, getClockDelta, removeAnimationLoop } from 'magia-exedra-character-three/renderer';
import { guiAmbientLight, guiAmbientLightColor, guiDirectionalLight, guiDirectionalLightColor, guiFloorShadowOpacity, guiLightAngle, guiLightDistance, guiLightHeight } from '../controllers';

export const cameraVideo = document.getElementById('camera-bg') as HTMLVideoElement
let cameraStream: MediaStream | undefined = undefined

export async function enableSceneCamera() {
    cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
            width: { ideal: 1920 },
            height: { ideal: 1440 },
            aspectRatio: { ideal: 4 / 3 },
            facingMode: "environment",
        }
    })

    cameraStream.getTracks().forEach(x => prettyPrintJSON(x.getSettings()));

    cameraVideo.srcObject = cameraStream
    cameraVideo.play()

    cameraVideo.onloadedmetadata = () => {
        addAnimationLoop(updateSceneEnvironment)
    }

    backupGuiValues(
        guiAmbientLightColor, guiAmbientLight,
        guiDirectionalLightColor, guiDirectionalLight,
        guiLightAngle, guiLightHeight, guiLightDistance,
        guiFloorShadowOpacity
    )
    guiAmbientLight.setValue(1.25)
    guiFloorShadowOpacity.setValue(0.25)
}

export function disableSceneCamera() {
    removeAnimationLoop(updateSceneEnvironment)
    scene.scene.environment = null
    scene.scene.background = null

    cameraPanoramaTex?.dispose()
    cameraPanoramaTex = undefined
    pmremRenderTarget?.dispose()
    pmremRenderTarget = undefined

    if (cameraStream) {
        cameraStream.getTracks().forEach(x => x.stop())
        cameraStream = undefined
    }

    restoreGuiValues()
}

let savedGuiValues: { controller: Controller, value: unknown }[] | undefined

function backupGuiValues(...controllers: unknown[]) {
    savedGuiValues = controllers.filter(x => x instanceof Controller).map(controller => ({
        controller,
        value: controller.getValue()
    }))
}

function restoreGuiValues() {
    savedGuiValues?.forEach(x => x.controller.setValue(x.value))
}

const cameraPanoramaCanvas = document.createElement('canvas')
cameraPanoramaCanvas.width = 512
cameraPanoramaCanvas.height = 256
const cameraPanoramaCanvasCtx = cameraPanoramaCanvas.getContext('2d')

let cameraPanoramaTex: THREE.Texture | undefined = undefined
let pmremRenderTarget: THREE.WebGLRenderTarget | undefined = undefined

const pmremGenerator = new THREE.PMREMGenerator(scene.renderer);
pmremGenerator.compileEquirectangularShader();

let accumulatedTimeDelta = 0
const environmentUpdateTime = 1 / 5

/**
 * Use the webcam to create a panorama and apply it as scene environment, to provide ambient lighting
 */
function updateSceneEnvironment() {
    if (!cameraPanoramaCanvasCtx) return

    // run at a throttled framerate. the PMREM calculation is heavy
    accumulatedTimeDelta += getClockDelta()
    if (accumulatedTimeDelta < environmentUpdateTime) return
    accumulatedTimeDelta = 0

    const drawWidth = cameraPanoramaCanvas.width / 2
    const drawHeight = cameraPanoramaCanvas.height

    cameraPanoramaCanvasCtx.drawImage(cameraVideo, 0, 0, drawWidth, drawHeight) // draw the front side
    cameraPanoramaCanvasCtx.scale(-1, 1)
    cameraPanoramaCanvasCtx.drawImage(cameraVideo, 0 - drawWidth * 2, 0, drawWidth, drawHeight) // draw the rear side (mirrord front side)
    cameraPanoramaCanvasCtx.resetTransform()

    if (!cameraPanoramaTex) {
        cameraPanoramaTex = new THREE.Texture(cameraPanoramaCanvas)
        cameraPanoramaTex.colorSpace = THREE.SRGBColorSpace
        // cameraTex.mapping = THREE.EquirectangularReflectionMapping
    }
    cameraPanoramaTex.needsUpdate = true

    // we need to re-calculate PMREM every time, or it won't update
    const renderTarget = pmremGenerator.fromEquirectangular(cameraPanoramaTex)
    scene.scene.environment = renderTarget.texture
    // scene.scene.background = pmremTexNext

    pmremRenderTarget?.dispose() // dispose the old texture
    pmremRenderTarget = renderTarget
}

export function setCameraVideoFullscreen(fullscreen: boolean) {
    if (fullscreen) {
        cameraVideo.style.removeProperty('object-fit')
    } else {
        cameraVideo.style.objectFit = 'contain'
    }
}

export function getCameraStreamDimensions(): { width: number, height: number } {
    if (cameraStream) {
        for (const track of cameraStream.getTracks()) {
            if (track.kind != 'video') continue
            const settings = track.getSettings()
            return {
                width: settings.width ?? 0,
                height: settings.height ?? 0,
            }
        }
    }
    return { width: 0, height: 0 }
}

// debug canvas
// showCanvas(cameraPanoramaCanvas)

export function showCanvas(canvas: HTMLCanvasElement) {
    canvas.style.maxWidth = '100%'
    canvas.style.maxHeight = '25%'
    canvas.style.border = '2px solid red'
    canvas.style.boxSizing = 'border-box'
    canvas.style.position = 'fixed'
    canvas.style.left = '0'
    canvas.style.bottom = '0'
    document.body.appendChild(canvas)
}

// plane for debugging environment reflection
if (false) {
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        new THREE.MeshStandardMaterial({
            roughness: 0,
            metalness: 0.9,
            color: 0xffffff,
        })
    )
    plane.castShadow = true
    plane.receiveShadow = true
    plane.rotation.x = -Math.PI / 2
    plane.position.y = 0
    scene.scene.add(plane)
}

export function getAllMaterials() {
    return scene.characters.map(x => x.character).filter(x => !!x).flatMap(x =>
        x.meshes.map(x => x.material).filter(x => x instanceof THREE.MeshStandardMaterial)
    )
}

function enableTestEnvironmentMap() {
    new HDRLoader().load('https://sbcode.net/img/spruit_sunrise_1k.hdr', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping
        scene.scene.environment = texture
        scene.scene.background = texture
    })
}

Object.assign(window, { cameraVideo, disableSceneCamera, enableTestEnvironmentMap, getCameraStreamDimensions })
