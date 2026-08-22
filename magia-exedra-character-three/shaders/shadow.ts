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

    // Keep the native map assignment for Three's ordinary depth program, but
    // do not derive the authored cutout UV from it. WebGLShadowMap mutates a
    // custom depth material's map/map transform to match the forward material;
    // CameraDepthTexture may then draw that same material later in the frame.
    // The dedicated UV varying below is therefore bound directly to the
    // authored alpha texture's UV0 transform, matching ReDrive's TEXCOORD0.
    material.map = alphaTex
    if (alphaTex.matrixAutoUpdate) alphaTex.updateMatrix()

    const userData = new MaterialUserData()
    material.userData = userData

    material.onBeforeCompile = shader => {
        shader.uniforms.tAlpha = { value: alphaTex }
        shader.uniforms.uRdAlphaUvTransform = { value: alphaTex.matrix }

        const uniforms = new ShadowMaterialUniforms(shader)
        uniforms.loadGlobalOptions()

        shader.vertexShader = /* glsl */ `
            uniform mat3 uRdAlphaUvTransform;
            varying vec2 vRdAlphaCutoutUv;
            ${shader.vertexShader}
        `.replace(
            '#include <uv_vertex>',
            /* glsl */ `
            #include <uv_vertex>
            vRdAlphaCutoutUv =
                (uRdAlphaUvTransform * vec3(uv, 1.0)).xy;
            `,
        )

        shader.fragmentShader = /*glsl*/`
            uniform sampler2D tAlpha;
            uniform float uAlphaTest;
            varying vec2 vRdAlphaCutoutUv;

            ${shader.fragmentShader}
        `.replace(
            '#include <alphatest_fragment>',
            /*glsl*/
            `if (texture2D(tAlpha, vRdAlphaCutoutUv).a < uAlphaTest) discard;`
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
