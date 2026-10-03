import * as THREE from 'three'
import { resolveRuntimeAssetUrl } from './runtimeProductDelivery'
import { readLoadingResponse } from '../../magia-exedra-character-three/loadingProgress.ts'

/** An audited original Sprite, not an image-plane stand-in for a missing 3D scene. */
export interface NativeImageBackground {
    schema: 'magius.native-image-background.v1'
    sourceType: 'Sprite'
    sourceRegion: 'steam-jp'
    sourceBundle: string
    spritePathId: string
    texturePathId: string
    width: number
    height: number
    byteLength: number
    sha256: string
    pixelSha256: string
}
interface ImageDefinition { id: string; url?: string; assetBundleName?: string; nativeImage?: NativeImageBackground }

export function validateNativeImageBackground(definition: ImageDefinition): NativeImageBackground {
    const profile = definition.nativeImage
    if (!profile || profile.schema !== 'magius.native-image-background.v1'
        || profile.sourceType !== 'Sprite' || profile.sourceRegion !== 'steam-jp'
        || !profile.sourceBundle.startsWith('gallery/library/diorama_background/')
        || profile.sourceBundle !== definition.assetBundleName
        || !/^-?\d+$/.test(profile.spritePathId) || !/^-?\d+$/.test(profile.texturePathId)
        || !Number.isInteger(profile.width) || profile.width < 1 || profile.width > 16384
        || !Number.isInteger(profile.height) || profile.height < 1 || profile.height > 16384
        || !Number.isSafeInteger(profile.byteLength) || profile.byteLength <= 0
        || !/^[a-f0-9]{64}$/.test(profile.sha256) || !/^[a-f0-9]{64}$/.test(profile.pixelSha256)
        || !definition.url?.startsWith('./stages/official/' + definition.id + '/')
        || !definition.url.endsWith('.png')) {
        throw new Error('Unverified native image background: ' + definition.id)
    }
    return profile
}

/** Contain the whole image without stretching, cropping or camera-dependent parallax. */
export function nativeImageViewportScale(imageAspect: number, viewportAspect: number): [number, number] {
    if (!(imageAspect > 0) || !(viewportAspect > 0) || !Number.isFinite(imageAspect + viewportAspect)) {
        throw new RangeError('Invalid image or viewport aspect')
    }
    return imageAspect > viewportAspect ? [1, viewportAspect / imageAspect] : [imageAspect / viewportAspect, 1]
}

export function createNativeImageScreen(texture: THREE.Texture, id: string, profile: NativeImageBackground): THREE.Mesh {
    const scale = new THREE.Vector2(1, 1)
    const viewport = new THREE.Vector4()
    const material = new THREE.ShaderMaterial({
        name: 'Native2DBackground:' + id, transparent: true, depthWrite: false, depthTest: false,
        toneMapped: false, uniforms: { uImage: { value: texture }, uImageScale: { value: scale } },
        vertexShader: `varying vec2 vImageUV;
void main() { vImageUV = uv; gl_Position = vec4(position.xy, 0.999999, 1.0); }`,
        fragmentShader: `uniform sampler2D uImage; uniform vec2 uImageScale; varying vec2 vImageUV;
void main() {
    vec2 imageUV = (vImageUV - 0.5) / uImageScale + 0.5;
    bool inside = all(greaterThanEqual(imageUV, vec2(0.0))) && all(lessThanEqual(imageUV, vec2(1.0)));
    gl_FragColor = inside ? texture2D(uImage, imageUV) : vec4(0.035, 0.04, 0.05, 1.0);
    #include <colorspace_fragment>
}`,
    })
    material.userData.stageRigidVertexPosition = false
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    mesh.name = 'Native2DBackground:' + id
    mesh.renderOrder = -100000
    mesh.frustumCulled = false
    mesh.castShadow = mesh.receiveShadow = false
    mesh.userData.stageCastShadow = mesh.userData.stageReceiveShadow = false
    mesh.userData.nativeImageBackground = { id, ...profile }
    // The screen-space quad is not a world-space floor, prop, editor hit or backdrop depth occluder.
    mesh.raycast = () => {}
    mesh.onBeforeRender = renderer => {
        renderer.getCurrentViewport(viewport)
        scale.fromArray(nativeImageViewportScale(profile.width / profile.height, Math.max(1, viewport.z) / Math.max(1, viewport.w)))
    }
    return mesh
}

export async function loadNativeImageBackground(definition: ImageDefinition, signal: AbortSignal) {
    const profile = validateNativeImageBackground(definition)
    const payloadUrl = await resolveRuntimeAssetUrl(definition.url!, signal)
    const response = await fetch(payloadUrl, { signal })
    if (!response.ok) throw new Error('Native background image HTTP ' + response.status)
    const bytes = await readLoadingResponse(response, { url: definition.url!, signal, expectedBytes: profile.byteLength })
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('')
    if (bytes.byteLength !== profile.byteLength || digest !== profile.sha256) throw new Error('Native background payload identity mismatch: ' + definition.id)
    signal.throwIfAborted()
    const blob = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
    let texture: THREE.Texture | undefined
    try {
        texture = await new THREE.TextureLoader().loadAsync(blob)
        signal.throwIfAborted()
        const image = texture.image as HTMLImageElement | undefined
        if (!image || image.width !== profile.width || image.height !== profile.height) throw new Error('Native background dimensions mismatch')
        texture.name = 'NativeGallery:' + definition.url
        texture.colorSpace = THREE.SRGBColorSpace
        texture.generateMipmaps = false
        texture.minFilter = texture.magFilter = THREE.LinearFilter
        return { object: createNativeImageScreen(texture, definition.id, profile), textures: [texture] }
    } catch (error) {
        texture?.dispose()
        throw error
    } finally { URL.revokeObjectURL(blob) }
}
