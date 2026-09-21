import * as THREE from 'three'
import type { ExactPhysicsBindingRegistry, ResolvedCharacterPhysicsBindings } from './binding'
import type {
    CharacterPhysicsNativeProduct,
    CharacterPhysicsProfile,
    PhysicsVector3,
} from './types'

export interface NativeColliderQueryOptions {
    includeTriggers?: boolean
    layerMask?: number
    stableKeys?: ReadonlySet<string>
}

export interface NativeColliderDescriptor {
    stableKey: string
    type: CharacterPhysicsNativeProduct['type']
    scope: CharacterPhysicsNativeProduct['scope']
    runtimeReady: boolean
    trigger: boolean
}

export interface NativeColliderContact {
    stableKey: string
    type: CharacterPhysicsNativeProduct['type']
    point: THREE.Vector3
    normal: THREE.Vector3
    penetration: number
    trigger: boolean
}

export interface NativeColliderProjection {
    point: THREE.Vector3
    contacted: boolean
    contacts: readonly NativeColliderContact[]
}

export interface NativeCharacterColliderRuntime {
    list(): readonly NativeColliderDescriptor[]
    querySphere(
        center: THREE.Vector3,
        radius: number,
        options?: NativeColliderQueryOptions,
    ): readonly NativeColliderContact[]
    projectSphere(
        center: THREE.Vector3,
        radius: number,
        options?: NativeColliderQueryOptions,
    ): NativeColliderProjection
}

interface MeshTriangleRecord {
    readonly first: THREE.Vector3
    readonly second: THREE.Vector3
    readonly third: THREE.Vector3
}

const EPSILON = 1e-8
const RAY_DIRECTION = new THREE.Vector3(1, 0.1234567, 0.057913).normalize()

function vector(value: PhysicsVector3 | undefined): THREE.Vector3 {
    if (!value) return new THREE.Vector3()
    return new THREE.Vector3(-value.x, value.y, value.z)
}

function recordValue(
    value: Readonly<Record<string, unknown>>,
    key: string,
): unknown {
    return value[key]
}

function recordNumber(
    value: Readonly<Record<string, unknown>>,
    key: string,
    fallback = 0,
): number {
    const candidate = recordValue(value, key)
    return typeof candidate === 'number' && Number.isFinite(candidate)
        ? candidate
        : fallback
}

function recordBoolean(
    value: Readonly<Record<string, unknown>>,
    key: string,
    fallback = false,
): boolean {
    const candidate = recordValue(value, key)
    return typeof candidate === 'boolean' ? candidate : fallback
}

function recordVector(
    value: Readonly<Record<string, unknown>>,
    key: string,
): PhysicsVector3 | undefined {
    const candidate = recordValue(value, key)
    if (!candidate || typeof candidate !== 'object') return undefined
    const components = candidate as Partial<PhysicsVector3>
    if (
        typeof components.x !== 'number'
        || typeof components.y !== 'number'
        || typeof components.z !== 'number'
    ) return undefined
    return { x: components.x, y: components.y, z: components.z }
}

function nestedLayerBits(
    value: Readonly<Record<string, unknown>>,
    key: string,
): number {
    const candidate = recordValue(value, key)
    if (!candidate || typeof candidate !== 'object') return 0
    const bits = (candidate as Readonly<Record<string, unknown>>).m_Bits
    return typeof bits === 'number' ? bits >>> 0 : 0
}

function layerAllows(
    product: CharacterPhysicsNativeProduct,
    layerMask: number | undefined,
): boolean {
    if (layerMask === undefined) return true
    const mask = layerMask >>> 0
    const include = nestedLayerBits(product.serialized, 'm_IncludeLayers')
    const exclude = nestedLayerBits(product.serialized, 'm_ExcludeLayers')
    if (exclude !== 0 && (exclude & mask) !== 0) return false
    return include === 0 || (include & mask) !== 0
}

function worldScale(object: THREE.Object3D): THREE.Vector3 {
    const result = object.getWorldScale(new THREE.Vector3())
    return result.set(Math.abs(result.x), Math.abs(result.y), Math.abs(result.z))
}

function contactForSphere(
    product: CharacterPhysicsNativeProduct,
    object: THREE.Object3D,
    center: THREE.Vector3,
    radius: number,
): NativeColliderContact | undefined {
    const serialized = product.serialized
    const colliderCenter = object.localToWorld(vector(recordVector(serialized, 'm_Center')))
    const scale = worldScale(object)
    const colliderRadius = Math.max(scale.x, scale.y, scale.z)
        * Math.max(0, recordNumber(serialized, 'm_Radius'))
    const combinedRadius = colliderRadius + radius
    const offset = center.clone().sub(colliderCenter)
    const distance = offset.length()
    if (distance >= combinedRadius) return undefined
    const normal = distance > EPSILON ? offset.divideScalar(distance) : new THREE.Vector3(0, 1, 0)
    const penetration = combinedRadius - distance
    return {
        stableKey: product.stableKey,
        type: product.type,
        point: center.clone().addScaledVector(normal, penetration),
        normal,
        penetration,
        trigger: recordBoolean(serialized, 'm_IsTrigger'),
    }
}

function contactForCapsule(
    product: CharacterPhysicsNativeProduct,
    object: THREE.Object3D,
    center: THREE.Vector3,
    radius: number,
): NativeColliderContact | undefined {
    const serialized = product.serialized
    const colliderCenter = object.localToWorld(vector(recordVector(serialized, 'm_Center')))
    const direction = recordNumber(serialized, 'm_Direction', 1)
    const localAxis = direction === 0
        ? new THREE.Vector3(1, 0, 0)
        : direction === 2
            ? new THREE.Vector3(0, 0, 1)
            : new THREE.Vector3(0, 1, 0)
    const worldAxis = localAxis.transformDirection(object.matrixWorld)
    const scale = worldScale(object)
    const axisScale = direction === 0 ? scale.x : direction === 2 ? scale.z : scale.y
    const radialScale = direction === 0
        ? Math.max(scale.y, scale.z)
        : direction === 2
            ? Math.max(scale.x, scale.y)
            : Math.max(scale.x, scale.z)
    const colliderRadius = Math.max(0, recordNumber(serialized, 'm_Radius')) * radialScale
    const segmentHalfLength = Math.max(
        0,
        recordNumber(serialized, 'm_Height') - recordNumber(serialized, 'm_Radius') * 2,
    ) * axisScale * 0.5
    const start = colliderCenter.clone().addScaledVector(worldAxis, -segmentHalfLength)
    const end = colliderCenter.clone().addScaledVector(worldAxis, segmentHalfLength)
    const segment = end.clone().sub(start)
    const segmentLengthSquared = segment.lengthSq()
    const ratio = segmentLengthSquared > EPSILON
        ? THREE.MathUtils.clamp(center.clone().sub(start).dot(segment) / segmentLengthSquared, 0, 1)
        : 0
    const nearest = start.addScaledVector(segment, ratio)
    const offset = center.clone().sub(nearest)
    const distance = offset.length()
    const combinedRadius = colliderRadius + radius
    if (distance >= combinedRadius) return undefined
    const normal = distance > EPSILON ? offset.divideScalar(distance) : worldAxis.clone()
    const penetration = combinedRadius - distance
    return {
        stableKey: product.stableKey,
        type: product.type,
        point: center.clone().addScaledVector(normal, penetration),
        normal,
        penetration,
        trigger: recordBoolean(serialized, 'm_IsTrigger'),
    }
}

function localMeshTriangles(product: CharacterPhysicsNativeProduct): readonly MeshTriangleRecord[] {
    const vertices = product.mesh?.vertices ?? []
    const indices = product.mesh?.indices ?? []
    const values = vertices.map(value => new THREE.Vector3(-value[0], value[1], value[2]))
    const triangles: MeshTriangleRecord[] = []
    for (let index = 0; index + 2 < indices.length; index += 3) {
        const first = values[indices[index]!]
        const second = values[indices[index + 1]!]
        const third = values[indices[index + 2]!]
        if (!first || !second || !third) continue
        triangles.push({ first, second, third })
    }
    return triangles
}

function pointInsideConvexMesh(
    point: THREE.Vector3,
    triangles: readonly THREE.Triangle[],
): boolean {
    const ray = new THREE.Ray(point, RAY_DIRECTION)
    const distances: number[] = []
    for (const triangle of triangles) {
        const hit = ray.intersectTriangle(
            triangle.a,
            triangle.b,
            triangle.c,
            false,
            new THREE.Vector3(),
        )
        if (!hit) continue
        const distance = hit.distanceTo(point)
        if (distance <= EPSILON) continue
        if (!distances.some(value => Math.abs(value - distance) < 1e-6)) distances.push(distance)
    }
    return distances.length % 2 === 1
}

function contactForMesh(
    product: CharacterPhysicsNativeProduct,
    object: THREE.Object3D,
    localTriangles: readonly MeshTriangleRecord[],
    center: THREE.Vector3,
    radius: number,
): NativeColliderContact | undefined {
    if (!localTriangles.length) return undefined
    object.updateWorldMatrix(true, false)
    const worldTriangles = localTriangles.map(value => new THREE.Triangle(
        value.first.clone().applyMatrix4(object.matrixWorld),
        value.second.clone().applyMatrix4(object.matrixWorld),
        value.third.clone().applyMatrix4(object.matrixWorld),
    ))
    let nearestPoint: THREE.Vector3 | undefined
    let nearestTriangle: THREE.Triangle | undefined
    let distanceSquared = Number.POSITIVE_INFINITY
    for (const triangle of worldTriangles) {
        const candidate = triangle.closestPointToPoint(center, new THREE.Vector3())
        const candidateDistance = candidate.distanceToSquared(center)
        if (candidateDistance >= distanceSquared) continue
        nearestPoint = candidate
        nearestTriangle = triangle
        distanceSquared = candidateDistance
    }
    if (!nearestPoint || !nearestTriangle) return undefined
    const convex = recordBoolean(product.serialized, 'm_Convex')
    const inside = convex && pointInsideConvexMesh(center, worldTriangles)
    const distance = Math.sqrt(distanceSquared)
    if (!inside && distance >= radius) return undefined
    const normal = inside
        ? nearestPoint.clone().sub(center)
        : center.clone().sub(nearestPoint)
    if (normal.lengthSq() <= EPSILON) nearestTriangle.getNormal(normal)
    else normal.normalize()
    const penetration = inside ? distance + radius : radius - distance
    return {
        stableKey: product.stableKey,
        type: product.type,
        point: inside
            ? nearestPoint.clone().addScaledVector(normal, radius)
            : center.clone().addScaledVector(normal, penetration),
        normal,
        penetration,
        trigger: recordBoolean(product.serialized, 'm_IsTrigger'),
    }
}

class NativeCharacterColliders implements NativeCharacterColliderRuntime {
    private readonly meshTriangles = new Map<string, readonly MeshTriangleRecord[]>()
    private readonly products: readonly CharacterPhysicsNativeProduct[]
    private readonly bindings: ResolvedCharacterPhysicsBindings
    private readonly external?: ExactPhysicsBindingRegistry

    constructor(
        products: readonly CharacterPhysicsNativeProduct[],
        bindings: ResolvedCharacterPhysicsBindings,
        external?: ExactPhysicsBindingRegistry,
    ) {
        this.products = products
        this.bindings = bindings
        this.external = external
        for (const product of products) {
            if (product.type === 'MeshCollider') {
                this.meshTriangles.set(product.stableKey, localMeshTriangles(product))
            }
        }
    }

    list(): readonly NativeColliderDescriptor[] {
        return this.products.map(product => ({
            stableKey: product.stableKey,
            type: product.type,
            scope: product.scope,
            runtimeReady: Object.values(product.activation).every(Boolean)
                && this.resolveObject(product) !== undefined,
            trigger: recordBoolean(product.serialized, 'm_IsTrigger'),
        }))
    }

    querySphere(
        center: THREE.Vector3,
        radius: number,
        options: NativeColliderQueryOptions = {},
    ): readonly NativeColliderContact[] {
        const contacts: NativeColliderContact[] = []
        for (const product of this.products) {
            if (!this.accepts(product, options)) continue
            const object = this.resolveObject(product)
            if (!object) continue
            object.updateWorldMatrix(true, false)
            const contact = this.contact(product, object, center, Math.max(0, radius))
            if (contact) contacts.push(contact)
        }
        return contacts
    }

    projectSphere(
        center: THREE.Vector3,
        radius: number,
        options: NativeColliderQueryOptions = {},
    ): NativeColliderProjection {
        const point = center.clone()
        const contacts: NativeColliderContact[] = []
        for (let iteration = 0; iteration < 4; iteration += 1) {
            let changed = false
            for (const product of this.products) {
                if (!this.accepts(product, options)) continue
                const object = this.resolveObject(product)
                if (!object) continue
                object.updateWorldMatrix(true, false)
                const contact = this.contact(product, object, point, Math.max(0, radius))
                if (!contact) continue
                point.copy(contact.point)
                contacts.push(contact)
                changed = true
            }
            if (!changed) break
        }
        return { point, contacted: contacts.length > 0, contacts }
    }

    private accepts(
        product: CharacterPhysicsNativeProduct,
        options: NativeColliderQueryOptions,
    ): boolean {
        if (!recordBoolean(product.serialized, 'm_Enabled', true)) return false
        if (!options.includeTriggers && recordBoolean(product.serialized, 'm_IsTrigger')) return false
        if (options.stableKeys && !options.stableKeys.has(product.stableKey)) return false
        return layerAllows(product, options.layerMask)
    }

    private resolveObject(product: CharacterPhysicsNativeProduct): THREE.Object3D | undefined {
        if (!Object.values(product.activation).every(Boolean)) return undefined
        return this.bindings.byStableKey.get(product.stableKey)
            ?? this.external?.resolve(product.binding.stableKey)
    }

    private contact(
        product: CharacterPhysicsNativeProduct,
        object: THREE.Object3D,
        center: THREE.Vector3,
        radius: number,
    ): NativeColliderContact | undefined {
        if (product.type === 'CapsuleCollider') {
            return contactForCapsule(product, object, center, radius)
        }
        if (product.type === 'SphereCollider') {
            return contactForSphere(product, object, center, radius)
        }
        if (product.type === 'MeshCollider') {
            return contactForMesh(
                product,
                object,
                this.meshTriangles.get(product.stableKey) ?? [],
                center,
                radius,
            )
        }
        return undefined
    }
}

export function createNativeCharacterColliderRuntime(
    profile: CharacterPhysicsProfile,
    bindings: ResolvedCharacterPhysicsBindings,
    external?: ExactPhysicsBindingRegistry,
): NativeCharacterColliderRuntime {
    return new NativeCharacterColliders(profile.components.native, bindings, external)
}
