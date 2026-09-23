import * as THREE from 'three'

/** Each prop owns a separate loader transaction; never borrow an actor's rig/resources. */
export interface WeaponDonor {
    object: THREE.Group
    animation: { paused: boolean; mixer: THREE.AnimationMixer }
    dispose(): void
}
export interface WeaponChoice { key: string; name: string; object: THREE.Object3D }
export interface IndependentWeapon {
    object: THREE.Group
    characterId: string
    weaponName: string
    dispose(): void
}

export function listIndependentWeapons(root: THREE.Object3D): WeaponChoice[] {
    const result: WeaponChoice[] = []
    root.traverse(object => {
        if (!/^chara_\d+_weapon_[a-z0-9_]*model$/i.test(object.name)) return
        let vertices = 0
        object.traverse(child => {
            if ((child as THREE.Mesh).isMesh) vertices += (child as THREE.Mesh).geometry.getAttribute('position')?.count ?? 0
        })
        if (vertices) result.push({ key: object.name, name: object.name, object })
    })
    return result
}

export function createIndependentWeapon(donor: WeaponDonor, characterId: string, key: string): IndependentWeapon {
    const choice = listIndependentWeapons(donor.object).find(item => item.key === key)
    if (!choice) throw new Error('Weapon resource was not found')
    donor.animation.mixer.stopAllAction()
    donor.animation.paused = true
    // Keep the original bone ancestry/bind matrices. Hide only non-selected renderers;
    // cloning just a SkinnedMesh or reparenting a sibling rig breaks native skinning.
    const selected = new Set<THREE.Object3D>()
    choice.object.traverse(child => selected.add(child))
    donor.object.traverse(child => {
        if ((child as THREE.Mesh).isMesh) child.visible = selected.has(child)
    })
    for (let parent: THREE.Object3D | null = choice.object; parent; parent = parent.parent) parent.visible = true
    donor.object.updateMatrixWorld(true)
    const bounds = new THREE.Box3()
    choice.object.traverse(child => {
        const mesh = child as THREE.SkinnedMesh
        if (!mesh.isMesh || !mesh.visible) return
        if (mesh.isSkinnedMesh) {
            mesh.skeleton.update()
            mesh.computeBoundingBox()
            if (mesh.boundingBox) bounds.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
        } else {
            mesh.geometry.computeBoundingBox()
            if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
        }
    })
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
        throw new Error('Weapon geometry is empty')
    }
    const object = new THREE.Group()
    object.name = `independent-weapon:${characterId}:${key}`
    object.userData.magiusIndependentWeapon = true
    // Center a wrapper, not the source skeleton. Original material, size, rotation
    // and skin weights are preserved; user placement belongs to the outer group.
    const center = new THREE.Group()
    center.position.copy(bounds.getCenter(new THREE.Vector3())).negate()
    center.add(donor.object)
    object.add(center)
    let disposed = false
    return {
        object, characterId, weaponName: choice.name,
        dispose() {
            if (disposed) return
            disposed = true
            object.removeFromParent()
            donor.dispose()
        },
    }
}

export function setIndependentWeaponTransform(
    object: THREE.Object3D, channel: 'position' | 'rotation' | 'scale', axis: 'x' | 'y' | 'z', value: number,
): boolean {
    if (!Number.isFinite(value) || (channel === 'scale' && value <= 0)) return false
    object[channel][axis] = channel === 'rotation' ? THREE.MathUtils.degToRad(value) : value
    object.updateMatrixWorld(true)
    return true
}
