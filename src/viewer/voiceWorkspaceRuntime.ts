import {
    VoiceUploadWorkspace,
    type VoiceCharacterTarget,
    type VoiceUploadCharacterDescriptor,
    type VoiceUploadTrackSnapshot,
    type VoiceUploadWorkspaceEnvironment,
} from './voice/index.ts'
import type {
    VoicePanelWorkspaceCharacter,
    VoicePanelWorkspaceCommand,
    VoicePanelWorkspaceRuntime,
    VoicePanelWorkspaceTrackSnapshot,
} from './voicePanel.ts'

export interface ViewerVoiceWorkspaceRuntimeOptions {
    environment?: Partial<VoiceUploadWorkspaceEnvironment>
}

type BeforeCharacterPlayHandler = (
    character: VoicePanelWorkspaceCharacter,
) => void | Promise<void>

function panelStatus(
    status: VoiceUploadTrackSnapshot['status'],
): VoicePanelWorkspaceTrackSnapshot['status'] {
    return status === 'disposed' ? 'error' : status
}

export class ViewerVoiceWorkspaceRuntime implements VoicePanelWorkspaceRuntime {
    readonly workspace: VoiceUploadWorkspace
    private readonly characters = new Map<string, VoicePanelWorkspaceCharacter>()
    private beforeCharacterPlayHandler: BeforeCharacterPlayHandler | null = null
    private disposed = false

    constructor(options: ViewerVoiceWorkspaceRuntimeOptions = {}) {
        const environment = options.environment
        const upstreamBeforeCharacterPlay = environment?.beforeCharacterPlay
        this.workspace = new VoiceUploadWorkspace({
            ...environment,
            beforeCharacterPlay: async descriptor => {
                await upstreamBeforeCharacterPlay?.(descriptor)
                const character = this.characters.get(descriptor.key)
                if (character) await this.beforeCharacterPlayHandler?.(character)
            },
        })
    }

    snapshot(): readonly VoicePanelWorkspaceTrackSnapshot[] {
        const snapshot = this.workspace.snapshot
        return [
            ...snapshot.characterTracks.map(track => this.toPanelTrack(track)),
            ...snapshot.backgroundTracks.map(track => this.toPanelTrack(track)),
        ]
    }

    subscribe(
        listener: (tracks: readonly VoicePanelWorkspaceTrackSnapshot[]) => void,
    ): () => void {
        return this.workspace.subscribe(() => listener(this.snapshot()))
    }

    setCharacters(characters: readonly VoicePanelWorkspaceCharacter[]): void {
        if (this.disposed) return
        this.characters.clear()
        const descriptors: VoiceUploadCharacterDescriptor[] = []
        for (const character of characters) {
            const key = character.actorKey.trim()
            if (!key || this.characters.has(key)) continue
            const value = { ...character, actorKey: key }
            this.characters.set(key, value)
            descriptors.push({
                key,
                characterResourceId: character.characterResourceId,
                label: character.label?.trim() || character.characterResourceId,
                target: character.target,
            })
        }
        this.workspace.setCharacters(descriptors)
    }

    uploadCharacterTrack(character: VoicePanelWorkspaceCharacter, file: File): void {
        this.assertActive()
        if (this.characters.get(character.actorKey)?.target !== character.target) {
            const next = new Map(this.characters)
            next.set(character.actorKey, character)
            this.setCharacters([...next.values()])
        }
        if (!this.workspace.loadCharacterFile(character.actorKey, file)) {
            throw new Error(this.trackReason(character.actorKey) || `Local character audio load failed: ${file.name}`)
        }
    }

    uploadBackgroundTrack(file: File): void {
        this.assertActive()
        const key = this.workspace.addBackgroundFile(file)
        if (!key) throw new Error(`Local background audio load failed: ${file.name}`)
    }

    async dispatch(command: VoicePanelWorkspaceCommand): Promise<void> {
        this.assertActive()
        const track = this.snapshot().find(value => value.trackId === command.trackId)
        if (!track) throw new Error(`Audio workspace track is absent: ${command.trackId}`)
        const character = track.kind === 'character'

        switch (command.type) {
            case 'play': {
                const played = character
                    ? await this.workspace.playCharacter(command.trackId)
                    : await this.workspace.playBackground(command.trackId)
                if (!played) throw new Error(this.trackReason(command.trackId) || `Audio track did not start: ${command.trackId}`)
                return
            }
            case 'pause':
                if (character) this.workspace.pauseCharacter(command.trackId)
                else this.workspace.pauseBackground(command.trackId)
                return
            case 'stop':
                if (character) this.workspace.stopCharacter(command.trackId)
                else this.workspace.stopBackground(command.trackId)
                return
            case 'remove':
                if (character) this.workspace.removeCharacterFile(command.trackId)
                else this.workspace.removeBackgroundTrack(command.trackId)
                return
            case 'seek':
                if (character) this.workspace.seekCharacter(command.trackId, command.seconds)
                else this.workspace.seekBackground(command.trackId, command.seconds)
                return
            case 'volume':
                if (character) this.workspace.setCharacterVolume(command.trackId, command.value)
                else this.workspace.setBackgroundVolume(command.trackId, command.value)
                return
            case 'loop':
                if (!character) this.workspace.setBackgroundLoop(command.trackId, command.enabled)
                return
            case 'lip-sync':
                if (character) this.workspace.setCharacterLipSync(command.trackId, command.enabled)
                return
        }
    }

    setBeforeCharacterPlay(handler: BeforeCharacterPlayHandler | null): void {
        this.beforeCharacterPlayHandler = handler
    }

    stopCharacterForTarget(target: VoiceCharacterTarget): void {
        this.workspace.stopCharacterForTarget(target)
    }

    update(deltaSeconds: number): void {
        this.workspace.update(deltaSeconds)
    }

    async dispose(): Promise<void> {
        if (this.disposed) return
        this.disposed = true
        this.beforeCharacterPlayHandler = null
        this.characters.clear()
        await this.workspace.dispose()
    }

    private toPanelTrack(track: VoiceUploadTrackSnapshot): VoicePanelWorkspaceTrackSnapshot {
        return {
            trackId: track.key,
            kind: track.kind,
            actorKey: track.kind === 'character' ? track.key : undefined,
            fileName: track.fileName ?? '',
            status: panelStatus(track.status),
            positionSeconds: track.positionSeconds,
            durationSeconds: track.durationSeconds ?? 0,
            volume: track.volume,
            loop: track.loop,
            lipSync: track.lipSyncEnabled,
            reason: track.error ?? undefined,
        }
    }

    private trackReason(key: string): string | null {
        const snapshot = this.workspace.snapshot
        return [
            ...snapshot.characterTracks,
            ...snapshot.backgroundTracks,
        ].find(track => track.key === key)?.error ?? null
    }

    private assertActive(): void {
        if (this.disposed) throw new Error('Audio workspace is disposed')
    }
}

export function createViewerVoiceWorkspaceRuntime(
    options: ViewerVoiceWorkspaceRuntimeOptions = {},
): ViewerVoiceWorkspaceRuntime {
    return new ViewerVoiceWorkspaceRuntime(options)
}
