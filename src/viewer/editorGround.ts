import { Box3, Camera, DoubleSide, InstancedMesh, Matrix3, Matrix4, Mesh, MeshBasicMaterial, Object3D, Raycaster, Vector3 } from 'three'

export interface GroundSample { height: number; source: 'scene' | 'reference-plane' }
const down = new Vector3(0, -1, 0)
const excluded = /sky|cloud|dome|particle|volumetric|outline|shadow|gizmo/i
const worldVisible = (node: Object3D) => {
    for (let current: Object3D | null = node; current; current = current.parent) if (!current.visible) return false
    return true
}
export function liftWorld(object: Object3D, distance: number): void {
    if (!Number.isFinite(distance) || distance <= 0) return
    const point = object.getWorldPosition(new Vector3()).addScaledVector(new Vector3(0, 1, 0), distance)
    if (object.parent) object.parent.worldToLocal(point)
    object.position.copy(point)
    object.updateWorldMatrix(false, true)
}

/** Read-only collision proxies reuse scene geometry. Unrecovered or empty
 * scenes retain a reference plane rather than permitting an unbounded fall. */
export class EditorGroundGuard {
    private stage?: Object3D
    private stageId = ''
    private proxies: Mesh[] = []
    private sources = new Map<Mesh, Mesh>()
    private readonly material = new MeshBasicMaterial({ side: DoubleSide })
    private readonly ray = new Raycaster()
    private readonly normal = new Vector3()
    private readonly normalMatrix = new Matrix3()
    private referenceY = 0
    private readonly hulls = new WeakMap<Object3D, Vector3[]>()
    private readonly signatures = new WeakMap<Object3D, string>()
    private cameraSignature = ''
    private readonly readStage: () => Object3D | undefined
    queries = 0
    inspect(object: Object3D) {
        return { stageId: this.stageId, referenceY: this.referenceY, proxyCount: this.proxies.length,
            hull: this.hulls.get(object)?.map(p => p.toArray()), world: object.getWorldPosition(new Vector3()).toArray(), queries: this.queries }
    }
    visualBounds(object: Object3D): Box3 {
        this.capture(object)
        return new Box3().setFromPoints((this.hulls.get(object) ?? [new Vector3()]).map(p => p.clone().applyMatrix4(object.matrixWorld)))
    }
    constructor(readStage: () => Object3D | undefined) { this.readStage = readStage }
    private refresh() {
        const root = this.readStage()
        const active = root?.children.find(child => child.visible)
        const id = String(root?.userData.stageDefinition?.id ?? 'none')
        if (active === this.stage && id === this.stageId) return
        this.stage = active; this.stageId = id; this.proxies = []; this.sources.clear(); this.cameraSignature = ''
        const spawn = root?.userData.stageDefinition?.spawnPoints?.find((p: { role?: string }) => p.role === 'ally')
        this.referenceY = Number.isFinite(spawn?.position?.[1]) ? spawn.position[1] : 0
        active?.updateWorldMatrix(true, true)
        active?.traverse(node => {
            const source = node as Mesh
            if (!source.isMesh || (source as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh || source.renderOrder < -10 || excluded.test(source.name) || !worldVisible(source)) return
            if (!source.geometry.getAttribute('position')?.count) return
            const materials = Array.isArray(source.material) ? source.material : [source.material]
            if (materials.every(m => !m.visible || m.opacity < 0.1)) return
            let proxy: Mesh
            if ((source as InstancedMesh).isInstancedMesh) {
                const instances = source as InstancedMesh
                const copy = new InstancedMesh(source.geometry, this.material, instances.count)
                copy.instanceMatrix = instances.instanceMatrix; proxy = copy
            } else proxy = new Mesh(source.geometry, this.material)
            proxy.matrixAutoUpdate = false; proxy.matrixWorld.copy(source.matrixWorld)
            this.proxies.push(proxy); this.sources.set(proxy, source)
        })
    }
    sample(x: number, z: number, nearHeight = this.referenceY): GroundSample {
        this.refresh()
        if (![x, z, nearHeight].every(Number.isFinite)) return { height: this.referenceY, source: 'reference-plane' }
        ++this.queries
        const start = Math.max(nearHeight, this.referenceY) + 1
        this.ray.set(new Vector3(x, start, z), down)
        this.ray.near = 0; this.ray.far = Math.max(50, start - this.referenceY + 50)
        for (const [proxy, source] of this.sources) { source.updateWorldMatrix(true, false); proxy.matrixWorld.copy(source.matrixWorld) }
        for (const hit of this.ray.intersectObjects(this.proxies, false)) {
            const source = this.sources.get(hit.object as Mesh)
            if (!source || !worldVisible(source) || !hit.face) continue
            const matrix = hit.object.matrixWorld.clone()
            if (hit.instanceId !== undefined && (hit.object as InstancedMesh).isInstancedMesh) {
                const instance = new Matrix4(); (hit.object as InstancedMesh).getMatrixAt(hit.instanceId, instance); matrix.multiply(instance)
            }
            this.normalMatrix.getNormalMatrix(matrix)
            this.normal.copy(hit.face.normal).applyNormalMatrix(this.normalMatrix).normalize()
            if (Math.abs(this.normal.y) < 0.55) continue
            return { height: hit.point.y, source: 'scene' }
        }
        return { height: this.referenceY, source: 'reference-plane' }
    }
    capture(object: Object3D): void {
        object.updateWorldMatrix(true, true)
        const box = new Box3()
        const characterBody = object.getObjectByName('Body_Mesh')
        object.traverse(node => {
            const mesh = node as Mesh & { isSkinnedMesh?: boolean; boundingBox?: Box3 | null; computeBoundingBox?(): void }
            if (!mesh.isMesh || !worldVisible(mesh) || /outline|shadow|helper|gizmo/i.test(mesh.name)) return
            // Native character animations park tiny, unused weapon geometry at
            // Y=-10 while retaining Mesh.visible=true. These are not the feet.
            // A separately selected weapon/prop has no Body_Mesh and retains
            // its own complete floor-contact bounds.
            if (characterBody && /weapon|wpn/i.test(mesh.name)) return
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            if (materials.every(m => !m.visible || m.opacity < 0.1)) return
            if (mesh.isSkinnedMesh && mesh.computeBoundingBox) mesh.computeBoundingBox()
            else if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
            const bounds = mesh.isSkinnedMesh ? mesh.boundingBox : mesh.geometry.boundingBox
            if (bounds) box.union(bounds.clone().applyMatrix4(mesh.matrixWorld))
        })
        if (box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) { this.hulls.set(object, [new Vector3()]); return }
        const inverse = new Matrix4().copy(object.matrixWorld).invert(), corners: Vector3[] = []
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new Vector3(x, y, z).applyMatrix4(inverse))
        this.hulls.set(object, corners); this.signatures.delete(object)
    }
    constrainObject(object: Object3D, force = false): boolean {
        this.refresh()
        if (!object.parent) return false
        object.updateWorldMatrix(true, false)
        const key = this.stageId + ':' + object.matrixWorld.elements.join(',')
        if (!force && this.signatures.get(object) === key) return false
        if (!this.hulls.has(object)) this.capture(object)
        const points = this.hulls.get(object)!.map(p => p.clone().applyMatrix4(object.matrixWorld))
        const root = object.getWorldPosition(new Vector3())
        const bottom = Math.min(root.y, ...points.map(p => p.y))
        let lift = this.sample(root.x, root.z, root.y).height - bottom
        for (const p of points) if (p.y < bottom + 0.3) lift = Math.max(lift, this.sample(p.x, p.z, root.y).height - p.y)
        if (lift > 1e-5) liftWorld(object, lift + 1e-4)
        object.updateWorldMatrix(true, false)
        this.signatures.set(object, this.stageId + ':' + object.matrixWorld.elements.join(','))
        return lift > 1e-5
    }
    constrainCamera(camera: Camera, controls: { target: Vector3; enabled: boolean; maxPolarAngle: number }): boolean {
        this.refresh()
        const key = this.stageId + ':' + camera.position.toArray().join(',') + ':' + controls.target.toArray().join(',')
        if (key === this.cameraSignature) return false
        const targetGround = this.sample(controls.target.x, controls.target.z, controls.target.y).height
        const ground = this.sample(camera.position.x, camera.position.z, controls.target.y).height
        const clearance = Math.max(0.08, Math.min(0.5, Number((camera as Camera & { near?: number }).near ?? 0.05) * 1.5))
        let changed = false
        if (controls.enabled && controls.target.y < targetGround + 0.02) {
            const dy = targetGround + 0.0201 - controls.target.y
            controls.target.y += dy; camera.position.y += dy; changed = true
        }
        if (camera.position.y < ground + clearance) { camera.position.y = ground + clearance + 1e-4; changed = true }
        if (controls.enabled) {
            const radius = camera.position.distanceTo(controls.target)
            controls.maxPolarAngle = Math.acos(Math.max(-0.9999, Math.min(0.9999, (ground + clearance - controls.target.y) / Math.max(radius, clearance))))
            if (changed) camera.lookAt(controls.target)
        }
        if (changed) camera.updateMatrixWorld()
        this.cameraSignature = this.stageId + ':' + camera.position.toArray().join(',') + ':' + controls.target.toArray().join(',')
        return changed
    }
    dispose() { this.proxies.length = 0; this.sources.clear(); this.material.dispose() }
}
