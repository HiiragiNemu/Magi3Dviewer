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
    static cameraInitialFov = 15
    static cameraInitialPosition: [number, number, number] = [0, 1.5, 7.5]

    controls: OrbitControls
    static controlsInitialTarget: [number, number, number] = [0, 0.9, 0]

    ambientLight: THREE.AmbientLight
    static ambientLightInitialColor = '#ffffff'
    static ambientLightInitialIntensity = 2

    directionalLight: THREE.DirectionalLight
    static directionalLightInitialColor = '#ffffff'
    static directionalLightInitialIntensity = 1.5
    static directionalLightInitialAngle = -45
    static directionalLightInitialDistance = 5 * Math.sqrt(2)
    static directionalLightInitialHeight = 5

    axesHelper: THREE.AxesHelper

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

        this.ambientLight = new THREE.AmbientLight(ViewerScene.ambientLightInitialColor, ViewerScene.ambientLightInitialIntensity);
        this.scene.add(this.ambientLight);

        this.directionalLight = new THREE.DirectionalLight(ViewerScene.directionalLightInitialColor, ViewerScene.directionalLightInitialIntensity);
        const {
            x: directionalLightPositionX,
            z: directionalLightPositionZ
        } = deg2pos(ViewerScene.directionalLightInitialAngle, ViewerScene.directionalLightInitialDistance)
        this.directionalLight.position.set(
            directionalLightPositionX,
            ViewerScene.directionalLightInitialHeight,
            directionalLightPositionZ
        );
        this.scene.add(this.directionalLight);

        this.axesHelper = new THREE.AxesHelper(2);
        this.axesHelper.visible = false
        this.scene.add(this.axesHelper);

        this.camera = new THREE.PerspectiveCamera(ViewerScene.cameraInitialFov, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(...ViewerScene.cameraInitialPosition);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.target.set(...ViewerScene.controlsInitialTarget);

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
    }

    resetCameraControl() {
        this.camera.position.set(...ViewerScene.cameraInitialPosition)
        this.controls.target.set(...ViewerScene.controlsInitialTarget)
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
}

export function deg2pos(degrees: number, radius: number) {
    const rad = degrees * (Math.PI / 180);
    const x = -radius * Math.sin(rad);
    const z = radius * Math.cos(rad);
    return { x, z }
}