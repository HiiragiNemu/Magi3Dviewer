export interface PhysicsVector3 {
    x: number
    y: number
    z: number
}

export interface PhysicsQuaternion extends PhysicsVector3 {
    w: number
}

export interface UnityCurveKey {
    time: number
    value: number
    inSlope: number
    outSlope: number
    weightedMode: number
    inWeight: number
    outWeight: number
}

export interface UnityAnimationCurve {
    m_Curve: readonly UnityCurveKey[]
    m_PreInfinity: number
    m_PostInfinity: number
    m_RotationOrder: number
}

export interface MagicaCurveParameter {
    value: number
    useCurve: number
    curve: UnityAnimationCurve
}

export interface MagicaCheckSlider {
    value: number
    use: number
}

export interface UnityTransformBinding {
    stableKey: string
    transformPathID: string
    gameObjectPathID?: string
    hierarchyPath: string
    modelRelativePath: string | null
    visualRootRelativePath: string | null
    localTRS?: {
        localPosition: PhysicsVector3
        localRotation: PhysicsQuaternion
        localScale: PhysicsVector3
    }
}

export interface CharacterPhysicsComponentActivation {
    componentEnabled: boolean
    gameObjectActive: boolean
    activeInHierarchy: boolean
}

export type CharacterPhysicsComponentScope =
    | 'persistent-model'
    | 'action-timeline-registration'
    | 'auxiliary-prefab-registration'

export interface MagicaClothSerializeData {
    clothType: 0 | 1 | 10
    rootBones: readonly Readonly<{ m_FileID: number; m_PathID: string }>[]
    connectionMode: 0 | 1 | 2 | 3
    rotationalInterpolation: number
    rootRotation: number
    updateMode: 0 | 1 | 2 | 10
    animationPoseRatio: number
    normalAxis: number
    gravity: number
    gravityDirection: PhysicsVector3
    gravityFalloff: number
    stablizationTimeAfterReset: number
    damping: MagicaCurveParameter
    radius: MagicaCurveParameter
    inertiaConstraint: {
        anchor: Readonly<{ m_FileID: number; m_PathID: string }>
        anchorInertia: number
        worldInertia: number
        movementInertiaSmoothing: number
        movementSpeedLimit: MagicaCheckSlider
        rotationSpeedLimit: MagicaCheckSlider
        localInertia: number
        localMovementSpeedLimit: MagicaCheckSlider
        localRotationSpeedLimit: MagicaCheckSlider
        depthInertia: number
        centrifualAcceleration: number
        particleSpeedLimit: MagicaCheckSlider
        teleportMode: 0 | 1 | 2
        teleportDistance: number
        teleportRotation: number
    }
    tetherConstraint: {
        distanceCompression: number
    }
    distanceConstraint: {
        stiffness: MagicaCurveParameter
    }
    triangleBendingConstraint: {
        stiffness: number
    }
    angleRestorationConstraint: {
        useAngleRestoration: number
        stiffness: MagicaCurveParameter
        velocityAttenuation: number
        gravityFalloff: number
    }
    angleLimitConstraint: {
        useAngleLimit: number
        limitAngle: MagicaCurveParameter
        stiffness: number
    }
    motionConstraint: {
        useMaxDistance: number
        maxDistance: MagicaCurveParameter
        useBackstop: number
        backstopRadius: number
        backstopDistance: MagicaCurveParameter
        stiffness: number
    }
    colliderCollisionConstraint: {
        mode: 0 | 1 | 2
        friction: number
        colliderList: readonly Readonly<{ m_FileID: number; m_PathID: string }>[]
        collisionBones: readonly Readonly<{ m_FileID: number; m_PathID: string }>[]
        limitDistance: MagicaCurveParameter
    }
    selfCollisionConstraint: {
        selfMode: 0 | 2
        surfaceThickness: MagicaCurveParameter
        syncMode: number
        syncPartner: Readonly<{ m_FileID: number; m_PathID: string }>
        clothMass: number
    }
    wind: {
        influence: number
        frequency: number
        turbulence: number
        blend: number
        synchronization: number
        depthWeight: number
        movingWind: number
    }
    springConstraint: {
        useSpring: number
        springPower: number
        limitDistance: number
        normalLimitRatio: number
        springNoise: number
    }
}

export interface CharacterPhysicsClothProduct {
    stableKey: string
    componentPathID: string
    binding: UnityTransformBinding
    /** Stable keys for component Transform and official ancestors, leaf to root. */
    centerTransformBindingStableKeys: readonly string[]
    /**
     * Exact official Transforms whose world pose equals the component center.
     * Every bridge key is an authored identity local TRS; this permits older
     * FBX products to omit empty center nodes without choosing an animated bone.
     */
    centerTransformCandidates: readonly Readonly<{
        bindingStableKey: string
        identityBridgeStableKeys: readonly string[]
        exactExportRelativePath: string | null
    }>[]
    activation: CharacterPhysicsComponentActivation
    runtimeBinding: Readonly<{
        status: 'runtime-ready' | 'inactive' | 'fail-closed'
        failClosedReasons: readonly string[]
    }>
    rootBoneBindings: readonly UnityTransformBinding[]
    chainBindings: readonly UnityTransformBinding[]
    collisionBoneBindings: readonly UnityTransformBinding[]
    colliderReferences: readonly Readonly<{
        stableKey: string | null
        componentPathID: string
        resolved: boolean
        nullReference?: boolean
        script: string | null
        binding: UnityTransformBinding | null
    }>[]
    serializeData: MagicaClothSerializeData
    serializeData2: Readonly<{
        selectionData?: Readonly<{
            positions?: readonly PhysicsVector3[]
            attributes?: readonly Readonly<{ Value: number }>[]
            maxConnectionDistance?: number
            userEdit?: number
        }>
    }>
    runtimeProperties: Readonly<Record<string, number>>
}

export interface CharacterPhysicsColliderProduct {
    script: 'MagicaCapsuleCollider' | 'MagicaSphereCollider' | 'MagicaPlaneCollider'
    stableKey: string
    componentPathID: string
    binding: UnityTransformBinding
    activation: CharacterPhysicsComponentActivation
    settings: Readonly<Record<string, unknown>>
}

export interface CharacterPhysicsWindZoneProduct {
    script: 'MagicaWindZone'
    stableKey: string
    componentPathID: string
    binding: UnityTransformBinding
    activation: CharacterPhysicsComponentActivation
    scope: CharacterPhysicsComponentScope
    settings: Readonly<{
        m_Enabled: number
        mode: 0 | 1 | 2 | 3
        size: PhysicsVector3
        radius: number
        main: number
        turbulence: number
        directionAngleX: number
        directionAngleY: number
        attenuation: UnityAnimationCurve
        isAddition: number
    }>
}

export interface CharacterPhysicsNativeProduct {
    type: string
    stableKey: string
    componentPathID: string
    binding: UnityTransformBinding
    activation: CharacterPhysicsComponentActivation
    scope: CharacterPhysicsComponentScope
    serialized: Readonly<Record<string, unknown>>
    mesh?: Readonly<{
        stableKey: string
        meshPathID: string
        name: string
        vertices: readonly (readonly [number, number, number])[]
        indices: readonly number[]
    }>
}

export interface CharacterPhysicsProfile {
    schema: 'magius.character-physics-profile.v1'
    stableKey: string
    identity: Readonly<{
        style3dCharacterMstId: number
        characterResourceId: number
        resourceName: string
        displayName: string | null
    }>
    source: Readonly<{
        sourceStableKey: string
        logicalKey: string
        unityVersion: string
    }>
    runtime: Readonly<{
        status: 'runtime-ready' | 'fail-closed'
        failClosedReasons: readonly string[]
        bindingPolicy: Readonly<{
            identity: string
            nameFallback: false
            missingBinding: 'fail-closed-component'
            writerPolicy: 'single-post-animation-physics-writer'
            actionOwnedBonePolicy: 'animation-pose-is-read-only-input'
        }>
        fixedStepSeconds: number
        maximumCatchUpSteps: number
    }>
    counts: Readonly<Record<string, number>>
    components: Readonly<{
        cloth: readonly CharacterPhysicsClothProduct[]
        colliders: readonly CharacterPhysicsColliderProduct[]
        windZones: readonly CharacterPhysicsWindZoneProduct[]
        otherMagica: readonly unknown[]
        native: readonly CharacterPhysicsNativeProduct[]
    }>
    physicsTransformBindings: readonly UnityTransformBinding[]
}

export interface CharacterPhysicsCatalogEntry {
    stableKey: string
    style3dCharacterMstId: number
    characterResourceId: number
    resourceName: string
    displayName: string | null
    sourceStableKey: string
    productUrl: string
    runtimeStatus: 'runtime-ready' | 'fail-closed'
    failClosedReasons: readonly string[]
    counts: Readonly<Record<string, number>>
}

export interface CharacterPhysicsCatalog {
    schema: 'magius.character-physics-catalog.v1'
    lookupKey: 'style3dCharacterMstId|characterResourceId'
    bindingIdentity: string
    counts: Readonly<Record<string, number>>
    mechanismCounts: Readonly<Record<string, Readonly<Record<string, number>>>>
    runtimeMechanismCounts: Readonly<Record<string, Readonly<Record<string, number>>>>
    entries: readonly CharacterPhysicsCatalogEntry[]
}

export interface CharacterPhysicsDiagnostics {
    profileStableKey: string
    status: 'ready' | 'disabled' | 'fail-closed' | 'disposed'
    active: boolean
    clothTeams: number
    boneSpringTeams: number
    particles: number
    writableBones: number
    bodyColliders: number
    magicaColliders: number
    windZones: number
    missingBindings: readonly string[]
    duplicateBindings: readonly string[]
    resetCount: number
    simulationSteps: number
    colliderContacts: number
    selfContacts: number
    speedClamps: number
    angleClamps: number
    teleportResets: number
    nonFiniteCorrections: number
}
