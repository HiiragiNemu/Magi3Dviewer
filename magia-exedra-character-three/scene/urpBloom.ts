import * as THREE from 'three'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'

/**
 * Unity URP 14 / Unity 2022.3 Bloom, ported from the official 2022.3 branch:
 * - Bloom.shader: prefilter, separable 9-tap Gaussian and pyramid upsample
 * - PostProcessPass.cs: half-resolution pyramid, soft knee and scatter mapping
 *
 * This intentionally remains separate from Three's UnrealBloomPass. The two
 * operators use different pyramids, thresholds and blend weights.
 */

const fullscreenVertex = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`

function shader(
    uniforms: Record<string, THREE.IUniform>,
    fragmentShader: string,
): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms,
        vertexShader: fullscreenVertex,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
        toneMapped: false,
    })
}

function target(name: string): THREE.WebGLRenderTarget {
    const result = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
    })
    result.texture.name = name
    result.texture.generateMipmaps = false
    return result
}

function gammaToLinear(value: number): number {
    if (value <= 0.04045) return value / 12.92
    return Math.pow((value + 0.055) / 1.055, 2.4)
}

const prefilterFragment = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uClampMax;
    uniform float uThreshold;
    uniform float uThresholdKnee;
    varying vec2 vUv;

    void main() {
        vec3 color = min(vec3(uClampMax), texture2D(tDiffuse, vUv).rgb);
        float brightness = max(color.r, max(color.g, color.b));
        float softness = clamp(
            brightness - uThreshold + uThresholdKnee,
            0.0,
            2.0 * uThresholdKnee
        );
        softness = (softness * softness) / (4.0 * uThresholdKnee + 1e-4);
        float multiplier = max(brightness - uThreshold, softness)
            / max(brightness, 1e-4);
        gl_FragColor = vec4(max(color * multiplier, vec3(0.0)), 1.0);
    }
`

const blurHorizontalFragment = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexelSize;
    varying vec2 vUv;

    void main() {
        float x = uTexelSize.x * 2.0;
        vec3 color = texture2D(tDiffuse, vUv - vec2(x * 4.0, 0.0)).rgb * 0.01621622;
        color += texture2D(tDiffuse, vUv - vec2(x * 3.0, 0.0)).rgb * 0.05405405;
        color += texture2D(tDiffuse, vUv - vec2(x * 2.0, 0.0)).rgb * 0.12162162;
        color += texture2D(tDiffuse, vUv - vec2(x, 0.0)).rgb * 0.19459459;
        color += texture2D(tDiffuse, vUv).rgb * 0.22702703;
        color += texture2D(tDiffuse, vUv + vec2(x, 0.0)).rgb * 0.19459459;
        color += texture2D(tDiffuse, vUv + vec2(x * 2.0, 0.0)).rgb * 0.12162162;
        color += texture2D(tDiffuse, vUv + vec2(x * 3.0, 0.0)).rgb * 0.05405405;
        color += texture2D(tDiffuse, vUv + vec2(x * 4.0, 0.0)).rgb * 0.01621622;
        gl_FragColor = vec4(color, 1.0);
    }
`

const blurVerticalFragment = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexelSize;
    varying vec2 vUv;

    void main() {
        float y = uTexelSize.y;
        vec3 color = texture2D(tDiffuse, vUv - vec2(0.0, y * 3.23076923)).rgb * 0.07027027;
        color += texture2D(tDiffuse, vUv - vec2(0.0, y * 1.38461538)).rgb * 0.31621622;
        color += texture2D(tDiffuse, vUv).rgb * 0.22702703;
        color += texture2D(tDiffuse, vUv + vec2(0.0, y * 1.38461538)).rgb * 0.31621622;
        color += texture2D(tDiffuse, vUv + vec2(0.0, y * 3.23076923)).rgb * 0.07027027;
        gl_FragColor = vec4(color, 1.0);
    }
`

const upsampleFragment = /* glsl */ `
    uniform sampler2D tHighMip;
    uniform sampler2D tLowMip;
    uniform float uScatter;
    varying vec2 vUv;

    void main() {
        vec3 highMip = texture2D(tHighMip, vUv).rgb;
        vec3 lowMip = texture2D(tLowMip, vUv).rgb;
        gl_FragColor = vec4(mix(highMip, lowMip, uScatter), 1.0);
    }
`

const compositeFragment = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float uIntensity;
    uniform vec3 uTint;
    varying vec2 vUv;

    void main() {
        vec4 source = texture2D(tDiffuse, vUv);
        vec3 bloom = texture2D(tBloom, vUv).rgb * uIntensity * uTint;
        gl_FragColor = vec4(source.rgb + bloom, source.a);
    }
`

export class ReDriveUrpBloomPass extends Pass {
    /** Serialized URP Bloom intensity. */
    intensity = 1
    /** Serialized URP Bloom scatter in [0, 1]. */
    scatter = 0.7
    /** Serialized gamma-space threshold. */
    threshold = 0.8
    /** URP Bloom default when the profile does not override clamp. */
    clamp = 65472
    maxIterations = 6
    tint = new THREE.Color(1, 1, 1)

    private width = 1
    private height = 1
    private readonly mipDown: THREE.WebGLRenderTarget[] = []
    private readonly mipUp: THREE.WebGLRenderTarget[] = []
    private readonly prefilterMaterial: THREE.ShaderMaterial
    private readonly blurHorizontalMaterial: THREE.ShaderMaterial
    private readonly blurVerticalMaterial: THREE.ShaderMaterial
    private readonly upsampleMaterial: THREE.ShaderMaterial
    private readonly compositeMaterial: THREE.ShaderMaterial
    private readonly fsQuad: FullScreenQuad
    private readonly oldClearColor = new THREE.Color()

    constructor() {
        super()
        this.enabled = false
        this.needsSwap = true

        for (let i = 0; i < 6; i++) {
            this.mipDown.push(target(`ReDriveUrpBloom.down${i}`))
            this.mipUp.push(target(`ReDriveUrpBloom.up${i}`))
        }

        this.prefilterMaterial = shader({
            tDiffuse: { value: null },
            uClampMax: { value: this.clamp },
            uThreshold: { value: gammaToLinear(this.threshold) },
            uThresholdKnee: { value: gammaToLinear(this.threshold) * 0.5 },
        }, prefilterFragment)
        this.blurHorizontalMaterial = shader({
            tDiffuse: { value: null },
            uTexelSize: { value: new THREE.Vector2(1, 1) },
        }, blurHorizontalFragment)
        this.blurVerticalMaterial = shader({
            tDiffuse: { value: null },
            uTexelSize: { value: new THREE.Vector2(1, 1) },
        }, blurVerticalFragment)
        this.upsampleMaterial = shader({
            tHighMip: { value: null },
            tLowMip: { value: null },
            uScatter: { value: 0.68 },
        }, upsampleFragment)
        this.compositeMaterial = shader({
            tDiffuse: { value: null },
            tBloom: { value: null },
            uIntensity: { value: this.intensity },
            uTint: { value: new THREE.Color(1, 1, 1) },
        }, compositeFragment)
        this.fsQuad = new FullScreenQuad()
    }

    setSize(width: number, height: number) {
        this.width = Math.max(1, Math.floor(width))
        this.height = Math.max(1, Math.floor(height))
        let mipWidth = Math.max(1, this.width >> 1)
        let mipHeight = Math.max(1, this.height >> 1)
        for (let i = 0; i < this.mipDown.length; i++) {
            this.mipDown[i].setSize(mipWidth, mipHeight)
            this.mipUp[i].setSize(mipWidth, mipHeight)
            mipWidth = Math.max(1, mipWidth >> 1)
            mipHeight = Math.max(1, mipHeight >> 1)
        }
    }

    private draw(
        renderer: THREE.WebGLRenderer,
        material: THREE.ShaderMaterial,
        destination: THREE.WebGLRenderTarget | null,
        clear = true,
    ) {
        this.fsQuad.material = material
        renderer.setRenderTarget(destination)
        if (clear) renderer.clear()
        this.fsQuad.render(renderer)
    }

    render(
        renderer: THREE.WebGLRenderer,
        writeBuffer: THREE.WebGLRenderTarget,
        readBuffer: THREE.WebGLRenderTarget,
        _deltaTime?: number,
        maskActive = false,
    ) {
        const oldClearAlpha = renderer.getClearAlpha()
        const oldAutoClear = renderer.autoClear
        renderer.getClearColor(this.oldClearColor)
        renderer.autoClear = false
        renderer.setClearColor(0x000000, 0)

        const stencil = (renderer as any).state.buffers.stencil
        if (maskActive) stencil.setTest(false)

        const halfWidth = Math.max(1, this.width >> 1)
        const halfHeight = Math.max(1, this.height >> 1)
        const iterations = Math.floor(Math.log2(Math.max(halfWidth, halfHeight)) - 1)
        const mipCount = THREE.MathUtils.clamp(
            iterations,
            1,
            Math.min(this.maxIterations, this.mipDown.length),
        )

        const threshold = gammaToLinear(Math.max(0, this.threshold))
        this.prefilterMaterial.uniforms.tDiffuse.value = readBuffer.texture
        this.prefilterMaterial.uniforms.uClampMax.value = this.clamp
        this.prefilterMaterial.uniforms.uThreshold.value = threshold
        this.prefilterMaterial.uniforms.uThresholdKnee.value = threshold * 0.5
        this.draw(renderer, this.prefilterMaterial, this.mipDown[0])

        let lastDown = this.mipDown[0]
        for (let i = 1; i < mipCount; i++) {
            this.blurHorizontalMaterial.uniforms.tDiffuse.value = lastDown.texture
            this.blurHorizontalMaterial.uniforms.uTexelSize.value.set(
                1 / lastDown.width,
                1 / lastDown.height,
            )
            this.draw(renderer, this.blurHorizontalMaterial, this.mipUp[i])

            this.blurVerticalMaterial.uniforms.tDiffuse.value = this.mipUp[i].texture
            this.blurVerticalMaterial.uniforms.uTexelSize.value.set(
                1 / this.mipUp[i].width,
                1 / this.mipUp[i].height,
            )
            this.draw(renderer, this.blurVerticalMaterial, this.mipDown[i])
            lastDown = this.mipDown[i]
        }

        const scatter = THREE.MathUtils.lerp(
            0.05,
            0.95,
            THREE.MathUtils.clamp(this.scatter, 0, 1),
        )
        this.upsampleMaterial.uniforms.uScatter.value = scatter
        for (let i = mipCount - 2; i >= 0; i--) {
            const lowMip = i === mipCount - 2
                ? this.mipDown[i + 1]
                : this.mipUp[i + 1]
            this.upsampleMaterial.uniforms.tHighMip.value = this.mipDown[i].texture
            this.upsampleMaterial.uniforms.tLowMip.value = lowMip.texture
            this.draw(renderer, this.upsampleMaterial, this.mipUp[i])
        }

        const tintLuma = this.tint.r * 0.2126
            + this.tint.g * 0.7152
            + this.tint.b * 0.0722
        const normalizedTint = this.compositeMaterial.uniforms.uTint.value as THREE.Color
        if (tintLuma > 0) normalizedTint.copy(this.tint).multiplyScalar(1 / tintLuma)
        else normalizedTint.setRGB(1, 1, 1)
        this.compositeMaterial.uniforms.tDiffuse.value = readBuffer.texture
        this.compositeMaterial.uniforms.tBloom.value = (
            mipCount > 1 ? this.mipUp[0] : this.mipDown[0]
        ).texture
        this.compositeMaterial.uniforms.uIntensity.value = Math.max(0, this.intensity)

        if (maskActive) stencil.setTest(true)
        this.draw(
            renderer,
            this.compositeMaterial,
            this.renderToScreen ? null : writeBuffer,
            this.clear,
        )

        renderer.setClearColor(this.oldClearColor, oldClearAlpha)
        renderer.autoClear = oldAutoClear
    }

    dispose() {
        for (const mip of [...this.mipDown, ...this.mipUp]) mip.dispose()
        this.prefilterMaterial.dispose()
        this.blurHorizontalMaterial.dispose()
        this.blurVerticalMaterial.dispose()
        this.upsampleMaterial.dispose()
        this.compositeMaterial.dispose()
        this.fsQuad.dispose()
    }
}
