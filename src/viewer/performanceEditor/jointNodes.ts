import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
    Object3D, OrthographicCamera, PerspectiveCamera, Quaternion, RingGeometry, Vector2, Vector3 } from 'three'
import type { Camera, Scene, SkinnedMesh } from 'three'
import type { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { PerformanceActorAdapter } from './actorAdapter.ts'
import type { PerformanceEditorRuntime } from './runtime.ts'
import type { Availability } from './types.ts'

export interface JointNodeIdentity { actorKey: string; generation: number; boneKey: string; boneUuid: string; label: string }
export interface PoseSelection { actorKey: string; generation: number; boneKey: string }
interface RegisteredJoint { identity: JointNodeIdentity; bone: Object3D }
const belongsTo = (bone: Object3D, root: Object3D) => {
    for (let node: Object3D | null = bone; node; node = node.parent) if (node === root) return true
    return false
}
/**
 * Keep the editing surface to animator controls a person can actually use.
 * Clothing, hair, ribbons and helper bones remain driven by the authored
 * physics/animation layers; exposing thousands of those nodes both obscures
 * the rig and makes pointer hit testing needlessly expensive.  The key is
 * still resolved against the exact Object3D below, so this is only a visual
 * affordance filter, not a name-based binding shortcut.
 */
const EDITABLE_TERMINALS = new Set([
    'root', 'hip', 'spine', 'waist', 'chest', 'neck', 'head',
    'shoulder_l', 'shoulder_r', 'arm_l', 'arm_r', 'forearm_l', 'forearm_r',
    'hand_l', 'hand_r', 'upleg_l', 'upleg_r', 'leg_l', 'leg_r',
    'foot_l', 'foot_r', 'toe_l', 'toe_r',
])
const NON_EDITABLE_HINT = /(?:hair|pony|twin|skirt|dress|cloth|sleeve|cuff|ribbon|rendo|weapon|accessory|gem|jewel|shadow|outline|end$)/i
function isPrimaryEditableJoint(key: string, bone: Object3D): boolean {
    // ActorAdapter paths include a stable child index (`/0:hip`).  Strip that
    // transport prefix before applying the animator-facing terminal allowlist;
    // otherwise every real skin joint is silently filtered out.
    const terminal = key.replace(/\\/g, '/').split('/').at(-1) ?? ''
    const normalized = terminal.replace(/^\d+:/, '').replace(/(?:\.001|_end)$/i, '').toLowerCase()
    if (NON_EDITABLE_HINT.test(key) || NON_EDITABLE_HINT.test(bone.name)) return false
    return EDITABLE_TERMINALS.has(normalized)
}
/** One visual per exact primary Bone object registered in a real skin; names are never joins. */
export function registeredJointNodes(actor: PerformanceActorAdapter): RegisteredJoint[] {
    if (!actor.current) return []
    const registered = new Set<Object3D>(), keys = new Map([...actor.bones].map(([key, bone]) => [bone, key]))
    const skinned: Object3D[] = []
    actor.descriptor.object.traverse(object => {
        const mesh = object as SkinnedMesh
        if (mesh.isSkinnedMesh && mesh.skeleton) for (const bone of mesh.skeleton.bones) {
            if (bone.isBone && keys.has(bone) && belongsTo(bone, actor.descriptor.object)
                && !NON_EDITABLE_HINT.test(keys.get(bone)!) && !NON_EDITABLE_HINT.test(bone.name)) skinned.push(bone)
        }
    })
    // Prefer semantic animator joints. Some official FBX rigs use opaque or
    // localized bone names, so a strict allowlist would expose zero controls;
    // in that case retain a bounded set of exact skin bones as a usable
    // fallback. This never invents names or binds unskinned helpers.
    const primary = skinned.filter((bone, index, all) => all.indexOf(bone) === index && isPrimaryEditableJoint(keys.get(bone)!, bone))
    for (const bone of (primary.length ? primary : skinned).slice(0, 24)) registered.add(bone)
    return [...registered].map(bone => ({ bone, identity: { actorKey: actor.key, generation: actor.descriptor.generation,
        boneKey: keys.get(bone)!, boneUuid: bone.uuid,
        label: `${bone.name || 'Joint'} · ${keys.get(bone)} · ${bone.uuid.slice(0, 8)}` } }))
}

interface JointLayerOptions {
    scene: Scene; camera: Camera; canvas: HTMLElement; runtime: PerformanceEditorRuntime
    selection(): PoseSelection | undefined
    subscribeSelection(listener: () => void): () => void
    subscribeFrame(listener: () => void): () => void
    interactionBlocked(event: PointerEvent): boolean
    select(identity: JointNodeIdentity, pointer?: PointerEvent): Availability<void>
    showCandidates(identities: readonly JointNodeIdentity[], choose: (identity: JointNodeIdentity) => void): void
    clearCandidates(): void
    report(reason: string): void
}
/** Editing-only draw helpers. No bone/mesh TRS, skin, camera layer or Orbit mutation. */
export function createJointNodeLayer(options: JointLayerOptions) {
    const group = new Group(); group.name = 'PerformanceJointNodes'; group.matrixAutoUpdate = false
    const world = new Vector3(), eye = new Vector3(), rotation = new Quaternion()
    let enabled = false, disposed = false, actor: PerformanceActorAdapter | undefined
    let rows: (RegisteredJoint & { marker: Mesh; screen: Vector2; projectable: boolean })[] = [], releases: (() => void)[] = []
    let geometry: RingGeometry | undefined, material: MeshBasicMaterial | undefined, selectedMaterial: MeshBasicMaterial | undefined
    let lineGeometry: BufferGeometry | undefined, lineMaterial: LineBasicMaterial | undefined
    let edges: [Object3D, Object3D][] = [], lines: LineSegments | undefined
    let token = '', missingReported = false
    const clear = () => {
        group.removeFromParent(); group.clear()
        geometry?.dispose(); material?.dispose(); selectedMaterial?.dispose(); lineGeometry?.dispose(); lineMaterial?.dispose()
        geometry = undefined; material = undefined; selectedMaterial = undefined; lineGeometry = undefined; lineMaterial = undefined
        rows = []; edges = []; lines = undefined; actor = undefined; token = ''; missingReported = false
        options.clearCandidates()
    }
    const build = (next: PerformanceActorAdapter) => {
        clear(); actor = next; token = `${next.key}:${next.descriptor.generation}`
        const registered = registeredJointNodes(next)
        if (!registered.length) { options.report('当前角色没有可用的蒙皮骨架关节绑定'); missingReported = true; return }
        geometry = new RingGeometry(0.66, 1, 16)
        material = new MeshBasicMaterial({ color: 0x3fe0ff, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, toneMapped: false })
        selectedMaterial = new MeshBasicMaterial({ color: 0xffcd38, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
        const jointSet = new Set(registered.map(row => row.bone))
        rows = registered.map(row => {
            const marker = new Mesh(geometry, material); marker.name = `Joint:${row.identity.boneUuid}`
            marker.renderOrder = 10002; marker.userData.jointIdentity = row.identity; group.add(marker)
            let parent = row.bone.parent
            while (parent && parent !== next.descriptor.object && !jointSet.has(parent)) parent = parent.parent
            if (parent && jointSet.has(parent)) edges.push([parent, row.bone])
            return { ...row, marker, screen: new Vector2(), projectable: false }
        })
        lineGeometry = new BufferGeometry(); lineGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(edges.length * 6), 3))
        lineMaterial = new LineBasicMaterial({ color: 0x3fe0ff, transparent: true, opacity: 0.25, depthTest: false, depthWrite: false, toneMapped: false })
        lines = new LineSegments(lineGeometry, lineMaterial); lines.frustumCulled = false; lines.renderOrder = 10001; group.add(lines)
        options.scene.add(group)
    }
    const update = () => {
        if (!enabled || disposed) return
        const selected = options.selection(), next = selected && options.runtime.actors.get(selected.actorKey)
        if (!next?.current || next.descriptor.generation !== selected!.generation) {
            if (actor || rows.length) { options.runtime.endDrag(); clear() }
            return
        }
        if (actor !== next || token !== `${next.key}:${next.descriptor.generation}`) { options.runtime.endDrag(); build(next) }
        if (!rows.length) { if (!missingReported) options.report('当前角色没有可用的蒙皮骨架关节绑定'); return }
        const rect = options.canvas.getBoundingClientRect()
        options.camera.updateWorldMatrix(true, false); options.scene.updateWorldMatrix(true, false)
        group.matrix.copy(options.scene.matrixWorld).invert()
        options.camera.getWorldQuaternion(rotation)
        const occupied = new Set<string>()
        // One hollow glyph per 7px screen cell. All identities remain in picking;
        // the selected node wins its cell, never a label/name-based priority.
        for (const row of [...rows].sort((a, b) => Number(b.identity.boneKey === selected!.boneKey) - Number(a.identity.boneKey === selected!.boneKey))) {
            row.bone.getWorldPosition(world); eye.copy(world).applyMatrix4(options.camera.matrixWorldInverse)
            let units = 0
            if (options.camera instanceof PerspectiveCamera) units = -eye.z * 2 * Math.tan(options.camera.fov * Math.PI / 360) / options.camera.zoom
            else if (options.camera instanceof OrthographicCamera) units = (options.camera.top - options.camera.bottom) / options.camera.zoom
            const active = row.identity.boneKey === selected!.boneKey
            row.marker.position.copy(world); row.marker.quaternion.copy(rotation)
            row.marker.scale.setScalar(Math.max(0, units) * (active ? 4.5 : 2.5) / Math.max(1, rect.height))
            const projected = world.clone().project(options.camera)
            row.screen.set(rect.left + (projected.x + 1) * rect.width / 2, rect.top + (1 - projected.y) * rect.height / 2)
            row.projectable = belongsTo(row.bone, next.descriptor.object) && eye.z < 0 && projected.z >= -1 && projected.z <= 1
                && projected.x >= -1 && projected.x <= 1 && projected.y >= -1 && projected.y <= 1 && rect.width > 0 && rect.height > 0
            const cell = `${Math.floor(row.screen.x / 7)}:${Math.floor(row.screen.y / 7)}`
            row.marker.visible = row.projectable && !occupied.has(cell)
            if (row.marker.visible) occupied.add(cell)
            row.marker.material = active ? selectedMaterial! : material!
        }
        const positions = lineGeometry!.getAttribute('position')
        const selectedBone = next.bones.get(selected!.boneKey)
        let segments = 0
        for (const [parent, child] of edges) {
            if (parent !== selectedBone && child !== selectedBone) continue
            parent.getWorldPosition(world); positions.setXYZ(segments * 2, world.x, world.y, world.z)
            child.getWorldPosition(world); positions.setXYZ(segments * 2 + 1, world.x, world.y, world.z); segments++
        }
        lineGeometry!.setDrawRange(0, segments * 2)
        positions.needsUpdate = true; group.updateMatrixWorld(true)
    }
    const pick = (clientX: number, clientY: number): JointNodeIdentity[] => {
        update()
        if (!enabled || !actor?.current) return []
        const rect = options.canvas.getBoundingClientRect()
        if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return []
        const current = new Set(registeredJointNodes(actor).map(row => row.bone))
        // Hit area is independent of glyph area. A 10px radius covers a whole
        // 7px cell (including decluttered nodes), retaining the exact chooser.
        return rows.filter(row => row.projectable && current.has(row.bone)
            && row.screen.distanceToSquared(new Vector2(clientX, clientY)) <= 100).map(row => ({ ...row.identity }))
    }
    const choose = (identity: JointNodeIdentity, event?: PointerEvent) => {
        const selected = options.selection(), current = options.runtime.actors.get(identity.actorKey)
        if (!enabled || !current?.current || selected?.actorKey !== identity.actorKey || selected.generation !== identity.generation
            || current.descriptor.generation !== identity.generation || !registeredJointNodes(current).some(row => row.identity.boneKey === identity.boneKey && row.identity.boneUuid === identity.boneUuid)) {
            options.clearCandidates(); options.report('关节所属角色或骨架已变化，请重新选择'); return
        }
        options.clearCandidates()
        const result = options.select(identity, event)
        if (result.status !== 'ready') options.report(result.reason)
    }
    const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || event.isPrimary === false || options.interactionBlocked(event)) return
        const hits = pick(event.clientX, event.clientY)
        if (!hits.length) return
        event.preventDefault(); event.stopImmediatePropagation()
        if (hits.length === 1) choose(hits[0], event)
        else options.showCandidates(hits, identity => choose(identity))
    }
    const setEnabled = (value: boolean) => {
        if (disposed || value === enabled) return
        enabled = value
        if (value) {
            options.canvas.addEventListener('pointerdown', onPointerDown, true)
            releases = [options.subscribeSelection(update), options.runtime.subscribe(kind => { if (kind === 'actors') update() }), options.subscribeFrame(update)]
            update()
        } else {
            options.canvas.removeEventListener('pointerdown', onPointerDown, true)
            for (const release of releases.splice(0)) release()
            options.runtime.endDrag(); clear()
        }
    }
    return { setEnabled, update, pick, get presentation() { return { identities: rows.length, glyphs: rows.filter(row => row.marker.visible).length, glyph: 'hollow-ring', hitRadiusPx: 10 } }, get identities() { return rows.map(row => ({ ...row.identity })) },
        dispose() { if (disposed) return; setEnabled(false); disposed = true } }
}

/** Forward the original node gesture into the EXISTING TransformControls owner.
 * Rotation uses its free-rotation axis; IK uses its world-plane translation.
 */
export function beginJointPointerDrag(control: TransformControls, canvas: HTMLElement, event: PointerEvent, mode: 'joint' | 'ik' | 'gizmo'): () => void {
    const pointer = (e: PointerEvent, button: number) => { const rect = canvas.getBoundingClientRect()
        return { x: (e.clientX - rect.left) / rect.width * 2 - 1, y: -(e.clientY - rect.top) / rect.height * 2 + 1, button } as PointerEvent }
    let live = true
    const release = () => { if (!live) return; live = false
        canvas.removeEventListener('pointermove', move, true); canvas.removeEventListener('pointerup', end, true)
        canvas.removeEventListener('pointercancel', end, true); canvas.removeEventListener('lostpointercapture', end, true)
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    const move = (e: PointerEvent) => { if (!live || e.pointerId !== event.pointerId) return
        e.preventDefault(); e.stopImmediatePropagation(); control.getHelper().updateMatrixWorld(true); control.pointerMove(pointer(e, -1)) }
    const end = (e: PointerEvent) => { if (!live || e.pointerId !== event.pointerId) return
        e.preventDefault(); e.stopImmediatePropagation(); release(); control.pointerUp(pointer(e, 0)) }
    // Existing gizmos retain the exact raycast axis, unlike direct free-rotation/IK nodes.
    if (mode !== 'gizmo') control.axis = mode === 'joint' ? 'XYZE' : 'XYZ'
    control.getHelper().updateMatrixWorld(true)
    control.pointerDown(pointer(event, 0))
    canvas.setPointerCapture(event.pointerId)
    canvas.addEventListener('pointermove', move, true); canvas.addEventListener('pointerup', end, true)
    canvas.addEventListener('pointercancel', end, true); canvas.addEventListener('lostpointercapture', end, true)
    return release
}

/** Resolve this pointer, not the last hover. A miss never detaches the selected gizmo.
 * A hit uses the same capture/cancel lifetime as node dragging before Orbit sees down.
 */
export function beginExistingJointGizmoPointerDrag(control: TransformControls, canvas: HTMLElement, event: PointerEvent): (() => void) | undefined {
    if (!control.enabled || !control.object || control.dragging || event.button !== 0 || event.isPrimary === false) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return
    control.getHelper().updateMatrixWorld(true)
    control.pointerHover({ x: (event.clientX - rect.left) / rect.width * 2 - 1, y: -(event.clientY - rect.top) / rect.height * 2 + 1 } as PointerEvent)
    if (!control.axis) return
    event.preventDefault(); event.stopImmediatePropagation()
    return beginJointPointerDrag(control, canvas, event, 'gizmo')
}
