import * as THREE from 'three';
import {
    ShadowTexOptions,
    angelRingOptions,
    getMeshAngelRingShaders,
    getMeshGeneralMaterialUniforms,
    getMeshToonStylizationUniforms,
    loadAngelRingOptions,
    resetOfficialAngelRingPreset,
    resetOfficialShadowPreset,
    resetOfficialToonPreset,
    toonStylizationOptions,
} from 'magia-exedra-character-three/shaders';
import { deg2pos } from 'magia-exedra-character-three/scene';
import { recoveredFillLight, recoveredHemisphereLight, scene } from '../scene';
import { gui, guiOptions } from './GUI';
import { setBackgroundColor } from './background';

export const guiShader = gui.addFolder('Shader').close()

const profileActions = {
    ApplyRecoveredBaseline: applyRecoveredBaseline,
}
guiShader.add(profileActions, 'ApplyRecoveredBaseline').name('Apply recovered ReDrive baseline')

const toonFolder = guiShader.addFolder('Recovered ReDrive Toon base').close()
toonFolder.add(toonStylizationOptions, 'officialLookEnabled').name('Enabled').onChange(updateMaterialStylization)
toonFolder.add(toonStylizationOptions, 'lightingInfluence', 0, 1, 0.01).name('Physical light influence').onChange(updateMaterialStylization)
toonFolder.add(toonStylizationOptions, 'albedoLift', -0.25, 0.5, 0.01).name('Albedo lift').onChange(updateMaterialStylization)
toonFolder.add(toonStylizationOptions, 'brightness', 0.25, 2, 0.01).name('Brightness').onChange(updateMaterialStylization)
toonFolder.add(toonStylizationOptions, 'contrast', 0.25, 2, 0.01).name('Contrast').onChange(updateMaterialStylization)
toonFolder.add(toonStylizationOptions, 'saturation', 0, 2, 0.01).name('Saturation').onChange(updateMaterialStylization)
toonFolder.addColor(toonStylizationOptions, 'shadowTint').name('Shadow tint').onChange(updateMaterialStylization)
toonFolder.add(toonStylizationOptions, 'shadowTintStrength', 0, 1, 0.01).name('Shadow tint strength').onChange(updateMaterialStylization)
toonFolder.addColor(toonStylizationOptions, 'highlightTint').name('Highlight tint').onChange(updateMaterialStylization)
toonFolder.add(toonStylizationOptions, 'highlightTintStrength', 0, 1, 0.01).name('Highlight tint strength').onChange(updateMaterialStylization)
toonFolder.add(toonStylizationOptions, 'specularStrength', 0, 2, 0.01).name('Control B / gradient specular').onChange(updateMaterialStylization)
toonFolder.add(toonStylizationOptions, 'metallicResponse', 0, 1, 0.01).name('Control G response tint').onChange(updateMaterialStylization)

const shadowFolder = guiShader.addFolder('Toon shadow selection').close()
shadowFolder.add(ShadowTexOptions, 'preMix', 0, 1, 0.01).name('Control R pre-mix').onChange(updateMaterialShadow)
shadowFolder.add(ShadowTexOptions, 'test', 0, 1, 0.01).name('Light probe value').onChange(updateMaterialShadow)
shadowFolder.add(ShadowTexOptions, 'threshold', -0.5, 1, 0.01).name('Shadow threshold').onChange(updateMaterialShadow)
shadowFolder.add(ShadowTexOptions, 'transition', 0.001, 1, 0.001).name('Shadow softness').onChange(updateMaterialShadow)
shadowFolder.add(ShadowTexOptions, 'amount', -1, 1, 0.01).name('Ambient shadow amount').onChange(updateMaterialShadow)
shadowFolder.add(ShadowTexOptions, 'controlOffsetStrength', 0, 1, 0.01).name('Control R threshold offset').onChange(updateMaterialShadow)

const angelRingFolder = guiShader.addFolder('AngelRing (UV3 + view normal)').close()
angelRingFolder.add(angelRingOptions, 'enabled').name('Enabled').onChange(updateMaterialAngelRing)
angelRingFolder.addColor(angelRingOptions, 'color').name('Color').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'strength', 0, 2, 0.01).name('Strength').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'offsetU', 0, 1, 0.005).name('Normal projection U').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'offsetV', 0, 1, 0.005).name('UV3 / normal V blend').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'verticalOffset', -0.5, 0.5, 0.0025).name('Vertical offset').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'headVInfluence', 0, 1, 0.01).name('Head height correction').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'softness', 0.00025, 0.05, 0.00025).name('Map filtering').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'frontFadeStart', -1, 1, 0.01).name('Back fade start').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'frontFadeEnd', -1, 1, 0.01).name('Front fade end').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'mapGamma', 0.05, 3, 0.01).name('Map gamma').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'emission', 0, 2, 0.01).name('Additive brightness').onChange(updateMaterialAngelRing)

const rimFolder = guiShader.addFolder('Timeline / scene additional Rim').close()
rimFolder.add(toonStylizationOptions, 'rimEnabled').name('Enabled').onChange(updateMaterialStylization)
rimFolder.addColor(toonStylizationOptions, 'rimColor').name('HDR color approximation').onChange(updateMaterialStylization)
rimFolder.add(toonStylizationOptions, 'rimStrength', 0, 2, 0.01).name('Strength').onChange(updateMaterialStylization)
rimFolder.add(toonStylizationOptions, 'rimThreshold', 0, 1, 0.01).name('Threshold').onChange(updateMaterialStylization)
rimFolder.add(toonStylizationOptions, 'rimFeather', 0, 0.5, 0.01).name('Feather').onChange(updateMaterialStylization)
rimFolder.add(toonStylizationOptions, 'rimDirectionX', -1, 1, 0.01).name('Direction X').onChange(updateMaterialStylization)
rimFolder.add(toonStylizationOptions, 'rimDirectionY', -1, 1, 0.01).name('Direction Y').onChange(updateMaterialStylization)
rimFolder.add(toonStylizationOptions, 'rimDirectionality', 0, 1, 0.01).name('Directionality').onChange(updateMaterialStylization)

const fresnelFolder = guiShader.addFolder('Per-renderer animation Fresnel').close()
fresnelFolder.add(toonStylizationOptions, 'fresnelEnabled').name('Global debug override').onChange(updateMaterialStylization)
fresnelFolder.addColor(toonStylizationOptions, 'fresnelColor').name('Color').onChange(updateMaterialStylization)
fresnelFolder.add(toonStylizationOptions, 'fresnelStrength', 0, 2, 0.01).name('Strength').onChange(updateMaterialStylization)
fresnelFolder.add(toonStylizationOptions, 'fresnelThreshold', 0, 1, 0.01).name('Threshold').onChange(updateMaterialStylization)
fresnelFolder.add(toonStylizationOptions, 'fresnelFeather', 0, 0.5, 0.01).name('Feather').onChange(updateMaterialStylization)

function getLoadedMeshes() {
    return scene.characters
        .map(x => x.character)
        .flatMap(x => x?.meshes.map(mesh => mesh.mesh) ?? [])
}

export function updateMaterialShadow() {
    getLoadedMeshes()
        .flatMap(mesh => getMeshGeneralMaterialUniforms(mesh))
        .forEach(uniforms => uniforms.loadGlobalOptions())
}

export function updateMaterialStylization() {
    getLoadedMeshes()
        .flatMap(mesh => getMeshToonStylizationUniforms(mesh))
        .forEach(uniforms => uniforms.loadGlobalOptions())
}

export function updateMaterialAngelRing() {
    getLoadedMeshes()
        .flatMap(mesh => getMeshAngelRingShaders(mesh))
        .forEach(shader => loadAngelRingOptions(shader))
}

/**
 * A stronger neutral inspection baseline. Official battle/ADV lighting remains
 * stage-profile driven, but the default can no longer flatten the Control-map
 * shadows, gradient specular and AngelRing into an evenly lit pastel surface.
 */
export function applyRecoveredBaseline() {
    resetOfficialShadowPreset()
    resetOfficialToonPreset()
    resetOfficialAngelRingPreset()

    Object.assign(guiOptions, {
        BgColor: '#30496f',
        AmbientLightColor: '#829ac2',
        DirectionalLightColor: '#ffe2d8',
        AmbientLight: 0.26,
        DirectionalLight: 4.25,
        LightAngle: -34,
        LightHeight: 4.6,
        LightDistance: 6.2,
        Brightness: 1.03,
        Contrast: 1.10,
        Saturation: 1.06,
        OutlineThickness: 0.0020,
        OutlineColor: '#554a67',
    })

    setBackgroundColor(guiOptions.BgColor)
    scene.ambientLight.color.set(guiOptions.AmbientLightColor)
    scene.ambientLight.intensity = guiOptions.AmbientLight
    scene.directionalLight.color.set(guiOptions.DirectionalLightColor)
    scene.directionalLight.intensity = guiOptions.DirectionalLight
    const lightPosition = deg2pos(guiOptions.LightAngle, guiOptions.LightDistance)
    scene.directionalLight.position.set(
        lightPosition.x,
        guiOptions.LightHeight,
        lightPosition.z,
    )
    scene.directionalLight.target.position.set(0, 1.30, 0)
    scene.directionalLight.target.updateMatrixWorld()

    recoveredHemisphereLight.color.set('#a8c7ff')
    recoveredHemisphereLight.groundColor.set('#403b55')
    recoveredHemisphereLight.intensity = 0.54
    recoveredFillLight.color.set('#7fa8ff')
    recoveredFillLight.intensity = 0.34
    recoveredFillLight.position.set(-4.0, 2.7, -3.4)
    recoveredFillLight.target.position.set(0, 1.25, 0)
    recoveredFillLight.target.updateMatrixWorld()

    scene.setColorFilter({
        brightness: guiOptions.Brightness,
        contrast: guiOptions.Contrast,
        saturation: guiOptions.Saturation,
    })
    scene.renderer.toneMapping = THREE.ACESFilmicToneMapping
    scene.renderer.toneMappingExposure = 1.08
    scene.effects.bloomPass.enabled = true
    scene.effects.bloomPass.strength = 0.12
    scene.effects.bloomPass.radius = 0.34
    scene.effects.bloomPass.threshold = 0.78

    scene.characters
        .map(entry => entry.character)
        .filter(character => Boolean(character))
        .forEach(character => {
            character!.userData.outlineMeshes.forEach(mesh => {
                const material = mesh.material as THREE.ShaderMaterial
                material.uniforms.uThickness.value = guiOptions.OutlineThickness
                material.uniforms.uColor.value = new THREE.Color(guiOptions.OutlineColor)
            })
        })

    updateMaterialShadow()
    updateMaterialStylization()
    updateMaterialAngelRing()
    gui.controllersRecursive().forEach(controller => controller.updateDisplay())
}

setTimeout(applyRecoveredBaseline, 0)
