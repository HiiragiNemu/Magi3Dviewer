import { layoutViewportBranches } from './viewportBranchLayout'
import { Bone, Camera, Object3D, Vector3 } from 'three'
import { findDirectPoseParts, type DirectPoseHistory, type PosePart } from './directPoseTools'

export interface ViewportEditorState {
    actor?: Object3D
    object?: Object3D
    pose: boolean
    active: boolean
    mode: 'translate' | 'rotate'
    selected?: Bone
    history?: DirectPoseHistory
    limited: boolean
    canTranslate: boolean
}
interface Options {
    state(): ViewportEditorState
    camera: Camera
    canvas: HTMLElement
    translate(text: string): string
    locale(): string
    place(mode: 'translate' | 'rotate'): void
    pose(): void
    mode(mode: 'translate' | 'rotate'): void
    close(): void
    parameters(): void
    focus(): void
    select(part: PosePart): void
    begin(part: PosePart, event: PointerEvent): boolean
    move(event: PointerEvent): void
    end(event?: PointerEvent): void
    undo(): void
    redo(): void
    reset(): void
    nudge(axis: 'x' | 'y' | 'z', amount: number): void
}
const words = {
    'zh-CN': { launch:'编辑角色', object:'整体摆放', pose:'姿态编辑', move:'XYZ 移动', rotate:'旋转环', joints:'关节点', fine:'部位微调', parameters:'参数面板', close:'关闭编辑', reset:'重置部位', undo:'撤销', redo:'重做', hint:'空白拖动：转视角 · 右键：平移 · 滚轮：缩放', pick:'点击关节点或身体部位', locked:'已到关节 / 地面限制', safe:'关节限制 · 地面保护', title:'视口编辑', fineHint:'每次 1°；Shift 为 0.2°' },
    'ja-JP': { launch:'モデル編集', object:'全体配置', pose:'ポーズ', move:'XYZ 移動', rotate:'回転リング', joints:'関節点', fine:'関節微調整', parameters:'詳細パネル', close:'編集終了', reset:'関節リセット', undo:'元に戻す', redo:'やり直す', hint:'空白をドラッグ：回転 · 右ボタン：移動 · ホイール：ズーム', pick:'関節点または体を選択', locked:'関節 / 地面の制限に到達', safe:'関節制限 · 地面保護', title:'ビューポート編集', fineHint:'1°ずつ；Shift：0.2°' },
    en: { launch:'Edit model', object:'Place object', pose:'Pose editor', move:'Move XYZ', rotate:'Rotation rings', joints:'Joint nodes', fine:'Fine joint edit', parameters:'Parameters', close:'Close editing', reset:'Reset joint', undo:'Undo', redo:'Redo', hint:'Drag empty space: orbit · Right drag: pan · Wheel: zoom', pick:'Select a joint node or body part', locked:'Joint / floor limit reached', safe:'Joint limits · Floor guard', title:'Viewport editor', fineHint:'1° steps; Shift: 0.2°' },
}
export function clampEditorPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
    return { x: Math.max(8, Math.min(x, viewportWidth - width - 8)), y: Math.max(8, Math.min(y, viewportHeight - height - 8)) }
}

export function placeEditorBesideJoints(minX: number, maxX: number, width: number, viewportWidth: number) {
    const gap = 90
    if (maxX + gap + width <= viewportWidth - 8) return maxX + gap
    if (minX - width - gap >= 8) return minX - width - gap
    return viewportWidth - maxX >= minX ? Math.max(8, viewportWidth - width - 8) : 8
}

/** A transparent, actor-anchored branch menu. Only individual chips and joint
 * handles intercept input. No phone bottom sheet and no invisible modal hitbox. */
export function createViewportPoseEditor(options: Options) {
    const root = document.createElement('div'); root.id = 'viewport-editor'; root.dataset.i18nIgnore = 'true'
    const nodes = document.createElement('div'); nodes.className = 've-joints'
    const launch = document.createElement('button'); launch.id = 'viewport-editor-launch'; launch.type = 'button'; launch.onclick = () => options.place('translate')
    const dock = document.createElement('section'); dock.id = 'viewport-editor-dock'; dock.setAttribute('aria-label', 'Viewport branch editor')
    const wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); wires.classList.add('ve-branch-wires'); wires.setAttribute('aria-hidden','true')
    const wireLeft = document.createElementNS(wires.namespaceURI,'path'), wireRight = document.createElementNS(wires.namespaceURI,'path'); wires.append(wireLeft,wireRight)
    const left = document.createElement('nav'); left.className='ve-branch ve-branch-left'; left.setAttribute('aria-label','Pose tools')
    const right = document.createElement('nav'); right.className='ve-branch ve-branch-right'; right.setAttribute('aria-label','Object and pose modes')
    const header = document.createElement('header'); header.className='ve-drag-handle'
    const title=document.createElement('span');title.className='ve-branch-grip';title.textContent='⋮⋮'
    const focus=document.createElement('button');focus.type='button';focus.id='viewport-focus';focus.textContent='⌖';focus.onclick=()=>{custom=false;options.focus()}
    const collapse=document.createElement('button');collapse.type='button';collapse.id='viewport-editor-collapse';collapse.textContent='−';collapse.setAttribute('aria-expanded','true')
    let folded=false,showJoints=true,showFine=false
    collapse.onclick=()=>{folded=!folded;collapse.textContent=folded?'+':'−';collapse.setAttribute('aria-expanded',String(!folded));refresh()}
    header.append(title,focus,collapse);right.append(header)
    const controls=new Map<string,HTMLButtonElement>()
    const button=(parent:HTMLElement,id:string,action:()=>void)=>{const b=document.createElement('button');b.id='viewport-'+id;b.type='button';b.onclick=()=>{action();refresh()};controls.set(id,b);parent.append(b);return b}
    button(right,'pose',()=>{folded=false;showJoints=true;options.pose()})
    button(right,'object',()=>{showFine=false;options.place('translate')})
    button(right,'move',()=>options.state().pose?options.mode('translate'):options.place('translate'))
    button(right,'rotate',()=>options.state().pose?options.mode('rotate'):options.place('rotate'))
    const close=button(right,'editor-close',options.close);close.id='viewport-editor-close';close.className='ve-close'
    button(left,'joints',()=>{showJoints=!showJoints})
    button(left,'fine',()=>{showFine=!showFine})
    button(left,'parameters',options.parameters)
    const history=document.createElement('div');history.className='ve-history';left.append(history)
    button(history,'undo',options.undo);button(history,'redo',options.redo)
    button(left,'reset',options.reset)
    const selection=document.createElement('output');selection.id='viewport-editor-selection';left.prepend(selection)
    const guard=document.createElement('span');guard.className='ve-guard';guard.hidden=true;left.append(guard)
    const fine=document.createElement('fieldset');fine.id='viewport-editor-fine'
    const legend=document.createElement('legend');fine.append(legend)
    for(const axis of ['x','y','z'] as const){const row=document.createElement('div');row.className='ve-fine-axis';const label=document.createElement('span');label.textContent=axis.toUpperCase();row.append(label);for(const sign of [-1,1]){const b=document.createElement('button');b.type='button';b.dataset.nudgeAxis=axis;b.dataset.nudgeSign=String(sign);b.textContent=sign<0?'−1°':'+1°';b.setAttribute('aria-label',axis.toUpperCase()+' '+b.textContent);b.onclick=e=>options.nudge(axis,sign*(e.shiftKey?.valueOf()? .2:1));row.append(b)}fine.append(row)}
    left.append(fine)
    dock.append(wires,left,right);root.append(nodes,launch,dock);document.body.append(root)
    let actor:Object3D|undefined,parts:PosePart[]=[],lastKey='',custom=false,offsetX=0,offsetY=0
    let drag:{id:number;x:number;y:number;ox:number;oy:number}|undefined
    let nodeDrag:{id:number;button:HTMLButtonElement}|undefined
    const point=new Vector3()
    let rect=options.canvas.getBoundingClientRect()
    const stopNodes=(event?:PointerEvent)=>{if(!nodeDrag||event&&event.pointerId!==nodeDrag.id)return;const previous=nodeDrag;nodeDrag=undefined;options.end(event);if(previous.button.hasPointerCapture(previous.id))previous.button.releasePointerCapture(previous.id)}
    const buildNodes=()=>{
        stopNodes();nodes.replaceChildren();parts=actor?findDirectPoseParts(actor):[]
        for(const part of parts){const b=document.createElement('button');b.type='button';b.className='ve-joint-node';b.dataset.viewportJoint=part.id;const label=document.createElement('span');label.className='ve-joint-label';label.textContent=options.translate(part.label);b.title=label.textContent;b.setAttribute('aria-label',label.textContent);b.append(label)
            b.addEventListener('pointerdown',e=>{if(e.button!==0||nodeDrag)return;e.preventDefault();e.stopPropagation();if(options.begin(part,e)){nodeDrag={id:e.pointerId,button:b};b.setPointerCapture(e.pointerId)}refresh()})
            b.addEventListener('pointermove',e=>{if(nodeDrag?.id===e.pointerId)options.move(e)})
            for(const type of ['pointerup','pointercancel','lostpointercapture'] as const)b.addEventListener(type,stopNodes)
            b.onclick=e=>{if(e.detail===0){options.select(part);refresh()}};nodes.append(b)
        }
    }
    const layout=()=>{
        if(!options.state().active)return
        const viewport=window.visualViewport,top=Math.max(rect.top,viewport?.offsetTop??0,document.getElementById('menu')?.getBoundingClientRect().bottom??0)
        const view={x:Math.max(rect.left,viewport?.offsetLeft??0),y:top,width:Math.min(rect.width,viewport?.width??innerWidth),height:Math.min(rect.bottom,(viewport?.offsetTop??0)+(viewport?.height??innerHeight))-top}
        const projected:Array<{x:number;y:number}>=[]
        for(const part of parts){part.bone.getWorldPosition(point).project(options.camera);if(Math.abs(point.z)<=1)projected.push({x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2})}
        if(!projected.length){const anchor=options.state().object??actor;if(!anchor)return;anchor.getWorldPosition(point);point.y+=.7;point.project(options.camera);const x=rect.left+(point.x+1)*rect.width/2,y=rect.top+(1-point.y)*rect.height/2;projected.push({x:x-35,y:y-60},{x:x+35,y:y+60})}
        const minY=Math.min(...projected.map(p=>p.y)),maxY=Math.max(...projected.map(p=>p.y)),pad=Math.max(14,(maxY-minY)*.085)
        const body={x:Math.min(...projected.map(p=>p.x))-pad,y:minY-pad,width:Math.max(...projected.map(p=>p.x))-Math.min(...projected.map(p=>p.x))+2*pad,height:maxY-minY+2*pad}
        const plan=layoutViewportBranches(view,body,left.hidden?0:left.offsetHeight,right.offsetHeight)
        for(const [node,box] of [[left,plan.left],[right,plan.right]] as const){node.style.width=box.width+'px';const p=clampEditorPosition(box.x+(custom?offsetX:0),box.y+(custom?offsetY:0),box.width,node.offsetHeight,innerWidth,innerHeight);node.style.transform=`translate(${Math.round(p.x)}px,${Math.round(p.y)}px)`}
        dock.dataset.protectedRect=JSON.stringify(body);dock.dataset.compact=String(plan.compact)
        const centerY=body.y+body.height*.48,leftRect=left.getBoundingClientRect(),rightRect=right.getBoundingClientRect()
        wireLeft.setAttribute('d',left.hidden?'':`M ${body.x} ${centerY} Q ${leftRect.right+12} ${centerY} ${leftRect.right} ${leftRect.y+Math.min(60,leftRect.height/2)}`)
        wireRight.setAttribute('d',folded?'':`M ${body.x+body.width} ${centerY} Q ${rightRect.x-12} ${centerY} ${rightRect.x} ${rightRect.y+Math.min(60,rightRect.height/2)}`)
    }
    const refresh=()=>{
        const state=options.state()
        if(state.actor!==actor){actor=state.actor;custom=false;offsetX=offsetY=0;buildNodes();lastKey=''}
        const text=words[options.locale() as keyof typeof words]??words.en
        dock.hidden=!state.active;launch.hidden=state.active||!(state.object||state.actor);launch.textContent='✥ '+text.launch
        nodes.hidden=!(state.pose&&showJoints);left.hidden=folded||!state.pose;fine.hidden=!(showFine&&state.pose&&state.selected)
        dock.classList.toggle('is-collapsed',folded)
        for(const [id,b] of controls){b.hidden=folded;if(id==='object')b.hidden=folded||!state.pose;if(id==='reset')b.hidden=folded||!state.selected}
        close.hidden=false
        const key=[options.locale(),state.active,state.pose,state.mode,state.canTranslate,state.selected?.uuid,state.history?.canUndo,state.history?.canRedo,state.limited,showJoints,showFine,folded].join('|')
        if(key!==lastKey){lastKey=key
            for(const [id,b] of controls)b.textContent=text[id as keyof typeof text]||id
            if(folded)header.append(close);else right.append(close)
            close.textContent=folded?'×':options.locale()==='zh-CN'?'关闭 ✕':text.close;close.title=text.close;close.setAttribute('aria-label',text.close)
            guard.classList.toggle('is-limited',state.limited);guard.title=state.limited?text.locked:text.safe
            focus.title=options.locale()==='zh-CN'?'聚焦 / 腾出编辑空间':'Focus object';focus.setAttribute('aria-label',focus.title)
            collapse.title=options.locale()==='zh-CN'?'收起分支（保留编辑）':'Fold branches (keep editing)';collapse.setAttribute('aria-label',collapse.title)
            controls.get('pose')!.textContent=(options.locale()==='zh-CN'?'动作编辑':text.pose)+' ‹'
            controls.get('joints')!.textContent=(options.locale()==='zh-CN'?'主要关节':text.joints)+(showJoints?' ●':' ○')
            controls.get('pose')!.disabled=!actor
            controls.get('move')!.disabled=state.pose&&!state.canTranslate
            for(const id of ['move','rotate'])controls.get(id)!.setAttribute('aria-pressed',String(state.mode===(id==='move'?'translate':'rotate')))
            controls.get('pose')!.setAttribute('aria-pressed',String(state.pose));controls.get('object')!.setAttribute('aria-pressed',String(!state.pose))
            controls.get('joints')!.setAttribute('aria-pressed',String(showJoints));controls.get('fine')!.setAttribute('aria-expanded',String(showFine))
            controls.get('fine')!.disabled=!state.selected;controls.get('reset')!.hidden=folded||!state.selected
            controls.get('undo')!.disabled=!state.history?.canUndo;controls.get('redo')!.disabled=!state.history?.canRedo
            history.hidden=!state.history?.canUndo&&!state.history?.canRedo
            legend.textContent=options.locale()==='zh-CN'?'微调 1°':text.fine
            const part=parts.find(p=>p.bone===state.selected);selection.textContent=part?options.translate(part.label):state.selected?.name||text.pick;selection.title=state.limited?text.locked:text.safe
            for(let i=0;i<parts.length;i++){const b=nodes.children[i] as HTMLButtonElement;b.setAttribute('aria-pressed',String(parts[i].bone===state.selected));b.querySelector('span')!.textContent=options.translate(parts[i].label)}
        }
        layout()
    }
    header.addEventListener('pointerdown',e=>{if(e.button!==0||(e.target as Element).closest('button'))return;custom=true;drag={id:e.pointerId,x:e.clientX,y:e.clientY,ox:offsetX,oy:offsetY};header.setPointerCapture(e.pointerId);e.preventDefault()})
    header.addEventListener('pointermove',e=>{if(drag?.id!==e.pointerId)return;offsetX=drag.ox+e.clientX-drag.x;offsetY=drag.oy+e.clientY-drag.y;layout()})
    const stopDock=()=>{drag=undefined};for(const type of ['pointerup','pointercancel','lostpointercapture'])header.addEventListener(type,stopDock)
    const resize=()=>{rect=options.canvas.getBoundingClientRect();custom=false;refresh()}
    const observer=new ResizeObserver(resize);observer.observe(options.canvas);window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize)
    const blur=()=>{stopDock();stopNodes()};window.addEventListener('blur',blur);document.addEventListener('magius:localechange',refresh)
    const update=()=>{refresh();if(!options.state().pose||!showJoints)return;for(let i=0;i<parts.length;i++){const b=nodes.children[i] as HTMLButtonElement;parts[i].bone.getWorldPosition(point).project(options.camera);const x=rect.left+(point.x+1)*rect.width/2,y=rect.top+(1-point.y)*rect.height/2;b.hidden=Math.abs(point.z)>1||x<rect.left||x>rect.right||y<rect.top||y>rect.bottom;if(!b.hidden)b.style.transform=`translate(${Math.round(x)}px,${Math.round(y)}px)`}}
    refresh()
    return {update,refresh,reposition(){custom=false;refresh()},dispose(){stopNodes();observer.disconnect();window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);window.removeEventListener('blur',blur);document.removeEventListener('magius:localechange',refresh);root.remove()}}
}
