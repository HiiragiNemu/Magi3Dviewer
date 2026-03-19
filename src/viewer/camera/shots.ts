import * as THREE from 'three';
import { scene } from '../scene';
import { cameraVideo, getCameraVideoResolution } from './background';
import { setRenderPaused } from 'magia-exedra-character-three/renderer';
import { btnCameraShot } from '.';

const cameraSaveContainer = document.getElementById('camera-save-container') as HTMLDivElement
const cameraSaveImg = document.getElementById('camera-save-img') as HTMLImageElement
const btnCameraSaveClose = document.getElementById('camera-save-close') as HTMLButtonElement
const btnCameraSaveDownload = document.getElementById('camera-save-download') as HTMLButtonElement

cameraSaveImg.onload = () => {
    btnCameraShot.classList.remove('shoting')
    setTimeout(() => {
        btnCameraSaveClose.disabled = false
        btnCameraSaveDownload.disabled = false
    }, 100);
}

btnCameraSaveClose.onclick = closeImage
btnCameraSaveDownload.onclick = () => {
    btnCameraSaveDownload.disabled = true
    setTimeout(() => {
        downloadImage()
        setTimeout(() => {
            btnCameraSaveDownload.disabled = false
        }, 1500);
    }, 50);
}

let imgDownloadUrl = ''

export function savePhoto() {
    if (btnCameraShot.classList.contains('shoting')) return
    if (cameraSaveContainer.style.display) return

    pauseViewer()
    btnCameraShot.classList.add('shoting')

    setTimeout(() => {
        const canvas = document.createElement('canvas')

        const renderSize = new THREE.Vector2()
        scene.renderer.getDrawingBufferSize(renderSize)
        const renderAspect = renderSize.width / renderSize.height
        console.log('render size:', renderSize, renderAspect)

        const cameraSize = getCameraVideoResolution()
        const cameraAspect = cameraSize.width / cameraSize.height
        console.log('camera size:', cameraSize, cameraAspect)

        const cameraSizeCropped: ReturnType<typeof getCameraVideoResolution> = (() => {
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
        // TODO: Safari does not support this filter
        ctx.filter = scene.getColorFilterCSS()
        ctx.drawImage(scene.renderer.domElement, 0, 0, canvas.width, canvas.height)
        console.log('draw scene:', performance.now() - t, 'ms')

        t = performance.now()
        // canvas.toBlob(blob => {
        //     console.log('toBlob:', performance.now() - t, 'ms')
        //     if (!blob) return
        //     imgDownloadUrl = URL.createObjectURL(blob)
        //     showImage()
        // })
        imgDownloadUrl = canvas.toDataURL()
        console.log('toDataURL:', performance.now() - t, 'ms')

        showImage()
    }, 50);
}

const metaViewport = document.querySelector('meta[name="viewport"]') as HTMLMetaElement
const origViewportContent = metaViewport.content

function showImage() {
    pauseViewer()

    cameraSaveImg.src = imgDownloadUrl
    cameraSaveContainer.style.display = 'block'

    document.documentElement.style.overscrollBehavior = 'contain'
    document.documentElement.style.overflow = 'hidden'
    metaViewport.content = origViewportContent.replace(', maximum-scale=1.0', '').replace('maximum-scale=1.0', '')

    btnCameraSaveClose.disabled = true
    btnCameraSaveDownload.disabled = true
    setTimeout(() => {
        btnCameraSaveClose.disabled = false
    }, 100);
}

function closeImage() {
    resumeViewer()

    cameraSaveImg.src = ''
    cameraSaveContainer.style.removeProperty('display')

    document.documentElement.style.removeProperty('overscroll-behavior')
    document.documentElement.style.removeProperty('overflow')
    metaViewport.content = origViewportContent

    btnCameraShot.classList.remove('shoting')

    if (imgDownloadUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imgDownloadUrl)
    }
}

function downloadImage() {
    const a = document.createElement('a')
    a.href = cameraSaveImg.src
    a.download = `Magi3Dviewer - ${new Date().toLocaleString()}.png`
    a.click()
}

function pauseViewer() {
    setRenderPaused(true)
    if (cameraVideo.srcObject) cameraVideo.pause()
}

function resumeViewer() {
    setRenderPaused(false)
    if (cameraVideo.srcObject) cameraVideo.play()
}

Object.assign(window, { savePhoto })
