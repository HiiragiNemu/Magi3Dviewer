export interface TouchPoint { id: number; x: number; y: number }
interface GestureHooks { rotate(dx:number,dy:number):void; pinch(ratio:number):void }
/** Touch identifiers belong only to fingers that began in empty viewer space. */
export class TpsViewGesture {
    private points = new Map<number,TouchPoint>()
    private readonly hooks:GestureHooks
    constructor(hooks:GestureHooks){this.hooks=hooks}
    has(id:number){return this.points.has(id)}
    get size(){return this.points.size}
    begin(point:TouchPoint){if(this.points.size<2&&!this.has(point.id)&&Number.isFinite(point.x)&&Number.isFinite(point.y))this.points.set(point.id,{...point})}
    move(changed:readonly TouchPoint[]){
        const before=[...this.points.values()].map(p=>({...p}))
        for(const p of changed)if(this.has(p.id)&&Number.isFinite(p.x)&&Number.isFinite(p.y))this.points.set(p.id,{...p})
        const after=[...this.points.values()]
        if(before.length===1&&after.length===1)this.hooks.rotate(after[0].x-before[0].x,after[0].y-before[0].y)
        if(before.length===2&&after.length===2){const a=Math.hypot(before[0].x-before[1].x,before[0].y-before[1].y),b=Math.hypot(after[0].x-after[1].x,after[0].y-after[1].y);if(a>8&&b>8)this.hooks.pinch(a/b)}
    }
    end(ids:readonly number[]){for(const id of ids)this.points.delete(id)}
    reset(){this.points.clear()}
}
interface ViewHooks extends GestureHooks { active():boolean; canvas():HTMLCanvasElement; isControl(target:EventTarget|null):boolean }
export class TpsViewTouch {
    readonly gesture:TpsViewGesture
    private readonly abort=new AbortController()
    constructor(hooks:ViewHooks){
        this.gesture=new TpsViewGesture(hooks)
        const options={capture:true,passive:false,signal:this.abort.signal}
        const points=(touches:TouchList)=>Array.from(touches,t=>({id:t.identifier,x:t.clientX,y:t.clientY}))
        document.addEventListener('touchstart',event=>{
            if(!hooks.active())return
            const canvas=hooks.canvas(),r=canvas.getBoundingClientRect()
            let owned=false
            for(const t of Array.from(event.changedTouches)){
                if(hooks.isControl(t.target)||hooks.isControl(event.target))continue
                if(t.clientX<r.left||t.clientX>r.right||t.clientY<r.top||t.clientY>r.bottom)continue
                this.gesture.begin({id:t.identifier,x:t.clientX,y:t.clientY});owned ||= this.gesture.has(t.identifier)
            }
            if(owned&&event.cancelable)event.preventDefault()
        },options)
        document.addEventListener('touchmove',event=>{
            if(!hooks.active()){this.reset();return}
            if(!Array.from(event.changedTouches).some(t=>this.gesture.has(t.identifier)))return
            this.gesture.move(points(event.changedTouches))
            if(event.cancelable)event.preventDefault()
        },options)
        const end=(event:TouchEvent)=>{const ids=Array.from(event.changedTouches,t=>t.identifier);const owned=ids.some(id=>this.gesture.has(id));this.gesture.end(ids);if(owned&&event.cancelable)event.preventDefault()}
        document.addEventListener('touchend',end,options);document.addEventListener('touchcancel',end,options)
        window.addEventListener('blur',()=>this.reset(),{signal:this.abort.signal})
        window.addEventListener('resize',()=>this.reset(),{signal:this.abort.signal})
        document.addEventListener('visibilitychange',()=>{if(document.hidden)this.reset()},{signal:this.abort.signal})
    }
    reset(){this.gesture.reset()}
    dispose(){this.reset();this.abort.abort()}
}
