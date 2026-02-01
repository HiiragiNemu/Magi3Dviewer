import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { createGeneralMaterial, createFaceMaterial, addOutlineToMesh } from './shaders'
import { loadTexture } from './texture';
import { ObjFindByKey, ObjFilterByKey, humanizeBytes, fetchAndTryDecompressGzip } from './utils';
import type { ObjectUserData } from './character';
// import faceCtrlMap from './models/face_ctrl.png'

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
    modelLoadedCallback: (model: THREE.Group) => any
    /** TODO: If a character is disposed before all textures are loaded, this function should not be called */
    loadFinishCallback: (model: THREE.Group) => any
}

export async function loadCharacter(files: Record<string, string>, callbacks?: Partial<LoadCharacterCallbacks>): Promise<THREE.Group> {
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
            }
            modelObject.userData = userData

            // return model, load textures later
            resolve(modelObject)
            modelLoadedCallback(modelObject)

            // process and apply textures
            loadProgressCallback('Loading textures...')
            console.log('Using textures:', texturePathUrl)

            await Promise.all(meshes.map(mesh => new Promise<void>(async (resolve, _reject) => {
                try {
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
                    */
                    const name = mesh.name
                        .replace('_Mesh', '')
                        .replace('_mesh', '')
                        .toLowerCase();

                    let meshTextures = ObjFilterByKey(texturePathUrl, x => x.includes(name))
                    if (Object.keys(meshTextures).length == 0) {
                        // tomoe mami swimsuit
                        if (characterId == 100303 && ['glass', 'mint', 'tea'].includes(name)) {
                            meshTextures = ObjFilterByKey(texturePathUrl, x => x.includes('weapon_b'))
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
                            colorMap, shadowMap: shadowMap!, ctrlMap: undefined,
                            eyehighlightMap: ObjFindByKey(texturePathUrl, x => x.includes('eye'))!
                        })
                        mesh.material = material
                        userData.textures.push(...textures.textures)
                    }
                    else if ((characterId == 113701 || characterId == 113801) && name.includes('body')) {
                        /*
                        ultimate madoka & akuma homura's dresses has special inside color
 
                        body_color ---\
                                       mix, factor=body_ctrl[red] --\
                        body_shadow --/                              \
                                                                      |--> final texture
                        [UV1]dress_inside, UV1.xy > 0 ---------------/

                                                    body_shadow[alpha] --> final alpha map
                        */
                        const insideTex = await loadTexture(ObjFindByKey(meshTextures, x =>
                            x.includes('space') || // ultimate madoka (body_space_color)
                            x.includes('inside') // akuma homura (body_inside_color)
                        )!, { colorSpace: THREE.SRGBColorSpace })

                        const { material, textures } = await createGeneralMaterial({
                            colorMap, shadowMap, ctrlMap,
                            alphaSrc: 'shadow', // only effective for ultimate madoka. akuma homura's maps are fully opaque

                            onBeforeCompile(shader) {
                                shader.uniforms.tInside = { value: insideTex }

                                // dress inside uses UV1
                                shader.vertexShader = /*glsl*/`
                                    attribute vec2 uv1;
                                    varying vec2 vUv1;
                                    ${shader.vertexShader}
                                `.replace(
                                    '#include <uv_vertex>',
                                    /*glsl*/`
                                    #include <uv_vertex>
                                    vUv1 = uv1;
                                    `
                                );

                                shader.fragmentShader = /*glsl*/`
                                    varying vec2 vUv1;
                                    uniform sampler2D tInside;
                                    ${shader.fragmentShader}
                                `.replace(
                                    '// end map_fragment injection',
                                    /*glsl*/`
                                    vec4 texInside = texture2D(tInside, vUv1);
                                    if (vUv1.x > 0.0 && vUv1.y > 0.0) {
                                        diffuseColor.rgb = texInside.rgb; // replace color if UV1 > 0
                                    }
                                    // end map_fragment injection
                                    `
                                )
                            },
                        })

                        mesh.material = material;
                        userData.textures.push(...textures.textures, insideTex);
                        ({ alphaTex } = textures);
                    }
                    else {
                        let alphaSrc: 'ctrl' | 'shadow' | undefined = undefined

                        // character overrides
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
                        console.log(`${name} alpha  ->`, alphaSrc)

                        const { material, textures } = await createGeneralMaterial({ colorMap, shadowMap, ctrlMap, alphaSrc })
                        mesh.material = material;
                        userData.textures.push(...textures.textures);
                        ({ alphaTex } = textures);
                    }

                    // apply mesh visibility
                    mesh.material.visible = getMeshDefaultVisibility(name)

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
            loadFinishCallback(modelObject)

        }, undefined, (error) => {
            URL.revokeObjectURL(fbxBlobUrl)
            loadProgressCallback('Parse FAILED')
            reject(error)
        });
    })
}

export function getMeshDefaultVisibility(name: string): boolean {
    name = name.toLowerCase()

    // hide `eye_nohighlight` by default
    if (name.includes('eye_nohighlight')) {
        return false
    }

    return true
}
