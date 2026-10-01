import { Bone, Object3D } from 'three'

export type PoseSnapshot = Map<string, number[]>
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

export interface PosePart { id: string; label: string; bone: Object3D; mode: 'rotate' | 'translate' }
export type PoseSide = 'left' | 'right'
/** Raw L/R are the character's anatomical identities in these imported rigs.
 * Display names use the user's fixed FRONT observer convention, never camera
 * position or a posed limb's current screen position. Raw names/IDs stay intact. */
export function frontViewPoseSide(name: string): PoseSide | undefined {
    if (/(?:^|[_ .:/-])(?:l\d*|left)(?:$|[_ .:/-])|^left|left$/i.test(name)) return 'right'
    if (/(?:^|[_ .:/-])(?:r\d*|right)(?:$|[_ .:/-])|^right|right$/i.test(name)) return 'left'
    return undefined
}
export function primaryPoseRegion(part: PosePart): 'top' | 'bottom' | PoseSide {
    if (part.id === 'head' || part.id === 'neck') return 'top'
    return frontViewPoseSide(part.bone.name) ?? 'bottom'
}
export function primaryPoseOrder(part: PosePart): number {
    const role = part.id.replace(/^(?:left|right)-/, '')
    return ['head','neck','shoulder','upper-arm','elbow','hand','upper-leg','knee','foot','chest','waist','spine'].indexOf(role)
}
const excluded = /twist|roll|assist|bend|finger|thumb|index|middle|pinky|hair|cloth|skirt|weapon|dummy|nub|end/i
const side = (name: string, s: 'left' | 'right') => s === 'left'
    ? /(?:^|[_. :/\-])(?:l|left)(?:$|[_. :/\-])|^left|left$/i.test(name)
    : /(?:^|[_. :/\-])(?:r|right)(?:$|[_. :/\-])|^right|right$/i.test(name)

/** AssetStudio expands one Unity transform into nested, same-name identity
 * bones for different skinned renderers. Expose the outer driving transform,
 * not one useless control for every renderer-specific copy. */
export function canonicalPoseBone(node: Object3D): Object3D {
    let result = node
    while (result.parent instanceof Bone && result.parent.name === result.name
        && result.position.lengthSq() < 1e-12) result = result.parent
    return result
}
export function poseBones(actor: Object3D): Bone[] {
    const seen = new Set<Object3D>(), bones: Bone[] = []
    actor.traverse(node => {
        if (!(node instanceof Bone)) return
        const bone = canonicalPoseBone(node)
        if (bone instanceof Bone && !seen.has(bone)) { seen.add(bone); bones.push(bone) }
    })
    return bones
}
/** Zero-scale native branches select alternate heads/accessories. They remain
 * in saved-pose data but are not useful handles in the visible pose editor. */
export function poseBoneIsActive(node:Object3D,actor:Object3D):boolean {
    for(let p:Object3D|null=node;p&&p!==actor;p=p.parent)if(Math.abs(p.scale.x)<1e-9||Math.abs(p.scale.y)<1e-9||Math.abs(p.scale.z)<1e-9)return false
    return true
}
export function findDirectPoseParts(actor: Object3D): PosePart[] {
    const bones = poseBones(actor).filter(bone => poseBoneIsActive(bone,actor) && !excluded.test(bone.name))
    const parts: PosePart[] = []
    const axisName = (word: string) => new RegExp('(?:^|[_. :/\\-])(?:'+word+')(?:$|[_. :/\\-])', 'i')
    for (const [id, label, pattern] of [
        ['head', 'Head', axisName('head')], ['neck', 'Neck', axisName('neck')],
        ['chest', 'Chest', axisName('chest|spine0?2')],
        ['waist', 'Waist', axisName('waist')],
    ] as const) {
        const bone = bones.find(b => pattern.test(b.name))
        if (bone && !parts.some(p => p.bone === bone)) parts.push({ id, label, bone, mode: 'rotate' })
    }
    // Spine and Waist are distinct pivots, not duplicate bones. Keep the
    // simpler upper-torso Waist in the main UI; Spine stays in torso details.
    // Rigs without Waist retain their actual Spine as the main torso control.
    if (!parts.some(p => p.id === 'waist')) {
        const bone = bones.find(b => axisName('spine|spine0?1').test(b.name))
        if (bone && !parts.some(p => p.bone === bone)) parts.push({id:'spine',label:'Spine',bone,mode:'rotate'})
    }
    for (const [part, label, pattern] of [
        ['shoulder', 'shoulder', axisName('shoulder|clavicle')],
        ['upper-arm', 'upper arm', axisName('arm|upperarm')],
        ['elbow', 'elbow', axisName('forearm|lowerarm|elbow')],
        ['hand', 'hand', axisName('hand|wrist')],
        ['upper-leg', 'thigh', axisName('upleg|upperleg|thigh')],
        ['knee', 'knee', axisName('leg|lowerleg|calf|shin|knee')],
        ['foot', 'foot', axisName('foot|ankle')],
    ] as const) {
        for (const s of ['left', 'right'] as const) {
            const bone = bones.find(b => pattern.test(b.name) && side(b.name, s))
            if (bone && !parts.some(p => p.bone === bone)) parts.push({
                id: `${s}-${part}`, label: `${s === 'left' ? 'Right' : 'Left'} ${label}`, bone,
                mode: part === 'hand' || part === 'foot' ? 'translate' : 'rotate',
            })
        }
    }
    return parts
}

interface PoseToolsOptions {
    translate(text: string): string
    actor(): Object3D | undefined
    selected(): Object3D | undefined
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
    let actor: Object3D | undefined, selected: Object3D | undefined
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
