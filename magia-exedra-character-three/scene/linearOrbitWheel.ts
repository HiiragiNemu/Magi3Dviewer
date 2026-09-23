import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/** Equal wheel input moves the camera an equal world distance, not a percentage
 * of the remaining radius. Advance the pivot when crossing it, never invert the
 * view direction or asymptotically stall against a zero-radius orbit. */
export function applyLinearOrbitWheel(
    camera: THREE.PerspectiveCamera,
    target: THREE.Vector3,
    deltaY: number,
    deltaMode: number,
    viewportHeight: number,
    zoomSpeed = 1,
): boolean {
    if (!Number.isFinite(deltaY) || deltaY === 0) return false
    const units = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, viewportHeight) : 1
    const step = deltaY * units * 0.0035 * zoomSpeed
    const offset = camera.position.clone().sub(target)
    const distance = offset.length()
    const direction = distance > 1e-8 ? offset.divideScalar(distance)
        : camera.getWorldDirection(new THREE.Vector3()).negate()
    camera.position.addScaledVector(direction, step)
    const pivotDistance = Math.max(camera.near * 2, 0.01)
    if (distance + step < pivotDistance) {
        target.copy(camera.position).addScaledVector(direction, -pivotDistance)
    }
    return true
}

export function installLinearOrbitWheel(controls: OrbitControls, camera: THREE.PerspectiveCamera): void {
    // Capture only wheel on this render canvas. Orbit retains drag/pinch controls;
    // disabled controls (TPS) retain their own wheel handler without double input.
    controls.domElement?.addEventListener('wheel', event => {
        if (!controls.enabled || !controls.enableZoom) return
        const wheel = event as WheelEvent
        if (!applyLinearOrbitWheel(camera, controls.target, wheel.deltaY, wheel.deltaMode,
            controls.domElement?.clientHeight ?? 1, controls.zoomSpeed)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        controls.dispatchEvent({ type: 'change' })
    }, { capture: true, passive: false })
}
