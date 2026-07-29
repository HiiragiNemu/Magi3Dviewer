import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const options = parseArguments(process.argv.slice(2))
const chromePath = options.chrome
    ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const outputPath = path.resolve(options.output ?? 'artifacts/webgl-capture.png')
const reportPath = path.resolve(
    options.report ?? outputPath.replace(/\.[^.]+$/, '.json'),
)
const port = Number(options.port ?? 9333)
const waitMs = Number(options.wait ?? 12_000)
const hardTimeoutMs = Number(
    options.timeout ?? Math.max(waitMs + 30_000, 45_000),
)
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'magius-cdp-'))

await mkdir(path.dirname(outputPath), { recursive: true })
await mkdir(path.dirname(reportPath), { recursive: true })

const chrome = spawn(
    chromePath,
    [
        '--headless=new',
        `--remote-debugging-port=${port}`,
        '--remote-allow-origins=*',
        `--user-data-dir=${profileDir}`,
        '--use-angle=d3d11',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
        '--hide-scrollbars',
        '--window-size=1536,1024',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
    ],
    {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    },
)

let stderr = ''
chrome.stderr.setEncoding('utf8')
chrome.stderr.on('data', chunk => {
    // Keep diagnostics bounded even if Chrome repeatedly reports a GPU issue.
    if (stderr.length < 32_768) stderr += chunk
})

let socket
let cdp
let timedOut = false
const watchdog = setTimeout(() => {
    timedOut = true
    socket?.close()
    void terminateProcessTree(chrome.pid)
}, hardTimeoutMs)
watchdog.unref()
try {
    await waitForDebugger(port)
    // Create a blank target and navigate exactly once. Creating it at the final
    // URL and navigating again made download-manager extensions see duplicate
    // FBX requests during every regression capture.
    const target = await createTarget(port, 'about:blank')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    cdp = await createCdpClient(socket)
    const events = []
    const assetRequests = new Map()

    cdp.onEvent(event => {
        if (event.method === 'Network.responseReceived') {
            const url = event.params.response?.url ?? ''
            if (/\.(?:fbxdata|bin|gz)(?:[?#]|$)/i.test(url) && assetRequests.size < 50) {
                assetRequests.set(event.params.requestId, {
                    requestId: event.params.requestId,
                    url,
                    status: event.params.response.status,
                    mimeType: event.params.response.mimeType,
                    encodedDataLength: event.params.response.encodedDataLength,
                    headers: {
                        contentLength: event.params.response.headers?.['Content-Length']
                            ?? event.params.response.headers?.['content-length'],
                        contentEncoding: event.params.response.headers?.['Content-Encoding']
                            ?? event.params.response.headers?.['content-encoding'],
                    },
                })
            }
        } else if (
            event.method === 'Network.loadingFinished'
            && assetRequests.has(event.params.requestId)
        ) {
            Object.assign(assetRequests.get(event.params.requestId), {
                finished: true,
                encodedDataLength: event.params.encodedDataLength,
            })
        } else if (
            event.method === 'Network.loadingFailed'
            && assetRequests.has(event.params.requestId)
        ) {
            Object.assign(assetRequests.get(event.params.requestId), {
                failed: true,
                errorText: event.params.errorText,
                canceled: event.params.canceled,
            })
        }

        const isException = event.method === 'Runtime.exceptionThrown'
        const isLogEntry = event.method === 'Log.entryAdded'
        const isConsoleError =
            event.method === 'Runtime.consoleAPICalled'
            && ['error', 'warning', 'warn'].includes(event.params.type)
        if (events.length < 200 && (isException || isLogEntry || isConsoleError)) {
            events.push(event)
        }
    })

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Network.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1536,
        height: 1024,
        deviceScaleFactor: 1,
        mobile: false,
    })
    await cdp.send('Page.navigate', { url: options.url })
    await waitForReadyState(cdp)
    if (options.character || options.stage) {
        await delay(2_000)
    }
    if (options.character) {
        await evaluate(cdp, `(() => {
            const selector = document.querySelector('#character-selector')
            if (!selector) return false
            selector.value = ${JSON.stringify(options.character)}
            selector.dispatchEvent(new Event('change', { bubbles: true }))
            return selector.value === ${JSON.stringify(options.character)}
        })()`)
    }
    if (options.stage) {
        await evaluate(cdp, `(() => {
            const selector = document.querySelector('#stage-selector')
            if (!selector) return false
            selector.value = ${JSON.stringify(options.stage)}
            selector.dispatchEvent(new Event('change', { bubbles: true }))
            return selector.value === ${JSON.stringify(options.stage)}
        })()`)
    }
    await delay(waitMs)
    if (options['disable-bloom']) {
        await evaluate(cdp, `(() => {
            if (!window.scene?.effects?.bloomPass) return false
            window.scene.effects.bloomPass.enabled = false
            return true
        })()`)
        await delay(300)
    }
    if (
        options['bloom-strength']
        || options['bloom-radius']
        || options['bloom-threshold']
    ) {
        const strength = Number(options['bloom-strength'])
        const radius = Number(options['bloom-radius'])
        const threshold = Number(options['bloom-threshold'])
        await evaluate(cdp, `(() => {
            const pass = window.scene?.effects?.bloomPass
            if (!pass) return false
            pass.enabled = true
            ${Number.isFinite(strength) ? `pass.strength = ${strength};` : ''}
            ${Number.isFinite(radius) ? `pass.radius = ${radius};` : ''}
            ${Number.isFinite(threshold) ? `pass.threshold = ${threshold};` : ''}
            return true
        })()`)
        await delay(300)
    }
    if (options['disable-rim']) {
        await evaluate(cdp, `(() => {
            for (const entry of window.scene?.characters ?? []) {
                for (const mesh of entry.character?.userData?.meshes ?? []) {
                    const materials = Array.isArray(mesh.material)
                        ? mesh.material
                        : [mesh.material]
                    for (const material of materials) {
                        const uniform =
                            material?.userData?.shader?.uniforms?.uRimEnabled
                        if (uniform) uniform.value = 0
                    }
                }
            }
            return true
        })()`)
        await delay(300)
    }
    if (options['hide-outlines']) {
        await evaluate(cdp, `(() => {
            for (const entry of window.scene?.characters ?? []) {
                for (const mesh of entry.character?.userData?.outlineMeshes ?? []) {
                    mesh.visible = false
                }
            }
            return true
        })()`)
        await delay(500)
    }
    if (options['disable-angel-ring']) {
        await evaluate(cdp, `(() => {
            let changed = 0
            for (const entry of window.scene?.characters ?? []) {
                const root = entry.character?.object
                root?.traverse?.(object => {
                    if (!object?.isMesh) return
                    const materials = Array.isArray(object.material)
                        ? object.material
                        : [object.material]
                    for (const material of materials) {
                        const uniform =
                            material?.userData?.shader?.uniforms
                                ?.uAngelRingEnabled
                        if (!uniform) continue
                        uniform.value = 0
                        changed++
                    }
                })
            }
            return changed
        })()`)
        await delay(300)
    }
    if (options['head-view']) {
        const headView = String(options['head-view'])
        if (
            ![
                'front',
                'front-low',
                'back',
                'back-low',
                'left',
                'right',
            ].includes(headView)
        ) {
            throw new Error(
                '--head-view must be front, front-low, back, back-low, left, or right',
            )
        }
        await evaluate(cdp, `(() => {
            const scene = window.scene
            const camera = scene?.camera
            const controls = scene?.controls
            if (!camera || !controls) return { ok: false, reason: 'camera' }

            let uniforms
            const root = scene.characters?.[0]?.character?.object
            root?.traverse?.(object => {
                if (uniforms || !object?.isMesh) return
                const materials = Array.isArray(object.material)
                    ? object.material
                    : [object.material]
                for (const material of materials) {
                    const candidate = material?.userData?.shader?.uniforms
                    if (
                        candidate?.uAngelRingFacePosition
                        && candidate?.uAngelRingFaceForward
                        && candidate?.uAngelRingFaceUp
                    ) {
                        uniforms = candidate
                        break
                    }
                }
            })
            if (!uniforms) return { ok: false, reason: 'uniforms' }

            const facePosition =
                uniforms.uAngelRingFacePosition.value.clone()
            const faceForward =
                uniforms.uAngelRingFaceForward.value.clone().normalize()
            const faceUp =
                uniforms.uAngelRingFaceUp.value.clone().normalize()
            const faceRight = faceForward.clone()
                .cross(faceUp)
                .normalize()
            const view = ${JSON.stringify(headView)}
            const isLow = view.endsWith('-low')
            const viewSide = isLow ? view.slice(0, -4) : view
            const direction = (
                viewSide === 'front'
                    ? faceForward
                    : viewSide === 'back'
                        ? faceForward.clone().multiplyScalar(-1)
                        : viewSide === 'left'
                            ? faceRight.clone().multiplyScalar(-1)
                            : faceRight
            ).clone()
            if (isLow) {
                direction.addScaledVector(faceUp, -0.52).normalize()
            }
            const distance = 0.72
            const target = facePosition.clone()
                .addScaledVector(faceUp, -0.015)

            camera.position.copy(target)
                .addScaledVector(direction, distance)
                .addScaledVector(faceUp, isLow ? -0.015 : 0.035)
            camera.up.copy(faceUp)
            if ('fov' in camera) {
                camera.fov = 30
                camera.updateProjectionMatrix()
            }
            controls.target.copy(target)
            camera.lookAt(target)
            controls.update()
            return {
                ok: true,
                view,
                facePosition: facePosition.toArray(),
                faceForward: faceForward.toArray(),
                faceUp: faceUp.toArray(),
                faceRight: faceRight.toArray(),
                cameraPosition: camera.position.toArray(),
                target: target.toArray(),
            }
        })()`)
        await delay(800)
    }

    const diagnostics = await evaluate(cdp, `(() => {
        const canvas = document.querySelector('canvas')
        const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl')
        const characterMeshes = []
        const characterObject =
            window.scene?.characters?.[0]?.character?.object
        characterObject?.traverse?.(object => {
            if (!object?.isMesh || characterMeshes.length >= 48) return
            const materials = Array.isArray(object.material)
                ? object.material
                : [object.material]
            const isOutline = materials.every(
                material => material?.type === 'ShaderMaterial',
            )
            const uv = isOutline
                ? null
                : object.geometry?.getAttribute?.('uv')
            const uvSummary = uv
                ? (() => {
                    let minU = Infinity
                    let minV = Infinity
                    let maxU = -Infinity
                    let maxV = -Infinity
                    const samples = []
                    const count = Math.min(uv.count, 20000)
                    for (let index = 0; index < count; index++) {
                        const u = uv.getX(index)
                        const v = uv.getY(index)
                        minU = Math.min(minU, u)
                        minV = Math.min(minV, v)
                        maxU = Math.max(maxU, u)
                        maxV = Math.max(maxV, v)
                        if (index < 12) samples.push([u, v])
                    }
                    return {
                        count: uv.count,
                        inspected: count,
                        min: [minU, minV],
                        max: [maxU, maxV],
                        samples,
                    }
                })()
                : null
            characterMeshes.push({
                name: object.name,
                parent: object.parent?.name ?? null,
                visible: object.visible,
                renderOrder: object.renderOrder,
                uv: uvSummary,
                groups: {
                    count: object.geometry?.groups?.length ?? 0,
                    materialIndices: [
                        ...new Set(
                            (object.geometry?.groups ?? [])
                                .slice(0, 256)
                                .map(group => group.materialIndex),
                        ),
                    ],
                    samples: (object.geometry?.groups ?? []).slice(0, 12),
                },
                materials: materials.filter(Boolean).map(material => {
                    const image = material.map?.image
                    const shader = material.userData?.shader
                    return {
                        type: material.type,
                        name: material.name,
                        visible: material.visible,
                        color: material.color?.getHexString?.() ?? null,
                        map: image?.currentSrc ?? image?.src ?? null,
                        mapSize: image
                            ? [
                                image.naturalWidth ?? image.width ?? null,
                                image.naturalHeight ?? image.height ?? null,
                            ]
                            : null,
                        side: material.side,
                        transparent: material.transparent,
                        opacity: material.opacity,
                        depthTest: material.depthTest,
                        depthWrite: material.depthWrite,
                        compiled: Boolean(shader),
                        defines: shader?.defines ?? null,
                        angelRing: shader?.uniforms?.uAngelRingFacePosition
                            ? {
                                enabled:
                                    shader.uniforms.uAngelRingEnabled?.value
                                    ?? null,
                                materialEnabled:
                                    shader.uniforms
                                        .uAngelRingMaterialEnabled?.value
                                    ?? null,
                                mapKind:
                                    shader.uniforms.uAngelRingMapKind?.value
                                    ?? null,
                                uvMode:
                                    shader.uniforms.uAngelRingUvMode?.value
                                    ?? null,
                                facePosition:
                                    shader.uniforms
                                        .uAngelRingFacePosition.value
                                        ?.toArray?.()
                                    ?? null,
                                faceForward:
                                    shader.uniforms
                                        .uAngelRingFaceForward?.value
                                        ?.toArray?.()
                                    ?? null,
                                faceUp:
                                    shader.uniforms.uAngelRingFaceUp?.value
                                        ?.toArray?.()
                                    ?? null,
                                aspectFix:
                                    shader.uniforms
                                        .uAngelRingAspectFix?.value
                                        ?.toArray?.()
                                    ?? null,
                                fovOrOrthoFix:
                                    shader.uniforms
                                        .uAngelRingFovOrOrthoFix?.value
                                    ?? null,
                            }
                            : null,
                        uniformKeys: shader
                            ? Object.keys(shader.uniforms).filter(key =>
                                /^u(Global|Official|Rd|Shadow|Angel)|^t(Shadow|Ctrl|Angel)/.test(key)
                            ).slice(0, 40)
                            : [],
                    }
                }),
            })
        })
        const rendererInfo = gl
            ? {
                vendor: gl.getParameter(gl.VENDOR),
                renderer: gl.getParameter(gl.RENDERER),
                version: gl.getParameter(gl.VERSION),
            }
            : null
        return {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            canvas: Boolean(canvas),
            webgl: Boolean(gl),
            rendererInfo,
            character: document.querySelector('#character-selector')?.value ?? null,
            stage: document.querySelector('#stage-selector')?.value ?? null,
            stageOptions: document.querySelectorAll('#stage-selector option').length,
            loadingText: document.querySelector('#loading-progress')?.textContent ?? null,
            bodyClass: document.body.className,
            camera: window.scene?.camera
                ? {
                    position: window.scene.camera.position.toArray(),
                    up: window.scene.camera.up.toArray(),
                    fov: window.scene.camera.fov ?? null,
                    target:
                        window.scene.controls?.target?.toArray?.()
                        ?? null,
                }
                : null,
            characterMeshes,
            renderValidation: {
                ungroupedMaterialArrays: characterMeshes.filter(mesh =>
                    mesh.groups.count === 0
                    && mesh.materials.filter(
                        material => material.type !== 'ShaderMaterial',
                    ).length > 1
                ).map(mesh => mesh.name),
                mainMaterials: characterMeshes
                    .flatMap(mesh => mesh.materials)
                    .filter(material => material.type !== 'ShaderMaterial')
                    .length,
                compiledMainMaterials: characterMeshes
                    .flatMap(mesh => mesh.materials)
                    .filter(material =>
                        material.type !== 'ShaderMaterial'
                        && material.compiled
                    ).length,
            },
        }
    })()`)

    const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true,
    })
    await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'))

    const report = {
        capturedAt: new Date().toISOString(),
        chromePid: chrome.pid,
        url: options.url,
        waitMs,
        hardTimeoutMs,
        timedOut,
        diagnostics,
        assetRequests: Array.from(assetRequests.values()),
        browserEvents: events.map(simplifyEvent),
        chromeStderr: stderr,
        outputPath,
    }
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))

    if (!diagnostics.webgl) process.exitCode = 2
    if (diagnostics.renderValidation.ungroupedMaterialArrays.length > 0) {
        process.exitCode = 3
    }
    if (
        Array.from(assetRequests.values()).some(
            request =>
                request.failed
                || request.status >= 400
                || !request.finished,
        )
    ) {
        process.exitCode = 4
    }
    if (
        diagnostics.renderValidation.mainMaterials === 0
        || diagnostics.renderValidation.compiledMainMaterials === 0
    ) {
        process.exitCode = 5
    }
    const hasFatalBrowserEvent = events.some(event =>
        event.method === 'Runtime.exceptionThrown'
        || (
            event.method === 'Log.entryAdded'
            && event.params.entry?.level === 'error'
        )
        || (
            event.method === 'Runtime.consoleAPICalled'
            && event.params.type === 'error'
        )
    )
    if (hasFatalBrowserEvent) process.exitCode = 6
} finally {
    clearTimeout(watchdog)
    if (cdp) {
        try {
            await cdp.send('Browser.close')
        } catch {
            // The browser may already have exited after a renderer failure.
        }
    }
    socket?.close()
    await terminateProcessTree(chrome.pid)
    await delay(500)
    await rm(profileDir, { recursive: true, force: true })
}

function parseArguments(args) {
    const parsed = {}
    for (let index = 0; index < args.length; index++) {
        const argument = args[index]
        if (!argument.startsWith('--')) continue
        const key = argument.slice(2)
        const value = args[index + 1]
        if (!value || value.startsWith('--')) {
            parsed[key] = true
        } else {
            parsed[key] = value
            index++
        }
    }
    if (typeof parsed.url !== 'string') {
        throw new Error('Usage: node capture-webgl-cdp.mjs --url <URL> [--output capture.png]')
    }
    return parsed
}

async function waitForDebugger(debugPort) {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
            if (response.ok) return
        } catch {
            // Chrome has not opened its debugger port yet.
        }
        await delay(150)
    }
    throw new Error(`Chrome debugger did not start on port ${debugPort}`)
}

async function createTarget(debugPort, url) {
    const response = await fetch(
        `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`,
        { method: 'PUT' },
    )
    if (!response.ok) {
        throw new Error(`Could not create Chrome target: ${response.status}`)
    }
    return response.json()
}

async function createCdpClient(ws) {
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true })
        ws.addEventListener('error', reject, { once: true })
    })

    let commandId = 0
    const pending = new Map()
    const listeners = new Set()
    const rejectPending = reason => {
        const error = reason instanceof Error
            ? reason
            : new Error(String(reason ?? 'CDP socket closed'))
        for (const waiter of pending.values()) waiter.reject(error)
        pending.clear()
    }

    ws.addEventListener(
        'close',
        () => rejectPending(new Error('CDP socket closed')),
    )
    ws.addEventListener(
        'error',
        () => rejectPending(new Error('CDP socket failed')),
    )

    ws.addEventListener('message', event => {
        const message = JSON.parse(event.data)
        if (message.id != null) {
            const waiter = pending.get(message.id)
            if (!waiter) return
            pending.delete(message.id)
            if (message.error) {
                waiter.reject(new Error(message.error.message))
            } else {
                waiter.resolve(message.result)
            }
            return
        }
        listeners.forEach(listener => listener(message))
    })

    return {
        send(method, params = {}) {
            const id = ++commandId
            ws.send(JSON.stringify({ id, method, params }))
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject })
            })
        },
        onEvent(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
}

async function terminateProcessTree(pid) {
    if (!pid) return
    if (process.platform !== 'win32') {
        try {
            process.kill(pid, 'SIGKILL')
        } catch {
            // The browser may already have exited cleanly.
        }
        return
    }

    await new Promise(resolve => {
        const killer = spawn(
            'taskkill.exe',
            ['/PID', String(pid), '/T', '/F'],
            {
                stdio: 'ignore',
                windowsHide: true,
            },
        )
        killer.once('exit', resolve)
        killer.once('error', resolve)
    })
}

async function waitForReadyState(cdp) {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
        try {
            const readyState = await evaluate(cdp, 'document.readyState')
            if (readyState === 'interactive' || readyState === 'complete') return
        } catch {
            // The initial about:blank execution context may have been discarded.
        }
        await delay(100)
    }
    throw new Error('Page did not reach an interactive ready state')
}

async function evaluate(cdp, expression) {
    const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    })
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? 'Runtime evaluation failed')
    }
    return result.result.value
}

function simplifyEvent(event) {
    if (event.method === 'Runtime.exceptionThrown') {
        return {
            method: event.method,
            text: event.params.exceptionDetails?.text,
            description: event.params.exceptionDetails?.exception?.description,
        }
    }
    if (event.method === 'Log.entryAdded') {
        return {
            method: event.method,
            level: event.params.entry?.level,
            text: event.params.entry?.text,
            url: event.params.entry?.url,
        }
    }
    return {
        method: event.method,
        type: event.params.type,
        args: event.params.args?.map(argument => argument.value ?? argument.description),
    }
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}
