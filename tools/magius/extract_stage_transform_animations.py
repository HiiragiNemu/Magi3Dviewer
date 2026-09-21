#!/usr/bin/env python3
"""Extract source-certified default absolute rotation clips, without a new player.

Only single-layer, single-state, parameter-free override controllers are admitted.
The inactive-carrier compatibility policy must be explicitly selected by caller.
No stage, tree, clip name, motion frequency, or hierarchy path is hardcoded.
"""
from __future__ import annotations
import argparse, hashlib, importlib.util, json, math, sys, zlib
from collections import defaultdict
from pathlib import Path
sys.dont_write_bytecode = True
import UnityPy
spec=importlib.util.spec_from_file_location('scene_decoder',Path(__file__).with_name('extract_magius_scene_profile.py'))
scene=importlib.util.module_from_spec(spec);spec.loader.exec_module(scene)
def require(condition,message):
    if not condition: raise ValueError(message)
def pointer(value): return int(value['m_PathID'])
def extract(bundle:Path, profile:dict, allow_inactive:bool):
    require(allow_inactive,'Select --preserve-rendered-inactive-carriers explicitly')
    require(not profile.get('sourceRecords',{}).get('animatorRandomizers'),'AnimatorRandomizer owns playback')
    UnityPy.config.FALLBACK_UNITY_VERSION=profile['unityVersion']
    env=UnityPy.load(str(bundle));objects={o.path_id:o for o in env.objects};trees={}
    def tree(pid):
        if pid not in trees: trees[pid]=objects[pid].read_typetree()
        return trees[pid]
    gos={o.path_id:tree(o.path_id) for o in env.objects if o.type.name=='GameObject'}
    transforms={o.path_id:tree(o.path_id) for o in env.objects if o.type.name=='Transform'}
    by_go={pointer(t['m_GameObject']):pid for pid,t in transforms.items()}
    def hierarchy(tid):
        t=transforms[tid];parent=pointer(t['m_Father']);return (hierarchy(parent)+'/' if parent else '')+gos[pointer(t['m_GameObject'])]['m_Name']
    def active(tid):
        t=transforms[tid];parent=pointer(t['m_Father']);return bool(gos[pointer(t['m_GameObject'])]['m_IsActive']) and (active(parent) if parent else True)
    clips={};groups={};controller_evidence={}
    for reader in env.objects:
        if reader.type.name!='Animator':continue
        animator=tree(reader.path_id);cid=pointer(animator['m_Controller'])
        if not cid:continue
        require(animator['m_Controller']['m_FileID']==0 and cid in objects,'External controller needs its frozen closure')
        require(animator['m_Enabled'] and not animator['m_ApplyRootMotion'],'Disabled/root-motion Animator needs separate authority')
        require(animator['m_UpdateMode']==0 and animator['m_CullingMode']==0 and animator['m_HasTransformHierarchy'],'Animator update/culling/hierarchy needs separate playback authority')
        require(objects[cid].type.name=='AnimatorController','Controller override needs explicit resolution')
        raw_controller=tree(cid);co=raw_controller['m_Controller'];layers=co['m_LayerArray'];machines=co['m_StateMachineArray']
        require(len(layers)==len(machines)==1,'Multiple layers need explicit rotation ownership')
        layer=layers[0]['data'];sm=machines[0]['data'];states=sm['m_StateConstantArray']
        require(layer['m_StateMachineIndex']==0 and layer['(int&)m_LayerBlendingMode']==0,'Non-default/additive layer')
        require(not layer['m_SkeletonMask']['data']['m_Data'],'Masked layer needs explicit ownership')
        require(len(states)==1 and sm['m_DefaultState']==0 and not sm['m_AnyStateTransitionConstantArray'],'State transitions need explicit playback authority')
        entries=[x['data'] for x in sm['m_SelectorStateConstantArray'] if x['data']['m_IsEntry']]
        require(len(entries)==1 and len(entries[0]['m_TransitionConstantArray'])==1,'Entry selectors need explicit playback authority')
        entry=entries[0]['m_TransitionConstantArray'][0]['data']
        require(entry['m_Destination']==0 and not entry['m_ConditionConstantArray'],'Conditional/non-default entry state')
        require(not co['m_Values']['data']['m_ValueArray'] and not raw_controller['m_StateMachineBehaviours'],'Parameters/behaviours need explicit playback authority')
        state=states[0]['data'];require(not state['m_TransitionConstantArray'],'State transitions are not static defaults')
        require(not any(state.get(k,0) for k in ['m_SpeedParamID','m_MirrorParamID','m_CycleOffsetParamID','m_TimeParamID']) and not state['m_Mirror'],'Parameterized/mirrored state')
        blend=state['m_BlendTreeConstantArray'];require(len(blend)==1,'Blended motions need a separate adapter')
        nodes=blend[0]['data']['m_NodeArray'];require(len(nodes)==1,'Blended motion nodes')
        node=nodes[0]['data'];require(not node['m_ChildIndices'] and not node['m_Mirror'] and node['m_CycleOffset']==0,'Non-leaf/mirrored/offset motion')
        ptr=raw_controller['m_AnimationClips'][node['m_ClipID']];clip_pid=pointer(ptr)
        require(ptr['m_FileID']==0 and clip_pid in objects,'External clip needs its frozen closure')
        clip_reader=objects[clip_pid];decoded=scene.serialized_component_clip_record(clip_reader,include_transform_only=True)
        require(decoded and all(b['typeID']==4 and b['propertyNameHash'] in (2,4) for b in decoded['bindings']),'Clip contains non-rotation fields')
        muscle=tree(clip_pid)['m_MuscleClip'];require(not muscle['m_LoopBlend'] and muscle['m_CycleOffset']==0,'Loop blending/clip offset needs a separate adapter')
        require(bool(state['m_Loop'])==decoded['loop'],'State/clip loop disagreement')
        speed=float(state['m_Speed']);offset=float(state['m_CycleOffset']);require(math.isfinite(speed) and speed>0 and math.isfinite(offset),'Invalid controller timing')
        tid=by_go[pointer(animator['m_GameObject'])];by_hash=defaultdict(list);stack=[(tid,'')]
        while stack:
            current,relative=stack.pop();by_hash[zlib.crc32(relative.encode())&0xffffffff].append(relative)
            for ch in transforms[current]['m_Children']:
                child=pointer(ch);name=gos[pointer(transforms[child]['m_GameObject'])]['m_Name'];stack.append((child,relative+'/'+name if relative else name))
        bindings=[]
        for binding in decoded['bindings']:
            matches=by_hash[binding['transformPathHash']];require(len(matches)==1,'Native transform hash collision or missing target')
            value={'relativePath':matches[0],'transformPathHash':binding['transformPathHash'],'attribute':binding['propertyNameHash'],'curves':binding['curves']}
            if value['attribute']==4:
                axes=[i for i,curve in enumerate(value['curves']) if any(k['value']!=0 or any(x!=0 for x in k.get('coefficients',[])) for k in curve)]
                require(len(axes)<=1,'Multi-axis Euler needs a verified order adapter');value['eulerAxis']=axes[0] if axes else 0
            bindings.append(value)
        descriptor={'name':decoded['name'],'sourceClipPathID':str(clip_pid),'sourceClipCAB':clip_reader.assets_file.name,'duration':float(muscle['m_StopTime']-muscle['m_StartTime']),'startTime':float(muscle['m_StartTime']),'loop':decoded['loop'],'speed':speed,'cycleOffset':offset,'bindings':bindings}
        key=hashlib.sha256(json.dumps(descriptor,sort_keys=True,separators=(',',':')).encode()).hexdigest();descriptor={'id':key,**descriptor};clips[key]=descriptor
        path=hierarchy(tid);group=groups.setdefault(path,{'hierarchyPath':path,'clipId':key,'expectedCarrierCount':0,'sources':[],'authority':'same-absolute-rotation-fields'})
        require(group['clipId']==key,'Ambiguous path has different absolute rotation fields/default policy')
        group['expectedCarrierCount']+=1;group['sources'].append({'animatorPathID':str(reader.path_id),'gameObjectPathID':str(pointer(animator['m_GameObject'])),'controllerPathID':str(cid),'clipId':key,'enabled':True,'activeInHierarchy':active(tid)})
        controller_evidence[str(cid)]={'name':raw_controller['m_Name'],'defaultState':0,'defaultStateName':dict(raw_controller['m_TOS']).get(state['m_NameID']),'clipPathID':str(clip_pid),'speed':speed,'cycleOffset':offset,'loop':decoded['loop'],'layerBlendingMode':0,'stateCount':1,'transitionCount':0}
    require(clips and groups,'No supported default rotation controllers')
    cab=next(o.assets_file.name for o in env.objects if o.type.name=='AnimatorController')
    return {'bundle':bundle.name,'sourceStageCab':cab,'sourceControllers':controller_evidence,'animation':{'schemaVersion':1,'sourceBundleSHA256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'coordinateConvention':'unity-reflect-x','carrierPolicy':'preserve-rendered-carriers-including-native-inactive','clips':sorted(clips.values(),key=lambda c:c['id']),'groups':sorted(groups.values(),key=lambda g:g['hierarchyPath'])}}
def main():
    p=argparse.ArgumentParser();p.add_argument('--bundle',type=Path,required=True);p.add_argument('--profile',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--preserve-rendered-inactive-carriers',action='store_true');a=p.parse_args()
    profile=json.loads(a.profile.read_text(encoding='utf-8-sig'));entry=extract(a.bundle,profile,a.preserve_rendered_inactive_carriers)
    catalog=json.loads(a.output.read_text(encoding='utf-8-sig')) if a.output.exists() else {'schemaVersion':1,'stages':{}}
    require(catalog['schemaVersion']==1,'Unsupported catalog');catalog['stages'][profile['stageId']]=entry;a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(catalog,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf8')
    animation=entry['animation'];print(json.dumps({'output':str(a.output.resolve()),'stageId':profile['stageId'],'clips':len(animation['clips']),'groups':len(animation['groups']),'sourceAnimators':sum(g['expectedCarrierCount'] for g in animation['groups']),'curveBindings':sum(g['expectedCarrierCount']*len(next(c for c in animation['clips'] if c['id']==g['clipId'])['bindings']) for g in animation['groups']),'sourceSHA256':animation['sourceBundleSHA256']}))
if __name__=='__main__':main()
