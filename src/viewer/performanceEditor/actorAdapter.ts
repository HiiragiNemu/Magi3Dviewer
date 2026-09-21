import type { Object3D } from 'three'
import { applyTransform, captureTransform } from './pose.ts'
import type { ActorDescriptor, ChannelSelection, PoseSnapshot } from './types.ts'

interface MorphObject extends Object3D {
    morphTargetDictionary?: Record<string, number>
    morphTargetInfluences?: number[]
}
export class PerformanceActorAdapter {
    readonly descriptor: ActorDescriptor
    readonly key: string
    readonly bones = new Map<string, Object3D>()
    readonly morphs = new Map<string, { values: number[]; index: number }>()
    readonly labels = new Map<string, string>()
    private disposed = false

    constructor(descriptor: ActorDescriptor) {
        this.descriptor = descriptor
        this.key = descriptor.object.uuid
        const visit = (object: Object3D, path: string) => {
            if ((object as Object3D & { isBone?: boolean }).isBone) {
                this.bones.set(path, object)
                this.labels.set(path, object.name || path)
            }
            const mesh = object as MorphObject
            if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
                for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
                    if (!Number.isInteger(index) || index < 0 || index >= mesh.morphTargetInfluences.length) continue
                    const key = `${path}#${encodeURIComponent(name)}`
                    this.morphs.set(key, { values: mesh.morphTargetInfluences, index })
                    this.labels.set(key, `${object.name || path} / ${name}`)
                }
            }
            object.children.forEach((child, index) => visit(child, `${path}/${index}:${child.name}`))
        }
        visit(descriptor.object, '.')
    }

    get current() { return !this.disposed && this.descriptor.isCurrent() }
    capture(channels: ChannelSelection): PoseSnapshot {
        if (!this.current) throw new Error(`Stale performance actor: ${this.key}`)
        const pose: PoseSnapshot = { bones: {}, morphs: {} }
        if (channels.root) pose.root = captureTransform(this.descriptor.object)
        for (const key of channels.bones) {
            const bone = this.bones.get(key)
            if (!bone) throw new Error(`Bone channel absent: ${key}`)
            pose.bones[key] = captureTransform(bone)
        }
        for (const key of channels.morphs) {
            const morph = this.morphs.get(key)
            if (!morph) throw new Error(`Morph channel absent: ${key}`)
            pose.morphs[key] = morph.values[morph.index]
        }
        return pose
    }

    apply(pose: PoseSnapshot, phase: 'body' | 'face') {
        if (!this.current) return
        if (phase === 'body') {
            if (pose.root) applyTransform(this.descriptor.object, pose.root)
            for (const [key, transform] of Object.entries(pose.bones)) {
                const bone = this.bones.get(key)
                if (bone) applyTransform(bone, transform)
            }
        } else {
            for (const [key, value] of Object.entries(pose.morphs)) {
                const morph = this.morphs.get(key)
                if (morph && Number.isFinite(value)) morph.values[morph.index] = value
            }
        }
    }

    dispose() { this.disposed = true; this.bones.clear(); this.morphs.clear(); this.labels.clear() }
}
