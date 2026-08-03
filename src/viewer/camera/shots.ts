import * as THREE from 'three';
import { scene } from '../scene';
import { cameraVideo, getCameraVideoResolution, isCameraEnabled } from './camera';
import { setRenderPaused } from 'magia-exedra-character-three/renderer';
import { btnCameraShot } from '.';
import { bgImageEl, isBackgroundImageVisible } from '../controllers';
import { translateUiText } from '../localization/zhCN';

const cameraSaveContainer = document.getElementById('camera-save-container') as HTMLDivElement
const cameraSaveImg = document.getElementById('camera-save-img') as HTMLImageElement
const btnCameraSaveClose = document.getElementById('camera-save-close') as HTMLButtonElement
const btnCameraSaveDownload = document.getElementById('camera-save-download') as HTMLButtonElement

btnCameraSaveClose.onclick = closeImage
btnCameraSaveDownload.onclick = () => {
    btnCameraSaveDownload.disabled = true
    setTimeout(() => {
        downloadImage()
        setTimeout(() => {
            btnCameraSaveDownload.disabled = false
        }, 1000);
    }, 50);
}

export function savePhoto() {
    if (btnCameraShot.classList.contains('shoting')) return
    if (cameraSaveContainer.style.display) return

    pauseViewer()
    btnCameraShot.classList.add('shoting')

    let bgSource, bgSize

    if (isCameraEnabled()) {
        bgSource = cameraVideo
        bgSize = getCameraVideoResolution()
    }
    else if (isBackgroundImageVisible()) {
        bgSource = bgImageEl
        bgSize = {
            width: bgImageEl.naturalWidth,
            height: bgImageEl.naturalHeight
        }
    }

    const c = compositeBgScene(bgSource, bgSize)

    if (c) {
        const canvas = c

        let t = performance.now()
        if (true) {
            canvas.toBlob(blob => {
                console.log('toBlob:', performance.now() - t, 'ms')
                if (blob) {
                    showImage(URL.createObjectURL(blob))
                }
            })
        } else {
            setTimeout(() => {
                const url = canvas.toDataURL()
                console.log('toDataURL:', performance.now() - t, 'ms')
                showImage(url)
            }, 50);
        }
    }
    else {
        window.alert(translateUiText('Photo capture failed'))
        resumeViewer()
        btnCameraShot.classList.remove('shoting')
    }
}

const metaViewport = document.querySelector('meta[name="viewport"]') as HTMLMetaElement
const origViewportContent = metaViewport.content

function showImage(url: string) {
    pauseViewer()

    btnCameraSaveClose.disabled = true
    btnCameraSaveDownload.disabled = true

    tryRevokeImageObjectURL()
    cameraSaveImg.addEventListener('load', onImageLoad)
    cameraSaveImg.src = url
}

function onImageLoad() {
    cameraSaveContainer.style.display = 'block'

    document.documentElement.style.overscrollBehavior = 'contain'
    document.documentElement.style.overflow = 'hidden'
    metaViewport.content = origViewportContent.replace(', maximum-scale=1.0', '').replace('maximum-scale=1.0', '')

    btnCameraShot.classList.remove('shoting')

    btnCameraSaveClose.disabled = false
    btnCameraSaveDownload.disabled = false
}

function closeImage() {
    resumeViewer()

    tryRevokeImageObjectURL()
    cameraSaveImg.removeEventListener('load', onImageLoad)
    cameraSaveImg.src = ''
    cameraSaveContainer.style.removeProperty('display')

    document.documentElement.style.removeProperty('overscroll-behavior')
    document.documentElement.style.removeProperty('overflow')
    metaViewport.content = origViewportContent

    btnCameraShot.classList.remove('shoting')
}

function downloadImage() {
    const a = document.createElement('a')
    a.href = cameraSaveImg.src
    a.download = `Magi3Dviewer - ${new Date().toLocaleString()}.png`
    a.click()
}

function pauseViewer() {
    setRenderPaused(true)
    if (isCameraEnabled()) cameraVideo.pause()
}

function resumeViewer() {
    setRenderPaused(false)
    if (isCameraEnabled()) cameraVideo.play()
}

function tryRevokeImageObjectURL() {
    if (cameraSaveImg.src.startsWith('blob:')) {
        URL.revokeObjectURL(cameraSaveImg.src)
    }
}

function compositeBgScene(bg?: CanvasImageSource, bgSize?: { width: number, height: number }) {
    const canvas = document.createElement('canvas')

    const renderSize = new THREE.Vector2()
    scene.renderer.getDrawingBufferSize(renderSize)
    const renderAspect = renderSize.width / renderSize.height
    console.log('render size:', renderSize, renderAspect)

    bgSize ??= { width: 0, height: 0 }
    const bgAspect = bgSize.width / bgSize.height
    console.log('bg size:', bgSize, bgAspect)

    const bgSizeCropped: typeof bgSize = (() => {
        if (renderAspect > bgAspect) {
            return {
                width: bgSize.width,
                height: bgSize.width / renderAspect
            }
        } else {
            return {
                width: bgSize.height * renderAspect,
                height: bgSize.height
            }
        }
    })()

    if (renderSize.width > bgSizeCropped.width) {
        canvas.width = renderSize.width
        canvas.height = renderSize.height
    } else {
        canvas.width = bgSizeCropped.width
        canvas.height = bgSizeCropped.height
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let t

    if (bg) {
        t = performance.now()
        if (renderAspect > bgAspect) {
            ctx.drawImage(bg, 0, canvas.height * (bgAspect - renderAspect) / 2 / bgAspect, canvas.width, canvas.width / bgAspect)
        } else {
            ctx.drawImage(bg, canvas.width * (renderAspect - bgAspect) / 2 / renderAspect, 0, canvas.height * bgAspect, canvas.height)
        }
        console.log('draw bg:', performance.now() - t, 'ms')
    }

    t = performance.now()
    // TODO: Safari does not support this filter
    ctx.filter = scene.getColorFilterCSS()
    ctx.drawImage(scene.renderer.domElement, 0, 0, canvas.width, canvas.height)
    console.log('draw scene:', performance.now() - t, 'ms')

    return canvas
}

Object.assign(window, { savePhoto })
