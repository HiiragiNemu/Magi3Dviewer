import * as THREE from 'three';
import {
    createGeneralMaterial,
    MaterialUserData,
    type MaterialCreationOptions,
    type MaterialCreationResult,
} from '.';
import type { OfficialMaterialProfile } from '../materialProfile';
import type { AngelRingReference } from '../renderProfile';
import {
    ApplyOfficialCharacterAngelRingSampling,
    ApplyOfficialCommonAngelRingSampling,
    loadTexture,
} from '../texture';
import AngelRingMap from './RDToon_AngelRingMap.png';

/**
 * The official material exposes no AngelRing strength, gamma, band-width, or
 * vertical-offset property. This global switch is retained only as a diagnostic
 * A/B toggle; shape, location, map mode, and colour come from official data.
 */
export interface AngelRingOptions {
    enabled: boolean;
}

export type OfficialAngelRingBranch = 'disabled' | 'projected' | 'uv';

export function resolveOfficialAngelRingBranch(
    profile: OfficialMaterialProfile | undefined,
): OfficialAngelRingBranch {
    const angelRing = profile?.angelRing;
    if (!angelRing?.enabled || angelRing.map === 'none') return 'disabled';
    return angelRing.uvMode ? 'uv' : 'projected';
}

export interface OfficialAngelRingSlotRuntime {
    materialName: string | null;
    serializedEnabled: boolean;
    globalEnabled: boolean;
    effectiveEnabled: boolean;
    branch: OfficialAngelRingBranch;
    isHair: boolean;
    map: 'none' | 'common' | 'character';
    mapKind: number;
    uvMode: boolean;
    rimLightColor: readonly [number, number, number];
    uniforms: {
        uAngelRingEnabled: number;
        uAngelRingMaterialEnabled: number;
        uAngelRingMapKind: number;
        uAngelRingUvMode: number;
        uAngelRingAspectFix: readonly [number, number];
        uAngelRingFovOrOrthoFix: number;
        uAngelRingOrthographic: number;
    };
    compiledProjection: {
        source: 'viewer-head-frame-ylock-v1';
        nativeReference: 'main_hair/blob98/fragment-932-1000';
        viewerCompensation: true;
        outsideRangeSampling: 'serialized-sampler';
    };
}

export const angelRingOptions: AngelRingOptions = {
    enabled: true,
};

export const officialAngelRingPreset = {
    ...angelRingOptions,
};

export function resetOfficialAngelRingPreset() {
    Object.assign(angelRingOptions, officialAngelRingPreset);
}

export interface HairMaterialCreationOptions extends MaterialCreationOptions {
    /** Animated official reference: Head.position + faceUp * headOffset. */
    angelRingReference?: AngelRingReference;
    /** Character-authored `_AngelRingMap` used by UV and rare projected modes. */
    angelRingMap?: string;
    /** Stable exported Texture2D path used to select its serialized sampler. */
    angelRingMapName?: string;
}

export interface HairMaterialCreationResult extends MaterialCreationResult {
    updateAngelRingReference?: () => void;
}

function setColorUniform(
    shader: THREE.WebGLProgramParametersWithUniforms,
    key: string,
    value: THREE.ColorRepresentation,
) {
    const current = shader.uniforms[key]?.value;
    if (current instanceof THREE.Color) {
        current.set(value);
    } else {
        shader.uniforms[key] = { value: new THREE.Color(value) };
    }
}

function setNumberUniform(
    shader: THREE.WebGLProgramParametersWithUniforms,
    key: string,
    value: number,
) {
    shader.uniforms[key] ??= { value };
    shader.uniforms[key].value = value;
}

export function loadAngelRingOptions(
    shader: THREE.WebGLProgramParametersWithUniforms,
) {
    setNumberUniform(
        shader,
        'uAngelRingEnabled',
        angelRingOptions.enabled ? 1 : 0,
    );
}

/**
 * Apply the serialized material-slot AngelRing state immediately before the
 * corresponding FBX geometry group is drawn.
 */
export function setOfficialAngelRingMaterialProfileUniforms(
    shader: THREE.WebGLProgramParametersWithUniforms | undefined,
    profile: OfficialMaterialProfile | undefined,
): OfficialAngelRingSlotRuntime | undefined {
    if (!shader) return;
    const angelRing = profile?.angelRing;
    const mapKind = angelRing?.map === 'character'
        ? 2
        : angelRing?.map === 'common'
            ? 1
            : 0;
    loadAngelRingOptions(shader);
    setNumberUniform(
        shader,
        'uAngelRingMaterialEnabled',
        angelRing?.enabled ? 1 : 0,
    );
    setNumberUniform(shader, 'uAngelRingMapKind', mapKind);
    setNumberUniform(shader, 'uAngelRingUvMode', angelRing?.uvMode ? 1 : 0);
    setNumberUniform(
        shader,
        'uHairDepthRimEnabled',
        angelRing?.isHair ? 1 : 0,
    );
    const color = angelRing?.rimLightColor ?? [1, 1, 1];
    setColorUniform(
        shader,
        'uAngelRingColor',
        new THREE.Color(color[0], color[1], color[2]),
    );

    const serializedEnabled = Boolean(angelRing?.enabled && mapKind > 0);
    const globalEnabled = shader.uniforms.uAngelRingEnabled.value > 0.5;
    const uvMode = Boolean(angelRing?.uvMode);
    const aspectFixValue = shader.uniforms.uAngelRingAspectFix?.value;
    const aspectFix: [number, number] = aspectFixValue instanceof THREE.Vector2
        ? [aspectFixValue.x, aspectFixValue.y]
        : [1, 1];
    return {
        materialName: profile?.name ?? null,
        serializedEnabled,
        globalEnabled,
        effectiveEnabled: serializedEnabled && globalEnabled,
        branch: !serializedEnabled
            ? 'disabled'
            : uvMode
                ? 'uv'
                : 'projected',
        isHair: Boolean(angelRing?.isHair),
        map: angelRing?.map ?? 'none',
        mapKind,
        uvMode,
        rimLightColor: [color[0], color[1], color[2]],
        uniforms: {
            uAngelRingEnabled: shader.uniforms.uAngelRingEnabled.value,
            uAngelRingMaterialEnabled:
                shader.uniforms.uAngelRingMaterialEnabled.value,
            uAngelRingMapKind: shader.uniforms.uAngelRingMapKind.value,
            uAngelRingUvMode: shader.uniforms.uAngelRingUvMode.value,
            uAngelRingAspectFix: aspectFix,
            uAngelRingFovOrOrthoFix: Number(
                shader.uniforms.uAngelRingFovOrOrthoFix?.value ?? 1,
            ),
            uAngelRingOrthographic: Number(
                shader.uniforms.uAngelRingOrthographic?.value ?? 0,
            ),
        },
        compiledProjection: {
            source: 'viewer-head-frame-ylock-v1',
            nativeReference: 'main_hair/blob98/fragment-932-1000',
            viewerCompensation: true,
            outsideRangeSampling: 'serialized-sampler',
        },
    };
}

export function collectOfficialAngelRingRuntime(root: THREE.Object3D) {
    const result: Array<Record<string, unknown>> = [];
    root.traverse(object => {
        const runtime = object.userData.officialAngelRingRuntime;
        if (!runtime) return;
        result.push({
            meshName: object.name,
            ...runtime,
        });
    });
    return result;
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        angelRingOptions,
        collectOfficialAngelRingRuntime,
    });
}

const viewportSize = new THREE.Vector2(1, 1);

/**
 * Unity's `_GlobalAspectFix` and `_GlobalFOVorOrthoSizeFix` are camera globals,
 * not artist-tuned AngelRing parameters. Update their Web equivalents for each
 * draw so resized canvases, perspective cameras, and orthographic cameras all
 * use the recovered official projection.
 */
export function setAngelRingCameraUniforms(
    shader: THREE.WebGLProgramParametersWithUniforms | undefined,
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
) {
    if (!shader?.uniforms.uAngelRingViewportSize) return;
    const renderTarget = renderer.getRenderTarget();
    if (renderTarget) {
        viewportSize.set(renderTarget.width, renderTarget.height);
    } else {
        renderer.getDrawingBufferSize(viewportSize);
    }
    const width = viewportSize.x;
    const height = viewportSize.y;
    shader.uniforms.uAngelRingViewportSize.value.set(width, height);
    shader.uniforms.uAngelRingAspectFix.value.set(height / width, 1);

    let cameraFix = 1;
    let orthographic = 0;
    if (camera instanceof THREE.PerspectiveCamera) {
        cameraFix = 1 / camera.fov;
    } else if (camera instanceof THREE.OrthographicCamera) {
        const halfHeight =
            Math.abs(camera.top - camera.bottom) / (2 * camera.zoom);
        cameraFix = 1 / (halfHeight * 100);
        orthographic = 1;
    }
    setNumberUniform(shader, 'uAngelRingFovOrOrthoFix', cameraFix);
    setNumberUniform(shader, 'uAngelRingOrthographic', orthographic);
}

/** Viewer coordinate correction requested from observed head-height locking.
 * Uses the native neutral orthographic scale; not a literal blob98 projection.
 */
export const angelRingHeadLockedUvGLSL = /* glsl */ `
vec2 rdAngelHeadLockedUv(
    vec3 worldPosition, vec3 facePosition, vec3 faceUp,
    vec3 faceForward, vec3 cameraViewZ
) {
    vec3 up = normalize(faceUp);
    vec3 right = cross(up, faceForward);
    if (dot(right, right) < 0.0000000001) {
        right = cross(up, abs(up.y) < 0.9
            ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
    }
    right = normalize(right);
    vec3 forward = cross(right, up);
    vec3 delta = vec3(
        worldPosition.x - facePosition.x,
        worldPosition.y - facePosition.y,
        worldPosition.z - facePosition.z
    );
    float pitch = dot(cameraViewZ, up);
    vec3 horizontalView = vec3(
        cameraViewZ.x - up.x * pitch,
        cameraViewZ.y - up.y * pitch,
        cameraViewZ.z - up.z * pitch
    );
    // At an exact head-up pole yaw has no direction: use the head-forward
    // basis rather than normalize zero. This fallback never changes V.
    vec3 yawView = forward;
    if (dot(horizontalView, horizontalView) > 0.0000000001) {
        yawView = normalize(horizontalView);
    }
    vec3 yawRight = cross(up, yawView);
    // blob98 orthographic: (worldY / (2*halfHeight)) /
    // (20 * 0.875 / (100*halfHeight)) = worldY * 100/(40*0.875).
    float unitScale = 100.0 / (40.0 * 0.875);
    float back = dot(forward, yawView) * -0.5 + 0.5;
    float u = dot(delta, yawRight) * unitScale + 0.5
        + back * back * (15.0 / 20.0);
    // Use head-local X, not yaw-shifted U, for the neutral native arch.
    // Hence yaw can move U without moving or resizing the vertical band.
    float headU = dot(delta, right) * unitScale + 0.5;
    float v = dot(delta, up) * unitScale + 0.5
        + sin(headU * 3.14159274) * (0.5 - 0.414999992) * 0.5;
    return vec2(u, v);
}
`;

export async function createHairMaterial(
    options: HairMaterialCreationOptions,
): Promise<HairMaterialCreationResult> {
    const reference = options.angelRingReference;
    if (!reference) return await createGeneralMaterial(options);

    const profiles = options.materialProfiles ?? [];
    const requiresCommonAngelRingMap = profiles.some(
        profile =>
            resolveOfficialAngelRingBranch(profile) !== 'disabled' &&
            profile.angelRing.map === 'common',
    );
    const requiresCharacterAngelRingMap = profiles.some(
        profile =>
            resolveOfficialAngelRingBranch(profile) !== 'disabled' &&
            profile.angelRing.map === 'character',
    );
    const native = options.nativeResources;
    if (!native && requiresCharacterAngelRingMap && !options.angelRingMap) {
        throw new Error(
            `Official character AngelRing texture is unavailable: ${options.angelRingMapName}`,
        );
    }

    const [commonAngelRingTex, characterAngelRingTex] = native ? [requiresCommonAngelRingMap ? native.textures._AngelRingMap ?? undefined : undefined, requiresCharacterAngelRingMap ? native.textures._AngelRingMap ?? undefined : undefined] : await Promise.all([
        requiresCommonAngelRingMap
            ? loadTexture(AngelRingMap)
            : Promise.resolve(undefined),
        requiresCharacterAngelRingMap && options.angelRingMap
            ? loadTexture(options.angelRingMap)
            : Promise.resolve(undefined),
    ]);
    if (commonAngelRingTex && !native) {
        ApplyOfficialCommonAngelRingSampling(commonAngelRingTex);
    }
    const characterAngelRingSampling = native ? undefined : characterAngelRingTex
        ? ApplyOfficialCharacterAngelRingSampling(
            characterAngelRingTex,
            options.angelRingMapName,
        )
        : undefined;
    if (!native && characterAngelRingTex && !characterAngelRingSampling) {
        commonAngelRingTex?.dispose();
        characterAngelRingTex.dispose();
        throw new Error(
            `Official character AngelRing sampler is missing: ${options.angelRingMapName}`,
        );
    }

    const projectedShaders =
        new Set<THREE.WebGLProgramParametersWithUniforms>();
    const headPosition = new THREE.Vector3();
    const headQuaternion = new THREE.Quaternion();
    const facePosition = new THREE.Vector3();
    const faceUp = new THREE.Vector3(0, 1, 0);
    const faceForward = new THREE.Vector3(0, 0, 1);

    const updateAngelRingReference = () => {
        if (projectedShaders.size === 0) return;
        reference.headBone.updateWorldMatrix(true, false);
        reference.headBone.getWorldPosition(headPosition);
        reference.headBone.getWorldQuaternion(headQuaternion);
        faceUp.copy(reference.localUp).applyQuaternion(headQuaternion).normalize();
        faceForward
            .copy(reference.localForward)
            .applyQuaternion(headQuaternion)
            .normalize();
        facePosition
            .copy(headPosition)
            .addScaledVector(faceUp, reference.headOffset);

        for (const shader of projectedShaders) {
            shader.uniforms.uAngelRingFacePosition.value.copy(facePosition);
            shader.uniforms.uAngelRingFaceUp.value.copy(faceUp);
            shader.uniforms.uAngelRingFaceForward.value.copy(faceForward);

        }
    };

    const result = await createGeneralMaterial({
        ...options,
        onAfterStylization(shader) {
            const profile = this.userData instanceof MaterialUserData
                ? this.userData.officialMaterialProfile ?? options.materialProfiles?.[0]
                : options.materialProfiles?.[0];
            if (resolveOfficialAngelRingBranch(profile) !== 'uv') return;
            // The tint statement is introduced by injectToonStylization.
            // Keep only this UV fragment insertion after that stage; all
            // projected/reference setup retains its original hook order.
            shader.fragmentShader = /* glsl */ `
                varying vec2 vAngelRingUv;
                uniform sampler2D tAngelRingMap;
                uniform float uAngelRingEnabled;
                uniform float uAngelRingMaterialEnabled;
                uniform vec3 uAngelRingColor;
                ${shader.fragmentShader}
            `.replace(
                'outgoingLight *= uGlobalCharacterTint;',
                /* glsl */ `
                // blob 98 adds the UV highlight before the final character tint.
                float rdAngelActive =
                    uAngelRingEnabled * uAngelRingMaterialEnabled;
                if (rdAngelActive > 0.0) {
                    vec3 rdAngelCurrentLighting =
                        rdToonSceneLightColor *
                        (rdToonBaseWeight * 0.8 + 0.2);
                    vec3 rdAngelMap = texture2D(
                        tAngelRingMap,
                        vAngelRingUv
                    ).rgb;
                    outgoingLight +=
                        rdAngelMap *
                        uAngelRingColor *
                        rdAngelCurrentLighting *
                        rdAngelActive;
                }
                outgoingLight *= uGlobalCharacterTint;
                `,
            );
        },
        onBeforeCompile(shader) {
            const runtimeUserData = this.userData instanceof MaterialUserData
                ? this.userData
                : new MaterialUserData();
            this.userData = runtimeUserData;
            const profile = runtimeUserData.officialMaterialProfile ??
                options.materialProfiles?.[0];
            const branch = resolveOfficialAngelRingBranch(profile);
            const selectedTexture = profile?.angelRing.map === 'character'
                ? characterAngelRingTex
                : profile?.angelRing.map === 'common'
                    ? commonAngelRingTex
                    : undefined;
            if (branch !== 'disabled' && !selectedTexture) {
                throw new Error(
                    `Official AngelRing shader variant has no texture: ${profile?.name ?? 'unknown material'}`,
                );
            }

            shader.uniforms.uHairDepthRimEnabled = { value: 0 };
            loadAngelRingOptions(shader);
            setOfficialAngelRingMaterialProfileUniforms(
                shader,
                profile,
            );
            if (branch === 'disabled') return;

            shader.uniforms.tAngelRingMap = { value: selectedTexture };
            if (branch === 'uv') {
                // `_YuugenHighlight` in blob 98 samples raw TEXCOORD0. It has
                // no transformed-base-coordinate or view-dependent state.
                shader.vertexShader = /* glsl */ `
                    varying vec2 vAngelRingUv;
                    ${shader.vertexShader}
                `.replace(
                    '#include <uv_vertex>',
                    /* glsl */ `
                    #include <uv_vertex>
                    vAngelRingUv = uv;
                    `,
                );
                return;
            }

            projectedShaders.add(shader);
            shader.uniforms.uAngelRingFacePosition = {
                value: new THREE.Vector3(),
            };
            shader.uniforms.uAngelRingFaceUp = {
                value: new THREE.Vector3(0, 1, 0),
            };
            shader.uniforms.uAngelRingFaceForward = {
                value: new THREE.Vector3(0, 0, 1),
            };
            shader.uniforms.uAngelRingViewportSize = {
                value: new THREE.Vector2(1, 1),
            };
            shader.uniforms.uAngelRingAspectFix = {
                value: new THREE.Vector2(1, 1),
            };
            shader.uniforms.uAngelRingFovOrOrthoFix = { value: 1 };
            shader.uniforms.uAngelRingOrthographic = { value: 0 };
            updateAngelRingReference();

            shader.vertexShader = /* glsl */ `
                varying vec3 vAngelRingWorldPosition;
                ${shader.vertexShader}
            `.replace(
                '#include <project_vertex>',
                /* glsl */ `
                #include <project_vertex>
                // transformed already contains morph and skin deformation.
                vAngelRingWorldPosition =
                    (modelMatrix * vec4(transformed, 1.0)).xyz;
                `,
            );

            shader.fragmentShader = /* glsl */ `
                varying vec3 vAngelRingWorldPosition;
                uniform vec3 uAngelRingFaceUp;
                uniform vec3 uAngelRingFaceForward;
                ${angelRingHeadLockedUvGLSL}
                uniform sampler2D tAngelRingMap;
                uniform float uAngelRingEnabled;
                uniform float uAngelRingMaterialEnabled;
                uniform vec3 uAngelRingColor;
                uniform vec3 uAngelRingFacePosition;
                uniform vec2 uAngelRingViewportSize;
                uniform vec2 uAngelRingAspectFix;
                uniform float uAngelRingFovOrOrthoFix;
                uniform float uAngelRingOrthographic;
                ${shader.fragmentShader}
            `.replace(
                '// RD_DEPTH_RIM_COMPOSITE_BEGIN',
                /* glsl */ `
                float rdAngelActive =
                    uAngelRingEnabled * uAngelRingMaterialEnabled;
                if (rdAngelActive > 0.0) {
                    // User-observed Y lock: only the input coordinate domain
                    // differs from blob98; sampler and composite remain intact.
                    vec2 rdAngelMapUv = rdAngelHeadLockedUv(
                        vAngelRingWorldPosition,
                        uAngelRingFacePosition,
                        uAngelRingFaceUp,
                        uAngelRingFaceForward,
                        vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])
                    );
                    float rdAngelMap = texture2D(
                        tAngelRingMap,
                        rdAngelMapUv
                    ).r;
                    // Blob 98 combines this sample with the shared depth-rim
                    // carrier before the official colour/light multipliers.
                    rdDepthRimMainCompositeSignal = clamp(
                        rdDepthRimMainCompositeSignal +
                        rdAngelMap * rdAngelActive,
                        0.0,
                        1.0
                    );
                }

                // RD_DEPTH_RIM_COMPOSITE_BEGIN

                // No picture-matched fallback: the official hair edge is the
                // shared CameraDepthTexture signal gated by (1 - NdotV).
                // Missing depth/color-G data therefore stays neutral instead
                // of reintroducing the removed 0.55/0.93/0.16 proxy.
                `,
            );
        },
    });

    const baseProgramCacheKey = result.material.customProgramCacheKey;
    result.material.customProgramCacheKey = function () {
        const profile = this.userData instanceof MaterialUserData
            ? this.userData.officialMaterialProfile
            : options.materialProfiles?.[0];
        const branch = resolveOfficialAngelRingBranch(profile);
        return [
            baseProgramCacheKey.call(this),
            'viewer-angel-ring-head-frame-ylock-v1',
            branch,
            profile?.angelRing.map ?? 'none',
        ].join(':');
    };

    if (
        characterAngelRingSampling &&
        result.material.userData instanceof MaterialUserData &&
        result.material.userData.officialTextureSampling
    ) {
        result.material.userData.officialTextureSampling.angelRingMap =
            characterAngelRingSampling;
    }

    if (commonAngelRingTex) {
        result.textures.push(commonAngelRingTex);
    }
    if (characterAngelRingTex) {
        result.textures.push(characterAngelRingTex);
    }
    return {
        ...result,
        updateAngelRingReference,
    };
}

export function getMeshAngelRingShaders(
    mesh: THREE.Mesh,
): THREE.WebGLProgramParametersWithUniforms[] {
    const shaders = (Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        .map(material => material?.userData)
        .filter(userData => userData instanceof MaterialUserData)
        .map(userData => userData.shader)
        .filter(
            (shader): shader is THREE.WebGLProgramParametersWithUniforms =>
                Boolean(shader?.uniforms.uAngelRingEnabled),
        );
    return [...new Set(shaders)];
}
