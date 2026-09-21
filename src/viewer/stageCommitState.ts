import * as THREE from 'three'

// Snapshot only mutable CPU fields. GPU resources, objects, uniform containers
// and callbacks retain their identities; no JSON clone/reload of a live scene.
function preserveValue(value: unknown): () => void {
    if (value instanceof THREE.Color || value instanceof THREE.Vector2
        || value instanceof THREE.Vector3 || value instanceof THREE.Vector4
        || value instanceof THREE.Quaternion || value instanceof THREE.Euler
        || value instanceof THREE.Matrix3 || value instanceof THREE.Matrix4
        || value instanceof THREE.Spherical || value instanceof THREE.SphericalHarmonics3) {
        const copy = value.clone()
        return () => { (value.copy as (saved: typeof copy) => unknown)(copy) }
    }
    if (Array.isArray(value)) {
        const copy = [...value]
        return () => { value.splice(0, value.length, ...copy) }
    }
    return () => {}
}

export function captureStageFields(target: object, keys: readonly string[]) {
    const record = target as Record<string, unknown>
    const fields = keys.map(key => ({ key, own: Object.hasOwn(record, key),
        value: record[key], restore: preserveValue(record[key]) }))
    return () => {
        for (const { key, own, value, restore } of fields) {
            if (record[key] !== value) record[key] = value
            restore()
            if (!own) delete record[key]
        }
    }
}

export function captureStageRecord(target: object) {
    const keys = Object.keys(target)
    const restore = captureStageFields(target, keys)
    return () => {
        for (const key of Object.keys(target)) {
            if (!keys.includes(key)) delete (target as Record<string, unknown>)[key]
        }
        restore()
    }
}

export function captureStageUniforms(uniforms: Record<string, THREE.IUniform>) {
    const restoreEntries = captureStageRecord(uniforms)
    const restoreValues = Object.values(uniforms)
        .map(uniform => captureStageFields(uniform, ['value']))
    return () => { restoreEntries(); restoreValues.forEach(restore => restore()) }
}
