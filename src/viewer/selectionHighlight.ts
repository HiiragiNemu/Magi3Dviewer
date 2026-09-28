import { Mesh, Object3D, ShaderMaterial } from 'three'

/** Reuse instance-owned outline draws. Selection never clones geometry,
 * recompiles programs, or enables full-scene postprocessing passes. */
export class SelectionHighlight {
    private actor?: Object3D
    private readonly cache = new WeakMap<Object3D, readonly ShaderMaterial[]>()
    private materials: readonly ShaderMaterial[] = []

    select(actor?: Object3D): void {
        if (actor === this.actor) return
        for (const material of this.materials) material.uniforms.uSelectionWeight.value = 0
        this.actor = actor
        if (!actor) { this.materials = []; return }
        let materials = this.cache.get(actor)
        if (!materials) {
            const found = new Set<ShaderMaterial>()
            actor.traverse(node => {
                if (!(node instanceof Mesh)) return
                for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
                    if (material instanceof ShaderMaterial && material.uniforms.uSelectionWeight) found.add(material)
                }
            })
            materials = [...found]
            this.cache.set(actor, materials)
        }
        this.materials = materials
        for (const material of materials) material.uniforms.uSelectionWeight.value = 1
    }

    clear(): void { this.select(undefined) }
    get materialCount(): number { return this.materials.length }
}
