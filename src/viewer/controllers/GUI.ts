import GUI, { type FunctionController } from 'three/addons/libs/lil-gui.module.min.js';
import { OutlineColor, OutlineThickness } from 'magia-exedra-character-three/shaders'
import { scene } from '../scene';
import { MagiaExedraScene3D } from 'magia-exedra-character-three/scene'
import type { SceneComposerAntiAliasing } from 'magia-exedra-character-three/scene/effects';
import { presetExport, presetImport } from './presets';
import { themeDarkBgColor } from './theme';
import { CharacterMeshController } from 'magia-exedra-character-three/character';

export const threeGuiContainer = document.getElementById('three-gui')!

export const gui = new GUI({ container: threeGuiContainer }).close()

export const guiOptions = {
    OutlineVisible: true,
    OutlineThickness: OutlineThickness,
    OutlineColor: OutlineColor,
    OutlineAlwaysVisible: CharacterMeshController.OutlineAlwaysVisible,

    Brightness: MagiaExedraScene3D.colorFilter.brightness,
    Contrast: MagiaExedraScene3D.colorFilter.contrast,
    Saturation: MagiaExedraScene3D.colorFilter.saturation,

    BgColor: themeDarkBgColor,
    AmbientLightColor: MagiaExedraScene3D.ambientLightInitialColor,
    DirectionalLightColor: MagiaExedraScene3D.directionalLightInitialColor,

    AmbientLight: MagiaExedraScene3D.ambientLightInitialIntensity,
    DirectionalLight: MagiaExedraScene3D.directionalLightInitialIntensity,

    LightAngle: MagiaExedraScene3D.directionalLightInitialAngle,
    LightHeight: MagiaExedraScene3D.directionalLightInitialHeight,
    LightDistance: MagiaExedraScene3D.directionalLightInitialDistance,

    FOV: MagiaExedraScene3D.cameraInitialFov,
    CameraRotation: 0,
    CameraFullscreen: true,

    Axes: false,
    PixelRatio: MagiaExedraScene3D.defaultPixelRatio,
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


export function isGuiClosed(gui: GUI) {
    return gui.domElement.classList.contains('closed')
}


Object.assign(window, { gui, guiOptions })
