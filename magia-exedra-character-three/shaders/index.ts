import * as THREE from 'three';
import type { MaterialFeatureProfile } from '../renderProfile';
import type { OfficialMaterialProfile } from '../materialProfile';

export * from './userdata'
export * from './general'
export * from './BodyInside'
export * from './hair'
export * from './face'
export * from './outline'
export * from './shadow'
export * from './stylization'
export * from './gem'

export interface MaterialCreationOptions {
    colorMap: string;
    shadowMap?: string;
    ctrlMap?: string;
    alphaSrc?: 'ctrl' | 'shadow';
    materialNames?: string[];
    featureProfile?: MaterialFeatureProfile;
    materialProfiles?: OfficialMaterialProfile[];
    specularGradientMap?: string;
}

export interface MaterialCreationResult {
    material: THREE.Material
    textures: THREE.Texture[];
    alphaTex?: THREE.Texture;
}
