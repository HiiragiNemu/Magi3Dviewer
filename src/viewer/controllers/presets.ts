import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string"
import { getCharacterMeshVisibility, getCharacterOptions, getCurrentTheme, gui, guiCharacterSelectedFolderName, setTheme, updateCharacterMeshVisibility, updateCharacterOutline, updateCharacterPosition, type CharacterOptions, type Theme } from "."
import { scene } from "../scene"
import type { Vector3Like } from "three"
import { deselectCharacter, displayProgress, hideAllDemoItems } from "../"
import type MagiaExedraCharacter3D from "magia-exedra-character-three/character"

const dialogContainer = document.getElementById('preset-dialog-container') as HTMLDivElement
const dialogOverlay = document.getElementById('preset-dialog-overlay') as HTMLDivElement
const dialogTitle = document.getElementById('preset-dialog-title') as HTMLDivElement
const dialogTextarea = document.getElementById('preset-dialog-textarea') as HTMLTextAreaElement
const dialogBtnOk = document.getElementById('preset-dialog-button-ok') as HTMLButtonElement

interface ViewerPreset {
    characters: Array<{
        id: number
        animation?: string
        /** If exists, the character is paused at a timestamp */
        animationTime?: number
        options: CharacterOptions
    }>
    camera: {
        position: Vector3Like
        target: Vector3Like
    }
    theme: Theme
    gui: ReturnType<typeof gui.save>
}

export const presetPattern = '#preset='

/** @returns `true` if copied to clipboard, otherwise `false` */
export async function presetExport(): Promise<boolean> {
    const preset: ViewerPreset = {
        characters: scene.characters.map(x => x.character).filter(x => !!x).map(character => ({
            id: character.userData.characterId,
            animation: character.animation.current,
            animationTime: (character.animation.current && character.animation.paused) ? character.animation.time : undefined,
            options: {
                ...getCharacterOptions(character),
                Meshes: getCharacterMeshVisibility(character),
            },
        })),
        camera: {
            position: scene.camera.position,
            target: scene.controls.target,
        },
        theme: getCurrentTheme(),
        gui: gui.save(),
    }

    if ('folders' in preset.gui && preset.gui.folders instanceof Object && guiCharacterSelectedFolderName in preset.gui.folders) {
        delete preset.gui.folders[guiCharacterSelectedFolderName]
    }

    prettyPrintJSON(preset)

    const presetJson = JSON.stringify(preset)
    // console.log(presetJson, presetJson.length)
    const presetQueryParamUncompressed = encodeURIComponent(presetJson)
    // console.log(presetQueryParamUncompressed, presetQueryParamUncompressed.length)
    const presetQueryParam = compressToEncodedURIComponent(presetJson)
    // console.log(presetQueryParam, presetQueryParam.length)
    console.log('JSON:', presetJson.length, ' encodeURIComponent:', presetQueryParamUncompressed.length, ' Compressed:', presetQueryParam.length)

    const presetUrl = getHrefWithoutHash() + presetPattern + presetQueryParam
    try {
        await navigator.clipboard.writeText(presetUrl);
        return true
    } catch (e) {
        await showDialog('Please copy the preset:', presetUrl)
        return false
    }
}

let hasPendingClipboardPermissionApproval = false

export async function presetImport(presetUrl?: string | null, ask = false) {
    let preset
    if (!presetUrl) {
        try {
            if (hasPendingClipboardPermissionApproval) {
                // if the user holds on the permission request and clicks the button twice,
                // revert to manual input immediately
                throw new Error('A clipboard permission request is ongoing')
            }
            hasPendingClipboardPermissionApproval = true
            let clipboardUrl
            try {
                clipboardUrl = await navigator.clipboard.readText()
            } finally {
                hasPendingClipboardPermissionApproval = false
            }
            preset = parsePresetUrl(clipboardUrl)
        } catch (e) {
            console.log('Auto parse clipboard failed, asking user input')
            presetUrl = await showDialog('Enter preset:')
        }
    }

    if (!preset) {
        if (!presetUrl) {
            console.log('User did not enter any preset')
            return
        }
        preset = parsePresetUrl(presetUrl)
    }

    prettyPrintJSON(preset)

    const total = preset.characters.length
    if (ask) {
        if (!window.confirm(`Import preset with ${total} character(s)?`)) return
    }

    hideAllDemoItems()

    deselectCharacter()
    scene.characters.forEach(x => scene.removeCharacter(x))

    gui.load(preset.gui)
    setTheme(preset.theme)
    scene.camera.position.copy(preset.camera.position)
    scene.controls.target.copy(preset.camera.target)

    let completed = 0

    await Promise.all(preset.characters.map(characterPreset => new Promise<void>(async (resolve, _reject) => {
        let character: MagiaExedraCharacter3D | undefined

        await scene.addCharacter(characterPreset.id, {
            loadProgressCallback() {
                displayProgress(`Loading ${completed} / ${total} models...`)
            },
            loadFinishCallback() {
                if (character) {
                    updateCharacterOutline(character, characterPreset.options)
                    if (characterPreset.options.Meshes) {
                        updateCharacterMeshVisibility(character, characterPreset.options.Meshes)
                    }
                }
                resolve()
            },
        }).then(sceneCharacter => {
            if (!sceneCharacter.character) return
            character = sceneCharacter.character

            updateCharacterPosition(character, characterPreset.options)

            if (characterPreset.animation) {
                character.animation.play(characterPreset.animation, true)
                if (typeof characterPreset.animationTime == 'number') {
                    character.animation.paused = true
                    character.animation.time = characterPreset.animationTime
                }
            }

            completed++
        })
    })))

    displayProgress('')
}

export function parsePresetUrl(presetUrl: string): ViewerPreset {
    let presetQueryParam
    let hashIndex = presetUrl.indexOf(presetPattern)
    if (hashIndex >= 0) {
        presetQueryParam = presetUrl.slice(hashIndex + presetPattern.length)
    } else {
        presetQueryParam = presetUrl
    }

    const presetJson = decompressFromEncodedURIComponent(presetQueryParam)
    const preset: ViewerPreset | null | undefined = JSON.parse(presetJson)

    if (!preset) {
        throw new Error('Preset not valid')
    }
    return preset
}

export function getHrefWithoutHash() {
    return location.origin + location.pathname + location.search
}

export async function prettyPrintJSON(obj: object | string) {
    if (typeof obj == 'object') {
        console.log(JSON.stringify(obj, undefined, 2))
    } else {
        console.log(JSON.stringify(JSON.parse(obj), undefined, 2))
    }
}

async function showDialog(title: string, text?: string): Promise<string | undefined> {
    return new Promise(resolve => {
        dialogTitle.textContent = title
        dialogContainer.style.removeProperty('display')

        dialogTextarea.value = text || ''
        dialogTextarea.select()

        dialogBtnOk.onclick = () => {
            resolve(dialogTextarea.value)
            dialogContainer.style.display = 'none'
        }

        dialogOverlay.onclick = () => {
            resolve(undefined)
            dialogContainer.style.display = 'none'
        }
    })
}

Object.assign(window, { presetExport, presetImport, getHrefWithoutHash })
