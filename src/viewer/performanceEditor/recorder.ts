import type { Object3D, PerspectiveCamera, Vector3 } from 'three'
import type { PerformanceEditorRuntime } from './runtime.ts'
import type { PerformanceDocument } from './types.ts'
import { RecordedRig, captureRecordedCamera, applyRecordedCamera, sampleRecorded, insertRecordedInterval, recordedStride, RECORDING_FPS, MAX_RECORD_SECONDS, type RecordedActor, type RecordedKind, type RecordedLane, type RecordedTarget } from './recordings.ts'

export interface RecorderHost {
    actors():RecordedActor[]
    scene?():string|undefined
    loadScene?(id:string):Promise<void>
    camera():{camera:PerspectiveCamera;target:Vector3}
    select(actor:RecordedActor):void
    playback():void
    stopInput?():void
    syncRoot?(actor:RecordedActor):void
    releaseCamera():void
    loadActors?(targets:RecordedTarget[]):Promise<void>
    beforeCapture?():void
    adoptPose?(actor:RecordedActor,kinds:RecordedKind[]):void
}
interface ActiveCapture { lanes:RecordedLane[]; rigs:Map<string,RecordedRig>; start:number; previousDuration:number; previousLoop:boolean; before:PerformanceDocument; lastTime:number;used:number;budget:number;capacityReached:boolean }
interface Underlay {rig:RecordedRig;values:number[]}
const identity=(t:RecordedTarget)=>`${t.type}:${t.resourceId}:${t.instance}`
const laneId=(kind:RecordedKind,t?:RecordedTarget)=>kind==='camera'?'record:camera':`record:${identity(t!)}:${kind}`
/** Final-pose recording shares the existing performance transport/audio clock.
 * A reversible display overlay prevents replay from becoming a spring/animation
 * input on the next frame. Different actors and body/face channels are isolated. */
export class PerformanceRecorder {
    readonly runtime:PerformanceEditorRuntime
    readonly host:RecorderHost
    private captureState?:ActiveCapture
    private replay=false
    private live=new Set<string>()
    private underlays:Underlay[]=[]
    private cameraUnderlay?:number[]
    private rigs=new Map<string,RecordedRig>()
    private boundTargets=new Map<string,RecordedActor>()
    private listeners=new Set<()=>void>()
    private releases:Array<()=>void>=[]
    private past:PerformanceDocument[]=[]
    private future:PerformanceDocument[]=[]
    private internalDocument=false
    error=''
    constructor(runtime:PerformanceEditorRuntime,host:RecorderHost){
        this.runtime=runtime;this.host=host
        this.releases.push(runtime.subscribeClock(snapshot=>{
            if(snapshot.reason==='stop'){this.restore();this.replay=false;this.live.clear();this.host.releaseCamera()}
            else if(snapshot.reason==='play'||snapshot.reason==='seek'){this.replay=true;if(!this.captureState)this.live.clear()}
        }),runtime.subscribe(kind=>{if(kind==='document'&&!this.internalDocument){this.restore();this.rigs.clear();this.boundTargets.clear();this.live.clear();this.error=''}if(kind!=='state')this.notify()}))
    }
    get recording(){return !!this.captureState}
    get canUndo(){return this.past.length>0}
    get canRedo(){return this.future.length>0}
    get lanes(){return this.runtime.timeline.recordedLanes}
    subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
    private notify(){for(const l of this.listeners)l()}
    private findActor(target:RecordedTarget):RecordedActor|undefined {
        const bound=this.boundTargets.get(target.actorKey)
        if(bound)return bound.current()?bound:undefined
        const actors=this.host.actors().filter(a=>a.current())
        const actor=actors.find(a=>a.actorKey===target.actorKey&&identity(a)===identity(target))??actors.find(a=>identity(a)===identity(target))
        if(actor)this.boundTargets.set(target.actorKey,actor)
        return actor
    }
    private rig(lane:RecordedLane):RecordedRig {
        const actor=lane.target&&this.findActor(lane.target);if(!actor)throw Error('请先加载录制角色：'+(lane.target?.label??lane.label))
        const key=lane.id+':'+actor.object.uuid+':'+actor.generation
        let rig=this.rigs.get(key)
        if(!rig){rig=new RecordedRig(actor,lane.kind as 'motion'|'expression',lane.bindings);this.rigs.set(key,rig)}
        return rig
    }
    /** Called before any native animation/physics. Raw Float32 quaternions and
     * scales are restored exactly, rather than normalized/rounded every frame. */
    restore(){
        for(const {rig,values}of this.underlays){if(rig.actor.current())rig.apply(values,true)}this.underlays=[]
        if(this.cameraUnderlay){const {camera,target}=this.host.camera();applyRecordedCamera(camera,target,this.cameraUnderlay);this.cameraUnderlay=undefined}
    }
    ownsMotion(object:Object3D){return this.replay&&this.lanes.some(l=>l.kind==='motion'&&!l.muted&&!this.live.has(l.id)&&this.findActor(l.target!)?.object===object)}
    ownsCamera(){return this.replay&&this.lanes.some(l=>l.kind==='camera'&&!l.muted&&!this.live.has(l.id))}
    prepareLive(actorKey:string,kinds:RecordedKind[]=['motion','expression'],adoptForEditing=true){
        if(this.recording)throw Error('请先停止当前录制')
        const target=this.host.actors().find(a=>a.actorKey===actorKey&&a.current())
        const cameraValue=actorKey==='camera'&&this.lanes.some(l=>l.kind==='camera')?captureRecordedCamera(this.host.camera().camera,this.host.camera().target):undefined
        const values:Array<{rig:RecordedRig;values:number[]}>=[]
        for(const l of this.lanes){if(kinds.includes(l.kind)&&(actorKey==='camera'?l.kind==='camera':target&&l.target&&identity(l.target)===identity(target))){this.live.add(l.id);if(l.kind!=='camera'){const rig=this.rig(l);values.push({rig,values:rig.capture(true)})}}}
        this.restore();for(const row of values)row.rig.apply(row.values,true)
        if(cameraValue)applyRecordedCamera(this.host.camera().camera,this.host.camera().target,cameraValue)
        if(target){this.host.select(target);if(values.length&&kinds.includes('motion'))this.host.syncRoot?.(target);if(values.length&&adoptForEditing)this.host.adoptPose?.(target,kinds)}
        this.host.releaseCamera();this.notify()
    }
    private newLane(kind:RecordedKind,target?:RecordedActor):{lane:RecordedLane;rig?:RecordedRig}{
        const recordTarget:RecordedTarget|undefined=target?{actorKey:target.actorKey,resourceId:target.resourceId,instance:target.instance,type:target.type,label:target.label}:undefined
        const rig=kind==='camera'?undefined:new RecordedRig(target!,kind)
        return{lane:{id:laneId(kind,recordTarget),kind,target:recordTarget,label:kind==='camera'?'镜头':target!.label.split(' / ')[0]+(target!.instance?' #'+(target!.instance+1):''),bindings:rig?.bindings??[],frames:[]},rig}
    }
    start(actorKey:string,kinds:RecordedKind[]=['motion','expression']){
        if(this.recording)throw Error('已有录制进行中')
        this.host.beforeCapture?.();this.runtime.pause();this.error=''
        const target=actorKey==='camera'?undefined:this.host.actors().find(a=>a.actorKey===actorKey&&a.current())
        if(!target&&actorKey!=='camera')throw Error('请选择一个已加载的角色')
        if(actorKey==='camera')kinds=['camera'];else kinds=[...new Set(kinds)].filter(k=>k!=='camera')
        if(!kinds.length)throw Error('请选择动作或表情录制通道')
        if(actorKey==='camera')this.host.playback()
        this.prepareLive(actorKey,kinds,false)
        const document=this.runtime.timeline.value,start=this.runtime.time,lanes:RecordedLane[]=[],rigs=new Map<string,RecordedRig>()
        for(const kind of kinds){const next=this.newLane(kind,target);if(!next.rig||next.rig.bindings.length){lanes.push(next.lane);if(next.rig)rigs.set(next.lane.id,next.rig)}}
        if(!lanes.length)throw Error('该模型没有可录制的所选通道')
        // Imported authored tracks may own these exact bones. Fail explicitly,
        // rather than silently overwrite an unrelated actor's keyframes.
        if(target&&document.tracks.some(t=>t.actorKey===target.actorKey))throw Error('该角色已有高级手工轨道；请先在高级轨道中移除冲突通道，或换一个角色录制')
        const sceneId=this.host.scene?.();if(document.sceneId&&sceneId&&document.sceneId!==sceneId)throw Error('场景已改变；请载入项目场景或新建项目后录制')
        const existingNumbers=(document.recordedLanes??[]).reduce((n,l)=>n+l.frames.reduce((v,f)=>v+f.values.length,0),0),budget=15000000-existingNumbers
        if(budget<100000)throw Error('当前项目已接近内存上限；请导出并新建一个片段')
        this.captureState={lanes,rigs,start,previousDuration:document.duration,previousLoop:document.loop,before:document,lastTime:-1,used:0,budget,capacityReached:false}
        this.setDocument({...document,sceneId:document.sceneId??sceneId,loop:false,duration:Math.max(document.duration,start+MAX_RECORD_SECONDS)})
        this.runtime.time=start;this.runtime.liveCaptureClock=true;this.replay=true
        this.live=new Set(lanes.map(l=>l.id))
        this.captureFrame(true)
        this.runtime.play();if(this.runtime.lastError){this.cancel();throw Error(this.runtime.lastError)}
        this.notify()
    }
    private captureFrame(force=false){
        const state=this.captureState;if(!state||state.capacityReached)return
        const time=Math.round(this.runtime.time*1000000)/1000000
        if(!force&&time-state.lastTime<1/RECORDING_FPS-1e-5)return
        const width=state.lanes.reduce((n,l)=>n+recordedStride(l),0)
        if(state.used+width>state.budget){state.capacityReached=true;this.error='已自动停止并保留录制：达到本片段内存限额，请导出或新建片段。';return}
        state.used+=width
        for(const lane of state.lanes){const values=lane.kind==='camera'?captureRecordedCamera(this.host.camera().camera,this.host.camera().target):state.rigs.get(lane.id)!.capture()
            const old=lane.frames.at(-1);if(old&&Math.abs(time-old.time)<1e-6)old.values=values;else lane.frames.push({time,values})
        }state.lastTime=time
    }
    finish(){
        const state=this.captureState;if(!state)return
        try{this.captureFrame(true)}catch(error){this.error=String((error as Error).message)}
        const time=this.runtime.time;this.captureState=undefined;this.host.stopInput?.();this.runtime.pause();this.runtime.liveCaptureClock=false
        const document=this.runtime.timeline.value,lanes=[...(document.recordedLanes??[])]
        for(const incoming of state.lanes){if(!incoming.frames.length)continue;const index=lanes.findIndex(l=>l.id===incoming.id),merged=insertRecordedInterval(index<0?undefined:lanes[index],incoming);if(index<0)lanes.push(merged);else lanes[index]=merged}
        this.remember(state.before)
        this.setDocument({...document,recordedLanes:lanes,loop:state.previousLoop,duration:Math.max(state.previousDuration,...lanes.flatMap(l=>l.frames.map(f=>f.time)),.1)})
        this.runtime.time=time;this.live.clear();this.replay=true;this.frame();this.notify()
    }
    cancel(){const state=this.captureState;if(!state)return;this.captureState=undefined;this.host.stopInput?.();this.runtime.pause();this.runtime.liveCaptureClock=false;this.setDocument(state.before);this.runtime.time=state.start;this.replay=false;this.live.clear();this.restore();this.notify()}
    captureKey(actorKey:string,kinds:RecordedKind[]=['motion','expression']){
        if(this.recording)throw Error('实时录制已自动产生关键帧')
        this.host.beforeCapture?.();this.runtime.pause()
        const actor=this.host.actors().find(a=>a.actorKey===actorKey&&a.current());if(actorKey!=='camera'&&!actor)throw Error('请选择角色')
        const document=this.runtime.timeline.value,lanes=[...(document.recordedLanes??[])],time=this.runtime.time
        for(const kind of actorKey==='camera'?['camera'] as RecordedKind[]:kinds.filter(k=>k!=='camera')){
            const {lane,rig}=this.newLane(kind,actor);if(rig&&!rig.bindings.length)continue
            lane.frames=[{time,values:kind==='camera'?captureRecordedCamera(this.host.camera().camera,this.host.camera().target):rig!.capture()}]
            const i=lanes.findIndex(l=>l.id===lane.id),merged=insertRecordedInterval(i<0?undefined:lanes[i],lane);if(i<0)lanes.push(merged);else lanes[i]=merged
        }
        this.remember(document);this.setDocument({...document,sceneId:document.sceneId??this.host.scene?.(),recordedLanes:lanes});this.runtime.time=time;this.notify()
    }
    play(){if(this.recording)this.finish();this.host.beforeCapture?.();this.restore();this.live.clear();this.host.playback();this.replay=true;this.runtime.play();this.frame();this.notify()}
    pause(){if(this.recording)this.finish();else this.runtime.pause();this.notify()}
    seek(time:number){if(this.recording)throw Error('停止录制后可拖动时间轴');this.restore();this.live.clear();this.host.playback();this.runtime.pause();this.runtime.seek(time);this.replay=true;this.frame();this.notify()}
    stop(){if(this.recording)this.finish();this.runtime.stop();this.restore();this.replay=false;this.live.clear();this.host.releaseCamera();this.notify()}
    frame(){
        // Usually restored in pre-animation. A UI seek may also compose twice
        // before RAF; restoration makes that path idempotent too.
        this.restore()
        try{
            if(this.replay)for(const lane of this.lanes){if(lane.muted||this.live.has(lane.id))continue
                const data=sampleRecorded(lane,this.runtime.time)
                if(lane.kind==='camera'){const {camera,target}=this.host.camera();this.cameraUnderlay=[...camera.position.toArray(),...camera.quaternion.toArray(),...target.toArray(),camera.fov,camera.near,camera.far,camera.zoom];applyRecordedCamera(camera,target,data)}
                else{const rig=this.rig(lane);this.underlays.push({rig,values:rig.capture(true)});rig.apply(data)}
            }
            if(this.captureState){this.captureFrame();if(this.captureState.capacityReached||this.runtime.time-this.captureState.start>=MAX_RECORD_SECONDS-.001)this.finish()}
        }catch(error){this.error=(error as Error).message;this.runtime.pause();this.restore();this.replay=false;if(this.captureState)this.finish();this.notify()}
    }
    private setDocument(document:PerformanceDocument){this.restore();this.internalDocument=true;try{this.runtime.setDocument(document);this.rigs.clear()}finally{this.internalDocument=false}}
    private remember(document:PerformanceDocument){this.past.push(document);if(this.past.length>8)this.past.shift();this.future=[]}
    editLanes(edit:(lanes:RecordedLane[])=>void){if(this.recording)throw Error('请先停止录制');const before=this.runtime.timeline.value,document=structuredClone(before);edit(document.recordedLanes??=[]);this.remember(before);this.setDocument(document);this.notify()}
    mute(id:string){this.editLanes(lanes=>{const l=lanes.find(l=>l.id===id);if(l)l.muted=!l.muted})}
    remove(id:string){this.editLanes(lanes=>{const i=lanes.findIndex(l=>l.id===id);if(i>=0)lanes.splice(i,1)})}
    move(id:string,offset:number){if(!Number.isFinite(offset))throw Error('偏移量无效');this.editLanes(lanes=>{const l=lanes.find(l=>l.id===id);if(!l)return;if(l.frames[0].time+offset<0||l.frames.at(-1)!.time+offset>this.runtime.timeline.duration)throw Error('轨道偏移超出时间范围');l.frames.forEach(f=>f.time=Math.round((f.time+offset)*1e6)/1e6)})}
    deleteFrame(id:string,time:number){this.editLanes(lanes=>{const l=lanes.find(l=>l.id===id);if(!l)return;l.frames=l.frames.filter(f=>f.time!==time);if(!l.frames.length)lanes.splice(lanes.indexOf(l),1)})}
    undo(redo=false){if(this.recording)throw Error('请先停止录制');const from=redo?this.future:this.past,to=redo?this.past:this.future,d=from.pop();if(d){to.push(this.runtime.timeline.value);this.setDocument(d);this.notify()}}
    async import(text:string){if(this.recording)throw Error('请先停止录制');const {PerformanceTimeline}=await import('./timeline.ts');const validated=PerformanceTimeline.deserialize(text).value;this.stop();if(validated.sceneId)await this.host.loadScene?.(validated.sceneId);const targets=[...new Map((validated.recordedLanes??[]).filter(l=>l.target).map(l=>[identity(l.target!),l.target!])).values()];await this.host.loadActors?.(targets);this.boundTargets.clear();for(const lane of validated.recordedLanes??[])if(lane.kind!=='camera'){const actor=this.findActor(lane.target!);if(!actor)throw Error('项目角色未加载');new RecordedRig(actor,lane.kind,lane.bindings)}this.remember(this.runtime.timeline.value);this.setDocument(validated);this.error='';this.notify()}
    dispose(){if(this.recording)this.cancel();this.stop();this.releases.forEach(r=>r());this.listeners.clear();this.rigs.clear()}
}
