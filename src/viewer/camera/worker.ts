import CameraWorkerThread from './WorkerThread?worker'
import { CameraWorkerCore, type CameraWorkerMessage } from './WorkerCore'

const enableWorkerThread = true

export function createCameraWorker() {
    if (window.OffscreenCanvas && enableWorkerThread) {
        return new CameraWorkerThread()
    } else {
        console.warn('Your browser does not support `OffscreenCanvas`. Camera environment will be processed in main thread. Performance may be significantly impacted.')
        return new CameraWorkerLegacy()
    }
}

export class CameraWorkerLegacy {
    private _core = new CameraWorkerCore()

    constructor() {
        this._core.onDispatchMessage = data => {
            if (this.onmessage) {
                this.onmessage(new MessageEvent('CameraWorkerLegacyMessage', { data }))
            }
        }
    }

    postMessage(message: CameraWorkerMessage, ..._: any) {
        this._core.processMessage(message)
    }

    onmessage: ((ev: MessageEvent<CameraWorkerMessage>) => any) | null = null
}
