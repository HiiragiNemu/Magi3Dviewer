import * as THREE from 'three';

export * from './general'
export * from './face'
export * from './outline'

export * from './BodyInside'

export interface MaterialCreationOptions {
    colorMap: string;
    shadowMap?: string;
    ctrlMap?: string;
    alphaSrc?: 'ctrl' | 'shadow';
}

export interface MaterialTexutres {
    textures: THREE.Texture[];
    alphaTex?: THREE.Texture;
}
