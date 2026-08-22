import { guiOptions, guiBgColor } from "."

export const themeLightBtn = document.getElementById('theme-set-light') as HTMLButtonElement
export const themeDarkBtn = document.getElementById('theme-set-dark') as HTMLButtonElement
themeLightBtn.onclick = () => setTheme('light')
themeDarkBtn.onclick = () => setTheme('dark')

const themeStorageKey = 'magius3dviewer.theme'

export const themeDarkBgColor = '#444444'
export const themeLightBgColor = '#ffffff'

export type Theme = 'light' | 'dark'
export const themeLightClassName = 'theme-light'

export function setTheme(theme: Theme, persist = true) {
    let newColor
    let shouldApplyNewColor = false

    if (theme == 'light') {
        document.body.classList.add(themeLightClassName)
        newColor = themeLightBgColor
        shouldApplyNewColor = guiOptions.BgColor == themeDarkBgColor
    } else if (theme == 'dark') {
        document.body.classList.remove(themeLightClassName)
        newColor = themeDarkBgColor
        shouldApplyNewColor = guiOptions.BgColor == themeLightBgColor
    } else return

    guiBgColor._initialValueHexString = newColor
    if (shouldApplyNewColor) guiBgColor.reset()
    if (persist) localStorage.setItem(themeStorageKey, theme)
}

export function restoreThemePreference() {
    const stored = localStorage.getItem(themeStorageKey)
    setTheme(stored == 'light' || stored == 'dark' ? stored : 'dark', false)
}

export function getCurrentTheme(): Theme {
    return document.body.classList.contains(themeLightClassName) ? 'light' : 'dark'
}

Object.assign(window, { setTheme, getCurrentTheme })
