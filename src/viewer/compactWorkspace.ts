import './style/compact-workspace.css'

export function setupOrientationToggle(button:HTMLButtonElement) {
    let landscape=false,pending=false
    const paint=()=>{button.setAttribute('aria-pressed',String(landscape));button.title=landscape?'恢复竖屏':'横屏 / 全屏';button.setAttribute('aria-label',button.title);button.dataset.orientation=landscape?'landscape':'portrait'}
    button.dataset.i18nIgnore='true'
    button.onclick=async()=>{
        if(pending)return;pending=true;button.disabled=true
        const orientation=screen.orientation as ScreenOrientation & {lock?:(value:string)=>Promise<void>}
        try{
            if(!landscape){
                if(!document.fullscreenElement)await document.documentElement.requestFullscreen()
                if(orientation.lock)await orientation.lock('landscape')
                landscape=true
            }else{
                if(orientation.lock)await orientation.lock('portrait').catch(()=>{})
                if(document.fullscreenElement)await document.exitFullscreen()
                orientation.unlock?.();landscape=false
            }
            paint()
        }catch(error){
            // Unsupported locking is not an application crash. Fullscreen can
            // still be exited on the second tap, including desktop browsers.
            landscape=!!document.fullscreenElement;paint()
            button.title+=(error as DOMException)?.name==='NotSupportedError'?'（浏览器不支持方向锁定，请转动设备）':'（方向锁定未获允许）'
        }finally{pending=false;button.disabled=false}
    }
    document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement){landscape=false;screen.orientation?.unlock?.();paint()}})
    paint()
}

export function setupCompactWorkspace(performanceRoot:HTMLElement) {
    const menu=document.getElementById('menu-controls')!,action=document.getElementById('action-panel-toggle')!
    action.after(document.getElementById('weapon-panel-toggle')!,document.getElementById('enemy-panel-toggle')!)
    document.getElementById('stage-list-panel-toggle')!.after(document.getElementById('voice-panel-toggle')!)
    performanceRoot.id='perf-stat';performanceRoot.classList.remove('performance-corner');performanceRoot.classList.add('performance-toolbar')
    const studio=document.getElementById('performance-editor-toggle')
    if(studio)studio.after(performanceRoot);else menu.append(performanceRoot)
    const settings=document.querySelector('#advanced-controls-dock .floating-panel-scroll')!
    const label=document.createElement('label');label.className='render-performance-toggle';label.dataset.i18nIgnore='true'
    const input=document.createElement('input');input.id='performance-overlay-toggle';input.type='checkbox'
    try{input.checked=localStorage.getItem('magius.performance.visible')!=='false'}catch{input.checked=true}
    const paint=()=>{performanceRoot.hidden=!input.checked;document.documentElement.dataset.performanceOverlay=String(input.checked)}
    input.onchange=()=>{paint();try{localStorage.setItem('magius.performance.visible',String(input.checked))}catch{}}
    label.append(input,document.createTextNode('显示帧率 / 性能'));settings.prepend(label);paint()
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.id='performance-overlay-close';dismiss.dataset.i18nIgnore='true';dismiss.textContent='×';dismiss.title='关闭性能显示（可在渲染设置重新开启）';dismiss.setAttribute('aria-label',dismiss.title)
    dismiss.onclick=()=>{input.checked=false;input.dispatchEvent(new Event('change'))};performanceRoot.append(dismiss)
    menu.classList.add('compact-controls')
}
