import * as THREE from 'three'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'

export interface CombatVfxScreenState {
    kawaseBlend: number
    kawasePasses: number
    kawaseDownsample: number
    kawaseOffset: number
    radialBlend: number
    radialPower: number
    radialCenter: [number, number]
    chromaticBlend: number
    chromaticOffsetX: number
}

export const EMPTY_COMBAT_VFX_SCREEN_STATE: Readonly<CombatVfxScreenState> =
    Object.freeze({
        kawaseBlend: 0,
        kawasePasses: 1,
        kawaseDownsample: 1,
        kawaseOffset: 0,
        radialBlend: 0,
        radialPower: 0,
        radialCenter: [0.5, 0.5] as [number, number],
        chromaticBlend: 0,
        chromaticOffsetX: 0,
    })

/**
 * Transient battle Timeline screen tracks.
 *
 * The recovered `Creative/Effect/Particle/Screen` GLES variant establishes
 * the radial center convention and repeated center-directed samples. Kawase
 * blur and chromatic aberration are ReDrive post-process tracks, so they share
 * this one persistent pass rather than allocating render targets per frame.
 */
export class CombatVfxScreenPass extends Pass {
    private readonly material: THREE.ShaderMaterial
    private readonly quad: FullScreenQuad
    private state: CombatVfxScreenState = { ...EMPTY_COMBAT_VFX_SCREEN_STATE }

    constructor() {
        super()
        this.enabled = false
        this.needsSwap = true
        this.material = new THREE.ShaderMaterial({
            name: 'MagiusCombatVfxScreenTracks',
            uniforms: {
                tDiffuse: { value: null },
                uResolution: { value: new THREE.Vector2(1, 1) },
                uKawaseBlend: { value: 0 },
                uKawaseOffset: { value: 0 },
                uKawasePasses: { value: 1 },
                uKawaseDownsample: { value: 1 },
                uRadialBlend: { value: 0 },
                uRadialPower: { value: 0 },
                uRadialCenter: { value: new THREE.Vector2(0.5, 0.5) },
                uChromaticBlend: { value: 0 },
                uChromaticOffsetX: { value: 0 },
            },
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix
                        * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform sampler2D tDiffuse;
                uniform vec2 uResolution;
                uniform float uKawaseBlend;
                uniform float uKawaseOffset;
                uniform float uKawasePasses;
                uniform float uKawaseDownsample;
                uniform float uRadialBlend;
                uniform float uRadialPower;
                uniform vec2 uRadialCenter;
                uniform float uChromaticBlend;
                uniform float uChromaticOffsetX;
                varying vec2 vUv;

                vec3 kawase(vec2 uv) {
                    float passScale = max(1.0, uKawasePasses);
                    float downsample = max(1.0, uKawaseDownsample);
                    vec2 stepUv = vec2(
                        (uKawaseOffset + 0.5) * passScale * downsample
                    ) / max(uResolution, vec2(1.0));
                    return (
                        texture2D(tDiffuse, uv + vec2(stepUv.x, stepUv.y)).rgb
                        + texture2D(tDiffuse, uv + vec2(-stepUv.x, stepUv.y)).rgb
                        + texture2D(tDiffuse, uv + vec2(stepUv.x, -stepUv.y)).rgb
                        + texture2D(tDiffuse, uv - stepUv).rgb
                    ) * 0.25;
                }

                vec3 radial(vec2 uv) {
                    vec2 center = vec2(uRadialCenter.x, 1.0 - uRadialCenter.y);
                    vec2 delta = uv - center;
                    float strength = clamp(uRadialPower / 100.0, 0.0, 1.0);
                    vec3 sum = vec3(0.0);
                    for (int index = 0; index < 8; index++) {
                        float sampleIndex = float(index) / 7.0;
                        sum += texture2D(
                            tDiffuse,
                            center + delta * (1.0 - strength * sampleIndex)
                        ).rgb;
                    }
                    return sum * 0.125;
                }

                void main() {
                    vec4 source = texture2D(tDiffuse, vUv);
                    vec3 color = mix(
                        source.rgb,
                        kawase(vUv),
                        clamp(uKawaseBlend, 0.0, 1.0)
                    );
                    color = mix(
                        color,
                        radial(vUv),
                        clamp(uRadialBlend, 0.0, 1.0)
                    );
                    float channelOffset = uChromaticOffsetX * uChromaticBlend;
                    vec3 aberrated = vec3(
                        texture2D(tDiffuse, vUv + vec2(channelOffset, 0.0)).r,
                        color.g,
                        texture2D(tDiffuse, vUv - vec2(channelOffset, 0.0)).b
                    );
                    color = mix(
                        color,
                        aberrated,
                        clamp(uChromaticBlend, 0.0, 1.0)
                    );
                    gl_FragColor = vec4(color, source.a);
                }
            `,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
        })
        this.quad = new FullScreenQuad(this.material)
    }

    setState(value: CombatVfxScreenState) {
        this.state = {
            ...value,
            radialCenter: [...value.radialCenter],
        }
        const uniforms = this.material.uniforms
        uniforms.uKawaseBlend!.value = value.kawaseBlend
        uniforms.uKawaseOffset!.value = value.kawaseOffset
        uniforms.uKawasePasses!.value = value.kawasePasses
        uniforms.uKawaseDownsample!.value = value.kawaseDownsample
        uniforms.uRadialBlend!.value = value.radialBlend
        uniforms.uRadialPower!.value = value.radialPower
        uniforms.uRadialCenter!.value.set(...value.radialCenter)
        uniforms.uChromaticBlend!.value = value.chromaticBlend
        uniforms.uChromaticOffsetX!.value = value.chromaticOffsetX
        this.enabled = value.kawaseBlend > 0.0001
            || value.radialBlend > 0.0001
            || value.chromaticBlend > 0.0001
    }

    getState(): CombatVfxScreenState {
        return {
            ...this.state,
            radialCenter: [...this.state.radialCenter],
        }
    }

    override setSize(width: number, height: number) {
        this.material.uniforms.uResolution!.value.set(width, height)
    }

    override render(
        renderer: THREE.WebGLRenderer,
        writeBuffer: THREE.WebGLRenderTarget,
        readBuffer: THREE.WebGLRenderTarget,
    ) {
        this.material.uniforms.tDiffuse!.value = readBuffer.texture
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer)
        if (this.clear) renderer.clear()
        this.quad.render(renderer)
    }

    override dispose() {
        this.material.dispose()
        this.quad.dispose()
    }
}
