import * as THREE from 'three'

export const OutlineThickness = 0.0024
export const OutlineColor = '#5a5268'

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
            #include <skinning_pars_vertex>

            void main() {
                vUv = uv;

                #include <skinbase_vertex>
                #include <begin_vertex>
                #include <beginnormal_vertex>
                #include <skinnormal_vertex>
                #include <skinning_vertex>

                vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
                vec3 vNormal = normalize(normalMatrix * objectNormal);
                mvPosition.xy += vNormal.xy * uThickness;
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

                #include <colorspace_fragment>
            }
        `,
        side: THREE.BackSide,
        transparent: Boolean(alphaTex),
    })

    if (alphaTex) {
        material.uniforms.tAlpha = { value: alphaTex }
        material.defines.HAS_ALPHA = true
    }

    return material
}

export function addOutlineToMesh(mesh: THREE.Mesh, options?: OutlineMaterialCreationOptions) {
    const outlineMat = createOutlineMaterial(options);
    const outlineMesh = new THREE.SkinnedMesh(mesh.geometry, outlineMat);

    if (mesh instanceof THREE.SkinnedMesh && mesh.skeleton) {
        outlineMesh.bind(mesh.skeleton, mesh.bindMatrix);
    }

    mesh.add(outlineMesh);
    return outlineMesh
}
