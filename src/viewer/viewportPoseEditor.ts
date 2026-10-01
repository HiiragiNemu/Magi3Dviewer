import { Camera, Object3D, Vector3 } from 'three'
import { groupedPoseParts, nodePath, poseNodePages, posePartLabel, poseCategoryLabel, posePageLabel, type PoseNodePage, type PoseNodeGroup } from './poseWorkspace'
import type { PosePart } from './directPoseTools'

export interface ViewportEditorState {
    actor?: Object3D; object?: Object3D; pose: boolean; active: boolean
    mode: 'translate' | 'rotate'; selected?: Object3D; group: PoseNodeGroup; stretch: boolean
    history?: { readonly canUndo: boolean; readonly canRedo: boolean }; limited: boolean; canTranslate: boolean
}
interface Options {
    state(): ViewportEditorState; camera: Camera | (() => Camera); canvas: HTMLElement
    translate(text: string): string; locale(): string
    place(mode: 'translate' | 'rotate'): void; pose(): void; mode(mode: 'translate' | 'rotate'): void
    close(): void; parameters(): void; focus(): void; focusPart(parts: PosePart[]): void
    select(part: PosePart): void; begin(part: PosePart, event: PointerEvent): boolean
    move(event: PointerEvent): void; end(event?: PointerEvent): void
    undo(): void; redo(): void; reset(): void; nudge(axis: 'x' | 'y' | 'z', amount: number): void
    group(value: PoseNodeGroup): void; fineHost: HTMLElement; resetAll(): void; save(): void
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
/** Projection never performs label repulsion. The dot is the real joint origin,
 * using the same finalized world/view matrices as the rendered model. */
export function projectPoseAnchor(bone: Object3D, camera: Camera, rect: {left:number;top:number;width:number;height:number}) {
    camera.updateWorldMatrix(true, false)
    const p = bone.getWorldPosition(new Vector3()).project(camera)
    return { x: rect.left+(p.x+1)*rect.width/2, y: rect.top+(1-p.y)*rect.height/2, z:p.z }
}
const labels = {
    'zh-CN': {joints:'主要节点',hands:'手部节点',more:'更多节点',parameters:'参数面板',undo:'撤销',redo:'重做',reset:'重置部位','reset-all':'重置全部',save:'保存姿态',pose:'动作编辑',object:'整体摆放',move:'XYZ 移动',rotate:'旋转环','editor-close':'关闭',focus:'聚焦全身','focus-detail':'聚焦部位',collapse:'收起编辑按钮',grip:'拖动布置；双击恢复位置；方向键微调'},
    'ja-JP': {joints:'主要関節',hands:'指の関節',more:'その他',parameters:'詳細',undo:'元に戻す',redo:'やり直す',reset:'部位リセット','reset-all':'全体リセット',save:'保存',pose:'ポーズ',object:'全体配置',move:'XYZ 移動',rotate:'回転','editor-close':'閉じる',focus:'全身へ','focus-detail':'部位へ',collapse:'折り畳む',grip:'ドラッグで配置・ダブルクリックで戻す・矢印キーで微調整'},
    en: {joints:'Main nodes',hands:'Hand nodes',more:'More nodes',parameters:'Parameters',undo:'Undo',redo:'Redo',reset:'Reset part','reset-all':'Reset pose',save:'Save pose',pose:'Pose edit',object:'Place object',move:'Move XYZ',rotate:'Rotate','editor-close':'Close',focus:'Frame actor','focus-detail':'Frame part',collapse:'Fold controls',grip:'Drag to arrange; double-click to restore; arrow keys to nudge'},
}
interface Chip {key:string;root:HTMLDivElement;control:HTMLElement;grip:HTMLButtonElement;x:number;y:number;width:number;height:number;homeX:number;homeY:number}
const LAYOUT_KEY='magius.viewport-chip-layout.v1'
/** Independent fit-content chips, not a modal tray. Only actual controls claim
 * pointer input. Layout handles move UI only; joint buttons still edit pose. */
export function createViewportPoseEditor(options: Options) {
    const abort=new AbortController(),events={signal:abort.signal}
    const root=document.createElement('div');root.id='viewport-editor';root.dataset.i18nIgnore='true';root.className='ve-compact-chips'
    const dock=document.createElement('section');dock.id='viewport-editor-dock'
    const left=document.createElement('nav');left.className='ve-branch ve-branch-left';left.setAttribute('aria-label','Pose tools')
    const right=document.createElement('nav');right.className='ve-branch ve-branch-right';right.setAttribute('aria-label','Object and pose modes')
    const detailPanel=document.createElement('section');detailPanel.id='viewport-node-panel';detailPanel.setAttribute('aria-label','Named joint controls')
    const chooser=document.createElement('div');chooser.className='ve-node-chooser'
    const nodes=document.createElement('div');nodes.className='ve-joints'
    const lines=document.createElementNS('http://www.w3.org/2000/svg','svg');lines.classList.add('ve-node-lines');lines.setAttribute('aria-hidden','true')
    const selection=document.createElement('output');selection.id='viewport-editor-selection'
    dock.append(left,right,selection);detailPanel.append(chooser,nodes);root.append(lines,detailPanel,dock);document.body.append(root)
    const chips=new Map<string,Chip>(),buttons=new Map<string,HTMLButtonElement>()
    let nodeAbort=new AbortController(),jointChips:Chip[]=[],projectionSignatures:string[]=[]
    let jointVisuals:Array<{line:SVGLineElement;dot:SVGCircleElement;hit:SVGCircleElement}>=[]
    let preferences:Record<string,{x:number;y:number}>={}
    try {const p=JSON.parse(localStorage.getItem(LAYOUT_KEY)||'{}');if(p&&typeof p==='object'&&!Array.isArray(p))preferences=p} catch { /* Storage may be unavailable; editing is still usable. */ }
    let layoutDrag:{chip:Chip;id:number;x:number;y:number;startX:number;startY:number}|undefined
    let nodeDrag:{id:number;button:Element}|undefined
    let actor:Object3D|undefined,group:PoseNodeGroup='primary',parts:PosePart[]=[],pages:PoseNodePage[]=[],page=0,folded=false,lastKey='',wasPose=false,layoutDirty=true
    const primaryHomes=new Map<string,{x:number;y:number}>()
    let rect=options.canvas.getBoundingClientRect(),top=0,bottom=innerHeight,viewWidth=innerWidth
    const text=()=>labels[options.locale() as keyof typeof labels]??labels.en
    const camera=()=>typeof options.camera==='function'?options.camera():options.camera
    const persist=(c:Chip)=>{preferences[c.key]={x:c.x/Math.max(1,viewWidth-c.width),y:(c.y-top)/Math.max(1,bottom-top-c.height)};try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(preferences))}catch{}}
    const place=(c:Chip,x:number,y:number)=>{
        c.x=Math.max(4,Math.min(x,viewWidth-c.width-4));c.y=Math.max(top+4,Math.min(y,bottom-c.height-4))
        c.root.style.transform=`translate(${c.x}px,${c.y}px)`
    }
    const makeChip=(host:HTMLElement,key:string,control:HTMLElement):Chip=>{
        const chipEvents=host===nodes?{signal:nodeAbort.signal}:events
        const div=document.createElement('div');div.className='ve-chip';div.dataset.layoutKey=key
        const grip=document.createElement('button');grip.type='button';grip.className='ve-chip-grip';grip.textContent='⠿'
        const c:Chip={key,root:div,control,grip,x:0,y:0,width:0,height:0,homeX:0,homeY:0};div.append(grip,control);host.append(div);chips.set(key,c)
        const swallow=(e:Event)=>{e.preventDefault();e.stopPropagation()}
        grip.addEventListener('pointerdown',e=>{if(e.button!==0||layoutDrag||nodeDrag)return;swallow(e);layoutDrag={chip:c,id:e.pointerId,x:e.clientX,y:e.clientY,startX:c.x,startY:c.y};grip.setPointerCapture(e.pointerId);div.classList.add('is-arranging')},chipEvents)
        grip.addEventListener('pointermove',e=>{if(layoutDrag?.id!==e.pointerId)return;swallow(e);place(c,layoutDrag.startX+e.clientX-layoutDrag.x,layoutDrag.startY+e.clientY-layoutDrag.y)},chipEvents)
        const stop=(e:PointerEvent)=>{if(layoutDrag?.id!==e.pointerId)return;swallow(e);layoutDrag=undefined;div.classList.remove('is-arranging');persist(c);if(grip.hasPointerCapture(e.pointerId))grip.releasePointerCapture(e.pointerId)}
        for(const type of ['pointerup','pointercancel','lostpointercapture'] as const)grip.addEventListener(type,stop,chipEvents)
        grip.addEventListener('click',swallow,chipEvents)
        grip.addEventListener('dblclick',e=>{swallow(e);delete preferences[c.key];place(c,c.homeX,c.homeY);try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(preferences))}catch{}},chipEvents)
        grip.addEventListener('keydown',e=>{const v=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[e.key];if(!v)return;swallow(e);place(c,c.x+v[0]*(e.shiftKey?1:8),c.y+v[1]*(e.shiftKey?1:8));persist(c)},chipEvents)
        return c
    }
    const tool=(host:HTMLElement,id:string,action:()=>void)=>{
        const b=document.createElement('button');b.type='button';b.id='viewport-'+id;b.className='ve-tool-button'
        b.onclick=()=>{action();lastKey='';refresh()};buttons.set(id,b);makeChip(host,'tool:'+id,b);return b
    }
    const changeGroup=(value:PoseNodeGroup)=>{page=0;options.group(value)}
    tool(left,'joints',()=>changeGroup('primary'));tool(left,'hands',()=>changeGroup('hands'));tool(left,'more',()=>changeGroup('more'))
    tool(left,'parameters',options.parameters);tool(left,'undo',options.undo);tool(left,'redo',options.redo)
    tool(left,'reset',options.reset);tool(left,'reset-all',options.resetAll);tool(left,'save',options.save)
    tool(right,'focus',()=>options.focus()).textContent='⌖'
    const collapse=tool(right,'editor-collapse',()=>{folded=!folded;layoutDirty=true});collapse.textContent='−'
    tool(right,'pose',()=>{folded=false;options.pose()});tool(right,'object',()=>options.place('translate'))
    tool(right,'move',()=>options.state().pose?options.mode('translate'):options.place('translate'))
    tool(right,'rotate',()=>options.state().pose?options.mode('rotate'):options.place('rotate'))
    tool(right,'editor-close',options.close).classList.add('ve-close')
    const category=document.createElement('select');category.id='viewport-node-category'
    const chain=document.createElement('select');chain.id='viewport-node-chain'
    makeChip(chooser,'chooser:category',category);makeChip(chooser,'chooser:chain',chain)
    tool(chooser,'focus-detail',()=>{options.focusPart(parts);layoutDirty=true})
    // Explicit focus only. Changing a page changes selection, never the camera.
    const changePage=()=>{buildNodes();if(parts[0])options.select(parts[0]);lastKey='';refresh()}
    category.onchange=()=>{page=Math.max(0,pages.findIndex(p=>p.category===category.value));changePage()}
    chain.onchange=()=>{page=Number(chain.value);changePage()}
    const fine=document.createElement('fieldset');fine.id='viewport-editor-fine'
    const legend=document.createElement('legend');legend.textContent='微调 1°';fine.append(legend)
    for(const axis of ['x','y','z'] as const){const row=document.createElement('div');row.className='ve-fine-axis';const label=document.createElement('span');label.textContent=axis.toUpperCase();row.append(label);for(const sign of [-1,1]){const b=document.createElement('button');b.type='button';b.dataset.nudgeAxis=axis;b.dataset.nudgeSign=String(sign);b.textContent=sign<0?'−1°':'+1°';b.onclick=e=>options.nudge(axis,sign*(e.shiftKey ? .2 : 1));row.append(b)}fine.append(row)}
    const fineDetails=document.createElement('details');fineDetails.id='pose-fine-panel';const summary=document.createElement('summary');summary.textContent='部位微调（角度）';fineDetails.append(summary,fine);options.fineHost.append(fineDetails)
    const stopNodes=(event?:PointerEvent)=>{if(!nodeDrag||event&&event.pointerId!==nodeDrag.id)return;const previous=nodeDrag;nodeDrag=undefined;options.end(event);if(previous.button.hasPointerCapture(previous.id))previous.button.releasePointerCapture(previous.id)}
    const buildNodes=()=>{
        stopNodes();nodeAbort.abort();nodeAbort=new AbortController();jointChips=[];projectionSignatures=[];jointVisuals=[];primaryHomes.clear();for(const [key,c]of chips)if(c.root.parentElement===nodes)chips.delete(key);nodes.replaceChildren();lines.replaceChildren()
        pages=actor?poseNodePages(actor,group):[];page=Math.max(0,Math.min(page,pages.length-1));parts=group==='primary'&&actor?groupedPoseParts(actor,group):pages[page]?.parts??[]
        const current=pages[page],locale=options.locale()
        category.replaceChildren(...[...new Set(pages.map(p=>p.category))].map(value=>{const o=document.createElement('option');o.value=value;o.textContent=poseCategoryLabel(value,locale);return o}))
        category.value=current?.category??'';category.setAttribute('aria-label',locale==='zh-CN'?(group==='hands'?'选择左手或右手':'选择部件类别'):'Node category')
        chain.replaceChildren(...pages.flatMap((p,i)=>{if(p.category!==current?.category)return[];const o=document.createElement('option');o.value=String(i);o.textContent=posePageLabel(p,locale);return[o]}));chain.value=String(page);chain.setAttribute('aria-label',locale==='zh-CN'?'选择部件链':'Joint chain')
        detailPanel.dataset.chain=current?.id??'';nodes.dataset.group=group;nodes.dataset.total=String(parts.length)
        const modelName=actor?.getObjectByName('Root')?.parent?.name||actor?.name||'actor'
        for(const part of parts){
            const b=document.createElement('button');b.type='button';b.className='ve-joint-node';b.dataset.viewportJoint=part.id;b.dataset.boneUuid=part.bone.uuid
            const label=document.createElement('span');label.className='ve-joint-label';const fullLabel=posePartLabel(part,locale);label.textContent=group==='hands'?fullLabel.replace(/ · 第 (\d+) 节/,'$1').replace(' · 掌骨／起点','根'):fullLabel;b.append(label);b.title=fullLabel+' · '+part.bone.name;b.setAttribute('aria-label',fullLabel)
            const key='node:'+modelName+':'+(group==='primary'?part.id:nodePath(part.bone,actor!));jointChips.push(makeChip(nodes,key,b));const nodeEvents={signal:nodeAbort.signal}
            b.addEventListener('pointerdown',e=>{if(e.button!==0||nodeDrag||layoutDrag)return;e.preventDefault();e.stopPropagation();if(options.begin(part,e)){nodeDrag={id:e.pointerId,button:b};b.setPointerCapture(e.pointerId)}lastKey='';refresh()},nodeEvents)
            b.addEventListener('pointermove',e=>{if(nodeDrag?.id===e.pointerId)options.move(e)},nodeEvents)
            for(const type of ['pointerup','pointercancel','lostpointercapture'] as const)b.addEventListener(type,stopNodes,nodeEvents)
            b.onclick=e=>{if(e.detail===0){options.select(part);lastKey='';refresh()}}
            const namespace='http://www.w3.org/2000/svg'
            const line=document.createElementNS(namespace,'line'),dot=document.createElementNS(namespace,'circle'),hit=document.createElementNS(namespace,'circle')
            line.setAttribute('data-bone-uuid',part.bone.uuid);dot.setAttribute('data-bone-uuid',part.bone.uuid);dot.setAttribute('r','3.5')
            hit.classList.add('ve-anchor-hit');hit.setAttribute('r','10');hit.dataset.anchorBone=part.bone.uuid
            const title=document.createElementNS(namespace,'title');title.textContent=fullLabel;hit.append(title)
            // Preserve direct point dragging as a shortcut, while the always-
            // named chip remains the larger, unambiguous keyboard/touch target.
            hit.addEventListener('pointerdown',e=>{if(e.button!==0||nodeDrag||layoutDrag)return;e.preventDefault();e.stopPropagation();if(options.begin(part,e)){nodeDrag={id:e.pointerId,button:hit};hit.setPointerCapture(e.pointerId)}lastKey='';refresh()},nodeEvents)
            hit.addEventListener('pointermove',e=>{if(nodeDrag?.id===e.pointerId)options.move(e)},nodeEvents)
            for(const type of ['pointerup','pointercancel','lostpointercapture'] as const)hit.addEventListener(type,stopNodes,nodeEvents)
            lines.append(line,dot,hit);jointVisuals.push({line,dot,hit})
        }
        layoutDirty=true
    }
    const isHidden=(c:Chip)=>c.root.hidden||c.control.hidden
    const layout=()=>{
        rect=options.canvas.getBoundingClientRect();const viewport=window.visualViewport
        top=Math.max(rect.top,viewport?.offsetTop??0,document.getElementById('menu')?.getBoundingClientRect().bottom??0)
        bottom=Math.min(rect.bottom,(viewport?.offsetTop??0)+(viewport?.height??innerHeight));viewWidth=Math.min(innerWidth,rect.right)
        const visible=[...chips.values()].filter(c=>!isHidden(c));for(const c of visible){const r=c.root.getBoundingClientRect();c.width=r.width;c.height=r.height}
        const gap=4,wide=viewWidth>=700
        const assign=(c:Chip,x:number,y:number)=>{c.homeX=x;c.homeY=y;const saved=preferences[c.key];if(layoutDrag?.chip===c)return;if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))place(c,saved.x*(viewWidth-c.width),top+saved.y*(bottom-top-c.height));else place(c,x,y)}
        const toolChips=visible.filter(c=>c.root.parentElement===left||c.root.parentElement===right)
        let toolsBottom=top+4
        if(wide){
            for(const host of [left,right]){let y=top+8;for(const c of toolChips.filter(c=>c.root.parentElement===host)){assign(c,host===left?8:viewWidth-c.width-8,y);y+=c.height+gap}toolsBottom=Math.max(toolsBottom,y)}
        }else{
            // Compact wrapping controls occupy only their text+grip, not two tall
            // full-width columns. The center remains free for orbit gestures.
            let x=8,y=top+6,rowHeight=0
            for(const c of toolChips){if(x+c.width>viewWidth-8){x=8;y+=rowHeight+gap;rowHeight=0}assign(c,x,y);x+=c.width+gap;rowHeight=Math.max(rowHeight,c.height)}toolsBottom=y+rowHeight+8
        }
        const nodeChips=visible.filter(c=>c.root.parentElement===nodes)
        if(group==='primary'){
            if(!primaryHomes.size){
                const ranked=nodeChips.map(c=>({c,p:projectPoseAnchor(parts.find(p=>p.bone.uuid===c.control.dataset.boneUuid)!.bone,camera(),rect)})).sort((a,b)=>a.p.x-b.p.x)
                const mid=Math.ceil(ranked.length/2),minX=Math.min(...ranked.map(r=>r.p.x)),maxX=Math.max(...ranked.map(r=>r.p.x))
                const start=wide?top+10:toolsBottom,last=bottom-10
                const spacing=Math.max(...nodeChips.map(c=>c.height),28)+4,maxWidth=Math.max(...nodeChips.map(c=>c.width))
                const lanes=viewWidth>=480&&mid*spacing>last-start?2:1
                for(const [column,side]of [ranked.slice(0,mid),ranked.slice(mid)].entries()){
                    side.sort((a,b)=>a.p.y-b.p.y)
                    for(let lane=0;lane<lanes;lane++){
                        const list=side.filter((_,i)=>i%lanes===lane)
                        const ys=list.map(r=>Math.max(start,Math.min(r.p.y-r.c.height/2,last-r.c.height)))
                        for(let i=1;i<ys.length;i++)ys[i]=Math.max(ys[i],ys[i-1]+spacing)
                        if(ys.length&&ys.at(-1)!+list.at(-1)!.c.height>last){ys[ys.length-1]=last-list.at(-1)!.c.height;for(let i=ys.length-2;i>=0;i--)ys[i]=Math.min(ys[i],ys[i+1]-spacing)}
                        list.forEach(({c},i)=>{let x:number
                            if(lanes===2)x=column===0?(wide?120:8)+lane*(maxWidth+6):viewWidth-c.width-(wide?120:8)-lane*(maxWidth+6)
                            else x=column===0?(wide?Math.max(120,minX-150-c.width):8):(wide?Math.min(viewWidth-c.width-120,maxX+150):viewWidth-c.width-8)
                            primaryHomes.set(c.key,{x,y:ys[i]})
                        })
                    }
                }
            }
            nodeChips.forEach(c=>{const home=primaryHomes.get(c.key)!;assign(c,home.x,home.y)})
        }else{
            const chooserChips=visible.filter(c=>c.root.parentElement===chooser)
            const maxW=wide?Math.min(600,viewWidth-260):viewWidth-16
            const startX=(viewWidth-maxW)/2
            const pack=(items:Chip[],y:number)=>{let x=startX,row=0;for(const c of items){if(x+c.width>startX+maxW+.5){x=startX;y+=row+gap;row=0}assign(c,x,y);x+=c.width+gap;row=Math.max(row,c.height)}return y+row}
            // Reserve only the actual chip rows. No surrounding panel, padding
            // frame or instructional footer intercepts the canvas.
            const countRows=Math.max(1,Math.ceil(nodeChips.reduce((n,c)=>n+c.width+gap,0)/maxW))
            let y=Math.max(wide?top+10:toolsBottom,bottom-(countRows+2)*38-8)
            y=pack(chooserChips,y)+gap;pack(nodeChips,y)
        }
        selection.hidden=true // The selected chip is already named and highlighted.
        layoutDirty=false
    }
    const refresh=()=>{
        const state=options.state();lines.style.display=state.pose&&!folded?'':'none';root.hidden=!state.active;dock.hidden=!state.active;detailPanel.hidden=!state.pose||folded;fine.disabled=!state.pose||!state.selected
        if(state.actor!==actor||(state.pose&&!wasPose)||state.group!==group){actor=state.actor;group=state.group;page=0;buildNodes();lastKey=''}wasPose=state.pose
        const key=[state.active,state.pose,state.group,state.selected?.uuid,state.mode,state.canTranslate,state.history?.canUndo,state.history?.canRedo,folded,options.locale()].join('|')
        if(key!==lastKey){lastKey=key;const t=text()
            for(const[id,b]of buttons){const c=chips.get('tool:'+id)!;let show=!folded
                if(['joints','hands','more','save'].includes(id))show=show&&state.pose
                if(id==='reset')show=show&&state.pose&&!!state.selected
                if(id==='object')show=show&&state.pose
                if(id==='focus-detail')show=show&&state.pose&&group!=='primary'
                if(id==='editor-close'||id==='editor-collapse')show=true
                c.root.hidden=!show;b.hidden=false
                b.textContent=id==='focus'?'⌖':id==='editor-collapse'?(folded?'+':'−'):t[id as keyof typeof t]||id
                b.title=id==='editor-collapse'?t.collapse:t[id as keyof typeof t]||id;b.setAttribute('aria-label',b.title)
            }
            collapse.setAttribute('aria-expanded',String(!folded))
            for(const[id,g]of[['joints','primary'],['hands','hands'],['more','more']] as const){const b=buttons.get(id)!;b.setAttribute('aria-pressed',String(group===g));b.disabled=!actor||!groupedPoseParts(actor,g).length}
            buttons.get('pose')!.disabled=!actor;buttons.get('pose')!.setAttribute('aria-pressed',String(state.pose))
            buttons.get('object')!.setAttribute('aria-pressed',String(!state.pose));buttons.get('move')!.disabled=state.pose&&!state.canTranslate
            buttons.get('move')!.setAttribute('aria-pressed',String(state.mode==='translate'));buttons.get('rotate')!.setAttribute('aria-pressed',String(state.mode==='rotate'))
            buttons.get('undo')!.disabled=!state.history?.canUndo;buttons.get('redo')!.disabled=!state.history?.canRedo
            for(const c of chips.values()){
                if(c.root.parentElement===nodes){c.root.hidden=!state.pose||folded;c.control.setAttribute('aria-pressed',String(c.control.dataset.boneUuid===state.selected?.uuid));c.grip.setAttribute('aria-label',t.grip+' · '+c.control.textContent)}
                else c.grip.setAttribute('aria-label',t.grip+' · '+(c.control.getAttribute('aria-label')||c.control.textContent))
                c.grip.title=t.grip
            }
            for(const id of ['chooser:category','chooser:chain'])chips.get(id)!.root.hidden=!state.pose||folded||group==='primary'
            layoutDirty=true
        }
        if(layoutDirty&&!root.hidden)layout()
    }
    const update=()=>{
        refresh();if(root.hidden||!options.state().pose||folded)return
        const cam=camera();cam.updateWorldMatrix(true,false)
        // Re-read canvas bounds after menu/browser viewport movement, without
        // reflowing or repelling controls on every camera change.
        rect=options.canvas.getBoundingClientRect()
        const selected=options.state().selected
        for(let i=0;i<parts.length;i++){
            const part=parts[i],c=jointChips[i];if(!c)continue
            const p=projectPoseAnchor(part.bone,cam,rect),{line,dot,hit}=jointVisuals[i]
            const visible=Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.z)<=1&&p.x>=rect.left&&p.x<=rect.right&&p.y>=top&&p.y<=bottom
            const signature=[p.x.toFixed(3),p.y.toFixed(3),p.z.toFixed(5),c.x,c.y,c.width,c.height,visible,part.bone===selected].join('|')
            if(projectionSignatures[i]===signature)continue
            projectionSignatures[i]=signature
            line.setAttribute('visibility',visible?'visible':'hidden');dot.setAttribute('visibility',visible?'visible':'hidden');hit.setAttribute('visibility',visible?'visible':'hidden')
            c.root.classList.toggle('anchor-offscreen',!visible);c.root.classList.toggle('is-selected',part.bone===selected)
            c.control.dataset.anchorX=String(p.x);c.control.dataset.anchorY=String(p.y);c.control.dataset.anchorZ=String(p.z)
            if(!visible)continue
            // A leader attaches at the nearest point on the chip boundary.
            const x=Math.max(c.x,Math.min(p.x,c.x+c.width)),y=Math.max(c.y,Math.min(p.y,c.y+c.height))
            line.setAttribute('x1',String(p.x));line.setAttribute('y1',String(p.y));line.setAttribute('x2',String(x));line.setAttribute('y2',String(y));line.setAttribute('class',part.bone===selected?'is-selected':'')
            dot.setAttribute('cx',String(p.x));dot.setAttribute('cy',String(p.y));dot.setAttribute('class',part.bone===selected?'is-selected':'');hit.setAttribute('cx',String(p.x));hit.setAttribute('cy',String(p.y))
        }
    }
    const resize=()=>{primaryHomes.clear();layoutDirty=true;refresh()}
    const observer=new ResizeObserver(resize);observer.observe(options.canvas);const menu=document.getElementById('menu');if(menu)observer.observe(menu)
    window.addEventListener('resize',resize,events);window.visualViewport?.addEventListener('resize',resize,events);window.visualViewport?.addEventListener('scroll',resize,events)
    window.addEventListener('blur',()=>{stopNodes();if(layoutDrag){persist(layoutDrag.chip);layoutDrag.chip.root.classList.remove('is-arranging');layoutDrag=undefined}},events)
    document.addEventListener('magius:localechange',()=>{buildNodes();lastKey='';refresh()},events)
    refresh()
    return {update,refresh,reposition(){primaryHomes.clear();layoutDirty=true;refresh()},dispose(){stopNodes();nodeAbort.abort();abort.abort();observer.disconnect();fineDetails.remove();root.remove()}}
}
