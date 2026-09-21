import type { OfficialMaterialProfile, OfficialTextureSamplerProfile } from './materialProfile';
import * as THREE from 'three';
import type { OfficialCharacterSurfaceSamplingState } from './texture';
import type { NativeControllerBindings } from './nativeCharacterController';

export interface NativeModelIdentity {
    characterId: number;
    styleId: number;
    sourceCommit: string;
    serializedPlatform: number;
    serializedFormat: number;
    unityVersion: string | null;
    versionStatus: string;
}
export interface NativePPtr {
    pathId: string; targetCab?: string; status: 'NULL' | 'RESOLVED';
    name?: string; type?: string;
}
export interface NativeTextureEnvironment {
    property: string; texture: NativePPtr;
    scale: { x: number; y: number }; offset: { x: number; y: number };
}
export interface NativeBlankField { profilePath: string; sourceProperty: string; status: 'BLANK'; reason: string }
export interface NativeMaterialEntry {
    identity: { cab: string; pathId: string; name: string };
    shader: NativePPtr;
    profile: Record<string, unknown>;
    typedBlanks: NativeBlankField[];
    native: {
        cab: string; pathId: string; name: string;
        savedFloats: [string, number][]; savedInts: [string, number][];
        savedColors: [string, { r: number; g: number; b: number; a: number }][];
        textureEnvs: NativeTextureEnvironment[];
    };
}
export interface NativeTextureEntry {
    identity: { cab: string; pathId: string; name: string };
    sampler: OfficialTextureSamplerProfile;
    png: string;
    payloadMipEvidence: { baseMip: string; remainingMips: string };
    native: { cab: string; pathId: string; name: string };
}
export interface NativeChannelRange { offset: number; byteLength: number; count: number; itemSize: number }
export interface NativeExtraChannel {
    semantic: string; sourceChannelIndex: number;
    serialized: { stream: number; offset: number; format: number; dimension: number };
    componentCount: number; attribute: string; data: NativeChannelRange;
}
export interface NativeMaterialSlot {
    index: number; start: number; count: number;
    materialKey: string; materialName: string; shaderKey: string;
}
export interface NativeMeshBinding {
    key: string; sourceCab: string; meshPathId: string; rendererPathId: string;
    path: string; name: string; sourceVertexCount: number; expandedVertexCount: number;
    slots: NativeMaterialSlot[]; channels: NativeExtraChannel[];
    fbxUvAliases: { attribute: string; sourceSemantic: string; components: number[]; vTransform: string }[];
}
export interface NativeMeshPacket extends NativeMeshBinding {
    positions: NativeChannelRange; bakedNormal: NativeChannelRange; sourceCornerIndices: string;
}
export interface NativeMaterialPacket extends NativeModelIdentity {
    schema: 'magius.native-material-channel.v1';
    /** Optional exact serialized controller/Transform carrier; never inferred from character ID. */
    controllerBindings?: NativeControllerBindings;
    meshes: NativeMeshPacket[];
    materials: Record<string, NativeMaterialEntry>;
    textures: Record<string, NativeTextureEntry>;
    channelFile: string; bakedNormalFile: string;
}
export interface NativeModelBindingContract extends NativeModelIdentity { meshBindings: NativeMeshBinding[] }
export interface NativeTextureBinding {
    status: 'NULL' | 'RESOLVED'; property: string; key: string | null;
    texture: NativeTextureEntry | null;
    scale: NativeTextureEnvironment['scale']; offset: NativeTextureEnvironment['offset'];
}
function fail(message: string): never { throw new Error(`Native material: ${message}`); }
function freeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) freeze(child);
    }
    return value;
}
function valueAt(value: unknown, path: string): unknown {
    for (const part of path.split('.')) value = (value as Record<string, unknown> | undefined)?.[part];
    return value;
}
export function nativeMeshBinding(mesh: NativeMeshPacket): NativeMeshBinding {
    const { key, sourceCab, meshPathId, rendererPathId, path, name, sourceVertexCount, expandedVertexCount, slots, channels, fbxUvAliases } = mesh;
    return { key, sourceCab, meshPathId, rendererPathId, path, name, sourceVertexCount, expandedVertexCount, slots, channels, fbxUvAliases };
}
/** Separate asset scope; never installs into the existing Steam-f2 global map. */
export function createNativeMaterialScope(input: unknown, expected: NativeModelBindingContract) {
    const data = freeze(structuredClone(input)) as NativeMaterialPacket;
    if (data?.schema !== 'magius.native-material-channel.v1') fail('schema mismatch');
    for (const field of ['characterId', 'styleId', 'sourceCommit', 'serializedPlatform', 'serializedFormat', 'unityVersion', 'versionStatus'] as const) {
        if (!(field in expected) || data[field] !== expected[field]) fail(`identity mismatch: ${field}`);
    }
    if (JSON.stringify(data.meshes.map(nativeMeshBinding)) !== JSON.stringify(expected.meshBindings)) fail('mesh/slot/channel contract drift');
    const meshes = new Map<string, NativeMeshPacket>();
    const paths = new Set<string>();
    for (const mesh of data.meshes) {
        if (mesh.key !== `${mesh.sourceCab}:${mesh.meshPathId}:renderer:${mesh.rendererPathId}` || meshes.has(mesh.key) || paths.has(mesh.path)) fail('ambiguous mesh identity');
        meshes.set(mesh.key, mesh); paths.add(mesh.path);
    }
    for (const [key, entry] of Object.entries(data.textures)) {
        if (`${entry.identity.cab}:${entry.identity.pathId}` !== key || `${entry.native.cab}:${entry.native.pathId}` !== key) fail('texture composite identity mismatch');
        if (entry.native.name !== entry.identity.name || entry.sampler.name !== entry.identity.name.trim().toLowerCase()) fail('texture diagnostic mismatch');
    }
    for (const [key, entry] of Object.entries(data.materials)) {
        if (`${entry.identity.cab}:${entry.identity.pathId}` !== key || `${entry.native.cab}:${entry.native.pathId}` !== key) fail('material composite identity mismatch');
        if (entry.shader.status !== 'RESOLVED' || entry.shader.type !== 'Shader' || entry.shader.name !== 'Creative/Character/ReDriveToon') fail('shader identity missing');
        const seen = new Set<string>();
        for (const env of entry.native.textureEnvs) {
            if (seen.has(env.property)) fail('duplicate texture property'); seen.add(env.property);
            if (![env.scale?.x, env.scale?.y, env.offset?.x, env.offset?.y].every(Number.isFinite)) fail('texture ST missing/non-finite');
            if (env.texture.status === 'NULL' && env.texture.pathId === '0') continue;
            if (env.texture.status !== 'RESOLVED' || !data.textures[`${env.texture.targetCab}:${env.texture.pathId}`]) fail('unresolved texture PPtr');
        }
        for (const blank of entry.typedBlanks) {
            if (blank.status !== 'BLANK' || valueAt(entry.profile, blank.profilePath) !== null) fail('typed unknown replaced by fallback');
        }
    }
    function materialForSlot(meshKey: string, index: number): NativeMaterialEntry {
        const slot = meshes.get(meshKey)?.slots[index];
        if (!slot || slot.index !== index) fail('exact material slot missing');
        const entry = data.materials[slot.materialKey];
        if (!entry || entry.identity.name !== slot.materialName || `${entry.shader.targetCab}:${entry.shader.pathId}` !== slot.shaderKey) fail('slot material/shader mismatch');
        return entry;
    }
    for (const mesh of meshes.values()) mesh.slots.forEach((_, i) => materialForSlot(mesh.key, i));
    function profileValue<T = unknown>(meshKey: string, index: number, path: string): T {
        const value = valueAt(materialForSlot(meshKey, index).profile, path);
        const hasUnknown = (v: unknown): boolean => v == null || (typeof v === 'object' && Object.values(v).some(hasUnknown));
        if (hasUnknown(value)) fail(`BLANK profile field: ${path}`);
        return value as T;
    }
    function floatValue(meshKey: string, index: number, property: string): number {
        const rows = materialForSlot(meshKey, index).native.savedFloats.filter(row => row[0] === property);
        if (rows.length !== 1 || !Number.isFinite(rows[0][1])) fail(`BLANK/ambiguous float: ${property}`);
        return rows[0][1];
    }
    function colorValue(meshKey: string, index: number, property: string) {
        const rows = materialForSlot(meshKey, index).native.savedColors.filter(row => row[0] === property);
        if (rows.length !== 1 || !Object.values(rows[0][1]).every(Number.isFinite)) fail(`BLANK/ambiguous color: ${property}`);
        return rows[0][1];
    }
    function textureForProperty(meshKey: string, index: number, property: string): NativeTextureBinding {
        const rows = materialForSlot(meshKey, index).native.textureEnvs.filter(row => row.property === property);
        if (rows.length !== 1) fail(`BLANK/ambiguous texture property: ${property}`);
        const env = rows[0], key = env.texture.status === 'NULL' ? null : `${env.texture.targetCab}:${env.texture.pathId}`;
        return { status: env.texture.status, property, key, texture: key ? data.textures[key] : null, scale: env.scale, offset: env.offset };
    }
    return Object.freeze({ data, materialForSlot, profileValue, floatValue, colorValue, textureForProperty });
}
export type NativeMaterialScope = ReturnType<typeof createNativeMaterialScope>;
export interface NativeSlotResources {
    key: string;
    textures: Readonly<Record<string, THREE.Texture | null>>;
    sampling: Readonly<Record<string, OfficialCharacterSurfaceSamplingState | null>>;
    bindings: Readonly<Record<string, NativeTextureBinding>>;
    baseColor: readonly [number, number, number, number];
    shadowColor: readonly [number, number, number, number];
    faceDirections: { forward: THREE.Vector3; up: THREE.Vector3; right: THREE.Vector3 };
    unknowns: readonly NativeBlankField[];
}
const NativeSamplerProperties: Readonly<Record<string, string>> = {
    map: '_BaseMap', tShadow: '_ShadowTex', tCtrl: '_ControlMap',
    tSpecularGradient: '_SpecularGradientMap', tAngelRingMap: '_AngelRingMap',
    tFaceGradient: '_FaceShadowGradientMap', tNoseGradient: '_NoseShadowGradientMap',
    tEyehighlight: '_FaceAdditionalMap', tGemMatCap: '_MatCapTex',
};
/** Custom shader samplers do not use Three's mapTransform. Apply their own
 * exact TexEnv ST; ordinary Three map sampling already uses Texture.matrix. */
export function applyNativeSlotShaderBindings(shader: THREE.WebGLProgramParametersWithUniforms, resources: NativeSlotResources) {
    for (const [sampler, property] of Object.entries(NativeSamplerProperties)) {
        const binding = resources.bindings[property];
        if (!binding || !resources.textures[property]) continue;
        const pattern = new RegExp(`texture2D\\(\\s*${sampler}\\s*,`, 'g');
        if (!pattern.test(shader.fragmentShader)) continue;
        const functionName = `rdNativeSample_${sampler}`, st = `rdNativeST_${sampler}`;
        if (shader.fragmentShader.includes(`vec4 ${functionName}(`)) continue;
        shader.uniforms[st] = { value: new THREE.Vector4(binding.scale.x, binding.scale.y, binding.offset.x, binding.offset.y) };
        shader.fragmentShader = shader.fragmentShader.replace(pattern, `${functionName}(`);
        shader.fragmentShader = shader.fragmentShader.replace(/void\s+main\s*\(/, `uniform vec4 ${st};\nvec4 ${functionName}(vec2 nativeUv) { return texture2D(${sampler}, nativeUv * ${st}.xy + ${st}.zw); }\nvoid main(`);
    }
    for (const blank of resources.unknowns) {
        const uniform = NativeInactiveUniforms[blank.profilePath];
        if (!uniform) fail(`unreviewed consumer: ${blank.sourceProperty}`);
        const declaration = new RegExp(`uniform\\s+float\\s+${uniform}\\s*;`, 'g');
        const body = `${shader.vertexShader}\n${shader.fragmentShader}`.replace(declaration, '');
        if (new RegExp(`\\b${uniform}\\b`).test(body)) fail(`BLANK field now required by active shader: ${blank.sourceProperty}`);
        delete shader.uniforms[uniform];
        shader.fragmentShader = shader.fragmentShader.replace(declaration, '');
        shader.vertexShader = shader.vertexShader.replace(declaration, '');
    }
}

/** Audit keys are absent/declaration-only in current GLSL, not false defaults. */
export const NativeInactiveUniforms: Readonly<Record<string, string>> = {
    outlineOffset: 'uMaterialOutlineOffset', skinOutlineOffset: 'uMaterialSkinOutlineOffset',
    'gem.fresnelThreshold': 'uGemFresnelThreshold', 'gem.fresnelFeather': 'uGemFresnelFeather',
    'gem.fresnelMaskByMetallic': 'uGemFresnelMaskByMetallic',
};
export function nativeSlotShaderProfile(scope: NativeMaterialScope, meshKey: string, index: number): OfficialMaterialProfile {
    const entry = scope.materialForSlot(meshKey, index);
    const profile = structuredClone(entry.profile);
    for (const blank of entry.typedBlanks) {
        if (!(blank.profilePath in NativeInactiveUniforms)) fail(`active/unknown consumer for ${blank.sourceProperty}`);
        const parts = blank.profilePath.split('.');
        let parent = profile;
        for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
        delete parent[parts.at(-1)!];
    }
    profile.name = entry.identity.name;
    // Current constructor API requires a complete profile. These audited
    // inactive fields are intentionally omitted, guarded at upload, and tested
    // for absence of active GLSL reads. Original nulls remain in scope.data.
    return profile as unknown as OfficialMaterialProfile;
}
