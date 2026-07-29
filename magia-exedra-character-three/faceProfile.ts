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
    // BEGIN GENERATED JP FACE PROFILES
    [100101, { characterId: 100101, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0044, noseShadowGradientMapYOffset: 0, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [100102, { characterId: 100102, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0044, noseShadowGradientMapYOffset: 0, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100103, { characterId: 100103, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0044, noseShadowGradientMapYOffset: 0, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [100106, { characterId: 100106, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0044, noseShadowGradientMapYOffset: 0, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [100107, { characterId: 100107, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0044, noseShadowGradientMapYOffset: 0, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [100201, { characterId: 100201, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0301, noseShadowGradientMapYOffset: 0.0015, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100202, { characterId: 100202, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.014, noseShadowGradientMapYOffset: 0.0047, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100203, { characterId: 100203, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.014, noseShadowGradientMapYOffset: 0.0047, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100205, { characterId: 100205, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0301, noseShadowGradientMapYOffset: 0.0015, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100207, { characterId: 100207, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.014, noseShadowGradientMapYOffset: 0.0047, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100301, { characterId: 100301, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.003, noseShadowGradientMapYOffset: -0.022, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [100302, { characterId: 100302, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.003, noseShadowGradientMapYOffset: -0.022, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [100303, { characterId: 100303, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.003, noseShadowGradientMapYOffset: -0.022, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [100304, { characterId: 100304, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.003, noseShadowGradientMapYOffset: -0.022, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [100305, { characterId: 100305, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.003, noseShadowGradientMapYOffset: -0.022, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [100401, { characterId: 100401, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0274, noseShadowGradientMapYOffset: -0.0184, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [100402, { characterId: 100402, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0274, noseShadowGradientMapYOffset: -0.0184, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [100403, { characterId: 100403, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0274, noseShadowGradientMapYOffset: -0.0184, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [100501, { characterId: 100501, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0, noseShadowGradientMapYOffset: 0.0169, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100502, { characterId: 100502, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0, noseShadowGradientMapYOffset: 0.0169, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100503, { characterId: 100503, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0, noseShadowGradientMapYOffset: 0.0169, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100504, { characterId: 100504, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0, noseShadowGradientMapYOffset: 0.0169, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100601, { characterId: 100601, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.047, noseShadowGradientMapYOffset: 0, cheekValue: 0.6, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100701, { characterId: 100701, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.018, noseShadowGradientMapYOffset: -0.007, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100702, { characterId: 100702, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.018, noseShadowGradientMapYOffset: -0.007, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100801, { characterId: 100801, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0282, noseShadowGradientMapYOffset: 0, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 0.1 }],
    [100804, { characterId: 100804, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0282, noseShadowGradientMapYOffset: 0, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 0.1 }],
    [100805, { characterId: 100805, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0282, noseShadowGradientMapYOffset: 0, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 0.1 }],
    [100901, { characterId: 100901, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.024, noseShadowGradientMapYOffset: -0.0216, cheekValue: 0.5, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [100903, { characterId: 100903, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.024, noseShadowGradientMapYOffset: -0.0216, cheekValue: 0.5, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [101001, { characterId: 101001, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0079, noseShadowGradientMapYOffset: -0.0197, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [101101, { characterId: 101101, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.003, noseShadowGradientMapYOffset: -0.008, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [101201, { characterId: 101201, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.032, noseShadowGradientMapYOffset: 0, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [101301, { characterId: 101301, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0251, noseShadowGradientMapYOffset: -0.0146, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 0.2 }],
    [101401, { characterId: 101401, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0, noseShadowGradientMapYOffset: -0.01, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [101501, { characterId: 101501, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.088, noseShadowGradientMapYOffset: 0.047, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [101601, { characterId: 101601, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0699, noseShadowGradientMapYOffset: 0.0543, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [101701, { characterId: 101701, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.046, noseShadowGradientMapYOffset: 0.052, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [101801, { characterId: 101801, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.045, noseShadowGradientMapYOffset: 0, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 5.2 }],
    [101901, { characterId: 101901, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0496, noseShadowGradientMapYOffset: 0.028, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [102001, { characterId: 102001, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.007, noseShadowGradientMapYOffset: -0.018, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [102101, { characterId: 102101, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: -0.0609, noseShadowGradientMapYOffset: -0.061, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [102102, { characterId: 102102, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: -0.0609, noseShadowGradientMapYOffset: -0.061, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [102201, { characterId: 102201, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.018, noseShadowGradientMapYOffset: 0, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [102301, { characterId: 102301, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.008, noseShadowGradientMapYOffset: -0.031, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 0.1 }],
    [102401, { characterId: 102401, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.056, noseShadowGradientMapYOffset: 0.036, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [102501, { characterId: 102501, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: -0.0038, noseShadowGradientMapYOffset: -0.029, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 6.01 }],
    [102601, { characterId: 102601, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: -0.0038, noseShadowGradientMapYOffset: -0.029, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 6.01 }],
    [105801, { characterId: 105801, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0575, noseShadowGradientMapYOffset: 0.005, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [105901, { characterId: 105901, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0, noseShadowGradientMapYOffset: -0.025, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [106101, { characterId: 106101, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.04, noseShadowGradientMapYOffset: -0.014, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [106201, { characterId: 106201, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.045, noseShadowGradientMapYOffset: 0.018, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [106701, { characterId: 106701, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.039, noseShadowGradientMapYOffset: -0.0275, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [106801, { characterId: 106801, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0747, noseShadowGradientMapYOffset: 0.0544, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [106901, { characterId: 106901, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.037, noseShadowGradientMapYOffset: -0.015, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [107001, { characterId: 107001, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.017, noseShadowGradientMapYOffset: -0.022, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [107101, { characterId: 107101, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0331, noseShadowGradientMapYOffset: 0.0172, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [107201, { characterId: 107201, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0813, noseShadowGradientMapYOffset: 0.051, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [107401, { characterId: 107401, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0425, noseShadowGradientMapYOffset: 0, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [107601, { characterId: 107601, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.078, noseShadowGradientMapYOffset: -0.004, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [108001, { characterId: 108001, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.082, noseShadowGradientMapYOffset: 0.0328, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [108002, { characterId: 108002, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.082, noseShadowGradientMapYOffset: 0.0328, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [108101, { characterId: 108101, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: -0.0085, noseShadowGradientMapYOffset: -0.045, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [108201, { characterId: 108201, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0664, noseShadowGradientMapYOffset: 0.032, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [108301, { characterId: 108301, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.1, noseShadowGradientMapYOffset: 0.0712, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [108401, { characterId: 108401, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.012, noseShadowGradientMapYOffset: -0.018, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [108601, { characterId: 108601, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.047, noseShadowGradientMapYOffset: 0.047, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [108602, { characterId: 108602, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.047, noseShadowGradientMapYOffset: 0.047, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [109001, { characterId: 109001, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.027, noseShadowGradientMapYOffset: 0.021, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [109201, { characterId: 109201, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0202, noseShadowGradientMapYOffset: -0.0254, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [109801, { characterId: 109801, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.082, noseShadowGradientMapYOffset: 0.049, cheekValue: 0.6, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [110401, { characterId: 110401, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.027, noseShadowGradientMapYOffset: -0.018, cheekValue: 0, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [110701, { characterId: 110701, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0759, noseShadowGradientMapYOffset: 0.05, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [111401, { characterId: 111401, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0853, noseShadowGradientMapYOffset: 0.0772, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [111501, { characterId: 111501, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.038, noseShadowGradientMapYOffset: 0.003, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [111601, { characterId: 111601, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.01, noseShadowGradientMapYOffset: -0.021, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [111701, { characterId: 111701, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.003, noseShadowGradientMapYOffset: -0.022, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [112001, { characterId: 112001, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: -0.004, noseShadowGradientMapYOffset: 0.002, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 0.5 }],
    [112401, { characterId: 112401, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.02, noseShadowGradientMapYOffset: -0.025, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [112501, { characterId: 112501, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0362, noseShadowGradientMapYOffset: 0.0169, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [112601, { characterId: 112601, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.05, noseShadowGradientMapYOffset: 0.035, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [113301, { characterId: 113301, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0054, noseShadowGradientMapYOffset: -0.0234, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [113701, { characterId: 113701, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0044, noseShadowGradientMapYOffset: 0, cheekValue: 0, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [113801, { characterId: 113801, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0048, noseShadowGradientMapYOffset: 0.0072, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [113901, { characterId: 113901, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.003, noseShadowGradientMapYOffset: -0.022, cheekValue: 0.737, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [114401, { characterId: 114401, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.01, noseShadowGradientMapYOffset: 0, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [114501, { characterId: 114501, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.075, noseShadowGradientMapYOffset: 0.03, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 0.065 }],
    [114601, { characterId: 114601, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.038, noseShadowGradientMapYOffset: -0.004, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [114901, { characterId: 114901, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.02, noseShadowGradientMapYOffset: -0.025, cheekValue: 0.7, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [115001, { characterId: 115001, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.0044, noseShadowGradientMapYOffset: 0, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.05, faceOutlineAdjust: 3.3 }],
    [115101, { characterId: 115101, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.02, noseShadowGradientMapYOffset: 0, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 3.3 }],
    [115201, { characterId: 115201, source: 'official-export', useFaceGradientMap: true, faceShadowGradientMapYOffset: 0.005, noseShadowGradientMapYOffset: 0, cheekValue: 1, shadowOffset: 0.3, shadowFeather: 0, faceAreaCameraDepthTextureZWriteOffset: 0.04, faceOutlineAdjust: 0.1 }],
    // 92 resource-character profiles from jp-redrive-character-evidence.json.
    // END GENERATED JP FACE PROFILES
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
