import * as THREE from 'three';
import { disposeObject } from './utils';
import { addAnimationLoop, getClockDelta, removeAnimationLoop } from './renderer';

export interface ObjectUserData {
    characterId: number
    /** Original meshes of the object. Does not include outline meshes */
    meshes: THREE.Mesh[]
    textures: THREE.Texture[]
    outlineMeshes: THREE.SkinnedMesh[]
}

export default class MagiaExedraCharacter3D {
    /** 
     * Can be added to three.js scene.
     * 
     * The scene must use a renderer created by `MagiaExedraCharacterThree.createRenderer()` to render correctly.
     */
    object: THREE.Group
    userData: ObjectUserData
    mixer: THREE.AnimationMixer
    lastPlayedAnimations: string[] | undefined

    constructor(object: THREE.Group) {
        this.object = object
        this.userData = object.userData as ObjectUserData
        this.mixer = new THREE.AnimationMixer(object)

        addAnimationLoop(this.animationLoop)
    }

    get animations(): string[] {
        return [...new Set(
            this.object.animations
                .filter(x => x.tracks.length > 0)
                .map(x => x.name.replace(/_\d/, ''))
        )].sort()
    }

    animationLoop = () => {
        const delta = getClockDelta()
        this.mixer.update(delta)
    }

    playAnimation(name: string | undefined = undefined, loop = false): string[] {
        if (!name) loop = true

        /*
        character and its weapon have seperate animations
    
        for example:
        CommonWait_L    - for body
        CommonWait_L_1  - for weapon
    
        if it plays `CommonWait_L`, `CommonWait_L_1` should also be played
        */
        const animations = this.object.animations.filter(x => {
            if (name) {
                return x.name.startsWith(name)
            } else {
                return x.name.startsWith('CommonWait') || x.name.startsWith('DungeonWait')
            }
        })
        if (animations.length == 0) {
            if (name) {
                console.warn(`Animation "${name}" not found in "${this.object.name}"`)
            } else {
                console.warn(`Default animation not found in "${this.object.name}"`)
            }
            return []
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

        const animationNames = animations.map(x => x.name)
        console.log('Playing animation:', animationNames)

        this.lastPlayedAnimations = animationNames

        return animationNames
    }

    dispose() {
        removeAnimationLoop(this.animationLoop)
        this.mixer.stopAllAction()
        this.mixer.uncacheRoot(this.object)
        disposeObject(this.object)
        this.userData.textures.forEach(x => x.dispose())
    }
}
