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

export const perfCameraDownscale = new PerformanceController('Camera downscale')
export const perfPanoramaDraw = new PerformanceController('Panorama draw')
export const perfPmrem = new PerformanceController('PMREM')
export const perfLightDraw = new PerformanceController('Light drawCtx')
export const perfLightGetImageData = new PerformanceController('Light getData')
export const perfLightCalc = new PerformanceController('Light calc')

const cameraPerfControllers = [perfCameraDownscale, perfPanoramaDraw, perfPmrem, perfLightDraw, perfLightGetImageData, perfLightCalc]
const controllers = [...cameraPerfControllers]

export function clearCameraPerformance() {
    cameraPerfControllers.forEach(x => x.clear())
}

perfTimeEl.appendChild(scene.perfRender.domElement)
controllers.forEach(x => perfTimeEl.appendChild(x.domElement))
