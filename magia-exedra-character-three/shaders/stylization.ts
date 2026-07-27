import * as THREE from 'three';
import { MaterialUserData, ShaderUniformsController } from './userdata';

export interface ToonStylizationOptions {
    rimEnabled: boolean;
    rimColor: string;
    rimStrength: number;
    rimThreshold: number;
    rimFeather: number;
    rimDirectionX: number;
    rimDirectionY: number;
    rimDirectionality: number;
    fresnelEnabled: boolean;
    fresnelColor: string;
    fresnelStrength: number;
    fresnelThreshold: number;
    fresnelFeather: number;
}

/**
 * ReDriveToon exposes a regular rim light plus a timeline-controlled,
 * screen-directional additional rim light. These restrained defaults preserve
 * the characteristic lit edge without washing out the character.
 */
export const toonStylizationOptions: ToonStylizationOptions = {
    rimEnabled: true,
    rimColor: '#fff4dc',
    rimStrength: 0.16,
    rimThreshold: 0.58,
    rimFeather: 0.18,
    rimDirectionX: -0.45,
    rimDirectionY: 0.8,
    rimDirectionality: 0.42,
    fresnelEnabled: false,
    fresnelColor: '#ffffff',
    fresnelStrength: 0.35,
    fresnelThreshold: 0.5,
    fresnelFeather: 0.25,
};

/** Runtime uniforms shared by general and face materials. */
export class ToonStylizationUniforms extends ShaderUniformsController {
    private setColor(key: string, value: THREE.ColorRepresentation) {
        const current = this.getValue(key);
        if (current instanceof THREE.Color) {
            current.set(value);
        } else {
            this.setValue(key, new THREE.Color(value));
        }
    }

    private setVector2(key: string, x: number, y: number) {
        const current = this.getValue(key);
        if (current instanceof THREE.Vector2) {
            current.set(x, y);
        } else {
            this.setValue(key, new THREE.Vector2(x, y));
        }
    }

    loadGlobalOptions() {
        const options = toonStylizationOptions;

        this.setValue('uRimEnabled', options.rimEnabled ? 1 : 0);
        this.setColor('uRimColor', options.rimColor);
        this.setValue('uRimStrength', options.rimStrength);
        this.setValue('uRimThreshold', options.rimThreshold);
        this.setValue('uRimFeather', options.rimFeather);
        this.setVector2(
            'uRimDirection',
            options.rimDirectionX,
            options.rimDirectionY,
        );
        this.setValue('uRimDirectionality', options.rimDirectionality);

        this.setValue('uFresnelEnabled', options.fresnelEnabled ? 1 : 0);
        this.setColor('uFresnelColor', options.fresnelColor);
        this.setValue('uFresnelStrength', options.fresnelStrength);
        this.setValue('uFresnelThreshold', options.fresnelThreshold);
        this.setValue('uFresnelFeather', options.fresnelFeather);
    }
}

/**
 * Add emission-like edge lighting after Three.js has assembled the physical
 * lighting result. Rim and Fresnel therefore remain legible in shadow and do
 * not interfere with the first pass used to choose the toon shadow texture.
 */
export function injectToonStylization(
    shader: THREE.WebGLProgramParametersWithUniforms,
    uniforms: ToonStylizationUniforms = new ToonStylizationUniforms(shader),
): ToonStylizationUniforms {
    uniforms.loadGlobalOptions();

    shader.fragmentShader = /* glsl */ `
        uniform float uRimEnabled;
        uniform vec3 uRimColor;
        uniform float uRimStrength;
        uniform float uRimThreshold;
        uniform float uRimFeather;
        uniform vec2 uRimDirection;
        uniform float uRimDirectionality;

        uniform float uFresnelEnabled;
        uniform vec3 uFresnelColor;
        uniform float uFresnelStrength;
        uniform float uFresnelThreshold;
        uniform float uFresnelFeather;

        ${shader.fragmentShader}
    `.replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        float rdToonNdotV = saturate(dot(normal, geometryViewDir));
        float rdToonEdge = 1.0 - rdToonNdotV;

        float rdToonRimStart = clamp(uRimThreshold - uRimFeather, 0.0, 1.0);
        float rdToonRimEnd = max(
            rdToonRimStart + 0.0001,
            clamp(uRimThreshold + uRimFeather, 0.0, 1.0)
        );
        float rdToonRimBand = smoothstep(
            rdToonRimStart,
            rdToonRimEnd,
            rdToonEdge
        );

        float rdToonNormalXyLength = length(normal.xy);
        vec2 rdToonNormalXy = rdToonNormalXyLength > 0.0001
            ? normal.xy / rdToonNormalXyLength
            : vec2(0.0, 1.0);
        vec2 rdToonRimDirection = length(uRimDirection) > 0.0001
            ? normalize(uRimDirection)
            : vec2(0.0, 1.0);
        float rdToonDirectionalRim = smoothstep(
            -0.2,
            0.7,
            dot(rdToonNormalXy, rdToonRimDirection)
        );
        float rdToonRimMask = rdToonRimBand * mix(
            1.0,
            rdToonDirectionalRim,
            saturate(uRimDirectionality)
        );
        outgoingLight +=
            uRimColor * rdToonRimMask * uRimStrength * uRimEnabled;

        float rdToonFresnelStart = clamp(
            uFresnelThreshold - uFresnelFeather,
            0.0,
            1.0
        );
        float rdToonFresnelEnd = max(
            rdToonFresnelStart + 0.0001,
            clamp(uFresnelThreshold + uFresnelFeather, 0.0, 1.0)
        );
        float rdToonFresnelMask = smoothstep(
            rdToonFresnelStart,
            rdToonFresnelEnd,
            rdToonEdge
        );
        outgoingLight +=
            uFresnelColor *
            rdToonFresnelMask *
            uFresnelStrength *
            uFresnelEnabled;

        #include <opaque_fragment>
        `,
    );

    return uniforms;
}

export function getMeshToonStylizationUniforms(
    mesh: THREE.Mesh,
): ToonStylizationUniforms[] {
    return (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        .map(material => material?.userData)
        .filter(userData => userData instanceof MaterialUserData)
        .map(userData => userData.shaderUniforms)
        .filter(uniforms => uniforms instanceof ToonStylizationUniforms);
}
