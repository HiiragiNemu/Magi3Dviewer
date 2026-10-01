import { createTpsTargetMenu } from './tpsTargetMenu'
import { createCameraCornerControls } from './cameraCornerControls'
import { frameWholeObject, frameObjectInEditorArea, safePartFocusDistance } from './cameraFraming'
import { installOrbitTwoFingerGesture } from './OrbitTwoFingerGesture'
import { installContextRecovery } from './pageLifecycle'
import { readWorkspaceSession, writeWorkspaceSession, type WorkspaceSession } from './sessionWorkspace'
import { readLocal } from './poseWorkspace'
import { onPermanentPageExit } from './pageLifecycle'
import { setupCompactWorkspace, setupOrientationToggle } from './compactWorkspace'
import { createPoseWorkspacePanel } from './poseWorkspacePanel'
import { groupedPoseParts, structuralNodes, captureModelLocal, writeLocal, PlacementHistory, StructurePoseTarget, makeSavedPose, savePoseLibrary, resolveSavedPose, type PoseNodeGroup, type LocalTransform } from './poseWorkspace'
import { normalizeViewerEntry } from './entryCoherence'
import './style/viewport-editor.css'
import './style/tps-touch.css'
import { createViewportPoseEditor } from './viewportPoseEditor'
import { EditorGroundGuard } from './editorGround'
import { createPoseContactGuard } from './poseContactGuard'
import { registerPoseJointLimits, clampPoseJoint, poseJointLimitSnapshot } from './poseJointLimits'
import { installPoseDiagnostics } from './poseDiagnostics'
import { createDirectPoseTools, canonicalPoseBone, DirectPoseHistory, type PosePart, type PoseSnapshot } from './directPoseTools'
import { DirectPoseTarget } from './directPoseTarget'
import { addBeforeAnimationLoop, removeBeforeAnimationLoop, getClockDelta } from '../../magia-exedra-character-three/renderer'
import { ObjectMovementSelection, pickMovementTarget, visiblePickMeshes, type MovementTarget } from './objectMovementSelection'
import { setupWeaponPanel } from './weaponPanel'
import { setupFloatingPanelDrag } from './floatingPanelInteraction'
import { getNonBattleExpressionRuntime } from '../../magia-exedra-character-three/nonBattleExpressionRuntime.ts'
import { createLoadingProgressPanel } from './loadingProgressPanel'
import { createViewportFraming } from './performanceEditor/viewportFraming'
import { mountPerformanceStudio } from './performanceEditor/studio'
import { PerformanceRecorder } from './performanceEditor/recorder'
import type { RecordedActor } from './performanceEditor/recordings'
import { StableGarmentContacts, GARMENT_CONTACT_SETTING, GARMENT_DAMPING_SETTING, DEFAULT_GARMENT_HALF_LIFE } from './garmentContacts'
import { PoseGravityPreview } from './poseGravityPreview'
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
import { translateBoneChannelLabel, translateMorphChannelLabel, translateUiText, getUiLocale } from './localization/zhCN'
import { setupRuntimeSelectionPanels } from './runtimeSelectionPanels'
import { setupVoicePanel, type VoicePanelController, type VoicePanelWorkspaceCharacter } from './voicePanel'
import { createViewerVoiceWorkspaceRuntime } from './voiceWorkspaceRuntime'
import { mountPerformanceEditor, type ActorDescriptor, type ChannelSelection, type DragRequest } from './performanceEditor'
import { fetchVoiceCatalogManifest, VoiceCatalog } from './voice/catalog'
import { getViewerCharacterPhysicsAttachment } from './characterPhysics'
import type { VoicePoseAvailability, VoicePoseChannelLease } from './voice/poseChannels'
import {
    loadStageById,getCurrentStageDefinition,setupStageSelector,
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
    isViewerLocomotionEnabled, adoptViewerCamera, rotateViewerCameraPlane, canControlViewerActor,
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
const editorGround = new EditorGroundGuard(() => scene.backgroundScene.getObjectByName('Magius3DviewerStageRoot'))
const movementSelection = new ObjectMovementSelection(object => !!performanceExternalLeases.get(object)?.channels.root, object => { editorGround.constrainObject(object) })
let weaponPanelController: ReturnType<typeof setupWeaponPanel> | undefined
function selectMovementTarget(target: MovementTarget) {
    if (movementSelection.current?.object !== target.object) {
        if (directPoseEditingEnabled) setDirectPoseEditing(false)
        closeObjectTransform()
    }
    placementHistory(target.object)
    movementSelection.select(target)
    updateMovementTargetLabel()
    if (poseStructurePanel) { rebuildActionParameterChannels(); rebuildModelPartVisibilityControls(); updateDirectPoseUi() }
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
    if (directPoseSelection?.object===object || (directPoseEditingEnabled && getPoseActor()===object)) setDirectPoseEditing(false)
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
    bone: THREE.Object3D
    offsets: THREE.Vector3
    positionOffsets: THREE.Vector3
    lastBase?: THREE.Quaternion
    lastApplied?: THREE.Quaternion
    lastBasePosition?: THREE.Vector3
    lastAppliedPosition?: THREE.Vector3
    scaleFactors?: THREE.Vector3
    lastBaseScale?: THREE.Vector3
    lastAppliedScale?: THREE.Vector3
    unrestricted?: boolean
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
    startHandleQuaternion: THREE.Quaternion
    startWorldPosition: THREE.Vector3
    viewportWidth: number
    viewportHeight: number
    lastX: number
    lastY: number
    altKey: boolean
    shiftKey: boolean
    dirty: boolean
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
let directPoseGizmoPointerId: number | undefined
let directPoseFeedbackPending = false
let directPoseTarget: DirectPoseTarget | StructurePoseTarget | undefined
let directPoseInputRoot: THREE.Group | undefined
const directPoseDragBases = new Map<THREE.Object3D, THREE.Quaternion>()
let directPoseFinishing = false
let viewportEditor: ReturnType<typeof createViewportPoseEditor> | undefined
let directPoseToolsUi: ReturnType<typeof createDirectPoseTools> | undefined
const directPoseHistories = new WeakMap<THREE.Object3D, DirectPoseHistory>()
const poseActorCapabilities=new WeakMap<THREE.Object3D,boolean>()
let poseNodeGroup: PoseNodeGroup = 'primary'
let poseAllowStretch = false
const poseOrigins = new WeakMap<THREE.Object3D, Map<string,LocalTransform>>()
const poseFrozenBases = new WeakMap<THREE.Object3D, Map<string,LocalTransform>>()
const placementHistories = new WeakMap<THREE.Object3D,PlacementHistory>()
const poseDragTransforms = new Map<THREE.Object3D,LocalTransform>()
let poseStructurePanel: ReturnType<typeof installPoseWorkspacePanel> | undefined
let directPoseKeepOrientation = false
let directPoseBendEditing = false
let performanceGizmoFlush: (() => void) | undefined
let objectTransformUiPending = false
let nextDirectPoseAnimationUiAt = 0
let recordPoseDiagnosticFrame = () => {}
let directPoseEditingEnabled = false
// Joint movement is length-preserving IK. Root placement stays in the object
// editor; the input handle is independent of the animated skeleton.
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
let performanceRecorder: PerformanceRecorder | undefined
const studioAdoptedExpressions=new WeakSet<THREE.Object3D>()
const poseGravity = new PoseGravityPreview()
const garmentContacts = new Map<THREE.Object3D, StableGarmentContacts>()
const garmentPreparing = new Set<THREE.Object3D>()
const garmentContactsAvailable = import.meta.env.VITE_MAGIUS_GARMENT_CONTACTS !== 'off'
let garmentContactsEnabled = garmentContactsAvailable
let garmentRecoveryHalfLife=DEFAULT_GARMENT_HALF_LIFE
try { const saved=Number(localStorage.getItem(GARMENT_DAMPING_SETTING));if(Number.isFinite(saved)&&saved>=.04&&saved<=.3)garmentRecoveryHalfLife=saved } catch {}
try { if(localStorage.getItem(GARMENT_CONTACT_SETTING)==='off')garmentContactsEnabled=false } catch { /* privacy mode */ }
function setGarmentContactsEnabled(value:boolean){
    value=Boolean(value&&garmentContactsAvailable);garmentContactsEnabled=value
    if(!value)for(const solver of garmentContacts.values())solver.restore(true)
    try{localStorage.setItem(GARMENT_CONTACT_SETTING,value?'on':'off')}catch{}
    const input=document.getElementById('garment-contacts-enabled') as HTMLInputElement|null;if(input)input.checked=value
}
function warmGarmentContacts(object:THREE.Object3D){
    if(!garmentContactsAvailable||garmentContacts.has(object)||garmentPreparing.has(object))return
    garmentPreparing.add(object)
    const prepare=()=>{garmentPreparing.delete(object);if(!scene.characters.some(s=>s.character?.object===object))return;try{const solver=new StableGarmentContacts(object);solver.setRecoveryHalfLife(garmentRecoveryHalfLife);garmentContacts.set(object,solver)}catch(error){console.warn('Garment contact capability unavailable',error)}}
    if('requestIdleCallback' in window)window.requestIdleCallback(prepare,{timeout:1500});else setTimeout(prepare,200)
}
function restoreStudioOutputs(){performanceRecorder?.restore();for(const contact of garmentContacts.values())contact.restore()}
function preparePoseGravity(){
    if(!poseGravity.enabled)return
    poseGravity.prepare(scene.characters.flatMap(slot=>{
        const character=slot.character;if(!character||slot.removed)return[]
        const object=character.object,frozen=poseFrozenBases.get(object),generation=slot.loadGeneration??0
        return[{object,generation,current:()=>slot.character===character&&!slot.removed&&!character.disposed,
            frozen:!!frozen&&character.animation.paused&&!performanceRecorder?.ownsMotion(object),
            inputs:[...manualPoseByCharacter.get(object)?.values()??[]].filter(entry=>!isPerformanceBoneLeased(entry.bone)).map(entry=>({node:entry.bone,
                manual:entry.offsets.lengthSq()>1e-12||entry.positionOffsets.lengthSq()>1e-12||!!entry.scaleFactors||directPoseSelection?.entry===entry,
                apply:()=>{const base=frozen?.get(entry.bone.uuid);if(!base)return;writeLocal(entry.bone,base);entry.lastApplied=entry.lastAppliedPosition=entry.lastAppliedScale=undefined;applyPoseEntry(entry)},
            }))}]
    }))
}
function updateGarmentContacts(deltaSeconds=0){
    for(const slot of scene.characters){const character=slot.character;if(!character)continue
        const object=character.object,active=garmentContactsEnabled&&!performanceRecorder?.ownsMotion(object)&&(
            (isViewerLocomotionEnabled()&&scene.characterSelected===slot)||
            (poseFrozenBases.has(object)?poseGravity.enabled:/walk|run|jump|airborne|land/i.test(character.animation.current??'')))
        if(active)warmGarmentContacts(object)
        garmentContacts.get(object)?.solve(active,node=>{if(isPerformanceBoneLeased(node))return true;const entry=manualPoseByCharacter.get(object)?.get(node.uuid);return !!entry&&(entry.offsets.lengthSq()>1e-12||entry.positionOffsets.lengthSq()>1e-12||!!entry.scaleFactors||directPoseSelection?.entry===entry)},deltaSeconds)
    }
    for(const [object,solver]of garmentContacts)if(!scene.characters.some(s=>s.character?.object===object)){solver.dispose();garmentContacts.delete(object)}
}
function updateGarmentSurfaces(){
    if(!garmentContactsEnabled)return
    for(const slot of scene.characters){const character=slot.character;if(!character)continue
        const object=character.object,active=performanceRecorder?.ownsMotion(object)||(isViewerLocomotionEnabled()&&scene.characterSelected===slot)||poseFrozenBases.has(object)||/walk|run|jump|airborne|land/i.test(character.animation.current??'')
        if(!active)continue;warmGarmentContacts(object)
        garmentContacts.get(object)?.projectSurface(node=>{
            if(!performanceRecorder?.ownsMotion(object)&&isPerformanceBoneLeased(node))return true
            const entry=manualPoseByCharacter.get(object)?.get(node.uuid)
            return !!entry&&(entry.offsets.lengthSq()>1e-12||entry.positionOffsets.lengthSq()>1e-12||!!entry.scaleFactors||directPoseSelection?.entry===entry)
        })
    }
}
function setupMotionContactOptions(){
    const section=document.createElement('section');section.id='motion-contact-options';section.dataset.i18nIgnore='true';section.style.cssText='display:grid;gap:6px;padding:8px;font-size:12px'
    const contact=document.createElement('input');contact.type='checkbox';contact.id='garment-contacts-enabled';contact.checked=garmentContactsEnabled;contact.disabled=!garmentContactsAvailable
    const contactLabel=document.createElement('label');contactLabel.append(contact,document.createTextNode('稳定防穿模（可单独关闭）'));contact.onchange=()=>setGarmentContactsEnabled(contact.checked)
    const gravity=document.createElement('input');gravity.type='checkbox';gravity.id='pose-gravity-enabled';gravity.disabled=!garmentContactsAvailable
    const gravityLabel=document.createElement('label');gravityLabel.append(gravity,document.createTextNode('自定义姿态重力预览（原生物理）'));gravity.onchange=()=>poseGravity.setEnabled(gravity.checked&&garmentContactsAvailable)
    const note=document.createElement('small');note.textContent='姿态重力默认关闭，保留固定姿态。开启后，仅未手动控制的头发、衣服、饰品继续原生物理；身体姿态不受碰撞改写；只对衣服做即时让位和平滑回落。'
    const recovery=document.createElement('input');recovery.type='range';recovery.min='40';recovery.max='300';recovery.step='10';recovery.id='garment-recovery-damping';recovery.value=String(Math.round(garmentRecoveryHalfLife*1000));recovery.disabled=!garmentContactsAvailable
    const recoveryValue=document.createElement('output');recoveryValue.textContent=recovery.value+' ms'
    const recoveryLabel=document.createElement('label');recoveryLabel.style.cssText='display:flex;align-items:center;gap:6px';recoveryLabel.append(document.createTextNode('衣服回落阻尼'),recovery,recoveryValue);recovery.setAttribute('aria-label','衣服回落阻尼（毫秒）');recovery.title='越大回落越平缓；不延迟手臂、腿推动衣服时的碰撞让位'
    recovery.oninput=()=>{garmentRecoveryHalfLife=Number(recovery.value)/1000;recoveryValue.textContent=recovery.value+' ms';for(const solver of garmentContacts.values())solver.setRecoveryHalfLife(garmentRecoveryHalfLife);try{localStorage.setItem(GARMENT_DAMPING_SETTING,String(garmentRecoveryHalfLife))}catch{}}
    section.append(contactLabel,recoveryLabel,gravityLabel,note)
    const dock=document.getElementById('advanced-controls-dock')!;(dock.querySelector('.floating-panel-scroll')??dock).append(section)
    Object.assign(window,{magiusGarmentContacts:{setEnabled:setGarmentContactsEnabled,evaluateOnce:()=>{updateGarmentContacts();updateGarmentSurfaces()},get enabled(){return garmentContactsEnabled},setPoseGravity:(value:boolean)=>{gravity.checked=Boolean(value&&garmentContactsAvailable);poseGravity.setEnabled(gravity.checked)},diagnostics:()=>({contacts:[...garmentContacts].map(([root,solver])=>({uuid:root.uuid,...solver.diagnostics})),gravity:poseGravity.diagnostics()})}})
}
function listRecordedActors():RecordedActor[]{
    const counts=new Map<string,number>(),result:RecordedActor[]=[]
    for(const slot of scene.characters){const character=slot.character;if(!character||slot.loading||slot.removed||character.disposed)continue
        const resourceId=String(character.userData.characterId),instance=counts.get(resourceId)??0;counts.set(resourceId,instance+1)
        result.push({object:character.object,actorKey:character.object.uuid,resourceId,instance,type:'character',generation:slot.loadGeneration??0,label:formatCharacterTrilingualName(resourceId,characters.getCharacterNameById(resourceId)),current:()=>slot.character===character&&!slot.removed&&!character.disposed})
    }
    const enemyCounts=new Map<string,number>()
    for(const enemy of enemyPanelController?.enemyResources.getInstances()??[]){const resourceId=String(enemy.entry.enemyMstId),instance=enemyCounts.get(resourceId)??0;enemyCounts.set(resourceId,instance+1);result.push({object:enemy.object,actorKey:enemy.object.uuid,resourceId,instance,type:'enemy',generation:0,label:'敌人 '+resourceId,current:()=>!!enemyPanelController?.enemyResources.getInstances().includes(enemy)})}
    return result
}

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
        if (directPoseSelection?.object === actor.object && bones.includes(directPoseSelection.entry.bone)) {
            clearDirectPoseSelection()
        }
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
    let pendingChange = false
    const flushChange = () => {
        if (!pendingChange || released) return
        pendingChange = false
        try { request.onChange(request.mode === 'ik' ? request.object.getWorldPosition(new THREE.Vector3()) : undefined) }
        catch (error) { release(); throw error }
    }
    performanceGizmoFlush = flushChange
    control.addEventListener('objectChange', () => { pendingChange = true })
    control.addEventListener('mouseUp', () => { try { flushChange(); request.onEnd() } finally { release() } })
    let released = false
    const release = () => {
        if (released) return
        released = true
        if (performanceGizmoFlush === flushChange) performanceGizmoFlush = undefined
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
    let layout: ReturnType<typeof mountPerformanceStudio> | undefined
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
        performanceRecorder = new PerformanceRecorder(editor.runtime,{
            scene:()=>getCurrentStageDefinition()?.id,loadScene:async id=>{await setupStageSelector();const select=document.getElementById('stage-selector') as HTMLSelectElement;const option=[...select.options].find(o=>o.value===id);if(!option||option.disabled)throw Error('项目场景当前不可加载：'+id);if(getCurrentStageDefinition()?.id!==id)await loadStageById(id);if(getCurrentStageDefinition()?.id!==id)throw Error('项目场景加载失败，保留现有项目：'+id)},
            actors:listRecordedActors,camera:()=>({camera:scene.camera,target:scene.controls.target}),
            select:actor=>{const slot=scene.characters.find(s=>s.character?.object===actor.object);if(slot&&slot!==scene.characterSelected)selectCharacter(slot);else{const enemy=enemyPanelController?.enemyResources.getInstances().find(e=>e.object===actor.object);if(enemy)enemyPanelController?.selectInstance(enemy.instanceId)}},
            playback:()=>{if(isViewerLocomotionEnabled())setViewerLocomotionEnabled(false);setDirectPoseEditing(false);closeObjectTransform()},
            stopInput:()=>{if(isViewerLocomotionEnabled())setViewerLocomotionEnabled(false)},
            syncRoot:actor=>{teleportViewerCharacter(actor.object,actor.object.position.clone(),actor.object.quaternion.clone())},
            releaseCamera:()=>{adoptViewerCamera();if(!isViewerLocomotionEnabled()&&!directPoseGizmoDragging)scene.controls.enabled=true},
            beforeCapture:finishDirectPoseDrag,
            adoptPose:(actor,kinds)=>{
                finishDirectPoseDrag()
                const object=actor.object,character=scene.characters.find(s=>s.character?.object===object)?.character
                if(kinds.includes('motion')){
                    const snapshot=captureModelLocal(object)
                    getPoseEntries(object).forEach(entry=>{entry.offsets.set(0,0,0);entry.positionOffsets.set(0,0,0);entry.scaleFactors=undefined;entry.lastApplied=entry.lastBase=undefined;entry.lastAppliedPosition=entry.lastBasePosition=undefined;entry.lastAppliedScale=entry.lastBaseScale=undefined;entry.unrestricted=false})
                    poseOrigins.set(object,snapshot);poseFrozenBases.set(object,snapshot)
                    if(character)character.animation.paused=true
                    else enemyPanelController?.enemyResources.getInstances().find(e=>e.object===object)?.setAnimationPaused(true)
                    teleportViewerCharacter(object,object.position.clone(),object.quaternion.clone())
                    for(const [id,pose]of snapshot){const entry=manualPoseByCharacter.get(object)?.get(id);if(entry)writeLocal(entry.bone,pose)}
                }
                if(kinds.includes('expression')){
                    const meshes=getMorphTargetMeshes(object),map=new Map<string,ManualMorphEntry>()
                    for(const mesh of meshes)for(const[name,index]of Object.entries(mesh.morphTargetDictionary)){
                        const value=mesh.morphTargetInfluences[index]??0;let entry=map.get(name);if(!entry){entry={value,baselineByMesh:new Map()};map.set(name,entry)}entry.baselineByMesh.set(mesh,value)
                    }
                    manualMorphsByCharacter.set(object,map);studioAdoptedExpressions.add(object)
                }
                rebuildActionParameterChannels();rebuildExpressionParameterChannels();updateDirectPoseUi()
            },
            loadActors:async targets=>{for(const target of targets){if(target.type==='enemy'){if(!enemyPanelController)throw Error('敌人资源管理器尚未就绪');while(listRecordedActors().filter(a=>a.type==='enemy'&&a.resourceId===target.resourceId).length<=target.instance)await enemyPanelController.enemyResources.addEnemy(Number(target.resourceId),scene.scene);enemyPanelController.refreshInstances();continue}while(listRecordedActors().filter(a=>a.type==='character'&&a.resourceId===target.resourceId).length<=target.instance)await addOrChangeCharacter(target.resourceId)}notifyPerformanceActors()},
        })
        layout = mountPerformanceStudio({
            panel:editor.panel,toggle,recorder:performanceRecorder,
            selected:()=>scene.characterSelected?.character?.object.uuid,
            pose:()=>setDirectPoseEditing(true),
            expression:()=>{if(!expressionPanel.classList.contains('is-open'))expressionPanelToggle.click()},
            tps:()=>setViewerLocomotionEnabled(!isViewerLocomotionEnabled()),
            focus:()=>{
                const bounds=new THREE.Box3();for(const actor of listRecordedActors())bounds.union(editorGround.visualBounds(actor.object));if(bounds.isEmpty())return
                const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),rect=scene.renderer.domElement.getBoundingClientRect(),top=Math.max(0,(document.getElementById('menu')?.getBoundingClientRect().bottom??0)-rect.top),bottom=parseFloat(document.body.style.getPropertyValue('--studio-reserved-height'))||0
                const tangent=Math.tan(THREE.MathUtils.degToRad(scene.camera.fov)/2),fraction=Math.max(.28,(rect.height-top-bottom)/rect.height),distance=Math.max(size.y/(2*tangent*fraction*.78),size.x/(2*tangent*scene.camera.aspect*.8),size.z*1.6,1)
                const direction=scene.camera.getWorldDirection(new THREE.Vector3()).negate(),up=new THREE.Vector3(0,1,0).applyQuaternion(scene.camera.quaternion)
                scene.controls.target.copy(center).addScaledVector(up,(top-bottom)/rect.height*tangent*distance);scene.camera.position.copy(scene.controls.target).addScaledVector(direction,distance)
                scene.camera.updateMatrixWorld(true);adoptViewerCamera()
            },
            onOpenChange:()=>{framing?.setEnabled(false);jointNodes?.setEnabled(false)},
        })
        Object.assign(window,{magiusPerformanceStudio:{recorder:performanceRecorder,runtime:editor.runtime,open:()=>layout?.setOpen(true),close:()=>layout?.setOpen(false)}})
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
        performanceRecorder?.dispose();performanceRecorder=undefined
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
setupOrientationToggle(fullscreenBtn)

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
    onPermanentPageExit(() => weaponPanel.dispose())
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
    setupDirectPoseTools()
    setupViewportEditor()
    poseStructurePanel=installPoseWorkspacePanel()
    recordPoseDiagnosticFrame = installPoseDiagnostics(scene, () => directPoseEditingEnabled?directPoseControls:singleCharacterTransformActive?singleCharacterTransformControls:scene.transformControls, () => ({
        mode: directPoseTransformMode, editing: directPoseEditingEnabled,
        solves: directPoseTarget?.solves ?? 0, pending: directPoseTarget?.pending ?? false,
    }))
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

    setupMotionContactOptions()
    addBeforeAnimationLoop(restoreStudioOutputs)
    addBeforeAnimationLoop(restoreManualPoseOverrides)
    addBeforeAnimationLoop(preparePoseGravity)
    scene.animateLoopCallback = animateLoop

    onPermanentPageExit(() => {
        removeBeforeAnimationLoop(restoreStudioOutputs)
        removeBeforeAnimationLoop(preparePoseGravity)
        poseGravity.dispose();for(const contact of garmentContacts.values())contact.dispose();garmentContacts.clear()
        removeBeforeAnimationLoop(restoreManualPoseOverrides)
        finishDirectPoseDrag()
        directPoseToolsUi?.dispose()
        viewportEditor?.dispose()
        editorGround.dispose()
        directPoseControls?.dispose()
        directPoseControlsHelper?.removeFromParent()
        directPoseInputRoot?.removeFromParent()
        disposePerformanceEditorUi?.()
        characterPhysicsActionOptionsUi?.dispose()
        characterPhysicsActionOptionsUi = undefined
        void voicePanelController?.dispose()
    })

    scene.transformControls.addEventListener('objectChange', () => { objectTransformUiPending = true })

    setupSessionWorkspace()
    void tryChangeCharacterByHash()

    stats.dom.style.removeProperty('top')
    stats.dom.style.removeProperty('left')
    stats.dom.style.removeProperty('position')
    stats.dom.style.removeProperty('z-index')
    perfStatJsContainer.appendChild(stats.dom)
    setupCompactWorkspace(perfStatJsContainer.closest('#perf-stat') as HTMLElement)
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
    const value = clampAnimationPlaybackRate(playbackRate).toFixed(2)
    if (animationSpeed.value !== value) animationSpeed.value = value
    const text = value + '×'
    if (animationSpeedValue.value !== text) animationSpeedValue.value = text
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
    // catalog, but their playback state is owned by the character runtime. Do
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
        characterPhysicsActionOptionsUi?.refresh()
    }
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

    onPermanentPageExit(() => {
        characterActionRefreshToken++
        characterActionOperationToken++
        characterActionPendingId = undefined
        api.dispose()
        characterActionCatalogUnsubscribe?.()
        characterActionStateUnsubscribe?.()
        characterActionCatalogUnsubscribe = undefined
        characterActionStateUnsubscribe = undefined
    })
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
        setPositionControlsOpen(false)
        if(document.body.classList.contains('locomotion-mode-enabled'))setViewerLocomotionEnabled(false)
        const target=movementSelection.current
        const object=target?.object??scene.characterSelected?.character?.object
        if(!object)return
        setDirectPoseEditing(false)
        activateObjectTransform(object,target?.changed)
        setTransformMode('translate')
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
    registerPoseJointLimits(object)
    const existing = manualPoseByCharacter.get(object) ?? new Map<string, ManualPoseEntry>()
    const next = new Map<string, ManualPoseEntry>()
    const candidates = new Set(structuralNodes(object))
    object.traverse(child => {
        if (!candidates.has(child)) return
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
        if (!(child instanceof THREE.Mesh) || /:official-outline:|SelectionOutline/i.test(child.name)) return
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
    const object = getPoseActor()
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
    if (scrollSelected && selectedRow) {
        const y = selectedRow.offsetTop - actionModelPartList.offsetTop
        if (y < actionModelPartList.scrollTop || y + selectedRow.offsetHeight > actionModelPartList.scrollTop + actionModelPartList.clientHeight) actionModelPartList.scrollTop = y
    }

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
    const object = getPoseActor()
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
    const object = getPoseActor()
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
    const object = getPoseActor()
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

            const name = document.createElement('button')
            name.type = 'button'
            name.className = 'parameter-channel-name pose-bone-select'
            name.title = path
            name.textContent = displayLabel
            name.onclick = () => { setDirectPoseEditing(true); selectDirectPoseBone(object, entry.bone) }
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
                input.addEventListener('pointerdown', () => getDirectPoseHistory(object).begin(captureDirectPose(object)))
                input.addEventListener('change', () => commitDirectPoseHistory())
                input.addEventListener('input', () => {
                    getDirectPoseHistory(object).begin(captureDirectPose(object))
                    if (isPerformanceBoneLeased(entry.bone)) { input.value = entry.offsets[axis].toFixed(1); return }
                    entry.offsets[axis] = parseFloat(input.value)
                    output.value = `${entry.offsets[axis].toFixed(1)}°`
                    // The render loop applies the newest input once per frame.
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

function poseQuaternionMatches(a: THREE.Quaternion, b: THREE.Quaternion) {
    // Imported Float32 animation values need not have exactly unit length.
    // angleTo(q, q) can be nonzero; compare stored components without acos.
    const sign = a.dot(b) < 0 ? -1 : 1
    return (a.x - sign * b.x) ** 2 + (a.y - sign * b.y) ** 2
        + (a.z - sign * b.z) ** 2 + (a.w - sign * b.w) ** 2 < 1e-12
}

function applyPoseEntry(entry: ManualPoseEntry) {
    const changed=entry.offsets.lengthSq()>1e-12||entry.positionOffsets.lengthSq()>1e-12||!!entry.scaleFactors
    if(!changed&&!entry.lastApplied&&!entry.lastAppliedPosition&&!entry.lastAppliedScale)return
    if(isPerformanceBoneLeased(entry.bone))return
    if(entry.lastApplied&&entry.lastBase&&poseQuaternionMatches(entry.bone.quaternion,entry.lastApplied))entry.bone.quaternion.copy(entry.lastBase)
    if(entry.lastAppliedPosition&&entry.lastBasePosition&&entry.bone.position.distanceToSquared(entry.lastAppliedPosition)<1e-10)entry.bone.position.copy(entry.lastBasePosition)
    if(entry.lastAppliedScale&&entry.lastBaseScale&&entry.bone.scale.distanceToSquared(entry.lastAppliedScale)<1e-10)entry.bone.scale.copy(entry.lastBaseScale)
    entry.lastBase=entry.bone.quaternion.clone();entry.lastBasePosition=entry.bone.position.clone();entry.lastBaseScale=entry.bone.scale.clone()
    if(entry.offsets.lengthSq()>1e-12){
        const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(...entry.offsets.toArray().map(THREE.MathUtils.degToRad) as [number,number,number],'XYZ'))
        entry.bone.quaternion.multiply(rotation).normalize()
        if(!entry.unrestricted&&entry.bone instanceof THREE.Bone&&clampPoseJoint(entry.bone)){
            const limited=new THREE.Euler().setFromQuaternion(entry.lastBase.clone().invert().multiply(entry.bone.quaternion).normalize(),'XYZ')
            entry.offsets.set(THREE.MathUtils.radToDeg(limited.x),THREE.MathUtils.radToDeg(limited.y),THREE.MathUtils.radToDeg(limited.z))
        }
    }
    entry.bone.position.add(entry.positionOffsets)
    if(entry.scaleFactors)entry.bone.scale.multiply(entry.scaleFactors)
    entry.lastApplied=entry.bone.quaternion.clone();entry.lastAppliedPosition=entry.bone.position.clone();entry.lastAppliedScale=entry.bone.scale.clone()
}

function restoreManualPoseOverrides() {
    // This runs BEFORE native animation/physics, not merely before rendering.
    // Native writers must not read last frame's manual result as their base.
    for (const actor of getPoseActors()) {
        if (!actor.object) continue
        manualPoseByCharacter.get(actor.object)?.forEach(entry => {
            if (isPerformanceBoneLeased(entry.bone)) return
            if (entry.lastApplied && entry.lastBase && poseQuaternionMatches(entry.bone.quaternion, entry.lastApplied)) entry.bone.quaternion.copy(entry.lastBase)
            if (entry.lastAppliedPosition && entry.lastBasePosition && entry.bone.position.distanceToSquared(entry.lastAppliedPosition)<1e-10) entry.bone.position.copy(entry.lastBasePosition)
            if (entry.lastAppliedScale && entry.lastBaseScale && entry.bone.scale.distanceToSquared(entry.lastAppliedScale)<1e-10) entry.bone.scale.copy(entry.lastBaseScale)
            entry.lastApplied = undefined
            entry.lastAppliedPosition = entry.lastAppliedScale = undefined
        })
    }
}

function applyManualPoseOverrides() {
    // Snapshot editing must not let continuing spring simulation change the
    // reference beneath a saved pose. Resuming playback releases the snapshot.
    for(const actor of getPoseActors()){
        const object=actor.object;if(!object)continue
        const frozen=poseFrozenBases.get(object);if(!frozen)continue
        if(!actor.paused||(scene.characterSelected?.character?.object===object&&document.body.classList.contains('locomotion-mode-enabled'))){poseFrozenBases.delete(object);continue}
        manualPoseByCharacter.get(object)?.forEach(entry=>{
            const base=frozen.get(entry.bone.uuid);if(!base||isPerformanceBoneLeased(entry.bone))return
            writeLocal(entry.bone,base);entry.lastApplied=undefined;entry.lastAppliedPosition=entry.lastAppliedScale=undefined
            applyPoseEntry(entry)
        })
    }
    syncDirectPoseOffsetsFromBone()
    for (const actor of getPoseActors()) {
        const object = actor.object
        if (object) manualPoseByCharacter.get(object)?.forEach(applyPoseEntry)
    }
    // Never feed a solved bone back into the active input handle.
    directPoseTarget?.sync()
}

function resetActionParameters() {
    finishDirectPoseDrag();const object=getPoseActor();if(!object)return
    ensurePoseOrigin(object)
    const history=getDirectPoseHistory(object);history.begin(captureDirectPose(object))
    getPoseEntries(object).forEach(entry=>{
        if(isPerformanceBoneLeased(entry.bone))return
        const initial=poseOrigins.get(object)?.get(entry.bone.uuid)
        if(initial)writeLocal(entry.bone,initial)
        entry.offsets.set(0,0,0);entry.positionOffsets.set(0,0,0);entry.scaleFactors=undefined
        entry.lastApplied=entry.lastBase=undefined;entry.lastAppliedPosition=entry.lastBasePosition=undefined;entry.lastAppliedScale=entry.lastBaseScale=undefined;entry.unrestricted=false
    })
    restoreModelPartVisibility(object);history.finish(captureDirectPose(object));directPoseTarget?.sync()
    rebuildActionParameterChannels();rebuildModelPartVisibilityControls();updateDirectPoseUi()
}

function getPoseEntryBase(entry: ManualPoseEntry) {
    if (
        entry.lastApplied
        && entry.lastBase
        && poseQuaternionMatches(entry.bone.quaternion, entry.lastApplied)
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
    const row = actionChannelList.querySelector<HTMLElement>(`[data-bone-uuid="${entry.bone.uuid}"]`)
    if (!row) return
    for (const axis of ['x', 'y', 'z'] as PoseAxis[]) {
        const input = row.querySelector<HTMLInputElement>(`input[data-pose-axis="${axis}"]`)
        const output = input?.nextElementSibling as HTMLOutputElement | null
        if (!input || !output) continue
        const value = THREE.MathUtils.clamp(entry.offsets[axis], -180, 180).toFixed(1)
        const label = `${entry.offsets[axis].toFixed(1)}°`
        if (input.value !== value) input.value = value
        if (output.value !== label) output.value = label
    }
}

function setDirectPoseTransformMode(mode: DirectPoseTransformMode) {
    finishDirectPoseDrag()
    directPoseTransformMode = mode
    if (directPoseSelection) {
        directPoseSelection.base = getPoseEntryBase(directPoseSelection.entry)
        directPoseSelection.basePosition = getPoseEntryPositionBase(directPoseSelection.entry)
    }
    if (directPoseControls) {
        directPoseControls.mode = directPoseTransformMode
        directPoseControls.space = mode === 'translate' ? 'world' : 'local'
        directPoseControls.showX = directPoseControls.showY = directPoseControls.showZ = true
        directPoseControls.enabled = directPoseEditingEnabled && Boolean(directPoseTarget)
            && (mode === 'rotate' || directPoseTarget?.canTranslate === true)
        if (directPoseControlsHelper) directPoseControlsHelper.visible = directPoseControls.enabled
    }
    updateDirectPoseUi()
}

/** Resolve the actual scene selection. A selected prop without a rig never
 * falls through to another character. Stable model keys allow two instances of
 * the same enemy to exchange a saved pose without sharing live state. */
function getPoseActor(): THREE.Object3D | undefined {
    const object=movementSelection.current?.object ?? scene.characterSelected?.character?.object
    if(!object)return undefined
    let editable=poseActorCapabilities.get(object)
    if(editable===undefined){editable=groupedPoseParts(object,'primary').length+groupedPoseParts(object,'hands').length+groupedPoseParts(object,'more').length>0;poseActorCapabilities.set(object,editable)}
    return editable?object:undefined
}
function getPoseModel(object:THREE.Object3D):string {
    const character=scene.characters.find(slot=>slot.character?.object===object)?.character
    if(character)return String(character.userData.characterId)
    const enemy=enemyPanelController?.enemyResources.getInstances().find(instance=>instance.object===object)
    return enemy?'enemy:'+enemy.entry.modelPrefabName:'object:'+object.name
}
function getPoseActors():Array<{object:THREE.Object3D;paused:boolean}> {
    return [
        ...scene.characters.flatMap(slot=>slot.character?[{object:slot.character.object,paused:slot.character.animation.paused}]:[]),
        ...(enemyPanelController?.enemyResources.getInstances()??[]).map(instance=>({object:instance.object,paused:instance.animationPaused})),
    ]
}
function pausePoseActor(object:THREE.Object3D):void {
    if(object===scene.characterSelected?.character?.object)pauseSelectedAnimation()
    else enemyPanelController?.enemyResources.getInstances().find(instance=>instance.object===object)?.setAnimationPaused(true)
}

function updateDirectPoseUi(_scrollSelected = false) {
    const object = getPoseActor()
    actionDirectEditToggle.disabled = !object
    actionDirectTranslate.disabled = !object || Boolean(directPoseTarget && !directPoseTarget.canTranslate)
    actionDirectRotate.disabled = !object
    actionDirectEditToggle.setAttribute('aria-pressed', String(directPoseEditingEnabled))
    actionDirectEditToggle.textContent = translateUiText(
        directPoseEditingEnabled ? 'Exit direct drag pose' : 'Direct drag pose',
    )
    actionDirectTranslate.setAttribute('aria-pressed', String(directPoseTransformMode === 'translate'))
    actionDirectRotate.setAttribute('aria-pressed', String(directPoseTransformMode === 'rotate'))
    actionDirectTranslate.textContent = translateUiText('Move XYZ') + ' (IK)'
    actionDirectTranslate.title = translateUiText('Drag the XYZ arrows, or drag the body part in the camera plane; hold Alt for depth')
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
    // Bone picks deliberately preserve every panel scroll position.

    updateDirectPoseTarget()
    updateModelPartVisibilityUi()
    directPoseToolsUi?.refresh()
    viewportEditor?.refresh()
    poseStructurePanel?.refresh()
}

function updateDirectPoseTarget() {
    let text: string
    if (!directPoseSelection) {
        text = translateUiText('Click a body part, then drag it or use the rotation rings')
    } else if (directPoseTransformMode === 'translate' && !directPoseTarget?.canTranslate) {
        text = translateBoneChannelLabel(directPoseSelection.entry.bone.name || 'Unnamed bone')
            + ' · ' + translateUiText('Joint translation is unavailable; use Root placement or IK target')
    } else {
        const entry = directPoseSelection.entry
        const values = directPoseTransformMode === 'translate'
            ? entry.bone.getWorldPosition(new THREE.Vector3()) : entry.offsets
        text = translateBoneChannelLabel(entry.bone.name || 'Unnamed bone')
            + (directPoseTransformMode === 'translate' ? ' · IK / XYZ · ' : ' · XYZ · ')
            + values.toArray().map(value => value.toFixed(2)).join(' / ')
    }
    if (actionDirectEditTarget.value !== text) actionDirectEditTarget.value = text
}

function requestDirectPoseFeedback() {
    if (directPoseFeedbackPending) return
    directPoseFeedbackPending = true
    requestAnimationFrame(() => {
        directPoseFeedbackPending = false
        if (!directPoseSelection) return
        const entries = manualPoseByCharacter.get(directPoseSelection.object)
        for (const bone of directPoseTarget?.editedBones ?? []) {
            const entry = entries?.get(bone.uuid)
            if (entry) syncPoseEntryControls(entry)
        }
        updateDirectPoseTarget()
    })
}

function selectDirectPoseBone(object: THREE.Object3D, bone: THREE.Object3D, _part?: THREE.Mesh) {
    let owner:THREE.Object3D|null=bone
    while(owner&&owner!==object)owner=owner.parent
    if(owner!==object||isPerformanceBoneLeased(bone))return
    finishDirectPoseDrag()
    const entries = manualPoseByCharacter.get(object)?.has(bone.uuid)
        ? manualPoseByCharacter.get(object)! : getPoseEntries(object)
    const entry = entries.get(bone.uuid)
    if (!entry || !directPoseControls || !directPoseControlsHelper) return
    directPoseTarget?.handle.removeFromParent()
    directPoseTarget = poseAllowStretch||!(bone instanceof THREE.Bone)
        ? new StructurePoseTarget(object,bone,poseAllowStretch,isPerformanceBoneLeased)
        : new DirectPoseTarget(object,bone,isPerformanceBoneLeased)
    if(directPoseTarget instanceof DirectPoseTarget)directPoseTarget.projectPosition = createPoseContactGuard(object, editorGround)
    entry.unrestricted = false
    directPoseTarget.preserveEndOrientation = directPoseKeepOrientation
    directPoseInputRoot?.add(directPoseTarget.handle)
    directPoseSelection = {
        object, entry, base: getPoseEntryBase(entry), basePosition: getPoseEntryPositionBase(entry),
    }
    // Joint selection is not whole-mesh visibility selection.
    selectModelPart(undefined)
    directPoseControls.attach(directPoseTarget.handle)
    directPoseControls.mode = directPoseTransformMode
    directPoseControls.space = directPoseTransformMode === 'translate' ? 'world' : 'local'
    directPoseControls.enabled = directPoseEditingEnabled
        && (directPoseTransformMode === 'rotate' || directPoseTarget.canTranslate)
    directPoseControlsHelper.visible = directPoseControls.enabled
    updateDirectPoseUi()
}

function clearDirectPoseSelection() {
    finishDirectPoseDrag()
    directPoseControls?.detach()
    if (directPoseControlsHelper) directPoseControlsHelper.visible = false
    directPoseTarget?.handle.removeFromParent()
    directPoseTarget = undefined
    directPoseDragBases.clear()
    directPoseSelection = undefined
    directPosePointerDrag = undefined
    directPoseGizmoDragging = false
    updateDirectPoseUi()
}

function setDirectPoseEditing(enabled: boolean) {
    if (enabled && performanceGizmoActive) return
    const object = getPoseActor()
    if (enabled && !object) return
    if (directPoseEditingEnabled === enabled) {
        updateDirectPoseUi()
        return
    }
    finishDirectPoseDrag()
    directPoseEditingEnabled = enabled
    document.body.classList.toggle('direct-pose-editing', enabled)
    if (enabled) {
        if (document.body.classList.contains('locomotion-mode-enabled')) setViewerLocomotionEnabled(false)
        closeObjectTransform()
        directPoseOrbitControlsWasEnabled = scene.controls.enabled
        directPoseOutlineSelection = [...scene.effects.outlinePass.selectedObjects]
        scene.effects.outlinePass.selectedObjects = []
        // Only an actual pointer drag leases Orbit input.
        scene.controls.enabled = true
        if (directPoseControls) directPoseControls.enabled = true
        // Pause the official action transport too, not only the legacy mixer.
        if(object)pausePoseActor(object)
        if(object)ensurePoseOrigin(object)
        if(object)freezePoseForEditing(object)
        if(object&&!groupedPoseParts(object,poseNodeGroup).length)poseNodeGroup=groupedPoseParts(object,'primary').length?'primary':'more'
    } else {
        clearDirectPoseSelection()
        if (directPoseControls) directPoseControls.enabled = false
        scene.effects.outlinePass.selectedObjects = directPoseOutlineSelection
        directPoseOutlineSelection = []
        scene.controls.enabled = directPoseOrbitControlsWasEnabled
    }
    updateDirectPoseUi()
}

function beginDirectPoseTransaction(): boolean {
    if (!directPoseSelection || !directPoseTarget?.begin(directPoseTransformMode)) return false
    const entries = manualPoseByCharacter.get(directPoseSelection.object)
    directPoseDragBases.clear(); poseDragTransforms.clear()
    for (const bone of directPoseTarget.editedBones) {
        const entry = entries?.get(bone.uuid)
        if (!entry) { directPoseTarget.end(); return false }
        directPoseDragBases.set(bone, getPoseEntryBase(entry))
        poseDragTransforms.set(bone,{p:getPoseEntryPositionBase(entry).toArray(),q:getPoseEntryBase(entry).toArray(),s:(entry.lastBaseScale??bone.scale).toArray()})
    }
    getDirectPoseHistory(directPoseSelection.object).begin(captureDirectPose(directPoseSelection.object))
    scene.controls.enabled = false
    return true
}

function syncDirectPoseOffsetsFromBone() {
    const target = directPoseTarget
    const selection = directPoseSelection
    if (!target || !selection) return
    if (getPoseActor() !== selection.object) {
        target.end()
        return
    }
    const drag = directPosePointerDrag
    if (drag?.dirty) {
        drag.dirty = false
        const dx = drag.lastX - drag.startX, dy = drag.lastY - drag.startY
        if (directPoseTransformMode === 'translate') {
            target.handle.position.copy(drag.startWorldPosition)
                .add(directPoseScreenTranslationDelta(drag, dx, dy, drag.altKey, drag.shiftKey))
        } else {
            const sensitivity = drag.shiftKey ? 0.18 : 0.35
            const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                THREE.MathUtils.degToRad(drag.altKey ? 0 : -dy * sensitivity),
                THREE.MathUtils.degToRad(drag.altKey ? dx * sensitivity : 0),
                THREE.MathUtils.degToRad(drag.altKey ? 0 : -dx * sensitivity), 'XYZ'))
            target.handle.quaternion.copy(drag.startHandleQuaternion).multiply(delta).normalize()
        }
        target.queue()
    }
    const changed = target.flush()
    if (!changed.length) return
    const entries = manualPoseByCharacter.get(selection.object)
    for (const bone of changed) {
        const entry = entries?.get(bone.uuid), base = directPoseDragBases.get(bone)
        if (!entry || !base) continue
        const delta = base.clone().normalize().invert().multiply(bone.quaternion).normalize()
        const angles = new THREE.Euler().setFromQuaternion(delta, 'XYZ')
        entry.offsets.set(THREE.MathUtils.radToDeg(angles.x), THREE.MathUtils.radToDeg(angles.y), THREE.MathUtils.radToDeg(angles.z))
        const local=poseDragTransforms.get(bone)
        if(directPoseTarget instanceof StructurePoseTarget&&local&&directPoseTarget.canTranslate){
            entry.positionOffsets.copy(bone.position).sub(new THREE.Vector3().fromArray(local.p))
            entry.lastBasePosition=new THREE.Vector3().fromArray(local.p);entry.lastAppliedPosition=bone.position.clone()
        }
        entry.unrestricted=false
        entry.lastBase = base.clone()
        entry.lastApplied = bone.quaternion.clone()
    }
    requestDirectPoseFeedback()
}

function captureDirectPose(object: THREE.Object3D): PoseSnapshot {
    const snapshot:PoseSnapshot=new Map()
    getPoseEntries(object).forEach(entry=>{
        snapshot.set(entry.bone.uuid,entry.offsets.toArray())
        snapshot.set(entry.bone.uuid+'/p',entry.positionOffsets.toArray())
        snapshot.set(entry.bone.uuid+'/s',(entry.scaleFactors??new THREE.Vector3(1,1,1)).toArray())
        snapshot.set(entry.bone.uuid+'/q',entry.bone.quaternion.toArray())
        snapshot.set(entry.bone.uuid+'/bp',getPoseEntryPositionBase(entry).toArray())
        snapshot.set(entry.bone.uuid+'/bs',(entry.lastBaseScale??entry.bone.scale).toArray())
        if(entry.unrestricted)snapshot.set(entry.bone.uuid+'/free',[1])
    });return snapshot
}

function getDirectPoseHistory(object: THREE.Object3D) {
    let history = directPoseHistories.get(object)
    if (!history) { history = new DirectPoseHistory(); directPoseHistories.set(object, history) }
    return history
}

function commitDirectPoseHistory() {
    const object = directPoseSelection?.object ?? getPoseActor()
    if (object) directPoseHistories.get(object)?.finish(captureDirectPose(object))
    directPoseToolsUi?.refresh()
}

function restoreDirectPose(snapshot: PoseSnapshot) {
    const object=getPoseActor();if(!object)return
    getPoseEntries(object).forEach(entry=>{
        if(isPerformanceBoneLeased(entry.bone))return
        entry.offsets.fromArray(snapshot.get(entry.bone.uuid)??[0,0,0])
        entry.positionOffsets.fromArray(snapshot.get(entry.bone.uuid+'/p')??[0,0,0])
        entry.scaleFactors=new THREE.Vector3().fromArray(snapshot.get(entry.bone.uuid+'/s')??[1,1,1])
        entry.unrestricted=!!snapshot.get(entry.bone.uuid+'/free')
        const q=snapshot.get(entry.bone.uuid+'/q')
        if(q){const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(...entry.offsets.toArray().map(THREE.MathUtils.degToRad) as [number,number,number]));entry.lastBase=new THREE.Quaternion().fromArray(q).multiply(rotation.invert());entry.bone.quaternion.copy(entry.lastBase);entry.lastApplied=undefined}
        entry.lastBasePosition=new THREE.Vector3().fromArray(snapshot.get(entry.bone.uuid+'/bp')??entry.bone.position.toArray())
        entry.lastBaseScale=new THREE.Vector3().fromArray(snapshot.get(entry.bone.uuid+'/bs')??entry.bone.scale.toArray())
        entry.bone.position.copy(entry.lastBasePosition);entry.bone.scale.copy(entry.lastBaseScale);entry.lastAppliedPosition=entry.lastAppliedScale=undefined
        applyPoseEntry(entry);syncPoseEntryControls(entry)
    });directPoseTarget?.sync();updateDirectPoseUi()
}

function undoDirectPose(redo = false) {
    finishDirectPoseDrag()
    const object = getPoseActor()
    if (!object) return
    const history = getDirectPoseHistory(object), current = captureDirectPose(object)
    const snapshot = redo ? history.redo(current) : history.undo(current)
    if (snapshot) restoreDirectPose(snapshot)
}

function setupDirectPoseTools() {
    directPoseToolsUi = createDirectPoseTools(actionDirectEditTarget.parentElement!, {
        translate: translateUiText,
        actor: () => getPoseActor(),
        selected: () => directPoseSelection?.entry.bone,
        history: () => { const object = getPoseActor(); return object && directPoseHistories.get(object) },
        enable: () => setDirectPoseEditing(true),
        select: part => {
            const object = getPoseActor()
            if (!object) return
            selectDirectPoseBone(object, part.bone)
            setDirectPoseTransformMode(part.mode)
        },
        undo: () => undoDirectPose(), redo: () => undoDirectPose(true),
        resetPart: resetViewportPosePart,
        placeActor: () => {
            const object=getPoseActor()
            if(!object)return
            setDirectPoseEditing(false)
            activateObjectTransform(object,movementSelection.current?.changed)
        },
        preserveOrientation: value => {
            finishDirectPoseDrag(); directPoseKeepOrientation = value
            if (directPoseTarget) directPoseTarget.preserveEndOrientation = value
        },
        bend: value => {
            if (!directPoseTarget?.canTranslate || !Number.isFinite(value)) return
            if (!directPoseBendEditing) {
                setDirectPoseTransformMode('translate')
                if (!beginDirectPoseTransaction()) return
                directPoseBendEditing = true
            }
            directPoseTarget.bendAngle = THREE.MathUtils.degToRad(value)
            directPoseTarget.queue()
        },
        bendEnd: () => { finishDirectPoseDrag(); if (directPoseTarget) directPoseTarget.bendAngle = 0 },
    })
    const shortcuts = (event: KeyboardEvent) => {
        if (!directPoseEditingEnabled || (event.target instanceof Element
            && event.target.closest('input,textarea,select,[contenteditable="true"]'))) return
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault(); undoDirectPose(event.shiftKey)
        } else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'w') {
            event.preventDefault(); setDirectPoseTransformMode('translate')
        } else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'e') {
            event.preventDefault(); setDirectPoseTransformMode('rotate')
        }
    }
    document.addEventListener('keydown', shortcuts)
    onPermanentPageExit(() => document.removeEventListener('keydown', shortcuts))
}

function resetViewportPosePart() {
    finishDirectPoseDrag();const object=directPoseSelection?.object;if(!object)return
    const history=getDirectPoseHistory(object);history.begin(captureDirectPose(object))
    for(const node of directPoseTarget?.editedBones??[]){const entry=manualPoseByCharacter.get(object)?.get(node.uuid),initial=poseOrigins.get(object)?.get(node.uuid);if(!entry||!initial||isPerformanceBoneLeased(node))continue;writeLocal(node,initial);entry.offsets.set(0,0,0);entry.positionOffsets.set(0,0,0);entry.scaleFactors=undefined;entry.lastApplied=entry.lastBase=undefined;entry.lastAppliedPosition=entry.lastBasePosition=undefined;entry.lastAppliedScale=entry.lastBaseScale=undefined}
    history.finish(captureDirectPose(object));directPoseTarget?.sync();updateDirectPoseUi()
}

function selectViewportPosePart(part: PosePart) {
    const object = getPoseActor()
    if (!object) return
    const sameJoint = directPoseEditingEnabled && directPoseSelection?.entry.bone === part.bone
    setDirectPoseEditing(true)
    selectDirectPoseBone(object, part.bone)
    if (!sameJoint) setDirectPoseTransformMode(part.mode)
}

function setupViewportEditor() {
    if (new URL(location.href).searchParams.get('diagnostic') === 'pose-editor') {
        Object.assign(window, { magiusGroundInspection: () => {
            const object = scene.characterSelected?.character?.object
            return object ? editorGround.inspect(object) : null
        }, magiusJointLimitInspection: () => {
            const snapshots: ReturnType<typeof poseJointLimitSnapshot>[] = []
            scene.characterSelected?.character?.object.traverse(node => {
                if (node instanceof THREE.Bone) {
                    const snapshot = poseJointLimitSnapshot(node)
                    if (snapshot) snapshots.push(snapshot)
                }
            })
            return snapshots
        } })
    }
    viewportEditor = createViewportPoseEditor({
        camera: () => scene.camera, canvas: scene.renderer.domElement, translate: translateUiText, locale: getUiLocale,
        state: () => ({ actor: getPoseActor(), object: movementSelection.current?.object,
            active: directPoseEditingEnabled || singleCharacterTransformActive || Boolean(scene.transformControls.object && scene.characterSelectionVisible),
            pose: directPoseEditingEnabled, mode: directPoseEditingEnabled ? directPoseTransformMode : (singleCharacterTransformActive ? singleCharacterTransformControls?.mode : scene.transformControls.mode) === 'rotate' ? 'rotate' : 'translate',
            selected: directPoseSelection?.entry.bone, group:poseNodeGroup, stretch:poseAllowStretch,
            history: directPoseEditingEnabled ? getPoseActor() && directPoseHistories.get(getPoseActor()!) : movementSelection.current && placementHistory(movementSelection.current.object),
            limited: directPoseTarget?.limited ?? false, canTranslate: !directPoseTarget || directPoseTarget.canTranslate }),
        place: mode => {
            if(document.body.classList.contains('locomotion-mode-enabled'))setViewerLocomotionEnabled(false)
            const target = movementSelection.current
            const object = target?.object ?? scene.characterSelected?.character?.object
            if (!object) return
            setDirectPoseEditing(false)
            if (!singleCharacterTransformActive || singleCharacterTransformControls?.object !== object) activateObjectTransform(object, target?.changed)
            setTransformMode(mode)
        },
        pose: () => { setDirectPoseEditing(true); setDirectPoseTransformMode('rotate') },
        mode: setDirectPoseTransformMode,
        group: setPoseNodeGroup,
        fineHost: actionPanel.querySelector('.floating-panel-scroll') as HTMLElement,
        resetAll: ()=>directPoseEditingEnabled?resetActionParameters():resetPlacement(),
        save: ()=>{if(!actionPanel.classList.contains('is-open'))actionPanelToggle.click();const library=document.getElementById('pose-library') as HTMLDetailsElement|null;if(library){library.open=true;library.scrollIntoView({block:'nearest'})}},
        close: () => { setDirectPoseEditing(false); closeObjectTransform() },
        parameters: () => { if (!actionPanel.classList.contains('is-open')) actionPanelToggle.click() },
        focus: () => {
            finishDirectPoseDrag()
            const object = directPoseEditingEnabled ? getPoseActor() : movementSelection.current?.object ?? scene.characterSelected?.character?.object
            if (!object) return
            const bounds = editorGround.visualBounds(object), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3())
            const direction = scene.camera.position.clone().sub(scene.controls.target).normalize()
            const canvasRect=scene.renderer.domElement.getBoundingClientRect()
            const editorArea=viewportEditor?.framingRect()
            if(editorArea&&frameObjectInEditorArea(scene.camera,scene.controls.target,bounds,canvasRect,editorArea)){
                const roll=scene.cameraRotation
                editorGround.constrainCamera(scene.camera,scene.controls);scene.controls.update();scene.cameraRotation=roll
                viewportEditor?.reposition();return
            }
            const top=Math.max(canvasRect.top,document.getElementById('menu')?.getBoundingClientRect().bottom??canvasRect.top)
            const visibleHeight=Math.max(120,canvasRect.bottom-top)
            const sideSpace=Math.min(104,Math.max(76,canvasRect.width*.215))+25
            const widthFraction=Math.max(.25,(canvasRect.width-sideSpace*2)/canvasRect.width)
            const heightFraction=visibleHeight/canvasRect.height
            const tangent=Math.tan(THREE.MathUtils.degToRad(scene.camera.fov)/2)
            const distance=Math.max(size.y/heightFraction,size.x/(scene.camera.aspect*widthFraction),size.z/scene.camera.aspect,.3)/(2*tangent*.74)
            const screenUp=new THREE.Vector3(0,1,0).applyQuaternion(scene.camera.quaternion)
            const offset=(top-canvasRect.top)/canvasRect.height*tangent*distance
            scene.controls.target.copy(center).addScaledVector(screenUp,offset)
            scene.camera.position.copy(scene.controls.target).addScaledVector(direction,distance)
            editorGround.constrainCamera(scene.camera, scene.controls)
            scene.camera.lookAt(scene.controls.target); scene.camera.updateMatrixWorld()
            scene.controls.update()
            viewportEditor?.reposition()
        },
        focusPart: parts=>{
            finishDirectPoseDrag()
            if(!parts.length)return
            const actor=getPoseActor();if(!actor)return
            const scale=actor.getWorldScale(new THREE.Vector3()).length()/Math.sqrt(3)
            let hand:THREE.Object3D|undefined
            for(let node:THREE.Object3D|null=parts[0].bone;node&&node!==actor;node=node.parent){if(/^(?:Hand|Wrist)_[LR]$/i.test(node.name)){hand=node;break}}
            const points=parts.map(p=>p.bone.getWorldPosition(new THREE.Vector3()))
            if(hand)hand.traverse(node=>{if(node instanceof THREE.Bone&&/finger|thumb|hand/i.test(node.name))points.push(node.getWorldPosition(new THREE.Vector3()))})
            const bounds=new THREE.Box3().setFromPoints(points),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3())
            const canvas=scene.renderer.domElement.getBoundingClientRect(),top=Math.max(canvas.top,document.getElementById('menu')?.getBoundingClientRect().bottom??0)
            const fraction=Math.max(.25,(canvas.bottom-top-130)/canvas.height),tangent=Math.tan(THREE.MathUtils.degToRad(scene.camera.fov)/2)
            const desiredDistance=Math.max(scene.camera.near*4,Math.max(size.length()*1.7,.17*scale)/(2*tangent*fraction*.55))
            // Approach a hand from outside the torso, not straight through the
            // chest. A hands-on-hips pose can otherwise hide every finger even
            // though the camera was mathematically centered on its joint.
            const torso=actor.getObjectByName('Chest')??actor
            const direction=hand?center.clone().sub(torso.getWorldPosition(new THREE.Vector3())):scene.camera.position.clone().sub(scene.controls.target)
            if(hand)direction.y=0
            if(direction.lengthSq()<1e-10)direction.copy(scene.camera.position).sub(scene.controls.target)
            direction.normalize();const up=new THREE.Vector3(0,1,0)
            const distance=safePartFocusDistance(center,direction,desiredDistance,editorGround.visualBounds(actor),scene.camera.near)
            scene.controls.target.copy(center).addScaledVector(up,(top-canvas.top-100)/canvas.height*tangent*distance)
            scene.camera.position.copy(scene.controls.target).addScaledVector(direction,distance);scene.controls.update();scene.camera.updateMatrixWorld(true)
        },
        select: selectViewportPosePart,
        begin: (part, event) => { selectViewportPosePart(part); return startDirectPosePointerDrag(event) },
        move: updateDirectPosePointerDrag, end: finishDirectPoseDrag,
        undo: () => directPoseEditingEnabled?undoDirectPose():undoPlacement(), redo: () => directPoseEditingEnabled?undoDirectPose(true):undoPlacement(true), reset: resetViewportPosePart,
        nudge: (axis, amount) => {
            finishDirectPoseDrag()
            const selection = directPoseSelection
            if (!selection || isPerformanceBoneLeased(selection.entry.bone)) return
            getDirectPoseHistory(selection.object).begin(captureDirectPose(selection.object))
            selection.entry.offsets[axis] += amount
            applyPoseEntry(selection.entry); syncPoseEntryControls(selection.entry)
            directPoseTarget?.sync(); commitDirectPoseHistory(); updateDirectPoseUi()
        },
    })
    scene.addBeforeRenderCallback(() => {
        const object = movementSelection.current?.object
        if (object && !performanceExternalLeases.get(object)?.channels.root && !document.body.classList.contains('locomotion-mode-enabled')) editorGround.constrainObject(object)
        editorGround.constrainCamera(scene.camera, scene.controls)
        viewportEditor?.update()
    })
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
    const object = getPoseActor()
    if (!object) return undefined
    const rect = scene.renderer.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(pointer, scene.camera)
    const entries = manualPoseByCharacter.get(object) ?? getPoseEntries(object)

    for (const intersection of raycaster.intersectObjects(visiblePickMeshes(object), false)) {
        if (!(intersection.object instanceof THREE.SkinnedMesh) || !intersection.face) continue
        const mesh = intersection.object
        let visible = true
        for (let owner: THREE.Object3D | null = mesh; owner; owner = owner.parent) visible &&= owner.visible
        if (!visible || /:official-outline:/i.test(mesh.name)) continue
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
        let bone:THREE.Object3D|undefined = dominant == undefined ? undefined : canonicalPoseBone(mesh.skeleton.bones[dominant])
        const mainParts = groupedPoseParts(object,poseNodeGroup)
        while (bone && !mainParts.some(part => part.bone === bone)) bone = bone.parent instanceof THREE.Bone ? bone.parent : undefined
        if (bone && entries.has(bone.uuid)) return { object, bone, part: mesh }
    }
    return undefined
}

function directPoseScreenTranslationDelta(
    drag: DirectPosePointerDrag, dx: number, dy: number, depth: boolean, fine: boolean,
) {
    const camera = scene.camera
    const scale = fine ? 0.25 : 1
    const origin = drag.startWorldPosition.clone().project(camera)
    const point = origin.clone()
    point.x += dx * scale / Math.max(1, drag.viewportWidth) * 2
    point.y -= dy * scale / Math.max(1, drag.viewportHeight) * 2
    const delta = point.unproject(camera).sub(drag.startWorldPosition)
    if (depth) {
        const onePixel = origin.clone()
        onePixel.y += 2 / Math.max(1, drag.viewportHeight)
        const unitsPerPixel = onePixel.unproject(camera).distanceTo(drag.startWorldPosition)
        delta.copy(camera.getWorldDirection(new THREE.Vector3())).multiplyScalar(-dy * scale * unitsPerPixel)
    }
    return delta
}

function finishDirectPoseDrag(event?: PointerEvent) {
    if (directPoseFinishing) return
    const pointerId = directPosePointerDrag?.pointerId ?? directPoseGizmoPointerId
    if (event && pointerId !== undefined && event.pointerId !== pointerId) return
    if (pointerId === undefined && !directPoseControls?.dragging && !directPoseTarget?.dragging) return
    directPoseFinishing = true
    try {
        // A release can precede RAF: commit the last queued sample exactly once.
        syncDirectPoseOffsetsFromBone()
        directPosePointerDrag = undefined
        directPoseGizmoPointerId = undefined
        if (directPoseControls?.dragging) directPoseControls.pointerUp(null)
        directPoseGizmoDragging = false
        directPoseTarget?.end()
        directPoseBendEditing = false
        commitDirectPoseHistory()
        const canvas = scene.renderer.domElement
        if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
        scene.controls.enabled = directPoseOrbitControlsWasEnabled
    } finally { directPoseFinishing = false }
}

function startDirectPosePointerDrag(event: PointerEvent): boolean {
    if (!directPoseSelection || !directPoseTarget || !beginDirectPoseTransaction()) return false
    const rect = scene.renderer.domElement.getBoundingClientRect()
    directPosePointerDrag = {
        pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
        lastX: event.clientX, lastY: event.clientY, altKey: event.altKey, shiftKey: event.shiftKey, dirty: false,
        startHandleQuaternion: directPoseTarget.handle.quaternion.clone(), startWorldPosition: directPoseTarget.handle.position.clone(),
        viewportWidth: rect.width, viewportHeight: rect.height, selection: directPoseSelection,
    }
    return true
}

function updateDirectPosePointerDrag(event: PointerEvent) {
    const drag = directPosePointerDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    if (isPerformanceBoneLeased(drag.selection.entry.bone)) { finishDirectPoseDrag(event); return }
    drag.lastX = event.clientX; drag.lastY = event.clientY
    drag.altKey = event.altKey; drag.shiftKey = event.shiftKey; drag.dirty = true
    event.preventDefault(); event.stopPropagation()
}

function setupDirectPoseEditing() {
    const canvas = scene.renderer.domElement
    // Keep the control's parent small: Three updates object.parent on pointer
    // down; it must not traverse the entire stage or the animated skeleton.
    directPoseInputRoot = new THREE.Group()
    directPoseInputRoot.name = 'MagiusDirectPoseInputRoot'
    scene.scene.add(directPoseInputRoot)
    directPoseControls = new TransformControls(scene.camera, canvas)
    directPoseControls.mode = directPoseTransformMode
    directPoseControls.space = 'local'
    directPoseControls.size = 0.72
    directPoseControls.enabled = false
    directPoseControlsHelper = directPoseControls.getHelper()
    directPoseControlsHelper.visible = false
    scene.scene.add(directPoseControlsHelper)
    actionDirectEditTarget.setAttribute('data-i18n-ignore', 'true')
    directPoseControls.addEventListener('dragging-changed', event => {
        directPoseGizmoDragging = Boolean(event.value)
        if (event.value) {
            if (!beginDirectPoseTransaction()) { directPoseControls?.pointerUp(null); return }
        } else {
            syncDirectPoseOffsetsFromBone()
            directPoseTarget?.end()
            commitDirectPoseHistory()
        }
        scene.controls.enabled = !event.value && directPoseOrbitControlsWasEnabled
    })
    directPoseControls.addEventListener('objectChange', () => {
        if (directPoseGizmoDragging) directPoseTarget?.queue()
    })
    canvas.addEventListener('pointerdown', event => {
        if (!directPoseEditingEnabled || event.button !== 0 || event.ctrlKey || event.metaKey) return
        const owner = directPosePointerDrag?.pointerId ?? directPoseGizmoPointerId
        if (owner !== undefined) { event.stopImmediatePropagation(); return }
        const rect = canvas.getBoundingClientRect()
        directPoseControls?.pointerHover({ x: (event.clientX - rect.left) / rect.width * 2 - 1, y: -(event.clientY - rect.top) / rect.height * 2 + 1, button: 0 } as unknown as PointerEvent)
        if (directPoseControls?.axis && directPoseControls.enabled) {
            directPoseGizmoPointerId = event.pointerId
            scene.controls.enabled = false
            return // TransformControls receives its normal event, not Orbit.
        }
        const weighted = getWeightedBoneAtPointer(event)
        if (!weighted || isPerformanceBoneLeased(weighted.bone)) return // Empty space stays Orbit.
        const changedJoint = directPoseSelection?.entry.bone !== weighted.bone
        selectDirectPoseBone(weighted.object, weighted.bone)
        if (changedJoint && directPoseTransformMode === 'translate' && !directPoseTarget?.canTranslate) setDirectPoseTransformMode('rotate')
        if (!startDirectPosePointerDrag(event)) return
        canvas.setPointerCapture(event.pointerId)
        event.preventDefault(); event.stopImmediatePropagation()
    }, { capture: true })
    canvas.addEventListener('pointermove', updateDirectPosePointerDrag)
    const stopPointerDrag = (event: PointerEvent) => finishDirectPoseDrag(event)
    canvas.addEventListener('pointerup', stopPointerDrag)
    canvas.addEventListener('pointercancel', stopPointerDrag)
    canvas.addEventListener('lostpointercapture', stopPointerDrag)
    canvas.addEventListener('pointermove', event => {
        if (event.pointerType === 'mouse' && event.buttons === 0) finishDirectPoseDrag(event)
    }, { capture: true })
    window.addEventListener('blur', () => finishDirectPoseDrag())
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
        for (const [name, entry] of overrides) {
            for (const mesh of entry.baselineByMesh.keys()) {
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
function resetSelectedCharacterTransform() { const object=movementSelection.current?.object;if(object)placementHistory(object).begin();movementSelection.reset(teleportViewerCharacter);if(object)placementHistory(object).finish() }

function bindContinuousTransformButton(button: HTMLButtonElement, action: () => void) {
    let repeatDelay: number | undefined
    let repeatTimer: number | undefined
    let editedObject:THREE.Object3D|undefined
    const stop = () => {
        if (repeatDelay !== undefined) window.clearTimeout(repeatDelay)
        if (repeatTimer !== undefined) window.clearInterval(repeatTimer)
        repeatDelay = undefined
        repeatTimer = undefined
        if(editedObject){placementHistory(editedObject).finish();editedObject=undefined;viewportEditor?.refresh()}
    }

    button.addEventListener('pointerdown', event => {
        if (event.button !== 0) return
        event.preventDefault()
        button.setPointerCapture(event.pointerId)
        stop()
        editedObject=movementSelection.current?.object
        if(editedObject)placementHistory(editedObject).begin()
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
    const targetMenu=createTpsTargetMenu({button:locomotionModeToggle,locale:getUiLocale,
        active:isViewerLocomotionEnabled,setActive:setViewerLocomotionEnabled,
        selected:()=>scene.characterSelected?.character?.object.uuid,
        targets:()=>scene.characters.flatMap((slot,i)=>{
            const actor=slot.character;if(!actor)return[]
            const id=String(actor.userData.characterId)
            const label=document.querySelector<HTMLOptionElement>(`#character-selector option[value="${id}"]`)?.textContent??id
            return[{key:actor.object.uuid,label:`${i+1}. ${label}`,enabled:canControlViewerActor(slot)}]
        }),select:key=>{const slot=scene.characters.find(c=>c.character?.object.uuid===key);if(slot&&canControlViewerActor(slot)&&slot!==scene.characterSelected)selectCharacter(slot)}})
    const corner=createCameraCornerControls({locale:getUiLocale,roll:rotateViewerCameraPlane,focus:()=>{
        finishDirectPoseDrag()
        const actor=isViewerLocomotionEnabled()?scene.characterSelected?.character?.object:movementSelection.current?.object??scene.characterSelected?.character?.object
        if(!actor)return
        const rect=scene.renderer.domElement.getBoundingClientRect(),roll=scene.cameraRotation
        if(frameWholeObject(scene.camera,scene.controls.target,editorGround.visualBounds(actor),rect,document.getElementById('menu')?.getBoundingClientRect().bottom??0)){
            editorGround.constrainCamera(scene.camera,scene.controls)
            if(isViewerLocomotionEnabled())adoptViewerCamera()
            else {scene.controls.update();scene.cameraRotation=roll}
        }
    }})
    onPermanentPageExit(()=>{targetMenu.dispose();corner.dispose()})
    const twoFinger=installOrbitTwoFingerGesture({canvas:scene.renderer.domElement,camera:()=>scene.camera,controls:()=>scene.controls,
        enabled:()=>!document.body.classList.contains('locomotion-mode-enabled')&&!performanceGizmoActive,
        beforeBegin:()=>finishDirectPoseDrag(),getRoll:()=>scene.cameraRotation??0,setRoll:value=>{scene.cameraRotation=value}})
    onPermanentPageExit(()=>twoFinger.dispose())
    scene.renderer.domElement.addEventListener('click', mouseClickHandler)
    scene.renderer.domElement.addEventListener('dblclick', mouseDoubleClickHandler)
    scene.renderer.domElement.addEventListener('mousedown', mouseDownHandler)
    scene.renderer.domElement.addEventListener('mousemove', mouseMoveHandler)
    document.addEventListener('magius:tps-select-at', event => {
        if(!document.body.classList.contains('locomotion-mode-enabled')||performanceGizmoActive)return
        const {x,y}=(event as CustomEvent<{x:number;y:number}>).detail
        if(!Number.isFinite(x)||!Number.isFinite(y))return
        const hit=pickObject({clientX:x,clientY:y} as MouseEvent)
        const character=scene.characters.find(slot=>slot.character?.object===hit?.object)
        if(character&&canControlViewerActor(character)&&character!==scene.characterSelected)selectCharacter(character)
    })
    // A touch activation owns its following compatibility click/dblclick.
    // Newly mounted editor buttons must not receive the opening finger's click.
    let touchDown:{id:number;x:number;y:number;at:number}|undefined
    let lastTap:{at:number;object:THREE.Object3D;x:number;y:number}|undefined
    let suppressTouchClickUntil=0
    document.addEventListener('click',event=>{
        if(performance.now()<suppressTouchClickUntil){event.preventDefault();event.stopImmediatePropagation()}
    },true)
    document.addEventListener('pointerdown',()=>{suppressTouchClickUntil=0},{capture:true})
    scene.renderer.domElement.addEventListener('pointerdown',event=>{
        if(event.pointerType==='touch'&&!document.body.classList.contains('locomotion-mode-enabled')&&!document.body.classList.contains('view-two-finger'))touchDown={id:event.pointerId,x:event.clientX,y:event.clientY,at:performance.now()}
    })
    scene.renderer.domElement.addEventListener('pointerup',event=>{
        const down=touchDown;touchDown=undefined
        if(!down||down.id!==event.pointerId||directPoseEditingEnabled||performanceGizmoActive||document.body.classList.contains('locomotion-mode-enabled')||document.body.classList.contains('view-two-finger')||performance.now()-down.at>550||Math.hypot(event.clientX-down.x,event.clientY-down.y)>12)return
        const target=pickObject(event);if(!target){lastTap=undefined;return}
        if(lastTap?.object===target.object&&performance.now()-lastTap.at<450&&Math.hypot(event.clientX-lastTap.x,event.clientY-lastTap.y)<28){
            suppressTouchClickUntil=performance.now()+450
            target.select();activateObjectTransform(target.object,target.refresh);lastTap=undefined
        }else lastTap={at:performance.now(),object:target.object,x:event.clientX,y:event.clientY}
    })
    scene.renderer.domElement.addEventListener('pointercancel',()=>{touchDown=undefined;lastTap=undefined})

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
        scene.camera.updateMatrixWorld(true)
        raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), scene.camera)
        return pickMovementTarget(raycaster, targets)
    }
    function mouseClickHandler(e: MouseEvent) {
        if (directPoseEditingEnabled || performanceGizmoActive) return
        if(document.body.classList.contains('locomotion-mode-enabled')) {
            if(document.pointerLockElement&&document.pointerLockElement===scene.renderer.domElement)return
            if(Math.abs(mouseMoveX)>3||Math.abs(mouseMoveY)>3)return
            const hit=pickObject(e),slot=scene.characters.find(c=>c.character?.object===hit?.object)
            if(slot&&canControlViewerActor(slot)&&slot!==scene.characterSelected)selectCharacter(slot)
            return
        }
        if (Math.abs(mouseMoveX) > 3 || Math.abs(mouseMoveY) > 3) return
        if (singleCharacterTransformControls?.dragging || scene.transformControls.dragging
            || singleCharacterTransformControls?.axis || scene.transformControls.axis) return
        const target = pickObject(e)
        if (target) target.select()
        else { closeObjectTransform(); selectCharacterByMouse(e) }
    }
    function mouseDoubleClickHandler(e: MouseEvent) {
        if (directPoseEditingEnabled || performanceGizmoActive) return
        if(document.body.classList.contains('locomotion-mode-enabled')) {
            e.preventDefault();e.stopPropagation()
            if(document.pointerLockElement!==scene.renderer.domElement)document.dispatchEvent(new CustomEvent('magius:tps-capture'))
            return
        }
        const target = pickObject(e)
        if (!target) return
        if(document.body.classList.contains('locomotion-mode-enabled'))setViewerLocomotionEnabled(false)
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
    poseGravity.capture()
    recordPoseDiagnosticFrame()
    applySelectedAnimationPlaybackRate()
    applyManualExpressionOverrides()
    voicePanelController?.update()
    applyManualPoseOverrides()
    poseGravity.compose()
    performanceGizmoFlush?.()
    performanceHost?.flushFinalPoseBeforeCamera()
    updateGarmentContacts(getClockDelta())
    performanceRecorder?.frame()
    updateGarmentSurfaces()
    if (objectTransformUiPending) {
        objectTransformUiPending = false
        if (singleObjectTransformOnChange) singleObjectTransformOnChange()
        else if (scene.characterSelected?.character) updateCharacterController(scene.characterSelected.character)
    }
    if(document.documentElement.dataset.performanceOverlay!=='false')stats.update()
    // A paused pose does not need a complete animation-panel rebuild per RAF.
    const now = performance.now()
    if (now >= nextDirectPoseAnimationUiAt) {
        nextDirectPoseAnimationUiAt = now + (directPoseEditingEnabled ? 100 : 50)
        updateAnimationControls()
    }
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

    if(!location.hash&&await restoreSessionWorkspace())return

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
        warmGarmentContacts(character.object)

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
                if(studioAdoptedExpressions.has(character.object)){manualMorphsByCharacter.delete(character.object);studioAdoptedExpressions.delete(character.object)}
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

    let tpsOwnedAtDragStart = false
    singleCharacterTransformControls.addEventListener('dragging-changed', event => {
        const dragging = Boolean(event.value)
        const tpsOwnsCamera = document.body.classList.contains('locomotion-mode-enabled')
        if (dragging) {
            if(singleCharacterTransformControls?.object)placementHistory(singleCharacterTransformControls.object).begin()
            tpsOwnedAtDragStart = tpsOwnsCamera
            singleCharacterTransformOrbitWasEnabled = scene.controls.enabled
            scene.controls.enabled = false
        } else if (!directPoseEditingEnabled) {
            if(singleCharacterTransformControls?.object)placementHistory(singleCharacterTransformControls.object).finish()
            if (tpsOwnsCamera) scene.controls.enabled = false
            else if (!tpsOwnedAtDragStart) scene.controls.enabled = singleCharacterTransformOrbitWasEnabled
            // If TPS ended during the drag, retain the camera owner's restored state.
        }
    })
    singleCharacterTransformControls.addEventListener('objectChange', () => {
        const object = singleCharacterTransformControls?.object
        if (object) editorGround.constrainObject(object)
        objectTransformUiPending = true
    })
}

function clearSingleCharacterTransform() {
    scene.characterTransformEditing = false
    scene.effects.outlinePass.enabled = false
    const wasDragging = singleCharacterTransformControls?.dragging === true
    singleCharacterTransformControls?.detach()
    if (singleCharacterTransformControls) singleCharacterTransformControls.enabled = false
    if (singleCharacterTransformControlsHelper) singleCharacterTransformControlsHelper.visible = false
    singleCharacterTransformActive = false
    singleObjectTransformOnChange = undefined
    // Only an actual drag leases Orbit input; opening/closing edit UI does not.
    if (wasDragging && singleCharacterTransformControls) singleCharacterTransformControls.dragging = false
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
        // Repeated double-click/tap on the same object must not immediately
        // toggle the editor closed.
        singleObjectTransformOnChange = onObjectChange ?? singleObjectTransformOnChange
        return
    }
    if (directPoseEditingEnabled) setDirectPoseEditing(false)
    scene.transformControls.detach()
    singleCharacterTransformActive = true
    scene.characterTransformEditing = scene.characterSelected?.character?.object === object
    singleObjectTransformOnChange = onObjectChange
    placementHistory(object)
    editorGround.capture(object)
    editorGround.constrainObject(object, true)
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
    // Ground-contact correction now permits all three rotation rings without
    // letting a tilted whole actor or prop cut through the ground.
    controls.showX = true
    controls.showZ = true
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
    viewportEditor?.refresh()
}

Object.assign(window, { changeCharacter })

normalizeViewerEntry()


function ensurePoseOrigin(object:THREE.Object3D) {
    if(poseOrigins.has(object))return
    const baseline=captureModelLocal(object)
    manualPoseByCharacter.get(object)?.forEach(entry=>{
        baseline.set(entry.bone.uuid,{p:getPoseEntryPositionBase(entry).toArray(),q:getPoseEntryBase(entry).toArray(),s:(entry.lastBaseScale??entry.bone.scale).toArray()})
    })
    poseOrigins.set(object,baseline)
}
function freezePoseForEditing(object:THREE.Object3D){
    if(!poseFrozenBases.has(object))poseFrozenBases.set(object,poseOrigins.get(object)??captureModelLocal(object))
    const character=scene.characters.find(slot=>slot.character?.object===object)?.character
    if(character)character.animation.paused=true
    else enemyPanelController?.enemyResources.getInstances().find(instance=>instance.object===object)?.setAnimationPaused(true)
}
function placementHistory(object:THREE.Object3D) {
    let history=placementHistories.get(object);if(!history){history=new PlacementHistory(object);placementHistories.set(object,history)}return history
}
function undoPlacement(redo=false) {
    const target=movementSelection.current,object=target?.object??scene.characterSelected?.character?.object;if(!object)return
    if(placementHistory(object).undo(redo)){editorGround.constrainObject(object,true);target?.changed?.();viewportEditor?.refresh()}
}
function resetPlacement(){const target=movementSelection.current,object=target?.object??scene.characterSelected?.character?.object;if(!object)return;placementHistory(object).reset();editorGround.constrainObject(object,true);target?.changed?.();viewportEditor?.refresh()}
function setPoseNodeGroup(value:PoseNodeGroup){
    if(!['primary','hands','more'].includes(value))return
    finishDirectPoseDrag();poseNodeGroup=value;clearDirectPoseSelection();setDirectPoseEditing(true)
    if(value!=='primary')setDirectPoseTransformMode('rotate')
    poseStructurePanel?.refresh(true);updateDirectPoseUi()
}
function setPoseStretch(value:boolean){
    finishDirectPoseDrag();const object=getPoseActor()
    if(object&&!value){
        const history=getDirectPoseHistory(object);history.begin(captureDirectPose(object))
        getPoseEntries(object).forEach(entry=>{if(isPerformanceBoneLeased(entry.bone))return;entry.positionOffsets.set(0,0,0);entry.scaleFactors=undefined;applyPoseEntry(entry)})
        history.finish(captureDirectPose(object))
    }
    poseAllowStretch=value
    const selected=directPoseSelection;if(selected)selectDirectPoseBone(selected.object,selected.entry.bone)
    updateDirectPoseUi()
}
function applySavedModelPose(value:unknown) {
    const object=getPoseActor();if(!object)throw Error('请先选择角色')
    finishDirectPoseDrag();setDirectPoseEditing(true);ensurePoseOrigin(object)
    const changes=resolveSavedPose(object,getPoseModel(object),value,poseAllowStretch,poseOrigins.get(object))
    if(changes.some(({node})=>isPerformanceBoneLeased(node)))throw Error('演出系统正在控制模型，未应用姿态')
    const history=getDirectPoseHistory(object);history.begin(captureDirectPose(object));const entries=getPoseEntries(object)
    for(const {node,transform}of changes){
        const entry=entries.get(node.uuid);if(!entry)continue
        const base=getPoseEntryBase(entry),p=getPoseEntryPositionBase(entry),scale=entry.lastBaseScale?.clone()??node.scale.clone()
        const delta=base.clone().invert().multiply(new THREE.Quaternion().fromArray(transform.q)),angles=new THREE.Euler().setFromQuaternion(delta,'XYZ')
        entry.offsets.set(THREE.MathUtils.radToDeg(angles.x),THREE.MathUtils.radToDeg(angles.y),THREE.MathUtils.radToDeg(angles.z))
        entry.positionOffsets.fromArray(transform.p).sub(p)
        entry.scaleFactors=new THREE.Vector3(...transform.s.map((value,i)=>Math.abs(scale.getComponent(i))<1e-9?1:value/scale.getComponent(i)) as [number,number,number])
        entry.unrestricted=true;entry.lastBase=base;entry.lastBasePosition=p;entry.lastBaseScale=scale
        writeLocal(node,transform);entry.lastApplied=node.quaternion.clone();entry.lastAppliedPosition=node.position.clone();entry.lastAppliedScale=node.scale.clone()
    }
    history.finish(captureDirectPose(object));directPoseTarget?.sync();rebuildActionParameterChannels();updateDirectPoseUi()
}
function installPoseWorkspacePanel() {
    return createPoseWorkspacePanel(actionPanel.querySelector('.floating-panel-scroll') as HTMLElement,{
        actor:()=>getPoseActor(),model:()=>{const object=getPoseActor();return object?getPoseModel(object):''},selected:()=>directPoseSelection?.entry.bone,
        group:()=>poseNodeGroup,setGroup:setPoseNodeGroup,allowStretch:()=>poseAllowStretch,setStretch:setPoseStretch,select:selectViewportPosePart,
        reset:resetActionParameters,undo:()=>undoDirectPose(),redo:()=>undoDirectPose(true),
        make:name=>{const object=getPoseActor();if(!object)throw Error('请先选择角色');finishDirectPoseDrag();ensurePoseOrigin(object);return makeSavedPose(object,getPoseModel(object),name,poseOrigins.get(object)!)},
        save:pose=>savePoseLibrary(localStorage,pose),apply:applySavedModelPose,
        scale:(axis,value)=>{
            const selection=directPoseSelection;if(!selection||!poseAllowStretch)throw Error('请先选节点并明确开启允许拉伸')
            if(!Number.isFinite(value)||value<.05||value>5)throw Error('缩放限于0.05至5')
            finishDirectPoseDrag();const entry=selection.entry;if(isPerformanceBoneLeased(entry.bone))return
            const history=getDirectPoseHistory(selection.object);history.begin(captureDirectPose(selection.object))
            const base=entry.lastBaseScale??entry.bone.scale.clone();entry.scaleFactors??=new THREE.Vector3(1,1,1);entry.scaleFactors[axis]=value/base[axis]
            applyPoseEntry(entry);history.finish(captureDirectPose(selection.object));directPoseTarget?.sync();updateDirectPoseUi()
        }
    })
}

let restoringWorkspace=false
let sessionReady=false
function snapshotSessionWorkspace() {
    if(!sessionReady||restoringWorkspace)return
    const live=scene.characters.filter(actor=>actor.character&&!actor.loading)
    if(!live.length||live.length>8)return
    try{
        finishDirectPoseDrag()
        const actors=live.map(actor=>{
            const object=actor.character!.object,id=String(actor.character!.userData.characterId),entries=manualPoseByCharacter.get(object)
            const modified=entries&&[...entries.values()].some(entry=>entry.offsets.lengthSq()>1e-12||entry.positionOffsets.lengthSq()>1e-12||entry.scaleFactors&&entry.scaleFactors.distanceToSquared(new THREE.Vector3(1,1,1))>1e-12)
            return {id,placement:readLocal(object),pose:modified?makeSavedPose(object,id,'最近未完成编辑',poseOrigins.get(object)??captureModelLocal(object)):undefined}
        })
        const session:WorkspaceSession={schema:'magius.workspace-session.v1',savedAt:new Date().toISOString(),actors,selected:Math.max(0,live.indexOf(scene.characterSelected!)),camera:{p:scene.camera.position.toArray(),q:scene.camera.quaternion.toArray(),target:scene.controls.target.toArray(),roll:scene.cameraRotation??0},allowStretch:poseAllowStretch,stage:(document.getElementById('stage-selector') as HTMLSelectElement).value}
        writeWorkspaceSession(sessionStorage,session);document.documentElement.dataset.sessionSaved='true'
    }catch(error){document.documentElement.dataset.sessionSaved='unavailable';console.warn('Workspace checkpoint unavailable:',(error as Error).name)}
}
function setupSessionWorkspace(){
    installContextRecovery(scene.renderer.domElement)
    let timer:ReturnType<typeof setTimeout>|undefined
    const schedule=()=>{if(timer)clearTimeout(timer);timer=setTimeout(snapshotSessionWorkspace,600)}
    document.addEventListener('pointerup',schedule,{passive:true})
    document.addEventListener('change',schedule,{passive:true})
    document.addEventListener('visibilitychange',()=>{if(document.hidden)snapshotSessionWorkspace()})
    window.addEventListener('pagehide',()=>snapshotSessionWorkspace(),{capture:true})
    const check=setInterval(()=>{if(scene.characters.some(a=>a.character&&!a.loading)){sessionReady=true;clearInterval(check)}},250)
    document.documentElement.dataset.sessionResume='ready'
}
async function restoreSessionWorkspace():Promise<boolean>{
    let saved:WorkspaceSession|undefined
    try{saved=readWorkspaceSession(sessionStorage)}catch{document.documentElement.dataset.sessionResume='invalid';return false}
    if(!saved||saved.actors.some(a=>!characterIdList.includes(a.id)))return false
    restoringWorkspace=true
    try{
        const loaded:SceneCharacter[]=[]
        poseAllowStretch=saved.allowStretch
        for(const data of saved.actors){
            const slot=await addOrChangeCharacter(data.id)
            loaded.push(slot);writeLocal(slot.character!.object,data.placement);placementHistory(slot.character!.object)
            selectCharacter(slot)
            if(data.pose)applySavedModelPose(data.pose)
        }
        setDirectPoseEditing(false);closeObjectTransform();selectCharacter(loaded[saved.selected])
        const stage=document.getElementById('stage-selector') as HTMLSelectElement
        if(saved.stage&&[...stage.options].some(o=>o.value===saved.stage)&&stage.value!==saved.stage){stage.value=saved.stage;stage.dispatchEvent(new Event('change',{bubbles:true}))}
        scene.camera.position.fromArray(saved.camera.p);scene.camera.quaternion.fromArray(saved.camera.q).normalize();scene.controls.target.fromArray(saved.camera.target);scene.cameraRotation=saved.camera.roll??0;scene.controls.update()
        document.documentElement.dataset.sessionResume='restored';return true
    }catch(error){document.documentElement.dataset.sessionResume='partial';console.warn('Workspace restore interrupted:',(error as Error).name);return scene.characters.some(a=>!!a.character)}
    finally{restoringWorkspace=false;sessionReady=true}
}
