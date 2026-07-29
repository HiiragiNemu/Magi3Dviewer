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
 * Extend one shared base material. Geometry groups may reference the same
 * material object; loader onBeforeRender changes only scalar uniforms for the
 * current group, while the expensive base/control/matcap textures remain shared.
 */
export async function extendMaterialWithOfficialGem(
    material: THREE.Material,
    profiles: OfficialMaterialProfile[],
): Promise<ExtendedGemMaterial> {
    const resources = await loadOfficialGemResources(profiles);
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
    material.customProgramCacheKey = () => `${previousKey()}|official-gem-v2|${profiles.map(x => x.name).join('|')}`;
    material.needsUpdate = true;

    return { resources, profiles };
}
