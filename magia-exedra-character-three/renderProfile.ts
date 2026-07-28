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
    /** Whether this character's hair material serializes the AngelRing feature. */
    angelRingEnabled: boolean;
    /** Optional profile override derived from official Head geometry and map scale. */
    angelRingBandHalfWidth?: number;
    /** Official `_YuugenHighlight` / Hair UV AngelRing material mode. */
    hairUvAngelRing?: boolean;
    notes?: string[];
}

/**
 * ReDriveToonMaterialController.TransformDirection values recovered from the
 * processed IL2CPP dump:
 *
 * 0 X, 1 Y, 2 Z, 3 negX, 4 negY, 5 negZ.
 *
 * Do not infer AngelRing from the existence of `_AngelRingMap`: the common
 * Shader property is serialized on every ReDriveToon material. Feature state is
 * character/material specific. Ashley 110701 has no serialized
 * `_USE_ANGEL_RING` keyword; Madoka 100107 does.
 */
const CHARACTER_PROFILES = new Map<number, CharacterReDriveProfile>([
    [100107, {
        characterId: 100107,
        source: 'official-export',
        headBoneName: 'Head',
        faceForwardAxis: '-x',
        faceUpAxis: 'y',
        faceRightAxis: 'z',
        headOffset: 0.167,
        angelRingEnabled: true,
        angelRingBandHalfWidth: 0.030,
        hairUvAngelRing: false,
        notes: [
            '鹿目まどか / chara_100107_battle_unit.',
            'Controller: forward=negX, up=Y, right=Z, headOffset=0.167.',
            'Hair serializes `_USE_ANGEL_RING`; `_YuugenHighlight=0`.',
        ],
    }],
    [110701, {
        characterId: 110701,
        source: 'official-export',
        headBoneName: 'Head',
        faceForwardAxis: '-x',
        faceUpAxis: 'y',
        faceRightAxis: 'z',
        headOffset: 0.2,
        angelRingEnabled: false,
        hairUvAngelRing: false,
        notes: [
            'Ashley Taylor / chara_110701_battle_unit.',
            'Controller: forward=negX, up=Y, right=Z, headOffset=0.2.',
            'Hair does not serialize `_USE_ANGEL_RING`; do not apply the global fake band.',
            'FBX material graph confirms Aniso, Gem/MatCap and material-specific OutlineOffset variants.',
        ],
    }],
]);

/**
 * Unknown characters default to no synthetic AngelRing. The former global
 * fallback painted an unsupported white band on every hairstyle and was worse
 * than omitting the feature. The all-character official profile database will
 * replace these estimates incrementally.
 */
const DEFAULT_PROFILE: Omit<CharacterReDriveProfile, 'characterId'> = {
    source: 'estimated',
    headBoneName: 'Head',
    faceForwardAxis: '-x',
    faceUpAxis: 'y',
    faceRightAxis: 'z',
    angelRingEnabled: false,
    notes: ['No official character profile loaded; AngelRing remains disabled.'],
};

export function getCharacterReDriveProfile(characterId: number): CharacterReDriveProfile {
    return CHARACTER_PROFILES.get(characterId) ?? {
        characterId,
        ...DEFAULT_PROFILE,
    };
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

/** Select the character Head bone, excluding duplicate weapon skeletons. */
export function findCharacterHeadBone(
    root: THREE.Object3D,
    profile: CharacterReDriveProfile,
): THREE.Object3D | undefined {
    const candidates: THREE.Object3D[] = [];
    root.traverse(object => {
        if (object.name === profile.headBoneName && !hasWeaponAncestor(object)) {
            candidates.push(object);
        }
    });

    return candidates.find(x => hasNamedAncestor(x, 'Neck'))
        ?? candidates.find(x => x instanceof THREE.Bone)
        ?? candidates[0];
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

const BOX_CORNERS = [
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
];

function setBoxCorners(box: THREE.Box3): THREE.Vector3[] {
    const { min, max } = box;
    return BOX_CORNERS.map((corner, index) => corner.set(
        index & 1 ? max.x : min.x,
        index & 2 ? max.y : min.y,
        index & 4 ? max.z : min.z,
    ));
}

/**
 * Build the official coordinate model (Head position + rotated face axes).
 * Unknown or explicitly disabled characters return no reference, preventing the
 * renderer from attaching the AngelRing shader path at all.
 */
export function createAngelRingReference(
    root: THREE.Object3D,
    hairMesh: THREE.Mesh,
    profile: CharacterReDriveProfile,
): AngelRingReference | undefined {
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

export interface MaterialFeatureProfile {
    anisotropy: boolean;
    outlineOffset: boolean;
    skinOutlineOffset: boolean;
    specialJewel: boolean;
}

export function inferMaterialFeatures(materialNames: string[]): MaterialFeatureProfile {
    const lower = materialNames.map(x => x.toLowerCase());
    return {
        anisotropy: lower.some(x => x.includes('aniso')),
        outlineOffset: lower.some(x => x.includes('outlineoffset')),
        skinOutlineOffset: lower.some(x => x.includes('outlineoffset_skin')),
        specialJewel: lower.some(x => x.includes('_sj') || x.includes('jewel') || x.includes('gem')),
    };
}
