import { MagiaExedraScene3D } from 'magia-exedra-character-three/scene'
import { characters } from './character';

export const viewerEl = document.getElementById('viewer')!

export const scene = new MagiaExedraScene3D(characters)

viewerEl.appendChild(scene.renderer.domElement)

Object.assign(window, { scene })
