import * as THREE from 'three'
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { OutlineColor, OutlineThickness } from 'magia-exedra-character-three/shaders'
import MagiaExedraCharacter3D from 'magia-exedra-character-three/character';
import { scene, ViewerScene, deg2pos, viewerEl, type SceneComposerAntiAliasing } from './scene';

//
// Theme controller
//
export const themeSelector = document.getElementById('theme-selector') as HTMLFormElement
themeSelector.onsubmit = e => e.preventDefault()
themeSelector.onchange = e => e.target instanceof HTMLInputElement && setTheme(e.target.value);

export const themeDarkBgColor = '#444444'
export const themeLightBgColor = '#ffffff'

function setTheme(theme: string) {
    let newColor
    let shouldApplyNewColor = false

    if (theme == 'light') {
        document.body.classList.add('theme-light')
        newColor = themeLightBgColor
        shouldApplyNewColor = guiOptions.BgColor == themeDarkBgColor
    } else if (theme == 'dark') {
        document.body.classList.remove('theme-light')
        newColor = themeDarkBgColor
        shouldApplyNewColor = guiOptions.BgColor == themeLightBgColor
    } else return

    if (guiBgColor) {
        guiBgColor._initialValueHexString = newColor
        if (shouldApplyNewColor) guiBgColor.reset()
    }
}

//
// GUI controller
//
export interface CharacterOutlineOptions {
    OutlineVisible: boolean,
    OutlineThickness: number,
    OutlineColor: string,
}

export interface CharacterOptions extends CharacterOutlineOptions {
    X: number
    Y: number
    Z: number
    RotateX: number
    RotateY: number
    RotateZ: number
}

export const threeGuiContainer = document.getElementById('three-gui')!

export const gui = new GUI({ container: threeGuiContainer }).close()
export const guiOptions = {
    OutlineVisible: true,
    OutlineThickness: OutlineThickness,
    OutlineColor: OutlineColor,

    BgColor: themeDarkBgColor,
    AmbientLightColor: ViewerScene.ambientLightInitialColor,
    DirectionalLightColor: ViewerScene.directionalLightInitialColor,

    AmbientLight: ViewerScene.ambientLightInitialIntensity,
    DirectionalLight: ViewerScene.directionalLightInitialIntensity,

    LightAngle: ViewerScene.directionalLightInitialAngle,
    LightHeight: ViewerScene.directionalLightInitialHeight,
    LightDistance: ViewerScene.directionalLightInitialDistance,

    FOV: ViewerScene.cameraInitialFov,
    Axes: false,
    UseEffectComposer: scene.composerEnabled,
    AntiAliasing: 'None' satisfies SceneComposerAntiAliasing as SceneComposerAntiAliasing,
    AntiAliasingLevel: 2,

    Reset: () => {
        gui.reset()
        scene.resetCameraControl()
    }
}

export const guiCharacterSelected = gui.addFolder('Character (Selected)')

const characterGlobalFolder = gui.addFolder('Characters (Global)')
characterGlobalFolder.add(guiOptions, 'OutlineVisible').onChange(() => updateCharacterOutline('OutlineVisible', guiOptions))
characterGlobalFolder.add(guiOptions, 'OutlineThickness', 0, 0.01).onChange(() => updateCharacterOutline('OutlineThickness', guiOptions))
characterGlobalFolder.addColor(guiOptions, 'OutlineColor').onChange(() => updateCharacterOutline('OutlineColor', guiOptions))

const lightingFolder = gui.addFolder('Lighting')
const guiBgColor = lightingFolder.addColor(guiOptions, 'BgColor').onChange(value => {
    viewerEl.style.backgroundColor = value
    const color = new THREE.Color(value)
    // W3C Luminance Formula
    const luminance = (0.299 * color.r) + (0.587 * color.g) + (0.114 * color.b);
    scene.outlinePass.visibleEdgeColor = luminance > 0.5 ? ViewerScene.outlineColorDark : ViewerScene.outlineColorLight
})
lightingFolder.addColor(guiOptions, 'AmbientLightColor').onChange(value => scene.ambientLight.color = new THREE.Color(value))
lightingFolder.addColor(guiOptions, 'DirectionalLightColor').onChange(value => scene.directionalLight.color = new THREE.Color(value))
lightingFolder.add(guiOptions, 'AmbientLight', 0, 5).onChange(value => scene.ambientLight.intensity = value)
lightingFolder.add(guiOptions, 'DirectionalLight', 0, 5).onChange(value => scene.directionalLight.intensity = value)
lightingFolder.add(guiOptions, 'LightAngle', -180, 180).onChange(updateSceneDirectionalLight)
lightingFolder.add(guiOptions, 'LightHeight', -5, 5).onChange(updateSceneDirectionalLight)
lightingFolder.add(guiOptions, 'LightDistance', 0, 10).onChange(updateSceneDirectionalLight)

function updateSceneDirectionalLight() {
    const { x, z } = deg2pos(guiOptions.LightAngle, guiOptions.LightDistance)
    scene.directionalLight.position.set(x, guiOptions.LightHeight, z)
}

const miscFolder = gui.addFolder('Misc').close()
miscFolder.add(guiOptions, 'FOV', 5, 60).onChange(value => { scene.camera.fov = value; scene.camera.updateProjectionMatrix() })
miscFolder.add(guiOptions, 'Axes').onChange(value => scene.axesHelper.visible = value)
miscFolder.add(guiOptions, 'UseEffectComposer', ['Auto', 'Always', 'Never']).onChange(value => { scene.composerEnabled = value; updateAntiAliasingGUI() }).domElement.title =
    `Auto: Use effect composer only when needed to render selection outlines.
Always: Always use effect composer for rendering, disable direct rendering.
Never: Disable effect composer, always use direct rendering (This will cause selection outlines not visible).

Force enabling the effect composer with high levels of antialiasing can produce greater image quality, at the cost of degraded performance.`;
const guiAntiAliasing = miscFolder.add(guiOptions, 'AntiAliasing', ['None', 'MSAA', 'TAA', 'SSAA', 'SMAA', 'FXAA']).name('AntiAliasing(Composer)').onChange(updateAntiAliasing)
guiAntiAliasing.domElement.title = `Anti-aliasing method used for the effect composer.
This option does not affect direct rendering that always uses default MSAA.`;
const guiAntiAliasingLevel = miscFolder.add(guiOptions, 'AntiAliasingLevel', 0, 8, 1).onChange(updateAntiAliasing).hide()

gui.add(guiOptions, 'Reset')

function updateAntiAliasingGUI() {
    if (guiOptions.UseEffectComposer != 'Never') {
        guiAntiAliasing.show()
    } else {
        guiAntiAliasing.hide()
    }

    if (guiOptions.UseEffectComposer != 'Never' && (
        guiOptions.AntiAliasing == 'MSAA' ||
        guiOptions.AntiAliasing == 'TAA' ||
        guiOptions.AntiAliasing == 'SSAA'
    )) {
        guiAntiAliasingLevel.show()
    } else {
        guiAntiAliasingLevel.hide()
    }
}

function updateAntiAliasing() {
    updateAntiAliasingGUI()
    scene.setAntiAliasing(guiOptions.AntiAliasing, guiOptions.AntiAliasingLevel)
}

export function updateCharacterController(character: MagiaExedraCharacter3D | null) {
    for (let i = 0; i < 2; i++) { // run for N times to clear N folders
        guiCharacterSelected.controllersRecursive().forEach(x => x.destroy())
        guiCharacterSelected.children.forEach(x => x.destroy())
    }

    if (!character) return

    let characterOptions: CharacterOptions = {
        X: character.object.position.x,
        Y: character.object.position.y,
        Z: character.object.position.z,
        RotateX: character.object.rotation.x,
        RotateY: character.object.rotation.y,
        RotateZ: character.object.rotation.z,
        ...(getCharacterOutline(character) || {
            OutlineVisible: true,
            OutlineThickness: OutlineThickness,
            OutlineColor: OutlineColor,
        }),
    }
    guiCharacterSelected.add(characterOptions, 'X', -2, 2).onChange(value => character.object.position.x = value).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'Y', -2, 2).onChange(value => character.object.position.y = value).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'Z', -2, 2).onChange(value => character.object.position.z = value).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'RotateX', -180, 180).onChange(value => character.object.rotation.x = THREE.MathUtils.degToRad(value)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'RotateY', -180, 180).onChange(value => character.object.rotation.y = THREE.MathUtils.degToRad(value)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'RotateZ', -180, 180).onChange(value => character.object.rotation.z = THREE.MathUtils.degToRad(value)).initialValue = 0

    const outlineFolder = guiCharacterSelected.addFolder('Outline').close()
    outlineFolder.add(characterOptions, 'OutlineVisible').onChange(() => updateCharacterOutline(character, characterOptions)).initialValue = true
    outlineFolder.add(characterOptions, 'OutlineThickness', 0, 0.01).onChange(() => updateCharacterOutline(character, characterOptions)).initialValue = OutlineThickness
    outlineFolder.addColor(characterOptions, 'OutlineColor').onChange(() => updateCharacterOutline(character, characterOptions))._initialValueHexString = OutlineColor

    const meshesFolder = guiCharacterSelected.addFolder('Meshes').close()
    const meshesOptions: Record<string, boolean> = {}
    for (const mesh of character.userData.meshes) {
        function getMaterials() {
            return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        }
        meshesOptions[mesh.name] = getMaterials().every(x => x.visible)
        meshesFolder.add(meshesOptions, mesh.name).onChange(value => {
            getMaterials().forEach(x => x.visible = value)
        }).initialValue = true
    }
}

export function getCharacterOutline(character: MagiaExedraCharacter3D): CharacterOutlineOptions | undefined {
    const mesh = character.userData.outlineMeshes.find(() => true)
    if (!mesh) return
    const material = mesh.material as THREE.ShaderMaterial
    return {
        OutlineVisible: mesh.visible,
        OutlineThickness: material.uniforms.uThickness.value,
        OutlineColor: '#' + (material.uniforms.uColor.value as THREE.Color).getHexString()
    }
}

export function updateCharacterOutline(target: MagiaExedraCharacter3D | keyof CharacterOutlineOptions | null, source: CharacterOutlineOptions) {
    const characters = target instanceof MagiaExedraCharacter3D
        ? [target]
        : scene.characters.map(x => x.character).filter(x => !!x);

    for (const character of characters) {
        for (const mesh of character.userData.outlineMeshes) {
            const material = mesh.material as THREE.ShaderMaterial
            if (typeof target != 'string' || target == 'OutlineVisible') {
                mesh.visible = source.OutlineVisible
            }
            if (typeof target != 'string' || target == 'OutlineThickness') {
                material.uniforms.uThickness.value = source.OutlineThickness
            }
            if (typeof target != 'string' || target == 'OutlineColor') {
                material.uniforms.uColor.value = new THREE.Color(source.OutlineColor)
            }
        }
    }
}

Object.assign(window, { setTheme, gui, guiOptions, guiCharacterSelected, getCharacterOutline, updateCharacterController })
