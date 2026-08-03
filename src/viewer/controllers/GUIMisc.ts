import { PerformanceMetricsOptions } from '../performance';
import { scene } from '../scene';
import { gui, guiOptions } from './GUI';
import { createSquareExponentController } from './GUIExtensions';

const miscFolder = gui.addFolder('Misc').close()

miscFolder.add(guiOptions, 'Axes').onChange(value => scene.axesHelper.visible = value)

miscFolder.add(guiOptions, 'PixelRatio', 0.2, 2, 0.1).onChange(value => scene.pixelRatio = value)

miscFolder.add(guiOptions, 'UseEffectComposer', ['Auto', 'Always', 'Never']).onChange(value => { scene.composerEnabled = value; updateAntiAliasingGUI() }).domElement.title =
    `自动：仅在绘制选择描边等必要情况使用后期合成器。
始终：始终通过后期合成器渲染，并停用直接渲染。
从不：停用后期合成器并始终直接渲染（这会导致选择描边不可见）。

强制启用后期合成器并使用高等级抗锯齿可改善画质，但会降低性能。`;

const guiAntiAliasing = miscFolder.add(guiOptions, 'AntiAliasing', ['None', 'MSAA', 'TAA', 'SSAA', 'SMAA', 'FXAA']).name('AntiAliasing(Composer)').onChange(updateAntiAliasing)
guiAntiAliasing.domElement.title = `后期合成器使用的抗锯齿方式。
此选项不影响始终采用默认 MSAA 的直接渲染。`;

const guiAntiAliasingLevel = createSquareExponentController(miscFolder, guiOptions, 'AntiAliasingLevel', 1, 8).onChange(updateAntiAliasing).hide()

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
    scene.effects.setAntiAliasing(guiOptions.AntiAliasing, guiOptions.AntiAliasingLevel)
}

miscFolder.add(PerformanceMetricsOptions, 'visible').name('PerformanceMetrics')
