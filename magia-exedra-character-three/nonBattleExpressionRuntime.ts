import * as THREE from 'three'
import type MagiaExedraCharacter3D from './character.ts'
import type { NonBattleCharacterProfile } from './nonBattleCharacterLoader.ts'
import nativeProduct from './nonbattle-expressions.generated.json'

type Curve = {
    storage: 'constant'; value: number
} | {
    storage: 'dense'; beginTime: number; sampleRate: number; values: number[]
} | {
    storage: 'streamed'; keys: Array<{ time: number; coeff: number[] }>
}
interface NativeMorphBinding {
    rendererPath: string
    rendererPathId: string
    meshPathId: string
    fbxName: string
    attributeHash: number
    pathHash: number
}
interface NativeStoryClip {
    pathId: string
    importedName: string
    duration: number
    states: Array<{ name: string; loop: boolean; speed: number }>
    morphCurves: Array<NativeMorphBinding & Curve>
}
interface NativeStoryProduct {
    id: number
    identityKey: string
    controllerPathId: string
    defaultAction: string
    clips: NativeStoryClip[]
}
export interface NonBattleExpressionRuntime {
    readonly kind: 'native-story-face-action'
    readonly actions: ReadonlyArray<{ id: string; label: string; clip: string; sourceClipPathId: string }>
    readonly current: string | undefined
    play(id: string): void
    resetToDefault(): void
}
const products = nativeProduct.characters as unknown as NativeStoryProduct[]
const runtimes = new WeakMap<MagiaExedraCharacter3D, NonBattleExpressionRuntime>()

/** Unity streamed polynomial coefficients are preserved, not resampled poses. */
export function sampleNativeStoryCurve(curve: Curve, time: number): number {
    if (curve.storage === 'constant') return curve.value
    if (curve.storage === 'dense') {
        const f = Math.max(0, Math.min(curve.values.length - 1,
            (time - curve.beginTime) * curve.sampleRate))
        const a = Math.floor(f), b = Math.min(a + 1, curve.values.length - 1)
        return curve.values[a]! + (curve.values[b]! - curve.values[a]!) * (f - a)
    }
    let low = 0, high = curve.keys.length
    while (low + 1 < high) {
        const mid = (low + high) >>> 1
        if (curve.keys[mid]!.time <= time) low = mid
        else high = mid
    }
    const key = curve.keys[low]!
    const dt = Math.max(0, time - key.time)
    const [a, b, c, d] = key.coeff
    return ((a! * dt + b!) * dt + c!) * dt + d!
}

class NativeStoryInterpolant extends THREE.LinearInterpolant {
    private readonly curve: Curve
    constructor(curve: Curve, result?: THREE.TypedArray) {
        super(new Float32Array([0]), new Float32Array([0]), 1, result)
        this.curve = curve
    }
    override evaluate(time: number) {
        this.resultBuffer[0] = sampleNativeStoryCurve(this.curve, time)
        return this.resultBuffer
    }
}

function exactPath(root: THREE.Object3D, path: string): THREE.Object3D {
    const parts = path.split('/')
    if (parts.shift() !== root.name) throw new Error(`Story morph root mismatch: ${path}`)
    let current = root
    for (const name of parts) {
        const matches = current.children.filter(child => child.name === name)
        if (matches.length !== 1) throw new Error(`Story morph path count ${matches.length}: ${path}`)
        current = matches[0]!
    }
    return current
}

export function getNonBattleExpressionRuntime(character: MagiaExedraCharacter3D | undefined) {
    return character ? runtimes.get(character) : undefined
}

export function installNonBattleExpressions(
    character: MagiaExedraCharacter3D,
    profile: NonBattleCharacterProfile,
): NonBattleExpressionRuntime {
    const existing = runtimes.get(character)
    if (existing) return existing
    const matches = products.filter(p => p.id === character.userData.characterId
        && p.identityKey === profile.identity.identityKey
        && p.controllerPathId === profile.storyController.activeControllerPathId)
    if (matches.length !== 1) throw new Error(`Story expression identity count: ${matches.length}`)
    const product = matches[0]!
    if (product.clips.length !== profile.storyController.clips.length) {
        throw new Error('Story expression source clip count mismatch')
    }
    const pending: Array<{ clip: THREE.AnimationClip; tracks: THREE.KeyframeTrack[] }> = []
    for (const source of product.clips) {
        const authority = profile.storyController.clips.filter(c => c.pathId === source.pathId
            && c.name === source.importedName)
        const clips = character.object.animations.filter(c => c.name === source.importedName)
        if (authority.length !== 1 || clips.length !== 1) {
            throw new Error(`Story expression clip identity mismatch: ${source.pathId}`)
        }
        const clip = clips[0]!, tracks: THREE.KeyframeTrack[] = []
        for (const binding of source.morphCurves) {
            const renderer = profile.model.renderers.find(r => r.hierarchyPath === binding.rendererPath
                && r.rendererPathId === binding.rendererPathId && r.meshPathId === binding.meshPathId)
            if (!renderer) throw new Error(`Story morph renderer PPtr mismatch: ${binding.rendererPath}`)
            const mesh = exactPath(character.object, binding.rendererPath) as THREE.Mesh
            const index = mesh.morphTargetDictionary?.[binding.fbxName]
            if (!mesh.isMesh || index === undefined || !mesh.morphTargetInfluences
                || index >= mesh.morphTargetInfluences.length) {
                throw new Error(`Story morph channel missing: ${binding.rendererPath}/${binding.fbxName}`)
            }
            const name = `${mesh.uuid}.morphTargetInfluences[${index}]`
            if (clip.tracks.some(t => t.name === name) || tracks.some(t => t.name === name)) {
                throw new Error(`Duplicate story morph binding: ${name}`)
            }
            const track = new THREE.NumberKeyframeTrack(name, [0, source.duration],
                [sampleNativeStoryCurve(binding, 0), sampleNativeStoryCurve(binding, source.duration)])
            track.InterpolantFactoryMethodLinear = result => new NativeStoryInterpolant(binding, result)
            track.setInterpolation(THREE.InterpolateLinear)
            tracks.push(track)
        }
        pending.push({ clip, tracks })
    }
    // Commit only after every exact path/PPtr/channel has passed. Existing body
    // tracks and their natural clocks remain in their original AnimationClip.
    for (const { clip, tracks } of pending) clip.tracks.push(...tracks)
    const actions = product.clips.map(source => ({
        id: source.pathId,
        label: `${source.importedName} · story face/action`,
        clip: source.importedName,
        sourceClipPathId: source.pathId,
    }))
    const runtime: NonBattleExpressionRuntime = {
        kind: 'native-story-face-action', actions,
        get current() {
            return actions.find(a => a.clip === character.animation.current)?.id
        },
        play(id) {
            if (character.disposed || runtimes.get(character) !== runtime) return
            const source = product.clips.find(c => c.pathId === id)
            if (!source) throw new Error(`Unknown native story expression action: ${id}`)
            // Only a unanimous native state loop is repeated. Clips absent from
            // the active controller remain available as explicit one-shot previews.
            const loop = source.states.length > 0 && source.states.every(s => s.loop)
            character.animation.play(source.importedName, loop)
        },
        resetToDefault() {
            const action = actions.find(a => a.clip === product.defaultAction)
            if (!action) throw new Error('Missing native story default action')
            runtime.play(action.id)
        },
    }
    runtimes.set(character, runtime)
    character.userData.disposeCallbacks.push(() => { runtimes.delete(character) })
    return runtime
}
