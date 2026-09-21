import * as THREE from 'three'
import { evaluateUnityCurve } from './math'
import type { ExactPhysicsBindingRegistry, ResolvedCharacterPhysicsBindings } from './binding'
import type {
    CharacterPhysicsProfile,
    CharacterPhysicsWindZoneProduct,
} from './types'

export interface MagicaWindZoneDescriptor {
    stableKey: string
    bindingStableKey: string
    mode: 0 | 1 | 2 | 3
    addition: boolean
    scope: CharacterPhysicsWindZoneProduct['scope']
    runtimeReady: boolean
}

export interface MagicaWindSample {
    vector: THREE.Vector3
    baseStableKey: string | null
    additiveStableKeys: readonly string[]
}

export interface MagicaWindRuntime {
    list(): readonly MagicaWindZoneDescriptor[]
    sample(point: THREE.Vector3, elapsedSeconds: number): MagicaWindSample
}

interface ZoneSample {
    readonly zone: CharacterPhysicsWindZoneProduct
    readonly vector: THREE.Vector3
    readonly volume: number
}

const EPSILON = 1e-8

function hashUnit(value: string): number {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0) / 0xffffffff
}

class CharacterMagicaWind implements MagicaWindRuntime {
    private readonly zones: readonly CharacterPhysicsWindZoneProduct[]
    private readonly bindings: ResolvedCharacterPhysicsBindings
    private readonly external?: ExactPhysicsBindingRegistry

    constructor(
        zones: readonly CharacterPhysicsWindZoneProduct[],
        bindings: ResolvedCharacterPhysicsBindings,
        external?: ExactPhysicsBindingRegistry,
    ) {
        this.zones = zones
        this.bindings = bindings
        this.external = external
    }

    list(): readonly MagicaWindZoneDescriptor[] {
        return this.zones.map(zone => ({
            stableKey: zone.stableKey,
            bindingStableKey: zone.binding.stableKey,
            mode: zone.settings.mode,
            addition: zone.settings.isAddition !== 0,
            scope: zone.scope,
            runtimeReady: this.resolveObject(zone) !== undefined,
        }))
    }

    sample(point: THREE.Vector3, elapsedSeconds: number): MagicaWindSample {
        const samples = this.zones
            .map(zone => this.sampleZone(zone, point, elapsedSeconds))
            .filter((value): value is ZoneSample => value !== undefined)
        // MagicaCloth chooses the smallest containing non-additive volume.
        // A global directional zone has infinite volume and therefore lowest
        // priority.  Up to three additive zones are accumulated separately.
        const base = samples
            .filter(sample => sample.zone.settings.isAddition === 0)
            .sort((first, second) => first.volume - second.volume)[0]
        const additions = samples
            .filter(sample => sample.zone.settings.isAddition !== 0)
            .sort((first, second) => first.volume - second.volume)
            .slice(0, 3)
        const vector = base?.vector.clone() ?? new THREE.Vector3()
        for (const addition of additions) vector.add(addition.vector)
        return {
            vector,
            baseStableKey: base?.zone.stableKey ?? null,
            additiveStableKeys: additions.map(sample => sample.zone.stableKey),
        }
    }

    private sampleZone(
        zone: CharacterPhysicsWindZoneProduct,
        point: THREE.Vector3,
        elapsedSeconds: number,
    ): ZoneSample | undefined {
        if (!Object.values(zone.activation).every(Boolean)) return undefined
        if (!zone.settings.m_Enabled) return undefined
        const object = this.resolveObject(zone)
        if (!object) return undefined
        object.updateWorldMatrix(true, false)
        const center = object.getWorldPosition(new THREE.Vector3())
        const localPoint = point.clone().applyMatrix4(object.matrixWorld.clone().invert())
        let normalizedDistance = 0
        let volume = Number.POSITIVE_INFINITY
        if (zone.settings.mode === 1 || zone.settings.mode === 3) {
            if (zone.settings.radius <= 0) return undefined
            normalizedDistance = localPoint.length() / zone.settings.radius
            if (normalizedDistance > 1) return undefined
            volume = 4 / 3 * Math.PI * zone.settings.radius ** 3
        } else if (zone.settings.mode === 2) {
            const half = new THREE.Vector3(
                zone.settings.size.x,
                zone.settings.size.y,
                zone.settings.size.z,
            ).multiplyScalar(0.5)
            if (half.x <= 0 || half.y <= 0 || half.z <= 0) return undefined
            normalizedDistance = Math.max(
                Math.abs(localPoint.x) / half.x,
                Math.abs(localPoint.y) / half.y,
                Math.abs(localPoint.z) / half.z,
            )
            if (normalizedDistance > 1) return undefined
            volume = zone.settings.size.x * zone.settings.size.y * zone.settings.size.z
        }
        const attenuation = evaluateUnityCurve(zone.settings.attenuation, normalizedDistance)
        let direction: THREE.Vector3
        if (zone.settings.mode === 3) {
            direction = point.clone().sub(center)
            if (direction.lengthSq() <= EPSILON) direction.set(0, 1, 0)
            else direction.normalize()
        } else {
            const euler = new THREE.Euler(
                THREE.MathUtils.degToRad(zone.settings.directionAngleX),
                THREE.MathUtils.degToRad(-zone.settings.directionAngleY),
                0,
                'YXZ',
            )
            direction = new THREE.Vector3(0, 0, 1)
                .applyEuler(euler)
                .transformDirection(object.matrixWorld)
        }
        const phase = elapsedSeconds * Math.PI * 2
            + hashUnit(zone.stableKey) * Math.PI * 2
            + normalizedDistance * 7.31
        const turbulence = 1 + Math.sin(phase) * zone.settings.turbulence * 0.25
        direction.multiplyScalar(zone.settings.main * attenuation * turbulence)
        return { zone, vector: direction, volume }
    }

    private resolveObject(zone: CharacterPhysicsWindZoneProduct): THREE.Object3D | undefined {
        if (!Object.values(zone.activation).every(Boolean)) return undefined
        return this.bindings.byStableKey.get(zone.stableKey)
            ?? this.external?.resolve(zone.binding.stableKey)
    }
}

export function createMagicaWindRuntime(
    profile: CharacterPhysicsProfile,
    bindings: ResolvedCharacterPhysicsBindings,
    external?: ExactPhysicsBindingRegistry,
): MagicaWindRuntime {
    return new CharacterMagicaWind(profile.components.windZones, bindings, external)
}
