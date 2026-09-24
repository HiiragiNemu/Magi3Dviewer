import { ObjectMovementSelection, pickMovementTarget, type MovementTarget } from './objectMovementSelection'
import { setupWeaponPanel } from './weaponPanel'
import { setupFloatingPanelDrag } from './floatingPanelInteraction'
import { getNonBattleExpressionRuntime } from '../../magia-exedra-character-three/nonBattleExpressionRuntime.ts'
import { createLoadingProgressPanel } from './loadingProgressPanel'
import { createViewportFraming } from './performanceEditor/viewportFraming'
import { mountPerformanceWorkspace } from './performanceEditor/workspace'
import { createJointNodeLayer, beginJointPointerDrag, beginExistingJointGizmoPointerDrag } from './performanceEditor/jointNodes'
import * as THREE from 'three'
import Stats from 'three/addons/libs/stats.module.js';
import { scene } from './scene';
import { type SceneCharacter } from 'magia-exedra-character-three/scene'
import { initSelector } from './controls'
import { characters } from './character';
import { guiOptions, restoreThemePreference, setupBackgroundImageSelector, updateCharacterController, updateCharacterOutline } from './controllers';
import { TransformControls, type TransformControlsMode } from 'three/examples/jsm/Addons.js';
import { presetImport } from './controllers/presets';
import { setupCameraModeButtons } from './camera'
import { setupCombatVfxPanel } from './combatVfxPanel'
import {
    setupCharacterPhysicsActionOptionsUi,
    type CharacterPhysicsActionOptionsUiController,
} from './characterPhysicsActionOptionsUi'
import { setupEnemyPanel, type EnemyPanelController } from './enemyPanel'
import { formatCharacterTrilingualName } from './localization/characterNames'
import { translateBoneChannelLabel, translateMorphChannelLabel, translateUiText } from './localization/zhCN'
import { setupRuntimeSelectionPanels } from './runtimeSelectionPanels'
import { setupVoicePanel, type VoicePanelController, type VoicePanelWorkspaceCharacter } from './voicePanel'
import { createViewerVoiceWorkspaceRuntime } from './voiceWorkspaceRuntime'
import { mountPerformanceEditor, type ActorDescriptor, type ChannelSelection, type DragRequest } from './performanceEditor'
import { fetchVoiceCatalogManifest, VoiceCatalog } from './voice/catalog'
import { getViewerCharacterPhysicsAttachment } from './characterPhysics'
import type { VoicePoseAvailability, VoicePoseChannelLease } from './voice/poseChannels'
import {
    STAGE_SHADOW_QUALITY_CHANGE_EVENT,
    getStageShadowQuality,
    getStageShadowQualityState,
    setStageShadowQuality,
    type StageShadowQuality,
} from './stages'
import {
    attachViewerLocomotion,
    detachViewerLocomotion,
    selectViewerLocomotion,
    setViewerLocomotionEnabled,
    setupViewerLocomotion,
    teleportViewerCharacter,
    createViewerPerformanceHost,
} from './viewerLocomotion'
import {
    characterUiControlState,
    createPrimaryCharacterCatalog,
    resolvePrimaryCharacterSelection,
    searchPrimaryCharacterCatalog,
    type PrimaryCharacterCatalogEntry,
} from './uiCharacterCatalog'

const characterSelector = document.getElementById('character-selector') as HTMLSelectElement
const characterAddCrossBtn = document.getElementById('character-add-cross-btn') as HTMLButtonElement
const characterAddSelector = document.getElementById('character-add-selector') as HTMLSelectElement
const characterSearchInput = document.getElementById('character-search-input') as HTMLInputElement
const characterSearchResults = document.getElementById('character-search-results') as HTMLElement
const locomotionModeToggle = document.getElementById('locomotion-mode-toggle') as HTMLButtonElement
const combatVfxPanelToggle = document.getElementById('combat-vfx-panel-toggle') as HTMLButtonElement
const combatVfxPanel = document.getElementById('combat-vfx-panel') as HTMLElement
const characterPhysicsActionOptions = document.getElementById('character-physics-action-options') as HTMLElement
const animationSelector = document.getElementById('animation-selector') as HTMLSelectElement
const animationPlayBtn = document.getElementById('animation-play') as HTMLButtonElement
const animationPauseBtn = document.getElementById('animation-pause') as HTMLButtonElement
const animationSlider = document.getElementById('animation-slider') as HTMLInputElement
const animationRepetitions = document.getElementById('animation-repetitions') as HTMLInputElement
const animationProgressValue = document.getElementById('animation-progress-value') as HTMLOutputElement
const animationActionStatus = document.getElementById('animation-action-status') as HTMLOutputElement
const animationSpeed = document.getElementById('animation-speed') as HTMLInputElement
const animationSpeedValue = document.getElementById('animation-speed-value') as HTMLOutputElement
const actionPanelToggle = document.getElementById('action-panel-toggle') as HTMLButtonElement
const actionPanel = document.getElementById('action-parameter-panel') as HTMLElement
const actionPanelClose = document.getElementById('action-panel-close') as HTMLButtonElement
const actionDirectEditToggle = document.getElementById('action-direct-edit-toggle') as HTMLButtonElement
const actionDirectTranslate = document.getElementById('action-direct-translate') as HTMLButtonElement
const actionDirectRotate = document.getElementById('action-direct-rotate') as HTMLButtonElement
const actionDirectEditTarget = document.getElementById('action-direct-edit-target') as HTMLOutputElement
const actionSelectedPart = document.getElementById('action-selected-part') as HTMLOutputElement
const actionSelectedPartVisibility = document.getElementById('action-selected-part-visibility') as HTMLButtonElement
const actionShowAllParts = document.getElementById('action-show-all-parts') as HTMLButtonElement
const actionModelPartSearch = document.getElementById('action-model-part-search') as HTMLInputElement
const actionModelPartList = document.getElementById('action-model-part-list') as HTMLElement
const actionChannelSearch = document.getElementById('action-channel-search') as HTMLInputElement
const actionChannelList = document.getElementById('action-channel-list') as HTMLElement
const actionParametersReset = document.getElementById('action-parameters-reset') as HTMLButtonElement
const expressionSelector = document.getElementById('expression-selector') as HTMLSelectElement
const expressionAutoBlink = document.getElementById('expression-auto-blink') as HTMLInputElement
const expressionManualBlink = document.getElementById('expression-manual-blink') as HTMLInputElement
const expressionManualBlinkValue = document.getElementById('expression-manual-blink-value') as HTMLOutputElement
const expressionStrength = document.getElementById('expression-strength') as HTMLInputElement
const expressionStrengthValue = document.getElementById('expression-strength-value') as HTMLOutputElement
const expressionTransition = document.getElementById('expression-transition') as HTMLInputElement
const expressionTransitionValue = document.getElementById('expression-transition-value') as HTMLOutputElement
const expressionMouthCorner = document.getElementById('expression-mouth-corner') as HTMLInputElement
const expressionMouthCornerValue = document.getElementById('expression-mouth-corner-value') as HTMLOutputElement
const expressionPanelToggle = document.getElementById('expression-panel-toggle') as HTMLButtonElement
const expressionPanel = document.getElementById('expression-parameter-panel') as HTMLElement
const expressionPanelClose = document.getElementById('expression-panel-close') as HTMLButtonElement
const expressionChannelSearch = document.getElementById('expression-channel-search') as HTMLInputElement
const expressionChannelList = document.getElementById('expression-channel-list') as HTMLElement
const expressionParametersReset = document.getElementById('expression-parameters-reset') as HTMLButtonElement
const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement
const menuCollapseToggle = document.getElementById('menu-collapse-toggle') as HTMLButtonElement
const renderSettingsToggle = document.getElementById('render-settings-toggle') as HTMLButtonElement
const advancedControlsDock = document.getElementById('advanced-controls-dock') as HTMLElement
const renderSettingsClose = document.getElementById('render-settings-close') as HTMLButtonElement
const stageShadowQualitySelect = document.getElementById('stage-shadow-quality') as HTMLSelectElement
const positionControlsToggle = document.getElementById('position-controls-toggle') as HTMLButtonElement
const captureControlsToggle = document.getElementById('capture-controls-toggle') as HTMLButtonElement
const positionControlsWrapper = document.getElementById('position-controls-wrapper') as HTMLElement
const characterMoveUpBtn = document.getElementById('character-move-up') as HTMLButtonElement
const characterMoveDownBtn = document.getElementById('character-move-down') as HTMLButtonElement
const characterMoveLeftBtn = document.getElementById('character-move-left') as HTMLButtonElement
const characterMoveRightBtn = document.getElementById('character-move-right') as HTMLButtonElement
const characterTiltLeftBtn = document.getElementById('character-tilt-left') as HTMLButtonElement
const characterTiltRightBtn = document.getElementById('character-tilt-right') as HTMLButtonElement
const characterRotateLeftBtn = document.getElementById('character-rotate-left') as HTMLButtonElement
const characterRotateRightBtn = document.getElementById('character-rotate-right') as HTMLButtonElement
const characterTransformResetBtn = document.getElementById('character-transform-reset') as HTMLButtonElement

const officialDefaultFaceState = '__official_default_face_state__'
const movementSelection = new ObjectMovementSelection(object => !!performanceExternalLeases.get(object)?.channels.root)
let weaponPanelController: ReturnType<typeof setupWeaponPanel> | undefined
function selectMovementTarget(target: MovementTarget) {
    if (movementSelection.current?.object !== target.object) closeObjectTransform()
    movementSelection.select(target)
    updateMovementTargetLabel()
}
function updateMovementTargetLabel() {
    for (const id of ['character-move-up', 'character-move-down', 'character-move-left', 'character-move-right', 'character-tilt-left', 'character-tilt-right', 'character-rotate-left', 'character-rotate-right', 'character-transform-reset', 'object-move-forward', 'object-move-backward']) {
        const button = document.getElementById(id) as HTMLButtonElement | null
        if (button) button.disabled = !movementSelection.current
    }
    const output = document.getElementById('movement-target')
    if (output) output.textContent = movementSelection.current
        ? translateUiText('Selected object') + ': ' + movementSelection.current.label
        : translateUiText('Click an object to move it')
}
function forgetMovementTarget(object?: THREE.Object3D) {
    if (!object) return
    movementSelection.forget(object)
    updateMovementTargetLabel()
}
const characterMoveStep = 0.05
const characterRotateStep = THREE.MathUtils.degToRad(5)

type CharacterActionsApi = Window['magiusViewerLocomotion']['characterActions']
type CharacterActionCatalogSnapshot = ReturnType<CharacterActionsApi['catalog']>
type CharacterActionCatalogEntry = CharacterActionCatalogSnapshot['entries'][number]
type CharacterActionPlaybackState = ReturnType<CharacterActionsApi['state']>
type CharacterActionPlaybackRateState = CharacterActionPlaybackState & { playbackRate?: number }
type CharacterActionsPlaybackRateApi = CharacterActionsApi & {
    setPlaybackRate?: (playbackRate: number) => CharacterActionPlaybackRateState
}

const baseAnimationNamesByCharacter = new WeakMap<THREE.Object3D, readonly string[]>()
let characterActionCatalogSnapshot: CharacterActionCatalogSnapshot | undefined
let characterActionPlaybackState: CharacterActionPlaybackState | undefined
let characterActionCatalogUnsubscribe: (() => void) | undefined
let characterActionStateUnsubscribe: (() => void) | undefined
let characterActionRefreshToken = 0
let characterActionOperationToken = 0
let characterActionPendingId: string | undefined
let animationSelectorCharacter: THREE.Object3D | undefined
let characterActionConsumerSetup = false
let voicePanelController: VoicePanelController | undefined
let enemyPanelController: EnemyPanelController | undefined
let characterPhysicsActionOptionsUi: CharacterPhysicsActionOptionsUiController | undefined

type PoseAxis = 'x' | 'y' | 'z'

interface ManualPoseEntry {
    bone: THREE.Bone
    offsets: THREE.Vector3
    positionOffsets: THREE.Vector3
    lastBase?: THREE.Quaternion
    lastApplied?: THREE.Quaternion
    lastBasePosition?: THREE.Vector3
    lastAppliedPosition?: THREE.Vector3
}

interface ManualMorphEntry {
    value: number
    baselineByMesh: Map<MorphTargetMesh, number>
}

type MorphTargetMesh = THREE.Mesh & {
    morphTargetDictionary: Record<string, number>
    morphTargetInfluences: number[]
}

const manualPoseByCharacter = new WeakMap<THREE.Object3D, Map<string, ManualPoseEntry>>()
const manualMorphsByCharacter = new WeakMap<THREE.Object3D, Map<string, ManualMorphEntry>>()
const modelPartsByCharacter = new WeakMap<THREE.Object3D, Map<string, ModelPartEntry>>()
const animationPlaybackRateByCharacter = new WeakMap<THREE.Object3D, number>()

interface DirectPoseSelection {
    object: THREE.Object3D
    entry: ManualPoseEntry
    base: THREE.Quaternion
    basePosition: THREE.Vector3
}

interface DirectPosePointerDrag {
    pointerId: number
    startX: number
    startY: number
    startOffsets: THREE.Vector3
    selection: DirectPoseSelection
}

interface ModelPartEntry {
    object: THREE.Mesh
    defaultVisible: boolean
    path: string
    label: string
}

type DirectPoseTransformMode = 'translate' | 'rotate'

let directPoseControls: TransformControls | undefined
let directPoseControlsHelper: THREE.Object3D | undefined
let directPoseSelection: DirectPoseSelection | undefined
let selectedModelPart: ModelPartEntry | undefined
let directPosePointerDrag: DirectPosePointerDrag | undefined
let directPoseEditingEnabled = false
// Direct bone editing is joint rotation only; actor translation belongs to root
// placement and end-effector movement belongs to the IK editor.
let directPoseTransformMode: DirectPoseTransformMode = 'rotate'
let directPoseGizmoDragging = false
let directPoseOrbitControlsWasEnabled = true
let directPoseOutlineSelection: THREE.Object3D[] = []
let singleCharacterTransformControls: TransformControls | undefined
let singleCharacterTransformControlsHelper: THREE.Object3D | undefined
let singleCharacterTransformActive = false
let singleCharacterTransformOrbitWasEnabled = true
let singleObjectTransformOnChange: (() => void) | undefined
let performanceEditorController: ReturnType<typeof mountPerformanceEditor> | undefined
let performanceHost: ReturnType<typeof createViewerPerformanceHost> | undefined
const performanceEditorTransitionSeconds = 0.18
const performanceActorListeners = new Set<() => void>()
const performanceExternalLeases = new Map<THREE.Object3D, {
    generation: number; channels: ChannelSelection
    bones: ReadonlySet<THREE.Object3D>
    morphs: readonly { mesh: THREE.Mesh; index: number; influences: number[] }[]
}>()
let performanceGizmoActive = false
let performanceGizmoControl: TransformControls | undefined
let performanceGizmoPointerDown: ((event: PointerEvent) => boolean) | undefined
let performanceJointPointer: PointerEvent | undefined
let disposePerformanceEditorUi: (() => void) | undefined

function notifyPerformanceActors() {
    for (const listener of performanceActorListeners) listener()
}

function listPerformanceActors(): ActorDescriptor[] {
    return scene.characters.flatMap(entry => {
        const character = entry.character
        if (!character || entry.loading || entry.removed || character.disposed) return []
        const generation = entry.loadGeneration ?? 0
        const resourceId = String(character.userData.characterId)
        return [{ object: character.object, generation,
            label: formatCharacterTrilingualName(resourceId, characters.getCharacterNameById(resourceId)),
            actions: character.animations,
            isCurrent: () => !entry.loading && !entry.removed && !character.disposed
                && entry.character === character && (entry.loadGeneration ?? 0) === generation
                && scene.characters.includes(entry),
        }]
    })
}

function resolvePerformanceNativeConflicts(actor: ActorDescriptor, bones: readonly THREE.Object3D[]) {
    const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason })
    if (!actor.isCurrent()) return unavailable('Stale performance actor generation')
    const attachment = getViewerCharacterPhysicsAttachment(actor.object)
    if (!attachment || attachment.status !== 'ready' || !attachment.runtime) {
        return unavailable(`Native attachment is ${attachment?.status ?? 'absent'}`)
    }
    if (attachment.root !== actor.object) return unavailable('Native attachment root mismatch')
    // Read current output ownership every call; a binding refresh invalidates a prior snapshot.
    const snapshot = attachment.runtime.getWritableChannelSnapshot()
    if (snapshot.status !== 'ready') return unavailable(`Native writable channels: ${snapshot.reason}`)
    if (snapshot.root !== actor.object) return unavailable('Native writable snapshot root mismatch')
    for (const bone of bones) {
        let parent: THREE.Object3D | null = bone
        while (parent && parent !== actor.object) parent = parent.parent
        if (!parent) return unavailable('Native query contains a foreign or detached bone')
    }
    const requested = new Set(bones)
    return { status: 'ready' as const, value: snapshot.outputs
        .filter(output => requested.has(output.object))
        .map(output => `${output.ownerStableKey}:${output.object.uuid}:${output.channels.join('/')}`) }
}

function acquirePerformanceExternalChannels(actor: ActorDescriptor, channels: ChannelSelection) {
    const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason })
    if (!actor.isCurrent()) return unavailable('Stale performance actor generation')
    if (performanceExternalLeases.has(actor.object)) return unavailable('External actor channels already leased')
    if (directPoseGizmoDragging || directPosePointerDrag || singleCharacterTransformControls?.dragging
        || scene.transformControls.dragging) return unavailable('Another transform drag is active')
    const adapter = performanceEditorController?.runtime.actors.get(actor.object.uuid)
    if (!adapter?.current || adapter.descriptor.object !== actor.object || adapter.descriptor.generation !== actor.generation) {
        return unavailable('Exact performance actor adapter absent')
    }
    const bones = channels.bones.map(key => adapter.bones.get(key))
    if (bones.some(bone => !bone)) return unavailable('Exact performance bone channel absent')
    const morphs: { mesh: THREE.Mesh; index: number; influences: number[] }[] = []
    const meshes = channels.morphs.length ? getMorphTargetMeshes(actor.object) : []
    for (const key of channels.morphs) {
        const morph = adapter.morphs.get(key)
        if (!morph) return unavailable('Exact performance morph channel absent')
        const matches = meshes.filter(mesh => mesh.morphTargetInfluences === morph.values)
        if (matches.length !== 1) return unavailable('Exact performance morph storage is absent or shared')
        morphs.push({ mesh: matches[0], index: morph.index, influences: morph.values })
    }
    // Existing nonzero legacy overrides retain their own exact channels. Do not
    // silently discard them or resume them later with a discontinuous jump.
    if ([...manualPoseByCharacter.get(actor.object)?.values() ?? []].some(entry => bones.includes(entry.bone)
        && (entry.offsets.lengthSq() > 0 || entry.positionOffsets.lengthSq() > 0))) {
        return unavailable('Existing manual pose override owns a requested channel')
    }
    if ([...manualMorphsByCharacter.get(actor.object)?.keys() ?? []].some(name => morphs.some(binding => binding.mesh.morphTargetDictionary?.[name] === binding.index))) {
        return unavailable('Existing manual expression override owns a requested channel')
    }
    // Until the matching provider release lands, absence is an explicit capability
    // failure. Ordinary release is not an evaluator-only handoff.
    let voice: (VoicePoseChannelLease & { beginMorphReturn?(): VoicePoseAvailability<void> }) | undefined
    if (bones.length || morphs.length || channels.action) {
        if (!voicePanelController?.acquirePoseChannels) return unavailable('Voice pose-channel yield provider pending')
        const result = voicePanelController.acquirePoseChannels({
            actor: { object: actor.object, uuid: actor.object.uuid, generation: actor.generation, isCurrent: actor.isCurrent },
            bones: bones as THREE.Object3D[], morphs, action: channels.action,
            releaseTransitionSeconds: performanceEditorTransitionSeconds,
        })
        if (result.status !== 'ready') return result
        voice = result.value
    }
    const previousRoot = scene.transformControls.object
    try {
        if (channels.root && previousRoot === actor.object) scene.transformControls.detach()
        if (singleCharacterTransformControls?.object === actor.object) clearSingleCharacterTransform()
    } catch (error) {
        voice?.release()
        if (previousRoot === actor.object && actor.isCurrent()) scene.transformControls.attach(actor.object)
        throw error
    }
    const lease = { generation: actor.generation, channels, bones: new Set(bones as THREE.Object3D[]), morphs }
    performanceExternalLeases.set(actor.object, lease)
    let released = false
    const active = () => !released && actor.isCurrent() && (!voice || voice.active)
        && performanceExternalLeases.get(actor.object) === lease
    return { status: 'ready' as const, value: {
        get active() { return active() },
        beginMorphReturn(): VoicePoseAvailability<void> {
            if (!active()) return unavailable('Stale external morph return authority')
            if (!morphs.length) return { status: 'ready', value: undefined }
            if (!voice?.beginMorphReturn) return unavailable('Voice evaluator-only morph return provider pending')
            // Keep the real lease and manual masks. The provider yields only its
            // producer writes; ACTION owns the single final return compositor.
            return voice.beginMorphReturn()
        },
        release() {
        if (released) return
        released = true
        try { voice?.release() } finally {
            if (performanceExternalLeases.get(actor.object) === lease) {
                performanceExternalLeases.delete(actor.object)
                if (previousRoot === actor.object && actor.isCurrent()
                    && scene.characterSelected?.character?.object === actor.object && !performanceGizmoActive) {
                    scene.transformControls.attach(actor.object)
                }
            }
        }
    } } }
}

function isPerformanceBoneLeased(bone: THREE.Object3D) {
    for (let parent: THREE.Object3D | null = bone; parent; parent = parent.parent) {
        if (performanceExternalLeases.get(parent)?.bones.has(bone)) return true
    }
    return false
}

function isPerformanceMorphLeased(mesh: THREE.Mesh, index: number) {
    for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) {
        if (performanceExternalLeases.get(parent)?.morphs.some(binding => binding.mesh === mesh && binding.index === index)) return true
    }
    return false
}

function acquirePerformanceGizmo(request: DragRequest) {
    const actor = performanceEditorController?.runtime.actors.get(request.actorKey)
    if (!actor?.current || !performanceExternalLeases.has(actor.descriptor.object)) {
        return { status: 'unavailable' as const, reason: 'Exact performance actor lease absent' }
    }
    if (performanceGizmoActive || directPoseGizmoDragging || directPosePointerDrag) {
        return { status: 'unavailable' as const, reason: 'Another pointer/gizmo owner is active' }
    }
    setDirectPoseEditing(false)
    clearSingleCharacterTransform()
    const previousRoot = scene.transformControls.object
    scene.transformControls.detach()
    const orbitEnabled = scene.controls.enabled
    const control = new TransformControls(scene.camera, scene.renderer.domElement)
    const helper = control.getHelper()
    // The IK proxy has world-space placement and must belong to the scene for a gizmo.
    const addedProxy = request.mode === 'ik' && !request.object.parent
    if (addedProxy) scene.scene.add(request.object)
    scene.scene.add(helper)
    control.mode = request.mode === 'joint' ? 'rotate' : 'translate'
    control.space = request.mode === 'joint' ? 'local' : 'world'
    control.attach(request.object)
    performanceGizmoActive = true
    performanceGizmoControl = control
    let releaseNodePointer: (() => void) | undefined
    control.addEventListener('dragging-changed', event => { scene.controls.enabled = event.value ? false : orbitEnabled })
    control.addEventListener('objectChange', () => {
        try { request.onChange(request.mode === 'ik' ? request.object.getWorldPosition(new THREE.Vector3()) : undefined) }
        catch (error) { release(); throw error }
    })
    control.addEventListener('mouseUp', () => { try { request.onEnd() } finally { release() } })
    let released = false
    const release = () => {
        if (released) return
        released = true
        releaseNodePointer?.()
        control.detach(); control.dispose(); helper.removeFromParent()
        if (performanceGizmoControl === control) { performanceGizmoControl = undefined; performanceGizmoPointerDown = undefined }
        if (addedProxy) request.object.removeFromParent()
        performanceGizmoActive = false
        scene.controls.enabled = orbitEnabled
        if (previousRoot && scene.characterSelected?.character?.object === previousRoot
            && !performanceExternalLeases.get(previousRoot)?.channels.root) scene.transformControls.attach(previousRoot)
    }
    performanceGizmoPointerDown = event => {
        if (released) return false
        // Claim a real current-axis hit in the node layer's capture phase, before Orbit.
        const pointerRelease = beginExistingJointGizmoPointerDrag(control, scene.renderer.domElement, event)
        if (!pointerRelease) return false
        releaseNodePointer = pointerRelease
        return true
    }
    if (performanceJointPointer && request.mode !== 'root') {
        try { releaseNodePointer = beginJointPointerDrag(control, scene.renderer.domElement, performanceJointPointer, request.mode) }
        catch (error) { release(); return { status: 'unavailable' as const, reason: error instanceof Error ? error.message : String(error) } }
    }
    return { status: 'ready' as const, value: release }
}

function setupPerformanceEditor() {
    if (performanceEditorController) return
    const menu = document.getElementById('menu-controls')
    if (!menu) throw new Error('Performance editor mount container absent')
    const workspace = document.getElementById('workspace')
    if (!workspace) throw new Error('Performance editor workspace absent')
    const toggle = document.createElement('button')
    toggle.type = 'button'; toggle.textContent = 'Performance'
    toggle.id = 'performance-editor-toggle'; toggle.setAttribute('aria-controls', 'performance-editor-panel')
    toggle.setAttribute('aria-expanded', 'false')
    const panel = document.createElement('aside')
    panel.id = 'performance-editor-panel'; panel.hidden = true
    // The hidden mount owns editor lifecycle; regions are placed around #viewer.
    menu.append(toggle); workspace.append(panel)
    let layout: ReturnType<typeof mountPerformanceWorkspace> | undefined
    let jointNodes: ReturnType<typeof createJointNodeLayer> | undefined
    let framing: ReturnType<typeof createViewportFraming> | undefined
    const host = createViewerPerformanceHost({
        acquireExternalChannels: acquirePerformanceExternalChannels,
        nativePhysicsConflicts: resolvePerformanceNativeConflicts,
    })
    performanceHost = host
    let pending = false, disposed = false
    const changed = () => {
        if (pending || disposed) return
        pending = true
        queueMicrotask(() => { pending = false; if (!disposed) notifyPerformanceActors() })
    }
    scene.scene.addEventListener('childadded', changed); scene.scene.addEventListener('childremoved', changed)
    try {
        performanceEditorController = mountPerformanceEditor(panel, {
            actorSource: { list: listPerformanceActors, subscribe(listener) { performanceActorListeners.add(listener); return () => { performanceActorListeners.delete(listener) } } },
            channelHost: host.channelHost, framePort: host.framePort,
            transformHost: { acquire: acquirePerformanceGizmo },
            transitionSeconds: performanceEditorTransitionSeconds,
        })
        const editor = performanceEditorController
        jointNodes = createJointNodeLayer({ scene: scene.scene, camera: scene.camera, canvas: scene.renderer.domElement, runtime: editor.runtime,
            selection: editor.panel.getPoseSelection, subscribeSelection: editor.panel.subscribePoseSelection,
            subscribeFrame: listener => host.framePort.subscribeFinalPoseBeforeCamera(listener),
            interactionBlocked: event => !!(directPoseGizmoDragging || directPosePointerDrag || scene.transformControls.dragging
                || performanceGizmoControl?.dragging || performanceGizmoPointerDown?.(event)),
            select: (identity, pointer) => { performanceJointPointer = pointer
                try { return editor.panel.selectJointFromCanvas(identity) } finally { performanceJointPointer = undefined } },
            showCandidates: editor.panel.showJointCandidates, clearCandidates: editor.panel.clearJointCandidates, report: editor.panel.reportJointError,
        })
        framing = createViewportFraming({ camera: scene.camera, controls: scene.controls, canvas: scene.renderer.domElement,
            selectedActor: () => {
                const selection = editor.panel.getPoseSelection()
                const actor = selection && editor.runtime.actors.get(selection.actorKey)
                return actor?.current && actor.descriptor.generation === selection!.generation ? actor.descriptor.object : undefined
            }, report: editor.panel.reportJointError,
            schedule: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id),
        })
        layout = mountPerformanceWorkspace({
            workspace, panel: performanceEditorController.panel, toggle,
            onExit: () => performanceEditorController?.runtime.stop(),
            onOpenChange: open => { framing?.setEnabled(open); jointNodes?.setEnabled(open) },
            onFrameActor: () => framing?.frame(),
        })
        // Load the official voice manifest independently of the voice popup so
        // timeline projects can drive several actors without stealing its player.
        void fetchVoiceCatalogManifest().then(manifest => {
            performanceEditorController?.audio.setCatalog(new VoiceCatalog(manifest))
        }).catch(() => {
            // The dock remains usable for pose/action-only projects; the audio
            // lane reports the per-track catalog error when tracks are present.
        })
    } catch (error) {
        disposed = true; scene.scene.removeEventListener('childadded', changed); scene.scene.removeEventListener('childremoved', changed)
        layout?.dispose(); framing?.dispose(); jointNodes?.dispose(); performanceEditorController?.dispose(); performanceEditorController = undefined
        host.dispose(); performanceHost = undefined; panel.remove(); toggle.remove(); throw error
    }
    disposePerformanceEditorUi = () => {
        if (disposed) return
        disposed = true
        scene.scene.removeEventListener('childadded', changed); scene.scene.removeEventListener('childremoved', changed)
        layout?.dispose()
        framing?.dispose()
        jointNodes?.dispose()
        performanceEditorController?.dispose(); performanceEditorController = undefined
        host.dispose(); performanceHost = undefined; performanceActorListeners.clear(); performanceExternalLeases.clear()
        panel.remove(); toggle.remove()
    }
}

const loadingProgressPanel = createLoadingProgressPanel(document)

document.addEventListener('magius:localechange', () => {
    renderCharacterActionStatus()
})

const perfStatJsContainer = document.getElementById('perf-stat-js') as HTMLDivElement

characterAddCrossBtn.onclick = removeSelectedCharacter
document.getElementById('animation-apply')!.onclick = playSelectedAnimation
animationPlayBtn.onclick = resumeCurrentAnimation
animationPauseBtn.onclick = pauseSelectedAnimation
animationSlider.oninput = seekSelectedAnimation
animationSpeed.oninput = () => {
    setSelectedAnimationPlaybackRate(parseFloat(animationSpeed.value), true)
}
expressionAutoBlink.onchange = () => {
    const expression = scene.characterSelected?.character?.expression
    if (!expression) return
    expression.setAutomaticBlink(expressionAutoBlink.checked)
    syncExpressionControls()
}
expressionManualBlink.oninput = () => {
    const expression = scene.characterSelected?.character?.expression
    if (!expression) return
    expression.setManualBlinkWeight(parseFloat(expressionManualBlink.value))
    syncExpressionControls()
}
expressionStrength.oninput = () => {
    const expression = scene.characterSelected?.character?.expression
    if (!expression) return
    expression.setExpressionWeight(parseFloat(expressionStrength.value))
    syncExpressionControls()
}
expressionTransition.oninput = () => {
    const expression = scene.characterSelected?.character?.expression
    if (!expression) return
    expression.setExpressionTransitionSeconds(parseFloat(expressionTransition.value))
    syncExpressionControls()
}
expressionMouthCorner.oninput = () => {
    const expression = scene.characterSelected?.character?.expression
    if (!expression) return
    expression.setMouthCornerWeight(parseFloat(expressionMouthCorner.value))
    syncExpressionControls()
}
fullscreenBtn.onclick = () => document.documentElement.requestFullscreen().then(() => (screen.orientation as any).lock('landscape').catch(() => undefined))

const transformCloseBtn = document.getElementById('transform-close') as HTMLButtonElement
transformCloseBtn.onclick = closeObjectTransform
const transformTranslateBtn = document.getElementById('transform-set-translate') as HTMLButtonElement
const transformRotateBtn = document.getElementById('transform-set-rotate') as HTMLButtonElement
transformTranslateBtn.onclick = () => setTransformMode('translate')
transformRotateBtn.onclick = () => setTransformMode('rotate')

const primaryCharacterCatalog = createPrimaryCharacterCatalog(
    characters.getCharacterIdList(),
    characters.getNonBattleCharacterCatalog(),
    id => formatCharacterTrilingualName(id, characters.getCharacterNameById(id)),
)
const primaryCharacterById = new Map(primaryCharacterCatalog.map(entry => [entry.id, entry]))
const characterIdList = primaryCharacterCatalog.map(entry => entry.id)
const characterSelectDict = primaryCharacterCatalog.reduce((obj, entry) => {
    obj[`${entry.id} - ${entry.name}`] = entry.id
    return obj
}, {} as Record<string, string>)
console.log(Object.keys(characterSelectDict).join('\n'))

const stats = new Stats()

export function setupViewer() {
    const weaponPanel = weaponPanelController = setupWeaponPanel({
        files: characters.files,
        characters: primaryCharacterCatalog.filter(entry => /^\d{6}$/.test(entry.id)),
        scene: scene.scene,
        initialPosition: () => (scene.characterSelected?.character?.object.getWorldPosition(new THREE.Vector3())
            ?? scene.controls.target.clone()).add(new THREE.Vector3(1, 1, 0)),
        currentCharacterId: () => String(scene.characterSelected?.character?.userData.characterId ?? ''),
        select: (object, label, refresh) => selectMovementTarget({ object, label, changed: refresh }),
        transform: (object, mode, refresh) => {
            if (!singleCharacterTransformActive || singleCharacterTransformControls?.object !== object) activateObjectTransform(object, refresh)
            setTransformMode(mode)
        },
        detach: object => { if (singleCharacterTransformControls?.object === object) clearSingleCharacterTransform(); forgetMovementTarget(object) },
        closeTransform: closeObjectTransform,
    })
    window.addEventListener('pagehide', () => weaponPanel.dispose(), { once: true })
    setupMenuCollapseToggle()
    setupDockControls()
    enemyPanelController = setupEnemyPanel({
        onInstanceSelected: instance => selectMovementTarget({ object: instance.object, label: `${instance.entry.enemyMstId} · ${instance.instanceId}`, changed: () => enemyPanelController?.refreshInstances() }),
        onInstanceWillRemove: instance => {
            forgetMovementTarget(instance.object)
            if (singleCharacterTransformControls?.object === instance.object) {
                clearSingleCharacterTransform()
            }
        },
    })
    setupStageShadowQualityControl()
    setupParameterControls()
    setupDirectPoseEditing()
    setupCharacterMovementControls()
    setupViewerLocomotion()
    setupCharacterActionConsumer()
    characterPhysicsActionOptionsUi = setupCharacterPhysicsActionOptionsUi({
        currentCharacterResourceId: () => {
            const characterId = Number(scene.characterSelected?.character?.userData.characterId)
            return Number.isFinite(characterId) ? characterId : null
        },
        currentActionStatus: () => characterActionsApi().state().status,
        physicsPhaseState: () => characterActionsApi().physicsPhaseState(),
        activatePhase: stableKey => characterActionsApi().activatePhysicsPhase(stableKey),
        resolveAction: resolveCharacterPhysicsRelatedAction,
        playAction: playCharacterPhysicsRelatedAction,
    })
    restoreThemePreference()
    initSelector(
        characterSelector,
        characterSelectDict,
        changeCharacterFromSelector
    );
    annotateCharacterSelectorOptions(characterSelector)
    syncCharacterUiCapabilityGates(null)

    setupCharacterSearch()
    setupCharacterAddSelector()
    setupRuntimeSelectionPanels()
    setupCombatVfxPanel()
    voicePanelController = setupVoicePanel({
        workspaceRuntime: createViewerVoiceWorkspaceRuntime(),
    })
    syncVoiceCharacter()
    setupViewerInputHandler()
    setupPerformanceEditor()
    setupBackgroundImageSelector()
    setupCameraModeButtons()

    scene.animateLoopCallback = animateLoop

    window.addEventListener('pagehide', () => {
        disposePerformanceEditorUi?.()
        characterPhysicsActionOptionsUi?.dispose()
        characterPhysicsActionOptionsUi = undefined
        void voicePanelController?.dispose()
    }, { once: true })

    scene.transformControls.addEventListener('change', () => {
        if (scene.characterSelected?.character) {
            updateCharacterController(scene.characterSelected?.character)
        }
    })

    tryChangeCharacterByHash()

    stats.dom.style.removeProperty('top')
    stats.dom.style.removeProperty('left')
    stats.dom.style.removeProperty('position')
    stats.dom.style.removeProperty('z-index')
    perfStatJsContainer.appendChild(stats.dom)
}

function characterActionsApi(): CharacterActionsApi {
    return window.magiusViewerLocomotion.characterActions
}

function characterActionsPlaybackRateApi(): CharacterActionsPlaybackRateApi {
    return characterActionsApi() as CharacterActionsPlaybackRateApi
}

function clampAnimationPlaybackRate(value: number) {
    return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 1, 0, 2)
}

function renderAnimationPlaybackRate(playbackRate: number) {
    const value = clampAnimationPlaybackRate(playbackRate)
    animationSpeed.value = value.toFixed(2)
    animationSpeedValue.value = `${value.toFixed(2)}×`
    animationSpeedValue.textContent = animationSpeedValue.value
}

function selectedAnimationPlaybackRate() {
    const character = scene.characterSelected?.character
    if (!character) return 1
    const stored = animationPlaybackRateByCharacter.get(character.object)
    if (stored != undefined) return stored
    const runtimeRate = (characterActionsPlaybackRateApi().state() as CharacterActionPlaybackRateState).playbackRate
    const initial = clampAnimationPlaybackRate(
        Number.isFinite(runtimeRate) ? Number(runtimeRate) : character.animation.mixer.timeScale,
    )
    animationPlaybackRateByCharacter.set(character.object, initial)
    return initial
}

function setSelectedAnimationPlaybackRate(value: number, notifyActionRuntime: boolean) {
    const character = scene.characterSelected?.character
    if (!character) return
    const playbackRate = clampAnimationPlaybackRate(value)
    animationPlaybackRateByCharacter.set(character.object, playbackRate)
    character.animation.mixer.timeScale = playbackRate
    if (notifyActionRuntime && selectedCharacterActionOption()) {
        const api = characterActionsPlaybackRateApi()
        if (api.setPlaybackRate) {
            setCharacterActionPlaybackState(api.setPlaybackRate(playbackRate))
        }
    }
    renderAnimationPlaybackRate(playbackRate)
}

function applySelectedAnimationPlaybackRate() {
    const animation = scene.characterSelected?.character?.animation
    if (!animation) return
    const playbackRate = selectedAnimationPlaybackRate()
    if (Math.abs(animation.mixer.timeScale - playbackRate) > 1e-6) {
        animation.mixer.timeScale = playbackRate
    }
}

function selectedCharacterActionOption(): HTMLOptionElement | undefined {
    const option = animationSelector.selectedOptions[0]
    return option?.dataset.characterAction === 'true' ? option : undefined
}

function selectedCharacterCatalogEntries(): readonly CharacterActionCatalogEntry[] {
    const characterId = Number(scene.characterSelected?.character?.userData.characterId)
    if (!Number.isFinite(characterId)) return []
    if (characterActionCatalogSnapshot?.selectedCharacterId !== characterId) return []
    return characterActionCatalogSnapshot.entries
}

function resolveCharacterPhysicsRelatedAction(actionId: string) {
    const entry = selectedCharacterCatalogEntries().find(candidate => candidate.id === actionId)
    if (entry) {
        const availability = entry.consumerAvailability
        return {
            playable: availability.currentCharacter && availability.playable,
            status: availability.status,
            reason: availability.reason,
        }
    }
    const loadStatus = characterActionCatalogSnapshot?.loadStatus ?? 'not-requested'
    return {
        playable: false,
        status: loadStatus,
        reason: loadStatus === 'error'
            ? characterActionCatalogSnapshot?.error || 'character-action-catalog-error'
            : undefined,
    }
}

async function playCharacterPhysicsRelatedAction(actionId: string) {
    await refreshCharacterActionCatalog()
    const option = [...animationSelector.options].find(candidate => (
        candidate.dataset.characterAction === 'true' && candidate.value === actionId
    ))
    if (!option) throw new Error(`character-action-not-listed:${actionId}`)
    if (option.disabled || option.dataset.playable !== 'true') {
        throw new Error(
            option.dataset.unavailableReason
            || option.dataset.availabilityStatus
            || `character-action-unavailable:${actionId}`,
        )
    }
    animationSelector.value = actionId
    await onAnimationSelectionChanged()
    await playSelectedAnimation()
}

function showCharacterActionStatus(text: string, status = '') {
    if (!text) {
        animationActionStatus.hidden = true
        animationActionStatus.value = ''
        animationActionStatus.textContent = ''
        delete animationActionStatus.dataset.status
        animationActionStatus.removeAttribute('title')
        return
    }
    animationActionStatus.hidden = false
    animationActionStatus.value = text
    animationActionStatus.textContent = text
    animationActionStatus.title = text
    if (status) animationActionStatus.dataset.status = status
    else delete animationActionStatus.dataset.status
}

function renderCharacterActionStatus() {
    if (!scene.characterSelected?.character) {
        showCharacterActionStatus('')
        return
    }

    // Legacy/model-owned clips use the same selector as the official resource
    // catalog, but their playback state is owned by the character runtime.  Do
    // not report an unrelated official-catalog failure while one is selected.
    const selectedLegacyOption = animationSelector.selectedOptions[0]
    if (
        selectedLegacyOption?.dataset.animationSource === 'legacy'
        && selectedLegacyOption.value
    ) {
        showCharacterActionStatus('')
        return
    }

    const snapshot = characterActionCatalogSnapshot
    if (!snapshot || snapshot.loadStatus === 'not-requested' || snapshot.loadStatus === 'loading') {
        showCharacterActionStatus(translateUiText('Loading official character actions...'), 'loading')
        return
    }
    if (snapshot.loadStatus === 'error') {
        const prefix = translateUiText('Official character actions could not be loaded')
        showCharacterActionStatus(snapshot.error ? `${prefix}: ${snapshot.error}` : prefix, 'error')
        return
    }

    const entries = selectedCharacterCatalogEntries()
    if (entries.length === 0) {
        showCharacterActionStatus(translateUiText('No official character actions for this character'), 'unavailable')
        return
    }

    const selectedOption = selectedCharacterActionOption()
    if (selectedOption && characterActionPendingId === selectedOption.value) {
        showCharacterActionStatus(translateUiText('Loading official character action...'), 'loading')
        return
    }

    const state = characterActionPlaybackState
    if (selectedOption && state?.actionId === selectedOption.value) {
        const label = selectedOption.dataset.actionLabel || selectedOption.textContent || selectedOption.value
        const statusLabels: Partial<Record<CharacterActionPlaybackState['status'], string>> = {
            interrupted: 'Official character action interrupted',
            unavailable: 'Official character action unavailable',
        }
        const canonical = statusLabels[state.status]
        if (canonical) {
            const reason = state.reason ? `: ${state.reason}` : ''
            showCharacterActionStatus(`${translateUiText(canonical)} — ${label}${reason}`, state.status)
            return
        }
    }

    if (!entries.some(entry => entry.consumerAvailability.playable)) {
        if (entries.some(entry => (
            entry.consumerAvailability.status === 'not-requested'
            || entry.consumerAvailability.status === 'loading'
        ))) {
            showCharacterActionStatus(translateUiText('Loading official character actions...'), 'loading')
            return
        }
        const detail = entries.find(entry => entry.consumerAvailability.reason)?.consumerAvailability.reason
            ?? entries[0]?.consumerAvailability.status
        const prefix = translateUiText('No playable official character actions')
        showCharacterActionStatus(detail ? `${prefix}: ${detail}` : prefix, 'unavailable')
        return
    }

    showCharacterActionStatus('')
}

function renderAnimationSelector() {
    const character = scene.characterSelected?.character
    const object = character?.object
    const sameCharacter = !!object && animationSelectorCharacter === object
    const previousOption = animationSelector.selectedOptions[0]
    const previousActionId = sameCharacter && previousOption?.dataset.characterAction === 'true'
        ? previousOption.value
        : undefined
    const previousLegacyName = sameCharacter && previousOption?.dataset.animationSource === 'legacy'
        ? previousOption.value
        : undefined

    animationSelector.innerHTML = ''
    animationSelector.onchange = () => { void onAnimationSelectionChanged() }
    animationSelectorCharacter = object

    const emptyOption = document.createElement('option')
    emptyOption.value = ''
    emptyOption.textContent = '<No animation>'
    emptyOption.dataset.animationSource = 'legacy'
    animationSelector.appendChild(emptyOption)

    if (!character || !object) {
        animationSelector.value = ''
        renderCharacterActionStatus()
        return
    }

    const legacyNames = baseAnimationNamesByCharacter.get(object) ?? character.animations
    for (const name of legacyNames) {
        const option = document.createElement('option')
        option.value = name
        option.textContent = name
        option.dataset.animationSource = 'legacy'
        animationSelector.appendChild(option)
    }

    const entries = selectedCharacterCatalogEntries()
    const groups = new Map<string, { label: string; entries: CharacterActionCatalogEntry[] }>()
    for (const entry of entries) {
        const group = groups.get(entry.groupId) ?? { label: entry.group, entries: [] }
        group.entries.push(entry)
        groups.set(entry.groupId, group)
    }
    for (const [groupId, group] of groups) {
        const optionGroup = document.createElement('optgroup')
        optionGroup.label = group.label
        optionGroup.dataset.groupId = groupId
        optionGroup.setAttribute('data-i18n-ignore', 'true')
        for (const entry of group.entries) {
            const availability = entry.consumerAvailability
            const playable = availability.currentCharacter && availability.playable
            const detail = availability.reason || availability.status
            const option = document.createElement('option')
            option.value = entry.id
            option.disabled = !playable
            option.textContent = `${entry.label} · ${entry.playback}${playable ? '' : ` — ${detail}`}`
            option.title = `${entry.id} · ${entry.group} · ${entry.playback}${playable ? '' : ` · ${detail}`}`
            option.dataset.characterAction = 'true'
            option.dataset.actionLabel = entry.label
            option.dataset.groupId = entry.groupId
            option.dataset.group = entry.group
            option.dataset.playback = entry.playback
            option.dataset.currentCharacter = String(availability.currentCharacter)
            option.dataset.availabilityStatus = availability.status
            option.dataset.playable = String(playable)
            if (availability.reason) option.dataset.unavailableReason = availability.reason
            optionGroup.appendChild(option)
        }
        animationSelector.appendChild(optionGroup)
    }

    const characterId = Number(character.userData.characterId)
    const stateActionId = characterActionPlaybackState?.characterId === characterId
        ? characterActionPlaybackState.actionId
        : undefined
    const wantedActionId = stateActionId || previousActionId
    const actionOption = wantedActionId
        ? [...animationSelector.options].find(option => (
            option.dataset.characterAction === 'true' && option.value === wantedActionId
        ))
        : undefined
    const currentLegacyName = legacyNames.includes(character.animation.current || '')
        ? character.animation.current
        : undefined
    const wantedLegacyName = previousLegacyName || currentLegacyName
    const legacyOption = wantedLegacyName
        ? [...animationSelector.options].find(option => (
            option.dataset.animationSource === 'legacy' && option.value === wantedLegacyName
        ))
        : undefined
    ;(actionOption || legacyOption || emptyOption).selected = true
    renderCharacterActionStatus()
}

function applyCharacterActionCatalog(snapshot: CharacterActionCatalogSnapshot) {
    characterActionCatalogSnapshot = snapshot
    renderAnimationSelector()
    characterPhysicsActionOptionsUi?.refresh()
}

function setCharacterActionPlaybackState(state: CharacterActionPlaybackState) {
    const previous = characterActionPlaybackState
    characterActionPlaybackState = state
    if (
        previous?.status !== state.status
        || previous?.actionId !== state.actionId
        || previous?.characterId !== state.characterId
        || previous?.reason !== state.reason
    ) {
        renderCharacterActionStatus()
    }
    characterPhysicsActionOptionsUi?.refresh()
}

function disposeCharacterActionPlayback() {
    characterActionOperationToken++
    characterActionPendingId = undefined
    setCharacterActionPlaybackState(characterActionsApi().dispose())
}

async function playSelectedAnimation() {
    if (!animationRepetitions.disabled && !animationRepetitions.reportValidity()) return
    const repetitions = animationRepetitions.disabled || animationRepetitions.value === ''
        ? undefined : animationRepetitions.valueAsNumber
    const actionOption = selectedCharacterActionOption()
    if (!actionOption) {
        disposeCharacterActionPlayback()
        const animation = scene.characterSelected?.character?.animation
        if (animation && animationSelector.value) {
            if (repetitions === undefined) animation.play(animationSelector.value, animationSelector.value.endsWith('_L'))
            else animation.play(animationSelector.value, animationSelector.value.endsWith('_L'), { repetitions })
        }
        updateAnimationControls()
        return
    }
    if (actionOption.disabled || actionOption.dataset.playable !== 'true') {
        const reason = actionOption.dataset.unavailableReason || actionOption.dataset.availabilityStatus
        const prefix = translateUiText('Official character action unavailable')
        showCharacterActionStatus(reason ? `${prefix}: ${reason}` : prefix, 'unavailable')
        return
    }

    disposeCharacterActionPlayback()
    const actionId = actionOption.value
    const token = ++characterActionOperationToken
    characterActionPendingId = actionId
    renderCharacterActionStatus()
    try {
        const state = await characterActionsApi().play(actionId, { repetitions })
        if (token !== characterActionOperationToken) return
        characterActionPendingId = undefined
        setCharacterActionPlaybackState(state)
        setSelectedAnimationPlaybackRate(selectedAnimationPlaybackRate(), true)
        // subscribeState may publish the same playing state before play() resolves.
        // Re-render after clearing the pending marker so the loading label cannot stick.
        renderCharacterActionStatus()
    } catch (error) {
        if (token !== characterActionOperationToken) return
        characterActionPendingId = undefined
        const reason = error instanceof Error ? error.message : String(error)
        const prefix = translateUiText('Official character action unavailable')
        showCharacterActionStatus(`${prefix}: ${reason}`, 'error')
    }
    updateAnimationControls()
}

function currentCatalogPlayback() {
    const state = characterActionsApi().state()
    return state.actionId && (state.status === 'playing' || state.status === 'paused'
        || (state.status === 'idle' && state.repetitions !== undefined && (state.completedRepetitions ?? 0) > 0)) ? state : undefined
}

async function resumeCurrentAnimation() {
    const state = currentCatalogPlayback()
    if (state) {
        // play(active ID) resumes the transport's paused instance. Never apply
        // the dropdown draft here, and never restart a completed one-shot.
        if (state.status === 'paused' && (state.loop || state.timeSeconds < state.durationSeconds)) {
            setCharacterActionPlaybackState(await characterActionsApi().play(state.actionId!))
        }
    } else {
        const animation = scene.characterSelected?.character?.animation
        if (animation && !animation.clamped) animation.paused = false
    }
    updateAnimationControls()
}

function pauseSelectedAnimation() {
    if (currentCatalogPlayback()) {
        setCharacterActionPlaybackState(characterActionsApi().pause())
    } else if (scene.characterSelected?.character) {
        scene.characterSelected.character.animation.paused = true
    }
    updateAnimationControls()
}

function seekSelectedAnimation() {
    const requestedTime = parseFloat(animationSlider.value)
    if (!Number.isFinite(requestedTime)) return
    if (currentCatalogPlayback()) {
        characterActionsApi().pause()
        setCharacterActionPlaybackState(characterActionsApi().seek(requestedTime))
        updateAnimationControls()
        return
    }
    const animation = scene.characterSelected?.character?.animation
    if (!animation) return
    if (animation.clamped && animation.current && animation.repetitions === undefined) {
        animation.play(animation.current, animation.current.endsWith('_L'))
    }
    animation.paused = true
    animation.time = THREE.MathUtils.clamp(requestedTime, 0, Math.max(0, animation.duration))
    updateAnimationControls()
}

async function onAnimationSelectionChanged() {
    // Draft selection does not switch, pause or resume the active action.
    updateAnimationControls()
}

async function refreshCharacterActionCatalog() {
    const selectedObject = scene.characterSelected?.character?.object
    const token = ++characterActionRefreshToken
    const api = characterActionsApi()
    applyCharacterActionCatalog(api.catalog())
    if (!selectedObject) return
    try {
        await api.ready()
    } catch {
        // The catalog snapshot carries the exact load error for the visible status.
    }
    if (token !== characterActionRefreshToken) return
    if (scene.characterSelected?.character?.object !== selectedObject) return
    setCharacterActionPlaybackState(api.state())
    applyCharacterActionCatalog(api.catalog())
}

function setupCharacterActionConsumer() {
    if (characterActionConsumerSetup) return
    characterActionConsumerSetup = true
    const api = characterActionsApi()
    characterActionCatalogUnsubscribe = api.subscribeCatalog(applyCharacterActionCatalog)
    characterActionStateUnsubscribe = api.subscribeState(setCharacterActionPlaybackState)

    window.addEventListener('pagehide', () => {
        characterActionRefreshToken++
        characterActionOperationToken++
        characterActionPendingId = undefined
        api.dispose()
        characterActionCatalogUnsubscribe?.()
        characterActionStateUnsubscribe?.()
        characterActionCatalogUnsubscribe = undefined
        characterActionStateUnsubscribe = undefined
    }, { once: true })
}

function setupMenuCollapseToggle() {
    const transitionDuration = 220
    let collapsed = false
    let transitionTimer: number | undefined

    const updateToggleLabel = () => {
        menuCollapseToggle.classList.toggle('controls-collapsed', collapsed)
        menuCollapseToggle.setAttribute('aria-expanded', String(!collapsed))
        const label = translateUiText(collapsed ? 'Expand controls' : 'Collapse controls')
        menuCollapseToggle.title = label
        menuCollapseToggle.setAttribute('aria-label', label)
    }

    const setCollapsed = (nextCollapsed: boolean, animate = true) => {
        collapsed = nextCollapsed
        if (transitionTimer !== undefined) window.clearTimeout(transitionTimer)
        document.body.classList.remove('menu-ui-collapsing', 'menu-ui-expanding')
        updateToggleLabel()

        if (!animate) {
            document.body.classList.toggle('menu-ui-collapsed', collapsed)
            return
        }

        document.body.classList.remove('menu-ui-collapsed')
        document.body.classList.add(collapsed ? 'menu-ui-collapsing' : 'menu-ui-expanding')
        transitionTimer = window.setTimeout(() => {
            document.body.classList.remove('menu-ui-collapsing', 'menu-ui-expanding')
            document.body.classList.toggle('menu-ui-collapsed', collapsed)
            transitionTimer = undefined
        }, transitionDuration)
    }

    menuCollapseToggle.onclick = () => {
        setCollapsed(!collapsed)
    }
    document.addEventListener('magius:localechange', updateToggleLabel)
    setCollapsed(false, false)
}

function setupDockControls() {
    const otherToolsPanel = document.getElementById('other-tools-panel') as HTMLElement
    const otherToolsToggle = document.getElementById('other-tools-toggle') as HTMLButtonElement
    const otherToolsClose = document.getElementById('other-tools-close') as HTMLButtonElement
    const setOtherToolsPanelOpen = (open: boolean) => {
        const wasOpen = otherToolsPanel.classList.contains('is-open')
        const restoreFocus = !open && otherToolsPanel.contains(document.activeElement)
        otherToolsPanel.classList.toggle('is-open', open)
        otherToolsPanel.setAttribute('aria-hidden', String(!open))
        otherToolsToggle.setAttribute('aria-expanded', String(open))
        const label = translateUiText('About me')
        otherToolsToggle.textContent = label
        otherToolsToggle.title = label
        otherToolsToggle.setAttribute('aria-label', label)
        if (open && !wasOpen) otherToolsClose.focus({ preventScroll: true })
        else if (restoreFocus) otherToolsToggle.focus({ preventScroll: true })
    }
    otherToolsToggle.onclick = () => setOtherToolsPanelOpen(!otherToolsPanel.classList.contains('is-open'))
    otherToolsClose.onclick = () => setOtherToolsPanelOpen(false)

    const setAdvancedControlsOpen = (open: boolean) => {
        document.body.classList.toggle('advanced-controls-open', open)
        advancedControlsDock.classList.toggle('is-open', open)
        advancedControlsDock.setAttribute('aria-hidden', String(!open))
        renderSettingsToggle.setAttribute('aria-expanded', String(open))
        const label = translateUiText(open ? 'Hide rendering controls' : 'Rendering controls')
        renderSettingsToggle.textContent = label
        renderSettingsToggle.title = label
        renderSettingsToggle.setAttribute('aria-label', label)
    }

    const setPositionControlsOpen = (open: boolean) => {
        document.body.classList.toggle('position-controls-open', open)
        positionControlsWrapper.setAttribute('aria-hidden', String(!open))
        positionControlsToggle.setAttribute('aria-expanded', String(open))
        captureControlsToggle.setAttribute('aria-expanded', String(open))
        const label = translateUiText(open ? 'Hide movement and rotation' : 'Move and rotate')
        positionControlsToggle.textContent = label
        positionControlsToggle.title = label
        positionControlsToggle.setAttribute('aria-label', label)
        const captureLabel = translateUiText(open ? 'Hide movement and rotation' : 'Take a photo')
        captureControlsToggle.title = captureLabel
        captureControlsToggle.setAttribute('aria-label', captureLabel)
    }

    const setActionPanelOpen = (open: boolean) => {
        actionPanel.classList.toggle('is-open', open)
        actionPanel.setAttribute('aria-hidden', String(!open))
        actionPanelToggle.setAttribute('aria-expanded', String(open))
        const label = translateUiText(open ? 'Hide action parameters' : 'Action panel')
        actionPanelToggle.textContent = label
        actionPanelToggle.title = label
        actionPanelToggle.setAttribute('aria-label', label)
    }

    const setExpressionPanelOpen = (open: boolean) => {
        expressionPanel.classList.toggle('is-open', open)
        expressionPanel.setAttribute('aria-hidden', String(!open))
        expressionPanelToggle.setAttribute('aria-expanded', String(open))
        const label = translateUiText(open ? 'Hide expression parameters' : 'Expression panel')
        expressionPanelToggle.textContent = label
        expressionPanelToggle.title = label
        expressionPanelToggle.setAttribute('aria-label', label)
    }

    renderSettingsToggle.onclick = () => {
        setAdvancedControlsOpen(!document.body.classList.contains('advanced-controls-open'))
    }
    positionControlsToggle.onclick = () => {
        setPositionControlsOpen(!document.body.classList.contains('position-controls-open'))
    }
    captureControlsToggle.onclick = () => {
        setPositionControlsOpen(!document.body.classList.contains('position-controls-open'))
    }
    actionPanelToggle.onclick = () => setActionPanelOpen(!actionPanel.classList.contains('is-open'))
    expressionPanelToggle.onclick = () => setExpressionPanelOpen(!expressionPanel.classList.contains('is-open'))
    renderSettingsClose.onclick = () => setAdvancedControlsOpen(false)
    actionPanelClose.onclick = () => setActionPanelOpen(false)
    expressionPanelClose.onclick = () => setExpressionPanelOpen(false)

    for (const panel of document.querySelectorAll<HTMLElement>('.floating-panel:not(#voice-panel)')) {
        const header = panel.querySelector('.floating-panel-header') as HTMLElement | null
        if (header) setupFloatingPanelDrag(panel, header)
    }

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return
        setOtherToolsPanelOpen(false)
        closeObjectTransform()
        setDirectPoseEditing(false)
        setAdvancedControlsOpen(false)
        setActionPanelOpen(false)
        setExpressionPanelOpen(false)
    })
    document.addEventListener('magius:localechange', () => {
        setOtherToolsPanelOpen(otherToolsPanel.classList.contains('is-open'))
        setAdvancedControlsOpen(document.body.classList.contains('advanced-controls-open'))
        setPositionControlsOpen(document.body.classList.contains('position-controls-open'))
        setActionPanelOpen(actionPanel.classList.contains('is-open'))
        setExpressionPanelOpen(expressionPanel.classList.contains('is-open'))
    })

    setOtherToolsPanelOpen(false)
    setAdvancedControlsOpen(false)
    setPositionControlsOpen(false)
    setActionPanelOpen(false)
    setExpressionPanelOpen(false)
    setupToolbarPopovers()
}

function setupStageShadowQualityControl() {
    const syncFromState = (quality: StageShadowQuality) => {
        stageShadowQualitySelect.value = quality
    }

    stageShadowQualitySelect.value = getStageShadowQuality()
    stageShadowQualitySelect.onchange = () => {
        setStageShadowQuality(stageShadowQualitySelect.value as StageShadowQuality)
    }
    document.addEventListener(STAGE_SHADOW_QUALITY_CHANGE_EVENT, event => {
        const state = (event as CustomEvent<ReturnType<typeof getStageShadowQualityState>>).detail
        syncFromState(state.quality)
    })
}

function setupToolbarPopovers() {
    const containers = Array.from(document.querySelectorAll<HTMLElement>('#toolbar-tools .icon-hover-container'))

    const positionPopover = (container: HTMLElement) => {
        const trigger = container.querySelector<HTMLElement>(':scope > button')
        const popover = container.querySelector<HTMLElement>(':scope > .icon-hover-popitem')
        if (!trigger || !popover) return

        const triggerRect = trigger.getBoundingClientRect()
        const popoverRect = popover.getBoundingClientRect()
        if (popoverRect.width <= 0 || popoverRect.height <= 0) return

        const padding = 8
        const centeredLeft = triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2
        const left = THREE.MathUtils.clamp(centeredLeft, padding, Math.max(padding, window.innerWidth - popoverRect.width - padding))
        const below = triggerRect.bottom
        const top = below + popoverRect.height <= window.innerHeight - padding
            ? below
            : Math.max(padding, triggerRect.top - popoverRect.height)

        popover.style.left = `${left}px`
        popover.style.right = 'auto'
        popover.style.top = `${top}px`
        popover.style.transform = 'none'
    }

    const schedulePosition = (container: HTMLElement) => {
        requestAnimationFrame(() => positionPopover(container))
    }

    for (const container of containers) {
        container.addEventListener('pointerenter', () => schedulePosition(container))
        container.addEventListener('focusin', () => schedulePosition(container))
    }
    window.addEventListener('resize', () => {
        for (const container of containers) schedulePosition(container)
    })
}

function setupParameterControls() {
    actionChannelSearch.addEventListener('input', () => filterParameterRows(actionChannelList, actionChannelSearch.value))
    expressionChannelSearch.addEventListener('input', () => filterParameterRows(expressionChannelList, expressionChannelSearch.value))
    actionModelPartSearch.addEventListener('input', () => filterModelPartRows())
    actionDirectEditToggle.onclick = () => setDirectPoseEditing(!directPoseEditingEnabled)
    actionDirectTranslate.onclick = () => setDirectPoseTransformMode('translate')
    actionDirectRotate.onclick = () => setDirectPoseTransformMode('rotate')
    actionSelectedPartVisibility.onclick = () => setSelectedModelPartVisibility(!selectedModelPart?.object.visible)
    actionShowAllParts.onclick = showAllModelParts
    actionParametersReset.onclick = resetActionParameters
    expressionParametersReset.onclick = resetExpressionParameters
    document.addEventListener('magius:localechange', () => {
        rebuildActionParameterChannels()
        rebuildModelPartVisibilityControls()
        rebuildExpressionParameterChannels()
        updateDirectPoseUi()
    })
    rebuildModelPartVisibilityControls()
    updateDirectPoseUi()
}

function filterParameterRows(container: HTMLElement, value: string) {
    const query = value.trim().toLocaleLowerCase()
    container.querySelectorAll<HTMLElement>('.parameter-channel-row').forEach(row => {
        row.hidden = Boolean(query) && !(row.dataset.filterValue ?? '').includes(query)
    })
    container.querySelectorAll<HTMLElement>('.parameter-section-label').forEach(heading => {
        const section = heading.dataset.section
        heading.hidden = ![...container.querySelectorAll<HTMLElement>('.parameter-channel-row')]
            .some(row => row.dataset.section === section && !row.hidden)
    })
}

function getObjectPath(object: THREE.Object3D, root: THREE.Object3D) {
    const parts: string[] = []
    let current: THREE.Object3D | null = object
    while (current && current !== root) {
        parts.push(current.name || current.type)
        current = current.parent
    }
    return parts.reverse().join(' / ')
}

function createParameterEmptyState(container: HTMLElement, label: string) {
    const empty = document.createElement('div')
    empty.className = 'parameter-channel-empty'
    empty.textContent = translateUiText(label)
    container.append(empty)
}

function appendParameterSectionLabel(container: HTMLElement, label: string, section: string) {
    const heading = document.createElement('div')
    heading.className = 'parameter-section-label'
    heading.dataset.section = section
    heading.textContent = translateUiText(label)
    container.append(heading)
}

const excludedCommonBonePattern = /(?:hair|cloth|skirt|ribbon|weapon|prop|finger|thumb|index|middle|pinky|breast|bust|eye|face|jaw|tongue|antenna|accessory|ik|pole|target|dummy|nub|end|(?:^|[_ .:/-])sp(?:$|[_ .:/-]))/i
const commonBonePatterns: ReadonlyArray<readonly [RegExp, number]> = [
    [/(?:^|[_ .:/-])(?:root|origin)(?:$|[_ .:/-])/i, 0],
    [/(?:hip|hips|pelvis)/i, 10],
    [/(?:spine)/i, 20],
    [/(?:waist|center)/i, 30],
    [/(?:chest)/i, 40],
    [/(?:neck)/i, 50],
    [/(?:head)/i, 60],
    [/(?:clavicle|shoulder)/i, 70],
    [/(?:upperarm|forearm|lowerarm|elbow|(?:^|[_ .:/-])arm(?:$|[_ .:/-]))/i, 80],
    [/(?:hand|wrist)/i, 90],
    [/(?:thigh|upperleg|upleg)/i, 100],
    [/(?:knee|calf|shin|lowerleg|(?:^|[_ .:/-])leg(?:$|[_ .:/-]))/i, 110],
    [/(?:foot|ankle)/i, 120],
    [/(?:toe)/i, 130],
]

function getCommonBonePriority(name: string) {
    if (excludedCommonBonePattern.test(name)) return Number.POSITIVE_INFINITY
    const match = commonBonePatterns.find(([pattern]) => pattern.test(name))
    if (!match) return Number.POSITIVE_INFINITY
    const sideOrder = /(?:^|[_ .:/-])(?:left|l)(?:$|[_ .:/-])/i.test(name)
        ? 1
        : /(?:^|[_ .:/-])(?:right|r)(?:$|[_ .:/-])/i.test(name)
            ? 2
            : 0
    const auxiliary = /(?:twist|roll|assist|sub)/i.test(name) ? 3 : 0
    return match[1] * 10 + sideOrder + auxiliary
}

const commonMorphPatterns: ReadonlyArray<readonly [RegExp, number]> = [
    [/(?:blink|eyelid|eye.*(?:open|close)|(?:open|close).*eye)/i, 0],
    [/(?:eye)/i, 10],
    [/(?:eyebrow|brow)/i, 20],
    [/(?:mouth|lip|jaw)/i, 30],
    [/(?:cheek|blush)/i, 40],
    [/(?:tear)/i, 50],
]

function getCommonMorphPriority(name: string) {
    return commonMorphPatterns.find(([pattern]) => pattern.test(name))?.[1]
        ?? Number.POSITIVE_INFINITY
}

function getPoseEntries(object: THREE.Object3D) {
    const existing = manualPoseByCharacter.get(object) ?? new Map<string, ManualPoseEntry>()
    const next = new Map<string, ManualPoseEntry>()
    object.traverse(child => {
        if (!(child instanceof THREE.Bone)) return
        next.set(child.uuid, existing.get(child.uuid) ?? {
            bone: child,
            offsets: new THREE.Vector3(),
            positionOffsets: new THREE.Vector3(),
        })
    })
    manualPoseByCharacter.set(object, next)
    return next
}

function getModelPartEntries(object: THREE.Object3D) {
    const existing = modelPartsByCharacter.get(object) ?? new Map<string, ModelPartEntry>()
    const next = new Map<string, ModelPartEntry>()
    let unnamedIndex = 0
    object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return
        const previous = existing.get(child.uuid)
        const path = getObjectPath(child, object)
        const label = child.name || `${translateUiText('Model part')} ${++unnamedIndex}`
        next.set(child.uuid, {
            object: child,
            defaultVisible: previous?.defaultVisible ?? child.visible,
            path,
            label,
        })
    })
    modelPartsByCharacter.set(object, next)
    if (selectedModelPart) selectedModelPart = next.get(selectedModelPart.object.uuid)
    return next
}

function filterModelPartRows() {
    const query = actionModelPartSearch.value.trim().toLocaleLowerCase()
    actionModelPartList.querySelectorAll<HTMLElement>('.model-part-row').forEach(row => {
        row.hidden = Boolean(query) && !(row.dataset.filterValue ?? '').includes(query)
    })
}

function updateModelPartVisibilityUi(scrollSelected = false) {
    const object = scene.characterSelected?.character?.object
    const entries = object ? getModelPartEntries(object) : new Map<string, ModelPartEntry>()
    if (selectedModelPart && !entries.has(selectedModelPart.object.uuid)) selectedModelPart = undefined

    actionModelPartList.querySelectorAll<HTMLElement>('.model-part-row').forEach(row => {
        const entry = entries.get(row.dataset.modelPartUuid ?? '')
        row.classList.toggle('direct-selected', entry === selectedModelPart)
        row.classList.toggle('part-hidden', entry ? !entry.object.visible : false)
        const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]')
        const status = row.querySelector<HTMLOutputElement>('output')
        if (checkbox && entry) checkbox.checked = entry.object.visible
        if (status && entry) {
            status.value = translateUiText(entry.object.visible ? 'Visible' : 'Hidden')
            status.textContent = status.value
        }
    })

    const selectedRow = selectedModelPart
        ? actionModelPartList.querySelector<HTMLElement>(`[data-model-part-uuid="${selectedModelPart.object.uuid}"]`)
        : null
    if (scrollSelected && selectedRow) selectedRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' })

    const selectedText = selectedModelPart
        ? `${translateUiText('Selected model part')}: ${selectedModelPart.label}`
        : translateUiText('No model part selected')
    actionSelectedPart.value = selectedText
    actionSelectedPart.textContent = selectedText
    actionSelectedPart.title = selectedModelPart?.path ?? selectedText
    actionSelectedPartVisibility.disabled = !selectedModelPart
    const visibilityLabel = translateUiText(selectedModelPart?.object.visible ? 'Hide selected part' : 'Show selected part')
    actionSelectedPartVisibility.textContent = visibilityLabel
    actionSelectedPartVisibility.title = visibilityLabel
    actionShowAllParts.disabled = entries.size === 0 || [...entries.values()].every(entry => entry.object.visible)
}

function selectModelPart(entry: ModelPartEntry | undefined, scrollSelected = false) {
    selectedModelPart = entry
    updateModelPartVisibilityUi(scrollSelected)
}

function setSelectedModelPartVisibility(visible: boolean) {
    if (!selectedModelPart) return
    selectedModelPart.object.visible = visible
    updateModelPartVisibilityUi()
}

function showAllModelParts() {
    const object = scene.characterSelected?.character?.object
    if (!object) return
    getModelPartEntries(object).forEach(entry => { entry.object.visible = true })
    updateModelPartVisibilityUi()
}

function restoreModelPartVisibility(object: THREE.Object3D) {
    getModelPartEntries(object).forEach(entry => { entry.object.visible = entry.defaultVisible })
    updateModelPartVisibilityUi()
}

function rebuildModelPartVisibilityControls() {
    actionModelPartList.replaceChildren()
    const object = scene.characterSelected?.character?.object
    if (!object) {
        selectedModelPart = undefined
        createParameterEmptyState(actionModelPartList, 'Select a character to edit action parameters')
        updateModelPartVisibilityUi()
        return
    }

    const entries = [...getModelPartEntries(object).values()].sort((a, b) => (
        a.path.localeCompare(b.path) || a.object.uuid.localeCompare(b.object.uuid)
    ))
    if (entries.length === 0) {
        createParameterEmptyState(actionModelPartList, 'No model parts')
        updateModelPartVisibilityUi()
        return
    }

    for (const entry of entries) {
        const row = document.createElement('div')
        row.className = 'model-part-row'
        row.dataset.i18nIgnore = 'true'
        row.dataset.modelPartUuid = entry.object.uuid
        row.dataset.filterValue = `${entry.label} ${entry.path}`.toLocaleLowerCase()

        const visible = document.createElement('input')
        visible.type = 'checkbox'
        visible.checked = entry.object.visible
        visible.title = translateUiText('Visible')
        visible.setAttribute('aria-label', `${translateUiText('Visible')}: ${entry.label}`)
        visible.addEventListener('change', () => {
            entry.object.visible = visible.checked
            selectModelPart(entry)
        })

        const select = document.createElement('button')
        select.type = 'button'
        select.className = 'model-part-select'
        select.textContent = entry.label
        select.title = entry.path
        select.onclick = () => selectModelPart(entry, true)

        const status = document.createElement('output')
        status.value = translateUiText(entry.object.visible ? 'Visible' : 'Hidden')
        status.textContent = status.value
        row.append(visible, select, status)
        actionModelPartList.append(row)
    }
    filterModelPartRows()
    updateModelPartVisibilityUi()
}

function rebuildActionParameterChannels() {
    actionChannelList.replaceChildren()
    const object = scene.characterSelected?.character?.object
    if (!object) {
        createParameterEmptyState(actionChannelList, 'Select a character to edit action parameters')
        return
    }

    const entries = [...getPoseEntries(object).values()].sort((a, b) => {
        const aPriority = getCommonBonePriority(a.bone.name)
        const bPriority = getCommonBonePriority(b.bone.name)
        if (aPriority !== bPriority) {
            if (!Number.isFinite(aPriority)) return 1
            if (!Number.isFinite(bPriority)) return -1
            return aPriority - bPriority
        }
        return (a.bone.name || a.bone.uuid).localeCompare(b.bone.name || b.bone.uuid)
    })
    if (entries.length === 0) {
        createParameterEmptyState(actionChannelList, 'No bone channels')
        return
    }

    const nameCounts = new Map<string, number>()
    const nameIndexes = new Map<string, number>()
    for (const entry of entries) {
        const name = entry.bone.name || 'Unnamed bone'
        nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
    }

    const commonEntries = entries.filter(entry => Number.isFinite(getCommonBonePriority(entry.bone.name)))
    const otherEntries = entries.filter(entry => !Number.isFinite(getCommonBonePriority(entry.bone.name)))
    const sections: ReadonlyArray<readonly [string, string, ManualPoseEntry[]]> = [
        ['Common body controls', 'common', commonEntries],
        ['All bone controls', 'all', otherEntries],
    ]

    for (const [sectionLabel, section, sectionEntries] of sections) {
        if (sectionEntries.length === 0) continue
        appendParameterSectionLabel(actionChannelList, sectionLabel, section)
        for (const entry of sectionEntries) {
            const row = document.createElement('div')
            row.className = 'parameter-channel-row parameter-bone-row'
            row.dataset.i18nIgnore = 'true'
            row.dataset.boneUuid = entry.bone.uuid
            row.dataset.section = section
            const path = getObjectPath(entry.bone, object)
            const rawName = entry.bone.name || 'Unnamed bone'
            const duplicateCount = nameCounts.get(rawName) ?? 0
            const duplicateIndex = (nameIndexes.get(rawName) ?? 0) + 1
            nameIndexes.set(rawName, duplicateIndex)
            const translatedName = rawName === 'Unnamed bone'
                ? translateUiText(rawName)
                : translateBoneChannelLabel(rawName)
            const displayLabel = duplicateCount > 1
                ? `${translatedName} ${duplicateIndex}/${duplicateCount}`
                : translatedName
            row.dataset.filterValue = `${entry.bone.name} ${path} ${displayLabel}`.toLocaleLowerCase()

            const name = document.createElement('span')
            name.className = 'parameter-channel-name'
            name.title = path
            name.textContent = displayLabel
            row.append(name)

            for (const axis of ['x', 'y', 'z'] as PoseAxis[]) {
                const control = document.createElement('label')
                control.className = 'parameter-axis-control'
                const input = document.createElement('input')
                input.type = 'range'
                input.min = '-180'
                input.max = '180'
                input.step = '0.5'
                input.value = entry.offsets[axis].toFixed(1)
                input.dataset.poseAxis = axis
                input.title = `${displayLabel} ${axis.toUpperCase()}`
                const output = document.createElement('output')
                output.value = `${Number(input.value).toFixed(1)}°`
                output.textContent = output.value
                input.addEventListener('input', () => {
                    if (isPerformanceBoneLeased(entry.bone)) { input.value = entry.offsets[axis].toFixed(1); return }
                    entry.offsets[axis] = parseFloat(input.value)
                    output.value = `${entry.offsets[axis].toFixed(1)}°`
                    output.textContent = output.value
                    applyManualPoseOverrides()
                })
                control.append(input, output)
                row.append(control)
            }
            actionChannelList.append(row)
        }
    }
    filterParameterRows(actionChannelList, actionChannelSearch.value)
    updateDirectPoseUi()
}

function applyPoseEntry(entry: ManualPoseEntry) {
    if (isPerformanceBoneLeased(entry.bone)) return
    if (
        entry.lastApplied
        && entry.lastBase
        && entry.bone.quaternion.angleTo(entry.lastApplied) < 1e-5
    ) {
        entry.bone.quaternion.copy(entry.lastBase)
    }

    if (
        entry.lastAppliedPosition
        && entry.lastBasePosition
        && entry.bone.position.distanceToSquared(entry.lastAppliedPosition) < 1e-10
    ) {
        entry.bone.position.copy(entry.lastBasePosition)
    }

    const hasOffset = Math.abs(entry.offsets.x) > 1e-6
        || Math.abs(entry.offsets.y) > 1e-6
        || Math.abs(entry.offsets.z) > 1e-6
    if (hasOffset) {
        entry.lastBase = entry.bone.quaternion.clone()
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
            THREE.MathUtils.degToRad(entry.offsets.x),
            THREE.MathUtils.degToRad(entry.offsets.y),
            THREE.MathUtils.degToRad(entry.offsets.z),
            'XYZ',
        ))
        entry.bone.quaternion.multiply(rotation)
        entry.lastApplied = entry.bone.quaternion.clone()
    } else {
        entry.lastBase = undefined
        entry.lastApplied = undefined
    }

    // Joint translation is fail-closed: authored bones remain rotation-only.
    // Root placement and IK translation are handled by their dedicated hosts.
    entry.lastBasePosition = undefined
    entry.lastAppliedPosition = undefined
}

function applyManualPoseOverrides() {
    for (const sceneCharacter of scene.characters) {
        const object = sceneCharacter.character?.object
        if (!object) continue
        manualPoseByCharacter.get(object)?.forEach(entry => {
            if (directPoseGizmoDragging && directPoseSelection?.entry === entry) return
            applyPoseEntry(entry)
        })
    }
}

function resetActionParameters() {
    const object = scene.characterSelected?.character?.object
    if (!object) return
    const entries = manualPoseByCharacter.get(object)
    entries?.forEach(entry => {
        if (isPerformanceBoneLeased(entry.bone)) return
        if (
            entry.lastApplied
            && entry.lastBase
            && entry.bone.quaternion.angleTo(entry.lastApplied) < 1e-5
        ) entry.bone.quaternion.copy(entry.lastBase)
        if (
            entry.lastAppliedPosition
            && entry.lastBasePosition
            && entry.bone.position.distanceToSquared(entry.lastAppliedPosition) < 1e-10
        ) entry.bone.position.copy(entry.lastBasePosition)
        entry.offsets.set(0, 0, 0)
        entry.positionOffsets.set(0, 0, 0)
        entry.lastBase = undefined
        entry.lastApplied = undefined
        entry.lastBasePosition = undefined
        entry.lastAppliedPosition = undefined
    })
    if (directPoseSelection?.object === object) {
        directPoseSelection.base.copy(directPoseSelection.entry.bone.quaternion)
        directPoseSelection.basePosition.copy(directPoseSelection.entry.bone.position)
    }
    restoreModelPartVisibility(object)
    setSelectedAnimationPlaybackRate(1, true)
    setDirectPoseTransformMode('translate')
    rebuildActionParameterChannels()
    rebuildModelPartVisibilityControls()
}

function getPoseEntryBase(entry: ManualPoseEntry) {
    if (
        entry.lastApplied
        && entry.lastBase
        && entry.bone.quaternion.angleTo(entry.lastApplied) < 1e-5
    ) return entry.lastBase.clone()
    return entry.bone.quaternion.clone()
}

function getPoseEntryPositionBase(entry: ManualPoseEntry) {
    if (
        entry.lastAppliedPosition
        && entry.lastBasePosition
        && entry.bone.position.distanceToSquared(entry.lastAppliedPosition) < 1e-10
    ) return entry.lastBasePosition.clone()
    return entry.bone.position.clone()
}

function syncPoseEntryControls(entry: ManualPoseEntry) {
    const row = [...actionChannelList.querySelectorAll<HTMLElement>('.parameter-bone-row')]
        .find(candidate => candidate.dataset.boneUuid === entry.bone.uuid)
    if (!row) return
    for (const axis of ['x', 'y', 'z'] as PoseAxis[]) {
        const input = row.querySelector<HTMLInputElement>(`input[data-pose-axis="${axis}"]`)
        const output = input?.nextElementSibling as HTMLOutputElement | null
        if (!input || !output) continue
        input.value = THREE.MathUtils.clamp(entry.offsets[axis], -180, 180).toFixed(1)
        output.value = `${entry.offsets[axis].toFixed(1)}°`
        output.textContent = output.value
    }
}

function setDirectPoseTransformMode(mode: DirectPoseTransformMode) {
    directPoseTransformMode = mode === 'translate' ? 'rotate' : mode
    directPosePointerDrag = undefined
    if (directPoseSelection) {
        directPoseSelection.base = getPoseEntryBase(directPoseSelection.entry)
        directPoseSelection.basePosition = getPoseEntryPositionBase(directPoseSelection.entry)
    }
    if (directPoseControls) {
        directPoseControls.mode = directPoseTransformMode
        directPoseControls.space = 'local'
        directPoseControls.showX = true
        directPoseControls.showY = true
        directPoseControls.showZ = true
    }
    updateDirectPoseUi()
}

function updateDirectPoseUi(scrollSelected = false) {
    const object = scene.characterSelected?.character?.object
    actionDirectEditToggle.disabled = !object
    actionDirectTranslate.disabled = true
    actionDirectRotate.disabled = !object
    actionDirectEditToggle.setAttribute('aria-pressed', String(directPoseEditingEnabled))
    actionDirectEditToggle.textContent = translateUiText(
        directPoseEditingEnabled ? 'Exit direct drag pose' : 'Direct drag pose',
    )
    actionDirectTranslate.setAttribute('aria-pressed', String(directPoseTransformMode === 'translate'))
    actionDirectRotate.setAttribute('aria-pressed', String(directPoseTransformMode === 'rotate'))
    actionDirectTranslate.textContent = translateUiText('Move XYZ (Root / IK only)')
    actionDirectTranslate.title = translateUiText('Joint translation is unavailable; use Root placement or IK target')
    actionDirectRotate.textContent = translateUiText('Rotate XYZ')
    actionDirectEditToggle.title = translateUiText(
        directPoseTransformMode === 'translate'
            ? 'Drag the XYZ arrows, or drag the body part in the camera plane; hold Alt for depth'
            : 'Drag vertically for local X, horizontally for local Z; hold Alt for local Y',
    )

    actionChannelList.querySelectorAll('.parameter-bone-row.direct-selected')
        .forEach(row => row.classList.remove('direct-selected'))
    const selectedRow = directPoseSelection
        ? [...actionChannelList.querySelectorAll<HTMLElement>('.parameter-bone-row')]
            .find(row => row.dataset.boneUuid === directPoseSelection?.entry.bone.uuid)
        : undefined
    selectedRow?.classList.add('direct-selected')
    if (scrollSelected && selectedRow) selectedRow.scrollIntoView({ block: 'center', behavior: 'smooth' })

    const selectedOffsets = directPoseSelection
        ? directPoseTransformMode === 'translate'
            ? directPoseSelection.entry.positionOffsets.toArray().map(value => value.toFixed(3))
            : directPoseSelection.entry.offsets.toArray().map(value => `${value.toFixed(1)}°`)
        : []
    const targetText = directPoseSelection
        ? `${translateUiText('Selected bone')}: ${translateBoneChannelLabel(directPoseSelection.entry.bone.name || 'Unnamed bone')} · X ${selectedOffsets[0]} · Y ${selectedOffsets[1]} · Z ${selectedOffsets[2]}`
        : translateUiText(
            directPoseTransformMode === 'translate'
                ? 'Click a body part, then drag the XYZ arrows'
                : 'Click a body part, then drag it or use the rotation rings',
        )
    actionDirectEditTarget.value = targetText
    actionDirectEditTarget.textContent = targetText
    updateModelPartVisibilityUi(scrollSelected)
}

function selectDirectPoseBone(object: THREE.Object3D, bone: THREE.Bone, part?: THREE.Mesh) {
    if (isPerformanceBoneLeased(bone)) return
    const entry = getPoseEntries(object).get(bone.uuid)
    if (!entry || !directPoseControls || !directPoseControlsHelper) return
    directPoseSelection = {
        object,
        entry,
        base: getPoseEntryBase(entry),
        basePosition: getPoseEntryPositionBase(entry),
    }
    if (part) selectModelPart(getModelPartEntries(object).get(part.uuid))
    directPoseControls.attach(bone)
    directPoseControls.enabled = true
    directPoseControlsHelper.visible = true
    updateDirectPoseUi(true)
}

function clearDirectPoseSelection() {
    directPoseControls?.detach()
    if (directPoseControlsHelper) directPoseControlsHelper.visible = false
    directPoseSelection = undefined
    directPosePointerDrag = undefined
    directPoseGizmoDragging = false
    updateDirectPoseUi()
}

function setDirectPoseEditing(enabled: boolean) {
    if (enabled && performanceGizmoActive) return
    const object = scene.characterSelected?.character?.object
    if (enabled && !object) return
    if (directPoseEditingEnabled === enabled) {
        updateDirectPoseUi()
        return
    }

    directPoseEditingEnabled = enabled
    document.body.classList.toggle('direct-pose-editing', enabled)
    if (enabled) {
        clearSingleCharacterTransform()
        directPoseOrbitControlsWasEnabled = scene.controls.enabled
        directPoseOutlineSelection = [...scene.effects.outlinePass.selectedObjects]
        scene.effects.outlinePass.selectedObjects = []
        scene.controls.enabled = false
        if (directPoseControls) directPoseControls.enabled = true
        const animation = scene.characterSelected?.character?.animation
        if (animation) animation.paused = true
        updateAnimationControls()
    } else {
        clearDirectPoseSelection()
        if (directPoseControls) directPoseControls.enabled = false
        scene.effects.outlinePass.selectedObjects = directPoseOutlineSelection
        directPoseOutlineSelection = []
        scene.controls.enabled = directPoseOrbitControlsWasEnabled
    }
    updateDirectPoseUi()
}

function syncDirectPoseOffsetsFromBone() {
    const selection = directPoseSelection
    if (!selection) return
    const delta = selection.base.clone().invert().multiply(selection.entry.bone.quaternion)
    const euler = new THREE.Euler().setFromQuaternion(delta, 'XYZ')
    selection.entry.offsets.set(
        THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(euler.x), -180, 180),
        THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(euler.y), -180, 180),
        THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(euler.z), -180, 180),
    )
    selection.entry.lastBase = selection.base.clone()
    selection.entry.lastApplied = selection.entry.bone.quaternion.clone()
    syncPoseEntryControls(selection.entry)
    updateDirectPoseUi()
}

function getBufferAttributeComponent(
    attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    index: number,
    component: number,
) {
    if (component === 0) return attribute.getX(index)
    if (component === 1) return attribute.getY(index)
    if (component === 2) return attribute.getZ(index)
    return attribute.getW(index)
}

function getWeightedBoneAtPointer(event: PointerEvent) {
    const object = scene.characterSelected?.character?.object
    if (!object) return undefined
    const rect = scene.renderer.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(pointer, scene.camera)
    const entries = getPoseEntries(object)

    for (const intersection of raycaster.intersectObject(object, true)) {
        if (!(intersection.object instanceof THREE.SkinnedMesh) || !intersection.face) continue
        const mesh = intersection.object
        const skinIndex = mesh.geometry.getAttribute('skinIndex')
        const skinWeight = mesh.geometry.getAttribute('skinWeight')
        if (!skinIndex || !skinWeight) continue

        const scores = new Map<number, number>()
        for (const vertex of [intersection.face.a, intersection.face.b, intersection.face.c]) {
            for (let component = 0; component < Math.min(4, skinIndex.itemSize, skinWeight.itemSize); component++) {
                const boneIndex = Math.round(getBufferAttributeComponent(skinIndex, vertex, component))
                const weight = getBufferAttributeComponent(skinWeight, vertex, component)
                if (weight > 0) scores.set(boneIndex, (scores.get(boneIndex) ?? 0) + weight)
            }
        }
        const dominant = [...scores].sort((a, b) => b[1] - a[1])[0]?.[0]
        const bone = dominant == undefined ? undefined : mesh.skeleton.bones[dominant]
        if (bone && entries.has(bone.uuid)) return { object, bone, part: mesh }
    }
    return undefined
}

function setupDirectPoseEditing() {
    directPoseControls = new TransformControls(scene.camera, scene.renderer.domElement)
    directPoseControls.mode = directPoseTransformMode
    directPoseControls.space = 'local'
    directPoseControls.size = 0.72
    directPoseControls.enabled = false
    directPoseControlsHelper = directPoseControls.getHelper()
    directPoseControlsHelper.visible = false
    scene.scene.add(directPoseControlsHelper)

    directPoseControls.addEventListener('dragging-changed', event => {
        directPoseGizmoDragging = Boolean(event.value)
        if (directPoseGizmoDragging && directPoseSelection) {
            directPoseSelection.base = getPoseEntryBase(directPoseSelection.entry)
            directPoseSelection.basePosition = getPoseEntryPositionBase(directPoseSelection.entry)
        } else if (directPoseSelection) {
            syncDirectPoseOffsetsFromBone()
        }
        scene.controls.enabled = directPoseEditingEnabled ? false : !event.value && directPoseOrbitControlsWasEnabled
    })
    directPoseControls.addEventListener('objectChange', () => {
        if (directPoseGizmoDragging) syncDirectPoseOffsetsFromBone()
    })

    const canvas = scene.renderer.domElement
    canvas.addEventListener('pointerdown', event => {
        if (!directPoseEditingEnabled || event.button !== 0 || directPoseControls?.axis) return
        const weighted = getWeightedBoneAtPointer(event)
        if (!weighted) {
            const message = translateUiText('No weighted bone at this point')
            actionDirectEditTarget.value = message
            actionDirectEditTarget.textContent = message
            return
        }
        selectDirectPoseBone(weighted.object, weighted.bone, weighted.part)
        if (!directPoseSelection) return
        directPosePointerDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startOffsets: directPoseSelection.entry.offsets.clone(),
            selection: directPoseSelection,
        }
        canvas.setPointerCapture(event.pointerId)
        event.preventDefault()
        event.stopPropagation()
    })
    canvas.addEventListener('pointermove', event => {
        const drag = directPosePointerDrag
        if (!drag || drag.pointerId !== event.pointerId) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        const sensitivity = event.shiftKey ? 0.18 : 0.35
        if (event.altKey) {
            drag.selection.entry.offsets.y = THREE.MathUtils.clamp(drag.startOffsets.y + dx * sensitivity, -180, 180)
        } else {
            drag.selection.entry.offsets.x = THREE.MathUtils.clamp(drag.startOffsets.x - dy * sensitivity, -180, 180)
            drag.selection.entry.offsets.z = THREE.MathUtils.clamp(drag.startOffsets.z - dx * sensitivity, -180, 180)
        }
        applyPoseEntry(drag.selection.entry)
        syncPoseEntryControls(drag.selection.entry)
        updateDirectPoseUi()
        event.preventDefault()
        event.stopPropagation()
    })
    const stopPointerDrag = (event: PointerEvent) => {
        if (!directPosePointerDrag || directPosePointerDrag.pointerId !== event.pointerId) return
        directPosePointerDrag = undefined
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    canvas.addEventListener('pointerup', stopPointerDrag)
    canvas.addEventListener('pointercancel', stopPointerDrag)
    updateDirectPoseUi()
}

function isMorphTargetMesh(object: THREE.Object3D): object is MorphTargetMesh {
    const mesh = object as Partial<MorphTargetMesh>
    return object instanceof THREE.Mesh
        && Boolean(mesh.morphTargetDictionary)
        && Array.isArray(mesh.morphTargetInfluences)
}

function getMorphTargetMeshes(object: THREE.Object3D) {
    const meshes: MorphTargetMesh[] = []
    object.traverse(child => {
        if (isMorphTargetMesh(child)) meshes.push(child)
    })
    return meshes
}

function getMorphValue(meshes: MorphTargetMesh[], name: string) {
    for (const mesh of meshes) {
        const index = mesh.morphTargetDictionary[name]
        if (index != undefined) return mesh.morphTargetInfluences[index] ?? 0
    }
    return 0
}

function rebuildExpressionParameterChannels() {
    expressionChannelList.replaceChildren()
    const object = scene.characterSelected?.character?.object
    if (!object) {
        createParameterEmptyState(expressionChannelList, 'Select a character to edit expression parameters')
        return
    }

    const meshes = getMorphTargetMeshes(object)
    const names = [...new Set(meshes.flatMap(mesh => Object.keys(mesh.morphTargetDictionary)))].sort((a, b) => {
        const aPriority = getCommonMorphPriority(a)
        const bPriority = getCommonMorphPriority(b)
        if (aPriority !== bPriority) {
            if (!Number.isFinite(aPriority)) return 1
            if (!Number.isFinite(bPriority)) return -1
            return aPriority - bPriority
        }
        return a.localeCompare(b)
    })
    if (names.length === 0) {
        createParameterEmptyState(expressionChannelList, 'No morph channels')
        return
    }

    const overrides = manualMorphsByCharacter.get(object)
    const commonNames = names.filter(name => Number.isFinite(getCommonMorphPriority(name)))
    const otherNames = names.filter(name => !Number.isFinite(getCommonMorphPriority(name)))
    const sections: ReadonlyArray<readonly [string, string, string[]]> = [
        ['Common expression controls', 'common', commonNames],
        ['All expression controls', 'all', otherNames],
    ]

    for (const [sectionLabel, section, sectionNames] of sections) {
        if (sectionNames.length === 0) continue
        appendParameterSectionLabel(expressionChannelList, sectionLabel, section)
        for (const name of sectionNames) {
            const row = document.createElement('label')
            row.className = 'parameter-channel-row parameter-morph-row'
            row.dataset.i18nIgnore = 'true'
            row.dataset.section = section
            const displayLabel = translateMorphChannelLabel(name)
            row.dataset.filterValue = `${name} ${displayLabel}`.toLocaleLowerCase()

            const label = document.createElement('span')
            label.className = 'parameter-channel-name'
            label.title = name
            label.textContent = displayLabel

            const currentValue = overrides?.get(name)?.value ?? getMorphValue(meshes, name)
            const input = document.createElement('input')
            input.type = 'range'
            input.min = Math.min(-1, Math.floor(currentValue)).toString()
            input.max = Math.max(2, Math.ceil(currentValue)).toString()
            input.step = '0.01'
            input.value = currentValue.toFixed(2)
            input.title = displayLabel

            const output = document.createElement('output')
            output.value = currentValue.toFixed(2)
            output.textContent = output.value
            input.addEventListener('input', () => {
                if (meshes.some(mesh => isPerformanceMorphLeased(mesh, mesh.morphTargetDictionary[name]))) {
                    input.value = getMorphValue(meshes, name).toFixed(2); return
                }
                let map = manualMorphsByCharacter.get(object)
                if (!map) {
                    map = new Map()
                    manualMorphsByCharacter.set(object, map)
                }
                let entry = map.get(name)
                if (!entry) {
                    entry = {
                        value: parseFloat(input.value),
                        baselineByMesh: new Map(meshes.flatMap(mesh => {
                            const index = mesh.morphTargetDictionary[name]
                            return index == undefined
                                ? []
                                : [[mesh, mesh.morphTargetInfluences[index] ?? 0] as const]
                        })),
                    }
                    map.set(name, entry)
                }
                entry.value = parseFloat(input.value)
                output.value = entry.value.toFixed(2)
                output.textContent = output.value
                applyManualExpressionOverrides()
            })
            row.append(label, input, output)
            expressionChannelList.append(row)
        }
    }
    filterParameterRows(expressionChannelList, expressionChannelSearch.value)
}

function applyManualExpressionOverrides() {
    for (const sceneCharacter of scene.characters) {
        const object = sceneCharacter.character?.object
        if (!object) continue
        const overrides = manualMorphsByCharacter.get(object)
        if (!overrides?.size) continue
        for (const mesh of getMorphTargetMeshes(object)) {
            for (const [name, entry] of overrides) {
                const index = mesh.morphTargetDictionary[name]
                if (index != undefined && !isPerformanceMorphLeased(mesh, index)) mesh.morphTargetInfluences[index] = entry.value
            }
        }
    }
}

function resetExpressionParameters() {
    const character = scene.characterSelected?.character
    if (!character) return
    const overrides = manualMorphsByCharacter.get(character.object)
    overrides?.forEach((entry, name) => {
        entry.baselineByMesh.forEach((value, mesh) => {
            const index = mesh.morphTargetDictionary[name]
            if (index != undefined && !isPerformanceMorphLeased(mesh, index)) mesh.morphTargetInfluences[index] = value
        })
    })
    overrides?.clear()
    character.expression?.update(0)
    expressionManualBlink.value = '0'
    expressionStrength.value = '1'
    expressionTransition.value = '0'
    expressionMouthCorner.value = '0'
    character.expression?.setManualBlinkWeight(0)
    character.expression?.setExpressionWeight(1)
    character.expression?.setExpressionTransitionSeconds(0)
    character.expression?.setMouthCornerWeight(0)
    syncExpressionControls()
    rebuildExpressionParameterChannels()
}

function rememberCharacterTransform(object: THREE.Object3D, replace = false) {
    movementSelection.remember(object, replace)
}
function moveSelectedCharacter(horizontal: number, vertical: number) { movementSelection.move(scene.camera, horizontal, vertical) }
function rotateSelectedCharacter(delta: number) { movementSelection.rotate(delta) }
function tiltSelectedCharacter(delta: number) { movementSelection.tilt(scene.camera, delta) }
function resetSelectedCharacterTransform() { movementSelection.reset(teleportViewerCharacter) }

function bindContinuousTransformButton(button: HTMLButtonElement, action: () => void) {
    let repeatDelay: number | undefined
    let repeatTimer: number | undefined
    const stop = () => {
        if (repeatDelay !== undefined) window.clearTimeout(repeatDelay)
        if (repeatTimer !== undefined) window.clearInterval(repeatTimer)
        repeatDelay = undefined
        repeatTimer = undefined
    }

    button.addEventListener('pointerdown', event => {
        if (event.button !== 0) return
        event.preventDefault()
        button.setPointerCapture(event.pointerId)
        stop()
        action()
        repeatDelay = window.setTimeout(() => {
            repeatTimer = window.setInterval(action, 55)
        }, 260)
    })
    button.addEventListener('pointerup', stop)
    button.addEventListener('pointercancel', stop)
    button.addEventListener('lostpointercapture', stop)
}

function setupCharacterMovementControls() {
    bindContinuousTransformButton(characterMoveUpBtn, () => moveSelectedCharacter(0, characterMoveStep))
    bindContinuousTransformButton(characterMoveDownBtn, () => moveSelectedCharacter(0, -characterMoveStep))
    bindContinuousTransformButton(characterMoveLeftBtn, () => moveSelectedCharacter(-characterMoveStep, 0))
    bindContinuousTransformButton(characterMoveRightBtn, () => moveSelectedCharacter(characterMoveStep, 0))
    bindContinuousTransformButton(characterTiltLeftBtn, () => tiltSelectedCharacter(-characterRotateStep))
    bindContinuousTransformButton(characterTiltRightBtn, () => tiltSelectedCharacter(characterRotateStep))
    bindContinuousTransformButton(characterRotateLeftBtn, () => rotateSelectedCharacter(-characterRotateStep))
    bindContinuousTransformButton(characterRotateRightBtn, () => rotateSelectedCharacter(characterRotateStep))
    characterTransformResetBtn.onclick = resetSelectedCharacterTransform
    bindContinuousTransformButton(document.getElementById('object-move-forward') as HTMLButtonElement, () => movementSelection.move(scene.camera, 0, 0, characterMoveStep))
    bindContinuousTransformButton(document.getElementById('object-move-backward') as HTMLButtonElement, () => movementSelection.move(scene.camera, 0, 0, -characterMoveStep))
    document.addEventListener('magius:localechange', updateMovementTargetLabel)
    updateMovementTargetLabel()
}

type CharacterSearchEntry = PrimaryCharacterCatalogEntry

function searchCharacters(query: string, limit = 40): CharacterSearchEntry[] {
    return searchPrimaryCharacterCatalog(primaryCharacterCatalog, query, limit)
}

function annotateCharacterSelectorOptions(selector: HTMLSelectElement): void {
    for (const option of selector.options) {
        const entry = primaryCharacterById.get(option.value)
        if (!entry) continue
        option.dataset.characterKind = entry.kind
        option.dataset.characterStableIdentity = entry.stableIdentity
        option.dataset.characterBattleCapability = String(entry.capabilities.battle)
        option.dataset.characterTpsCapability = String(entry.capabilities.tps)
        option.dataset.characterDungeonCapability = String(entry.capabilities.dungeon)
        option.dataset.characterActionScope = entry.capabilities.actions
        option.dataset.characterPhysicsScope = entry.capabilities.physics
        option.title = [entry.name, ...entry.aliases].join(' · ')
    }
}

function syncCharacterUiCapabilityGates(characterId: string | number | null): void {
    const entry = characterId === null
        ? undefined
        : resolvePrimaryCharacterSelection(primaryCharacterCatalog, characterId)
    if (!entry) {
        locomotionModeToggle.disabled = true
        combatVfxPanelToggle.disabled = true
        delete document.documentElement.dataset.magiusCharacterUiCapabilities
        return
    }

    const state = characterUiControlState(entry)
    if (state.tpsDisabled) setViewerLocomotionEnabled(false)
    locomotionModeToggle.disabled = state.tpsDisabled
    locomotionModeToggle.dataset.characterTpsCapability = String(entry.capabilities.tps)
    locomotionModeToggle.dataset.characterDungeonCapability = String(entry.capabilities.dungeon)
    combatVfxPanelToggle.disabled = state.battleDisabled
    combatVfxPanelToggle.dataset.characterBattleCapability = String(entry.capabilities.battle)
    actionPanelToggle.dataset.characterActionScope = state.actionScope
    characterPhysicsActionOptions.dataset.characterPhysicsScope = state.physicsScope

    if (state.battleDisabled) {
        combatVfxPanel.classList.remove('is-open')
        combatVfxPanel.setAttribute('aria-hidden', 'true')
        combatVfxPanelToggle.setAttribute('aria-expanded', 'false')
    }
    document.documentElement.dataset.magiusCharacterUiCapabilities = JSON.stringify({
        characterId: entry.id,
        kind: entry.kind,
        visible: entry.visible,
        ...entry.capabilities,
    })
}

function setupCharacterSearch() {
    if (characterSearchResults.parentElement !== document.body) {
        document.body.appendChild(characterSearchResults)
    }

    let currentResults: CharacterSearchEntry[] = []
    let activeIndex = -1

    const updateInputWidth = () => {
        const viewportWidth = window.innerWidth
        const textLength = Array.from(characterSearchInput.value.trim()).length
        const baseChars = textLength > 0 ? textLength + 2 : 8
        const maxChars = viewportWidth < 760 ? 20 : 26
        const clampedChars = Math.max(8, Math.min(baseChars, maxChars))
        const approximatePx = Math.round(clampedChars * (viewportWidth < 760 ? 8 : 8.6) + 16)
        const minPx = viewportWidth < 520 ? 82 : 88
        const maxPx = Math.min(viewportWidth - 16, viewportWidth < 760 ? 220 : 260)
        const widthPx = Math.max(minPx, Math.min(approximatePx, maxPx))
        document.getElementById('character-search-box')?.style.setProperty('--character-search-width', `${widthPx}px`)
    }

    const updateResultsPosition = () => {
        const rect = characterSearchInput.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const width = Math.min(Math.max(rect.width, 320), viewportWidth - 16)
        let left = Math.min(rect.left, viewportWidth - width - 8)
        left = Math.max(8, left)
        const estimatedHeight = Math.min(420, viewportHeight * 0.7)
        let top = rect.bottom + 4
        if (top + estimatedHeight > viewportHeight - 8) {
            top = Math.max(8, rect.top - estimatedHeight - 4)
        }
        characterSearchResults.style.left = `${left}px`
        characterSearchResults.style.top = `${top}px`
        characterSearchResults.style.width = `${width}px`
    }

    const hideResults = () => {
        characterSearchResults.hidden = true
        characterSearchResults.innerHTML = ''
        characterSearchInput.setAttribute('aria-expanded', 'false')
        currentResults = []
        activeIndex = -1
    }

    const updateActiveResult = () => {
        const buttons = characterSearchResults.querySelectorAll<HTMLButtonElement>('.character-search-result')
        buttons.forEach((button, index) => {
            button.setAttribute('aria-selected', String(index === activeIndex))
        })
        buttons[activeIndex]?.scrollIntoView({ block: 'nearest' })
    }

    const selectSearchEntry = (entry: CharacterSearchEntry) => {
        characterSelector.value = entry.id
        if (characterSelector.value !== entry.id) return
        characterSelector.dispatchEvent(new Event('change', { bubbles: true }))
        characterSearchInput.value = `${entry.id} ${entry.name}`.trim()
        updateInputWidth()
        hideResults()
    }

    const renderResults = (results: CharacterSearchEntry[]) => {
        characterSearchResults.innerHTML = ''
        currentResults = results
        activeIndex = results.length > 0 ? 0 : -1

        if (results.length === 0) {
            const empty = document.createElement('span')
            empty.className = 'character-search-empty'
            empty.textContent = translateUiText('No matching characters')
            characterSearchResults.appendChild(empty)
        } else {
            results.forEach((entry, index) => {
                const button = document.createElement('button')
                button.type = 'button'
                button.className = 'character-search-result'
                button.dataset.characterId = entry.id
                button.setAttribute('role', 'option')
                button.setAttribute('aria-selected', String(index === activeIndex))

                const id = document.createElement('span')
                id.className = 'character-search-result-id'
                id.textContent = entry.id
                const name = document.createElement('span')
                name.className = 'character-search-result-name'
                name.textContent = entry.name
                button.append(id, name)

                button.addEventListener('mouseenter', () => {
                    activeIndex = index
                    updateActiveResult()
                })
                button.addEventListener('mousedown', event => {
                    event.preventDefault()
                    selectSearchEntry(entry)
                })
                characterSearchResults.appendChild(button)
            })
        }

        updateResultsPosition()
        characterSearchResults.hidden = false
        characterSearchInput.setAttribute('aria-expanded', 'true')
    }

    const renderQuery = () => {
        updateInputWidth()
        const query = characterSearchInput.value.trim()
        if (!query) {
            hideResults()
            return
        }
        renderResults(searchCharacters(query))
    }

    updateInputWidth()
    characterSearchInput.addEventListener('input', renderQuery)
    characterSearchInput.addEventListener('focus', renderQuery)
    characterSearchInput.addEventListener('blur', () => window.setTimeout(hideResults, 120))
    characterSearchInput.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            hideResults()
            characterSearchInput.blur()
            return
        }
        if (event.key === 'ArrowDown' && currentResults.length > 0) {
            event.preventDefault()
            activeIndex = Math.min(activeIndex + 1, currentResults.length - 1)
            updateActiveResult()
            return
        }
        if (event.key === 'ArrowUp' && currentResults.length > 0) {
            event.preventDefault()
            activeIndex = Math.max(activeIndex - 1, 0)
            updateActiveResult()
            return
        }
        if (event.key === 'Enter' && currentResults.length > 0) {
            event.preventDefault()
            const entry = currentResults[Math.max(activeIndex, 0)]
            if (entry) selectSearchEntry(entry)
        }
    })
    window.addEventListener('resize', () => {
        updateInputWidth()
        if (!characterSearchResults.hidden) updateResultsPosition()
    })
    window.addEventListener('scroll', () => {
        if (!characterSearchResults.hidden) updateResultsPosition()
    }, true)
    document.addEventListener('magius:localechange', () => {
        if (!characterSearchResults.hidden) renderQuery()
    })
}

function setupCharacterAddSelector() {
    initSelector(characterAddSelector, { '< Select a character to add >': '', ...characterSelectDict });
    annotateCharacterSelectorOptions(characterAddSelector)
    characterAddSelector.value = ''

    characterAddSelector.addEventListener('focus', () => {
        characterAddSelector.value = ''
    })
    characterAddSelector.addEventListener('click', () => {
        characterAddSelector.value = ''
    })
    characterAddSelector.addEventListener('change', async () => {
        if (characterAddSelector.value != '') {
            const id = characterAddSelector.value
            characterAddSelector.value = ''
            const newCharacter = await addOrChangeCharacter(id)
            selectCharacter(newCharacter)
        }
    })
}

function setupViewerInputHandler() {
    setupSingleCharacterTransformControls()
    scene.renderer.domElement.addEventListener('click', mouseClickHandler)
    scene.renderer.domElement.addEventListener('dblclick', mouseDoubleClickHandler)
    scene.renderer.domElement.addEventListener('mousedown', mouseDownHandler)
    scene.renderer.domElement.addEventListener('mousemove', mouseMoveHandler)

    let mouseMoveX = 0
    let mouseMoveY = 0

    function pickObject(e: MouseEvent) {
        const targets: { object: THREE.Object3D; select(): void; refresh(): void }[] = []
        for (const character of scene.characters) {
            if (!character.character) continue
            const actor = character.character
            targets.push({ object: actor.object, select: () => {
                if (character !== scene.characterSelected) selectCharacter(character)
                else selectMovementTarget({ object: actor.object, label: String(actor.userData.characterId), changed: () => updateCharacterController(actor) })
            }, refresh: () => updateCharacterController(actor) })
        }
        for (const enemy of enemyPanelController?.enemyResources.getInstances() ?? []) {
            targets.push({ object: enemy.object, select: () => { enemyPanelController?.selectInstance(enemy.instanceId) }, refresh: () => enemyPanelController?.refreshInstances() })
        }
        for (const weapon of weaponPanelController?.getInstances() ?? []) {
            targets.push({ object: weapon.object, select: () => { weaponPanelController?.selectObject(weapon.object) }, refresh: () => weaponPanelController?.refreshTransform() })
        }
        const rect = scene.renderer.domElement.getBoundingClientRect()
        const raycaster = new THREE.Raycaster()
        raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), scene.camera)
        return pickMovementTarget(raycaster, targets)
    }
    function mouseClickHandler(e: MouseEvent) {
        if (directPoseEditingEnabled || performanceGizmoActive) return
        if (Math.abs(mouseMoveX) > 3 || Math.abs(mouseMoveY) > 3) return
        if (singleCharacterTransformControls?.dragging || scene.transformControls.dragging
            || singleCharacterTransformControls?.axis || scene.transformControls.axis) return
        const target = pickObject(e)
        if (target) target.select()
        else { closeObjectTransform(); selectCharacterByMouse(e) }
    }
    function mouseDoubleClickHandler(e: MouseEvent) {
        if (directPoseEditingEnabled || performanceGizmoActive) return
        const target = pickObject(e)
        if (!target) return
        target.select()
        activateObjectTransform(target.object, target.refresh)
        e.preventDefault(); e.stopPropagation()
    }

    function mouseDownHandler(_e: MouseEvent) {
        mouseMoveX = 0
        mouseMoveY = 0
    }

    function mouseMoveHandler(e: MouseEvent) {
        if (e.buttons == 1) {
            mouseMoveX += e.movementX
            mouseMoveY += e.movementY
        }
    }

    function tpsMoveKeepsCharacterSelectedOnEmptyViewerClick(): boolean {
        return document.body.classList.contains('locomotion-mode-enabled')
    }

    function selectCharacterByMouse(e: PointerEvent | MouseEvent) {
        const character = scene.getIntersectedCharacter(e.offsetX, e.offsetY)
        if (character) {
            if (character != scene.characterSelected) {
                selectCharacter(character)
            }
        } else if (
            scene.characters.length > 1
            && scene.characterSelected
            && !tpsMoveKeepsCharacterSelectedOnEmptyViewerClick()
        ) {
            deselectCharacter()
        }
    }
}

function animateLoop() {
    applySelectedAnimationPlaybackRate()
    applyManualPoseOverrides()
    applyManualExpressionOverrides()
    voicePanelController?.update()
    performanceHost?.flushFinalPoseBeforeCamera()
    stats.update()
    updateAnimationControls()
}

function syncVoiceCharacter() {
    notifyPerformanceActors()
    const workspaceCharacters: VoicePanelWorkspaceCharacter[] = scene.characters.flatMap(sceneCharacter => {
        const character = sceneCharacter.character
        if (!character?.object) return []
        return [{
            actorKey: character.object.uuid,
            characterResourceId: String(character.userData.characterId ?? ''),
            target: character,
        }]
    })
    voicePanelController?.setWorkspaceCharacters(workspaceCharacters)
    voicePanelController?.setCharacter(
        String(scene.characterSelected?.character?.userData.characterId ?? '') || null,
        scene.characterSelected?.character ?? null,
    )
}

async function tryChangeCharacterByHash() {
    try {
        await presetImport(location.href)
        return
    } catch (e) { }

    let id = location.hash.replace('#', '')
    if (!characterIdList.includes(id)) id = '100107'

    const sceneCharacter = await changeCharacter(id)
    selectCharacter(sceneCharacter)
}

function consumeExpectedCharacterSelectionAbort<T>(selection: Promise<T>): Promise<T | undefined> {
    return selection.catch(error => {
        const abortError = (
            (error instanceof DOMException || error instanceof Error)
            && error.name === 'AbortError'
        )
        if (abortError) return undefined
        throw error
    })
}

function changeCharacterFromSelector(id: string) {
    return consumeExpectedCharacterSelectionAbort(changeCharacter(id))
}

async function changeCharacter(id: number | string) {
    if (typeof id == 'number') id = id.toString()

    voicePanelController?.setCharacter(null, null)
    disposeCharacterActionPlayback()
    characterSelector.value = id
    updateCharacterController(null)

    const loaded = await addOrChangeCharacter(id, scene.characterSelected)
    if (scene.characterSelected == loaded) {
        selectCharacter(loaded)
    }
    return loaded
}

function removeSelectedCharacter() {
    if (scene.characterSelected) {
        const removedCharacter = scene.characterSelected
        if (removedCharacter.character) forgetMovementTarget(removedCharacter.character.object)
        voicePanelController?.setCharacter(null, null)
        disposeCharacterActionPlayback()
        detachViewerLocomotion(removedCharacter)
        scene.removeCharacter(removedCharacter)
        scene.characterSelected = undefined
        deselectCharacter()
    }
}

async function addOrChangeCharacter(id: number | string, sceneCharacter?: SceneCharacter): Promise<SceneCharacter> {
    let loadedSceneCharacter: SceneCharacter | undefined = undefined

    let oldTransform = undefined
    if (sceneCharacter?.character?.object) {
        oldTransform = {
            position: sceneCharacter.character.object.position,
            rotation: sceneCharacter.character.object.rotation,
        }
        detachViewerLocomotion(sceneCharacter)
    }

    return scene.switchCharacter(
        sceneCharacter,
        id,
        {
            loadProgressCallback: displayProgress,
            loadFinishCallback: () => {
                if (loadedSceneCharacter?.character) {
                    updateCharacterOutline(loadedSceneCharacter.character, guiOptions)
                    if (scene.characterSelected == loadedSceneCharacter) {
                        updateCharacterController(loadedSceneCharacter.character)
                    }
                }
            }
        }
    ).then((sceneCharacter) => {
        hideAllDemoItems()

        const character = sceneCharacter.character!
        loadedSceneCharacter = sceneCharacter;

        if (oldTransform) {
            character.object.position.copy(oldTransform.position)
            character.object.rotation.copy(oldTransform.rotation)
        } else {
            character.object.position.copy(calculateNewCharacterPosition(sceneCharacter))
        }
        rememberCharacterTransform(character.object, true)
        baseAnimationNamesByCharacter.set(character.object, [...character.animations])

        if (character.animation.default) {
            character.animation.play(character.animation.default, true)
        }

        attachViewerLocomotion(sceneCharacter)

        return sceneCharacter
    })
}

function syncExpressionControls() {
    const expression = scene.characterSelected?.character?.expression
    const inputs = [
        expressionAutoBlink,
        expressionManualBlink,
        expressionStrength,
        expressionTransition,
        expressionMouthCorner,
    ]

    if (!expression) {
        const storyExpression = getNonBattleExpressionRuntime(scene.characterSelected?.character)
        if (storyExpression) expressionSelector.value = storyExpression.current ?? officialDefaultFaceState
        inputs.forEach(input => { input.disabled = true })
        expressionAutoBlink.checked = false
        expressionManualBlink.value = '0'
        expressionStrength.value = '1'
        expressionTransition.value = '0'
        expressionMouthCorner.value = '0'
    } else {
        expressionAutoBlink.disabled = !expression.automaticBlinkAvailable
        expressionAutoBlink.checked = expression.autoBlink
        expressionManualBlink.disabled = !expression.manualBlinkAvailable
        expressionManualBlink.value = expression.manualBlinkWeight.toFixed(2)
        expressionStrength.disabled = false
        expressionStrength.value = expression.expressionWeight.toFixed(2)
        expressionTransition.disabled = false
        expressionTransition.value = expression.expressionTransitionSeconds.toFixed(2)
        expressionMouthCorner.disabled = !expression.mouthCornerControlAvailable
        expressionMouthCorner.value = expression.mouthCornerWeight.toFixed(2)

        expressionSelector.value = expression.automaticBlinkActive
            ? officialDefaultFaceState
            : expression.current
    }

    expressionManualBlinkValue.value = Number(expressionManualBlink.value).toFixed(2)
    expressionStrengthValue.value = Number(expressionStrength.value).toFixed(2)
    expressionTransitionValue.value = `${Number(expressionTransition.value).toFixed(2)} s`
    expressionMouthCornerValue.value = Number(expressionMouthCorner.value).toFixed(2)
}

function selectCharacter(sceneCharacter: SceneCharacter) {
    performanceEditorController?.runtime.endDrag()
    clearSingleCharacterTransform()
    setDirectPoseEditing(false)
    if (scene.characterSelected && scene.characterSelected !== sceneCharacter) {
        disposeCharacterActionPlayback()
    }
    scene.characterSelected = sceneCharacter

    const character = sceneCharacter.character
    if (!character) return
    if (performanceExternalLeases.get(character.object)?.channels.root) scene.transformControls.detach()
    syncVoiceCharacter()
    rememberCharacterTransform(character.object)
    selectMovementTarget({ object: character.object, label: String(character.userData.characterId), changed: () => updateCharacterController(character) })

    characterSelector.value = character.userData.characterId.toString()
    syncCharacterUiCapabilityGates(character.userData.characterId)
    selectViewerLocomotion(sceneCharacter)
    setCharacterActionPlaybackState(characterActionsApi().state())
    applyCharacterActionCatalog(characterActionsApi().catalog())
    void refreshCharacterActionCatalog()
    updateAnimationControls()
    rebuildActionParameterChannels()
    rebuildModelPartVisibilityControls()

    const storyExpression = getNonBattleExpressionRuntime(character)
    if (storyExpression) {
        expressionSelector.disabled = false
        expressionSelector.title = 'Authored story face/action (full native animation)'
        initSelector(expressionSelector, storyExpression.actions.reduce((options, action) => {
            options[action.label] = action.id
            return options
        }, { 'Default face/action': officialDefaultFaceState } as Record<string, string>), value => {
            if (value === officialDefaultFaceState) storyExpression.resetToDefault()
            else storyExpression.play(value)
            updateAnimationControls()
            syncExpressionControls()
            rebuildExpressionParameterChannels()
        })
    } else if (character.expression) {
        expressionSelector.title = ''
        expressionSelector.disabled = false
        initSelector(
            expressionSelector,
            character.expression.expressions.reduce((obj, name) => {
                obj[name] = name
                return obj
            }, {
                'Default face': officialDefaultFaceState,
            } as Record<string, string>),
            value => {
                if (value === officialDefaultFaceState) {
                    character.expression?.resetToDefault()
                } else {
                    character.expression?.set(value, expressionAutoBlink.checked)
                }
                syncExpressionControls()
                rebuildExpressionParameterChannels()
            },
        )
    } else {
        expressionSelector.title = ''
        expressionSelector.disabled = true
        initSelector(expressionSelector, { '<No expression data>': '' })
    }
    syncExpressionControls()
    rebuildExpressionParameterChannels()

    updateCharacterController(character)
    updateTransformModeButtons()

    document.body.classList.remove('no-target')
}

export function deselectCharacter() {
    forgetMovementTarget(scene.characterSelected?.character?.object)
    if (!movementSelection.current) clearSingleCharacterTransform()
    setDirectPoseEditing(false)
    disposeCharacterActionPlayback()
    scene.characterSelected = undefined
    syncCharacterUiCapabilityGates(null)
    syncVoiceCharacter()
    selectViewerLocomotion(undefined)
    characterActionRefreshToken++
    setCharacterActionPlaybackState(characterActionsApi().state())
    applyCharacterActionCatalog(characterActionsApi().catalog())
    syncExpressionControls()
    rebuildActionParameterChannels()
    selectedModelPart = undefined
    rebuildModelPartVisibilityControls()
    rebuildExpressionParameterChannels()

    updateCharacterController(null)
    updateTransformModeButtons()

    document.body.classList.add('no-target')
}

/** Find available positions for a new character, 0.667 (2/3) meters per one */
function calculateNewCharacterPosition(newCharacter: SceneCharacter): THREE.Vector3 {
    const spacing = 2 / 3;
    const existingPositions = scene.characters.filter(x => x != newCharacter).map(x => x.character?.object.position).filter(x => !!x)
    const occupiedX = existingPositions.map(p => Math.round(p.x / spacing));

    let n = 0;
    while (true) {
        if (!occupiedX.includes(n)) return new THREE.Vector3(n * spacing, 0, 0);
        if (!occupiedX.includes(-n)) return new THREE.Vector3(-n * spacing, 0, 0);
        n++;
        if (n > 100) break;
    }
    return new THREE.Vector3(0, 0, 0);
}

export function displayProgress(
    text: string,
    detail?: { fileName?: string; loaded?: number; total?: number; phase?: string },
) {
    loadingProgressPanel.legacy(translateUiText(text), detail)
}

export function hideAllDemoItems() {
    document.body.classList.add('no-demo')
}

function showAnimationTimeline(durationSeconds: number, timeSeconds: number) {
    const duration = Math.max(0, durationSeconds)
    const currentTime = THREE.MathUtils.clamp(timeSeconds, 0, duration)
    const normalizedProgress = duration > 0 ? currentTime / duration : 0
    animationSlider.style.removeProperty('display')
    animationProgressValue.style.removeProperty('display')
    animationSlider.disabled = duration <= 0
    animationSlider.min = '0'
    animationSlider.max = duration.toString()
    animationSlider.step = '0.01'
    animationSlider.value = currentTime.toString()
    animationSlider.dataset.animationTime = currentTime.toFixed(4)
    animationSlider.dataset.animationDuration = duration.toFixed(4)
    animationSlider.dataset.animationProgress = normalizedProgress.toFixed(6)
    const progressLabel = `${Math.round(normalizedProgress * 100)}%`
    animationSlider.setAttribute('aria-valuetext', progressLabel)
    animationProgressValue.value = progressLabel
    animationProgressValue.textContent = progressLabel
}

function hideAnimationTimeline() {
    animationSlider.style.display = 'none'
    animationProgressValue.style.display = 'none'
}

function updateAnimationControls() {
    const character = scene.characterSelected?.character
    document.getElementById('character-animation-controls')!.hidden = !character
    if (!character) {
        animationPlayBtn.style.display = 'none'
        animationPauseBtn.style.display = 'none'
        hideAnimationTimeline()
        animationSpeed.disabled = true
        animationSpeed.value = '1'
        animationSpeedValue.value = '1.00×'
        animationSpeedValue.textContent = animationSpeedValue.value
        renderCharacterActionStatus()
        return
    }

    const animation = character.animation
    animationSpeed.disabled = false
    renderAnimationPlaybackRate(selectedAnimationPlaybackRate())
    const selectedAction = selectedCharacterActionOption()
    const repeatability = selectedAction ? characterActionsApi().repeatability(selectedAction.value) : { supported: true }
    animationRepetitions.disabled = !animationSelector.value || !repeatability.supported
    animationRepetitions.title = repeatability.reason || translateUiText('Total plays: blank uses default, 0 repeats forever')
    const applyButton = document.getElementById('animation-apply') as HTMLButtonElement
    applyButton.disabled = !animationSelector.value || Boolean(selectedAction?.disabled)
    const state = currentCatalogPlayback()
    animationSlider.dataset.activeAnimation = state?.actionId ?? animation.current ?? ''
    if (state) {
        setCharacterActionPlaybackState(state)
        const playing = state.status === 'playing'
        animationPlayBtn.style.display = playing ? 'none' : ''
        animationPauseBtn.style.display = playing ? '' : 'none'
        showAnimationTimeline(state.durationSeconds, state.timeSeconds)
    } else if (animation.current) {
        const playing = !animation.paused && !animation.clamped
        animationPlayBtn.style.display = playing ? 'none' : ''
        animationPauseBtn.style.display = playing ? '' : 'none'
        showAnimationTimeline(animation.duration, animation.time)
    } else {
        animationPlayBtn.style.display = 'none'
        animationPauseBtn.style.display = 'none'
        hideAnimationTimeline()
    }
}

function setupSingleCharacterTransformControls() {
    singleCharacterTransformControls = new TransformControls(scene.camera, scene.renderer.domElement)
    singleCharacterTransformControls.mode = 'translate'
    singleCharacterTransformControls.space = 'world'
    singleCharacterTransformControls.size = 0.85
    singleCharacterTransformControls.enabled = false
    singleCharacterTransformControlsHelper = singleCharacterTransformControls.getHelper()
    singleCharacterTransformControlsHelper.visible = false
    scene.scene.add(singleCharacterTransformControlsHelper)

    singleCharacterTransformControls.addEventListener('dragging-changed', event => {
        const dragging = Boolean(event.value)
        if (dragging) {
            singleCharacterTransformOrbitWasEnabled = scene.controls.enabled
            scene.controls.enabled = false
        } else if (!directPoseEditingEnabled) {
            scene.controls.enabled = singleCharacterTransformOrbitWasEnabled
        }
    })
    singleCharacterTransformControls.addEventListener('objectChange', () => {
        singleObjectTransformOnChange?.()
    })
}

function clearSingleCharacterTransform() {
    const wasActive = singleCharacterTransformActive
    singleCharacterTransformControls?.detach()
    if (singleCharacterTransformControls) singleCharacterTransformControls.enabled = false
    if (singleCharacterTransformControlsHelper) singleCharacterTransformControlsHelper.visible = false
    singleCharacterTransformActive = false
    singleObjectTransformOnChange = undefined
    if (wasActive && !directPoseEditingEnabled) scene.controls.enabled = singleCharacterTransformOrbitWasEnabled
    updateTransformModeButtons()
}

function closeObjectTransform() {
    clearSingleCharacterTransform()
    scene.transformControls.detach()
    scene.transformControls.enabled = false
    scene.transformControlsHelper.visible = false
    updateTransformModeButtons()
}

function activateObjectTransform(object: THREE.Object3D, onObjectChange?: () => void) {
    if (performanceExternalLeases.get(object)?.channels.root || performanceGizmoActive) return
    if (!singleCharacterTransformControls || !singleCharacterTransformControlsHelper) return
    if (singleCharacterTransformActive && singleCharacterTransformControls.object === object) {
        closeObjectTransform()
        return
    }
    scene.transformControls.detach()
    if (!singleCharacterTransformActive) singleCharacterTransformOrbitWasEnabled = scene.controls.enabled
    singleCharacterTransformActive = true
    singleObjectTransformOnChange = onObjectChange
    singleCharacterTransformControls.attach(object)
    singleCharacterTransformControls.enabled = true
    singleCharacterTransformControlsHelper.visible = true
    setTransformMode('translate')
}

function setTransformMode(mode: TransformControlsMode) {
    const controls = singleCharacterTransformActive && singleCharacterTransformControls
        ? singleCharacterTransformControls
        : scene.transformControls
    if (performanceGizmoActive || (controls.object && performanceExternalLeases.get(controls.object)?.channels.root)) return
    if (mode == 'rotate' && !controls.object?.userData.magiusIndependentWeapon) {
        controls.showX = false
        controls.showZ = false
    } else {
        controls.showX = true
        controls.showZ = true
    }
    controls.showY = true
    controls.mode = mode

    updateTransformModeButtons()
}

function updateTransformModeButtons() {
    transformTranslateBtn.style.display = 'none'
    transformRotateBtn.style.display = 'none'

    transformCloseBtn.hidden = !(singleCharacterTransformActive || (scene.characterSelectionVisible && scene.transformControls.object))
    if (scene.characterSelectionVisible && scene.transformControls.object || singleCharacterTransformActive) {
        const mode = singleCharacterTransformActive && singleCharacterTransformControls
            ? singleCharacterTransformControls.mode
            : scene.transformControls.mode
        if (mode == 'translate') {
            transformRotateBtn.style.removeProperty('display')
        } else {
            transformTranslateBtn.style.removeProperty('display')
        }
    }
}

Object.assign(window, { changeCharacter })
