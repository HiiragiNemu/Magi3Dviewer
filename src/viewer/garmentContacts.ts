import { GarmentSurfaceContact, type GarmentSurfaceStats } from './garmentSurfaceContact.ts'
import { Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three'
import { canonicalPoseBone, poseBones, poseBoneIsActive } from './directPoseTools.ts'

/** Separate opt-out post-animation contact layer. No velocity, springs, wind,
 * random forces or accumulated displacement. Every solve starts at this frame's
 * native pose. Body transforms are read-only colliders: only actual garment
 * surface vertices can be written. Contact projection is immediate; damping applies to
 * unconstrained cloth recovery, never to the incoming body trajectory. */
export const GARMENT_CONTACT_POLICY = 'native-bones-strain-limited-surface-v3'
export const GARMENT_CONTACT_SETTING = 'magius.garment-contacts.v1'
const garment = /skirt|dress|coat|mantle|cape|hem|cloth/i
const excluded = /hair|ribbon|weapon|finger|thumb|face|eye|bust|(?:root|end|tip|nub)$/i
const helper = /:official|:stencil|:mask|SelectionOutline|:forward|:outline/i
const clamp = (x:number,a:number,b:number) => Math.max(a,Math.min(b,x))
export const GARMENT_DAMPING_SETTING = 'magius.garment-recovery-half-life.v2'
export const DEFAULT_GARMENT_HALF_LIFE = .12
const v = () => new Vector3()
const q = () => new Quaternion()
interface ContactSample { mesh:SkinnedMesh; index:number; node:Object3D; preferred:Vector3; point:Vector3 }
interface Capsule { arm?:boolean; finger?:boolean; a:Object3D; b:Object3D; radius:number; start:Vector3; end:Vector3; worldRadius:number }
interface Joint { node:Object3D; samples:ContactSample[] }
export interface GarmentContactStats { policy:string; supported:boolean; samples:number; joints:number; contacts:number; beforeDepth:number; afterDepth:number; maxRotation:number; correctedJoints:number; milliseconds:number; limited:boolean; worstCollider?:string; worstGarment?:string; surface?:GarmentSurfaceStats }

export class StableGarmentContacts {
    readonly root:Object3D
    readonly samples:ContactSample[]=[]
    private joints:Joint[]=[]
    private capsules:Capsule[]=[]
    private hip?:Object3D
    private legLength=0
    private hipBindInverse = q()
    private hipRotation = q()
    private rootScale = v()
    private end=v();private offset=v();private nearest=v()
    private surface?:GarmentSurfaceContact
    private previousRootPosition?:Vector3
    private pendingDelta=0
    private stats:GarmentContactStats={policy:GARMENT_CONTACT_POLICY,supported:false,samples:0,joints:0,contacts:0,beforeDepth:0,afterDepth:0,maxRotation:0,correctedJoints:0,milliseconds:0,limited:false}
    constructor(root:Object3D){
        this.root=root
        const bones=poseBones(root).filter(n=>poseBoneIsActive(n,root)),find=(pattern:RegExp)=>bones.find(b=>pattern.test(b.name))
        this.hip=find(/^(?:hip|hips|pelvis)$/i)
        if(!this.hip)return
        const meshes:SkinnedMesh[]=[],rest=new Map<Object3D,Matrix4>()
        root.traverse(n=>{if((n as SkinnedMesh).isSkinnedMesh&&!helper.test(n.name)&&!/(?:hair|face|weapon|eye)/i.test(n.name))meshes.push(n as SkinnedMesh)})
        // Bind inverses are the source of radii and outward direction, not the
        // arbitrary animated pose at the moment the feature is first enabled.
        for(const mesh of meshes)mesh.skeleton.bones.forEach((bone,i)=>{const canonical=canonicalPoseBone(bone);if(!rest.has(canonical))rest.set(canonical,mesh.skeleton.boneInverses[i].clone().invert())})
        const hipBind=rest.get(this.hip)
        if(!hipBind)return
        const hipPosition=v().setFromMatrixPosition(hipBind),hipQ=q(),scale=v();hipBind.decompose(v(),hipQ,scale);this.hipBindInverse.copy(hipQ).invert()
        for(const side of ['L','R']){
            const upper=find(new RegExp('^(?:UpLeg|UpperLeg|Thigh)_'+side+'$','i')),lower=find(new RegExp('^(?:Leg|LowerLeg|Shin)_'+side+'$','i')),foot=find(new RegExp('^(?:Foot|Ankle)_'+side+'$','i'))
            if(upper&&lower&&foot&&rest.has(upper)&&rest.has(lower)&&rest.has(foot)){
                const len=v().setFromMatrixPosition(rest.get(upper)!).distanceTo(v().setFromMatrixPosition(rest.get(lower)!))+v().setFromMatrixPosition(rest.get(lower)!).distanceTo(v().setFromMatrixPosition(rest.get(foot)!))
                this.legLength=Math.max(this.legLength,len)
                this.capsules.push({a:upper,b:lower,radius:len*.09,start:v(),end:v(),worldRadius:0},{a:lower,b:foot,radius:len*.065,start:v(),end:v(),worldRadius:0})
            }
        }
        if(!(this.legLength>.05&&this.legLength<10))return
        const completeLegs=this.capsules.length===4
        for(const side of ['L','R']){
            const upper=find(new RegExp('^(?:Arm|UpperArm)_'+side+'$','i')),lower=find(new RegExp('^(?:Forearm|LowerArm)_'+side+'$','i')),hand=find(new RegExp('^(?:Hand|Wrist)_'+side+'$','i'))
            const palm=find(new RegExp('^MetaMiddlefinger_'+side+'$','i'))??find(new RegExp('^Middlefinger1_'+side+'$','i'))??hand
            if(upper&&lower&&hand){
                // Kinematic collision proxies only. They are NEVER solver joints.
                this.capsules.push(
                    {arm:true,a:upper,b:lower,radius:this.legLength*.047,start:v(),end:v(),worldRadius:0},
                    {arm:true,a:lower,b:hand,radius:this.legLength*.043,start:v(),end:v(),worldRadius:0},
                    {arm:true,a:hand,b:palm!,radius:this.legLength*.04,start:v(),end:v(),worldRadius:0},
                )
                // Fingers are narrower than the palm. Extending one palm-sized
                // capsule to the last knuckle incorrectly inflates idle skirts.
                for(const name of ['Thumb','Indexfinger','Middlefinger','Ringfinger','Pinkyfinger']){
                    const first=find(new RegExp('^'+name+'1_'+side+'$','i')),last=find(new RegExp('^'+name+'3_'+side+'$','i'))
                    if(first&&last)this.capsules.push({arm:true,finger:true,a:first,b:last,radius:this.legLength*.009,start:v(),end:v(),worldRadius:0})
                }
            }
        }
        const candidates=new Map<Object3D,Array<{mesh:SkinnedMesh;index:number;rest:Vector3}>>()
        const radii=new Map<Capsule,number[]>()
        for(const c of this.capsules)radii.set(c,[])
        for(const mesh of meshes){
            const {position,skinWeight,skinIndex}=mesh.geometry.attributes
            if(!position||!skinWeight||!skinIndex)continue
            const canonical=mesh.skeleton.bones.map(canonicalPoseBone)
            for(let i=0;i<position.count;i++){
                let best=-1,weight=0,clothWeight=0,nonAnchorWeight=0
                for(let k=0;k<4;k++){
                    const w=skinWeight.getComponent(i,k),index=skinIndex.getComponent(i,k),bone=canonical[index]
                    if(bone&&poseBoneIsActive(bone,root)&&garment.test(bone.name)&&!excluded.test(bone.name)){
                        clothWeight+=w;if(w>weight){weight=w;best=index}
                    }else if(bone&&!/^(?:root|hip|hips|pelvis|chara_\d+|spine|waist)$/i.test(bone.name))nonAnchorWeight+=w
                }
                const p=v().fromBufferAttribute(position,i).applyMatrix4(mesh.bindMatrix)
                // A low-weight cloth/waist blend at the waistband is sewn, not free fabric.
                // Only the lower hanging band may yield; body-dominant vertices remain immutable.
                const clothBoundary=clothWeight>.20&&nonAnchorWeight<.05&&p.y-hipPosition.y< -this.legLength*.10
                if((clothWeight>.55||clothBoundary)&&best>=0){const node=canonical[best];if(!candidates.has(node))candidates.set(node,[]);candidates.get(node)!.push({mesh,index:i,rest:p})}
                if(clothWeight<.05){for(const c of this.capsules){let w=0;for(let k=0;k<4;k++){const bone=canonical[skinIndex.getComponent(i,k)];if(bone===c.a||bone===c.b)w+=skinWeight.getComponent(i,k)}if(w>.8&&rest.has(c.a)&&rest.has(c.b)){const a=v().setFromMatrixPosition(rest.get(c.a)!),b=v().setFromMatrixPosition(rest.get(c.b)!),d=b.sub(a);const t=p.clone().sub(a).dot(d)/Math.max(1e-12,d.lengthSq());if(t>.2&&t<.8){const distance=p.distanceTo(a.addScaledVector(d,t));radii.get(c)!.push(distance)}}}}
            }
        }
        for(const c of this.capsules){const values=radii.get(c)!.filter(n=>Number.isFinite(n)).sort((a,b)=>a-b);if(values.length)c.radius=clamp(values[Math.floor(values.length*(c.arm?.5:.82))]*(c.arm?1:1.08),this.legLength*(c.finger?.006:c.arm?.022:.035),c.arm?c.radius*1.05:this.legLength*.14)}
        for(const [node,list] of candidates){
            // Deterministic spatial bins prevent repeated triangle vertices from
            // overweighting one seam. At most 36 probes per native cloth joint.
            const unique=new Map<string,typeof list[number]>()
            for(const s of list){const bin=[s.rest.x,s.rest.y,s.rest.z].map(n=>Math.round(n/(this.legLength*.018))).join(',');if(!unique.has(bin))unique.set(bin,s)}
            const all=[...unique.values()],count=Math.min(36,all.length),samples:ContactSample[]=[]
            for(let j=0;j<count;j++){
                const s=all[Math.floor(j*all.length/count)],radial=s.rest.clone().sub(hipPosition);radial.y=0
                if(radial.lengthSq()<1e-8)continue
                const sample={mesh:s.mesh,index:s.index,node,preferred:radial.normalize().applyQuaternion(this.hipBindInverse),point:v()};samples.push(sample);this.samples.push(sample)
            }
            if(samples.length)this.joints.push({node,samples})
        }
        this.stats.supported=this.joints.length>0&&completeLegs
        this.stats.samples=this.samples.length;this.stats.joints=this.joints.length
        if(this.stats.supported)this.surface=new GarmentSurfaceContact(root,[...candidates].flatMap(([node,list])=>list.map(item=>{
            const preferred=item.rest.clone().sub(hipPosition);preferred.y=0;if(preferred.lengthSq()<1e-8)preferred.z=1
            return {mesh:item.mesh,index:item.index,node,preferred:preferred.normalize().applyQuaternion(this.hipBindInverse)}
        })),this.legLength)

    }
    get diagnostics():GarmentContactStats{return {...this.stats}}
    setRecoveryHalfLife(seconds:number){this.surface?.setRecoveryHalfLife(seconds)}
    /** Display-only offsets never become native physics inputs. */
    restore(clearHistory=false){
        this.surface?.restore()
        if(clearHistory){this.surface?.clearHistory();this.previousRootPosition=undefined;this.pendingDelta=0}
    }
    private point(sample:ContactSample):Vector3{
        sample.mesh.getVertexPosition(sample.index,sample.point)
        return sample.point.applyMatrix4(sample.mesh.matrixWorld)
    }
    private distance(p:Vector3,c:Capsule):number{
        this.end.subVectors(c.end,c.start)
        const t=clamp(this.offset.subVectors(p,c.start).dot(this.end)/Math.max(this.end.lengthSq(),1e-10),0,1)
        this.nearest.copy(c.start).addScaledVector(this.end,t)
        return p.distanceTo(this.nearest)
    }
    private measure(corrected=true){
        let worst=0,energy=0,collider='',part=''
        for(const sample of this.samples){
            const p=this.surface?.sampledPosition(sample.mesh,sample.index,corrected)??this.point(sample)
            for(const c of this.capsules){
                const depth=Math.max(0,c.worldRadius-this.distance(p,c))
                if(depth>worst){worst=depth;collider=c.a.name+' → '+c.b.name;part=sample.node.name};energy+=depth*depth
            }
        }
        return {worst,energy,score:energy+worst*worst*4,collider,part}
    }
    solve(active=true,blocked:((node:Object3D)=>boolean)=()=>false,deltaSeconds=0):GarmentContactStats{
        this.restore()
        const started=performance.now()
        Object.assign(this.stats,{contacts:0,beforeDepth:0,afterDepth:0,maxRotation:0,correctedJoints:0,limited:false,surface:undefined})
        if(!active||!this.stats.supported){this.restore(true);this.stats.milliseconds=0;return this.diagnostics}
        this.hip!.getWorldQuaternion(this.hipRotation);this.root.getWorldScale(this.rootScale)
        const factor=Math.max(Math.abs(this.rootScale.x),Math.abs(this.rootScale.y),Math.abs(this.rootScale.z))
        const rootPosition=this.root.getWorldPosition(v())
        const temporal=Number.isFinite(deltaSeconds)&&deltaSeconds>0&&deltaSeconds<=.12
            &&(!this.previousRootPosition||rootPosition.distanceTo(this.previousRootPosition)<this.legLength*factor)
        this.pendingDelta=temporal?deltaSeconds:0
        if(!temporal)this.surface?.clearHistory()
        this.previousRootPosition=rootPosition
        for(const c of this.capsules){c.a.getWorldPosition(c.start);c.b.getWorldPosition(c.end);c.worldRadius=(c.radius+this.legLength*.004)*factor}
        // Native physics is the sole garment-bone writer. Contacts are surface
        // constraints, never torques that lift an entire skirt to clear a hand.
        this.stats.milliseconds=performance.now()-started
        return this.projectSurface(blocked)
    }
    projectSurface(blocked:((node:Object3D)=>boolean)=()=>false){
        if(!this.surface||!this.hip)return this.diagnostics
        this.root.updateMatrixWorld(true);this.hip.getWorldQuaternion(this.hipRotation);this.root.getWorldScale(this.rootScale)
        const factor=Math.max(Math.abs(this.rootScale.x),Math.abs(this.rootScale.y),Math.abs(this.rootScale.z))
        for(const c of this.capsules){c.a.getWorldPosition(c.start);c.b.getWorldPosition(c.end);c.worldRadius=(c.radius+this.legLength*.004)*factor}
        const started=performance.now();this.stats.surface=this.surface.project(this.capsules,this.hipRotation,blocked,factor,this.pendingDelta);this.pendingDelta=0
        const native=this.measure(false);this.stats.beforeDepth=native.worst
        this.stats.contacts=this.samples.reduce((sum,s)=>{
            const point=this.surface?.sampledPosition(s.mesh,s.index,false)??this.point(s)
            return sum+this.capsules.filter(c=>this.distance(point,c)<c.worldRadius).length
        },0)
        const result=this.measure();this.stats.afterDepth=result.worst;this.stats.worstCollider=result.collider;this.stats.worstGarment=result.part
        this.stats.limited ||= this.stats.surface.limited;this.stats.milliseconds+=performance.now()-started
        return this.diagnostics
    }
    dispose(){this.restore(true);this.surface?.dispose();this.surface=undefined;this.samples.length=0;this.joints=[];this.capsules=[]}
}
