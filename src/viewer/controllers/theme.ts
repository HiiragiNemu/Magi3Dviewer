import { guiOptions, guiBgColor } from "."

export const themeToggleBtn = document.getElementById('theme-toggle') as HTMLButtonElement
themeToggleBtn.onclick=()=>setTheme(getCurrentTheme()==='light'?'dark':'light')

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
    themeToggleBtn.textContent=theme==='light'?'☾':'☀'
    themeToggleBtn.title=theme==='light'?'切换夜间模式':'切换日间模式';themeToggleBtn.setAttribute('aria-label',themeToggleBtn.title);themeToggleBtn.setAttribute('aria-pressed',String(theme==='light'))
    if (persist) try { localStorage.setItem(themeStorageKey, theme) } catch {}
}

export function restoreThemePreference() {
    let stored:string|null=null;try{stored=localStorage.getItem(themeStorageKey)}catch{}
    setTheme(stored == 'light' || stored == 'dark' ? stored : 'dark', false)
}

export function getCurrentTheme(): Theme {
    return document.body.classList.contains(themeLightClassName) ? 'light' : 'dark'
}

Object.assign(window, { setTheme, getCurrentTheme })
