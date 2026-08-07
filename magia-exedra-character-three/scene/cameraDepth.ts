import * as THREE from 'three'

interface CameraDepthHostCharacter {
    character?: {
        object: THREE.Object3D
        userData: {
            outlineMeshes: THREE.Object3D[]
        }
    }
}

interface CameraDepthHost {
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.Camera & { projectionMatrixInverse: THREE.Matrix4 }
    characters: CameraDepthHostCharacter[]
}

export const reDriveCameraDepthUniformState = {
    enabled: { value: 0 },
    map: { value: null as THREE.DepthTexture | null },
    inverseProjection: { value: new THREE.Matrix4() },
    viewport: { value: new THREE.Vector2(1, 1) },
}

let reDriveCameraDepthRequested = false

/**
 * Marks that at least one compiled ReDrive material contains the current-JP
 * `_UseGemDepthDiff` branch.  The renderer keeps the depth pass dormant until
 * a real consumer exists, avoiding a permanent extra character draw for the
 * common case.
 */
export function requestReDriveCameraDepth() {
    reDriveCameraDepthRequested = true
}

export function getReDriveCameraDepthRequested() {
    return reDriveCameraDepthRequested
}

export function bindReDriveCameraDepthShader(shader: THREE.WebGLProgramParametersWithUniforms | any) {
    shader.uniforms.tRdCameraDepth = reDriveCameraDepthUniformState.map
    shader.uniforms.uRdCameraDepthEnabled = reDriveCameraDepthUniformState.enabled
    shader.uniforms.uRdCameraDepthInvProjection = reDriveCameraDepthUniformState.inverseProjection
    shader.uniforms.uRdCameraDepthViewport = reDriveCameraDepthUniformState.viewport
}

/**
 * Supplies a camera-depth texture for the recovered current-JP GemDepthDiff
 * arithmetic.  The compiled JP fragment formula is exact, but this Web depth
 * transport remains explicitly deferred/approximate until the native camera
 * depth production path, queue filtering and attachment precision are proven.
 *
 * The pass renders only the character scene, using the real skinned/material
 * draw path so alpha-tested deformation stays aligned with the colour pass.
 */
export class ReDriveCameraDepthController {
    private readonly host: CameraDepthHost
    private readonly target: THREE.WebGLRenderTarget
    private readonly drawingBufferSize = new THREE.Vector2()
    private readonly clearColor = new THREE.Color()
    private disposed = false

    constructor(host: CameraDepthHost) {
        this.host = host
        const depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)
        depthTexture.name = '_CameraDepthTexture:web-transport-approximation'
        depthTexture.format = THREE.DepthFormat
        depthTexture.minFilter = THREE.NearestFilter
        depthTexture.magFilter = THREE.NearestFilter
        depthTexture.generateMipmaps = false

        this.target = new THREE.WebGLRenderTarget(1, 1, {
            depthBuffer: true,
            stencilBuffer: false,
        })
        this.target.texture.name = '_CameraDepthTextureColorScratch'
        this.target.texture.generateMipmaps = false
        this.target.depthTexture = depthTexture
    }

    render() {
        if (this.disposed || !reDriveCameraDepthRequested) {
            reDriveCameraDepthUniformState.enabled.value = 0
            return
        }

        const roots = this.host.characters
            .map(entry => entry.character?.object)
            .filter((value): value is THREE.Object3D => value != undefined)
        if (roots.length === 0) {
            reDriveCameraDepthUniformState.enabled.value = 0
            return
        }

        const { renderer, scene, camera } = this.host
        renderer.getDrawingBufferSize(this.drawingBufferSize)
        const width = Math.max(1, Math.floor(this.drawingBufferSize.x))
        const height = Math.max(1, Math.floor(this.drawingBufferSize.y))
        if (this.target.width !== width || this.target.height !== height) {
            this.target.setSize(width, height)
        }

        camera.updateProjectionMatrix?.()
        reDriveCameraDepthUniformState.inverseProjection.value.copy(
            camera.projectionMatrixInverse,
        )
        reDriveCameraDepthUniformState.viewport.value.set(width, height)

        const allowed = new Set<THREE.Object3D>()
        for (const root of roots) {
            root.traverse(object => allowed.add(object))
        }

        const hidden: Array<{ object: THREE.Object3D; visible: boolean }> = []
        scene.traverse(object => {
            const renderable =
                (object as THREE.Mesh).isMesh
                || (object as THREE.Line).isLine
                || (object as THREE.Points).isPoints
                || (object as THREE.Sprite).isSprite
            if (!renderable || allowed.has(object)) return
            hidden.push({ object, visible: object.visible })
            object.visible = false
        })
        for (const entry of this.host.characters) {
            for (const outline of entry.character?.userData.outlineMeshes ?? []) {
                hidden.push({ object: outline, visible: outline.visible })
                outline.visible = false
            }
        }

        const oldTarget = renderer.getRenderTarget()
        const oldAutoClear = renderer.autoClear
        const oldXrEnabled = renderer.xr.enabled
        const oldClearAlpha = renderer.getClearAlpha()
        renderer.getClearColor(this.clearColor)
        const oldMap = reDriveCameraDepthUniformState.map.value
        const oldEnabled = reDriveCameraDepthUniformState.enabled.value

        try {
            // Merely disabling the branch is not sufficient in WebGL: a depth
            // attachment may not remain bound to an active sampler while it is
            // being written.  Truly unbind it, mirroring the self-shadow fix.
            reDriveCameraDepthUniformState.enabled.value = 0
            reDriveCameraDepthUniformState.map.value = null
            renderer.xr.enabled = false
            renderer.autoClear = true
            renderer.setRenderTarget(this.target)
            renderer.setClearColor(0xffffff, 0)
            renderer.clear(true, true, false)
            renderer.render(scene, camera)
        } finally {
            renderer.setRenderTarget(oldTarget)
            reDriveCameraDepthUniformState.map.value = oldMap
            reDriveCameraDepthUniformState.enabled.value = oldEnabled
            renderer.setClearColor(this.clearColor, oldClearAlpha)
            renderer.autoClear = oldAutoClear
            renderer.xr.enabled = oldXrEnabled
            for (let index = hidden.length - 1; index >= 0; index--) {
                const { object, visible } = hidden[index]
                object.visible = visible
            }
        }

        reDriveCameraDepthUniformState.map.value = this.target.depthTexture ?? null
        reDriveCameraDepthUniformState.enabled.value =
            this.target.depthTexture != undefined ? 1 : 0
        scene.userData.reDriveCameraDepth = {
            source: 'official-jp-current-compiled-gem-formula',
            formulaFidelity: 'exact',
            transportFidelity: 'web-depth-transport-approximation',
            width,
            height,
            requested: reDriveCameraDepthRequested,
            enabled: reDriveCameraDepthUniformState.enabled.value === 1,
            deferred: [
                'native CameraDepthTexture producer/queue filtering parity',
                'native depth attachment precision parity',
                'runtime _Transparency MaterialPropertyBlock/attribute receiver',
            ],
        }
    }

    dispose() {
        if (this.disposed) return
        this.disposed = true
        if (reDriveCameraDepthUniformState.map.value === this.target.depthTexture) {
            reDriveCameraDepthUniformState.map.value = null
            reDriveCameraDepthUniformState.enabled.value = 0
        }
        this.target.dispose()
        this.target.depthTexture?.dispose()
        delete this.host.scene.userData.reDriveCameraDepth
    }
}
