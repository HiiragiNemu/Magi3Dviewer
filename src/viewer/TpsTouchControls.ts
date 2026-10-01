export interface TpsMovementInput {
    moveX: number
    moveZ: number
    run: boolean
    jumpPressed: boolean
}
interface TouchHooks {
    canvas(): HTMLCanvasElement
    exit(): void
}

/** Screen-space intent only. The existing controller owns motion, facing and jumping. */
export function joystickIntent(dx: number, dy: number, radius: number) {
    if (![dx, dy, radius].every(Number.isFinite) || radius <= 0) return { x: 0, z: 0 }
    const distance = Math.hypot(dx, dy)
    const strength = Math.min(1, distance / radius)
    const deadZone = 0.12
    if (strength <= deadZone) return { x: 0, z: 0 }
    const magnitude = (strength - deadZone) / (1 - deadZone)
    return { x: dx / distance * magnitude, z: -dy / distance * magnitude }
}

export class TpsTouchControls {
    readonly element: HTMLDivElement
    private readonly stick: HTMLButtonElement
    private readonly thumb: HTMLSpanElement
    private readonly runButton: HTMLButtonElement
    private readonly jumpButton: HTMLButtonElement
    private readonly exitButton: HTMLButtonElement
    private readonly hooks: TouchHooks
    private readonly abort = new AbortController()
    private readonly coarse: MediaQueryList
    private resize?: ResizeObserver
    private enabled = false
    private lastInput: 'touch'|'mouse'|'keyboard'|undefined
    private joystick?: { id: number; x: number; y: number; radius: number }
    private jumpPointer?: number
    private runLatched = false
    private jumpQueued = false
    private x = 0
    private z = 0

    constructor(hooks: TouchHooks) {
        this.hooks = hooks
        this.coarse = matchMedia('(any-pointer: coarse)')
        const element = document.createElement('div')
        element.id = 'tps-touch-controls'
        element.dataset.tpsTouch = 'true'
        element.setAttribute('role', 'group')
        element.setAttribute('aria-label', 'TPS 触控操作')
        element.hidden = true
        element.innerHTML = `<div class="tps-touch-left"><button type="button" id="tps-touch-stick" aria-label="移动摇杆，拖动方向行走" data-tps-touch="stick"><span class="tps-stick-axis" aria-hidden="true"></span><span class="tps-stick-thumb" aria-hidden="true"></span></button><span class="tps-touch-hint">拖动移动／转向</span></div><div class="tps-touch-right"><button type="button" id="tps-touch-exit" aria-label="退出 TPS">退出 TPS</button><div class="tps-touch-actions"><button type="button" id="tps-touch-run" aria-pressed="false">跑步</button><button type="button" id="tps-touch-jump">跳跃</button></div><span class="tps-touch-hint">空白处拖动视角</span></div>`
        this.element = element
        this.stick = element.querySelector('#tps-touch-stick')!
        this.thumb = element.querySelector('.tps-stick-thumb')!
        this.runButton = element.querySelector('#tps-touch-run')!
        this.jumpButton = element.querySelector('#tps-touch-jump')!
        this.exitButton = element.querySelector('#tps-touch-exit')!
        document.body.append(element)
        const options = { signal: this.abort.signal }
        const swallow = (event: Event) => { if (event.cancelable) event.preventDefault(); event.stopPropagation() }
        element.addEventListener('contextmenu', swallow, options)
        element.addEventListener('dblclick', swallow, options)
        this.stick.addEventListener('pointerdown', event => {
            if (!this.enabled || element.hidden || this.joystick || event.button !== 0) return
            swallow(event)
            const rect = this.stick.getBoundingClientRect()
            this.joystick = { id: event.pointerId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.width * 0.34 }
            this.stick.setPointerCapture(event.pointerId)
            this.move(event)
        }, options)
        this.stick.addEventListener('pointermove', event => {
            if (this.joystick?.id !== event.pointerId) return
            swallow(event); this.move(event)
        }, options)
        const releaseStick = (event: PointerEvent) => {
            if (this.joystick?.id !== event.pointerId) return
            swallow(event); this.clearJoystick()
        }
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.stick.addEventListener(type, releaseStick, options)
        this.runButton.addEventListener('pointerdown', event => {
            if (!this.enabled || element.hidden || event.button !== 0) return
            swallow(event)
            this.runLatched = !this.runLatched
            this.renderRun()
        }, options)
        // Keyboard/assistive activation has detail=0; pointer activation was
        // handled on down so it works concurrently with an already held stick.
        this.runButton.addEventListener('click', event => {
            swallow(event)
            if (this.enabled && !element.hidden && event.detail === 0) { this.runLatched = !this.runLatched; this.renderRun() }
        }, options)
        this.jumpButton.addEventListener('pointerdown', event => {
            if (!this.enabled || element.hidden || this.jumpPointer !== undefined || event.button !== 0) return
            swallow(event); this.jumpPointer = event.pointerId; this.jumpQueued = true
            this.jumpButton.setPointerCapture(event.pointerId)
            this.jumpButton.classList.add('is-held')
        }, options)
        const releaseJump = (event: PointerEvent) => {
            if (this.jumpPointer !== event.pointerId) return
            swallow(event); this.jumpPointer = undefined; this.jumpButton.classList.remove('is-held')
        }
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.jumpButton.addEventListener(type, releaseJump, options)
        this.jumpButton.addEventListener('click', event => {
            swallow(event)
            if (this.enabled && !element.hidden && event.detail === 0) this.jumpQueued = true
        }, options)
        this.exitButton.addEventListener('click', event => { swallow(event); this.hooks.exit() }, options)
        const layout = () => { this.reset(); this.layout() }
        document.addEventListener('magius:studio-layout', () => this.layout(), options)
        window.addEventListener('resize', layout, options)
        window.visualViewport?.addEventListener('resize', layout, options)
        window.visualViewport?.addEventListener('scroll', layout, options)
        window.addEventListener('blur', () => this.reset(), options)
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset() }, options)
        document.addEventListener('pointerdown', event => {
            const input=event.pointerType==='touch'?'touch':'mouse'
            if(this.lastInput!==input){this.lastInput=input;this.reset();this.layout()}
        }, { capture: true, signal: this.abort.signal })
        document.addEventListener('keydown',event=>{if(!/^(?:[wasd]|Arrow\w+| |Shift)$/i.test(event.key))return;if(this.lastInput!=='keyboard'){this.lastInput='keyboard';this.reset();this.layout()}},options)
        this.coarse.addEventListener('change', layout, options)
        if (typeof ResizeObserver !== 'undefined') {
            this.resize = new ResizeObserver(() => this.layout())
            this.resize.observe(hooks.canvas())
        }
        this.layout()
    }

    private move(event: PointerEvent) {
        const stick = this.joystick
        if (!stick) return
        const dx = event.clientX - stick.x, dy = event.clientY - stick.y
        const intent = joystickIntent(dx, dy, stick.radius)
        this.x = intent.x; this.z = intent.z
        const distance = Math.hypot(dx, dy), scale = distance > stick.radius ? stick.radius / distance : 1
        this.thumb.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`
        this.stick.setAttribute('aria-label', `移动摇杆，横向 ${Math.round(this.x * 100)}%，前后 ${Math.round(this.z * 100)}%`)
    }
    private clearJoystick() {
        const id = this.joystick?.id
        this.joystick = undefined; this.x = 0; this.z = 0
        this.thumb.style.transform = ''
        this.stick.setAttribute('aria-label', '移动摇杆，拖动方向行走')
        if (id !== undefined && this.stick.hasPointerCapture(id)) this.stick.releasePointerCapture(id)
    }
    private renderRun() {
        this.runButton.setAttribute('aria-pressed', String(this.runLatched))
        this.runButton.textContent = this.runLatched ? '跑步 ✓' : '跑步'
        this.runButton.title = this.runLatched ? '再次点击恢复步行' : '点击切换跑步；摇杆松开即停止'
    }
    reset() {
        this.clearJoystick()
        const id = this.jumpPointer; this.jumpPointer = undefined
        if (id !== undefined && this.jumpButton.hasPointerCapture(id)) this.jumpButton.releasePointerCapture(id)
        this.jumpQueued = false; this.runLatched = false
        this.jumpButton.classList.remove('is-held'); this.renderRun()
    }
    setEnabled(enabled: boolean) {
        this.enabled = enabled
        this.reset(); this.layout()
    }
    private layout() {
        const available=this.lastInput ? this.lastInput==='touch'
            : this.coarse.matches && navigator.maxTouchPoints>0 && matchMedia('(hover: none)').matches
        const visible = this.enabled && available
        this.element.hidden = !visible
        document.body.classList.toggle('tps-touch-visible', visible)
        if (!visible) return
        const rect = this.hooks.canvas().getBoundingClientRect()
        const viewport = window.visualViewport
        const left = Math.max(rect.left, viewport?.offsetLeft ?? 0)
        const top = Math.max(rect.top, viewport?.offsetTop ?? 0)
        const right = Math.min(rect.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth))
        const bottom = Math.min(rect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight), innerHeight-(parseFloat(document.body.style.getPropertyValue('--studio-reserved-height'))||0))
        Object.assign(this.element.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(0, right-left)}px`, height: `${Math.max(0, bottom-top)}px` })
    }
    consume(): TpsMovementInput {
        if (!this.enabled || this.element.hidden) return { moveX: 0, moveZ: 0, run: false, jumpPressed: false }
        const value = { moveX: this.x, moveZ: this.z, run: this.runLatched, jumpPressed: this.jumpQueued }
        this.jumpQueued = false
        return value
    }
    dispose() {
        this.setEnabled(false); this.abort.abort(); this.resize?.disconnect(); this.element.remove()
    }
}
