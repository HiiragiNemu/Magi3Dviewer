import * as THREE from 'three'
import {
    getMeshToonStylizationUniforms,
    toonStylizationOptions,
} from 'magia-exedra-character-three/shaders'
import { scene, recoveredFillLight, recoveredHemisphereLight } from './scene'

export type RdBlendMode = 0 | 1 | 2 | 3
export type Rgba = [number, number, number, number]

export interface ReDriveVolumeRuntimeProfile {
    skyboxIntensity?: number
    shAmbient?: number[]
    characterTint?: string | Rgba
    characterShadowTint?: string | Rgba
    backgroundTint?: string | Rgba
    characterLightingOverrideColor?: string | Rgba
    characterLightingOverrideRatio?: number
    characterLightingOverrideDirection?: [number, number, number]
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
        topColor: string | Rgba
        bottomColor: string | Rgba
        opacity: number
        width: number
        topBlendMode: RdBlendMode
        bottomBlendMode: RdBlendMode
        lightScreenIntensity?: number
        lightScreenTopColor?: string | Rgba
        lightScreenBottomColor?: string | Rgba
        lightScreenPow?: number
        lightScreenRoundness?: number
    }
    overrides?: Record<string, boolean>
}

const lightProbe = new THREE.LightProbe(new THREE.SphericalHarmonics3(), 0)
lightProbe.name = 'OfficialReDriveSphericalHarmonics'
scene.scene.add(lightProbe)

const initial = {
    ambientIntensity: scene.ambientLight.intensity,
    hemisphereIntensity: recoveredHemisphereLight.intensity,
    fillIntensity: recoveredFillLight.intensity,
    rimEnabled: toonStylizationOptions.rimEnabled,
    rimColor: toonStylizationOptions.rimColor,
    rimStrength: toonStylizationOptions.rimStrength,
    rimDirectionX: toonStylizationOptions.rimDirectionX,
    rimDirectionY: toonStylizationOptions.rimDirectionY,
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
    if (!values || values.length !== 27) {
        lightProbe.intensity = 0
        return
    }

    // Unity SphericalHarmonicsL2 serializes 9 coefficients per RGB channel.
    for (let coefficient = 0; coefficient < 9; coefficient++) {
        lightProbe.sh.coefficients[coefficient].set(
            values[coefficient],
            values[coefficient + 9],
            values[coefficient + 18],
        )
    }
    lightProbe.intensity = 1
    scene.ambientLight.intensity = 0
    recoveredHemisphereLight.intensity = 0
    recoveredFillLight.intensity = 0
}

function applyParaffin(profile?: ReDriveVolumeRuntimeProfile['paraffin']) {
    const pass = scene.effects.paraffinPass
    if (!profile || profile.enabled === false || profile.opacity <= 0.0001) {
        pass.enabled = false
        pass.uniforms.uEnabled.value = 0
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
    pass.uniforms.uLightScreenIntensity.value = profile.lightScreenIntensity ?? 0
    pass.uniforms.uLightScreenTopColor.value.copy(color(profile.lightScreenTopColor, '#000000'))
    pass.uniforms.uLightScreenBottomColor.value.copy(color(profile.lightScreenBottomColor, '#000000'))
    pass.uniforms.uLightScreenPow.value = profile.lightScreenPow ?? 1
    pass.uniforms.uLightScreenRoundness.value = profile.lightScreenRoundness ?? 0
}

export function applyReDriveVolumeRuntime(profile?: ReDriveVolumeRuntimeProfile) {
    if (!profile) {
        resetReDriveVolumeRuntime()
        return
    }

    applySphericalHarmonics(profile.shAmbient)
    applyParaffin(profile.paraffin)

    const rim = colorAndIntensity(profile.characterAdditionalRimLightColor)
    const rimOverride = profile.overrides?.characterAdditionalRimLightColor ?? profile.characterAdditionalRimLightColor != undefined
    toonStylizationOptions.rimEnabled = rimOverride && rim.intensity > 0.0001
    toonStylizationOptions.rimColor = `#${rim.color.getHexString()}`
    // Unity stores HDR colour magnitude in the RGB components.
    toonStylizationOptions.rimStrength = rim.intensity
    if (profile.characterAdditionalRimLightDirection) {
        toonStylizationOptions.rimDirectionX = profile.characterAdditionalRimLightDirection[0]
        toonStylizationOptions.rimDirectionY = profile.characterAdditionalRimLightDirection[1]
    }

    scene.scene.userData.reDriveVolumeRuntime = profile
    updateCharacterUniforms()
}

export function resetReDriveVolumeRuntime() {
    lightProbe.intensity = 0
    lightProbe.sh.zero()
    scene.ambientLight.intensity = initial.ambientIntensity
    recoveredHemisphereLight.intensity = initial.hemisphereIntensity
    recoveredFillLight.intensity = initial.fillIntensity
    scene.effects.paraffinPass.enabled = false
    scene.effects.paraffinPass.uniforms.uEnabled.value = 0
    toonStylizationOptions.rimEnabled = initial.rimEnabled
    toonStylizationOptions.rimColor = initial.rimColor
    toonStylizationOptions.rimStrength = initial.rimStrength
    toonStylizationOptions.rimDirectionX = initial.rimDirectionX
    toonStylizationOptions.rimDirectionY = initial.rimDirectionY
    delete scene.scene.userData.reDriveVolumeRuntime
    updateCharacterUniforms()
}

Object.assign(window, {
    applyReDriveVolumeRuntime,
    resetReDriveVolumeRuntime,
})
