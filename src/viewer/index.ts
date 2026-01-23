import * as THREE from 'three'
import Stats from 'three/addons/libs/stats.module.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import ViewerScene from './scene';
import { initSelector } from './UIControls'
import { characters } from './character';
// import { ARButton } from 'three/examples/jsm/Addons.js';

const viewerEl = document.getElementById('viewer')!
const menuEl = document.getElementById('menu')!

const characterSelector = document.getElementById('character-selector') as HTMLSelectElement
const animationSelector = document.getElementById('animation-selector') as HTMLSelectElement
const animationPlayBtn = document.getElementById('animation-play') as HTMLButtonElement
const animationLoopBtn = document.getElementById('animation-loop') as HTMLButtonElement
const animationStopBtn = document.getElementById('animation-stop') as HTMLButtonElement
const loadProgressEl = document.getElementById('load-progress') as HTMLDivElement
const threeGuiContainer = document.getElementById('three-gui') as HTMLDivElement

animationPlayBtn.onclick = () => scene?.character?.playAnimation(animationSelector.value)
animationLoopBtn.onclick = () => scene?.character?.playAnimation(animationSelector.value, true)
animationStopBtn.onclick = () => scene?.character?.mixer?.stopAllAction()

let scene: ViewerScene | undefined = undefined

const characterIdList = characters.getCharacterIdList()

const clock = new THREE.Clock()
const stats = new Stats()

const gui = new GUI({ container: threeGuiContainer })
gui.close()
const guiOptions = {
    bgColor: '#444',
    brightness: 2,
    FOV: 10,
    outlineVisible: true,
    outline: 0.0035,
    reset: () => {
        gui.reset()
        scene?.resetCameraControl()
    }
}

export function setupViewer() {
    initSelector(
        characterSelector,
        characterIdList.reduce((obj, id) => {
            obj[`${id} - ${characters.getCharacterNameById(id)}`] = id
            return obj
        }, {} as Record<string, string>),
        value => {
            console.log('Selector value change:', value)
            if (!value || location.hash == `#${value}`) return
            location.hash = value
        }
    )

    stats.dom.style.removeProperty('top')
    stats.dom.style.bottom = '0'
    menuEl.appendChild(stats.dom)

    scene = new ViewerScene(viewerEl)
    scene.animateLoopCallback = animateLoop

    // viewerEl.appendChild(ARButton.createButton(scene.renderer, {
    //     requiredFeatures: ['hit-test'],
    //     optionalFeatures: ['dom-overlay'],
    //     domOverlay: { root: menuEl }
    // }))

    window.addEventListener('hashchange', tryChangeCharacterByHash)
    tryChangeCharacterByHash() || changeCharacter(100107)

    setupGui()
}

function animateLoop() {
    const delta = clock.getDelta();
    if (scene?.character?.mixer) {
        scene.character.mixer.update(delta);
    }
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

    scene?.switchCharacter(
        id,
        {
            loadProgressCallback: progress => loadProgressEl.textContent = progress,
            loadFinishCallback: () => updateCharacterOutline() // WARN: In some racing cases, a stale character may callback this function, but it won't cause any issues for now
        }
    ).then((character) => {
        initSelector(
            animationSelector,
            character.animations.reduce((obj, name) => {
                obj[name] = name
                return obj
            }, {} as Record<string, string>),
            value => value && character.playAnimation(value)
        );

        character.mixer.addEventListener('finished', () => character.playAnimation())
        const playing = character.playAnimation()

        if (playing.length > 0) animationSelector.value = character.animations.find(x => playing.includes(x))!

        updateCharacterOutline()
    })
}

function setupGui() {
    Object.assign(window, { gui, guiOptions })
    gui.addColor(guiOptions, 'bgColor').onChange(value => viewerEl.style.backgroundColor = value)
    gui.add(guiOptions, 'brightness', 0, 5).onChange(value => scene && (scene.ambientLight.intensity = value))
    gui.add(guiOptions, 'FOV', 5, 60).onChange(value => scene && (scene.camera.fov = value) && scene.camera.updateProjectionMatrix())
    gui.add(guiOptions, 'outlineVisible').onChange(updateCharacterOutline)
    gui.add(guiOptions, 'outline', 0, 0.01).onChange(updateCharacterOutline)
    gui.add(guiOptions, 'reset')
}

function updateCharacterOutline() {
    if (!(scene && scene.character)) return
    for (const mesh of scene.character.userData.outlineMeshes) {
        mesh.visible = guiOptions.outlineVisible;
        (mesh.material as THREE.ShaderMaterial).uniforms.uThickness.value = guiOptions.outline
    }
}
