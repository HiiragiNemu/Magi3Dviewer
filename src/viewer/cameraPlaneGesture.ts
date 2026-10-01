import * as THREE from 'three'
export interface PlaneGestureDelta { x:number;y:number;spread:number;roll:number }
export interface PlaneGestureBase {
    position:THREE.Vector3;target:THREE.Vector3;quaternion:THREE.Quaternion
    right:THREE.Vector3;up:THREE.Vector3;back:THREE.Vector3;panScale:number;near:number;zoomSpeed:number
}
export function capturePlaneGesture(camera:THREE.PerspectiveCamera,target:THREE.Vector3,height:number,zoomSpeed=1):PlaneGestureBase {
    const q=camera.quaternion.clone(),distance=camera.position.distanceTo(target)
    return {position:camera.position.clone(),target:target.clone(),quaternion:q,
        right:new THREE.Vector3(1,0,0).applyQuaternion(q),up:new THREE.Vector3(0,1,0).applyQuaternion(q),back:new THREE.Vector3(0,0,1).applyQuaternion(q),
        panScale:2*Math.max(distance,.2)*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)/Math.max(1,height),near:Math.max(camera.near*2,.01),zoomSpeed}
}
/** Absolute from gesture start. Sequential pointer events cannot accumulate
 * drift when two fingers return to the same centroid and separation. */
export function resolvePlaneGesture(base:PlaneGestureBase,delta:PlaneGestureDelta) {
    if(![delta.x,delta.y,delta.spread,delta.roll].every(Number.isFinite))return undefined
    const pan=base.right.clone().multiplyScalar(-delta.x*base.panScale).addScaledVector(base.up,delta.y*base.panScale)
    const dolly=-delta.spread*.007*base.zoomSpeed
    const position=base.position.clone().add(pan).addScaledVector(base.back,dolly)
    const target=base.target.clone().add(pan),distance=base.position.distanceTo(base.target)+dolly
    if(distance<base.near)target.copy(position).addScaledVector(base.back,-base.near)
    return {position,target,quaternion:base.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),delta.roll)),distance:Math.max(base.near,distance)}
}
