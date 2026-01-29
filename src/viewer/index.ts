import * as THREE from 'three'
import Stats from 'three/addons/libs/stats.module.js';
import { scene, viewerEl, type SceneCharacter } from './scene';
import { initSelector } from './UIControls'
import { characters } from './character';
import { guiOptions, updateCharacterController, updateCharacterOutline } from './controller';
import type MagiaExedraCharacter3D from 'magia-exedra-character-three/character';
import { ARButton } from 'three/examples/jsm/Addons.js';

const menuEl = document.getElementById('menu')!

const characterSelector = document.getElementById('character-selector') as HTMLSelectElement
const characterAddCrossBtn = document.getElementById('character-add-cross-btn') as HTMLButtonElement
const characterAddSelector = document.getElementById('character-add-selector') as HTMLSelectElement
const animationSelector = document.getElementById('animation-selector') as HTMLSelectElement
const animationPlayBtn = document.getElementById('animation-play') as HTMLButtonElement
const animationLoopBtn = document.getElementById('animation-loop') as HTMLButtonElement
const animationStopBtn = document.getElementById('animation-stop') as HTMLButtonElement
const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement
const loadProgressEl = document.getElementById('load-progress')!
const demoEls = document.getElementsByClassName('demo')

characterAddCrossBtn.onclick = removeSelectedCharacter
animationPlayBtn.onclick = () => scene.characterSelected?.character?.playAnimation(animationSelector.value)
animationLoopBtn.onclick = () => scene.characterSelected?.character?.playAnimation(animationSelector.value, true)
animationStopBtn.onclick = () => scene.characterSelected?.character?.mixer?.stopAllAction()
fullscreenBtn.onclick = () => document.documentElement.requestFullscreen().then(() => (screen.orientation as any).lock('landscape').catch(() => undefined))

const characterIdList = characters.getCharacterIdList()
const characterSelectDict = characterIdList.reduce((obj, id) => {
    obj[`${id} - ${characters.getCharacterNameById(id)}`] = id
    return obj
}, {} as Record<string, string>)

const stats = new Stats()

export function setupViewer() {
    initSelector(
        characterSelector,
        characterSelectDict,
        changeCharacter
    );

    setupCharacterAddSelector()
    setupViewerInputHandler()

    scene.animateLoopCallback = animateLoop

    tryChangeCharacterByHash() || changeCharacter(100107)

    stats.dom.style.removeProperty('top')
    stats.dom.style.removeProperty('left')
    stats.dom.style.right = '0'
    stats.dom.style.bottom = '0'
    stats.dom.style.pointerEvents = 'initial'
    stats.dom.style.zIndex = '-1'
    menuEl.appendChild(stats.dom)

    const arButton = ARButton.createButton(scene.renderer, {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: menuEl }
    })
    arButton.style.removeProperty('z-index')
    arButton.style.bottom = '101%'
    viewerEl.appendChild(arButton)
}

function setupCharacterAddSelector() {
    initSelector(characterAddSelector, { '': '', ...characterSelectDict });
    characterAddSelector.value = ''

    characterAddSelector.addEventListener('focus', () => {
        characterAddSelector.value = ''
    })
    characterAddSelector.addEventListener('click', () => {
        characterAddSelector.value = ''
    })
    characterAddSelector.addEventListener('change', () => {
        if (characterAddSelector.value != '') {
            addOrChangeCharacter(characterAddSelector.value)
            characterAddSelector.value = ''
        }
    })
}

function setupViewerInputHandler() {
    scene.renderer.domElement.addEventListener('click', mouseClickHandler)
    scene.renderer.domElement.addEventListener('mousedown', mouseDownHandler)
    scene.renderer.domElement.addEventListener('mousemove', mouseMoveHandler)

    let mouseMoveX = 0
    let mouseMoveY = 0

    function mouseClickHandler(e: PointerEvent | MouseEvent) {
        if (Math.abs(mouseMoveX) > 3 || Math.abs(mouseMoveY) > 3) return
        selectCharacterByMouse(e)
    }

    function mouseDownHandler(_e: MouseEvent) {
        mouseMoveX = 0
        mouseMoveY = 0
    }

    function mouseMoveHandler(e: MouseEvent) {
        if (e.buttons == 1) {
            mouseMoveX += e.movementX
            mouseMoveY += e.movementY
        }
    }

    function selectCharacterByMouse(e: PointerEvent | MouseEvent) {
        const character = scene.getIntersectedCharacter(e.offsetX, e.offsetY)
        if (character) {
            if (character != scene.characterSelected) {
                selectCharacter(character)
            }
        } else if (scene.characters.length > 1 && scene.characterSelected) {
            deselectCharacter()
        }
    }
}

function animateLoop() {
    stats.update()
}

function tryChangeCharacterByHash(): boolean {
    let id = location.hash.replace('#', '')
    if (id === '') id = '100107'
    if (!characterIdList.includes(id)) return false
    changeCharacter(id)
    return true
}

function changeCharacter(id: number | string) {
    if (typeof id == 'number') id = id.toString()

    characterSelector.value = id
    updateCharacterController(null)

    addOrChangeCharacter(id, scene.characterSelected)
}

function removeSelectedCharacter() {
    if (scene.characterSelected) {
        scene.removeCharacter(scene.characterSelected)
        deselectCharacter()
    }
}

function addOrChangeCharacter(id: number | string, sceneCharacter?: SceneCharacter) {
    let loadedCharacter: MagiaExedraCharacter3D | undefined = undefined

    let oldTransform = undefined
    if (sceneCharacter?.character?.object) {
        oldTransform = {
            position: sceneCharacter.character.object.position,
            rotation: sceneCharacter.character.object.rotation,
        }
    }

    scene.switchCharacter(
        sceneCharacter,
        id,
        {
            loadProgressCallback: progress => {
                if (progress) {
                    loadProgressEl.style.removeProperty('display')
                    loadProgressEl.textContent = progress
                } else {
                    loadProgressEl.style.display = 'none'
                }
            },
            loadFinishCallback: () => loadedCharacter && updateCharacterOutline(loadedCharacter, guiOptions) // WARN: In some racing cases, a stale character may callback this function, but it won't cause any issues for now
        }
    ).then((sceneCharacter) => {
        [...demoEls].forEach(x => x instanceof HTMLElement && (x.style.display = 'none'))

        const character = sceneCharacter.character!
        loadedCharacter = character;

        if (oldTransform) {
            character.object.position.copy(oldTransform.position)
            character.object.rotation.copy(oldTransform.rotation)
        } else {
            character.object.position.copy(calculateNewCharacterPosition(sceneCharacter))
        }

        character.mixer.addEventListener('finished', () => character.playAnimation())
        character.playAnimation()

        selectCharacter(sceneCharacter)
    })
}

function selectCharacter(sceneCharacter: SceneCharacter) {
    scene.characterSelected = sceneCharacter

    const character = sceneCharacter.character
    if (!character) return

    characterSelector.value = character.userData.characterId.toString()

    initSelector(
        animationSelector,
        character.animations.reduce((obj, name) => {
            obj[name] = name
            return obj
        }, {} as Record<string, string>),
        value => value && character.playAnimation(value)
    );

    if (character.lastPlayedAnimations) {
        const playing = character.lastPlayedAnimations
        animationSelector.value = character.animations.find(x => playing.includes(x))!
    }

    updateCharacterController(character)
    document.body.classList.remove('no-target')
}

function deselectCharacter() {
    scene.characterSelected = undefined
    updateCharacterController(null)
    document.body.classList.add('no-target')
}

/** Find available positions for a new character, 0.667 (2/3) meters per one */
function calculateNewCharacterPosition(newCharacter: SceneCharacter): THREE.Vector3 {
    const spacing = 2 / 3;
    const existingPositions = scene.characters.filter(x => x != newCharacter).map(x => x.character?.object.position).filter(x => !!x)
    const occupiedX = existingPositions.map(p => Math.round(p.x / spacing));

    let n = 0;
    while (true) {
        if (!occupiedX.includes(n)) return new THREE.Vector3(n * spacing, 0, 0);
        if (!occupiedX.includes(-n)) return new THREE.Vector3(-n * spacing, 0, 0);
        n++;
        if (n > 100) break;
    }
    return new THREE.Vector3(0, 0, 0);
}

Object.assign(window, { changeCharacter })
