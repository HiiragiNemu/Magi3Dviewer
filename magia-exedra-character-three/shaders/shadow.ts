import * as THREE from 'three';

export const ShadowAlphaTest = 0.5

/**
 * Assign to `mesh.customDepthMaterial` to hide shadows for the transparent part of the mesh
 */
export function createDepthMaterial(alphaTex: THREE.Texture): THREE.MeshDepthMaterial {
    return createDepthOrDistanceMaterial(THREE.MeshDepthMaterial, alphaTex)
}

/**
 * Assign to `mesh.customDistanceMaterial` to hide shadows for the transparent part of the mesh
 */
export function createDistanceMaterial(alphaTex: THREE.Texture): THREE.MeshDistanceMaterial {
    return createDepthOrDistanceMaterial(THREE.MeshDistanceMaterial, alphaTex)
}

function createDepthOrDistanceMaterial<T extends typeof THREE.MeshDepthMaterial | typeof THREE.MeshDistanceMaterial>(materialType: T, alphaTex: THREE.Texture): InstanceType<T> {
    const material = new materialType()

    material.onBeforeCompile = shader => {
        shader.uniforms.tAlpha = { value: alphaTex }
        shader.uniforms.uAlphaTest = { value: ShadowAlphaTest }

        shader.fragmentShader = shader.fragmentShader = /*glsl*/`
            uniform sampler2D tAlpha;
            uniform float uAlphaTest;

            ${shader.fragmentShader}
        `.replace(
            '#include <alphatest_fragment>',
            /*glsl*/
            `if (texture2D(tAlpha, vMapUv).a < uAlphaTest) discard;`
        )
    }

    return material as InstanceType<T>
}
