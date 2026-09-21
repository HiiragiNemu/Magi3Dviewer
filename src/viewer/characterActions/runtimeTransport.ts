export const ACTION_RUNTIME_BROWSER_SUFFIX = '.magius-runtime'

const ACTION_RUNTIME_GZIP_PATTERN = /\/runtime\.v1\.json\.gz(?=([?#]|$))/i

/**
 * Keep the manifest pointed at the original gzip authority while requesting
 * its byte-identical, neutral-extension browser carrier. Download-manager
 * extensions commonly intercept application/gzip responses before fetch can
 * consume them.
 */
export function browserSafeActionRuntimeUrl(url: string): string {
    return url.replace(
        ACTION_RUNTIME_GZIP_PATTERN,
        `/runtime.v1${ACTION_RUNTIME_BROWSER_SUFFIX}`,
    )
}
