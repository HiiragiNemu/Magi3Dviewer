import { cameraDownscaleSize, lightProcessingSize } from "./consts"

export interface CameraWorkerMessage {
    cameraImage?: ImageBitmap
    downscaledImage?: {
        image: ImageBitmap
        timeDraw: number
    }
    lightingData?: {
        data: ImageData
        timeDraw: number
        timeGet: number
    }
    finish?: {
        totalTime: number
    }
    settings?: CameraWorkerSettings
}

export interface CameraWorkerSettings {
    downscale?: boolean
    lighting?: boolean
}

const settings: CameraWorkerSettings = {
    downscale: true,
    lighting: true
}

const cameraDownscaleCanvas = new OffscreenCanvas(cameraDownscaleSize, cameraDownscaleSize)
const cameraDownscaleCtx = cameraDownscaleCanvas.getContext('2d', { willReadFrequently: false })
if (cameraDownscaleCtx) {
    cameraDownscaleCtx.imageSmoothingEnabled = false
}

const lightingCanvas = new OffscreenCanvas(lightProcessingSize, lightProcessingSize)
const lightingCtx = lightingCanvas.getContext('2d', { willReadFrequently: false })

onmessage = async (e) => {
    if (typeof e.data != 'object') return
    const data = e.data as CameraWorkerMessage

    if (data.cameraImage) {
        const tStart = performance.now()
        const promises: Promise<unknown>[] = []

        try {
            do {
                if (!settings.downscale) break
                if (!cameraDownscaleCtx) {
                    console.warn('`cameraDownscaleCtx` not available')
                    break
                }

                let t = performance.now()
                cameraDownscaleCtx.drawImage(data.cameraImage, 0, 0, cameraDownscaleSize, cameraDownscaleSize)
                const tDownscale = performance.now() - t

                promises.push(createImageBitmap(cameraDownscaleCanvas).then(image => postMessage(
                    {
                        downscaledImage: {
                            image,
                            timeDraw: tDownscale
                        }
                    } satisfies CameraWorkerMessage,
                    { transfer: [image] }
                )))

                if (!settings.lighting) break
                if (!lightingCtx) {
                    console.warn('`lightingCtx` not available')
                    break
                }

                t = performance.now()
                lightingCtx.drawImage(cameraDownscaleCanvas, 0, 0, lightingCanvas.width, lightingCanvas.height)
                const tLightDraw = performance.now() - t

                t = performance.now()
                // TODO: `getImageData` still blocking the GPU
                const lightingImageData = lightingCtx.getImageData(0, 0, lightingCanvas.width, lightingCanvas.height)
                const tLightGet = performance.now() - t

                postMessage(
                    {
                        lightingData: {
                            data: lightingImageData,
                            timeDraw: tLightDraw,
                            timeGet: tLightGet
                        }
                    } satisfies CameraWorkerMessage,
                    { transfer: [lightingImageData.data.buffer] }
                )
            } while (false)
        }
        finally {
            data.cameraImage.close()

            await Promise.all(promises)

            const totalTime = performance.now() - tStart
            postMessage({ finish: { totalTime } } satisfies CameraWorkerMessage)
        }
    }

    if (data.settings) {
        Object.assign(settings, data.settings)
    }
}
