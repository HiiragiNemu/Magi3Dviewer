import * as THREE from 'three'

export interface StageAtlasProfile {
    columns: number
    rows: number
    /** Frame offset recovered from the serialized material. */
    offset?: number
    /** Zero disables animation and displays only the selected frame. */
    framesPerSecond?: number
}

export interface StageMaterialBinding {
    /** Exact FBX material name. */
    materialName?: string
    /** Optional regular expression for exporter-added name suffixes. */
    materialPattern?: string
    shading?: 'lit' | 'unlit'
    baseMapUrl?: string
    normalMapUrl?: string
    smoothnessMapUrl?: string
    blendMapUrl?: string
    vertexColorBlend?: boolean
    smoothness?: number
    smoothnessChannel?: 'r' | 'g' | 'b' | 'a'
    metallic?: number
    metallicFromSmoothnessMap?: boolean
    normalScale?: number
    alphaTest?: number
    alphaToCoverage?: boolean
    transparent?: boolean
    unlitness?: number
    castShadow?: boolean
    receiveShadow?: boolean
    side?: 'front' | 'back' | 'double'
    atlas?: StageAtlasProfile
}

export interface StageMaterialBindingResult {
    textures: THREE.Texture[]
    matchedMaterials: string[]
    unmatchedBindings: string[]
}

type LoadedTextureKind = 'color' | 'data'

const sideByName = {
    front: THREE.FrontSide,
    back: THREE.BackSide,
    double: THREE.DoubleSide,
} as const

/**
 * AssetStudio's FBX contains geometry and material names, but this stage's FBX
 * contains no Texture/RelativeFilename records. This binder reconnects the
 * adjacent, separately exported textures using catalog evidence.
 */
export async function applyStageMaterialBindings(
    object: THREE.Object3D,
    bindings: StageMaterialBinding[] | undefined,
    renderer: THREE.WebGLRenderer,
): Promise<StageMaterialBindingResult> {
    if (!bindings?.length) {
        return { textures: [], matchedMaterials: [], unmatchedBindings: [] }
    }

    const textureLoader = new THREE.TextureLoader()
    const textureCache = new Map<string, Promise<THREE.Texture>>()
    const ownedTextures = new Set<THREE.Texture>()
    const matchedBindings = new Set<StageMaterialBinding>()
    const matchedMaterials = new Set<string>()
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()

    const loadTexture = (url: string, kind: LoadedTextureKind) => {
        const cacheKey = `${kind}:${new URL(url, document.baseURI).href}`
        let promise = textureCache.get(cacheKey)
        if (!promise) {
            promise = textureLoader.loadAsync(new URL(url, document.baseURI).href).then(texture => {
                texture.name = `StageTexture:${url}`
                texture.colorSpace = kind === 'color'
                    ? THREE.SRGBColorSpace
                    : THREE.NoColorSpace
                texture.anisotropy = maxAnisotropy
                texture.needsUpdate = true
                ownedTextures.add(texture)
                return texture
            })
            textureCache.set(cacheKey, promise)
        }
        return promise
    }

    const texturePromises = bindings.flatMap(binding => [
        binding.baseMapUrl ? loadTexture(binding.baseMapUrl, 'color') : undefined,
        binding.normalMapUrl ? loadTexture(binding.normalMapUrl, 'data') : undefined,
        binding.smoothnessMapUrl ? loadTexture(binding.smoothnessMapUrl, 'data') : undefined,
        binding.blendMapUrl ? loadTexture(binding.blendMapUrl, 'color') : undefined,
    ].filter((promise): promise is Promise<THREE.Texture> => Boolean(promise)))
    await Promise.all(texturePromises)

    const resolveTexture = async (url: string | undefined, kind: LoadedTextureKind) => {
        if (!url) return undefined
        return loadTexture(url, kind)
    }

    const materialPromises: Promise<void>[] = []
    object.traverse(child => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return

        const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const outputMaterials = [...sourceMaterials]
        sourceMaterials.forEach((sourceMaterial, index) => {
            const binding = bindings.find(entry => matchesMaterial(entry, sourceMaterial.name))
            if (!binding) return

            materialPromises.push((async () => {
                const material = await createBoundMaterial(binding, mesh, {
                    baseMap: await resolveTexture(binding.baseMapUrl, 'color'),
                    normalMap: await resolveTexture(binding.normalMapUrl, 'data'),
                    smoothnessMap: await resolveTexture(binding.smoothnessMapUrl, 'data'),
                    blendMap: await resolveTexture(binding.blendMapUrl, 'color'),
                    ownedTextures,
                })
                material.name = sourceMaterial.name
                outputMaterials[index] = material
                mesh.userData.stageCastShadow = binding.castShadow
                    ?? mesh.userData.stageCastShadow
                mesh.userData.stageReceiveShadow = binding.receiveShadow
                    ?? mesh.userData.stageReceiveShadow
                matchedBindings.add(binding)
                matchedMaterials.add(sourceMaterial.name)
                sourceMaterial.dispose()
            })())
        })

        Promise.all(materialPromises).then(() => {
            mesh.material = Array.isArray(mesh.material) ? outputMaterials : outputMaterials[0]
        })
    })
    await Promise.all(materialPromises)

    const unmatchedBindings = bindings
        .filter(binding => !matchedBindings.has(binding))
        .map(binding => binding.materialName ?? binding.materialPattern ?? '(unnamed)')

    object.userData.stageMaterialBindings = {
        matchedMaterials: [...matchedMaterials],
        unmatchedBindings,
    }
    if (unmatchedBindings.length > 0) {
        console.warn('Official stage material bindings did not match FBX materials:', unmatchedBindings)
    }
    console.log('Applied official stage material bindings:', object.userData.stageMaterialBindings)

    return {
        textures: [...ownedTextures],
        matchedMaterials: [...matchedMaterials],
        unmatchedBindings,
    }
}

function matchesMaterial(binding: StageMaterialBinding, materialName: string) {
    if (binding.materialName === materialName) return true
    if (!binding.materialPattern) return false
    return new RegExp(binding.materialPattern).test(materialName)
}

interface BoundTextureSet {
    baseMap?: THREE.Texture
    normalMap?: THREE.Texture
    smoothnessMap?: THREE.Texture
    blendMap?: THREE.Texture
    ownedTextures: Set<THREE.Texture>
}

async function createBoundMaterial(
    binding: StageMaterialBinding,
    mesh: THREE.Mesh,
    textures: BoundTextureSet,
): Promise<THREE.Material> {
    const side = binding.side ? sideByName[binding.side] : THREE.FrontSide
    const map = createAtlasTexture(textures.baseMap, binding.atlas, textures.ownedTextures)
    const common = {
        map,
        alphaTest: binding.alphaTest ?? 0,
        transparent: binding.transparent ?? false,
        side,
    }

    if (binding.shading === 'unlit') {
        const material = new THREE.MeshBasicMaterial(common)
        material.alphaToCoverage = binding.alphaToCoverage ?? false
        installAtlasAnimation(material, map, binding.atlas)
        return material
    }

    const material = new THREE.MeshStandardMaterial({
        ...common,
        normalMap: textures.normalMap,
        normalScale: new THREE.Vector2(
            binding.normalScale ?? 1,
            binding.normalScale ?? 1,
        ),
        metalness: binding.metallic ?? 0,
        roughness: textures.smoothnessMap
            ? 1
            : 1 - (binding.smoothness ?? 0),
        vertexColors: Boolean(binding.vertexColorBlend && mesh.geometry.hasAttribute('color')),
    })
    material.alphaToCoverage = binding.alphaToCoverage ?? false

    if (binding.vertexColorBlend && !mesh.geometry.hasAttribute('color')) {
        console.warn(`Stage material ${binding.materialName ?? binding.materialPattern} requested vertex-color blending, but its mesh has no color attribute`)
    }
    installOfficialLitExtensions(material, binding, textures)
    installAtlasAnimation(material, map, binding.atlas)
    return material
}

function createAtlasTexture(
    source: THREE.Texture | undefined,
    atlas: StageAtlasProfile | undefined,
    ownedTextures: Set<THREE.Texture>,
) {
    if (!source || !atlas) return source
    const texture = source.clone()
    texture.name = `${source.name}:atlas`
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(1 / atlas.columns, 1 / atlas.rows)
    setAtlasFrame(texture, atlas, atlas.offset ?? 0)
    texture.needsUpdate = true
    ownedTextures.add(texture)
    return texture
}

function installAtlasAnimation(
    material: THREE.Material,
    map: THREE.Texture | undefined,
    atlas: StageAtlasProfile | undefined,
) {
    if (!map || !atlas) return
    const frameCount = Math.max(1, atlas.columns * atlas.rows)
    const frameOffset = atlas.offset ?? 0
    const framesPerSecond = atlas.framesPerSecond ?? 0
    material.userData.stageAtlas = { ...atlas }
    material.onBeforeRender = () => {
        const elapsedFrame = framesPerSecond > 0
            ? Math.floor(performance.now() * 0.001 * framesPerSecond)
            : 0
        setAtlasFrame(map, atlas, (frameOffset + elapsedFrame) % frameCount)
    }
}

function setAtlasFrame(texture: THREE.Texture, atlas: StageAtlasProfile, frame: number) {
    const normalizedFrame = ((frame % (atlas.columns * atlas.rows)) + atlas.columns * atlas.rows)
        % (atlas.columns * atlas.rows)
    const column = normalizedFrame % atlas.columns
    const row = Math.floor(normalizedFrame / atlas.columns)
    texture.offset.set(
        column / atlas.columns,
        1 - ((row + 1) / atlas.rows),
    )
}

function installOfficialLitExtensions(
    material: THREE.MeshStandardMaterial,
    binding: StageMaterialBinding,
    textures: BoundTextureSet,
) {
    const blendMap = binding.vertexColorBlend ? textures.blendMap : undefined
    const smoothnessMap = textures.smoothnessMap
    const smoothness = binding.smoothness ?? 1
    const smoothnessChannel = binding.smoothnessChannel ?? 'r'
    const unlitness = binding.unlitness ?? 0
    material.userData.stageBlendMap = blendMap
    material.userData.stageSmoothnessMap = smoothnessMap
    material.userData.stageSmoothness = smoothness
    // This must be present before program parameter collection so Three emits
    // USE_ROUGHNESSMAP and vRoughnessMapUv for our smoothness interpretation.
    if (smoothnessMap) material.roughnessMap = smoothnessMap
    if (smoothnessMap && binding.metallicFromSmoothnessMap) {
        material.metalnessMap = smoothnessMap
    }

    material.onBeforeCompile = shader => {
        if (blendMap) {
            shader.uniforms.uStageBlendMap = { value: blendMap }
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <map_pars_fragment>',
                    `#include <map_pars_fragment>
uniform sampler2D uStageBlendMap;`,
                )
                .replace(
                    '#include <color_fragment>',
                    '// Stage vertex color is reserved for official texture blending.',
                )
                .replace(
                    '#include <map_fragment>',
                    `#ifdef USE_MAP
    vec4 sampledDiffuseColor = texture2D( map, vMapUv );
    #ifdef DECODE_VIDEO_TEXTURE
        sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
    #endif
    diffuseColor *= sampledDiffuseColor;
#endif
#ifdef USE_COLOR
    vec4 stageBlendColor = texture2D( uStageBlendMap, vMapUv );
    diffuseColor.rgb = mix( diffuseColor.rgb, stageBlendColor.rgb, clamp( vColor.r, 0.0, 1.0 ) );
#endif`,
                )
        }

        if (smoothnessMap) {
            shader.uniforms.uStageSmoothnessMap = { value: smoothnessMap }
            shader.uniforms.uStageSmoothness = { value: smoothness }
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <roughnessmap_pars_fragment>',
                    `#include <roughnessmap_pars_fragment>
uniform sampler2D uStageSmoothnessMap;
uniform float uStageSmoothness;`,
                )
                .replace(
                    '#include <roughnessmap_fragment>',
                    `float stageSmoothness = texture2D( uStageSmoothnessMap, vRoughnessMapUv ).${smoothnessChannel} * uStageSmoothness;
float roughnessFactor = clamp( 1.0 - stageSmoothness, 0.04, 1.0 );`,
                )
            if (binding.metallicFromSmoothnessMap) {
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <metalnessmap_fragment>',
                    `float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
    metalnessFactor *= texture2D( metalnessMap, vMetalnessMapUv ).r;
#endif`,
                )
            }
        }

        if (unlitness > 0) {
            shader.uniforms.uStageUnlitness = { value: unlitness }
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <opaque_fragment>',
                    `outgoingLight = mix( outgoingLight, diffuseColor.rgb, uStageUnlitness );
#include <opaque_fragment>`,
                )
                .replace(
                    '#include <common>',
                    `#include <common>
uniform float uStageUnlitness;`,
                )
        }
    }
    material.customProgramCacheKey = () => [
        'official-stage-material-v1',
        blendMap ? 'vertex-blend' : 'single-map',
        smoothnessMap ? 'smoothness-inversion' : 'constant-roughness',
        binding.metallicFromSmoothnessMap ? 'metallic-red' : 'metallic-constant',
        unlitness > 0 ? `unlit-mix-${unlitness}` : 'fully-lit',
    ].join(':')
    material.needsUpdate = true
}
