import { GarmentSurfaceContact, type GarmentSurfaceStats } from './garmentSurfaceContact.ts'
import { Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three'
import { canonicalPoseBone, poseBones, poseBoneIsActive } from './directPoseTools.ts'

/** Separate opt-out post-animation contact layer. No velocity, springs, wind,
 * random forces or accumulated displacement. Every solve starts at this frame's
 * native pose. Body transforms are read-only colliders: only actual garment
 * drivers can be written. Contact projection is immediate; damping applies to
 * unconstrained cloth recovery, never to the incoming body trajectory. */
export const GARMENT_CONTACT_POLICY = 'one-way-damped-garment-contacts-v2'
export const GARMENT_CONTACT_SETTING = 'magius.garment-contacts.v1'
const garment = /skirt|dress|coat|mantle|cape|hem|cloth/i
const excluded = /hair|ribbon|weapon|finger|thumb|face|eye|bust|(?:root|end|tip|nub)$/i
const helper = /:official|:stencil|:mask|SelectionOutline|:forward|:outline/i
const clamp = (x:number,a:number,b:number) => Math.max(a,Math.min(b,x))
export const GARMENT_DAMPING_SETTING = 'magius.garment-recovery-half-life.v2'
export const DEFAULT_GARMENT_HALF_LIFE = .12
const v = () => new Vector3()
const q = () => new Quaternion()
interface ContactSample { mesh:SkinnedMesh; index:number; node:Object3D; preferred:Vector3; point:Vector3; armDirections?:Map<Capsule,Vector3> }
interface Capsule { arm?:boolean; a:Object3D; b:Object3D; radius:number; start:Vector3; end:Vector3; worldRadius:number; previousStart?:Vector3; previousEnd?:Vector3 }
interface Joint { node:Object3D; samples:ContactSample[]; before:Quaternion; after:Quaternion; applied:boolean; angle:number; history?:Quaternion; best?:Quaternion; frameOrigin?:Quaternion; frameBudget?:number }
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
    private end=v();private offset=v();private nearest=v();private normal=v();private r=v();private axis=v();private step=v();private pivot=v()
    private parentRotation=q();private delta=q()
    private elapsed=0
    private recoveryHalfLife=DEFAULT_GARMENT_HALF_LIFE
    private previousRootPosition?:Vector3
    private readonly maxAngle=.4
    private surface?:GarmentSurfaceContact
    private readonly passLimit=10
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
            const palm=find(new RegExp('^(?:MetaMiddlefinger|Middlefinger1)_'+side+'$','i'))??hand
            if(upper&&lower&&hand){
                // Kinematic collision proxies only. They are NEVER solver joints.
                this.capsules.push(
                    {arm:true,a:upper,b:lower,radius:this.legLength*.047,start:v(),end:v(),worldRadius:0},
                    {arm:true,a:lower,b:hand,radius:this.legLength*.043,start:v(),end:v(),worldRadius:0},
                    {arm:true,a:hand,b:palm!,radius:this.legLength*.04,start:v(),end:v(),worldRadius:0},
                )
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
                let best=-1,weight=0,clothWeight=0
                for(let k=0;k<4;k++){const w=skinWeight.getComponent(i,k),index=skinIndex.getComponent(i,k),bone=canonical[index];if(bone&&poseBoneIsActive(bone,root)&&garment.test(bone.name)&&!excluded.test(bone.name)){clothWeight+=w;if(w>weight){weight=w;best=index}}}
                const p=v().fromBufferAttribute(position,i).applyMatrix4(mesh.bindMatrix)
                if(clothWeight>.55&&best>=0){const node=canonical[best];if(!candidates.has(node))candidates.set(node,[]);candidates.get(node)!.push({mesh,index:i,rest:p})}
                if(clothWeight<.05){for(const c of this.capsules){let w=0;for(let k=0;k<4;k++){const bone=canonical[skinIndex.getComponent(i,k)];if(bone===c.a||bone===c.b)w+=skinWeight.getComponent(i,k)}if(w>.8&&rest.has(c.a)&&rest.has(c.b)){const a=v().setFromMatrixPosition(rest.get(c.a)!),b=v().setFromMatrixPosition(rest.get(c.b)!),d=b.sub(a);const t=p.clone().sub(a).dot(d)/Math.max(1e-12,d.lengthSq());if(t>.2&&t<.8){const distance=p.distanceTo(a.addScaledVector(d,t));radii.get(c)!.push(distance)}}}}
            }
        }
        for(const c of this.capsules){const values=radii.get(c)!.filter(n=>Number.isFinite(n)).sort((a,b)=>a-b);if(values.length)c.radius=clamp(values[Math.floor(values.length*(c.arm?.5:.82))]*(c.arm?1:1.08),this.legLength*(c.arm?.022:.035),c.arm?c.radius*1.05:this.legLength*.14)}
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
            if(samples.length)this.joints.push({node,samples,before:q(),after:q(),applied:false,angle:0})
        }
        // A vertex close to its own joint cannot be separated by rotating that
        // joint alone. Distribute its constraint to real garment ancestors so
        // the chain bends naturally instead of exhausting one joint's limit.
        const byNode=new Map(this.joints.map(j=>[j.node,j]))
        for(const sample of this.samples){let ancestors=0;const visited=new Set<Object3D>()
            for(let parent=sample.node.parent;parent&&parent!==root&&ancestors<3;parent=parent.parent){
                const node=canonicalPoseBone(parent);if(node===sample.node||visited.has(node))continue;visited.add(node)
                if(!garment.test(node.name)||excluded.test(node.name))break
                let joint=byNode.get(node)
                if(!joint){joint={node,samples:[],before:q(),after:q(),applied:false,angle:0};this.joints.push(joint);byNode.set(node,joint)}
                if(!joint.samples.includes(sample))joint.samples.push(sample);ancestors++
            }
        }
        // Parent cloth drivers first. A small fixed iteration count bounds work.
        const depth=(n:Object3D)=>{let d=0;for(let p=n.parent;p&&p!==root;p=p.parent)d++;return d}
        this.joints.sort((a,b)=>depth(a.node)-depth(b.node)||a.node.name.localeCompare(b.node.name))
        this.stats.supported=this.joints.length>0&&completeLegs
        this.stats.samples=this.samples.length;this.stats.joints=this.joints.length
        if(this.stats.supported)this.surface=new GarmentSurfaceContact(root,[...candidates].flatMap(([node,list])=>list.map(item=>{
            const preferred=item.rest.clone().sub(hipPosition);preferred.y=0;if(preferred.lengthSq()<1e-8)preferred.z=1
            return {mesh:item.mesh,index:item.index,node,preferred:preferred.normalize().applyQuaternion(this.hipBindInverse)}
        })),this.legLength)

    }
    get diagnostics():GarmentContactStats{return {...this.stats}}
    setRecoveryHalfLife(seconds:number){
        if(Number.isFinite(seconds))this.recoveryHalfLife=clamp(seconds,.04,.3)
    }
    /** Restore display overrides before native animation/physics. The passive
     * recovery state is separate, so no contact output becomes spring input. */
    restore(clearHistory=false){
        this.surface?.restore()
        let changed=false
        for(const j of this.joints){
            if(j.applied&&1-Math.abs(j.node.quaternion.dot(j.after))<1e-9){
                j.node.quaternion.copy(j.before);j.node.updateMatrix();changed=true
            }
            j.applied=false;j.angle=0
            if(clearHistory)j.history=undefined
        }
        if(clearHistory){this.previousRootPosition=undefined;for(const sample of this.samples)sample.armDirections?.clear();for(const capsule of this.capsules){capsule.previousStart=undefined;capsule.previousEnd=undefined}}
        if(changed)this.root.updateMatrixWorld(true)
    }
    private point(sample:ContactSample):Vector3{
        sample.mesh.getVertexPosition(sample.index,sample.point)
        return sample.point.applyMatrix4(sample.mesh.matrixWorld)
    }
    private distance(p:Vector3,c:Capsule):number{
        this.end.subVectors(c.end,c.start)
        const t=clamp(this.offset.subVectors(p,c.start).dot(this.end)/Math.max(this.end.lengthSq(),1e-10),0,1)
        this.nearest.copy(c.start).addScaledVector(this.end,t)
        this.normal.subVectors(p,this.nearest)
        return this.normal.length()
    }
    private measure(contactSkin=false){
        let worst=0,energy=0,collider='',part=''
        for(const sample of this.samples){
            const p=this.point(sample)
            for(const c of this.capsules){
                const depth=Math.max(0,c.worldRadius+(contactSkin?this.legLength*.003:0)-this.distance(p,c))
                if(depth>worst){worst=depth;collider=c.a.name+' → '+c.b.name;part=sample.node.name};energy+=depth*depth
            }
        }
        return {worst,energy,score:energy+worst*worst*4,collider,part}
    }
    /** Distance to the capsule boundary along a stable cloth-side direction.
     * Unlike flipping an arbitrary penetration normal, this solves the positive
     * ray/sphere root and cannot switch sides as a fast limb crosses a seam. */
    private contact(sample:ContactSample,p:Vector3,c:Capsule):number{
        const length=this.distance(p,c),margin=this.legLength*.003
        if(length>=c.worldRadius+margin)return 0
        const radial=this.normal.clone()
        if(c.arm){
            const fixed=sample.armDirections?.get(c)
            if(fixed)this.normal.copy(fixed).applyQuaternion(this.hipRotation)
            else if(length>1e-8)this.normal.multiplyScalar(1/length)
            else this.normal.copy(sample.preferred).applyQuaternion(this.hipRotation).negate()
        }else this.normal.copy(sample.preferred).applyQuaternion(this.hipRotation)
        this.normal.normalize()
        const along=radial.dot(this.normal)
        return Math.max(0,-along+Math.sqrt(Math.max(0,along*along+(c.worldRadius+margin)**2-length*length)))
    }
    private write(j:Joint,value:Quaternion){
        j.node.quaternion.copy(value);j.node.updateMatrix();j.node.updateWorldMatrix(false,true)
        j.after.copy(j.node.quaternion);j.applied=true
    }
    private rotate(j:Joint,axis:Vector3,angle:number){
        if(!Number.isFinite(angle)||axis.lengthSq()<1e-12)return
        this.parentRotation.identity();j.node.parent?.getWorldQuaternion(this.parentRotation)
        this.delta.setFromAxisAngle(axis.normalize().applyQuaternion(this.parentRotation.invert()),angle)
        const candidate=j.node.quaternion.clone().premultiply(this.delta).normalize()
        const base=j.before.clone().normalize(),distance=base.angleTo(candidate)
        if(distance>this.maxAngle){candidate.copy(base.clone().slerp(candidate,this.maxAngle/distance));this.stats.limited=true}
        if(j.frameOrigin&&j.frameBudget!==undefined){
            const travel=j.frameOrigin.angleTo(candidate)
            if(travel>j.frameBudget){candidate.copy(j.frameOrigin.clone().slerp(candidate,j.frameBudget/travel));this.stats.limited=true}
        }
        // An authored pose can move the admissible cone between frames. Its
        // hard deformation bound wins when the temporal trust region and that
        // cone do not intersect; never retain a stale out-of-bounds garment.
        const bounded=base.angleTo(candidate)
        if(bounded>this.maxAngle)candidate.copy(base.clone().slerp(candidate,this.maxAngle/bounded))
        this.write(j,candidate)
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
        const blend=temporal?1-Math.exp(-Math.LN2*deltaSeconds/this.recoveryHalfLife):1
        for(const c of this.capsules){c.a.getWorldPosition(c.start);c.b.getWorldPosition(c.end);c.worldRadius=(c.radius+this.legLength*.004)*factor}
        let bodyTravel=0
        const worldToRoot=this.root.matrixWorld.clone().invert()
        for(const c of this.capsules){
            const a=c.start.clone().applyMatrix4(worldToRoot),b=c.end.clone().applyMatrix4(worldToRoot)
            if(temporal&&c.previousStart&&c.previousEnd)bodyTravel=Math.max(bodyTravel,a.distanceTo(c.previousStart),b.distanceTo(c.previousEnd))
            if(deltaSeconds>0){c.previousStart=a;c.previousEnd=b}
        }
        // Keep whole garment-chain motion slow and passive. Immediate local
        // contact belongs to projectSurface(), so a fast knee never requires
        // whipping the complete hem around or slowing the body's animation.
        const frameBudget=1.8*Math.max(0,deltaSeconds)+Math.min(.003,bodyTravel/Math.max(this.legLength,1e-6))
        const native=this.measure();this.stats.beforeDepth=native.worst
        // Cache the side of an ARM contact on entry. Arms can touch a garment
        // from either side; keep that side until separation, rather than moving
        // the arm or toggling a front/back normal every frame.
        const inverse=this.hipRotation.clone().invert()
        for(const sample of this.samples){
            const p=this.point(sample);sample.armDirections??=new Map()
            if(!temporal)sample.armDirections.clear()
            for(const c of this.capsules){if(!c.arm)continue
                const length=this.distance(p,c)
                if(length>c.worldRadius+this.legLength*.035)sample.armDirections.delete(c)
                else if(length<c.worldRadius&&!sample.armDirections.has(c)){
                    const direction=length>1e-8?this.normal.clone().multiplyScalar(1/length):sample.preferred.clone().applyQuaternion(this.hipRotation).negate()
                    sample.armDirections.set(c,direction.applyQuaternion(inverse))
                }
            }
        }
        for(const j of this.joints){
            j.before.copy(j.node.quaternion)
            j.frameOrigin=temporal?j.history?.clone():undefined;j.frameBudget=temporal?frameBudget:undefined
            if(blocked(j.node)){j.history=undefined;continue}
            if(temporal&&j.history){
                // Passive first-order damping: no simulated velocity, stored
                // spring energy, random force, overshoot or per-frame gain.
                const base=j.before.clone().normalize(),filtered=j.history.clone().slerp(base,blend)
                const distance=base.angleTo(filtered)
                if(distance>this.maxAngle)filtered.copy(base.clone().slerp(filtered,this.maxAngle/distance))
                this.write(j,filtered)
            }
        }
        // Damping is followed by CURRENT-frame constraints. Thus a rapidly
        // advancing thigh/hand is never delayed by the recovery time constant.
        let best=this.measure(true)
        for(const j of this.joints)j.best=j.node.quaternion.clone()
        for(let pass=0;pass<this.passLimit;pass++){
            for(const j of this.joints){
                if(blocked(j.node))continue
                j.node.getWorldPosition(this.pivot);this.step.set(0,0,0);let count=0
                for(const sample of j.samples){const p=this.point(sample)
                    for(const c of this.capsules){
                        const depth=this.contact(sample,p,c);if(depth<=this.legLength*.000005)continue
                        this.r.subVectors(p,this.pivot);this.axis.crossVectors(this.r,this.normal)
                        const denom=this.axis.lengthSq()+this.legLength*this.legLength*.001
                        const weight=clamp(depth/(this.legLength*.025),.2,2)
                        this.step.addScaledVector(this.axis,Math.min(depth,this.legLength*.20)/denom*weight)
                        count+=weight;this.stats.contacts++
                    }
                }
                if(count){this.step.multiplyScalar(.9/count);this.rotate(j,this.step,Math.min(this.step.length(),.22))}
            }
            const current=this.measure(true)
            const improved=current.score<best.score-1e-14
            if(improved){best=current;for(const j of this.joints)j.best!.copy(j.node.quaternion)}
            else if(pass>=2)break
            if(current.worst<this.legLength*.00005)break
        }
        // Keep the best bounded cloth solution. The old all-or-nothing restore
        // at one bad sample caused visible on/off snaps on successive frames.
        for(const j of this.joints){
            if(blocked(j.node))continue
            if(j.applied)this.write(j,j.best!)
            const angle=j.before.clone().normalize().angleTo(j.node.quaternion.clone().normalize())
            if(angle>1e-8){this.stats.correctedJoints++;this.stats.maxRotation=Math.max(this.stats.maxRotation,angle)}
            if(temporal)j.history=j.node.quaternion.clone()
            j.after.copy(j.node.quaternion)
        }
        this.root.updateMatrixWorld(true)
        const final=this.measure();this.stats.afterDepth=final.worst;this.stats.worstCollider=final.collider;this.stats.worstGarment=final.part
        this.stats.limited ||= this.stats.afterDepth>this.legLength*.003
        if(deltaSeconds>0)this.previousRootPosition=rootPosition
        this.elapsed=performance.now()-started;this.stats.milliseconds=this.elapsed
        return this.diagnostics
    }
    projectSurface(blocked:((node:Object3D)=>boolean)=()=>false){
        if(!this.surface||!this.hip)return this.diagnostics
        this.root.updateMatrixWorld(true);this.hip.getWorldQuaternion(this.hipRotation);this.root.getWorldScale(this.rootScale)
        const factor=Math.max(Math.abs(this.rootScale.x),Math.abs(this.rootScale.y),Math.abs(this.rootScale.z))
        for(const c of this.capsules){c.a.getWorldPosition(c.start);c.b.getWorldPosition(c.end);c.worldRadius=(c.radius+this.legLength*.004)*factor}
        const started=performance.now();this.stats.surface=this.surface.project(this.capsules,this.hipRotation,blocked,factor)
        const result=this.measure();this.stats.afterDepth=result.worst;this.stats.worstCollider=result.collider;this.stats.worstGarment=result.part
        this.stats.limited ||= this.stats.surface.limited;this.stats.milliseconds+=performance.now()-started
        return this.diagnostics
    }
    dispose(){this.restore(true);this.surface?.dispose();this.surface=undefined;this.samples.length=0;this.joints=[];this.capsules=[]}
}
