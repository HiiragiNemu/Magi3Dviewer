import * as THREE from 'three';
import type { CharacterPerspectiveReference } from '../renderProfile';

/** Compiled ReDriveToon vertex constant: max(1 - distance * 2.25, 0). */
export const OFFICIAL_CHARACTER_PERSPECTIVE_DISTANCE_FALLOFF = 2.25;

/**
 * Port the common ReDriveToon character vertex deformation recovered from the
 * JP 2022.3.62f2 GLES program. `_CharacterCancelPerspective` comes from each
 * serialized character controller; the captured live global gate is 1.
 */
export function injectCharacterPerspectiveCancellation(
    shader: THREE.WebGLProgramParametersWithUniforms,
    reference: CharacterPerspectiveReference | undefined,
): void {
    if (!reference) return;
    reference.update();
    shader.uniforms.uRdCharacterFacePositionWS = {
        value: reference.facePosition,
    };
    shader.uniforms.uRdCharacterCancelPerspective = {
        value: reference.characterCancelPerspective,
    };
    shader.uniforms.uRdGlobalCharacterCancelPerspective = { value: 1 };
    shader.vertexShader = /* glsl */ `
        uniform vec3 uRdCharacterFacePositionWS;
        uniform float uRdCharacterCancelPerspective;
        uniform float uRdGlobalCharacterCancelPerspective;
        ${shader.vertexShader}
    `.replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        vec3 rdCancelWorldPosition =
            (modelMatrix * vec4(transformed, 1.0)).xyz;
        float rdCancelPerspectiveFactor = max(
            1.0 - distance(
                rdCancelWorldPosition,
                uRdCharacterFacePositionWS
            ) * 2.25,
            0.0
        );
        rdCancelPerspectiveFactor *=
            uRdGlobalCharacterCancelPerspective *
            uRdCharacterCancelPerspective *
            clamp(rdCancelWorldPosition.y, 0.0, 1.0);
        vec3 rdCancelFacePositionVS =
            (viewMatrix * vec4(uRdCharacterFacePositionWS, 1.0)).xyz;
        vec2 rdPerspectiveCancelledXY =
            abs(gl_Position.w) * gl_Position.xy /
            abs(rdCancelFacePositionVS.z);
        if (isPerspectiveMatrix(projectionMatrix)) {
            gl_Position.xy = mix(
                gl_Position.xy,
                rdPerspectiveCancelledXY,
                rdCancelPerspectiveFactor
            );
        }
        `,
    );
}
