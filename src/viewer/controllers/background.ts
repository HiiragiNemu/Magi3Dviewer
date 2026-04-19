import * as THREE from 'three'
import { scene } from '../scene';
import { SceneEffectsController } from 'magia-exedra-character-three/scene/effects';

export const backgroundListEl = document.getElementById('background-list') as HTMLDivElement
export const backgroundClearEl = document.getElementById('background-clear') as HTMLButtonElement
export const backgroundChooseFileEl = document.getElementById('background-choose-file') as HTMLButtonElement

backgroundClearEl.onclick = clearBackgroundImage
backgroundChooseFileEl.onclick = chooseBackgroundFile

export async function setupBackgroundImageSelector() {
    // for (let index = 0; index < 20; index++) {
    //     addBackgroundImage('')
    // }
}

function addBackgroundImage(url: string, position: 'start' | 'end' = 'end') {
    const btn = document.createElement('button')
    const img = document.createElement('img')
    btn.appendChild(img)

    img.loading = 'lazy'
    img.src = url

    btn.onclick = () => {
        setBackgroundImage(url)
    }

    if (position == 'end') {
        backgroundListEl.appendChild(btn)
    } else if (position == 'start') {
        backgroundClearEl.after(btn)
    }
}

function chooseBackgroundFile() {
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = 'image/*'
    fileInput.multiple = true

    fileInput.click()

    fileInput.onchange = () => {
        if (!fileInput.files) return

        [...fileInput.files].forEach(f => {
            const url = URL.createObjectURL(f)
            addBackgroundImage(url, 'start')
        })
    }
}

function setBackgroundImage(url: string) {
    document.body.style.backgroundImage = `url(${url})`
}

function clearBackgroundImage() {
    document.body.style.removeProperty('background-image')
}

export function setBackgroundColor(value: string) {
    document.body.style.backgroundColor = value
    const color = new THREE.Color(value)
    const luminance = rgb2luminance(color.r, color.g, color.b);
    scene.effects.outlinePass.visibleEdgeColor = luminance > 0.5 ? SceneEffectsController.outlineColorDark : SceneEffectsController.outlineColorLight
}

/** W3C Luminance Formula */
export function rgb2luminance(r: number, g: number, b: number) {
    return 0.299 * r + 0.587 * g + 0.114 * b
}
