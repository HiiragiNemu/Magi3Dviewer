import {Box3,Camera,PerspectiveCamera,Ray,Vector3} from 'three'
/** Stay outside the selected actor's visible bounds. A one-node enemy branch
 * cannot be framed as a zero-size hand and place the lens inside its surface. */
export function safePartFocusDistance(center:Vector3,direction:Vector3,desired:number,bounds:Box3,near:number):number {
    const size=bounds.getSize(new Vector3()),margin=Math.max(near*4,size.length()*.055,.06)
    if(bounds.isEmpty()||!size.toArray().every(Number.isFinite))return Math.max(desired,margin)
    // From the target, find the farthest forward box intersection (not the
    // near entry). Even a target just outside a mesh cannot focus through it.
    const ray=new Ray(center,direction.clone().normalize()),expanded=bounds.clone().expandByScalar(margin)
    const inverse=new Ray(center.clone().addScaledVector(direction,size.length()*4+desired+margin),direction.clone().negate())
    const far=inverse.intersectBox(expanded,new Vector3())
    const exit=far?far.clone().sub(center).dot(direction):0
    const intersects=!!ray.intersectBox(expanded,new Vector3())
    return Math.max(desired,near*4,intersects?exit+margin:0)
}
export function frameWholeObject(camera:PerspectiveCamera,target:Vector3,bounds:Box3,canvas:DOMRect,top:number) {
    if(bounds.isEmpty())return false
    const originalRotation=camera.quaternion.clone()
    const center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3()),direction=new Vector3(0,0,1).applyQuaternion(camera.quaternion)
    if(direction.lengthSq()<1e-10)direction.set(0,.15,1);direction.normalize()
    const fraction=Math.max(.3,(canvas.bottom-Math.max(canvas.top,top))/canvas.height),tan=Math.tan(camera.fov*Math.PI/360)
    const distance=Math.max(size.y/fraction,size.x/Math.max(.2,camera.aspect),size.z,.3)/(2*tan*.72)
    const up=new Vector3(0,1,0).applyQuaternion(camera.quaternion),offset=(Math.max(canvas.top,top)-canvas.top)/canvas.height*tan*distance
    target.copy(center).addScaledVector(up,offset);camera.position.copy(target).addScaledVector(direction,distance);camera.quaternion.copy(originalRotation);camera.updateWorldMatrix(true,false)
    return true
}
/** Pure optical roll, no target or position adjustment. */
export function rotateCameraPlane(camera:Camera,radians:number) {camera.rotateZ(radians);camera.updateWorldMatrix(true,false)}

/** Explicit whole-actor focus into the space left by the editor's head, torso
 * and side controls. Does not install a tracking/follow mode or mutate a model. */
export function frameObjectInEditorArea(camera:PerspectiveCamera,target:Vector3,bounds:Box3,canvas:DOMRect,area:{left:number;right:number;top:number;bottom:number}):boolean {
    if(bounds.isEmpty()||canvas.width<=0||canvas.height<=0)return false
    const width=area.right-area.left,height=area.bottom-area.top
    if(width<60||height<60)return false
    const rotation=camera.quaternion.clone(),inverse=rotation.clone().invert(),center=bounds.getCenter(new Vector3())
    let halfX=0,halfY=0,halfDepth=0
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
        const v=new Vector3(x,y,z).sub(center).applyQuaternion(inverse)
        halfX=Math.max(halfX,Math.abs(v.x));halfY=Math.max(halfY,Math.abs(v.y));halfDepth=Math.max(halfDepth,Math.abs(v.z))
    }
    const tan=Math.tan(camera.fov*Math.PI/360),distance=Math.max(halfX/(tan*camera.aspect*width/canvas.width*.84),halfY/(tan*height/canvas.height*.84),camera.near*4)+halfDepth
    if(!Number.isFinite(distance))return false
    const x=((area.left+area.right)/2-canvas.left)/canvas.width*2-1,y=((area.top+area.bottom)/2-canvas.top)/canvas.height*2-1
    target.copy(center).addScaledVector(new Vector3(1,0,0).applyQuaternion(rotation),-x*tan*camera.aspect*distance).addScaledVector(new Vector3(0,1,0).applyQuaternion(rotation),y*tan*distance)
    camera.position.copy(target).addScaledVector(new Vector3(0,0,1).applyQuaternion(rotation),distance);camera.updateWorldMatrix(true,false)
    return true
}
