import * as THREE from 'three';

export * from './general'
export * from './BodyInside'
export * from './hair'
export * from './face'
export * from './outline'

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

export interface MaterialUserData {
    shader?: THREE.WebGLProgramParametersWithUniforms
}
