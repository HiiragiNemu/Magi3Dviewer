import { cameraVideo } from "./background"
import { perfCameraDownscale } from "../performance"

export const cameraDownscaleSize = 256

export const cameraDownscaleCanvas = document.createElement('canvas')
cameraDownscaleCanvas.width = cameraDownscaleSize
cameraDownscaleCanvas.height = cameraDownscaleSize
const cameraDownscaleCtx = cameraDownscaleCanvas.getContext('2d', { willReadFrequently: false })
if (cameraDownscaleCtx) {
    cameraDownscaleCtx.imageSmoothingEnabled = false
}

export function downscaleCamera() {
    if (!cameraDownscaleCtx) return

    perfCameraDownscale.start()
    cameraDownscaleCtx.drawImage(cameraVideo, 0, 0, cameraDownscaleSize, cameraDownscaleSize)
    perfCameraDownscale.stop()
}
