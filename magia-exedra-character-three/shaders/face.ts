import * as THREE from 'three';
import { MaterialUserData, type MaterialCreationOptions, type MaterialCreationResult } from '.';
import type { FaceDirectionReference, OfficialFaceProfile } from '../faceProfile';
import {
    getOfficialTextureSamplerProfile,
    resolveOfficialFaceAdditionalActive,
    type OfficialMaterialProfile,
} from '../materialProfile';
import {
    ApplyOfficialCharacterSurfaceSampling,
    ApplyOfficialFaceAdditionalSampling,
    ApplyOfficialFaceGradientSampling,
    loadTexture,
    MaximizeTextureQuality,
    type OfficialFaceAdditionalSamplingState,
    type OfficialFaceGradientSamplingState,
} from '../texture';
import { injectToonStylization, ToonStylizationUniforms } from './stylization';
import { injectCharacterPerspectiveCancellation } from './perspective';
import { injectReDriveDepthRimShader } from './depthRim';
import { applyNativeSlotShaderBindings } from '../nativeMaterialScope';
import type { OfficialCharacterSurfaceSamplingState } from '../texture';

const OFFICIAL_FACE_CTRL_BASE_TEXTURE = 'face_ctrl_base'
const OFFICIAL_FACE_CTRL_NOSE_TEXTURE = 'face_ctrl_nose'

interface FaceMaterialCreationOptions extends MaterialCreationOptions {
    shadowMap: string;
    /** Exact per-material URLs, or composite PPtr keys for native resources. */
    faceAdditionalMaps: readonly (string | null)[];
    noseGradientMap?: string;
    faceReference?: FaceDirectionReference;
    faceProfile: OfficialFaceProfile;
}

export interface OfficialFaceAdditionalMaterialBinding {
    serializedTexture: string | null
    sourceUrl: string | null
    texture: THREE.Texture | null
    sampler: OfficialFaceAdditionalSamplingState | OfficialCharacterSurfaceSamplingState | null
}

export interface FaceMaterialCreationResult extends MaterialCreationResult {
    updateFaceDirectionReference?: () => void;
    officialFaceAdditionalBindings: readonly OfficialFaceAdditionalMaterialBinding[];
    officialFaceGradientRuntime: {
        authority: 'compiled-ReDriveToon-and-serialized-Texture2D'
        keyword: '_FACE_SHADOW_GRADIENTMAP'
        faceMap: OfficialFaceGradientSamplingState | OfficialCharacterSurfaceSamplingState | null
        noseMap: OfficialFaceGradientSamplingState | OfficialCharacterSurfaceSamplingState | null
        formula: {
            forwardBias: 0.111
            rightBias: 0.333
            thresholdBase: 0.985
            transitionWidth: 0.01
            transitionGain: 100
        }
    }
    officialFaceAdditionalRuntime: {
        authority: 'serialized-Material-PPtr-and-live-TW-GL-binding' | 'native-per-model-PPtr'
        uvSet: 'uv1'
        baseCarrierBeforeShouldApplyGate: '_FACE_SHADOW_GRADIENTMAP-only'
        baseCarrierEyeExcluded: true
        defaultTexture: null | {
            authority: 'fresh-TW-live-GL-readback'
            width: 4
            height: 4
            rgba: readonly [0, 0, 0, 0]
        }
        gradientDepthGate: {
            source: '_CameraDepthTexture'
            sampleDirection: 'physical-main-light'
            referenceOffset: 0.00999999978
            gain: 50
            threshold: 0.899999976
        }
        slots: Array<{
            materialIndex: number
            materialName: string
            isFace: boolean
            isEye: boolean
            shouldApplyAdditional: boolean
            cheekValue: number
            serializedTexture: string | null
            sourceUrl: string | null
            binding: 'serialized-texture' | 'shader-default-black'
            sampler: OfficialFaceAdditionalMaterialBinding['sampler']
        }>
    }
}

export function setOfficialFaceMaterialProfileUniforms(
    shader: THREE.WebGLProgramParametersWithUniforms | undefined,
    profile: OfficialMaterialProfile,
): void {
    if (!shader) return
    const face = profile.face
    const set = (name: string, value: number) => {
        if (shader.uniforms[name]) shader.uniforms[name].value = value
    }
    set('uUseFaceGradient', face.useGradientMap ? 1 : 0)
    set('uOfficialFaceIsEye', face.isEye ? 1 : 0)
    set(
        'uOfficialFaceShouldApplyAdditional',
        resolveOfficialFaceAdditionalActive(profile) ? 1 : 0,
    )
    set('uOfficialFaceHighlightThreshold', face.highlightThreshold)
    set('uOfficialFaceHighlightRotation', face.highlightRotation)
    set('uCheekValue', face.cheekValue)
    const color = shader.uniforms.uOfficialFaceCheekColor?.value
    if (color instanceof THREE.Color) {
        // Unity runs this project in Linear color space and `_CheekColor` is a
        // ShaderLab Color property.  Convert its serialized sRGB channels to
        // the linear working space before uploading the uniform.
        color.setRGB(...face.cheekColor, THREE.SRGBColorSpace)
    }
}

/**
 * Face shading is driven by the animated Head coordinate frame and the authored
 * face SDF. It must not use the mesh normal/PBR split that is appropriate for
 * clothes and hair.
 */
export class FaceMaterialUniforms extends ToonStylizationUniforms {
    loadGlobalOptions() {
        super.loadGlobalOptions()
        this.setValue('uLightingInfluence', 0.01)
        this.setValue('uAlbedoLift', 0.0)
        this.setValue('uOfficialBrightness', 1.0)
        this.setValue('uOfficialContrast', 1.0)
        this.setValue('uOfficialSaturation', 1.02)
        this.setValue('uShadowTintStrength', 0.025)
        this.setValue('uHighlightTintStrength', 0.01)
        this.setValue('uOfficialSpecularStrength', 0.06)
        this.setValue('uMetallicResponse', 0.0)
        this.setValue('uRimStrength', 0.0)
    }
}

function createOfficialFaceAdditionalDefaultTexture(): THREE.DataTexture {
    // Fresh TW program 921 binds Unity texture 4 for a null PPtr. FBO readback
    // confirms a complete 4x4 GL_SRGB8_ALPHA8 texture with RGBA=(0,0,0,0).
    const texture = new THREE.DataTexture(
        new Uint8Array(4 * 4 * 4),
        4,
        4,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
    )
    texture.name = 'ReDriveToon _FaceAdditionalMap default black'
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = false
    texture.generateMipmaps = false
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearFilter
    texture.anisotropy = 1
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.needsUpdate = true
    return texture
}

export async function createFaceMaterial(options: FaceMaterialCreationOptions): Promise<FaceMaterialCreationResult> {
    // Keep the serialized Texture2D identity separate from Vite's transport
    // URL. Small PNG fallbacks may be emitted as data URIs, which erase the
    // name required to select the exact official BC6H payload.
    const native = options.nativeResources;
    const faceGradientSource = native ? native.bindings._FaceShadowGradientMap?.key ?? 'native:null' : options.ctrlMap || OFFICIAL_FACE_CTRL_BASE_TEXTURE
    const noseGradientSource = native ? native.bindings._NoseShadowGradientMap?.key ?? 'native:null' : options.noseGradientMap || OFFICIAL_FACE_CTRL_NOSE_TEXTURE
    if (
        options.materialProfiles
        && options.faceAdditionalMaps.length !== options.materialProfiles.length
    ) {
        throw new Error(
            'Serialized FaceAdditional slot count does not match material profiles: '
            + `${options.faceAdditionalMaps.length} != ${options.materialProfiles.length}`,
        )
    }
    const faceAdditionalSources = [
        ...new Set(
            options.faceAdditionalMaps.filter(
                (source): source is string => Boolean(source),
            ),
        ),
    ]
    const [
        colorTex,
        shadowTex,
        ctrlTex,
        noseGradientTex,
        loadedFaceAdditionalEntries,
    ] = native ? [native.textures._BaseMap ?? null, native.textures._ShadowTex ?? null, native.textures._FaceShadowGradientMap ?? null, native.textures._NoseShadowGradientMap ?? null, [] as [string, { texture: THREE.Texture; sampler: OfficialFaceAdditionalSamplingState }][]] as const : await Promise.all([
        loadTexture(options.colorMap, { colorSpace: THREE.SRGBColorSpace }),
        loadTexture(options.shadowMap, { colorSpace: THREE.SRGBColorSpace }),
        loadTexture(faceGradientSource),
        loadTexture(noseGradientSource),
        Promise.all(faceAdditionalSources.map(async source => {
            const texture = await loadTexture(source)
            MaximizeTextureQuality(texture)
            return [source, {
                texture,
                sampler: ApplyOfficialFaceAdditionalSampling(texture),
            }] as const
        })),
    ]);
    const loadedFaceAdditional = new Map(loadedFaceAdditionalEntries)
    const defaultFaceAdditionalTexture =
        native ? null : createOfficialFaceAdditionalDefaultTexture()
    const officialFaceAdditionalBindings = options.faceAdditionalMaps.map(
        (sourceUrl, materialIndex): OfficialFaceAdditionalMaterialBinding => {
            if (native) {
                // Native resources were loaded by exact PPtr before construction;
                // their keys are identities, not entries in the legacy URL map.
                const binding = native.bindings._FaceAdditionalMap
                const texture = native.textures._FaceAdditionalMap ?? null
                const sampler = native.sampling._FaceAdditionalMap ?? null
                if (!binding || sourceUrl !== binding.key || (binding.key
                    ? !texture || !sampler || texture.userData.nativeTextureKey !== binding.key
                    : texture !== null || sampler !== null)) {
                    throw new Error(
                        `Native FaceAdditional binding mismatch at slot ${materialIndex}: ${sourceUrl}`,
                    )
                }
                return {
                    serializedTexture: options.materialProfiles?.[materialIndex]
                        ?.face.additionalTexture ?? null,
                    sourceUrl: binding.key,
                    texture,
                    sampler,
                }
            }
            const loaded = sourceUrl
                ? loadedFaceAdditional.get(sourceUrl)
                : undefined
            if (sourceUrl && !loaded) {
                throw new Error(
                    `Serialized FaceAdditional texture failed to load at slot ${materialIndex}: ${sourceUrl}`,
                )
            }
            return {
                serializedTexture:
                    options.materialProfiles?.[materialIndex]
                        ?.face.additionalTexture ?? null,
                sourceUrl,
                texture: loaded?.texture ?? defaultFaceAdditionalTexture,
                sampler: loaded?.sampler ?? null,
            }
        },
    )

    const officialTextureSampling = native ? undefined : {
        baseMap: ApplyOfficialCharacterSurfaceSampling(
            colorTex!,
            options.colorMap,
            getOfficialTextureSamplerProfile(options.colorMap),
        ),
        shadowTex: ApplyOfficialCharacterSurfaceSampling(
            shadowTex!,
            options.shadowMap,
            getOfficialTextureSamplerProfile(options.shadowMap),
        ),
    }
    // Face gradient and each material slot's FaceAdditional PPtr use separate
    // serialized contracts; null PPtrs retain the shader's black default.
    const officialFaceGradientRuntime = {
        authority: 'compiled-ReDriveToon-and-serialized-Texture2D' as const,
        keyword: '_FACE_SHADOW_GRADIENTMAP' as const,
        faceMap: native ? native.sampling._FaceShadowGradientMap : ApplyOfficialFaceGradientSampling(
            ctrlTex!,
            faceGradientSource,
        ),
        noseMap: native ? native.sampling._NoseShadowGradientMap : ApplyOfficialFaceGradientSampling(
            noseGradientTex!,
            noseGradientSource,
        ),
        formula: {
            forwardBias: 0.111 as const,
            rightBias: 0.333 as const,
            thresholdBase: 0.985 as const,
            transitionWidth: 0.01 as const,
            transitionGain: 100 as const,
        },
    }

    const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        roughness: 1.0,
        metalness: 0.0,
    });

    if (native) { material.color.setRGB(native.baseColor[0], native.baseColor[1], native.baseColor[2]); material.opacity = native.baseColor[3]; }
    material.userData = new MaterialUserData()
    material.userData.officialTextureSampling = officialTextureSampling
    const faceMaterialUserData = material.userData as MaterialUserData & {
        officialFaceAdditionalTexture?: THREE.Texture | null
        officialFaceAdditionalSource?: string | null
        officialFaceAdditionalSampling?: OfficialFaceAdditionalMaterialBinding['sampler']
    }
    faceMaterialUserData.officialFaceAdditionalTexture =
        officialFaceAdditionalBindings[0]?.texture
        ?? defaultFaceAdditionalTexture
    faceMaterialUserData.officialFaceAdditionalSource =
        officialFaceAdditionalBindings[0]?.sourceUrl ?? null
    faceMaterialUserData.officialFaceAdditionalSampling =
        officialFaceAdditionalBindings[0]?.sampler ?? null
    Object.assign(material.userData, { officialFaceGradientRuntime })
    const officialFaceAdditionalRuntime = {
        authority: native ? 'native-per-model-PPtr' as const : 'serialized-Material-PPtr-and-live-TW-GL-binding' as const,
        uvSet: 'uv1' as const,
        baseCarrierBeforeShouldApplyGate:
            '_FACE_SHADOW_GRADIENTMAP-only' as const,
        baseCarrierEyeExcluded: true as const,
        defaultTexture: native ? null : {
            authority: 'fresh-TW-live-GL-readback' as const,
            width: 4 as const,
            height: 4 as const,
            rgba: [0, 0, 0, 0] as const,
        },
        gradientDepthGate: {
            source: '_CameraDepthTexture' as const,
            sampleDirection: 'physical-main-light' as const,
            referenceOffset: 0.00999999978 as const,
            gain: 50 as const,
            threshold: 0.899999976 as const,
        },
        slots: (options.materialProfiles ?? []).map((profile, materialIndex) => {
            const binding = officialFaceAdditionalBindings[materialIndex]
            return {
                materialIndex,
                materialName:
                    options.materialNames?.[materialIndex] ?? profile.name,
                isFace: profile.face.isFace,
                isEye: profile.face.isEye,
                shouldApplyAdditional:
                    resolveOfficialFaceAdditionalActive(profile),
                cheekValue: profile.face.cheekValue,
                serializedTexture: profile.face.additionalTexture,
                sourceUrl: binding?.sourceUrl ?? null,
                binding: binding?.sourceUrl
                    ? 'serialized-texture' as const
                    : 'shader-default-black' as const,
                sampler: binding?.sampler ?? null,
            }
        }),
    }
    material.userData.officialFaceAdditionalRuntime =
        officialFaceAdditionalRuntime
    const compiledShaders =
        new Set<THREE.WebGLProgramParametersWithUniforms>()

    const headQuaternion = new THREE.Quaternion()
    const forward = new THREE.Vector3(0, 0, 1)
    const up = new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3(1, 0, 0)
    const initialOfficialProfile = options.materialProfiles?.find(
        profile => profile.face.useGradientMap,
    ) ?? options.materialProfiles?.[0]

    const updateFaceDirectionReference = () => {
        if (compiledShaders.size === 0 || !options.faceReference) return
        const reference = options.faceReference
        reference.headBone.updateWorldMatrix(true, false)
        reference.headBone.getWorldQuaternion(headQuaternion)
        forward.copy(reference.localForward).applyQuaternion(headQuaternion).normalize()
        up.copy(reference.localUp).applyQuaternion(headQuaternion).normalize()
        right.copy(reference.localRight).applyQuaternion(headQuaternion).normalize()
        for (const shader of compiledShaders) {
            shader.uniforms.uFaceForwardWS.value.copy(forward)
            shader.uniforms.uFaceUpWS.value.copy(up)
            shader.uniforms.uFaceRightWS.value.copy(right)
        }
    }

    material.customProgramCacheKey = () => JSON.stringify({
        faceSdf: true,
        characterId: options.faceProfile.characterId,
        source: options.faceProfile.source,
        hasReference: Boolean(options.faceReference),
        hasCharacterPerspective: Boolean(
            options.characterPerspectiveReference,
        ),
    })

    material.onBeforeCompile = function (shader) {
        compiledShaders.add(shader)
        if (!shader.defines) shader.defines = {};

        const runtimeUserData = this.userData instanceof MaterialUserData
            ? this.userData
            : new MaterialUserData()
        this.userData = runtimeUserData
        const runtimeFaceUserData = runtimeUserData as MaterialUserData & {
            officialFaceAdditionalTexture?: THREE.Texture | null
        }
        const uniforms = new FaceMaterialUniforms(shader)
        uniforms.loadGlobalOptions()

        shader.uniforms.tShadow = { value: shadowTex };
        shader.uniforms.tFaceGradient = { value: ctrlTex };
        shader.uniforms.tNoseGradient = { value: noseGradientTex };
        shader.uniforms.tEyehighlight = {
            value: runtimeFaceUserData.officialFaceAdditionalTexture === undefined
                ? officialFaceAdditionalBindings[0]?.texture
                    ?? defaultFaceAdditionalTexture
                : runtimeFaceUserData.officialFaceAdditionalTexture,
        };
        shader.uniforms.uUseFaceGradient = { value: options.faceProfile.useFaceGradientMap ? 1 : 0 };
        shader.uniforms.uFaceGradientYOffset = { value: options.faceProfile.faceShadowGradientMapYOffset };
        shader.uniforms.uNoseGradientYOffset = { value: options.faceProfile.noseShadowGradientMapYOffset };
        shader.uniforms.uCheekValue = { value: options.faceProfile.cheekValue };
        shader.uniforms.uOfficialFaceIsEye = { value: 0 };
        shader.uniforms.uOfficialFaceShouldApplyAdditional = { value: 0 };
        shader.uniforms.uOfficialFaceHighlightThreshold = { value: 0.5 };
        shader.uniforms.uOfficialFaceHighlightRotation = { value: 0 };
        shader.uniforms.uOfficialFaceCheekColor = {
            value: new THREE.Color(1, 0.7, 0.7),
        };
        shader.uniforms.uFaceForwardWS = { value: new THREE.Vector3(0, 0, 1) };
        shader.uniforms.uFaceUpWS = { value: new THREE.Vector3(0, 1, 0) };
        shader.uniforms.uFaceRightWS = { value: new THREE.Vector3(1, 0, 0) };
        if (initialOfficialProfile) {
            setOfficialFaceMaterialProfileUniforms(shader, initialOfficialProfile)
        }
        updateFaceDirectionReference()

        shader.vertexShader = /*glsl*/ `
            attribute vec2 uv1;
            varying vec2 vFaceUv;
            varying vec2 vFaceUv2;
            varying vec3 vFaceForwardVS;
            varying vec3 vFaceUpVS;
            varying vec3 vFaceRightVS;
            varying vec3 vFaceSelfShadowNormalVS;
            uniform vec3 uFaceForwardWS;
            uniform vec3 uFaceUpWS;
            uniform vec3 uFaceRightWS;
            ${shader.vertexShader}
        `.replace(
            '#include <uv_vertex>',
            /*glsl*/ `
            #include <uv_vertex>
            vFaceUv = uv;
            vFaceUv2 = uv1;
            vFaceForwardVS = normalize(mat3(viewMatrix) * uFaceForwardWS);
            vFaceUpVS = normalize(mat3(viewMatrix) * uFaceUpWS);
            vFaceRightVS = normalize(mat3(viewMatrix) * uFaceRightWS);
            `
        ).replace(
            '#include <defaultnormal_vertex>',
            /*glsl*/ `
            #include <defaultnormal_vertex>
            vFaceSelfShadowNormalVS = normalize(transformedNormal);
            `
        );

        shader.fragmentShader = /*glsl*/ `
            varying vec2 vFaceUv;
            varying vec2 vFaceUv2;
            varying vec3 vFaceForwardVS;
            varying vec3 vFaceUpVS;
            varying vec3 vFaceRightVS;
            varying vec3 vFaceSelfShadowNormalVS;

            uniform sampler2D tShadow;
            uniform sampler2D tFaceGradient;
            uniform sampler2D tNoseGradient;
            uniform sampler2D tEyehighlight;
            uniform float uUseFaceGradient;
            uniform float uFaceGradientYOffset;
            uniform float uNoseGradientYOffset;
            uniform float uCheekValue;
            uniform float uOfficialFaceIsEye;
            uniform float uOfficialFaceShouldApplyAdditional;
            uniform float uOfficialFaceHighlightThreshold;
            uniform float uOfficialFaceHighlightRotation;
            uniform vec3 uOfficialFaceCheekColor;
            ${shader.fragmentShader}
        `.replace(
            '#include <map_fragment>',
            /*glsl*/ `
            vec4 faceColor = texture2D(map, vFaceUv);
            vec4 faceShadow = texture2D(tShadow, vFaceUv);
            vec4 eyehighlight = texture2D(tEyehighlight, vFaceUv2);

            vec3 rdFacePhysicalLightVS = normalize(vec3(-0.35, 0.72, 0.60));
            #if NUM_DIR_LIGHTS > 0
                rdFacePhysicalLightVS = normalize(directionalLights[0].direction);
            #endif
            // CameraDepthTexture offset sampling remains tied to the physical
            // main light. FaceGradient alone consumes the character override.
            vec3 rdToonMainLightDirection = rdFacePhysicalLightVS;
            // RD_FACE_GRADIENT_DEPTH_SAMPLE_BEGIN
            // SetGlobalShaderParams applies the same character-light direction
            // to FaceGradient as to Body/Hair.  Keeping Face on the physical
            // stage light alone made every overridden scene appear backlit.
            vec3 rdFaceLightVS = normalize(mix(
                rdFacePhysicalLightVS,
                uGlobalCharacterLightingOverrideDirection,
                step(
                    0.5,
                    uGlobalCharacterLightingOverrideDirectionEnabled
                )
            ));

            // Recovered from the Android ReDriveToon face-gradient variant.
            // The two bias constants and the 0.985 threshold are part of the
            // compiled official program, not viewer-tuned approximations.
            vec3 rdFaceForward = normalize(vFaceForwardVS);
            vec3 rdFaceRight = normalize(vFaceRightVS);
            vec3 rdFaceBiasedLight = normalize(
                rdFaceLightVS +
                rdFaceForward * 0.111 +
                rdFaceRight * 0.333
            );
            vec2 rdFaceDirection = vec2(
                dot(rdFaceRight, rdFaceBiasedLight),
                dot(rdFaceForward, rdFaceBiasedLight)
            );
            rdFaceDirection /= max(length(rdFaceDirection), 0.0000001);

            // Exact _FACE_SHADOW_GRADIENTMAP coordinates from the compiled
            // ReDriveToon program. Positive head-right light selects +UV.x;
            // negative selects -UV.x. The official Repeat sampler makes the
            // optional +1 face-U period equivalent, while V remains the
            // authored mesh UV plus each material's row offset. Sampling one
            // fixed V row flattened 108301's whole face into the shadow band.
            float rdFaceGradientSign = rdFaceDirection.x > 0.0
                ? 1.0
                : (rdFaceDirection.x < 0.0 ? -1.0 : 0.0);
            float rdFaceGradientU = vFaceUv.x * rdFaceGradientSign + 1.0;
            float rdNoseGradientU = vFaceUv.x * rdFaceGradientSign;
            float rdFaceGradient = texture2D(
                tFaceGradient,
                vec2(
                    rdFaceGradientU,
                    vFaceUv.y + uFaceGradientYOffset
                )
            ).r;
            float rdNoseGradient = texture2D(
                tNoseGradient,
                vec2(
                    rdNoseGradientU,
                    vFaceUv.y + uNoseGradientYOffset
                )
            ).r;

            // Official mix: nose values farthest from neutral 0.5 replace the
            // face gradient most strongly.
            float rdNoseMix = saturate(abs(rdNoseGradient - 0.5) * 2.0);
            float rdCombinedGradient = mix(
                rdFaceGradient,
                rdNoseGradient,
                rdNoseMix
            );
            float rdFaceThreshold =
                0.985 - (rdFaceDirection.y * 0.5 + 0.5);
            float rdGradientFaceLight = smoothstep(
                rdFaceThreshold - 0.01,
                rdFaceThreshold,
                rdCombinedGradient
            );
            rdGradientFaceLight *= step(0.899999976, rdFaceGradientDepthSignal);
            // The official face pass excludes the UV2 marker island used by
            // the separate eye/auxiliary geometry branch.
            rdGradientFaceLight *= 1.0 - step(1.4, length(vFaceUv2));
            float rdMaskNdotL = dot(
                rdFaceLightVS,
                normalize(vFaceSelfShadowNormalVS)
            );
            float rdMaskFaceLight = smoothstep(
                0.0,
                1.0,
                clamp(rdMaskNdotL + 1.0, 0.0, 1.0)
            );
            float rdCombinedFaceLight = mix(
                rdMaskFaceLight,
                rdGradientFaceLight,
                saturate(uUseFaceGradient)
            );

            faceColor.rgb = mix(
                faceShadow.rgb * uGlobalCharacterShadowTint,
                faceColor.rgb,
                rdCombinedFaceLight
            );

            diffuseColor = faceColor;
            `
        ).replace(
            '#include <opaque_fragment>',
            /*glsl*/ `
            // JP ReDriveToon face pass evaluates SH with the animated Head
            // forward direction, not the polygon normal. Apply the scene-volume
            // lighting override before subsequent material additions.
            vec3 rdFaceForwardNormalVS = normalize(vFaceForwardVS);
            vec3 rdFaceAmbient = getAmbientLightIrradiance(ambientLightColor);
            #if defined(USE_LIGHT_PROBES)
                rdFaceAmbient += getLightProbeIrradiance(
                    lightProbe,
                    rdFaceForwardNormalVS
                );
            #endif
            #if NUM_HEMI_LIGHTS > 0
                #pragma unroll_loop_start
                for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
                    rdFaceAmbient += getHemisphereLightIrradiance(
                        hemisphereLights[i],
                        rdFaceForwardNormalVS
                    );
                }
                #pragma unroll_loop_end
            #endif
            vec3 rdFaceMainLightColor = vec3(0.0);
            #if NUM_DIR_LIGHTS > 0
                // Stage directional lights are multiplied by PI so Three's
                // Lambert branch receives Unity radiance after RECIPROCAL_PI.
                // This face carrier bypasses Lambert, matching ReDriveToon's
                // direct _MainLightColor use, so undo that transport scaling.
                rdFaceMainLightColor =
                    directionalLights[0].color * RECIPROCAL_PI;
            #endif
            vec3 rdFaceSceneLightRaw = clamp(
                max(rdFaceAmbient, vec3(0.0)) + rdFaceMainLightColor,
                vec3(0.0),
                vec3(1.0)
            );
            vec3 rdFaceSceneLightColor = max(
                mix(
                    rdFaceSceneLightRaw,
                    uGlobalCharacterLightingOverrideColor,
                    saturate(uGlobalCharacterLightingOverrideRatio)
                ),
                vec3(0.1)
            );
            outgoingLight =
                diffuseColor.rgb * rdFaceSceneLightColor +
                totalEmissiveRadiance;

            // _ISEYE is a separate queue-2001 geometry pass. The compiled
            // ReDriveToon program applies its highlight after scene lighting;
            // it is not a hand-tuned brightening of the main face material.
            vec2 rdFaceAdditionalUv = vFaceUv2;
            if (uOfficialFaceHighlightRotation != 0.0) {
                vec2 rdEyeCenter = vFaceUv2.x <= 0.5
                    ? vec2(0.25, 0.25)
                    : vec2(0.75, 0.25);
                vec2 rdEyeLocal = vFaceUv2 - rdEyeCenter;
                float rdEyeAngle =
                    uOfficialFaceHighlightRotation * 6.28318530718;
                float rdEyeSin = sin(rdEyeAngle);
                float rdEyeCos = cos(rdEyeAngle);
                rdFaceAdditionalUv = rdEyeCenter + vec2(
                    dot(rdEyeLocal, vec2(rdEyeCos, rdEyeSin)),
                    dot(rdEyeLocal.yx, vec2(rdEyeCos, -rdEyeSin))
                );
            }
            float rdEyeAdditional = texture2D(
                tEyehighlight,
                rdFaceAdditionalUv
            ).r;
            float rdEyeHighlight = smoothstep(
                uOfficialFaceHighlightThreshold,
                uOfficialFaceHighlightThreshold + 0.05,
                rdEyeAdditional
            );
            vec3 rdFaceHighlightCarrier =
                min(rdFaceSceneLightColor * 2.0, vec3(1.0)) * 1.5;
            outgoingLight += rdFaceHighlightCarrier * rdEyeHighlight
                * saturate(uOfficialFaceIsEye);

            // TW face pass 3 blob 106 applies this pre-gate carrier only in the
            // _FACE_SHADOW_GRADIENTMAP variant. The ordinary eyebrow-mask
            // program does not. _ISEYE emits its highlight separately.
            float rdFaceAdditional = texture2D(
                tEyehighlight,
                vFaceUv2
            ).r;
            float rdBaseCheekBlend =
                rdFaceAdditional * uCheekValue *
                (1.0 - saturate(uOfficialFaceIsEye)) *
                saturate(uUseFaceGradient);
            outgoingLight = mix(
                outgoingLight,
                outgoingLight * uOfficialFaceCheekColor,
                rdBaseCheekBlend
            );

            if (uOfficialFaceShouldApplyAdditional != 0.0) {
                float rdCheekMask = step(0.5, vFaceUv2.y);
                float rdAdditionalCheekBlend =
                    rdFaceAdditional * rdCheekMask * uCheekValue;
                outgoingLight = mix(
                    outgoingLight,
                    outgoingLight * uOfficialFaceCheekColor,
                    rdAdditionalCheekBlend
                );
                float rdFaceHighlight = smoothstep(
                    uOfficialFaceHighlightThreshold,
                    uOfficialFaceHighlightThreshold + 0.05,
                    rdFaceAdditional * (1.0 - rdCheekMask)
                );
                outgoingLight += rdFaceHighlightCarrier * rdFaceHighlight;
            }

            #include <opaque_fragment>
            `
        );

        injectCharacterPerspectiveCancellation(
            shader,
            options.characterPerspectiveReference,
        );
        injectToonStylization(shader, uniforms);
        injectReDriveDepthRimShader(shader);
        runtimeUserData.shader = shader;
        runtimeUserData.shaderUniforms = uniforms;
        if (native) {
            if (!options.faceReference) {
                shader.uniforms.uFaceForwardWS.value.copy(native.faceDirections.forward);
                shader.uniforms.uFaceUpWS.value.copy(native.faceDirections.up);
                shader.uniforms.uFaceRightWS.value.copy(native.faceDirections.right);
            }
            shader.vertexShader = shader.vertexShader.replace('attribute vec2 uv1;', 'attribute vec2 reDriveTexcoord1;').replace(/vFaceUv2 = uv1/g, 'vFaceUv2 = reDriveTexcoord1');
            applyNativeSlotShaderBindings(shader, native);
            Object.assign(runtimeUserData, { nativeMaterialKey: native.key, nativeTextureSampling: native.sampling, nativeUnknowns: native.unknowns });
        }
    };

    return {
        material,
        textures: [
            colorTex,
            shadowTex,
            ctrlTex,
            noseGradientTex,
            defaultFaceAdditionalTexture,
            ...loadedFaceAdditionalEntries.map(([, value]) => value.texture),
        ].filter((texture): texture is THREE.Texture => texture instanceof THREE.Texture),
        shadowTex: shadowTex ?? undefined,
        officialFaceAdditionalRuntime,
        officialFaceAdditionalBindings,
        officialFaceGradientRuntime,
        updateFaceDirectionReference: options.faceReference
            ? updateFaceDirectionReference
            : undefined,
    };
}
