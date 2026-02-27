import * as THREE from 'three'

export const OutlineThickness = 0.0035
export const OutlineColor = '#303030'

interface OutlineMaterialCreationOptions {
    thickness?: number
    color?: THREE.ColorRepresentation
    alphaTex?: THREE.Texture
}

export function createOutlineMaterial(options?: OutlineMaterialCreationOptions) {
    const thickness = options?.thickness ?? OutlineThickness
    const color = options?.color ?? OutlineColor
    const alphaTex = options?.alphaTex

    const colorThree = new THREE.Color(color)

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

                // #include <tonemapping_fragment>
                #include <colorspace_fragment> // enable color space awareness so that we dont need convertLinearToSRGB
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
