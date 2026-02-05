import * as THREE from 'three'
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { OutlineColor, OutlineThickness } from 'magia-exedra-character-three/shaders'
import MagiaExedraCharacter3D from 'magia-exedra-character-three/character';
import { scene, ViewerScene, deg2pos, viewerEl, type SceneComposerAntiAliasing } from './scene';
import { getMeshDefaultVisibility } from 'magia-exedra-character-three/loader';
import { presetExport, presetImport } from './presets';

//
// Theme controller
//
export const themeLightBtn = document.getElementById('theme-set-light') as HTMLButtonElement
export const themeDarkBtn = document.getElementById('theme-set-dark') as HTMLButtonElement
themeLightBtn.onclick = () => setTheme('light')
themeDarkBtn.onclick = () => setTheme('dark')

export const themeDarkBgColor = '#444444'
export const themeLightBgColor = '#ffffff'

export type Theme = 'light' | 'dark'
export const themeLightClassName = 'theme-light'

export function setTheme(theme: Theme) {
    let newColor
    let shouldApplyNewColor = false

    if (theme == 'light') {
        document.body.classList.add(themeLightClassName)
        newColor = themeLightBgColor
        shouldApplyNewColor = guiOptions.BgColor == themeDarkBgColor
    } else if (theme == 'dark') {
        document.body.classList.remove(themeLightClassName)
        newColor = themeDarkBgColor
        shouldApplyNewColor = guiOptions.BgColor == themeLightBgColor
    } else return

    if (guiBgColor) {
        guiBgColor._initialValueHexString = newColor
        if (shouldApplyNewColor) guiBgColor.reset()
    }
}

export function getCurrentTheme(): Theme {
    return document.body.classList.contains(themeLightClassName) ? 'light' : 'dark'
}

//
// GUI controller
//
export interface CharacterOptions extends CharacterOutlineOptions {
    X: number
    Y: number
    Z: number
    RotateX: number
    RotateY: number
    RotateZ: number
}

export interface CharacterOutlineOptions {
    OutlineVisible: boolean,
    OutlineThickness: number,
    OutlineColor: string,
}

export interface CharacterGuiOptions extends CharacterOptions {
    Reset: () => any
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

    async Export() {
        if (await presetExport()) {
            const el = guiExport.domElement.getElementsByClassName('name')[0]
            const oldText = el.textContent
            el.textContent = 'Copied to clipbaord!'
            guiExport.disable()
            setTimeout(() => {
                el.textContent = oldText
                guiExport.enable()
            }, 1500);
        }
    },
    async Import() {
        try {
            await presetImport(undefined, true)
        } catch (e) {
            if (e instanceof Error) window.alert(e.message)
        }
    },
    Reset() {
        gui.reset()
        scene.resetCameraControl()
    },
}

export const guiCharacterSelectedFolderName = 'Character (Selected)'
export const guiCharacterSelected = gui.addFolder(guiCharacterSelectedFolderName).close()

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

const guiExport = gui.add(guiOptions, 'Export').name('Export presets')
gui.add(guiOptions, 'Import').name('Import presets')
gui.add(guiOptions, 'Reset').name('Reset everything')

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

//
// Selected character controller
//
let currentCharacter: MagiaExedraCharacter3D | undefined = undefined
let currentCharacterOptions: CharacterGuiOptions | undefined = undefined

export function updateCharacterController(character: MagiaExedraCharacter3D | null) {
    // character not changed, update values & display
    if (character && currentCharacterOptions && currentCharacter == character) {
        Object.assign(currentCharacterOptions, getCharacterOptions(character))
        guiCharacterSelected.controllers.forEach(x => x.updateDisplay())
        return
    }

    // character changed, destroy all old controllers
    for (let i = 0; i < 2; i++) { // run for N times to clear N folders
        guiCharacterSelected.controllersRecursive().forEach(x => x.destroy())
        guiCharacterSelected.children.forEach(x => x.destroy())
    }

    if (!character) {
        currentCharacter = undefined
        currentCharacterOptions = undefined
        return
    }
    currentCharacter = character

    let characterOptions: CharacterGuiOptions = {
        ...getCharacterOptions(character),
        Reset() {
            guiCharacterSelected.reset()
        },
    }
    currentCharacterOptions = characterOptions

    guiCharacterSelected.add(characterOptions, 'X', -2, 2).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'Y', -2, 2).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'Z', -2, 2).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'RotateX', -180, 180).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'RotateY', -180, 180).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'RotateZ', -180, 180).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 0

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
        }).initialValue = getMeshDefaultVisibility(mesh.name)
    }

    guiCharacterSelected.add(characterOptions, 'Reset').name('Reset character')
}

export function getCharacterOptions(character: MagiaExedraCharacter3D): CharacterOptions {
    return {
        X: character.object.position.x,
        Y: character.object.position.y,
        Z: character.object.position.z,
        RotateX: THREE.MathUtils.radToDeg(character.object.rotation.x),
        RotateY: THREE.MathUtils.radToDeg(character.object.rotation.y),
        RotateZ: THREE.MathUtils.radToDeg(character.object.rotation.z),
        ...(getCharacterOutline(character) || {
            OutlineVisible: true,
            OutlineThickness: OutlineThickness,
            OutlineColor: OutlineColor,
        }),
    }
}

export function updateCharacterPosition(character: MagiaExedraCharacter3D, options: CharacterOptions) {
    character.object.position.x = options.X
    character.object.position.y = options.Y
    character.object.position.z = options.Z
    character.object.rotation.x = THREE.MathUtils.degToRad(options.RotateX)
    character.object.rotation.y = THREE.MathUtils.degToRad(options.RotateY)
    character.object.rotation.z = THREE.MathUtils.degToRad(options.RotateZ)
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

Object.assign(window, { setTheme, getCurrentTheme, gui, guiOptions, guiCharacterSelected, getCharacterOutline, updateCharacterController })
