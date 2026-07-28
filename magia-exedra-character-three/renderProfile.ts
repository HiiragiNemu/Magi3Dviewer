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
 * Ashley serializes forward=3, up=1, right=2 and headOffset=0.2. The serialized
 * forward vector points into the face under the exported FBX/Three handedness;
 * camera-facing and shading calculations require the outward inverse (+X). This
 * conversion is verified by the browser front/back regression: local +X maps to
 * the visible face direction, while local -X maps to the rear hair.
 */
const CHARACTER_PROFILES = new Map<number, CharacterReDriveProfile>([
    [110701, {
        characterId: 110701,
        source: 'official-export',
        headBoneName: 'Head',
        faceForwardAxis: 'x',
        faceUpAxis: 'y',
        faceRightAxis: 'z',
        headOffset: 0.2,
        hairUvAngelRing: false,
        notes: [
            'Ashley Taylor / chara_110701_battle_unit.',
            'Native controller: forward=negX, up=Y, right=Z, headOffset=0.2.',
            'Web outward face direction is the inverse of the native serialized forward axis.',
            'Hair material: _IsHair=1, _YuugenHighlight=0, _UseRimLight=1.',
            'FBX material graph confirms Aniso, Gem/MatCap and material-specific OutlineOffset variants.',
        ],
    }],
]);

/**
 * Generic values remain explicitly estimated. The direction fallback follows
 * the visible outward direction of the current FBX corpus. Each character should
 * ultimately receive its serialized controller profile and conversion metadata.
 */
const DEFAULT_PROFILE: Omit<CharacterReDriveProfile, 'characterId'> = {
    source: 'estimated',
    headBoneName: 'Head',
    faceForwardAxis: 'x',
    faceUpAxis: 'y',
    faceRightAxis: 'z',
    notes: ['Generic Unity humanoid outward Head-axis fallback; replace with an official exported profile.'],
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
 *
 * Long hair and twin tails extend far below the Head. The fallback uses only
 * crown height above the Head bone; an official serialized `headOffset` always
 * takes precedence.
 */
export function createAngelRingReference(
    root: THREE.Object3D,
    hairMesh: THREE.Mesh,
    profile: CharacterReDriveProfile,
): AngelRingReference | undefined {
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
    const estimatedBandHalfWidth = THREE.MathUtils.clamp(crownHeight * 0.18, 0.024, 0.060);

    return {
        headBone,
        localUp: axisToVector(profile.faceUpAxis),
        localRight: axisToVector(profile.faceRightAxis),
        localForward: axisToVector(profile.faceForwardAxis),
        headOffset: profile.headOffset ?? estimatedOffset,
        bandHalfWidth: estimatedBandHalfWidth,
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
