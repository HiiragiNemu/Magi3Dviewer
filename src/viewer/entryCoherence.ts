/** The production host already enables Release asset delivery. The legacy query
 * is not a website version selector. Preserve every unrelated option/hash. */
export function canonicalViewerEntry(href: string): string {
    const url = new URL(href)
    if (url.hostname === 'magius3dviewer.pages.dev' && url.pathname === '/'
        && url.searchParams.get('runtimeDelivery') === 'release') {
        url.searchParams.delete('runtimeDelivery')
    }
    return url.href
}
export function normalizeViewerEntry(): void {
    const canonical = canonicalViewerEntry(location.href)
    if (canonical !== location.href) history.replaceState(history.state, '', canonical)
}
