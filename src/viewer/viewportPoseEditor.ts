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

/** Persistent viewport tool. Only nodes and controls accept pointer events;
 * closing the separate parameter panel never dismisses this editor. */
export function createViewportPoseEditor(options: Options) {
    const root = document.createElement('div'); root.id = 'viewport-editor'; root.dataset.i18nIgnore = 'true'
    const nodes = document.createElement('div'); nodes.className = 've-joints'
    const launch = document.createElement('button'); launch.id = 'viewport-editor-launch'; launch.type = 'button'; launch.onclick = () => options.place('translate')
    const dock = document.createElement('section'); dock.id = 'viewport-editor-dock'; dock.setAttribute('aria-label', 'Viewport editor')
    const header = document.createElement('header'); header.className = 've-drag-handle'
    const title = document.createElement('strong')
    const collapse = document.createElement('button'); collapse.type = 'button'; collapse.id = 'viewport-editor-collapse'; collapse.className = 've-focus'; collapse.textContent = '−'; collapse.setAttribute('aria-expanded', 'true')
    collapse.onclick = () => { const folded = dock.classList.toggle('is-collapsed'); collapse.textContent = folded ? '+' : '−'; collapse.setAttribute('aria-expanded', String(!folded)) }
    const focus = document.createElement('button'); focus.type = 'button'; focus.id = 'viewport-focus'; focus.className = 've-focus'; focus.textContent = '⌖'; focus.onclick = options.focus
    const close = document.createElement('button'); close.type = 'button'; close.id = 'viewport-editor-close'; close.className = 've-close'; close.textContent = '×'; close.onclick = options.close
    header.append(title, focus, collapse, close)
    const tabRow = document.createElement('div'); tabRow.className = 've-row ve-tabs'
    const modeRow = document.createElement('div'); modeRow.className = 've-row ve-modes'
    const selection = document.createElement('div'); selection.id = 'viewport-editor-selection'
    const quick = document.createElement('div'); quick.className = 've-row ve-quick'
    const history = document.createElement('div'); history.className = 've-row ve-history'
    const fine = document.createElement('fieldset'); fine.id = 'viewport-editor-fine'; fine.hidden = true
    const legend = document.createElement('legend'); fine.append(legend)
    const guard = document.createElement('p'); guard.className = 've-guard'
    const hint = document.createElement('p'); hint.className = 've-hint'
    const controls = new Map<string, HTMLButtonElement>()
    const button = (parent: HTMLElement, id: string, click: () => void) => {
        const node = document.createElement('button'); node.type = 'button'; node.id = 'viewport-' + id
        node.onclick = click; controls.set(id, node); parent.append(node); return node
    }
    button(tabRow, 'object', () => options.place('translate')); button(tabRow, 'pose', options.pose)
    button(modeRow, 'move', () => options.state().pose ? options.mode('translate') : options.place('translate'))
    button(modeRow, 'rotate', () => options.state().pose ? options.mode('rotate') : options.place('rotate'))
    let showJoints = true
    button(quick, 'joints', () => { showJoints = !showJoints; refresh() })
    button(quick, 'fine', () => { fine.hidden = !fine.hidden; refresh() }); button(quick, 'parameters', options.parameters)
    button(history, 'undo', options.undo); button(history, 'redo', options.redo); button(history, 'reset', options.reset)
    for (const axis of ['x', 'y', 'z'] as const) {
        const row = document.createElement('div'); row.className = 've-fine-axis'
        const label = document.createElement('span'); label.textContent = axis.toUpperCase(); row.append(label)
        for (const sign of [-1, 1]) {
            const node = document.createElement('button'); node.type = 'button'; node.dataset.nudgeAxis = axis; node.dataset.nudgeSign = String(sign)
            node.textContent = sign < 0 ? '−1°' : '+1°'; node.setAttribute('aria-label', `${axis.toUpperCase()} ${node.textContent}`)
            node.onclick = event => options.nudge(axis, sign * (event.shiftKey ? 0.2 : 1)); row.append(node)
        }
        fine.append(row)
    }
    dock.append(header, tabRow, modeRow, selection, quick, fine, history, guard, hint)
    root.append(nodes, launch, dock); document.body.append(root)
    let actor: Object3D | undefined, parts: PosePart[] = [], activeBefore = false, lastKey = ''
    let width = 300, height = 245, x = 12, y = 100, customPosition = false
    let drag: { id: number; x: number; y: number; startX: number; startY: number } | undefined
    let nodeDrag: { id: number; button: HTMLButtonElement } | undefined
    const point = new Vector3()
    let rect = options.canvas.getBoundingClientRect()
    const position = () => {
        if (window.innerWidth < 640 && !customPosition) { x = 8; y = window.innerHeight - height - 12 }
        const clamped = clampEditorPosition(x, y, width, height, window.innerWidth, window.innerHeight)
        x = clamped.x; y = clamped.y; dock.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`
    }
    const resize = () => { rect = options.canvas.getBoundingClientRect(); position() }
    const observer = new ResizeObserver(entries => {
        const entry = entries[0]; if (!entry) return
        width = entry.borderBoxSize?.[0]?.inlineSize || dock.offsetWidth || 300
        height = entry.borderBoxSize?.[0]?.blockSize || dock.offsetHeight || 245; position()
    })
    observer.observe(dock); window.addEventListener('resize', resize)
    const viewportObserver = new ResizeObserver(resize)
    viewportObserver.observe(options.canvas)
    header.addEventListener('pointerdown', event => {
        if (event.button !== 0 || (event.target as Element).closest('button')) return
        customPosition = true; drag = { id: event.pointerId, x, y, startX: event.clientX, startY: event.clientY }
        header.setPointerCapture(event.pointerId); event.preventDefault()
    })
    header.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.id) return
        x = drag.x + event.clientX - drag.startX; y = drag.y + event.clientY - drag.startY; position()
    })
    const stopDock = () => { drag = undefined }
    header.addEventListener('pointerup', stopDock); header.addEventListener('pointercancel', stopDock); header.addEventListener('lostpointercapture', stopDock)
    const stopNodes = (event?: PointerEvent) => {
        if (!nodeDrag || event && event.pointerId !== nodeDrag.id) return
        const previous = nodeDrag; nodeDrag = undefined; options.end(event)
        if (previous.button.hasPointerCapture(previous.id)) previous.button.releasePointerCapture(previous.id)
    }
    const buildNodes = () => {
        stopNodes(); nodes.replaceChildren(); parts = actor ? findDirectPoseParts(actor) : []
        for (const part of parts) {
            const node = document.createElement('button'); node.type = 'button'; node.className = 've-joint-node'; node.dataset.viewportJoint = part.id
            const label = document.createElement('span'); label.className = 've-joint-label'; label.textContent = options.translate(part.label)
            node.title = label.textContent; node.setAttribute('aria-label', label.textContent); node.append(label)
            node.addEventListener('pointerdown', event => {
                if (event.button !== 0 || nodeDrag) return
                event.preventDefault(); event.stopPropagation()
                if (options.begin(part, event)) { nodeDrag = {id:event.pointerId,button:node}; node.setPointerCapture(event.pointerId) }
                refresh()
            })
            node.addEventListener('pointermove', event => { if (nodeDrag?.id === event.pointerId) options.move(event) })
            node.addEventListener('pointerup', stopNodes); node.addEventListener('pointercancel', stopNodes); node.addEventListener('lostpointercapture', stopNodes)
            node.onclick = event => { if (event.detail === 0) { options.select(part); refresh() } }
            nodes.append(node)
        }
    }
    const refresh = () => {
        const state = options.state()
        if (state.actor !== actor) { actor = state.actor; customPosition = false; buildNodes() }
        const text = words[options.locale() as keyof typeof words] ?? words.en
        dock.hidden = !state.active; launch.hidden = state.active || !(state.object || state.actor); launch.textContent = '✥ ' + text.launch
        nodes.hidden = !(state.pose && showJoints)
        const key = [options.locale(),state.active,state.pose,state.mode,state.canTranslate,state.selected?.uuid,state.history?.canUndo,state.history?.canRedo,state.limited,showJoints,fine.hidden].join('|')
        if (key !== lastKey) {
            lastKey = key; title.textContent = text.title; close.title = text.close; close.setAttribute('aria-label',text.close)
            focus.title = options.locale() === 'zh-CN' ? '聚焦角色 / 物品' : options.locale() === 'ja-JP' ? '対象にフォーカス' : 'Focus object'
            focus.setAttribute('aria-label', focus.title)
            collapse.title = options.locale() === 'zh-CN' ? '展开 / 收起工具栏（保留编辑）' : options.locale() === 'ja-JP' ? 'ツールを展開 / 折りたたむ' : 'Expand / collapse tools (keep editing)'
            collapse.setAttribute('aria-label', collapse.title)
            const advanced = options.locale() === 'zh-CN'
                ? ['整块模型显示（高级）', '骨骼数值微调（高级）', '此处控制整块网格；手脚关节请在视口中选择。']
                : options.locale() === 'ja-JP'
                    ? ['メッシュ表示（詳細）', 'ボーン数値編集（詳細）', 'ここではメッシュ全体を切り替えます。手足の関節は画面上で選択してください。']
                    : ['Mesh visibility (advanced)', 'Bone parameters (advanced)', 'These controls affect whole meshes. Select hand and foot joints in the viewport.']
            for (const [selector, value] of [['#mesh-visibility-details>summary', advanced[0]], ['#bone-parameter-details>summary', advanced[1]], ['.ve-advanced-hint', advanced[2]]]) {
                const element = document.querySelector(selector)
                if (element && element.textContent !== value) element.textContent = value
            }
            for (const [id,node] of controls) node.textContent = text[id as keyof typeof text] || id
            controls.get('pose')!.disabled = !actor
            controls.get('move')!.disabled = state.pose && !state.canTranslate
            controls.get('object')!.setAttribute('aria-pressed',String(!state.pose)); controls.get('pose')!.setAttribute('aria-pressed',String(state.pose))
            controls.get('move')!.setAttribute('aria-pressed',String(state.mode === 'translate')); controls.get('rotate')!.setAttribute('aria-pressed',String(state.mode === 'rotate'))
            controls.get('joints')!.setAttribute('aria-pressed',String(showJoints)); controls.get('fine')!.setAttribute('aria-pressed',String(!fine.hidden))
            controls.get('joints')!.disabled = !state.pose; controls.get('fine')!.disabled = !state.selected || !state.pose
            controls.get('undo')!.disabled = !state.pose || !state.history?.canUndo; controls.get('redo')!.disabled = !state.pose || !state.history?.canRedo
            controls.get('reset')!.disabled = !state.pose || !state.selected
            for (const input of fine.querySelectorAll<HTMLButtonElement>('button')) input.disabled = !state.pose || !state.selected
            legend.textContent = text.fineHint
            const part = parts.find(p => p.bone === state.selected)
            selection.textContent = state.pose ? (part ? options.translate(part.label) : state.selected?.name || text.pick) : text.object
            guard.textContent = state.limited ? text.locked : text.safe; guard.classList.toggle('is-limited',state.limited); hint.textContent = text.hint
            for (let i=0;i<parts.length;i++) { const node = nodes.children[i] as HTMLButtonElement; node.setAttribute('aria-pressed',String(parts[i].bone === state.selected)); node.querySelector('span')!.textContent = options.translate(parts[i].label) }
        }
        if (state.active && !activeBefore && !customPosition) {
            const anchor = state.object ?? actor
            if (anchor) {
                anchor.getWorldPosition(point); point.y += 0.8; point.project(options.camera)
                const sx=rect.left+(point.x+1)*rect.width/2
                x = sx + 115 + width < window.innerWidth ? sx + 115 : sx - width - 115
                y = rect.top + Math.max(40, rect.height * 0.2)
            }
            position()
        }
        activeBefore = state.active
    }
    const update = () => {
        refresh()
        if (!options.state().pose || !showJoints) return
        for (let i=0;i<parts.length;i++) {
            const node=nodes.children[i] as HTMLButtonElement
            parts[i].bone.getWorldPosition(point).project(options.camera)
            const sx=rect.left+(point.x+1)*rect.width/2, sy=rect.top+(1-point.y)*rect.height/2
            node.hidden = Math.abs(point.z)>1 || sx<rect.left || sx>rect.right || sy<rect.top || sy>rect.bottom
            if (!node.hidden) node.style.transform=`translate(${Math.round(sx)}px,${Math.round(sy)}px)`
        }
    }
    const blur=()=>{stopDock();stopNodes()}
    window.addEventListener('blur',blur); document.addEventListener('magius:localechange',refresh); refresh()
    return { update, refresh, dispose() {stopNodes();observer.disconnect();viewportObserver.disconnect();window.removeEventListener('resize',resize);window.removeEventListener('blur',blur);document.removeEventListener('magius:localechange',refresh);root.remove()} }
}
