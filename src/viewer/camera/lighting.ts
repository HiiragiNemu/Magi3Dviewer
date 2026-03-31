import * as THREE from 'three'
import { guiFloorShadowOpacity, guiLightAngle, guiLightHeight, rgb2luminance } from "../controllers"
import { perfLightCalc } from "../performance"
import { showCanvas } from "./environment"
import { lightProcessingSize } from './consts'

const debugEnabled = false

/** For debugging purposes only. No longer used for rendering */
const lightingCanvas = document.createElement('canvas')
lightingCanvas.width = lightProcessingSize
lightingCanvas.height = lightProcessingSize
/** For debugging purposes only. No longer used for rendering */
const lightingCtx = lightingCanvas.getContext('2d', { willReadFrequently: true })

const debugPoint = document.createElement('div')
debugPoint.style.width = debugPoint.style.height = '8px'
debugPoint.style.transform = 'translate(-50%, 50%)'
debugPoint.style.backgroundColor = 'red'
debugPoint.style.position = 'fixed'

export function updateSceneLight(imageData: ImageData) {
    let { x, y } = calcLightPosition(imageData)
    const angle = THREE.MathUtils.smoothstep(x, 0.25, 0.75) * 180 - 90
    y = y + 1

    guiLightAngle.setValue(angle)
    if (false) {
        guiLightHeight.setValue(y)
        guiFloorShadowOpacity.setValue(THREE.MathUtils.smoothstep(y, 1.4, 2.5))
    }
}

/**
 * range: `[0, 1]`  
 * `(0, 0)` at bottom-left, `(1, 1)` at top-right
 */
export function calcLightPosition(imageData: ImageData): { x: number, y: number } {
    const data = imageData.data

    let totalBrightness = 0;
    let sumX = 0;
    let sumY = 0;
    const brightnessData = []

    perfLightCalc.start()

    for (let i = 0; i < data.length; i += 4) {
        const brightness = rgb2luminance(data[i], data[i + 1], data[i + 2]);
        const x = (i / 4) % imageData.width;
        const y = Math.floor((i / 4) / imageData.width);

        sumX += brightness * x;
        sumY += brightness * y;
        totalBrightness += brightness;

        brightnessData.push(brightness)

        if (debugEnabled) data[i] = data[i + 1] = data[i + 2] = brightness
    }

    const sortedBrightness = [...brightnessData].sort((a, b) => a - b)
    // const brightnessLow = sortedBrightness[Math.round(sortedBrightness.length * 0.01)]
    const brightnessMax = sortedBrightness[Math.round(sortedBrightness.length * 0.99)]

    if (debugEnabled && lightingCtx) lightingCtx.putImageData(imageData, 0, 0)

    perfLightCalc.stop()


    const result = brightnessMax > 16 ? {
        x: sumX / (totalBrightness * imageData.width), // Normalized 0 to 1
        y: 1 - sumY / (totalBrightness * imageData.height)  // Normalized 0 to 1
    } : { x: 0.5, y: 0.5 }

    if (debugEnabled) {
        debugPoint.style.left = result.x * lightingCanvas.clientWidth + 2 + 'px'
        debugPoint.style.bottom = result.y * lightingCanvas.clientHeight + 2 + 'px'
    }

    return result
}

if (debugEnabled) {
    lightingCanvas.style.width = lightingCanvas.width * 4 + 'px'
    lightingCanvas.style.height = lightingCanvas.height * 4 + 'px'
    lightingCanvas.style.imageRendering = 'pixelated'
    showCanvas(lightingCanvas)
    document.body.appendChild(debugPoint)
}

Object.assign(window, { calcLightPosition })
