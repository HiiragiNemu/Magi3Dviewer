import { PerformanceController } from "magia-exedra-character-three/performance"
import { scene } from "./scene"

const perfTimeEl = document.getElementById('perf-time') as HTMLDivElement

export const PerformanceMetricsOptions = {
    get visible() {
        return perfTimeEl.style.display != 'none'
    },
    set visible(visible) {
        if (visible) {
            perfTimeEl.style.removeProperty('display')
        } else {
            perfTimeEl.style.display = 'none'
        }
    }
}

export const perfCreateImageBitmap = new PerformanceController('CreateImageBitmap')
export const perfPanoramaDraw = new PerformanceController('Panorama draw')
export const perfPmrem = new PerformanceController('PMREM')
export const perfLightCalc = new PerformanceController('Light calc')

export const perfWorkerDownscale = new PerformanceController('Worker downscale')
export const perfWorkerLightDraw = new PerformanceController('Worker light draw')
export const perfWorkerLightGet = new PerformanceController('Worker light get')
export const perfWorkerTotal = new PerformanceController('Worker total')

const cameraPerfControllers = [
    perfCreateImageBitmap, perfPanoramaDraw, perfPmrem, perfLightCalc,
    perfWorkerDownscale, perfWorkerLightDraw, perfWorkerLightGet, perfWorkerTotal
]

const controllers = [...cameraPerfControllers]

export function clearCameraPerformance() {
    cameraPerfControllers.forEach(x => x.clear())
}

perfTimeEl.appendChild(scene.perfRender.domElement)
controllers.forEach(x => perfTimeEl.appendChild(x.domElement))
