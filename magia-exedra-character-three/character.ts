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
                .map(x => x.name.replace(/_\d/, ''))
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
    paused = false

    constructor(character: MagiaExedraCharacter3D) {
        this._character = character
        this.mixer = new THREE.AnimationMixer(this._character.object)

        this.mixer.addEventListener('finished', this.onFinishHandler)
    }

    play(name: string, loop = false) {
        /*
        character and its weapon have seperate animations
    
        for example:
        CommonWait_L    - for body
        CommonWait_L_1  - for weapon
    
        if it plays `CommonWait_L`, `CommonWait_L_1` should also be played
        */
        const animations = this.getAnimationClipsByName(name)
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

            action.play()
        }

        this.paused = false
        this.time = 0
        this._current = name
        this._clamped = false

        console.log('Playing animation:', animations.map(x => x.name))
    }

    clear() {
        this.mixer.stopAllAction()
        this._current = undefined
    }

    getAnimationClipsByName(name: string) {
        return this._character.object.animations.filter(x => x.name.startsWith(name))
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
            return Math.max(...this.getAnimationClipsByName(this.current).map(x => x.duration))
        } else {
            return 0
        }
    }

    get time(): number {
        if (this.current) {
            if (this.clamped) {
                return this.duration
            } else {
                return this.mixer.time % this.duration
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

    constructor(mesh: THREE.Mesh) {
        this.mesh = mesh
    }

    get name() {
        return this.mesh.name
    }

    get defaultVisibility(): boolean {
        let name = this.mesh.name.toLowerCase()

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

    get materials() {
        return Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material]
    }

    get visible(): boolean {
        return this.mesh.visible && this.materials.every(x => x.visible)
    }

    set visible(value) {
        if (value) {
            this.mesh.visible = true
        }
        else if (this.defaultVisibility == false) {
            this.mesh.visible = false
        }

        this.materials.forEach(x => x.visible = value)
    }

    restoreDefaultVisibility() {
        this.visible = this.defaultVisibility
    }
}
