import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const generated = await readFile(
    new URL('./magia-exedra-character-three/submeshGroups.generated.ts', import.meta.url),
    'utf8',
)
const runtime = await readFile(
    new URL('./magia-exedra-character-three/submeshGroups.ts', import.meta.url),
    'utf8',
)

function counts(characterId, meshName) {
    const characterBlock = generated.match(
        new RegExp(`\\n    ${characterId}: \\{([\\s\\S]*?)\\n    \\},`),
    )?.[1]
    assert.ok(characterBlock, `missing character ${characterId}`)
    const values = characterBlock.match(
        new RegExp(`"${meshName}": \\[([^\\]]+)\\]`),
    )?.[1]
    assert.ok(values, `missing ${characterId}/${meshName}`)
    return values.split(',').map(value => Number(value.trim()))
}

test('Madoka official submesh counts exactly match the non-indexed FBX draw counts', () => {
    assert.deepEqual(counts(100107, 'Body_Mesh'), [34164, 834, 246])
    assert.equal(counts(100107, 'Body_Mesh').reduce((a, b) => a + b, 0), 35244)
    assert.deepEqual(counts(100107, 'Hair_Mesh'), [3261, 5709])
    assert.equal(counts(100107, 'Hair_Mesh').reduce((a, b) => a + b, 0), 8970)
    assert.deepEqual(counts(100107, 'weapon_b_mesh'), [4077, 48, 168])
})

test('runtime refuses partial group recovery and restores contiguous official ranges', () => {
    assert.match(runtime, /counts\.length !== materialSlotCount/)
    assert.match(runtime, /recoveredCount !== drawCount/)
    assert.match(runtime, /geometry\.clearGroups\(\)/)
    assert.match(runtime, /geometry\.addGroup\(start, count, materialIndex\)/)
})
