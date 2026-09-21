import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

const textureSource = read('./magia-exedra-character-three/texture.ts')
const hairSource = read('./magia-exedra-character-three/shaders/hair.ts')
const gemSource = read('./magia-exedra-character-three/shaders/gem.ts')
const loaderSource = read('./magia-exedra-character-three/loader.ts')
const authority = JSON.parse(read(
    './artifacts/verification/20260824-official-character-texture-sampling/official-sampler-authority.json',
))

const byName = new Map(authority.textures.map(row => [row.name, row]))

test('serialized sampler authority covers every current MatCap and AngelRing texture', () => {
    assert.equal(authority.missing.length, 0)
    assert.equal(authority.textures.length, 22)

    const commonRing = byName.get('RDToon_AngelRingMap')
    assert.deepEqual(
        [commonRing.mipCount, commonRing.colorSpace, commonRing.filterMode,
            commonRing.aniso, commonRing.wrapU, commonRing.wrapV],
        [1, 0, 1, 1, 1, 1],
    )
    const characterRing = byName.get('chara_108101_hair_highlight')
    assert.deepEqual(
        [characterRing.mipCount, characterRing.colorSpace,
            characterRing.filterMode, characterRing.aniso,
            characterRing.wrapU, characterRing.wrapV],
        [11, 1, 1, 1, 0, 0],
    )
    const mirroredRing = byName.get('chara_115201_hairhighlight')
    assert.deepEqual(
        [mirroredRing.mipCount, mirroredRing.colorSpace,
            mirroredRing.filterMode, mirroredRing.aniso,
            mirroredRing.wrapU, mirroredRing.wrapV],
        [10, 1, 1, 1, 2, 2],
    )

    const pearl = byName.get('chara_100903_body_pearl_matcap')
    assert.deepEqual(
        [pearl.mipCount, pearl.colorSpace, pearl.filterMode,
            pearl.aniso, pearl.wrapU, pearl.wrapV],
        [8, 0, 1, 1, 0, 0],
    )
    const weapon = byName.get('chara_100903_weapon_a_sp_matcap')
    assert.deepEqual(
        [weapon.mipCount, weapon.colorSpace, weapon.filterMode,
            weapon.aniso, weapon.wrapU, weapon.wrapV],
        [1, 1, 1, 1, 0, 0],
    )
})

test('common and character AngelRing maps keep separate official samplers', () => {
    assert.match(textureSource, /ApplyOfficialCommonAngelRingSampling/)
    assert.match(textureSource, /ApplyOfficialCharacterAngelRingSampling/)
    assert.match(textureSource, /THREE\.LinearMipmapNearestFilter/)
    assert.match(textureSource, /THREE\.MirroredRepeatWrapping/)
    assert.match(textureSource, /tex\.anisotropy = 1/)

    assert.match(hairSource, /ApplyOfficialCommonAngelRingSampling\(commonAngelRingTex\)/)
    assert.match(
        hairSource,
        /ApplyOfficialCharacterAngelRingSampling\(\s*characterAngelRingTex,\s*options\.angelRingMapName/,
    )
    assert.doesNotMatch(
        hairSource,
        /MaximizeTextureQuality\(commonAngelRingTex, characterAngelRingTex\)/,
    )
    assert.match(loaderSource, /angelRingMapName/)
})

test('MatCap routing applies exact color space, mip and wrapping metadata by texture key', () => {
    assert.match(textureSource, /ApplyOfficialMatCapSampling/)
    assert.match(textureSource, /chara_100304_matcap_metallic/)
    assert.match(textureSource, /chara_100903_body_pearl_matcap/)
    assert.match(textureSource, /chara_100903_weapon_a_sp_matcap/)
    assert.match(textureSource, /matcap_softmetallic/)
    assert.match(textureSource, /matcap02_invert/)

    assert.match(gemSource, /ApplyOfficialMatCapSampling\(texture, name\)/)
    assert.match(gemSource, /ApplyOfficialMatCapSampling\(fallbackMatCap, fallbackName\)/)
    assert.doesNotMatch(gemSource, /MaximizeTextureQuality\(texture\)/)
    assert.doesNotMatch(gemSource, /fallbackMatCap\.wrapS = THREE\.ClampToEdgeWrapping/)
})
