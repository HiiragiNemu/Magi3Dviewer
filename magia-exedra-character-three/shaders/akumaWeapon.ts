import * as THREE from 'three'
import type { OfficialCustomCharacterShaderProfile } from '../materialProfile'
import { ApplyOfficialCharacterSurfaceSampling, loadTexture } from '../texture'
import { MaterialUserData } from './userdata'
import type { MaterialCreationResult } from '.'

export const AKUMA_WEAPON_SHADER = 'Creative/Character/UniqueWeapon/AkumaHomuraWeapon'
const textureKeys = ['_2ndFresnelMaskNoise', '_BaseMap', '_1stFresnelMaskNoise', '_HighlightMap'] as const
const scalarKeys = [
    '_1stFresnelStep', '_2ndFresnelMaskNoiseSpeed', '_2ndFresnelMaskNoiseTillingRadial',
    '_2ndFresnelMaskNoiseTillingLength', '_1stFresnelMaskNoiseIntensity',
    '_2ndFresnelMaskNoiseIntensity', '_2ndFresnellStep', '_HighlightIntensity',
    '_1stFresnelMaskNoiseSpeed', '_HighlightTilling', '_HighlightSpeed',
    '_1stFresnelMaskNoiseTilling', '_BaseSpeed', '_BaseTilling',
] as const

/** CAB-62882fe585c4c287c90d9badf26fab6e forward PS blob8.
 * This is an unlit four-texture shader, not a ReDrive fallback. The material
 * origin (not face/head) anchors its screen projection. Native .05, 100,
 * 1.001, .159236, 1e-5 and highlight clamping literals are retained below. */
export const akumaWeaponVertexShader = /* glsl */`
    uniform vec2 uAkumaAspect;
    uniform float uAkumaFov;
    uniform float uAkumaOrtho;
    uniform float uAkumaOrthoHalfHeight;
    varying vec3 vAkumaViewPosition;
    varying vec3 vAkumaViewNormal;
    varying vec4 vAkumaRect;
    #include <common>
    #include <morphtarget_pars_vertex>
    #include <skinning_pars_vertex>
    void main() {
        #include <beginnormal_vertex>
        #include <morphnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <morphtarget_vertex>
        #include <skinning_vertex>
        vec4 pos = modelViewMatrix * vec4(transformed, 1.0);
        vAkumaViewPosition = pos.xyz;
        vAkumaViewNormal = normalize(normalMatrix * objectNormal);
        vec4 originView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 originClip = projectionMatrix * originView;
        float scale = mix(originView.z * uAkumaFov * 0.05,
            uAkumaOrthoHalfHeight * 5.0, uAkumaOrtho) * uAkumaAspect.x;
        // Preserve signed view depth. abs(depth) would mirror the flipbooks.
        vAkumaRect = vec4(originClip.xy / originClip.w, uAkumaAspect / scale);
        gl_Position = projectionMatrix * pos;
    }
`

export const akumaWeaponFragmentShader = /* glsl */`
    uniform sampler2D _2ndFresnelMaskNoise;
    uniform sampler2D _BaseMap;
    uniform sampler2D _1stFresnelMaskNoise;
    uniform sampler2D _HighlightMap;
    uniform vec2 _1stFresnelMaskNoiseSheet, _BaseSheet, _HighlightSheet;
    uniform vec4 _1stColor, _2ndColor;
    uniform float _1stFresnelStep, _2ndFresnellStep;
    uniform float _2ndFresnelMaskNoiseSpeed, _2ndFresnelMaskNoiseTillingRadial;
    uniform float _2ndFresnelMaskNoiseTillingLength, _1stFresnelMaskNoiseIntensity;
    uniform float _2ndFresnelMaskNoiseIntensity, _HighlightIntensity;
    uniform float _1stFresnelMaskNoiseSpeed, _HighlightTilling, _HighlightSpeed;
    uniform float _1stFresnelMaskNoiseTilling, _BaseSpeed, _BaseTilling;
    uniform float uAkumaTime, uAkumaOrtho, uAkumaDitherFade, uAkumaAlphaToMask;
    uniform vec2 uAkumaViewport;
    varying vec3 vAkumaViewPosition, vAkumaViewNormal;
    varying vec4 vAkumaRect;
    #include <common>
    float akumaFresnel(float ndv, float edge) {
        float t = clamp((ndv - 1.001) / (edge - 1.001), 0.0, 1.0);
        return t * t * (3.0 - 2.0 * t);
    }
    vec2 akumaFlipbook(vec2 uv, vec2 sheet, float speed) {
        float count = sheet.x * sheet.y;
        float phase = (speed * uAkumaTime + 0.00001) / count;
        // HLSL fmod is sign-preserving, unlike GLSL mod for negative time.
        float tile = floor(sign(phase) * fract(abs(phase)) * count);
        float row = floor((tile + 0.5) / sheet.x);
        vec2 cell = vec2(tile - sheet.x * row, sheet.y - (row + 1.0));
        return (uv + cell) / sheet;
    }
    vec2 akumaProjection(vec2 ndc, float tiling) {
        return (ndc * (tiling * 100.0) - (vAkumaRect.xy - vAkumaRect.zw)) /
            (vAkumaRect.zw * 2.0);
    }
    float akumaDither(vec2 pixel) {
        vec2 p = mod(floor(pixel), 4.0);
        float i = p.x * 4.0 + p.y;
        if (i < 0.5) return 1.0/17.0;
        if (i < 1.5) return 9.0/17.0;
        if (i < 2.5) return 3.0/17.0;
        if (i < 3.5) return 11.0/17.0;
        if (i < 4.5) return 13.0/17.0;
        if (i < 5.5) return 5.0/17.0;
        if (i < 6.5) return 15.0/17.0;
        if (i < 7.5) return 7.0/17.0;
        if (i < 8.5) return 4.0/17.0;
        if (i < 9.5) return 12.0/17.0;
        if (i < 10.5) return 2.0/17.0;
        if (i < 11.5) return 10.0/17.0;
        if (i < 12.5) return 16.0/17.0;
        if (i < 13.5) return 8.0/17.0;
        if (i < 14.5) return 14.0/17.0;
        return 6.0/17.0;
    }
    void main() {
        float keep = 0.5 - uAkumaDitherFade * (1.5 - akumaDither(gl_FragCoord.xy));
        float coverage = keep >= 1.0 ? 1.0 : clamp(keep * 10000.0 + 1.0, 0.0, 1.0);
        float alpha = uAkumaAlphaToMask > 0.5 ? coverage : 1.0;
        float cutoff = uAkumaAlphaToMask > 0.5 && keep < 1.0 ? coverage - 0.0001 : keep;
        if (cutoff < 0.0) discard;
        vec3 n = normalize(vAkumaViewNormal);
        vec3 v = uAkumaOrtho > 0.5 ? vec3(0.0, 0.0, 1.0) : normalize(-vAkumaViewPosition);
        float ndv = dot(n, v);
        vec2 polar = fract(vec2(
            length(n.xy) * (2.0 * _2ndFresnelMaskNoiseTillingRadial) + _2ndFresnelMaskNoiseSpeed * uAkumaTime,
            atan(n.x, n.y) * _2ndFresnelMaskNoiseTillingLength * 0.159236));
        float secondNoise = texture2D(_2ndFresnelMaskNoise, polar).r;
        float secondMask = 1.0 - _2ndFresnelMaskNoiseIntensity * (secondNoise - 1.0);
        vec3 second = clamp(vec3(1.0) + secondMask * (_2ndColor.rgb - 1.0) *
            akumaFresnel(ndv, _2ndFresnellStep), 0.0, 1.0);
        vec2 ndc = gl_FragCoord.xy / uAkumaViewport * 2.0 - 1.0;
        float firstNoise = texture2D(_1stFresnelMaskNoise, akumaFlipbook(
            akumaProjection(ndc, _1stFresnelMaskNoiseTilling),
            _1stFresnelMaskNoiseSheet, _1stFresnelMaskNoiseSpeed)).r;
        float firstMask = 1.0 - _1stFresnelMaskNoiseIntensity * (firstNoise - 1.0);
        vec3 first = clamp(vec3(1.0) + firstMask * (_1stColor.rgb - 1.0) *
            akumaFresnel(ndv, _1stFresnelStep), 0.0, 1.0);
        vec3 base = texture2D(_BaseMap, akumaFlipbook(akumaProjection(ndc, _BaseTilling), _BaseSheet, _BaseSpeed)).rgb;
        vec3 highlight = texture2D(_HighlightMap, akumaFlipbook(
            akumaProjection(ndc, _HighlightTilling), _HighlightSheet, _HighlightSpeed)).rgb;
        vec3 color = first * second * base;
        vec3 dodge = color / (1.0 - clamp(highlight, 0.000001, 0.999999));
        gl_FragColor = vec4(color + _HighlightIntensity * (dodge - color), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`

export async function createOfficialAkumaWeaponMaterial(
    profile: OfficialCustomCharacterShaderProfile,
    resolveTexture?: (name: string) => string | undefined,
): Promise<MaterialCreationResult> {
    const authored = profile.akumaWeapon
    if (profile.name !== AKUMA_WEAPON_SHADER || !authored || !resolveTexture) {
        throw new Error(`Missing serialized Akuma weapon payload: ${profile.name}`)
    }
    const uniforms: Record<string, THREE.IUniform> = {
        uAkumaTime: { value: 0 }, uAkumaViewport: { value: new THREE.Vector2(1, 1) },
        uAkumaAspect: { value: new THREE.Vector2(1, 1) }, uAkumaFov: { value: 1 },
        uAkumaOrtho: { value: 0 }, uAkumaOrthoHalfHeight: { value: 1 },
        uAkumaDitherFade: { value: profile.ditherFade }, uAkumaAlphaToMask: { value: 0 },
    }
    for (const key of scalarKeys) {
        const value = authored.floats[key]
        if (!Number.isFinite(value)) throw new Error(`Missing Akuma scalar ${key}`)
        uniforms[key] = { value }
    }
    for (const key of ['_1stColor', '_2ndColor', '_1stFresnelMaskNoiseSheet', '_BaseSheet', '_HighlightSheet']) {
        const value = authored.colors[key]
        if (value?.length !== 4 || !value.every(Number.isFinite)) throw new Error(`Missing Akuma color/vector ${key}`)
        const sheet = key.endsWith('Sheet')
        if (sheet && (!Number.isInteger(value[0]) || !Number.isInteger(value[1]) || value[0] <= 0 || value[1] <= 0)) {
            throw new Error(`Invalid Akuma sheet ${key}`)
        }
        uniforms[key] = { value: sheet ? new THREE.Vector2(value[0], value[1]) : new THREE.Vector4(...value) }
    }
    const bindings = textureKeys.map(key => {
        const binding = authored.textures[key]
        const url = binding?.name ? resolveTexture(binding.name) : undefined
        if (!url || !binding.sampler || binding.pathId === '0') throw new Error(`Missing Akuma texture ${key}: ${binding?.name}`)
        return { key, binding, url }
    })
    const textures: THREE.Texture[] = []
    try {
        for (const { key, binding, url } of bindings) {
            const texture = await loadTexture(url)
            textures.push(texture)
            ApplyOfficialCharacterSurfaceSampling(texture, binding.name, binding.sampler)
            uniforms[key] = { value: texture }
        }
    } catch (error) {
        textures.forEach(texture => texture.dispose())
        throw error
    }
    const material = new THREE.ShaderMaterial({
        name: profile.name, uniforms, vertexShader: akumaWeaponVertexShader,
        fragmentShader: akumaWeaponFragmentShader, side: THREE.FrontSide,
        depthTest: true, depthWrite: true, depthFunc: THREE.LessEqualDepth,
        blending: THREE.NoBlending, transparent: false, alphaToCoverage: true,
    })
    const userData = new MaterialUserData()
    Object.assign(userData, {
        officialCompiledPassState: { depthWrite: true },
        officialCustomCharacterShader: { shader: profile.name, compiledPass: 'Universal Forward/VS1/PS8',
            source: authored.source, textureBindings: authored.textures, projectionAnchor: 'unity_ObjectToWorld.translation',
            outlinePass: false, runtimeCapture: false },
    })
    material.userData = userData
    material.onBeforeCompile = shader => { userData.shader = shader }
    material.onBeforeRender = (renderer, _scene, camera) => {
        // Native Forward is Always/Keep. The loader's legacy whole-weapon
        // stencil helper must not turn this dedicated pass into a writer.
        material.stencilWrite = false
        setOfficialAkumaWeaponRuntimeUniforms(uniforms, renderer, camera)
    }
    material.customProgramCacheKey = () => `official-akuma-weapon-v1:${JSON.stringify(authored)}`
    return { material, textures }
}

const viewport = new THREE.Vector2()
export function setOfficialAkumaWeaponRuntimeUniforms(
    uniforms: Record<string, THREE.IUniform>, renderer: THREE.WebGLRenderer, camera: THREE.Camera,
) {
    if (!uniforms.uAkumaTime) return // Depth override is not the forward program.
    const target = renderer.getRenderTarget()
    if (target) viewport.set(target.width, target.height)
    else renderer.getDrawingBufferSize(viewport)
    uniforms.uAkumaTime.value = performance.now() * 0.001
    uniforms.uAkumaAlphaToMask.value = target ? Number(target.samples > 0) : Number(renderer.getContext().getContextAttributes()?.antialias === true)
    uniforms.uAkumaViewport.value.copy(viewport)
    uniforms.uAkumaAspect.value.set(viewport.y / viewport.x, 1)
    uniforms.uAkumaOrtho.value = camera instanceof THREE.OrthographicCamera ? 1 : 0
    if (camera instanceof THREE.PerspectiveCamera) uniforms.uAkumaFov.value = camera.fov
    if (camera instanceof THREE.OrthographicCamera) uniforms.uAkumaOrthoHalfHeight.value = Math.abs(camera.top - camera.bottom) / (2 * camera.zoom)
}
