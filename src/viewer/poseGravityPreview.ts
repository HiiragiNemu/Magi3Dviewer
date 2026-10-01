import type { Object3D } from 'three'
import { getViewerCharacterPhysicsAttachment } from './characterPhysics'
import type { NativeCharacterPhysicsRuntime, NativeManualOutputLease } from './characterPhysics/runtime'
import { readLocal, writeLocal, type LocalTransform } from './poseWorkspace'
export interface GravityPreviewActor {object:Object3D;generation:number;current():boolean;frozen:boolean;inputs:Array<{node:Object3D;manual:boolean;apply():void}>}
interface State {runtime:NativeCharacterPhysicsRuntime;outputs:ReadonlySet<Object3D>;lease?:NativeManualOutputLease;pinned:Set<Object3D>;free:Set<Object3D>}
/** Reuse the one existing native solver. The editor's skeleton is its input,
 * while untouched cloth/hair/accessories remain solver-owned. No second spring
 * simulation, guessed gravity constant or modification of native parameters. */
export class PoseGravityPreview {
    enabled=false
    private states=new Map<Object3D,State>()
    private displayed=new Map<Object3D,LocalTransform>()
    setEnabled(value:boolean){if(value===this.enabled)return;this.enabled=value;if(!value)this.clear()}
    prepare(actors:GravityPreviewActor[]){
        const current=new Set<Object3D>()
        if(this.enabled)for(const actor of actors){
            if(!actor.frozen||!actor.current())continue
            const attachment=getViewerCharacterPhysicsAttachment(actor.object),runtime=attachment?.runtime
            if(attachment?.status!=='ready'||!runtime)continue
            const snapshot=runtime.getWritableChannelSnapshot();if(snapshot.status!=='ready'||!snapshot.active)continue
            current.add(actor.object)
            let state=this.states.get(actor.object)
            if(!state||state.runtime!==runtime){state?.lease?.cancel();state={runtime,outputs:snapshot.outputObjects,pinned:new Set(),free:new Set()};this.states.set(actor.object,state)}
            state.outputs=snapshot.outputObjects
            const pinned=new Set(actor.inputs.filter(i=>i.manual&&state!.outputs.has(i.node)).map(i=>i.node))
            if(pinned.size!==state.pinned.size||[...pinned].some(n=>!state!.pinned.has(n))||state.lease?.state==='invalid'){
                state.lease?.cancel();state.lease=undefined;state.pinned=pinned
                if(pinned.size){const lease=runtime.acquireManualOutputLease({root:actor.object,actorGeneration:actor.generation,isCurrent:actor.current,outputs:[...pinned]});if(lease.status==='ready')state.lease=lease.value;else{state.free.clear();continue}}
            }
            state.free=new Set([...state.outputs].filter(n=>!pinned.has(n)))
            for(const input of actor.inputs)if(!state.free.has(input.node))input.apply()
            actor.object.updateMatrixWorld(true)
        }
        for(const [object,state]of this.states)if(!current.has(object)){state.lease?.cancel();this.states.delete(object)}
    }
    capture(){this.displayed.clear();if(this.enabled)for(const state of this.states.values())for(const node of state.free)this.displayed.set(node,readLocal(node))}
    compose(){if(this.enabled)for(const [node,pose]of this.displayed){writeLocal(node,pose);node.updateMatrix()}this.displayed.clear()}
    ownsFree(root:Object3D,node:Object3D){return this.enabled&&this.states.get(root)?.free.has(node)===true}
    diagnostics(){return{enabled:this.enabled,actors:[...this.states].map(([object,state])=>({uuid:object.uuid,freeOutputs:state.free.size,heldOutputs:state.pinned.size,solver:state.runtime.diagnostics}))}}
    clear(){for(const state of this.states.values())state.lease?.cancel();this.states.clear();this.displayed.clear()}
    dispose(){this.clear()}
}
