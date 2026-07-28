import * as THREE from 'three'
import {
    axisToVector,
    findCharacterHeadBone,
    type CharacterReDriveProfile,
} from './renderProfile'

export interface OfficialFaceProfile {
    characterId: number
    source: 'official-export' | 'estimated'
    useFaceGradientMap: boolean
    faceShadowGradientMapYOffset: number
    noseShadowGradientMapYOffset: number
    cheekValue: number
    shadowOffset: number
    shadowFeather: number
    faceAreaCameraDepthTextureZWriteOffset: number
    faceOutlineAdjust: number
}

const OFFICIAL_FACE_PROFILES = new Map<number, OfficialFaceProfile>([
    [100107, {
        characterId: 100107,
        source: 'official-export',
        useFaceGradientMap: true,
        faceShadowGradientMapYOffset: 0.0044,
        noseShadowGradientMapYOffset: 0,
        cheekValue: 1,
        shadowOffset: 0.3,
        shadowFeather: 0,
        faceAreaCameraDepthTextureZWriteOffset: 0.05,
        faceOutlineAdjust: 3.3,
    }],
    [110701, {
        characterId: 110701,
        source: 'official-export',
        useFaceGradientMap: true,
        faceShadowGradientMapYOffset: 0.0759,
        noseShadowGradientMapYOffset: 0.05,
        cheekValue: 0.7,
        shadowOffset: 0.3,
        shadowFeather: 0,
        faceAreaCameraDepthTextureZWriteOffset: 0.04,
        faceOutlineAdjust: 3.3,
    }],
])

const DEFAULT_FACE_PROFILE: Omit<OfficialFaceProfile, 'characterId'> = {
    source: 'estimated',
    useFaceGradientMap: true,
    faceShadowGradientMapYOffset: 0,
    noseShadowGradientMapYOffset: 0,
    cheekValue: 1,
    shadowOffset: 0.3,
    shadowFeather: 0,
    faceAreaCameraDepthTextureZWriteOffset: 0.05,
    faceOutlineAdjust: 3.3,
}

export function getOfficialFaceProfile(characterId: number): OfficialFaceProfile {
    return OFFICIAL_FACE_PROFILES.get(characterId) ?? {
        characterId,
        ...DEFAULT_FACE_PROFILE,
    }
}

export interface FaceDirectionReference {
    headBone: THREE.Object3D
    localForward: THREE.Vector3
    localUp: THREE.Vector3
    localRight: THREE.Vector3
}

export function createFaceDirectionReference(
    root: THREE.Object3D,
    profile: CharacterReDriveProfile,
): FaceDirectionReference | undefined {
    const headBone = findCharacterHeadBone(root, profile)
    if (!headBone) return undefined
    return {
        headBone,
        localForward: axisToVector(profile.faceForwardAxis),
        localUp: axisToVector(profile.faceUpAxis),
        localRight: axisToVector(profile.faceRightAxis),
    }
}
