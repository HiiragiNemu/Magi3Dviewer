import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three'
function nodePath(node:Object3D,root:Object3D):string {
    const parts:string[]=[];let current:Object3D|null=node
    while(current&&current!==root){const siblings=current.parent?.children.filter(n=>n.name===current!.name&&n.type===current!.type)??[current];parts.unshift(encodeURIComponent(current.name)+':'+current.type+':'+siblings.indexOf(current));current=current.parent}
    if(current!==root)throw Error('录制节点不属于该模型');return parts.join('/')
}

export type RecordedKind = 'motion' | 'expression' | 'camera'
export interface RecordedTarget { actorKey:string; resourceId:string; instance:number; type:'character'|'enemy'; label:string }
export interface RecordedBinding { path:string; kind:'transform'|'morphs'|'visible'; names?:string[] }
export interface RecordedFrame { time:number; values:number[] }
export interface RecordedLane { id:string; label:string; kind:RecordedKind; target?:RecordedTarget; bindings:RecordedBinding[]; frames:RecordedFrame[]; muted?:boolean }
export interface RecordedActor extends RecordedTarget { object:Object3D; generation:number; current():boolean }
export const RECORDING_FPS=30
export const MAX_RECORD_SECONDS=180
const finite=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)
const excluded=/:official|:stencil|:mask|SelectionOutline|Magius.*(?:Input|Gizmo)|:forward|:outline/i
const faceName=/(?:^|[_ .:/-])(?:eye\w*|mouth\w*|lip\w*|jaw|tongue|cheek\w*|brow\w*|face\w*)(?:$|[_ .:/-])/i
const size=(b:RecordedBinding)=>b.kind==='transform'?10:b.kind==='visible'?1:b.names?.length??0
const stable=(n:number)=>Math.round(n*1e6)/1e6
export function recordedStride(lane:Pick<RecordedLane,'bindings'|'kind'>):number{return lane.kind==='camera'?14:lane.bindings.reduce((n,b)=>n+size(b),0)}
export function validateRecordedLanes(value:unknown,duration:number):asserts value is RecordedLane[] {
    if(value===undefined)return
    if(!Array.isArray(value)||value.length>160)throw Error('录制轨道数量无效')
    const ids=new Set<string>(),channels=new Set<string>();let numbers=0
    for(const lane of value as RecordedLane[]){
        if(!lane||typeof lane.id!=='string'||!lane.id||ids.has(lane.id)||typeof lane.label!=='string'||lane.label.length>200||!['motion','expression','camera'].includes(lane.kind)||typeof lane.muted!=='undefined'&&typeof lane.muted!=='boolean')throw Error('录制轨道格式无效')
        ids.add(lane.id)
        const t=lane.target
        if(lane.kind!=='camera'&&(!t||typeof t.actorKey!=='string'||typeof t.resourceId!=='string'||!/^[\w:-]{1,100}$/.test(t.resourceId)||!['character','enemy'].includes(t.type)||!Number.isInteger(t.instance)||t.instance<0||t.instance>50||typeof t.label!=='string'))throw Error('录制角色身份无效')
        const channel=lane.kind==='camera'?'camera':`${t!.type}:${t!.resourceId}:${t!.instance}:${lane.kind}`
        if(channels.has(channel))throw Error('同一角色通道存在重复录制轨道');channels.add(channel)
        if(!Array.isArray(lane.bindings)||lane.bindings.length>2000||!Array.isArray(lane.frames)||!lane.frames.length||lane.frames.length>20000)throw Error('录制关键帧无效')
        const paths=new Set<string>()
        for(const b of lane.bindings){const key=b.path+':'+b.kind;if(typeof b.path!=='string'||b.path.length>4000||!['transform','morphs','visible'].includes(b.kind)||paths.has(key)||b.kind==='morphs'&&(!Array.isArray(b.names)||!b.names.length||b.names.length>1000||b.names.some(n=>typeof n!=='string')||new Set(b.names).size!==b.names.length))throw Error('录制骨架绑定无效');paths.add(key)}
        const stride=recordedStride(lane);if(!stride||stride>25000)throw Error('录制数据宽度无效')
        let previous=-1
        for(const f of lane.frames){if(!finite(f.time)||f.time<0||f.time>duration+1e-6||f.time<=previous||!Array.isArray(f.values)||f.values.length!==stride||f.values.some(n=>!finite(n)||Math.abs(n)>1e5))throw Error('录制关键帧包含非法数值');previous=f.time;numbers+=stride
            if(lane.kind==='camera'){if(f.values[10]<=1||f.values[10]>=170||f.values[11]<=0||f.values[12]<=f.values[11]||f.values[13]<=0)throw Error('镜头参数无效')}
            let offset=0;for(const binding of lane.kind==='camera'?[{kind:'transform'}]:lane.bindings){if(binding.kind==='transform'){const norm=Math.hypot(...f.values.slice(offset+3,offset+7));if(Math.abs(norm-1)>.015)throw Error('录制旋转四元数无效');if(lane.kind!=='camera'&&f.values.slice(offset+7,offset+10).some(n=>n<0))throw Error('录制缩放无效')}offset+=lane.kind==='camera'?14:size(binding as RecordedBinding)}
        }
        if(numbers>18000000)throw Error('录制项目超过安全内存限额；请拆分为较短片段')
    }
}

interface Bound { definition:RecordedBinding; object:Object3D; morph?:{values:number[];indices:number[]} }
/** Exact model-local paths, including duplicate-name siblings. No remapping by
 * a bone-name guess, no shader/material copying, no rebinding imported bones. */
export class RecordedRig {
    readonly actor:RecordedActor
    readonly kind:'motion'|'expression'
    readonly bindings:RecordedBinding[]=[]
    private bound:Bound[]=[]
    private rotation=new Quaternion()
    constructor(actor:RecordedActor,kind:'motion'|'expression',expected?:RecordedBinding[]){
        this.actor=actor;this.kind=kind
        const root=actor.object,byPath=new Map<string,Object3D>();byPath.set('',root)
        root.traverse(n=>{if(n!==root&&!excluded.test(n.name))byPath.set(nodePath(n,root),n)})
        const add=(object:Object3D,definition:RecordedBinding)=>{
            const row:Bound={definition,object}
            if(definition.kind==='morphs'){
                const mesh=object as Object3D&{morphTargetInfluences?:number[];morphTargetDictionary?:Record<string,number>},values=mesh.morphTargetInfluences,dict=mesh.morphTargetDictionary
                if(!values||!dict||definition.names!.some(n=>!Number.isInteger(dict[n])||dict[n]<0||dict[n]>=values.length))throw Error('表情通道与录制文件不一致')
                row.morph={values,indices:definition.names!.map(n=>dict[n])}
            }
            this.bindings.push(definition);this.bound.push(row)
        }
        if(expected){for(const definition of expected){const object=byPath.get(definition.path);if(!object)throw Error('模型层级与录制文件不一致：'+definition.path);add(object,definition)}return}
        const morphStorage=new Set<number[]>()
        for(const [path,n]of byPath){
            if((n as Object3D&{isCamera?:boolean;isLight?:boolean}).isCamera||(n as Object3D&{isLight?:boolean}).isLight)continue
            const face=faceName.test(n.name)
            if((kind==='expression')===face&&(n!==root||kind==='motion')){
                add(n,{path,kind:'transform'})
                if(n!==root)add(n,{path,kind:'visible'})
            }
            if(kind==='expression'){
                const mesh=n as Object3D&{morphTargetInfluences?:number[];morphTargetDictionary?:Record<string,number>}
                if(mesh.morphTargetInfluences&&mesh.morphTargetDictionary&&!morphStorage.has(mesh.morphTargetInfluences)){
                    const names=Object.keys(mesh.morphTargetDictionary).sort();if(names.length){add(n,{path,kind:'morphs',names});morphStorage.add(mesh.morphTargetInfluences)}
                }
            }
        }
    }
    capture(exact=false):number[]{
        if(!this.actor.current())throw Error('录制对象已被移除或重新加载')
        const data:number[]=[]
        for(const b of this.bound){const n=b.object;if(b.definition.kind==='transform'){this.rotation.copy(n.quaternion);if(!exact)this.rotation.normalize();data.push(...n.position.toArray(),...this.rotation.toArray(),...n.scale.toArray())}else if(b.definition.kind==='visible')data.push(n.visible?1:0);else for(const i of b.morph!.indices)data.push(b.morph!.values[i])}
        return exact?data:data.map(stable)
    }
    apply(data:readonly number[],exact=false):void{
        if(!this.actor.current())throw Error('播放对象已被移除或重新加载')
        if(data.length!==this.bindings.reduce((n,b)=>n+size(b),0))throw Error('录制数据与绑定不一致')
        let i=0
        for(const b of this.bound){const n=b.object;if(b.definition.kind==='transform'){n.position.fromArray(data,i);n.quaternion.fromArray(data,i+3);if(!exact)n.quaternion.normalize();n.scale.fromArray(data,i+7);n.updateMatrix();i+=10}else if(b.definition.kind==='visible')n.visible=data[i++]>=.5;else for(const index of b.morph!.indices)b.morph!.values[index]=data[i++]}
        this.actor.object.updateMatrixWorld(true)
    }
}

export function captureRecordedCamera(camera:PerspectiveCamera,target:Vector3):number[]{return [...camera.position.toArray(),...camera.quaternion.clone().normalize().toArray(),...target.toArray(),camera.fov,camera.near,camera.far,camera.zoom].map(stable)}
export function applyRecordedCamera(camera:PerspectiveCamera,target:Vector3,data:readonly number[]){camera.position.fromArray(data);camera.quaternion.fromArray(data,3).normalize();target.fromArray(data,7);camera.fov=data[10];camera.near=data[11];camera.far=data[12];camera.zoom=data[13];camera.updateProjectionMatrix();camera.updateMatrixWorld(true)}

const qa=new Quaternion(),qb=new Quaternion()
export function interpolateRecorded(lane:Pick<RecordedLane,'kind'|'bindings'>,a:readonly number[],b:readonly number[],t:number):number[]{
    const result=a.map((v,i)=>v+(b[i]-v)*t)
    if(lane.kind==='camera'){qa.fromArray(a,3);qb.fromArray(b,3);qa.slerp(qb,t).normalize().toArray(result,3);return result}
    let offset=0
    for(const binding of lane.bindings){if(binding.kind==='transform'){qa.fromArray(a,offset+3);qb.fromArray(b,offset+3);qa.slerp(qb,t).normalize().toArray(result,offset+3);for(let j=7;j<10;j++)if(a[offset+j]===0||b[offset+j]===0)result[offset+j]=t<1?a[offset+j]:b[offset+j]}else if(binding.kind==='visible')result[offset]=t<1?a[offset]:b[offset];offset+=size(binding)}
    return result
}
export function sampleRecorded(lane:RecordedLane,time:number):number[]{
    const frames=lane.frames;if(!frames.length)throw Error('空录制轨道')
    if(time<=frames[0].time)return [...frames[0].values]
    if(time>=frames.at(-1)!.time)return [...frames.at(-1)!.values]
    let low=0,high=frames.length-1
    while(high-low>1){const mid=(low+high)>>1;if(frames[mid].time<=time)low=mid;else high=mid}
    const a=frames[low],b=frames[high];return interpolateRecorded(lane,a.values,b.values,(time-a.time)/(b.time-a.time))
}
/** Loss-bounded temporal simplification. Boolean/zero-scale state changes are
 * retained. This operates once on stop, never inside a render or input callback. */
export function simplifyRecorded(lane:RecordedLane,tolerance=.0007):RecordedFrame[]{
    const frames=lane.frames;if(frames.length<3)return frames
    if(frames.length>900){const result:RecordedFrame[]=[];for(let start=0;start<frames.length-1;start+=299){const chunk=simplifyRecorded({...lane,frames:frames.slice(start,start+300)},tolerance);result.push(...(start?chunk.slice(1):chunk))}return result}
    const keep=new Set([0,frames.length-1]),stack:[[number,number]]|[number,number][]=[[0,frames.length-1]]
    while(stack.length){const [a,b]=stack.pop()!;if(b-a<2)continue;let worst=tolerance,index=-1
        for(let i=a+1;i<b;i++){const t=(frames[i].time-frames[a].time)/(frames[b].time-frames[a].time),expected=interpolateRecorded(lane,frames[a].values,frames[b].values,t);let error=0;for(let k=0;k<expected.length;k++)error=Math.max(error,Math.abs(expected[k]-frames[i].values[k]));if(error>worst){worst=error;index=i}}
        if(index>=0){keep.add(index);stack.push([a,index],[index,b])}
    }
    return [...keep].sort((a,b)=>a-b).map(i=>frames[i])
}
export function insertRecordedInterval(existing:RecordedLane|undefined,incoming:RecordedLane):RecordedLane{
    if(!existing)return {...incoming,frames:simplifyRecorded(incoming)}
    if(existing.kind!==incoming.kind||JSON.stringify(existing.bindings)!==JSON.stringify(incoming.bindings))throw Error('不能将不同骨架合并到同一录制轨道')
    const start=incoming.frames[0].time,end=incoming.frames.at(-1)!.time
    const retained=existing.frames.filter(f=>f.time<start-1e-6||f.time>end+1e-6)
    const frames=[...retained,...simplifyRecorded(incoming)].sort((a,b)=>a.time-b.time)
    return {...existing,muted:false,frames}
}
