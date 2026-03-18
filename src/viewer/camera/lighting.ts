import * as THREE from 'three'
import { guiFloorShadowOpacity, guiLightAngle, guiLightHeight, rgb2luminance } from "../controllers"
import { perfLightCalc, perfLightDraw, perfLightGetImageData } from "../performance"
import { showCanvas } from "./background"
import { cameraDownscaleCanvas } from "./scale"

const lightingCanvas = document.createElement('canvas')
lightingCanvas.width = 32
lightingCanvas.height = 32
const lightingCtx = lightingCanvas.getContext('2d', { willReadFrequently: true })

const debugEnabled = false

const debugPoint = document.createElement('div')
debugPoint.style.width = debugPoint.style.height = '8px'
debugPoint.style.transform = 'translate(-50%, 50%)'
debugPoint.style.backgroundColor = 'red'
debugPoint.style.position = 'fixed'

export function updateSceneLight() {
    let { x, y } = calcLightPosition()
    const angle = THREE.MathUtils.smoothstep(x, 0.25, 0.75) * 180 - 90
    y = y + 1

    guiLightAngle.setValue(angle)
    if (false) {
        guiLightHeight.setValue(y)
        guiFloorShadowOpacity.setValue(THREE.MathUtils.smoothstep(y, 1.4, 2.5))
    }
}

export function calcLightPosition(): { x: number, y: number } {
    if (!lightingCtx) return { x: 0.5, y: 0.5 }

    perfLightDraw.start()
    lightingCtx.drawImage(cameraDownscaleCanvas, 0, 0, lightingCanvas.width, lightingCanvas.height)
    perfLightDraw.stop()

    perfLightGetImageData.start()
    const imageData = lightingCtx.getImageData(0, 0, lightingCanvas.width, lightingCanvas.height)
    const data = imageData.data
    perfLightGetImageData.stop()

    let totalBrightness = 0;
    let sumX = 0;
    let sumY = 0;
    const brightnessData = []

    perfLightCalc.start()

    for (let i = 0; i < data.length; i += 4) {
        const brightness = rgb2luminance(data[i], data[i + 1], data[i + 2]);
        const x = (i / 4) % lightingCanvas.width;
        const y = Math.floor((i / 4) / lightingCanvas.width);

        sumX += brightness * x;
        sumY += brightness * y;
        totalBrightness += brightness;

        brightnessData.push(brightness)

        if (debugEnabled) data[i] = data[i + 1] = data[i + 2] = brightness
    }

    const sortedBrightness = [...brightnessData].sort((a, b) => a - b)
    // const brightnessLow = sortedBrightness[Math.round(sortedBrightness.length * 0.01)]
    const brightnessMax = sortedBrightness[Math.round(sortedBrightness.length * 0.99)]

    if (debugEnabled) lightingCtx.putImageData(imageData, 0, 0)

    perfLightCalc.stop()


    const result = brightnessMax > 16 ? {
        x: sumX / (totalBrightness * lightingCanvas.width), // Normalized 0 to 1
        y: 1 - sumY / (totalBrightness * lightingCanvas.height)  // Normalized 0 to 1
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
