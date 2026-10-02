import { Triangle, Vector3 } from 'three'
const triangle=new Triangle(),axis=new Vector3(),normal=new Vector3(),point=new Vector3(),other=new Vector3()
const d1=new Vector3(),d2=new Vector3(),relative=new Vector3(),edgePoint=new Vector3(),axisPoint=new Vector3()
const clamp=(x:number)=>Math.max(0,Math.min(1,x))
function segmentPair(p:Vector3,q:Vector3,a:Vector3,b:Vector3) {
    d1.subVectors(q,p);d2.subVectors(b,a);relative.subVectors(p,a)
    const aa=d1.lengthSq(),ee=d2.lengthSq(),ff=d2.dot(relative)
    let s=0,t=0
    if(aa<=1e-14&&ee<=1e-14){edgePoint.copy(p);axisPoint.copy(a);return}
    if(aa<=1e-14)t=clamp(ff/ee)
    else{
        const cc=d1.dot(relative)
        if(ee<=1e-14)s=clamp(-cc/aa)
        else{
            const bb=d1.dot(d2),den=aa*ee-bb*bb
            s=den>1e-14?clamp((bb*ff-cc*ee)/den):0
            t=(bb*s+ff)/ee
            if(t<0){t=0;s=clamp(-cc/aa)}else if(t>1){t=1;s=clamp((bb-cc)/aa)}
        }
    }
    edgePoint.copy(p).addScaledVector(d1,s);axisPoint.copy(a).addScaledVector(d2,t)
}
/** Exact triangle/segment distance, including an axis piercing the triangle
 * interior while all three vertices are outside the collision capsule. */
export function closestTriangleSegment(a:Vector3,b:Vector3,c:Vector3,start:Vector3,end:Vector3,target:Vector3,barycentric:Vector3):number {
    triangle.set(a,b,c);axis.subVectors(end,start)
    normal.subVectors(b,a).cross(other.subVectors(c,a))
    const denominator=normal.dot(axis)
    if(Math.abs(denominator)>1e-12){
        const t=normal.dot(point.subVectors(a,start))/denominator
        if(t>=0&&t<=1){point.copy(start).addScaledVector(axis,t);if(triangle.containsPoint(point)){target.copy(point);triangle.getBarycoord(target,barycentric);return 0}}
    }
    let best=Infinity
    for(const endpoint of [start,end]){
        triangle.closestPointToPoint(endpoint,point);const distance=point.distanceToSquared(endpoint)
        if(distance<best){best=distance;target.copy(point)}
    }
    for(const [p,q]of [[a,b],[b,c],[c,a]]){
        segmentPair(p,q,start,end);const distance=edgePoint.distanceToSquared(axisPoint)
        if(distance<best){best=distance;target.copy(edgePoint)}
    }
    triangle.getBarycoord(target,barycentric)
    return Math.sqrt(best)
}
