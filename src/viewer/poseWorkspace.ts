import { Bone, Object3D, Quaternion, Vector3 } from 'three'
import { findDirectPoseParts, type PosePart } from './directPoseTools.ts'
export type { PosePart } from './directPoseTools.ts'

export type PoseNodeGroup = 'primary' | 'hands' | 'more' | 'free'
export interface LocalTransform { p: number[]; q: number[]; s: number[] }
export const readLocal = (node: Object3D): LocalTransform => ({ p: node.position.toArray(), q: node.quaternion.toArray(), s: node.scale.toArray() })
export function writeLocal(node: Object3D, value: LocalTransform) {
    node.position.fromArray(value.p); node.quaternion.fromArray(value.q).normalize(); node.scale.fromArray(value.s)
    node.updateMatrix(); node.updateWorldMatrix(true, false)
}
const clone = <T>(value: T): T => structuredClone(value)
const equal = (a: LocalTransform, b: LocalTransform) => ['p','q','s'].every(key => {
    const k = key as keyof LocalTransform; return a[k].every((v,i) => Math.abs(v-b[k][i]) < 1e-7)
})
export class PlacementHistory {
    readonly object: Object3D
    readonly initial: LocalTransform
    private past: LocalTransform[] = []
    private future: LocalTransform[] = []
    private before?: LocalTransform
    constructor(object: Object3D) { this.object = object; this.initial = readLocal(object) }
    begin() { this.before ??= readLocal(this.object) }
    finish() {
        const current=readLocal(this.object),before=this.before;this.before=undefined
        if(!before||equal(before,current))return
        this.past.push(before);if(this.past.length>40)this.past.shift();this.future=[]
    }
    undo(redo=false) {
        this.finish();const source=redo?this.future:this.past,destination=redo?this.past:this.future,value=source.pop()
        if(value){destination.push(readLocal(this.object));writeLocal(this.object,value)}
        return !!value
    }
    reset() { this.begin();writeLocal(this.object,this.initial);this.finish() }
    get canUndo(){return this.past.length>0}
    get canRedo(){return this.future.length>0}
}
const finger = /finger|thumb|index|middle|ring|pinky|little/i
const isFinger = (node:Object3D) => finger.test(node.name)&&!/hair|angel|ribbon|weapon|skirt/i.test(node.name)
const terminal = /(?:nub|end|tip)(?:_|\b|$)/i
const hiddenHelper = /:official-outline:|:stencil-mask|:mask-writer:|SelectionOutline|Magius.*(?:Input|Gizmo)|^(?:PerspectiveCamera|AmbientLight|DirectionalLight)$/i
export function structuralNodes(actor: Object3D): Object3D[] {
    const nodes: Object3D[]=[]
    actor.traverse(node=>{if(node!==actor&&!hiddenHelper.test(node.name)&&(node instanceof Bone||(node as Object3D & {isMesh?:boolean}).isMesh||node.type==='Group'||node.type==='Object3D'))nodes.push(node)})
    return nodes
}
export function nodePath(node: Object3D, root: Object3D): string {
    const parts:string[]=[]
    let n:Object3D|null=node
    while(n&&n!==root){const siblings=n.parent?.children.filter(child=>child.name===n!.name&&child.type===n!.type)||[n];parts.unshift(`${encodeURIComponent(n.name)}:${n.type}:${siblings.indexOf(n)}`);n=n.parent}
    if(n!==root)throw new Error('Node is outside the selected model')
    return parts.join('/')
}
export function groupedPoseParts(actor: Object3D, group: PoseNodeGroup): PosePart[] {
    const primary=findDirectPoseParts(actor),ids=new Set(primary.map(p=>p.bone.uuid))
    if(group==='primary')return primary
    const nodes=structuralNodes(actor).filter(node=>group==='free'||node instanceof Bone&&!terminal.test(node.name)
        &&(group==='hands'?isFinger(node):!isFinger(node)&&!ids.has(node.uuid)))
    return nodes.map((node,i)=>({id:`${group}-${i}`,label:node.name||node.type,bone:node,mode:'rotate' as const}))
}
export function captureModelLocal(actor:Object3D) {
    return new Map(structuralNodes(actor).map(node=>[node.uuid,readLocal(node)]))
}
export interface SavedPose {
    schema:'magius.saved-pose.v1';model:string;name:string;createdAt:string
    nodes:Array<{path:string;transform:LocalTransform}>;requiresStretch:boolean
}
const finite=(value:unknown,length:number,limit:number)=>Array.isArray(value)&&value.length===length&&value.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=limit)
export function validateSavedPose(value:unknown):SavedPose {
    const v=value as SavedPose
    if(!v||v.schema!=='magius.saved-pose.v1'||typeof v.model!=='string'||typeof v.name!=='string'||v.name.length>80||!Array.isArray(v.nodes)||v.nodes.length>5000||typeof v.requiresStretch!=='boolean')throw new Error('Invalid saved pose')
    const paths=new Set<string>()
    for(const item of v.nodes){const x=item?.transform
        if(typeof item?.path!=='string'||item.path.length>2500||paths.has(item.path)||!x||!finite(x.p,3,1000)||!finite(x.q,4,1.01)||!finite(x.s,3,100)||x.s.some(n=>n<.001)||Math.abs(Math.hypot(...x.q)-1)>.01)throw new Error('Invalid or duplicate model node transform')
        paths.add(item.path)
    }
    return v
}
export function makeSavedPose(actor:Object3D, model:string, name:string, baseline:Map<string,LocalTransform>):SavedPose {
    const nodes=structuralNodes(actor)
    return {schema:'magius.saved-pose.v1',model,name:name.trim().slice(0,80)||'保存姿态',createdAt:new Date().toISOString(),requiresStretch:nodes.some(node=>{const b=baseline.get(node.uuid),t=readLocal(node);return !!b&&(!t.p.every((x,i)=>Math.abs(x-b.p[i])<1e-6)||!t.s.every((x,i)=>Math.abs(x-b.s[i])<1e-6))}),nodes:nodes.map(node=>({path:nodePath(node,actor),transform:readLocal(node)}))}
}
export function resolveSavedPose(actor:Object3D,model:string,value:unknown,allowStretch:boolean,baseline?:Map<string,LocalTransform>) {
    const pose=validateSavedPose(value)
    if(pose.model!==model)throw new Error('保存姿态不属于当前模型')
    if(pose.requiresStretch&&!allowStretch)throw new Error('此姿态含位移或拉伸，请先明确启用“允许拉伸”')
    const nodes=new Map(structuralNodes(actor).map(node=>[nodePath(node,actor),node]))
    if(pose.nodes.length!==nodes.size||pose.nodes.some(entry=>!nodes.has(entry.path)))throw new Error('模型结构已改变，未应用任何姿态')
    if (!allowStretch && baseline) for (const entry of pose.nodes) {
        const base = baseline.get(nodes.get(entry.path)!.uuid)
        if (!base || !entry.transform.p.every((n,i)=>Math.abs(n-base.p[i])<1e-5)
            || !entry.transform.s.every((n,i)=>Math.abs(n-base.s[i])<1e-5)) throw new Error('姿态含结构位移或缩放，默认防拉伸模式拒绝导入')
    }
    return pose.nodes.map(entry=>({node:nodes.get(entry.path)!,transform:clone(entry.transform)}))
}
const KEY='magius.saved-poses.v1'
export function readPoseLibrary(storage:Pick<Storage,'getItem'>):SavedPose[] {
    const text=storage.getItem(KEY);if(!text)return[]
    if(text.length>4_000_000)throw new Error('Saved pose library is too large')
    const data=JSON.parse(text);if(!Array.isArray(data)||data.length>20)throw new Error('Invalid pose library')
    return data.map(validateSavedPose)
}
export function savePoseLibrary(storage:Pick<Storage,'getItem'|'setItem'>,pose:SavedPose) {
    validateSavedPose(pose)
    const previous=readPoseLibrary(storage),next=previous.filter(p=>p.model!==pose.model||p.name!==pose.name)
    next.push(pose);if(next.length>20)throw new Error('姿态保存已达20份，请先删除不需要的记录')
    const text=JSON.stringify(next);if(text.length>4_000_000)throw new Error('姿态数据过大；未覆盖已有记录')
    storage.setItem(KEY,text)
}
export function deleteSavedPose(storage:Pick<Storage,'getItem'|'setItem'>,model:string,name:string) {
    storage.setItem(KEY,JSON.stringify(readPoseLibrary(storage).filter(p=>p.model!==model||p.name!==name)))
}

/** Free structure manipulation never silently changes bone length. Rotation is
 * unrestricted in free mode; bone translation requires explicit opt-in. */
export class StructurePoseTarget {
    readonly actor:Object3D; readonly bone:Object3D; readonly stretch:boolean
    private readonly blocked:(node:Object3D)=>boolean
    readonly handle=new Object3D();readonly editedBones:Object3D[]
    limited=false;solves=0;preserveEndOrientation=false;bendAngle=0
    projectPosition?: (point:Vector3,bone:Bone)=>boolean
    private active=false;private dirty=false;private mode:'translate'|'rotate'='rotate'
    private startLocal=new Quaternion();private startWorld=new Quaternion()
    private desiredPosition=new Vector3();private desiredQuaternion=new Quaternion()
    constructor(actor:Object3D,bone:Object3D,stretch:boolean,blocked:(node:Object3D)=>boolean){this.actor=actor;this.bone=bone;this.stretch=stretch;this.blocked=blocked;this.editedBones=[bone];this.handle.name='MagiusStructureInput';this.sync()}
    get canTranslate(){return this.stretch}
    get dragging(){return this.active}
    get pending(){return this.dirty}
    sync(){if(this.active)return;this.bone.getWorldPosition(this.handle.position);this.bone.getWorldQuaternion(this.handle.quaternion);this.handle.scale.set(1,1,1);this.handle.updateMatrixWorld()}
    begin(mode:'translate'|'rotate'){if(this.blocked(this.bone)||mode==='translate'&&!this.canTranslate)return false;this.active=false;this.sync();this.mode=mode;this.startLocal.copy(this.bone.quaternion);this.startWorld.copy(this.handle.quaternion);this.active=true;this.dirty=false;return true}
    queue(){if(!this.active)return;this.desiredPosition.copy(this.handle.position);this.desiredQuaternion.copy(this.handle.quaternion);this.dirty=true}
    flush():Object3D[]{
        if(!this.active||!this.dirty||this.blocked(this.bone))return[];this.dirty=false
        let p:Object3D|null=this.bone;while(p&&p!==this.actor)p=p.parent;if(!p)return[]
        if(!this.desiredPosition.toArray().every(Number.isFinite)||!this.desiredQuaternion.toArray().every(Number.isFinite))return[]
        if(this.mode==='rotate')this.bone.quaternion.copy(this.startLocal).multiply(this.startWorld.clone().invert().multiply(this.desiredQuaternion)).normalize()
        else if(this.canTranslate&&this.bone.parent){this.bone.parent.updateWorldMatrix(true,false);if(Math.abs(this.bone.parent.matrixWorld.determinant())<1e-12)return[];const pos=this.bone.parent.worldToLocal(this.desiredPosition.clone());if(pos.length()>100)return[];this.bone.position.copy(pos)}
        this.bone.updateWorldMatrix(true,false);this.solves++;return this.editedBones
    }
    end(){this.active=false;this.dirty=false;this.sync()}
}
