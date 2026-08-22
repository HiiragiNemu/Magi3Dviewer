import * as THREE from 'three';
import 'abortcontroller-polyfill/dist/polyfill-patch-fetch'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import {
    createGeneralMaterial,
    createFaceMaterial,
    addOfficialOutlineGroupsToMesh,
    createBodyInsideMaterial,
    createHairMaterial,
    createDepthMaterial,
    createDistanceMaterial,
    extendMaterialWithOfficialGem,
    setAngelRingCameraUniforms,
    setOfficialAngelRingMaterialProfileUniforms,
    setOfficialMaterialProfileUniforms,
    setOfficialFaceMaterialProfileUniforms,
    selectOfficialMatCap,
    setDepthRimVertexColorAvailability,
    MaterialUserData,
    type OfficialGemResources,
} from './shaders'
import { ObjFindByKey, ObjFilterByKey, humanizeBytes, fetchAndTryDecompressGzip } from './utils';
import MagiaExedraCharacter3D, { type ObjectUserData } from './character';
import {
    createAngelRingReference,
    createCharacterPerspectiveReference,
    getCharacterReDriveProfile,
    inferMaterialFeatures,
} from './renderProfile';
import {
    getOfficialMaterialProfiles,
    loadOfficialMaterialProfiles,
    type OfficialMaterialProfile,
} from './materialProfile';
import { createFaceDirectionReference, getOfficialFaceProfile } from './faceProfile';
import { restoreOfficialSubmeshGroups } from './submeshGroups';
import {
    parseReDriveBakedNormals,
    restoreReDriveBakedNormalAttribute,
    type ReDriveBakedNormalData,
} from './bakedNormal';
import {
    attachHomeAnimationRuntime,
    type HomeAnimationRuntime,
    type HomeExpressionRuntime,
} from './homeRuntime';

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

async function fetchJsonRuntime<T>(url: string): Promise<T> {
    const blob = await fetchAndTryDecompressGzip(url)
    return JSON.parse(await blob.text()) as T
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

export interface LoadCharacterCallbacks {
    loadProgressCallback: (progress: string) => any
    modelLoadedCallback: (model: MagiaExedraCharacter3D) => any
    loadFinishCallback: (model: MagiaExedraCharacter3D) => any
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

/**
 * FBX geometry groups refer to original Unity material slots. Replacing an array
 * with one aggregate material erased that information and made body Soul Gems,
 * anisotropic fabric and outline-offset pieces impossible to render correctly.
 *
 * Keep one shared compiled material/texture set for memory efficiency, but retain
 * an array entry for every group and update only scalar feature uniforms before
 * each draw call.
 */
function bindOfficialMaterialGroups(
    mesh: THREE.Mesh,
    material: THREE.Material,
    profiles: OfficialMaterialProfile[],
    gemResources?: OfficialGemResources,
) {
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
    const materials = Array.from({ length: slots }, (_, index) => {
        const slotMaterial = index === 0 ? material : material.clone()
        if (index > 0) {
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
        userData.officialMaterialProfile =
            slotProfiles[index] ?? slotProfiles[0]
        return slotMaterial
    })
    mesh.material = materials.length > 1 ? materials : materials[0]
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
        const index = (
            group as unknown as { materialIndex?: number } | null
        )?.materialIndex ?? 0
        const profile = slotProfiles[index] ?? slotProfiles[0]
        setOfficialMaterialProfileUniforms(shader, profile)
        setOfficialFaceMaterialProfileUniforms(shader, profile)
        if (shader && gemResources) {
            const matCap = selectOfficialMatCap(gemResources, profile)
            shader.uniforms.tGemMatCap ??= { value: matCap ?? null }
            shader.uniforms.tGemMatCap.value = matCap ?? null
        }
        setOfficialAngelRingMaterialProfileUniforms(shader, profile)
        setAngelRingCameraUniforms(shader, renderer, camera)
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

const OFFICIAL_HAIR_MASK_STENCIL_REF = 0x80
const CHARACTER_OPAQUE_RENDER_ORDER = 2

interface OfficialGeometryGroup {
    start: number
    count: number
    materialIndex?: number
}

function mapOfficialOpaqueQueueToRenderOrder(queue: number): number {
    return CHARACTER_OPAQUE_RENDER_ORDER + (queue - 2000) / 1000
}

function createSharedMaterialGroupGeometry(
    source: THREE.BufferGeometry,
    group: OfficialGeometryGroup,
): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.name = `${source.name}:official-material-group`
    if (source.index) geometry.setIndex(source.index)
    for (const [name, attribute] of Object.entries(source.attributes)) {
        geometry.setAttribute(name, attribute)
    }
    geometry.morphAttributes = source.morphAttributes
    geometry.morphTargetsRelative = source.morphTargetsRelative
    geometry.boundingBox = source.boundingBox
    geometry.boundingSphere = source.boundingSphere
    geometry.setDrawRange(group.start, group.count)
    return geometry
}

function configureStencilTest(
    material: THREE.Material,
    func: THREE.StencilFunc,
    writeMask: number,
) {
    material.stencilWrite = true
    material.stencilRef = OFFICIAL_HAIR_MASK_STENCIL_REF
    material.stencilFunc = func
    material.stencilFuncMask = OFFICIAL_HAIR_MASK_STENCIL_REF
    material.stencilWriteMask = writeMask
    material.stencilFail = THREE.KeepStencilOp
    material.stencilZFail = THREE.KeepStencilOp
    material.stencilZPass = THREE.KeepStencilOp
}

/**
 * 101901's eye/eyebrow mask materials are queue 2001 stencil writers. Preserve
 * the existing low seven-bit outline reference while writing Unity's bit 128;
 * the queue-2002 hair_out draws then select outside/inside that authored mask.
 */
function install101901FaceMaskStencil(
    characterId: number,
    materials: THREE.Material | THREE.Material[],
    profiles: OfficialMaterialProfile[],
    outlineMeshes: THREE.SkinnedMesh[],
    outlineRef: number,
) {
    if (characterId !== 101901 || !Array.isArray(materials)) return
    const lowerRef = outlineRef & 0x7f
    const maskNames = new Set([
        'mt_chara_101901_eyebrow_mask',
        'mt_chara_101901_eye_mask',
    ])
    materials.forEach((material, index) => {
        material.stencilFuncMask = 0x7f
        material.stencilWriteMask = 0x7f
        if (!maskNames.has(profiles[index]?.name)) return
        material.stencilRef = lowerRef | OFFICIAL_HAIR_MASK_STENCIL_REF
        material.stencilFunc = THREE.AlwaysStencilFunc
        material.stencilFuncMask = 0xff
        material.stencilWriteMask = 0xff
        material.stencilZPass = THREE.ReplaceStencilOp
    })
    outlineMeshes.forEach(outlineMesh => {
        const outlineMaterials = Array.isArray(outlineMesh.material)
            ? outlineMesh.material
            : [outlineMesh.material]
        outlineMaterials.forEach(material => {
            material.stencilRef = lowerRef
            material.stencilFuncMask = 0x7f
            material.stencilWriteMask = 0
        })
    })
}

function configure101901HairOutOutline(
    outlineMeshes: readonly THREE.SkinnedMesh[],
    queue: number,
) {
    const outlineMesh = outlineMeshes.find(mesh =>
        mesh.name.endsWith('official-outline:1')
    )
    if (!outlineMesh) {
        throw new Error('101901 hair_out official outline group is missing')
    }
    outlineMesh.renderOrder = 3 + (queue - 2000) / 1000
    const outlineMaterials = Array.isArray(outlineMesh.material)
        ? outlineMesh.material
        : [outlineMesh.material]
    for (const outlineMaterial of outlineMaterials) {
        configureStencilTest(outlineMaterial, THREE.NotEqualStencilFunc, 0)
    }
}

/**
 * Unity renders 101901 Hair_Mesh slot 1 as an independent queue-2002 draw and
 * enables its RdToonStencilMaskPass. Build two child draws that share the
 * source vertex/index buffers, Skeleton and live morph arrays. Slot 0 remains
 * on the original SkinnedMesh, so no texture, skin or animation is duplicated.
 */
function install101901HairOutRuntime(
    characterId: number,
    mesh: THREE.Mesh,
    profiles: OfficialMaterialProfile[],
    outlineMeshes: readonly THREE.SkinnedMesh[],
    userData: ObjectUserData,
): boolean {
    if (characterId !== 101901 || mesh.name.toLowerCase() !== 'hair_mesh') {
        return false
    }
    if (!(mesh instanceof THREE.SkinnedMesh) || !mesh.skeleton) return false
    if (!Array.isArray(mesh.material)) return false

    const hairOutMaterialIndex = profiles.findIndex(
        profile => profile.name === 'mt_chara_101901_hair_out',
    )
    const hairOutProfile = profiles[hairOutMaterialIndex]
    const hairOutGroup = mesh.geometry.groups.find(
        (group: OfficialGeometryGroup) =>
            (group.materialIndex ?? 0) === hairOutMaterialIndex,
    )
    if (
        hairOutMaterialIndex !== 1
        || !hairOutProfile
        || hairOutProfile.customRenderQueue !== 2002
        || !hairOutGroup
        || hairOutGroup.count !== 2400
    ) {
        throw new Error('101901 hair_out official slot/queue/range mismatch')
    }

    const materials = mesh.material
    const hairOutMaterial = materials[hairOutMaterialIndex]
    configure101901HairOutOutline(
        outlineMeshes,
        hairOutProfile.customRenderQueue,
    )
    const sourceOnBeforeRender = mesh.onBeforeRender
    const groupGeometry = createSharedMaterialGroupGeometry(
        mesh.geometry,
        hairOutGroup,
    )
    const hairOutMesh = new THREE.SkinnedMesh(groupGeometry, hairOutMaterial)
    hairOutMesh.name = `${mesh.name}:mt_chara_101901_hair_out:forward`
    hairOutMesh.bind(mesh.skeleton, mesh.bindMatrix)
    hairOutMesh.bindMode = mesh.bindMode
    hairOutMesh.morphTargetInfluences = mesh.morphTargetInfluences
    hairOutMesh.morphTargetDictionary = mesh.morphTargetDictionary
    hairOutMesh.castShadow = mesh.castShadow
    hairOutMesh.receiveShadow = mesh.receiveShadow
    hairOutMesh.frustumCulled = mesh.frustumCulled
    hairOutMesh.renderOrder = mapOfficialOpaqueQueueToRenderOrder(
        hairOutProfile.customRenderQueue,
    )
    hairOutMesh.userData.officialMaterialProfiles = [hairOutProfile]
    configureStencilTest(hairOutMaterial, THREE.NotEqualStencilFunc, 0)

    hairOutMesh.onBeforeRender = function (
        renderer,
        scene,
        camera,
        geometry,
        renderMaterial,
        _group,
    ) {
        sourceOnBeforeRender.call(
            this,
            renderer,
            scene,
            camera,
            geometry,
            renderMaterial,
            { materialIndex: hairOutMaterialIndex } as unknown as THREE.Group,
        )
    }

    const hairOutMaskMaterial = hairOutMaterial.clone()
    hairOutMaskMaterial.name =
        `${hairOutMaterial.name}:RdToonStencilMaskPass`
    hairOutMaskMaterial.onBeforeCompile = hairOutMaterial.onBeforeCompile
    hairOutMaskMaterial.customProgramCacheKey = () =>
        `${hairOutMaterial.customProgramCacheKey()}:stencil-mask`
    hairOutMaskMaterial.userData = new MaterialUserData()
    hairOutMaskMaterial.userData.officialMaterialProfile = hairOutProfile
    hairOutMaskMaterial.opacity = 1 - 0.75
    hairOutMaskMaterial.transparent = false
    hairOutMaskMaterial.blending = THREE.CustomBlending
    hairOutMaskMaterial.blendSrc = THREE.SrcAlphaFactor
    hairOutMaskMaterial.blendDst = THREE.OneMinusSrcAlphaFactor
    hairOutMaskMaterial.blendEquation = THREE.AddEquation
    hairOutMaskMaterial.depthTest = true
    hairOutMaskMaterial.depthWrite = true
    configureStencilTest(hairOutMaskMaterial, THREE.EqualStencilFunc, 0)

    const hairOutMaskMesh = new THREE.SkinnedMesh(
        createSharedMaterialGroupGeometry(mesh.geometry, hairOutGroup),
        hairOutMaskMaterial,
    )
    hairOutMaskMesh.name =
        `${mesh.name}:mt_chara_101901_hair_out:stencil-mask`
    hairOutMaskMesh.bind(mesh.skeleton, mesh.bindMatrix)
    hairOutMaskMesh.bindMode = mesh.bindMode
    hairOutMaskMesh.morphTargetInfluences = mesh.morphTargetInfluences
    hairOutMaskMesh.morphTargetDictionary = mesh.morphTargetDictionary
    hairOutMaskMesh.castShadow = mesh.castShadow
    hairOutMaskMesh.receiveShadow = mesh.receiveShadow
    hairOutMaskMesh.frustumCulled = mesh.frustumCulled
    hairOutMaskMesh.renderOrder = hairOutMesh.renderOrder + 0.0001
    hairOutMaskMesh.userData.officialMaterialProfiles = [hairOutProfile]
    hairOutMaskMesh.onBeforeRender = hairOutMesh.onBeforeRender

    const mainGroups = mesh.geometry.groups.filter(
        (group: OfficialGeometryGroup) =>
            (group.materialIndex ?? 0) !== hairOutMaterialIndex,
    )
    mesh.geometry.clearGroups()
    mainGroups.forEach((group: OfficialGeometryGroup) => {
        mesh.geometry.addGroup(group.start, group.count, group.materialIndex ?? 0)
    })
    mesh.material = [materials[0]]
    mesh.add(hairOutMesh)
    mesh.add(hairOutMaskMesh)
    userData.meshes.push(hairOutMesh, hairOutMaskMesh)
    return true
}

export async function loadCharacter(
    files: Record<string, string>,
    callbacks?: Partial<LoadCharacterCallbacks>,
): Promise<MagiaExedraCharacter3D> {
    const loadProgressCallback = callbacks?.loadProgressCallback || (() => undefined)
    const modelLoadedCallback = callbacks?.modelLoadedCallback || (() => undefined)
    const loadFinishCallback = callbacks?.loadFinishCallback || (() => undefined)

    loadProgressCallback('Loading official material profiles...')
    try {
        await loadOfficialMaterialProfiles()
    } catch (error) {
        loadProgressCallback('Material profile FAILED')
        throw error
    }

    const fbxPathUrl = ObjFilterByKey(files, path => path.includes('.fbx'))
    const fbxPath = Object.keys(fbxPathUrl)[0]
    const characterId = parseInt(fbxPath.match(/chara_(\d+).*\//)![1])
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
    const texturePathUrl = ObjFilterByKey(files, path => path.includes('.png'))
    const specularGradientMap = ObjFindByKey(
        texturePathUrl,
        path => path.toLowerCase().includes('rdtoon_metallic_gradient_map'),
    )
    const characterProfile = getCharacterReDriveProfile(characterId)

    return new Promise(async (resolve, reject) => {
        console.log('Loading model:', fbxPathUrl)
        loadProgressCallback('Loading FBX...')

        let fbxBlob: Blob
        try {
            fbxBlob = await fetchAndTryDecompressGzip(
                fbxUrl,
                progress => {
                    const loaded = humanizeBytes(progress.loaded)
                    const total = humanizeBytes(progress.total)
                    loadProgressCallback(`Downloading FBX... ${progress.lengthComputable ? `${loaded} / ${total}` : loaded}`)
                },
                () => loadProgressCallback('Decompressing FBX...'),
            )
        } catch (error) {
            loadProgressCallback('Download FAILED')
            reject(error)
            return
        }

        loadProgressCallback('Parsing geometry...')
        let modelObject: THREE.Group
        try {
            // Parse the already-downloaded, already-decompressed buffer
            // directly. Re-wrapping it in a blob URL made FBXLoader perform a
            // second asynchronous request and could expose a stale/truncated
            // blob to the parser after rapid preview rebuilds.
            const fbxBuffer = await fbxBlob.arrayBuffer()
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
        } catch (error) {
            loadProgressCallback('Parse FAILED')
            reject(error)
            return
        }

            let bakedNormalData: ReDriveBakedNormalData | undefined
            if (bakedNormalUrl) {
                loadProgressCallback('Loading official baked normals...')
                try {
                    const bakedNormalBlob = await fetchAndTryDecompressGzip(
                        bakedNormalUrl,
                    )
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
                    reject(error)
                    return
                }
            }

            let homeAnimationRuntime: HomeAnimationRuntime | undefined
            let homeExpressionRuntime: HomeExpressionRuntime | undefined
            if (homeAnimationUrl || homeExpressionUrl) {
                loadProgressCallback('Loading Home actions and expressions...')
                try {
                    const [animationRuntime, expressionRuntime] = await Promise.all([
                        homeAnimationUrl
                            ? fetchJsonRuntime<HomeAnimationRuntime>(homeAnimationUrl)
                            : Promise.resolve(undefined),
                        homeExpressionUrl
                            ? fetchJsonRuntime<HomeExpressionRuntime>(homeExpressionUrl)
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
                    reject(error)
                    return
                }
            }

            console.log(`Model "${modelObject.name}" loaded successfully`)

            modelObject.updateMatrixWorld(true)
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
                        let bakedNormalKey = mesh.name
                        let official = bakedNormalData?.meshes.get(bakedNormalKey)
                        if (!official && bakedNormalData) {
                            const objectPath = getModelObjectPath(mesh, modelObject)
                            bakedNormalKey = `${mesh.name}\x00${objectPath}`
                            official = bakedNormalData.meshes.get(bakedNormalKey)
                        }
                        if (official) matchedBakedNormalMeshes.add(bakedNormalKey)
                        restoreReDriveBakedNormalAttribute(mesh.geometry, official)
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
                reject(
                    geometryChannelError
                    ?? new Error(
                        `FBX matched ${matchedBakedNormalMeshes.size} of `
                        + `${bakedNormalData!.meshes.size} baked-normal meshes`,
                    ),
                )
                return
            }

            const userData: ObjectUserData = {
                characterId,
                meshes,
                textures: [],
                outlineMeshes: [],
                animationLoops: [],
                homeAnimationRuntime,
                homeExpressionRuntime,
            }
            modelObject.userData = userData

            const characterPerspectiveReference =
                createCharacterPerspectiveReference(
                    modelObject,
                    characterProfile,
                )
            if (characterPerspectiveReference) {
                userData.animationLoops.push(
                    characterPerspectiveReference.update,
                )
            }

            const character = new MagiaExedraCharacter3D(modelObject)
            resolve(character)
            modelLoadedCallback(character)

            loadProgressCallback('Loading textures...')
            console.log('Using textures:', texturePathUrl)
            console.log('ReDrive character profile:', characterProfile)

            await Promise.all(meshes.map(mesh => new Promise<void>(async finish => {
                try {
                    mesh.castShadow = true
                    mesh.receiveShadow = true

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
                    if (!colorMap) {
                        console.warn(`Could not find a color map for "${mesh.name}"`)
                        return
                    }

                    const sharedMaterialOptions = {
                        colorMap,
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

                    if (name.includes('face')) {
              const faceProfile = getOfficialFaceProfile(characterId)
              outlineFaceAdjust = faceProfile.faceOutlineAdjust
              const faceReference = createFaceDirectionReference(modelObject, characterProfile)
              const result = await createFaceMaterial({
                  ...sharedMaterialOptions,
                  shadowMap: shadowMap!,
                           eyehighlightMap: ObjFindByKey(texturePathUrl, path => path.includes('eye'))!,
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
              outlineShadowTex = result.shadowTex
              if (result.updateFaceDirectionReference) {
                  userData.animationLoops.push(result.updateFaceDirectionReference)
              }
              console.log('Official face profile/reference:', faceProfile, faceReference)
                    } else {
                        let alphaSrc: 'ctrl' | 'shadow' | undefined
                        if ((characterId == 113701 || characterId == 113801) && name.includes('body')) {
                            const result = await createBodyInsideMaterial(sharedMaterialOptions, texturePathUrl)
                            material = result.material
                            textures = result.textures
                            alphaTex = result.alphaTex
                            outlineShadowTex = result.shadowTex
                            userData.animationLoops.push(result.animate)
                        } else {
                            if (characterId == 100106 && name.includes('body')) alphaSrc = 'shadow'
                            else if (characterId == 100205 && name.includes('acc')) alphaSrc = 'shadow'
                            else if (characterId == 113801 && name.includes('weapon')) alphaSrc = undefined
                            else if (shadowMap != undefined && ctrlMap == undefined) alphaSrc = 'shadow'
                            else if (shadowMap == undefined && ctrlMap != undefined) alphaSrc = 'ctrl'
                            else if (meshMaterialNames.some(value => value.includes('trans') || value.includes('trs'))) alphaSrc = 'shadow'
                            else if (meshMaterialNames.some(value => value.includes('alpha'))) alphaSrc = name.includes('hair') ? 'shadow' : 'ctrl'

                            if (name.includes('hair')) {
                        const angelRingReference = createAngelRingReference(modelObject, mesh, characterProfile)
                        if (angelRingReference) {
                            const requiresCharacterAngelRingMap =
                                materialProfiles.some(
                                    profile =>
                                        profile.angelRing.map === 'character',
                                )
                            const angelRingMap = requiresCharacterAngelRingMap
                                ? ObjFindByKey(
                                    texturePathUrl,
                                    path => {
                                        const lower = path.toLowerCase()
                                        return (
                                            lower.includes('hair_highlight') ||
                                            lower.includes('hairhighlight')
                                        )
                                    },
                                )
                                : undefined
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
                            })
                            material = result.material
                            textures = result.textures
                            alphaTex = result.alphaTex
                            outlineShadowTex = result.shadowTex
                            if (result.updateAngelRingReference) {
                                userData.animationLoops.push(result.updateAngelRingReference)
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
                    bindOfficialMaterialGroups(
                        mesh,
                        material,
                        materialProfiles,
                        officialGemResources,
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
                            enabled:
                                profile.outline.enabled &&
                                !Boolean(profile.gem.transparency),
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
                    userData.outlineMeshes.push(...outlineMeshes)
                    outlineMeshes.forEach(outlineMesh => {
                        outlineMesh.renderOrder = 3
                    })

                    if (name.includes('face') || name.includes('weapon')) {
                        const outlineStencilRef = stencilRefCount
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
                        if (name.includes('face')) {
                            install101901FaceMaskStencil(
                                characterId,
                                mesh.material,
                                materialProfiles,
                                outlineMeshes,
                                outlineStencilRef,
                            )
                        }
                        stencilRefCount++
                    }
                    if (name.includes('hair')) {
                        install101901HairOutRuntime(
                            characterId,
                            mesh,
                            materialProfiles,
                            outlineMeshes,
                            userData,
                        )
                    }
                } catch (error) {
                    console.error(`Error applying texture to "${mesh.name}":`, error)
                } finally {
                    finish()
                }
            })))

            loadProgressCallback('')
            if (!character.disposed) loadFinishCallback(character)
    })
}
