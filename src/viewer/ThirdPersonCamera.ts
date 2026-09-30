import * as THREE from 'three'
import { TpsViewTouch } from './TpsViewTouch.ts'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

interface CameraHost {
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    renderer: { domElement: HTMLCanvasElement }
}
interface CameraHooks {
    scene(): CameraHost
    actor(): THREE.Object3D | undefined
    released(): void
    status(text: string): void
}

/** One camera owner, one input stream. No angle clamps, pole logic or angular inertia. */
export class ThirdPersonCamera {
    yaw = 0
    pitch = 0
    distance = 7.5
    active = false
    private center = new THREE.Vector3()
    private previousActor = new THREE.Vector3()
    private previousActorObject?: THREE.Object3D
    private backward = new THREE.Vector3()
    private orientation = new THREE.Euler(0, 0, 0, 'YXZ')
    private orbit?: { controls: OrbitControls; enabled: boolean; up: THREE.Vector3 }
    private listeners?: AbortController
    private touchView?: TpsViewTouch
    private drag?: { id: number; x: number; y: number }
    private locked = false
    private lockPending = false
    private lockGeneration = 0
    private rawLock: 'accepted' | 'unsupported' | 'unknown' | 'requested' = 'unknown'
    private stream = 'pointermove'
    private eventCount = 0
    private lastExit?: { position: THREE.Vector3; quaternion: THREE.Quaternion; distance: number }
    private readonly gain = 0.0015 // radians per device delta, identical at every angle

    private hooks: CameraHooks
    constructor(hooks: CameraHooks) { this.hooks = hooks }

    private trace(row: Array<number | boolean | string | null>): void {
        const sink = (window as Window & { __s6TpsCameraTrace?: (row: unknown[]) => void }).__s6TpsCameraTrace
        sink?.(row)
    }

    start(): void {
        if (this.active) return
        const { camera, controls } = this.hooks.scene()
        this.active = true
        this.orbit = { controls, enabled: controls.enabled, up: camera.up.clone() }
        controls.enabled = false
        controls.disconnect()
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
        this.backward.set(0, 0, 1).applyQuaternion(camera.quaternion)
        this.yaw = Math.atan2(-right.z, right.x)
        this.pitch = Math.atan2(this.backward.y, up.y)
        const sameExit = this.lastExit
            && camera.position.distanceToSquared(this.lastExit.position) < 1e-16
            && 1 - Math.abs(camera.quaternion.dot(this.lastExit.quaternion)) < 1e-12
        this.distance = sameExit ? this.lastExit!.distance : camera.position.distanceTo(controls.target)
        this.center.copy(camera.position).addScaledVector(this.backward, -this.distance)
        this.previousActorObject = this.hooks.actor()
        this.previousActorObject?.getWorldPosition(this.previousActor)
        this.trace([3, performance.now(), 'start', this.stream, this.yaw, this.pitch, this.distance])
    }

    /** Relative device movement is displacement, not velocity: never multiply by frame time. */
    move(dx: number, dy: number, eventTime = 0, source = this.stream, trusted = false): void {
        if (!this.active || !Number.isFinite(dx) || !Number.isFinite(dy)) return
        this.yaw -= dx * this.gain
        this.pitch += dy * this.gain
        this.trace([0, performance.now(), dx, dy, this.yaw, this.pitch, eventTime, source, ++this.eventCount, this.rawLock, trusted])
    }

    zoom(delta: number): void {
        if (!Number.isFinite(delta)) return
        this.distance = Math.min(10, Math.max(0, this.distance + delta * 0.0035))
    }

    pan(dx:number,dy:number):void {
        if(!this.active||!Number.isFinite(dx)||!Number.isFinite(dy))return
        const {camera,renderer}=this.hooks.scene()
        const scale=2*Math.max(this.distance,.2)*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)/Math.max(1,renderer.domElement.clientHeight)
        this.center.addScaledVector(new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),-dx*scale)
        this.center.addScaledVector(new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion),dy*scale)
    }

    update(): void {
        if (!this.active) return
        const { camera, controls } = this.hooks.scene()
        if (this.orbit && this.orbit.controls !== controls) {
            controls.disconnect()
            this.orbit.controls = controls
        }
        controls.enabled = false
        const actor = this.hooks.actor()
        if (actor) {
            const position = actor.getWorldPosition(new THREE.Vector3())
            if (actor === this.previousActorObject) this.center.add(position.clone().sub(this.previousActor))
            this.previousActor.copy(position)
            this.previousActorObject = actor
        }
        this.orientation.set(-this.pitch, this.yaw, 0, 'YXZ')
        camera.quaternion.setFromEuler(this.orientation)
        this.backward.set(0, 0, 1).applyQuaternion(camera.quaternion)
        camera.position.copy(this.center).addScaledVector(this.backward, this.distance)
        camera.up.set(0, 1, 0)
        controls.target.copy(this.center)
        this.trace([1, performance.now(), this.yaw, this.pitch, ...camera.quaternion.toArray(), ...camera.position.toArray(), this.distance])
    }

    stop(): void {
        if (!this.active) return
        this.update()
        this.active = false
        this.touchView?.reset()
        this.drag = undefined
        this.lockGeneration++
        const { camera, controls, renderer } = this.hooks.scene()
        if (document.pointerLockElement === renderer.domElement) document.exitPointerLock()
        document.body.classList.remove('locomotion-pointer-locked')
        const position = camera.position.clone(), quaternion = camera.quaternion.clone()
        // Orbit's state is private. Drain pending gestures off-screen before reconnecting.
        const damping = controls.enableDamping
        controls.enableDamping = false
        controls.update()
        camera.position.copy(position)
        camera.quaternion.copy(quaternion)
        // Orbit's navigation axis is not the TPS camera's screen-up vector.
        // Restore the axis owned by ordinary viewing before TPS took control.
        camera.up.copy(this.orbit?.up ?? new THREE.Vector3(0, 1, 0))
        controls.target.copy(position).addScaledVector(this.backward, -Math.max(this.distance, camera.near))
        controls.update()
        this.lastExit = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), distance: this.distance }
        controls.enableDamping = damping
        controls.connect(renderer.domElement)
        controls.enabled = this.orbit?.enabled ?? true
        this.orbit = undefined
    }

    private isControl(target: EventTarget | null): boolean {
        return target instanceof Element && !!target.closest('[data-tps-touch],button,input,select,textarea,[contenteditable="true"],[role="button"],[role="slider"],[role="listbox"],[role="combobox"]')
    }

    private inside(x: number, y: number): boolean {
        const rect = this.hooks.scene().renderer.domElement.getBoundingClientRect()
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }

    private async capture(): Promise<void> {
        if (this.lockPending || !this.active) return
        const canvas = this.hooks.scene().renderer.domElement
        if (document.pointerLockElement === canvas) return
        const generation = ++this.lockGeneration
        this.lockPending = true
        try {
            // Windows cursor acceleration/recentering is not a camera signal.
            this.rawLock = 'requested'
            const request = (canvas.requestPointerLock as (options?: { unadjustedMovement: boolean }) => Promise<void> | void)({ unadjustedMovement: true })
            await request
            this.rawLock = request && typeof request.then === 'function' ? 'accepted' : 'unknown'
        } catch (error) {
            if (generation !== this.lockGeneration || !this.active) return
            if ((error as DOMException)?.name === 'NotSupportedError') {
                try { await canvas.requestPointerLock(); this.rawLock = 'unsupported' }
                catch { this.hooks.status('Mouse capture unavailable; hold and drag to look around.') }
            } else this.hooks.status('Mouse capture unavailable; hold and drag to look around.')
        } finally {
            this.lockPending = false
            if (generation !== this.lockGeneration || !this.active) {
                if (document.pointerLockElement === canvas) document.exitPointerLock()
            }
        }
    }

    install(): void {
        if (this.listeners) return
        this.listeners = new AbortController()
        const signal = this.listeners.signal
        this.touchView = new TpsViewTouch({
            active: () => this.active,
            canvas: () => this.hooks.scene().renderer.domElement,
            isControl: target => this.isControl(target),
            rotate: (dx,dy) => this.move(dx*2,dy*2,0,'touch'),
            pinch: ratio => { if(Number.isFinite(ratio)&&ratio>0)this.distance=Math.min(20,Math.max(.12,this.distance*ratio)) },
            pan:(dx,dy)=>this.pan(dx,dy),
            tap:(x,y)=>document.dispatchEvent(new CustomEvent('magius:tps-select-at',{detail:{x,y}})),
        })
        // Never subscribe to mousemove alongside Pointer Events. Raw and normal
        // pointer streams overlap; exactly ONE of them owns locked movement.
        this.stream = window.isSecureContext && 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove'
        document.addEventListener(this.stream, ((event: PointerEvent) => {
            if (!this.active || document.pointerLockElement !== this.hooks.scene().renderer.domElement) return
            if (event.pointerType && event.pointerType !== 'mouse') return
            // The dispatched event already aggregates its coalesced children.
            // Do not replay those children as extra movement.
            this.move(event.movementX, event.movementY, event.timeStamp, this.stream, event.isTrusted)
        }) as EventListener, { signal })
        document.addEventListener('pointermove', event => {
            if (event.pointerType === 'touch') return
            if (!this.active || document.pointerLockElement === this.hooks.scene().renderer.domElement || this.drag?.id !== event.pointerId) return
            if (event.cancelable) event.preventDefault()
            this.move(event.clientX - this.drag.x, event.clientY - this.drag.y, event.timeStamp, 'drag', event.isTrusted)
            this.drag.x = event.clientX; this.drag.y = event.clientY
        }, { signal })
        document.addEventListener('pointerdown', event => {
            if (event.pointerType === 'touch') return
            if (!this.active || event.button !== 0 || this.isControl(event.target) || !this.inside(event.clientX, event.clientY)) return
            if (document.pointerLockElement !== this.hooks.scene().renderer.domElement) {
                if (this.drag && this.drag.id !== event.pointerId) return
                this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
                // Touch look is an independent finger, not a mouse-lock request.
                // A joystick/jump finger must neither steal nor release it.
                if (!event.pointerType || event.pointerType === 'mouse') void this.capture()
                else this.hooks.scene().renderer.domElement.setPointerCapture(event.pointerId)
            }
            event.preventDefault()
        }, { capture: true, signal })
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(name, event => {
            if (this.drag?.id === (event as PointerEvent).pointerId) this.drag = undefined
        }, { signal })
        document.addEventListener('pointerlockchange', () => {
            const wasLocked = this.locked
            this.locked = document.pointerLockElement === this.hooks.scene().renderer.domElement
            this.drag = undefined
            document.body.classList.toggle('locomotion-pointer-locked', this.locked)
            this.trace([3, performance.now(), 'lock', this.locked, this.rawLock, this.stream])
            if (wasLocked && !this.locked && this.active) this.hooks.released()
        }, { signal })
        document.addEventListener('wheel', event => {
            if (!this.active) return
            const locked = document.pointerLockElement === this.hooks.scene().renderer.domElement
            if (!locked && (this.isControl(event.target) || !this.inside(event.clientX, event.clientY))) return
            event.preventDefault()
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.hooks.scene().renderer.domElement.clientHeight : 1
            this.zoom(Math.max(-120, Math.min(120, event.deltaY * unit)))
        }, { passive: false, capture: true, signal })
        window.addEventListener('blur', () => { this.drag = undefined; if (this.active) this.hooks.released() }, { signal })
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.drag = undefined }, { signal })
        window.addEventListener('resize', () => { this.drag = undefined }, { signal })
    }

    diagnostics(): Record<string, unknown> {
        return { implementation: 'clean-third-person-v1', yaw: this.yaw, pitch: this.pitch, distance: this.distance,
            active: this.active, stream: this.stream, rawLock: this.rawLock, events: this.eventCount, angularLimits: null }
    }
}
