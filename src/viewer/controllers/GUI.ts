import GUI, { type FunctionController } from 'three/addons/libs/lil-gui.module.min.js';
import { OutlineColor, OutlineThickness, shadowOptions } from 'magia-exedra-character-three/shaders'
import { scene, ViewerScene, type SceneComposerAntiAliasing } from '../scene';
import { presetExport, presetImport } from './presets';
import { themeDarkBgColor } from './theme';

export const threeGuiContainer = document.getElementById('three-gui')!

export const gui = new GUI({ container: threeGuiContainer }).close()

export const guiOptions = {
    OutlineVisible: true,
    OutlineThickness: OutlineThickness,
    OutlineColor: OutlineColor,

    Brightness: ViewerScene.colorFilter.brightness,
    Contrast: ViewerScene.colorFilter.contrast,
    Saturation: ViewerScene.colorFilter.saturation,

    BgColor: themeDarkBgColor,
    AmbientLightColor: ViewerScene.ambientLightInitialColor,
    DirectionalLightColor: ViewerScene.directionalLightInitialColor,

    AmbientLight: ViewerScene.ambientLightInitialIntensity,
    DirectionalLight: ViewerScene.directionalLightInitialIntensity,

    LightAngle: ViewerScene.directionalLightInitialAngle,
    LightHeight: ViewerScene.directionalLightInitialHeight,
    LightDistance: ViewerScene.directionalLightInitialDistance,

    ShadowThreshold: shadowOptions.threshold,
    ShadowTransition: shadowOptions.transition,
    ShadowAmount: shadowOptions.amount,

    FOV: ViewerScene.cameraInitialFov,
    Axes: false,
    UseEffectComposer: scene.composerEnabled,
    AntiAliasing: 'None' satisfies SceneComposerAntiAliasing as SceneComposerAntiAliasing,
    AntiAliasingLevel: 2,

    async Export() {
        if (await presetExport()) {
            if (!guiExport) return
            const el = guiExport.domElement.getElementsByClassName('name')[0]
            const oldText = el.textContent
            el.textContent = 'Copied to clipbaord!'
            guiExport.disable()
            setTimeout(() => {
                el.textContent = oldText
                guiExport?.enable()
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

let guiExport: FunctionController<typeof guiOptions, 'Export'> | undefined = undefined
setTimeout(() => {
    guiExport = gui.add(guiOptions, 'Export').name('Export presets')
    gui.add(guiOptions, 'Import').name('Import presets')
    gui.add(guiOptions, 'Reset').name('Reset everything')
}, 0);

Object.assign(window, { gui, guiOptions })
