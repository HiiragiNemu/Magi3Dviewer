import * as THREE from 'three';
import 'abortcontroller-polyfill/dist/polyfill-patch-fetch'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import {
    createGeneralMaterial,
    createFaceMaterial,
    addOutlineToMesh,
    createBodyInsideMaterial,
    createHairMaterial,
    createDepthMaterial,
    createDistanceMaterial,
    extendMaterialWithOfficialGem,
    setAngelRingCameraUniforms,
    setOfficialAngelRingMaterialProfileUniforms,
    setOfficialMaterialProfileUniforms,
    MaterialUserData,
} from './shaders'
import { ObjFindByKey, ObjFilterByKey, humanizeBytes, fetchAndTryDecompressGzip } from './utils';
import MagiaExedraCharacter3D, { type ObjectUserData } from './character';
import {
    createAngelRingReference,
    getCharacterReDriveProfile,
    inferMaterialFeatures,
} from './renderProfile';
import {
    getOfficialMaterialProfiles,
    type OfficialMaterialProfile,
} from './materialProfile';
import { createFaceDirectionReference, getOfficialFaceProfile } from './faceProfile';
import { restoreOfficialSubmeshGroups } from './submeshGroups';

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
        setOfficialAngelRingMaterialProfileUniforms(shader, profile)
        setAngelRingCameraUniforms(shader, renderer, camera)
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

export async function loadCharacter(
    files: Record<string, string>,
    callbacks?: Partial<LoadCharacterCallbacks>,
): Promise<MagiaExedraCharacter3D> {
    const loadProgressCallback = callbacks?.loadProgressCallback || (() => undefined)
    const modelLoadedCallback = callbacks?.modelLoadedCallback || (() => undefined)
    const loadFinishCallback = callbacks?.loadFinishCallback || (() => undefined)

    const fbxPathUrl = ObjFilterByKey(files, path => path.includes('.fbx'))
    const fbxPath = Object.keys(fbxPathUrl)[0]
    const characterId = parseInt(fbxPath.match(/chara_(\d+).*\//)![1])
    const fbxUrl = fbxPathUrl[fbxPath]
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
                new URL('.', fbxUrl).href,
            )
        } catch (error) {
            loadProgressCallback('Parse FAILED')
            reject(error)
            return
        }

            console.log(`Model "${modelObject.name}" loaded successfully`)

            modelObject.updateMatrixWorld(true)
            const meshes: THREE.Mesh[] = []
            modelObject.traverse(child => {
                if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh)
            })

            const userData: ObjectUserData = {
                characterId,
                meshes,
                textures: [],
                outlineMeshes: [],
                animationLoops: [],
            }
            modelObject.userData = userData

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
                    }

                    let alphaTex: THREE.Texture | undefined
                    let material: THREE.Material
                    let textures: THREE.Texture[]

                    if (name.includes('face')) {
              const faceProfile = getOfficialFaceProfile(characterId)
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
                            }
                        }
                    }

                    if (materialProfiles.some(profile => profile.gem.enabled)) {
                        const extension = await extendMaterialWithOfficialGem(material, materialProfiles)
                        textures.push(...extension.resources.textures)
                    }
                    bindOfficialMaterialGroups(mesh, material, materialProfiles)
                    userData.textures.push(...textures)

                    if (alphaTex) {
                        mesh.customDepthMaterial = createDepthMaterial(alphaTex)
                        mesh.customDistanceMaterial = createDistanceMaterial(alphaTex)
                    }
                    character.meshes.find(value => value.mesh == mesh)?.restoreDefaultVisibility()
                    if (name.includes('weapon')) mesh.frustumCulled = false
                    mesh.renderOrder = name.includes('hair') ? 1 : 2

                    const outlineMesh = addOutlineToMesh(mesh, {
                        alphaTex,
                        thickness: featureProfile.outlineOffset ? 0.0018 : undefined,
                    })
                    userData.outlineMeshes.push(outlineMesh)
                    outlineMesh.renderOrder = 3

                    if (name.includes('face') || name.includes('weapon')) {
                        setStencil(mesh.material, stencilRefCount)
                        outlineMesh.material.stencilWrite = true
                        outlineMesh.material.stencilRef = stencilRefCount
                        outlineMesh.material.stencilFunc = THREE.NotEqualStencilFunc
                        stencilRefCount++
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
