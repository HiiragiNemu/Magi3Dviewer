import * as THREE from 'three';

export * from './userdata'
export * from './general'
export * from './BodyInside'
export * from './hair'
export * from './face'
export * from './outline'
export * from './shadow'

export interface MaterialCreationOptions {
    colorMap: string;
    shadowMap?: string;
    ctrlMap?: string;
    alphaSrc?: 'ctrl' | 'shadow';
}

export interface MaterialCreationResult {
    material: THREE.Material
    textures: THREE.Texture[];
    alphaTex?: THREE.Texture;
}
