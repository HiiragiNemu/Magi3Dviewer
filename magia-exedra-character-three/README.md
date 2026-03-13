# magia-exedra-character-three

Load Magia Exedra 3D character models into three.js

All `.fbx`s are compressed with gzip which can enable transparent decompression when `Content-Encoding: gzip` header is set.

## Usage

```ts
import { MagiaExedraCharacterThree, MagiaExedraScene3D } from "magia-exedra-character-three"

// Import all models
const characters = new MagiaExedraCharacterThree(import.meta.glob([
    '../node_modules/magia-exedra-character-three/models/**/*.fbx*',
    '../node_modules/magia-exedra-character-three/models/**/*.png'
], { query: '?url', import: 'default', eager: true }))

// Create the scene
const scene = new MagiaExedraScene3D(characters)

// Add canvas to page
document.body.appendChild(scene.renderer.domElement)

// Load character model and add to scene
const character = (await scene.addCharacter(100107)).character! // 100107 = Madoka Kaname

// Play default animation
if (character.animation.default) {
    character.animation.play(character.animation.default, true)
}
```