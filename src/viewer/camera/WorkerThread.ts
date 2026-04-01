import { CameraWorkerCore } from "./WorkerCore"

const core = new CameraWorkerCore()

onmessage = async e => {
    if (typeof e.data == 'object') {
        await core.processMessage(e.data)
    }
}

core.onDispatchMessage = (message => {
    let transfer: Transferable[] | undefined = undefined

    if (message.downscaledImage) {
        transfer = [message.downscaledImage.image]
    }

    if (message.lightingData) {
        transfer = [message.lightingData.data.data.buffer]
    }

    postMessage(message, { transfer })
})
