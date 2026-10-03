import { BackSide, FrontSide, BufferAttribute, BufferGeometry, Material, Matrix3, Matrix4, Mesh, Object3D, Quaternion, SkinnedMesh, Vector3, Ray, Triangle } from 'three'

export interface SurfaceVertex {mesh:SkinnedMesh;index:number;node:Object3D;preferred:Vector3;contact?:boolean}
export interface SurfaceCapsule {arm?:boolean;start:Vector3;end:Vector3;worldRadius:number}
export interface GarmentSurfaceStats {vertices:number;correctedVertices:number;maxDisplacement:number;remainingDepth:number;limited:boolean}
interface SkinGroup {mesh:SkinnedMesh;indices:number[];weights:number[];inverse:Matrix3;normalWorld?:Matrix3;normalInverse?:Matrix3;frame:number}
interface VertexGroup {mesh:SkinnedMesh;indices:number[];node:Object3D;preferred:Vector3;skin:SkinGroup;position:BufferAttribute;original:Float32Array;point?:ClothPoint;contact:boolean;history?:Vector3}
interface GeometryState {original:BufferGeometry;geometry:BufferGeometry;position:BufferAttribute;base:Float32Array;changed:Set<number>;users:Mesh[];normals?:Array<{attribute:BufferAttribute;base:Float32Array}>;normalChanged?:Set<number>}
interface ClothPoint {mesh:SkinnedMesh;index:number;vertex?:VertexGroup;base:Vector3;current:Vector3;weight:number;planes:Map<SurfaceCapsule,{normal:Vector3;offset:number}>;checked?:Vector3;nativeNormal?:Vector3;deformedNormal?:Vector3;solved?:Vector3;filtered?:boolean}
interface ClothEdge {a:ClothPoint;b:ClothPoint;length:number}
interface ClothFace {a:ClothPoint;b:ClothPoint;c:ClothPoint;normal:Vector3;area:number}


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
 * skin weight is changed. Cloth shading and baked outline directions follow
 * only the local sheet deformation. Render, shadow and outline share the same
 * actor-local geometry, so this is not a color-pass-only concealment effect. */
export class GarmentSurfaceContact {
    private readonly geometries:GeometryState[]=[]
    private readonly vertices:VertexGroup[]=[]
    private readonly views:Array<{mesh:Mesh;original:BufferGeometry;geometry:BufferGeometry}>=[]
    private readonly points:ClothPoint[]=[]
    private readonly edges:ClothEdge[]=[]
    private readonly faces:ClothFace[]=[]
    private readonly linings:Array<{source:SkinnedMesh;mesh:SkinnedMesh;slot:number;material?:Material;version:number}>=[]
    private readonly nativeLiningFaces=new Map<SkinnedMesh,Set<number>>()
    private readonly outlineGuards:Array<{material:Material;compile:Material['onBeforeCompile'];key:Material['customProgramCacheKey']}>=[]
    private readonly foldGuardEnabled={value:0}
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
    constructor(root:Object3D,source:SurfaceVertex[],length:number,preferredToBind=new Quaternion()){
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
            if(!vertex){vertex={mesh,indices:[],node:item.node,preferred:item.preferred,skin,position:state.position,original:state.base,contact:item.contact!==false};groups.set(key,vertex);this.vertices.push(vertex)}
            vertex.indices.push(item.index)
        }
        // Clone only within this actor. Never mutate a cache shared by another
        // instance. Helpers for the same draw retain identical cloth positions.
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
            for(const [name,attribute]of Object.entries(old.attributes))geometry.setAttribute(name,['position','normal','reDriveBakedNormal'].includes(name)&&attribute===state.original.getAttribute(name)?state.geometry.getAttribute(name):attribute)
            geometry.morphAttributes=old.morphAttributes;geometry.morphTargetsRelative=old.morphTargetsRelative
            geometry.setDrawRange(old.drawRange.start,old.drawRange.count)
            for(const group of old.groups)geometry.addGroup(group.start,group.count,group.materialIndex)
            geometry.boundingBox=state.geometry.boundingBox;geometry.boundingSphere=state.geometry.boundingSphere
            this.views.push({mesh,original:old,geometry});mesh.geometry=geometry
        })
        const byMesh=new Map<SkinnedMesh,Map<number,ClothPoint>>()
        for(const vertex of this.vertices){let indices=byMesh.get(vertex.mesh);if(!indices)byMesh.set(vertex.mesh,indices=new Map());const p:ClothPoint={mesh:vertex.mesh,index:vertex.indices[0],vertex,base:new Vector3(),current:new Vector3(),weight:1,planes:new Map()};this.points.push(p);vertex.point=p;for(const i of vertex.indices)indices.set(i,p)}
        for(const [mesh,indices] of byMesh){
            const geometry=mesh.geometry,index=geometry.index,count=index?.count??geometry.getAttribute('position').count,unique=new Set<string>(),ids=new Map<ClothPoint,number>()
            const point=(i:number)=>{let p=indices.get(i);if(!p){p={mesh,index:i,base:new Vector3(),current:new Vector3(),weight:0,planes:new Map()};indices.set(i,p);this.points.push(p)}return p}
            for(let i=0;i+2<count;i+=3){const v=[0,1,2].map(k=>index?index.getX(i+k):i+k);if(!v.some(j=>indices.get(j)?.vertex))continue;const ps=v.map(point);for(const p of ps)if(!ids.has(p))ids.set(p,ids.size)
                this.faces.push({a:ps[0],b:ps[1],c:ps[2],normal:new Vector3(),area:0})
                for(let k=0;k<3;k++){const a=ps[k],b=ps[(k+1)%3];if(a===b)continue;const ia=ids.get(a)!,ib=ids.get(b)!,key=Math.min(ia,ib)+':'+Math.max(ia,ib);if(unique.has(key))continue;unique.add(key);this.edges.push({a,b,length:0})}
            }
        }
        for(const state of this.geometries){state.normals=['normal','reDriveBakedNormal'].flatMap(name=>{const attribute=state.geometry.getAttribute(name) as BufferAttribute;return attribute?.itemSize===3&&attribute.array instanceof Float32Array?[{attribute,base:new Float32Array(attribute.array)}]:[]});state.normalChanged=new Set()}
        for(const state of this.geometries){state.geometry.boundingBox?.expandByScalar(length*.24);if(state.geometry.boundingSphere)state.geometry.boundingSphere.radius+=length*.24}
        this.classifyNativeLiningBacks(preferredToBind)
        this.createClothBackfaces()
        this.guardClothOutlineWinding(root)
        this.stats.vertices=this.vertices.length
    }
    /** Extrusion can invert a small concave triangle on the FRONT of a fold.
     * BackSide culling then admits that triangle as a solid black polygon.
     * Test the unextruded triangle's orientation in the fragment, rather than
     * trusting the displaced hull's winding. True silhouette backfaces remain.
     * This is independent of the coloured inner-surface draw below. */
    private guardClothOutlineWinding(root:Object3D){
        for(const state of this.geometries){
            const mask=new Float32Array(state.position.count)
            for(const v of this.vertices)if(v.position===state.position)for(const i of v.indices)mask[i]=1
            const attribute=new BufferAttribute(mask,1);state.geometry.setAttribute('garmentClothMask',attribute)
            const lining=state.geometry.getAttribute('garmentNativeLiningMask')??new BufferAttribute(new Float32Array(mask.length),1);state.geometry.setAttribute('garmentNativeLiningMask',lining)
            for(const view of this.views)if(view.geometry.getAttribute('position')===state.position){view.geometry.setAttribute('garmentClothMask',attribute);view.geometry.setAttribute('garmentNativeLiningMask',lining)}
        }
        const guarded=new Set<Material>()
        root.traverse(node=>{
            const mesh=node as Mesh;if(!mesh.isMesh||!mesh.geometry.getAttribute('garmentClothMask'))return
            for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
                const shader=material as Material&{vertexShader?:string};if(!shader.vertexShader?.includes('vec3 outlineNormalVS =')||guarded.has(material))continue
                guarded.add(material);const compile=material.onBeforeCompile,key=material.customProgramCacheKey,enabled=this.foldGuardEnabled
                this.outlineGuards.push({material,compile,key})
                material.onBeforeCompile=function(program,renderer){
                    compile.call(this,program,renderer)
                    program.uniforms.uGarmentFoldGuardEnabled=enabled
                    program.vertexShader='attribute float garmentNativeLiningMask;\nvarying float vGarmentNativeLiningMask;\nattribute float garmentClothMask;\nvarying float vGarmentClothMask;\nvarying vec3 vGarmentOriginalVS;\n'+program.vertexShader
                    program.vertexShader=program.vertexShader.replace('vec3 outlineNormalVS =','vGarmentNativeLiningMask = garmentNativeLiningMask;\nvGarmentClothMask = garmentClothMask;\nvGarmentOriginalVS = mvPosition.xyz;\nvec3 outlineNormalVS =')
                    program.fragmentShader='varying float vGarmentNativeLiningMask;\nuniform float uOrthographic;\nuniform float uGarmentFoldGuardEnabled;\nvarying float vGarmentClothMask;\nvarying vec3 vGarmentOriginalVS;\n'+program.fragmentShader
                    program.fragmentShader=program.fragmentShader.replace('void main() {',`void main() {
                        // GARMENT_NATIVE_LINING_BACK_GUARD: never render a hidden lining outward.
                        if (uGarmentFoldGuardEnabled > 0.5 && vGarmentNativeLiningMask > 0.999) discard;
                        // GARMENT_ORIGINAL_FRONT_GUARD: derivatives measure the
                        // source face against the rasterised (extruded) face.
                        vec3 originalCross = cross(dFdx(vGarmentOriginalVS), dFdy(vGarmentOriginalVS));
                        vec3 originalView = mix(-vGarmentOriginalVS, vec3(0.0, 0.0, 1.0), uOrthographic);
                        if (uGarmentFoldGuardEnabled > 0.5 && vGarmentClothMask > 0.001 && dot(originalCross, originalView) <= 0.0) discard;
                    `)
                }
                material.customProgramCacheKey=function(){return key.call(this)+':garment-original-front-guard-v5-native-lining'}
                material.needsUpdate=true
            }
        })
    }
    /** A folded, single-sided cloth triangle must still have a coloured inner
     * surface. Otherwise the inverse-hull outline is the only visible draw and
     * fills the exposed inner face black. Add ONLY the existing cloth faces,
     * at exactly their original depth, using their own UVs and slot shader.
     * Do not change culling for the body, gems or the original colour pass. */
    /** A native inward-facing lining already has its own colour pass. Giving
     * it another BackSide draw (or an outward inverse hull) exposes its hidden
     * texture through the exterior. Classify only a directly matched inner
     * face: opposing outer sheet, small authored thickness and compatible skin.
     * No connected-component extrapolation, character IDs or per-frame search. */
    private classifyNativeLiningBacks(preferredToBind:Quaternion){
        const meshes=new Set(this.vertices.map(v=>v.mesh)),gap=this.length*.016,cell=this.length*.08
        for(const mesh of meshes){
            const g=mesh.geometry,pos=g.getAttribute('position'),index=g.index,si=g.getAttribute('skinIndex'),sw=g.getAttribute('skinWeight'),count=index?.count??pos.count
            const guides=new Map<number,Vector3>();for(const v of this.vertices)if(v.mesh===mesh)for(const i of v.indices)guides.set(i,v.preferred.clone().applyQuaternion(preferredToBind))
            const triangles:Array<{start:number;ids:number[];tri:Triangle;normal:Vector3;outward:number;weights:Map<number,number>}>=[],grid=new Map<string,number[]>(),key=(x:number,y:number,z:number)=>x+','+y+','+z
            for(let i=0;i+2<count;i+=3){
                const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);if(!ids.some(j=>guides.has(j)))continue
                const ps=ids.map(j=>new Vector3().fromBufferAttribute(pos,j).applyMatrix4(mesh.bindMatrix)),tri=new Triangle(...ps as [Vector3,Vector3,Vector3]),normal=tri.getNormal(new Vector3()),guide=new Vector3(),weights=new Map<number,number>()
                for(const j of ids){if(guides.has(j))guide.add(guides.get(j)!);for(let k=0;k<4;k++){const bone=si.getComponent(j,k);weights.set(bone,(weights.get(bone)??0)+sw.getComponent(j,k)/3)}}
                const face=triangles.length;triangles.push({start:i,ids,tri,normal,outward:normal.dot(guide.normalize()),weights})
                const lo=new Vector3(Math.min(...ps.map(p=>p.x))-gap,Math.min(...ps.map(p=>p.y))-gap,Math.min(...ps.map(p=>p.z))-gap).divideScalar(cell).floor(),hi=new Vector3(Math.max(...ps.map(p=>p.x))+gap,Math.max(...ps.map(p=>p.y))+gap,Math.max(...ps.map(p=>p.z))+gap).divideScalar(cell).floor()
                for(let x=lo.x;x<=hi.x;x++)for(let y=lo.y;y<=hi.y;y++)for(let z=lo.z;z<=hi.z;z++){const k=key(x,y,z);let list=grid.get(k);if(!list)grid.set(k,list=[]);list.push(face)}
            }
            const lined=new Set<number>(),point=new Vector3(),hit=new Vector3(),bary=new Vector3(),ray=new Ray(),probe=new Vector3()
            for(const f of triangles){
                if(f.outward>=-.15)continue;f.tri.getMidpoint(point);probe.copy(point).divideScalar(cell).floor()
                for(const j of grid.get(key(probe.x,probe.y,probe.z))??[]){
                    const other=triangles[j];if(other.outward<=.15||f.normal.dot(other.normal)>-.8)continue
                    ray.origin.copy(point).addScaledVector(f.normal,gap);ray.direction.copy(f.normal).negate()
                    if(!ray.intersectTriangle(other.tri.a,other.tri.b,other.tri.c,false,hit)||hit.distanceTo(point)>gap)continue
                    other.tri.getBarycoord(hit,bary);const weights=new Map<number,number>()
                    other.ids.forEach((v,k)=>{for(let c=0;c<4;c++){const bone=si.getComponent(v,c);weights.set(bone,(weights.get(bone)??0)+sw.getComponent(v,c)*bary.getComponent(k))}})
                    let difference=0;for(const bone of new Set([...weights.keys(),...f.weights.keys()]))difference+=Math.abs((weights.get(bone)??0)-(f.weights.get(bone)??0))
                    if(difference<.25){lined.add(f.start);break}
                }
            }
            this.nativeLiningFaces.set(mesh,lined)
            // Do not mask a shared indexed vertex belonging to an exterior face.
            const inner=new Set<number>(),other=new Set<number>()
            for(const f of triangles)for(const i of f.ids)(lined.has(f.start)?inner:other).add(i)
            const mask=new Float32Array(pos.count);for(const i of inner)if(!other.has(i))mask[i]=1
            g.setAttribute('garmentNativeLiningMask',new BufferAttribute(mask,1))
        }
    }
    private createClothBackfaces(){
        const vertices=new Map<SkinnedMesh,Set<number>>()
        for(const v of this.vertices){let set=vertices.get(v.mesh);if(!set)vertices.set(v.mesh,set=new Set());for(const i of v.indices)set.add(i)}
        for(const [source,cloth]of vertices){
            const g=source.geometry,index=g.index,position=g.getAttribute('position'),count=index?.count??position.count
            const skinIndex=g.getAttribute('skinIndex'),skinWeight=g.getAttribute('skinWeight')
            // A separately authored lining already supplies the opposite face.
            // Match positions AND skin bindings, not coincident points belonging
            // to different moving panels, and leave that native lining alone.
            const keys=Array.from({length:position.count},(_,i)=>[position.getX(i),position.getY(i),position.getZ(i),...[0,1,2,3].flatMap(k=>[skinIndex.getComponent(i,k),skinWeight.getComponent(i,k)])].join(','))
            const cyclic=(a:string,b:string,c:string)=>[a+';'+b+';'+c,b+';'+c+';'+a,c+';'+a+';'+b].sort()[0]
            const faces=new Set<string>()
            const ids=(i:number)=>[0,1,2].map(k=>index?index.getX(i+k):i+k)
            for(let i=0;i+2<count;i+=3){const [a,b,c]=ids(i);faces.add(cyclic(keys[a],keys[b],keys[c]))}
            const groups=Array.isArray(source.material)?g.groups:[{start:0,count,materialIndex:0}]
            const selected=new Map<number,number[]>()
            for(const group of groups){
                const start=Math.max(group.start,g.drawRange.start),end=Math.min(count,group.start+group.count,g.drawRange.start+g.drawRange.count)
                for(let i=start;i+2<end;i+=3){const [a,b,c]=ids(i);if(this.nativeLiningFaces.get(source)?.has(i)||![a,b,c].some(j=>cloth.has(j))||faces.has(cyclic(keys[a],keys[c],keys[b])))continue
                    const slot=group.materialIndex??0;let out=selected.get(slot);if(!out)selected.set(slot,out=[]);out.push(a,b,c)
                }
            }
            for(const [slot,indices]of selected){
                const geometry=new BufferGeometry();geometry.name=g.name+':cloth-inner-surface'
                for(const [name,attribute]of Object.entries(g.attributes))geometry.setAttribute(name,attribute)
                geometry.setIndex(indices);geometry.addGroup(0,indices.length,0)
                geometry.morphAttributes=g.morphAttributes;geometry.morphTargetsRelative=g.morphTargetsRelative
                geometry.boundingBox=g.boundingBox;geometry.boundingSphere=g.boundingSphere
                const inner=new SkinnedMesh(geometry,[]);inner.name=source.name+':official-cloth-inner:'+slot
                inner.bindMode=source.bindMode;inner.bind(source.skeleton,source.bindMatrix)
                inner.morphTargetInfluences=source.morphTargetInfluences;inner.morphTargetDictionary=source.morphTargetDictionary
                inner.visible=false;inner.receiveShadow=source.receiveShadow;inner.castShadow=source.castShadow
                inner.layers.mask=source.layers.mask;inner.renderOrder=source.renderOrder
                // Keep native per-slot dynamic uniforms/stencil selectors. The
                // slot number is retained even though this view has one draw.
                inner.onBeforeRender=(renderer,scene,camera,geometry,material,group)=>{
                    const sourceGroup=group?Object.assign({},group,{materialIndex:slot}):group
                    source.onBeforeRender.call(source,renderer,scene,camera,geometry,material,sourceGroup)
                    material.userData.shaderUniforms?.loadGlobalOptions?.()
                }
                // This is a render view, never a second selectable character.
                inner.raycast=()=>{}
                source.add(inner);this.linings.push({source,mesh:inner,slot,version:-1})
            }
        }
    }
    private syncClothBackfaces(){
        for(const view of this.linings){
            const source=Array.isArray(view.source.material)?view.source.material[view.slot]:view.source.material
            view.mesh.visible=!!source&&source.visible&&source.colorWrite&&source.side===FrontSide&&!source.userData.officialMaterialProfile?.gem?.enabled
            if(!view.mesh.visible)continue
            const refresh=source!==view.material||source.version!==view.version
            if(!view.material||source.type!==view.material.type){
                // Material.copy JSON-serializes userData; live shader state may
                // be cyclic. Copy the material through a metadata-free facade,
                // then retain the metadata class but NOT the compiled program.
                const material=source.clone.call(Object.assign(Object.create(source),{userData:{}}))
                for(const previous of Array.isArray(view.mesh.material)?view.mesh.material:[view.mesh.material])previous?.dispose()
                view.mesh.material=[material]
            }
            const material=(view.mesh.material as Material[])[0],oldData=material.userData
            material.copy(Object.assign(Object.create(source),{userData:{}}))
            material.userData=refresh?Object.assign(Object.create(Object.getPrototypeOf(source.userData)),source.userData,{shader:undefined,shaderUniforms:undefined}):oldData
            material.side=BackSide;material.shadowSide=BackSide
            material.onBeforeCompile=source.onBeforeCompile
            material.customProgramCacheKey=()=>source.customProgramCacheKey()+':cloth-inner-surface-v5'
            if(refresh)material.needsUpdate=true
            view.material=source;view.version=source.version
            view.mesh.morphTargetInfluences=view.source.morphTargetInfluences
            view.mesh.layers.mask=view.source.layers.mask;view.mesh.renderOrder=view.source.renderOrder
            view.mesh.castShadow=view.source.castShadow;view.mesh.receiveShadow=view.source.receiveShadow
        }
    }
    get diagnostics(){return {...this.stats}}
    restore(clearHistory=false){
        if(clearHistory)this.foldGuardEnabled.value=0
        if(clearHistory)for(const view of this.linings)view.mesh.visible=false
        if(clearHistory)for(const v of this.vertices)v.history=undefined
        for(const state of this.geometries){
            const changedNormals:Set<number>=state.normalChanged??new Set<number>()
            if(changedNormals.size){for(const n of state.normals??[]){for(const index of changedNormals){const o=index*3;n.attribute.array[o]=n.base[o];n.attribute.array[o+1]=n.base[o+1];n.attribute.array[o+2]=n.base[o+2]}n.attribute.needsUpdate=true}changedNormals.clear()}
            if(!state.changed.size)continue;const a=state.position.array
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
        // Three skins normals as directions before the mesh normal matrix.
        // This differs from inverse-transposing the blended position matrix.
        const skinDirection=new Matrix3().setFromMatrix4(new Matrix4().copy(mesh.bindMatrixInverse).multiply(this.blended).multiply(mesh.bindMatrix))
        group.normalWorld??=new Matrix3();group.normalInverse??=new Matrix3()
        group.normalWorld.getNormalMatrix(mesh.matrixWorld).multiply(skinDirection)
        group.normalInverse.copy(group.normalWorld).invert()
        group.inverse.setFromMatrix4(this.worldSkin.invert());group.frame=this.frame;return group.inverse
    }
    project(capsules:readonly SurfaceCapsule[],hip:Quaternion,blocked:(node:Object3D)=>boolean,scale=1,deltaSeconds=0,origin=new Vector3()){
        this.restore();this.frame++
        this.foldGuardEnabled.value=1
        this.syncClothBackfaces()
        Object.assign(this.stats,{correctedVertices:0,maxDisplacement:0,remainingDepth:0,limited:false})
        const skin=this.length*.003*scale,maximum=this.length*.24*scale
        const temporal=deltaSeconds>0&&deltaSeconds<.1,blend=temporal?1-Math.exp(-Math.LN2*deltaSeconds/.085):1,inverseHip=hip.clone().invert()
        for(const p of this.points){p.mesh.getVertexPosition(p.index,p.base).applyMatrix4(p.mesh.matrixWorld);p.current.copy(p.base);p.weight=p.vertex&&!blocked(p.vertex.node)?1:0;p.planes.clear();p.checked=undefined}
        for(const edge of this.edges)edge.length=edge.a.base.distanceTo(edge.b.base)
        for(const f of this.faces){f.normal.subVectors(f.b.base,f.a.base).cross(this.trial.subVectors(f.c.base,f.a.base));f.area=f.normal.length();if(f.area>1e-12)f.normal.multiplyScalar(1/f.area)}
        for(const vertex of this.vertices){
            if(blocked(vertex.node)||!vertex.contact)continue
            this.world.copy(vertex.point!.base);this.originalWorld.copy(this.world)
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
            vertex.point!.current.copy(this.world)
        }
        // Solve the sheet's metric, not independent vertex displacements. A
        // contact may recruit nearby cloth but never shrink its correction to
        // hide a strain failure. Contact half-spaces stay on one side per solve.
        const constrain=(p:ClothPoint)=>{
            if(!p.weight||!p.vertex?.contact)return
            if(p.checked?.distanceToSquared(p.current)===0)return
            for(const c of capsules){
                let plane: {normal:Vector3;offset:number}|undefined
                if(!plane){const dx=c.end.x-c.start.x,dy=c.end.y-c.start.y,dz=c.end.z-c.start.z,t=Math.max(0,Math.min(1,((p.current.x-c.start.x)*dx+(p.current.y-c.start.y)*dy+(p.current.z-c.start.z)*dz)/Math.max(dx*dx+dy*dy+dz*dz,1e-12)))
                    const x=c.start.x+t*dx,y=c.start.y+t*dy,z=c.start.z+t*dz,nx=p.current.x-x,ny=p.current.y-y,nz=p.current.z-z,d=Math.hypot(nx,ny,nz)
                    if(d>c.worldRadius+skin+this.length*.0001)continue
                    const normal=d>1e-9?new Vector3(nx/d,ny/d,nz/d):p.vertex!.preferred.clone().applyQuaternion(hip).normalize()
                    plane={normal,offset:normal.x*x+normal.y*y+normal.z*z+c.worldRadius+skin};p.planes.set(c,plane)
                }
                const depth=plane.offset-plane.normal.dot(p.current);if(depth>0)p.current.addScaledVector(plane.normal,depth)
            }
            p.checked??=new Vector3();p.checked.copy(p.current)
        }
        for(const p of this.points)constrain(p)
        for(let pass=0;pass<32;pass++){
            let violation=0
            for(let i=0;i<this.edges.length;i++){const e=this.edges[pass%2?this.edges.length-1-i:i],{a,b}=e,w=a.weight+b.weight;if(!w||e.length<1e-6)continue
                const dx=b.current.x-a.current.x,dy=b.current.y-a.current.y,dz=b.current.z-a.current.z,d=Math.hypot(dx,dy,dz),limit=Math.max(e.length*.96,Math.min(e.length*1.04,d));if(d===limit||d<1e-9)continue
                const excess=d-limit;violation=Math.max(violation,Math.abs(excess));const amount=excess/(d*w)
                a.current.x+=dx*amount*a.weight;a.current.y+=dy*amount*a.weight;a.current.z+=dz*amount*a.weight
                b.current.x-=dx*amount*b.weight;b.current.y-=dy*amount*b.weight;b.current.z-=dz*amount*b.weight
            }
            for(const f of this.faces){if(f.area<1e-12)continue
                const {a,b,c,normal:n}=f,pa=a.current,pb=b.current,pc=c.current
                const abx=pb.x-pa.x,aby=pb.y-pa.y,abz=pb.z-pa.z,acx=pc.x-pa.x,acy=pc.y-pa.y,acz=pc.z-pa.z
                const area=(aby*acz-abz*acy)*n.x+(abz*acx-abx*acz)*n.y+(abx*acy-aby*acx)*n.z,error=area-f.area*.6;if(error>=0)continue
                const ax=(pb.y-pc.y)*n.z-(pb.z-pc.z)*n.y,ay=(pb.z-pc.z)*n.x-(pb.x-pc.x)*n.z,az=(pb.x-pc.x)*n.y-(pb.y-pc.y)*n.x
                const bx=acy*n.z-acz*n.y,by=acz*n.x-acx*n.z,bz=acx*n.y-acy*n.x,cx=-ax-bx,cy=-ay-by,cz=-az-bz
                const denom=a.weight*(ax*ax+ay*ay+az*az)+b.weight*(bx*bx+by*by+bz*bz)+c.weight*(cx*cx+cy*cy+cz*cz);if(denom<1e-15)continue
                const s=-error/denom;pa.x+=s*a.weight*ax;pa.y+=s*a.weight*ay;pa.z+=s*a.weight*az;pb.x+=s*b.weight*bx;pb.y+=s*b.weight*by;pb.z+=s*b.weight*bz;pc.x+=s*c.weight*cx;pc.y+=s*c.weight*cy;pc.z+=s*c.weight*cz
            }
            for(const p of this.points)constrain(p)
            if(violation<this.length*.00005)break
        }
        // Filter only the small, high-frequency part of a completed sheet
        // solve. History follows the hip frame, not the oscillating garment
        // joint. Accept a filtered point only if it is clear of EVERY current
        // collider; otherwise retain the immediate constrained result. This is
        // not collision strength scaling or body trajectory smoothing.
        for(const p of this.points){p.solved??=new Vector3();p.solved.copy(p.current);p.filtered=false}
        for(const vertex of this.vertices){const p=vertex.point!;if(!p.weight||!temporal){vertex.history=undefined;continue}
            if(!vertex.history)continue
            this.localDelta.copy(vertex.history).multiplyScalar(scale).applyQuaternion(hip).add(origin)
            const travel=p.current.distanceTo(this.localDelta)/Math.max(this.length*scale,1e-9),motion=Math.max(0,Math.min(1,(travel-.008)/.05)),release=motion*motion*(3-2*motion)
            this.trial.copy(p.current).lerp(this.localDelta,(1-blend)*(1-release));let clear=true
            if(vertex.contact)for(const c of capsules){const dx=c.end.x-c.start.x,dy=c.end.y-c.start.y,dz=c.end.z-c.start.z,t=Math.max(0,Math.min(1,((this.trial.x-c.start.x)*dx+(this.trial.y-c.start.y)*dy+(this.trial.z-c.start.z)*dz)/Math.max(dx*dx+dy*dy+dz*dz,1e-12)));if(Math.hypot(this.trial.x-c.start.x-t*dx,this.trial.y-c.start.y-t*dy,this.trial.z-c.start.z-t*dz)<c.worldRadius+skin*.1){clear=false;break}}
            if(!clear){
                // Advance only as far as CURRENT contact requires, instead of
                // throwing away the entire filter and snapping to the raw end.
                this.direction.subVectors(p.current,this.trial);const span=this.direction.length()
                if(span>1e-9){this.direction.multiplyScalar(1/span);exitUnion(this.trial,this.direction,capsules,skin*.1,this.length*.00001,this.world);if(this.world.distanceTo(this.trial)<=span+1e-8){this.trial.copy(this.world);clear=true}}
            }
            if(clear){p.current.copy(this.trial);p.filtered=true}
        }
        // A temporal filter may not undo the shape constraints the user has
        // accepted. Reject only conflicting filtered endpoints, propagating
        // that rejection through connected faces/edges until consistent.
        const reject=(p:ClothPoint)=>{if(!p.filtered)return false;p.current.copy(p.solved!);p.filtered=false;return true}
        const signedArea=(f:ClothFace,solved:boolean)=>{const a=solved?f.a.solved!:f.a.current,b=solved?f.b.solved!:f.b.current,c=solved?f.c.solved!:f.c.current;return this.trial.subVectors(b,a).cross(this.direction.subVectors(c,a)).dot(f.normal)}
        for(let pass=0;pass<16;pass++){let rejected=false
            for(const e of this.edges){if(!e.a.filtered&&!e.b.filtered)continue;const raw=e.a.solved!.distanceTo(e.b.solved!),d=e.a.current.distanceTo(e.b.current),tolerance=e.length*.003+1e-8;if(d>Math.max(raw,e.length*1.08)+tolerance||d<Math.min(raw,e.length*.8)-tolerance){rejected=reject(e.a)||rejected;rejected=reject(e.b)||rejected}}
            for(const f of this.faces){if(!f.a.filtered&&!f.b.filtered&&!f.c.filtered)continue;if(signedArea(f,false)<Math.min(signedArea(f,true),f.area*.1)-f.area*.003){rejected=reject(f.a)||rejected;rejected=reject(f.b)||rejected;rejected=reject(f.c)||rejected}}
            if(!rejected)break;if(pass===15)for(const p of this.points)reject(p)
        }
        Object.assign(this.stats,{correctedVertices:0,maxDisplacement:0,remainingDepth:0})
        for(const vertex of this.vertices){
            const p=vertex.point!;if(!p.weight)continue
            this.localDelta.subVectors(p.current,p.base);let displacement=this.localDelta.length();if(displacement<1e-9){vertex.history=undefined;continue}
            if(displacement>maximum){this.localDelta.multiplyScalar(maximum/displacement);p.current.copy(p.base).add(this.localDelta);displacement=maximum;this.stats.limited=true}
            if(vertex.contact)for(const c of capsules){const dx=c.end.x-c.start.x,dy=c.end.y-c.start.y,dz=c.end.z-c.start.z,t=Math.max(0,Math.min(1,((p.current.x-c.start.x)*dx+(p.current.y-c.start.y)*dy+(p.current.z-c.start.z)*dz)/Math.max(dx*dx+dy*dy+dz*dz,1e-12))),depth=c.worldRadius-Math.hypot(p.current.x-c.start.x-t*dx,p.current.y-c.start.y-t*dy,p.current.z-c.start.z-t*dz);this.stats.remainingDepth=Math.max(this.stats.remainingDepth,depth)}
            const inverse=this.inverseSkin(vertex.skin);if(!inverse)continue
            this.localDelta.applyMatrix3(inverse);if(!this.localDelta.toArray().every(Number.isFinite))continue
            if(temporal){vertex.history??=new Vector3();vertex.history.copy(p.current).sub(origin).applyQuaternion(inverseHip).divideScalar(scale)}
            const state=this.geometries.find(g=>g.position===vertex.position)!;const a=vertex.position.array
            for(const index of vertex.indices){const o=index*3;a[o]=vertex.original[o]+this.localDelta.x;a[o+1]=vertex.original[o+1]+this.localDelta.y;a[o+2]=vertex.original[o+2]+this.localDelta.z;state.changed.add(index)}
            this.stats.correctedVertices+=vertex.indices.length;this.stats.maxDisplacement=Math.max(this.stats.maxDisplacement,displacement)
        }
        this.updateClothNormals()
        for(const state of this.geometries)if(state.changed.size)state.position.needsUpdate=true
        return this.diagnostics
    }
    private updateClothNormals(){
        // Measure bending in the FINAL skinned world sheet. Inverse-skinning
        // different vertices can distort the bind-space triangle; its normal
        // is not the visible face normal and produced wrongly oriented black
        // outline backfaces. Preserve authored smoothing in that world frame,
        // then undo exactly the shader's normal transform per skin group.
        const native=new Vector3(),deformed=new Vector3(),a=new Vector3(),b=new Vector3(),c=new Vector3(),edge=new Vector3(),rotation=new Quaternion(),normal=new Vector3()
        for(const p of this.points){p.nativeNormal??=new Vector3();p.deformedNormal??=new Vector3();p.nativeNormal.set(0,0,0);p.deformedNormal.set(0,0,0)}
        for(const f of this.faces){const state=this.geometries.find(s=>s.geometry===f.a.mesh.geometry)!;if(!state?.changed.size)continue
            a.copy(f.a.base);b.copy(f.b.base);c.copy(f.c.base);native.subVectors(b,a).cross(edge.subVectors(c,a))
            a.copy(f.a.current);b.copy(f.b.current);c.copy(f.c.current);deformed.subVectors(b,a).cross(edge.subVectors(c,a))
            for(const p of [f.a,f.b,f.c]){p.nativeNormal!.add(native);p.deformedNormal!.add(deformed)}
        }
        for(const vertex of this.vertices){const p=vertex.point!,from=p.nativeNormal!,to=p.deformedNormal!;if(from.lengthSq()<1e-16||to.lengthSq()<1e-16)continue
            from.normalize();to.normalize();if(from.distanceToSquared(to)<1e-14)continue;rotation.setFromUnitVectors(from,to)
            const state=this.geometries.find(s=>s.position===vertex.position)!
            if(!this.inverseSkin(vertex.skin)||!vertex.skin.normalWorld||!vertex.skin.normalInverse)continue
            for(const n of state.normals??[]){for(const i of vertex.indices){normal.fromArray(n.base,i*3).applyMatrix3(vertex.skin.normalWorld).normalize().applyQuaternion(rotation).applyMatrix3(vertex.skin.normalInverse).normalize();n.attribute.setXYZ(i,normal.x,normal.y,normal.z);state.normalChanged!.add(i)}n.attribute.needsUpdate=true}
        }
    }
    dispose(){this.restore();for(const guard of this.outlineGuards){guard.material.onBeforeCompile=guard.compile;guard.material.customProgramCacheKey=guard.key;guard.material.needsUpdate=true}this.outlineGuards.length=0;for(const view of this.linings){view.mesh.removeFromParent();view.mesh.geometry.dispose();for(const material of Array.isArray(view.mesh.material)?view.mesh.material:[view.mesh.material])material?.dispose()}this.linings.length=0;for(const view of this.views){if(view.mesh.geometry===view.geometry)view.mesh.geometry=view.original;view.geometry.dispose()}this.views.length=0;for(const state of this.geometries){for(const mesh of state.users)if(mesh.geometry===state.geometry)mesh.geometry=state.original;state.geometry.dispose()}this.geometries.length=0;this.vertices.length=0}
}
