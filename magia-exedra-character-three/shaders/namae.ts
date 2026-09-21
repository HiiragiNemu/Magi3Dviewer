import * as THREE from 'three'
import type {
    OfficialCustomCharacterShaderProfile,
    OfficialCosmicProfile,
    OfficialMaterialProfile,
    OfficialTextureSamplerProfile,
} from '../materialProfile'
import type { AngelRingReference } from '../renderProfile'
import {
    ApplyOfficialCharacterSurfaceSampling,
    loadTexture,
} from '../texture'
import { MaterialUserData, type MaterialCreationResult } from '.'
import OfficialSharedCosmicNoise from '../models/chara_113401_model/cloud_noise_tex.png'

const NAMAE_SHADER = 'Creative/Character/NamaeShader'
const AKUMA_WEAPON_SHADER = 'Creative/Character/UniqueWeapon/AkumaHomuraWeapon'
const REDRIVE_TOON_SHADER = 'Creative/Character/ReDriveToon'
const DOPPEL_IROHA_SHADER =
    'Creative/Character/ReDriveToon-DoppelIroha'
const OFFICIAL_COSMIC_COMPOSITE = '// RD_OFFICIAL_COSMIC_COMPOSITE'

export interface OfficialCustomCharacterMaterialOptions {
    profile: OfficialCustomCharacterShaderProfile
    /** Complete serialized slot profile; owns ordinary ReDrive Cosmic fields. */
    materialProfile?: OfficialMaterialProfile
    resolveTexture?: (name: string) => string | undefined
    noiseMap?: string
    /** Ordinary ReDrive material retained by a mixed custom/standard mesh. */
    baseMaterial?: THREE.Material
    cosmicMap?: string
    cosmicNoiseMap?: string
    cosmicTextureSampler?: OfficialTextureSamplerProfile
    cosmicNoiseTextureSampler?: OfficialTextureSamplerProfile
    cosmicReference?: AngelRingReference
    /** Reuse a per-slot ReDrive base instead of cloning a shared mesh material. */
    dedicatedBaseMaterial?: boolean
}

export interface OfficialCustomCharacterMaterialResources {
    profile: OfficialCustomCharacterShaderProfile
    kind: 'namae' | 'doppel-iroha' | 'redrive-cosmic' | 'akuma-weapon'
    noiseTexture?: THREE.Texture
    cosmicTexture?: THREE.Texture
    cosmicNoiseTexture?: THREE.Texture
    cosmicReference?: AngelRingReference
    facePosition: THREE.Vector3
    headPosition: THREE.Vector3
    headQuaternion: THREE.Quaternion
    faceUp: THREE.Vector3
    characterCancelPerspective: number
}

export interface OfficialCustomCharacterMaterialResult
    extends MaterialCreationResult {
    resources: OfficialCustomCharacterMaterialResources
}

export function supportsOfficialCustomCharacterShader(
    profile: OfficialCustomCharacterShaderProfile | undefined,
): boolean {
    return profile?.name === AKUMA_WEAPON_SHADER ||
        profile?.name === NAMAE_SHADER ||
        profile?.name === DOPPEL_IROHA_SHADER ||
        (profile?.name === REDRIVE_TOON_SHADER && profile.isCosmic === true)
}

/** Promote a serialized standard-ReDrive Cosmic feature to the existing
 * projected-Cosmic material pipeline without any character or mesh ID route. */
export function createOfficialReDriveCosmicShaderProfile(
    materialProfile: OfficialMaterialProfile,
): OfficialCustomCharacterShaderProfile | undefined {
    const cosmic = materialProfile.cosmic
    if (!cosmic.enabled) return undefined
    return {
        name: REDRIVE_TOON_SHADER,
        baseColor: [...cosmic.baseColor],
        emissionColor: [...materialProfile.emissionColor, 0],
        baseTexture: cosmic.baseTexture,
        shadowTexture: cosmic.shadowTexture,
        controlTexture: cosmic.controlTexture,
        noiseTexture: null,
        noiseTiling: 1,
        noiseIntensity: 0,
        noiseThreshold: 0,
        ditherFade: materialProfile.depthRim.ditherFade,
        useVertexColorG: false,
        vertexColorThreshold: 0,
        forwardCutoff: 0.5,
        outlineCutoff: 0.5,
        isCosmic: true,
        alphaClipping: cosmic.alphaClipping,
        fillColor: [0, 0, 0, 0],
        cosmicTexture: cosmic.texture,
        cosmicNoiseTexture: cosmic.noiseTexture,
        cosmicTiling: cosmic.tiling,
        cosmicScroll: [...cosmic.scroll],
        cosmicMaskByControlAlpha: cosmic.maskByControlAlpha,
        cosmicNoiseInfluence: cosmic.noiseInfluence,
        cosmicNoiseTiling: cosmic.noiseTiling,
        cosmicNoiseSpeed: cosmic.noiseSpeed,
    }
}

export function isOfficialStandardReDriveCosmicShader(
    profile: OfficialCustomCharacterShaderProfile,
): boolean {
    return profile.name === REDRIVE_TOON_SHADER && profile.isCosmic === true
}

const officialDitherFunction = /* glsl */`
    float officialDitherPattern(vec2 fragmentPosition) {
        vec2 cell = mod(floor(fragmentPosition), 4.0);
        float index = cell.y * 4.0 + cell.x;
        if (index < 0.5) return 1.0 / 17.0;
        if (index < 1.5) return 9.0 / 17.0;
        if (index < 2.5) return 3.0 / 17.0;
        if (index < 3.5) return 11.0 / 17.0;
        if (index < 4.5) return 13.0 / 17.0;
        if (index < 5.5) return 5.0 / 17.0;
        if (index < 6.5) return 15.0 / 17.0;
        if (index < 7.5) return 7.0 / 17.0;
        if (index < 8.5) return 4.0 / 17.0;
        if (index < 9.5) return 12.0 / 17.0;
        if (index < 10.5) return 2.0 / 17.0;
        if (index < 11.5) return 10.0 / 17.0;
        if (index < 12.5) return 16.0 / 17.0;
        if (index < 13.5) return 8.0 / 17.0;
        if (index < 14.5) return 14.0 / 17.0;
        return 6.0 / 17.0;
    }

    void applyOfficialDither(float fade) {
        float pattern = officialDitherPattern(gl_FragCoord.xy);
        float keep = (1.0 - fade) - fade * (1.0 - pattern);
        if (keep < 0.0) discard;
    }

    float sampleOfficialNamaeNoise(
        sampler2D noiseTexture,
        vec2 viewNormalXY,
        float tiling,
        float timeSeconds
    ) {
        vec2 axis = viewNormalXY;
        float angle = atan(axis.y, axis.x) * 0.159236;
        vec2 polar = vec2(fract(length(axis)), fract(angle));
        vec2 phase = polar * 3.0;
        float noiseA = texture2D(
            noiseTexture,
            phase * tiling + vec2(fract(-timeSeconds))
        ).r;
        float noiseB = texture2D(
            noiseTexture,
            phase * tiling + vec2(fract(timeSeconds))
        ).r;
        return texture2D(
            noiseTexture,
            polar * tiling + vec2((noiseA + noiseB) * 0.5)
        ).r;
    }
`

function createRuntimeUserData(
    profile: OfficialCustomCharacterShaderProfile,
    noiseTexture: THREE.Texture,
) {
    const userData = new MaterialUserData() as MaterialUserData & {
        officialCustomCharacterShader: Record<string, unknown>
    }
    userData.officialCustomCharacterShader = {
        shader: profile.name,
        noiseTexture: profile.noiseTexture,
        forwardCutoff: profile.forwardCutoff,
        outlineCutoff: profile.outlineCutoff,
        compiledPass: 'Namae/pass0/blob3',
        texture: noiseTexture,
    }
    return userData
}

function createResources(
    profile: OfficialCustomCharacterShaderProfile,
    kind: OfficialCustomCharacterMaterialResources['kind'],
    values: Partial<OfficialCustomCharacterMaterialResources> = {},
): OfficialCustomCharacterMaterialResources {
    return {
        profile,
        kind,
        facePosition: new THREE.Vector3(),
        headPosition: new THREE.Vector3(),
        headQuaternion: new THREE.Quaternion(),
        faceUp: new THREE.Vector3(0, 1, 0),
        characterCancelPerspective: 1,
        ...values,
    }
}

async function createOfficialNamaeMaterial(
    options: OfficialCustomCharacterMaterialOptions,
): Promise<OfficialCustomCharacterMaterialResult> {
    const { profile } = options
    if (!profile.noiseTexture || !options.noiseMap) {
        throw new Error(
            `Official shader ${profile.name} is missing serialized noise texture ${profile.noiseTexture}`,
        )
    }

    const noiseTexture = await loadTexture(options.noiseMap, {
        colorSpace: THREE.NoColorSpace,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        magFilter: THREE.LinearFilter,
        minFilter: THREE.LinearMipmapLinearFilter,
        generateMipmaps: true,
    })
    const baseColor = new THREE.Vector4(...profile.baseColor)
    const emissionColor = new THREE.Vector4(...profile.emissionColor)
    const material = new THREE.ShaderMaterial({
        name: profile.name,
        uniforms: {
            tOfficialNoise: { value: noiseTexture },
            uOfficialBaseColor: { value: baseColor },
            uOfficialEmissionColor: { value: emissionColor },
            uOfficialNoiseTiling: { value: profile.noiseTiling },
            uOfficialNoiseThreshold: { value: profile.noiseThreshold },
            uOfficialUseVertexColorG: {
                value: profile.useVertexColorG ? 1 : 0,
            },
            uOfficialVertexColorThreshold: {
                value: profile.vertexColorThreshold,
            },
            uOfficialDitherFade: { value: profile.ditherFade },
            uOfficialForwardCutoff: { value: profile.forwardCutoff },
            uOfficialTime: { value: 0 },
        },
        vertexShader: /* glsl */`
            attribute vec3 color;
            varying vec3 vOfficialVertexColor;
            varying vec3 vOfficialWorldNormal;
            varying vec3 vOfficialViewDirection;
            varying vec2 vOfficialViewNormalXY;
            #include <common>
            #include <morphtarget_pars_vertex>
            #include <skinning_pars_vertex>

            void main() {
                #include <beginnormal_vertex>
                #include <morphnormal_vertex>
                #include <skinbase_vertex>
                #include <skinnormal_vertex>
                #include <begin_vertex>
                #include <morphtarget_vertex>
                #include <skinning_vertex>

                vec4 officialWorldPosition =
                    modelMatrix * vec4(transformed, 1.0);
                vec3 officialViewNormal = normalize(
                    normalMatrix * objectNormal
                );
                vOfficialVertexColor = color;
                vOfficialWorldNormal = normalize(
                    mat3(modelMatrix) * objectNormal
                );
                vOfficialViewDirection = normalize(
                    cameraPosition - officialWorldPosition.xyz
                );
                vOfficialViewNormalXY = officialViewNormal.xy;
                gl_Position = projectionMatrix * modelViewMatrix *
                    vec4(transformed, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform sampler2D tOfficialNoise;
            uniform vec4 uOfficialBaseColor;
            uniform vec4 uOfficialEmissionColor;
            uniform float uOfficialNoiseTiling;
            uniform float uOfficialNoiseThreshold;
            uniform float uOfficialUseVertexColorG;
            uniform float uOfficialVertexColorThreshold;
            uniform float uOfficialDitherFade;
            uniform float uOfficialForwardCutoff;
            uniform float uOfficialTime;
            varying vec3 vOfficialVertexColor;
            varying vec3 vOfficialWorldNormal;
            varying vec3 vOfficialViewDirection;
            varying vec2 vOfficialViewNormalXY;
            ${officialDitherFunction}

            void main() {
                applyOfficialDither(uOfficialDitherFade);
                float officialNoise = sampleOfficialNamaeNoise(
                    tOfficialNoise,
                    vOfficialViewNormalXY,
                    uOfficialNoiseTiling,
                    uOfficialTime
                );
                float officialCoverage = clamp(
                    dot(
                        normalize(vOfficialViewDirection),
                        normalize(vOfficialWorldNormal)
                    ) +
                    officialNoise +
                    uOfficialNoiseThreshold +
                    vOfficialVertexColor.g *
                        uOfficialVertexColorThreshold *
                        uOfficialUseVertexColorG,
                    0.0,
                    1.0
                );
                if (officialCoverage < uOfficialForwardCutoff) discard;
                gl_FragColor = vec4(
                    uOfficialBaseColor.rgb + uOfficialEmissionColor.rgb,
                    1.0
                );
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
        side: THREE.FrontSide,
        transparent: false,
        depthTest: true,
        depthWrite: true,
        toneMapped: true,
    })
    material.defaultAttributeValues.color = [0, 0, 0]
    material.userData = createRuntimeUserData(profile, noiseTexture)
    material.customProgramCacheKey = () =>
        `official-custom-character:${profile.name}:${JSON.stringify(profile)}`
    material.onBeforeCompile = shader => {
        const userData = material.userData as MaterialUserData
        userData.shader = shader
    }
    material.onBeforeRender = () => {
        material.uniforms.uOfficialTime.value = performance.now() * 0.001
    }

    return {
        material,
        textures: [noiseTexture],
        resources: createResources(profile, 'namae', { noiseTexture }),
    }
}

const officialCosmicFunctions = /* glsl */`
    vec3 officialCosmicRgbToHsv(vec3 c) {
        vec4 K = vec4(0.0, -0.3333333333, 0.6666666667, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    vec3 officialCosmicHsvToRgb(vec3 c) {
        vec3 p = abs(fract(c.xxx + vec3(0.0, 0.6666666667, 0.3333333333)) * 6.0 - 3.0);
        return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
    }

    vec3 officialCosmicOverlay(vec3 base, vec3 blend) {
        vec3 low = 2.0 * base * blend;
        vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
        return mix(low, high, step(vec3(0.5), base));
    }
`

function createWhiteCosmicNoiseTexture() {
    const texture = new THREE.DataTexture(
        new Uint8Array([255, 255, 255, 255]),
        1,
        1,
        THREE.RGBAFormat,
    )
    texture.name = 'Official default white CosmicNoiseTex'
    texture.colorSpace = THREE.NoColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true
    return texture
}

function resolveOfficialCosmicProfile(
    options: OfficialCustomCharacterMaterialOptions,
): OfficialCosmicProfile {
    const exact = options.materialProfile?.cosmic
    if (exact?.enabled) return exact
    const profile = options.profile
    return {
        enabled: profile.isCosmic === true,
        alphaClipping: profile.alphaClipping === true,
        baseColor: [...profile.baseColor],
        isScreenBaseMap: false,
        baseTexture: profile.baseTexture ?? null,
        shadowTexture: profile.shadowTexture ?? null,
        controlTexture: profile.controlTexture ?? null,
        baseMapTiling: 1,
        baseMapScroll: [0, 0],
        texture: profile.cosmicTexture ?? null,
        noiseTexture: profile.cosmicNoiseTexture ?? null,
        tiling: profile.cosmicTiling ?? 1,
        scroll: profile.cosmicScroll ?? [0, 0],
        maskByControlAlpha: profile.cosmicMaskByControlAlpha === true,
        noiseInfluence: profile.cosmicNoiseInfluence ?? 1,
        noiseTiling: profile.cosmicNoiseTiling ?? 1,
        noiseSpeed: profile.cosmicNoiseSpeed ?? 1,
        getShadowTexture: false,
        getShadowTint: false,
        applyAmbientLighting: false,
        overlay: false,
        shadowTintColor: [1, 1, 1],
    }
}

async function createOfficialProjectedCosmicMaterial(
    options: OfficialCustomCharacterMaterialOptions,
): Promise<OfficialCustomCharacterMaterialResult> {
    const { profile, baseMaterial } = options
    const cosmic = resolveOfficialCosmicProfile(options)
    if (!baseMaterial) {
        throw new Error(
            `Official shader ${profile.name} requires its ordinary ReDrive base material`,
        )
    }
    if (!cosmic.enabled || !cosmic.texture || !options.cosmicMap) {
        throw new Error(
            `Official shader ${profile.name} is missing serialized CosmicTex ${cosmic.texture}`,
        )
    }

    const cosmicTexture = await loadTexture(options.cosmicMap, {
        colorSpace: THREE.NoColorSpace,
    })
    ApplyOfficialCharacterSurfaceSampling(
        cosmicTexture,
        options.cosmicMap,
        options.cosmicTextureSampler,
    )

    let cosmicNoiseTexture: THREE.Texture
    if (cosmic.noiseTexture) {
        const cosmicNoiseMap = options.cosmicNoiseMap ?? (
            cosmic.noiseTexture.toLowerCase() === 'cloud_noise_tex'
                ? OfficialSharedCosmicNoise
                : undefined
        )
        if (!cosmicNoiseMap) {
            cosmicTexture.dispose()
            throw new Error(
                `Official shader ${profile.name} is missing serialized CosmicNoiseTex ${cosmic.noiseTexture}`,
            )
        }
        cosmicNoiseTexture = await loadTexture(cosmicNoiseMap, {
            colorSpace: THREE.NoColorSpace,
        })
        ApplyOfficialCharacterSurfaceSampling(
            cosmicNoiseTexture,
            cosmicNoiseMap,
            options.cosmicNoiseTextureSampler,
        )
    } else {
        // Unity binds its built-in white texture when the serialized PPtr is
        // null. This keeps the recovered noise term deterministic.
        cosmicNoiseTexture = createWhiteCosmicNoiseTexture()
    }

    const previousOnBeforeCompile = baseMaterial.onBeforeCompile
    const previousProgramCacheKey = baseMaterial.customProgramCacheKey
        .bind(baseMaterial)
    const material = options.dedicatedBaseMaterial
        ? baseMaterial
        : baseMaterial.clone()
    material.name = profile.name
    material.transparent = false
    material.opacity = 1
    material.alphaTest = cosmic.alphaClipping ? 0.5 : 0
    // The compiled Forward pass binds ZWrite to the serialized `_ZWrite`
    // property; it is not a fixed `ZWrite Off` pass. The slot binder therefore
    // remains the single authority for this state (hair_alpha serializes 1),
    // just as it is for ordinary ReDrive materials.

    const inheritedUserData = baseMaterial.userData instanceof MaterialUserData
        ? baseMaterial.userData
        : undefined
    const userData = new MaterialUserData() as MaterialUserData & {
        officialCustomCharacterShader: Record<string, unknown>
    }
    userData.officialTextureSampling = inheritedUserData?.officialTextureSampling
    userData.officialCustomCharacterShader = {
        shader: profile.name,
        compiledPass: profile.name === DOPPEL_IROHA_SHADER
            ? 'DoppelIroha/pass3/blob19'
            : 'ReDriveToon/main_base/blob90',
        renderStateBinding: {
            depthWrite: 'serialized:_ZWrite',
            srcBlend: 'serialized:_SrcBlend',
            dstBlend: 'serialized:_DstBlend',
        },
        projection: '_FacePositionWS',
        projectionContract:
            'faceNdc +/- aspectFix/(signedViewDepth*fov*0.015)',
        projectionMultipliers: [3, 9],
        cosmicScrollTimeScale: 0.1,
        cosmicNoiseSamples: 3,
        cosmicTexture: cosmic.texture,
        cosmicNoiseTexture: cosmic.noiseTexture,
        cosmicTiling: cosmic.tiling,
        cosmicScroll: cosmic.scroll,
        cosmicMaskByControlAlpha: cosmic.maskByControlAlpha,
        cosmicNoiseInfluence: cosmic.noiseInfluence,
        cosmicNoiseTiling: cosmic.noiseTiling,
        cosmicNoiseSpeed: cosmic.noiseSpeed,
        isScreenBaseMap: cosmic.isScreenBaseMap,
        baseMapTiling: cosmic.baseMapTiling,
        baseMapScroll: cosmic.baseMapScroll,
        getShadowTexture: cosmic.getShadowTexture,
        getShadowTint: cosmic.getShadowTint,
        applyAmbientLighting: cosmic.applyAmbientLighting,
        overlay: cosmic.overlay,
        shadowTintColor: cosmic.shadowTintColor,
        fillColor: profile.fillColor,
    }
    material.userData = userData

    material.onBeforeCompile = function (shader, renderer) {
        previousOnBeforeCompile.call(this, shader, renderer)
        const runtimeUserData = this.userData as MaterialUserData
        runtimeUserData.shader = shader
        shader.uniforms.tOfficialCosmic = { value: cosmicTexture }
        shader.uniforms.tOfficialCosmicNoise = { value: cosmicNoiseTexture }
        shader.uniforms.uOfficialCosmicTiling = {
            value: cosmic.tiling,
        }
        shader.uniforms.uOfficialCosmicScroll = {
            value: new THREE.Vector2(...cosmic.scroll),
        }
        shader.uniforms.uOfficialCosmicMaskByControlAlpha = {
            value: cosmic.maskByControlAlpha ? 1 : 0,
        }
        shader.uniforms.uOfficialCosmicNoiseInfluence = {
            value: cosmic.noiseInfluence,
        }
        shader.uniforms.uOfficialCosmicNoiseTiling = {
            value: cosmic.noiseTiling,
        }
        shader.uniforms.uOfficialCosmicNoiseSpeed = {
            value: cosmic.noiseSpeed,
        }
        shader.uniforms.uOfficialCosmicIsScreenBaseMap = {
            value: cosmic.isScreenBaseMap ? 1 : 0,
        }
        shader.uniforms.uOfficialCosmicBaseMapTiling = {
            value: cosmic.baseMapTiling,
        }
        shader.uniforms.uOfficialCosmicBaseMapScroll = {
            value: new THREE.Vector2(...cosmic.baseMapScroll),
        }
        shader.uniforms.uOfficialCosmicGetShadowTexture = {
            value: cosmic.getShadowTexture ? 1 : 0,
        }
        shader.uniforms.uOfficialCosmicGetShadowTint = {
            value: cosmic.getShadowTint ? 1 : 0,
        }
        shader.uniforms.uOfficialCosmicApplyAmbientLighting = {
            value: cosmic.applyAmbientLighting ? 1 : 0,
        }
        shader.uniforms.uOfficialCosmicOverlay = {
            value: cosmic.overlay ? 1 : 0,
        }
        shader.uniforms.uOfficialCosmicShadowTintColor = {
            value: new THREE.Color(...cosmic.shadowTintColor),
        }
        shader.uniforms.uOfficialCosmicTime = { value: 0 }
        shader.uniforms.uOfficialCosmicViewport = {
            value: new THREE.Vector2(1, 1),
        }
        shader.uniforms.uOfficialCosmicAspectFix = {
            value: new THREE.Vector2(1, 1),
        }
        shader.uniforms.uOfficialCosmicCameraFov = { value: 1 }
        shader.uniforms.uOfficialCosmicOrthographic = { value: 0 }
        shader.uniforms.uOfficialCosmicOrthoHeight = { value: 1 }
        shader.uniforms.uOfficialCosmicFacePosition = {
            value: new THREE.Vector3(),
        }

        shader.vertexShader = /* glsl */`
            uniform vec3 uOfficialCosmicFacePosition;
            uniform vec2 uOfficialCosmicAspectFix;
            uniform float uOfficialCosmicCameraFov;
            uniform float uOfficialCosmicOrthographic;
            uniform float uOfficialCosmicOrthoHeight;
            varying vec4 vOfficialCosmicFaceRect;
            ${shader.vertexShader}
        `.replace(
            '#include <project_vertex>',
            /* glsl */`
            #include <project_vertex>
            vec4 officialCosmicFaceView = viewMatrix *
                vec4(uOfficialCosmicFacePosition, 1.0);
            vec4 officialCosmicFaceClip = projectionMatrix *
                officialCosmicFaceView;
            // pass3/blob13 preserves the signed Unity view-space Z. The sign
            // is consumed by blob19's (center-half)/(center+half) rectangle;
            // taking abs() mirrors the projected cosmic texture.
            float officialCosmicPerspectiveScale =
                officialCosmicFaceView.z *
                uOfficialCosmicCameraFov * 0.015;
            float officialCosmicProjectionScale = mix(
                officialCosmicPerspectiveScale,
                uOfficialCosmicOrthoHeight,
                step(0.5, uOfficialCosmicOrthographic)
            );
            float officialCosmicSafeProjectionScale =
                abs(officialCosmicProjectionScale) < 0.000001
                    ? (officialCosmicProjectionScale < 0.0
                        ? -0.000001
                        : 0.000001)
                    : officialCosmicProjectionScale;
            float officialCosmicSafeClipW =
                abs(officialCosmicFaceClip.w) < 0.000001
                    ? (officialCosmicFaceClip.w < 0.0
                        ? -0.000001
                        : 0.000001)
                    : officialCosmicFaceClip.w;
            vec2 officialCosmicFaceNdc =
                officialCosmicFaceClip.xy /
                officialCosmicSafeClipW;
            vec2 officialCosmicRectHalf =
                uOfficialCosmicAspectFix /
                officialCosmicSafeProjectionScale;
            vOfficialCosmicFaceRect = vec4(
                officialCosmicFaceNdc,
                officialCosmicRectHalf
            );
            `,
        )

        shader.fragmentShader = /* glsl */`
            uniform sampler2D tOfficialCosmic;
            uniform sampler2D tOfficialCosmicNoise;
            uniform float uOfficialCosmicTiling;
            uniform vec2 uOfficialCosmicScroll;
            uniform float uOfficialCosmicMaskByControlAlpha;
            uniform float uOfficialCosmicNoiseInfluence;
            uniform float uOfficialCosmicNoiseTiling;
            uniform float uOfficialCosmicNoiseSpeed;
            uniform float uOfficialCosmicIsScreenBaseMap;
            uniform float uOfficialCosmicBaseMapTiling;
            uniform vec2 uOfficialCosmicBaseMapScroll;
            uniform float uOfficialCosmicGetShadowTexture;
            uniform float uOfficialCosmicGetShadowTint;
            uniform float uOfficialCosmicApplyAmbientLighting;
            uniform float uOfficialCosmicOverlay;
            uniform vec3 uOfficialCosmicShadowTintColor;
            uniform float uOfficialCosmicTime;
            uniform vec2 uOfficialCosmicViewport;
            varying vec4 vOfficialCosmicFaceRect;
            ${officialCosmicFunctions}
            ${shader.fragmentShader}
        `.replace(
            OFFICIAL_COSMIC_COMPOSITE,
            /* glsl */`
            // JP 2022.3.62f2 main_base blob 90 / DoppelIroha blob 19.
            // The projected branch runs after MatCap, scene light, Aniso,
            // SpecularGradient and Fresnel; it is not an AngelRing substitute.
            vec3 officialCosmicOriginal = outgoingLight;
            vec2 officialCosmicViewport = max(
                uOfficialCosmicViewport,
                vec2(1.0)
            );
            vec2 officialCosmicFragmentNdc =
                gl_FragCoord.xy / officialCosmicViewport * 2.0 - 1.0;
            vec2 officialCosmicRectHalf = vOfficialCosmicFaceRect.zw;
            vec2 officialCosmicRectCoordinate =
                (officialCosmicFragmentNdc -
                    (vOfficialCosmicFaceRect.xy - officialCosmicRectHalf)) /
                (officialCosmicRectHalf * 2.0);
            // pass3/blob19 lines 168-188 use the same face rectangle at
            // 3x for CosmicTex and at 9x for the counter-scrolling noise tap.
            vec2 officialCosmicProjection3 =
                officialCosmicRectCoordinate * 3.0;
            vec2 officialCosmicProjection9 =
                officialCosmicRectCoordinate * 9.0;
            float officialCosmicNoisePhase =
                uOfficialCosmicTime * uOfficialCosmicNoiseSpeed;
            float officialCosmicNoiseA = texture2D(
                tOfficialCosmicNoise,
                officialCosmicProjection3 * uOfficialCosmicNoiseTiling +
                    vec2(fract(officialCosmicNoisePhase))
            ).r;
            float officialCosmicNoiseB = texture2D(
                tOfficialCosmicNoise,
                officialCosmicProjection9 * uOfficialCosmicNoiseTiling +
                    vec2(fract(-officialCosmicNoisePhase))
            ).r;
            float officialCosmicNoise = texture2D(
                tOfficialCosmicNoise,
                officialCosmicProjection3 * uOfficialCosmicNoiseTiling +
                    vec2(
                        (officialCosmicNoiseA + officialCosmicNoiseB) * 0.5
                    )
            ).r;
            vec3 officialCosmicSource = officialCosmicOriginal;
            if (uOfficialCosmicIsScreenBaseMap > 0.5) {
                vec2 officialCosmicBaseUv =
                    officialCosmicProjection3 *
                        uOfficialCosmicBaseMapTiling +
                    uOfficialCosmicBaseMapScroll *
                        uOfficialCosmicTime * 0.1;
                // A proven native NULL BaseMap compiles without USE_MAP.
                vec3 officialCosmicScreenBase = vec3(1.0);
                #ifdef USE_MAP
                    officialCosmicScreenBase = texture2D(
                        map,
                        officialCosmicBaseUv
                    ).rgb;
                #endif
                vec3 officialCosmicScreenShadow =
                    officialCosmicScreenBase;
                #ifdef HAS_SHADOW
                    if (uOfficialCosmicGetShadowTexture > 0.5) {
                        officialCosmicScreenShadow = texture2D(
                            tShadow,
                            officialCosmicBaseUv
                        ).rgb;
                    }
                #endif
                if (uOfficialCosmicGetShadowTint > 0.5) {
                    officialCosmicScreenShadow *=
                        uGlobalCharacterShadowTint;
                }
                officialCosmicSource = mix(
                    officialCosmicScreenShadow,
                    officialCosmicScreenBase,
                    rdToonBaseWeight
                );
            }
            vec3 officialCosmicBaseHsv = officialCosmicRgbToHsv(
                officialCosmicSource
            );
            officialCosmicBaseHsv.x = fract(
                officialCosmicBaseHsv.x +
                officialCosmicNoise * 0.1 *
                    uOfficialCosmicNoiseInfluence
            );
            vec3 officialCosmicBase = officialCosmicHsvToRgb(
                officialCosmicBaseHsv
            );
            vec3 officialCosmicMap = texture2D(
                tOfficialCosmic,
                officialCosmicProjection3 * uOfficialCosmicTiling +
                    uOfficialCosmicScroll * uOfficialCosmicTime * 0.1
            ).rgb;
            officialCosmicMap *= 1.0 +
                uOfficialCosmicNoiseInfluence *
                (2.0 * officialCosmicNoise * officialCosmicNoise - 1.0);
            vec3 officialCosmicOverlayColor = officialCosmicOverlay(
                officialCosmicBase,
                officialCosmicMap
            );
            vec3 officialCosmicAddColor =
                officialCosmicBase + officialCosmicMap;
            vec3 officialCosmicColor = mix(
                officialCosmicAddColor,
                officialCosmicOverlayColor,
                uOfficialCosmicOverlay
            );
            if (uOfficialCosmicIsScreenBaseMap < 0.5) {
                vec3 officialCosmicShadowTint =
                    uOfficialCosmicShadowTintColor;
                if (uOfficialCosmicGetShadowTint > 0.5) {
                    officialCosmicShadowTint *=
                        uGlobalCharacterShadowTint;
                }
                officialCosmicColor = mix(
                    officialCosmicColor * officialCosmicShadowTint,
                    officialCosmicColor,
                    rdToonBaseWeight
                );
            }
            officialCosmicColor *= mix(
                vec3(1.0),
                rdToonSceneLightColor,
                uOfficialCosmicApplyAmbientLighting
            );
            float officialCosmicMask = 1.0;
            #ifdef HAS_CTRL
                officialCosmicMask = mix(
                    1.0,
                    texCtrl.a,
                    uOfficialCosmicMaskByControlAlpha
                );
            #endif
            outgoingLight = mix(
                officialCosmicOriginal,
                officialCosmicColor,
                officialCosmicMask
            );

            ${OFFICIAL_COSMIC_COMPOSITE}
            `,
        )
    }
    material.customProgramCacheKey = () => [
        previousProgramCacheKey(),
        profile.name === DOPPEL_IROHA_SHADER
            ? 'official-doppel-iroha'
            : 'official-redrive-cosmic',
        JSON.stringify(profile),
        JSON.stringify(cosmic),
    ].join(':')
    material.needsUpdate = true

    return {
        material,
        textures: [cosmicTexture, cosmicNoiseTexture],
        resources: createResources(
            profile,
            profile.name === DOPPEL_IROHA_SHADER
                ? 'doppel-iroha'
                : 'redrive-cosmic', {
            cosmicTexture,
            cosmicNoiseTexture,
            cosmicReference: options.cosmicReference,
            characterCancelPerspective:
                options.cosmicReference?.characterCancelPerspective ?? 1,
            },
        ),
    }
}

export async function createOfficialCustomCharacterMaterial(
    options: OfficialCustomCharacterMaterialOptions,
): Promise<OfficialCustomCharacterMaterialResult> {
    const { profile } = options
    if (profile.name === AKUMA_WEAPON_SHADER) {
        const { createOfficialAkumaWeaponMaterial } = await import('./akumaWeapon')
        const result = await createOfficialAkumaWeaponMaterial(profile, options.resolveTexture)
        return { ...result, resources: createResources(profile, 'akuma-weapon') }
    }
    if (profile.name === NAMAE_SHADER) {
        return createOfficialNamaeMaterial(options)
    }
    if (
        profile.name === DOPPEL_IROHA_SHADER ||
        (profile.name === REDRIVE_TOON_SHADER && profile.isCosmic)
    ) {
        return createOfficialProjectedCosmicMaterial(options)
    }
    throw new Error(`Unsupported official character shader: ${profile.name}`)
}

const customViewport = new THREE.Vector2(1, 1)

export function setOfficialCustomCharacterRuntimeUniforms(
    shader: THREE.WebGLProgramParametersWithUniforms | undefined,
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    resources: OfficialCustomCharacterMaterialResources,
) {
    if (!shader) return
    if (resources.kind === 'akuma-weapon') {
        // The dedicated material updates its own uniforms in onBeforeRender,
        // including the first frame before a compiled program is cached.
        return
    }
    const time = performance.now() * 0.001
    if (resources.kind === 'namae') {
        if (shader.uniforms.uOfficialTime) {
            shader.uniforms.uOfficialTime.value = time
        }
        return
    }

    // Mesh.onBeforeRender also runs for the camera-depth override pass. That
    // pass carries the same draw-group index but not the Doppel forward
    // program, so none of the Cosmic uniforms exist there. Only update the
    // material instance whose onBeforeCompile installed the complete set.
    const {
        uOfficialCosmicTime,
        uOfficialCosmicViewport,
        uOfficialCosmicAspectFix,
        uOfficialCosmicCameraFov,
        uOfficialCosmicOrthographic,
        uOfficialCosmicOrthoHeight,
        uOfficialCosmicFacePosition,
    } = shader.uniforms
    if (
        !uOfficialCosmicTime ||
        !uOfficialCosmicViewport ||
        !uOfficialCosmicAspectFix ||
        !uOfficialCosmicCameraFov ||
        !uOfficialCosmicOrthographic ||
        !uOfficialCosmicOrthoHeight ||
        !uOfficialCosmicFacePosition
    ) return

    const reference = resources.cosmicReference
    if (reference) {
        reference.headBone.updateWorldMatrix(true, false)
        reference.headBone.getWorldPosition(resources.headPosition)
        reference.headBone.getWorldQuaternion(resources.headQuaternion)
        resources.faceUp
            .copy(reference.localUp)
            .applyQuaternion(resources.headQuaternion)
            .normalize()
        resources.facePosition
            .copy(resources.headPosition)
            .addScaledVector(resources.faceUp, reference.headOffset)
    }
    if (renderer.getRenderTarget()) {
        const target = renderer.getRenderTarget()!
        customViewport.set(target.width, target.height)
    } else {
        renderer.getDrawingBufferSize(customViewport)
    }
    camera.updateMatrixWorld()
    uOfficialCosmicTime.value = time
    uOfficialCosmicViewport.value.copy(customViewport)
    uOfficialCosmicAspectFix.value.set(
        customViewport.y / Math.max(customViewport.x, 1),
        1,
    )
    let cameraFov = 1
    let orthographic = 0
    let orthoHeight = 1
    if (camera instanceof THREE.PerspectiveCamera) {
        // The projection matrix already carries Camera.zoom. Native uses the
        // serialized fieldOfView here rather than the zoom-adjusted FOV.
        cameraFov = Math.max(camera.fov, 0.0001)
    } else if (camera instanceof THREE.OrthographicCamera) {
        orthographic = 1
        orthoHeight = Math.max(
            Math.abs(camera.top - camera.bottom) /
                (2 * Math.max(camera.zoom, 0.0001)),
            0.0001,
        )
    }
    uOfficialCosmicCameraFov.value = cameraFov
    uOfficialCosmicOrthographic.value = orthographic
    uOfficialCosmicOrthoHeight.value = orthoHeight
    uOfficialCosmicFacePosition.value.copy(
        resources.facePosition,
    )
}

export function installOfficialCustomCharacterOutline(
    material: THREE.ShaderMaterial,
    resources: OfficialCustomCharacterMaterialResources,
) {
    const { profile, noiseTexture } = resources
    if (profile.name !== NAMAE_SHADER || !noiseTexture) return
    material.uniforms.tOfficialNoise = { value: noiseTexture }
    material.uniforms.uOfficialNoiseTiling = { value: profile.noiseTiling }
    material.uniforms.uOfficialNoiseThreshold = {
        value: profile.noiseThreshold,
    }
    material.uniforms.uOfficialDitherFade = { value: profile.ditherFade }
    material.uniforms.uOfficialOutlineCutoff = {
        value: profile.outlineCutoff,
    }
    material.uniforms.uOfficialTime = { value: 0 }
    const outlineViewDirectionDeclaration =
        /\bvarying\s+vec3\s+vOutlineViewDirectionVS\s*;/.test(
            material.fragmentShader,
        )
            ? ''
            : 'varying vec3 vOutlineViewDirectionVS;'
    material.fragmentShader = material.fragmentShader
        .replace(
            '#include <common>',
            `#include <common>
            uniform sampler2D tOfficialNoise;
            uniform float uOfficialNoiseTiling;
            uniform float uOfficialNoiseThreshold;
            uniform float uOfficialDitherFade;
            uniform float uOfficialOutlineCutoff;
            uniform float uOfficialTime;
            ${outlineViewDirectionDeclaration}
            ${officialDitherFunction}`,
        )
        .replace(
            'void main() {',
            `void main() {
                applyOfficialDither(uOfficialDitherFade);
                float officialNoise = sampleOfficialNamaeNoise(
                    tOfficialNoise,
                    vOutlineNormalVS.xy,
                    uOfficialNoiseTiling,
                    uOfficialTime
                );
                float officialCoverage = clamp(
                    dot(
                        normalize(vOutlineViewDirectionVS),
                        normalize(vOutlineNormalVS)
                    ) + officialNoise + uOfficialNoiseThreshold,
                    0.0,
                    1.0
                );
                if (officialCoverage > uOfficialOutlineCutoff) discard;
                gl_FragColor = vec4(uColor + uEmissionColor, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
                return;`,
        )
    const previousOnBeforeRender = material.onBeforeRender
    material.onBeforeRender = function (...args) {
        previousOnBeforeRender.call(this, ...args)
        material.uniforms.uOfficialTime.value = performance.now() * 0.001
    }
    material.customProgramCacheKey = () =>
        `official-custom-outline:${profile.name}:${JSON.stringify(profile)}`
    material.needsUpdate = true
}
