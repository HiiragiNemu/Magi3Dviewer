import * as THREE from 'three'
import Stats from 'three/addons/libs/stats.module.js';
import { scene } from './scene';
import { type SceneCharacter } from 'magia-exedra-character-three/scene'
import { initSelector, resumeOrReplaySelectedAnimation } from './controls'
import { characters } from './character';
import { guiOptions, restoreThemePreference, setupBackgroundImageSelector, updateCharacterController, updateCharacterOutline } from './controllers';
import { TransformControls, type TransformControlsMode } from 'three/examples/jsm/Addons.js';
import { presetImport } from './controllers/presets';
import { setupCameraModeButtons } from './camera'
import { translateBoneChannelLabel, translateMorphChannelLabel, translateUiText } from './localization/zhCN'

const characterSelector = document.getElementById('character-selector') as HTMLSelectElement
const characterAddCrossBtn = document.getElementById('character-add-cross-btn') as HTMLButtonElement
const characterAddSelector = document.getElementById('character-add-selector') as HTMLSelectElement
const animationSelector = document.getElementById('animation-selector') as HTMLSelectElement
const animationPlayBtn = document.getElementById('animation-play') as HTMLButtonElement
const animationPauseBtn = document.getElementById('animation-pause') as HTMLButtonElement
const animationSlider = document.getElementById('animation-slider') as HTMLInputElement
const animationSpeed = document.getElementById('animation-speed') as HTMLInputElement
const animationSpeedValue = document.getElementById('animation-speed-value') as HTMLOutputElement
const actionPanelToggle = document.getElementById('action-panel-toggle') as HTMLButtonElement
const actionPanel = document.getElementById('action-parameter-panel') as HTMLElement
const actionPanelClose = document.getElementById('action-panel-close') as HTMLButtonElement
const actionDirectEditToggle = document.getElementById('action-direct-edit-toggle') as HTMLButtonElement
const actionDirectEditTarget = document.getElementById('action-direct-edit-target') as HTMLOutputElement
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
const menuCollapseGlyph = menuCollapseToggle.querySelector('span') as HTMLSpanElement
const renderSettingsToggle = document.getElementById('render-settings-toggle') as HTMLButtonElement
const advancedControlsDock = document.getElementById('advanced-controls-dock') as HTMLElement
const renderSettingsClose = document.getElementById('render-settings-close') as HTMLButtonElement
const positionControlsToggle = document.getElementById('position-controls-toggle') as HTMLButtonElement
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
const characterTransformDefaults = new WeakMap<THREE.Object3D, {
    position: THREE.Vector3
    quaternion: THREE.Quaternion
}>()
const characterMoveStep = 0.05
const characterRotateStep = THREE.MathUtils.degToRad(5)

type PoseAxis = 'x' | 'y' | 'z'

interface ManualPoseEntry {
    bone: THREE.Bone
    offsets: THREE.Vector3
    lastBase?: THREE.Quaternion
    lastApplied?: THREE.Quaternion
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

interface DirectPoseSelection {
    object: THREE.Object3D
    entry: ManualPoseEntry
    base: THREE.Quaternion
}

interface DirectPosePointerDrag {
    pointerId: number
    startX: number
    startY: number
    startOffsets: THREE.Vector3
    selection: DirectPoseSelection
}

let directPoseControls: TransformControls | undefined
let directPoseControlsHelper: THREE.Object3D | undefined
let directPoseSelection: DirectPoseSelection | undefined
let directPosePointerDrag: DirectPosePointerDrag | undefined
let directPoseEditingEnabled = false
let directPoseGizmoDragging = false
let directPoseOrbitControlsWasEnabled = true
let directPoseOutlineSelection: THREE.Object3D[] = []

const loadProgressEl = document.getElementById('load-progress')!
let lastProgressText = ''
document.addEventListener('magius:localechange', () => {
    if (lastProgressText) loadProgressEl.textContent = translateUiText(lastProgressText)
})

const perfStatJsContainer = document.getElementById('perf-stat-js') as HTMLDivElement

characterAddCrossBtn.onclick = removeSelectedCharacter
animationPlayBtn.onclick = () => {
    const animation = scene.characterSelected?.character?.animation
    if (animation) {
        resumeOrReplaySelectedAnimation(animation, animationSelector.value)
    }
    updateAnimationControls()
}
animationPauseBtn.onclick = () => { scene.characterSelected?.character && (scene.characterSelected.character.animation.paused = true); updateAnimationControls() }
animationSlider.oninput = () => {
    if (scene.characterSelected?.character) {
        const animation = scene.characterSelected.character.animation
        animation.paused = true
        animation.time = parseFloat(animationSlider.value)
        updateAnimationControls()
    }
}
animationSpeed.oninput = () => {
    const animation = scene.characterSelected?.character?.animation
    if (!animation) return
    animation.mixer.timeScale = THREE.MathUtils.clamp(parseFloat(animationSpeed.value), 0, 2)
    updateAnimationControls()
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

const transformTranslateBtn = document.getElementById('transform-set-translate') as HTMLButtonElement
const transformRotateBtn = document.getElementById('transform-set-rotate') as HTMLButtonElement
transformTranslateBtn.onclick = () => setTransformMode('translate')
transformRotateBtn.onclick = () => setTransformMode('rotate')

const characterIdList = characters.getCharacterIdList()
const characterSelectDict = characterIdList.reduce((obj, id) => {
    obj[`${id} - ${characters.getCharacterNameById(id)}`] = id
    return obj
}, {} as Record<string, string>)
console.log(Object.keys(characterSelectDict).join('\n'))

const stats = new Stats()

export function setupViewer() {
    setupMenuCollapseToggle()
    setupDockControls()
    setupParameterControls()
    setupDirectPoseEditing()
    setupCharacterMovementControls()
    restoreThemePreference()
    initSelector(
        characterSelector,
        characterSelectDict,
        changeCharacter
    );

    setupCharacterAddSelector()
    setupViewerInputHandler()
    setupBackgroundImageSelector()
    setupCameraModeButtons()

    scene.animateLoopCallback = animateLoop

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

function setupMenuCollapseToggle() {
    const setCollapsed = (collapsed: boolean) => {
        document.body.classList.toggle('menu-ui-collapsed', collapsed)
        menuCollapseToggle.classList.toggle('controls-collapsed', collapsed)
        menuCollapseToggle.setAttribute('aria-expanded', String(!collapsed))
        menuCollapseGlyph.textContent = '△'
        const label = translateUiText(collapsed ? 'Expand controls' : 'Collapse controls')
        menuCollapseToggle.title = label
        menuCollapseToggle.setAttribute('aria-label', label)
    }

    menuCollapseToggle.onclick = () => {
        setCollapsed(!document.body.classList.contains('menu-ui-collapsed'))
    }
    document.addEventListener('magius:localechange', () => {
        setCollapsed(document.body.classList.contains('menu-ui-collapsed'))
    })
    setCollapsed(false)
}

function setupDockControls() {
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
        const label = translateUiText(open ? 'Hide character movement' : 'Character movement')
        positionControlsToggle.textContent = label
        positionControlsToggle.title = label
        positionControlsToggle.setAttribute('aria-label', label)
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
    actionPanelToggle.onclick = () => setActionPanelOpen(!actionPanel.classList.contains('is-open'))
    expressionPanelToggle.onclick = () => setExpressionPanelOpen(!expressionPanel.classList.contains('is-open'))
    renderSettingsClose.onclick = () => setAdvancedControlsOpen(false)
    actionPanelClose.onclick = () => setActionPanelOpen(false)
    expressionPanelClose.onclick = () => setExpressionPanelOpen(false)

    for (const panel of [advancedControlsDock, actionPanel, expressionPanel]) {
        const header = panel.querySelector('.floating-panel-header') as HTMLElement | null
        if (header) setupFloatingPanelDrag(panel, header)
    }

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return
        setDirectPoseEditing(false)
        setAdvancedControlsOpen(false)
        setActionPanelOpen(false)
        setExpressionPanelOpen(false)
    })
    document.addEventListener('magius:localechange', () => {
        setAdvancedControlsOpen(document.body.classList.contains('advanced-controls-open'))
        setPositionControlsOpen(document.body.classList.contains('position-controls-open'))
        setActionPanelOpen(actionPanel.classList.contains('is-open'))
        setExpressionPanelOpen(expressionPanel.classList.contains('is-open'))
    })

    setAdvancedControlsOpen(false)
    setPositionControlsOpen(false)
    setActionPanelOpen(false)
    setExpressionPanelOpen(false)
}

function setupFloatingPanelDrag(panel: HTMLElement, handle: HTMLElement) {
    let pointerId: number | undefined
    let offsetX = 0
    let offsetY = 0

    handle.addEventListener('pointerdown', event => {
        if ((event.target as Element).closest('button')) return
        const rect = panel.getBoundingClientRect()
        pointerId = event.pointerId
        offsetX = event.clientX - rect.left
        offsetY = event.clientY - rect.top
        panel.style.left = `${rect.left}px`
        panel.style.top = `${rect.top}px`
        panel.style.transform = 'none'
        handle.setPointerCapture(pointerId)
        event.preventDefault()
    })
    handle.addEventListener('pointermove', event => {
        if (pointerId !== event.pointerId) return
        const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth)
        const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight)
        panel.style.left = `${THREE.MathUtils.clamp(event.clientX - offsetX, 0, maxLeft)}px`
        panel.style.top = `${THREE.MathUtils.clamp(event.clientY - offsetY, 0, maxTop)}px`
    })
    const stopDragging = (event: PointerEvent) => {
        if (pointerId !== event.pointerId) return
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
        pointerId = undefined
    }
    handle.addEventListener('pointerup', stopDragging)
    handle.addEventListener('pointercancel', stopDragging)
}

function setupParameterControls() {
    actionChannelSearch.addEventListener('input', () => filterParameterRows(actionChannelList, actionChannelSearch.value))
    expressionChannelSearch.addEventListener('input', () => filterParameterRows(expressionChannelList, expressionChannelSearch.value))
    actionDirectEditToggle.onclick = () => setDirectPoseEditing(!directPoseEditingEnabled)
    actionParametersReset.onclick = resetActionParameters
    expressionParametersReset.onclick = resetExpressionParameters
    document.addEventListener('magius:localechange', () => {
        rebuildActionParameterChannels()
        rebuildExpressionParameterChannels()
        updateDirectPoseUi()
    })
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
        })
    })
    manualPoseByCharacter.set(object, next)
    return next
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
    if (
        entry.lastApplied
        && entry.lastBase
        && entry.bone.quaternion.angleTo(entry.lastApplied) < 1e-5
    ) {
        entry.bone.quaternion.copy(entry.lastBase)
    }

    const hasOffset = Math.abs(entry.offsets.x) > 1e-6
        || Math.abs(entry.offsets.y) > 1e-6
        || Math.abs(entry.offsets.z) > 1e-6
    if (!hasOffset) {
        entry.lastBase = undefined
        entry.lastApplied = undefined
        return
    }

    entry.lastBase = entry.bone.quaternion.clone()
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(entry.offsets.x),
        THREE.MathUtils.degToRad(entry.offsets.y),
        THREE.MathUtils.degToRad(entry.offsets.z),
        'XYZ',
    ))
    entry.bone.quaternion.multiply(rotation)
    entry.lastApplied = entry.bone.quaternion.clone()
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
        if (
            entry.lastApplied
            && entry.lastBase
            && entry.bone.quaternion.angleTo(entry.lastApplied) < 1e-5
        ) entry.bone.quaternion.copy(entry.lastBase)
        entry.offsets.set(0, 0, 0)
        entry.lastBase = undefined
        entry.lastApplied = undefined
    })
    if (directPoseSelection?.object === object) {
        directPoseSelection.base.copy(directPoseSelection.entry.bone.quaternion)
    }
    rebuildActionParameterChannels()
}

function getPoseEntryBase(entry: ManualPoseEntry) {
    if (
        entry.lastApplied
        && entry.lastBase
        && entry.bone.quaternion.angleTo(entry.lastApplied) < 1e-5
    ) return entry.lastBase.clone()
    return entry.bone.quaternion.clone()
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

function updateDirectPoseUi(scrollSelected = false) {
    const object = scene.characterSelected?.character?.object
    actionDirectEditToggle.disabled = !object
    actionDirectEditToggle.setAttribute('aria-pressed', String(directPoseEditingEnabled))
    actionDirectEditToggle.textContent = translateUiText(
        directPoseEditingEnabled ? 'Exit direct drag pose' : 'Direct drag pose',
    )
    actionDirectEditToggle.title = translateUiText('Drag vertically for local X, horizontally for local Z; hold Alt for local Y')

    actionChannelList.querySelectorAll('.parameter-bone-row.direct-selected')
        .forEach(row => row.classList.remove('direct-selected'))
    const selectedRow = directPoseSelection
        ? [...actionChannelList.querySelectorAll<HTMLElement>('.parameter-bone-row')]
            .find(row => row.dataset.boneUuid === directPoseSelection?.entry.bone.uuid)
        : undefined
    selectedRow?.classList.add('direct-selected')
    if (scrollSelected && selectedRow) selectedRow.scrollIntoView({ block: 'center', behavior: 'smooth' })

    const targetText = directPoseSelection
        ? `${translateUiText('Selected bone')}: ${translateBoneChannelLabel(directPoseSelection.entry.bone.name || 'Unnamed bone')}`
        : translateUiText('Click a body part, then drag it or use the rotation rings')
    actionDirectEditTarget.value = targetText
    actionDirectEditTarget.textContent = targetText
}

function selectDirectPoseBone(object: THREE.Object3D, bone: THREE.Bone) {
    const entry = getPoseEntries(object).get(bone.uuid)
    if (!entry || !directPoseControls || !directPoseControlsHelper) return
    directPoseSelection = {
        object,
        entry,
        base: getPoseEntryBase(entry),
    }
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
    const object = scene.characterSelected?.character?.object
    if (enabled && !object) return
    if (directPoseEditingEnabled === enabled) {
        updateDirectPoseUi()
        return
    }

    directPoseEditingEnabled = enabled
    document.body.classList.toggle('direct-pose-editing', enabled)
    if (enabled) {
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
        if (bone && entries.has(bone.uuid)) return { object, bone }
    }
    return undefined
}

function setupDirectPoseEditing() {
    directPoseControls = new TransformControls(scene.camera, scene.renderer.domElement)
    directPoseControls.mode = 'rotate'
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
        selectDirectPoseBone(weighted.object, weighted.bone)
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
        const sensitivity = event.shiftKey ? 0.18 : 0.35
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (event.altKey) {
            drag.selection.entry.offsets.y = THREE.MathUtils.clamp(drag.startOffsets.y + dx * sensitivity, -180, 180)
        } else {
            drag.selection.entry.offsets.x = THREE.MathUtils.clamp(drag.startOffsets.x - dy * sensitivity, -180, 180)
            drag.selection.entry.offsets.z = THREE.MathUtils.clamp(drag.startOffsets.z - dx * sensitivity, -180, 180)
        }
        applyPoseEntry(drag.selection.entry)
        syncPoseEntryControls(drag.selection.entry)
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
                if (index != undefined) mesh.morphTargetInfluences[index] = entry.value
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
            if (index != undefined) mesh.morphTargetInfluences[index] = value
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
    if (!replace && characterTransformDefaults.has(object)) return
    characterTransformDefaults.set(object, {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
    })
}

function updateSelectedCharacterTransformUi() {
    const character = scene.characterSelected?.character
    if (character) updateCharacterController(character)
}

function moveSelectedCharacter(horizontal: number, vertical: number) {
    const object = scene.characterSelected?.character?.object
    if (!object) return
    rememberCharacterTransform(object)

    scene.camera.updateMatrixWorld()
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(scene.camera.matrixWorld, 0)
    cameraRight.y = 0
    if (cameraRight.lengthSq() < 1e-6) cameraRight.set(1, 0, 0)
    cameraRight.normalize()
    if (object.parent) {
        const parentWorldRotation = object.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        cameraRight.applyQuaternion(parentWorldRotation)
    }

    object.position.addScaledVector(cameraRight, horizontal)
    object.position.y += vertical
    updateSelectedCharacterTransformUi()
}

function rotateSelectedCharacter(delta: number) {
    const object = scene.characterSelected?.character?.object
    if (!object) return
    rememberCharacterTransform(object)
    object.rotateY(delta)
    updateSelectedCharacterTransformUi()
}

function tiltSelectedCharacter(delta: number) {
    const object = scene.characterSelected?.character?.object
    if (!object) return
    rememberCharacterTransform(object)

    scene.camera.updateMatrixWorld()
    const cameraForward = scene.camera.getWorldDirection(new THREE.Vector3()).normalize()
    if (object.parent) {
        const parentWorldRotation = object.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        cameraForward.applyQuaternion(parentWorldRotation).normalize()
    }
    object.quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(cameraForward, delta),
    )
    updateSelectedCharacterTransformUi()
}

function resetSelectedCharacterTransform() {
    const object = scene.characterSelected?.character?.object
    if (!object) return
    const initial = characterTransformDefaults.get(object)
    if (!initial) return
    object.position.copy(initial.position)
    object.quaternion.copy(initial.quaternion)
    updateSelectedCharacterTransformUi()
}

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
}

function setupCharacterAddSelector() {
    initSelector(characterAddSelector, { '< Select a character to add >': '', ...characterSelectDict });
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
    scene.renderer.domElement.addEventListener('click', mouseClickHandler)
    scene.renderer.domElement.addEventListener('mousedown', mouseDownHandler)
    scene.renderer.domElement.addEventListener('mousemove', mouseMoveHandler)

    let mouseMoveX = 0
    let mouseMoveY = 0

    function mouseClickHandler(e: PointerEvent | MouseEvent) {
        if (directPoseEditingEnabled) return
        if (Math.abs(mouseMoveX) > 3 || Math.abs(mouseMoveY) > 3) return
        selectCharacterByMouse(e)
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

    function selectCharacterByMouse(e: PointerEvent | MouseEvent) {
        const character = scene.getIntersectedCharacter(e.offsetX, e.offsetY)
        if (character) {
            if (character != scene.characterSelected) {
                selectCharacter(character)
            }
        } else if (scene.characters.length > 1 && scene.characterSelected) {
            deselectCharacter()
        }
    }
}

function animateLoop() {
    applyManualPoseOverrides()
    applyManualExpressionOverrides()
    stats.update()
    updateAnimationControls()
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

async function changeCharacter(id: number | string) {
    if (typeof id == 'number') id = id.toString()

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
        scene.removeCharacter(scene.characterSelected)
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

        if (character.animation.default) {
            character.animation.play(character.animation.default, true)
        }

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
    setDirectPoseEditing(false)
    scene.characterSelected = sceneCharacter

    const character = sceneCharacter.character
    if (!character) return
    rememberCharacterTransform(character.object)

    characterSelector.value = character.userData.characterId.toString()

    initSelector(
        animationSelector,
        character.animations.reduce((obj, name) => {
            obj[name] = name
            return obj
        }, { '<No animation>': '' } as Record<string, string>),
        value => {
            if (value) {
                character.animation.play(value, value.endsWith('_L'))
            } else {
                character.animation.clear()
            }
        }
    );

    animationSelector.value = character.animation.current || ''
    updateAnimationControls()
    rebuildActionParameterChannels()

    if (character.expression) {
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
    setDirectPoseEditing(false)
    scene.characterSelected = undefined
    syncExpressionControls()
    rebuildActionParameterChannels()
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

export function displayProgress(text: string) {
    lastProgressText = text
    if (text) {
        loadProgressEl.style.removeProperty('display')
        loadProgressEl.textContent = translateUiText(text)
    } else {
        loadProgressEl.style.display = 'none'
    }
}

export function hideAllDemoItems() {
    document.body.classList.add('no-demo')
}

function updateAnimationControls() {
    if (scene.characterSelected?.character) {
        const animation = scene.characterSelected.character.animation
        animationSpeed.disabled = false
        animationSpeed.value = animation.mixer.timeScale.toFixed(2)
        animationSpeedValue.value = `${animation.mixer.timeScale.toFixed(2)}×`
        animationSpeedValue.textContent = animationSpeedValue.value

        if (animationSelector.value) {
            if (animation.paused || animation.clamped) {
                animationPlayBtn.style.removeProperty('display')
                animationPauseBtn.style.display = 'none'
            } else {
                animationPlayBtn.style.display = 'none'
                animationPauseBtn.style.removeProperty('display')
            }
            animationSlider.style.removeProperty('display')
            animationSlider.min = '0'
            animationSlider.max = (animation.duration - 0.01).toString()
            animationSlider.step = '0.01'
            animationSlider.value = animation.time.toString()
        } else {
            animationPauseBtn.style.display = 'none'
            animationPlayBtn.style.display = 'none'
            animationSlider.style.display = 'none'
        }
    } else {
        animationPlayBtn.style.display = 'none'
        animationPauseBtn.style.display = 'none'
        animationSlider.style.display = 'none'
        animationSpeed.disabled = true
        animationSpeed.value = '1'
        animationSpeedValue.value = '1.00×'
        animationSpeedValue.textContent = animationSpeedValue.value
    }
}

function setTransformMode(mode: TransformControlsMode) {
    if (mode == 'rotate') {
        scene.transformControls.showX = false
        scene.transformControls.showZ = false
    } else {
        scene.transformControls.showX = true
        scene.transformControls.showZ = true
    }
    scene.transformControls.mode = mode

    updateTransformModeButtons()
}

function updateTransformModeButtons() {
    transformTranslateBtn.style.display = 'none'
    transformRotateBtn.style.display = 'none'

    if (scene.characterSelectionVisible) {
        if (scene.transformControls.mode == 'translate') {
            transformRotateBtn.style.removeProperty('display')
        } else {
            transformTranslateBtn.style.removeProperty('display')
        }
    }
}

Object.assign(window, { changeCharacter })
