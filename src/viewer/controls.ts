export function initSelector(el: HTMLSelectElement, items: Record<string, string>, onchangeCallback?: (value: string) => any) {
    el.innerHTML = ''

    for (const key in items) {
        const option = document.createElement('option')
        option.textContent = key
        option.value = items[key]
        el.appendChild(option)
    }

    if (onchangeCallback) {
        el.onchange = e => {
            onchangeCallback((e!.target as HTMLSelectElement).value)
        }
    }
}

export interface ReplayableAnimation {
    paused: boolean
    readonly clamped: boolean
    play(name: string, loop?: boolean): void
}

/**
 * A finished LoopOnce action is still marked as playing by three.js while its
 * final pose is clamped. Merely clearing `paused` therefore cannot restart it.
 * Replay the selected family so ChatacterAnimation.play() resets every action
 * and the shared mixer timeline to frame zero. Paused, unfinished actions keep
 * the old resume behaviour.
 */
export function resumeOrReplaySelectedAnimation(
    animation: ReplayableAnimation,
    selectedAnimation: string,
) {
    if (selectedAnimation && animation.clamped) {
        animation.play(selectedAnimation, selectedAnimation.endsWith('_L'))
        return
    }

    animation.paused = false
}
