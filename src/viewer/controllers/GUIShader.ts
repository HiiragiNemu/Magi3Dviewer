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
import { scene } from '../scene';
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

const angelRingFolder = guiShader.addFolder('AngelRing (Head-local Hair)').close()
angelRingFolder.add(angelRingOptions, 'enabled').name('Enabled').onChange(updateMaterialAngelRing)
angelRingFolder.addColor(angelRingOptions, 'color').name('Color').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'strength', 0, 2, 0.01).name('Strength').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'center', 0, 1, 0.005).name('Head-plane fine shift').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'width', 0.01, 0.5, 0.005).name('Band width scale').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'softness', 0.001, 0.3, 0.005).name('Edge softness scale').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'tilt', -1, 1, 0.01).name('Plane tilt').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'viewPower', 0.05, 4, 0.01).name('View response').onChange(updateMaterialAngelRing)
angelRingFolder.add(angelRingOptions, 'textureInfluence', 0, 1, 0.01).name('Official map influence').onChange(updateMaterialAngelRing)

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
 * Applies a neutral recovered baseline. Scene-specific ReDriveVolume, Timeline
 * Rim/Fresnel, reflection probe and background post-processing must be loaded
 * by the selected official stage profile rather than baked into this button.
 */
export function applyRecoveredBaseline() {
    resetOfficialShadowPreset()
    resetOfficialToonPreset()
    resetOfficialAngelRingPreset()

    Object.assign(guiOptions, {
        BgColor: '#5c92df',
        AmbientLightColor: '#9ebbe9',
        DirectionalLightColor: '#ffd8cf',
        AmbientLight: 1.4,
        DirectionalLight: 2.2,
        LightAngle: -38,
        LightHeight: 4.2,
        LightDistance: 8.0,
        Brightness: 1.0,
        Contrast: 1.0,
        Saturation: 1.0,
        OutlineThickness: 0.0022,
        OutlineColor: '#655c76',
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
    scene.setColorFilter({
        brightness: guiOptions.Brightness,
        contrast: guiOptions.Contrast,
        saturation: guiOptions.Saturation,
    })
    scene.renderer.toneMapping = THREE.ACESFilmicToneMapping
    scene.renderer.toneMappingExposure = 0.90
    scene.effects.bloomPass.enabled = true
    scene.effects.bloomPass.strength = 0.006
    scene.effects.bloomPass.radius = 0.06
    scene.effects.bloomPass.threshold = 0.92

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
