import * as THREE from 'three';
import { renderer } from './renderer'

const texLoader = new THREE.TextureLoader()

export async function loadTexture(url: string, textureProps: Partial<THREE.Texture> = {}) {
    const tex = await texLoader.loadAsync(url);
    Object.assign(tex, textureProps)
    return tex;
}

export function MaximizeTextureQuality(...textures: Array<THREE.Texture | null | undefined>) {
    for (const tex of textures) {
        if (tex) {
            tex.magFilter = THREE.LinearFilter
            tex.minFilter = THREE.LinearMipMapLinearFilter
            tex.anisotropy = renderer?.capabilities.getMaxAnisotropy() || THREE.Texture.DEFAULT_ANISOTROPY
        }
    }
}
