import * as THREE from 'three';

export let renderer: THREE.WebGLRenderer | undefined
let animationLoop: XRFrameRequestCallback = () => undefined
let animationLoops: Array<() => any> = []

let renderPaused = false

const clock = new THREE.Clock()
let clockDelta = clock.getDelta()

/**
 * Characters must use the renderer created by this function to render correctly.
 */
export function createRenderer(parameters?: THREE.WebGLRendererParameters) {
    renderer = new THREE.WebGLRenderer({
        ...parameters,
        stencil: true,
    })

    console.log('MaxAnisotropy:', renderer.capabilities.getMaxAnisotropy())

    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02

    renderer.setAnimationLoop((...args) => {
        if (renderPaused) return
        clockDelta = clock.getDelta()
        // Unity updates the AnimationMixer and ReDrive material controller
        // before drawing. Rendering first left Head-driven face/AngelRing
        // uniforms one frame behind the visible pose.
        animationLoops.forEach(x => x())
        animationLoop(...args)
    })
    renderer.setAnimationLoop = (callback: XRFrameRequestCallback | null) => {
        animationLoop = callback ?? (() => undefined)
    }

    return renderer
}

export function addAnimationLoop(callback: () => any) {
    if (animationLoops.includes(callback)) return
    animationLoops.push(callback)
}

export function removeAnimationLoop(callback: () => any) {
    animationLoops = animationLoops.filter(x => x != callback)
}

export function getClockDelta() {
    return clockDelta
}

export function setRenderPaused(value: boolean) {
    renderPaused = value
}

Object.assign(window, { setRenderPaused })
