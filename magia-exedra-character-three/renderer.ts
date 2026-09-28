import * as THREE from 'three';

export let renderer: THREE.WebGLRenderer | undefined
let animationLoop: XRFrameRequestCallback = () => undefined
let animationLoops: Array<() => any> = []
let beforeAnimationLoops: Array<() => void> = []
let cameraRenderLoops: Array<(camera: THREE.Camera) => any> = []

let renderPaused = false
let pageVisibilityPaused =
    typeof document !== 'undefined' && document.visibilityState === 'hidden'
// A user can keep several Viewer windows open at once. Browser visibility only
// pauses background tabs; a visible but unfocused window would otherwise keep
// its complete shadow/composer chain running. Freeze that window until it is
// focused again so the active Viewer keeps the full native-DPR + AA path.
let pageFocusPaused = false

const clock = new THREE.Clock()
let clockDelta = clock.getDelta()

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        pageVisibilityPaused = document.visibilityState === 'hidden'
        // Consume the hidden interval immediately. The first visible frame
        // then advances by one real frame rather than fast-forwarding every
        // mixer, material animation and VFX by the whole background duration.
        clock.getDelta()
    }, { passive: true })
}

if (typeof window !== 'undefined') {
    window.addEventListener('blur', () => {
        pageFocusPaused = true
        clock.getDelta()
    }, { passive: true })
    window.addEventListener('focus', () => {
        pageFocusPaused = false
        clock.getDelta()
    }, { passive: true })
}

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
    // Three r182 removed the old PCFSoft program define. Keeping the
    // deprecated enum makes WebGLProgram select SHADOWMAP_TYPE_BASIC even
    // though WebGLShadowMap later warns that it will use PCF. Select the
    // supported enum up front so stage receivers execute the filtered depth-
    // comparison branch rather than a single nearest/basic sample.
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02

    renderer.setAnimationLoop((...args) => {
        clockDelta = clock.getDelta()
        if (renderPaused || pageVisibilityPaused || pageFocusPaused) return
        // Restore the previous manual overlay before any animation/physics
        // writer can read that overlay back as its new base pose.
        beforeAnimationLoops.forEach(callback => callback())
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

export function addBeforeAnimationLoop(callback: () => void) {
    if (!beforeAnimationLoops.includes(callback)) beforeAnimationLoops.push(callback)
}

export function removeBeforeAnimationLoop(callback: () => void) {
    beforeAnimationLoops = beforeAnimationLoops.filter(value => value !== callback)
}

export function addAnimationLoop(callback: () => any) {
    if (animationLoops.includes(callback)) return
    animationLoops.push(callback)
}

export function removeAnimationLoop(callback: () => any) {
    animationLoops = animationLoops.filter(x => x != callback)
}

export function addCameraRenderLoop(callback: (camera: THREE.Camera) => any) {
    if (cameraRenderLoops.includes(callback)) return
    cameraRenderLoops.push(callback)
}

export function removeCameraRenderLoop(callback: (camera: THREE.Camera) => any) {
    cameraRenderLoops = cameraRenderLoops.filter(x => x != callback)
}

/**
 * Updates camera-dependent official consumers once with the main view camera.
 * The scene invokes this before any shadow, depth, composer, or direct pass so
 * auxiliary pass cameras never replace the serialized FaceMeshSwitcher input.
 */
export function updateCameraRenderLoops(camera: THREE.Camera) {
    cameraRenderLoops.forEach(callback => callback(camera))
}

export function getClockDelta() {
    return clockDelta
}

export function setRenderPaused(value: boolean) {
    renderPaused = value
}

export function getRenderPauseState() {
    return {
        manuallyPaused: renderPaused,
        pageVisibilityPaused,
        pageFocusPaused,
        effectivePaused:
            renderPaused || pageVisibilityPaused || pageFocusPaused,
    }
}

Object.assign(window, { setRenderPaused, getRenderPauseState })
