import MagiaExedraCharacterThree from "magia-exedra-character-three"

export const characters = new MagiaExedraCharacterThree(import.meta.glob([
    '../../node_modules/magia-exedra-character-three/models/**/*.fbx*',
    '../../node_modules/magia-exedra-character-three/models/**/*.png',
    '../../node_modules/magia-exedra-character-three/models/**/home-*.json*'
], { query: '?url', import: 'default', eager: true }))

Object.assign(window, { characters })
console.log('Imported character files:', characters.files)
