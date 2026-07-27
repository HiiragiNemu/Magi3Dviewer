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
 * Profiles intentionally separate recovered official values from estimates.
 * Unknown per-character values are not silently branded as official; the loader
 * derives a visible fallback from the Head bone and hair bounds until the
 * AssetBundle MonoBehaviour export supplies the serialized value.
 */
const CHARACTER_PROFILES = new Map<number, CharacterReDriveProfile>([
    [110701, {
        characterId: 110701,
        source: 'native-schema',
        headBoneName: 'Head',
        // The exported FBX faces local -Z. Using +Z projected the AngelRing map
        // onto the rear hair and produced the visible square/wedge artifact.
        faceForwardAxis: '-z',
        faceUpAxis: 'y',
        faceRightAxis: 'x',
        notes: [
            'Ashley Taylor / chara_110701_battle_unit.',
            'FBX material graph confirms Aniso and material-specific OutlineOffset variants.',
            'Serialized headOffset is pending extraction from ReDriveToonMaterialController.',
        ],
    }],
]);

const DEFAULT_PROFILE: Omit<CharacterReDriveProfile, 'characterId'> = {
    source: 'estimated',
    headBoneName: 'Head',
    faceForwardAxis: '-z',
    faceUpAxis: 'y',
    faceRightAxis: 'x',
    notes: ['Generic Head-bone fallback; replace with an official exported profile.'],
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
 * When the serialized headOffset is unavailable, only the numerical
 * offset/width/radius are derived from the current hair bounds and the result is
 * explicitly marked estimated.
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

    let minUp = Infinity;
    let maxUp = -Infinity;
    let radius = 0;
    for (const corner of setBoxCorners(box)) {
        const delta = corner.clone().sub(headPosition);
        const alongUp = delta.dot(up);
        minUp = Math.min(minUp, alongUp);
        maxUp = Math.max(maxUp, alongUp);
        radius = Math.max(radius, Math.abs(delta.dot(right)), Math.abs(delta.dot(forward)));
    }

    const verticalSpan = Math.max(maxUp - minUp, 0.05);
    // Official captures place the band around the upper fringe/crown transition,
    // not at the Head origin. The older 0.48 factor was visibly too low.
    const estimatedOffset = THREE.MathUtils.clamp(
        Math.max(maxUp * 0.70, verticalSpan * 0.58),
        0.075,
        0.34,
    );

    return {
        headBone,
        localUp: axisToVector(profile.faceUpAxis),
        localRight: axisToVector(profile.faceRightAxis),
        localForward: axisToVector(profile.faceForwardAxis),
        headOffset: profile.headOffset ?? estimatedOffset,
        bandHalfWidth: THREE.MathUtils.clamp(verticalSpan * 0.085, 0.022, 0.11),
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
