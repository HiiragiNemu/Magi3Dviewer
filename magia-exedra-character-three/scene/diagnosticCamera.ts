export type DiagnosticCameraVector = readonly [number, number, number]

export interface DiagnosticCameraInitialState {
    diagnostic: string
    position?: DiagnosticCameraVector
    target?: DiagnosticCameraVector
}

function parseFiniteVector3(value: string | null): DiagnosticCameraVector | undefined {
    if (value === null) return undefined
    const components = value.split(',').map(component => Number(component.trim()))
    if (components.length !== 3 || !components.every(Number.isFinite)) {
        return undefined
    }
    return components as [number, number, number]
}

/**
 * Reproducible visual gates need a deterministic first frame, but must leave
 * OrbitControls entirely interactive for the user's own angle and zoom checks.
 * These query fields therefore set only the initial camera vectors and are
 * ignored outside an explicitly named diagnostic session.
 */
export function readDiagnosticCameraInitialState(
    search: string,
): DiagnosticCameraInitialState | undefined {
    const params = new URLSearchParams(search)
    const diagnostic = params.get('diagnostic')?.trim()
    if (!diagnostic) return undefined

    const position = parseFiniteVector3(
        params.get('diagnosticCameraPosition'),
    )
    const target = parseFiniteVector3(
        params.get('diagnosticCameraTarget'),
    )
    if (!position && !target) return undefined

    return {
        diagnostic,
        ...(position ? { position } : {}),
        ...(target ? { target } : {}),
    }
}
