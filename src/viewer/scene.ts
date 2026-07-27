import * as THREE from 'three'
import { MagiaExedraScene3D } from 'magia-exedra-character-three/scene'
import { characters } from './character';

export const viewerEl = document.getElementById('viewer')!

export const scene = new MagiaExedraScene3D(characters)

/**
 * ReDrive scenes use directional key light plus SH/sky fill rather than a very
 * strong flat AmbientLight. These two lights provide a visible neutral research
 * baseline until an official stage ReDriveVolume overrides the scene profile.
 */
export const recoveredHemisphereLight = new THREE.HemisphereLight(
    '#b9d2ff',
    '#75677f',
    0.78,
)
recoveredHemisphereLight.name = 'MagiusRecoveredHemisphereFill'
scene.scene.add(recoveredHemisphereLight)

export const recoveredFillLight = new THREE.DirectionalLight('#91b4ff', 0.42)
recoveredFillLight.name = 'MagiusRecoveredBackFill'
recoveredFillLight.position.set(-4.5, 2.8, -4.0)
recoveredFillLight.target.position.set(0, 1.25, 0)
scene.scene.add(recoveredFillLight)
scene.scene.add(recoveredFillLight.target)

viewerEl.appendChild(scene.renderer.domElement)

Object.assign(window, { scene })
