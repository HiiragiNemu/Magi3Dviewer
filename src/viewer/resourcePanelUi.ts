/** Shared thumbnail behavior for characters, scenes and enemies. IDs remain
 * native identities; only display labels are shortened for compact catalogs. */
export function createResourceTile(data:{value:string;label:string;title?:string;image?:string;loadable?:boolean},select:()=>void,activate?:()=>void):HTMLButtonElement {
    const tile=document.createElement('button');tile.type='button';tile.className='runtime-selection-tile'
    tile.dataset.value=data.value;tile.dataset.loadable=String(data.loadable!==false);tile.setAttribute('role','option');tile.setAttribute('aria-selected','false');tile.title=data.title||data.label
    const frame=document.createElement('span');frame.className='runtime-selection-tile-image'
    if(data.image){const img=document.createElement('img');img.src=data.image;img.alt='';img.loading='lazy';img.decoding='async';img.draggable=false;img.addEventListener('error',()=>{img.remove();frame.classList.add('is-missing')},{once:true});frame.append(img)}
    else frame.classList.add('is-missing')
    const label=document.createElement('span');label.className='runtime-selection-tile-label';label.textContent=data.label
    const identity=document.createElement('span');identity.className='runtime-selection-tile-identity';identity.textContent=data.value
    tile.append(frame,label,identity);tile.addEventListener('click',select)
    if(activate)tile.addEventListener('dblclick',()=>{select();activate()})
    return tile
}
export function markResourceSelection(grid:HTMLElement,value:string){
    for(const tile of grid.querySelectorAll<HTMLButtonElement>('.runtime-selection-tile')){
        const selected=tile.dataset.value===value;tile.classList.toggle('is-selected',selected);tile.setAttribute('aria-selected',String(selected))
    }
}
export function installResourceGridKeys(grid:HTMLElement){
    grid.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return
        const tiles=[...grid.querySelectorAll<HTMLButtonElement>('.runtime-selection-tile')],index=tiles.indexOf(event.target as HTMLButtonElement)
        if(index<0||!tiles.length)return
        const columns=Math.max(1,getComputedStyle(grid).gridTemplateColumns.split(' ').length)
        const next=event.key==='Home'?0:event.key==='End'?tiles.length-1:index+({ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns}[event.key]??0)
        event.preventDefault();const tile=tiles[Math.max(0,Math.min(tiles.length-1,next))];tile.focus({preventScroll:true});tile.click();tile.scrollIntoView({block:'nearest',inline:'nearest'})
    })
}
export function compactResourceLabel(label:string,kind:'character'|'scene'|'enemy',locale:string):string {
    if(kind!=='character')return label
    const values=label.split(/\s+\/\s+/),part=locale==='ja-JP'?values[1]:locale==='en'?values[2]:values[0]
    return (part||values[0]).replace(/^\d+\s*[-—]\s*/,'').trim()
}
export function normalizedResourceQuantity(input:HTMLInputElement):number {
    const n=Number.parseInt(input.value,10),value=Number.isFinite(n)?Math.max(1,Math.min(8,n)):1;input.value=String(value);return value
}
