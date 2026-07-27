import * as THREE from 'three';
import { MaterialUserData, ShaderUniformsController } from './userdata';

export interface ToonStylizationOptions {
    officialLookEnabled: boolean;
    lightingInfluence: number;
    albedoLift: number;
    brightness: number;
    contrast: number;
    saturation: number;
    shadowTint: string;
    shadowTintStrength: number;
    highlightTint: string;
    highlightTintStrength: number;
    specularStrength: number;
    metallicResponse: number;

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
 * Recovered baseline presentation. It is intentionally neutral: scene colour,
 * additional Rim and Fresnel belong to ReDriveVolume/Timeline or per-renderer
 * animation attributes, not to a permanently enabled global beauty filter.
 */
export const toonStylizationOptions: ToonStylizationOptions = {
    officialLookEnabled: true,
    lightingInfluence: 0.24,
    albedoLift: 0.00,
    brightness: 0.98,
    contrast: 1.03,
    saturation: 1.02,
    shadowTint: '#858aa8',
    shadowTintStrength: 0.12,
    highlightTint: '#ffe7e0',
    highlightTintStrength: 0.015,
    specularStrength: 0.72,
    metallicResponse: 0.12,

    // Official additional Rim is scene/Timeline driven. Keep the implementation
    // available for imported tracks, but do not bake it into every character.
    rimEnabled: false,
    rimColor: '#c9d7ff',
    rimStrength: 0.14,
    rimThreshold: 0.56,
    rimFeather: 0.18,
    rimDirectionX: -0.65,
    rimDirectionY: 0.35,
    rimDirectionality: 0.46,

    // Official Fresnel is a per-renderer MaterialPropertyBlock animation value.
    fresnelEnabled: false,
    fresnelColor: '#ffffff',
    fresnelStrength: 0.20,
    fresnelThreshold: 0.60,
    fresnelFeather: 0.20,
};

export const officialToonPreset: Readonly<ToonStylizationOptions> = {
    ...toonStylizationOptions,
};

export function resetOfficialToonPreset() {
    Object.assign(toonStylizationOptions, officialToonPreset);
}

/** Runtime uniforms shared by general, face and hair materials. */
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

        this.setValue('uOfficialLookEnabled', options.officialLookEnabled ? 1 : 0);
        this.setValue('uLightingInfluence', options.lightingInfluence);
        this.setValue('uAlbedoLift', options.albedoLift);
        this.setValue('uOfficialBrightness', options.brightness);
        this.setValue('uOfficialContrast', options.contrast);
        this.setValue('uOfficialSaturation', options.saturation);
        this.setColor('uShadowTint', options.shadowTint);
        this.setValue('uShadowTintStrength', options.shadowTintStrength);
        this.setColor('uHighlightTint', options.highlightTint);
        this.setValue('uHighlightTintStrength', options.highlightTintStrength);
        this.setValue('uOfficialSpecularStrength', options.specularStrength);
        this.setValue('uMetallicResponse', options.metallicResponse);

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
 * Adds the texture-dominant ReDrive baseline after Three.js has assembled its
 * physical lighting result. General materials populate the masks below from the
 * control texture: R shadow offset, G metallic/tint response, B specular mask.
 */
export function injectToonStylization(
    shader: THREE.WebGLProgramParametersWithUniforms,
    uniforms: ToonStylizationUniforms = new ToonStylizationUniforms(shader),
): ToonStylizationUniforms {
    uniforms.loadGlobalOptions();

    shader.fragmentShader = /* glsl */ `
        uniform float uOfficialLookEnabled;
        uniform float uLightingInfluence;
        uniform float uAlbedoLift;
        uniform float uOfficialBrightness;
        uniform float uOfficialContrast;
        uniform float uOfficialSaturation;
        uniform vec3 uShadowTint;
        uniform float uShadowTintStrength;
        uniform vec3 uHighlightTint;
        uniform float uHighlightTintStrength;
        uniform float uOfficialSpecularStrength;
        uniform float uMetallicResponse;

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

        float rdToonShadowOffset = 0.0;
        float rdToonMetallicMask = 0.0;
        float rdToonSpecularMask = 0.0;

        ${shader.fragmentShader}
    `.replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        vec3 rdToonAlbedo = max(diffuseColor.rgb, vec3(0.0));
        vec3 rdToonPhysical = max(outgoingLight, vec3(0.0));

        float rdToonAlbedoLuma = max(
            dot(rdToonAlbedo, vec3(0.2126, 0.7152, 0.0722)),
            0.001
        );
        float rdToonPhysicalLuma = dot(
            rdToonPhysical,
            vec3(0.2126, 0.7152, 0.0722)
        );
        float rdToonRelativeLight = clamp(
            rdToonPhysicalLuma / rdToonAlbedoLuma,
            0.0,
            2.0
        );
        float rdToonShadowMask = 1.0 - smoothstep(
            0.52,
            0.96,
            rdToonRelativeLight
        );
        float rdToonHighlightMask = smoothstep(
            0.90,
            1.45,
            rdToonRelativeLight
        );

        vec3 rdToonOfficial = mix(
            rdToonAlbedo,
            rdToonPhysical,
            saturate(uLightingInfluence)
        );
        rdToonOfficial += rdToonAlbedo * uAlbedoLift;

        rdToonOfficial = mix(
            rdToonOfficial,
            rdToonOfficial * uShadowTint,
            rdToonShadowMask * saturate(uShadowTintStrength)
        );
        rdToonOfficial +=
            uHighlightTint *
            rdToonHighlightMask *
            uHighlightTintStrength;

        float rdToonMetalGradientPosition = saturate(normal.y * 0.5 + 0.5);
        vec3 rdToonMetalGradient = mix(
            uShadowTint,
            uHighlightTint,
            smoothstep(0.05, 0.95, rdToonMetalGradientPosition)
        );
        vec3 rdToonMetalColor =
            rdToonMetalGradient * mix(rdToonAlbedo, vec3(1.0), 0.20);
        rdToonOfficial = mix(
            rdToonOfficial,
            rdToonMetalColor,
            saturate(rdToonMetallicMask * uMetallicResponse)
        );

        // General materials with the recovered SpecularGradientMap already add
        // the authored Control-B highlight. Keep the legacy Three specular path
        // only for materials that do not provide that official gradient.
        #ifndef HAS_SPECULAR_GRADIENT
            rdToonOfficial +=
                totalSpecular *
                rdToonSpecularMask *
                uOfficialSpecularStrength;
        #endif

        float rdToonOfficialLuma = dot(
            rdToonOfficial,
            vec3(0.2126, 0.7152, 0.0722)
        );
        rdToonOfficial = mix(
            vec3(rdToonOfficialLuma),
            rdToonOfficial,
            max(uOfficialSaturation, 0.0)
        );
        rdToonOfficial =
            (rdToonOfficial - vec3(0.5)) * uOfficialContrast + vec3(0.5);
        rdToonOfficial *= uOfficialBrightness;

        outgoingLight = mix(
            outgoingLight,
            max(rdToonOfficial, vec3(0.0)),
            saturate(uOfficialLookEnabled)
        );

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
            -0.25,
            0.72,
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
