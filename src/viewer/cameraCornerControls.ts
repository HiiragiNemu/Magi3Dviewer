interface Hooks {focus():void;roll(degrees:number):void;reset():void;angle():number;locale():string}

/** One roll control on both mouse and touch: drag horizontally to rotate, tap
 * to level the horizon. Keyboard arrows rotate; Home/Enter/Space level it. */
export function createCameraCornerControls(hooks:Hooks){
    const root=document.createElement('nav');root.id='camera-corner-controls';root.dataset.i18nIgnore='true'
    root.setAttribute('aria-label','Camera framing and optical roll')
    const abort=new AbortController(),options={signal:abort.signal}
    const roll=document.createElement('button');roll.type='button';roll.id='camera-roll-control';roll.setAttribute('role','slider');roll.setAttribute('aria-valuemin','-180');roll.setAttribute('aria-valuemax','180');roll.setAttribute('aria-orientation','horizontal')
    const label=document.createElement('span'),value=document.createElement('output');value.setAttribute('aria-hidden','true');roll.append(label,value)
    const focus=document.createElement('button');focus.type='button';focus.id='camera-frame-actor';focus.textContent='⌖';focus.onclick=hooks.focus
    roll.dataset.viewportObstacle='true';focus.dataset.viewportObstacle='true'
    root.append(roll,focus);document.body.append(root)
    let drag:{id:number;start:number;last:number;moved:boolean}|undefined,lastValue=''
    const update=()=>{
        const angle=((hooks.angle()+180)%360+360)%360-180,display=Math.abs(angle)<.05?'0':String(Math.round(angle*10)/10)
        const key=display+'|'+Boolean(drag?.moved)+'|'+hooks.locale();if(key===lastValue)return;lastValue=key
        value.textContent=drag?.moved?display+'°':hooks.locale()==='zh-CN'?'点按回正':hooks.locale()==='ja-JP'?'タップで水平':'Tap to level';roll.setAttribute('aria-valuenow',display);roll.setAttribute('aria-valuetext',display+'°')
    }
    const localize=()=>{
        const zh=hooks.locale()==='zh-CN',ja=hooks.locale()==='ja-JP'
        label.textContent=zh?'拖动旋转':ja?'ドラッグ回転':'Drag to roll'
        roll.title=zh?'左右拖动旋转画面；点按恢复水平。键盘方向键旋转，Home 回正。':ja?'左右ドラッグで回転・タップで水平に戻す':'Drag left/right to roll; tap to level. Arrow keys rotate; Home resets.'
        roll.setAttribute('aria-label',roll.title)
        focus.title=zh?'聚焦当前角色（一次）':ja?'選択モデル全体へ':'Frame selected actor once';focus.setAttribute('aria-label',focus.title)
        update()
    }
    roll.addEventListener('pointerdown',event=>{
        if(event.button!==0||drag)return
        event.preventDefault();event.stopPropagation();roll.focus({preventScroll:true})
        drag={id:event.pointerId,start:event.clientX,last:event.clientX,moved:false};roll.setPointerCapture(event.pointerId)
    },options)
    roll.addEventListener('pointermove',event=>{
        if(drag?.id!==event.pointerId)return
        event.preventDefault();event.stopPropagation()
        if(!drag.moved&&Math.abs(event.clientX-drag.start)<4)return
        drag.moved=true;roll.classList.add('is-dragging');hooks.roll((event.clientX-drag.last)*.5);drag.last=event.clientX;update()
    },options)
    const release=(event:PointerEvent)=>{
        if(drag?.id!==event.pointerId)return
        const previous=drag;drag=undefined;roll.classList.remove('is-dragging')
        if(event.type==='pointerup'&&!previous.moved){hooks.reset();update()}
        if(roll.hasPointerCapture(event.pointerId))roll.releasePointerCapture(event.pointerId)
        event.preventDefault();event.stopPropagation()
    }
    for(const name of ['pointerup','pointercancel','lostpointercapture'] as const)roll.addEventListener(name,release,options)
    roll.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(event.detail===0){hooks.reset();update()}},options)
    roll.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation()},options)
    roll.addEventListener('keydown',event=>{
        if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();hooks.roll((event.key==='ArrowLeft'?-1:1)*(event.shiftKey?15:5));update()}
        else if(event.key==='Home'){event.preventDefault();event.stopPropagation();hooks.reset();update()}
    },options)
    const layout=()=>{
        const canvas=document.querySelector('#workspace canvas')??document.querySelector('canvas')
        const top=Math.max(canvas?.getBoundingClientRect().top??0,document.getElementById('menu')?.getBoundingClientRect().bottom??0,window.visualViewport?.offsetTop??0)
        root.style.top=(top+8)+'px';root.style.bottom='auto'
        document.dispatchEvent(new window.Event('magius:camera-controls-layout'))
    }
    const resize=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(layout)
    const menu=document.getElementById('menu');if(menu)resize?.observe(menu)
    window.addEventListener('resize',layout,options);window.visualViewport?.addEventListener('resize',layout,options);window.visualViewport?.addEventListener('scroll',layout,options)
    window.addEventListener('blur',()=>{if(drag){const id=drag.id;drag=undefined;if(roll.hasPointerCapture(id))roll.releasePointerCapture(id)}roll.classList.remove('is-dragging')},options)
    document.addEventListener('magius:localechange',localize,options);localize();layout()
    return{update,dispose(){abort.abort();resize?.disconnect();root.remove()}}
}
