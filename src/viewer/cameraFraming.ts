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
