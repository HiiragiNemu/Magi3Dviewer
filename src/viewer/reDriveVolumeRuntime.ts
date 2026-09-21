import * as THREE from 'three'
import {
    DepthRimExperiment,
    getReDriveCharacterLightingDirectionState,
    getMeshToonStylizationUniforms,
    setReDriveCharacterLightingOverrideDirection,
    toonStylizationOptions,
} from 'magia-exedra-character-three/shaders'
import { scene, recoveredFillLight, recoveredHemisphereLight } from './scene'
import { unityShL2ToThree } from './unityLighting'
import { captureStageRecord, captureStageFields, captureStageUniforms } from './stageCommitState'

export type RdBlendMode = 0 | 1 | 2 | 3
export type Rgba = [number, number, number, number]

type SceneWithImageBasedLighting = THREE.Scene & {
    environmentIntensity?: number
    backgroundIntensity?: number
}

export interface ReDriveVolumeRuntimeProfile {
    skyboxIntensity?: number
    shAmbient?: number[]
    characterTint?: string | Rgba
    characterShadowTint?: string | Rgba
    /** _globalBackgroundTintColor: scene-global background multiply. */
    backgroundTint?: string | Rgba
    /** _bgBackgroundTintColor: background-only multiply. */
    backgroundBackgroundTint?: string | Rgba
    characterLightingOverrideColor?: string | Rgba
    characterLightingOverrideRatio?: number
    /** Native Vector3Parameter value: Unity Euler degrees, not a direction. */
    characterLightingOverrideDirection?: [number, number, number]
    /** Optional effective Volume-stack gate recovered at runtime. */
    characterLightingOverrideDirectionEnabled?: boolean
    characterAdditionalRimLightColor?: string | Rgba
    characterAdditionalRimLightDirection?: [number, number]
    characterFaceAwayTint?: string | Rgba
    characterCancelPerspective?: number
    backgroundShadowStrengthAdditive?: number
    backgroundPostExposure?: number
    backgroundContrast?: number
    backgroundSaturation?: number
    paraffin?: {
        enabled?: boolean
        /** True only after the native IsActiveParaffin gate is recovered. */
        runtimeVerified?: boolean
        /** True only after the web operator matches the compiled shader. */
        operatorVerified?: boolean
        topColor: string | Rgba
        bottomColor: string | Rgba
        opacity: number
        width: number
        topBlendMode: RdBlendMode
        bottomBlendMode: RdBlendMode
        /** Serialized ReDriveVolume _useFixedLightDir value. */
        useFixedLightDirection?: boolean
        activationSource?: string
        operatorSource?: string
        lightScreenIntensity?: number
        lightScreenTopColor?: string | Rgba
        lightScreenBottomColor?: string | Rgba
        lightScreenPow?: number
        lightScreenRoundness?: number
    }
    overrides?: Record<string, boolean>
}

export interface ReDriveBackgroundShaderGlobals {
    /** Native `_BgColorAdjustments`: contrast, saturation, exposure multiplier. */
    colorAdjustments: [number, number, number]
    globalTint: string | Rgba
    backgroundTint: string | Rgba
    shadowStrengthAdditive: number
    authority: 'redrive-volume-to-native-gpu-uniforms'
}

export interface ReDriveVolumeRuntimeOptions {
    /** True when recovered background materials consume native shader globals. */
    backgroundShaderGlobalsApplied?: boolean
}

const lightProbe = new THREE.LightProbe(new THREE.SphericalHarmonics3(), 0)
lightProbe.name = 'OfficialReDriveSphericalHarmonics'
const backgroundLightProbe =
    new THREE.LightProbe(new THREE.SphericalHarmonics3(), 0)
backgroundLightProbe.name = 'OfficialReDriveSphericalHarmonics:Background'

function captureInitialState() {
    return {
        sceneEnvironmentIntensity:
            (scene.scene as SceneWithImageBasedLighting).environmentIntensity,
        backgroundSceneEnvironmentIntensity:
            (scene.backgroundScene as SceneWithImageBasedLighting).environmentIntensity,
        sceneBackgroundIntensity:
            (scene.scene as SceneWithImageBasedLighting).backgroundIntensity,
        backgroundSceneBackgroundIntensity:
            (scene.backgroundScene as SceneWithImageBasedLighting).backgroundIntensity,
        ambientIntensity: scene.ambientLight.intensity,
        hemisphereIntensity: recoveredHemisphereLight.intensity,
        fillIntensity: recoveredFillLight.intensity,
        characterTint: toonStylizationOptions.characterTint,
        characterShadowTint: toonStylizationOptions.characterShadowTint,
        characterLightingOverrideColor:
            toonStylizationOptions.characterLightingOverrideColor,
        characterLightingOverrideRatio:
            toonStylizationOptions.characterLightingOverrideRatio,
        characterLightingOverrideDirection:
            getReDriveCharacterLightingDirectionState(),
        rimEnabled: toonStylizationOptions.rimEnabled,
        rimColor: toonStylizationOptions.rimColor,
        rimStrength: toonStylizationOptions.rimStrength,
        rimDirectionX: toonStylizationOptions.rimDirectionX,
        rimDirectionY: toonStylizationOptions.rimDirectionY,
        additionalRimDirection:
            DepthRimExperiment.additionalDirectionVS.clone(),
        additionalRimColor: DepthRimExperiment.additionalColor.clone(),
    }
}

type InitialState = ReturnType<typeof captureInitialState>
let initialState: InitialState | undefined
let probesAttached = false

/**
 * stages.ts and scene.ts form an intentional runtime import cycle. Do not read
 * the scene binding while modules are still being evaluated: production chunk
 * ordering can otherwise hit the ESM temporal dead zone before setupViewer().
 */
function ensureReDriveRuntimeInitialized(): InitialState {
    if (!probesAttached) {
        scene.scene.add(lightProbe)
        scene.backgroundScene.add(backgroundLightProbe)
        probesAttached = true
    }
    initialState ??= captureInitialState()
    return initialState
}

/** Restore captured values directly: do not retry the consumer that just failed. */
export function captureReDriveVolumeRuntime() {
    const previousInitialState = initialState
    const previousAttached = probesAttached
    const parents = [lightProbe.parent, backgroundLightProbe.parent]
    const restoreOptions = captureStageRecord(toonStylizationOptions)
    const direction = getReDriveCharacterLightingDirectionState()
    const restoreDepth = captureStageRecord(DepthRimExperiment)
    const restoreProbes = [lightProbe, backgroundLightProbe]
        .map(probe => captureStageFields(probe, ['intensity', 'sh']))
    const restoreUniforms = scene.characters.flatMap(entry =>
        entry.character?.userData.meshes ?? []).flatMap(mesh =>
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
            .flatMap(material => material.userData.shader?.uniforms
                ? [captureStageUniforms(material.userData.shader.uniforms)] : []))
    return () => {
        restoreOptions()
        setReDriveCharacterLightingOverrideDirection(direction.enabled, direction.eulerDegrees)
        restoreDepth()
        restoreProbes.forEach(restore => restore())
        restoreUniforms.forEach(restore => restore())
        ;[lightProbe, backgroundLightProbe].forEach((probe, index) => {
            if (probe.parent !== parents[index]) {
                probe.removeFromParent()
                parents[index]?.add(probe)
            }
        })
        initialState = previousInitialState
        probesAttached = previousAttached
    }
}

function color(value: string | Rgba | undefined, fallback = '#ffffff'): THREE.Color {
    if (Array.isArray(value)) return new THREE.Color(value[0], value[1], value[2])
    return new THREE.Color(value ?? fallback)
}

function colorAndIntensity(value: string | Rgba | undefined) {
    const rgba: Rgba = Array.isArray(value)
        ? value
        : (() => {
            const c = new THREE.Color(value ?? '#ffffff')
            return [c.r, c.g, c.b, 1] as Rgba
        })()
    const intensity = Math.max(rgba[0], rgba[1], rgba[2], 0)
    const safe = intensity > 0.0001 ? intensity : 1
    return {
        color: new THREE.Color(rgba[0] / safe, rgba[1] / safe, rgba[2] / safe),
        intensity,
    }
}

function updateCharacterUniforms() {
    scene.characters
        .map(entry => entry.character)
        .filter(character => Boolean(character))
        .flatMap(character => character!.userData.meshes)
        .flatMap(mesh => getMeshToonStylizationUniforms(mesh))
        .forEach(uniforms => uniforms.loadGlobalOptions())
}

function applySphericalHarmonics(values?: number[]) {
    ensureReDriveRuntimeInitialized()
    if (!values || values.length !== 27) {
        lightProbe.intensity = 0
        backgroundLightProbe.intensity = 0
        return
    }

    const coefficients = unityShL2ToThree(values)
    for (let coefficient = 0; coefficient < coefficients.length; coefficient++) {
        lightProbe.sh.coefficients[coefficient].set(
            ...coefficients[coefficient],
        )
        backgroundLightProbe.sh.coefficients[coefficient].copy(
            lightProbe.sh.coefficients[coefficient],
        )
    }
    lightProbe.intensity = 1
    backgroundLightProbe.intensity = 1
    scene.ambientLight.intensity = 0
    scene.backgroundAmbientLight.intensity = 0
    recoveredHemisphereLight.intensity = 0
    recoveredFillLight.intensity = 0
}

function profileOverride(
    profile: ReDriveVolumeRuntimeProfile,
    key: string,
    present: boolean,
) {
    return profile.overrides?.[key] ?? present
}

/**
 * Resolve serialized Volume parameters to the exact native GPU representation.
 * A bounded TW GLES capture confirmed [1, 1.05, 1.14869833] for serialized
 * contrast=0, saturation=5 and postExposure=0.2.
 */
export function resolveReDriveBackgroundShaderGlobals(
    profile?: ReDriveVolumeRuntimeProfile,
): ReDriveBackgroundShaderGlobals | undefined {
    if (!profile) return undefined
    const contrastEnabled = profileOverride(
        profile,
        'backgroundContrast',
        profile.backgroundContrast != undefined,
    )
    const saturationEnabled = profileOverride(
        profile,
        'backgroundSaturation',
        profile.backgroundSaturation != undefined,
    )
    const exposureEnabled = profileOverride(
        profile,
        'backgroundPostExposure',
        profile.backgroundPostExposure != undefined,
    )
    const globalTintEnabled = profileOverride(
        profile,
        'backgroundTint',
        profile.backgroundTint != undefined,
    )
    const backgroundTintEnabled = profileOverride(
        profile,
        'backgroundBackgroundTint',
        profile.backgroundBackgroundTint != undefined,
    )
    const shadowEnabled = profileOverride(
        profile,
        'backgroundShadowStrengthAdditive',
        profile.backgroundShadowStrengthAdditive != undefined,
    )
    const contrast = contrastEnabled ? profile.backgroundContrast ?? 0 : 0
    const saturation = saturationEnabled ? profile.backgroundSaturation ?? 0 : 0
    const postExposure = exposureEnabled ? profile.backgroundPostExposure ?? 0 : 0
    return {
        colorAdjustments: [
            1 + contrast * 0.01,
            1 + saturation * 0.01,
            2 ** postExposure,
        ],
        globalTint: globalTintEnabled
            ? profile.backgroundTint ?? [1, 1, 1, 1]
            : [1, 1, 1, 1],
        backgroundTint: backgroundTintEnabled
            ? profile.backgroundBackgroundTint ?? [1, 1, 1, 1]
            : [1, 1, 1, 1],
        shadowStrengthAdditive: shadowEnabled
            ? THREE.MathUtils.clamp(
                profile.backgroundShadowStrengthAdditive ?? 0,
                0,
                1,
            )
            : 0,
        authority: 'redrive-volume-to-native-gpu-uniforms',
    }
}

function applySkyboxIntensity(profile: ReDriveVolumeRuntimeProfile) {
    const enabled = profileOverride(
        profile,
        'skyboxIntensity',
        profile.skyboxIntensity != undefined,
    )
    if (!enabled) {
        delete scene.scene.userData.reDriveSkyboxIntensity
        return
    }
    const intensity = Number.isFinite(profile.skyboxIntensity)
        ? Math.max(0, profile.skyboxIntensity ?? 1)
        : 1
    ;(scene.scene as SceneWithImageBasedLighting).environmentIntensity = intensity
    ;(scene.backgroundScene as SceneWithImageBasedLighting).environmentIntensity = intensity
    ;(scene.scene as SceneWithImageBasedLighting).backgroundIntensity = intensity
    ;(scene.backgroundScene as SceneWithImageBasedLighting).backgroundIntensity = intensity
    scene.scene.userData.reDriveSkyboxIntensity = intensity
}

function applyBackgroundColorAdjustments(
    profile: ReDriveVolumeRuntimeProfile,
    shaderGlobalsApplied: boolean,
) {
    const pass = scene.effects.backgroundColorAdjustPass
    const globalTintEnabled = profileOverride(
        profile,
        'backgroundTint',
        profile.backgroundTint != undefined,
    )
    const backgroundTintEnabled = profileOverride(
        profile,
        'backgroundBackgroundTint',
        profile.backgroundBackgroundTint != undefined,
    )
    const exposureEnabled = profileOverride(
        profile,
        'backgroundPostExposure',
        profile.backgroundPostExposure != undefined,
    )
    const contrastEnabled = profileOverride(
        profile,
        'backgroundContrast',
        profile.backgroundContrast != undefined,
    )
    const saturationEnabled = profileOverride(
        profile,
        'backgroundSaturation',
        profile.backgroundSaturation != undefined,
    )
    const enabled =
        globalTintEnabled
        || backgroundTintEnabled
        || exposureEnabled
        || contrastEnabled
        || saturationEnabled

    const fullscreenFallbackEnabled = enabled && !shaderGlobalsApplied
    pass.enabled = fullscreenFallbackEnabled
    pass.uniforms.uEnabled.value = fullscreenFallbackEnabled ? 1 : 0
    pass.uniforms.uGlobalTint.value.copy(
        color(globalTintEnabled ? profile.backgroundTint : undefined),
    )
    pass.uniforms.uBackgroundTint.value.copy(
        color(
            backgroundTintEnabled
                ? profile.backgroundBackgroundTint
                : undefined,
        ),
    )
    pass.uniforms.uPostExposure.value =
        exposureEnabled ? profile.backgroundPostExposure ?? 0 : 0
    pass.uniforms.uContrast.value =
        contrastEnabled ? profile.backgroundContrast ?? 0 : 0
    pass.uniforms.uSaturation.value =
        saturationEnabled ? profile.backgroundSaturation ?? 0 : 0

    scene.backgroundScene.userData.reDriveBackgroundColorAdjustments = enabled
        ? {
            path: shaderGlobalsApplied
                ? 'native-material-shader-globals'
                : 'fullscreen-fallback',
            shaderGlobals: resolveReDriveBackgroundShaderGlobals(profile),
            globalTint: globalTintEnabled ? profile.backgroundTint ?? null : null,
            backgroundTint: backgroundTintEnabled
                ? profile.backgroundBackgroundTint ?? null
                : null,
            postExposure: pass.uniforms.uPostExposure.value,
            contrast: pass.uniforms.uContrast.value,
            saturation: pass.uniforms.uSaturation.value,
        }
        : null
}

function applyParaffin(profile?: ReDriveVolumeRuntimeProfile['paraffin']) {
    const pass = scene.effects.paraffinPass
    if (
        !profile
        || profile.enabled === false
        || profile.runtimeVerified !== true
        || profile.operatorVerified !== true
        || profile.opacity <= 0.0001
    ) {
        pass.enabled = false
        pass.uniforms.uEnabled.value = 0
        scene.scene.userData.reDriveParaffin = profile
            ? {
                requested: profile.enabled !== false && profile.opacity > 0.0001,
                applied: false,
                reason: profile.runtimeVerified !== true
                    ? 'native-runtime-gate-unverified'
                    : 'compiled-operator-unverified',
            }
            : null
        return
    }

    pass.enabled = true
    pass.uniforms.uEnabled.value = 1
    pass.uniforms.uTopColor.value.copy(color(profile.topColor))
    pass.uniforms.uBottomColor.value.copy(color(profile.bottomColor))
    pass.uniforms.uOpacity.value = profile.opacity
    pass.uniforms.uParaWidth.value = profile.width
    pass.uniforms.uTopBlendMode.value = profile.topBlendMode
    pass.uniforms.uBottomBlendMode.value = profile.bottomBlendMode
    pass.uniforms.uUseFixedLightDirection.value =
        profile.useFixedLightDirection ? 1 : 0
    scene.scene.userData.reDriveParaffin = {
        requested: true,
        applied: true,
        reason: 'verified',
        useFixedLightDirection: profile.useFixedLightDirection === true,
        activationSource: profile.activationSource ?? null,
        operatorSource: profile.operatorSource ?? null,
        lightScreenApplied: false,
    }
}

function applyCharacterLightingOverrideDirection(
    profile: ReDriveVolumeRuntimeProfile,
) {
    const initial = ensureReDriveRuntimeInitialized()
    const serialized = profile.characterLightingOverrideDirection
    const validSerialized =
        serialized != undefined
        && serialized.length === 3
        && serialized.every(Number.isFinite)
    const stageOverridesDirection = profile.overrides
        ?.characterLightingOverrideDirection === true
    // The shader gate is the effective Volume-stack override state. A stored
    // Vector3Parameter with overrideState=false is only an inspector value and
    // must not inherit the Viewer's previous hard-coded -Z override.
    const enabled = profile.characterLightingOverrideDirectionEnabled
        ?? stageOverridesDirection
    const eulerDegrees = validSerialized
        ? serialized
        : initial.characterLightingOverrideDirection.eulerDegrees
    const state = setReDriveCharacterLightingOverrideDirection(
        enabled,
        eulerDegrees,
    )
    scene.scene.userData.reDriveCharacterLightingOverrideDirection = {
        ...state,
        source: profile.characterLightingOverrideDirectionEnabled != undefined
            ? 'resolved-volume-stack'
            : stageOverridesDirection && validSerialized
                ? 'stage-redrive-volume'
                : 'disabled-unoverridden-volume-parameter',
    }
}

export function applyReDriveVolumeRuntime(
    profile?: ReDriveVolumeRuntimeProfile,
    options: ReDriveVolumeRuntimeOptions = {},
) {
    if (!profile) {
        resetReDriveVolumeRuntime()
        return
    }

    ensureReDriveRuntimeInitialized()
    applySphericalHarmonics(profile.shAmbient)
    applySkyboxIntensity(profile)
    applyBackgroundColorAdjustments(
        profile,
        options.backgroundShaderGlobalsApplied === true,
    )
    applyParaffin(profile.paraffin)
    applyCharacterLightingOverrideDirection(profile)

    if (profile.characterTint != undefined) {
        toonStylizationOptions.characterTint =
            `#${color(profile.characterTint).getHexString()}`
    }
    if (profile.characterShadowTint != undefined) {
        toonStylizationOptions.characterShadowTint =
            `#${color(profile.characterShadowTint).getHexString()}`
    }
    if (profile.characterLightingOverrideColor != undefined) {
        toonStylizationOptions.characterLightingOverrideColor =
            `#${color(profile.characterLightingOverrideColor).getHexString()}`
    }
    toonStylizationOptions.characterLightingOverrideRatio =
        profile.characterLightingOverrideRatio ?? 0

    const rim = colorAndIntensity(profile.characterAdditionalRimLightColor)
    const rimColorOverride =
        profile.overrides?.characterAdditionalRimLightColor
        ?? profile.characterAdditionalRimLightColor != undefined
    const rimDirectionOverride =
        profile.overrides?.characterAdditionalRimLightDirection
        ?? profile.characterAdditionalRimLightDirection != undefined
    const rimDirection = profile.characterAdditionalRimLightDirection
    const validRimDirection =
        rimDirection != undefined
        && rimDirection.length === 2
        && rimDirection.every(Number.isFinite)
    // Additional Rim is a directional runtime/Timeline effect. A serialized
    // HDR colour by itself is only a default value, not proof that the effect
    // is active. Requiring both effective overrides prevents a static white
    // rim from washing out every character in the stage.
    const additionalRimEnabled =
        rimColorOverride
        && rimDirectionOverride
        && validRimDirection
        && rim.intensity > 0.0001
    // `_globalCharacterAdditionalRimLight*` belongs only to the compiled
    // CameraDepthTexture second sample. The old Web normal/view Fresnel band
    // is an inspection approximation, not a second official consumer. Feeding
    // the same HDR scene colour into both paths created a broad smooth halo
    // which Bloom then expanded over the character and erased the hard toon
    // separation. Keep that legacy carrier disabled while a ReDriveVolume is
    // active and preserve the serialized HDR magnitude in the depth carrier.
    toonStylizationOptions.rimEnabled = false
    if (additionalRimEnabled && rimDirection) {
        // Native SetGlobalShaderParams negates both Volume XY components
        // (TW 0x4763170-0x47631A4); the depth shader consumes GPU XY as-is.
        DepthRimExperiment.additionalDirectionVS.set(
            -rimDirection[0], -rimDirection[1],
        )
        DepthRimExperiment.additionalColor
            .copy(rim.color)
            .multiplyScalar(rim.intensity)
    } else {
        DepthRimExperiment.additionalDirectionVS.set(0, 0)
        DepthRimExperiment.additionalColor.setRGB(0, 0, 0)
    }

    scene.scene.userData.reDriveCharacterAdditionalRim = {
        enabled: additionalRimEnabled,
        carrier: 'camera-depth-second-sample',
        legacySurfaceCarrierEnabled: false,
        directionView: DepthRimExperiment.additionalDirectionVS.toArray(),
        colorLinearHdr: DepthRimExperiment.additionalColor.toArray(),
        colorOverride: rimColorOverride,
        directionOverride: rimDirectionOverride,
    }

    scene.scene.userData.reDriveVolumeRuntime = profile
    updateCharacterUniforms()
}

export function resetReDriveVolumeRuntime() {
    const initial = ensureReDriveRuntimeInitialized()
    lightProbe.intensity = 0
    lightProbe.sh.zero()
    ;(scene.scene as SceneWithImageBasedLighting).environmentIntensity =
        initial.sceneEnvironmentIntensity
    ;(scene.backgroundScene as SceneWithImageBasedLighting).environmentIntensity =
        initial.backgroundSceneEnvironmentIntensity
    ;(scene.scene as SceneWithImageBasedLighting).backgroundIntensity =
        initial.sceneBackgroundIntensity
    ;(scene.backgroundScene as SceneWithImageBasedLighting).backgroundIntensity =
        initial.backgroundSceneBackgroundIntensity
    delete scene.scene.userData.reDriveSkyboxIntensity
    backgroundLightProbe.intensity = 0
    backgroundLightProbe.sh.zero()
    scene.ambientLight.intensity = initial.ambientIntensity
    scene.backgroundAmbientLight.intensity = initial.ambientIntensity
    recoveredHemisphereLight.intensity = initial.hemisphereIntensity
    recoveredFillLight.intensity = initial.fillIntensity
    toonStylizationOptions.characterTint = initial.characterTint
    toonStylizationOptions.characterShadowTint = initial.characterShadowTint
    toonStylizationOptions.characterLightingOverrideColor =
        initial.characterLightingOverrideColor
    toonStylizationOptions.characterLightingOverrideRatio =
        initial.characterLightingOverrideRatio
    setReDriveCharacterLightingOverrideDirection(
        initial.characterLightingOverrideDirection.enabled,
        initial.characterLightingOverrideDirection.eulerDegrees,
    )
    delete scene.scene.userData.reDriveCharacterLightingOverrideDirection
    const backgroundPass = scene.effects.backgroundColorAdjustPass
    backgroundPass.enabled = false
    backgroundPass.uniforms.uEnabled.value = 0
    backgroundPass.uniforms.uGlobalTint.value.set(1, 1, 1)
    backgroundPass.uniforms.uBackgroundTint.value.set(1, 1, 1)
    backgroundPass.uniforms.uPostExposure.value = 0
    backgroundPass.uniforms.uContrast.value = 0
    backgroundPass.uniforms.uSaturation.value = 0
    delete scene.backgroundScene.userData.reDriveBackgroundColorAdjustments
    scene.effects.paraffinPass.enabled = false
    scene.effects.paraffinPass.uniforms.uEnabled.value = 0
    delete scene.scene.userData.reDriveParaffin
    toonStylizationOptions.rimEnabled = initial.rimEnabled
    toonStylizationOptions.rimColor = initial.rimColor
    toonStylizationOptions.rimStrength = initial.rimStrength
    toonStylizationOptions.rimDirectionX = initial.rimDirectionX
    toonStylizationOptions.rimDirectionY = initial.rimDirectionY
    DepthRimExperiment.additionalDirectionVS.copy(
        initial.additionalRimDirection,
    )
    DepthRimExperiment.additionalColor.copy(initial.additionalRimColor)
    delete scene.scene.userData.reDriveCharacterAdditionalRim
    delete scene.scene.userData.reDriveVolumeRuntime
    updateCharacterUniforms()
}

Object.assign(window, {
    applyReDriveVolumeRuntime,
    resetReDriveVolumeRuntime,
})
