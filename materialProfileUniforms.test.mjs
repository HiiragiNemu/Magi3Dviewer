import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const gemShader = await readFile(
    new URL('./magia-exedra-character-three/shaders/gem.ts', import.meta.url),
    'utf8',
)
const loader = await readFile(
    new URL('./magia-exedra-character-three/loader.ts', import.meta.url),
    'utf8',
)

test('per-slot gem uniforms update both the gem pass and special-jewel specular boost', () => {
    assert.match(gemShader, /set\('uMaterialIsGem', gem\.enabled \? 1 : 0\);/)
    assert.match(gemShader, /set\('uMaterialSpecialJewel', gem\.enabled \? 1 : 0\);/)
})

test('draw-group binding refreshes the official profile before each render', () => {
    assert.match(loader, /const profile = slotProfiles\[index\] \?\? slotProfiles\[0\]/)
    assert.match(loader, /setOfficialMaterialProfileUniforms\(shader, profile\)/)
})
