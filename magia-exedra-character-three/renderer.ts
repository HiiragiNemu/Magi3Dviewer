import * as THREE from 'three';

export let renderer: THREE.WebGLRenderer | undefined
let animationLoop: XRFrameRequestCallback = () => undefined
let animationLoops: Array<() => any> = []

const clock = new THREE.Clock()
let clockDelta = clock.getDelta()

/**
 * Characters must a the renderer created by this function to render correctly
 */
export function createRenderer(parameters?: THREE.WebGLRendererParameters) {
    renderer = new THREE.WebGLRenderer({
        ...parameters,
        stencil: true,
    })

    console.log('MaxAnisotropy:', renderer.capabilities.getMaxAnisotropy())

    renderer.setAnimationLoop((...args) => {
        clockDelta = clock.getDelta()
        animationLoop(...args)
        animationLoops.forEach(x => x())
    })
    renderer.setAnimationLoop = (callback: XRFrameRequestCallback | null) => {
        animationLoop = callback ?? (() => undefined)
    }

    return renderer
}

export function addAnimationLoop(callback: () => any) {
    animationLoops.push(callback)
}

export function removeAnimationLoop(callback: () => any) {
    animationLoops = animationLoops.filter(x => x != callback)
}

export function getClockDelta() {
    return clockDelta
}
