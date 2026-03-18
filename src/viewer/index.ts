import * as THREE from 'three'
import Stats from 'three/addons/libs/stats.module.js';
import { scene } from './scene';
import { type SceneCharacter } from 'magia-exedra-character-three/scene'
import { initSelector } from './controls'
import { characters } from './character';
import { guiOptions, updateCharacterController, updateCharacterOutline } from './controllers';
import { type TransformControlsMode } from 'three/examples/jsm/Addons.js';
import { presetImport } from './controllers/presets';
import { setupCameraModeButtons } from './camera'

const characterSelector = document.getElementById('character-selector') as HTMLSelectElement
const characterAddCrossBtn = document.getElementById('character-add-cross-btn') as HTMLButtonElement
const characterAddSelector = document.getElementById('character-add-selector') as HTMLSelectElement
const animationSelector = document.getElementById('animation-selector') as HTMLSelectElement
const animationPlayBtn = document.getElementById('animation-play') as HTMLButtonElement
const animationPauseBtn = document.getElementById('animation-pause') as HTMLButtonElement
const animationSlider = document.getElementById('animation-slider') as HTMLInputElement
const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement

const loadProgressEl = document.getElementById('load-progress')!

const perfStatJsContainer = document.getElementById('perf-stat-js') as HTMLDivElement

characterAddCrossBtn.onclick = removeSelectedCharacter
animationPlayBtn.onclick = () => { scene.characterSelected?.character && (scene.characterSelected.character.animation.paused = false); updateAnimationControls() }
animationPauseBtn.onclick = () => { scene.characterSelected?.character && (scene.characterSelected.character.animation.paused = true); updateAnimationControls() }
animationSlider.oninput = () => {
    if (scene.characterSelected?.character) {
        const animation = scene.characterSelected.character.animation
        animation.paused = true
        animation.time = parseFloat(animationSlider.value)
        updateAnimationControls()
    }
}
fullscreenBtn.onclick = () => document.documentElement.requestFullscreen().then(() => (screen.orientation as any).lock('landscape').catch(() => undefined))

const transformTranslateBtn = document.getElementById('transform-set-translate') as HTMLButtonElement
const transformRotateBtn = document.getElementById('transform-set-rotate') as HTMLButtonElement
transformTranslateBtn.onclick = () => setTransformMode('translate')
transformRotateBtn.onclick = () => setTransformMode('rotate')

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
    setupCameraModeButtons()

    scene.animateLoopCallback = animateLoop

    scene.transformControls.addEventListener('change', () => {
        if (scene.characterSelected?.character) {
            updateCharacterController(scene.characterSelected?.character)
        }
    })

    tryChangeCharacterByHash()

    stats.dom.style.removeProperty('top')
    stats.dom.style.removeProperty('left')
    stats.dom.style.removeProperty('position')
    stats.dom.style.removeProperty('z-index')
    perfStatJsContainer.appendChild(stats.dom)
}

function setupCharacterAddSelector() {
    initSelector(characterAddSelector, { '< Select a character to add >': '', ...characterSelectDict });
    characterAddSelector.value = ''

    characterAddSelector.addEventListener('focus', () => {
        characterAddSelector.value = ''
    })
    characterAddSelector.addEventListener('click', () => {
        characterAddSelector.value = ''
    })
    characterAddSelector.addEventListener('change', async () => {
        if (characterAddSelector.value != '') {
            const id = characterAddSelector.value
            characterAddSelector.value = ''
            const newCharacter = await addOrChangeCharacter(id)
            selectCharacter(newCharacter)
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
    updateAnimationControls()
}

async function tryChangeCharacterByHash() {
    try {
        await presetImport(location.href)
        return
    } catch (e) { }

    let id = location.hash.replace('#', '')
    if (!characterIdList.includes(id)) id = '100107'

    const sceneCharacter = await changeCharacter(id)
    selectCharacter(sceneCharacter)
}

async function changeCharacter(id: number | string) {
    if (typeof id == 'number') id = id.toString()

    characterSelector.value = id
    updateCharacterController(null)

    const loaded = await addOrChangeCharacter(id, scene.characterSelected)
    if (scene.characterSelected == loaded) {
        selectCharacter(loaded)
    }
    return loaded
}

function removeSelectedCharacter() {
    if (scene.characterSelected) {
        scene.removeCharacter(scene.characterSelected)
        deselectCharacter()
    }
}

async function addOrChangeCharacter(id: number | string, sceneCharacter?: SceneCharacter): Promise<SceneCharacter> {
    let loadedSceneCharacter: SceneCharacter | undefined = undefined

    let oldTransform = undefined
    if (sceneCharacter?.character?.object) {
        oldTransform = {
            position: sceneCharacter.character.object.position,
            rotation: sceneCharacter.character.object.rotation,
        }
    }

    return scene.switchCharacter(
        sceneCharacter,
        id,
        {
            loadProgressCallback: displayProgress,
            loadFinishCallback: () => {
                if (loadedSceneCharacter?.character) {
                    // character outlines are added after texture load. apply global character outlines
                    updateCharacterOutline(loadedSceneCharacter.character, guiOptions)
                    // mesh visibility may change after textures loaded. update it.
                    if (scene.characterSelected == loadedSceneCharacter) { // the user may select another chatacter when textures are loading
                        updateCharacterController(loadedSceneCharacter.character)
                    }
                }
            }
        }
    ).then((sceneCharacter) => {
        hideAllDemoItems()

        const character = sceneCharacter.character!
        loadedSceneCharacter = sceneCharacter;

        if (oldTransform) {
            character.object.position.copy(oldTransform.position)
            character.object.rotation.copy(oldTransform.rotation)
        } else {
            character.object.position.copy(calculateNewCharacterPosition(sceneCharacter))
        }

        if (character.animation.default) {
            character.animation.play(character.animation.default, true)
        }

        return sceneCharacter
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
        }, { '<None>': '' } as Record<string, string>),
        value => {
            if (value) {
                character.animation.play(value, true)
            } else {
                character.animation.clear()
            }
        }
    );

    animationSelector.value = character.animation.current || ''
    updateAnimationControls()

    updateCharacterController(character)
    updateTransformModeButtons()

    document.body.classList.remove('no-target')
}

export function deselectCharacter() {
    scene.characterSelected = undefined

    updateCharacterController(null)
    updateTransformModeButtons()

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

export function displayProgress(text: string) {
    if (text) {
        loadProgressEl.style.removeProperty('display')
        loadProgressEl.textContent = text
    } else {
        loadProgressEl.style.display = 'none'
    }
}

export function hideAllDemoItems() {
    document.body.classList.add('no-demo')
}

function updateAnimationControls() {
    if (scene.characterSelected?.character) {
        const animation = scene.characterSelected.character.animation

        if (animationSelector.value) {
            if (animation.paused) {
                animationPlayBtn.style.removeProperty('display')
                animationPauseBtn.style.display = 'none'
            } else {
                animationPlayBtn.style.display = 'none'
                animationPauseBtn.style.removeProperty('display')
            }
            animationSlider.style.removeProperty('display')
            animationSlider.min = '0'
            animationSlider.max = (animation.duration - 0.01).toString()
            animationSlider.step = '0.01'
            animationSlider.value = animation.time.toString()
        } else {
            animationPauseBtn.style.display = 'none'
            animationPlayBtn.style.display = 'none'
            animationSlider.style.display = 'none'
        }
    }
}

function setTransformMode(mode: TransformControlsMode) {
    if (mode == 'rotate') {
        scene.transformControls.showX = false
        scene.transformControls.showZ = false
    } else {
        scene.transformControls.showX = true
        scene.transformControls.showZ = true
    }
    scene.transformControls.mode = mode

    updateTransformModeButtons()
}

function updateTransformModeButtons() {
    transformTranslateBtn.style.display = 'none'
    transformRotateBtn.style.display = 'none'

    if (scene.characterSelectionVisible) {
        if (scene.transformControls.mode == 'translate') {
            transformRotateBtn.style.removeProperty('display')
        } else {
            transformTranslateBtn.style.removeProperty('display')
        }
    }
}

Object.assign(window, { changeCharacter })
