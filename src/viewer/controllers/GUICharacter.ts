import * as THREE from 'three'
import type GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OutlineColor, OutlineThickness } from 'magia-exedra-character-three/shaders'
import MagiaExedraCharacter3D from 'magia-exedra-character-three/character';
import { scene } from '../scene';
import { gui, guiOptions, isGuiClosed } from './GUI';

export interface CharacterOptions extends CharacterOutlineOptions {
    X: number
    Y: number
    Z: number
    RotateX: number
    RotateY: number
    RotateZ: number
    Meshes?: CharacterMeshVisibilityOptions
}

export interface CharacterOutlineOptions {
    OutlineVisible: boolean,
    OutlineThickness: number,
    OutlineColor: string,
}

export type CharacterMeshVisibilityOptions = Record<string, boolean>

export interface CharacterGuiOptions extends CharacterOptions {
    Reset: () => any
}

export const guiCharacterSelectedFolderName = 'Character (Selected)'
export const guiCharacterSelected = gui.addFolder(guiCharacterSelectedFolderName).close()

const characterGlobalFolder = gui.addFolder('Characters (Global)')
characterGlobalFolder.add(guiOptions, 'OutlineVisible').onChange(() => updateCharacterOutline('OutlineVisible', guiOptions))
characterGlobalFolder.add(guiOptions, 'OutlineThickness', 0, 0.01).onChange(() => updateCharacterOutline('OutlineThickness', guiOptions))
characterGlobalFolder.addColor(guiOptions, 'OutlineColor').onChange(() => updateCharacterOutline('OutlineColor', guiOptions))

let currentCharacter: MagiaExedraCharacter3D | undefined = undefined
let currentCharacterOptions: CharacterGuiOptions | undefined = undefined
let outlineFolder: GUI | undefined = undefined
let meshesFolder: GUI | undefined = undefined

export function updateCharacterController(character: MagiaExedraCharacter3D | null) {
    // character not changed, update values & display
    if (character && currentCharacter == character) {
        currentCharacterOptions && Object.assign(currentCharacterOptions, getCharacterOptions(character))
        currentCharacterOptions?.Meshes && Object.assign(currentCharacterOptions.Meshes, getCharacterMeshVisibility(character))
        guiCharacterSelected.controllersRecursive().forEach(x => x.updateDisplay())
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
        Meshes: getCharacterMeshVisibility(character),
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

    const outlineFolderClosed: boolean = outlineFolder ? isGuiClosed(outlineFolder) : true
    outlineFolder = guiCharacterSelected.addFolder('Outline')
    if (outlineFolderClosed) {
        outlineFolder.close()
    }
    outlineFolder.add(characterOptions, 'OutlineVisible').onChange(() => updateCharacterOutline(character, characterOptions)).initialValue = true
    outlineFolder.add(characterOptions, 'OutlineThickness', 0, 0.01).onChange(() => updateCharacterOutline(character, characterOptions)).initialValue = OutlineThickness
    outlineFolder.addColor(characterOptions, 'OutlineColor').onChange(() => updateCharacterOutline(character, characterOptions))._initialValueHexString = OutlineColor

    const meshesFolderClosed: boolean = meshesFolder ? isGuiClosed(meshesFolder) : true
    meshesFolder = guiCharacterSelected.addFolder('Meshes')
    if (meshesFolderClosed) {
        meshesFolder.close()
    }
    for (const meshName in characterOptions.Meshes) {
        let controller = character.meshes.find(x => x.name == meshName)
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

/**
 * @param target
 * If `MagiaExedraCharacter3D`, apply the given `CharacterOutlineOptions` to the specified character.  
 * If `keyof CharacterOutlineOptions`, apply the specified property to all characters in the scene.  
 * If `null`, apply the given options to all characters in the scene.
 * 
 * @param source
 */
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

export function getCharacterMeshVisibility(character: MagiaExedraCharacter3D): CharacterMeshVisibilityOptions {
    const options: CharacterMeshVisibilityOptions = {}

    for (const controller of character.meshes) {
        options[controller.name] = controller.visible
    }

    return options
}

export function updateCharacterMeshVisibility(character: MagiaExedraCharacter3D, options: CharacterMeshVisibilityOptions) {
    for (const meshName in options) {
        let controller = character.meshes.find(x => x.name == meshName)
        if (controller) {
            controller.visible = options[meshName]
        }
    }
}

Object.assign(window, { guiCharacterSelected, getCharacterOutline, updateCharacterController })
