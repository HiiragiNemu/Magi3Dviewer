import * as THREE from 'three';

export let renderer: THREE.WebGLRenderer | undefined

/**
 * Characters must use the renderer created by this function to render correctly
 */
export function createRenderer(parameters?: THREE.WebGLRendererParameters) {
    renderer = new THREE.WebGLRenderer({
        ...parameters,
        stencil: true,
    })

    console.log('MaxAnisotropy:', renderer.capabilities.getMaxAnisotropy())

    return renderer
}
