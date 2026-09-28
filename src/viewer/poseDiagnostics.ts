import { Bone, BufferAttribute, Mesh, Object3D, Vector3 } from 'three'
import type { MagiaExedraScene3D } from '../../magia-exedra-character-three/scene'
import type { TransformControls } from 'three/addons/controls/TransformControls.js'

/** Opt-in read-only browser evidence. No posing, camera or quality setters. */
export function installPoseDiagnostics(scene: MagiaExedraScene3D, control: () => TransformControls | undefined,
    state: () => { mode: string; editing: boolean; solves: number; pending: boolean }) {
    if (new URLSearchParams(location.search).get('diagnostic') !== 'pose-editor') return () => {}
    let previous = 0, calls = 0
    const frames: Array<{ milliseconds: number; renderCalls: number }> = []
    const render = scene.renderer.render.bind(scene.renderer)
    scene.renderer.render = (...args) => { calls++; return render(...args) }
    const project = (object: Object3D, point = new Vector3()) => {
        point.applyMatrix4(object.matrixWorld).project(scene.camera)
        const rect = scene.renderer.domElement.getBoundingClientRect()
        return [rect.left + (point.x + 1) * rect.width / 2, rect.top + (1 - point.y) * rect.height / 2, point.z]
    }
    const snapshot = () => {
        const selected = scene.characterSelected?.character?.object
        const bones: unknown[] = []
        selected?.traverse(node => {
            if (node instanceof Bone) bones.push({ uuid: node.uuid, name: node.name, parent: node.parent?.uuid,
                position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(), screen: project(node) })
        })
        const rings: unknown[] = []
        control()?.getHelper().traverse(node => {
            if (!(node instanceof Mesh) || !/^[XYZ]$/.test(node.name) || !node.visible) return
            const positions = node.geometry.getAttribute('position') as BufferAttribute | undefined
            if (!positions) return
            const points = []
            for (let i = 0; i < positions.count; i += Math.max(1, Math.floor(positions.count / 20))) points.push(project(node, new Vector3().fromBufferAttribute(positions, i)))
            rings.push({ axis: node.name, points })
        })
        return { ...state(), axis: control()?.axis, dragging: control()?.dragging, selected: selected?.uuid,
            actorCount: scene.characters.length, outlines: scene.selectionHighlight.materialCount,
            screenOutlinePass: scene.effects.outlinePass.enabled, pixelRatio: scene.renderer.getPixelRatio(),
            antialiasing: scene.effects.effectiveAntiAliasing, frames: frames.slice(), bones, rings }
    }
    Object.defineProperty(window, 'magiusPoseInspection', { configurable: true, value: snapshot })
    window.addEventListener('pagehide', () => { scene.renderer.render = render; Reflect.deleteProperty(window, 'magiusPoseInspection') }, { once: true })
    return () => {
        const now = performance.now()
        if (previous && now - previous < 1000) {
            frames.push({ milliseconds: now - previous, renderCalls: calls })
            if (frames.length > 180) frames.shift()
        }
        previous = now; calls = 0
    }
}
