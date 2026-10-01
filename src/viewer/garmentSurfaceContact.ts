import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three'

export interface SurfaceVertex {mesh:SkinnedMesh;index:number;node:Object3D;preferred:Vector3}
export interface SurfaceCapsule {arm?:boolean;start:Vector3;end:Vector3;worldRadius:number}
export interface GarmentSurfaceStats {vertices:number;correctedVertices:number;maxDisplacement:number;remainingDepth:number;limited:boolean}
interface SkinGroup {mesh:SkinnedMesh;indices:number[];weights:number[];inverse:Matrix3;frame:number}
interface VertexGroup {mesh:SkinnedMesh;indices:number[];node:Object3D;preferred:Vector3;skin:SkinGroup;position:BufferAttribute;original:Float32Array}
interface GeometryState {original:BufferGeometry;geometry:BufferGeometry;position:BufferAttribute;base:Float32Array;changed:Set<number>;users:Mesh[]}


/** Positive exit of a ray from the union of a finite cylinder and its two
 * end spheres. Using one direction for overlapping contacts cannot alternate
 * endlessly between a thigh and a hand. */
function capsuleExit(px:number,py:number,pz:number,nx:number,ny:number,nz:number,c:SurfaceCapsule,r:number){
    const ax=c.end.x-c.start.x,ay=c.end.y-c.start.y,az=c.end.z-c.start.z,length=Math.hypot(ax,ay,az)
    let exit=0
    for(const center of [c.start,c.end]){const mx=px-center.x,my=py-center.y,mz=pz-center.z,dot=mx*nx+my*ny+mz*nz,disc=dot*dot+r*r-mx*mx-my*my-mz*mz;if(disc>=0)exit=Math.max(exit,-dot+Math.sqrt(disc))}
    if(length>1e-9){
        const ex=ax/length,ey=ay/length,ez=az/length,mx=px-c.start.x,my=py-c.start.y,mz=pz-c.start.z,along=mx*ex+my*ey+mz*ez,direction=nx*ex+ny*ey+nz*ez
        const qx=mx-along*ex,qy=my-along*ey,qz=mz-along*ez,dx=nx-direction*ex,dy=ny-direction*ey,dz=nz-direction*ez,a=dx*dx+dy*dy+dz*dz,b=qx*dx+qy*dy+qz*dz,cc=qx*qx+qy*qy+qz*qz-r*r,disc=b*b-a*cc
        if(a>1e-12&&disc>=0){const t=(-b+Math.sqrt(disc))/a,h=along+t*direction;if(h>=0&&h<=length)exit=Math.max(exit,t)}
    }
    return exit
}

function exitUnion(origin:Vector3,direction:Vector3,capsules:readonly SurfaceCapsule[],skin:number,epsilon:number,out:Vector3){
    out.copy(origin);let hits=0
    for(let pass=0;pass<3;pass++){let hit=false
        for(const c of capsules){const dx=c.end.x-c.start.x,dy=c.end.y-c.start.y,dz=c.end.z-c.start.z,t=Math.max(0,Math.min(1,((out.x-c.start.x)*dx+(out.y-c.start.y)*dy+(out.z-c.start.z)*dz)/Math.max(dx*dx+dy*dy+dz*dz,1e-12))),radius=c.worldRadius+skin
            if(Math.hypot(out.x-c.start.x-t*dx,out.y-c.start.y-t*dy,out.z-c.start.z-t*dz)>=radius)continue
            const amount=capsuleExit(out.x,out.y,out.z,direction.x,direction.y,direction.z,c,radius)+epsilon
            out.addScaledVector(direction,amount);hits++;hit=true
        }
        if(!hit)break
    }
    return hits
}

/** Local, cloth-only surface projection fills gaps that cannot be removed by
 * rotating a small number of native garment joints. No body vertex, bone, UV,
 * skin weight or normal is changed. Render, shadow and outline share the same
 * actor-local geometry, so this is not a color-pass-only concealment effect. */
export class GarmentSurfaceContact {
    private readonly geometries:GeometryState[]=[]
    private readonly vertices:VertexGroup[]=[]
    private frame=0
    private readonly world=new Vector3()
    private readonly originalWorld=new Vector3()
    private readonly localDelta=new Vector3()
    private readonly preferred=new Vector3()
    private readonly trial=new Vector3()
    private readonly direction=new Vector3()
    private readonly lateral=new Vector3()
    private readonly up=new Vector3()
    private readonly boneMatrix=new Matrix4()
    private readonly blended=new Matrix4()
    private readonly worldSkin=new Matrix4()
    private readonly stats:GarmentSurfaceStats={vertices:0,correctedVertices:0,maxDisplacement:0,remainingDepth:0,limited:false}
    private readonly length:number
    constructor(root:Object3D,source:SurfaceVertex[],length:number){
        this.length=length
        const byGeometry=new Map<BufferGeometry,GeometryState>(),groups=new Map<string,VertexGroup>(),skins=new Map<string,SkinGroup>()
        for(const item of source){
            const mesh=item.mesh,old=mesh.geometry,position=old.getAttribute('position') as BufferAttribute
            if(!position||position.itemSize!==3||!(position.array instanceof Float32Array))continue
            let state=byGeometry.get(old)
            if(!state){const geometry=old.clone(),p=geometry.getAttribute('position') as BufferAttribute;state={original:old,geometry,position:p,base:new Float32Array(position.array),changed:new Set(),users:[]};byGeometry.set(old,state);this.geometries.push(state)}
            const indices=[],weights=[],skinIndex=old.getAttribute('skinIndex'),skinWeight=old.getAttribute('skinWeight')
            for(let k=0;k<4;k++){indices.push(skinIndex.getComponent(item.index,k));weights.push(skinWeight.getComponent(item.index,k))}
            const skinKey=mesh.uuid+':'+indices.join(',')+':'+weights.join(',')
            let skin=skins.get(skinKey);if(!skin){skin={mesh,indices,weights,inverse:new Matrix3(),frame:-1};skins.set(skinKey,skin)}
            const offset=item.index*3,key=skinKey+':'+state.base.slice(offset,offset+3).join(',')
            let vertex=groups.get(key)
            if(!vertex){vertex={mesh,indices:[],node:item.node,preferred:item.preferred,skin,position:state.position,original:state.base};groups.set(key,vertex);this.vertices.push(vertex)}
            vertex.indices.push(item.index)
        }
        // Clone only within this actor. Never mutate a cache shared by another
        // instance. Helpers for the same draw retain identical cloth positions.
        root.traverse(node=>{const mesh=node as Mesh;if(!mesh.isMesh)return;const state=byGeometry.get(mesh.geometry);if(state){state.users.push(mesh);mesh.geometry=state.geometry}})
        for(const state of this.geometries){state.geometry.boundingBox?.expandByScalar(length*.24);if(state.geometry.boundingSphere)state.geometry.boundingSphere.radius+=length*.24}
        this.stats.vertices=this.vertices.length
    }
    get diagnostics(){return {...this.stats}}
    restore(){
        for(const state of this.geometries){if(!state.changed.size)continue;const a=state.position.array
            for(const index of state.changed){const o=index*3;a[o]=state.base[o];a[o+1]=state.base[o+1];a[o+2]=state.base[o+2]}
            state.changed.clear();state.position.needsUpdate=true
        }
    }
    private inverseSkin(group:SkinGroup):Matrix3|undefined{
        if(group.frame===this.frame)return group.inverse
        const mesh=group.mesh,e=this.blended.elements;e.fill(0)
        for(let k=0;k<4;k++){const weight=group.weights[k],index=group.indices[k];if(!weight)continue;const bone=mesh.skeleton.bones[index];if(!bone)return
            this.boneMatrix.multiplyMatrices(bone.matrixWorld,mesh.skeleton.boneInverses[index]);const b=this.boneMatrix.elements;for(let j=0;j<16;j++)e[j]+=b[j]*weight
        }
        this.worldSkin.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(this.blended).multiply(mesh.bindMatrix)
        if(Math.abs(this.worldSkin.determinant())<1e-12)return
        group.inverse.setFromMatrix4(this.worldSkin.invert());group.frame=this.frame;return group.inverse
    }
    project(capsules:readonly SurfaceCapsule[],hip:Quaternion,blocked:(node:Object3D)=>boolean,scale=1){
        this.restore();this.frame++
        Object.assign(this.stats,{correctedVertices:0,maxDisplacement:0,remainingDepth:0,limited:false})
        const skin=this.length*.003*scale,maximum=this.length*.24*scale
        for(const vertex of this.vertices){
            if(blocked(vertex.node))continue
            vertex.mesh.getVertexPosition(vertex.indices[0],this.world).applyMatrix4(vertex.mesh.matrixWorld);this.originalWorld.copy(this.world)
            this.preferred.copy(vertex.preferred).applyQuaternion(hip).normalize()
            let changed=false,nx=this.preferred.x,ny=this.preferred.y,nz=this.preferred.z,insideLeg=false,deepest=0
            // Legs preserve the garment's native outside. For an arm-only
            // contact choose its local separation direction without moving it.
            for(const c of capsules){const dx=c.end.x-c.start.x,dy=c.end.y-c.start.y,dz=c.end.z-c.start.z,t=Math.max(0,Math.min(1,((this.world.x-c.start.x)*dx+(this.world.y-c.start.y)*dy+(this.world.z-c.start.z)*dz)/Math.max(dx*dx+dy*dy+dz*dz,1e-12))),rx=this.world.x-c.start.x-t*dx,ry=this.world.y-c.start.y-t*dy,rz=this.world.z-c.start.z-t*dz,d=Math.hypot(rx,ry,rz),depth=c.worldRadius+skin-d
                if(depth>0&&!c.arm)insideLeg=true
                if(c.arm&&depth>deepest&&d>1e-8){deepest=depth;nx=rx/d;ny=ry/d;nz=rz/d}
            }
            if(insideLeg){nx=this.preferred.x;ny=this.preferred.y;nz=this.preferred.z}
            this.direction.set(nx,ny,nz).normalize()
            const hits=exitUnion(this.originalWorld,this.direction,capsules,skin,this.length*.00001,this.world);changed=hits>0
            if(changed&&this.world.distanceTo(this.originalWorld)>this.length*.045*scale){
                let best=this.world.distanceToSquared(this.originalWorld)
                const penalty=this.length*this.length*scale*scale*.002
                this.lateral.set(vertex.preferred.x>=0?1:-1,0,0).applyQuaternion(hip)
                this.up.set(0,1,0).applyQuaternion(hip)
                // When a hand overlaps a thigh, forward-only projection can
                // unnecessarily drag cloth through the entire union. A stable
                // native outboard/upward branch permits a local fold instead.
                for(const axis of [this.lateral,this.up])for(const amount of [.5,1,2]){
                    this.direction.copy(this.preferred).addScaledVector(axis,amount).normalize()
                    exitUnion(this.originalWorld,this.direction,capsules,skin,this.length*.00001,this.trial)
                    const distance=this.trial.distanceToSquared(this.originalWorld),cost=distance+penalty*(1-this.direction.dot(this.preferred))
                    if(cost<best){best=cost;this.world.copy(this.trial)}
                }
            }
            if(!changed)continue
            this.localDelta.subVectors(this.world,this.originalWorld);let displacement=this.localDelta.length()
            if(displacement>maximum){this.localDelta.multiplyScalar(maximum/displacement);this.world.copy(this.originalWorld).add(this.localDelta);displacement=maximum;this.stats.limited=true}
            for(const c of capsules){const dx=c.end.x-c.start.x,dy=c.end.y-c.start.y,dz=c.end.z-c.start.z,t=Math.max(0,Math.min(1,((this.world.x-c.start.x)*dx+(this.world.y-c.start.y)*dy+(this.world.z-c.start.z)*dz)/Math.max(dx*dx+dy*dy+dz*dz,1e-12))),depth=c.worldRadius-Math.hypot(this.world.x-c.start.x-t*dx,this.world.y-c.start.y-t*dy,this.world.z-c.start.z-t*dz);this.stats.remainingDepth=Math.max(this.stats.remainingDepth,depth)}
            const inverse=this.inverseSkin(vertex.skin);if(!inverse)continue
            this.localDelta.applyMatrix3(inverse);if(!this.localDelta.toArray().every(Number.isFinite))continue
            const state=this.geometries.find(g=>g.position===vertex.position)!;const a=vertex.position.array
            for(const index of vertex.indices){const o=index*3;a[o]=vertex.original[o]+this.localDelta.x;a[o+1]=vertex.original[o+1]+this.localDelta.y;a[o+2]=vertex.original[o+2]+this.localDelta.z;state.changed.add(index)}
            this.stats.correctedVertices+=vertex.indices.length;this.stats.maxDisplacement=Math.max(this.stats.maxDisplacement,displacement)
        }
        for(const state of this.geometries)if(state.changed.size)state.position.needsUpdate=true
        return this.diagnostics
    }
    dispose(){this.restore();for(const state of this.geometries){for(const mesh of state.users)if(mesh.geometry===state.geometry)mesh.geometry=state.original;state.geometry.dispose()}this.geometries.length=0;this.vertices.length=0}
}
