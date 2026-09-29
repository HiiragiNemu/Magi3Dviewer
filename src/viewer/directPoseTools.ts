import { Bone, Object3D } from 'three'

export type PoseSnapshot = Map<string, [number, number, number]>
const copy = (value: PoseSnapshot): PoseSnapshot => new Map([...value].map(([key, v]) => [key, [...v]]))
const same = (a: PoseSnapshot, b: PoseSnapshot) => a.size === b.size && [...a].every(([key, v]) => {
    const other = b.get(key)
    return other && v.every((n, i) => Math.abs(n - other[i]) < 1e-7)
})

/** One undo item per completed gesture, not per pointer event. */
export class DirectPoseHistory {
    private past: PoseSnapshot[] = []
    private future: PoseSnapshot[] = []
    private before?: PoseSnapshot
    begin(value: PoseSnapshot) { this.before ??= copy(value) }
    finish(value: PoseSnapshot) {
        const before = this.before
        this.before = undefined
        if (!before || same(before, value)) return
        this.past.push(before)
        if (this.past.length > 40) this.past.shift()
        this.future.length = 0
    }
    undo(current: PoseSnapshot): PoseSnapshot | undefined {
        this.finish(current)
        const value = this.past.pop()
        if (value) this.future.push(copy(current))
        return value
    }
    redo(current: PoseSnapshot): PoseSnapshot | undefined {
        this.finish(current)
        const value = this.future.pop()
        if (value) this.past.push(copy(current))
        return value
    }
    get canUndo() { return this.past.length > 0 }
    get canRedo() { return this.future.length > 0 }
}

export interface PosePart { id: string; label: string; bone: Bone; mode: 'rotate' | 'translate' }
const excluded = /twist|roll|assist|finger|thumb|index|middle|pinky|hair|cloth|skirt|weapon|dummy|nub|end/i
const side = (name: string, s: 'left' | 'right') => s === 'left'
    ? /(?:^|[_. :/\-])(?:l|left)(?:$|[_. :/\-])|^left|left$/i.test(name)
    : /(?:^|[_. :/\-])(?:r|right)(?:$|[_. :/\-])|^right|right$/i.test(name)

export function findDirectPoseParts(actor: Object3D): PosePart[] {
    const bones: Bone[] = []
    actor.traverse(node => { if (node instanceof Bone && !excluded.test(node.name)) bones.push(node) })
    const parts: PosePart[] = []
    for (const [part, pattern] of [
        ['hand', /hand|wrist/i], ['foot', /foot|ankle/i],
        ['elbow', /forearm|lowerarm|elbow/i], ['knee', /calf|shin|lowerleg|knee|(?:^|[_. :/\-])leg(?:$|[_. :/\-])/i],
    ] as const) {
        for (const s of ['left', 'right'] as const) {
            const bone = bones.find(b => pattern.test(b.name) && side(b.name, s))
            if (bone) parts.push({ id: `${s}-${part}`, label: `${s === 'left' ? 'Left' : 'Right'} ${part}`, bone, mode: part === 'elbow' || part === 'knee' ? 'rotate' : 'translate' })
        }
    }
    for (const [id, label, pattern] of [['head', 'Head', /head/i], ['chest', 'Chest', /chest|spine0?2/i]] as const) {
        const bone = bones.find(b => pattern.test(b.name))
        if (bone) parts.push({ id, label, bone, mode: 'rotate' })
    }
    return parts
}

interface PoseToolsOptions {
    translate(text: string): string
    actor(): Object3D | undefined
    selected(): Bone | undefined
    history(): DirectPoseHistory | undefined
    select(part: PosePart): void
    undo(): void
    redo(): void
    resetPart(): void
    placeActor(): void
    preserveOrientation(value: boolean): void
    bend(value: number): void
    bendEnd(): void
    enable(): void
}

export function createDirectPoseTools(parent: HTMLElement, options: PoseToolsOptions) {
    const root = document.createElement('section')
    root.id = 'direct-pose-tools'
    root.className = 'direct-pose-tools'
    const partsRow = document.createElement('div')
    partsRow.className = 'direct-pose-parts'
    const actions = document.createElement('div')
    actions.className = 'direct-pose-actions'
    const button = (id: string, label: string, click: () => void) => {
        const node = document.createElement('button')
        node.type = 'button'; node.id = id; node.dataset.poseLabel = label
        node.textContent = options.translate(label)
        node.onclick = click; actions.append(node)
        return node
    }
    const undo = button('pose-undo', 'Undo pose', options.undo)
    const redo = button('pose-redo', 'Redo pose', options.redo)
    const reset = button('pose-reset-part', 'Reset selected part', options.resetPart)
    const place = button('pose-place-actor', 'Move whole character', options.placeActor)
    const keep = document.createElement('label')
    const orientation = document.createElement('input')
    orientation.type = 'checkbox'; orientation.id = 'pose-keep-orientation'
    orientation.onchange = () => options.preserveOrientation(orientation.checked)
    const keepLabel = document.createElement('span')
    keep.append(orientation, keepLabel)
    const bend = document.createElement('label')
    const bendLabel = document.createElement('span')
    const bendInput = document.createElement('input')
    bendInput.type = 'range'; bendInput.min = '-65'; bendInput.max = '65'; bendInput.step = '1'; bendInput.value = '0'
    bendInput.id = 'pose-bend-direction'
    bendInput.oninput = () => options.bend(bendInput.valueAsNumber)
    bendInput.onchange = () => { options.bendEnd(); bendInput.value = '0' }
    bend.append(bendLabel, bendInput)
    const hint = document.createElement('p')
    hint.className = 'direct-pose-hint'
    root.append(partsRow, actions, keep, bend, hint)
    parent.append(root)
    let actor: Object3D | undefined, selected: Bone | undefined
    let parts: PosePart[] = []
    const refresh = () => {
        const current = options.actor(), bone = options.selected()
        if (current !== actor) {
            actor = current; parts = current ? findDirectPoseParts(current) : []
            partsRow.replaceChildren()
            for (const part of parts) {
                const node = document.createElement('button')
                node.type = 'button'; node.dataset.posePart = part.id; node.dataset.poseLabel = part.label
                node.textContent = options.translate(part.label); node.title = part.bone.name
                node.onclick = () => { options.enable(); options.select(part) }
                partsRow.append(node)
            }
        }
        if (selected !== bone) { selected = bone; bendInput.value = '0' }
        for (const node of partsRow.querySelectorAll<HTMLButtonElement>('button')) {
            node.setAttribute('aria-pressed', String(parts.find(p => p.id === node.dataset.posePart)?.bone === bone))
        }
        undo.disabled = !options.history()?.canUndo
        redo.disabled = !options.history()?.canRedo
        reset.disabled = !bone
        place.disabled = !current
        orientation.disabled = !bone
        bendInput.disabled = !bone || !/(?:hand|wrist|foot|ankle)/i.test(bone.name)
    }
    const localize = () => {
        for (const node of root.querySelectorAll<HTMLButtonElement>('[data-pose-label]')) node.textContent = options.translate(node.dataset.poseLabel!)
        keepLabel.textContent = options.translate('Keep hand / foot orientation')
        bendLabel.textContent = options.translate('Elbow / knee bend direction')
        hint.textContent = options.translate('Choose a hand or foot, then drag the arrows or the body part. Shift: fine adjustment. Alt: depth. W / E: move / rotate. Ctrl+Z: undo.')
    }
    document.addEventListener('magius:localechange', localize)
    refresh(); localize()
    return { refresh, dispose() { document.removeEventListener('magius:localechange', localize); root.remove() } }
}
