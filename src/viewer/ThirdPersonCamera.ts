import { capturePlaneGesture, resolvePlaneGesture, type PlaneGestureBase } from './cameraPlaneGesture.ts'
import * as THREE from 'three'
import { TpsViewTouch } from './TpsViewTouch.ts'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

interface CameraHost {
    cameraRotation?: number
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
    roll = 0
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
    private touchBase?:PlaneGestureBase
    private touchRoll=0
    private drag?: { id:number; x:number; y:number; startX:number; startY:number; mode:'rotate'|'pan'; moved:boolean }
    private suppressClickUntil=0
    private locked = false
    private lockPending = false
    private lockGeneration = 0
    private rawLock: 'accepted' | 'unsupported' | 'unknown' | 'requested' = 'unknown'
    private stream = 'pointermove'
    private eventCount = 0
    private lastExit?: { position: THREE.Vector3; quaternion: THREE.Quaternion; distance: number }
    private readonly gain = 0.0015 // direct device displacement; no angular inertia

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
        this.orientation.setFromQuaternion(camera.quaternion,'YXZ')
        this.yaw=this.orientation.y;this.pitch=-this.orientation.x;this.roll=this.orientation.z
        this.backward.set(0,0,1).applyQuaternion(camera.quaternion)
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
        if (!this.active || !Number.isFinite(delta)) return
        const {camera,controls}=this.hooks.scene(),step=delta*.0035*(controls.zoomSpeed??1)
        const next=this.distance+step,pivot=Math.max(camera.near*2,.01)
        this.backward.set(0,0,1).applyQuaternion(camera.quaternion)
        if(next<pivot)this.center.addScaledVector(this.backward,next-pivot)
        this.distance=Math.max(pivot,next)
    }

    /** Match Orbit's radians per CSS pixel for screen drags. Raw mouse-lock
     * deltas retain their separate, device-space sensitivity. */
    rotateViewport(dx:number,dy:number):void {
        const {controls,renderer}=this.hooks.scene()
        const gain=2*Math.PI*(controls.rotateSpeed??1)/Math.max(1,renderer.domElement.clientHeight||renderer.domElement.getBoundingClientRect().height)
        this.move(dx*gain/this.gain,dy*gain/this.gain,0,'viewport-drag')
    }

    pan(dx:number,dy:number):void {
        if(!this.active||!Number.isFinite(dx)||!Number.isFinite(dy))return
        const {camera,renderer}=this.hooks.scene()
        // Dolly may travel past the old orbit target. Its near-plane-sized
        // pivot is not the scene's manipulation plane: using it here made Ctrl
        // pan up to hundreds of times slower while the actor was still metres
        // away. Pan at the actor depth, with the normal Orbit panSpeed gain.
        const actor=this.hooks.actor()
        const anchor=actor?.getObjectByName('Hip')??actor
        const backward=new THREE.Vector3(0,0,1).applyQuaternion(camera.quaternion)
        const actorDepth=anchor?Math.abs(anchor.getWorldPosition(new THREE.Vector3()).sub(camera.position).dot(backward)):0
        const planeDepth=Math.max(this.distance,actorDepth,camera.near*2,.2)
        const gain=Number.isFinite(this.hooks.scene().controls.panSpeed)?this.hooks.scene().controls.panSpeed:1
        const scale=2*planeDepth*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)*gain/Math.max(1,renderer.domElement.clientHeight)
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
            if (actor === this.previousActorObject) {
                const delta=position.clone().sub(this.previousActor);this.center.add(delta)
                this.touchBase?.target.add(delta);this.touchBase?.position.add(delta)
            }
            this.previousActor.copy(position)
            this.previousActorObject = actor
        }
        this.orientation.set(-this.pitch, this.yaw, this.roll, 'YXZ')
        camera.quaternion.setFromEuler(this.orientation)
        this.backward.set(0, 0, 1).applyQuaternion(camera.quaternion)
        camera.position.copy(this.center).addScaledVector(this.backward, this.distance)
        camera.up.copy(this.orbit?.up??new THREE.Vector3(0,1,0))
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
        const relative=camera.quaternion.clone().invert().multiply(quaternion)
        this.hooks.scene().cameraRotation=THREE.MathUtils.radToDeg(2*Math.atan2(relative.z,relative.w))
        camera.quaternion.copy(quaternion)
        this.lastExit = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), distance: this.distance }
        controls.enableDamping = damping
        controls.connect(renderer.domElement)
        controls.enabled = this.orbit?.enabled ?? true
        this.orbit = undefined
    }


    /** Pointer ownership is independent of TPS locomotion ownership. */
    releasePointer(): void {
        this.drag=undefined;this.lockGeneration++
        if(document.pointerLockElement===this.hooks.scene().renderer.domElement)document.exitPointerLock()
    }
    /** Adopt an explicit user framing action without restarting locomotion. */
    adoptView():void {
        if(!this.active)return
        const {camera,controls}=this.hooks.scene()
        this.orientation.setFromQuaternion(camera.quaternion,'YXZ')
        this.yaw=this.orientation.y;this.pitch=-this.orientation.x;this.roll=this.orientation.z
        this.center.copy(controls.target);this.distance=camera.position.distanceTo(this.center)
        this.touchBase=undefined;this.drag=undefined
        this.previousActorObject=this.hooks.actor();this.previousActorObject?.getWorldPosition(this.previousActor)
        this.update()
    }
    rollBy(radians:number):void {if(this.active&&Number.isFinite(radians)){this.roll+=radians;this.update()}}
    resetRoll():void {
        if(!this.active)return
        // Re-express unwrapped pitch before zeroing optical roll; keep the
        // current viewing direction even when the user has crossed a pole.
        this.orientation.setFromQuaternion(this.hooks.scene().camera.quaternion,'YXZ')
        this.yaw=this.orientation.y;this.pitch=-this.orientation.x;this.roll=0
        this.touchView?.reset();this.touchBase=undefined;this.update()
    }

    private isControl(target: EventTarget | null): boolean {
        return target instanceof Element && !!target.closest('[data-tps-touch],button,input,select,textarea,[contenteditable="true"],[role="button"],[role="slider"],[role="listbox"],[role="combobox"]')
    }

    private inside(x: number, y: number): boolean {
        const rect = this.hooks.scene().renderer.domElement.getBoundingClientRect()
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }

    async capture(): Promise<void> {
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
            rotate: (dx,dy) => this.rotateViewport(dx,dy),
            pinch: () => {},
            twoStart:()=>{const {camera,controls,renderer}=this.hooks.scene();this.touchBase=capturePlaneGesture(camera,this.center,renderer.domElement.clientHeight||renderer.domElement.getBoundingClientRect().height,controls.zoomSpeed??1);this.touchRoll=this.roll},
            two:delta=>{if(!this.touchBase)return;const next=resolvePlaneGesture(this.touchBase,delta);if(!next)return;this.center.copy(next.target);this.distance=next.distance;this.roll=this.touchRoll+delta.roll},
            twoEnd:()=>{this.touchBase=undefined},
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
            const drag=this.drag
            if(!drag.moved&&Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<4)return
            const dx=event.clientX-drag.x,dy=event.clientY-drag.y
            drag.moved=true
            if(drag.mode==='pan')this.pan(dx,dy);else this.rotateViewport(dx,dy)
            drag.x=event.clientX;drag.y=event.clientY
        }, { signal })
        document.addEventListener('pointerdown', event => {
            if (event.pointerType === 'touch') return
            // Canvas manipulators claim the event first. In capture phase TPS
            // used to start a camera drag before the pose gizmo could claim it.
            if (event.defaultPrevented) return
            if (!this.active || ![0,1,2].includes(event.button) || this.isControl(event.target) || !this.inside(event.clientX,event.clientY)) return
            if (document.pointerLockElement === this.hooks.scene().renderer.domElement) return
            if (this.drag && this.drag.id !== event.pointerId) return
            // A click selects; a drag looks/pans. Neither silently locks the
            // cursor. Double-clicking the canvas is the explicit recapture.
            this.drag={id:event.pointerId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,mode:event.button!==0||event.shiftKey||event.ctrlKey||event.metaKey?'pan':'rotate',moved:false}
            this.hooks.scene().renderer.domElement.setPointerCapture(event.pointerId)
        }, {signal})
        for (const name of ['pointerup','pointercancel','lostpointercapture']) document.addEventListener(name,event=>{
            const e=event as PointerEvent,drag=this.drag;if(drag?.id!==e.pointerId)return
            this.drag=undefined
            if(drag.moved)this.suppressClickUntil=performance.now()+250
            const canvas=this.hooks.scene().renderer.domElement
            if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId)
        }, {signal})
        document.addEventListener('click',event=>{
            if(this.active&&performance.now()<this.suppressClickUntil&&!this.isControl(event.target)){event.preventDefault();event.stopImmediatePropagation()}
        }, {capture:true,signal})
        document.addEventListener('contextmenu',event=>{
            if(this.active&&!this.isControl(event.target)&&this.inside(event.clientX,event.clientY))event.preventDefault()
        },{signal})
        document.addEventListener('magius:tps-capture',()=>{if(this.active)void this.capture()},{signal})
        document.addEventListener('pointerlockchange', () => {
            const wasLocked = this.locked
            this.locked = document.pointerLockElement === this.hooks.scene().renderer.domElement
            this.drag = undefined
            document.body.classList.toggle('locomotion-pointer-locked', this.locked)
            this.trace([3, performance.now(), 'lock', this.locked, this.rawLock, this.stream])
            if (wasLocked && !this.locked && this.active) {
                this.hooks.released()
                this.hooks.status('Drag to look, right-drag to pan; double-click the view to lock the mouse. Escape releases the cursor and keeps TPS on.')
            }
        }, { signal })
        document.addEventListener('wheel', event => {
            if (!this.active) return
            const locked = document.pointerLockElement === this.hooks.scene().renderer.domElement
            if (!locked && (this.isControl(event.target) || !this.inside(event.clientX, event.clientY))) return
            event.preventDefault()
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.hooks.scene().renderer.domElement.clientHeight : 1
            this.zoom(event.deltaY * unit)
        }, { passive: false, capture: true, signal })
        window.addEventListener('blur', () => { this.drag = undefined; if (this.active) this.hooks.released() }, { signal })
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.drag = undefined }, { signal })
        window.addEventListener('resize', () => { this.drag = undefined }, { signal })
    }

    diagnostics(): Record<string, unknown> {
        return { implementation: 'clean-third-person-v1', yaw: this.yaw, pitch: this.pitch, distance: this.distance,
            active: this.active, roll: this.roll, stream: this.stream, rawLock: this.rawLock, events: this.eventCount, angularLimits: null }
    }
}
