import * as THREE from 'three';
import { disposeObject } from './utils';
import { addAnimationLoop, getClockDelta, removeAnimationLoop } from './renderer';

export interface ObjectUserData {
    characterId: number
    /** Original meshes of the object. Does not include outline meshes */
    meshes: THREE.Mesh[]
    textures: THREE.Texture[]
    outlineMeshes: THREE.SkinnedMesh[]
    animationLoops: Function[]
}

/**
 * Exedra exports one logical animation as a full-body clip plus optional weapon
 * or masked companion clips. Normalize only documented suffixes. The previous
 * startsWith() grouping could activate unrelated animations that happened to
 * share a prefix, which is especially destructive when clips key the same bones.
 */
export function getAnimationFamilyName(name: string): string {
    return name
        .replace(/_weapon_[a-z0-9]+(?=_|$)/gi, '')
        .replace(/_\d+$/g, '')
}

function isCompanionAnimationName(name: string): boolean {
    return /_weapon_[a-z0-9]+(?=_|$)/i.test(name) || /_\d+$/.test(name)
}

export default class MagiaExedraCharacter3D {
    /** 
     * Can be added to three.js scene.
     * 
     * The scene must use a renderer created by `MagiaExedraCharacterThree.createRenderer()` to render correctly.
     */
    object: THREE.Group
    userData: ObjectUserData
    animation: ChatacterAnimation
    meshes: CharacterMeshController[]

    constructor(object: THREE.Group) {
        this.object = object
        this.userData = object.userData as ObjectUserData

        this.animation = new ChatacterAnimation(this)
        this.meshes = this.userData.meshes.map(x => new CharacterMeshController(x))

        addAnimationLoop(this.animationLoop)
    }

    animationLoop = () => {
        this.animation.animationLoop()
        this.userData.animationLoops.forEach(x => x())
    }

    get animations(): string[] {
        return [...new Set(
            this.object.animations
                .filter(x => x.tracks.length > 0)
                .map(x => getAnimationFamilyName(x.name))
        )].sort()
    }

    private _disposed = false

    get disposed() {
        return this._disposed
    }

    dispose() {
        removeAnimationLoop(this.animationLoop)
        this.animation.mixer.stopAllAction()
        this.animation.mixer.uncacheRoot(this.object)
        disposeObject(this.object)
        this.userData.textures.forEach(x => x.dispose())

        this._disposed = true
    }
}

export class ChatacterAnimation {
    private _character: MagiaExedraCharacter3D
    mixer: THREE.AnimationMixer
    private _default?: string | null = null
    private _current?: string
    private _clamped = false
    private _preparedFamilies = new Map<string, THREE.AnimationClip[]>()
    paused = false

    constructor(character: MagiaExedraCharacter3D) {
        this._character = character
        this.mixer = new THREE.AnimationMixer(this._character.object)

        this.mixer.addEventListener('finished', this.onFinishHandler)
    }

    play(name: string, loop = false) {
        /*
        Character, weapon and partially masked body motion can be exported as
        separate AnimationClips. The numbered clip is not consistently the
        weapon clip: Ashley 110701 has families where `_1` is the full-body clip
        and other families where the unnumbered clip is full-body. The family is
        therefore ordered by binding coverage, not by suffix.
        */
        const animations = this.getPreparedAnimationClipsByName(name)
        if (animations.length == 0) {
            console.warn(`Animation "${name}" not found in "${this._character.object.name}"`)
            return
        }

        this.mixer.stopAllAction()

        for (const animation of animations) {
            const action = this.mixer.clipAction(animation);

            if (loop) {
                action.setLoop(THREE.LoopRepeat, Infinity);
                action.clampWhenFinished = false;
            } else {
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
            }

            action.reset().play()
        }

        this.paused = false
        this.time = 0
        this._current = getAnimationFamilyName(name)
        this._clamped = false

        console.log('Playing animation family:', this._current, animations.map(x => x.name))
    }

    clear() {
        this.mixer.stopAllAction()
        this._current = undefined
    }

    getAnimationClipsByName(name: string): THREE.AnimationClip[] {
        const family = getAnimationFamilyName(name)
        return this._character.object.animations
            .filter(clip => getAnimationFamilyName(clip.name) === family)
            .sort((a, b) => {
                // The clip with the broadest binding coverage is the base pose.
                // This is required for Ashley: e.g. Wait_L has ~69 target
                // channels while Wait_L_1 has ~603, but CommonWait_L uses the
                // opposite suffix arrangement.
                const coverage = b.tracks.length - a.tracks.length
                if (coverage !== 0) return coverage

                const exactA = a.name === name || a.name === family ? 0 : 1
                const exactB = b.name === name || b.name === family ? 0 : 1
                if (exactA !== exactB) return exactA - exactB

                const companionA = isCompanionAnimationName(a.name) ? 1 : 0
                const companionB = isCompanionAnimationName(b.name) ? 1 : 0
                if (companionA !== companionB) return companionA - companionB

                return a.name.localeCompare(b.name)
            })
    }

    /**
     * Exported companion clips can contain duplicate body channels in addition
     * to weapon channels. Playing them at equal weight blends conflicting
     * transforms onto the same bone and produces a broken pose. The full-body
     * clip (largest track set) owns each binding; smaller companions retain only
     * previously unclaimed channels.
     */
    private getPreparedAnimationClipsByName(name: string): THREE.AnimationClip[] {
        const family = getAnimationFamilyName(name)
        const cached = this._preparedFamilies.get(family)
        if (cached) return cached

        const sourceClips = this.getAnimationClipsByName(name)
        const claimedTracks = new Map<string, string>()
        const prepared: THREE.AnimationClip[] = []

        for (const source of sourceClips) {
            const duplicateTracks: string[] = []
            const uniqueTracks = source.tracks.filter(track => {
                const owner = claimedTracks.get(track.name)
                if (owner) {
                    duplicateTracks.push(`${track.name} (already owned by ${owner})`)
                    return false
                }
                claimedTracks.set(track.name, source.name)
                return true
            })

            if (duplicateTracks.length > 0) {
                console.warn(
                    `Removed duplicate animation bindings from "${source.name}" in family "${family}":`,
                    duplicateTracks,
                )
            }

            if (uniqueTracks.length == 0) {
                console.warn(`Skipped animation companion "${source.name}" because every track duplicates an earlier clip`)
                continue
            }

            if (uniqueTracks.length === source.tracks.length) {
                prepared.push(source)
                continue
            }

            const clone = source.clone()
            clone.name = source.name
            clone.tracks = uniqueTracks
            clone.duration = source.duration
            prepared.push(clone)
        }

        this._preparedFamilies.set(family, prepared)
        return prepared
    }

    animationLoop = () => {
        if (this.paused) return
        const delta = getClockDelta()
        this.mixer.update(delta)
    }

    onFinishHandler = () => {
        this._clamped = true
    }

    get default(): string | undefined {
        if (this._default === null) {
            this._default = this._character.animations.find(x => x.startsWith('CommonWait') || x.startsWith('DungeonWait'))
            if (!this._default) {
                console.warn(`Default animation not found in "${this._character.object.name}"`)
            }
        }
        return this._default
    }

    get current(): string | undefined {
        return this._current
    }

    get clamped(): boolean {
        return this._clamped
    }

    get duration(): number {
        if (this.current) {
            const clips = this.getPreparedAnimationClipsByName(this.current)
            return clips.length > 0 ? Math.max(...clips.map(x => x.duration)) : 0
        } else {
            return 0
        }
    }

    get time(): number {
        if (this.current) {
            if (this.clamped) {
                return this.duration
            } else {
                const duration = this.duration
                return duration > 0 ? this.mixer.time % duration : 0
            }
        } else {
            return 0
        }
    }
    set time(value) {
        this.mixer.setTime(value)
    }
}

export class CharacterMeshController {
    mesh: THREE.Mesh
    static OutlineAlwaysVisible = false
    private _outlineAlwaysVisible = CharacterMeshController.OutlineAlwaysVisible

    constructor(mesh: THREE.Mesh) {
        this.mesh = mesh
    }

    get name() {
        return this.mesh.name
    }

    get material(): THREE.Material | undefined {
        if (Array.isArray(this.mesh.material)) {
            if (this.mesh.material.length > 0) {
                return this.mesh.material[0]
            } else {
                return undefined
            }
        } else {
            return this.mesh.material
        }
    }

    get materials(): THREE.Material[] {
        return Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material]
    }

    get defaultVisibility(): boolean {
        const name = this.mesh.name.toLowerCase()

        // hide `eye_nohighlight` by default
        if (name.includes('eye_nohighlight')) {
            return false
        }

        // hide `face_a` for momoe nagisa
        if (name.includes('face') && name.includes('_a')) {
            return false
        }

        return true
    }

    get visible(): boolean {
        return this.mesh.visible && this.materials.every(x => x.visible)
    }

    set visible(value) {
        this.mesh.visible = value

        if (this.outlineAlwaysVisible && this.defaultVisibility == true) {
            this.mesh.visible = true
        }

        this.materials.forEach(x => x.visible = value)
    }

    get outlineAlwaysVisible() {
        return this._outlineAlwaysVisible
    }

    set outlineAlwaysVisible(value) {
        this._outlineAlwaysVisible = value

        this.visible = this.visible
    }

    restoreDefaultVisibility() {
        this.visible = this.defaultVisibility
    }
}
