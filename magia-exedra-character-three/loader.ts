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
    const slots = Math.max(profiles.length, 1)
    mesh.material = slots > 1
        ? Array.from({ length: slots }, () => material)
        : material
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
        const userData = material.userData
        const shader = userData instanceof MaterialUserData
            ? userData.shader
            : userData?.shader
        const index = group?.materialIndex ?? 0
        setOfficialMaterialProfileUniforms(shader, profiles[index] ?? profiles[0])
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

        const fbxBlobUrl = URL.createObjectURL(fbxBlob)
        loadProgressCallback('Parsing geometry...')
        fbxLoader.load(fbxBlobUrl, async modelObject => {
            URL.revokeObjectURL(fbxBlobUrl)
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
                    const materialProfiles = getOfficialMaterialProfiles(meshMaterialNames)
                    const featureProfile = inferMaterialFeatures(meshMaterialNames)
                    console.log(`Material slots of "${mesh.name}":`, meshMaterialNames, materialProfiles)

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
                    const ctrlMap = ObjFindByKey(meshTextures, path => path.includes('ctrl'))
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
                            const result = await createHairMaterial({
                                ...sharedMaterialOptions,
                                alphaSrc,
                                angelRingReference,
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
        }, undefined, error => {
            URL.revokeObjectURL(fbxBlobUrl)
            loadProgressCallback('Parse FAILED')
            reject(error)
        })
    })
}
