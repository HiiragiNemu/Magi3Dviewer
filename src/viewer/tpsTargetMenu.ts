export interface TpsTarget { key:string; label:string; enabled:boolean }
interface Hooks { button:HTMLButtonElement; targets():TpsTarget[]; selected():string|undefined; active():boolean; setActive(value:boolean):void; select(key:string):void; locale():string }
/** One toolbar button keeps its dimensions. The popup chooses actual instances,
 * so two copies of the same model are not conflated by character ID. */
export function createTpsTargetMenu(hooks:Hooks) {
    const abort=new AbortController(),options={signal:abort.signal}
    const popup=document.createElement('div');popup.id='tps-target-menu';popup.hidden=true;popup.dataset.i18nIgnore='true';popup.setAttribute('role','listbox');document.body.append(popup)
    hooks.button.setAttribute('aria-controls',popup.id)
    let signature=''
    const close=()=>{popup.hidden=true;hooks.button.setAttribute('aria-expanded','false')}
    const position=()=>{const r=hooks.button.getBoundingClientRect();popup.style.left=Math.max(6,Math.min(r.left,innerWidth-popup.offsetWidth-6))+'px';popup.style.top=(r.bottom+popup.offsetHeight+6<innerHeight?r.bottom+4:Math.max(6,r.top-popup.offsetHeight-4))+'px'}
    const render=()=>{
        const entries=hooks.targets(),locale=hooks.locale(),multiple=entries.length>1
        hooks.button.classList.toggle('tps-multiple-targets',multiple)
        hooks.button.disabled=!hooks.active()&&!entries.some(entry=>entry.enabled)
        if(multiple)hooks.button.setAttribute('aria-haspopup','listbox');else hooks.button.removeAttribute('aria-haspopup')
        const title=multiple?(locale==='zh-CN'?'选择 TPS 控制角色或关闭 TPS':locale==='ja-JP'?'TPS 操作対象を選択・終了':'Choose TPS character or turn TPS off'):(locale==='zh-CN'?(hooks.active()?'关闭 TPS 控制':'开启 TPS 控制'):locale==='ja-JP'?(hooks.active()?'TPS 操作を終了':'TPS 操作を開始'):(hooks.active()?'Disable TPS character control':'Enable TPS character control'))
        hooks.button.title=title;hooks.button.setAttribute('aria-label',title)
        const key=locale+'|'+hooks.active()+'|'+hooks.selected()+'|'+entries.map(e=>e.key+e.label+e.enabled).join('|')
        if(key===signature)return;signature=key
        const focused=(document.activeElement as HTMLElement|null)?.dataset.targetKey
        popup.replaceChildren()
        const add=(id:string,label:string,disabled:boolean,selected:boolean,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.dataset.targetKey=id;b.textContent=label;b.disabled=disabled;b.setAttribute('role','option');b.setAttribute('aria-selected',String(selected));b.onclick=()=>{action();close();hooks.button.focus()};popup.append(b)}
        add('off',locale==='zh-CN'?'关闭 TPS':locale==='ja-JP'?'TPS を終了':'Turn TPS off',false,!hooks.active(),()=>hooks.setActive(false))
        for(const entry of entries)add(entry.key,entry.label,!entry.enabled,hooks.active()&&entry.key===hooks.selected(),()=>{hooks.select(entry.key);if(!hooks.active())hooks.setActive(true)})
        if(focused&&!popup.hidden)popup.querySelector<HTMLButtonElement>('[data-target-key="'+CSS.escape(focused)+'"]')?.focus()
        if(!multiple&&!popup.hidden)close()
    }
    const open=()=>{
        render();const entries=hooks.targets()
        if(entries.length<=1){const only=entries[0];if(hooks.active()){hooks.setActive(false);return}if(!only?.enabled)return;hooks.select(only.key);hooks.setActive(true);return}
        if(!popup.hidden){close();return}
        popup.hidden=false;position();hooks.button.setAttribute('aria-expanded','true')
        const current=popup.querySelector<HTMLButtonElement>('[aria-selected=true]');(current??popup.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus()
    }
    document.addEventListener('magius:tps-toggle-request',open,options)
    document.addEventListener('pointerdown',e=>{if(!popup.hidden&&!popup.contains(e.target as Node)&&!hooks.button.contains(e.target as Node))close()},options)
    popup.addEventListener('keydown',e=>{
        // Menu navigation must not also steer the controlled character.
        e.stopPropagation()
        if(e.key==='Escape'){e.preventDefault();close();hooks.button.focus();return}
        const list=[...popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],current=list.indexOf(document.activeElement as HTMLButtonElement)
        let next=current;if(e.key==='ArrowDown')next=(current+1)%list.length;else if(e.key==='ArrowUp')next=(current+list.length-1)%list.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=list.length-1;else return
        e.preventDefault();list[next]?.focus()
    },options)
    hooks.button.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();if(popup.hidden)open()}},options)
    const resize=()=>{if(!popup.hidden)position()};window.addEventListener('resize',resize,options)
    const timer=setInterval(()=>{render();resize()},250)
    render();close()
    return {refresh:render,close,dispose(){clearInterval(timer);abort.abort();popup.remove()}}
}
