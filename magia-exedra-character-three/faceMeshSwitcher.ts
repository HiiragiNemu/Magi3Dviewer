import * as THREE from 'three'
import generatedProfileDocument from './official-face-mesh-switcher-profiles.generated.json'
import {
    unityDirectionToThreeFbx,
    type ReDriveAxis,
} from './renderProfile'
import {
    addCameraRenderLoop,
    removeCameraRenderLoop,
} from './renderer'

export type OfficialFaceState = 'FrontRight' | 'FrontLeft' | 'Side'

const FACE_MESH_ROLES = [
    'faceFrontRight',
    'faceFrontLeft',
    'faceSide',
    'facepartsFront',
    'facepartsSide',
    'mouthFrontRight',
    'mouthFrontLeft',
    'mouthSide',
] as const

type OfficialFaceMeshRole = typeof FACE_MESH_ROLES[number]

export interface OfficialFaceMeshSwitcherProfile {
    source: {
        bundle: string
        characterId: number
        componentPathId: string
        rootGameObjectPathId: string
        rootGameObjectName: string
    }
    head: { name: string; path: string }
    faceForwardDirection: number
    faceForwardAxis: ReDriveAxis
    faceUpAxis: ReDriveAxis
    faceRightAxis: ReDriveAxis
    meshes: Record<OfficialFaceMeshRole, string>
    switchAngle: number
    hysteresisAngle: number
    controlBone: { name: string; path: string }
    elevationMin: number
    elevationMax: number
    cameraDownOffsetAtMax: number
    yScaleAtMax: number
    localZElevationMin: number
    localZElevationMax: number
    localZOffsetAtMax: number
    localZFrontBackBlend: number
    boneHideAngle: number
    boneHideElevationAngle: number
    shouldDrawGizmo: boolean
}

export interface OfficialFaceMeshSwitcherDebugState {
    sourceBundle: string
    componentPathId: string
    matchedBy: 'complete-semantic-mesh-set'
    state: OfficialFaceState
    horizontalAngle: number
    elevationAngle: number
    switchAngle: number
    hysteresisAngle: number
    cameraName: string | null
    meshVisibility: Record<OfficialFaceMeshRole, boolean>
    controlBoneName: string
    controlBoneAvailable: boolean
    controlElevationFactor: number
    controlLocalZFactor: number
    controlFrontBackWeight: number
    controlHiddenByAngle: boolean
    controlHiddenByElevation: boolean
    controlBoneScale: [number, number, number] | null
    controlBonePosition: [number, number, number] | null
    disposed: boolean
}

export interface OfficialFaceMeshSwitcherRuntime {
    readonly profile: OfficialFaceMeshSwitcherProfile
    readonly debug: OfficialFaceMeshSwitcherDebugState
    update: (camera: THREE.Camera) => void
    dispose: () => void
}

interface GeneratedProfileDocument {
    schemaVersion: number
    profileCount: number
    profiles: OfficialFaceMeshSwitcherProfile[]
}

const PROFILE_DOCUMENT =
    generatedProfileDocument as unknown as GeneratedProfileDocument
const OFFICIAL_PROFILES = PROFILE_DOCUMENT.profiles
const ACTIVE_DEBUG_STATES = new Set<OfficialFaceMeshSwitcherDebugState>()

// FaceMeshSwitcher.BoneHideScale is a literal const float in the current
// official PC global metadata default-value table (0x38d1b717 LE).
export const OFFICIAL_FACE_BONE_HIDE_SCALE = 0.0001

const headPosition = new THREE.Vector3()
const cameraPosition = new THREE.Vector3()
const headQuaternion = new THREE.Quaternion()
const cameraQuaternion = new THREE.Quaternion()
const parentQuaternion = new THREE.Quaternion()
const directionToCamera = new THREE.Vector3()
const horizontalDirection = new THREE.Vector3()
const faceForward = new THREE.Vector3()
const faceUp = new THREE.Vector3()
const faceRight = new THREE.Vector3()
const cameraDownWorld = new THREE.Vector3()
const cameraDownLocal = new THREE.Vector3()

export function getOfficialFaceMeshSwitcherProfiles():
readonly OfficialFaceMeshSwitcherProfile[] {
    return OFFICIAL_PROFILES
}

export function getActiveOfficialFaceMeshSwitcherDebugStates():
readonly OfficialFaceMeshSwitcherDebugState[] {
    return [...ACTIVE_DEBUG_STATES]
}

function normalizeSignedAngle(angle: number): number {
    return THREE.MathUtils.euclideanModulo(angle + 180, 360) - 180
}

/**
 * Official FaceState is FrontRight=0, FrontLeft=1, Side=2. Side entry and
 * exit use the serialized hysteresis band around switchAngle.
 */
export function evaluateOfficialFaceState(
    horizontalAngle: number,
    currentState: OfficialFaceState,
    switchAngle: number,
    hysteresisAngle: number,
): OfficialFaceState {
    const angle = normalizeSignedAngle(horizontalAngle)
    const absoluteAngle = Math.abs(angle)
    const sideThreshold = currentState === 'Side'
        ? switchAngle - hysteresisAngle
        : switchAngle + hysteresisAngle
    if (absoluteAngle > sideThreshold) return 'Side'
    return angle >= 0 ? 'FrontRight' : 'FrontLeft'
}

function getObjectPath(object: THREE.Object3D, root: THREE.Object3D): string {
    const names: string[] = []
    let current: THREE.Object3D | null = object
    while (current) {
        names.unshift(current.name)
        if (current === root) break
        current = current.parent
    }
    return names.join('/')
}

function hierarchySuffixScore(serializedPath: string, importedPath: string): number {
    const official = serializedPath.split('/').filter(Boolean)
    const imported = importedPath.split('/').filter(Boolean)
    let score = 0
    while (
        score < official.length
        && score < imported.length
        && official[official.length - 1 - score]
            === imported[imported.length - 1 - score]
    ) {
        score++
    }
    return score
}

function hasSceneAncestor(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object
    while (current) {
        if ((current as THREE.Scene).isScene) return true
        current = current.parent
    }
    return false
}

function findSemanticObject(
    root: THREE.Object3D,
    name: string,
    serializedPath: string,
): THREE.Object3D | undefined {
    const candidates: THREE.Object3D[] = []
    root.traverse(object => {
        if (object.name === name) candidates.push(object)
    })
    return candidates.sort((a, b) =>
        hierarchySuffixScore(serializedPath, getObjectPath(b, root))
        - hierarchySuffixScore(serializedPath, getObjectPath(a, root))
    )[0]
}

function getUniqueNamedMesh(
    root: THREE.Object3D,
    name: string,
): THREE.Mesh | undefined {
    const matches: THREE.Mesh[] = []
    root.traverse(object => {
        if (object.name === name && (object as THREE.Mesh).isMesh) {
            matches.push(object as THREE.Mesh)
        }
    })
    return matches.length === 1 ? matches[0] : undefined
}

function matchProfile(
    root: THREE.Object3D,
    profile: OfficialFaceMeshSwitcherProfile,
): Record<OfficialFaceMeshRole, THREE.Mesh> | undefined {
    const result = {} as Record<OfficialFaceMeshRole, THREE.Mesh>
    for (const role of FACE_MESH_ROLES) {
        const mesh = getUniqueNamedMesh(root, profile.meshes[role])
        if (!mesh) return undefined
        result[role] = mesh
    }
    return result
}

export function findOfficialFaceMeshSwitcherProfile(
    root: THREE.Object3D,
): OfficialFaceMeshSwitcherProfile | undefined {
    const matches = OFFICIAL_PROFILES.filter(profile => matchProfile(root, profile))
    return matches.length === 1 ? matches[0] : undefined
}

function inverseLerpClamped(min: number, max: number, value: number): number {
    if (max === min) return value >= max ? 1 : 0
    return THREE.MathUtils.clamp((value - min) / (max - min), 0, 1)
}

function setFaceState(
    meshes: Record<OfficialFaceMeshRole, THREE.Mesh>,
    state: OfficialFaceState,
    debug: OfficialFaceMeshSwitcherDebugState,
) {
    const visibility: Record<OfficialFaceMeshRole, boolean> = {
        faceFrontRight: state === 'FrontRight',
        faceFrontLeft: state === 'FrontLeft',
        faceSide: state === 'Side',
        facepartsFront: state !== 'Side',
        facepartsSide: state === 'Side',
        mouthFrontRight: state === 'FrontRight',
        mouthFrontLeft: state === 'FrontLeft',
        mouthSide: state === 'Side',
    }
    for (const role of FACE_MESH_ROLES) {
        meshes[role].visible = visibility[role]
    }
    debug.state = state
    debug.meshVisibility = visibility
}

function reportBrowserDebugState(debug: OfficialFaceMeshSwitcherDebugState) {
    if (typeof window === 'undefined') return
    const payload = JSON.stringify(debug)
    console.info(
        'OFFICIAL_FACE_MESH_SWITCHER_RUNTIME '
        + payload,
    )
    if (
        typeof document !== 'undefined'
        && new URLSearchParams(window.location.search).has('diagnostic')
    ) {
        document.documentElement.dataset.officialFaceMeshSwitcherRuntime = payload
    }
}

function updateControlBone(
    controlBone: THREE.Object3D,
    originalPosition: THREE.Vector3,
    originalScale: THREE.Vector3,
    profile: OfficialFaceMeshSwitcherProfile,
    horizontalAngle: number,
    elevationAngle: number,
    camera: THREE.Camera,
    debug: OfficialFaceMeshSwitcherDebugState,
) {
    const positiveElevation = Math.max(0, elevationAngle)
    const elevationFactor = inverseLerpClamped(
        profile.elevationMin,
        profile.elevationMax,
        positiveElevation,
    )
    const localZFactor = inverseLerpClamped(
        profile.localZElevationMin,
        profile.localZElevationMax,
        positiveElevation,
    )
    const frontBack = Math.cos(THREE.MathUtils.degToRad(horizontalAngle))
    const frontBackWeight = THREE.MathUtils.lerp(
        1,
        frontBack,
        profile.localZFrontBackBlend,
    )
    const hiddenByAngle =
        Math.abs(horizontalAngle) > profile.boneHideAngle
    const hiddenByElevation =
        elevationAngle > profile.boneHideElevationAngle

    controlBone.position.copy(originalPosition)
    camera.getWorldQuaternion(cameraQuaternion)
    cameraDownWorld.set(0, -1, 0).applyQuaternion(cameraQuaternion)
    if (controlBone.parent) {
        controlBone.parent.getWorldQuaternion(parentQuaternion)
        cameraDownLocal
            .copy(cameraDownWorld)
            .applyQuaternion(parentQuaternion.invert())
    } else {
        cameraDownLocal.copy(cameraDownWorld)
    }
    controlBone.position.addScaledVector(
        cameraDownLocal,
        profile.cameraDownOffsetAtMax * elevationFactor,
    )
    controlBone.position.z +=
        profile.localZOffsetAtMax * localZFactor * frontBackWeight

    controlBone.scale.copy(originalScale)
    controlBone.scale.y *= THREE.MathUtils.lerp(
        1,
        profile.yScaleAtMax,
        elevationFactor,
    )
    if (hiddenByAngle || hiddenByElevation) {
        controlBone.scale.setScalar(OFFICIAL_FACE_BONE_HIDE_SCALE)
    }
    controlBone.updateMatrix()

    debug.controlElevationFactor = elevationFactor
    debug.controlLocalZFactor = localZFactor
    debug.controlFrontBackWeight = frontBackWeight
    debug.controlHiddenByAngle = hiddenByAngle
    debug.controlHiddenByElevation = hiddenByElevation
    debug.controlBoneScale = controlBone.scale.toArray() as [number, number, number]
    debug.controlBonePosition =
        controlBone.position.toArray() as [number, number, number]
}

export function installOfficialFaceMeshSwitcher(
    root: THREE.Object3D,
): OfficialFaceMeshSwitcherRuntime | undefined {
    const profile = findOfficialFaceMeshSwitcherProfile(root)
    if (!profile) return undefined
    const meshes = matchProfile(root, profile)
    const head = findSemanticObject(root, profile.head.name, profile.head.path)
    const controlBone = findSemanticObject(
        root,
        profile.controlBone.name,
        profile.controlBone.path,
    )
    if (!meshes || !head) return undefined

    // AssetStudio omits the serialized MouthScaleOffset when it has no FBX
    // skin binding. Mesh switching remains authoritative; control-bone
    // elevation is installed whenever that exact serialized transform exists.
    const originalPosition = controlBone?.position.clone()
    const originalScale = controlBone?.scale.clone()
    const debug: OfficialFaceMeshSwitcherDebugState = {
        sourceBundle: profile.source.bundle,
        componentPathId: profile.source.componentPathId,
        matchedBy: 'complete-semantic-mesh-set',
        state: 'FrontRight',
        horizontalAngle: 0,
        elevationAngle: 0,
        switchAngle: profile.switchAngle,
        hysteresisAngle: profile.hysteresisAngle,
        cameraName: null,
        meshVisibility: {} as Record<OfficialFaceMeshRole, boolean>,
        controlBoneName: profile.controlBone.name,
        controlBoneAvailable: Boolean(controlBone),
        controlElevationFactor: 0,
        controlLocalZFactor: 0,
        controlFrontBackWeight: 1,
        controlHiddenByAngle: false,
        controlHiddenByElevation: false,
        controlBoneScale:
            originalScale?.toArray() as [number, number, number] | undefined
            ?? null,
        controlBonePosition:
            originalPosition?.toArray() as [number, number, number] | undefined
            ?? null,
        disposed: false,
    }
    let state: OfficialFaceState = 'FrontRight'
    let reportedCameraState: OfficialFaceState | null = null
    setFaceState(meshes, state, debug)

    const localForward = unityDirectionToThreeFbx(profile.faceForwardAxis)
    const localUp = unityDirectionToThreeFbx(profile.faceUpAxis)
    const localRight = unityDirectionToThreeFbx(profile.faceRightAxis)

    const update = (camera: THREE.Camera) => {
        if (debug.disposed) return
        head.updateWorldMatrix(true, false)
        camera.updateWorldMatrix(true, false)
        head.getWorldPosition(headPosition)
        head.getWorldQuaternion(headQuaternion)
        camera.getWorldPosition(cameraPosition)

        faceForward.copy(localForward).applyQuaternion(headQuaternion).normalize()
        faceUp.copy(localUp).applyQuaternion(headQuaternion).normalize()
        faceRight.copy(localRight).applyQuaternion(headQuaternion).normalize()
        directionToCamera.copy(cameraPosition).sub(headPosition).normalize()
        const elevationDot = THREE.MathUtils.clamp(
            directionToCamera.dot(faceUp),
            -1,
            1,
        )
        horizontalDirection
            .copy(directionToCamera)
            .addScaledVector(faceUp, -elevationDot)
        const horizontalLength = horizontalDirection.length()
        if (horizontalLength > 1e-7) {
            horizontalDirection.divideScalar(horizontalLength)
        }

        const horizontalAngle = horizontalLength > 1e-7
            ? THREE.MathUtils.radToDeg(Math.atan2(
                horizontalDirection.dot(faceRight),
                horizontalDirection.dot(faceForward),
            ))
            : debug.horizontalAngle
        const elevationAngle = THREE.MathUtils.radToDeg(
            Math.atan2(elevationDot, horizontalLength),
        )
        state = evaluateOfficialFaceState(
            horizontalAngle,
            state,
            profile.switchAngle,
            profile.hysteresisAngle,
        )
        debug.horizontalAngle = horizontalAngle
        debug.elevationAngle = elevationAngle
        debug.cameraName = camera.name || camera.type
        setFaceState(meshes, state, debug)
        if (controlBone && originalPosition && originalScale) {
            updateControlBone(
                controlBone,
                originalPosition,
                originalScale,
                profile,
                horizontalAngle,
                elevationAngle,
                camera,
                debug,
            )
        }
        if (reportedCameraState !== state || debug.cameraName === null) {
            reportBrowserDebugState(debug)
            reportedCameraState = state
        }
    }

    let runtime: OfficialFaceMeshSwitcherRuntime
    let removalArmed = hasSceneAncestor(root)
    const onAdded = () => { removalArmed = true }
    const onRemoved = () => {
        if (removalArmed) runtime.dispose()
    }
    const dispose = () => {
        if (debug.disposed) return
        debug.disposed = true
        reportBrowserDebugState(debug)
        removeCameraRenderLoop(update)
        root.removeEventListener('added', onAdded)
        root.removeEventListener('removed', onRemoved)
        ACTIVE_DEBUG_STATES.delete(debug)
        if (controlBone && originalPosition && originalScale) {
            controlBone.position.copy(originalPosition)
            controlBone.scale.copy(originalScale)
            controlBone.updateMatrix()
        }
    }
    runtime = { profile, debug, update, dispose }
    root.userData.officialFaceMeshSwitcherRuntime = debug
    root.addEventListener('added', onAdded)
    root.addEventListener('removed', onRemoved)
    ACTIVE_DEBUG_STATES.add(debug)
    addCameraRenderLoop(update)
    reportBrowserDebugState(debug)
    return runtime
}

if (typeof window !== 'undefined') {
    Object.assign(window, { getActiveOfficialFaceMeshSwitcherDebugStates })
}
