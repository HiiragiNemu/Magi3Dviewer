export interface ScreenRect { x: number; y: number; width: number; height: number }
export interface BranchPlacement { left: ScreenRect; right: ScreenRect; protected: ScreenRect; compact: boolean }

/** Place small branch rails outside the projected actor, never a bottom sheet. */
export function layoutViewportBranches(view: ScreenRect, actor: ScreenRect, leftHeight: number, rightHeight: number): BranchPlacement {
    const margin = 8, gap = 10
    const width = Math.min(104, Math.max(76, view.width * 0.215))
    const safe = { x: actor.x - gap, y: actor.y - 8, width: actor.width + gap * 2, height: actor.height + 16 }
    const leftRoom = safe.x - view.x - margin
    const rightRoom = view.x + view.width - margin - safe.x - safe.width
    const availableHeight = Math.max(40, view.height - margin * 2)
    const clampY = (height: number) => Math.max(view.y + margin, Math.min(actor.y + actor.height * .37 - height * .35, view.y + view.height - height - margin))
    const left = { x: Math.max(view.x + margin, safe.x - width - gap), y: clampY(leftHeight), width, height: Math.min(leftHeight, availableHeight) }
    const right = { x: Math.min(view.x + view.width - width - margin, safe.x + safe.width + gap), y: clampY(rightHeight), width, height: Math.min(rightHeight, availableHeight) }
    // If a close-up fills the entire view, rails remain narrow and reachable.
    // They never turn into a viewport-wide card; folding keeps only the header.
    return { left, right, protected: safe, compact: leftRoom < width || rightRoom < width }
}
