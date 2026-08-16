import * as THREE from 'three'

export interface HomeAnimationRuntime {
    schema: 1
    characterId: number
    unityVersion: string
    source: string
    actions?: {
        wait01: { loopFamily: string }
        wait02: { loopFamily: string }
        unique01: {
            startFamily: string
            loopFamily: string
            enterTransitionSeconds: number
            startExitNormalizedTime: number
            startToLoopTransitionSeconds: number
        }
    }
    helpers?: string[]
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
    if (runtime.schema !== 1) {
        throw new Error(`Unsupported Home animation schema: ${runtime.schema}`)
    }

    const referencedPaths = new Set(Object.values(runtime.nodePaths))
    const objectsByPath = new Map<string, THREE.Object3D>()
    root.traverse(object => {
        const path = getObjectPath(object)
        if (!referencedPaths.has(path)) return
        if (objectsByPath.has(path)) {
            throw new Error(`Ambiguous Home animation target path in character FBX: ${path}`)
        }
        objectsByPath.set(path, object)
    })

    const clips = runtime.clips.map(serialized => {
        const tracks = serialized.tracks.map(track => {
            const separator = track.name.indexOf('.')
            if (separator < 1) {
                throw new Error(`Invalid Home animation track binding: ${track.name}`)
            }
            const sourceNodeId = track.name.slice(0, separator)
            const sourcePath = runtime.nodePaths[sourceNodeId]
            const target = sourcePath ? objectsByPath.get(sourcePath) : undefined
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

function clampWeight(value: number): number {
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

/**
 * Unity's Home controller has four layers, but expression and blink are states
 * in the same `FaceLayer`.  Selecting a FaceXX state therefore replaces the
 * automatic blink state machine; it must never be composited on top of a
 * selected expression.  `FaceDefault` returns that layer to the blink branch,
 * while `FaceDefaultLayer` continues to provide the character's base face.
 */
export class CharacterExpressionController {
    readonly runtime: HomeExpressionRuntime
    readonly meshes: MorphTargetMesh[]
    readonly expressions: string[]
    autoBlink = true
    mouthOpen = false

    private _current: string
    private elapsed = 0
    private mouthTime = 0
    private faceLayerState: 'automatic-blink' | 'expression' = 'automatic-blink'
    private readonly controlledNames: Set<string>

    constructor(meshes: THREE.Mesh[], runtime: HomeExpressionRuntime) {
        this.runtime = runtime
        this.meshes = meshes.filter(isMorphTargetMesh)
        this.expressions = runtime.expressionOrder.filter(name => !!runtime.expressions[name])
        this._current = runtime.defaultExpression
        this.controlledNames = new Set([
            ...Object.values(runtime.expressions).flatMap(expression => Object.keys(expression.weights)),
            ...Object.keys(runtime.blink.weights),
            ...Object.keys(runtime.mouth.constantWeights),
        ])
        if (runtime.mouth.curveTarget) {
            this.controlledNames.add(runtime.mouth.curveTarget)
        }

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

    set(name: string) {
        if (name === 'HomeFace00_Default') {
            this.resetToDefault()
            return
        }
        const canonical = this.runtime.aliases[name] ?? name
        if (!this.runtime.expressions[canonical]) {
            throw new Error(`Home expression not found: ${name}`)
        }
        this._current = canonical
        this.faceLayerState = 'expression'
        this.apply()
    }

    /** Mirrors the controller's `FaceDefault` trigger. */
    resetToDefault() {
        this._current = this.runtime.defaultExpression
        this.faceLayerState = 'automatic-blink'
        this.elapsed = 0
        this.apply()
    }

    update(delta: number) {
        this.elapsed += Math.max(0, delta)
        if (this.mouthOpen) {
            this.mouthTime = (this.mouthTime + Math.max(0, delta)) % this.runtime.mouth.duration
        } else {
            this.mouthTime = 0
        }
        this.apply()
    }

    private blinkWeight(): number {
        if (
            this.faceLayerState !== 'automatic-blink'
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
            return clampWeight((time - blinkStart) / controller.fadeInSeconds)
        }
        if (time < fadeOutStart) return 1
        return clampWeight(1 - (time - fadeOutStart) / controller.fadeOutSeconds)
    }

    private apply() {
        const base = this.runtime.expressions[this._current].weights
        const blink = this.blinkWeight()
        const mouthCurve = this.mouthOpen
            ? clampWeight(evaluateCubicSegment(
                this.runtime.mouth.curveSegments,
                this.mouthTime,
            ) / 100)
            : 0

        for (const mesh of this.meshes) {
            for (const name of this.controlledNames) {
                const index = mesh.morphTargetDictionary[name]
                if (index == undefined) continue
                const baseWeight = base[name] ?? 0
                const blinkLayer = (this.runtime.blink.weights[name] ?? 0) * blink
                const mouthLayer = this.mouthOpen
                    ? Math.max(
                        this.runtime.mouth.curveTarget
                            && name === this.runtime.mouth.curveTarget
                            ? mouthCurve
                            : 0,
                        this.runtime.mouth.constantWeights[name] ?? 0,
                    )
                    : 0
                mesh.morphTargetInfluences[index] = clampWeight(
                    Math.max(baseWeight, blinkLayer, mouthLayer),
                )
            }
        }
    }
}
