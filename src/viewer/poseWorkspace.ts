import { Bone, Object3D, Quaternion, Vector3 } from 'three'
import { canonicalPoseBone, poseBones, poseBoneIsActive, findDirectPoseParts, type PosePart } from './directPoseTools.ts'
export type { PosePart } from './directPoseTools.ts'

export type PoseNodeGroup = 'primary' | 'hands' | 'more'
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
const finger = /finger|thumb|(?:^|[_ .:/-])(?:index|middle|ring|pinky|little)(?:[_ .:/\d-]|$)/i
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
const wholeObjectBone = /^(?:root\d*|origin|visualroot|armature|chara_\d+|.*_model)$/i
export interface PoseNodePage {
    id: string
    /** Semantic category and chain identity, never an arbitrary fixed-size slice. */
    category: string
    side?: 'left' | 'right'
    finger?: 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'
    chain: string
    parts: PosePart[]
}
export function groupedPoseParts(actor: Object3D, group: PoseNodeGroup): PosePart[] {
    const primary = findDirectPoseParts(actor), ids = new Set(primary.map(p => p.bone))
    if (group === 'primary') return primary
    if (group !== 'hands' && group !== 'more') return []
    const nodes = poseBones(actor).filter(node => poseBoneIsActive(node,actor) && !terminal.test(node.name)
        && !wholeObjectBone.test(node.name)
        && !ids.has(canonicalPoseBone(node)) && (group === 'hands' ? isFinger(node) : !isFinger(node)))
    return nodes.map(node => ({id: node.uuid, label: node.name || node.type, bone: node, mode:'rotate' as const}))
}
const fingerKind = (name: string): PoseNodePage['finger'] => /thumb/i.test(name) ? 'thumb'
    : /index/i.test(name) ? 'index' : /middle/i.test(name) ? 'middle'
        : /ring/i.test(name) ? 'ring' : /pinky|little/i.test(name) ? 'pinky' : undefined
const nodeSide = (name: string): PoseNodePage['side'] => /(?:^|[_ .:/-])(?:l\d*|left)(?:$|[_ .:/-])/i.test(name) ? 'left'
    : /(?:^|[_ .:/-])(?:r\d*|right)(?:$|[_ .:/-])/i.test(name) ? 'right' : undefined
const nodeCategory = (name: string) => /ribbon/i.test(name) ? 'ribbons' : /hair/i.test(name) ? 'hair'
    : /skirt|dress/i.test(name) ? 'skirt' : /cloth|coat|cape|sleeve/i.test(name) ? 'clothing'
    : /wing|tail|tentacle|leg|arm|hand|foot|wrist|toe/i.test(name) ? 'limbs'
    : /bust/i.test(name) ? 'torso' : /eye|jaw|mouth|face/i.test(name) ? 'face' : /acc|jewel|ornament|weapon/i.test(name) ? 'accessories' : 'other'
export function poseNodePages(actor: Object3D, group: PoseNodeGroup): PoseNodePage[] {
    const parts = groupedPoseParts(actor, group)
    if (group === 'primary') return parts.length ? [{id:'primary',category:'primary',chain:'primary',parts}] : []
    const pages = new Map<string, PoseNodePage>()
    for (const part of parts) {
        const name=part.bone.name, side=nodeSide(name), finger=group==='hands' ? fingerKind(name) : undefined
        const category=group==='hands' ? side ?? 'other' : nodeCategory(name)
        // Hair_S_L1_01_Sp and Hair_S_L1_02_Sp are one authored strand.
        // Child order is the actual hierarchy order, not alphabetical page fill.
        const chain=group==='hands' ? finger ?? name : name.replace(/(?:_\d+)?_(?:sp|end)$/i,'').replace(/_\d+$/,'')
        const id=`${category}:${chain}`
        const page=pages.get(id) ?? {id,category,side,finger,chain,parts:[]}
        page.parts.push(part);pages.set(id,page)
    }
    const order=['left','right','hair','ribbons','skirt','clothing','limbs','torso','face','accessories','other']
    const fingers=['thumb','index','middle','ring','pinky']
    const depth=(node:Object3D)=>{let n:Object3D|null=node,d=0;while(n&&n!==actor){d++;n=n.parent}return d}
    for (const page of pages.values()) page.parts.sort((a,b)=>depth(a.bone)-depth(b.bone)||a.bone.name.localeCompare(b.bone.name,undefined,{numeric:true}))
    return [...pages.values()].sort((a,b)=>order.indexOf(a.category)-order.indexOf(b.category)
        || (group==='hands' ? fingers.indexOf(a.finger??'')-fingers.indexOf(b.finger??'') : a.chain.localeCompare(b.chain,undefined,{numeric:true})))
}
export function poseCategoryLabel(category: string, locale: string): string {
    const labels:Record<string,readonly[string,string,string]>={left:['左手','左手','Left hand'],right:['右手','右手','Right hand'],
        thumb:['拇指','親指','Thumb'],index:['食指','人差し指','Index'],middle:['中指','中指','Middle'],ring:['无名指','薬指','Ring'],pinky:['小指','小指','Little'],
        hair:['头发','髪','Hair'],ribbons:['蝴蝶结与缎带','リボン','Ribbons'],skirt:['裙摆','スカート','Skirt'],clothing:['服装','服','Clothing'],
        limbs:['肢体辅助','手足の補助','Limb details'],torso:['躯干辅助','胴体の補助','Torso details'],face:['面部','顔','Face'],accessories:['饰品与武器','装飾と武器','Accessories'],other:['其他骨骼','その他の骨','Other bones']}
    return labels[category]?.[locale==='zh-CN'?0:locale==='ja-JP'?1:2]??category
}
/** Compact human labels. Technical identities remain in title/search and never
 * become the lookup key used for editing or loading saved poses. */
export function posePartLabel(part: PosePart, locale: string): string {
    if(locale==='en')return part.label
    const zh=locale==='zh-CN',name=part.bone.name,s=nodeSide(name),f=fingerKind(name)
    const side=s==='left'?(zh?'左':'左'):s==='right'?(zh?'右':'右'):''
    if(f&&isFinger(part.bone)) {
        const joint=/meta/i.test(name)?(zh?'掌骨／起点':'中手骨'):(zh?'第 '+(name.match(/(?:finger|thumb)(\d+)/i)?.[1]??'1')+' 节':(name.match(/(?:finger|thumb)(\d+)/i)?.[1]??'1')+'節')
        return `${side}${poseCategoryLabel(f,locale)} · ${joint}`
    }
    const main:Record<string,readonly[string,string]>={head:['头部','頭'],neck:['颈部','首'],chest:['胸部','胸'],waist:['腰部','腰'],spine:['脊柱','背骨'],pelvis:['骨盆','骨盤'],shoulder:['肩部','肩'],'upper-arm':['上臂','上腕'],elbow:['手肘','肘'],hand:['手腕','手首'],'upper-leg':['大腿','太もも'],knee:['膝盖','膝'],foot:['脚踝','足首']}
    const k=part.id.replace(/^(?:left|right)-/,'');if(main[k])return side+main[k][zh?0:1]
    if(/^Wrist_[LR]$/i.test(name))return side+(zh?'腕部附加骨骼':'手首の補助骨')
    const tokens:Record<string,string>=zh?{hair:'头发',ribbon:'缎带',skirt:'裙摆',neck:'颈',leg:'腿',arm:'手臂',forearm:'前臂',wrist:'手腕',toe:'脚趾',bust:'胸部',eye:'眼睛',acc:'饰品',weapon:'武器',wing:'翅膀',tail:'尾部',twist:'扭转',bend:'弯曲',s:'侧',f:'前',b:'后',c:'中',l:'左',r:'右',sp:'',end:''}
        :{hair:'髪',ribbon:'リボン',skirt:'スカート',acc:'装飾',weapon:'武器',eye:'目',twist:'ねじれ',s:'横',f:'前',b:'後',c:'中',l:'左',r:'右',sp:'',end:''}
    return name.replace(/([a-z])([A-Z])/g,'$1_$2').split('_').map(t=>{const m=t.match(/^([a-z]+)(\d*)$/i);return m&&m[1].toLowerCase() in tokens?tokens[m[1].toLowerCase()]+m[2]:t}).filter(Boolean).join(' ')
}
export function posePageLabel(page: PoseNodePage, locale:string):string {
    if(page.finger)return `${poseCategoryLabel(page.side??'other',locale)} · ${poseCategoryLabel(page.finger,locale)}`
    return posePartLabel({...page.parts[0],label:page.chain,bone:{name:page.chain} as Object3D},locale)
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
        if(typeof item?.path!=='string'||item.path.length>2500||paths.has(item.path)||!x||!finite(x.p,3,1000)||!finite(x.q,4,1.01)||!finite(x.s,3,100)||Math.abs(Math.hypot(...x.q)-1)>.01)throw new Error('Invalid or duplicate model node transform')
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
    if (baseline) for(const entry of pose.nodes){
        const base=baseline.get(nodes.get(entry.path)!.uuid)
        if(base&&entry.transform.s.some((n,i)=>Math.abs(base.s[i])<1e-9&&Math.abs(n)>=1e-9))throw Error('当前动作关闭的原生部件不能通过姿态导入强制启用')
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
