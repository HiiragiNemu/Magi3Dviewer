import { scene } from "../scene";
import { gui, guiOptions } from "./GUI";

export const guiColor = gui.addFolder('Color')

export const guiColorBrightness = guiColor.add(guiOptions, 'Brightness', 0.5, 1.5, 0.01).onChange(updateColorFilter)
export const guiColorContrast = guiColor.add(guiOptions, 'Contrast', 0.5, 1.5, 0.01).onChange(updateColorFilter)
export const guiColorSaturation = guiColor.add(guiOptions, 'Saturation', 0.5, 1.5, 0.01).onChange(updateColorFilter)

function updateColorFilter() {
    scene.setColorFilter({
        brightness: guiOptions.Brightness,
        contrast: guiOptions.Contrast,
        saturation: guiOptions.Saturation,
    })
}
