import * as THREE from 'three'
import { loadTexture, MaximizeTextureQuality } from './texture'

interface GeneralMaterialCreationOptions {
    colorMap: string
    shadowMap?: string
    ctrlMap?: string
    alphaSrc?: 'ctrl' | 'shadow'
    onBeforeCompile?: (shader: THREE.WebGLProgramParametersWithUniforms) => any
}

interface MaterialTexutres {
    textures: THREE.Texture[],
    alphaTex?: THREE.Texture,
}

/**
 * ```txt
 * color ---\
 *           |--> ctrl[red] -----> final texture
 * shadow --/
 * 
 * ctrl[alpha] / shadow[alpha] --> final alpha map
 * ```
 */
export async function createGeneralMaterial(options: GeneralMaterialCreationOptions): Promise<{ material: THREE.MeshStandardMaterial, textures: MaterialTexutres }> {
    if (options.alphaSrc == 'shadow' && !options.shadowMap) options.alphaSrc = undefined
    if (options.alphaSrc == 'ctrl' && !options.ctrlMap) options.alphaSrc = undefined

    const [colorTex, shadowTex, ctrlTex] = await Promise.all([
        loadTexture(options.colorMap, { colorSpace: THREE.SRGBColorSpace }),
        options.shadowMap ? loadTexture(options.shadowMap, { colorSpace: THREE.SRGBColorSpace }) : Promise.resolve(undefined),
        options.ctrlMap ? loadTexture(options.ctrlMap) : Promise.resolve(undefined),
    ]);

    MaximizeTextureQuality(colorTex, shadowTex, ctrlTex)

    const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        transparent: Boolean(options.alphaSrc),
    });

    material.onBeforeCompile = (shader) => {
        if (!shader.defines) shader.defines = {}

        if (shadowTex) {
            shader.defines.HAS_SHADOW = true
            shader.uniforms.tShadow = { value: shadowTex }
        }
        shader.uniforms.uShadowMix = { value: 0.67 }

        if (ctrlTex) {
            shader.defines.HAS_CTRL = true
            shader.uniforms.tCtrl = { value: ctrlTex }
        }

        shader.fragmentShader = /*glsl*/`
            uniform sampler2D tShadow;
            uniform sampler2D tCtrl;
            uniform float uShadowMix;
            ${shader.fragmentShader}
        `.replace(
            '#include <map_fragment>',
            /*glsl*/`
            // start map_fragment injection
            #include <map_fragment>
            
            #ifdef HAS_CTRL
                vec4 texCtrl = texture2D(tCtrl, vMapUv);
            #endif

            #ifdef HAS_SHADOW
                vec4 texShadow = texture2D(tShadow, vMapUv);
                #ifdef HAS_CTRL
                    diffuseColor.rgb = mix(texShadow.rgb, diffuseColor.rgb, texCtrl.r); // Mix Color and Shadow texture with Ctrl red
                #else
                    diffuseColor.rgb = mix(texShadow.rgb, diffuseColor.rgb, uShadowMix);
                #endif
            #endif
            // end map_fragment injection
            `
        ).replace(
            '#include <roughnessmap_fragment>',
            /*glsl*/`
            float roughnessFactor;

            #ifdef HAS_CTRL
                roughnessFactor = 1.0 - texCtrl.g; // Ctrl green inverted -> Roughness
            #else
                roughnessFactor = roughness; 
            #endif
            `
        ).replace(
            '#include <metalnessmap_fragment>',
            /*glsl*/`
            float metalnessFactor;

            #ifdef HAS_CTRL
                metalnessFactor = texCtrl.b; // Ctrl blue -> Metalness
            #else
                metalnessFactor = metalness; 
            #endif
            `
        ).replace(
            '#include <alphatest_fragment>',
            {
                ctrl: /*glsl*/`diffuseColor.a = texCtrl.a;`,
                shadow: /*glsl*/`diffuseColor.a = texShadow.a;`,
                none: /*glsl*/`diffuseColor.a = 1.0;`,
            }[options.alphaSrc || 'none']
        )

        options.onBeforeCompile && options.onBeforeCompile(shader)

        // console.log(shader.fragmentShader)
    };

    return {
        material,
        textures: {
            textures: [colorTex, shadowTex, ctrlTex].filter(x => x instanceof THREE.Texture),
            alphaTex: {
                ctrl: ctrlTex,
                shadow: shadowTex,
                none: undefined,
            }[options.alphaSrc || 'none']
        }
    }
}

interface FaceMaterialCreationOptions {
    colorMap: string
    shadowMap: string
    ctrlMap?: string
    eyehighlightMap: string
}

export async function createFaceMaterial(options: FaceMaterialCreationOptions): Promise<{ material: THREE.MeshStandardMaterial, textures: MaterialTexutres }> {
    const [colorTex, shadowTex, ctrlTex, eyehighlightTex] = await Promise.all([
        loadTexture(options.colorMap, { colorSpace: THREE.SRGBColorSpace }),
        loadTexture(options.shadowMap, { colorSpace: THREE.SRGBColorSpace }),
        options.ctrlMap ? loadTexture(options.ctrlMap) : Promise.resolve(undefined),
        loadTexture(options.eyehighlightMap),
    ]);

    MaximizeTextureQuality(colorTex, shadowTex, ctrlTex, eyehighlightTex)

    const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        // transparent: true,
    });

    // 2. Inject your custom Blush/Highlight logic
    material.onBeforeCompile = (shader) => {
        if (!shader.defines) shader.defines = {}

        // Add your extra uniforms
        shader.uniforms.tShadow = { value: shadowTex };
        shader.uniforms.tEyehighlight = { value: eyehighlightTex };

        shader.uniforms.uShadowMix = { value: 0.67 }
        shader.uniforms.uHighlightBrightness = { value: 1.0 }
        shader.uniforms.uBlushStrength = { value: 0.33 };

        if (ctrlTex) {
            shader.uniforms.tCtrl = { value: ctrlTex };
            shader.defines.HAS_CTRL = true
        }

        // Update Vertex Shader to handle UV1 (uv1 attribute)
        shader.vertexShader = /*glsl*/`
            attribute vec2 uv1;
            varying vec2 vUv;
            varying vec2 vUv2;
            ${shader.vertexShader}
        `.replace(
            '#include <uv_vertex>',
            /*glsl*/`
            #include <uv_vertex>
            vUv = uv;
            vUv2 = uv1;
            `
        );

        // Update Fragment Shader
        shader.fragmentShader = /*glsl*/`
            varying vec2 vUv;
            varying vec2 vUv2;

            uniform sampler2D tShadow;
            uniform sampler2D tCtrl;
            uniform sampler2D tEyehighlight;
            
            uniform float uShadowMix;
            uniform float uHighlightBrightness;
            uniform float uBlushStrength;
            ${shader.fragmentShader}
        `.replace(
            '#include <map_fragment>',
            /*glsl*/`
            vec4 faceColor = texture2D(map, vUv);
            vec4 faceShadow = texture2D(tShadow, vUv);
            vec4 eyehighlight = texture2D(tEyehighlight, vUv2);
            
            // mix color and shadow map
            #ifdef HAS_CTRL
                // mirror vUv right to the left and reduce range
                float mirroredU = abs(vUv.x - 0.5) / 2.0 + 0.5;
                vec4 faceCtrl = texture2D(tCtrl, vec2(mirroredU, vUv.y));
                faceColor.rgb = mix(faceShadow.rgb, faceColor.rgb, faceCtrl.r);
            #else
                faceColor.rgb = mix(faceShadow.rgb, faceColor.rgb, uShadowMix);
            #endif
            
            float eyeMask = step(vUv2.y, 0.5); // extract eye highlights (bottom-half)
            float highlightIntensity = smoothstep(0.5, 1.0, eyehighlight.r) * eyeMask; // hide pixels with value < 0.5
            vec3 highlightColor = vec3(highlightIntensity * uHighlightBrightness);

            float blushMask = step(0.5, vUv2.y); // extract blush (top-half)
            float blushFactor = eyehighlight.r * blushMask * uBlushStrength; // calculate factor
            vec3 blushCyan = vec3(0.0, blushFactor, blushFactor); // map red to grenn-blue, used for subtraction later

            faceColor.rgb += highlightColor; // add eye highlights
            faceColor.rgb -= blushCyan; // add blush (subtract the inverted red)

            // Apply back to the standard variable 'diffuseColor'
            diffuseColor = faceColor;
            `
        );
    };

    return {
        material,
        textures: {
            textures: [colorTex, shadowTex, ctrlTex, eyehighlightTex].filter(x => x instanceof THREE.Texture)
        }
    }
}

interface OutlineMaterialCreationOptions {
    thickness?: number
    color?: number
    alphaTex?: THREE.Texture
}

export function createOutlineMaterial(options?: OutlineMaterialCreationOptions) {
    const thickness = options?.thickness ?? 0.0035
    const color = options?.color ?? 0x303030
    const alphaTex = options?.alphaTex

    const colorThree = new THREE.Color(color)
    colorThree.convertLinearToSRGB()

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uThickness: { value: thickness },
            uColor: { value: colorThree },
        },
        vertexShader: /*glsl*/`
            uniform float uThickness;
            varying vec2 vUv;
            #include <skinning_pars_vertex> // Required for animated FBX

            void main() {
                vUv = uv;

                #include <skinbase_vertex>
                #include <begin_vertex> // defines transformed as position
                #include <beginnormal_vertex> // defines objectNormal as normal
                #include <skinnormal_vertex> // applies skinning to objectNormal
                #include <skinning_vertex> // applies skinning to transformed position

                // 1. Project position to View Space (before the lens)
                vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);

                // 2. Get the normal in View Space
                vec3 vNormal = normalize(normalMatrix * objectNormal);

                // 3. Offset in View Space (Actual 3D units)
                // This closes gaps because it's 2D-aligned but stays in 3D "meters"
                mvPosition.xy += vNormal.xy * uThickness;

                // 4. Final Projection
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: /*glsl*/`
            uniform vec3 uColor;
            uniform sampler2D tAlpha;
            varying vec2 vUv;

            void main() {
                #ifdef HAS_ALPHA
                    float alpha = texture2D(tAlpha, vUv).a;
                    gl_FragColor = vec4(uColor, alpha);
                #else
                    gl_FragColor = vec4(uColor, 1.0);
                #endif
            }
        `,
        side: THREE.BackSide, // Draw the INSIDE of the shell
        transparent: Boolean(alphaTex),
    })

    if (alphaTex) {
        material.uniforms.tAlpha = { value: alphaTex }
        material.defines.HAS_ALPHA = true
    }

    return material
}

export function addOutlineToMesh(mesh: THREE.Mesh, options?: OutlineMaterialCreationOptions) {
    // Create the outline
    const outlineMat = createOutlineMaterial(options);
    const outlineMesh = new THREE.SkinnedMesh(mesh.geometry, outlineMat);

    // Link the outline skeleton to the body skeleton so they move together
    if (mesh instanceof THREE.SkinnedMesh && mesh.skeleton) {
        outlineMesh.bind(mesh.skeleton, mesh.bindMatrix);
    }

    mesh.add(outlineMesh); // Add it as a child
    return outlineMesh
}
