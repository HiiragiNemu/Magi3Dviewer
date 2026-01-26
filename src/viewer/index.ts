import * as THREE from 'three'
import Stats from 'three/addons/libs/stats.module.js';
import GUI, { type ColorController } from 'three/addons/libs/lil-gui.module.min.js';
import ViewerScene, { deg2pos } from './scene';
import { initSelector } from './UIControls'
import { characters } from './character';
import { OutlineColor, OutlineThickness } from 'magia-exedra-character-three/shaders'
// import { ARButton } from 'three/examples/jsm/Addons.js';

const viewerEl = document.getElementById('viewer')!
const menuEl = document.getElementById('menu')!

const characterSelector = document.getElementById('character-selector') as HTMLSelectElement
const animationSelector = document.getElementById('animation-selector') as HTMLSelectElement
const animationPlayBtn = document.getElementById('animation-play') as HTMLButtonElement
const animationLoopBtn = document.getElementById('animation-loop') as HTMLButtonElement
const animationStopBtn = document.getElementById('animation-stop') as HTMLButtonElement
const themeSelector = document.getElementById('theme-selector') as HTMLFormElement
const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement
const loadProgressEl = document.getElementById('load-progress')!
const threeGuiContainer = document.getElementById('three-gui')!
const demoEls = document.getElementsByClassName('demo')

animationPlayBtn.onclick = () => scene?.character?.playAnimation(animationSelector.value)
animationLoopBtn.onclick = () => scene?.character?.playAnimation(animationSelector.value, true)
animationStopBtn.onclick = () => scene?.character?.mixer?.stopAllAction()
themeSelector.onsubmit = e => e.preventDefault()
themeSelector.onchange = e => e.target instanceof HTMLInputElement && setTheme(e.target.value);
fullscreenBtn.onclick = () => document.documentElement.requestFullscreen().then(() => (screen.orientation as any).lock('landscape').catch(() => undefined))

let scene: ViewerScene | undefined = undefined

const characterIdList = characters.getCharacterIdList()

const clock = new THREE.Clock()
const stats = new Stats()

const themeDarkBgColor = '#444444'
const themeLightBgColor = '#ffffff'

const gui = new GUI({ container: threeGuiContainer })
gui.close()
const guiOptions = {
    BgColor: themeDarkBgColor,
    OutlineVisible: true,
    OutlineThickness: OutlineThickness,
    OutlineColor: OutlineColor,

    AmbientLightColor: ViewerScene.ambientLightInitialColor,
    DirectionalLightColor: ViewerScene.directionalLightInitialColor,
    AmbientLight: ViewerScene.ambientLightInitialIntensity,
    DirectionalLight: ViewerScene.directionalLightInitialIntensity,
    LightAngle: ViewerScene.directionalLightInitialAngle,
    LightHeight: ViewerScene.directionalLightInitialHeight,
    LightDistance: ViewerScene.directionalLightInitialDistance,

    FOV: ViewerScene.cameraInitialFov,
    Axes: false,

    Reset: () => {
        gui.reset()
        scene?.resetCameraControl()
    }
}
let guiBgColor: ColorController<typeof guiOptions, 'BgColor'> | undefined
let guiMeshes: GUI | undefined

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
    );

    stats.dom.style.removeProperty('top')
    stats.dom.style.removeProperty('left')
    stats.dom.style.right = '0'
    stats.dom.style.bottom = '0'
    stats.dom.style.pointerEvents = 'initial'
    menuEl.appendChild(stats.dom)

    scene = new ViewerScene(viewerEl)
    scene.animateLoopCallback = animateLoop
    Object.assign(window, { scene })

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
    guiMeshes?.destroy()

    scene?.switchCharacter(
        id,
        {
            loadProgressCallback: progress => loadProgressEl.textContent = progress,
            loadFinishCallback: updateCharacterOutline // WARN: In some racing cases, a stale character may callback this function, but it won't cause any issues for now
        }
    ).then((character) => {
        [...demoEls].forEach(x => x instanceof HTMLElement && (x.style.display = 'none'))

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

        guiMeshes = gui.addFolder('Meshes')
        guiMeshes.close()
        const guiMeshesOptions: Record<string, boolean> = {}
        for (const mesh of character.userData.meshes) {
            guiMeshesOptions[mesh.name] = true
        }
        for (const mesh of character.userData.meshes) {
            guiMeshes.add(guiMeshesOptions, mesh.name).onChange(value => {
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
                materials.forEach(x => x.visible = value)
            })
        }
    })
}

function setupGui() {
    Object.assign(window, { gui, guiOptions })

    guiBgColor = gui.addColor(guiOptions, 'BgColor').onChange(value => viewerEl.style.backgroundColor = value)
    gui.add(guiOptions, 'OutlineVisible').onChange(updateCharacterOutline)
    gui.add(guiOptions, 'OutlineThickness', 0, 0.01).onChange(updateCharacterOutline)
    gui.addColor(guiOptions, 'OutlineColor').onChange(updateCharacterOutline)

    const lightingFolder = gui.addFolder('Lighting')
    lightingFolder.addColor(guiOptions, 'AmbientLightColor').onChange(value => scene && (scene.ambientLight.color = new THREE.Color(value)))
    lightingFolder.addColor(guiOptions, 'DirectionalLightColor').onChange(value => scene && (scene.directionalLight.color = new THREE.Color(value)))
    lightingFolder.add(guiOptions, 'AmbientLight', 0, 5).onChange(value => scene && (scene.ambientLight.intensity = value))
    lightingFolder.add(guiOptions, 'DirectionalLight', 0, 5).onChange(value => scene && (scene.directionalLight.intensity = value))
    lightingFolder.add(guiOptions, 'LightAngle', -180, 180).onChange(updateSceneDirectionalLight)
    lightingFolder.add(guiOptions, 'LightHeight', -10, 10).onChange(updateSceneDirectionalLight)
    lightingFolder.add(guiOptions, 'LightDistance', 0, 20).onChange(updateSceneDirectionalLight)

    const miscFolder = gui.addFolder('Misc')
    miscFolder.close()
    miscFolder.add(guiOptions, 'FOV', 5, 60).onChange(value => scene && (scene.camera.fov = value) && scene.camera.updateProjectionMatrix())
    miscFolder.add(guiOptions, 'Axes').onChange(value => scene && (scene.axesHelper.visible = value))

    gui.add(guiOptions, 'Reset')
}

function updateCharacterOutline() {
    if (!(scene && scene.character)) return
    for (const mesh of scene.character.userData.outlineMeshes) {
        mesh.visible = guiOptions.OutlineVisible;
        const material = mesh.material as THREE.ShaderMaterial
        material.uniforms.uThickness.value = guiOptions.OutlineThickness
        material.uniforms.uColor.value = new THREE.Color(guiOptions.OutlineColor)
    }
}

function updateSceneDirectionalLight() {
    if (!scene) return
    const { x, z } = deg2pos(guiOptions.LightAngle, guiOptions.LightDistance)
    scene.directionalLight.position.set(x, guiOptions.LightHeight, z)
}

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
