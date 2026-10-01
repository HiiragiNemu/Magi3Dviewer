import type { PlaneGestureDelta } from './cameraPlaneGesture.ts'
export interface TouchPoint { id:number;x:number;y:number }
interface GestureHooks {rotate(dx:number,dy:number):void;pinch(ratio:number):void;pan?(dx:number,dy:number):void;roll?(radians:number):void;twoStart?():void;two?(delta:PlaneGestureDelta):void;twoEnd?():void}
export class TpsViewGesture {
    private points=new Map<number,TouchPoint>()
    private pair?:{x:number;y:number;distance:number;angle:number;roll:number}
    private readonly hooks:GestureHooks
    constructor(hooks:GestureHooks){this.hooks=hooks}
    has(id:number){return this.points.has(id)}
    get size(){return this.points.size}
    begin(point:TouchPoint){
        if(this.points.size>=2||this.has(point.id)||!Number.isFinite(point.x)||!Number.isFinite(point.y))return
        this.points.set(point.id,{...point})
        if(this.points.size===2){const[a,b]=[...this.points.values()];this.pair={x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(b.x-a.x,b.y-a.y),angle:Math.atan2(b.y-a.y,b.x-a.x),roll:0};this.hooks.twoStart?.()}
    }
    move(changed:readonly TouchPoint[]){
        const before=[...this.points.values()].map(p=>({...p}))
        for(const p of changed)if(this.has(p.id)&&Number.isFinite(p.x)&&Number.isFinite(p.y))this.points.set(p.id,{...p})
        const after=[...this.points.values()]
        if(before.length===1&&after.length===1)this.hooks.rotate(after[0].x-before[0].x,after[0].y-before[0].y)
        if(before.length===2&&after.length===2){
            const bv={x:before[1].x-before[0].x,y:before[1].y-before[0].y},av={x:after[1].x-after[0].x,y:after[1].y-after[0].y}
            const a=Math.hypot(bv.x,bv.y),b=Math.hypot(av.x,av.y)
            if(this.hooks.two&&this.pair&&this.pair.distance>8&&b>8){
                const angle=Math.atan2(av.y,av.x);let turn=angle-this.pair.angle
                while(turn>Math.PI)turn-=2*Math.PI;while(turn< -Math.PI)turn+=2*Math.PI
                this.pair.roll+=turn;this.pair.angle=angle
                this.hooks.two({x:(after[0].x+after[1].x)/2-this.pair.x,y:(after[0].y+after[1].y)/2-this.pair.y,spread:b-this.pair.distance,roll:this.pair.roll});return
            }
            if(a>8&&b>8){
                this.hooks.pinch(a/b)
                let turn=Math.atan2(av.y,av.x)-Math.atan2(bv.y,bv.x)
                while(turn>Math.PI)turn-=Math.PI*2
                while(turn< -Math.PI)turn+=Math.PI*2
                if(Math.abs(turn)>1e-4)this.hooks.roll?.(turn)
            }
            this.hooks.pan?.((after[0].x+after[1].x-before[0].x-before[1].x)/2,(after[0].y+after[1].y-before[0].y-before[1].y)/2)
        }
    }
    end(ids:readonly number[]){for(const id of ids)this.points.delete(id);if(this.points.size<2&&this.pair){this.pair=undefined;this.hooks.twoEnd?.()}}
    reset(){this.points.clear();if(this.pair){this.pair=undefined;this.hooks.twoEnd?.()}}
}
interface ViewHooks extends GestureHooks {active():boolean;canvas():HTMLCanvasElement;isControl(target:EventTarget|null):boolean;tap?(x:number,y:number):void}
export class TpsViewTouch {
    readonly gesture:TpsViewGesture
    private readonly abort=new AbortController()
    private tap?:{id:number;x:number;y:number;time:number}
    constructor(hooks:ViewHooks){
        this.gesture=new TpsViewGesture(hooks)
        const options={capture:true,passive:false,signal:this.abort.signal}
        const points=(touches:TouchList)=>Array.from(touches,t=>({id:t.identifier,x:t.clientX,y:t.clientY}))
        document.addEventListener('touchstart',event=>{
            if(!hooks.active())return
            const canvas=hooks.canvas(),r=canvas.getBoundingClientRect();let owned=false
            for(const t of Array.from(event.changedTouches)){
                if(hooks.isControl(t.target)||hooks.isControl(event.target))continue
                if(t.clientX<r.left||t.clientX>r.right||t.clientY<r.top||t.clientY>r.bottom)continue
                this.gesture.begin({id:t.identifier,x:t.clientX,y:t.clientY});owned ||= this.gesture.has(t.identifier)
                if(this.gesture.size===1)this.tap={id:t.identifier,x:t.clientX,y:t.clientY,time:performance.now()};else this.tap=undefined
            }
            if(owned&&event.cancelable)event.preventDefault()
        },options)
        document.addEventListener('touchmove',event=>{
            if(!hooks.active()){this.reset();return}
            if(!Array.from(event.changedTouches).some(t=>this.gesture.has(t.identifier)))return
            this.gesture.move(points(event.changedTouches))
            for(const t of Array.from(event.changedTouches))if(this.tap?.id===t.identifier&&Math.hypot(t.clientX-this.tap.x,t.clientY-this.tap.y)>7)this.tap=undefined
            if(event.cancelable)event.preventDefault()
        },options)
        const end=(event:TouchEvent)=>{
            const ids=Array.from(event.changedTouches,t=>t.identifier),owned=ids.some(id=>this.gesture.has(id)),tap=this.tap
            if(tap&&ids.includes(tap.id)){this.tap=undefined;if(event.type==='touchend'&&performance.now()-tap.time<500&&hooks.active())hooks.tap?.(tap.x,tap.y)}
            this.gesture.end(ids);if(owned&&event.cancelable)event.preventDefault()
        }
        document.addEventListener('touchend',end,options);document.addEventListener('touchcancel',end,options)
        window.addEventListener('blur',()=>this.reset(),{signal:this.abort.signal})
        window.addEventListener('resize',()=>this.reset(),{signal:this.abort.signal})
        document.addEventListener('visibilitychange',()=>{if(document.hidden)this.reset()},{signal:this.abort.signal})
    }
    reset(){this.tap=undefined;this.gesture.reset()}
    dispose(){this.reset();this.abort.abort()}
}
