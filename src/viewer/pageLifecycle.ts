/** Back/forward caching parks the live document. It must not dispose models or
 * input panels as though it were a permanent navigation. */
export function onPermanentPageExit(callback:()=>void) {
    const exit=(event:PageTransitionEvent)=>{if(event.persisted)return;window.removeEventListener('pagehide',exit);callback()}
    window.addEventListener('pagehide',exit)
    return ()=>window.removeEventListener('pagehide',exit)
}
export function installContextRecovery(canvas:HTMLCanvasElement) {
    let losses=0,restores=0
    canvas.addEventListener('webglcontextlost',event=>{
        event.preventDefault();losses++
        document.documentElement.dataset.webglState='lost'
    })
    canvas.addEventListener('webglcontextrestored',()=>{
        restores++;document.documentElement.dataset.webglState='restored'
        document.dispatchEvent(new CustomEvent('magius:graphics-restored'))
    })
    document.addEventListener('visibilitychange',()=>{
        document.documentElement.dataset.pageVisibility=document.visibilityState
    })
    Object.assign(window,{magiusPageRecovery:()=>({losses,restores,wasDiscarded:!!(document as Document&{wasDiscarded?:boolean}).wasDiscarded,visibility:document.visibilityState})})
}
