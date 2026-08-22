import * as THREE from 'three'

export interface HomeAnimationRuntime {
    schema: 1 | 2
    characterId: number
    unityVersion: string
    source: string
    actions?: {
        wait01: { loopFamily: string; sourceClipPathId?: string }
        wait02: { loopFamily: string; sourceClipPathId?: string }
        unique01: {
            startFamily: string
            startSourceClipPathId?: string
            loopFamily: string
            loopSourceClipPathId?: string
            enterTransitionSeconds: number
            startExitNormalizedTime: number
            startToLoopTransitionSeconds: number
        }
    }
    helpers?: string[]
    helperSourceClipPathIds?: string[]
    clipIdentities?: Array<{
        sourceClipPathId: string
        sourceName: string
        importedName: string
        transformTrackCount: number
    }>
    /** Helpers for an optional weapon model absent from the Viewer FBX. */
    externalHelpers?: string[]
    nodePaths: Record<string, string>
    clips: Array<{
        name: string
        duration: number
        tracks: Array<{ name: string } & Record<string, unknown>>
        [key: string]: unknown
    }>
}

export interface HomeExpressionDefinition {
    duration: number
    weights: Record<string, number>
    unresolvedAttributes?: number[]
}

export interface HomeBlinkControllerDefinition {
    emptyExitTime: number
    fadeInSeconds: number
    blinkExitTime: number
    fadeOutSeconds: number
    afterBlinkExitTime: number
    afterBlinkTransitionSeconds: number
    intervalSpeed: number
    intervalExitTime: number
    intervalTransitionSeconds: number
}

export interface HomeExpressionRuntime {
    schema: 1
    characterId: number
    unityVersion: string
    source: string
    defaultExpression: string
    morphTargetCount: number
    expressionOrder: string[]
    aliases: Record<string, string>
    expressions: Record<string, HomeExpressionDefinition>
    blink: {
        duration: number
        weights: Record<string, number>
        controller: HomeBlinkControllerDefinition | null
        unresolvedAttributes?: number[]
    }
    mouth: {
        duration: number
        curveTarget: string | null
        curveSegments: Array<{
            time: number
            coeff: [number, number, number, number]
        }>
        constantWeights: Record<string, number>
        unresolvedAttributes: number[]
    }
}

function getObjectPath(object: THREE.Object3D): string {
    const parts: string[] = []
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
        parts.unshift(current.name || '<root>')
    }
    return parts.join('/')
}

function getCharacterLocalPath(path: string, characterId: number): string | undefined {
    const anchor = `chara_${characterId}`
    const parts = path.split('/')
    const index = parts.indexOf(anchor)
    return index < 0 ? undefined : parts.slice(index).join('/')
}

/**
 * AssetStudio's auxiliary Home export and the production battle FBX contain
 * the same hierarchy but Three assigns fresh UUIDs each time it parses them.
 * Resolve every official curve by its full hierarchy path and then rewrite the
 * serialized track to the UUID of the already-loaded production model. This
 * avoids ambiguous short bone names such as Chest/Head in weapon and victory
 * subtrees.
 */
export function attachHomeAnimationRuntime(
    root: THREE.Group,
    runtime: HomeAnimationRuntime,
): THREE.AnimationClip[] {
    if (runtime.schema !== 1 && runtime.schema !== 2) {
        throw new Error(`Unsupported Home animation schema: ${runtime.schema}`)
    }

    const referencedPaths = new Set(Object.values(runtime.nodePaths))
    const referencedLocalPaths = new Set(
        [...referencedPaths]
            .map(path => getCharacterLocalPath(path, runtime.characterId))
            .filter((path): path is string => path != undefined),
    )
    const objectsByPath = new Map<string, THREE.Object3D>()
    const objectsByLocalPath = new Map<string, THREE.Object3D>()
    root.traverse(object => {
        const path = getObjectPath(object)
        if (referencedPaths.has(path)) {
            if (objectsByPath.has(path)) {
                throw new Error(`Ambiguous Home animation target path in character FBX: ${path}`)
            }
            objectsByPath.set(path, object)
        }
        const localPath = getCharacterLocalPath(path, runtime.characterId)
        if (!localPath || !referencedLocalPaths.has(localPath)) return
        if (objectsByLocalPath.has(localPath)) {
            throw new Error(
                `Ambiguous character-local Home animation target path in character FBX: ${localPath}`,
            )
        }
        objectsByLocalPath.set(localPath, object)
    })

    const clips = runtime.clips.map(serialized => {
        const tracks = serialized.tracks.map(track => {
            const separator = track.name.indexOf('.')
            if (separator < 1) {
                throw new Error(`Invalid Home animation track binding: ${track.name}`)
            }
            const sourceNodeId = track.name.slice(0, separator)
            const sourcePath = runtime.nodePaths[sourceNodeId]
            const sourceLocalPath = sourcePath
                ? getCharacterLocalPath(sourcePath, runtime.characterId)
                : undefined
            const target = sourcePath
                ? objectsByPath.get(sourcePath)
                    ?? (sourceLocalPath ? objectsByLocalPath.get(sourceLocalPath) : undefined)
                : undefined
            if (!target) {
                throw new Error(
                    `Home animation target is absent from production FBX: ${sourcePath ?? sourceNodeId}`,
                )
            }
            return {
                ...track,
                name: `${target.uuid}${track.name.slice(separator)}`,
            }
        })
        return THREE.AnimationClip.parse({ ...serialized, tracks } as any)
    })

    const newNames = new Set(clips.map(clip => clip.name))
    root.animations = [
        ...root.animations.filter(clip => !newNames.has(clip.name)),
        ...clips,
    ]
    return clips
}

function clamp01(value: number): number {
    return THREE.MathUtils.clamp(value, 0, 1)
}

function evaluateCubicSegment(
    segments: HomeExpressionRuntime['mouth']['curveSegments'],
    time: number,
): number {
    if (segments.length === 0) return 0
    let segment = segments[0]
    for (const candidate of segments) {
        if (candidate.time > time) break
        segment = candidate
    }
    const localTime = Math.max(0, time - segment.time)
    const [a, b, c, d] = segment.coeff
    return ((a * localTime + b) * localTime + c) * localTime + d
}

interface MorphTargetMesh extends THREE.Mesh {
    morphTargetDictionary: Record<string, number>
    morphTargetInfluences: number[]
}

function isMorphTargetMesh(mesh: THREE.Mesh): mesh is MorphTargetMesh {
    return !!mesh.morphTargetDictionary && !!mesh.morphTargetInfluences
}

function isEyeClosureMorph(name: string): boolean {
    return /^Eyelid_Close(?:_[A-Za-z0-9]+)?_[LR]$/.test(name)
}

function conflictsWithStandardBlink(name: string): boolean {
    return /^Eyelid_/.test(name)
}

function getDistinctExpressionNames(
    meshes: MorphTargetMesh[],
    runtime: HomeExpressionRuntime,
): string[] {
    const orderedNames = runtime.expressionOrder.filter(
        name => !!runtime.expressions[name],
    )
    if (
        runtime.expressions[runtime.defaultExpression]
        && !orderedNames.includes(runtime.defaultExpression)
    ) {
        orderedNames.unshift(runtime.defaultExpression)
    }

    const availableMorphNames = [...new Set(
        meshes.flatMap(mesh => Object.keys(mesh.morphTargetDictionary)),
    )].sort()
    const signatureFor = (name: string) => JSON.stringify(
        availableMorphNames.map(morphName => (
            runtime.expressions[name].weights[morphName] ?? 0
        )),
    )
    const defaultSignature = runtime.expressions[runtime.defaultExpression]
        ? signatureFor(runtime.defaultExpression)
        : undefined
    const seen = new Set<string>()
    const distinct: string[] = []

    for (const name of orderedNames) {
        const signature = signatureFor(name)
        // Keep the official default name for its snapshot instead of an
        // earlier state whose clip resolves to the same constant weights.
        if (signature === defaultSignature && name !== runtime.defaultExpression) {
            continue
        }
        if (seen.has(signature)) continue
        seen.add(signature)
        distinct.push(name)
    }

    return distinct
}

/**
 * Unity's Home controller has four layers, but expression and blink are states
 * in the same `FaceLayer`. Static selections preserve that exact behaviour.
 * The Viewer additionally offers an explicit expression+blink preview mode for
 * expressions whose exported snapshot does not already close either eye.
 * `FaceDefault` returns the layer to the official default blink branch.
 */
export class CharacterExpressionController {
    readonly runtime: HomeExpressionRuntime
    readonly meshes: MorphTargetMesh[]
    readonly expressions: string[]
    autoBlink: boolean
    manualBlinkWeight = 0
    mouthCornerWeight = 0
    expressionWeight = 1
    expressionTransitionSeconds = 0
    mouthOpen = false

    private _current: string
    private elapsed = 0
    private mouthTime = 0
    private expressionTransitionElapsed = 0
    private expressionTransitionFrom: Map<string, number> | null = null
    private faceLayerState:
        | 'automatic-blink'
        | 'expression'
        | 'expression-auto-blink' = 'automatic-blink'
    private readonly controlledNames: Set<string>
    private readonly mouthCornerUpNames: Set<string>
    private readonly mouthCornerDownNames: Set<string>

    constructor(meshes: THREE.Mesh[], runtime: HomeExpressionRuntime) {
        this.runtime = runtime
        this.meshes = meshes.filter(isMorphTargetMesh)
        this.expressions = getDistinctExpressionNames(this.meshes, runtime)
        this._current = runtime.defaultExpression
        this.autoBlink = !!runtime.blink.controller
        this.controlledNames = new Set([
            ...Object.values(runtime.expressions).flatMap(expression => Object.keys(expression.weights)),
            ...Object.keys(runtime.blink.weights),
            ...Object.keys(runtime.mouth.constantWeights),
        ])
        if (runtime.mouth.curveTarget) {
            this.controlledNames.add(runtime.mouth.curveTarget)
        }
        const availableControlledNames = [...this.controlledNames].filter(name => (
            this.meshes.some(mesh => name in mesh.morphTargetDictionary)
        ))
        // These are discovered from each character's exported Home bindings;
        // a character never receives a control for a morph it does not own.
        this.mouthCornerUpNames = new Set(availableControlledNames.filter(
            name => /^Mouth_Up_[LR]$/.test(name),
        ))
        this.mouthCornerDownNames = new Set(availableControlledNames.filter(
            name => /^Mouth_Down_[LR]$/.test(name),
        ))

        if (!runtime.expressions[this._current]) {
            throw new Error(`Default Home expression is missing: ${this._current}`)
        }
        if (this.meshes.length === 0) {
            throw new Error('Home expression runtime requires an exported morph-target mesh')
        }
        this.apply()
    }

    get current(): string {
        return this._current
    }

    get automaticBlinkActive(): boolean {
        return this.faceLayerState === 'automatic-blink'
    }

    get expressionAutoBlinkActive(): boolean {
        return this.faceLayerState === 'expression-auto-blink'
    }

    get automaticBlinkAvailable(): boolean {
        if (!this.runtime.blink.controller) return false
        return this.manualBlinkAvailable
    }

    get manualBlinkAvailable(): boolean {
        return this.supportsManualBlink(
            this.faceLayerState === 'automatic-blink'
                ? this.runtime.defaultExpression
                : this._current,
        )
    }

    get mouthCornerControlAvailable(): boolean {
        return this.mouthCornerUpNames.size > 0 || this.mouthCornerDownNames.size > 0
    }

    supportsAutomaticBlink(name: string): boolean {
        const canonical = this.runtime.aliases[name] ?? name
        return !!this.runtime.blink.controller && this.supportsManualBlink(canonical)
    }

    supportsManualBlink(name: string = this._current): boolean {
        const canonical = this.runtime.aliases[name] ?? name
        const expression = this.runtime.expressions[canonical]
        if (!expression) return false
        if (!Object.keys(this.runtime.blink.weights).some(morphName => (
            this.meshes.some(mesh => morphName in mesh.morphTargetDictionary)
        ))) return false

        return !Object.entries(expression.weights).some(([morphName, weight]) => (
            weight >= 0.8
            && isEyeClosureMorph(morphName)
            && this.meshes.some(mesh => morphName in mesh.morphTargetDictionary)
        ))
    }

    set(name: string, automaticBlink = false) {
        if (name === 'HomeFace00_Default') {
            this.resetToDefault()
            return
        }
        const canonical = this.runtime.aliases[name] ?? name
        if (!this.runtime.expressions[canonical]) {
            throw new Error(`Home expression not found: ${name}`)
        }
        this.beginExpressionTransition()
        this._current = canonical
        this.autoBlink = automaticBlink && this.supportsAutomaticBlink(canonical)
        this.faceLayerState = this.autoBlink
            ? 'expression-auto-blink'
            : 'expression'
        this.apply()
    }

    /** Mirrors the controller's `FaceDefault` trigger. */
    resetToDefault() {
        this.beginExpressionTransition()
        this._current = this.runtime.defaultExpression
        this.faceLayerState = 'automatic-blink'
        this.autoBlink = !!this.runtime.blink.controller
        this.elapsed = 0
        this.apply()
    }

    setAutomaticBlink(enabled: boolean) {
        this.autoBlink = enabled && this.automaticBlinkAvailable
        if (this.faceLayerState === 'expression-auto-blink' && !this.autoBlink) {
            this.faceLayerState = 'expression'
        } else if (
            this.faceLayerState === 'expression'
            && this.autoBlink
            && this.supportsAutomaticBlink(this._current)
        ) {
            this.faceLayerState = 'expression-auto-blink'
        }
        this.apply()
    }

    setManualBlinkWeight(weight: number) {
        this.manualBlinkWeight = clamp01(weight)
        this.apply()
    }

    setMouthCornerWeight(weight: number) {
        this.mouthCornerWeight = THREE.MathUtils.clamp(weight, -1, 1)
        this.apply()
    }

    setExpressionWeight(weight: number) {
        this.expressionWeight = clamp01(weight)
        this.apply()
    }

    setExpressionTransitionSeconds(seconds: number) {
        this.expressionTransitionSeconds = Math.max(0, seconds)
        if (this.expressionTransitionSeconds === 0) {
            this.expressionTransitionFrom = null
        }
        this.apply()
    }

    update(delta: number) {
        const safeDelta = Math.max(0, delta)
        this.elapsed += safeDelta
        if (this.expressionTransitionFrom) {
            this.expressionTransitionElapsed += safeDelta
            if (this.expressionTransitionElapsed >= this.expressionTransitionSeconds) {
                this.expressionTransitionFrom = null
            }
        }
        if (this.mouthOpen) {
            this.mouthTime = (this.mouthTime + safeDelta) % this.runtime.mouth.duration
        } else {
            this.mouthTime = 0
        }
        this.apply()
    }

    private blinkWeight(): number {
        if (
            this.faceLayerState === 'expression'
            || !this.autoBlink
            || !this.runtime.blink.controller
        ) return 0
        const { duration, controller } = this.runtime.blink
        const blinkStart = controller.emptyExitTime
        const fullBlinkStart = blinkStart + controller.fadeInSeconds
        const fadeOutStart = fullBlinkStart + duration * controller.blinkExitTime
        const blinkEnd = fadeOutStart + controller.fadeOutSeconds
        const cycle = blinkEnd
            + controller.afterBlinkExitTime
            + controller.afterBlinkTransitionSeconds
            + controller.intervalExitTime / Math.max(controller.intervalSpeed, 1e-6)
            + controller.intervalTransitionSeconds
        const time = this.elapsed % cycle

        if (time < blinkStart || time >= blinkEnd) return 0
        if (time < fullBlinkStart) {
            return clamp01((time - blinkStart) / controller.fadeInSeconds)
        }
        if (time < fadeOutStart) return 1
        return clamp01(1 - (time - fadeOutStart) / controller.fadeOutSeconds)
    }

    private expressionTargetWeight(name: string): number {
        const defaultFace = this.runtime.expressions[this.runtime.defaultExpression].weights
        const selectedFace = this.runtime.expressions[this._current].weights
        if (this.faceLayerState === 'automatic-blink') return defaultFace[name] ?? 0
        return THREE.MathUtils.lerp(
            defaultFace[name] ?? 0,
            selectedFace[name] ?? 0,
            this.expressionWeight,
        )
    }

    private expressionBaseWeight(name: string): number {
        const target = this.expressionTargetWeight(name)
        if (!this.expressionTransitionFrom || this.expressionTransitionSeconds <= 0) {
            return target
        }
        const progress = clamp01(
            this.expressionTransitionElapsed / this.expressionTransitionSeconds,
        )
        return THREE.MathUtils.lerp(
            this.expressionTransitionFrom.get(name) ?? 0,
            target,
            progress,
        )
    }

    private beginExpressionTransition() {
        if (this.expressionTransitionSeconds <= 0) {
            this.expressionTransitionFrom = null
            this.expressionTransitionElapsed = 0
            return
        }
        this.expressionTransitionFrom = new Map(
            [...this.controlledNames].map(name => [name, this.expressionBaseWeight(name)]),
        )
        this.expressionTransitionElapsed = 0
    }

    private apply() {
        const selectedExpression = this.faceLayerState !== 'automatic-blink'
        const blinkSupported = this.supportsManualBlink(
            selectedExpression ? this._current : this.runtime.defaultExpression,
        )
        const blink = blinkSupported
            ? Math.max(this.manualBlinkWeight, this.blinkWeight())
            : 0
        const mouthCurve = this.mouthOpen
            ? evaluateCubicSegment(
                this.runtime.mouth.curveSegments,
                this.mouthTime,
            ) / 100
            : 0

        for (const mesh of this.meshes) {
            for (const name of this.controlledNames) {
                const index = mesh.morphTargetDictionary[name]
                if (index == undefined) continue
                // Every official FaceXX clip is a full constant snapshot. A
                // missing entry therefore means the keyed value was zero, not
                // "inherit". Manual expression strength blends that complete
                // snapshot against this character's official default face.
                let value = this.expressionBaseWeight(name)

                const blinkTarget = this.runtime.blink.weights[name]
                if (
                    blink > 0
                    && blinkTarget != undefined
                ) {
                    // Blend from the active face snapshot. Taking Math.max or
                    // stacking both closure families recreates the sideways
                    // second blink reported by users.
                    value = THREE.MathUtils.lerp(value, blinkTarget, blink)
                }
                if (
                    selectedExpression
                    && blink > 0
                    && blinkTarget == undefined
                    && conflictsWithStandardBlink(name)
                ) {
                    // Fade every expression-specific eyelid channel away while
                    // the standard blink channel fades in. Keeping anger, sad,
                    // open or alternate-close eyelids stacked with the official
                    // blink recreates the sideways/doubled eyelid defect.
                    value = THREE.MathUtils.lerp(value, 0, blink)
                }

                const cornerWeight = Math.abs(this.mouthCornerWeight)
                if (cornerWeight > 0) {
                    const raising = this.mouthCornerWeight > 0
                    if (this.mouthCornerUpNames.has(name)) {
                        value = THREE.MathUtils.lerp(value, raising ? 1 : 0, cornerWeight)
                    } else if (this.mouthCornerDownNames.has(name)) {
                        value = THREE.MathUtils.lerp(value, raising ? 0 : 1, cornerWeight)
                    }
                }

                if (this.mouthOpen) {
                    // MouthLayer is the final Override layer.  Only bindings
                    // present in HomeMouthOpen replace the face result.  Unity
                    // blend-shape weights are signed and unbounded (official
                    // data uses -1.0 and 2.0), so never clamp or max-composite.
                    if (this.runtime.mouth.curveTarget === name) {
                        value = mouthCurve
                    }
                    const constantWeight = this.runtime.mouth.constantWeights[name]
                    if (constantWeight != undefined) {
                        value = constantWeight
                    }
                }
                mesh.morphTargetInfluences[index] = value
            }
        }
    }
}
