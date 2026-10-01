import { Object3D } from 'three'
import { posePartLabel, groupedPoseParts, readPoseLibrary, deleteSavedPose, type PoseNodeGroup, type SavedPose, type PosePart } from './poseWorkspace'

interface Hooks {
    actor():Object3D|undefined
    model():string
    selected():Object3D|undefined
    group():PoseNodeGroup
    setGroup(group:PoseNodeGroup):void
    allowStretch():boolean
    setStretch(value:boolean):void
    select(part:PosePart):void
    reset():void
    undo():void
    redo():void
    make(name:string):SavedPose
    save(pose:SavedPose):void
    apply(pose:unknown):void
    scale(axis:'x'|'y'|'z',value:number):void
}
/** Optional advanced editor. Viewport controls never open this automatically. */
export function createPoseWorkspacePanel(parent:HTMLElement,hooks:Hooks) {
    const root=document.createElement('section');root.id='pose-workspace';root.dataset.i18nIgnore='true'
    const policy=document.createElement('label');policy.className='pose-stretch-policy'
    const stretch=document.createElement('input');stretch.type='checkbox';stretch.id='pose-allow-stretch'
    policy.append(stretch,document.createTextNode('允许拉伸 / 结构位移（默认关闭）'))
    const note=document.createElement('small');note.textContent='普通模式保长；更多节点覆盖其余实际骨骼。开启拉伸后才允许结构平移和缩放。'
    const actions=document.createElement('div');actions.className='pose-workspace-actions'
    const button=(host:HTMLElement,id:string,label:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.id=id;b.textContent=label;b.onclick=()=>{try{action();refresh(true)}catch(e){message.textContent=String((e as Error).message)}};host.append(b);return b}
    button(actions,'pose-reset-all','重置全部动作',hooks.reset)
    button(actions,'pose-workspace-undo','撤销动作',hooks.undo);button(actions,'pose-workspace-redo','重做动作',hooks.redo)
    const structure=document.createElement('details');structure.id='pose-structure';const summary=document.createElement('summary');summary.textContent='节点与服装结构';structure.append(summary)
    const categories=document.createElement('div');categories.className='pose-workspace-actions'
    for(const [g,l]of [['primary','主要节点'],['hands','手部节点'],['more','更多节点']] as const)button(categories,'pose-group-'+g,l,()=>hooks.setGroup(g))
    const search=document.createElement('input');search.type='search';search.id='pose-structure-search';search.placeholder='搜索手指 / 服装 / 模型节点';search.setAttribute('aria-label',search.placeholder)
    const list=document.createElement('select');list.id='pose-structure-select';list.size=6;list.setAttribute('aria-label','实际可编辑结构节点')
    const scale=document.createElement('div');scale.id='pose-structure-scale';scale.className='pose-scale-grid'
    for(const axis of ['x','y','z'] as const){const label=document.createElement('label');label.textContent=axis.toUpperCase()+' 缩放';const input=document.createElement('input');input.id='pose-scale-'+axis;input.type='number';input.min='.05';input.max='5';input.step='.05';input.value='1';input.onchange=()=>{try{hooks.scale(axis,input.valueAsNumber);refresh()}catch(e){message.textContent=(e as Error).message}};label.append(input);scale.append(label)}
    structure.append(categories,search,list,scale)
    const library=document.createElement('details');library.id='pose-library';const heading=document.createElement('summary');heading.textContent='保存 / 载入姿态（本机保留）';library.append(heading)
    const name=document.createElement('input');name.id='pose-save-name';name.placeholder='姿态名称';name.maxLength=80;name.setAttribute('aria-label','姿态名称')
    const saved=document.createElement('select');saved.id='pose-saved-list';saved.setAttribute('aria-label','当前模型保存的姿态')
    const ops=document.createElement('div');ops.className='pose-workspace-actions'
    button(ops,'pose-save','保存姿态',()=>{hooks.save(hooks.make(name.value));message.textContent='已保存到此浏览器；关闭并重开仍可载入。'})
    button(ops,'pose-load','载入姿态',()=>{const p=readPoseLibrary(localStorage).filter(p=>p.model===hooks.model())[Number(saved.value)];if(!p)throw Error('请先选择保存的姿态');hooks.apply(p);message.textContent='已载入；可撤销。'})
    button(ops,'pose-delete','删除记录',()=>{const p=readPoseLibrary(localStorage).filter(p=>p.model===hooks.model())[Number(saved.value)];if(!p)return;deleteSavedPose(localStorage,p.model,p.name);message.textContent='已删除保存记录。'})
    button(ops,'pose-export','导出 JSON',()=>{const blob=new Blob([JSON.stringify(hooks.make(name.value),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Magius-pose-${hooks.model()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)})
    const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.hidden=true;file.id='pose-import-file'
    button(ops,'pose-import','导入 JSON',()=>file.click())
    file.onchange=async()=>{try{const f=file.files?.[0];if(!f)return;if(f.size>4_000_000)throw Error('文件超过4 MB，未载入');hooks.apply(JSON.parse(await f.text()));message.textContent='已导入姿态；可撤销。'}catch(e){message.textContent=(e as Error).message}finally{file.value='';refresh(true)}}
    const storageNote=document.createElement('small');storageNote.textContent='保存的是姿态，不是整段动画；清除网站数据会删除本机记录，导出 JSON 可长期备份。'
    library.append(name,saved,ops,file,storageNote)
    const message=document.createElement('output');message.id='pose-workspace-status';message.setAttribute('aria-live','polite')
    root.append(policy,note,actions,structure,library,message);parent.prepend(root)
    let key='',entries:PosePart[]=[]
    const rebuild=()=>{const actor=hooks.actor();entries=actor?groupedPoseParts(actor,hooks.group()):[];const query=search.value.toLowerCase();list.replaceChildren();for(const part of entries.filter(p=>(posePartLabel(p,document.documentElement.lang)+' '+p.label+' '+p.bone.type).toLowerCase().includes(query))){const option=document.createElement('option');option.value=part.bone.uuid;option.textContent=posePartLabel(part,document.documentElement.lang);option.title=part.bone.name;list.append(option)}if(hooks.selected())list.value=hooks.selected()!.uuid;summary.textContent=`节点与服装结构 · ${entries.length} 个实际节点`}
    const refresh=(force=false)=>{
        const actor=hooks.actor(),selected=hooks.selected(),next=(actor?.uuid??'')+'|'+hooks.group()+'|'+document.documentElement.lang
        if(force||next!==key){key=next;rebuild();const value=saved.value;saved.replaceChildren();try{readPoseLibrary(localStorage).filter(p=>p.model===hooks.model()).forEach((p,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=p.name;saved.append(o)});saved.value=value||'0'}catch(e){message.textContent='本机存储不可用：'+(e as Error).message}}
        if(selected&&document.activeElement!==list)list.value=selected.uuid
        stretch.checked=hooks.allowStretch()
        for(const axis of ['x','y','z'] as const){const input=scale.querySelector<HTMLInputElement>('#pose-scale-'+axis)!;input.disabled=!selected||!hooks.allowStretch();if(document.activeElement!==input)input.value=String(Number((selected?.scale[axis]??1).toFixed(4)))}
        for(const b of categories.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.id==='pose-group-'+hooks.group()))
    }
    stretch.onchange=()=>{try{hooks.setStretch(stretch.checked);message.textContent=stretch.checked?'拉伸已明确开启。':'拉伸已关闭；已编辑的结构位移会恢复保长基线，可撤销。';refresh()}catch(e){stretch.checked=hooks.allowStretch();message.textContent=(e as Error).message}}
    search.oninput=rebuild;list.onchange=()=>{const entry=entries.find(p=>p.bone.uuid===list.value);if(entry){hooks.select(entry);refresh()}}
    refresh(true)
    return{refresh,root}
}
