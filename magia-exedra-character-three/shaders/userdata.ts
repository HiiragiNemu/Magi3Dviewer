import * as THREE from 'three';
import type { OfficialMaterialProfile } from '../materialProfile';
import type { OfficialCharacterSurfaceSamplingState } from '../texture';

export class MaterialUserData {
    shader?: THREE.WebGLProgramParametersWithUniforms
    shaderUniforms?: ShaderUniformsController
    /**
     * Every FBX draw group owns a distinct Material instance. Keeping the
     * serialized profile on that instance lets onBeforeCompile initialize the
     * correct uniforms on the very first frame.
     */
    officialMaterialProfile?: OfficialMaterialProfile
    /** Actual Texture state after serialized Base/Shadow/Control sampling. */
    officialTextureSampling?: {
        baseMap?: OfficialCharacterSurfaceSamplingState
        shadowTex?: OfficialCharacterSurfaceSamplingState
        controlMap?: OfficialCharacterSurfaceSamplingState
        angelRingMap?: OfficialCharacterSurfaceSamplingState
    }
    /**
     * ShaderLab pass state recovered from the compiled official shader. Unity
     * uses this state after serialized material properties have selected the
     * pass, so it is authoritative when the two disagree.
     */
    officialCompiledPassState?: {
        depthWrite?: boolean
    }
}

export class ShaderUniformsController {
    private _shader: THREE.WebGLProgramParametersWithUniforms

    constructor(shader: THREE.WebGLProgramParametersWithUniforms) {
        this._shader = shader
    }

    loadGlobalOptions() { }

    protected getValue(key: string) {
        return this.getUniform(key)?.value
    }

    protected setValue(key: string, value: unknown) {
        const uniform = this.getUniform(key)
        if (uniform) {
            uniform.value = value
        } else {
            this.setUniform(key, value)
        }
    }

    private getUniform(key: string) {
        return this._shader.uniforms[key] as THREE.IUniform | undefined
    }

    private setUniform(key: string, value: unknown) {
        this._shader.uniforms[key] = { value }
    }
}
