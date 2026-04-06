import * as THREE from 'three';
import 'abortcontroller-polyfill/dist/polyfill-patch-fetch' // for chrome <= 66
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { createGeneralMaterial, createFaceMaterial, addOutlineToMesh, createBodyInsideMaterial, createHairMaterial, createDepthMaterial, createDistanceMaterial } from './shaders'
import { ObjFindByKey, ObjFilterByKey, humanizeBytes, fetchAndTryDecompressGzip } from './utils';
import MagiaExedraCharacter3D, { type ObjectUserData } from './character';

const loadingManager = new THREE.LoadingManager();
loadingManager.setURLModifier((url) => {
    // Check if the URL is one of the textures the FBX is trying to auto-load
    if (url.endsWith('.png')) {
        console.log('Prevented auto-load for:', url);
        return 'data:,';
    }
    return url;
});

const fbxLoader = new FBXLoader(loadingManager);
let stencilRefCount = 1

// suppress warning `THREE.FBXLoader: unknown attribute mapping type NoMappingInformation`
const origConsoleWarn = console.warn
console.warn = function (...data: any[]) {
    for (const s of data) {
        if (typeof s == 'string' && s.includes('NoMappingInformation')) {
            return
        }
    }
    origConsoleWarn(...data)
}

export interface LoadCharacterCallbacks {
    loadProgressCallback: (progress: string) => any
    modelLoadedCallback: (model: MagiaExedraCharacter3D) => any
    loadFinishCallback: (model: MagiaExedraCharacter3D) => any
}

export async function loadCharacter(files: Record<string, string>, callbacks?: Partial<LoadCharacterCallbacks>): Promise<MagiaExedraCharacter3D> {
    const loadProgressCallback = callbacks?.loadProgressCallback || (() => undefined)
    const modelLoadedCallback = callbacks?.modelLoadedCallback || (() => undefined)
    const loadFinishCallback = callbacks?.loadFinishCallback || (() => undefined)

    const fbxPathUrl = ObjFilterByKey(files, x => x.includes('.fbx'))
    const fbxPath = Object.keys(fbxPathUrl)[0]
    const characterId = parseInt(fbxPath.match(/chara_(\d+).*\//)![1])
    const fbxUrl = fbxPathUrl[fbxPath]

    const texturePathUrl = ObjFilterByKey(files, x => x.includes('.png'))

    return new Promise(async (resolve, reject) => {
        // load model
        console.log('Loading model:', fbxPathUrl)
        loadProgressCallback('Loading FBX...')

        let fbxBlob
        try {
            fbxBlob = await fetchAndTryDecompressGzip(fbxUrl, (progress) => {
                const loaded = humanizeBytes(progress.loaded)
                const total = humanizeBytes(progress.total)
                loadProgressCallback(`Downloading FBX... ${progress.lengthComputable ? `${loaded} / ${total}` : loaded}`)
            }, () => {
                loadProgressCallback('Decompressing FBX...')
            })
        } catch (e) {
            loadProgressCallback('Download FAILED')
            reject(e)
            return
        }
        const fbxBlobUrl = URL.createObjectURL(fbxBlob)

        loadProgressCallback('Parsing geometry...')
        fbxLoader.load(fbxBlobUrl, async (modelObject) => {
            URL.revokeObjectURL(fbxBlobUrl)
            console.log(`Model "${modelObject.name}" loaded successfully`)

            const meshes: THREE.Mesh[] = []
            modelObject.traverse(child => (child as THREE.Mesh).isMesh && meshes.push(child as THREE.Mesh))

            const userData: ObjectUserData = {
                characterId,
                meshes,
                textures: [],
                outlineMeshes: [],
                animationLoops: [],
            }
            modelObject.userData = userData

            // return model, load textures later
            const character = new MagiaExedraCharacter3D(modelObject)
            resolve(character)
            modelLoadedCallback(character)

            // process and apply textures
            loadProgressCallback('Loading textures...')
            console.log('Using textures:', texturePathUrl)

            await Promise.all(meshes.map(mesh => new Promise<void>(async (resolve, _reject) => {
                try {
                    // enable shadows
                    mesh.castShadow = true
                    mesh.receiveShadow = true

                    const meshMaterialNames: string[] = Array.isArray(mesh.material)
                        ? mesh.material.map(x => x.name)
                        : [mesh.material.name]
                    console.log(`Material names of "${mesh.name}":`, meshMaterialNames)

                    /*
                    mesh.name may be:
                    Acc_Mesh (hair accessories)
                    Body_Mesh
                    Face_Mesh
                    Hair_Mesh

                    weapon_mesh (if there's only one weapon)
                    weapon_a_mesh
                    weapon_b_mesh

                    special for momoe nagisa (two faces):
                    Face_Mesh
                    Face_Mesh_a (a mask)
                    */
                    const name = mesh.name
                        .replace('_Mesh', '') // remove `mesh` because texture filenames doesn't include it
                        .replace('_mesh', '')
                        .toLowerCase();

                    let meshTextures = ObjFilterByKey(texturePathUrl, x => x.includes(name))

                    // `weapon_b` mesh may use `weapon_a` texture in materials
                    if (meshMaterialNames.some(x => x.includes('weapon'))) {
                        let meshWeaponNames = meshMaterialNames
                            .map(x => x.match(/(weapon_\w)($|_)/)?.at(1))
                            .filter(x => typeof x == 'string')
                        console.log('weapon material names:', meshWeaponNames)
                        meshWeaponNames = [... new Set(meshWeaponNames)]

                        if (meshWeaponNames.length == 1) {
                            meshTextures = ObjFilterByKey(texturePathUrl, x => x.includes(meshWeaponNames[0]))
                        }
                    }

                    // do not include `face_a` for `face`
                    if (name.includes('face') && !name.includes('_a')) {
                        meshTextures = ObjFilterByKey(meshTextures, x => !x.includes('_a'))
                    }

                    if (Object.keys(meshTextures).length == 0) {
                        // PAPA series, 'face_hide', 'face_l', 'face_r', 'face_side', 'faceparts', 'mouth' uses the same face texture
                        if (meshMaterialNames.some(x => x.includes('face'))) {
                            meshTextures = ObjFilterByKey(texturePathUrl, x => x.includes('face'))
                        }
                        // `weapon_a_mesh` and `weapon_b_mesh` may use the same `weapon_a.png`
                        else if (name.includes('weapon')) {
                            meshTextures = ObjFilterByKey(texturePathUrl, x => x.includes('weapon'))
                        }
                        // holy mami and akuma homura has `eye_nohighlight` that uses face map
                        else if (name.includes('eye')) {
                            meshTextures = ObjFilterByKey(texturePathUrl, x => x.includes('face'))
                        }
                        // defaults to `weapon`
                        else {
                            meshTextures = ObjFilterByKey(texturePathUrl, x => x.includes('weapon'))
                        }
                    }

                    console.log(`Using textures for mesh [${mesh.name} -> ${name}]:`, meshTextures)

                    let colorMap = ObjFindByKey(meshTextures, x => x.includes('color'))
                    let shadowMap = ObjFindByKey(meshTextures, x => x.includes('shadow'))
                    let ctrlMap = ObjFindByKey(meshTextures, x => x.includes('ctrl'))

                    if (!colorMap && shadowMap) {
                        colorMap = shadowMap
                        // shadowMap = undefined
                    }

                    console.log(`${name} color  ->`, colorMap)
                    console.log(`${name} shadow ->`, shadowMap)
                    console.log(`${name} ctrl   ->`, ctrlMap)

                    if (!colorMap) {
                        console.warn(`Could not find a color map for "${mesh.name}"`)
                        return
                    }

                    // mix color and shadow map and set texture
                    let alphaTex: THREE.Texture | undefined

                    if (name.includes('face')) {
                        // TODO: The public face_ctrl is not suitable for all characters, but characters do not have individual face_ctrl!
                        const { material, textures } = await createFaceMaterial({
                            colorMap, shadowMap: shadowMap!, ctrlMap,
                            eyehighlightMap: ObjFindByKey(texturePathUrl, x => x.includes('eye'))!
                        })
                        mesh.material = material
                        userData.textures.push(...textures)
                    }
                    else {
                        let alphaSrc: 'ctrl' | 'shadow' | undefined = undefined
                        let material, textures

                        // material overrides
                        if ((characterId == 113701 || characterId == 113801) && name.includes('body')) {
                            // ultimate madoka & akuma homura's dresses has special inside color
                            let animate;
                            ({ material, textures, alphaTex, animate } = await createBodyInsideMaterial({ colorMap, shadowMap, ctrlMap }, texturePathUrl));
                            userData.animationLoops.push(animate)
                        }
                        else {
                            // `alphaSrc` overrides
                            if (characterId == 100106 && name.includes('body')) {
                                // madoka swimsuit
                                // it doesn't have transparent materials but should use alpha from shadow map
                                alphaSrc = 'shadow'
                            }
                            else if (characterId == 100205 && name.includes('acc')) {
                                // homura school uniform - glasses
                                alphaSrc = 'shadow'
                            }
                            else if (characterId == 113801 && name.includes('weapon')) {
                                // akuma homura's dark orb - do not use any alpha
                                alphaSrc = undefined
                            }
                            // has either `shadow` or `ctrl` - use what exists
                            else if (shadowMap != undefined && ctrlMap == undefined) {
                                alphaSrc = 'shadow'
                            }
                            else if (shadowMap == undefined && ctrlMap != undefined) {
                                alphaSrc = 'ctrl'
                            }
                            // FBX has `transparent` material -> use alpha map from shadow map
                            // example: ultimate madoka's body (transparent), 加賀見まさら's body (trans), アリナ・グレイ's weapon (trs)
                            // this condition should always place in front of `alpha`, as these two may exist together
                            else if (meshMaterialNames.some(x => x.includes('trans') || x.includes('trs'))) {
                                alphaSrc = 'shadow'
                            }
                            // has `alpha` material -> use alpha map frpm ctrl map
                            // example: homura's glasses
                            else if (meshMaterialNames.some(x => x.includes('alpha'))) {
                                alphaSrc = name.includes('hair')
                                    ? 'shadow' // hair always uses alpha from shadow map
                                    : 'ctrl'
                            }
                            console.log(`${name} alpha  ->`, alphaSrc);

                            ({ material, textures, alphaTex } = await (name.includes('hair')
                                ? createHairMaterial
                                : createGeneralMaterial)
                                ({ colorMap, shadowMap, ctrlMap, alphaSrc }))
                        }

                        mesh.material = material;
                        userData.textures.push(...textures);
                    }

                    // hide shadows for the transparent part of the mesh
                    if (alphaTex) {
                        mesh.customDepthMaterial = createDepthMaterial(alphaTex)
                        mesh.customDistanceMaterial = createDistanceMaterial(alphaTex)
                    }

                    // apply mesh visibility
                    character.meshes.find(x => x.mesh == mesh)?.restoreDefaultVisibility()

                    // prevent weapons from hiding because of bounding box issues with animation
                    if (name.includes('weapon')) {
                        mesh.frustumCulled = false
                    }

                    if (name.includes('hair')) {
                        mesh.renderOrder = 1 // render hair first to prevent seeing through on transparent meshes (e.g. ultimate madoka's wings)
                    } else {
                        mesh.renderOrder = 2
                    }

                    const outlineMesh = addOutlineToMesh(mesh, { alphaTex })
                    userData.outlineMeshes.push(outlineMesh)
                    // render last so that transparent meshes won't see the outline mesh behind
                    // this also fixes some cases that outline meshs display regardless of stencil
                    outlineMesh.renderOrder = 3

                    if (name.includes('face') || name.includes('weapon')) {
                        // prevent outlines from being displayed inside mesh area
                        // require renderer stencil enabled
                        mesh.material.stencilWrite = true;
                        mesh.material.stencilRef = stencilRefCount;
                        mesh.material.stencilFunc = THREE.AlwaysStencilFunc;
                        mesh.material.stencilZPass = THREE.ReplaceStencilOp;

                        outlineMesh.material.stencilWrite = true;
                        outlineMesh.material.stencilRef = stencilRefCount;
                        outlineMesh.material.stencilFunc = THREE.NotEqualStencilFunc;

                        stencilRefCount++
                    }

                } catch (error) {
                    console.error(`Error applying texture to "${mesh.name}":`, error)
                } finally {
                    resolve()
                }
            })))

            loadProgressCallback('')
            if (!character.disposed) {
                loadFinishCallback(character)
            }

        }, undefined, (error) => {
            URL.revokeObjectURL(fbxBlobUrl)
            loadProgressCallback('Parse FAILED')
            reject(error)
        });
    })
}
