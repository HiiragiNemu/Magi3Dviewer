import { closestTriangleSegment } from './garmentTriangleDistance.ts'
import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three'

export interface SurfaceVertex { mesh:SkinnedMesh; index:number; node:Object3D; preferred:Vector3 }
export interface SurfaceCapsule { arm?:boolean; start:Vector3; end:Vector3; worldRadius:number }
export interface GarmentSurfaceStats {
    vertices:number; correctedVertices:number; maxDisplacement:number; remainingDepth:number; limited:boolean
    contacts:number; maxEdgeRatio:number; recoveryOnly:boolean; triangleContacts:number; minAreaRatio:number
    beforeVertexDepth:number; afterVertexDepth:number; incomingContacts:number
}
interface SkinGroup { mesh:SkinnedMesh; indices:number[]; weights:number[]; inverse:Matrix3; forward:Matrix3; world:Matrix4; frame:number; inverseFrame:number }
interface CapsuleBounds { capsule:SurfaceCapsule;minX:number;minY:number;minZ:number;maxX:number;maxY:number;maxZ:number }
interface MeshFrame { frame:number; palette:Matrix4[]; baseInfluence:number }
interface VertexGroup {
    mesh:SkinnedMesh; indices:number[]; node?:Object3D; preferred:Vector3; skin:SkinGroup
    state:GeometryState; native:Vector3; point:Vector3; normal:Vector3; history:Vector3; previous:Vector3; previousNative?:Vector3; nativeTravel:number; movable:boolean
    morphIndices:number[]; morphBaseInfluence:number; adjacent:number[]; component:number; contactDirection?:Vector3
}
interface GeometryState { original:BufferGeometry; geometry:BufferGeometry; position:BufferAttribute; base:Float32Array; changed:Set<number>; users:Mesh[] }
interface Face { a:number;b:number;c:number; normal:Vector3; area:number; candidates:SurfaceCapsule[] }
interface Edge { a:number; b:number; length:number; materialLength:number; constraintLength:number }
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x))

function capsuleDistance(point:Vector3,c:SurfaceCapsule,nearest?:Vector3):number {
    const dx=c.end.x-c.start.x,dy=c.end.y-c.start.y,dz=c.end.z-c.start.z
    const t=clamp(((point.x-c.start.x)*dx+(point.y-c.start.y)*dy+(point.z-c.start.z)*dz)/Math.max(dx*dx+dy*dy+dz*dz,1e-12),0,1)
    const x=c.start.x+t*dx,y=c.start.y+t*dy,z=c.start.z+t*dz
    nearest?.set(x,y,z)
    return Math.sqrt((point.x-x)**2+(point.y-y)**2+(point.z-z)**2)
}
/** Positive ray exit from a capsule. Direction is the material's side of the
 * body, never a freshly flipped penetration normal or an upward escape. */
function capsuleExit(point:Vector3,direction:Vector3,c:SurfaceCapsule,r:number):number {
    const ax=c.end.x-c.start.x,ay=c.end.y-c.start.y,az=c.end.z-c.start.z,length=Math.hypot(ax,ay,az)
    let exit=0
    for(const center of [c.start,c.end]) {
        const mx=point.x-center.x,my=point.y-center.y,mz=point.z-center.z
        const dot=mx*direction.x+my*direction.y+mz*direction.z,disc=dot*dot+r*r-mx*mx-my*my-mz*mz
        if(disc>=0)exit=Math.max(exit,-dot+Math.sqrt(disc))
    }
    if(length>1e-9) {
        const ex=ax/length,ey=ay/length,ez=az/length,mx=point.x-c.start.x,my=point.y-c.start.y,mz=point.z-c.start.z
        const along=mx*ex+my*ey+mz*ez,parallel=direction.x*ex+direction.y*ey+direction.z*ez
        const qx=mx-along*ex,qy=my-along*ey,qz=mz-along*ez,dx=direction.x-parallel*ex,dy=direction.y-parallel*ey,dz=direction.z-parallel*ez
        const a=dx*dx+dy*dy+dz*dz,b=qx*dx+qy*dy+qz*dz,cc=qx*qx+qy*qy+qz*qz-r*r,disc=b*b-a*cc
        if(a>1e-12&&disc>=0) {
            const t=(-b+Math.sqrt(disc))/a,h=along+t*parallel
            if(h>=0&&h<=length)exit=Math.max(exit,t)
        }
    }
    return exit
}

/** A kinematic garment-surface constraint, not a second bone/cloth simulator.
 * The native animated shape remains the reference every frame. Only contact
 * offsets have passive recovery; original bones and non-garment vertices are
 * immutable. Shared triangle seams are welded by actual skin identity.
 */
export class GarmentSurfaceContact {
    private readonly geometries:GeometryState[]=[]
    private readonly views:Array<{mesh:Mesh;original:BufferGeometry;geometry:BufferGeometry}>=[]
    private readonly vertices:VertexGroup[]=[]
    private readonly lookup=new Map<SkinnedMesh,Map<number,number>>()
    private readonly edges:Edge[]=[]
    private readonly faces:Face[]=[]
    private readonly facePoint=new Vector3()
    private readonly barycentric=new Vector3()
    private readonly gradientA=new Vector3()
    private readonly gradientB=new Vector3()
    private readonly gradientC=new Vector3()
    private readonly boneMatrix=new Matrix4()
    private readonly worldSkin=new Matrix4()
    private readonly meshFrames=new Map<SkinnedMesh,MeshFrame>()
    private readonly delta=new Vector3()
    private readonly direction=new Vector3()
    private readonly average=new Vector3()
    private readonly edgeDelta=new Vector3()
    private readonly trial=new Vector3()
    private readonly best=new Vector3()
    private readonly trialDirection=new Vector3()
    private readonly up=new Vector3()
    private readonly inverseHip=new Quaternion()
    private readonly hipRotation=new Quaternion()
    private readonly nearest=new Vector3()
    private readonly componentScales:number[]=[]
    private readonly nearby:SurfaceCapsule[]=[]
    private readonly candidateCapsules=new Map<VertexGroup,SurfaceCapsule[]>()
    private readonly activeFaces:Face[]=[]
    private readonly capsuleBounds=new Map<SurfaceCapsule,CapsuleBounds>()
    private readonly frameBounds:CapsuleBounds[]=[]
    private lastProjection=0
    private readonly root:Object3D
    private readonly rootInverse=new Matrix4()
    private readonly previousCapsules=new Map<SurfaceCapsule,{a:Vector3;b:Vector3}>()
    private readonly capsuleTravel=new Map<SurfaceCapsule,number>()
    private readonly localPoint=new Vector3()
    private readonly temporalAlpha:number[]=[]
    private frame=0
    private inputContact=false
    private previousScale=0
    private halfLife=.12
    private readonly length:number
    private readonly maxStrain=1.12
    private readonly stats:GarmentSurfaceStats={vertices:0,correctedVertices:0,maxDisplacement:0,remainingDepth:0,limited:false,contacts:0,maxEdgeRatio:1,recoveryOnly:false,triangleContacts:0,minAreaRatio:1,beforeVertexDepth:0,afterVertexDepth:0,incomingContacts:0}

    constructor(root:Object3D,source:SurfaceVertex[],length:number) {
        this.length=length;this.root=root
        const byGeometry=new Map<BufferGeometry,GeometryState>(),groups=new Map<string,number>(),skins=new Map<string,SkinGroup>()
        const byMeshIndex=this.lookup
        const sourceIndices=new Map<SkinnedMesh,Map<number,SurfaceVertex>>()
        for(const item of source) {
            if(!sourceIndices.has(item.mesh))sourceIndices.set(item.mesh,new Map())
            sourceIndices.get(item.mesh)!.set(item.index,item)
        }
        const addVertex=(mesh:SkinnedMesh,index:number,item?:SurfaceVertex):number=>{
            const known=byMeshIndex.get(mesh)?.get(index)
            if(known!==undefined)return known
            const old=mesh.geometry,position=old.getAttribute('position') as BufferAttribute
            if(!position||position.itemSize!==3||!(position.array instanceof Float32Array))return -1
            let state=byGeometry.get(old)
            if(!state) {
                const geometry=old.clone(),p=geometry.getAttribute('position') as BufferAttribute
                state={original:old,geometry,position:p,base:new Float32Array(position.array),changed:new Set(),users:[]}
                byGeometry.set(old,state);this.geometries.push(state)
            }
            const indices:number[]=[],weights:number[]=[],skinIndex=old.getAttribute('skinIndex'),skinWeight=old.getAttribute('skinWeight')
            for(let k=0;k<4;k++){indices.push(skinIndex.getComponent(index,k));weights.push(skinWeight.getComponent(index,k))}
            const skinKey=mesh.uuid+':'+indices.join(',')+':'+weights.join(',')
            let skin=skins.get(skinKey)
            if(!skin){skin={mesh,indices,weights,inverse:new Matrix3(),forward:new Matrix3(),world:new Matrix4(),frame:-1,inverseFrame:-1};skins.set(skinKey,skin)}
            const morphIndices:number[]=[],morphSignature:string[]=[]
            for(const [morphIndex,attribute]of (old.morphAttributes.position??[]).entries()){
                const values=[0,1,2].map(k=>attribute.getComponent(index,k))
                if(values.some((value,k)=>value!==(old.morphTargetsRelative?0:state!.base[index*3+k]))){
                    morphIndices.push(morphIndex);morphSignature.push(morphIndex+':'+values.join(','))
                }
            }
            const offset=index*3,key=skinKey+':'+state.base.slice(offset,offset+3).join(',')+':'+morphSignature.join('|')
            let id=groups.get(key)
            if(id===undefined) {
                id=this.vertices.length;groups.set(key,id)
                this.vertices.push({mesh,indices:[],node:item?.node,preferred:item?.preferred.clone()??new Vector3(),skin,state,native:new Vector3(),point:new Vector3(),normal:new Vector3(),history:new Vector3(),previous:new Vector3(),nativeTravel:0,movable:!!item,morphIndices,morphBaseInfluence:1,adjacent:[],component:-1})
            }
            this.vertices[id].indices.push(index)
            if(!byMeshIndex.has(mesh))byMeshIndex.set(mesh,new Map())
            byMeshIndex.get(mesh)!.set(index,id)
            return id
        }
        // Register movable vertices first so boundary duplicates stay coherent.
        for(const item of source)addVertex(item.mesh,item.index,item)
        const edgeKeys=new Set<string>()
        for(const [mesh,selected] of sourceIndices) {
            const geometry=mesh.geometry,index=geometry.index,count=index?.count??geometry.getAttribute('position').count
            const get=(i:number)=>index?index.getX(i):i
            for(let t=0;t+2<count;t+=3) {
                const triangle=[get(t),get(t+1),get(t+2)]
                if(!triangle.some(i=>selected.has(i)))continue
                const ids=triangle.map(i=>addVertex(mesh,i,selected.get(i)))
                if(ids.every(i=>i>=0)&&new Set(ids).size===3)this.faces.push({a:ids[0],b:ids[1],c:ids[2],normal:new Vector3(),area:0,candidates:[]})
                for(let e=0;e<3;e++) {
                    const a=ids[e],b=ids[(e+1)%3]
                    if(a<0||b<0||a===b)continue
                    const key=Math.min(a,b)+':'+Math.max(a,b)
                    if(edgeKeys.has(key))continue
                    edgeKeys.add(key)
                    const va=this.vertices[a],vb=this.vertices[b]
                    const pa=new Vector3().fromArray(va.state.base,va.indices[0]*3).applyMatrix4(mesh.bindMatrix)
                    const pb=new Vector3().fromArray(vb.state.base,vb.indices[0]*3).applyMatrix4(mesh.bindMatrix)
                    this.edges.push({a,b,length:0,materialLength:pa.distanceTo(pb),constraintLength:0})
                    this.vertices[a].adjacent.push(b);this.vertices[b].adjacent.push(a)
                }
            }
        }
        // Connected cloth components get an exact last-resort strain bound.
        // A pinned body vertex is a boundary, never a way to merge garments.
        let component=0
        for(let i=0;i<this.vertices.length;i++) {
            const first=this.vertices[i]
            if(!first.node||first.component>=0)continue
            const pending=[i];first.component=component
            while(pending.length){const id=pending.pop()!;for(const n of this.vertices[id].adjacent){const next=this.vertices[n];if(next.node&&next.component<0){next.component=component;pending.push(n)}}}
            component++
        }
        this.componentScales.length=component
        // Native material-slot outlines use separate Geometry objects sharing
        // the source position attribute. Identity-by-geometry alone left those
        // backfaces undeformed: they protruded through a dent as solid black
        // patches. Rebind every exact buffer view, preserving its draw range.
        const byPosition=new Map(this.geometries.map(state=>[state.original.getAttribute('position'),state]))
        root.traverse(node=>{
            const mesh=node as Mesh;if(!mesh.isMesh)return
            const old=mesh.geometry,state=byGeometry.get(old)??byPosition.get(old.getAttribute('position'))
            if(!state)return
            if(old===state.original){state.users.push(mesh);mesh.geometry=state.geometry;return}
            const geometry=new BufferGeometry();geometry.name=old.name
            if(old.index)geometry.setIndex(old.index)
            for(const [name,attribute]of Object.entries(old.attributes))geometry.setAttribute(name,name==='position'?state.position:attribute)
            geometry.morphAttributes=old.morphAttributes;geometry.morphTargetsRelative=old.morphTargetsRelative
            geometry.setDrawRange(old.drawRange.start,old.drawRange.count)
            for(const group of old.groups)geometry.addGroup(group.start,group.count,group.materialIndex)
            geometry.boundingBox=state.geometry.boundingBox;geometry.boundingSphere=state.geometry.boundingSphere
            this.views.push({mesh,original:old,geometry});mesh.geometry=geometry
        })
        for(const state of this.geometries){state.geometry.boundingBox?.expandByScalar(length*.24);if(state.geometry.boundingSphere)state.geometry.boundingSphere.radius+=length*.24}
        this.stats.vertices=this.vertices.filter(v=>v.node).length
    }
    get diagnostics(){return {...this.stats}}
    sampledPosition(mesh:SkinnedMesh,index:number,corrected=true):Vector3|undefined {
        const id=this.lookup.get(mesh)?.get(index),vertex=id===undefined?undefined:this.vertices[id]
        return vertex?(corrected?vertex.point:vertex.native):undefined
    }
    setRecoveryHalfLife(seconds:number){if(Number.isFinite(seconds))this.halfLife=clamp(seconds,.04,.3)}
    clearHistory(){for(const vertex of this.vertices){vertex.history.set(0,0,0);vertex.contactDirection=undefined;vertex.previousNative=undefined}this.previousCapsules.clear();this.inputContact=false;this.previousScale=0}
    restore() {
        for(const state of this.geometries) {
            if(!state.changed.size)continue
            const array=state.position.array
            for(const index of state.changed){const o=index*3;array[o]=state.base[o];array[o+1]=state.base[o+1];array[o+2]=state.base[o+2]}
            state.changed.clear();state.position.needsUpdate=true
        }
    }
    private skin(group:SkinGroup):boolean {
        if(group.frame===this.frame)return true
        const mesh=group.mesh
        let cached=this.meshFrames.get(mesh)
        if(!cached){cached={frame:-1,palette:mesh.skeleton.bones.map(()=>new Matrix4()),baseInfluence:1};this.meshFrames.set(mesh,cached)}
        if(cached.frame!==this.frame){
            this.boneMatrix.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse)
            for(let i=0;i<mesh.skeleton.bones.length;i++)cached.palette[i].copy(this.boneMatrix)
                .multiply(mesh.skeleton.bones[i].matrixWorld).multiply(mesh.skeleton.boneInverses[i]).multiply(mesh.bindMatrix)
            cached.baseInfluence=mesh.geometry.morphAttributes.position?.length&&!mesh.geometry.morphTargetsRelative
                ?1-(mesh.morphTargetInfluences??[]).reduce((a,b)=>a+b,0):1
            cached.frame=this.frame
        }
        const e=this.worldSkin.elements;e.fill(0)
        for(let k=0;k<4;k++) {
            const weight=group.weights[k],index=group.indices[k]
            if(!weight)continue
            const transform=cached.palette[index];if(!transform)return false
            const values=transform.elements
            for(let j=0;j<16;j++)e[j]+=values[j]*weight
        }
        group.forward.setFromMatrix4(this.worldSkin)
        if(Math.abs(group.forward.determinant())<1e-12)return false
        group.world.copy(this.worldSkin);group.frame=this.frame
        return true
    }
    private projectContacts(_capsules:readonly SurfaceCapsule[],skin:number,maximum:number):number {
        let count=0;this.lastProjection=0
        for(const vertex of this.vertices) {
            if(!vertex.movable)continue
            const capsules=this.candidateCapsules.get(vertex)??[]
            this.nearby.length=0
            let deepest:SurfaceCapsule|undefined,depth=-Infinity
            for(const c of capsules) {
                const penetration=c.worldRadius+skin-capsuleDistance(vertex.point,c)
                if(penetration>0){this.nearby.push(c);if(penetration>depth){depth=penetration;deepest=c}}
            }
            if(!deepest)continue
            this.lastProjection=Math.max(this.lastProjection,depth)
            const internal=this.nearby.some(c=>!c.arm)||/cape|mantle/i.test(vertex.node!.name)
            this.direction.copy(vertex.normal).multiplyScalar(internal?1:-1)
            // The nearest capsule normal lets a high knee lift/fold the actual
            // contacted fabric. It is accepted only on the material's original
            // side, so an exterior hand cannot flip through and inflate a skirt.
            capsuleDistance(vertex.point,deepest,this.nearest)
            this.trialDirection.subVectors(vertex.point,this.nearest)
            if(this.trialDirection.lengthSq()>1e-12&&this.trialDirection.normalize().dot(this.direction)>.35)this.direction.lerp(this.trialDirection,.35).normalize()
            else if(vertex.contactDirection){
                this.trialDirection.copy(vertex.contactDirection).applyQuaternion(this.hipRotation)
                if(this.trialDirection.dot(this.direction)>.2)this.direction.copy(this.trialDirection)
            }
            let bestCost=Infinity,bestAngle=0
            for(const angle of [0]) {
                this.trialDirection.copy(this.direction).applyAxisAngle(this.up,angle)
                this.trial.copy(vertex.point)
                for(let pass=0;pass<3;pass++) {
                    let touched=false
                    for(const c of capsules) {
                        if(capsuleDistance(this.trial,c)>=c.worldRadius+skin)continue
                        const amount=capsuleExit(this.trial,this.trialDirection,c,c.worldRadius+skin)
                        if(!Number.isFinite(amount)||amount<=0)continue
                        this.trial.addScaledVector(this.trialDirection,amount+skin*.01);touched=true
                    }
                    if(!touched)break
                }
                const travel=this.trial.distanceTo(vertex.point)
                let residual=0
                for(const c of capsules)residual=Math.max(residual,c.worldRadius-capsuleDistance(this.trial,c))
                const cost=travel+this.length*.008*Math.abs(angle)+residual*20
                if(cost<bestCost){bestCost=cost;this.best.copy(this.trial);bestAngle=angle}
                if(angle===0&&travel<this.length*.05&&residual<=skin)break
            }
            if(!Number.isFinite(bestCost))continue
            vertex.point.copy(this.best)
            vertex.contactDirection??=new Vector3()
            vertex.contactDirection.copy(this.direction).applyAxisAngle(this.up,bestAngle).applyQuaternion(this.inverseHip).normalize()
            this.delta.subVectors(vertex.point,vertex.native)
            if(this.delta.length()>maximum){this.delta.setLength(maximum);vertex.point.copy(vertex.native).add(this.delta);this.stats.limited=true}
            count+=this.nearby.length
        }
        return count
    }
    private refreshTriangleCandidates(){
        this.activeFaces.length=0
        for(const face of this.faces){
            face.candidates.length=0
            const va=this.vertices[face.a],vb=this.vertices[face.b],vc=this.vertices[face.c]
            if(!va.movable&&!vb.movable&&!vc.movable)continue
            const a=va.point,b=vb.point,c=vc.point
            const minX=Math.min(a.x,b.x,c.x),maxX=Math.max(a.x,b.x,c.x),minY=Math.min(a.y,b.y,c.y),maxY=Math.max(a.y,b.y,c.y),minZ=Math.min(a.z,b.z,c.z),maxZ=Math.max(a.z,b.z,c.z)
            for(const box of this.frameBounds){
                if(maxX<box.minX||minX>box.maxX||maxY<box.minY||minY>box.maxY||maxZ<box.minZ||minZ>box.maxZ)continue
                face.candidates.push(box.capsule)
            }
            if(face.candidates.length)this.activeFaces.push(face)
        }
    }
    private projectTriangleContacts(_capsules:readonly SurfaceCapsule[],skin:number,maximum:number,measureOnly=false):number {
        let contacts=0
        for(const face of this.activeFaces){
            const va=this.vertices[face.a],vb=this.vertices[face.b],vc=this.vertices[face.c]
            if(face.area<1e-10||!va.movable&&!vb.movable&&!vc.movable)continue
            const a=va.point,b=vb.point,c=vc.point
            for(const capsule of face.candidates){
                const radius=capsule.worldRadius+skin
                if(Math.max(a.x,b.x,c.x)<Math.min(capsule.start.x,capsule.end.x)-radius||Math.min(a.x,b.x,c.x)>Math.max(capsule.start.x,capsule.end.x)+radius
                    ||Math.max(a.y,b.y,c.y)<Math.min(capsule.start.y,capsule.end.y)-radius||Math.min(a.y,b.y,c.y)>Math.max(capsule.start.y,capsule.end.y)+radius
                    ||Math.max(a.z,b.z,c.z)<Math.min(capsule.start.z,capsule.end.z)-radius||Math.min(a.z,b.z,c.z)>Math.max(capsule.start.z,capsule.end.z)+radius)continue
                const distance=closestTriangleSegment(a,b,c,capsule.start,capsule.end,this.facePoint,this.barycentric)
                if(distance>=radius)continue
                const wa=va.movable?Math.max(0,this.barycentric.x):0,wb=vb.movable?Math.max(0,this.barycentric.y):0,wc=vc.movable?Math.max(0,this.barycentric.z):0
                const denominator=wa*wa+wb*wb+wc*wc
                if(denominator<.02)continue // the sewn/pinned boundary is not a freely translating sheet
                contacts++
                if(measureOnly){this.stats.remainingDepth=Math.max(this.stats.remainingDepth,capsule.worldRadius-distance);continue}
                const outward=!capsule.arm||!!(va.node&&/cape|mantle/i.test(va.node.name)||vb.node&&/cape|mantle/i.test(vb.node.name)||vc.node&&/cape|mantle/i.test(vc.node.name))
                this.direction.set(0,0,0)
                this.direction.addScaledVector(va.normal,wa).addScaledVector(vb.normal,wb).addScaledVector(vc.normal,wc)
                if(this.direction.lengthSq()<1e-10)this.direction.copy(face.normal)
                this.direction.normalize().multiplyScalar(outward?1:-1)
                const amount=capsuleExit(this.facePoint,this.direction,capsule,radius)
                if(!Number.isFinite(amount)||amount<=0)continue
                this.lastProjection=Math.max(this.lastProjection,radius-distance)
                for(let i=0;i<3;i++){
                    const weight=i===0?wa:i===1?wb:wc;if(!weight)continue
                    const vertex=i===0?va:i===1?vb:vc;vertex.point.addScaledVector(this.direction,(amount+skin*.01)*weight/denominator)
                    this.delta.subVectors(vertex.point,vertex.native)
                    if(this.delta.length()>maximum){vertex.point.copy(vertex.native).add(this.delta.setLength(maximum));this.stats.limited=true}
                }
            }
        }
        return contacts
    }
    private relaxTriangleAreas():number {
        let worst=0
        for(const face of this.faces){
            if(face.area<1e-10)continue
            const a=this.vertices[face.a],b=this.vertices[face.b],c=this.vertices[face.c]
            this.delta.subVectors(b.point,a.point);this.average.subVectors(c.point,a.point)
            const area=this.edgeDelta.crossVectors(this.delta,this.average).dot(face.normal),violation=face.area*.35-area
            if(violation<=0)continue
            this.gradientA.subVectors(b.point,c.point).cross(face.normal)
            this.gradientB.subVectors(c.point,a.point).cross(face.normal)
            this.gradientC.subVectors(a.point,b.point).cross(face.normal)
            const denominator=(a.movable?this.gradientA.lengthSq():0)+(b.movable?this.gradientB.lengthSq():0)+(c.movable?this.gradientC.lengthSq():0)
            if(denominator<1e-14)continue
            const gain=violation/denominator
            if(a.movable)a.point.addScaledVector(this.gradientA,gain)
            if(b.movable)b.point.addScaledVector(this.gradientB,gain)
            if(c.movable)c.point.addScaledVector(this.gradientC,gain)
            worst=Math.max(worst,violation)
        }
        return worst
    }
    private rejectWorsenedComponents(_capsules:readonly SurfaceCapsule[],skin:number) {
        const before=this.componentScales.map(()=>({worst:0,energy:0})),after=this.componentScales.map(()=>({worst:0,energy:0}))
        for(const vertex of this.vertices)if(vertex.movable)for(const c of this.candidateCapsules.get(vertex)??[]) {
            const a=Math.max(0,c.worldRadius-capsuleDistance(vertex.native,c)),b=Math.max(0,c.worldRadius-capsuleDistance(vertex.point,c))
            before[vertex.component].worst=Math.max(before[vertex.component].worst,a);before[vertex.component].energy+=a*a
            after[vertex.component].worst=Math.max(after[vertex.component].worst,b);after[vertex.component].energy+=b*b
        }
        for(const vertex of this.vertices)if(vertex.movable) {
            const a=before[vertex.component],b=after[vertex.component]
            if(b.worst>a.worst+skin*.25||b.energy>a.energy*1.02+1e-12){vertex.point.copy(vertex.native);this.stats.limited=true}
        }
    }
    private relaxEdges(scale:number) {
        let correction=0
        for(const edge of this.edges) {
            const a=this.vertices[edge.a],b=this.vertices[edge.b],weight=Number(a.movable)+Number(b.movable)
            if(!weight||edge.length<1e-8)continue
            this.edgeDelta.subVectors(b.point,a.point);const distance=this.edgeDelta.length()
            const maximum=edge.constraintLength*1.06+this.length*.0001*scale,minimum=edge.length*.92
            if(distance<=maximum&&distance>=minimum||distance<1e-10)continue
            const target=clamp(distance,minimum,maximum),gain=(distance-target)/distance/weight
            correction=Math.max(correction,Math.abs(distance-target))
            if(a.movable)a.point.addScaledVector(this.edgeDelta,gain)
            if(b.movable)b.point.addScaledVector(this.edgeDelta,-gain)
        }
        return correction
    }
    private enforceStrain(maximum=Infinity) {
        this.componentScales.fill(1)
        for(const vertex of this.vertices)if(vertex.movable){const distance=vertex.point.distanceTo(vertex.native);if(distance>maximum)this.componentScales[vertex.component]=Math.min(this.componentScales[vertex.component],maximum/distance)}
        for(const edge of this.edges) {
            const a=this.vertices[edge.a],b=this.vertices[edge.b],component=a.component>=0?a.component:b.component
            if(component<0||edge.length<1e-7)continue
            this.edgeDelta.subVectors(b.native,a.native)
            this.delta.subVectors(b.point,b.native).sub(this.average.subVectors(a.point,a.native))
            const maximum=edge.constraintLength*this.maxStrain
            if(this.trial.copy(this.edgeDelta).add(this.delta).length()<=maximum+1e-8)continue
            const aa=this.delta.lengthSq(),bb=this.edgeDelta.dot(this.delta),cc=edge.length*edge.length-maximum*maximum
            const alpha=aa>1e-14?clamp((-bb+Math.sqrt(Math.max(0,bb*bb-aa*cc)))/aa,0,1):1
            this.componentScales[component]=Math.min(this.componentScales[component],alpha)
        }
        // Signed area is a quadratic along the native-to-candidate segment.
        // Limit at its first root: no triangle may turn inside-out or collapse
        // into the black slits produced by edge-length-only constraints.
        for(const face of this.faces){
            if(face.area<1e-10)continue
            const a=this.vertices[face.a],b=this.vertices[face.b],c=this.vertices[face.c],component=a.movable?a.component:b.movable?b.component:c.movable?c.component:undefined
            if(component===undefined)continue
            const ab=this.gradientA.subVectors(b.native,a.native),ac=this.gradientB.subVectors(c.native,a.native)
            const dab=this.delta.subVectors(b.point,a.point).sub(ab),dac=this.average.subVectors(c.point,a.point).sub(ac)
            const A=this.edgeDelta.crossVectors(dab,dac).dot(face.normal),B=this.edgeDelta.crossVectors(dab,ac).dot(face.normal)+this.trial.crossVectors(ab,dac).dot(face.normal),C=face.area*.75
            const bound=this.componentScales[component],test=(x:number)=>A*x*x+B*x+C
            const critical=A>1e-14?Math.max(0,Math.min(bound,-B/(2*A))):bound
            if(test(bound)>=0&&test(critical)>=0)continue
            let first=bound
            if(Math.abs(A)<1e-14){if(B<0)first=Math.min(first,-C/B)}
            else{const disc=B*B-4*A*C;if(disc>=0)for(const value of [(-B-Math.sqrt(disc))/(2*A),(-B+Math.sqrt(disc))/(2*A)])if(value>=0)first=Math.min(first,value)}
            this.componentScales[component]=Math.max(0,first*.999999)
        }
        for(const vertex of this.vertices) {
            if(!vertex.movable)continue
            const alpha=this.componentScales[vertex.component]
            if(alpha<1){vertex.point.lerp(vertex.native,1-alpha);this.stats.limited=true}
        }
    }
    private limitContactStep(scale:number){
        this.temporalAlpha.length=this.componentScales.length;this.temporalAlpha.fill(1)
        for(const vertex of this.vertices){
            if(!vertex.movable||!vertex.previousNative)continue
            let bodyTravel=0
            for(const c of this.candidateCapsules.get(vertex)??[])bodyTravel=Math.max(bodyTravel,this.capsuleTravel.get(c)??0)
            // Relative native/body motion determines permissible incoming
            // displacement. Resting contacts cannot jump across a skirt, but a
            // fast leg is not forced to wait for a slow release half-life.
            const budget=Math.max(this.length*.002*scale,(vertex.nativeTravel+bodyTravel)*1.4)
            const distance=vertex.point.distanceTo(vertex.previous)
            if(distance>budget)this.temporalAlpha[vertex.component]=Math.min(this.temporalAlpha[vertex.component],budget/distance)
        }
        // Use one convex interpolation parameter per connected fabric piece.
        // Find the minimum parameter needed to keep the new native-pose edge
        // bounds; validity wins over the temporal limiter on a large pose edit.
        const minimum=this.componentScales.map(()=>0)
        for(const edge of this.edges){
            const a=this.vertices[edge.a],b=this.vertices[edge.b],component=a.component>=0?a.component:b.component
            if(component<0||edge.length<1e-8)continue
            this.edgeDelta.subVectors(b.previous,a.previous)
            this.delta.subVectors(b.point,a.point).sub(this.edgeDelta)
            const maximum=edge.constraintLength*this.maxStrain
            if(this.edgeDelta.length()<=maximum+1e-8)continue
            const aa=this.delta.lengthSq(),bb=this.edgeDelta.dot(this.delta),cc=this.edgeDelta.lengthSq()-maximum*maximum
            const discriminant=bb*bb-aa*cc
            const alpha=aa>1e-14&&discriminant>=0?clamp((-bb-Math.sqrt(discriminant))/aa,0,1):1
            minimum[component]=Math.max(minimum[component],alpha)
        }
        for(const vertex of this.vertices){
            if(!vertex.movable)continue
            const alpha=Math.max(this.temporalAlpha[vertex.component],minimum[vertex.component])
            vertex.point.lerp(vertex.previous,1-alpha)
        }
    }
    project(capsules:readonly SurfaceCapsule[],hip:Quaternion,blocked:(node:Object3D)=>boolean,scale=1,deltaSeconds=0) {
        this.restore();this.frame++;this.up.set(0,1,0).applyQuaternion(hip);this.inverseHip.copy(hip).invert();this.hipRotation.copy(hip)
        Object.assign(this.stats,{correctedVertices:0,maxDisplacement:0,remainingDepth:0,limited:false,contacts:0,maxEdgeRatio:1,recoveryOnly:false,triangleContacts:0,minAreaRatio:1,beforeVertexDepth:0,afterVertexDepth:0,incomingContacts:0})
        const skin=this.length*.002*scale,maximum=this.length*.20*scale
        const temporal=Number.isFinite(deltaSeconds)&&deltaSeconds>0&&deltaSeconds<=.12
        this.rootInverse.copy(this.root.matrixWorld).invert()
        this.frameBounds.length=0
        for(const c of capsules){
            const a=c.start.clone().applyMatrix4(this.rootInverse),b=c.end.clone().applyMatrix4(this.rootInverse),previous=this.previousCapsules.get(c)
            this.capsuleTravel.set(c,temporal&&previous?Math.max(a.distanceTo(previous.a),b.distanceTo(previous.b))*scale:0)
            this.previousCapsules.set(c,{a,b})
            let box=this.capsuleBounds.get(c)
            if(!box){box={capsule:c,minX:0,minY:0,minZ:0,maxX:0,maxY:0,maxZ:0};this.capsuleBounds.set(c,box)}
            const r=c.worldRadius+skin
            box.minX=Math.min(c.start.x,c.end.x)-r;box.maxX=Math.max(c.start.x,c.end.x)+r
            box.minY=Math.min(c.start.y,c.end.y)-r;box.maxY=Math.max(c.start.y,c.end.y)+r
            box.minZ=Math.min(c.start.z,c.end.z)-r;box.maxZ=Math.max(c.start.z,c.end.z)+r
            this.frameBounds.push(box)
        }
        const decay=temporal?Math.exp(-Math.LN2*deltaSeconds/this.halfLife):0
        let recovering=false,unchanged=temporal&&this.frame>1&&Math.abs(scale-this.previousScale)<1e-12
        this.previousScale=scale
        for(const c of capsules)if((this.capsuleTravel.get(c)??0)>this.length*1e-9*scale)unchanged=false
        for(const vertex of this.vertices) {
            const validSkin=this.skin(vertex.skin)
            if(validSkin){
                const index=vertex.indices[0],offset=index*3,base=vertex.state.base
                let x=base[offset],y=base[offset+1],z=base[offset+2]
                for(const morph of vertex.morphIndices){
                    const influence=vertex.mesh.morphTargetInfluences?.[morph]??0;if(influence===0)continue
                    const attribute=vertex.mesh.geometry.morphAttributes.position![morph],relative=vertex.mesh.geometry.morphTargetsRelative
                    x+=(attribute.getX(index)-(relative?0:base[offset]))*influence
                    y+=(attribute.getY(index)-(relative?0:base[offset+1]))*influence
                    z+=(attribute.getZ(index)-(relative?0:base[offset+2]))*influence
                }
                vertex.native.set(x,y,z).applyMatrix4(vertex.skin.world)
            }else vertex.mesh.getVertexPosition(vertex.indices[0],vertex.native).applyMatrix4(vertex.mesh.matrixWorld)
            vertex.previous.copy(vertex.native)
            this.localPoint.copy(vertex.native).applyMatrix4(this.rootInverse)
            vertex.nativeTravel=temporal&&vertex.previousNative?vertex.previousNative.distanceTo(this.localPoint)*scale:0
            if(!vertex.previousNative||vertex.nativeTravel>this.length*1e-9*scale)unchanged=false
            vertex.previousNative??=new Vector3();vertex.previousNative.copy(this.localPoint)
            vertex.point.copy(vertex.native)
            vertex.morphBaseInfluence=this.meshFrames.get(vertex.mesh)?.baseInfluence??1
            const writableMorph=Math.abs(vertex.morphBaseInfluence)>=.1
            const movable=!!vertex.node&&!blocked(vertex.node)&&validSkin&&writableMorph
            if(movable!==vertex.movable)unchanged=false
            vertex.movable=movable
            if(vertex.node&&!writableMorph)this.stats.limited=true
            vertex.normal.copy(vertex.preferred).applyQuaternion(hip).normalize()
            if(!vertex.movable){vertex.history.set(0,0,0);vertex.contactDirection=undefined;continue}
            let nearby=this.candidateCapsules.get(vertex)
            if(!nearby){nearby=[];this.candidateCapsules.set(vertex,nearby)}nearby.length=0
            for(const box of this.frameBounds){const p=vertex.native
                if(p.x>=box.minX-maximum&&p.x<=box.maxX+maximum&&p.y>=box.minY-maximum&&p.y<=box.maxY+maximum&&p.z>=box.minZ-maximum&&p.z<=box.maxZ+maximum)nearby.push(box.capsule)
            }
            let nativeDepth=-Infinity
            for(const c of nearby)nativeDepth=Math.max(nativeDepth,c.worldRadius-capsuleDistance(vertex.native,c))
            this.stats.beforeVertexDepth=Math.max(this.stats.beforeVertexDepth,nativeDepth)
            if(nativeDepth>0)this.stats.incomingContacts++
            if(nativeDepth< -this.length*.02*scale)vertex.contactDirection=undefined
            if(temporal&&vertex.history.lengthSq()>1e-14) {
                this.delta.copy(vertex.history).applyMatrix3(vertex.skin.forward)
                if(this.delta.length()>maximum)this.delta.setLength(maximum)
                vertex.previous.add(this.delta);vertex.point.addScaledVector(this.delta,nativeDepth> -skin?1:decay);recovering=true
            }
        }
        for(const edge of this.edges){edge.length=this.vertices[edge.a].native.distanceTo(this.vertices[edge.b].native);edge.constraintLength=Math.max(edge.length,edge.materialLength*scale)}
        for(const face of this.faces){
            const a=this.vertices[face.a],b=this.vertices[face.b],c=this.vertices[face.c]
            face.normal.subVectors(b.native,a.native).cross(this.delta.subVectors(c.native,a.native));face.area=face.normal.length();if(face.area>1e-12)face.normal.multiplyScalar(1/face.area)
        }
        this.refreshTriangleCandidates()
        // A kinematic contact has no stored velocity: identical body/cloth input
        // must reproduce the same display, not keep iterating into a limit cycle.
        const resting=unchanged&&this.inputContact
        if(resting)for(const vertex of this.vertices)if(vertex.movable)vertex.point.copy(vertex.previous)
        const vertexContacts=resting?1:this.projectContacts(capsules,skin,maximum)
        this.stats.triangleContacts=resting?0:this.projectTriangleContacts(capsules,skin,maximum)
        const initial=vertexContacts+this.stats.triangleContacts;this.inputContact=initial>0;this.stats.contacts=initial;this.stats.recoveryOnly=recovering&&initial===0
        if(!resting&&(initial||recovering)) {
            // Alternate current-body constraints with real cloth topology. This
            // spreads a contact into a fold instead of stretching one triangle.
            // Bounded work per displayed frame; do not run 18 global contact
            // sweeps against immovable hoop/waist boundaries every RAF. The
            // geometry validity projection below is still mandatory.
            for(let pass=0;pass<2;pass++) {
                const correction=this.relaxEdges(scale)
                this.relaxTriangleAreas()
                this.stats.contacts+=this.projectContacts(capsules,skin,maximum)
                // Interior crossings are projected once before local relaxation;
                // repeated dense triangle projection was the expensive V3 loop.
                if(correction<skin*.1&&this.lastProjection<skin*.2)break
            }
            for(let pass=0;pass<2;pass++){this.relaxTriangleAreas();if(this.relaxEdges(scale)<skin*.02)break}
            this.enforceStrain(maximum)
            this.rejectWorsenedComponents(capsules,skin)
        }
        if(!resting&&temporal&&recovering){this.limitContactStep(scale);this.enforceStrain(maximum)}
        for(const vertex of this.vertices) {
            if(!vertex.movable)continue
            this.delta.subVectors(vertex.point,vertex.native)
            const distance=this.delta.length()
            for(const c of this.candidateCapsules.get(vertex)??[])this.stats.afterVertexDepth=Math.max(this.stats.afterVertexDepth,c.worldRadius-capsuleDistance(vertex.point,c))
            if(distance<=this.length*1e-7){vertex.history.set(0,0,0);continue}
            if(vertex.skin.inverseFrame!==this.frame){vertex.skin.inverse.copy(vertex.skin.forward).invert();vertex.skin.inverseFrame=this.frame}
            this.delta.applyMatrix3(vertex.skin.inverse)
            if(!this.delta.toArray().every(Number.isFinite)){vertex.history.set(0,0,0);this.stats.limited=true;continue}
            if(temporal)vertex.history.copy(this.delta);else vertex.history.set(0,0,0)
            // Absolute morph targets replace part of the base position. Keep
            // their authored data/weights immutable and invert only the base
            // contribution. Fully replacing morphs remain explicitly limited.
            this.delta.multiplyScalar(1/vertex.morphBaseInfluence)
            const state=vertex.state,array=state.position.array
            for(const index of vertex.indices){const o=index*3;array[o]=state.base[o]+this.delta.x;array[o+1]=state.base[o+1]+this.delta.y;array[o+2]=state.base[o+2]+this.delta.z;state.changed.add(index)}
            this.stats.correctedVertices+=vertex.indices.length;this.stats.maxDisplacement=Math.max(this.stats.maxDisplacement,distance)
        }
        for(const edge of this.edges)if(edge.length>1e-7)this.stats.maxEdgeRatio=Math.max(this.stats.maxEdgeRatio,this.vertices[edge.a].point.distanceTo(this.vertices[edge.b].point)/edge.constraintLength)
        this.stats.remainingDepth=this.stats.afterVertexDepth
        this.refreshTriangleCandidates()
        this.projectTriangleContacts(capsules,0,maximum,true)
        for(const face of this.faces)if(face.area>1e-10){const a=this.vertices[face.a].point,b=this.vertices[face.b].point,c=this.vertices[face.c].point;this.stats.minAreaRatio=Math.min(this.stats.minAreaRatio,this.delta.subVectors(b,a).cross(this.average.subVectors(c,a)).dot(face.normal)/face.area)}
        this.stats.limited ||= this.stats.remainingDepth>this.length*.002*scale
        for(const state of this.geometries)if(state.changed.size)state.position.needsUpdate=true
        return this.diagnostics
    }
    dispose(){this.restore();for(const view of this.views){if(view.mesh.geometry===view.geometry)view.mesh.geometry=view.original;view.geometry.dispose()}this.views.length=0;for(const state of this.geometries){for(const mesh of state.users)if(mesh.geometry===state.geometry)mesh.geometry=state.original;state.geometry.dispose()}this.geometries.length=0;this.vertices.length=0;this.edges.length=0}
}
