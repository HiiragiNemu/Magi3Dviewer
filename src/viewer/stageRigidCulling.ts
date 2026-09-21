import * as THREE from 'three'

/** Stage-only policy: leave deforming/unknown vertex programs unculled. */
export function enableRigidStageCulling(mesh: THREE.Mesh): boolean {
    const geometry = mesh.geometry
    const position = geometry?.getAttribute('position')
    const dynamicMesh = mesh as THREE.Mesh & {
        isSkinnedMesh?: boolean
        isInstancedMesh?: boolean
        isBatchedMesh?: boolean
        boundingSphere?: THREE.Sphere | null
    }
    mesh.frustumCulled = false
    if (
        dynamicMesh.isSkinnedMesh || dynamicMesh.isInstancedMesh || dynamicMesh.isBatchedMesh
        || !position || position.count === 0
        || ('usage' in position && position.usage !== THREE.StaticDrawUsage)
        || ('data' in position && position.data.usage !== THREE.StaticDrawUsage)
        || Object.values(geometry.morphAttributes).some(attributes => attributes?.length)
        || mesh.userData.stageDynamicVertexPosition === true
        || mesh.name.includes('stage-shadow-caster')
    ) return false

    const materials = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material]
    if (mesh.customDepthMaterial) materials.push(mesh.customDepthMaterial)
    if (mesh.customDistanceMaterial) materials.push(mesh.customDistanceMaterial)
    if (!materials.length || materials.some(material => {
        const candidate = material as THREE.Material & {
            isShaderMaterial?: boolean
            displacementMap?: THREE.Texture | null
        }
        return candidate.isShaderMaterial || candidate.displacementMap
            || (candidate.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile
                && candidate.userData.stageRigidVertexPosition !== true)
    })) return false

    geometry.computeBoundingSphere()
    const source = geometry.boundingSphere
    if (!source || !Number.isFinite(source.radius)
        || !source.center.toArray().every(Number.isFinite)) return false

    // Frustum.intersectsObject transforms object.boundingSphere by matrixWorld.
    // Three's max-column scale underestimates a sheared hierarchy. sqrt(3) is a
    // conservative bound on spectralNorm/maxColumnNorm for ANY 3x3 transform.
    // Use an object-local copy: no shared geometry/character bounds are changed.
    dynamicMesh.boundingSphere = source.clone()
    dynamicMesh.boundingSphere.radius *= Math.sqrt(3)
    mesh.frustumCulled = true
    return true
}
