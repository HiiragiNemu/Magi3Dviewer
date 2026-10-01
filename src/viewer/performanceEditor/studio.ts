import type { mountPerformancePanel } from './panel.ts'
import { PerformanceRecorder } from './recorder.ts'
import type { RecordedKind, RecordedLane } from './recordings.ts'
import { emptyPerformanceDocument } from './timeline.ts'
import { saveStudioProject, listStudioProjects } from './studioStorage.ts'
import './studio.css'
interface Options {toggle:HTMLButtonElement;panel:ReturnType<typeof mountPerformancePanel>;recorder:PerformanceRecorder;selected():string|undefined;pose():void;expression():void;tps():void;focus():void;onOpenChange?(open:boolean):void}
/** Live Viewer is the stage. No second skeleton editor and no permanent side
 * inspector. On phones the collapsed transport leaves the canvas unobstructed. */
export function mountPerformanceStudio(options:Options){
    const {recorder,panel,toggle}=options,runtime=recorder.runtime,abort=new AbortController(),ev={signal:abort.signal}
    const root=document.createElement('section');root.id='performance-studio';root.dataset.i18nIgnore='true';root.hidden=true;root.setAttribute('aria-label','演出录制与时间轴')
    const bar=document.createElement('div');bar.className='studio-bar'
    const target=document.createElement('select');target.id='studio-target';target.setAttribute('aria-label','录制角色或镜头')
    const time=document.createElement('output');time.id='studio-time';time.textContent='0.00 s'
    const status=document.createElement('output');status.id='studio-status';status.setAttribute('aria-live','polite')
    const transport=document.createElement('div');transport.className='studio-transport'
    const controls=document.createElement('div');controls.className='studio-tools'
    const trackHost=document.createElement('div');trackHost.id='studio-tracks';trackHost.hidden=true
    const drawer=document.createElement('section');drawer.id='studio-drawer';drawer.hidden=true
    const scrub=document.createElement('input');scrub.type='range';scrub.id='studio-scrub';scrub.min='0';scrub.step='.001';scrub.setAttribute('aria-label','演出时间轴')
    const report=(action:()=>unknown)=>{try{const result=action();if(result instanceof Promise)void result.catch(error=>message((error as Error).message));else refresh()}catch(error){message((error as Error).message)}}
    let targetExplicit=false
    let lastMessage='',messageUntil=0,open=false,compact=false,saving:ReturnType<typeof setTimeout>|undefined,lastFrame=-1
    const message=(text:string)=>{lastMessage=text;messageUntil=performance.now()+8000;status.textContent=text}
    const button=(host:HTMLElement,id:string,label:string,action:()=>unknown)=>{const b=document.createElement('button');b.type='button';b.id='studio-'+id;b.textContent=label;b.setAttribute('aria-label',label);b.addEventListener('click',()=>report(action),ev);host.append(b);return b}
    bar.append(target)
    const record=button(bar,'record','● 录制',()=>{if(recorder.recording){recorder.finish();setCompact(false);message('录制已保存；回到起点后可换角色叠录。')}else{recorder.start(target.value,kinds());message('正在录制所选通道；其他角色轨道同步重播。')}})
    const play=button(transport,'play','▶ 播放',()=>runtime.playing?recorder.pause():recorder.play())
    button(transport,'rewind','↤ 起点',()=>recorder.seek(0))
    button(transport,'stop','停止',()=>recorder.stop())
    transport.append(time,scrub)
    button(bar,'key','◆ 记一帧',()=>{recorder.captureKey(target.value,kinds());message('已在当前时刻记录所选通道。')})
    const tracksToggle=button(bar,'tracks-toggle','轨道',()=>{trackHost.hidden=!trackHost.hidden;tracksToggle.setAttribute('aria-expanded',String(!trackHost.hidden));compact=false;root.dataset.compact='false'})
    const toolsToggle=button(bar,'tools-toggle','工具',()=>{controls.hidden=!controls.hidden;toolsToggle.setAttribute('aria-expanded',String(!controls.hidden))})
    const collapse=button(bar,'collapse','收起',()=>setCompact(!compact))
    button(bar,'close','退出',()=>setOpen(false))
    const motion=document.createElement('input');motion.type='checkbox';motion.checked=true;motion.id='studio-motion'
    const face=document.createElement('input');face.type='checkbox';face.checked=true;face.id='studio-expression'
    for(const [input,text]of[[motion,'动作 / 位移'],[face,'表情']] as const){const label=document.createElement('label');label.append(input,document.createTextNode(text));controls.append(label)}
    const kinds=():RecordedKind[]=>target.value==='camera'?['camera']:[...(motion.checked?['motion' as const]:[]),...(face.checked?['expression' as const]:[])]
    button(controls,'live','编辑当前帧',()=>{runtime.pause();recorder.prepareLive(target.value,kinds());message('所选角色已交还实时编辑；调整后点“记一帧”或“录制”。')})
    button(controls,'pose','姿态编辑',()=>{if(!recorder.recording)recorder.prepareLive(target.value);options.pose();setCompact(true)})
    button(controls,'face','表情编辑',()=>{if(!recorder.recording)recorder.prepareLive(target.value,['expression']);options.expression();setCompact(true)})
    button(controls,'tps','TPS 控制',()=>{if(!recorder.recording)recorder.prepareLive(target.value);options.tps();setCompact(true)})
    button(controls,'focus','框选舞台',()=>{if(!recorder.recording)recorder.prepareLive('camera',['camera']);options.focus()})
    const undo=button(controls,'undo','撤销轨道',()=>recorder.undo()),redo=button(controls,'redo','重做轨道',()=>recorder.undo(true))
    button(controls,'project','项目',()=>showDrawer('project'))
    button(controls,'audio','音频',()=>showDrawer('audio'))
    button(controls,'advanced','高级关键帧',()=>showDrawer('advanced'))
    const loop=document.createElement('input');loop.type='checkbox';loop.id='studio-loop';const loopLabel=document.createElement('label');loopLabel.append(loop,document.createTextNode('循环'));controls.append(loopLabel)
    loop.addEventListener('change',()=>report(()=>{if(recorder.recording)throw Error('停止录制后再切换循环');runtime.setDocument({...runtime.timeline.value,loop:loop.checked})}),ev)
    const help=document.createElement('details');help.className='studio-help';const helpTitle=document.createElement('summary');helpTitle.textContent='操作示例';const helpText=document.createElement('p');helpText.textContent='选择A角色 → 录制并操控 → 停止录制 → 回到起点 → 选择B角色再录制。已有A轨道会同时重播。选择“镜头”可录制取景；表情可独立录制或逐帧修改。';help.append(helpTitle,helpText);controls.append(help)
    controls.hidden=true;root.append(drawer,trackHost,controls,bar,transport,status);document.body.append(root)
    const moved:Array<{node:HTMLElement;marker:Comment}>=[]
    const restoreRegions=()=>{for(const {node,marker}of moved.splice(0)){marker.parentNode?.insertBefore(node,marker);marker.remove()}}
    const move=(node:HTMLElement,host:HTMLElement)=>{const marker=document.createComment('studio-region');node.parentNode?.insertBefore(marker,node);moved.push({node,marker});host.append(node)}
    const setCompact=(value:boolean)=>{compact=value;root.dataset.compact=String(value);collapse.textContent=value?'展开':'收起';if(value){controls.hidden=true;trackHost.hidden=true;drawer.hidden=true;restoreRegions()}refresh()}
    const projectName=document.createElement('input');projectName.id='studio-project-name';projectName.placeholder='项目名称';projectName.value='我的演出';projectName.maxLength=80;projectName.setAttribute('aria-label','项目名称')
    const imports=document.createElement('input');imports.id='studio-import';imports.type='file';imports.accept='.json,application/json';imports.setAttribute('aria-label','导入演出项目')
    imports.addEventListener('change',()=>{const file=imports.files?.[0];if(file){if(file.size>160000000){message('文件过大，请拆分项目');return}report(async()=>{await recorder.import(await file.text());refreshActors();refreshTracks();message('已载入项目与录制角色');imports.value=''})}},ev)
    const showDrawer=(kind:'project'|'audio'|'advanced')=>{
        restoreRegions();drawer.replaceChildren();drawer.hidden=false;setCompact(false)
        const header=document.createElement('div');header.className='studio-drawer-title';const title=document.createElement('strong');title.textContent=kind==='project'?'项目与文件':kind==='audio'?'音频与口型':'高级逐通道关键帧';header.append(title);button(header,'drawer-close','关闭',()=>{drawer.hidden=true;restoreRegions()});drawer.append(header)
        if(kind==='audio'){move(panel.regions.audio,drawer);return}
        if(kind==='advanced'){move(panel.regions.timeline,drawer);return}
        const actions=document.createElement('div');actions.className='studio-project-actions';actions.append(projectName)
        button(actions,'save','保存到本机',async()=>{await saveStudioProject(projectName.value.trim()||'我的演出',runtime.exportProject());message('项目已保存到本机');await refreshSaved()})
        button(actions,'export','导出文件',()=>{const url=URL.createObjectURL(new Blob([runtime.exportProject()],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=(projectName.value.trim()||'magius-performance')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)})
        actions.append(imports);button(actions,'new','新建项目',()=>{if((recorder.lanes.length||runtime.timeline.tracks.length)&&!confirm('新建空项目？当前项目请先保存或导出。'))return;recorder.stop();runtime.setDocument(emptyPerformanceDocument())})
        const duration=document.createElement('input');duration.type='number';duration.min='.1';duration.max='3600';duration.step='.1';duration.value=String(runtime.timeline.duration);duration.setAttribute('aria-label','总时长（秒）');const durationLabel=document.createElement('label');durationLabel.append(document.createTextNode('总时长（秒）'),duration);actions.append(durationLabel)
        duration.addEventListener('change',()=>report(()=>runtime.setDocument({...runtime.timeline.value,duration:Number(duration.value)})),ev)
        const saved=document.createElement('div');saved.id='studio-saved-projects';drawer.append(actions,saved)
        async function refreshSaved(){const rows=await listStudioProjects();if(!saved.isConnected)return;saved.replaceChildren();for(const row of rows){button(saved,'saved-'+saved.children.length,(row.name==='__draft__'?'自动保存草稿':row.name)+' · '+new Date(row.updatedAt).toLocaleString(),async()=>{await recorder.import(row.text);projectName.value=row.name==='__draft__'?'我的演出':row.name;message('已载入 '+row.name)})}}
        void refreshSaved().catch(e=>message((e as Error).message))
    }
    let selectedLane:string|undefined,selectedKey:number|undefined
    const selectLane=(lane:RecordedLane)=>{
        selectedLane=lane.id;selectedKey=undefined
        const editor=document.createElement('div');editor.className='studio-lane-tools'
        const name=document.createElement('input');name.value=lane.label;name.maxLength=200;name.setAttribute('aria-label','轨道名称');name.onchange=()=>report(()=>recorder.editLanes(ls=>{ls.find(l=>l.id===lane.id)!.label=name.value}));editor.append(name)
        button(editor,'mute-lane',lane.muted?'启用轨道':'停用轨道',()=>recorder.mute(lane.id));button(editor,'earlier','← 0.1秒',()=>recorder.move(lane.id,-.1));button(editor,'later','0.1秒 →',()=>recorder.move(lane.id,.1))
        const key=document.createElement('select');key.setAttribute('aria-label','选择录制关键帧');key.append(...lane.frames.map(f=>{const o=document.createElement('option');o.value=String(f.time);o.textContent=f.time.toFixed(3)+' s';return o}));key.onchange=()=>{selectedKey=Number(key.value);report(()=>recorder.seek(selectedKey!))};editor.append(key)
        button(editor,'delete-key','删除该帧',()=>recorder.deleteFrame(lane.id,selectedKey??Number(key.value)))
        button(editor,'delete-lane','删除轨道',()=>{if(confirm('删除“'+lane.label+'”？可用撤销轨道恢复。')){recorder.remove(lane.id);drawer.hidden=true}})
        restoreRegions();drawer.replaceChildren();drawer.hidden=false;button(drawer,'lane-close','关闭轨道工具',()=>{drawer.hidden=true});drawer.append(editor)
    }
    const refreshActors=()=>{
        const previous=targetExplicit?target.value:options.selected()||target.value;target.replaceChildren(...recorder.host.actors().filter(a=>a.current()).map(a=>{const o=document.createElement('option');o.value=a.actorKey;o.textContent=(a.instance?`${a.instance+1} · `:'')+a.label;return o}));const camera=document.createElement('option');camera.value='camera';camera.textContent='镜头';target.append(camera)
        if([...target.options].some(o=>o.value===previous))target.value=previous!;refresh()
    }
    const refreshTracks=()=>{
        trackHost.replaceChildren()
        for(const lane of recorder.lanes){const row=document.createElement('div');row.className='studio-lane';row.dataset.laneId=lane.id;row.dataset.kind=lane.kind;row.classList.toggle('is-muted',!!lane.muted)
            const label=button(row,'lane-'+trackHost.children.length,(lane.kind==='camera'?'':lane.kind==='motion'?'动作 · ':'表情 · ')+lane.label,()=>selectLane(lane));label.className='studio-lane-label';label.title=lane.label
            const rail=document.createElement('div');rail.className='studio-rail';rail.setAttribute('role','slider');rail.setAttribute('aria-label',lane.label+' 时间轴');rail.tabIndex=0
            const span=document.createElement('span');span.className='studio-recorded-range';span.style.left=(lane.frames[0].time/runtime.timeline.duration*100)+'%';span.style.width=(Math.max(.012,lane.frames.at(-1)!.time-lane.frames[0].time)/runtime.timeline.duration*100)+'%';rail.append(span)
            const stride=Math.max(1,Math.ceil(lane.frames.length/100));lane.frames.forEach((frame,i)=>{if(i%stride&&i!==lane.frames.length-1)return;const key=document.createElement('i');key.className='studio-key';key.style.left=(frame.time/runtime.timeline.duration*100)+'%';rail.append(key)})
            const cursor=document.createElement('i');cursor.className='studio-cursor';rail.append(cursor)
            const seekAt=(event:PointerEvent)=>{const r=rail.getBoundingClientRect();recorder.seek(Math.max(0,Math.min(1,(event.clientX-r.left)/r.width))*runtime.timeline.duration)}
            rail.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();rail.setPointerCapture(e.pointerId);report(()=>seekAt(e))},ev);rail.addEventListener('pointermove',e=>{if(rail.hasPointerCapture(e.pointerId))report(()=>seekAt(e))},ev);rail.addEventListener('pointerup',e=>{if(rail.hasPointerCapture(e.pointerId))rail.releasePointerCapture(e.pointerId)},ev)
            rail.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();report(()=>recorder.seek(runtime.time+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?1:.1)))}},ev)
            const count=document.createElement('small');count.textContent=lane.frames.length+'帧';row.append(rail,count);trackHost.append(row)
        }
        for(const track of runtime.timeline.tracks){const line=document.createElement('div');line.className='studio-legacy-row';line.textContent='手工 · '+track.channel+' · '+track.keys.length+'帧';trackHost.append(line)}
        for(const audio of runtime.timeline.audioTracks){const line=document.createElement('div');line.className='studio-legacy-row';line.textContent='音频 · '+audio.startTime.toFixed(2)+'s · '+audio.sourceStableKey;trackHost.append(line)}
        if(!trackHost.childElementCount){const empty=document.createElement('p');empty.className='studio-empty';empty.textContent='先选择角色并录制。回到起点后换一个角色继续录制，即可形成并行轨道。';trackHost.append(empty)}
        if(selectedLane&&!recorder.lanes.some(l=>l.id===selectedLane)){selectedLane=undefined;selectedKey=undefined}
        tracksToggle.textContent='轨道 '+(recorder.lanes.length+runtime.timeline.tracks.length+runtime.timeline.audioTracks.length)
    }
    const refresh=()=>{
        record.textContent=recorder.recording?'■ 结束录制':'● 录制';record.setAttribute('aria-pressed',String(recorder.recording));root.dataset.recording=String(recorder.recording)
        play.textContent=runtime.playing?'Ⅱ 暂停':'▶ 播放';play.disabled=recorder.recording;target.disabled=recorder.recording
        time.textContent=runtime.time.toFixed(2)+' s';scrub.max=String(recorder.recording?Math.max(10,runtime.time+2):runtime.timeline.duration);if(document.activeElement!==scrub)scrub.value=String(runtime.time)
        root.style.setProperty('--studio-time',Math.min(100,runtime.time/runtime.timeline.duration*100)+'%')
        motion.disabled=face.disabled=target.value==='camera'||recorder.recording;loop.checked=runtime.timeline.loop;undo.disabled=!recorder.canUndo||recorder.recording;redo.disabled=!recorder.canRedo||recorder.recording
        status.textContent=recorder.error||runtime.lastError||(performance.now()<messageUntil?lastMessage:recorder.recording?'录制中 · 其他轨道同步播放':runtime.playing?'播放中':recorder.lanes.length?'就绪 · 选择角色可继续叠录':'选择角色 → 录制 → 起点 → 换角色叠录')
    }
    target.addEventListener('change',()=>report(()=>{targetExplicit=true;recorder.prepareLive(target.value,kinds());refresh()}),ev)
    scrub.addEventListener('input',()=>report(()=>recorder.seek(Number(scrub.value))),ev)
    const setOpen=(value:boolean)=>{if(value===open)return;if(!value){recorder.stop();drawer.hidden=true;restoreRegions()}open=value;root.hidden=!value;document.body.classList.toggle('performance-studio-open',value);toggle.setAttribute('aria-expanded',String(value));options.onOpenChange?.(value);if(value){refreshActors();refreshTracks();refresh()}else toggle.focus()}
    toggle.setAttribute('aria-controls',root.id);toggle.addEventListener('click',()=>setOpen(!open),ev)
    const release=runtime.subscribe(kind=>{if(kind==='actors')refreshActors();if(kind==='document'){refreshTracks();if(saving)clearTimeout(saving);if(!recorder.recording)saving=setTimeout(()=>{void saveStudioProject('__draft__',runtime.exportProject()).catch(()=>{/* Explicit save/export remains available on quota denial. */})},700)}if(open&&performance.now()-lastFrame>70){lastFrame=performance.now();refresh()}})
    const releaseRecorder=recorder.subscribe(()=>{refreshActors();refreshTracks();refresh()})
    document.addEventListener('keydown',e=>{if(!open||/INPUT|SELECT|TEXTAREA/.test((e.target as Element)?.tagName)||e.ctrlKey||e.altKey||e.metaKey)return;if(e.code==='KeyR'&&!document.body.classList.contains('locomotion-mode-enabled')){e.preventDefault();record.click()}},ev)
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&recorder.recording){recorder.finish();message('录制已在页面隐藏时停止并保留，避免后台时间跳跃。')}else if(document.hidden&&runtime.playing)runtime.pause()},ev)
    const measure=()=>{const height=root.hidden?0:Math.max(0,innerHeight-root.getBoundingClientRect().top+4);document.body.style.setProperty('--studio-reserved-height',height+'px');document.dispatchEvent(new CustomEvent('magius:studio-layout'))}
    const resizeObserver=new ResizeObserver(measure);resizeObserver.observe(root)
    refreshActors();refreshTracks();refresh()
    return{setOpen,get isOpen(){return open},refresh,dispose(){setOpen(false);if(saving)clearTimeout(saving);release();releaseRecorder();abort.abort();resizeObserver.disconnect();document.body.style.removeProperty('--studio-reserved-height');restoreRegions();root.remove()}}
}
