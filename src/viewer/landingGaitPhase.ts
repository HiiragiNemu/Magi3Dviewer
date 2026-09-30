import { AnimationClip, Object3D, Quaternion } from 'three'

export interface LandingGaitPhase { phase: number; score: number; zeroPhaseScore: number; tracks: number }
/** Choose the nearest leg pose in the incoming gait, rather than always
 * restarting on frame zero. Sampling is read-only and runs only at contact. */
export function matchLandingGaitPhase(root: Object3D, clips: readonly AnimationClip[]): LandingGaitPhase | undefined {
    const bones = new Map<string, Object3D>()
    root.traverse(node => { bones.set(node.uuid, node); if (!bones.has(node.name)) bones.set(node.name, node) })
    const channels: Array<{ duration: number; weight: number; current: Quaternion; sample(t: number): ArrayLike<number> }> = []
    for (const clip of clips) {
        if (!(clip.duration > 0)) continue
        for (const track of clip.tracks) {
            const at = track.name.lastIndexOf('.')
            if (track.name.slice(at + 1) !== 'quaternion') continue
            const node = bones.get(track.name.slice(0, at))
            if (!node || !/^(UpLeg|Leg|Foot)_[LR]$/.test(node.name)) continue
            const interpolant = (track as typeof track & {
                createInterpolant(): { evaluate(t: number): ArrayLike<number> }
            }).createInterpolant()
            channels.push({ duration: clip.duration, weight: node.name.startsWith('UpLeg') ? 3 : node.name.startsWith('Leg') ? 2 : 1,
                current: node.quaternion.clone().normalize(), sample: t => interpolant.evaluate(t) })
        }
    }
    if (channels.length < 2) return
    const q = new Quaternion()
    const error = (phase: number): number => {
        let sum = 0
        for (const channel of channels) {
            const values = channel.sample(phase * channel.duration)
            if (values.length !== 4 || !Array.from(values).every(Number.isFinite)) return Infinity
            q.fromArray(values).normalize()
            const dot = Math.min(1, Math.abs(q.dot(channel.current)))
            sum += channel.weight * (1 - dot * dot)
        }
        return sum
    }
    let phase = 0, score = error(0)
    const zeroPhaseScore = score
    for (let i = 1; i < 32; i++) { const candidate = error(i / 32); if (candidate < score) { phase = i / 32; score = candidate } }
    return Number.isFinite(score) ? { phase, score, zeroPhaseScore, tracks: channels.length } : undefined
}
