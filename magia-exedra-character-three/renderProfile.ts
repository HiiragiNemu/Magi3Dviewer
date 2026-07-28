import * as THREE from 'three';

export type ReDriveAxis = 'x' | 'y' | 'z' | '-x' | '-y' | '-z';

export interface CharacterReDriveProfile {
    characterId: number;
    source: 'official-export' | 'native-schema' | 'estimated';
    headBoneName: string;
    faceForwardAxis: ReDriveAxis;
    faceUpAxis: ReDriveAxis;
    faceRightAxis: ReDriveAxis;
    /** Official serialized ReDriveToonMaterialController value when known. */
    headOffset?: number;
    /**
     * Whether official serialized evidence identifies the hair AngelRing feature.
     * Unity stores this historical local keyword in m_InvalidKeywords for many
     * current materials, so this is capability evidence rather than a claim that
     * m_ValidKeywords contains the variant.
     */
    angelRingEnabled: boolean;
    /** Optional profile override derived from official Head geometry and map scale. */
    angelRingBandHalfWidth?: number;
    /** Official `_YuugenHighlight` / Hair UV AngelRing material mode. */
    hairUvAngelRing?: boolean;
    notes?: string[];
}

/**
 * Generated from 92 official `battle/character/chara_*_battle_unit` bundles.
 *
 * All current character controllers serialize TransformDirection values
 * forward=3 (negX), up=1 (Y), right=2 (Z). Head offsets are character-specific.
 * `_USE_ANGEL_RING` is preserved by Unity in m_InvalidKeywords for 56 characters;
 * because no character has it in m_ValidKeywords, the database records it as
 * capability evidence while Shader-source recovery determines the exact runtime
 * branch. `_YuugenHighlight` is an explicit float and remains authoritative.
 */
const CHARACTER_PROFILES = new Map<number, CharacterReDriveProfile>([
    [100101, { characterId: 100101, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.167, angelRingEnabled: true, hairUvAngelRing: false }],
    [100102, { characterId: 100102, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [100103, { characterId: 100103, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.195, angelRingEnabled: false, hairUvAngelRing: false }],
    [100104, { characterId: 100104, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.17, angelRingEnabled: false, hairUvAngelRing: false }],
    [100105, { characterId: 100105, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.17, angelRingEnabled: false, hairUvAngelRing: false }],
    [100106, { characterId: 100106, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.167, angelRingEnabled: true, hairUvAngelRing: false }],
    [100107, { characterId: 100107, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.167, angelRingEnabled: true, angelRingBandHalfWidth: 0.03, hairUvAngelRing: false }],
    [100201, { characterId: 100201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.19, angelRingEnabled: true, hairUvAngelRing: false }],
    [100202, { characterId: 100202, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100203, { characterId: 100203, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.205, angelRingEnabled: true, hairUvAngelRing: false }],
    [100204, { characterId: 100204, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [100205, { characterId: 100205, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.185, angelRingEnabled: true, hairUvAngelRing: false }],
    [100206, { characterId: 100206, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [100207, { characterId: 100207, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100301, { characterId: 100301, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100302, { characterId: 100302, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100303, { characterId: 100303, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100304, { characterId: 100304, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.195, angelRingEnabled: true, hairUvAngelRing: false }],
    [100305, { characterId: 100305, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100401, { characterId: 100401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.19, angelRingEnabled: true, hairUvAngelRing: false }],
    [100402, { characterId: 100402, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.19, angelRingEnabled: true, hairUvAngelRing: false }],
    [100403, { characterId: 100403, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.19, angelRingEnabled: true, hairUvAngelRing: false }],
    [100501, { characterId: 100501, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.19, angelRingEnabled: true, hairUvAngelRing: false }],
    [100502, { characterId: 100502, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.19, angelRingEnabled: true, hairUvAngelRing: false }],
    [100503, { characterId: 100503, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.19, angelRingEnabled: true, hairUvAngelRing: false }],
    [100504, { characterId: 100504, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.19, angelRingEnabled: true, hairUvAngelRing: false }],
    [100601, { characterId: 100601, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100701, { characterId: 100701, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100702, { characterId: 100702, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100801, { characterId: 100801, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100802, { characterId: 100802, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [100803, { characterId: 100803, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [100804, { characterId: 100804, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100805, { characterId: 100805, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100901, { characterId: 100901, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [100902, { characterId: 100902, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [100903, { characterId: 100903, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [101001, { characterId: 101001, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [101101, { characterId: 101101, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [101201, { characterId: 101201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [101301, { characterId: 101301, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [101401, { characterId: 101401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [101501, { characterId: 101501, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [101601, { characterId: 101601, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [101701, { characterId: 101701, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [101801, { characterId: 101801, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [101901, { characterId: 101901, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [102001, { characterId: 102001, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [102101, { characterId: 102101, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [102201, { characterId: 102201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [102301, { characterId: 102301, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [105901, { characterId: 105901, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [106201, { characterId: 106201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [106301, { characterId: 106301, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [106701, { characterId: 106701, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [106801, { characterId: 106801, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [107001, { characterId: 107001, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [107401, { characterId: 107401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [108101, { characterId: 108101, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: true }],
    [108201, { characterId: 108201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: true }],
    [108301, { characterId: 108301, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: true }],
    [108401, { characterId: 108401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [109201, { characterId: 109201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [109801, { characterId: 109801, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: true }],
    [110701, { characterId: 110701, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [111501, { characterId: 111501, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [111601, { characterId: 111601, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [111701, { characterId: 111701, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [111801, { characterId: 111801, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [112001, { characterId: 112001, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [112501, { characterId: 112501, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [113301, { characterId: 113301, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [113701, { characterId: 113701, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [113801, { characterId: 113801, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [113901, { characterId: 113901, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [114401, { characterId: 114401, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [114501, { characterId: 114501, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [114601, { characterId: 114601, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [114901, { characterId: 114901, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [115001, { characterId: 115001, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: true, hairUvAngelRing: false }],
    [115101, { characterId: 115101, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
    [115201, { characterId: 115201, source: 'official-export', headBoneName: 'Head', faceForwardAxis: '-x', faceUpAxis: 'y', faceRightAxis: 'z', headOffset: 0.2, angelRingEnabled: false, hairUvAngelRing: false }],
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
    const up = axisToVector(profile.faceUpAxis).applyQuaternion(headQuaternion).normalize();
    const right = axisToVector(profile.faceRightAxis).applyQuaternion(headQuaternion).normalize();
    const forward = axisToVector(profile.faceForwardAxis).applyQuaternion(headQuaternion).normalize();
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
        localUp: axisToVector(profile.faceUpAxis),
        localRight: axisToVector(profile.faceRightAxis),
        localForward: axisToVector(profile.faceForwardAxis),
        headOffset: profile.headOffset ?? estimatedOffset,
        bandHalfWidth: profile.angelRingBandHalfWidth ?? estimatedBandHalfWidth,
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
