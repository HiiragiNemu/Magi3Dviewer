import * as THREE from 'three';

export type ReDriveAxis = 'x' | 'y' | 'z' | '-x' | '-y' | '-z';

export interface CharacterReDriveProfile {
    characterId: number;
    /** Style3DCharacterMst ID can differ from the resource-character ID. */
    styleId?: number;
    source: 'official-export' | 'native-schema' | 'estimated';
    headBoneName: string;
    faceForwardAxis: ReDriveAxis;
    faceUpAxis: ReDriveAxis;
    faceRightAxis: ReDriveAxis;
    /** Official serialized ReDriveToonMaterialController value when known. */
    headOffset?: number;
    /**
     * Whether an official `_IsHair` material binds `_AngelRingMap`.
     */
    angelRingEnabled: boolean;
    /** Official `_YuugenHighlight` / Hair UV AngelRing material mode. */
    hairUvAngelRing?: boolean;
    notes?: string[];
}

/**
 * Generated from 92 official `battle/character/chara_*_battle_unit` bundles.
 *
 * All current character controllers serialize TransformDirection values
 * forward=3 (negX), up=1 (Y), right=2 (Z). Head offsets are character-specific.
 * `_USE_ANGEL_RING` is absent from the official ShaderVariantCollection and is
 * deliberately ignored. `_YuugenHighlight` selects the authored UV-highlight
 * texture path.
 */
const CHARACTER_PROFILES = new Map<number, CharacterReDriveProfile>([
    // BEGIN GENERATED JP CHARACTER PROFILES
    [100101, { characterId: 100101, styleId: undefined, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.167, angelRingEnabled: true, hairUvAngelRing: false }],
    [100102, { characterId: 100102, styleId: 100106, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100103, { characterId: 100103, styleId: 100104, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.195, angelRingEnabled: true, hairUvAngelRing: false }],
    [100106, { characterId: 100106, styleId: 100103, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100107, { characterId: 100107, styleId: 100101, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.167, angelRingEnabled: true, hairUvAngelRing: false }],
    [100201, { characterId: 100201, styleId: 100202, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100202, { characterId: 100202, styleId: 100201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100203, { characterId: 100203, styleId: 100203, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100205, { characterId: 100205, styleId: 100204, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100207, { characterId: 100207, styleId: 100206, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100301, { characterId: 100301, styleId: 100301, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100302, { characterId: 100302, styleId: 100304, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100303, { characterId: 100303, styleId: 100302, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100304, { characterId: 100304, styleId: 100305, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100305, { characterId: 100305, styleId: 100306, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100401, { characterId: 100401, styleId: 100401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100402, { characterId: 100402, styleId: 100402, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100403, { characterId: 100403, styleId: 100403, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100501, { characterId: 100501, styleId: 100501, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.206, angelRingEnabled: true, hairUvAngelRing: false }],
    [100502, { characterId: 100502, styleId: 100504, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.206, angelRingEnabled: true, hairUvAngelRing: false }],
    [100503, { characterId: 100503, styleId: 100502, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100504, { characterId: 100504, styleId: 100503, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.206, angelRingEnabled: true, hairUvAngelRing: false }],
    [100601, { characterId: 100601, styleId: 100601, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.177, angelRingEnabled: true, hairUvAngelRing: false }],
    [100701, { characterId: 100701, styleId: 100701, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.185, angelRingEnabled: true, hairUvAngelRing: false }],
    [100702, { characterId: 100702, styleId: 100702, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.185, angelRingEnabled: true, hairUvAngelRing: false }],
    [100801, { characterId: 100801, styleId: 100801, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100804, { characterId: 100804, styleId: 100803, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100805, { characterId: 100805, styleId: 100802, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100901, { characterId: 100901, styleId: 100901, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.159, angelRingEnabled: true, hairUvAngelRing: false }],
    [100903, { characterId: 100903, styleId: 100902, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.159, angelRingEnabled: true, hairUvAngelRing: false }],
    [101001, { characterId: 101001, styleId: 101001, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [101101, { characterId: 101101, styleId: 101101, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.17, angelRingEnabled: true, hairUvAngelRing: false }],
    [101201, { characterId: 101201, styleId: 101201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.147, angelRingEnabled: true, hairUvAngelRing: false }],
    [101301, { characterId: 101301, styleId: 101301, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [101401, { characterId: 101401, styleId: 101401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [101501, { characterId: 101501, styleId: 101501, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [101601, { characterId: 101601, styleId: 101601, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.206, angelRingEnabled: true, hairUvAngelRing: false }],
    [101701, { characterId: 101701, styleId: 101701, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [101801, { characterId: 101801, styleId: 101801, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.175, angelRingEnabled: true, hairUvAngelRing: false }],
    [101901, { characterId: 101901, styleId: 101901, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.18, angelRingEnabled: true, hairUvAngelRing: false }],
    [102001, { characterId: 102001, styleId: 102001, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.158, angelRingEnabled: true, hairUvAngelRing: false }],
    [102101, { characterId: 102101, styleId: 102101, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.17, angelRingEnabled: true, hairUvAngelRing: false }],
    [102102, { characterId: 102102, styleId: 102102, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [102201, { characterId: 102201, styleId: 102201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [102301, { characterId: 102301, styleId: 102301, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.155, angelRingEnabled: true, hairUvAngelRing: false }],
    [102401, { characterId: 102401, styleId: 102401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.192, angelRingEnabled: true, hairUvAngelRing: false }],
    [102501, { characterId: 102501, styleId: 102501, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.208, angelRingEnabled: true, hairUvAngelRing: false }],
    [102601, { characterId: 102601, styleId: 102601, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.208, angelRingEnabled: true, hairUvAngelRing: false }],
    [105801, { characterId: 105801, styleId: 105801, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [105901, { characterId: 105901, styleId: 105901, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.163, angelRingEnabled: true, hairUvAngelRing: false }],
    [106101, { characterId: 106101, styleId: 106101, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [106201, { characterId: 106201, styleId: 106201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [106701, { characterId: 106701, styleId: 106701, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [106801, { characterId: 106801, styleId: 106801, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [106901, { characterId: 106901, styleId: 106901, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [107001, { characterId: 107001, styleId: 107001, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.18, angelRingEnabled: true, hairUvAngelRing: false }],
    [107101, { characterId: 107101, styleId: 107101, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [107201, { characterId: 107201, styleId: 107201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.19, angelRingEnabled: true, hairUvAngelRing: false }],
    [107401, { characterId: 107401, styleId: 107401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.181, angelRingEnabled: true, hairUvAngelRing: false }],
    [107601, { characterId: 107601, styleId: 107601, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.22, angelRingEnabled: true, hairUvAngelRing: false }],
    [108001, { characterId: 108001, styleId: 108001, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.214, angelRingEnabled: true, hairUvAngelRing: false }],
    [108002, { characterId: 108002, styleId: 108002, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [108101, { characterId: 108101, styleId: 108101, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.191, angelRingEnabled: true, hairUvAngelRing: true }],
    [108201, { characterId: 108201, styleId: 108201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.199, angelRingEnabled: true, hairUvAngelRing: true }],
    [108301, { characterId: 108301, styleId: 108301, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.201, angelRingEnabled: true, hairUvAngelRing: true }],
    [108401, { characterId: 108401, styleId: 108401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.19, angelRingEnabled: true, hairUvAngelRing: false }],
    [108601, { characterId: 108601, styleId: 108601, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [108602, { characterId: 108602, styleId: 108602, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [109001, { characterId: 109001, styleId: 109001, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [109201, { characterId: 109201, styleId: 109201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [109801, { characterId: 109801, styleId: 109801, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.204, angelRingEnabled: false, hairUvAngelRing: false }],
    [110401, { characterId: 110401, styleId: 110401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.211, angelRingEnabled: true, hairUvAngelRing: false }],
    [110701, { characterId: 110701, styleId: 110701, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [111401, { characterId: 111401, styleId: 111401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [111501, { characterId: 111501, styleId: 111501, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [111601, { characterId: 111601, styleId: 111601, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [111701, { characterId: 111701, styleId: 111701, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.167, angelRingEnabled: true, hairUvAngelRing: false }],
    [112001, { characterId: 112001, styleId: 112001, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.16, angelRingEnabled: true, hairUvAngelRing: false }],
    [112401, { characterId: 112401, styleId: 112401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.18, angelRingEnabled: true, hairUvAngelRing: false }],
    [112501, { characterId: 112501, styleId: 112501, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.22, angelRingEnabled: true, hairUvAngelRing: false }],
    [112601, { characterId: 112601, styleId: 112601, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.18, angelRingEnabled: true, hairUvAngelRing: false }],
    [113301, { characterId: 113301, styleId: 113301, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.202, angelRingEnabled: true, hairUvAngelRing: false }],
    [113701, { characterId: 113701, styleId: 100102, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.167, angelRingEnabled: true, hairUvAngelRing: false }],
    [113801, { characterId: 113801, styleId: 113801, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.195, angelRingEnabled: true, hairUvAngelRing: false }],
    [113901, { characterId: 113901, styleId: 100303, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [114401, { characterId: 114401, styleId: 114401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [114501, { characterId: 114501, styleId: 114501, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.182, angelRingEnabled: true, hairUvAngelRing: false }],
    [114601, { characterId: 114601, styleId: 114601, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [114901, { characterId: 114901, styleId: 114901, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [115001, { characterId: 115001, styleId: 115001, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.18, angelRingEnabled: true, hairUvAngelRing: false }],
    [115101, { characterId: 115101, styleId: 115101, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.19, angelRingEnabled: true, hairUvAngelRing: false }],
    [115201, { characterId: 115201, styleId: 115201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.215, angelRingEnabled: true, hairUvAngelRing: false }],
    // 92 resource-character profiles from jp-redrive-character-evidence.json.
    // END GENERATED JP CHARACTER PROFILES
]);

const DEFAULT_PROFILE: Omit<CharacterReDriveProfile, 'characterId'> = {
    source: 'estimated',
    headBoneName: 'Head',
    faceForwardAxis: '-x',
    faceUpAxis: 'y',
    faceRightAxis: 'z',
    angelRingEnabled: false,
    notes: ['No official serialized character profile is available; AngelRing remains disabled.'],
};

export function getCharacterReDriveProfile(characterId: number): CharacterReDriveProfile {
    return CHARACTER_PROFILES.get(characterId) ?? { characterId, ...DEFAULT_PROFILE };
}

export function getOfficialCharacterReDriveProfiles(): readonly CharacterReDriveProfile[] {
    return [...CHARACTER_PROFILES.values()];
}

export function axisToVector(axis: ReDriveAxis): THREE.Vector3 {
    switch (axis) {
        case 'x': return new THREE.Vector3(1, 0, 0);
        case 'y': return new THREE.Vector3(0, 1, 0);
        case 'z': return new THREE.Vector3(0, 0, 1);
        case '-x': return new THREE.Vector3(-1, 0, 0);
        case '-y': return new THREE.Vector3(0, -1, 0);
        case '-z': return new THREE.Vector3(0, 0, -1);
    }
}

function hasWeaponAncestor(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
        if (current.name.toLowerCase().includes('weapon')) return true;
        current = current.parent;
    }
    return false;
}

function hasNamedAncestor(object: THREE.Object3D, name: string): boolean {
    let current: THREE.Object3D | null = object.parent;
    while (current) {
        if (current.name === name) return true;
        current = current.parent;
    }
    return false;
}

export function findCharacterHeadBone(root: THREE.Object3D, profile: CharacterReDriveProfile): THREE.Object3D | undefined {
    const candidates: THREE.Object3D[] = [];
    root.traverse(object => {
        if (object.name === profile.headBoneName && !hasWeaponAncestor(object)) candidates.push(object);
    });
    return candidates.find(x => hasNamedAncestor(x, 'Neck')) ?? candidates.find(x => x instanceof THREE.Bone) ?? candidates[0];
}

export interface AngelRingReference {
    headBone: THREE.Object3D;
    localUp: THREE.Vector3;
    localRight: THREE.Vector3;
    localForward: THREE.Vector3;
    headOffset: number;
    bandHalfWidth: number;
    projectionRadius: number;
    uvMode: boolean;
    estimated: boolean;
}

/**
 * Unity and Three's FBX loader expose opposite local-X handedness for these
 * exported character rigs. The serialized ReDrive controller directions are
 * Unity-local axes, so adapt them once before applying the imported Head
 * quaternion. Without this conversion Madoka's serialized negX forward points
 * at the back of the rendered head, which reverses the projected AngelRing
 * front/back response.
 */
function unityDirectionToThreeFbx(axis: ReDriveAxis): THREE.Vector3 {
    const direction = axisToVector(axis);
    direction.x *= -1;
    return direction;
}

const BOX_CORNERS = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

function setBoxCorners(box: THREE.Box3): THREE.Vector3[] {
    const { min, max } = box;
    return BOX_CORNERS.map((corner, index) => corner.set(index & 1 ? max.x : min.x, index & 2 ? max.y : min.y, index & 4 ? max.z : min.z));
}

export function createAngelRingReference(root: THREE.Object3D, hairMesh: THREE.Mesh, profile: CharacterReDriveProfile): AngelRingReference | undefined {
    if (!profile.angelRingEnabled) return undefined;
    const headBone = findCharacterHeadBone(root, profile);
    if (!headBone) return undefined;
    root.updateMatrixWorld(true);
    hairMesh.updateWorldMatrix(true, false);
    headBone.updateWorldMatrix(true, false);
    const headPosition = new THREE.Vector3();
    const headQuaternion = new THREE.Quaternion();
    headBone.getWorldPosition(headPosition);
    headBone.getWorldQuaternion(headQuaternion);
    const up = unityDirectionToThreeFbx(profile.faceUpAxis).applyQuaternion(headQuaternion).normalize();
    const right = unityDirectionToThreeFbx(profile.faceRightAxis).applyQuaternion(headQuaternion).normalize();
    const forward = unityDirectionToThreeFbx(profile.faceForwardAxis).applyQuaternion(headQuaternion).normalize();
    const box = new THREE.Box3().setFromObject(hairMesh);
    if (box.isEmpty()) return undefined;
    let maxUp = -Infinity;
    let radius = 0;
    for (const corner of setBoxCorners(box)) {
        const delta = corner.clone().sub(headPosition);
        maxUp = Math.max(maxUp, delta.dot(up));
        radius = Math.max(radius, Math.abs(delta.dot(right)), Math.abs(delta.dot(forward)));
    }
    const crownHeight = THREE.MathUtils.clamp(maxUp, 0.08, 0.42);
    const estimatedOffset = THREE.MathUtils.clamp(crownHeight * 0.66, 0.055, 0.24);
    const estimatedBandHalfWidth = THREE.MathUtils.clamp(crownHeight * 0.12, 0.020, 0.040);
    return {
        headBone,
        localUp: unityDirectionToThreeFbx(profile.faceUpAxis),
        localRight: unityDirectionToThreeFbx(profile.faceRightAxis),
        localForward: unityDirectionToThreeFbx(profile.faceForwardAxis),
        headOffset: profile.headOffset ?? estimatedOffset,
        bandHalfWidth: estimatedBandHalfWidth,
        projectionRadius: THREE.MathUtils.clamp(radius, 0.12, 0.65),
        uvMode: profile.hairUvAngelRing ?? false,
        estimated: profile.headOffset == undefined,
    };
}

export interface MaterialFeatureProfile { anisotropy: boolean; outlineOffset: boolean; skinOutlineOffset: boolean; specialJewel: boolean; }

export function inferMaterialFeatures(materialNames: string[]): MaterialFeatureProfile {
    const lower = materialNames.map(x => x.toLowerCase());
    return {
        anisotropy: lower.some(x => x.includes('aniso')),
        outlineOffset: lower.some(x => x.includes('outlineoffset')),
        skinOutlineOffset: lower.some(x => x.includes('outlineoffset_skin')),
        specialJewel: lower.some(x => x.includes('_sj') || x.includes('jewel') || x.includes('gem')),
    };
}
