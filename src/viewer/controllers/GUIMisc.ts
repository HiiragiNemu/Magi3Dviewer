import { scene } from '../scene';
import { gui, guiOptions } from './GUI';

const miscFolder = gui.addFolder('Misc').close()

miscFolder.add(guiOptions, 'FOV', 5, 60).onChange(value => { scene.camera.fov = value; scene.camera.updateProjectionMatrix() })
miscFolder.add(guiOptions, 'Axes').onChange(value => scene.axesHelper.visible = value)

miscFolder.add(guiOptions, 'UseEffectComposer', ['Auto', 'Always', 'Never']).onChange(value => { scene.composerEnabled = value; updateAntiAliasingGUI() }).domElement.title =
    `Auto: Use effect composer only when needed to render selection outlines.
Always: Always use effect composer for rendering, disable direct rendering.
Never: Disable effect composer, always use direct rendering (This will cause selection outlines not visible).

Force enabling the effect composer with high levels of antialiasing can produce greater image quality, at the cost of degraded performance.`;

const guiAntiAliasing = miscFolder.add(guiOptions, 'AntiAliasing', ['None', 'MSAA', 'TAA', 'SSAA', 'SMAA', 'FXAA']).name('AntiAliasing(Composer)').onChange(updateAntiAliasing)
guiAntiAliasing.domElement.title = `Anti-aliasing method used for the effect composer.
This option does not affect direct rendering that always uses default MSAA.`;

const guiAntiAliasingLevel = miscFolder.add(guiOptions, 'AntiAliasingLevel', 0, 8, 1).onChange(updateAntiAliasing).hide()

function updateAntiAliasingGUI() {
    if (guiOptions.UseEffectComposer != 'Never') {
        guiAntiAliasing.show()
    } else {
        guiAntiAliasing.hide()
    }

    if (guiOptions.UseEffectComposer != 'Never' && (
        guiOptions.AntiAliasing == 'MSAA' ||
        guiOptions.AntiAliasing == 'TAA' ||
        guiOptions.AntiAliasing == 'SSAA'
    )) {
        guiAntiAliasingLevel.show()
    } else {
        guiAntiAliasingLevel.hide()
    }
}

function updateAntiAliasing() {
    updateAntiAliasingGUI()
    scene.setAntiAliasing(guiOptions.AntiAliasing, guiOptions.AntiAliasingLevel)
}
