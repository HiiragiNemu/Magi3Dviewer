import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TpsViewGesture } from './TpsViewTouch.ts'
import { capturePlaneGesture, resolvePlaneGesture, type PlaneGestureBase } from './cameraPlaneGesture.ts'
interface Hooks {
    canvas:HTMLCanvasElement
    camera():THREE.PerspectiveCamera
    controls():OrbitControls
    enabled():boolean
    beforeBegin():void
    getRoll():number
    setRoll(degrees:number):void
}
/** Native Orbit owns mouse and one-finger orbit. A two-finger gesture takes a
 * bounded input lease, then restores it on every release/cancel/resize path. */
export function installOrbitTwoFingerGesture(hooks:Hooks) {
    const abort=new AbortController(),points=new Map<number,PointerEvent>()
    let base:PlaneGestureBase|undefined,owner:OrbitControls|undefined,damping=false,roll=0,internalCancel=false,ignoreClickUntil=0
    const finish=()=>{
        const previous=owner;owner=undefined;base=undefined;points.clear();gesture.reset()
        document.body.classList.remove('view-two-finger')
        if(previous&&previous===hooks.controls()) {
            previous.enabled=true;previous.enableDamping=damping;previous.update()
            hooks.camera().quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),THREE.MathUtils.degToRad(hooks.getRoll())))
            hooks.camera().updateMatrixWorld(true)
        }
    }
    const gesture=new TpsViewGesture({rotate(){},pinch(){},two:delta=>{
        if(!base||!owner)return
        if(!hooks.enabled()||owner!==hooks.controls()){finish();return}
        const next=resolvePlaneGesture(base,delta);if(!next)return
        const camera=hooks.camera();camera.position.copy(next.position);camera.quaternion.copy(next.quaternion)
        owner.target.copy(next.target);hooks.setRoll(roll+THREE.MathUtils.radToDeg(delta.roll));camera.updateMatrixWorld(true)
    }})
    const eligible=(event:PointerEvent)=>event.pointerType==='touch'&&hooks.enabled()
        &&event.target instanceof Element&&!event.target.closest('button,input,select,textarea,[data-tps-touch],[contenteditable=true]')
    const point=(event:PointerEvent)=>({id:event.pointerId,x:event.clientX,y:event.clientY})
    const swallow=(event:Event)=>{if(event.cancelable)event.preventDefault();event.stopImmediatePropagation()}
    const options={capture:true,passive:false,signal:abort.signal}
    document.addEventListener('pointerdown',event=>{
        if(!eligible(event)||points.size>=2)return
        const r=hooks.canvas.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)return
        if(points.size===1){
            hooks.beforeBegin()
            const controls=hooks.controls();if(!controls.enabled)return
            const camera=hooks.camera(),p=camera.position.clone(),q=camera.quaternion.clone(),t=controls.target.clone()
            damping=controls.enableDamping;controls.enableDamping=false;controls.update();camera.position.copy(p);camera.quaternion.copy(q);controls.target.copy(t)
            // Cancel the native first-pointer gesture through its public event
            // route so Orbit releases its capture and private pointer list.
            internalCancel=true
            for(const first of points.values())hooks.canvas.dispatchEvent(new PointerEvent('pointercancel',{pointerId:first.pointerId,pointerType:'touch',bubbles:true}))
            internalCancel=false
            owner=controls;controls.enabled=false;roll=hooks.getRoll()
            base=capturePlaneGesture(camera,t,r.height,controls.zoomSpeed)
            document.body.classList.add('view-two-finger')
        }
        points.set(event.pointerId,event);gesture.begin(point(event))
        if(owner){swallow(event);for(const id of points.keys())try{hooks.canvas.setPointerCapture(id)}catch{/* Pointer was cancelled by the platform. */}}
    },options)
    document.addEventListener('pointermove',event=>{
        if(!points.has(event.pointerId))return
        points.set(event.pointerId,event);gesture.move([point(event)])
        if(owner)swallow(event)
    },options)
    const end=(event:PointerEvent)=>{
        if(internalCancel||!points.has(event.pointerId))return
        const owned=Boolean(owner);points.delete(event.pointerId);gesture.end([event.pointerId])
        if(owned){ignoreClickUntil=performance.now()+450;swallow(event);if(hooks.canvas.hasPointerCapture(event.pointerId))hooks.canvas.releasePointerCapture(event.pointerId)}
        if(!points.size)finish()
    }
    for(const name of ['pointerup','pointercancel','lostpointercapture'] as const)document.addEventListener(name,end,options)
    document.addEventListener('click',event=>{if(performance.now()<ignoreClickUntil&&(event as PointerEvent).pointerType==='touch'&&event.target===hooks.canvas)swallow(event)},options)
    const cancel=()=>finish();window.addEventListener('blur',cancel,{signal:abort.signal});window.addEventListener('resize',cancel,{signal:abort.signal})
    document.addEventListener('visibilitychange',()=>{if(document.hidden)finish()},{signal:abort.signal})
    return {dispose(){finish();abort.abort()}}
}
