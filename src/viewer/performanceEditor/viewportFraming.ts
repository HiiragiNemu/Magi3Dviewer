import { Box3, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { Mesh, Object3D, SkinnedMesh } from 'three'
import type { HomeAnimationRuntime } from '../../../magia-exedra-character-three/homeRuntime.ts'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Availability } from './types.ts'

/** Home hide helpers use authored TRS, not Object3D.visible. Only a uniquely
 * bound, constant exported hide pose that is actually present now is excluded.
 * Pausing/seeking keeps that pose; fading away or editing it restores inclusion.
 * Missing/ambiguous authority never guesses a hidden target or a size cutoff. */
function authoredHiddenNodes(actor: Object3D): Set<Object3D> {
    const hidden = new Set<Object3D>()
    const runtime = actor.userData.homeAnimationRuntime as HomeAnimationRuntime | undefined
    if (!runtime || (runtime.schema !== 1 && runtime.schema !== 2)) return hidden
    const helpers = new Set((runtime.helpers ?? []).filter(name => /^HomeWeapon[A-Z0-9_]*Hide$/.test(name)))
    const nodes = new Map<string, Object3D[]>()
    actor.traverse(node => nodes.set(node.uuid, [...(nodes.get(node.uuid) ?? []), node]))
    for (const name of helpers) {
        if (runtime.clips.filter(clip => clip.name === name).length !== 1) continue
        const clips = actor.animations.filter(clip => clip.name === name)
        if (clips.length !== 1 || clips[0].tracks.length === 0) continue
        const targets = new Map<Object3D, Set<string>>()
        let matches = true
        for (const track of clips[0].tracks) {
            const separator = track.name.lastIndexOf('.')
            const candidates = nodes.get(track.name.slice(0, separator))
            const property = track.name.slice(separator + 1)
            if (candidates?.length !== 1 || !['position', 'scale', 'quaternion'].includes(property)) { matches = false; break }
            const node = candidates[0], properties = targets.get(node) ?? new Set<string>()
            const current = node[property as 'position' | 'scale' | 'quaternion'].toArray()
            if (properties.has(property) || track.getValueSize() !== current.length || track.times.length === 0
                || track.values.length !== track.times.length * current.length) { matches = false; break }
            // Compare the evaluated local pose with all constant keys, allowing
            // only double-precision interpolation noise, never spatial heuristics.
            if (!Array.from(track.values).every((value, index) => Number.isFinite(value)
                && value === track.values[index % current.length]
                && Math.abs(current[index % current.length] - value) <= 32 * Number.EPSILON * Math.max(1, Math.abs(value)))) { matches = false; break }
            properties.add(property); targets.set(node, properties)
        }
        if (!matches || [...targets.values()].some(properties => !properties.has('position') || !properties.has('scale'))) continue
        for (const node of targets.keys()) node.traverse(child => hidden.add(child))
    }
    return hidden
}

/** Evaluated actor geometry, excluding only declared current hide-helper output.
 * Skin influence joins also cover sibling weapon meshes and their outline copies. */
export function renderedActorBounds(actor: Object3D): Box3 | undefined {
    const box = new Box3(), point = new Vector3(), hidden = authoredHiddenNodes(actor)
    actor.updateWorldMatrix(true, true)
    let invalid = false
    actor.traverseVisible(object => {
        const mesh = object as Mesh
        if (!mesh.isMesh || !mesh.geometry?.attributes.position || hidden.has(mesh)) return
        if ((Array.isArray(mesh.material) ? mesh.material : [mesh.material]).every(material => !material.visible)) return
        const skin = mesh as SkinnedMesh, indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight
        const hiddenBones = skin.isSkinnedMesh && hidden.size > 0 && indices?.itemSize === 4 && weights?.itemSize === 4
            && indices.count === mesh.geometry.attributes.position.count && weights.count === indices.count
            ? skin.skeleton.bones.map(bone => hidden.has(bone)) : undefined
        for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
            if (hiddenBones) {
                let entirelyHidden = true, hasWeight = false
                for (let j = 0; j < 4; j++) {
                    const weight = weights.getComponent(i, j), index = indices.getComponent(i, j)
                    if (!Number.isFinite(weight) || weight < 0) { entirelyHidden = false; break }
                    if (weight === 0) continue
                    hasWeight = true
                    if (!Number.isInteger(index) || hiddenBones[index] !== true) { entirelyHidden = false; break }
                }
                if (entirelyHidden && hasWeight) continue
            }
            mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld)
            if (![point.x, point.y, point.z].every(Number.isFinite)) { invalid = true; return }
            box.expandByPoint(point)
        }
    })
    return !invalid && !box.isEmpty() && box.getSize(point).lengthSq() > 0 ? box : undefined
}

// OrbitControls r182 motion accumulators must be saved too: public camera/target
// restoration alone leaves damping inertia that moves the restored view next frame.
const orbitCloneFields = ['target', 'cursor', 'target0', 'position0', '_lastPosition', '_lastQuaternion', '_lastTargetPosition',
    '_quat', '_quatInverse', '_spherical', '_sphericalDelta', '_panOffset', '_rotateStart', '_rotateEnd', '_rotateDelta',
    '_panStart', '_panEnd', '_panDelta', '_dollyStart', '_dollyEnd', '_dollyDelta', '_dollyDirection', '_mouse'] as const
const orbitValueFields = ['enabled', 'enableDamping', 'dampingFactor', 'autoRotate', 'autoRotateSpeed', 'zoom0',
    'minDistance', 'maxDistance', 'minZoom', 'maxZoom', 'minTargetRadius', 'maxTargetRadius', '_scale', '_performCursorZoom', '_controlActive', 'state'] as const
type Copyable = { clone(): unknown; copy(value: unknown): unknown }
type Camera = PerspectiveCamera | OrthographicCamera
function capture(camera: Camera, controls: OrbitControls) {
    const record = controls as unknown as Record<string, unknown>
    if (record.state !== -1 || orbitCloneFields.some(key => typeof (record[key] as Copyable)?.clone !== 'function')) return undefined
    const clones = orbitCloneFields.map(key => [key, (record[key] as Copyable).clone()] as const)
    const values = orbitValueFields.map(key => [key, record[key]] as const)
    const position = camera.position.clone(), quaternion = camera.quaternion.clone(), up = camera.up.clone()
    const projection = camera.projectionMatrix.clone(), inverse = camera.projectionMatrixInverse.clone()
    const zoom = camera.zoom, near = camera.near, far = camera.far
    const aspect = camera instanceof PerspectiveCamera ? camera.aspect : undefined
    return () => {
        for (const [key, value] of clones) (record[key] as Copyable).copy(value)
        for (const [key, value] of values) record[key] = value
        camera.position.copy(position); camera.quaternion.copy(quaternion); camera.up.copy(up)
        camera.zoom = zoom; camera.near = near; camera.far = far
        if (camera instanceof PerspectiveCamera) camera.aspect = aspect!
        camera.projectionMatrix.copy(projection); camera.projectionMatrixInverse.copy(inverse)
        camera.updateMatrixWorld(true)
    }
}
const corners = (box: Box3) => [0,1,2,3,4,5,6,7].map(i => new Vector3(
    i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z))

export function frameActor(camera: Camera, controls: OrbitControls, actor: Object3D, viewport: { width: number; height: number }): Availability<void> {
    const box = renderedActorBounds(actor)
    if (!box || !Number.isFinite(viewport.width + viewport.height) || viewport.width <= 0 || viewport.height <= 0) return { status: 'unavailable', reason: '当前角色或视口没有有限可用的可见边界' }
    if (camera.parent || camera.view?.enabled || (camera instanceof PerspectiveCamera && camera.filmOffset !== 0)) return { status: 'unavailable', reason: '当前相机使用独立视图变换，请先返回普通 Orbit 视图' }
    const fill = 0.82, center = box.getCenter(new Vector3()), radius = box.getSize(new Vector3()).length() / 2
    const rotation = camera.getWorldQuaternion(new Quaternion()), inverseRotation = rotation.clone().invert()
    const local = corners(box).map(point => point.sub(center).applyQuaternion(inverseRotation))
    let distance = radius * 2
    if (camera instanceof PerspectiveCamera) {
        const tangent = Math.tan(camera.fov * Math.PI / 360) / camera.zoom
        const aspect = viewport.width / viewport.height
        if (!(tangent > 0) || !Number.isFinite(tangent)) return { status: 'unavailable', reason: '当前相机投影参数不适合取景' }
        distance = Math.max(...local.flatMap(p => [p.z + Math.abs(p.x) / (tangent * aspect * fill), p.z + Math.abs(p.y) / (tangent * fill)]), radius * 0.1)
        camera.aspect = aspect
    } else {
        const width = Math.max(...local.map(p => Math.abs(p.x))) * 2, height = Math.max(...local.map(p => Math.abs(p.y))) * 2
        camera.zoom = Math.min((camera.right-camera.left)*fill / Math.max(width, 1e-12), (camera.top-camera.bottom)*fill / Math.max(height, 1e-12))
        controls.minZoom = Math.min(controls.minZoom, camera.zoom); controls.maxZoom = Math.max(controls.maxZoom, camera.zoom)
    }
    camera.position.copy(center).add(new Vector3(0,0,distance).applyQuaternion(rotation))
    camera.near = Math.min(camera.near, Math.max(radius / 1000, 1e-8))
    camera.far = Math.max(camera.far, distance + radius * 3)
    controls.target.copy(center); controls.cursor.copy(center)
    controls.minDistance = Math.min(controls.minDistance, distance * 0.5)
    controls.maxDistance = Math.max(controls.maxDistance, distance * 2)
    const record = controls as unknown as { _sphericalDelta: { set(r: number, phi: number, theta: number): void }; _panOffset: Vector3; _scale: number; _performCursorZoom: boolean }
    record._sphericalDelta.set(0,0,0); record._panOffset.set(0,0,0); record._scale = 1; record._performCursorZoom = false
    const autoRotate = controls.autoRotate, damping = controls.enableDamping
    try { controls.autoRotate = false; controls.enableDamping = false; controls.update(0) }
    finally { controls.autoRotate = autoRotate; controls.enableDamping = damping }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
    return { status: 'ready', value: undefined }
}

export function createViewportFraming(options: {
    camera: Camera; controls: OrbitControls; canvas: HTMLElement; selectedActor(): Object3D | undefined
    report(reason: string): void; schedule(callback: FrameRequestCallback): number; cancel(id: number): void
}) {
    let restore: (() => void) | undefined, pending: number | undefined, enabled = false, disposed = false
    const cancelPending = () => { if (pending !== undefined) { options.cancel(pending); pending = undefined } }
    const frame = () => {
        cancelPending()
        if (!enabled || disposed || !restore) return
        const actor = options.selectedActor()
        const result = actor ? frameActor(options.camera, options.controls, actor, options.canvas.getBoundingClientRect()) : { status: 'unavailable' as const, reason: '请先选择要取景的角色' }
        if (result.status !== 'ready') options.report(result.reason)
    }
    const setEnabled = (value: boolean) => {
        if (disposed || value === enabled) return
        if (value) {
            restore = capture(options.camera, options.controls)
            if (!restore) { options.report('Orbit 正在交互或状态未就绪，请结束拖拽后重新进入演出'); return }
            enabled = true
            options.canvas.addEventListener('pointerdown', cancelPending, true)
            options.canvas.addEventListener('wheel', cancelPending, true)
            // Two one-shot frames let the workspace grid and ResizeObserver settle.
            pending = options.schedule(() => { pending = options.schedule(() => { pending = undefined; frame() }) })
        } else {
            cancelPending(); enabled = false
            options.canvas.removeEventListener('pointerdown', cancelPending, true)
            options.canvas.removeEventListener('wheel', cancelPending, true)
            restore?.(); restore = undefined
        }
    }
    return { frame, setEnabled, dispose() { if (disposed) return; setEnabled(false); disposed = true } }
}
