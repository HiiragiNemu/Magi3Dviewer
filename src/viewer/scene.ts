import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createRenderer } from 'magia-exedra-character-three'
import type MagiaExedraCharacter3D from 'magia-exedra-character-three/character'
import { characters } from './character';
import type { LoadCharacterCallbacks } from 'magia-exedra-character-three/loader';

export default class ViewerScene {
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene

    camera: THREE.PerspectiveCamera
    cameraInitialPosition: [number, number, number] = [0, 1.5, 10]

    controls: OrbitControls
    controlsInitialTarget: [number, number, number] = [0, 1, 0]

    ambientLight: THREE.AmbientLight

    animateLoopCallback: () => any = () => { }

    constructor(element: HTMLElement) {
        this.renderer = createRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.xr.enabled = true

        element.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        // scene.background = new THREE.Color(0x333333);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 2);
        this.scene.add(this.ambientLight);

        const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
        sunLight.position.set(5, 5, 5);
        this.scene.add(sunLight);

        this.camera = new THREE.PerspectiveCamera(10, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(...this.cameraInitialPosition);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.target.set(...this.controlsInitialTarget);

        this.renderer.setAnimationLoop(() => {
            this.controls.update();
            this.animateLoopCallback()
            this.renderer.render(this.scene, this.camera);
        })

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setPixelRatio(window.devicePixelRatio);
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        Object.assign(window, { scene: this })
    }

    character?: MagiaExedraCharacter3D
    characterLoading = false
    characterPending?: number | string
    characterPendingResolve?: (value: MagiaExedraCharacter3D) => void

    async switchCharacter(id: number | string, callbacks?: Partial<LoadCharacterCallbacks>): Promise<MagiaExedraCharacter3D> {
        return new Promise((resolve, reject) => {
            if (this.characterLoading) {
                this.characterPending = id
                this.characterPendingResolve = resolve
                return
            }
            this.characterLoading = true
            this.characterPending = undefined

            if (this.character) {
                this.scene.remove(this.character.object)
                this.character.dispose()
                this.character = undefined
            }

            characters.loadCharacterById(id, callbacks)
                .then(character => {
                    if (this.characterPending) return

                    this.character = character
                    this.scene.add(this.character.object)

                    resolve(this.character)
                })
                .catch(e => {
                    if (this.characterPending) return
                    reject(e)
                })
                .finally(() => {
                    this.characterLoading = false
                    if (this.characterPending) {
                        this.switchCharacter(this.characterPending, callbacks).then(x => {
                            if (!this.characterPending) this.characterPendingResolve!(x)
                        })
                    }
                })
        })
    }

    resetCameraControl() {
        this.camera.position.set(...this.cameraInitialPosition)
        this.controls.target.set(...this.controlsInitialTarget)
    }
}