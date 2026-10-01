interface Hooks {focus():void;roll(degrees:number):void;locale():string}
export function createCameraCornerControls(hooks:Hooks){
 const root=document.createElement('nav');root.id='camera-corner-controls';root.dataset.i18nIgnore='true';root.setAttribute('aria-label','Camera framing and optical roll')
 const make=(id:string,symbol:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.id=id;b.textContent=symbol;b.onclick=action;root.append(b);return b}
 const left=make('camera-roll-left','↶',()=>hooks.roll(-15)),focus=make('camera-frame-actor','⌖',hooks.focus),right=make('camera-roll-right','↷',()=>hooks.roll(15))
 const localize=()=>{const zh=hooks.locale()==='zh-CN',ja=hooks.locale()==='ja-JP';for(const[b,label]of [[left,zh?'画面左转 15°':ja?'画面を左に15°回転':'Roll screen left 15°'],[focus,zh?'聚焦当前角色（一次）':ja?'選択モデル全体へ':'Frame selected actor once'],[right,zh?'画面右转 15°':ja?'画面を右に15°回転':'Roll screen right 15°']] as const){b.title=label;b.setAttribute('aria-label',label)}}
 localize();document.addEventListener('magius:localechange',localize);document.body.append(root)
 return {dispose(){document.removeEventListener('magius:localechange',localize);root.remove()}}
}
