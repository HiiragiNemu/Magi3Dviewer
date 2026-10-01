import { Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three'
import { canonicalPoseBone, poseBones, poseBoneIsActive } from './directPoseTools.ts'

/** Separate opt-out post-animation contact layer. No velocity, springs, wind,
 * random forces or accumulated displacement. Every solve starts at this frame's
 * native pose; only bounded rotations of garment/arm joints may be changed. */
export const GARMENT_CONTACT_POLICY = 'quasistatic-body-capsules-v1'
export const GARMENT_CONTACT_SETTING = 'magius.garment-contacts.v1'
const garment = /skirt|dress|coat|mantle|cape|hem|cloth/i
const excluded = /hair|ribbon|weapon|finger|thumb|face|eye|bust|(?:root|end|tip|nub)$/i
const helper = /:official|:stencil|:mask|SelectionOutline|:forward|:outline/i
const clamp = (x:number,a:number,b:number) => Math.max(a,Math.min(b,x))
const v = () => new Vector3()
const q = () => new Quaternion()
interface ContactSample { mesh:SkinnedMesh; index:number; node:Object3D; preferred:Vector3; point:Vector3 }
interface Capsule { arm?:boolean; a:Object3D; b:Object3D; radius:number; start:Vector3; end:Vector3; worldRadius:number }
interface Joint { node:Object3D; samples:ContactSample[]; before:Quaternion; after:Quaternion; applied:boolean; angle:number }
interface Arm { upper:Object3D; lower:Object3D; hand:Object3D; side:number; radius:number; joint:Joint }
export interface GarmentContactStats { policy:string; supported:boolean; samples:number; joints:number; contacts:number; beforeDepth:number; afterDepth:number; maxRotation:number; correctedJoints:number; milliseconds:number; limited:boolean }

export class StableGarmentContacts {
    readonly root:Object3D
    readonly samples:ContactSample[]=[]
    private joints:Joint[]=[]
    private capsules:Capsule[]=[]
    private arms:Arm[]=[]
    private hip?:Object3D
    private legLength=0
    private hipBindInverse = q()
    private hipRotation = q()
    private rootScale = v()
    private end=v();private offset=v();private nearest=v();private normal=v();private r=v();private axis=v();private step=v();private pivot=v();private tmp=v()
    private parentRotation=q();private delta=q()
    private elapsed=0
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
                if(clothWeight<.05){for(const c of this.capsules){let w=0;for(let k=0;k<4;k++){const bone=canonical[skinIndex.getComponent(i,k)];if(bone===c.a||bone===c.b)w+=skinWeight.getComponent(i,k)}if(w>.8){const a=v().setFromMatrixPosition(rest.get(c.a)!),b=v().setFromMatrixPosition(rest.get(c.b)!),d=b.sub(a);const t=p.clone().sub(a).dot(d)/Math.max(1e-12,d.lengthSq());if(t>.2&&t<.8){const distance=p.distanceTo(a.addScaledVector(d,t));radii.get(c)!.push(distance)}}}}
            }
        }
        for(const c of this.capsules){const values=radii.get(c)!.filter(n=>Number.isFinite(n)).sort((a,b)=>a-b);if(values.length)c.radius=clamp(values[Math.floor(values.length*.82)]*1.08,this.legLength*.035,this.legLength*.14)}
        for(const [node,list] of candidates){
            // Deterministic spatial bins prevent repeated triangle vertices from
            // overweighting one seam. At most 24 probes per native cloth joint.
            const unique=new Map<string,typeof list[number]>()
            for(const s of list){const bin=[s.rest.x,s.rest.y,s.rest.z].map(n=>Math.round(n/(this.legLength*.018))).join(',');if(!unique.has(bin))unique.set(bin,s)}
            const all=[...unique.values()],count=Math.min(24,all.length),samples:ContactSample[]=[]
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
            for(let parent=sample.node.parent;parent&&parent!==root&&ancestors<2;parent=parent.parent){
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
        const completeLegs=this.capsules.length===4
        for(const side of ['L','R']){
            const upper=find(new RegExp('^(?:Arm|UpperArm)_'+side+'$','i')),lower=find(new RegExp('^(?:Forearm|LowerArm)_'+side+'$','i')),hand=find(new RegExp('^(?:Hand|Wrist)_'+side+'$','i'))
            if(upper&&lower&&hand){this.arms.push({upper,lower,hand,side:side==='L'?1:-1,radius:this.legLength*.045,joint:{node:upper,samples:[],before:q(),after:q(),applied:false,angle:0}});this.capsules.push({arm:true,a:lower,b:hand,radius:this.legLength*.043,start:v(),end:v(),worldRadius:0})}
        }
        this.stats.supported=this.joints.length>0&&completeLegs
        this.stats.samples=this.samples.length;this.stats.joints=this.joints.length
    }
    get diagnostics():GarmentContactStats{return {...this.stats}}
    /** Must run before native evaluators. Never feed a displayed contact result
     * back into a physics team's animation input or the next recorder sample. */
    restore(){let changed=false;for(const j of [...this.joints,...this.arms.map(a=>a.joint)]){if(j.applied&&1-Math.abs(j.node.quaternion.dot(j.after))<1e-9){j.node.quaternion.copy(j.before);j.node.updateMatrix();changed=true}j.applied=false;j.angle=0}if(changed)this.root.updateMatrixWorld(true)}
    private point(sample:ContactSample):Vector3{sample.mesh.getVertexPosition(sample.index,sample.point);return sample.point.applyMatrix4(sample.mesh.matrixWorld)}
    private depth(p:Vector3,c:Capsule,preferred?:Vector3):number{
        this.end.subVectors(c.end,c.start);const t=clamp(this.offset.subVectors(p,c.start).dot(this.end)/Math.max(this.end.lengthSq(),1e-10),0,1)
        this.nearest.copy(c.start).addScaledVector(this.end,t);this.normal.subVectors(p,this.nearest);const len=this.normal.length(),penetration=c.worldRadius-len
        if(penetration<=0)return 0
        if(len>1e-8)this.normal.multiplyScalar(1/len);else this.normal.copy(preferred??this.tmp.set(0,0,1))
        // Keep a front/back cloth panel on its original side when a fast limb
        // crosses deeply into it. This avoids alternating inward/outward normals.
        if(preferred&&this.normal.dot(preferred)<.15)this.normal.copy(preferred)
        return penetration
    }
    private rotate(j:Joint,axis:Vector3,angle:number,maximum:number){
        if(!Number.isFinite(angle)||axis.lengthSq()<1e-12)return
        if(!j.applied){j.before.copy(j.node.quaternion);j.applied=true}
        const allowed=Math.min(Math.abs(angle),Math.max(0,maximum-j.angle));if(allowed<=0){this.stats.limited=true;return}
        j.angle+=allowed;this.parentRotation.identity();j.node.parent?.getWorldQuaternion(this.parentRotation)
        this.delta.setFromAxisAngle(axis.normalize().applyQuaternion(this.parentRotation.invert()),Math.sign(angle)*allowed)
        j.node.quaternion.premultiply(this.delta).normalize();j.node.updateMatrix();j.node.updateWorldMatrix(false,true);j.after.copy(j.node.quaternion)
    }
    solve(active=true,adjustArms=true,blocked:((node:Object3D)=>boolean)=()=>false):GarmentContactStats{
        this.restore()
        const start=performance.now();Object.assign(this.stats,{contacts:0,beforeDepth:0,afterDepth:0,maxRotation:0,correctedJoints:0,limited:false})
        if(!active||!this.stats.supported)return this.diagnostics
        this.hip!.getWorldQuaternion(this.hipRotation);this.root.getWorldScale(this.rootScale);const factor=Math.max(Math.abs(this.rootScale.x),Math.abs(this.rootScale.y),Math.abs(this.rootScale.z))
        // Bind data is world-scaled in imported models. Current root scale relative
        // to one is only for explicit user model scaling, not guessed bone lengths.
        for(const c of this.capsules){c.a.getWorldPosition(c.start);c.b.getWorldPosition(c.end);c.worldRadius=c.radius*factor}
        for(const s of this.samples){const p=this.point(s);for(const c of this.capsules)this.stats.beforeDepth=Math.max(this.stats.beforeDepth,this.depth(p,c))}
        const projectArms=()=>{
        // Refresh a small cached garment surface sample set once, never rebuild
        // or raycast the 40k-vertex scene in the pointer/animation hot path.
        for(const s of this.samples)this.point(s)
        const hip=this.hip!.getWorldPosition(v()),inverse=this.hipRotation.clone().invert()
        for(const arm of adjustArms?this.arms:[]){
            const hand=arm.hand.getWorldPosition(v()),local=hand.clone().sub(hip).applyQuaternion(inverse)
            const below=hip.y-hand.y;if(below<-.04*this.legLength||below>this.legLength*.75)continue
            const radial=v().set(local.x,0,local.z);if(radial.lengthSq()<1e-8)continue;const distance=radial.length();radial.normalize();let penetration=0
            for(const s of this.samples){if(!/skirt|dress|hem|cape|coat/i.test(s.node.name))continue;const p=s.point.clone().sub(hip).applyQuaternion(inverse),dy=Math.abs(p.y-local.y);const along=p.x*radial.x+p.z*radial.z,across=Math.abs(p.x*radial.z-p.z*radial.x);if(along<=0)continue;const wx=clamp(1-across/(this.legLength*.10),0,1),wy=clamp(1-dy/(this.legLength*.12),0,1),weight=wx*wx*(3-2*wx)*wy*wy*(3-2*wy);penetration=Math.max(penetration,(along+arm.radius-distance)*weight)}
            if(penetration<=0)continue
            // Rotate the complete arm about its native shoulder pivot; never
            // translate the wrist, change an elbow length, or touch the gait.
            const desired=hand.clone().addScaledVector(radial.applyQuaternion(this.hipRotation),Math.min(penetration,this.legLength*.12)),origin=arm.upper.getWorldPosition(v()),a=hand.sub(origin).normalize(),b=desired.sub(origin).normalize(),axis=a.clone().cross(b),angle=Math.acos(clamp(a.dot(b),-1,1))
            this.rotate(arm.joint,axis,angle,.34);this.stats.contacts++
        }
        }
        projectArms()
        for(const c of this.capsules){c.a.getWorldPosition(c.start);c.b.getWorldPosition(c.end)}
        for(let pass=0;pass<6;pass++)for(const j of this.joints){
            if(blocked(j.node))continue
            j.node.getWorldPosition(this.pivot);this.step.set(0,0,0);let count=0
            for(const s of j.samples){const p=this.point(s),preferred=s.preferred.clone().applyQuaternion(this.hipRotation)
                for(const c of this.capsules){const d=this.depth(p,c,c.arm?preferred.clone().negate():preferred);if(d<=0)continue
                    this.r.subVectors(p,this.pivot);this.axis.crossVectors(this.r,this.normal);const denom=this.axis.lengthSq()+this.legLength*this.legLength*.001
                    const x=clamp(d/(this.legLength*.018),0,1),weight=x*x*(3-2*x);this.step.addScaledVector(this.axis,Math.min(d,this.legLength*.12)/denom*weight);count+=weight;this.stats.contacts++
                }
            }
            if(count){this.step.multiplyScalar(.85/Math.max(1,count));const angle=Math.min(this.step.length(),.16);this.rotate(j,this.step,angle,.55)}
        }
        projectArms()
        for(const c of this.capsules){c.a.getWorldPosition(c.start);c.b.getWorldPosition(c.end)}
        this.root.updateMatrixWorld(true)
        for(const s of this.samples){const p=this.point(s);for(const c of this.capsules)this.stats.afterDepth=Math.max(this.stats.afterDepth,this.depth(p,c))}
        for(const j of [...this.joints,...this.arms.map(a=>a.joint)])if(j.applied){this.stats.correctedJoints++;this.stats.maxRotation=Math.max(this.stats.maxRotation,j.before.angleTo(j.after));j.after.copy(j.node.quaternion)}
        // Extreme authored poses may have no solution within conservative
        // rotation limits. Never make the worst measured penetration worse.
        if(this.stats.afterDepth>this.stats.beforeDepth+this.legLength*.002){this.restore();this.stats.afterDepth=this.stats.beforeDepth;this.stats.correctedJoints=0;this.stats.maxRotation=0;this.stats.limited=true}
        this.elapsed=performance.now()-start;this.stats.milliseconds=this.elapsed
        return this.diagnostics
    }
    dispose(){this.restore();this.samples.length=0;this.joints=[];this.capsules=[];this.arms=[]}
}
