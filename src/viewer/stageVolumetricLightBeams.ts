import * as THREE from 'three'

import type { BackgroundDepthConsumer } from 'magia-exedra-character-three/scene/backgroundDepth'
import { resolveStageHierarchyPath } from './stageHierarchy'
import type {
    StageVolumetricDustParticlesProfile,
    StageVolumetricLightBeamConfigProfile,
    StageVolumetricLightBeamProfile,
} from './stageRuntime'
import { unityLightColorToLinear } from './unityLighting'

export interface StageVolumetricLightBeamDebugState {
    requestedBeamCount: number
    activeBeamCount: number
    missingAnchorPaths: string[]
    rejectedComponentPathIDs: string[]
    depthBlendConsumerCount: number
    deferredDustParticleCount: number
    configAuthority?: string
    pluginVersion?: number
    sharedMeshSides?: number
    sharedMeshSegments?: number
    geometryRenderQueue?: number
}

export interface StageBackgroundDepthRegistrar {
    registerBackgroundDepthConsumer(
        consumer: BackgroundDepthConsumer,
    ): () => void
}

interface ActiveBeam {
    profile: StageVolumetricLightBeamProfile
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    unregisterDepth?: () => void
}

function finite(value: number | undefined, fallback: number) {
    return Number.isFinite(value) ? value! : fallback
}

function clampedInt(value: number, minimum: number, maximum: number) {
    return THREE.MathUtils.clamp(Math.round(value), minimum, maximum)
}

/** Exact VLB 1.970 shared-mesh topology: (segments + 2) rings plus one cap. */
export function createVlbSharedConeGeometry(
    sides: number,
    segments: number,
    doubleSided: boolean,
) {
    const sideCount = clampedInt(sides, 3, 256)
    const segmentCount = clampedInt(segments, 0, 64)
    const ringCount = segmentCount + 2
    const frontPositions: number[] = []
    const frontUvs: number[] = []
    const angleOffset = sideCount === 4 ? Math.PI / 4 : 0

    for (let ring = 0; ring < ringCount; ring++) {
        for (let side = 0; side < sideCount; side++) {
            const angle = angleOffset + side * Math.PI * 2 / sideCount
            const x = Math.cos(angle)
            const y = Math.sin(angle)
            const z = ring / (segmentCount + 1)
            frontPositions.push(x, y, z)
            frontUvs.push(0, 0)
        }
    }

    // SharedMesh.Get always requests a cap. Per-beam geomCap is a shader gate.
    const capCenter = frontPositions.length / 3
    frontPositions.push(0, 0, 0)
    frontUvs.push(-0.3, 0.3)
    for (let side = 0; side < sideCount; side++) {
        const angle = angleOffset + side * Math.PI * 2 / sideCount
        frontPositions.push(Math.cos(angle), Math.sin(angle), 0)
        frontUvs.push(-0.3, 0.3)
    }

    const frontIndices: number[] = []
    for (let side = 0; side < sideCount; side++) {
        const next = (side + 1) % sideCount
        for (let segment = 0; segment <= segmentCount; segment++) {
            const a = segment * sideCount + side
            const b = segment * sideCount + next
            const c = a + sideCount
            const d = b + sideCount
            frontIndices.push(a, b, c, d, c, b)
        }
        const currentCap = capCenter + 1 + side
        const nextCap = capCenter + 1 + next
        frontIndices.push(capCenter, nextCap, currentCap)
    }

    const positions = [...frontPositions]
    const uvs = [...frontUvs]
    const indices = [...frontIndices]
    if (doubleSided) {
        const vertexOffset = frontPositions.length / 3
        positions.push(...frontPositions)
        for (let index = 0; index < frontUvs.length; index += 2) {
            uvs.push(frontUvs[index], 1)
        }
        for (let index = 0; index < frontIndices.length; index += 3) {
            indices.push(
                frontIndices[index] + vertexOffset,
                frontIndices[index + 2] + vertexOffset,
                frontIndices[index + 1] + vertexOffset,
            )
        }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
    )
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.userData.vlb1970 = {
        sides: sideCount,
        segments: segmentCount,
        ringCount,
        doubleSided,
        frontVertexCount: frontPositions.length / 3,
        frontIndexCount: frontIndices.length,
    }
    return geometry
}

export function resolveVlbBeamDimensions(
    profile: StageVolumetricLightBeamProfile,
) {
    const attached = profile.linkedLight
    const length = Math.max(
        0.001,
        profile.fallOffEndFromLight && attached
            ? finite(attached.range, profile.fallOffEnd)
            : finite(profile.fallOffEnd, 3),
    )
    const angleDegrees = THREE.MathUtils.clamp(
        profile.spotAngleFromLight && attached
            ? finite(attached.outerAngleDegrees, profile.spotAngle)
            : finite(profile.spotAngle, 35),
        0.1,
        179.9,
    )
    const radiusStart = Math.max(0, finite(profile.coneRadiusStart, 0.1))
    const radiusEnd = Math.tan(THREE.MathUtils.degToRad(angleDegrees * 0.5))
        * length
    return { length, angleDegrees, radiusStart, radiusEnd }
}

function configureBlend(
    material: THREE.ShaderMaterial,
    blendingMode: number,
) {
    material.transparent = true
    material.blendEquation = THREE.AddEquation
    material.blendEquationAlpha = THREE.AddEquation
    if (blendingMode === 0) {
        material.blending = THREE.CustomBlending
        material.blendSrc = THREE.SrcAlphaFactor
        material.blendDst = THREE.OneFactor
        material.blendSrcAlpha = THREE.OneFactor
        material.blendDstAlpha = THREE.OneFactor
    } else if (blendingMode === 1) {
        material.blending = THREE.CustomBlending
        material.blendSrc = THREE.OneMinusDstColorFactor
        material.blendDst = THREE.OneFactor
        material.blendSrcAlpha = THREE.ZeroFactor
        material.blendDstAlpha = THREE.OneFactor
    } else {
        material.blending = THREE.NormalBlending
    }
}

function makeBeamMaterial(
    profile: StageVolumetricLightBeamProfile,
    config: StageVolumetricLightBeamConfigProfile,
) {
    const dimensions = resolveVlbBeamDimensions(profile)
    const sourceColor = profile.colorFromLight && profile.linkedLight
        ? profile.linkedLight.color
        : profile.color
    const linearColor = unityLightColorToLinear(sourceColor)
    const intensityInside = profile.intensityFromLight && profile.linkedLight
        ? profile.linkedLight.intensity
        : profile.intensityInside
    const intensityOutside = profile.intensityFromLight && profile.linkedLight
        ? profile.linkedLight.intensity
        : profile.intensityOutside
    const uniforms = {
        uColor: { value: new THREE.Color(...linearColor) },
        uLength: { value: dimensions.length },
        uRadiusStart: { value: Math.max(0.001, dimensions.radiusStart) },
        uRadiusEnd: { value: Math.max(0.001, dimensions.radiusEnd) },
        uIntensityInside: { value: Math.max(0, intensityInside) },
        uIntensityOutside: { value: Math.max(0, intensityOutside) },
        uFallOffStart: { value: Math.max(0, profile.fallOffStart) },
        uFallOffEnd: { value: dimensions.length },
        uAttenuationLerp: {
            value: profile.attenuationEquation === 0
                ? 0
                : profile.attenuationEquation === 1
                    ? 1
                    : THREE.MathUtils.clamp(
                        profile.attenuationCustomBlending,
                        0,
                        1,
                    ),
        },
        uCameraClippingDistance: {
            value: Math.max(0.001, profile.cameraClippingDistance),
        },
        uGlareFrontal: { value: Math.max(0, profile.glareFrontal) },
        uGlareBehind: { value: Math.max(0, profile.glareBehind) },
        uFresnelPow: { value: Math.max(0.001, profile.fresnelPow) },
        uDrawCap: { value: profile.geomCap ? 1 : 0 },
        uUseDepthBlend: {
            value: config.featureEnabledDepthBlend
                && profile.depthBlendDistance > 0
                ? 1
                : 0,
        },
        uDepthBlendDistance: {
            value: Math.max(0.001, profile.depthBlendDistance),
        },
        uSceneDepth: { value: null as THREE.Texture | null },
        uDepthResolution: { value: new THREE.Vector2(1, 1) },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 1000 },
        uOrthographic: { value: 0 },
    }
    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: /* glsl */ `
            uniform float uLength;
            uniform float uRadiusStart;
            uniform float uRadiusEnd;
            varying vec3 vWorldPosition;
            varying float vViewDepth;
            varying float vAxialDistance;
            varying float vInsideSurface;
            varying float vCap;
            void main() {
                float axial01 = position.z * position.z;
                float radius = mix(uRadiusStart, uRadiusEnd, axial01);
                vec3 localPosition = vec3(
                    position.xy * radius,
                    axial01 * uLength
                );
                vec4 worldPosition = modelMatrix * vec4(localPosition, 1.0);
                vec4 viewPosition = viewMatrix * worldPosition;
                gl_Position = projectionMatrix * viewPosition;
                vWorldPosition = worldPosition.xyz;
                vViewDepth = -viewPosition.z;
                vAxialDistance = localPosition.z;
                vInsideSurface = uv.y;
                vCap = step(uv.x, -0.1);
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 uColor;
            uniform float uIntensityInside;
            uniform float uIntensityOutside;
            uniform float uFallOffStart;
            uniform float uFallOffEnd;
            uniform float uAttenuationLerp;
            uniform float uCameraClippingDistance;
            uniform float uGlareFrontal;
            uniform float uGlareBehind;
            uniform float uFresnelPow;
            uniform float uDrawCap;
            uniform float uUseDepthBlend;
            uniform float uDepthBlendDistance;
            uniform sampler2D uSceneDepth;
            uniform vec2 uDepthResolution;
            uniform float uCameraNear;
            uniform float uCameraFar;
            uniform float uOrthographic;
            varying vec3 vWorldPosition;
            varying float vViewDepth;
            varying float vAxialDistance;
            varying float vInsideSurface;
            varying float vCap;

            float depthToViewDistance(float depth) {
                float perspectiveViewZ = (uCameraNear * uCameraFar) /
                    ((uCameraFar - uCameraNear) * depth - uCameraFar);
                float orthographicViewZ = depth *
                    (uCameraNear - uCameraFar) - uCameraNear;
                return -mix(perspectiveViewZ, orthographicViewZ, uOrthographic);
            }

            void main() {
                if (vCap > 0.5 && uDrawCap < 0.5) discard;
                float distanceRange = max(0.001, uFallOffEnd - uFallOffStart);
                float distance01 = clamp(
                    (vAxialDistance - uFallOffStart) / distanceRange,
                    0.0,
                    1.0
                );
                float linearAttenuation = 1.0 - distance01;
                float quadraticAttenuation = linearAttenuation * linearAttenuation;
                float attenuation = mix(
                    linearAttenuation,
                    quadraticAttenuation,
                    uAttenuationLerp
                );

                vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
                vec3 surfaceNormal = normalize(cross(
                    dFdx(vWorldPosition),
                    dFdy(vWorldPosition)
                ));
                float facing = dot(surfaceNormal, viewDirection);
                float fresnel = pow(
                    clamp(1.0 - abs(facing), 0.0, 1.0),
                    uFresnelPow
                );
                float glare = mix(uGlareBehind, uGlareFrontal, step(0.0, facing));
                float intensity = mix(
                    uIntensityOutside,
                    uIntensityInside,
                    vInsideSurface
                );
                float cameraFade = smoothstep(
                    0.0,
                    uCameraClippingDistance,
                    distance(cameraPosition, vWorldPosition)
                );
                float depthFade = 1.0;
                if (uUseDepthBlend > 0.5) {
                    vec2 depthUv = gl_FragCoord.xy / uDepthResolution;
                    float sceneDepth = texture2D(uSceneDepth, depthUv).x;
                    float sceneViewDistance = depthToViewDistance(sceneDepth);
                    depthFade = clamp(
                        (sceneViewDistance - vViewDepth) / uDepthBlendDistance,
                        0.0,
                        1.0
                    );
                }
                float alpha = intensity * attenuation * cameraFade * depthFade;
                alpha *= mix(1.0, max(0.001, glare), fresnel);
                if (alpha <= 0.0001) discard;
                gl_FragColor = vec4(uColor, alpha);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
        depthTest: true,
        depthWrite: false,
        side: THREE.FrontSide,
        transparent: true,
    })
    configureBlend(material, profile.blendingMode)
    material.name = `VLB1970:${profile.componentPathID}`
    material.toneMapped = true
    material.userData.vlb1970 = {
        componentPathID: profile.componentPathID,
        pluginVersion: profile.pluginVersion,
        shaderPathID: config.beamShader.pathID,
        blendMode: profile.blendingMode,
        depthBlend: uniforms.uUseDepthBlend.value > 0.5,
        dimensions,
    }
    return material
}

export class StageVolumetricLightBeamController {
    private readonly active: ActiveBeam[] = []
    private readonly missingAnchorPaths: string[] = []
    private readonly rejectedComponentPathIDs: string[] = []
    private readonly config?: StageVolumetricLightBeamConfigProfile
    private readonly requestedBeamCount: number
    private readonly deferredDustParticleCount: number

    constructor(
        root: THREE.Object3D,
        config: StageVolumetricLightBeamConfigProfile | undefined,
        beams: readonly StageVolumetricLightBeamProfile[],
        dust: readonly StageVolumetricDustParticlesProfile[],
        depthRegistrar: StageBackgroundDepthRegistrar,
    ) {
        this.config = config
        this.requestedBeamCount = beams.length
        this.deferredDustParticleCount = dust.filter(profile => profile.active).length
        if (!config || config.pluginVersion !== 1970 || config.renderPipeline !== 1) {
            this.rejectedComponentPathIDs.push(
                ...beams.map(profile => profile.componentPathID),
            )
            root.userData.stageVolumetricLightBeams = this.getDebugState()
            return
        }

        for (const profile of beams) {
            if (!profile.active || profile.pluginVersion !== config.pluginVersion) {
                this.rejectedComponentPathIDs.push(profile.componentPathID)
                continue
            }
            // This port intentionally activates only compiled feature variants
            // proven by the supplied global config.
            if (
                (profile.noiseMode !== 0 && config.featureEnabledNoise3D)
                || (profile.colorMode !== 0 && config.featureEnabledColorGradient !== 0)
                || config.featureEnabledMeshSkewing
                || config.featureEnabledShaderAccuracyHigh
            ) {
                this.rejectedComponentPathIDs.push(profile.componentPathID)
                continue
            }
            const anchorPath = profile.lightAnchorPath ?? profile.hierarchyPath
            const anchor = anchorPath
                ? resolveStageHierarchyPath(root, anchorPath)
                : undefined
            if (!anchor) {
                this.missingAnchorPaths.push(anchorPath ?? '(missing)')
                continue
            }
            const sides = profile.geomMeshType === 0
                ? config.sharedMeshSides
                : profile.geomCustomSides
            const segments = profile.geomMeshType === 0
                ? config.sharedMeshSegments
                : profile.geomCustomSegments
            const doubleSided = config.renderingMode !== 0
            const geometry = createVlbSharedConeGeometry(
                sides,
                segments,
                doubleSided,
            )
            const material = makeBeamMaterial(profile, config)
            const mesh = new THREE.Mesh(geometry, material)
            mesh.name = `VLB1970-${profile.componentPathID}`
            mesh.renderOrder = config.geometryRenderQueue + profile.sortingOrder
            mesh.frustumCulled = false
            mesh.userData.stageVolumetricLightBeam = {
                profile,
                configObjectPathID: config.objectPathID,
            }
            mesh.onBeforeRender = (_renderer, _scene, camera) => {
                const depthCamera = camera as
                    | THREE.PerspectiveCamera
                    | THREE.OrthographicCamera
                material.uniforms.uCameraNear.value = depthCamera.near
                material.uniforms.uCameraFar.value = depthCamera.far
                material.uniforms.uOrthographic.value =
                    (depthCamera as THREE.OrthographicCamera).isOrthographicCamera
                        ? 1
                        : 0
            }
            anchor.add(mesh)

            let unregisterDepth: (() => void) | undefined
            if (material.uniforms.uUseDepthBlend.value > 0.5) {
                unregisterDepth = depthRegistrar.registerBackgroundDepthConsumer({
                    object: mesh,
                    depthTextureUniform: material.uniforms.uSceneDepth,
                    resolutionUniform: material.uniforms.uDepthResolution,
                })
            }
            this.active.push({ profile, mesh, unregisterDepth })
        }
        root.userData.stageVolumetricLightBeams = this.getDebugState()
    }

    getDebugState(): StageVolumetricLightBeamDebugState {
        return {
            requestedBeamCount: this.requestedBeamCount,
            activeBeamCount: this.active.length,
            missingAnchorPaths: [...this.missingAnchorPaths],
            rejectedComponentPathIDs: [...this.rejectedComponentPathIDs],
            depthBlendConsumerCount:
                this.active.filter(beam => beam.unregisterDepth != undefined).length,
            deferredDustParticleCount: this.deferredDustParticleCount,
            configAuthority: this.config?.source,
            pluginVersion: this.config?.pluginVersion,
            sharedMeshSides: this.config?.sharedMeshSides,
            sharedMeshSegments: this.config?.sharedMeshSegments,
            geometryRenderQueue: this.config?.geometryRenderQueue,
        }
    }

    dispose() {
        for (const beam of this.active) {
            beam.unregisterDepth?.()
            beam.mesh.removeFromParent()
            beam.mesh.geometry.dispose()
            beam.mesh.material.dispose()
        }
        this.active.length = 0
    }
}

export function createStageVolumetricLightBeamController(
    root: THREE.Object3D,
    config: StageVolumetricLightBeamConfigProfile | undefined,
    beams: readonly StageVolumetricLightBeamProfile[] | undefined,
    dust: readonly StageVolumetricDustParticlesProfile[] | undefined,
    depthRegistrar: StageBackgroundDepthRegistrar,
) {
    if (!beams?.length) return undefined
    return new StageVolumetricLightBeamController(
        root,
        config,
        beams,
        dust ?? [],
        depthRegistrar,
    )
}
