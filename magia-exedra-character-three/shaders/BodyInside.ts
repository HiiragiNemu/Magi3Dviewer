import * as THREE from 'three';
import { createGeneralMaterial, type MaterialCreationOptions } from '.';
import { loadTexture } from '../texture';
import { ObjFindByKey } from '../utils';

/**
 * ```txt
 * body_color ---\
 *                mix, factor=body_ctrl[red] --\
 * body_shadow --/                              \
 *                                               |--> final texture
 * [UV1]dress_inside, UV1.xy > 0 ---------------/
 * 
 *                             body_shadow[alpha] --> final alpha map
 * ```
 */
export async function createBodyInsideMaterial(options: MaterialCreationOptions, modelTextures: Record<string, string>): ReturnType<typeof createGeneralMaterial> {
    const insideTex = await loadTexture(ObjFindByKey(modelTextures, x =>
        x.includes('space') || // ultimate madoka (body_space_color)
        x.includes('inside') // akuma homura (body_inside_color)
    )!, { colorSpace: THREE.SRGBColorSpace })

    const result = await createGeneralMaterial({
        ...options,
        alphaSrc: 'shadow', // only effective for ultimate madoka. akuma homura's maps are fully opaque

        onBeforeCompile(shader) {
            shader.uniforms.tInside = { value: insideTex }

            // dress inside uses UV1
            shader.vertexShader = /*glsl*/`
                attribute vec2 uv1;
                varying vec2 vUv1;
                ${shader.vertexShader}
            `.replace(
                '#include <uv_vertex>',
                /*glsl*/`
                #include <uv_vertex>
                vUv1 = uv1;
                `
            );

            shader.fragmentShader = /*glsl*/`
                varying vec2 vUv1;
                uniform sampler2D tInside;
                ${shader.fragmentShader}
            `.replace(
                '// end map_fragment injection',
                /*glsl*/`
                vec4 texInside = texture2D(tInside, vUv1);
                if (vUv1.x > 0.0 && vUv1.y > 0.0) {
                    diffuseColor.rgb = texInside.rgb; // replace color if UV1 > 0
                }
                // end map_fragment injection
                `
            )
        },
    })

    result.textures.textures.push(insideTex)

    return result
}
