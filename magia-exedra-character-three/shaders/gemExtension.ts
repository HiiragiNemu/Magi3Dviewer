import * as THREE from 'three';
import type { OfficialMaterialProfile } from '../materialProfile';
import {
    injectOfficialGemShader,
    loadOfficialGemResources,
    type OfficialGemResources,
} from './gem';

export interface ExtendedGemMaterial {
    resources: OfficialGemResources;
    profiles: OfficialMaterialProfile[];
}

/**
 * Extend one shared base material with the official base MatCap and Gem
 * branches. Geometry groups may reference the same
 * material object; loader onBeforeRender changes only scalar uniforms for the
 * current group, while the expensive base/control/matcap textures remain shared.
 */
export async function extendMaterialWithOfficialGem(
    material: THREE.Material,
    profiles: OfficialMaterialProfile[],
    texturePathUrl: Record<string, string> = {},
): Promise<ExtendedGemMaterial> {
    const resources = await loadOfficialGemResources(profiles, texturePathUrl);
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey.bind(material);

    material.onBeforeCompile = function (shader, renderer) {
        previousCompile.call(this, shader, renderer);
        const profile =
            this.userData instanceof Object &&
            'officialMaterialProfile' in this.userData
                ? this.userData.officialMaterialProfile as
                    | OfficialMaterialProfile
                    | undefined
                : undefined
        injectOfficialGemShader(shader, resources, profile ?? profiles[0]);
        // GeneralMaterial has already registered this shader in MaterialUserData.
        // The object is the same, so per-group updates can access the new uniforms.
        if (this.userData && typeof this.userData === 'object') {
            this.userData.shader = shader;
            this.userData.officialMaterialProfiles = profiles;
        }
    };
    material.customProgramCacheKey = () =>
        `${previousKey()}|official-matcap-gem-v5|${profiles.map(x => `${x.name}:${x.matCap.texture ?? x.matCap.source}`).join('|')}`;
    material.needsUpdate = true;

    return { resources, profiles };
}
