export interface MarkerPoint {x:number;y:number}
export interface MarkerRect extends MarkerPoint {width:number;height:number}
const offsets:MarkerPoint[]=[]
for(let x=-6;x<=6;x++)for(let y=-6;y<=6;y++)offsets.push({x:x*25,y:y*25})
offsets.sort((a,b)=>a.x*a.x+a.y*a.y-b.x*b.x-b.y*b.y)
/** Separate projected handles only. Each handle keeps its actual bone and a
 * leader line; no synthetic joints or guessed model structure are created. */
export function separateNodeMarkers(points:readonly MarkerPoint[],view:MarkerRect,avoid:readonly MarkerRect[],spacing=24):MarkerPoint[]{
 const placed:MarkerPoint[]=[]
 for(const point of points){
  const candidates=offsets.map(o=>({x:Math.max(view.x+13,Math.min(view.x+view.width-13,point.x+o.x)),y:Math.max(view.y+13,Math.min(view.y+view.height-13,point.y+o.y))}))
  const valid=(p:MarkerPoint)=>!avoid.some(r=>p.x>r.x-13&&p.x<r.x+r.width+13&&p.y>r.y-13&&p.y<r.y+r.height+13)&&placed.every(q=>(p.x-q.x)**2+(p.y-q.y)**2>=spacing*spacing)
  placed.push(candidates.find(valid)??candidates[0])
 }
 return placed
}
