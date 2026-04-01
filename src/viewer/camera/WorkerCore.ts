import { cameraDownscaleSize, lightProcessingSize } from "./consts";

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

export class CameraWorkerCore {
    private _cameraDownscaleCanvas: HTMLCanvasElement | OffscreenCanvas
    private _cameraDownscaleCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    private _lightingCanvas: HTMLCanvasElement | OffscreenCanvas
    private _lightingCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null

    private _settings: CameraWorkerSettings

    constructor() {
        const isWorker = typeof window != 'object'

        if (isWorker) {
            this._cameraDownscaleCanvas = new OffscreenCanvas(cameraDownscaleSize, cameraDownscaleSize)
        } else {
            this._cameraDownscaleCanvas = document.createElement('canvas')
            this._cameraDownscaleCanvas.width = cameraDownscaleSize
            this._cameraDownscaleCanvas.height = cameraDownscaleSize
        }
        this._cameraDownscaleCtx = this._cameraDownscaleCanvas.getContext('2d', { willReadFrequently: false })
        if (this._cameraDownscaleCtx) {
            this._cameraDownscaleCtx.imageSmoothingEnabled = false
        }

        if (isWorker) {
            this._lightingCanvas = new OffscreenCanvas(lightProcessingSize, lightProcessingSize)
        } else {
            this._lightingCanvas = document.createElement('canvas')
            this._lightingCanvas.width = lightProcessingSize
            this._lightingCanvas.height = lightProcessingSize
        }
        this._lightingCtx = this._cameraDownscaleCanvas.getContext('2d', { willReadFrequently: false })

        this._settings = {
            downscale: true,
            lighting: true
        }
    }

    async processMessage(message: CameraWorkerMessage) {
        if (message.cameraImage) {
            const tStart = performance.now()
            const promises: Promise<unknown>[] = []

            try {
                do {
                    if (!this._settings.downscale) break
                    if (!this._cameraDownscaleCtx) {
                        console.warn('`cameraDownscaleCtx` not available')
                        break
                    }

                    let t = performance.now()
                    this._cameraDownscaleCtx.drawImage(message.cameraImage, 0, 0, cameraDownscaleSize, cameraDownscaleSize)
                    const tDownscale = performance.now() - t

                    promises.push(createImageBitmap(this._cameraDownscaleCanvas).then(image => this._dispatchMessage({
                        downscaledImage: {
                            image,
                            timeDraw: tDownscale
                        }
                    })))

                    if (!this._settings.lighting) break
                    if (!this._lightingCtx) {
                        console.warn('`lightingCtx` not available')
                        break
                    }

                    t = performance.now()
                    this._lightingCtx.drawImage(this._cameraDownscaleCanvas, 0, 0, this._lightingCanvas.width, this._lightingCanvas.height)
                    const tLightDraw = performance.now() - t

                    t = performance.now()
                    // TODO: `getImageData` still blocking the GPU
                    const lightingImageData = this._lightingCtx.getImageData(0, 0, this._lightingCanvas.width, this._lightingCanvas.height)
                    const tLightGet = performance.now() - t

                    this._dispatchMessage({
                        lightingData: {
                            data: lightingImageData,
                            timeDraw: tLightDraw,
                            timeGet: tLightGet
                        }
                    })
                } while (false)
            }
            finally {
                message.cameraImage.close()

                await Promise.all(promises)

                const totalTime = performance.now() - tStart
                this._dispatchMessage({ finish: { totalTime } })
            }
        }

        if (message.settings) {
            Object.assign(this._settings, message.settings)
        }
    }

    private _dispatchMessage(message: CameraWorkerMessage) {
        if (this.onDispatchMessage) {
            this.onDispatchMessage(message)
        }
    }

    onDispatchMessage: ((message: CameraWorkerMessage) => any) | undefined = undefined
}
