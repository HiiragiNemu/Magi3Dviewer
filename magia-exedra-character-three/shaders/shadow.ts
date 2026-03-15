import * as THREE from 'three';
import { MaterialUserData, ShaderUniformsController } from '.';

export const ShadowOptions = {
    alphaTest: 0.5,
}

export class ShadowMaterialUniforms extends ShaderUniformsController {
    constructor(shader: THREE.WebGLProgramParametersWithUniforms) {
        super(shader)
    }

    get uAlphaTest(): number | undefined { return this.getValue('uAlphaTest') }
    set uAlphaTest(value) { this.setValue('uAlphaTest', value) }

    loadGlobalOptions(): void {
        this.uAlphaTest = ShadowOptions.alphaTest
    }
}

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

    const userData = new MaterialUserData()
    material.userData = userData

    material.onBeforeCompile = shader => {
        shader.uniforms.tAlpha = { value: alphaTex }

        const uniforms = new ShadowMaterialUniforms(shader)
        uniforms.loadGlobalOptions()

        shader.fragmentShader = shader.fragmentShader = /*glsl*/`
            uniform sampler2D tAlpha;
            uniform float uAlphaTest;

            ${shader.fragmentShader}
        `.replace(
            '#include <alphatest_fragment>',
            /*glsl*/
            `if (texture2D(tAlpha, vMapUv).a < uAlphaTest) discard;`
        );

        userData.shader = shader;
        userData.shaderUniforms = uniforms;
    }

    return material as InstanceType<T>
}

export function getMeshShadowMaterialUniforms(mesh: THREE.Mesh): ShadowMaterialUniforms[] {
    return [mesh.customDepthMaterial, mesh.customDistanceMaterial]
        .map(x => x?.userData)
        .filter(x => x instanceof MaterialUserData)
        .map(x => x.shaderUniforms)
        .filter(x => x instanceof ShadowMaterialUniforms)
}
