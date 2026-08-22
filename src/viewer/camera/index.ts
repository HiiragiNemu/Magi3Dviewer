import { ARButton } from 'three/examples/jsm/Addons.js';
import { scene } from '../scene';
import { disableSceneCamera, enableSceneCamera } from './camera';
import { setupCaptureRecordingControls } from './shots';

export * from './camera'
export * from './shots'

const arButton = ARButton.createButton(scene.renderer, {
    requiredFeatures: ['hit-test'],
    // optionalFeatures: ['dom-overlay'],
    // domOverlay: { root: menuEl },
})
const cameraModeList = document.getElementById('camera-mode-list') as HTMLDivElement
const btnCameraBackground = document.getElementById('camera-mode-background') as HTMLButtonElement
// const btnCameraAR = document.getElementById('camera-mode-ar') as HTMLButtonElement
const btnCameraOff = document.getElementById('camera-off') as HTMLButtonElement

export function setupCameraModeButtons() {
    setupCaptureRecordingControls()
    arButton.removeAttribute('style')
    const arButtonObserver = new MutationObserver(records => {
        for (const record of records) {
            if (record.attributeName == 'style') {
                arButton.removeAttribute('style')
            }
        }
    })
    arButtonObserver.observe(arButton, { attributes: true })
    cameraModeList.appendChild(arButton)

    let cameraEnabling = false
    btnCameraBackground.onclick = async () => {
        if (cameraEnabling) return
        cameraEnabling = true
        try {
            await enableSceneCamera()
            document.body.classList.add('camera-active')
        } catch (error) {
            window.alert(error)
        } finally {
            cameraEnabling = false
        }
    }

    // btnCameraAR.onclick = () => arButton.click()

    btnCameraOff.onclick = () => {
        disableSceneCamera()
        document.body.classList.remove('camera-active')
    }

}
