#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'anchor occurs {text.count(old)} times in {path}: {old[:120]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


self_shadow = r'''import * as THREE from 'three'
import type { MagiaExedraScene3D } from '.'

/**
 * Native ReDriveToonSelfShadowPass evidence from the TW AArch64 client.
 * The rendering architecture is shared with JP; TW is used only as a readable
 * control build for recovering the renderer implementation.
 */
export const officialReDriveSelfShadowSettings = Object.freeze({
    enabled: true,
    useMainLightAsCastShadowDirection: false,
    shadowAngleDegrees: 15,
    boundSize: 1,
    resolution: 2048,
    shadowRange: 10,
    depthBias: 1,
    depthBiasScale: 0.005,
    useNdotLFix: true,
    charaBoundSize: [0.75, 1.5, 0.5] as const,
})

export const reDriveSelfShadowUniformState = {
    enabled: { value: 0 },
    map: { value: null as THREE.Texture | null },
    worldToClip: { value: new THREE.Matrix4() },
    param: { value: new THREE.Vector4() },
    range: { value: officialReDriveSelfShadowSettings.shadowRange },
    depthBias: {
        value:
            officialReDriveSelfShadowSettings.depthBias
            * officialReDriveSelfShadowSettings.depthBiasScale,
    },
    lightDirection: { value: new THREE.Vector3(0, 0, 1) },
    useNdotLFix: {
        value: officialReDriveSelfShadowSettings.useNdotLFix ? 1 : 0,
    },
}

export function bindReDriveSelfShadowUniforms(
    shader: THREE.WebGLProgramParametersWithUniforms,
) {
    shader.uniforms.uRdToonSelfShadowEnabled = reDriveSelfShadowUniformState.enabled
    shader.uniforms.tRdToonSelfShadowMap = reDriveSelfShadowUniformState.map
    shader.uniforms.uRdToonSelfShadowWorldToClip = reDriveSelfShadowUniformState.worldToClip
    shader.uniforms.uRdToonSelfShadowParam = reDriveSelfShadowUniformState.param
    shader.uniforms.uRdToonSelfShadowRange = reDriveSelfShadowUniformState.range
    shader.uniforms.uRdToonGlobalSelfShadowDepthBias = reDriveSelfShadowUniformState.depthBias
    shader.uniforms.uRdToonSelfShadowLightDirection = reDriveSelfShadowUniformState.lightDirection
    shader.uniforms.uRdToonSelfShadowUseNdotLFix = reDriveSelfShadowUniformState.useNdotLFix
}

export function injectReDriveSelfShadowShader(
    shader: THREE.WebGLProgramParametersWithUniforms,
) {
    bindReDriveSelfShadowUniforms(shader)
    shader.vertexShader = /* glsl */ `
        varying vec3 vRdToonWorldPosition;
        ${shader.vertexShader}
    `.replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        vRdToonWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
    )
    shader.fragmentShader = /* glsl */ `
        varying vec3 vRdToonWorldPosition;
        uniform sampler2D tRdToonSelfShadowMap;
        uniform float uRdToonSelfShadowEnabled;
        uniform mat4 uRdToonSelfShadowWorldToClip;
        uniform vec4 uRdToonSelfShadowParam;
        uniform float uRdToonSelfShadowRange;
        uniform float uRdToonGlobalSelfShadowDepthBias;
        uniform vec3 uRdToonSelfShadowLightDirection;
        uniform float uRdToonSelfShadowUseNdotLFix;

        float rdToonSelfShadowVisibility(vec3 worldPosition) {
            if (uRdToonSelfShadowEnabled < 0.5) return 1.0;
            vec4 shadowClip =
                uRdToonSelfShadowWorldToClip * vec4(worldPosition, 1.0);
            if (shadowClip.w <= 0.000001) return 1.0;
            vec3 shadowNdc = shadowClip.xyz / shadowClip.w;
            vec2 shadowUv = shadowNdc.xy * 0.5 + 0.5;
            float receiverDepth = shadowNdc.z * 0.5 + 0.5;
            if (
                shadowUv.x <= 0.0 || shadowUv.x >= 1.0 ||
                shadowUv.y <= 0.0 || shadowUv.y >= 1.0 ||
                receiverDepth <= 0.0 || receiverDepth >= 1.0
            ) return 1.0;

            // Native creates a bilinear 16-bit Shadowmap RT. WebGL depth
            // textures are compared explicitly, so use the recovered texel
            // size for a stable 2x2 PCF footprint.
            vec2 texel = max(uRdToonSelfShadowParam.xy, vec2(0.0000001));
            float compareDepth =
                receiverDepth - uRdToonGlobalSelfShadowDepthBias;
            float visibility = 0.0;
            visibility += step(compareDepth, texture2D(
                tRdToonSelfShadowMap,
                shadowUv + texel * vec2(-0.5, -0.5)
            ).r);
            visibility += step(compareDepth, texture2D(
                tRdToonSelfShadowMap,
                shadowUv + texel * vec2( 0.5, -0.5)
            ).r);
            visibility += step(compareDepth, texture2D(
                tRdToonSelfShadowMap,
                shadowUv + texel * vec2(-0.5,  0.5)
            ).r);
            visibility += step(compareDepth, texture2D(
                tRdToonSelfShadowMap,
                shadowUv + texel * vec2( 0.5,  0.5)
            ).r);
            return visibility * 0.25;
        }

        ${shader.fragmentShader}
    `
}

export class ReDriveSelfShadowController {
    private readonly scene: MagiaExedraScene3D
    private readonly shadowCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10)
    private readonly renderTarget: THREE.WebGLRenderTarget
    private readonly shadowView = new THREE.Matrix4()
    private readonly boundsView = new THREE.Matrix4()
    private readonly rotation = new THREE.Matrix4()
    private readonly flipZ = new THREE.Matrix4().makeScale(1, 1, -1)
    private readonly pelvis = new THREE.Vector3()
    private readonly shadowPelvis = new THREE.Vector3()
    private readonly rootPosition = new THREE.Vector3()
    private readonly forward = new THREE.Vector3(0, 0, 1)
    private readonly previousClearColor = new THREE.Color()
    private disposed = false

    constructor(scene: MagiaExedraScene3D) {
        this.scene = scene
        const resolution = officialReDriveSelfShadowSettings.resolution
        const depthTexture = new THREE.DepthTexture(
            resolution,
            resolution,
            THREE.UnsignedIntType,
        )
        depthTexture.format = THREE.DepthFormat
        depthTexture.minFilter = THREE.NearestFilter
        depthTexture.magFilter = THREE.NearestFilter
        depthTexture.generateMipmaps = false
        depthTexture.name = 'ReDrive:_RdToonSelfShadowMapRT:Depth'

        this.renderTarget = new THREE.WebGLRenderTarget(resolution, resolution, {
            depthBuffer: true,
            stencilBuffer: false,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
        })
        this.renderTarget.texture.name = 'ReDrive:_RdToonSelfShadowMapRT:Color'
        this.renderTarget.texture.generateMipmaps = false
        this.renderTarget.depthTexture = depthTexture

        reDriveSelfShadowUniformState.map.value = depthTexture
        reDriveSelfShadowUniformState.param.value.set(
            1 / resolution,
            1 / resolution,
            resolution,
            resolution,
        )
        this.shadowCamera.matrixAutoUpdate = false
    }

    render() {
        if (this.disposed) return
        const characters = this.scene.characters
            .map(entry => entry.character)
            .filter((character): character is NonNullable<typeof character> => Boolean(character))
        if (!officialReDriveSelfShadowSettings.enabled || characters.length === 0) {
            reDriveSelfShadowUniformState.enabled.value = 0
            return
        }

        this.scene.camera.updateMatrixWorld(true)
        if (officialReDriveSelfShadowSettings.useMainLightAsCastShadowDirection) {
            this.scene.directionalLight.updateMatrixWorld(true)
            // Native: mainLight.worldToLocalMatrix * RotateY(pi).
            this.shadowView.copy(this.scene.directionalLight.matrixWorld).invert()
            this.rotation.makeRotationY(Math.PI)
            this.shadowView.multiply(this.rotation)
        } else {
            // Native: RotateX(shadowAngle * Deg2Rad) * camera.worldToCameraMatrix.
            this.rotation.makeRotationX(
                THREE.MathUtils.degToRad(
                    officialReDriveSelfShadowSettings.shadowAngleDegrees,
                ),
            )
            this.shadowView.multiplyMatrices(
                this.rotation,
                this.scene.camera.matrixWorldInverse,
            )
        }
        this.boundsView.multiplyMatrices(this.flipZ, this.shadowView)

        let count = 0
        let left = Infinity
        let right = -Infinity
        let bottom = Infinity
        let top = -Infinity
        let near = Infinity
        let far = -Infinity
        const bound = officialReDriveSelfShadowSettings.boundSize
        const range = officialReDriveSelfShadowSettings.shadowRange

        for (const character of characters) {
            const root = character.object
            root.updateMatrixWorld(true)
            this.getPelvisWorldPosition(root, this.pelvis)
            this.shadowPelvis.copy(this.pelvis).applyMatrix4(this.boundsView)
            if (this.shadowPelvis.z - bound > range) continue
            count++
            left = Math.min(left, this.shadowPelvis.x - bound)
            right = Math.max(right, this.shadowPelvis.x + bound)
            bottom = Math.min(bottom, this.shadowPelvis.y - bound)
            top = Math.max(top, this.shadowPelvis.y + bound)
            near = Math.min(near, this.shadowPelvis.z - bound)
            far = Math.max(far, this.shadowPelvis.z + bound)
        }
        if (count === 0) {
            reDriveSelfShadowUniformState.enabled.value = 0
            return
        }

        // Native flips Z for positive Ortho near/far extents. Three renders
        // down -Z, so the same positive distances feed its Ortho projection.
        near = Math.max(0.01, near)
        far = Math.max(near + 0.01, far)
        this.shadowCamera.left = left
        this.shadowCamera.right = right
        this.shadowCamera.bottom = bottom
        this.shadowCamera.top = top
        this.shadowCamera.near = near
        this.shadowCamera.far = far
        this.shadowCamera.projectionMatrix.makeOrthographic(
            left,
            right,
            top,
            bottom,
            near,
            far,
        )
        this.shadowCamera.projectionMatrixInverse
            .copy(this.shadowCamera.projectionMatrix)
            .invert()
        this.shadowCamera.matrixWorldInverse.copy(this.shadowView)
        this.shadowCamera.matrixWorld.copy(this.shadowView).invert()
        this.shadowCamera.matrixWorld.decompose(
            this.shadowCamera.position,
            this.shadowCamera.quaternion,
            this.shadowCamera.scale,
        )

        reDriveSelfShadowUniformState.worldToClip.value.multiplyMatrices(
            this.shadowCamera.projectionMatrix,
            this.shadowView,
        )
        reDriveSelfShadowUniformState.lightDirection.value
            .copy(this.forward)
            .transformDirection(this.shadowCamera.matrixWorld)
        reDriveSelfShadowUniformState.range.value = range
        reDriveSelfShadowUniformState.depthBias.value =
            officialReDriveSelfShadowSettings.depthBias
            * officialReDriveSelfShadowSettings.depthBiasScale
        reDriveSelfShadowUniformState.useNdotLFix.value =
            officialReDriveSelfShadowSettings.useNdotLFix ? 1 : 0

        this.renderCharactersToDepth(characters)
        reDriveSelfShadowUniformState.enabled.value = 1
        this.scene.scene.userData.reDriveSelfShadow = this.getDebugState()
    }

    getDebugState() {
        return {
            enabled: reDriveSelfShadowUniformState.enabled.value > 0.5,
            source: 'TW-native-ReDriveToonSelfShadowPass',
            ...officialReDriveSelfShadowSettings,
            depthBiasEffective: reDriveSelfShadowUniformState.depthBias.value,
            worldToClip: reDriveSelfShadowUniformState.worldToClip.value.toArray(),
            lightDirection: reDriveSelfShadowUniformState.lightDirection.value.toArray(),
        }
    }

    dispose() {
        this.disposed = true
        this.renderTarget.depthTexture?.dispose()
        this.renderTarget.dispose()
        reDriveSelfShadowUniformState.map.value = null
        reDriveSelfShadowUniformState.enabled.value = 0
    }

    private getPelvisWorldPosition(root: THREE.Object3D, target: THREE.Vector3) {
        let pelvis: THREE.Object3D | undefined
        root.traverse(child => {
            if (pelvis) return
            const normalized = child.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
            if (
                normalized === 'hip'
                || normalized === 'hips'
                || normalized === 'pelvis'
                || normalized.endsWith('_hip')
                || normalized.endsWith('_hips')
                || normalized.endsWith('_pelvis')
            ) pelvis = child
        })
        if (pelvis) return pelvis.getWorldPosition(target)
        // Native fallback: transform.position + Vector3.up * 0.75.
        root.getWorldPosition(this.rootPosition)
        return target.copy(this.rootPosition).addScaledVector(THREE.Object3D.DEFAULT_UP, 0.75)
    }

    private renderCharactersToDepth(
        characters: NonNullable<MagiaExedraScene3D['characters'][number]['character']>[],
    ) {
        const renderer = this.scene.renderer
        const oldTarget = renderer.getRenderTarget()
        const oldAutoClear = renderer.autoClear
        const oldXrEnabled = renderer.xr.enabled
        const oldClearAlpha = renderer.getClearAlpha()
        renderer.getClearColor(this.previousClearColor)
        const outlineStates: Array<[THREE.Object3D, boolean]> = []

        // Never sample the same RT while its depth attachment is being written.
        reDriveSelfShadowUniformState.enabled.value = 0
        for (const character of characters) {
            for (const outline of character.userData.outlineMeshes) {
                outlineStates.push([outline, outline.visible])
                outline.visible = false
            }
        }

        try {
            renderer.xr.enabled = false
            renderer.autoClear = false
            renderer.setRenderTarget(this.renderTarget)
            renderer.setClearColor(0xffffff, 1)
            renderer.clear(true, true, true)
            for (const character of characters) {
                // Use the actual skinned/alpha-tested visible materials so
                // deformation and authored cutouts are retained in the depth RT.
                renderer.render(
                    character.object as unknown as THREE.Scene,
                    this.shadowCamera,
                )
            }
        } finally {
            outlineStates.forEach(([object, visible]) => {
                object.visible = visible
            })
            renderer.setRenderTarget(oldTarget)
            renderer.setClearColor(this.previousClearColor, oldClearAlpha)
            renderer.autoClear = oldAutoClear
            renderer.xr.enabled = oldXrEnabled
        }
    }
}
'''

path = ROOT / 'magia-exedra-character-three/scene/selfShadow.ts'
if path.exists():
    raise SystemExit(f'{path} already exists')
path.write_text(self_shadow, encoding='utf-8')

stylization = ROOT / 'magia-exedra-character-three/shaders/stylization.ts'
replace_once(
    stylization,
    "import { MaterialUserData, ShaderUniformsController } from './userdata';\n",
    "import { MaterialUserData, ShaderUniformsController } from './userdata';\n"
    "import { injectReDriveSelfShadowShader } from '../scene/selfShadow';\n",
)
replace_once(
    stylization,
    "    uniforms.loadGlobalOptions();\n\n    shader.fragmentShader = /* glsl */ `\n",
    "    uniforms.loadGlobalOptions();\n"
    "    injectReDriveSelfShadowShader(shader);\n\n"
    "    shader.fragmentShader = /* glsl */ `\n",
)

general = ROOT / 'magia-exedra-character-three/shaders/general.ts'
replace_once(
    general,
    "            float rdToonBaseWeight = step(rdToonRampLow, rdToonRamp);\n"
    "            if (rdToonRampHigh > rdToonRampLow + 0.00001) {\n"
    "                rdToonBaseWeight = smoothstep(\n"
    "                    rdToonRampLow,\n"
    "                    rdToonRampHigh,\n"
    "                    rdToonRamp\n"
    "                );\n"
    "            }\n\n"
    "            vec3 rdToonBaseColor = diffuseColor.rgb;\n",
    "            float rdToonBaseWeight = step(rdToonRampLow, rdToonRamp);\n"
    "            if (rdToonRampHigh > rdToonRampLow + 0.00001) {\n"
    "                rdToonBaseWeight = smoothstep(\n"
    "                    rdToonRampLow,\n"
    "                    rdToonRampHigh,\n"
    "                    rdToonRamp\n"
    "                );\n"
    "            }\n"
    "            // Dedicated ReDrive self-shadow selects the authored ShadowTex.\n"
    "            rdToonBaseWeight *= rdToonSelfShadowVisibility(\n"
    "                vRdToonWorldPosition\n"
    "            );\n\n"
    "            vec3 rdToonBaseColor = diffuseColor.rgb;\n",
)

face = ROOT / 'magia-exedra-character-three/shaders/face.ts'
replace_once(
    face,
    "            rdCombinedFaceLight = mix(\n"
    "                1.0,\n"
    "                rdCombinedFaceLight,\n"
    "                saturate(uUseFaceGradient)\n"
    "            );\n\n"
    "            faceColor.rgb = mix(\n",
    "            rdCombinedFaceLight = mix(\n"
    "                1.0,\n"
    "                rdCombinedFaceLight,\n"
    "                saturate(uUseFaceGradient)\n"
    "            );\n"
    "            rdCombinedFaceLight *= rdToonSelfShadowVisibility(\n"
    "                vRdToonWorldPosition\n"
    "            );\n\n"
    "            faceColor.rgb = mix(\n",
)

scene_index = ROOT / 'magia-exedra-character-three/scene/index.ts'
replace_once(
    scene_index,
    "import { SceneEffectsController } from './effects'\n",
    "import { SceneEffectsController } from './effects'\n"
    "import { ReDriveSelfShadowController } from './selfShadow'\n",
)
replace_once(
    scene_index,
    "    shadow: SceneShadowController\n    static shadowEnabled = true\n",
    "    shadow: SceneShadowController\n"
    "    selfShadow: ReDriveSelfShadowController\n"
    "    static shadowEnabled = true\n",
)
replace_once(
    scene_index,
    "        this.controls = new OrbitControls(this.camera, this.renderer.domElement);\n"
    "        this.controls.enableDamping = true;\n"
    "        this.controls.target.set(...MagiaExedraScene3D.controlsInitialTarget);\n\n"
    "        this.raycaster = new THREE.Raycaster();\n",
    "        this.controls = new OrbitControls(this.camera, this.renderer.domElement);\n"
    "        this.controls.enableDamping = true;\n"
    "        this.controls.target.set(...MagiaExedraScene3D.controlsInitialTarget);\n\n"
    "        this.selfShadow = new ReDriveSelfShadowController(this)\n\n"
    "        this.raycaster = new THREE.Raycaster();\n",
)
replace_once(
    scene_index,
    "            this.animateLoopCallback()\n\n"
    "            this.effects.outlinePass.enabled = this.characterSelectionVisible\n",
    "            this.animateLoopCallback()\n"
    "            this.selfShadow.render()\n\n"
    "            this.effects.outlinePass.enabled = this.characterSelectionVisible\n",
)

package = ROOT / 'package.json'
replace_once(
    package,
    '"test:release": "node --test ',
    '"test:release": "node --test nativeSelfShadow.test.mjs ',
)

print('native ReDrive self-shadow patch applied')
