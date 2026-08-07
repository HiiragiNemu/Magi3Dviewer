import * as THREE from 'three'

export interface StageAtlasProfile {
    columns: number
    rows: number
    /** Frame offset recovered from the serialized material. */
    offset?: number
    /** Zero disables animation and displays only the selected frame. */
    framesPerSecond?: number
}

export interface StageMultiUvScrollLayer {
    tiling: [number, number]
    offset: [number, number]
    speed: [number, number]
    color?: [number, number, number, number]
    opacity?: number
}

export interface StageMultiUvScrollProfile {
    /** Separately serialized Unity `_ScrollTexture` / `_ScrollTexutre`. */
    textureUrl: string
    first: StageMultiUvScrollLayer
    second: StageMultiUvScrollLayer
    /** Serialized `_Additive_to_Multiply`: 0 additive, 1 multiply. */
    additiveToMultiply: number
    /** `_DropFrame_MultiScroll`; exact dropped-frame quantization is deferred. */
    dropFrame?: boolean
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
    matCapMapUrl?: string
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
    matCapIntensity?: number
    castShadow?: boolean
    receiveShadow?: boolean
    side?: 'front' | 'back' | 'double'
    atlas?: StageAtlasProfile
    multiUvScroll?: StageMultiUvScrollProfile
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
    signal?: AbortSignal,
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
    const createdMaterials = new Set<THREE.Material>()
    const sourceMaterialsToDispose = new Set<THREE.Material>()

    const loadTexture = (url: string, kind: LoadedTextureKind) => {
        const cacheKey = `${kind}:${new URL(url, document.baseURI).href}`
        let promise = textureCache.get(cacheKey)
        if (!promise) {
            promise = textureLoader.loadAsync(new URL(url, document.baseURI).href).then(texture => {
                if (signal?.aborted) {
                    texture.dispose()
                    signal.throwIfAborted()
                }
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
        binding.matCapMapUrl ? loadTexture(binding.matCapMapUrl, 'color') : undefined,
        binding.multiUvScroll?.textureUrl
            ? loadTexture(binding.multiUvScroll.textureUrl, 'color')
            : undefined,
    ].filter((promise): promise is Promise<THREE.Texture> => Boolean(promise)))

    const resolveTexture = async (url: string | undefined, kind: LoadedTextureKind) => {
        if (!url) return undefined
        return loadTexture(url, kind)
    }

    interface MeshMaterialPlan {
        mesh: THREE.Mesh
        outputMaterials: THREE.Material[]
        bindings: StageMaterialBinding[]
        operations: Promise<void>[]
        usesMaterialArray: boolean
    }

    const plans: MeshMaterialPlan[] = []
    try {
        const textureResults = await Promise.allSettled(texturePromises)
        const textureFailure = textureResults.find(
            result => result.status === 'rejected',
        )
        if (textureFailure?.status === 'rejected') throw textureFailure.reason
        signal?.throwIfAborted()

        object.traverse(child => {
            const mesh = child as THREE.Mesh
            if (!mesh.isMesh) return

            const usesMaterialArray = Array.isArray(mesh.material)
            const sourceMaterials: THREE.Material[] =
                Array.isArray(mesh.material)
                    ? [...mesh.material]
                    : [mesh.material]
            const outputMaterials = [...sourceMaterials]
            const plan: MeshMaterialPlan = {
                mesh,
                outputMaterials,
                bindings: [],
                operations: [],
                usesMaterialArray,
            }

            sourceMaterials.forEach((sourceMaterial, index) => {
                const binding = bindings.find(
                    entry => matchesMaterial(entry, sourceMaterial.name),
                )
                if (!binding) return
                plan.bindings.push(binding)
                sourceMaterialsToDispose.add(sourceMaterial)

                plan.operations.push((async () => {
                    const material = await createBoundMaterial(binding, mesh, {
                        baseMap: await resolveTexture(binding.baseMapUrl, 'color'),
                        normalMap: await resolveTexture(binding.normalMapUrl, 'data'),
                        smoothnessMap: await resolveTexture(binding.smoothnessMapUrl, 'data'),
                        blendMap: await resolveTexture(binding.blendMapUrl, 'color'),
                        matCapMap: await resolveTexture(binding.matCapMapUrl, 'color'),
                        multiUvScrollMap: await resolveTexture(
                            binding.multiUvScroll?.textureUrl,
                            'color',
                        ),
                        ownedTextures,
                    })
                    createdMaterials.add(material)
                    signal?.throwIfAborted()
                    material.name = sourceMaterial.name
                    outputMaterials[index] = material
                    matchedBindings.add(binding)
                    matchedMaterials.add(sourceMaterial.name)
                })())
            })
            if (plan.operations.length > 0) plans.push(plan)
        })

        const materialResults = await Promise.allSettled(
            plans.flatMap(plan => plan.operations),
        )
        const materialFailure = materialResults.find(
            result => result.status === 'rejected',
        )
        if (materialFailure?.status === 'rejected') throw materialFailure.reason
        signal?.throwIfAborted()

        plans.forEach(plan => {
            plan.mesh.material = plan.usesMaterialArray
                ? plan.outputMaterials
                : plan.outputMaterials[0]
            applyDeterministicMeshShadowPolicy(plan.mesh, plan.bindings)
        })
        // FBXLoader may share one Texture instance across multiple materials.
        // Replacing one material must not dispose a texture that is still used
        // by an unmatched material elsewhere in the stage hierarchy.
        const retainedTextures = collectObjectMaterialTextures(object)
        sourceMaterialsToDispose.forEach(material => {
            disposeMaterialAndUnreferencedTextures(material, retainedTextures)
        })
    } catch (error) {
        createdMaterials.forEach(disposeMaterialAndTextures)
        ownedTextures.forEach(texture => texture.dispose())
        throw error
    }

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

function applyDeterministicMeshShadowPolicy(
    mesh: THREE.Mesh,
    bindings: StageMaterialBinding[],
) {
    const castValues = bindings
        .map(binding => binding.castShadow)
        .filter((value): value is boolean => value != undefined)
    const receiveValues = bindings
        .map(binding => binding.receiveShadow)
        .filter((value): value is boolean => value != undefined)

    if (castValues.length > 0) {
        mesh.userData.stageCastShadow = castValues.some(Boolean)
    }
    if (receiveValues.length > 0) {
        mesh.userData.stageReceiveShadow = receiveValues.some(Boolean)
    }
    if (
        new Set(castValues).size > 1
        || new Set(receiveValues).size > 1
    ) {
        console.warn(
            `Stage mesh "${mesh.name}" has mixed per-material shadow flags; `
            + 'using the conservative mesh-wide union.',
        )
    }
}

function disposeMaterialAndTextures(material: THREE.Material) {
    Object.values(material).forEach(value => {
        if (value instanceof THREE.Texture) value.dispose()
    })
    material.dispose()
}

function disposeMaterialAndUnreferencedTextures(
    material: THREE.Material,
    retainedTextures: ReadonlySet<THREE.Texture>,
) {
    Object.values(material).forEach(value => {
        if (value instanceof THREE.Texture && !retainedTextures.has(value)) {
            value.dispose()
        }
    })
    material.dispose()
}

function collectObjectMaterialTextures(object: THREE.Object3D) {
    const textures = new Set<THREE.Texture>()
    object.traverse(child => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
        materials.forEach(material => {
            Object.values(material).forEach(value => {
                if (value instanceof THREE.Texture) textures.add(value)
            })
        })
    })
    return textures
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
    matCapMap?: THREE.Texture
    multiUvScrollMap?: THREE.Texture
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
        installAtlasAnimation(material, map, binding.atlas, mesh)
        installMultiUvScroll(
            material,
            binding.multiUvScroll,
            textures.multiUvScrollMap,
            mesh,
        )
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
    installAtlasAnimation(material, map, binding.atlas, mesh)
    installMultiUvScroll(
        material,
        binding.multiUvScroll,
        textures.multiUvScrollMap,
        mesh,
    )
    return material
}

function installMultiUvScroll(
    material: THREE.Material,
    profile: StageMultiUvScrollProfile | undefined,
    scrollTexture: THREE.Texture | undefined,
    mesh: THREE.Object3D,
) {
    if (!profile || !scrollTexture) return

    scrollTexture.wrapS = THREE.RepeatWrapping
    scrollTexture.wrapT = THREE.RepeatWrapping
    scrollTexture.needsUpdate = true

    const firstColor = profile.first.color ?? [1, 1, 1, 1]
    const secondColor = profile.second.color ?? [1, 1, 1, 1]
    const baseCacheKey = material.customProgramCacheKey()
    const previousOnBeforeCompile = material.onBeforeCompile
    const previousOnBeforeRender = material.onBeforeRender
    let timeUniform: THREE.IUniform<number> | undefined

    material.userData.stageMultiUvScroll = {
        ...profile,
        timingMode: profile.dropFrame
            ? 'continuous-until-dropped-frame-time-is-recovered'
            : 'continuous',
    }
    material.customProgramCacheKey = () =>
        `${baseCacheKey}:stage-multi-uv:${JSON.stringify(profile)}`

    material.onBeforeCompile = function (shader, renderer) {
        shader.uniforms.uStageMultiUvTexture = { value: scrollTexture }
        shader.uniforms.uStageMultiUvTime = { value: 0 }
        shader.uniforms.uStageMultiUvFirstTiling = {
            value: new THREE.Vector2(...profile.first.tiling),
        }
        shader.uniforms.uStageMultiUvFirstOffset = {
            value: new THREE.Vector2(...profile.first.offset),
        }
        shader.uniforms.uStageMultiUvFirstSpeed = {
            value: new THREE.Vector2(...profile.first.speed),
        }
        shader.uniforms.uStageMultiUvFirstColor = {
            value: new THREE.Vector4(...firstColor),
        }
        shader.uniforms.uStageMultiUvFirstOpacity = {
            value: profile.first.opacity ?? 1,
        }
        shader.uniforms.uStageMultiUvSecondTiling = {
            value: new THREE.Vector2(...profile.second.tiling),
        }
        shader.uniforms.uStageMultiUvSecondOffset = {
            value: new THREE.Vector2(...profile.second.offset),
        }
        shader.uniforms.uStageMultiUvSecondSpeed = {
            value: new THREE.Vector2(...profile.second.speed),
        }
        shader.uniforms.uStageMultiUvSecondColor = {
            value: new THREE.Vector4(...secondColor),
        }
        shader.uniforms.uStageMultiUvSecondOpacity = {
            value: profile.second.opacity ?? 1,
        }
        shader.uniforms.uStageMultiUvAdditiveToMultiply = {
            value: profile.additiveToMultiply,
        }
        timeUniform = shader.uniforms.uStageMultiUvTime as THREE.IUniform<number>

        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <map_pars_fragment>',
                `#include <map_pars_fragment>
uniform sampler2D uStageMultiUvTexture;
uniform float uStageMultiUvTime;
uniform vec2 uStageMultiUvFirstTiling;
uniform vec2 uStageMultiUvFirstOffset;
uniform vec2 uStageMultiUvFirstSpeed;
uniform vec4 uStageMultiUvFirstColor;
uniform float uStageMultiUvFirstOpacity;
uniform vec2 uStageMultiUvSecondTiling;
uniform vec2 uStageMultiUvSecondOffset;
uniform vec2 uStageMultiUvSecondSpeed;
uniform vec4 uStageMultiUvSecondColor;
uniform float uStageMultiUvSecondOpacity;
uniform float uStageMultiUvAdditiveToMultiply;`,
            )
            .replace(
                '#include <map_fragment>',
                `#include <map_fragment>
#ifdef USE_MAP
    vec2 rdStageUv1 =
        vMapUv * uStageMultiUvFirstTiling +
        uStageMultiUvFirstOffset +
        uStageMultiUvFirstSpeed * uStageMultiUvTime;
    vec2 rdStageUv2 =
        vMapUv * uStageMultiUvSecondTiling +
        uStageMultiUvSecondOffset +
        uStageMultiUvSecondSpeed * uStageMultiUvTime;
    vec4 rdStageScroll1 =
        texture2D(uStageMultiUvTexture, rdStageUv1) *
        uStageMultiUvFirstColor;
    vec4 rdStageScroll2 =
        texture2D(uStageMultiUvTexture, rdStageUv2) *
        uStageMultiUvSecondColor;
    float rdStageAlpha1 = saturate(
        rdStageScroll1.a * uStageMultiUvFirstOpacity
    );
    float rdStageAlpha2 = saturate(
        rdStageScroll2.a * uStageMultiUvSecondOpacity
    );

    // The two texture inputs, ST, colors, opacities and speeds are exact
    // serialized JP Material values. The final additive/multiply interpolation
    // remains an explicit Web approximation until the compiled background
    // shader subprogram is decoded.
    vec3 rdStageAdditive = diffuseColor.rgb +
        rdStageScroll1.rgb * rdStageAlpha1 +
        rdStageScroll2.rgb * rdStageAlpha2;
    vec3 rdStageMultiply = diffuseColor.rgb *
        mix(vec3(1.0), rdStageScroll1.rgb, rdStageAlpha1) *
        mix(vec3(1.0), rdStageScroll2.rgb, rdStageAlpha2);
    diffuseColor.rgb = mix(
        rdStageAdditive,
        rdStageMultiply,
        saturate(uStageMultiUvAdditiveToMultiply)
    );
#endif`,
            )

        previousOnBeforeCompile.call(this, shader, renderer)
    }

    material.onBeforeRender = function (
        renderer,
        scene,
        camera,
        geometry,
        object,
        group,
    ) {
        previousOnBeforeRender.call(
            this,
            renderer,
            scene,
            camera,
            geometry,
            object,
            group,
        )
        if (timeUniform) {
            timeUniform.value =
                findStageRuntimeTime(mesh) ?? performance.now() * 0.001
        }
    }
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
    mesh: THREE.Object3D,
) {
    if (!map || !atlas) return
    const frameCount = Math.max(1, atlas.columns * atlas.rows)
    const frameOffset = atlas.offset ?? 0
    const framesPerSecond = atlas.framesPerSecond ?? 0
    material.userData.stageAtlas = { ...atlas }
    material.onBeforeRender = () => {
        const runtimeTime = findStageRuntimeTime(mesh)
        const elapsedFrame = framesPerSecond > 0
            ? Math.floor(
                (runtimeTime ?? performance.now() * 0.001)
                * framesPerSecond,
            )
            : 0
        setAtlasFrame(map, atlas, (frameOffset + elapsedFrame) % frameCount)
    }
}

function findStageRuntimeTime(object: THREE.Object3D) {
    let current: THREE.Object3D | null = object
    while (current) {
        const value = current.userData.stageRuntimeTime
        if (typeof value === 'number' && Number.isFinite(value)) return value
        current = current.parent
    }
    return undefined
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
    const matCapMap = textures.matCapMap
    const smoothness = binding.smoothness ?? 1
    const smoothnessChannel = binding.smoothnessChannel ?? 'r'
    const unlitness = binding.unlitness ?? 0
    material.userData.stageBlendMap = blendMap
    material.userData.stageSmoothnessMap = smoothnessMap
    material.userData.stageSmoothness = smoothness
    material.userData.stageMatCapMap = matCapMap
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

        if (matCapMap) {
            shader.uniforms.uStageMatCapMap = { value: matCapMap }
            shader.uniforms.uStageMatCapIntensity = {
                value: binding.matCapIntensity ?? 1,
            }
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <common>',
                    `#include <common>
uniform sampler2D uStageMatCapMap;
uniform float uStageMatCapIntensity;`,
                )
                .replace(
                    '#include <opaque_fragment>',
                    `vec3 stageMatCapViewDir = normalize( vViewPosition );
float stageMatCapHorizontalLengthSq = dot(
    stageMatCapViewDir.xz,
    stageMatCapViewDir.xz
);
vec3 stageMatCapX = stageMatCapHorizontalLengthSq > 1e-6
    ? vec3(
        stageMatCapViewDir.z,
        0.0,
        -stageMatCapViewDir.x
    ) * inversesqrt( stageMatCapHorizontalLengthSq )
    : vec3( 1.0, 0.0, 0.0 );
vec3 stageMatCapY = cross( stageMatCapViewDir, stageMatCapX );
vec2 stageMatCapUv = vec2(
    dot( stageMatCapX, normal ),
    dot( stageMatCapY, normal )
) * 0.495 + 0.5;
vec3 stageMatCapColor = texture2D(
    uStageMatCapMap,
    stageMatCapUv
).rgb;
outgoingLight = mix(
    outgoingLight,
    diffuseColor.rgb * stageMatCapColor,
    clamp( uStageMatCapIntensity, 0.0, 1.0 )
);
#include <opaque_fragment>`,
                )
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
        matCapMap ? `matcap-${binding.matCapIntensity ?? 1}` : 'no-matcap',
        unlitness > 0 ? `unlit-mix-${unlitness}` : 'fully-lit',
    ].join(':')
    material.needsUpdate = true
}
