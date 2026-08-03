import * as THREE from 'three'
import type GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OutlineColor, OutlineThickness } from 'magia-exedra-character-three/shaders'
import MagiaExedraCharacter3D, { CharacterMeshController } from 'magia-exedra-character-three/character';
import { scene } from '../scene';
import { gui, guiOptions, isGuiClosed } from './GUI';

export interface CharacterOptions extends CharacterOutlineOptions {
    X: number
    Y: number
    Z: number
    RotateX: number
    RotateY: number
    RotateZ: number
    Scale: number
    AnimationSpeed: number
    Meshes?: CharacterMeshVisibilityOptions
}

export interface CharacterOutlineOptions {
    OutlineVisible: boolean,
    OutlineThickness: number,
    OutlineColor: string,
    OutlineAlwaysVisible: boolean,
}

export type CharacterMeshVisibilityOptions = Record<string, boolean>

export interface CharacterGuiOptions extends CharacterOptions {
    Reset: () => any
}

export const guiCharacterSelectedFolderName = 'Character (Selected)'
export const guiCharacterSelected = gui.addFolder(guiCharacterSelectedFolderName).close()

const characterGlobalFolder = gui.addFolder('Characters (Global)').close()
characterGlobalFolder.add(guiOptions, 'OutlineVisible').onChange(() => updateCharacterOutline('OutlineVisible', guiOptions))
characterGlobalFolder.add(guiOptions, 'OutlineThickness', 0, 0.01).onChange(() => updateCharacterOutline('OutlineThickness', guiOptions))
characterGlobalFolder.addColor(guiOptions, 'OutlineColor').onChange(() => updateCharacterOutline('OutlineColor', guiOptions))
characterGlobalFolder.add(guiOptions, 'OutlineAlwaysVisible').onChange(() => updateCharacterOutline('OutlineAlwaysVisible', guiOptions)).domElement.title = '即使网格部件被隐藏也显示其描边'

const characterArrangementActions = {
    ArrangeLine: () => arrangeCharacters('line'),
    ArrangeArc: () => arrangeCharacters('arc'),
    CenterAll: () => arrangeCharacters('center'),
}
characterGlobalFolder.add(characterArrangementActions, 'ArrangeLine').name('Arrange in line')
characterGlobalFolder.add(characterArrangementActions, 'ArrangeArc').name('Arrange in arc')
characterGlobalFolder.add(characterArrangementActions, 'CenterAll').name('Center all')

let currentCharacter: MagiaExedraCharacter3D | undefined = undefined
let currentCharacterOptions: CharacterGuiOptions | undefined = undefined
let outlineFolder: GUI | undefined = undefined
let meshesFolder: GUI | undefined = undefined

export function updateCharacterController(character: MagiaExedraCharacter3D | null) {
    if (character && currentCharacter == character) {
        currentCharacterOptions && Object.assign(currentCharacterOptions, getCharacterOptions(character))
        currentCharacterOptions?.Meshes && Object.assign(currentCharacterOptions.Meshes, getCharacterMeshVisibility(character))
        guiCharacterSelected.controllersRecursive().forEach(x => x.updateDisplay())
        return
    }

    for (let i = 0; i < 2; i++) {
        guiCharacterSelected.controllersRecursive().forEach(x => x.destroy())
        guiCharacterSelected.children.forEach(x => x.destroy())
    }

    if (!character) {
        currentCharacter = undefined
        currentCharacterOptions = undefined
        return
    }
    currentCharacter = character

    const characterOptions: CharacterGuiOptions = {
        ...getCharacterOptions(character),
        Meshes: getCharacterMeshVisibility(character),
        Reset() {
            guiCharacterSelected.reset()
        },
    }
    currentCharacterOptions = characterOptions

    guiCharacterSelected.add(characterOptions, 'X', -10, 10, 0.01).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'Y', -5, 5, 0.01).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'Z', -10, 10, 0.01).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'RotateX', -180, 180, 0.1).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'RotateY', -180, 180, 0.1).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'RotateZ', -180, 180, 0.1).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 0
    guiCharacterSelected.add(characterOptions, 'Scale', 0.1, 3, 0.01).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 1
    guiCharacterSelected.add(characterOptions, 'AnimationSpeed', 0, 3, 0.01).onChange(() => updateCharacterPosition(character, characterOptions)).initialValue = 1

    const outlineFolderClosed: boolean = outlineFolder ? isGuiClosed(outlineFolder) : true
    outlineFolder = guiCharacterSelected.addFolder('Outline')
    if (outlineFolderClosed) outlineFolder.close()
    outlineFolder.add(characterOptions, 'OutlineVisible').onChange(() => updateCharacterOutline(character, characterOptions)).initialValue = true
    outlineFolder.add(characterOptions, 'OutlineThickness', 0, 0.01).onChange(() => updateCharacterOutline(character, characterOptions)).initialValue = OutlineThickness
    outlineFolder.addColor(characterOptions, 'OutlineColor').onChange(() => updateCharacterOutline(character, characterOptions))._initialValueHexString = OutlineColor
    outlineFolder.add(characterOptions, 'OutlineAlwaysVisible').onChange(() => updateCharacterOutline(character, characterOptions)).initialValue = CharacterMeshController.OutlineAlwaysVisible

    const meshesFolderClosed: boolean = meshesFolder ? isGuiClosed(meshesFolder) : false
    meshesFolder = guiCharacterSelected.addFolder('Meshes')
    if (meshesFolderClosed) meshesFolder.close()
    for (const meshName in characterOptions.Meshes) {
        const controller = character.meshes.find(x => x.name == meshName)
        if (controller) {
            meshesFolder.add(characterOptions.Meshes, meshName).onChange(value => controller.visible = value).initialValue = controller.defaultVisibility
        }
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
        Scale: character.object.scale.x,
        AnimationSpeed: character.animation.mixer.timeScale,
        ...(getCharacterOutline(character) || {
            OutlineVisible: true,
            OutlineThickness: OutlineThickness,
            OutlineColor: OutlineColor,
            OutlineAlwaysVisible: CharacterMeshController.OutlineAlwaysVisible,
        }),
    }
}

export function updateCharacterPosition(character: MagiaExedraCharacter3D, options: CharacterOptions) {
    character.object.position.set(options.X, options.Y, options.Z)
    character.object.rotation.set(
        THREE.MathUtils.degToRad(options.RotateX),
        THREE.MathUtils.degToRad(options.RotateY),
        THREE.MathUtils.degToRad(options.RotateZ),
    )
    character.object.scale.setScalar(options.Scale ?? 1)
    character.animation.mixer.timeScale = options.AnimationSpeed ?? 1
}

export function arrangeCharacters(mode: 'line' | 'arc' | 'center') {
    const characters = scene.characters
        .map(x => x.character)
        .filter((x): x is MagiaExedraCharacter3D => Boolean(x))
    const count = characters.length
    if (count === 0) return

    characters.forEach((character, index) => {
        const centeredIndex = index - (count - 1) / 2
        if (mode === 'line') {
            character.object.position.set(centeredIndex * 0.82, 0, 0)
            character.object.rotation.y = 0
        } else if (mode === 'arc') {
            const angle = centeredIndex * Math.min(18, 80 / Math.max(count - 1, 1))
            const radians = THREE.MathUtils.degToRad(angle)
            const radius = Math.max(3.4, count * 0.55)
            character.object.position.set(
                Math.sin(radians) * radius,
                0,
                Math.cos(radians) * radius - radius,
            )
            character.object.rotation.y = -radians
        } else {
            character.object.position.set(0, 0, 0)
            character.object.rotation.y = 0
        }
    })

    if (scene.characterSelected?.character) {
        updateCharacterController(scene.characterSelected.character)
    }
}

export function getCharacterOutline(character: MagiaExedraCharacter3D): CharacterOutlineOptions | undefined {
    const mesh = character.userData.outlineMeshes.find(() => true)
    if (!mesh) return
    const material = mesh.material as THREE.ShaderMaterial
    return {
        OutlineVisible: mesh.visible,
        OutlineThickness: material.uniforms.uThickness.value,
        OutlineColor: '#' + (material.uniforms.uColor.value as THREE.Color).getHexString(),
        OutlineAlwaysVisible: character.meshes.some(x => x.outlineAlwaysVisible == true)
    }
}

export function updateCharacterOutline(target: MagiaExedraCharacter3D | keyof CharacterOutlineOptions | null, source: CharacterOutlineOptions) {
    const characters = target instanceof MagiaExedraCharacter3D
        ? [target]
        : scene.characters.map(x => x.character).filter(x => !!x);

    for (const character of characters) {
        for (const mesh of character.userData.outlineMeshes) {
            const material = mesh.material as THREE.ShaderMaterial
            if (typeof target != 'string' || target == 'OutlineVisible') mesh.visible = source.OutlineVisible
            if (typeof target != 'string' || target == 'OutlineThickness') material.uniforms.uThickness.value = source.OutlineThickness
            if (typeof target != 'string' || target == 'OutlineColor') material.uniforms.uColor.value = new THREE.Color(source.OutlineColor)
        }

        for (const mesh of character.meshes) {
            if (typeof target != 'string' || target == 'OutlineAlwaysVisible') mesh.outlineAlwaysVisible = source.OutlineAlwaysVisible
        }
    }
}

export function getCharacterMeshVisibility(character: MagiaExedraCharacter3D): CharacterMeshVisibilityOptions {
    const options: CharacterMeshVisibilityOptions = {}
    for (const controller of character.meshes) options[controller.name] = controller.visible
    return options
}

export function updateCharacterMeshVisibility(character: MagiaExedraCharacter3D, options: CharacterMeshVisibilityOptions) {
    for (const meshName in options) {
        const controller = character.meshes.find(x => x.name == meshName)
        if (controller) controller.visible = options[meshName]
    }
}

Object.assign(window, { guiCharacterSelected, getCharacterOutline, updateCharacterController, arrangeCharacters })
