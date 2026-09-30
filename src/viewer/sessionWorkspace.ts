import { validateSavedPose, type SavedPose, type LocalTransform } from './poseWorkspace.ts'
export interface WorkspaceSession {
    schema:'magius.workspace-session.v1';savedAt:string
    actors:Array<{id:string;placement:LocalTransform;pose?:SavedPose}>
    selected:number;camera:{p:number[];q:number[];target:number[]};allowStretch:boolean;stage:string
}
const KEY='magius.workspace-session.v1'
const vector=(value:unknown,length:number)=>Array.isArray(value)&&value.length===length&&value.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<10000)
export function readWorkspaceSession(storage:Pick<Storage,'getItem'>):WorkspaceSession|undefined {
    const text=storage.getItem(KEY);if(!text)return
    if(text.length>3_000_000)throw Error('Session too large')
    const s=JSON.parse(text) as WorkspaceSession
    if(s.schema!=='magius.workspace-session.v1'||!Array.isArray(s.actors)||!s.actors.length||s.actors.length>8||!Number.isInteger(s.selected)||s.selected<0||s.selected>=s.actors.length||typeof s.allowStretch!=='boolean'||typeof s.stage!=='string'||!s.camera||!vector(s.camera.p,3)||!vector(s.camera.q,4)||!vector(s.camera.target,3))throw Error('Invalid workspace session')
    for(const a of s.actors){if(!/^\d{6}$/.test(a.id)||!a.placement||!vector(a.placement.p,3)||!vector(a.placement.q,4)||!vector(a.placement.s,3)||a.placement.s.some(x=>x<=0||x>100))throw Error('Invalid actor placement');if(a.pose){validateSavedPose(a.pose);if(a.pose.model!==a.id)throw Error('Session model mismatch')}}
    return s
}
export function writeWorkspaceSession(storage:Pick<Storage,'setItem'>,session:WorkspaceSession) {
    const text=JSON.stringify(session);if(text.length>3_000_000)throw Error('Session exceeds storage budget')
    storage.setItem(KEY,text)
}
