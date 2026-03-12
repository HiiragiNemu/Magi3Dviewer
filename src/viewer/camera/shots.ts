import * as THREE from 'three';
import { scene } from '../scene';
import { cameraVideo, getCameraStreamDimensions } from './background';

const cameraSaveContainer = document.getElementById('camera-save-container') as HTMLDivElement
const cameraSaveImg = document.getElementById('camera-save-img') as HTMLImageElement
const btnCameraSaveClose = document.getElementById('camera-save-close') as HTMLButtonElement
const btnCameraSaveDownload = document.getElementById('camera-save-download') as HTMLButtonElement

export function savePhoto() {
    const canvas = document.createElement('canvas')

    const renderSize = new THREE.Vector2()
    scene.renderer.getDrawingBufferSize(renderSize)
    const renderAspect = renderSize.width / renderSize.height
    console.log('render size:', renderSize, renderAspect)

    const cameraSize = getCameraStreamDimensions()
    const cameraAspect = cameraSize.width / cameraSize.height
    console.log('camera size:', cameraSize, cameraAspect)

    const cameraSizeCropped: ReturnType<typeof getCameraStreamDimensions> = (() => {
        if (renderAspect > cameraAspect) {
            return {
                width: cameraSize.width,
                height: cameraSize.width / renderAspect
            }
        } else {
            return {
                width: cameraSize.height * renderAspect,
                height: cameraSize.height
            }
        }
    })()

    if (renderSize.width > cameraSizeCropped.width) {
        canvas.width = renderSize.width
        canvas.height = renderSize.height
    } else {
        canvas.width = cameraSizeCropped.width
        canvas.height = cameraSizeCropped.height
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let t = performance.now()
    if (renderAspect > cameraAspect) {
        ctx.drawImage(cameraVideo, 0, canvas.height * (cameraAspect - renderAspect) / 2 / cameraAspect, canvas.width, canvas.width / cameraAspect)
    } else {
        ctx.drawImage(cameraVideo, canvas.width * (renderAspect - cameraAspect) / 2 / renderAspect, 0, canvas.height * cameraAspect, canvas.height)
    }
    console.log('draw camera:', performance.now() - t, 'ms')

    t = performance.now()
    ctx.filter = scene.getColorFilterCSS()
    ctx.drawImage(scene.renderer.domElement, 0, 0, canvas.width, canvas.height)
    console.log('draw scene:', performance.now() - t, 'ms')

    t = performance.now()
    // canvas.toBlob(blob => {
    //     console.log('toBlob:', performance.now() - t, 'ms')
    //     if (!blob) return
    //     const url = URL.createObjectURL(blob)
    //     const win = window.open(url)
    //     if (win) {
    //         const interval = setInterval(() => {
    //             if (win.closed) {
    //                 clearInterval(interval)
    //                 URL.revokeObjectURL(url)
    //             }
    //         }, 500);
    //     }
    // }, 'image/jpeg')
    const url = canvas.toDataURL()
    console.log('toDataURL:', performance.now() - t, 'ms')

    cameraSaveImg.src = url
    cameraSaveContainer.style.display = 'block'
    document.documentElement.style.overscrollBehavior = 'contain'
}

btnCameraSaveClose.onclick = () => {
    cameraSaveContainer.style.removeProperty('display')
    document.documentElement.style.removeProperty('overscroll-behavior')
    cameraSaveImg.src = ''
}

btnCameraSaveDownload.onclick = () => {
    const a = document.createElement('a')
    a.href = cameraSaveImg.src
    a.download = `Magi3Dviewer - ${new Date().toLocaleString()}.png`
    a.click()
}

Object.assign(window, { savePhoto })
