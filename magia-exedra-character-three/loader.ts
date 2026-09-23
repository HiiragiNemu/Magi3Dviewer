import { getLoadingTask, startLoadingTask, yieldLoadingFrame } from './loadingProgress.ts'
import { resolveNativeAngelRingReference } from './nativeCharacterController';
import * as THREE from 'three';
import 'abortcontroller-polyfill/dist/polyfill-patch-fetch'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import {
    createGeneralMaterial,
    createFaceMaterial,
    addOfficialOutlineGroupsToMesh,
    createHairMaterial,
    createDepthMaterial,
    createDistanceMaterial,
    extendMaterialWithOfficialGem,
    createOfficialGemSlotRuntime,
    setAngelRingCameraUniforms,
    setOfficialAngelRingMaterialProfileUniforms,
    setOfficialMaterialProfileUniforms,
    setOfficialFaceMaterialProfileUniforms,
    selectOfficialMatCap,
    setDepthRimVertexColorAvailability,
    createOfficialCustomCharacterMaterial,
    createOfficialReDriveCosmicShaderProfile,
    isOfficialStandardReDriveCosmicShader,
    installOfficialCustomCharacterOutline,
    setOfficialCustomCharacterRuntimeUniforms,
    MaterialUserData,
    type OfficialGemResources,
    type OfficialCustomCharacterMaterialResources,
    type OfficialFaceAdditionalMaterialBinding,
} from './shaders'
import {
    ObjFindByKey,
    ObjFilterByKey,
    characterAssetLoadError,
    fetchAndTryDecompressGzip,
    humanizeBytes,
    throwIfCharacterLoadAborted,
} from './utils';
import MagiaExedraCharacter3D, { type ObjectUserData } from './character';
import { registerParsedBoneLocals } from './authoredBoneLocals';
import {
    bindCharacterTextureLoadContext,
    registerCharacterTextureLoadContext,
} from './texture';
import {
    createAngelRingReference,
    createCharacterPerspectiveReference,
    createCharacterPerspectiveReferenceFromHead,
    type CharacterPerspectiveReference,
    getCharacterReDriveProfile,
    inferMaterialFeatures,
} from './renderProfile';
import {
    getOfficialMaterialProfiles,
    hasOfficialNullCosmicBaseMap,
    getOfficialTextureSamplerProfile,
    loadOfficialMaterialProfiles,
    normalizeOfficialTextureName,
    type OfficialMaterialProfile,
} from './materialProfile';
import { createFaceDirectionReference, getOfficialFaceProfile } from './faceProfile';
import { restoreOfficialSubmeshGroups } from './submeshGroups';
import {
    ensureOfficialSingleMaterialGroup,
    isOfficialOutlineExtrusionEnabled,
    installOfficialStencilSelectorRuntime,
    installOfficialStencilWriters,
} from './officialStencilRuntime';
import {
    parseReDriveBakedNormals,
    restoreReDriveBakedNormalAttribute,
    selectReDriveBakedNormalValues,
    type ReDriveBakedNormalData,
} from './bakedNormal';
import {
    attachHomeAnimationRuntime,
    type HomeAnimationRuntime,
    type HomeExpressionRuntime,
} from './homeRuntime';
import { installOfficialFaceMeshSwitcher } from './faceMeshSwitcher';
import {
    createNativeMaterialScope, nativeSlotShaderProfile, applyNativeSlotShaderBindings,
    type NativeMaterialPacket, type NativeModelBindingContract, type NativeMaterialScope,
    type NativeSlotResources, type NativeTextureBinding,
} from './nativeMaterialScope';
import { prepareNativeMaterialChannels } from './nativeMaterialChannels';
import { ApplyOfficialCharacterSurfaceSampling } from './texture';
import { injectOfficialGemShader } from './shaders/gem';

const loadingManager = new THREE.LoadingManager();
loadingManager.setURLModifier((url) => {
    if (url.endsWith('.png')) {
        console.log('Prevented auto-load for:', url);
        return 'data:,';
    }
    return url;
});

const fbxLoader = new FBXLoader(loadingManager);
let stencilRefCount = 1

async function fetchJsonRuntime<T>(
    url: string,
    signal?: AbortSignal,
): Promise<T> {
    try {
        const blob = await fetchAndTryDecompressGzip(
            url,
            undefined,
            undefined,
            signal,
        )
        throwIfCharacterLoadAborted(signal, 'home-runtime', url)
        getLoadingTask(signal)?.phase('decoding', url)
        await yieldLoadingFrame(signal)
        return JSON.parse(await blob.text()) as T
    } catch (error) {
        throw characterAssetLoadError('home-runtime', url, error)
    }
}

/**
 * FBXLoader treats vertex colours as display RGB and converts them to the
 * working colour space. AssetStudio exported the ReDrive vertex channels as
 * numeric shader data (outline width in R, depth-rim width in G and face
 * outline adjustment in B), so restore those serialized values once at the
 * character-loader boundary. Stage FBX uses a separate loader and keeps its
 * own material-scoped recovery.
 */
export function restoreReDriveCharacterVertexColorChannels(
    geometry: THREE.BufferGeometry,
): boolean {
    if (geometry.userData.reDriveVertexColorSpace === 'raw') return false
    const attribute = geometry.getAttribute('color')
    if (!(attribute instanceof THREE.BufferAttribute) || attribute.itemSize < 3) {
        return false
    }

    const array = attribute.array
    for (let index = 0; index < array.length; index++) {
        const linear = THREE.MathUtils.clamp(Number(array[index]), 0, 1)
        array[index] = linear <= 0.0031308
            ? linear * 12.92
            : 1.055 * linear ** (1 / 2.4) - 0.055
    }
    attribute.needsUpdate = true
    geometry.userData.reDriveVertexColorSpace = 'raw'
    return true
}

const origConsoleWarn = console.warn
console.warn = function (...data: any[]) {
    for (const value of data) {
        if (typeof value == 'string' && value.includes('NoMappingInformation')) return
    }
    origConsoleWarn(...data)
}

export interface LoadProgressDetail {
    url?: string
    fileName?: string
    loaded?: number
    total?: number
    phase?: string
}

export interface LoadCharacterCallbacks {
    loadProgressCallback: (progress: string, detail?: LoadProgressDetail) => any
    modelLoadedCallback: (model: MagiaExedraCharacter3D) => any
    loadFinishCallback: (model: MagiaExedraCharacter3D) => any
    signal: AbortSignal
}

function getMaterialNames(mesh: THREE.Mesh): string[] {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    return materials.map((material, index) => material?.name || `${mesh.name}:material-${index}`)
}

function getModelObjectPath(object: THREE.Object3D, root: THREE.Object3D): string {
    const names: string[] = []
    let current: THREE.Object3D | null = object
    while (current) {
        if (current.name) names.push(current.name)
        if (current === root) break
        current = current.parent
    }
    return names.reverse().join('/')
}

function getOfficialBlendFactor(value: number) {
    return {
        0: THREE.ZeroFactor,
        1: THREE.OneFactor,
        2: THREE.DstColorFactor,
        3: THREE.SrcColorFactor,
        4: THREE.OneMinusDstColorFactor,
        5: THREE.SrcAlphaFactor,
        6: THREE.OneMinusSrcColorFactor,
        7: THREE.DstAlphaFactor,
        8: THREE.OneMinusDstAlphaFactor,
        9: THREE.SrcAlphaSaturateFactor,
        10: THREE.OneMinusSrcAlphaFactor,
    }[value] ?? THREE.OneFactor
}

/** Apply only serialized slot state; mesh-level alpha inference remains a
 * shader input choice and must not leak blend/depth state to neighboring
 * groups. */
function applyOfficialSurfaceRenderState(
    material: THREE.Material,
    profile: OfficialMaterialProfile,
) {
    const surface = profile.surface
    const compiledPassState = material.userData instanceof MaterialUserData
        ? material.userData.officialCompiledPassState
        : material.userData?.officialCompiledPassState
    const usesBlending = surface.srcBlend !== 1 || surface.dstBlend !== 0
    material.transparent = surface.transparency || usesBlending
    // Serialized `_ZWrite` chooses the ordinary ReDrive state. A custom
    // compiled ShaderLab pass can carry a different fixed state; preserve that
    // pass authority when binding the material to its FBX draw slot.
    material.depthWrite = compiledPassState?.depthWrite ?? surface.zWrite
    // ReDriveToon UniversalForward serializes Cull Back for Gem as well as the
    // neighboring opaque slots. Fresh TW GLES evidence confirms GL_CULL_FACE +
    // GL_BACK on the active `_GemHeightCorrection` program. FBXLoader has
    // already converted the asset winding into Three's convention, so
    // FrontSide is the semantic Cull Back equivalent; do not add a Viewer-only
    // rear-shell pass for unrestricted orbit angles.
    material.side = profile.gem.enabled
        ? THREE.FrontSide
        : material.side
    material.blending = material.transparent
        ? THREE.CustomBlending
        : THREE.NormalBlending
    if (material.transparent) {
        material.blendEquation = THREE.AddEquation
        material.blendSrc = getOfficialBlendFactor(
            surface.srcBlend,
        ) as THREE.BlendingSrcFactor
        material.blendDst = getOfficialBlendFactor(
            surface.dstBlend,
        ) as THREE.BlendingDstFactor
    }
    material.needsUpdate = true
}

/**
 * FBX geometry groups refer to original Unity material slots. Replacing an array
 * with one aggregate material erased that information and made body Soul Gems,
 * anisotropic fabric and outline-offset pieces impossible to render correctly.
 *
 * Keep one shared compiled material/texture set for memory efficiency, but retain
 * an array entry for every group and update only scalar feature uniforms before
 * each draw call.
 */
export function bindOfficialMaterialGroups(
    mesh: THREE.Mesh,
    material: THREE.Material,
    profiles: OfficialMaterialProfile[],
    gemResources?: OfficialGemResources,
    slotMaterialOverrides?: ReadonlyMap<number, THREE.Material>,
    customResourcesBySlot?: ReadonlyMap<
        number,
        OfficialCustomCharacterMaterialResources
    >,
    faceAdditionalBindings?: readonly OfficialFaceAdditionalMaterialBinding[],
) {
    ensureOfficialSingleMaterialGroup(mesh, profiles)
    const groups = mesh.geometry.groups
    const highestGroupMaterialIndex = groups.reduce(
        (highest, group) => Math.max(highest, group.materialIndex ?? 0),
        0,
    )
    // Three.js does not render a material array when BufferGeometry has no draw
    // groups. AssetStudio/FBXLoader commonly preserves the Unity material-name
    // array while flattening the geometry into one ungrouped draw range. In
    // that case use the shared material for the whole mesh; otherwise Body,
    // Face, Hair and Weapon disappear and only their outline shells remain.
    const slots = groups.length > 0
        ? Math.max(profiles.length, highestGroupMaterialIndex + 1, 1)
        : 1
    const slotProfiles = profiles.length > 0
        ? profiles
        : getOfficialMaterialProfiles([material.name])
    const sharedTextureSampling =
        material.userData instanceof MaterialUserData
            ? material.userData.officialTextureSampling
            : undefined
    const materials = Array.from({ length: slots }, (_, index) => {
        const override = slotMaterialOverrides?.get(index)
        const slotMaterial = override ?? (
            index === 0 ? material : material.clone()
        )
        if (index > 0 && !override) {
            // Material.copy intentionally does not copy shader callbacks or
            // custom cache keys. Copy them explicitly while keeping a distinct
            // material id and a distinct uniform container per FBX draw group.
            slotMaterial.onBeforeCompile = material.onBeforeCompile
            slotMaterial.customProgramCacheKey =
                material.customProgramCacheKey.bind(slotMaterial)
            slotMaterial.userData = new MaterialUserData()
        }
        const userData = slotMaterial.userData instanceof MaterialUserData
            ? slotMaterial.userData
            : new MaterialUserData()
        slotMaterial.userData = userData
        userData.officialTextureSampling ??= sharedTextureSampling
        const slotProfile = slotProfiles[index] ?? slotProfiles[0]
        userData.officialMaterialProfile = slotProfile
        const faceAdditionalBinding = faceAdditionalBindings?.[index]
        if (faceAdditionalBinding) {
            const faceUserData = userData as MaterialUserData & {
                officialFaceAdditionalTexture?: THREE.Texture | null
                officialFaceAdditionalSource?: string | null
                officialFaceAdditionalSampling?:
                    OfficialFaceAdditionalMaterialBinding['sampler']
            }
            faceUserData.officialFaceAdditionalTexture =
                faceAdditionalBinding.texture
            faceUserData.officialFaceAdditionalSource =
                faceAdditionalBinding.sourceUrl
            faceUserData.officialFaceAdditionalSampling =
                faceAdditionalBinding.sampler
        }
        applyOfficialSurfaceRenderState(slotMaterial, slotProfile)
        return slotMaterial
    })
    mesh.material = materials.length > 1 || groups.length > 0
        ? materials
        : materials[0]
    mesh.userData.officialMaterialProfiles = profiles

    const previousOnBeforeRender = mesh.onBeforeRender
    mesh.onBeforeRender = function (
        renderer,
        scene,
        camera,
        geometry,
        renderMaterial,
        group,
    ) {
        previousOnBeforeRender.call(
            this,
            renderer,
            scene,
            camera,
            geometry,
            renderMaterial,
            group,
        )
        const userData = renderMaterial.userData
        const shader = userData instanceof MaterialUserData
            ? userData.shader
            : userData?.shader
        // WebGLRenderer passes a BufferGeometry draw-group here. The current
        // @types/three declaration incorrectly exposes it as THREE.Group.
        const drawGroup = group as unknown as {
            materialIndex?: number
            start?: number
            count?: number
        } | null
        const index = drawGroup?.materialIndex ?? 0
        const profile = slotProfiles[index] ?? slotProfiles[0]
        const toonShadowSlotRuntime =
            setOfficialMaterialProfileUniforms(shader, profile)
        // OFFICIAL_TOON_SHADOW_RUNTIME_BEGIN
        if (toonShadowSlotRuntime) {
            const previousRuntime = this.userData.officialToonShadowRuntime as {
                slots?: Record<number, Record<string, unknown>>
            } | undefined
            const slots = previousRuntime?.slots ?? {}
            slots[index] = {
                ...toonShadowSlotRuntime,
                materialIndex: index,
                groupStart: drawGroup?.start ?? 0,
                groupCount:
                    drawGroup?.count ??
                    geometry.getIndex()?.count ??
                    geometry.getAttribute('position')?.count ??
                    0,
            }
            this.userData.officialToonShadowRuntime = {
                activeMaterialIndex: index,
                slots,
            }
        }
        // OFFICIAL_TOON_SHADOW_RUNTIME_END
        setOfficialFaceMaterialProfileUniforms(shader, profile)
        if (shader && gemResources) {
            const matCap = selectOfficialMatCap(gemResources, profile)
            shader.uniforms.tGemMatCap ??= { value: matCap ?? null }
            shader.uniforms.tGemMatCap.value = matCap ?? null
        }
        // OFFICIAL_GEM_RUNTIME_BEGIN
        const gemSlotRuntime = createOfficialGemSlotRuntime(shader, profile)
        if (gemSlotRuntime) {
            const previousRuntime = this.userData.officialGemRuntime as {
                slots?: Record<number, Record<string, unknown>>
            } | undefined
            const slots = previousRuntime?.slots ?? {}
            slots[index] = {
                ...gemSlotRuntime,
                materialIndex: index,
                groupStart: drawGroup?.start ?? 0,
                groupCount:
                    drawGroup?.count ??
                    geometry.getIndex()?.count ??
                    geometry.getAttribute('position')?.count ??
                    0,
                renderState: {
                    depthTest: renderMaterial.depthTest,
                    depthWrite: renderMaterial.depthWrite,
                    transparent: renderMaterial.transparent,
                    opacity: renderMaterial.opacity,
                    side: renderMaterial.side,
                },
            }
            this.userData.officialGemRuntime = {
                activeMaterialIndex: index,
                slots,
            }
        }
        // OFFICIAL_GEM_RUNTIME_END
        setAngelRingCameraUniforms(shader, renderer, camera)
        const angelRingSlotRuntime =
            setOfficialAngelRingMaterialProfileUniforms(shader, profile)
        // OFFICIAL_ANGEL_RING_RUNTIME_BEGIN
        if (angelRingSlotRuntime) {
            const previousRuntime = this.userData.officialAngelRingRuntime as {
                slots?: Record<number, Record<string, unknown>>
            } | undefined
            const slots = previousRuntime?.slots ?? {}
            slots[index] = {
                ...angelRingSlotRuntime,
                sampler: userData instanceof MaterialUserData
                    ? userData.officialTextureSampling?.angelRingMap ?? null
                    : null,
                materialIndex: index,
                groupStart: drawGroup?.start ?? 0,
                groupCount:
                    drawGroup?.count ??
                    geometry.getIndex()?.count ??
                    geometry.getAttribute('position')?.count ??
                    0,
            }
            this.userData.officialAngelRingRuntime = {
                activeMaterialIndex: index,
                slots,
            }
        }
        // OFFICIAL_ANGEL_RING_RUNTIME_END
        const customResources = customResourcesBySlot?.get(index)
        if (customResources) {
            setOfficialCustomCharacterRuntimeUniforms(
                shader,
                renderer,
                camera,
                customResources,
            )
        }
        setDepthRimVertexColorAvailability(
            shader,
            Boolean(geometry.getAttribute('color')),
        )
    }
}

function setStencil(material: THREE.Material | THREE.Material[], ref: number) {
    const materials = Array.isArray(material) ? [...new Set(material)] : [material]
    materials.forEach(item => {
        item.stencilWrite = true
        item.stencilRef = ref
        item.stencilFunc = THREE.AlwaysStencilFunc
        item.stencilZPass = THREE.ReplaceStencilOp
    })
}

export interface NativeCharacterMaterialInput {
    scope: NativeMaterialScope;
    packet: NativeMaterialPacket;
    expected: NativeModelBindingContract;
    channels: ArrayBuffer;
    cornerIndices: Record<string, ArrayBuffer>;
    bakedNormalBuffer: ArrayBuffer;
    textureUrls: Record<string, string>;
}

/** Optional model-local companion. Transport paths locate bytes only; all
 * admission and material lookup uses the packet's exact composite identities. */
export async function loadNativeCharacterMaterialInput(files: Record<string, string>, signal?: AbortSignal): Promise<NativeCharacterMaterialInput | undefined> {
    const entries = Object.entries(files).filter(([key]) => key.replace(/\\/g, '/').endsWith('/runtime-material-channel.json'));
    if (entries.length === 0) return undefined;
    if (entries.length !== 1) throw new Error('Ambiguous native material packet');
    const [packetPath, packetUrl] = entries[0];
    const directory = packetPath.replace(/\\/g, '/').slice(0, -'runtime-material-channel.json'.length);
    const exactUrl = (relative: string) => {
        if (!relative || relative.includes('/') || relative.includes('\\') || relative === '..') throw new Error('Native companion path is not a sibling');
        const found = Object.entries(files).filter(([key]) => key.replace(/\\/g, '/') === directory + relative);
        if (found.length !== 1) throw new Error(`Exact native companion missing: ${relative}`);
        return found[0][1];
    };
    const json = async <T,>(url: string): Promise<T> => JSON.parse(await (await fetchAndTryDecompressGzip(url, undefined, undefined, signal)).text()) as T;
    const packet = await json<NativeMaterialPacket>(packetUrl);
    const expected = await json<NativeModelBindingContract>(exactUrl('model-binding-contract.json'));
    const scope = createNativeMaterialScope(packet, expected);
    const buffer = async (name: string) => (await fetchAndTryDecompressGzip(exactUrl(name), undefined, undefined, signal)).arrayBuffer();
    const [channels, bakedNormalBuffer, corners] = await Promise.all([
        buffer(packet.channelFile), buffer(packet.bakedNormalFile),
        Promise.all(packet.meshes.map(async mesh => [mesh.sourceCornerIndices, await buffer(mesh.sourceCornerIndices)] as const)),
    ]);
    const textureUrls = Object.fromEntries(Object.entries(packet.textures).map(([key, entry]) => [key, exactUrl(entry.png)]));
    throwIfCharacterLoadAborted(signal, 'texture-material', packetUrl);
    return { scope, packet, expected, channels, bakedNormalBuffer, cornerIndices: Object.fromEntries(corners), textureUrls };
}

export function createNativeSlotResourceLoader(input: NativeCharacterMaterialInput, signal?: AbortSignal, registerTexture: (texture: THREE.Texture) => void = () => undefined) {
    const cache = new Map<string, Promise<THREE.Texture>>();
    return async (meshKey: string, index: number): Promise<NativeSlotResources> => {
        const scope = input.scope, entry = scope.materialForSlot(meshKey, index);
        const bindings: Record<string, NativeTextureBinding> = {};
        const textures: Record<string, THREE.Texture | null> = {};
        const sampling: NativeSlotResources['sampling'] extends Readonly<infer T> ? T : never = {};
        for (const env of entry.native.textureEnvs) {
            const binding = scope.textureForProperty(meshKey, index, env.property);
            bindings[env.property] = binding;
            if (!binding.key || !binding.texture) { textures[env.property] = null; sampling[env.property] = null; continue; }
            const cacheKey = `${binding.key}:${JSON.stringify([binding.scale, binding.offset])}`;
            let pending = cache.get(cacheKey);
            if (!pending) {
                const url = input.textureUrls[binding.key];
                if (!url) throw new Error(`Exact texture transport missing: ${binding.key}`);
                pending = (async () => {
                    // Retained PNG is the exact scoped payload. Do not route
                    // its common filename into the legacy f2 compressed table.
                    const blob = await fetchAndTryDecompressGzip(url, undefined, undefined, signal);
                    const header = new DataView(await blob.slice(0, 24).arrayBuffer());
                    if (header.byteLength < 24 || header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a || header.getUint32(16) !== binding.texture!.sampler.width || header.getUint32(20) !== binding.texture!.sampler.height) throw new Error('Native PNG identity/dimension mismatch');
                    const objectUrl = URL.createObjectURL(blob);
                    let texture: THREE.Texture;
                    try { texture = await new THREE.TextureLoader().loadAsync(objectUrl); }
                    finally { URL.revokeObjectURL(objectUrl); }
                    registerTexture(texture);
                    throwIfCharacterLoadAborted(signal, 'texture-material', url);
                    ApplyOfficialCharacterSurfaceSampling(texture, binding.texture!.identity.name, binding.texture!.sampler);
                    texture.repeat.set(binding.scale.x, binding.scale.y);
                    texture.offset.set(binding.offset.x, binding.offset.y);
                    texture.updateMatrix();
                    Object.assign(texture.userData, { nativeTextureKey: binding.key, nativeMipEvidence: binding.texture!.payloadMipEvidence });
                    return texture;
                })();
                cache.set(cacheKey, pending);
            }
            textures[env.property] = await pending;
            sampling[env.property] = ApplyOfficialCharacterSurfaceSampling(textures[env.property]!, binding.texture.identity.name, binding.texture.sampler);
        }
        throwIfCharacterLoadAborted(signal, 'texture-material', meshKey);
        const rgba = (property: string) => { const c = scope.colorValue(meshKey, index, property); return [c.r, c.g, c.b, c.a] as const; };
        const direction = (property: string) => { const c = scope.colorValue(meshKey, index, property); return new THREE.Vector3(-c.r, c.g, c.b); };
        return { key: `${meshKey}:slot:${index}`, bindings, textures, sampling, baseColor: rgba('_BaseColor'), shadowColor: rgba('_ShadowColor'), faceDirections: { forward: direction('_FaceForwardDirection'), up: direction('_FaceUpDirection'), right: direction('_FaceRightDirection') }, unknowns: entry.typedBlanks };
    };
}

/** Real constructors, one material per native slot. No material/texture name
 * inference, shared global profile install, or cross-character preset. */
export async function createNativeMeshMaterials(
    mesh: THREE.Mesh, input: NativeCharacterMaterialInput,
    resourceLoader: ReturnType<typeof createNativeSlotResourceLoader>,
    references: { root?: THREE.Object3D; perspective?: ReturnType<typeof createCharacterPerspectiveReference>; perspectiveReferences?: Map<string, CharacterPerspectiveReference>; angelRing?: ReturnType<typeof createAngelRingReference>; face?: ReturnType<typeof createFaceDirectionReference> } = {},
) {
    const meshKey = mesh.geometry.userData.nativeMaterialChannelKey as string;
    const binding = input.packet.meshes.find(row => row.key === meshKey);
    if (!binding) throw new Error('Native material construction requires exact channel binding');
    const controllerBinding = references.root
        ? resolveNativeAngelRingReference(references.root, input.scope.data, binding)
        : undefined;
    const angelRingReference = references.angelRing ?? controllerBinding?.reference;
    const controllerKey = controllerBinding?.diagnostic.controllerKey;
    let perspectiveReference = references.perspective
        ?? (controllerKey ? references.perspectiveReferences?.get(controllerKey) : undefined);
    if (!perspectiveReference && controllerBinding?.reference) {
        perspectiveReference = createCharacterPerspectiveReferenceFromHead(controllerBinding.reference);
        if (controllerKey) references.perspectiveReferences?.set(controllerKey, perspectiveReference);
    }
    if (perspectiveReference) {
        // The depth prepass and stencil children read this same reference.
        mesh.userData.characterPerspectiveReference = perspectiveReference;
        installAngelRingDrawReferenceUpdate(mesh, perspectiveReference.update);
    }
    const profiles = binding.slots.map(slot => nativeSlotShaderProfile(input.scope, meshKey, slot.index));
    const materials = new Map<number, THREE.Material>();
    const slotResults = [];
    for (const slot of binding.slots) {
        const profile = profiles[slot.index], resources = await resourceLoader(meshKey, slot.index);
        const options = { colorMap: resources.bindings._BaseMap?.key ?? '', materialNames: [profile.name], materialProfiles: [profile], nativeResources: resources, characterPerspectiveReference: perspectiveReference };
        let result: Awaited<ReturnType<typeof createGeneralMaterial>>;
        const unresolved: string[] = [];
        if (profile.face.isFace) {
            if (profile.face.useGradientMap && (!resources.textures._FaceShadowGradientMap || !resources.textures._NoseShadowGradientMap)) throw new Error('BLANK required face gradient PPtr');
            const number = (name: string) => input.scope.floatValue(meshKey, slot.index, name);
            result = await createFaceMaterial({ ...options, shadowMap: resources.bindings._ShadowTex?.key ?? '', faceAdditionalMaps: [resources.bindings._FaceAdditionalMap?.key ?? null], faceReference: references.face,
                faceProfile: { characterId: input.packet.characterId, source: 'official-export', useFaceGradientMap: profile.face.useGradientMap, faceShadowGradientMapYOffset: number('_FaceShadowGradientMapYOffset'), noseShadowGradientMapYOffset: number('_NoseShadowGradientMapYOffset'), cheekValue: number('_CheekValue'), shadowOffset: profile.shadow.offset, shadowFeather: profile.shadow.feather, faceAreaCameraDepthTextureZWriteOffset: profile.face.cameraDepthTextureZWriteOffset, faceOutlineAdjust: profile.outline.faceOutlineAdjust } });
            if (!references.face) unresolved.push('dynamic controller/head face-direction binding BLANK; serialized material directions retained');
        } else if (profile.angelRing.isHair) {
            const hair = await createHairMaterial({ ...options, angelRingReference });
            result = hair;
            if (hair.updateAngelRingReference) installAngelRingDrawReferenceUpdate(mesh, hair.updateAngelRingReference);
            if (controllerBinding) hair.material.userData.nativeControllerReference = controllerBinding.diagnostic;
            if (profile.angelRing.enabled && !angelRingReference) unresolved.push('projected AngelRing controller/head reference BLANK; exact texture/property retained');
        } else result = await createGeneralMaterial(options);
        const material = result.material;
        material.name = profile.name;
        if (profile.gem.enabled || profile.matCap.enabled) {
            const matCap = resources.textures._MatCapTex;
            if (profile.matCap.enabled && !matCap && profile.matCap.source !== 'default-linear-grey') throw new Error('BLANK required MatCap PPtr');
            const exact: OfficialGemResources = { matCaps: new Map(matCap && profile.matCap.texture ? [[profile.matCap.texture.toLowerCase(), matCap]] : []), textures: matCap ? [matCap] : [] };
            const compile = material.onBeforeCompile;
            material.onBeforeCompile = function(shader, renderer) { compile.call(this, shader, renderer); injectOfficialGemShader(shader, exact, profile); applyNativeSlotShaderBindings(shader, resources); };
        }
        const baseCompile = material.onBeforeCompile;
        material.onBeforeCompile = function(shader, renderer) { baseCompile.call(this, shader, renderer); applyNativeSlotShaderBindings(shader, resources); };
        const key = material.customProgramCacheKey.bind(material);
        material.customProgramCacheKey = () => `${key()}|native:${resources.key}`;
        Object.assign(material.userData, { officialMaterialProfile: profile, nativeMaterialKey: resources.key, nativeBindings: resources.bindings, nativeTextureSampling: resources.sampling, nativeUnknowns: resources.unknowns, nativeUnresolvedFeatures: unresolved });
        materials.set(slot.index, material);
        slotResults.push({ index: slot.index, result, resources, unresolved });
    }
    return { profiles, materials, slots: slotResults, controllerBinding, perspectiveReference };
}

export async function loadCharacter(
    files: Record<string, string>,
    callbacks?: Partial<LoadCharacterCallbacks>,
): Promise<MagiaExedraCharacter3D> {
    const signal = callbacks?.signal ?? new AbortController().signal
    const previousLoadingTask = getLoadingTask(signal)
    const inheritedLoadingTask = previousLoadingTask?.snapshot().status === 'loading' ? previousLoadingTask : undefined
    const loadingTask = inheritedLoadingTask ?? startLoadingTask('角色加载', signal)
    const loadProgressCallback = (text: string, detail?: LoadProgressDetail) => {
        if (text) loadingTask.phase(
            detail?.phase === 'download' ? 'downloading' : /Parsing|Geometry/.test(text) ? 'decoding' : /Decompress/.test(text) ? 'decompressing' : 'assembling',
            detail?.url, text,
        )
        callbacks?.loadProgressCallback?.(text, detail)
    }
    const modelLoadedCallback = callbacks?.modelLoadedCallback || (() => undefined)
    const loadFinishCallback = callbacks?.loadFinishCallback || (() => undefined)
    let modelObject!: THREE.Group
    let character!: MagiaExedraCharacter3D
    let completed = false
    const transactionTextures = new Set<THREE.Texture>()
    const releaseTextureContext = registerCharacterTextureLoadContext({
        signal,
        stage: 'texture-download',
        registerTexture: texture => transactionTextures.add(texture),
    })

    try {
        const nativeInput = await loadNativeCharacterMaterialInput(files, signal);
        throwIfCharacterLoadAborted(
            signal,
            'texture-material',
            'magius:official-material-profiles',
        )
        loadProgressCallback('Loading official material profiles...')
        try {
            if (!nativeInput) await loadOfficialMaterialProfiles()
        } catch (error) {
            loadProgressCallback('Material profile FAILED')
            throw characterAssetLoadError(
                'texture-material',
                'magius:official-material-profiles',
                error,
            )
        }
        throwIfCharacterLoadAborted(
            signal,
            'texture-material',
            'magius:official-material-profiles',
        )

        const fbxPathUrl = ObjFilterByKey(files, path => path.includes('.fbx'))
        const fbxPath = Object.keys(fbxPathUrl)[0]
        if (!fbxPath) {
            throw characterAssetLoadError(
                'fbx-download',
                'magius:missing-fbx',
                new Error('No FBX asset was supplied for this character'),
            )
        }
        const characterId = parseInt(fbxPath.match(/chara_(\d+).*\//)![1])
        if (nativeInput && nativeInput.packet.characterId !== characterId) throw new Error('Native material character identity differs from FBX asset');
        const fbxUrl = fbxPathUrl[fbxPath]
        const homeAnimationUrl = ObjFindByKey(
            files,
            path => path.endsWith('home-animations.json.gz'),
        )
        const homeExpressionUrl = ObjFindByKey(
            files,
            path => path.endsWith('home-expressions.json'),
        )
        const bakedNormalUrl = ObjFindByKey(
            files,
            path => path.endsWith('redrive-baked-normals.bin.gz'),
        )
        const rawTexturePathUrl = ObjFilterByKey(
            files,
            path => path.includes('.png'),
        )
        const texturePathUrl = Object.fromEntries(
            Object.entries(rawTexturePathUrl).map(([path, url]) => [
                path,
                bindCharacterTextureLoadContext(url, {
                    signal,
                    stage: 'texture-download',
                    sourcePath: path,
                    registerTexture: texture => transactionTextures.add(texture),
                }),
            ]),
        ) as Record<string, string>
    const findOfficialTextureUrl = (
        textureName: string | null | undefined,
    ) => {
        if (!textureName) return undefined
        return Object.entries(texturePathUrl).find(
            ([path]) =>
                normalizeOfficialTextureName(path) ===
                normalizeOfficialTextureName(textureName),
        )?.[1]
    }
    const specularGradientMap = ObjFindByKey(
        texturePathUrl,
        path => path.toLowerCase().includes('rdtoon_metallic_gradient_map'),
    )
        const characterProfile = getCharacterReDriveProfile(characterId)

        console.log('Loading model:', fbxPathUrl)
        loadProgressCallback('Loading FBX...')

        let fbxBlob: Blob
        let fbxTransferStage: 'fbx-download' | 'fbx-decompress' = 'fbx-download'
        try {
            fbxBlob = await fetchAndTryDecompressGzip(
                fbxUrl,
                progress => {
                    const loaded = humanizeBytes(progress.loaded)
                    const total = humanizeBytes(progress.total)
                    loadProgressCallback(`Downloading FBX... ${progress.lengthComputable ? `${loaded} / ${total}` : loaded}`, {
                        url: fbxUrl,
                        fileName: fbxPath.split(/[\\/]/).pop(),
                        loaded: progress.loaded,
                        total: progress.lengthComputable ? progress.total : undefined,
                        phase: 'download',
                    })
                },
                () => {
                    fbxTransferStage = 'fbx-decompress'
                    loadProgressCallback('Decompressing FBX...')
                },
                signal,
            )
        } catch (error) {
            loadProgressCallback('Download FAILED')
            throw characterAssetLoadError(fbxTransferStage, fbxUrl, error)
        }

        loadProgressCallback('Parsing geometry...')
        await yieldLoadingFrame(signal)
        try {
            // Parse the already-downloaded, already-decompressed buffer
            // directly. Re-wrapping it in a blob URL made FBXLoader perform a
            // second asynchronous request and could expose a stale/truncated
            // blob to the parser after rapid preview rebuilds.
            const fbxBuffer = await fbxBlob.arrayBuffer()
            throwIfCharacterLoadAborted(signal, 'fbx-parse', fbxUrl)
            const fbxBytes = new Uint8Array(fbxBuffer)
            const headerBytes = fbxBytes.subarray(0, Math.min(24, fbxBytes.length))
            const headerAscii = new TextDecoder('ascii').decode(headerBytes)
            const headerHex = Array.from(headerBytes, byte => byte.toString(16).padStart(2, '0')).join(' ')
            const isBinaryFbx = headerAscii.startsWith('Kaydara FBX Binary')
            const isAsciiFbx = headerAscii.startsWith('; FBX')

            console.info('FBX payload diagnostic', {
                url: fbxUrl,
                byteLength: fbxBytes.byteLength,
                headerAscii,
                headerHex,
                isBinaryFbx,
                isAsciiFbx,
            })

            if (!isBinaryFbx && !isAsciiFbx) {
                throw new Error(
                    `Invalid FBX payload after download/decompression: ${fbxBytes.byteLength} bytes, header ${headerHex}`,
                )
            }

            modelObject = fbxLoader.parse(
                fbxBuffer,
                new URL('.', new URL(fbxUrl, document.baseURI)).href,
            )
            registerParsedBoneLocals(modelObject)
            throwIfCharacterLoadAborted(signal, 'fbx-parse', fbxUrl)
        } catch (error) {
            loadProgressCallback('Parse FAILED')
            throw characterAssetLoadError('fbx-parse', fbxUrl, error)
        }

            let bakedNormalData: ReDriveBakedNormalData | undefined
            if (nativeInput) bakedNormalData = parseReDriveBakedNormals(nativeInput.bakedNormalBuffer);
            if (bakedNormalUrl && !nativeInput) {
                loadProgressCallback('Loading official baked normals...')
                try {
                    const bakedNormalBlob = await fetchAndTryDecompressGzip(
                        bakedNormalUrl,
                        undefined,
                        undefined,
                        signal,
                    )
                    throwIfCharacterLoadAborted(
                        signal,
                        'baked-normals',
                        bakedNormalUrl,
                    )
                    loadingTask.phase('decoding', bakedNormalUrl)
                    await yieldLoadingFrame(signal)
                    bakedNormalData = parseReDriveBakedNormals(
                        await bakedNormalBlob.arrayBuffer(),
                    )
                    if (bakedNormalData.characterId !== characterId) {
                        throw new Error(
                            `Baked-normal character ${bakedNormalData.characterId} `
                            + `does not match model ${characterId}`,
                        )
                    }
                } catch (error) {
                    loadProgressCallback('Baked normals FAILED')
                    throw characterAssetLoadError(
                        'baked-normals',
                        bakedNormalUrl,
                        error,
                    )
                }
            }

            let homeAnimationRuntime: HomeAnimationRuntime | undefined
            let homeExpressionRuntime: HomeExpressionRuntime | undefined
            if (homeAnimationUrl || homeExpressionUrl) {
                loadProgressCallback('Loading Home actions and expressions...')
                try {
                    const [animationRuntime, expressionRuntime] = await Promise.all([
                        homeAnimationUrl
                            ? fetchJsonRuntime<HomeAnimationRuntime>(homeAnimationUrl, signal)
                            : Promise.resolve(undefined),
                        homeExpressionUrl
                            ? fetchJsonRuntime<HomeExpressionRuntime>(homeExpressionUrl, signal)
                            : Promise.resolve(undefined),
                    ])
                    if (animationRuntime) {
                        if (animationRuntime.characterId !== characterId) {
                            throw new Error('Home animation character ID does not match the model')
                        }
                        attachHomeAnimationRuntime(modelObject, animationRuntime)
                        homeAnimationRuntime = animationRuntime
                    }
                    if (expressionRuntime) {
                        if (expressionRuntime.characterId !== characterId) {
                            throw new Error('Home expression character ID does not match the model')
                        }
                        homeExpressionRuntime = expressionRuntime
                    }
                } catch (error) {
                    loadProgressCallback('Home runtime FAILED')
                    const runtimeUrl = homeAnimationUrl
                        ?? homeExpressionUrl
                        ?? 'magius:home-runtime'
                    throw characterAssetLoadError('home-runtime', runtimeUrl, error)
                }
            }

            console.log(`Model "${modelObject.name}" loaded successfully`)

            modelObject.updateMatrixWorld(true)
            if (nativeInput) prepareNativeMaterialChannels({ root: modelObject, ...nativeInput }).apply();
            const meshes: THREE.Mesh[] = []
            const recoveredVertexColorGeometries = new Set<THREE.BufferGeometry>()
            const recoveredBakedNormalGeometries = new Set<THREE.BufferGeometry>()
            const matchedBakedNormalMeshes = new Set<string>()
            let geometryChannelError: unknown
            modelObject.traverse(child => {
                if (geometryChannelError) return
                if (!(child as THREE.Mesh).isMesh) return
                const mesh = child as THREE.Mesh
                meshes.push(mesh)
                try {
                    if (!recoveredVertexColorGeometries.has(mesh.geometry)) {
                        restoreReDriveCharacterVertexColorChannels(mesh.geometry)
                        recoveredVertexColorGeometries.add(mesh.geometry)
                    }
                    if (!recoveredBakedNormalGeometries.has(mesh.geometry)) {
                        const objectPath = getModelObjectPath(mesh, modelObject)
                        const normal = mesh.geometry.getAttribute('normal')
                        const selection = selectReDriveBakedNormalValues(
                            bakedNormalData,
                            mesh.name,
                            objectPath,
                            normal?.count ?? 0,
                        )
                        if (selection.key) {
                            matchedBakedNormalMeshes.add(selection.key)
                        }
                        const source = restoreReDriveBakedNormalAttribute(
                            mesh.geometry,
                            selection.values,
                        )
                        mesh.userData.reDriveBakedNormalBinding = {
                            objectPath,
                            source,
                            selectedSource: selection.source,
                            matchedKey: selection.key ?? null,
                            rejected: selection.rejected,
                            fbxVertexCount: normal?.count ?? 0,
                        }
                        recoveredBakedNormalGeometries.add(mesh.geometry)
                    }
                } catch (error) {
                    geometryChannelError = error
                }
            })
            if (
                geometryChannelError
                || (bakedNormalData
                    && matchedBakedNormalMeshes.size !== bakedNormalData.meshes.size)
            ) {
                loadProgressCallback('Geometry channels FAILED')
                throw characterAssetLoadError(
                    'fbx-parse',
                    fbxUrl,
                    geometryChannelError
                    ?? new Error(
                        `FBX matched ${matchedBakedNormalMeshes.size} of `
                        + `${bakedNormalData!.meshes.size} baked-normal meshes`,
                    ),
                )
            }

            const userData: ObjectUserData = {
                characterId,
                meshes,
                textures: [],
                outlineMeshes: [],
                animationLoops: [],
                disposeCallbacks: [],
                homeAnimationRuntime,
                homeExpressionRuntime,
            }
            modelObject.userData = userData

            // ReDrive combines every mode-1/mode-2 material's serialized bit
            // 7 with one character-wide low-seven-bit stencil reference. Use
            // the same reference for Face writers and Hair selectors even
            // though those meshes finish their texture work asynchronously.
            const characterStencilReference =
                ((stencilRefCount - 1) % 0x7f) + 1
            stencilRefCount++

            const faceMeshSwitcherRuntime =
                nativeInput ? undefined : installOfficialFaceMeshSwitcher(modelObject)
            if (faceMeshSwitcherRuntime) {
                userData.disposeCallbacks.push(faceMeshSwitcherRuntime.dispose)
                console.log(
                    'Installed official FaceMeshSwitcher:',
                    faceMeshSwitcherRuntime.debug,
                )
            }

            const characterPerspectiveReference =
                nativeInput ? undefined : createCharacterPerspectiveReference(
                    modelObject,
                    characterProfile,
                )
            if (characterPerspectiveReference) {
                userData.animationLoops.push(
                    characterPerspectiveReference.update,
                )
            }

            character = new MagiaExedraCharacter3D(modelObject)
            throwIfCharacterLoadAborted(signal, 'texture-material', fbxUrl)
            modelLoadedCallback(character)

            loadProgressCallback('Loading textures...')
            console.log('Using textures:', texturePathUrl)
            console.log('ReDrive character profile:', characterProfile)
            const nativeResourceLoader = nativeInput ? createNativeSlotResourceLoader(nativeInput, signal, texture => transactionTextures.add(texture)) : undefined;
            // Per loaded actor: identical controller owners share one moving
            // face anchor; another actor never shares these mutable vectors.
            const nativePerspectiveReferences = new Map<string, CharacterPerspectiveReference>();

            const textureResults = await Promise.allSettled(meshes.map(async mesh => {
                try {
                    mesh.castShadow = true
                    mesh.receiveShadow = true
                    mesh.userData.characterPerspectiveReference =
                        characterPerspectiveReference

                    if (nativeInput && nativeResourceLoader) {
                        const exact = await createNativeMeshMaterials(mesh, nativeInput, nativeResourceLoader, { root: modelObject, perspectiveReferences: nativePerspectiveReferences });
                        if (exact.perspectiveReference && !userData.animationLoops.includes(exact.perspectiveReference.update)) {
                            userData.animationLoops.push(exact.perspectiveReference.update);
                        }
                        bindOfficialMaterialGroups(mesh, exact.materials.get(0)!, exact.profiles, undefined, exact.materials);
                        const outlines = addOfficialOutlineGroupsToMesh(mesh, exact.profiles.map((profile, index) => ({
                            enabled: isOfficialOutlineExtrusionEnabled(profile), thickness: profile.outlineWidth,
                            color: new THREE.Color().setRGB(...profile.outline.color), shadowTex: exact.slots[index].result.shadowTex,
                            texBlend: profile.outline.texBlend, emissionColor: new THREE.Color().setRGB(...profile.outline.emissionColor),
                            outlineZOffset: profile.outline.zOffset, faceOutlineAdjust: profile.outline.faceOutlineAdjust,
                            characterPerspectiveReference: exact.perspectiveReference,
                        })));
                        userData.outlineMeshes.push(...outlines);
                        userData.textures.push(...new Set(exact.slots.flatMap(slot => Object.values(slot.resources.textures).filter((texture): texture is THREE.Texture => texture instanceof THREE.Texture))));
                        mesh.userData.nativeMaterialConstruction = { status: 'BOUND', slotCount: exact.slots.length, unknowns: exact.slots.map(slot => ({ index: slot.index, fields: slot.resources.unknowns, unresolvedFeatures: slot.unresolved })), nativeRenderParity: 'NOT_CLAIMED' };
                        installOfficialStencilWriters(mesh, exact.profiles, outlines, userData, characterStencilReference);
                        installOfficialStencilSelectorRuntime(mesh, exact.profiles, outlines, userData, characterStencilReference);
                        character.meshes.find(value => value.mesh === mesh)?.restoreDefaultVisibility();
                        return;
                    }

                    const meshMaterialNames = getMaterialNames(mesh)
                    const restoredSubmeshGroups = restoreOfficialSubmeshGroups(
                        mesh,
                        characterId,
                        meshMaterialNames.length,
                    )
                    const materialProfiles = getOfficialMaterialProfiles(meshMaterialNames)
                    const featureProfile = inferMaterialFeatures(meshMaterialNames)
                    console.log(
                        `Material slots of "${mesh.name}":`,
                        meshMaterialNames,
                        materialProfiles,
                        restoredSubmeshGroups,
                    )

                    const name = mesh.name
                        .replace('_Mesh', '')
                        .replace('_mesh', '')
                        .toLowerCase()
                    let meshTextures = ObjFilterByKey(texturePathUrl, path => path.includes(name))

                    if (meshMaterialNames.some(value => value.includes('weapon'))) {
                        let weaponNames = meshMaterialNames
                            .map(value => value.match(/(weapon_\w)($|_)/)?.at(1))
                            .filter((value): value is string => typeof value == 'string')
                        weaponNames = [...new Set(weaponNames)]
                        if (weaponNames.length == 1) {
                            meshTextures = ObjFilterByKey(texturePathUrl, path => path.includes(weaponNames[0]))
                        }
                    }
                    if (name.includes('face') && !name.includes('_a')) {
                        meshTextures = ObjFilterByKey(meshTextures, path => !path.includes('_a'))
                    }

                    if (Object.keys(meshTextures).length == 0) {
                        if (meshMaterialNames.some(value => value.includes('face'))) {
                            meshTextures = ObjFilterByKey(texturePathUrl, path => path.includes('face'))
                        } else if (name.includes('weapon')) {
                            meshTextures = ObjFilterByKey(texturePathUrl, path => path.includes('weapon'))
                        } else if (name.includes('eye')) {
                            meshTextures = ObjFilterByKey(texturePathUrl, path => path.includes('face'))
                        } else if (meshMaterialNames.some(value => value.includes('body'))) {
                            meshTextures = ObjFilterByKey(texturePathUrl, path => path.includes('body'))
                        } else {
                            meshTextures = ObjFilterByKey(texturePathUrl, path => path.includes('weapon'))
                        }
                    }

                    let colorMap = ObjFindByKey(meshTextures, path => path.includes('color'))
                    const shadowMap = ObjFindByKey(meshTextures, path => path.includes('shadow'))
                    const ctrlMap = ObjFindByKey(
                        meshTextures,
                        path => {
                            const lower = path.toLowerCase()
                            return (
                                lower.includes('ctrl') &&
                                !lower.includes('face_ctrl_nose')
                            )
                        },
                    )
                    if (!colorMap && shadowMap) colorMap = shadowMap
                    const customShaderSlots = materialProfiles.flatMap(
                        (profile, materialIndex) => {
                            const shaderProfile = profile.customShader ??
                                createOfficialReDriveCosmicShaderProfile(profile)
                            return shaderProfile
                            ? [{
                                materialIndex,
                                materialProfile: profile,
                                profile: shaderProfile,
                            }]
                            : []
                        },
                    )
                    const standaloneCustomShader =
                        customShaderSlots.length > 0 &&
                        customShaderSlots.length === materialProfiles.length &&
                        customShaderSlots.every(slot => !slot.profile.isCosmic)
                    if (!colorMap && !standaloneCustomShader) {
                        console.warn(`Could not find a color map for "${mesh.name}"`)
                        return
                    }

                    const sharedMaterialOptions = {
                        colorMap: colorMap!,
                        shadowMap,
                        ctrlMap,
                        materialNames: meshMaterialNames,
                        materialProfiles,
                        featureProfile,
                        specularGradientMap,
                        characterPerspectiveReference,
                    }

                    let alphaTex: THREE.Texture | undefined
                    let outlineShadowTex: THREE.Texture | undefined
                    let outlineFaceAdjust = 0
                    let material: THREE.Material
                    let textures: THREE.Texture[]
                    let officialCustomShaderResources:
                        OfficialCustomCharacterMaterialResources | undefined
                    let officialFaceAdditionalBindings:
                        readonly OfficialFaceAdditionalMaterialBinding[] | undefined
                    const customMaterialOverrides =
                        new Map<number, THREE.Material>()
                    const customShaderResourcesBySlot = new Map<
                        number,
                        OfficialCustomCharacterMaterialResources
                    >()
                    const requiresProjectedCosmicReference =
                        customShaderSlots.some(slot => slot.profile.isCosmic)
                    const cosmicReference = requiresProjectedCosmicReference
                        ? characterPerspectiveReference
                        : undefined
                    if (requiresProjectedCosmicReference && !cosmicReference) {
                        throw new Error(
                            'Official projected Cosmic requires the ' +
                            `serialized face reference: ${mesh.name}`,
                        )
                    }
                    let angelRingReference:
                        ReturnType<typeof createAngelRingReference>

                    if (standaloneCustomShader) {
                        const customSlot = customShaderSlots[0]
                        const customShaderProfile = customSlot.profile
                        const result =
                            await createOfficialCustomCharacterMaterial({
                                profile: customShaderProfile,
                            resolveTexture: findOfficialTextureUrl,
                                materialProfile: customSlot.materialProfile,
                                noiseMap: findOfficialTextureUrl(
                                    customShaderProfile.noiseTexture,
                                ),
                            })
                        material = result.material
                        textures = result.textures
                        officialCustomShaderResources = result.resources
                        customMaterialOverrides.set(
                            customSlot.materialIndex,
                            result.material,
                        )
                        customShaderResourcesBySlot.set(
                            customSlot.materialIndex,
                            result.resources,
                        )
                        mesh.userData.officialCustomCharacterShader = {
                            shader: customShaderProfile.name,
                            materialSlots: meshMaterialNames,
                            noiseTexture: customShaderProfile.noiseTexture,
                            forwardCutoff: customShaderProfile.forwardCutoff,
                            outlineCutoff: customShaderProfile.outlineCutoff,
                        }
                    } else if (name.includes('face')) {
              const faceProfile = getOfficialFaceProfile(characterId)
              outlineFaceAdjust = faceProfile.faceOutlineAdjust
              const faceReference = createFaceDirectionReference(modelObject, characterProfile)
              const faceAdditionalMaps = materialProfiles.map(
                  (profile, materialIndex) => {
                      const textureName = profile.face.additionalTexture
                      if (!textureName) return null
                      const url = findOfficialTextureUrl(textureName)
                      if (!url) {
                          throw new Error(
                              'Serialized _FaceAdditionalMap Texture2D is missing: '
                              + `${profile.name} slot=${materialIndex} texture=${textureName}`,
                          )
                      }
                      return url
                  },
              )
              const result = await createFaceMaterial({
                  ...sharedMaterialOptions,
                  shadowMap: shadowMap!,
                           faceAdditionalMaps,
                           noseGradientMap: ObjFindByKey(
                               texturePathUrl,
                               path => path
                                   .toLowerCase()
                                   .includes('face_ctrl_nose'),
                           ),
                           faceProfile,
                  faceReference,
              })
              material = result.material
              textures = result.textures
              officialFaceAdditionalBindings =
                  result.officialFaceAdditionalBindings
              outlineShadowTex = result.shadowTex
              mesh.userData.officialFaceAdditionalRuntime =
                  result.officialFaceAdditionalRuntime
              if (result.updateFaceDirectionReference) {
                  userData.animationLoops.push(result.updateFaceDirectionReference)
              }
              console.log('Official face profile/reference:', faceProfile, faceReference)
                    } else {
                        let alphaSrc: 'ctrl' | 'shadow' | undefined
                        if (characterId == 100106 && name.includes('body')) alphaSrc = 'shadow'
                            else if (characterId == 100205 && name.includes('acc')) alphaSrc = 'shadow'
                            else if (characterId == 113801 && name.includes('weapon')) alphaSrc = undefined
                            else if (shadowMap != undefined && ctrlMap == undefined) alphaSrc = 'shadow'
                            else if (shadowMap == undefined && ctrlMap != undefined) alphaSrc = 'ctrl'
                            else if (meshMaterialNames.some(value => value.includes('trans') || value.includes('trs'))) alphaSrc = 'shadow'
                            else if (meshMaterialNames.some(value => value.includes('alpha'))) alphaSrc = name.includes('hair') ? 'shadow' : 'ctrl'

                            if (name.includes('hair')) {
                        angelRingReference ??= createAngelRingReference(modelObject, mesh, characterProfile)
                        if (angelRingReference) {
                            const requiresCharacterAngelRingMap =
                                materialProfiles.some(
                                    profile =>
                                        profile.angelRing.map === 'character',
                                )
                            const characterAngelRingMapNames = [
                                ...new Set(
                                    materialProfiles
                                        .filter(
                                            profile =>
                                                profile.angelRing.map ===
                                                'character',
                                        )
                                        .map(
                                            profile =>
                                                profile.angelRing.texture,
                                        )
                                        .filter(
                                            (value): value is string =>
                                                Boolean(value),
                                        ),
                                ),
                            ]
                            if (
                                requiresCharacterAngelRingMap &&
                                characterAngelRingMapNames.length !== 1
                            ) {
                                throw new Error(
                                    'Official character AngelRing Texture2D ' +
                                    `identity is unresolved: ${JSON.stringify(
                                        characterAngelRingMapNames,
                                    )}`,
                                )
                            }
                            const angelRingMapName =
                                characterAngelRingMapNames[0]
                            const angelRingMapEntry =
                                requiresCharacterAngelRingMap
                                ? Object.entries(texturePathUrl).find(
                                    ([path]) =>
                                        normalizeOfficialTextureName(path) ===
                                        normalizeOfficialTextureName(
                                            angelRingMapName,
                                        ),
                                )
                                : undefined
                            const angelRingMap = angelRingMapEntry?.[1]
                            if (
                                requiresCharacterAngelRingMap &&
                                !angelRingMap
                            ) {
                                console.warn(
                                    'Official character AngelRing map is missing:',
                                    meshMaterialNames,
                                )
                            }
                            const result = await createHairMaterial({
                                ...sharedMaterialOptions,
                                alphaSrc,
                                angelRingReference,
                                angelRingMap,
                                angelRingMapName,
                            })
                            material = result.material
                            textures = result.textures
                            alphaTex = result.alphaTex
                            outlineShadowTex = result.shadowTex
                            if (result.updateAngelRingReference) {
                                installAngelRingDrawReferenceUpdate(mesh, result.updateAngelRingReference)
                            }
                        } else {
                            const result = await createGeneralMaterial({
                                ...sharedMaterialOptions,
                                alphaSrc,
                            })
                            material = result.material
                            textures = result.textures
                            alphaTex = result.alphaTex
                            outlineShadowTex = result.shadowTex
                        }
                        console.log('AngelRing capability/reference:', {
                            enabled: characterProfile.angelRingEnabled,
                            reference: angelRingReference,
                        })
                            } else {
                                const result = await createGeneralMaterial({
                                    ...sharedMaterialOptions,
                                    alphaSrc,
                                })
                                material = result.material
                                textures = result.textures
                                alphaTex = result.alphaTex
                                outlineShadowTex = result.shadowTex
                        }
                    }

                    let officialGemResources: OfficialGemResources | undefined
                    if (materialProfiles.some(
                        profile => profile.gem.enabled || profile.matCap.enabled,
                    )) {
                        const extension = await extendMaterialWithOfficialGem(
                            material,
                            materialProfiles,
                            texturePathUrl,
                        )
                        officialGemResources = extension.resources
                        textures.push(...extension.resources.textures)
                    }
                    for (const customSlot of customShaderSlots) {
                        if (
                            customShaderResourcesBySlot.has(
                                customSlot.materialIndex,
                            )
                        ) continue
                        const customProfile = customSlot.profile
                        const slotProfile = customSlot.materialProfile
                        const standardReDriveCosmic =
                            isOfficialStandardReDriveCosmicShader(customProfile)
                        let customBaseMaterial = material
                        if (standardReDriveCosmic) {
                            const cosmic = slotProfile.cosmic
                            const baseMap = findOfficialTextureUrl(
                                cosmic.baseTexture,
                            )
                            const exactShadowMap = findOfficialTextureUrl(
                                cosmic.shadowTexture,
                            )
                            const exactControlMap = findOfficialTextureUrl(
                                cosmic.controlTexture,
                            )
                            const declaredNullBaseMap = hasOfficialNullCosmicBaseMap(slotProfile)
                            if (!baseMap && !declaredNullBaseMap) {
                                throw new Error(
                                    'Serialized standard ReDrive Cosmic ' +
                                    `BaseMap is missing: ${slotProfile.name} ` +
                                    `texture=${cosmic.baseTexture}`,
                                )
                            }
                            if (
                                (cosmic.alphaClipping ||
                                    slotProfile.surface.transparency) &&
                                !exactShadowMap
                            ) {
                                throw new Error(
                                    'Serialized standard ReDrive Cosmic ' +
                                    `ShadowTex alpha is missing: ${slotProfile.name}`,
                                )
                            }
                            if (cosmic.controlTexture && !exactControlMap) {
                                throw new Error(`Serialized Cosmic ControlMap is missing: ${slotProfile.name} texture=${cosmic.controlTexture}`)
                            }
                            const dedicated = await createGeneralMaterial({
                                colorMap: baseMap ?? '',
                                officialNullBaseMap: declaredNullBaseMap ? slotProfile : undefined,
                                shadowMap: exactShadowMap,
                                ctrlMap: exactControlMap,
                                alphaSrc:
                                    cosmic.alphaClipping ||
                                    slotProfile.surface.transparency
                                        ? 'shadow'
                                        : undefined,
                                materialNames: [slotProfile.name],
                                materialProfiles: [slotProfile],
                                featureProfile: inferMaterialFeatures([
                                    slotProfile.name,
                                ]),
                                specularGradientMap,
                                characterPerspectiveReference,
                            })
                            customBaseMaterial = dedicated.material
                            textures.push(...dedicated.textures)
                            if (
                                slotProfile.gem.enabled ||
                                slotProfile.matCap.enabled
                            ) {
                                const extension =
                                    await extendMaterialWithOfficialGem(
                                        customBaseMaterial,
                                        [slotProfile],
                                        texturePathUrl,
                                    )
                                textures.push(...extension.resources.textures)
                            }
                        }
                        const cosmicTextureName = slotProfile.cosmic.enabled
                            ? slotProfile.cosmic.texture
                            : customProfile.cosmicTexture
                        const cosmicNoiseTextureName =
                            slotProfile.cosmic.enabled
                                ? slotProfile.cosmic.noiseTexture
                                : customProfile.cosmicNoiseTexture
                        const result = await createOfficialCustomCharacterMaterial({
                            profile: customProfile,
                            resolveTexture: findOfficialTextureUrl,
                            materialProfile: slotProfile,
                            baseMaterial: customBaseMaterial,
                            dedicatedBaseMaterial: standardReDriveCosmic,
                            noiseMap: findOfficialTextureUrl(
                                customProfile.noiseTexture,
                            ),
                            cosmicMap: findOfficialTextureUrl(
                                cosmicTextureName,
                            ),
                            cosmicNoiseMap: findOfficialTextureUrl(
                                cosmicNoiseTextureName,
                            ),
                            cosmicTextureSampler:
                                cosmicTextureName
                                    ? getOfficialTextureSamplerProfile(
                                        cosmicTextureName,
                                    )
                                    : undefined,
                            cosmicNoiseTextureSampler:
                                cosmicNoiseTextureName
                                    ? getOfficialTextureSamplerProfile(
                                        cosmicNoiseTextureName,
                                    )
                                    : undefined,
                            cosmicReference,
                        })
                        customMaterialOverrides.set(
                            customSlot.materialIndex,
                            result.material,
                        )
                        customShaderResourcesBySlot.set(
                            customSlot.materialIndex,
                            result.resources,
                        )
                        textures.push(...result.textures)
                    }
                    if (customShaderSlots.length > 0) {
                        mesh.userData.officialCustomCharacterShaderSlots =
                            customShaderSlots.map(customSlot => {
                                const group = mesh.geometry.groups.find(
                                    value =>
                                        (value.materialIndex ?? 0) ===
                                        customSlot.materialIndex,
                                )
                                return {
                                    materialIndex: customSlot.materialIndex,
                                    materialName:
                                        customSlot.materialProfile.name,
                                    shader: customSlot.profile.name,
                                    customRenderQueue:
                                        customSlot.materialProfile
                                            .customRenderQueue,
                                    groupStart: group?.start ?? 0,
                                    groupCount: group?.count ?? 0,
                                    baseTexture:
                                        customSlot.profile.baseTexture,
                                    shadowTexture:
                                        customSlot.profile.shadowTexture,
                                    controlTexture:
                                        customSlot.profile.controlTexture,
                                    cosmicTexture:
                                        customSlot.profile.cosmicTexture,
                                    cosmicNoiseTexture:
                                        customSlot.profile.cosmicNoiseTexture,
                                    isCosmic: customSlot.profile.isCosmic,
                                    alphaClipping:
                                        customSlot.profile.alphaClipping,
                                    stencil:
                                        customSlot.materialProfile.stencil,
                                }
                            })
                    }
                    bindOfficialMaterialGroups(
                        mesh,
                        material,
                        materialProfiles,
                        officialGemResources,
                        customMaterialOverrides,
                        customShaderResourcesBySlot,
                        officialFaceAdditionalBindings,
                    )
                    userData.textures.push(...textures)

                    if (alphaTex) {
                        mesh.customDepthMaterial = createDepthMaterial(alphaTex)
                        mesh.customDistanceMaterial = createDistanceMaterial(alphaTex)
                    }
                    character.meshes.find(value => value.mesh == mesh)?.restoreDefaultVisibility()
                    if (name.includes('weapon')) mesh.frustumCulled = false
                    mesh.renderOrder = name.includes('hair') ? 1 : 2

                    const outlineMeshes = addOfficialOutlineGroupsToMesh(
                        mesh,
                        materialProfiles.map(profile => ({
                            // Blob 6 suppresses both `_UseOutline == 0` and
                            // transparent material slots before extrusion.
                            enabled: isOfficialOutlineExtrusionEnabled(profile),
                            thickness: profile.outlineWidth,
                            color: new THREE.Color().setRGB(
                                ...profile.outline.color,
                            ),
                            alphaTex,
                            shadowTex: outlineShadowTex,
                            texBlend: profile.outline.texBlend,
                            emissionColor: new THREE.Color().setRGB(
                                ...profile.outline.emissionColor,
                            ),
                            outlineZOffset: profile.outline.zOffset,
                            faceOutlineAdjust:
                                profile.source === 'official-export'
                                    ? profile.outline.faceOutlineAdjust
                                    : outlineFaceAdjust,
                            characterPerspectiveReference,
                        })),
                    )
                    if (
                        officialCustomShaderResources ||
                        customShaderResourcesBySlot.size > 0
                    ) {
                        outlineMeshes.forEach(outlineMesh => {
                            const outlineMaterial = outlineMesh.material
                            const materialIndex = Number(
                                outlineMesh.userData.officialMaterialIndex ?? 0,
                            )
                            const resources =
                                customShaderResourcesBySlot.get(materialIndex) ??
                                officialCustomShaderResources
                            if (
                                resources &&
                                outlineMaterial instanceof THREE.ShaderMaterial
                            ) {
                                installOfficialCustomCharacterOutline(
                                    outlineMaterial,
                                    resources,
                                )
                            }
                        })
                    }
                    userData.outlineMeshes.push(...outlineMeshes)
                    outlineMeshes.forEach(outlineMesh => {
                        outlineMesh.renderOrder = 3
                    })

                    let outlineStencilRef = 0
                    if (name.includes('face') || name.includes('weapon')) {
                        outlineStencilRef = characterStencilReference
                        setStencil(mesh.material, outlineStencilRef)
                        outlineMeshes.forEach(outlineMesh => {
                            const outlineMaterials = Array.isArray(outlineMesh.material)
                                ? outlineMesh.material
                                : [outlineMesh.material]
                            outlineMaterials.forEach(outlineMaterial => {
                                outlineMaterial.stencilWrite = true
                                outlineMaterial.stencilRef = outlineStencilRef
                                outlineMaterial.stencilFunc = THREE.NotEqualStencilFunc
                            })
                        })
                    }
                    const writerRuntime = installOfficialStencilWriters(
                        mesh,
                        materialProfiles,
                        outlineMeshes,
                        userData,
                        characterStencilReference,
                    )
                    if (writerRuntime) {
                        mesh.userData.officialStencilWriters = writerRuntime
                    }
                    const selectorRuntime = installOfficialStencilSelectorRuntime(
                        mesh,
                        materialProfiles,
                        outlineMeshes,
                        userData,
                        characterStencilReference,
                    )
                    if (selectorRuntime) {
                        mesh.userData.officialStencilSelectors = selectorRuntime
                    }
                } catch (error) {
                    console.error(`Error applying texture to "${mesh.name}":`, error)
                    throw characterAssetLoadError(
                        'texture-material',
                        `${fbxUrl}#mesh=${encodeURIComponent(mesh.name)}`,
                        error,
                    )
                }
            }))
            const textureFailures = textureResults.filter(
                (result): result is PromiseRejectedResult =>
                    result.status === 'rejected',
            )
            if (textureFailures.length > 0) {
                throw textureFailures[0].reason
            }
            throwIfCharacterLoadAborted(signal, 'texture-material', fbxUrl)

            if (!character.disposed) loadFinishCallback(character)
            completed = true
            if (!inheritedLoadingTask) loadingTask.complete()
            return character
    } catch (error) {
        loadingTask.fail(error)
        if (character && !character.disposed) {
            character.dispose()
        } else if (modelObject) {
            // FBX may already be parsed when a companion or texture stage
            // fails.  Dispose that detached root before surfacing the error.
            modelObject.traverse(object => {
                if (!(object as THREE.Mesh).isMesh) return
                const mesh = object as THREE.Mesh
                mesh.geometry.dispose()
                const materials = Array.isArray(mesh.material)
                    ? mesh.material
                    : [mesh.material]
                materials.forEach(material => material?.dispose())
            })
        }
        transactionTextures.forEach(texture => texture.dispose())
        throw error
    } finally {
        releaseTextureContext()
        if (!completed && signal?.aborted) {
            console.info('Character load transaction aborted', {
                reason: signal.reason,
            })
        }
        loadProgressCallback('')
    }
}

/** Refresh forward-pass inputs after the final pose, including late pose editors. */
export function installAngelRingDrawReferenceUpdate(
    mesh: THREE.Mesh,
    updateReference: () => void,
) {
    const previousOnBeforeRender = mesh.onBeforeRender
    mesh.onBeforeRender = function (...args) {
        previousOnBeforeRender.call(this, ...args)
        updateReference()
    }
}
