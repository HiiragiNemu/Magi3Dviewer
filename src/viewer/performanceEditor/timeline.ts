import { CHARACTER_TIMELINE_SCHEMA, CharacterTimeline } from '../characterTimeline.ts'
import type { CharacterTimelineTrack } from '../characterTimeline.ts'
import type { PerformanceDocument, PerformanceKey, PerformanceTrack, SampledPerformanceTrack } from './types.ts'

const kinds: Record<PerformanceTrack['channel'], string> = {
    'root-position': 'position', 'root-rotation': 'rotation', 'root-scale': 'scale',
    'bone-position': 'position', 'bone-rotation': 'rotation', 'bone-scale': 'scale',
    morph: 'morph', action: 'clip',
}
export function emptyPerformanceDocument(): PerformanceDocument {
    return { schema: 'performance-editor-v1', duration: 10, loop: false, tracks: [], audioTracks: [] }
}

export class PerformanceTimeline {
    private document: PerformanceDocument
    private sampler!: CharacterTimeline
    constructor(document: PerformanceDocument = emptyPerformanceDocument()) {
        this.document = structuredClone(document)
        this.compile()
    }
    private compile() {
        const d = this.document
        if (d.schema !== 'performance-editor-v1' || !Number.isFinite(d.duration) || d.duration <= 0
            || typeof d.loop !== 'boolean' || !Array.isArray(d.tracks)) throw new Error('Invalid performance document')
        if (d.audioTracks !== undefined) {
            if (!Array.isArray(d.audioTracks)) throw new Error('Invalid audio track metadata')
            const audioIds = new Set<string>()
            for (const audio of d.audioTracks) {
                if (!audio || typeof audio.id !== 'string' || !audio.id || audioIds.has(audio.id)
                    || typeof audio.sourceStableKey !== 'string' || !audio.sourceStableKey.trim()
                    || !Number.isFinite(audio.startTime) || audio.startTime < 0 || audio.startTime > d.duration
                    || (audio.offsetSeconds !== undefined && (!Number.isFinite(audio.offsetSeconds) || audio.offsetSeconds < 0))
                    || (audio.durationSeconds !== undefined && (!Number.isFinite(audio.durationSeconds) || audio.durationSeconds <= 0))
                    || (audio.volume !== undefined && (!Number.isFinite(audio.volume) || audio.volume < 0 || audio.volume > 1))
                    || ((audio.actorKey !== undefined || audio.generation !== undefined)
                        && (typeof audio.actorKey !== 'string' || !audio.actorKey.trim()
                            || !Number.isSafeInteger(audio.generation) || audio.generation! < 0))
                    || (audio.lipSync !== undefined && typeof audio.lipSync !== 'boolean')) {
                    throw new Error('Invalid audio track metadata')
                }
                audioIds.add(audio.id)
            }
        }
        const ids = new Set<string>()
        const keyIds = new Set<string>()
        const channels = new Set<string>()
        const tracks: CharacterTimelineTrack[] = d.tracks.map(track => {
            if (!track.id || ids.has(track.id) || !track.actorKey || !Object.hasOwn(kinds, track.channel)) throw new Error('Invalid or duplicate track')
            ids.add(track.id)
            if ((track.channel.startsWith('bone-') || track.channel === 'morph') && !track.property) throw new Error('Missing channel property')
            const channel = JSON.stringify([track.actorKey, track.channel, track.property || ''])
            if (channels.has(channel)) throw new Error('Multiple tracks write one actor channel')
            channels.add(channel)
            if (!Array.isArray(track.keys) || !track.keys.length) throw new Error('Empty track')
            track.keys.sort((a, b) => a.time - b.time)
            const times = new Set<number>()
            for (const key of track.keys) {
                if (!key.id || keyIds.has(key.id) || !Number.isFinite(key.time) || key.time < 0 || key.time > d.duration || times.has(key.time)) throw new Error('Invalid or duplicate key')
                keyIds.add(key.id); times.add(key.time)
            }
            return { id: track.id, targetId: track.actorKey, kind: kinds[track.channel], property: track.property,
                interpolation: track.channel === 'action' ? 'step' : track.interpolation || 'linear',
                keyframes: track.keys.map(key => ({ time: key.time, value: key.value })) }
        })
        this.sampler = new CharacterTimeline({ schema: CHARACTER_TIMELINE_SCHEMA, duration: d.duration, loop: false, tracks })
    }
    get value() { return structuredClone(this.document) }
    replace(document: PerformanceDocument) {
        const validated = new PerformanceTimeline(document)
        this.document = validated.document; this.sampler = validated.sampler
    }
    upsertTrack(track: PerformanceTrack) {
        const document = this.value
        const index = document.tracks.findIndex(row => row.id === track.id)
        if (index < 0) document.tracks.push(structuredClone(track))
        else document.tracks[index] = structuredClone(track)
        this.replace(document)
    }
    upsertKey(trackId: string, key: PerformanceKey) {
        const document = this.value
        const track = document.tracks.find(row => row.id === trackId)
        if (!track) throw new Error('Track absent')
        const index = track.keys.findIndex(row => row.id === key.id)
        if (index < 0) track.keys.push(structuredClone(key))
        else track.keys[index] = structuredClone(key)
        this.replace(document)
    }
    deleteKey(trackId: string, keyId: string) {
        const document = this.value
        const track = document.tracks.find(row => row.id === trackId)
        if (!track) return
        track.keys = track.keys.filter(key => key.id !== keyId)
        document.tracks = document.tracks.filter(row => row.keys.length)
        this.replace(document)
    }
    sample(time: number): SampledPerformanceTrack[] {
        if (!Number.isFinite(time)) throw new Error('Invalid timeline time')
        const bounded = Math.max(0, Math.min(this.document.duration, time))
        return this.sampler.sample(bounded).flatMap(sample => {
            const track = this.document.tracks.find(row => row.id === sample.trackId)!
            const key = [...track.keys].reverse().find(row => row.time <= bounded)
            if (track.channel === 'action' && !key) return []
            return [{ track: structuredClone(track), value: structuredClone(sample.value), keyId: (key || track.keys[0]).id,
                localTime: key ? bounded - key.time : 0 }]
        })
    }
    actionCrossings(from: number, to: number) {
        return this.document.tracks.flatMap(track => track.channel !== 'action' ? [] : track.keys
            .filter(key => key.time > from && key.time <= to)
            .map(key => ({ track: structuredClone(track), key: structuredClone(key) })))
            .sort((a, b) => a.key.time - b.key.time || a.key.id.localeCompare(b.key.id))
    }
    serialize() { return JSON.stringify(this.document) }
    static deserialize(text: string) { return new PerformanceTimeline(JSON.parse(text) as PerformanceDocument) }
}
